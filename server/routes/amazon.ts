/**
 * Amazon Selling Partner API surface.
 *
 * Every endpoint works before Amazon is configured — they report what is
 * missing rather than throwing — because the developer registration takes days
 * and the CRM has to be able to show readiness in the meantime.
 *
 * Nothing here lists automatically. Matching is read-only, and listing is
 * per-SKU with a dry run, deliberately: this is the same "look first, then
 * ramp" order that the eBay pipeline earned the hard way.
 */

import type { Express } from "express";
import { eq, sql } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import { db } from "../db";
import { products } from "@shared/schema";
import { storage } from "../storage";
import { withLease, describeRefusal } from "../job-lease";
import { leaseStore } from "../storage";
import { describeAmazonConfig, getAmazonConfig, isAmazonConfigured } from "../amazon-config";
import { amazonSpApi } from "../amazon-sp-api";
import {
  buildOfferOnlyListing,
  buildOfferPatches,
  preflightAmazon,
  amazonSellerSku,
  amazonQuantity,
} from "../amazon-listing";
import { isMatchEnabled, setMatchEnabled, runMatchSweep, matchProgress, matchOne } from "../amazon-matcher";

/** Consistent refusal when credentials are absent, naming what to set. */
function notConfigured(res: any) {
  const d = describeAmazonConfig();
  return res.status(503).json({
    ok: false,
    configured: false,
    error: `Amazon SP-API is not configured — missing: ${d.missing.join(", ")}`,
    missing: d.missing,
  });
}

export function registerAmazonRoutes(app: Express): void {
  /**
   * Readiness + coverage. Safe to call at any stage: before credentials it
   * reports what is missing; after, it reports how much of the catalogue is
   * matched and listable.
   */
  app.get("/api/amazon/status", requireAuth, async (_req, res) => {
    try {
      const config = describeAmazonConfig();
      const progress = await matchProgress().catch(() => null);
      const listable: any = await db.execute(sql`
        SELECT count(*) FILTER (WHERE amazon_match_status = 'matched'
                                AND status = 'active'
                                AND stock > 0
                                AND exclude_from_listing IS NOT TRUE)::int AS ready_to_list,
               count(*) FILTER (WHERE listed_on_amazon = true)::int AS listed,
               count(*) FILTER (WHERE amazon_listing_status = 'error')::int AS listing_errors
        FROM products
      `);
      res.json({
        ok: true,
        config,
        matching: progress,
        listing: (listable.rows ?? listable)?.[0] ?? null,
        sweepEnabled: await isMatchEnabled().catch(() => false),
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: (error as Error).message });
    }
  });

  /**
   * Credential check. Uses the Sellers API, which needs no restricted role,
   * so it is the first thing that can be verified once the app is authorised —
   * and it reports which marketplaces the account may actually sell on.
   */
  app.get("/api/amazon/test-connection", requireAuth, async (_req, res) => {
    if (!isAmazonConfigured()) return notConfigured(res);
    try {
      const r = await amazonSpApi.getMarketplaceParticipations();
      if (!r.ok) {
        return res.status(r.status || 502).json({ ok: false, error: r.error, code: r.code, transient: r.transient });
      }
      const participations = (r.data as any)?.payload ?? (r.data as any)?.participations ?? [];
      const c = getAmazonConfig();
      res.json({
        ok: true,
        target: { marketplaceId: c.marketplaceId, marketplace: c.marketplaceCode, endpoint: c.endpoint },
        marketplaces: (participations as any[]).map((p) => ({
          id: p?.marketplace?.id,
          name: p?.marketplace?.name,
          countryCode: p?.marketplace?.countryCode,
          currencyCode: p?.marketplace?.defaultCurrencyCode,
          canSell: p?.participation?.isParticipating,
        })),
        configuredMarketplaceIsAvailable: (participations as any[]).some((p) => p?.marketplace?.id === c.marketplaceId),
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: (error as Error).message });
    }
  });

  /**
   * Catalogue match sweep controls. ?sweep=start|stop|status; a start also
   * runs the first slice inline so the operator sees immediate evidence, and
   * the cron continues it.
   */
  app.get("/api/amazon/match", requireAuth, async (req, res) => {
    try {
      const sweep = String(req.query.sweep ?? "status");
      if (sweep === "status") {
        return res.json({ ok: true, enabled: await isMatchEnabled(), progress: await matchProgress() });
      }
      if (sweep === "stop") {
        await setMatchEnabled(false);
        return res.json({ ok: true, enabled: false, progress: await matchProgress() });
      }
      if (sweep === "start") {
        if (!isAmazonConfigured()) return notConfigured(res);
        await setMatchEnabled(true);
        const leased = await withLease(leaseStore, "amazon-match", { ttlSeconds: 300 }, () => runMatchSweep(60_000));
        return res.json({
          ok: true,
          enabled: true,
          firstSlice: leased.ran ? leased.result : describeRefusal("amazon-match", leased),
          note: "the /api/cron/amazon-match tick works the sweep while enabled; it disables itself when done",
        });
      }
      res.status(400).json({ ok: false, error: "sweep must be start, stop or status" });
    } catch (error) {
      res.status(500).json({ ok: false, error: (error as Error).message });
    }
  });

  /** Match one SKU — the per-product debugging path. */
  app.post("/api/amazon/match/:sku", requireAuth, async (req, res) => {
    if (!isAmazonConfigured()) return notConfigured(res);
    try {
      res.json(await matchOne(req.params.sku));
    } catch (error) {
      res.status(500).json({ ok: false, error: (error as Error).message });
    }
  });

  const matchCronHandler = async (_req: any, res: any) => {
    try {
      if (!isAmazonConfigured()) {
        return res.json({ ok: true, skipped: true, reason: "Amazon SP-API not configured" });
      }
      if (!(await isMatchEnabled())) {
        return res.json({ ok: true, skipped: true, reason: "match sweep not enabled" });
      }
      const leased = await withLease(leaseStore, "amazon-match", { ttlSeconds: 300 }, () => runMatchSweep(250_000));
      if (!leased.ran) {
        return res.json({ ok: true, skipped: true, reason: describeRefusal("amazon-match", leased) });
      }
      const r = leased.result;
      if (r.done) {
        await setMatchEnabled(false);
        await storage.createSyncLog({
          source: "amazon",
          operation: "match_complete",
          status: "success",
          message: `catalogue match complete — last slice: ${r.matched} matched, ${r.noAsin} without ASIN, ${r.noEan} without EAN`,
        });
      }
      res.json({ ok: true, ...r });
    } catch (error) {
      res.status(500).json({ ok: false, error: (error as Error).message });
    }
  };
  app.get("/api/cron/amazon-match", matchCronHandler);
  app.post("/api/cron/amazon-match", matchCronHandler);

  /**
   * Preview what we WOULD send for a SKU. Pure — no Amazon call — so the
   * payload can be reviewed before any credentials exist.
   */
  app.get("/api/amazon/preview/:sku", requireAuth, async (req, res) => {
    try {
      const [product] = await db.select().from(products).where(eq(products.sku, req.params.sku)).limit(1);
      if (!product) return res.status(404).json({ ok: false, error: "no such product" });
      const c = getAmazonConfig();
      const pre = preflightAmazon(product);
      res.json({
        ok: true,
        sku: amazonSellerSku(product),
        preflight: pre,
        quantity: amazonQuantity(product),
        asin: product.amazonAsin,
        matchStatus: product.amazonMatchStatus,
        payload: pre.ok
          ? buildOfferOnlyListing({
              product,
              marketplaceId: c.marketplaceId,
              currency: c.currency,
              shippingGroup: process.env.AMAZON_SHIPPING_GROUP || undefined,
            })
          : null,
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: (error as Error).message });
    }
  });

  /**
   * List one product. ?dryRun=1 submits with mode=VALIDATION_PREVIEW, which
   * asks Amazon to validate the payload and return issues WITHOUT creating
   * the listing — the Amazon equivalent of ?maxBatches=1, and how the first
   * real submission should always be tested.
   */
  app.post("/api/amazon/list/:sku", requireAuth, async (req, res) => {
    if (!isAmazonConfigured()) return notConfigured(res);
    try {
      const dryRun = req.query.dryRun === "1" || req.body?.dryRun === true;
      const [product] = await db.select().from(products).where(eq(products.sku, req.params.sku)).limit(1);
      if (!product) return res.status(404).json({ ok: false, error: "no such product" });

      const pre = preflightAmazon(product);
      if (!pre.ok) {
        return res.status(400).json({ ok: false, sku: product.sku, error: pre.reasons.join("; "), preflight: pre });
      }

      // Blocked SKUs must never reach a marketplace, whichever one it is.
      const blocked = await storage.filterBlockedCodes([product.sku]);
      if (blocked.has(product.sku.toUpperCase())) {
        return res.status(400).json({ ok: false, sku: product.sku, error: "SKU is on the blocked list" });
      }

      const c = getAmazonConfig();
      const sellerSku = amazonSellerSku(product);
      const payload = buildOfferOnlyListing({
        product,
        marketplaceId: c.marketplaceId,
        currency: c.currency,
        shippingGroup: process.env.AMAZON_SHIPPING_GROUP || undefined,
      });

      const r = await amazonSpApi.putListingsItem(sellerSku, payload, { dryRun });
      const issues = (r.data as any)?.issues ?? [];

      if (!r.ok) {
        if (!dryRun) {
          await storage.updateProduct(product.id, {
            amazonListingStatus: "error",
            amazonListingError: (r.error ?? "unknown").slice(0, 500),
            amazonListAttempts: (product.amazonListAttempts ?? 0) + 1,
          });
        }
        return res.status(r.status || 502).json({ ok: false, sku: sellerSku, dryRun, error: r.error, code: r.code, issues, transient: r.transient });
      }

      // Amazon can return 200 with a non-ACCEPTED status and blocking issues:
      // an HTTP success is not a published listing.
      const status = (r.data as any)?.status;
      const accepted = status === "ACCEPTED";
      if (!dryRun && accepted) {
        await storage.updateProduct(product.id, {
          listedOnAmazon: true,
          amazonListingStatus: "published",
          amazonListingError: null,
          amazonListAttempts: 0,
        });
      } else if (!dryRun && !accepted) {
        await storage.updateProduct(product.id, {
          amazonListingStatus: "error",
          amazonListingError: `submission status ${status}: ${issues.map((i: any) => i.message).join("; ")}`.slice(0, 500),
          amazonListAttempts: (product.amazonListAttempts ?? 0) + 1,
        });
      }

      res.json({ ok: accepted, sku: sellerSku, dryRun, status, issues, asin: product.amazonAsin, payload: dryRun ? payload : undefined });
    } catch (error) {
      res.status(500).json({ ok: false, error: (error as Error).message });
    }
  });

  /** Read a live listing back from Amazon — reconciliation for one SKU. */
  app.get("/api/amazon/listing/:sku", requireAuth, async (req, res) => {
    if (!isAmazonConfigured()) return notConfigured(res);
    try {
      const r = await amazonSpApi.getListingsItem(req.params.sku);
      if (!r.ok) return res.status(r.status || 502).json({ ok: false, error: r.error, code: r.code });
      res.json({ ok: true, listing: r.data });
    } catch (error) {
      res.status(500).json({ ok: false, error: (error as Error).message });
    }
  });

  /** Push current price and quantity for one SKU (the cheap patch path). */
  app.post("/api/amazon/sync-offer/:sku", requireAuth, async (req, res) => {
    if (!isAmazonConfigured()) return notConfigured(res);
    try {
      const [product] = await db.select().from(products).where(eq(products.sku, req.params.sku)).limit(1);
      if (!product) return res.status(404).json({ ok: false, error: "no such product" });
      const c = getAmazonConfig();
      const patches = buildOfferPatches({
        marketplaceId: c.marketplaceId,
        currency: c.currency,
        price: parseFloat(product.salePrice),
        quantity: amazonQuantity(product),
      });
      const r = await amazonSpApi.patchListingsItem(amazonSellerSku(product), patches);
      if (!r.ok) return res.status(r.status || 502).json({ ok: false, error: r.error, code: r.code });
      res.json({ ok: true, sku: product.sku, status: (r.data as any)?.status, patches });
    } catch (error) {
      res.status(500).json({ ok: false, error: (error as Error).message });
    }
  });
}

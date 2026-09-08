/**
 * EAN → ASIN matching sweep.
 *
 * Selling on Amazon as a reseller means attaching offers to ASINs that already
 * exist, so before anything can be listed the catalogue has to be matched. At
 * ~46k products and a 2 requests/second catalogue limit, that is hours of
 * calls — so it is built exactly like the recategorize and reprice sweeps:
 * cron-driven time-bounded slices, a DB kill-switch, a lease, and a resumable
 * cursor. Nothing here lists anything; matching is read-only against Amazon.
 *
 * Every product ends in one of five states, recorded on the row so the result
 * is auditable and the sweep is re-runnable without redoing settled work:
 *   matched   — amazonAsin set, ready to list
 *   no_ean    — no usable barcode; can never be listed as an offer (permanent)
 *   no_asin   — Amazon has no catalogue entry for this barcode (recheck later)
 *   ambiguous — several ASINs and none echoed our barcode; needs a human
 *   error     — the lookup itself failed; retried on the next pass
 */

import { and, asc, eq, gt, isNull, or, sql } from "drizzle-orm";
import { db } from "./db";
import { products, type Product } from "@shared/schema";
import { storage } from "./storage";
import { amazonSpApi } from "./amazon-sp-api";
import { isAmazonConfigured } from "./amazon-config";
import { isValidBarcode, pickAsinForBarcode } from "./amazon-listing";

const BATCH = 100;
/** Catalog Items accepts several identifiers per call; batching cuts the
 *  sweep's wall-clock by an order of magnitude against a 2 rps limit. */
const IDENTIFIERS_PER_CALL = 20;

export interface MatchStats {
  enabled: boolean;
  done: boolean;
  scanned: number;
  matched: number;
  noEan: number;
  noAsin: number;
  ambiguous: number;
  errors: number;
  cursor: number;
  budgetHit: boolean;
  sampleErrors: string[];
}

async function getSetting(name: string): Promise<string | undefined> {
  const rows = await storage.getMarketplaceSettings("amazon");
  return (rows as any[]).find((s) => s.setting === name)?.value;
}

export async function isMatchEnabled(): Promise<boolean> {
  return (await getSetting("match_sweep")) === "on";
}

export async function setMatchEnabled(on: boolean): Promise<void> {
  await storage.setMarketplaceSetting({ marketplace: "amazon", setting: "match_sweep", value: on ? "on" : "off" });
  if (on) {
    await storage.setMarketplaceSetting({ marketplace: "amazon", setting: "match_cursor", value: "0" });
  }
}

/** Coverage report: how far the catalogue is from being listable on Amazon. */
export async function matchProgress(): Promise<{
  cursor: number;
  total: number;
  unchecked: number;
  byStatus: Record<string, number>;
}> {
  const cursor = Number((await getSetting("match_cursor")) ?? 0) || 0;
  const q: any = await db.execute(sql`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE amazon_match_status IS NULL)::int AS unchecked,
           count(*) FILTER (WHERE amazon_match_status = 'matched')::int AS matched,
           count(*) FILTER (WHERE amazon_match_status = 'no_ean')::int AS no_ean,
           count(*) FILTER (WHERE amazon_match_status = 'no_asin')::int AS no_asin,
           count(*) FILTER (WHERE amazon_match_status = 'ambiguous')::int AS ambiguous,
           count(*) FILTER (WHERE amazon_match_status = 'error')::int AS error
    FROM products
  `);
  const row = (q.rows ?? q)?.[0] ?? {};
  return {
    cursor,
    total: row.total ?? 0,
    unchecked: row.unchecked ?? 0,
    byStatus: {
      matched: row.matched ?? 0,
      no_ean: row.no_ean ?? 0,
      no_asin: row.no_asin ?? 0,
      ambiguous: row.ambiguous ?? 0,
      error: row.error ?? 0,
    },
  };
}

/** One time-bounded slice; the cron calls this repeatedly until done. */
export async function runMatchSweep(budgetMs = 250_000): Promise<MatchStats> {
  const started = Date.now();
  const stats: MatchStats = {
    enabled: true,
    done: false,
    scanned: 0,
    matched: 0,
    noEan: 0,
    noAsin: 0,
    ambiguous: 0,
    errors: 0,
    cursor: 0,
    budgetHit: false,
    sampleErrors: [],
  };

  if (!isAmazonConfigured()) {
    stats.sampleErrors.push("Amazon SP-API is not configured — nothing to match against");
    return stats;
  }

  let cursor = Number((await getSetting("match_cursor")) ?? 0) || 0;

  for (;;) {
    if (Date.now() - started >= budgetMs) {
      stats.budgetHit = true;
      break;
    }

    // Only rows never checked, or whose last check was a soft miss worth
    // retrying. 'matched', 'no_ean' and 'ambiguous' are settled: re-asking
    // Amazon about them every pass would burn the whole rate limit on work
    // whose answer cannot have changed (or needs a human, not a retry).
    const batch = await db
      .select()
      .from(products)
      .where(
        and(
          gt(products.id, cursor),
          or(
            isNull(products.amazonMatchStatus),
            eq(products.amazonMatchStatus, "no_asin"),
            eq(products.amazonMatchStatus, "error"),
          ),
        ),
      )
      .orderBy(asc(products.id))
      .limit(BATCH);

    if (batch.length === 0) {
      stats.done = true;
      break;
    }

    // Split by barcode validity first — a missing EAN needs no API call.
    const needLookup: Product[] = [];
    for (const p of batch as Product[]) {
      stats.scanned++;
      if (!isValidBarcode(p.ean)) {
        stats.noEan++;
        await storage.updateProduct(p.id, {
          amazonMatchStatus: "no_ean",
          amazonMatchedAt: new Date(),
        });
        continue;
      }
      needLookup.push(p);
    }

    for (let i = 0; i < needLookup.length; i += IDENTIFIERS_PER_CALL) {
      if (Date.now() - started >= budgetMs) {
        stats.budgetHit = true;
        break;
      }
      const chunk = needLookup.slice(i, i + IDENTIFIERS_PER_CALL);
      const eans = chunk.map((p) => p.ean!.trim());
      const res = await amazonSpApi.searchCatalogItemsByIdentifier(eans, "EAN");

      if (!res.ok) {
        // A throttled or broken lookup is not a verdict about the product:
        // mark it 'error' so the next pass retries, and never set no_asin.
        stats.errors += chunk.length;
        if (stats.sampleErrors.length < 3 && res.error) stats.sampleErrors.push(res.error);
        for (const p of chunk) {
          await storage.updateProduct(p.id, {
            amazonMatchStatus: "error",
            amazonMatchedAt: new Date(),
            amazonListingError: `catalogue lookup failed: ${res.error ?? "unknown"}`.slice(0, 500),
          });
        }
        continue;
      }

      // The response mixes results for every barcode in the call, so each
      // product picks its own ASIN out of the shared item list.
      for (const p of chunk) {
        const hit = pickAsinForBarcode(res.data, p.ean!.trim());
        if (hit) {
          stats.matched++;
          await storage.updateProduct(p.id, {
            amazonAsin: hit.asin,
            amazonMatchStatus: "matched",
            amazonMatchedAt: new Date(),
            amazonListingError: null,
          });
        } else {
          const items = (res.data as any)?.items ?? [];
          const ambiguous = items.length > 1;
          if (ambiguous) stats.ambiguous++;
          else stats.noAsin++;
          await storage.updateProduct(p.id, {
            amazonMatchStatus: ambiguous ? "ambiguous" : "no_asin",
            amazonMatchedAt: new Date(),
          });
        }
      }
    }

    cursor = (batch[batch.length - 1] as Product).id;
    await storage.setMarketplaceSetting({ marketplace: "amazon", setting: "match_cursor", value: String(cursor) });
  }

  stats.cursor = cursor;
  return stats;
}

/** Match a single product on demand — the per-SKU debugging path. */
export async function matchOne(sku: string): Promise<{
  ok: boolean;
  sku: string;
  status: string;
  asin?: string;
  title?: string;
  brand?: string;
  candidates?: number;
  error?: string;
}> {
  const [product] = await db.select().from(products).where(eq(products.sku, sku)).limit(1);
  if (!product) return { ok: false, sku, status: "not_found", error: "no such product" };
  if (!isValidBarcode(product.ean)) {
    await storage.updateProduct(product.id, { amazonMatchStatus: "no_ean", amazonMatchedAt: new Date() });
    return { ok: false, sku, status: "no_ean", error: "product has no valid EAN" };
  }

  const res = await amazonSpApi.searchCatalogItemsByIdentifier([product.ean!.trim()], "EAN");
  if (!res.ok) {
    await storage.updateProduct(product.id, { amazonMatchStatus: "error", amazonMatchedAt: new Date() });
    return { ok: false, sku, status: "error", error: res.error };
  }

  const items = (res.data as any)?.items ?? [];
  const hit = pickAsinForBarcode(res.data, product.ean!.trim());
  if (!hit) {
    const status = items.length > 1 ? "ambiguous" : "no_asin";
    await storage.updateProduct(product.id, { amazonMatchStatus: status, amazonMatchedAt: new Date() });
    return { ok: false, sku, status, candidates: items.length };
  }

  await storage.updateProduct(product.id, {
    amazonAsin: hit.asin,
    amazonMatchStatus: "matched",
    amazonMatchedAt: new Date(),
    amazonListingError: null,
  });
  return { ok: true, sku, status: "matched", asin: hit.asin, title: hit.title, brand: hit.brand, candidates: items.length };
}

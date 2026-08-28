import type { Express } from "express";
import { requireAuth } from "../middleware/auth";
import { storage } from "../storage";
import { parseProductCodes } from "@shared/product-codes";

/**
 * The blocklist: products we must never sell again.
 *
 * Triggered by an eBay policy removal, a supplier withdrawal, or anything else
 * that makes an item unsellable. Blocking has to do four things at once, or it
 * leaks:
 *   1. record the code, durably and independently of the product row
 *   2. neutralise the product now (no stock, not listable)
 *   3. END the live eBay listing, since that is what got us the email
 *   4. stop future imports recreating it
 *
 * (1) and (4) are the ones people forget: delete the product and the next
 * catalogue sync brings it straight back.
 */
export function registerBlocklistRoutes(app: Express) {
  app.get("/api/blocklist", requireAuth, async (_req, res) => {
    try {
      const rows = await storage.listBlockedProducts();
      res.json({
        success: true,
        count: rows.length,
        blocked: rows.map((r: any) => ({
          code: r.code,
          reason: r.reason,
          notes: r.notes,
          blockedBy: r.blocked_by,
          createdAt: r.created_at,
          productId: r.product_id ?? null,
          name: r.name ?? null,
          // A blocked code with a live listing means the withdrawal failed and
          // needs another attempt — worth seeing rather than assuming.
          stillListed: !!r.listed_on_ebay,
        })),
      });
    } catch (error) {
      console.error("Blocklist fetch failed:", error);
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  /** Preview: what would this paste actually block? No writes. */
  app.post("/api/blocklist/preview", requireAuth, async (req, res) => {
    try {
      const parsed = parseProductCodes(String(req.body?.codes ?? ""));
      const already = await storage.filterBlockedCodes(parsed.codes);
      res.json({
        success: true,
        ...parsed,
        alreadyBlocked: Array.from(already),
        newCodes: parsed.codes.filter((c) => !already.has(c)),
      });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  app.post("/api/blocklist", requireAuth, async (req, res) => {
    try {
      const parsed = parseProductCodes(String(req.body?.codes ?? ""));
      if (parsed.codes.length === 0) {
        return res.status(400).json({ success: false, error: "No usable product codes found", ...parsed });
      }

      const result = await storage.addBlockedProducts(parsed.codes, {
        reason: req.body?.reason ? String(req.body.reason).slice(0, 500) : undefined,
        notes: req.body?.notes ? String(req.body.notes).slice(0, 2000) : undefined,
        blockedBy: (req as any).session?.userId ? String((req as any).session.userId) : "operator",
      });

      // End live listings. Done after the DB write, so a marketplace failure
      // leaves the product blocked rather than half-blocked — the listing can
      // be retried, but the block must not depend on eBay being reachable.
      const ended: string[] = [];
      const endFailures: Array<{ sku: string; error: string }> = [];
      if (result.listedProducts.length > 0) {
        const { ebayInventoryApi } = await import("../ebay-inventory-api");
        for (const p of result.listedProducts) {
          if (!p.ebayOfferId) {
            endFailures.push({ sku: p.sku, error: "no eBay offer id on the product" });
            continue;
          }
          try {
            const w = await ebayInventoryApi.withdrawOffer(p.ebayOfferId);
            if (w.ok) {
              ended.push(p.sku);
              await storage.updateProduct(p.id, {
                listedOnEbay: false,
                ebayListingStatus: "blocked",
                ebayListingError: "withdrawn — product blocked",
              });
            } else {
              endFailures.push({ sku: p.sku, error: w.error ?? "withdraw failed" });
            }
          } catch (e) {
            endFailures.push({ sku: p.sku, error: (e as Error).message });
          }
        }
      }

      await storage.createSyncLog({
        source: "ebay",
        operation: "blocklist",
        status: endFailures.length > 0 ? "partial" : "success",
        message: `Blocked ${result.added} code(s); ${result.productsAffected} product(s) affected, ${ended.length} listing(s) ended${endFailures.length ? `, ${endFailures.length} failed to end` : ""}`,
        details: JSON.stringify({ codes: parsed.codes.slice(0, 100), ended, endFailures }),
      });

      res.json({
        success: true,
        added: result.added,
        alreadyBlocked: result.alreadyBlocked,
        productsAffected: result.productsAffected,
        listingsEnded: ended.length,
        endFailures,
        rejected: parsed.rejected,
        duplicates: parsed.duplicates,
      });
    } catch (error) {
      console.error("Block failed:", error);
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  app.delete("/api/blocklist/:code", requireAuth, async (req, res) => {
    try {
      const removed = await storage.removeBlockedProduct(String(req.params.code));
      res.json({
        success: true,
        removed,
        note: "Unblocked. The product stays inactive with zero stock until the next TME sync refreshes it, and it will not relist until then.",
      });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });
}

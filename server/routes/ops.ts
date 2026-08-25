import type { Express } from "express";
import { storage } from "../storage";
import { requireAuth } from "../middleware/auth";
import { getRampPriceRange } from "../ramp-config";

/**
 * Operations dashboard + listing-ramp manual controls, extracted from the
 * routes monolith. Behaviour is identical to the previous inline handlers.
 */
export function registerOpsRoutes(app: Express) {
  // Compact daily-operations snapshot for the Operations page: API calls
  // used today (eBay + TME, persisted), job runs/errors today, sync queue
  // depth, eBay listing breakdown, and the most recent sync logs. All from
  // cheap aggregate queries (no full-table scans).
  app.get("/api/ops/daily", requireAuth, async (_req, res) => {
    try {
      const { validateListingEnv } = await import("../ebay-env");
      const [ebayUsage, tmeUsage, queue, listings, logStats, recentLogs, allLogs] =
        await Promise.all([
          storage.getApiUsage("ebay"),
          storage.getApiUsage("tme"),
          storage.getSyncQueueStats(),
          storage.getEbayListingStats(),
          storage.getSyncLogStatsToday(),
          storage.getSyncLogs(15),
          storage.getSyncLogs(200),
        ]);
      const envCheck = validateListingEnv();

      const parseDetails = (l: any) => {
        try { return l?.details ? JSON.parse(l.details) : {}; } catch { return {}; }
      };
      const lastCron = allLogs.find((l) => l.source === "tme" && l.operation === "cron_sync");

      res.json({
        date: new Date().toISOString().slice(0, 10),
        apiCalls: {
          ebay: {
            callsToday: ebayUsage?.callsToday ?? 0,
            // Read the enforced limit from the DB row (self-healed daily from
            // EBAY_DAILY_LIMIT) instead of displaying a hardcoded 2M that the
            // budget guard didn't actually use.
            dailyLimit: ebayUsage?.dailyLimit ?? 2_000_000,
            lastResetAt: ebayUsage?.lastResetAt ?? null,
            updatedAt: ebayUsage?.updatedAt ?? null,
          },
          tme: {
            callsToday: tmeUsage?.callsToday ?? 0,
            dailyLimit: tmeUsage?.dailyLimit ?? 10_000,
            lastResetAt: tmeUsage?.lastResetAt ?? null,
            updatedAt: tmeUsage?.updatedAt ?? null,
          },
        },
        jobs: {
          runsToday: logStats.bySource,
          totalRunsToday: logStats.total,
          errorsToday: logStats.errors,
          recentErrors: logStats.recentErrors,
          lastCronSync: lastCron
            ? { status: lastCron.status, at: lastCron.syncedAt, ...parseDetails(lastCron) }
            : null,
        },
        queue,
        listings: {
          totalTme: listings.totalTme,
          listedOnEbay: listings.listed,
          listedWithOfferId: listings.listedWithOfferId,
          listedLegacyItemIdOnly: listings.listedItemIdOnly,
          notYetListed: Math.max(0, listings.totalTme - listings.listed),
        },
        recentLogs: recentLogs.map((l) => ({
          source: l.source,
          operation: l.operation,
          status: l.status,
          message: l.message,
          syncedAt: l.syncedAt,
        })),
        listingEnv: {
          ok: envCheck.ok,
          rampEnabled: process.env.LISTING_RAMP_ENABLED === "true",
          rampPaused:
            (await storage.getMarketplaceSettings("ebay")).find(
              (s) => s.setting === "listing_ramp_paused",
            )?.value === "true",
          rampPriceRange: await getRampPriceRange(),
          issues: envCheck.issues,
        },
      });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Listing-ramp manual controls. Live publishing requires {confirm:true}
  // in the body so a single click can't ship products by accident.
  // WHY did listings fail? The ramp's sync log only carries counts
  // ("275 failed"), but every failure is persisted per-product in
  // products.ebay_listing_error. This groups those errors by normalised
  // message with counts + sample SKUs, so one request answers "what is
  // actually blocking my listings" instead of guessing.
  app.get("/api/ops/list-ramp/failures", requireAuth, async (_req, res) => {
    try {
      const { db } = await import("../db");
      const { sql } = await import("drizzle-orm");
      const r: any = await db.execute(sql`
        SELECT
          -- Collapse ids/numbers so the same failure groups together.
          regexp_replace(left(ebay_listing_error, 180), '[0-9]{3,}', 'N', 'g') AS reason,
          COUNT(*)::int AS count,
          (array_agg(sku ORDER BY id))[1:5] AS sample_skus,
          MAX(ebay_list_attempts)::int AS max_attempts,
          -- One VERBATIM example: the normalised reason above hides the eBay
          -- errorId and the parameters array, which name the offending field.
          (array_agg(ebay_listing_error ORDER BY id))[1] AS sample_full_error
        FROM products
        WHERE ebay_listing_error IS NOT NULL AND ebay_listing_error <> ''
        GROUP BY 1
        ORDER BY 2 DESC
        LIMIT 25
      `);
      const groups = (r.rows ?? r) as Array<{ reason: string; count: number; sample_skus: string[]; max_attempts: number; sample_full_error: string }>;
      const totalRow: any = await db.execute(sql`
        SELECT COUNT(*)::int AS n FROM products
        WHERE ebay_listing_error IS NOT NULL AND ebay_listing_error <> ''`);
      res.json({
        success: true,
        totalWithErrors: (totalRow.rows ?? totalRow)[0]?.n ?? 0,
        groups,
        hint: "Fix the top reason, then clear attempts via /api/ebay/reset-list-attempts and let the ramp retry.",
      });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  app.post("/api/ops/list-ramp/preview", requireAuth, async (_req, res) => {
    try {
      // Compute inline (no internal HTTP hop) — a server-to-server fetch to
      // our own deployment hits Vercel deployment protection on previews and
      // returns 401. This is read-only and already behind requireAuth.
      const batchSize = 25;
      const range = await getRampPriceRange();
      const [candidates, totalCandidatesRemaining] = await Promise.all([
        storage.getListingCandidates(batchSize, range),
        storage.getListingCandidateCount(range),
      ]);
      res.json({
        success: true,
        dryRun: true,
        priceRange: range,
        wouldPublishNow: candidates.length,
        totalCandidatesRemaining,
        sample: candidates.map((p: any) => ({
          id: p.id,
          sku: p.sku,
          name: p.name,
          stock: p.stock,
          salePrice: p.salePrice,
          supplierPrice: p.supplierPrice,
        })),
      });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  app.post("/api/ops/list-ramp/start", requireAuth, async (req, res) => {
    try {
      if (req.body?.confirm !== true) {
        return res.status(400).json({
          success: false,
          error: "Live listing requires {confirm:true}. Use /preview first to see what would be listed.",
        });
      }
      if (process.env.LISTING_RAMP_ENABLED !== "true") {
        return res.status(412).json({ success: false, error: "LISTING_RAMP_ENABLED is not 'true'" });
      }
      // Clear any prior pause so this run actually proceeds.
      await storage.setMarketplaceSetting({ marketplace: "ebay", setting: "listing_ramp_paused", value: "false" });
      const base = process.env.PUBLIC_BASE_URL || `https://${req.headers.host}`;
      const secret = process.env.CRON_SECRET;
      fetch(`${base}/api/cron/list-ramp`, {
        method: "POST",
        headers: secret ? { authorization: `Bearer ${secret}` } : {},
      }).catch(() => {});
      res.json({ success: true, message: "Listing ramp started (background). Watch Operations for progress." });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  // Immediate stop: set the DB pause flag. Any in-flight self-chain checks
  // the flag before its next batch and exits cleanly (within ≤270s).
  app.post("/api/ops/list-ramp/pause", requireAuth, async (_req, res) => {
    try {
      await storage.setMarketplaceSetting({ marketplace: "ebay", setting: "listing_ramp_paused", value: "true" });
      res.json({ success: true, message: "Ramp paused. The current chain will stop before its next batch." });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  app.post("/api/ops/list-ramp/resume", requireAuth, async (_req, res) => {
    try {
      await storage.setMarketplaceSetting({ marketplace: "ebay", setting: "listing_ramp_paused", value: "false" });
      res.json({ success: true, message: "Ramp un-paused (cron will resume on its next run)." });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  // Set the ramp sale-price band. Body: { minPrice?, maxPrice? } in the
  // listing currency. null/"" clears a bound. Persisted, so all subsequent
  // ramp runs (and the cron) only list products whose salePrice is in range.
  app.post("/api/ops/list-ramp/price-range", requireAuth, async (req, res) => {
    try {
      const norm = (v: any): string => {
        if (v === null || v === undefined || v === "") return "";
        const n = Number(v);
        return isNaN(n) || n < 0 ? "" : String(n);
      };
      const minVal = norm(req.body?.minPrice);
      const maxVal = norm(req.body?.maxPrice);
      if (minVal !== "" && maxVal !== "" && Number(minVal) > Number(maxVal)) {
        return res.status(400).json({ success: false, error: "minPrice must be ≤ maxPrice" });
      }
      await storage.setMarketplaceSetting({ marketplace: "ebay", setting: "ramp_min_price", value: minVal });
      await storage.setMarketplaceSetting({ marketplace: "ebay", setting: "ramp_max_price", value: maxVal });
      const range = await getRampPriceRange();
      const count = await storage.getListingCandidateCount(range);
      res.json({ success: true, priceRange: range, matchingCandidates: count });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });
}

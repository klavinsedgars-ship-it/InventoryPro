import type { Express } from "express";
import { storage } from "../storage";
import { requireAuth } from "../middleware/auth";
import { runSyncChunk } from "../sync-chunk";
import { triggerManualSync } from "../cron-jobs";
import { autoMessageScheduler } from "../auto-message-scheduler";
import { calculateEbayStock } from "../stock-manager";
import { ebayApi } from "../ebay-api";
import { tmeApi } from "../tme-api";
import { getRampPriceRange } from "../ramp-config";

/**
 * Sync, cron (daily-sync / auto-messages / list-ramp), and TME backfill routes,
 * extracted from the routes monolith. Behaviour is identical to the previous
 * inline handlers. The Vercel cron entrypoints are registered here.
 */
export function registerSyncRoutes(app: Express) {
  app.get("/api/sync/logs", requireAuth, async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
      const logs = await storage.getSyncLogs(limit);
      res.json(logs);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch sync logs" });
    }
  });

  // Sync Status Dashboard - Aggregated stats for all sync jobs
  app.get("/api/sync/status", requireAuth, async (req, res) => {
    try {
      const logs = await storage.getSyncLogs(500); // Get more logs to calculate stats
      
      // Helper to get latest log by operation type
      const getLatestByOperation = (source: string, operation: string) => {
        return logs.find(log => log.source === source && log.operation === operation);
      };
      
      // Helper to count logs by source and status in last 24 hours
      const countRecentBySourceAndStatus = (source: string, status: string, hours: number = 24) => {
        const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
        return logs.filter(log => 
          log.source === source && 
          log.status === status && 
          log.syncedAt && new Date(log.syncedAt) > cutoff
        ).length;
      };
      
      // Daily Sync Stats - find latest cron log regardless of operation type
      const cronLogs = logs.filter(log => log.source === 'cron' && log.syncedAt);
      const latestCronLog = cronLogs[0]; // Already sorted by syncedAt desc
      
      // Determine daily sync status based on the MOST RECENT cron log
      let dailySyncStatus = 'unknown';
      let dailySyncLastRun: Date | string | null = null;
      let dailySyncMessage = 'No sync runs recorded';
      
      if (latestCronLog?.syncedAt) {
        dailySyncLastRun = latestCronLog.syncedAt;
        
        if (latestCronLog.operation === 'daily_sync_complete') {
          dailySyncStatus = 'success';
          dailySyncMessage = latestCronLog.message || 'Sync completed successfully';
        } else if (latestCronLog.operation === 'daily_sync_error') {
          dailySyncStatus = 'error';
          dailySyncMessage = latestCronLog.message || 'Sync failed';
        } else if (latestCronLog.operation === 'daily_sync_start') {
          // Check if there's a completion or error after this start
          const startTime = new Date(latestCronLog.syncedAt).getTime();
          const laterComplete = cronLogs.find(log => 
            log.operation === 'daily_sync_complete' && 
            log.syncedAt && new Date(log.syncedAt).getTime() > startTime
          );
          const laterError = cronLogs.find(log => 
            log.operation === 'daily_sync_error' && 
            log.syncedAt && new Date(log.syncedAt).getTime() > startTime
          );
          
          if (laterComplete) {
            dailySyncStatus = 'success';
            dailySyncLastRun = laterComplete.syncedAt;
            dailySyncMessage = laterComplete.message || 'Sync completed successfully';
          } else if (laterError) {
            dailySyncStatus = 'error';
            dailySyncLastRun = laterError.syncedAt;
            dailySyncMessage = laterError.message || 'Sync failed';
          } else {
            // Still running or stalled
            dailySyncStatus = 'running';
            dailySyncMessage = latestCronLog.message || 'Sync in progress...';
          }
        }
      }
      
      // Get the last complete for details
      const lastDailyComplete = cronLogs.find(log => log.operation === 'daily_sync_complete');
      
      // eBay Sync Stats (last 24 hours)
      const ebayListingSuccess = countRecentBySourceAndStatus('ebay', 'success');
      const ebayListingError = countRecentBySourceAndStatus('ebay', 'error');
      const lastEbayLog = logs.find(log => log.source === 'ebay');
      
      // TME Sync Stats (last 24 hours)
      const tmeSuccess = countRecentBySourceAndStatus('tme', 'success');
      const tmeError = countRecentBySourceAndStatus('tme', 'error');
      const lastTmeLog = logs.find(log => log.source === 'tme');
      
      // Parse details from last daily complete to get actual numbers
      let dailySyncDetails = { changedProducts: 0, ebayUpdates: 0, totalProducts: 0 };
      if (lastDailyComplete?.details) {
        try {
          const parsed = JSON.parse(lastDailyComplete.details);
          dailySyncDetails = {
            changedProducts: parsed.changedProducts || parsed.changes || 0,
            ebayUpdates: parsed.ebayUpdates || parsed.ebaySync?.succeeded || 0,
            totalProducts: parsed.totalProducts || 0
          };
        } catch (e) {
          // Ignore parse errors
        }
      }
      
      res.json({
        success: true,
        syncStatus: {
          dailySync: {
            status: dailySyncStatus,
            lastRun: dailySyncLastRun,
            message: dailySyncMessage,
            nextScheduled: '02:00 AM',
            details: dailySyncDetails
          },
          ebaySync: {
            status: ebayListingError > 0 && ebayListingSuccess === 0 ? 'error' : 
                   ebayListingSuccess > 0 ? 'success' : 'idle',
            lastRun: lastEbayLog?.syncedAt || null,
            successCount24h: ebayListingSuccess,
            errorCount24h: ebayListingError,
            lastMessage: lastEbayLog?.message || 'No recent eBay operations'
          },
          tmeSync: {
            status: tmeError > 0 && tmeSuccess === 0 ? 'error' :
                   tmeSuccess > 0 ? 'success' : 'idle',
            lastRun: lastTmeLog?.syncedAt || null,
            successCount24h: tmeSuccess,
            errorCount24h: tmeError,
            lastMessage: lastTmeLog?.message || 'No recent TME operations'
          }
        },
        recentLogs: logs.slice(0, 20) // Include recent logs for detail view
      });
    } catch (error) {
      console.error('Failed to get sync status:', error);
      res.status(500).json({ 
        success: false,
        message: "Failed to fetch sync status",
        error: (error as Error).message
      });
    }
  });

  // Process ONE chunk of the stalest TME products. The frontend "Sync Now"
  // button loops this until done:true, showing progress. Fits in the
  // Vercel function timeout regardless of catalog size.
  app.post("/api/sync/run", requireAuth, async (req, res) => {
    try {
      const limit = Math.min(Number(req.body?.limit) || 50, 100);
      const result = await runSyncChunk(limit, "manual");
      res.json({ success: true, ...result });
    } catch (error) {
      console.error("Sync chunk failed:", error);
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  // Per-SKU sync audit trail for the "Sync Activity" view: what the TME->DB->
  // eBay sync changed and whether it reached eBay. Returns a paginated slice
  // plus a rollup over the same time window.
  app.get("/api/sync/audit", requireAuth, async (req, res) => {
    try {
      const sinceHours = req.query.sinceHours ? Number(req.query.sinceHours) : 24;
      const [data, stats, logs] = await Promise.all([
        storage.getSyncAudit({
          limit: req.query.limit ? Number(req.query.limit) : 50,
          offset: req.query.offset ? Number(req.query.offset) : 0,
          sku: (req.query.sku as string) || undefined,
          ebayAction: (req.query.ebayAction as string) || undefined,
          changedOnly: req.query.changedOnly === "true",
          sinceHours,
        }),
        storage.getSyncAuditStats(sinceHours),
        storage.getSyncLogs(50),
      ]);
      // Per-run history (the old dashboard "Recent activity" feed), folded into
      // this endpoint so the Sync Activity view is the single home for sync
      // history. Only TME sync runs, with the per-run counts parsed out of the
      // log's details JSON so the client doesn't re-parse the message string.
      const recentRuns = logs
        .filter((l) => (l.operation || "").includes("sync"))
        .slice(0, 20)
        .map((l) => {
          let d: any = {};
          try { d = l.details ? JSON.parse(l.details) : {}; } catch { /* non-JSON */ }
          const errs = Array.isArray(d.errors) ? d.errors.map(String) : [];
          return {
            status: l.status,
            operation: l.operation,
            message: l.message,
            syncedAt: l.syncedAt,
            changed: d.totalChanged ?? null,
            ebayUpdated: d.totalEbay ?? null,
            remaining: d.remaining ?? null,
            processed: d.totalProcessed ?? null,
            // Surface the actual failure reason (e.g. the TME error) so the UI
            // can show WHY a run is "partial" instead of a bare status dot.
            error: errs.length ? errs[0] : null,
            errorCount: errs.length,
          };
        });
      // Most recent run that carries an error — drives the health banner so a
      // failing TME sync reads as a failure, not benign "still queued".
      const lastError = recentRuns.find((r) => r.error)?.error ?? null;
      res.json({ success: true, ...data, stats, recentRuns, lastError, sinceHours });
    } catch (error) {
      console.error("Sync audit fetch failed:", error);
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  // Vercel Cron entrypoint (configured in vercel.json). Runs chunks
  // server-side within a time budget; whatever doesn't finish today is
  // picked up by the next run. Secured by CRON_SECRET when set (Vercel
  // sends it as a Bearer token); also allows authenticated UI calls.
  const cronHandler = async (req: any, res: any) => {
    const auth = req.headers["authorization"] || "";
    const cronSecret = process.env.CRON_SECRET;
    const isVercelCron = cronSecret && auth === `Bearer ${cronSecret}`;
    const isAuthed = !!req.session?.userId || process.env.BYPASS_AUTH === "true";
    if (!isVercelCron && !isAuthed) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const budgetMs = 270_000; // Vercel Pro maxDuration is 300s
    const start = Date.now();
    let chunks = 0;
    let totalChanged = 0;
    let totalEbay = 0;
    let totalUnlisted = 0;
    let totalRelisted = 0;
    let totalProcessed = 0;
    let totalProcessedListed = 0;
    let last: any = null;
    const allErrors: string[] = [];
    try {
      do {
        last = await runSyncChunk(50, "cron");
        chunks++;
        totalChanged += last.changed;
        totalEbay += last.ebayUpdated;
        totalUnlisted += last.ebayUnlisted ?? 0;
        totalRelisted += last.ebayRelisted ?? 0;
        totalProcessed += last.processedThisChunk ?? 0;
        totalProcessedListed += last.processedListed ?? 0;
        allErrors.push(...last.errors);
      } while (!last.done && Date.now() - start < budgetMs);

      await storage.createSyncLog({
        source: "tme",
        operation: "cron_sync",
        // A run with errors is NOT a success even if the loop finished (a TME
        // outage now aborts with done:true + errors instead of faking success).
        status: last?.done && allErrors.length === 0 ? "success" : "partial",
        message: `Cron sync: ${chunks} chunks, ${totalChanged} changed, ${totalEbay} eBay updated, ${totalUnlisted} unlisted (OOS), ${totalRelisted} relisted, ${totalProcessedListed}/${totalProcessed} listed, ${last?.remaining ?? "?"} remaining`,
        details: JSON.stringify({ chunks, totalChanged, totalEbay, totalUnlisted, totalRelisted, totalProcessed, totalProcessedListed, remaining: last?.remaining, errors: allErrors.slice(0, 20) }),
      });

      // No HTTP self-chain: each cron tick processes as much as fits in its
      // 270s budget; remaining stale products catch up on the next scheduled
      // run (lastSyncedAt cursor advances on every chunk, so it's resumable).
      // The previous self-chain via fetch() required CRON_SECRET to be set
      // correctly for *both* the inbound Vercel call AND the outbound self
      // call, which is brittle — see PR #N for the 401 chain failures it
      // produced. With an hourly schedule, catch-up from a ~2k backlog
      // takes a handful of cron ticks instead of one chained burst.

      res.json({
        success: true,
        done: last?.done ?? false,
        chunks,
        totalChanged,
        ebayUpdated: totalEbay,
        ebayUnlisted: totalUnlisted,
        ebayRelisted: totalRelisted,
        remaining: last?.remaining ?? null,
        elapsedMs: Date.now() - start,
      });
    } catch (error) {
      console.error("Cron sync failed:", error);
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  };
  app.get("/api/cron/daily-sync", cronHandler);
  app.post("/api/cron/daily-sync", cronHandler);

  // Auto-message cron: sends delayed (days-after-delivery) rule messages and
  // due one-off scheduled messages. Needed because the setInterval scheduler
  // only runs on a long-lived server, which Vercel isn't — so without this
  // these messages never sent. Same CRON_SECRET-or-session auth as daily-sync.
  const autoMessagesHandler = async (req: any, res: any) => {
    const auth = req.headers["authorization"] || "";
    const cronSecret = process.env.CRON_SECRET;
    const isVercelCron = cronSecret && auth === `Bearer ${cronSecret}`;
    const isAuthed = !!req.session?.userId || process.env.BYPASS_AUTH === "true";
    if (!isVercelCron && !isAuthed) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    try {
      const [delayed, scheduled] = await Promise.all([
        autoMessageScheduler.processDelayedRules(),
        autoMessageScheduler.processScheduledMessages(),
      ]);
      const errors = [...delayed.errors, ...scheduled.errors];
      await storage.createSyncLog({
        source: "messages",
        operation: "auto_messages",
        status: errors.length === 0 ? "success" : "partial",
        message: `Auto-messages: delayed ${delayed.sent}/${delayed.processed}, scheduled ${scheduled.sent}/${scheduled.processed}${errors.length ? `, ${errors.length} errors` : ""}`,
        details: JSON.stringify({ delayed, scheduled, errors: errors.slice(0, 20) }),
      });
      res.json({ success: true, delayed, scheduled });
    } catch (error) {
      console.error("Auto-messages cron failed:", error);
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  };
  app.get("/api/cron/auto-messages", autoMessagesHandler);
  app.post("/api/cron/auto-messages", autoMessagesHandler);

  // Server-side listing ramp: pulls listing candidates from the DB and runs
  // them through the 25-SKU Inventory-API bulk path within a 270s budget,
  // self-chaining if more remain. Resumable across cold starts (state lives
  // on each product's listedOnEbay/ebayOfferId). Gated by LISTING_RAMP_ENABLED
  // so it doesn't fire by accident — Vercel still schedules it, but the
  // handler exits cleanly until the flag is set.
  //
  // Safety controls:
  //  - DB kill-switch: marketplace_settings 'ebay'/'listing_ramp_paused'.
  //    Setting it to "true" makes the next chain run exit cleanly, which
  //    means a manual run stops within ≤270s of pausing.
  //  - Dry-run: ?dryRun=1 or {dryRun:true}. Returns the candidate batch
  //    that WOULD be listed (sku/name/stock/price) without calling eBay.
  const listRampHandler = async (req: any, res: any) => {
    const auth = req.headers["authorization"] || "";
    const cronSecret = process.env.CRON_SECRET;
    const isVercelCron = cronSecret && auth === `Bearer ${cronSecret}`;
    const isAuthed = !!req.session?.userId || process.env.BYPASS_AUTH === "true";
    if (!isVercelCron && !isAuthed) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const dryRun =
      req.query?.dryRun === "1" || req.query?.dryRun === "true" || req.body?.dryRun === true;

    if (!dryRun && process.env.LISTING_RAMP_ENABLED !== "true") {
      return res.json({ success: true, skipped: true, reason: "LISTING_RAMP_ENABLED not set" });
    }

    // Kill switch: short-circuit before any eBay call.
    const paused = (await storage.getMarketplaceSettings("ebay")).find(
      (s) => s.setting === "listing_ramp_paused",
    );
    if (!dryRun && paused?.value === "true") {
      return res.json({ success: true, skipped: true, reason: "ramp paused" });
    }

    const env = (await import("../ebay-env")).validateListingEnv();
    if (!env.ok) {
      return res.status(412).json({ success: false, envBlocked: true, issues: env.issues });
    }

    const batchSize = 25;
    const range = await getRampPriceRange();

    // Dry-run: never call eBay. Return what the next batch WOULD publish.
    if (dryRun) {
      const candidates = await storage.getListingCandidates(batchSize, range);
      const totalCandidates = await storage.getListingCandidateCount(range);
      return res.json({
        success: true,
        dryRun: true,
        priceRange: range,
        wouldPublishNow: candidates.length,
        totalCandidatesRemaining: totalCandidates,
        sample: candidates.map((p: any) => ({
          id: p.id,
          sku: p.sku,
          name: p.name,
          stock: p.stock,
          salePrice: p.salePrice,
          supplierPrice: p.supplierPrice,
        })),
      });
    }

    const { listProductsViaInventoryBulk } = await import("../ebay-lister");
    const budgetMs = 270_000;
    const start = Date.now();
    let batches = 0;
    let published = 0;
    let failed = 0;
    let skipped = 0;
    let limitHit = false;
    let lastBatchSize = 0;
    // Proactive eBay daily-call budget. The ramp uses ~3 bulk calls per
    // 25-SKU batch + cold-path category/aspects, so 100k listings is
    // ~12-25k eBay calls — well under the 2M default cap but worth not
    // burning blind. Default soft cap 80% of dailyLimit. Override via
    // EBAY_DAILY_CALL_SOFT_CAP_PCT.
    const softCapPct = Math.min(100, Math.max(10, Number(process.env.EBAY_DAILY_CALL_SOFT_CAP_PCT) || 80));
    let budgetStop = false;
    try {
      while (Date.now() - start < budgetMs && !limitHit && !budgetStop) {
        // Re-check pause flag each batch so an in-flight chain stops on
        // the first batch after Pause is hit.
        const stillPaused = (await storage.getMarketplaceSettings("ebay")).find(
          (s) => s.setting === "listing_ramp_paused",
        );
        if (stillPaused?.value === "true") break;

        // Daily-budget check (proactive). Was reactive only — we'd find out
        // we exceeded by getting an eBay limit error.
        const usage = await storage.getApiUsage("ebay");
        if (usage && usage.dailyLimit > 0 && usage.callsToday >= usage.dailyLimit * (softCapPct / 100)) {
          budgetStop = true;
          break;
        }

        const candidates = await storage.getListingCandidates(batchSize, range);
        lastBatchSize = candidates.length;
        if (candidates.length === 0) break;
        const r = await listProductsViaInventoryBulk(candidates as any);
        batches++;
        published += r.published;
        failed += r.failed;
        skipped += r.skipped ?? 0;
        if (r.limitHit) limitHit = true;
      }

      const done = !limitHit && !budgetStop && lastBatchSize < batchSize;

      await storage.createSyncLog({
        source: "ebay",
        operation: "list_ramp",
        status: failed > 0 ? "partial" : "success",
        message: `List ramp: ${batches} batches, ${published} published, ${failed} failed, ${skipped} skipped${limitHit ? " (limit hit)" : ""}${budgetStop ? ` (budget stop @${softCapPct}%)` : ""}`,
        details: JSON.stringify({ batches, published, failed, skipped, limitHit, budgetStop, softCapPct, done }),
      });

      // No HTTP self-chain: see the matching note in the daily-sync
      // handler above. Remaining candidates are listed in subsequent
      // scheduled ramp ticks (or by the manual "Resume ramp" control).

      res.json({ success: true, batches, published, failed, skipped, limitHit, budgetStop, done, elapsedMs: Date.now() - start });
    } catch (error) {
      console.error("List ramp failed:", error);
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  };
  app.get("/api/cron/list-ramp", listRampHandler);
  app.post("/api/cron/list-ramp", listRampHandler);

  app.post("/api/sync/trigger-daily", requireAuth, async (req, res) => {
    try {
      console.log('🔧 Manual daily sync triggered via API');

      const result = await triggerManualSync();

      res.json({
        success: true,
        message: 'Daily sync completed',
        result: {
          totalProducts: result.totalProducts,
          changedProducts: result.changedProducts,
          queuedItems: result.queuedItems,
          ebaySync: result.ebaySync,
          duration: result.duration
        }
      });
    } catch (error) {
      console.error('Manual sync trigger failed:', error);
      res.status(500).json({ 
        success: false,
        message: "Failed to trigger daily sync",
        error: (error as Error).message
      });
    }
  });

  app.post("/api/sync/trigger-ebay", requireAuth, async (req, res) => {
    try {
      console.log('🔧 Manual eBay sync triggered via API');
      
      const products = await storage.getProducts();
      const ebayProducts = products.filter(p => p.ebayItemId && p.listedOnEbay);
      
      if (ebayProducts.length === 0) {
        return res.json({
          success: true,
          message: 'No eBay-listed products to sync',
          result: { attempted: 0, succeeded: 0, failed: 0, skipped: 0 }
        });
      }
      
      // Use calculateEbayStock to apply stock limits (default 3) instead of raw TME stock
      const updates = ebayProducts.map(product => {
        const stockInfo = calculateEbayStock(product);
        console.log(`📊 Product ${product.sku}: TME stock ${stockInfo.tmeStock} → eBay stock ${stockInfo.ebayStock} (${stockInfo.limitReason})`);
        return {
          productId: product.id,
          ebayItemId: product.ebayItemId!,
          quantity: stockInfo.ebayStock, // Use limited eBay stock, not raw TME stock
          price: parseFloat(product.salePrice?.toString() || '0'),
          sku: product.sku
        };
      });
      
      const result = await ebayApi.bulkUpdateInventory(updates);
      
      res.json({
        success: true,
        message: 'eBay sync completed with stock limits applied',
        result: {
          attempted: updates.length,
          succeeded: result.succeeded,
          failed: result.failed,
          skipped: 0
        }
      });
    } catch (error) {
      console.error('Manual eBay sync failed:', error);
      res.status(500).json({ 
        success: false,
        message: "Failed to trigger eBay sync",
        error: (error as Error).message
      });
    }
  });

  // Backfill tmeCategoryId for existing products from TME API
  app.post("/api/sync/backfill-category-ids", requireAuth, async (req, res) => {
    try {
      console.log('🔄 Starting category ID backfill for existing products...');
      
      const products = await storage.getProducts();
      const tmeProducts = products.filter(p => 
        (p.supplier?.toLowerCase() === 'tme') && p.sku && !p.tmeCategoryId
      );
      
      if (tmeProducts.length === 0) {
        return res.json({
          success: true,
          message: 'No products need category ID backfill',
          result: { total: 0, updated: 0 }
        });
      }
      
      console.log(`📦 Backfilling category IDs for ${tmeProducts.length} TME products`);
      
      let updatedCount = 0;
      const batchSize = 50;
      
      for (let i = 0; i < tmeProducts.length; i += batchSize) {
        const batch = tmeProducts.slice(i, i + batchSize);
        const symbols = batch.map(p => p.sku);
        
        try {
          const tmeProductDetails = await tmeApi.getEnhancedProductInfo(symbols);
          
          for (const enhanced of tmeProductDetails) {
            const { product: tmeProduct } = enhanced;
            const localProduct = batch.find(p => p.sku === tmeProduct.Symbol);
            
            if (localProduct && tmeProduct.CategoryId) {
              await storage.updateProduct(localProduct.id, {
                tmeCategoryId: String(tmeProduct.CategoryId)
              });
              updatedCount++;
            }
          }
          
          if (i + batchSize < tmeProducts.length) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        } catch (error) {
          console.error(`❌ Batch category backfill failed:`, error);
        }
      }
      
      console.log(`🎉 Category ID backfill complete: ${updatedCount}/${tmeProducts.length} products updated`);
      
      res.json({
        success: true,
        message: `Category ID backfill completed`,
        result: {
          total: tmeProducts.length,
          updated: updatedCount
        }
      });
    } catch (error) {
      console.error('Category ID backfill failed:', error);
      res.status(500).json({ 
        success: false,
        message: "Failed to backfill category IDs",
        error: (error as Error).message
      });
    }
  });

  // Update MOQ (minimum order quantity) for existing products from TME API
  app.post("/api/sync/update-moq", requireAuth, async (req, res) => {
    try {
      console.log('🔄 Starting MOQ update for existing products...');
      
      const products = await storage.getProducts();
      const tmeProducts = products.filter(p => (p.supplier?.toLowerCase() === 'tme') && p.sku);
      
      if (tmeProducts.length === 0) {
        return res.json({
          success: true,
          message: 'No TME products to update',
          result: { total: 0, updated: 0 }
        });
      }
      
      console.log(`📦 Updating MOQ for ${tmeProducts.length} TME products`);
      
      let updatedCount = 0;
      const batchSize = 50;
      
      for (let i = 0; i < tmeProducts.length; i += batchSize) {
        const batch = tmeProducts.slice(i, i + batchSize);
        const symbols = batch.map(p => p.sku);
        
        try {
          // Fetch product details from TME to get MinAmount/Multiples
          const tmeProductDetails = await tmeApi.getEnhancedProductInfo(symbols);
          
          for (const enhanced of tmeProductDetails) {
            const { product: tmeProduct } = enhanced;
            const localProduct = batch.find(p => p.sku === tmeProduct.Symbol);
            
            if (localProduct && tmeProduct) {
              const moq = tmeProduct.MinAmount || 1;
              const multiples = tmeProduct.Multiples || 1;
              
              // Only update if different
              if (localProduct.moq !== moq || localProduct.multiples !== multiples) {
                await storage.updateProduct(localProduct.id, {
                  moq,
                  multiples
                });
                updatedCount++;
                console.log(`✅ Updated ${tmeProduct.Symbol}: MOQ=${moq}, Multiples=${multiples}`);
              }
            }
          }
          
          // Rate limiting
          if (i + batchSize < tmeProducts.length) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        } catch (error) {
          console.error(`❌ Batch MOQ update failed:`, error);
        }
      }
      
      console.log(`🎉 MOQ update complete: ${updatedCount}/${tmeProducts.length} products updated`);
      
      res.json({
        success: true,
        message: `MOQ update completed`,
        result: {
          total: tmeProducts.length,
          updated: updatedCount
        }
      });
    } catch (error) {
      console.error('MOQ update failed:', error);
      res.status(500).json({ 
        success: false,
        message: "Failed to update MOQ",
        error: (error as Error).message
      });
    }
  });
}

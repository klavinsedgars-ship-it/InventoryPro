/**
 * Shared TME → product-catalog sync logic.
 *
 * processTmeSyncChunk() imports a single batch of TME symbols into the products
 * table. It is intentionally small enough to finish well inside a serverless
 * function invocation, so a large selection can be driven chunk-by-chunk by an
 * async job (see the /api/tme/sync-job-* routes) with real, persisted progress.
 */

import { storage } from "./storage";
import { tmeApi } from "./tme-api";
import {
  calculatePriceWithFloor,
  getSupplierPriceForMoq,
  setActivePricingTiers,
  dbTiersToPricingTiers,
} from "./dynamic-pricing";
import { getFeeConfig } from "./fee-config";

export interface TmeSyncSettings {
  applyDynamicPricing?: boolean;
  [key: string]: any;
}

export interface TmeChunkResult {
  syncedCount: number;
  updatedCount: number;
  failedCount: number;
  errors: string[];
}

/**
 * Fetch enhanced TME info for `symbols` and create/update matching products.
 * `symbols` should be a single chunk (e.g. <= 100) to stay within timeouts.
 */
export async function processTmeSyncChunk(
  symbols: string[],
  settings: TmeSyncSettings = {},
): Promise<TmeChunkResult> {
  const result: TmeChunkResult = {
    syncedCount: 0,
    updatedCount: 0,
    failedCount: 0,
    errors: [],
  };

  if (symbols.length === 0) return result;

  let enhancedProducts: any[];
  try {
    // getEnhancedProductInfo batches internally (50/call, combined endpoint).
    enhancedProducts = await tmeApi.getEnhancedProductInfo(symbols);
  } catch (batchError) {
    // The whole chunk's TME fetch failed — count every symbol as failed so the
    // job's processed count still advances and the user sees an accurate total.
    result.failedCount = symbols.length;
    result.errors.push(`TME fetch failed: ${(batchError as Error).message}`);
    return result;
  }

  // Symbols TME returned no product data for must surface as failures, not
  // silently shrink the result. (A missing symbol after a SUCCESSFUL call
  // means TME doesn't know it or access to it is denied.)
  const returned = new Set(enhancedProducts.map((e: any) => e?.product?.Symbol));
  const missing = symbols.filter((s) => !returned.has(s));
  if (missing.length > 0) {
    result.failedCount += missing.length;
    result.errors.push(
      `TME returned no data for ${missing.length} symbol(s): ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? "…" : ""}`,
    );
  }

  // Look up only the products in this chunk (not the whole catalog).
  const existing = await storage.getProductsBySkus(symbols);
  const existingBySku = new Map(existing.map((p) => [p.sku, p]));

  const feeConfig = await getFeeConfig("ebay");
  // DB writes for this chunk, flushed together at the end (pool-bounded).
  const writes: Array<Promise<unknown>> = [];

  // Load the operator's DB pricing tiers (Configuration UI) — module state
  // resets per serverless invocation, so this must happen on EVERY import
  // path, not just the cron. Without it, browser imports priced with the
  // built-in config tiers and the next cron re-sync silently repriced them
  // with the DB tiers.
  setActivePricingTiers(dbTiersToPricingTiers(await storage.getPricingTiers()));

  // Blocked codes never enter the catalogue. Checked HERE, at the point of
  // creation, because a block applied only to existing rows would be undone by
  // the next import that returned the same symbol.
  const blocked = await storage.filterBlockedCodes(
    enhancedProducts.map((e: any) => e.product?.Symbol).filter(Boolean),
  );
  if (blocked.size > 0) {
    result.errors.push(`${blocked.size} blocked product(s) skipped`);
  }

  for (const enhanced of enhancedProducts) {
    if (blocked.has(String(enhanced.product?.Symbol ?? "").toUpperCase())) continue;
    try {
      const { product, price, stock } = enhanced;

      const moq = product.MinAmount || 1;
      const multiples = product.Multiples || 1;
      const supplierPrice = getSupplierPriceForMoq(price?.PriceList, moq);
      const weightGrams = (product as any).Weight ?? null;

      let pricingResult = {
        finalPrice: supplierPrice,
        calculatedPrice: supplierPrice,
        marginTier: "No Margin",
        marginPercentage: 0,
      };

      if (settings?.applyDynamicPricing && supplierPrice > 0) {
        const calc = calculatePriceWithFloor(supplierPrice, {
          moq,
          multiples,
          weightGrams,
          marketplace: "ebay",
          config: feeConfig,
        });
        pricingResult = {
          finalPrice: calc.finalPrice,
          calculatedPrice: calc.calculatedPrice,
          marginTier: calc.marginTier,
          marginPercentage: calc.marginPercentage,
        };
      }

      const productData: any = {
        name: product.Description || product.Symbol,
        sku: product.Symbol,
        description: product.Description || "",
        category: product.Category || "Electronics",
        stock: stock?.Amount || 0,
        supplier: "TME",
        imageUrl: product.Photo || null,
        status: (stock?.Amount || 0) > 0 ? "active" : "inactive",
        ean: product.EAN || null,
        weight: product.Weight?.toString() || null,
        tmeCategoryId: product.CategoryId ? String(product.CategoryId) : null,
        supplierProductId: product.Symbol,
        moq,
        multiples,
      };

      // Only write price fields when TME actually returned a usable price.
      // getSupplierPriceForMoq returns 0 when PriceList is missing/empty, and
      // unconditionally writing that overwrote a previously GOOD price with
      // "0" (and salePrice with 0) whenever TME had a data hiccup.
      if (supplierPrice > 0) {
        productData.supplierPrice = String(supplierPrice);
        productData.salePrice = String(pricingResult.finalPrice);
      }

      const match = existingBySku.get(product.Symbol);
      if (match) {
        // Queue the write instead of awaiting per product: 100 serial Neon
        // round-trips were the bulk of each chunk's latency (~5-8s of the
        // ~12s a chunk took), which is why the progress bar sat still.
        writes.push(
          storage.updateProduct(match.id, productData)
            .then(() => { result.updatedCount++; })
            .catch((e) => {
              result.failedCount++;
              result.errors.push(`${product.Symbol}: ${(e as Error).message}`);
            }),
        );
      } else {
        // New product with no price: create it, but never as sellable.
        if (supplierPrice <= 0) {
          productData.supplierPrice = "0";
          productData.salePrice = "0";
          productData.status = "inactive";
        }
        writes.push(
          storage.createProduct(productData)
            .then(() => { result.syncedCount++; })
            .catch((e) => {
              result.failedCount++;
              result.errors.push(`${product.Symbol}: ${(e as Error).message}`);
            }),
        );
      }
    } catch (itemError) {
      console.error("Failed to sync product:", itemError);
      result.failedCount++;
      result.errors.push(`Failed to sync: ${(itemError as Error).message}`);
    }
  }

  await Promise.allSettled(writes);
  return result;
}


export const TME_SYNC_CHUNK_SIZE = 100;

/**
 * Advance a TME Browser import job by ONE chunk. The single source of truth
 * for job progression: the HTTP route (browser-driven) and the cron drain
 * (server-driven) both call this, so an import behaves identically no matter
 * who is pushing it forward.
 */
export async function advanceSyncJob(jobId: string): Promise<{ done: boolean; job: any } | null> {
  // Chunk advancement is a read-modify-write: it reads job.processed, spends
  // ~12s importing that slice, then writes processed + chunk.length. The
  // browser pump and the cron drain can both be inside that window, in which
  // case both import the SAME symbols and the counter advances from a stale
  // read. The lease makes one of them wait; because it expires, a caller that
  // dies mid-chunk leaves the chunk to be retried rather than skipped.
  const { withLease } = await import("./job-lease");
  const { leaseStore } = await import("./storage");
  const leased = await withLease(leaseStore, `sync_job:${jobId}`, { ttlSeconds: 120 }, () =>
    advanceSyncJobChunk(jobId),
  );
  // Refused means another caller is mid-chunk. Report current state rather
  // than an error: the caller polls again and sees the other's progress.
  if (!leased.ran) {
    const job = await storage.getSyncJob(jobId);
    if (!job) return null;
    const done = ["completed", "completed_with_errors", "failed", "cancelled"].includes(job.status);
    return { done, job };
  }
  return leased.result;
}

async function advanceSyncJobChunk(jobId: string): Promise<{ done: boolean; job: any } | null> {
  const job = await storage.getSyncJob(jobId);
  if (!job) return null;
  if (["completed", "completed_with_errors", "failed", "cancelled"].includes(job.status)) {
    return { done: true, job };
  }

  const allSymbols: string[] = JSON.parse(job.symbols);
  const settings = job.settings ? JSON.parse(job.settings) : {};
  const chunk = allSymbols.slice(job.processed, job.processed + TME_SYNC_CHUNK_SIZE);

  if (job.status === "pending") {
    await storage.updateSyncJob(jobId, { status: "processing" });
  }

  const r = await processTmeSyncChunk(chunk, settings);

  const processed = job.processed + chunk.length;
  const syncedCount = job.syncedCount + r.syncedCount;
  const updatedCount = job.updatedCount + r.updatedCount;
  const failedCount = job.failedCount + r.failedCount;
  const prevErrors: string[] = job.errors ? JSON.parse(job.errors) : [];
  const errors = [...prevErrors, ...r.errors].slice(0, 50);

  const done = processed >= allSymbols.length;
  const status = done ? (failedCount > 0 ? "completed_with_errors" : "completed") : "processing";
  const message = `Synced ${syncedCount} new, updated ${updatedCount}, failed ${failedCount}`;

  const updated = await storage.updateSyncJob(jobId, {
    processed, syncedCount, updatedCount, failedCount,
    errors: errors.length ? JSON.stringify(errors) : null,
    status, message,
  });

  if (done) {
    await storage.createSyncLog({
      source: "tme_browser",
      operation: "sync_selected",
      status: failedCount === 0 ? "success" : failedCount < allSymbols.length ? "partial" : "error",
      message,
      details: JSON.stringify({ jobId, syncedCount, updatedCount, failedCount }),
    });
    console.log(`✅ TME sync job ${jobId} ${status}: ${message}`);
  }

  return { done, job: updated };
}

/**
 * Finish imports the browser abandoned. An import's state lives server-side,
 * but progression used to depend entirely on the browser POSTing chunk after
 * chunk — so a closed tab, a network blip, or a redeploy left the job frozen
 * mid-run until someone reopened the page. The hourly cron now calls this
 * with a slice of its time budget, which turns "the sync died at 43%" into
 * "the sync finished on its own within the hour".
 */
export async function drainPendingImportJobs(budgetMs: number): Promise<{
  advancedChunks: number;
  finishedJobs: number;
}> {
  const start = Date.now();
  let advancedChunks = 0;
  let finishedJobs = 0;

  while (Date.now() - start < budgetMs) {
    const job = await storage.getActiveSyncJob("tme_browser");
    if (!job) break;
    // Leave a fresh job to its browser: only adopt runs nothing has touched
    // for 2+ minutes, so the cron never competes with a live pump.
    const idleMs = Date.now() - new Date((job as any).updatedAt ?? (job as any).createdAt ?? 0).getTime();
    if (Number.isFinite(idleMs) && idleMs < 2 * 60 * 1000) break;

    const before = job.processed;
    const res = await advanceSyncJob(job.jobId);
    if (!res) break;
    if (res.done) { finishedJobs++; continue; }
    // No forward progress means someone else holds this job's chunk lease (a
    // browser pump that just woke up). Yield instead of spinning: without this
    // the drain would re-query in a tight loop for the rest of its budget.
    if ((res.job?.processed ?? before) <= before) break;
    advancedChunks++;
  }
  return { advancedChunks, finishedJobs };
}

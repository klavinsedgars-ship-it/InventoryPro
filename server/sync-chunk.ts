/**
 * Chunked TME -> DB -> eBay sync that fits inside Vercel's function
 * timeout. Instead of one long-running pass over all products (which
 * exceeds the 60s limit and can't run as a background loop on serverless),
 * each call processes the N *stalest* TME products (those not yet synced
 * today), refreshes their price/stock from TME (via the optimized combined
 * endpoint, 100/call), recomputes pricing, updates the DB, and pushes
 * inventory changes to eBay for already-listed items.
 *
 * Callers loop until `done`:
 *   - Manual "Sync Now": the browser drives the loop, showing progress.
 *   - Vercel Cron (daily): a server-side loop runs chunks within a time
 *     budget.
 */
import { storage } from "./storage";
import { tmeApiOptimized } from "./tme-api-optimized";
import {
  getSupplierPriceForMoq,
  calculatePriceWithFloor,
} from "./dynamic-pricing";
import { getFeeConfig } from "./fee-config";
import { ebayInventoryApi } from "./ebay-inventory-api";

// Marks a listing we ended automatically because TME stock hit 0, so we can
// tell it apart from manual unlists and auto-republish it when stock returns.
const ENDED_OOS = "ended_oos";

// Sum stock across TME warehouses (StockList), falling back to the flat
// Amount field, then to the value we already hold in the DB.
function extractStock(
  ps: { StockList?: Array<{ Amount: number }>; Amount?: number },
  fallback: number,
): number {
  if (ps.StockList && ps.StockList.length > 0) {
    return ps.StockList.reduce((sum, w) => sum + (w.Amount || 0), 0);
  }
  if (typeof ps.Amount === "number") return ps.Amount;
  return fallback;
}

export interface SyncChunkResult {
  total: number; // total TME products
  remaining: number; // TME products still not synced today (after this chunk)
  processedThisChunk: number;
  processedListed: number; // of processedThisChunk, how many were eBay-listed
  changed: number; // products whose price or stock actually changed
  ebayUpdated: number; // eBay listings updated
  ebayUnlisted: number; // listings withdrawn because stock hit 0
  ebayRelisted: number; // listings re-published because stock returned
  done: boolean;
  errors: string[];
}

// A product is "stale" if it hasn't been synced within this many hours.
// Tiered: listed eBay products refresh ~3× faster than unlisted, because the
// oversell risk (TME going to 0 between cron ticks) only matters for listed
// SKUs. Defaults: listed 4h (≈ 6×/day) ; unlisted 48h (≈ 0.5×/day).
//   Tune via SYNC_STALE_HOURS_LISTED / SYNC_STALE_HOURS_UNLISTED.
//   SYNC_STALE_HOURS (legacy) is the fallback when only one var is set.
function staleCutoffs(): { listed: Date; unlisted: Date } {
  const legacy = Number(process.env.SYNC_STALE_HOURS) || 12;
  const listedHours = Number(process.env.SYNC_STALE_HOURS_LISTED) || Math.min(4, legacy);
  const unlistedHours = Number(process.env.SYNC_STALE_HOURS_UNLISTED) || Math.max(48, legacy);
  const now = Date.now();
  return {
    listed: new Date(now - listedHours * 3600 * 1000),
    unlisted: new Date(now - unlistedHours * 3600 * 1000),
  };
}

export async function runSyncChunk(limit = 50): Promise<SyncChunkResult> {
  const errors: string[] = [];

  // DB-side: load only the next `limit` stalest TME products (indexed),
  // not the whole table. Tiered staleness — listed first.
  const cutoffs = staleCutoffs();
  const total = await storage.getTmeProductCount();
  const slice = (await storage.getStaleTmeProducts(limit, cutoffs.listed, cutoffs.unlisted))
    .filter((p) => p.sku);
  if (slice.length === 0) {
    return { total, remaining: 0, processedThisChunk: 0, processedListed: 0, changed: 0, ebayUpdated: 0, ebayUnlisted: 0, ebayRelisted: 0, done: true, errors };
  }

  // Resolve fee config once per chunk (drives the net-profit price floor).
  const feeConfig = await getFeeConfig("ebay");

  const symbols = slice.map((p) => p.supplierProductId || p.sku);
  // Optimized client: one combined GetPricesAndStocks call per 100 symbols
  // (vs the standard client's 2 calls per 50), and it persists the count via
  // storage.trackApiCall('tme'). MOQ/multiples/weight come from the DB row
  // (captured at import/list time and effectively static), so the cron needs
  // no per-product GetProducts call — ~4x fewer TME calls at 100k scale.
  let priceStocks: Awaited<ReturnType<typeof tmeApiOptimized.getProductsPricesAndStocks>> = [];
  try {
    priceStocks = await tmeApiOptimized.getProductsPricesAndStocks(symbols);
  } catch (e) {
    errors.push(`TME fetch failed: ${(e as Error).message}`);
  }
  const bySymbol = new Map(priceStocks.map((ps) => [ps.Symbol, ps]));

  let changed = 0;
  // Inventory-model listings (offerId) -> bulkUpdatePriceQuantity.
  const inventoryUpdates: Array<{ product: any; quantity: number; price: number }> = [];
  // Listed products whose stock hit 0 -> withdraw the offer.
  const withdrawals: any[] = [];
  // Previously auto-ended products back in stock -> re-publish the offer.
  const relists: any[] = [];
  const now = new Date();
  // Collect DB writes and flush them together at the end of the chunk
  // instead of awaiting one round-trip per product (the old bottleneck).
  const writes: Array<Promise<unknown>> = [];

  for (const product of slice) {
    const sym = product.supplierProductId || product.sku;
    const ps = bySymbol.get(sym);

    // Couldn't fetch this one: still bump lastSyncedAt so the cursor
    // advances (it retries on the next sync), but record nothing.
    if (!ps) {
      writes.push(storage.updateProduct(product.id, { lastSyncedAt: now }));
      continue;
    }

    const moq = product.moq || 1;
    const multiples = product.multiples || 1;
    const supplierPrice = getSupplierPriceForMoq(ps.PriceList as any, moq);
    const stock = extractStock(ps, product.stock ?? 0);
    const weightGrams = product.weight ? parseFloat(product.weight) : null;

    const pricing =
      supplierPrice > 0
        ? calculatePriceWithFloor(supplierPrice, {
            moq,
            multiples,
            weightGrams,
            marketplace: "ebay",
            config: feeConfig,
          })
        : null;

    const localSupplier = parseFloat(product.supplierPrice?.toString() || "0");
    const priceChanged = supplierPrice > 0 && Math.abs(localSupplier - supplierPrice) > 0.01;
    const stockChanged = (product.stock || 0) !== stock;

    const update: any = { lastSyncedAt: now, stock };
    if (supplierPrice > 0) update.supplierPrice = String(supplierPrice);
    if (pricing && product.useCalculatedPrice !== false) {
      update.salePrice = String(pricing.finalPrice);
      update.calculatedPrice = String(pricing.calculatedPrice);
      update.marginTier = pricing.marginTier;
      update.marginPercentage = String(pricing.marginPercentage);
      update.priceUpdatedAt = now;
    }
    writes.push(storage.updateProduct(product.id, update));

    if (priceChanged || stockChanged) changed++;

    // Effective sellable quantity after any per-product eBay stock cap.
    const limited =
      product.useStockLimit && product.ebayStockLimit != null
        ? Math.min(stock, product.ebayStockLimit)
        : stock;
    const hasOffer = !!product.ebayOfferId;

    if (product.listedOnEbay && hasOffer && limited <= 0) {
      // Out of stock -> withdraw the live listing (idempotent; withdrawOffer
      // tolerates an already-ended offer). Gated on state, not on `changed`,
      // so a previously-missed 0-stock listing is still recovered.
      withdrawals.push(product);
    } else if (!product.listedOnEbay && hasOffer && product.ebayListingStatus === ENDED_OOS && limited > 0) {
      // Back in stock and we're the ones who ended it -> re-publish the offer.
      relists.push(product);
    } else if (product.listedOnEbay && hasOffer && (priceChanged || stockChanged)) {
      // Still in stock with a change -> push qty/price via the Inventory API.
      inventoryUpdates.push({
        product: { ...product, stock },
        quantity: Math.max(0, limited),
        price: pricing ? Number(pricing.finalPrice) : parseFloat(product.salePrice) || 0,
      });
    }
  }

  // Flush this chunk's DB writes concurrently (pool-bounded) rather than
  // serially — the main per-chunk latency win at scale.
  if (writes.length > 0) {
    const settled = await Promise.allSettled(writes);
    const failedWrites = settled.filter((s) => s.status === "rejected").length;
    if (failedWrites > 0) errors.push(`DB writes: ${failedWrites} failed`);
  }

  let ebayUpdated = 0;
  if (inventoryUpdates.length > 0) {
    try {
      const { updateListedProductsViaInventory } = await import("./ebay-lister");
      const r = await updateListedProductsViaInventory(inventoryUpdates);
      ebayUpdated += r.updated;
      if (r.failed) errors.push(`eBay updates: ${r.failed} failed`);
    } catch (e) {
      errors.push(`eBay update failed: ${(e as Error).message}`);
    }
  }

  // Withdraw listings that went out of stock; mark them so we can re-list
  // automatically (and keep the ramp from creating a duplicate offer).
  let ebayUnlisted = 0;
  for (const product of withdrawals) {
    try {
      const r = await ebayInventoryApi.withdrawOffer(product.ebayOfferId);
      if (r.ok) {
        ebayUnlisted++;
        await storage.updateProduct(product.id, {
          listedOnEbay: false,
          ebayListingStatus: ENDED_OOS,
        });
      } else {
        errors.push(`withdraw ${product.sku}: ${r.error || r.httpStatus}`);
      }
    } catch (e) {
      errors.push(`withdraw ${product.sku}: ${(e as Error).message}`);
    }
  }

  // Re-publish offers we previously auto-ended, now that stock is back.
  let ebayRelisted = 0;
  for (const product of relists) {
    try {
      const r = await ebayInventoryApi.publishOffer(product.ebayOfferId);
      if (r.ok) {
        ebayRelisted++;
        await storage.updateProduct(product.id, {
          listedOnEbay: true,
          ebayListingStatus: "published",
          ...(r.listingId ? { ebayListingId: r.listingId } : {}),
        });
      } else {
        errors.push(`relist ${product.sku}: ${r.error || r.httpStatus}`);
      }
    } catch (e) {
      errors.push(`relist ${product.sku}: ${(e as Error).message}`);
    }
  }

  const remaining = Math.max(
    0,
    await storage.getStaleTmeProductCount(cutoffs.listed, cutoffs.unlisted),
  );
  return {
    total,
    remaining,
    processedThisChunk: slice.length,
    processedListed: slice.filter((p) => p.listedOnEbay).length,
    changed,
    ebayUpdated,
    ebayUnlisted,
    ebayRelisted,
    done: remaining === 0,
    errors,
  };
}

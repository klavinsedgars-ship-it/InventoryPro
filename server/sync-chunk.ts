/**
 * Chunked TME -> DB -> eBay sync that fits inside Vercel's function
 * timeout. Instead of one long-running pass over all products (which
 * exceeds the 60s limit and can't run as a background loop on serverless),
 * each call processes the N *stalest* TME products (those not yet synced
 * today), refreshes their price/stock/MOQ from TME, recomputes pricing,
 * updates the DB, and pushes inventory changes to eBay for already-listed
 * items.
 *
 * Callers loop until `done`:
 *   - Manual "Sync Now": the browser drives the loop, showing progress.
 *   - Vercel Cron (daily): a server-side loop runs chunks within a time
 *     budget.
 */
import { storage } from "./storage";
import { tmeApi } from "./tme-api";
import {
  getSupplierPriceForMoq,
  calculatePriceWithFloor,
} from "./dynamic-pricing";
import { getFeeConfig } from "./fee-config";

export interface SyncChunkResult {
  total: number; // total TME products
  remaining: number; // TME products still not synced today (after this chunk)
  processedThisChunk: number;
  changed: number; // products whose price or stock actually changed
  ebayUpdated: number; // eBay listings updated
  done: boolean;
  errors: string[];
}

// A product is "stale" if it hasn't been synced within this many hours.
// Default 6h -> each product refreshes ~4x/day. Tune via SYNC_STALE_HOURS
// (raise toward 24 to cut TME calls as the catalog grows to 100k).
function staleCutoff(): Date {
  const hours = Number(process.env.SYNC_STALE_HOURS) || 6;
  return new Date(Date.now() - hours * 3600 * 1000);
}

export async function runSyncChunk(limit = 50): Promise<SyncChunkResult> {
  const errors: string[] = [];

  // DB-side: load only the next `limit` stalest TME products (indexed),
  // not the whole table.
  const staleBefore = staleCutoff();
  const total = await storage.getTmeProductCount();
  const slice = (await storage.getStaleTmeProducts(limit, staleBefore)).filter((p) => p.sku);
  if (slice.length === 0) {
    return { total, remaining: 0, processedThisChunk: 0, changed: 0, ebayUpdated: 0, done: true, errors };
  }

  // Resolve fee config once per chunk (drives the net-profit price floor).
  const feeConfig = await getFeeConfig("ebay");

  const symbols = slice.map((p) => p.supplierProductId || p.sku);
  let enhanced: Awaited<ReturnType<typeof tmeApi.getEnhancedProductInfo>> = [];
  try {
    enhanced = await tmeApi.getEnhancedProductInfo(symbols);
  } catch (e) {
    errors.push(`TME fetch failed: ${(e as Error).message}`);
  }
  const bySymbol = new Map(enhanced.map((e) => [e.product?.Symbol, e]));

  let changed = 0;
  // Inventory-model listings (offerId) -> bulkUpdatePriceQuantity.
  const inventoryUpdates: Array<{ product: any; quantity: number; price: number }> = [];
  const now = new Date();

  for (const product of slice) {
    const sym = product.supplierProductId || product.sku;
    const info = bySymbol.get(sym);

    // Couldn't fetch this one: still bump lastSyncedAt so the cursor
    // advances (it retries on the next day's sync), but record nothing.
    if (!info) {
      await storage.updateProduct(product.id, { lastSyncedAt: now });
      continue;
    }

    const moq = info.product?.MinAmount || product.moq || 1;
    const multiples = info.product?.Multiples || product.multiples || 1;
    const supplierPrice = getSupplierPriceForMoq(info.price?.PriceList as any, moq);
    const stock = info.stock?.Amount ?? product.stock ?? 0;
    const weightGrams =
      info.product?.Weight ?? (product.weight ? parseFloat(product.weight) : null);

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
    if (info.product?.MinAmount) update.moq = info.product.MinAmount;
    if (info.product?.Multiples) update.multiples = info.product.Multiples;
    if (pricing && product.useCalculatedPrice !== false) {
      update.salePrice = String(pricing.finalPrice);
      update.calculatedPrice = String(pricing.calculatedPrice);
      update.marginTier = pricing.marginTier;
      update.marginPercentage = String(pricing.marginPercentage);
      update.priceUpdatedAt = now;
    }
    await storage.updateProduct(product.id, update);

    if (priceChanged || stockChanged) {
      changed++;
      // Inventory listings carry an offerId; push qty/price via the
      // Inventory API (bulkUpdatePriceQuantity).
      if (product.listedOnEbay && product.ebayOfferId) {
        const limited =
          product.useStockLimit && product.ebayStockLimit != null
            ? Math.min(stock, product.ebayStockLimit)
            : stock;
        inventoryUpdates.push({
          product: { ...product, stock },
          quantity: Math.max(0, limited),
          price: pricing ? Number(pricing.finalPrice) : parseFloat(product.salePrice) || 0,
        });
      }
    }
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

  const remaining = Math.max(0, (await storage.getStaleTmeProductCount(staleBefore)));
  return {
    total,
    remaining,
    processedThisChunk: slice.length,
    changed,
    ebayUpdated,
    done: remaining === 0,
    errors,
  };
}

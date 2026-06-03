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
  calculateDynamicPrice,
  calculatePackagePrice,
} from "./dynamic-pricing";
import { ebayApi } from "./ebay-api";

export interface SyncChunkResult {
  total: number; // total TME products
  remaining: number; // TME products still not synced today (after this chunk)
  processedThisChunk: number;
  changed: number; // products whose price or stock actually changed
  ebayUpdated: number; // eBay listings updated
  done: boolean;
  errors: string[];
}

function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export async function runSyncChunk(limit = 50): Promise<SyncChunkResult> {
  const errors: string[] = [];
  const today = startOfToday();

  const all = await storage.getProducts();
  const tmeProducts = all.filter((p) => p.supplier === "TME" && p.sku);
  const total = tmeProducts.length;

  // Stalest first: anything never synced, or last synced before today.
  const pending = tmeProducts
    .filter((p) => {
      const t = p.lastSyncedAt ? new Date(p.lastSyncedAt).getTime() : 0;
      return t < today;
    })
    .sort((a, b) => {
      const at = a.lastSyncedAt ? new Date(a.lastSyncedAt).getTime() : 0;
      const bt = b.lastSyncedAt ? new Date(b.lastSyncedAt).getTime() : 0;
      return at - bt;
    });

  const slice = pending.slice(0, limit);
  if (slice.length === 0) {
    return { total, remaining: 0, processedThisChunk: 0, changed: 0, ebayUpdated: 0, done: true, errors };
  }

  const symbols = slice.map((p) => p.supplierProductId || p.sku);
  let enhanced: Awaited<ReturnType<typeof tmeApi.getEnhancedProductInfo>> = [];
  try {
    enhanced = await tmeApi.getEnhancedProductInfo(symbols);
  } catch (e) {
    errors.push(`TME fetch failed: ${(e as Error).message}`);
  }
  const bySymbol = new Map(enhanced.map((e) => [e.product?.Symbol, e]));

  let changed = 0;
  const ebayBatch: Array<{ productId: number; ebayItemId: string; quantity?: number; price?: number }> = [];
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

    const pricing =
      supplierPrice > 0
        ? moq > 1
          ? calculatePackagePrice(supplierPrice, moq, multiples)
          : calculateDynamicPrice(supplierPrice)
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
      if (product.listedOnEbay && product.ebayItemId) {
        const limited =
          product.useStockLimit && product.ebayStockLimit != null
            ? Math.min(stock, product.ebayStockLimit)
            : stock;
        ebayBatch.push({
          productId: product.id,
          ebayItemId: product.ebayItemId,
          quantity: Math.max(0, limited),
          price: pricing ? Number(pricing.finalPrice) : undefined,
        });
      }
    }
  }

  let ebayUpdated = 0;
  if (ebayBatch.length > 0) {
    try {
      const r = await ebayApi.bulkUpdateInventory(ebayBatch);
      ebayUpdated = r.succeeded;
      if (r.failed) errors.push(`eBay updates: ${r.failed} failed`);
    } catch (e) {
      errors.push(`eBay bulk update failed: ${(e as Error).message}`);
    }
  }

  const remaining = Math.max(0, pending.length - slice.length);
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

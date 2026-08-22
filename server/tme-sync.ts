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

  // Load the operator's DB pricing tiers (Configuration UI) — module state
  // resets per serverless invocation, so this must happen on EVERY import
  // path, not just the cron. Without it, browser imports priced with the
  // built-in config tiers and the next cron re-sync silently repriced them
  // with the DB tiers.
  setActivePricingTiers(dbTiersToPricingTiers(await storage.getPricingTiers()));

  for (const enhanced of enhancedProducts) {
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
        await storage.updateProduct(match.id, productData);
        result.updatedCount++;
      } else {
        // New product with no price: create it, but never as sellable.
        if (supplierPrice <= 0) {
          productData.supplierPrice = "0";
          productData.salePrice = "0";
          productData.status = "inactive";
        }
        await storage.createProduct(productData);
        result.syncedCount++;
      }
    } catch (itemError) {
      console.error("Failed to sync product:", itemError);
      result.failedCount++;
      result.errors.push(`Failed to sync: ${(itemError as Error).message}`);
    }
  }

  return result;
}

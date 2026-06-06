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
import { calculatePriceWithFloor, getSupplierPriceForMoq } from "./dynamic-pricing";
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

  // Look up only the products in this chunk (not the whole catalog).
  const existing = await storage.getProductsBySkus(symbols);
  const existingBySku = new Map(existing.map((p) => [p.sku, p]));

  const feeConfig = await getFeeConfig("ebay");

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

      const productData = {
        name: product.Description || product.Symbol,
        sku: product.Symbol,
        description: product.Description || "",
        category: product.Category || "Electronics",
        stock: stock?.Amount || 0,
        salePrice: String(pricingResult.finalPrice),
        supplierPrice: String(supplierPrice),
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

      const match = existingBySku.get(product.Symbol);
      if (match) {
        await storage.updateProduct(match.id, productData);
        result.updatedCount++;
      } else {
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

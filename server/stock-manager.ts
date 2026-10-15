/**
 * Stock Management System for eBay Listings
 * Handles real TME stock vs eBay stock limitations
 */

import { Product } from '../shared/schema';

export interface StockInfo {
  tmeStock: number;
  ebayStock: number;
  isLimited: boolean;
  limitReason: string;
}

/**
 * TME units consumed by ONE eBay sale. A product with MOQ > 1 is listed as a
 * pack of MOQ units ("10x capacitor ..." — see generateTitle and the package
 * pricing), so every eBay unit sold is an order for MOQ units at TME.
 */
export function packSize(product: Pick<Product, 'moq'>): number {
  const moq = Number(product.moq);
  return Number.isFinite(moq) && moq > 1 ? Math.floor(moq) : 1;
}

/**
 * Whole packs TME can fill from `stock` units. 7 units of a 10-pack is ZERO
 * sellable listings, not 7: counting units here is what kept 10x packs live
 * on eBay (and "available" in the CRM) after TME fell below one pack.
 */
export function packsInStock(stock: number | null | undefined, moq: number): number {
  const units = Math.max(0, Number(stock) || 0);
  return Math.floor(units / Math.max(1, moq));
}

/**
 * Calculate eBay stock based on real TME stock and product settings.
 * `ebayStock` is in eBay units (packs); `tmeStock` stays in TME units.
 */
export function calculateEbayStock(product: Product): StockInfo {
  const tmeStock = product.stock;
  const moq = packSize(product);
  const packs = packsInStock(tmeStock, moq);
  const ebayLimit = product.ebayStockLimit || 2;
  const useLimit = product.useStockLimit !== false; // default to true

  if (packs === 0) {
    return {
      tmeStock,
      ebayStock: 0,
      isLimited: false,
      limitReason: moq > 1 && tmeStock > 0
        ? `Below one pack (${tmeStock} of ${moq} units)`
        : 'Out of stock'
    };
  }

  if (!useLimit) {
    return {
      tmeStock,
      ebayStock: packs,
      isLimited: false,
      limitReason: 'Stock limit disabled for this product'
    };
  }

  if (packs <= ebayLimit) {
    return {
      tmeStock,
      ebayStock: packs,
      isLimited: false,
      limitReason: 'TME stock below eBay limit'
    };
  }

  return {
    tmeStock,
    ebayStock: ebayLimit,
    isLimited: true,
    limitReason: `Limited to ${ebayLimit} units to preserve eBay account limits`
  };
}

/**
 * Calculate eBay stock for multiple products
 */
export function calculateBulkEbayStock(products: Product[]): Array<{
  id: number;
  stockInfo: StockInfo;
}> {
  return products.map(product => ({
    id: product.id,
    stockInfo: calculateEbayStock(product)
  }));
}

/**
 * Get stock status display text
 */
export function getStockStatusText(stockInfo: StockInfo): string {
  if (stockInfo.tmeStock === 0) {
    return "Out of Stock";
  }
  
  if (!stockInfo.isLimited) {
    return `${stockInfo.tmeStock} units`;
  }
  
  return `${stockInfo.tmeStock} units (eBay: ${stockInfo.ebayStock})`;
}

/**
 * Get stock status color for UI
 */
export function getStockStatusColor(stockInfo: StockInfo): 'success' | 'warning' | 'destructive' {
  if (stockInfo.tmeStock === 0) {
    return 'destructive';
  }
  
  if (stockInfo.isLimited) {
    return 'warning';
  }
  
  return 'success';
}

/**
 * Validate eBay stock limit value
 */
export function validateStockLimit(limit: number): { valid: boolean; error?: string } {
  if (!Number.isInteger(limit) || limit < 1) {
    return { valid: false, error: 'Stock limit must be a positive integer' };
  }
  
  if (limit > 999) {
    return { valid: false, error: 'Stock limit cannot exceed 999 units' };
  }
  
  return { valid: true };
}

/**
 * Get recommended stock limits by category
 */
export function getRecommendedStockLimit(category: string): number {
  const categoryLimits: Record<string, number> = {
    'Arduino Boards': 3,
    'Development Boards': 3,
    'Microcontrollers': 5,
    'Sensors': 10,
    'Electronic Components': 15,
    'Resistors': 25,
    'Capacitors': 25,
    'LEDs': 20,
    'Connectors': 10,
    'Default': 3
  };
  
  return categoryLimits[category] || categoryLimits['Default'];
}
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
 * Calculate eBay stock based on real TME stock and product settings
 */
export function calculateEbayStock(product: Product): StockInfo {
  const tmeStock = product.stock;
  const ebayLimit = product.ebayStockLimit || 3;
  const useLimit = product.useStockLimit !== false; // default to true
  
  if (!useLimit) {
    return {
      tmeStock,
      ebayStock: tmeStock,
      isLimited: false,
      limitReason: 'Stock limit disabled for this product'
    };
  }
  
  if (tmeStock === 0) {
    return {
      tmeStock: 0,
      ebayStock: 0,
      isLimited: false,
      limitReason: 'Out of stock'
    };
  }
  
  if (tmeStock <= ebayLimit) {
    return {
      tmeStock,
      ebayStock: tmeStock,
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
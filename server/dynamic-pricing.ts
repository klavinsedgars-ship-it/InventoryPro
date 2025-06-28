/**
 * Dynamic Pricing System for eBay Lister CRM
 * Implements tiered margin-based pricing calculation
 */

export interface PricingTier {
  min: number;
  max: number;
  multiplier: number;
  label: string;
  marginPercentage: number;
}

export interface PricingConfig {
  tiers: PricingTier[];
  minPrice: number;
  maxPrice: number;
  roundingRule: 'nearest_99' | 'nearest_05' | 'no_rounding';
}

export interface PriceCalculationResult {
  supplierPrice: number;
  calculatedPrice: number;
  finalPrice: number;
  marginTier: string;
  marginPercentage: number;
  multiplier: number;
  isValid: boolean;
  errors: string[];
}

// Core pricing configuration based on specification
export const PRICING_CONFIG: PricingConfig = {
  tiers: [
    { min: 1.00, max: 5.00, multiplier: 6.00, label: "Ultra High", marginPercentage: 500 },
    { min: 5.01, max: 9.99, multiplier: 4.00, label: "Very High", marginPercentage: 300 },
    { min: 10.00, max: 15.00, multiplier: 3.00, label: "High", marginPercentage: 200 },
    { min: 15.01, max: 25.00, multiplier: 2.50, label: "Medium-High", marginPercentage: 150 },
    { min: 25.01, max: 50.00, multiplier: 2.00, label: "Medium", marginPercentage: 100 },
    { min: 50.01, max: 100.00, multiplier: 1.75, label: "Low-Medium", marginPercentage: 75 },
    { min: 100.01, max: 999999, multiplier: 1.50, label: "Low", marginPercentage: 50 }
  ],
  minPrice: 2.00,
  maxPrice: 10000.00,
  roundingRule: "nearest_99"
};

/**
 * Calculate dynamic price based on supplier cost and pricing tiers
 */
export function calculateDynamicPrice(supplierPrice: number | string): PriceCalculationResult {
  const errors: string[] = [];
  
  // Input validation
  const numericPrice = typeof supplierPrice === 'string' ? parseFloat(supplierPrice) : supplierPrice;
  
  if (isNaN(numericPrice) || numericPrice <= 0) {
    return {
      supplierPrice: 0,
      calculatedPrice: 0,
      finalPrice: 0,
      marginTier: '',
      marginPercentage: 0,
      multiplier: 0,
      isValid: false,
      errors: ['Invalid supplier price: must be a positive number']
    };
  }

  // Find appropriate pricing tier
  const tier = PRICING_CONFIG.tiers.find(t => numericPrice >= t.min && numericPrice <= t.max);
  
  if (!tier) {
    return {
      supplierPrice: numericPrice,
      calculatedPrice: 0,
      finalPrice: 0,
      marginTier: '',
      marginPercentage: 0,
      multiplier: 0,
      isValid: false,
      errors: [`No pricing tier found for supplier price €${numericPrice.toFixed(2)}`]
    };
  }

  // Calculate price using tier multiplier
  const calculatedPrice = numericPrice * tier.multiplier;
  
  // Apply business rules (min/max price limits)
  let finalPrice = calculatedPrice;
  
  if (calculatedPrice < PRICING_CONFIG.minPrice) {
    finalPrice = PRICING_CONFIG.minPrice;
    errors.push(`Price adjusted to minimum: €${PRICING_CONFIG.minPrice.toFixed(2)}`);
  }
  
  if (calculatedPrice > PRICING_CONFIG.maxPrice) {
    finalPrice = PRICING_CONFIG.maxPrice;
    errors.push(`Price capped at maximum: €${PRICING_CONFIG.maxPrice.toFixed(2)}`);
  }

  // Apply rounding rules
  finalPrice = applyRoundingRule(finalPrice, PRICING_CONFIG.roundingRule);

  return {
    supplierPrice: numericPrice,
    calculatedPrice,
    finalPrice,
    marginTier: tier.label,
    marginPercentage: tier.marginPercentage,
    multiplier: tier.multiplier,
    isValid: true,
    errors
  };
}

/**
 * Apply rounding rules to calculated price
 */
function applyRoundingRule(price: number, rule: string): number {
  switch (rule) {
    case 'nearest_99':
      // Round to nearest .99 (e.g., 18.73 → 18.99)
      return Math.floor(price) + 0.99;
    
    case 'nearest_05':
      // Round to nearest .05 (e.g., 18.73 → 18.75)
      return Math.round(price * 20) / 20;
    
    case 'no_rounding':
    default:
      // Round to 2 decimal places
      return Math.round(price * 100) / 100;
  }
}

/**
 * Bulk calculate prices for multiple products
 */
export function calculateBulkPricing(products: Array<{ id: number, supplierPrice: number }>): Array<{
  id: number;
  result: PriceCalculationResult;
}> {
  return products.map(product => ({
    id: product.id,
    result: calculateDynamicPrice(product.supplierPrice)
  }));
}

/**
 * Get pricing tier information for a given supplier price
 */
export function getPricingTierInfo(supplierPrice: number): PricingTier | null {
  return PRICING_CONFIG.tiers.find(t => supplierPrice >= t.min && supplierPrice <= t.max) || null;
}

/**
 * Get all available pricing tiers
 */
export function getPricingTiers(): PricingTier[] {
  return PRICING_CONFIG.tiers;
}

/**
 * Validate pricing configuration
 */
export function validatePricingConfig(): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  // Check for tier overlaps
  for (let i = 0; i < PRICING_CONFIG.tiers.length - 1; i++) {
    const current = PRICING_CONFIG.tiers[i];
    const next = PRICING_CONFIG.tiers[i + 1];
    
    if (current.max >= next.min) {
      errors.push(`Tier overlap: ${current.label} (max: ${current.max}) overlaps with ${next.label} (min: ${next.min})`);
    }
  }
  
  // Check for gaps in tier coverage
  for (let i = 0; i < PRICING_CONFIG.tiers.length - 1; i++) {
    const current = PRICING_CONFIG.tiers[i];
    const next = PRICING_CONFIG.tiers[i + 1];
    
    if (current.max + 0.01 < next.min) {
      errors.push(`Tier gap: Range €${(current.max + 0.01).toFixed(2)} to €${(next.min - 0.01).toFixed(2)} not covered`);
    }
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Format price for display (EUR currency)
 */
export function formatPrice(price: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(price);
}

/**
 * Generate pricing summary for a product
 */
export function generatePricingSummary(supplierPrice: number): string {
  const result = calculateDynamicPrice(supplierPrice);
  
  if (!result.isValid) {
    return `Error: ${result.errors.join(', ')}`;
  }
  
  const profit = result.finalPrice - result.supplierPrice;
  const actualMargin = ((profit / result.supplierPrice) * 100).toFixed(1);
  
  return `${formatPrice(result.supplierPrice)} → ${formatPrice(result.finalPrice)} (${result.marginTier}, ${actualMargin}% margin)`;
}
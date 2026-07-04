/**
 * Dynamic Pricing System for eBay Lister CRM
 * Implements tiered margin-based pricing calculation
 */
import {
  calculateProfitFloorPrice,
  type FeeConfig,
  type Marketplace,
} from "./fee-model";

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

export interface PackagePriceResult extends PriceCalculationResult {
  moq: number;
  multiples: number;
  packageSupplierPrice: number;
  packageFinalPrice: number;
  pricePerUnit: number;
  quantityLabel: string;
}

// Core pricing configuration based on specification
export const PRICING_CONFIG: PricingConfig = {
  tiers: [
    // Low-cost component tiers for resistors, capacitors, etc. (reduced margins)
    { min: 0.001, max: 0.05, multiplier: 10.00, label: "Micro Components", marginPercentage: 900 },
    { min: 0.05, max: 0.25, multiplier: 6.00, label: "Small Components", marginPercentage: 500 },
    { min: 0.25, max: 1.00, multiplier: 5.00, label: "Low Cost", marginPercentage: 400 },
    { min: 1.00, max: 5.00, multiplier: 4.00, label: "Budget", marginPercentage: 300 },
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

// The tier set the calculations actually use. Defaults to the canonical
// PRICING_CONFIG so behavior is unchanged until a caller loads DB tiers.
// Entry points (the sync cron, the "recalculate all" routes) call
// setActivePricingTiers(dbTiersToPricingTiers(await storage.getPricingTiers()))
// so edits made in the Configuration UI take effect. min/max/rounding stay on
// PRICING_CONFIG — only the per-band tiers are editable.
let activeTiers: PricingTier[] = PRICING_CONFIG.tiers;

export function setActivePricingTiers(tiers: PricingTier[] | null | undefined): void {
  activeTiers = tiers && tiers.length > 0 ? tiers : PRICING_CONFIG.tiers;
}

/** Map pricing_tiers DB rows (decimal strings) to numeric PricingTier[]. */
export function dbTiersToPricingTiers(
  rows: Array<{ min: string; max: string; multiplier: string; label: string; marginPercentage: string }>,
): PricingTier[] {
  return rows
    .map((r) => ({
      min: parseFloat(r.min),
      max: parseFloat(r.max),
      multiplier: parseFloat(r.multiplier),
      label: r.label,
      marginPercentage: parseFloat(r.marginPercentage),
    }))
    .filter((t) => Number.isFinite(t.min) && Number.isFinite(t.max) && Number.isFinite(t.multiplier))
    .sort((a, b) => a.min - b.min);
}

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
  const tier = activeTiers.find(t => numericPrice >= t.min && numericPrice <= t.max);
  
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
  return activeTiers.find(t => supplierPrice >= t.min && supplierPrice <= t.max) || null;
}

/**
 * Get all available pricing tiers
 */
export function getPricingTiers(): PricingTier[] {
  return activeTiers;
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

/**
 * Calculate package price for products sold in multiples (MOQ)
 * 
 * CORRECT LOGIC:
 * 1. Calculate package supplier cost = Unit Price × MOQ (this is what we pay TME)
 * 2. Apply margin to the PACKAGE supplier cost (not per-unit!)
 * 3. Result is the eBay listing price for the whole package
 * 
 * Example: 10x Microswitch @ €0.0811/unit
 * - Package supplier cost = €0.0811 × 10 = €0.81
 * - Apply margin to €0.81 → ~€4-5 eBay price for the 10-pack
 */
export function calculatePackagePrice(
  unitSupplierPrice: number | string,
  moq: number = 1,
  multiples: number = 1
): PackagePriceResult {
  const numericUnitPrice = typeof unitSupplierPrice === 'string' 
    ? parseFloat(unitSupplierPrice) 
    : unitSupplierPrice;
  
  // Calculate the package supplier price (what we pay TME for MOQ units)
  const packageSupplierPrice = Math.round(numericUnitPrice * moq * 100) / 100;
  
  // Apply margin to the PACKAGE supplier cost, not per-unit!
  // This is the key fix: margin applies to total purchase price
  const packageResult = calculateDynamicPrice(packageSupplierPrice);
  
  if (!packageResult.isValid) {
    return {
      ...packageResult,
      moq,
      multiples,
      packageSupplierPrice: 0,
      packageFinalPrice: 0,
      pricePerUnit: 0,
      quantityLabel: formatQuantityLabel(moq)
    };
  }
  
  // The package final price is the result of applying margin to package cost
  const packageFinalPrice = packageResult.finalPrice;
  
  // Calculate effective per-unit price after margin and rounding
  const pricePerUnit = Math.round((packageFinalPrice / moq) * 100) / 100;
  
  return {
    // Override supplier price to show per-unit for reference
    supplierPrice: numericUnitPrice,
    calculatedPrice: packageResult.calculatedPrice,
    finalPrice: packageFinalPrice, // This is the eBay listing price
    marginTier: packageResult.marginTier,
    marginPercentage: packageResult.marginPercentage,
    multiplier: packageResult.multiplier,
    isValid: true,
    errors: packageResult.errors,
    moq,
    multiples,
    packageSupplierPrice,
    packageFinalPrice,
    pricePerUnit,
    quantityLabel: formatQuantityLabel(moq)
  };
}

export interface ProfitFloorOptions {
  packageSupplierCost: number; // unit supplier price * MOQ
  weightGrams: number | null | undefined;
  marketplace: Marketplace;
  config: FeeConfig;
}

/**
 * Raise a tier-priced result up to the price that nets at least
 * config.targetMinNetProfit (after eBay fees + VAT + shipping residual).
 * The aspirational tier label/margin is preserved; only finalPrice changes,
 * and a note is appended when the floor binds. This replaces the role of the
 * flat €2.00 min for callers that can supply weight + fee config.
 */
export function applyProfitFloor<T extends PriceCalculationResult>(
  result: T,
  opts: ProfitFloorOptions,
): T {
  if (!result.isValid) return result;

  const floorRaw = calculateProfitFloorPrice({
    packageSupplierCost: opts.packageSupplierCost,
    weightGrams: opts.weightGrams,
    marketplace: opts.marketplace,
    config: opts.config,
  });
  if (!isFinite(floorRaw) || floorRaw <= 0) return result;

  // Round up to the next .99 so the floor still nets >= target.
  let floorPrice = Math.floor(floorRaw) + 0.99;
  if (floorPrice < floorRaw) floorPrice += 1;
  floorPrice = Math.min(floorPrice, PRICING_CONFIG.maxPrice);

  if (floorPrice > result.finalPrice) {
    return {
      ...result,
      finalPrice: floorPrice,
      errors: [
        ...result.errors,
        `Raised to €${floorPrice.toFixed(2)} to meet €${opts.config.targetMinNetProfit.toFixed(2)} net profit floor`,
      ],
    };
  }
  return result;
}

/**
 * Single shared entry point: compute the tier price (package-aware) and apply
 * the net-profit floor. Use this everywhere prices are set so the floor is
 * applied consistently. packageSupplierCost = unit price * MOQ.
 */
export function calculatePriceWithFloor(
  supplierUnitPrice: number | string,
  opts: {
    moq?: number;
    multiples?: number;
    weightGrams?: number | null;
    marketplace?: Marketplace;
    config: FeeConfig;
  },
): PriceCalculationResult {
  const unit =
    typeof supplierUnitPrice === "string"
      ? parseFloat(supplierUnitPrice)
      : supplierUnitPrice;
  const moq = opts.moq && opts.moq > 1 ? opts.moq : 1;
  const multiples = opts.multiples && opts.multiples > 1 ? opts.multiples : 1;

  const base =
    moq > 1
      ? calculatePackagePrice(unit, moq, multiples)
      : calculateDynamicPrice(unit);

  return applyProfitFloor(base, {
    packageSupplierCost: unit * moq,
    weightGrams: opts.weightGrams ?? null,
    marketplace: opts.marketplace ?? "ebay",
    config: opts.config,
  });
}

/**
 * Format quantity label for display (e.g., "10x", "50x", "100x")
 */
export function formatQuantityLabel(quantity: number): string {
  if (quantity <= 1) return "";
  return `${quantity}x`;
}

/**
 * TME PriceList entry structure
 */
interface TMEPriceEntry {
  Amount: number;      // Minimum quantity threshold for this price tier
  PriceValue: number;  // Price per unit at this tier
  PriceBase?: number;
  Special?: boolean;
}

/**
 * Get the correct supplier price for a given MOQ from TME's PriceList
 * 
 * TME PriceList structure example:
 * [
 *   { Amount: 1, PriceValue: 0.20 },    // Base price for 1-4 units
 *   { Amount: 5, PriceValue: 0.164 },   // Discount for 5-24 units
 *   { Amount: 25, PriceValue: 0.098 },  // Bigger discount for 25-99 units
 *   { Amount: 100, PriceValue: 0.087 }, // etc.
 * ]
 * 
 * For MOQ=5, we should use PriceValue=0.164 (the tier where Amount <= 5)
 * This ensures package price = 5 × 0.164 = 0.82 EUR (matches TME's total)
 * 
 * @param priceList - TME's PriceList array
 * @param moq - Minimum Order Quantity
 * @returns The per-unit price for the given MOQ quantity tier
 */
export function getSupplierPriceForMoq(
  priceList: TMEPriceEntry[] | undefined | null,
  moq: number = 1
): number {
  if (!priceList || priceList.length === 0) {
    return 0;
  }

  // Sort price list by Amount ascending to find the correct tier
  const sortedPrices = [...priceList].sort((a, b) => a.Amount - b.Amount);
  
  // Find the price tier that applies to our MOQ
  // We want the highest Amount that is <= moq
  let applicablePrice = sortedPrices[0]?.PriceValue || 0;
  
  for (const tier of sortedPrices) {
    if (tier.Amount <= moq) {
      applicablePrice = tier.PriceValue;
    } else {
      // Once we exceed the MOQ, stop looking
      break;
    }
  }
  
  return applicablePrice;
}
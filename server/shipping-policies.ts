/**
 * eBay Shipping Policy Management
 * Maps product weight to appropriate shipping policy IDs
 * 
 * Weight-based shipping policies created on eBay:
 * - 0.01-99gr: £3.99 (UK/Europe), +£1 additional item
 * - 100-499gr: £4.99 (UK/Europe), +£1 additional item
 * - 500-999gr: £6.99 (UK/Europe), +£1 additional item
 * - 999-1999gr: £9.99 (UK/Europe), +£5 additional item
 * 
 * All policies exclude Belarus (BY) from shipping
 */

export interface WeightRange {
  min: number;
  max: number;
}

export interface ShippingPolicy {
  id: string;
  ebayPolicyId: string;  // The actual eBay fulfillment policy ID
  name: string;
  weightRange: WeightRange;
  description: string;
  price: string;
  additionalItemPrice: string;
  isDefault?: boolean;
}

// Shipping policy mapping based on weight ranges (in grams).
// The eBay fulfillment-policy IDs come from env vars so the same code
// works across marketplaces (UK / DE / ...). The hardcoded fallbacks are
// the original UK policy IDs, kept so existing UK behaviour is unchanged
// when the env vars aren't set.
//
// DE policy IDs (created 2026-06 via /api/__bootstrap-de-policies) are
// provided through:
//   EBAY_SHIPPING_POLICY_0_99GR
//   EBAY_SHIPPING_POLICY_100_499GR
//   EBAY_SHIPPING_POLICY_500_999GR
//   EBAY_SHIPPING_POLICY_1000_1999GR
//
// Weight bands use half-open intervals [min, max) so there is no gap at
// the boundaries (the old code had a hole at 999.01–999.99g that fell
// through to the default policy).
export const SHIPPING_POLICIES: ShippingPolicy[] = [
  {
    id: "policy_0_99",
    ebayPolicyId: process.env.EBAY_SHIPPING_POLICY_0_99GR || "268493033019",
    name: "0-99gr",
    weightRange: { min: 0, max: 100 },
    description: "Light items: SMD components, resistors, capacitors, small ICs",
    price: "4.99",
    additionalItemPrice: "1.00"
  },
  {
    id: "policy_100_499",
    ebayPolicyId: process.env.EBAY_SHIPPING_POLICY_100_499GR || "268493034019",
    name: "100-499gr",
    weightRange: { min: 100, max: 500 },
    description: "Small items: sensors, modules, connectors, small boards",
    price: "6.99",
    additionalItemPrice: "1.00"
  },
  {
    id: "policy_500_999",
    ebayPolicyId: process.env.EBAY_SHIPPING_POLICY_500_999GR || "268493035019",
    name: "500-999gr",
    weightRange: { min: 500, max: 1000 },
    description: "Medium items: development boards, larger modules, cables",
    price: "9.99",
    additionalItemPrice: "2.00"
  },
  {
    id: "policy_1000_1999",
    ebayPolicyId: process.env.EBAY_SHIPPING_POLICY_1000_1999GR || "268493036019",
    name: "1000-1999gr",
    weightRange: { min: 1000, max: 2000 },
    description: "Heavy items: power supplies, kits, bulk components",
    price: "14.99",
    additionalItemPrice: "5.00"
  }
];

// Default policy for items without weight or invalid weight (lightest policy)
export const DEFAULT_SHIPPING_POLICY_ID =
  process.env.EBAY_SHIPPING_POLICY_0_99GR || "268493033019";
export const DEFAULT_SHIPPING_POLICY_NAME = "0-99gr";

/**
 * Get eBay shipping policy ID based on product weight in grams
 */
export function getShippingPolicyId(weightGrams: number | null | undefined): string {
  // Handle invalid or missing weight - use lightest policy
  if (weightGrams === null || weightGrams === undefined || weightGrams <= 0) {
    console.log(`No weight specified, using default policy: ${DEFAULT_SHIPPING_POLICY_NAME} (${DEFAULT_SHIPPING_POLICY_ID})`);
    return DEFAULT_SHIPPING_POLICY_ID;
  }

  // Find matching policy based on weight (half-open intervals: min <= w < max)
  for (const policy of SHIPPING_POLICIES) {
    if (weightGrams >= policy.weightRange.min && weightGrams < policy.weightRange.max) {
      console.log(`Weight ${weightGrams}g matched to policy: ${policy.name} (eBay ID: ${policy.ebayPolicyId})`);
      return policy.ebayPolicyId;
    }
  }

  // For weights above our max range (1999g), use the heaviest policy
  if (weightGrams > 1999) {
    const heaviestPolicy = SHIPPING_POLICIES[SHIPPING_POLICIES.length - 1];
    console.warn(`Weight ${weightGrams}g exceeds max range, using heaviest policy: ${heaviestPolicy.name} (${heaviestPolicy.ebayPolicyId})`);
    return heaviestPolicy.ebayPolicyId;
  }

  // Fallback to default
  console.warn(`Weight ${weightGrams}g outside all ranges, using default policy: ${DEFAULT_SHIPPING_POLICY_ID}`);
  return DEFAULT_SHIPPING_POLICY_ID;
}

/**
 * Get policy details by eBay policy ID
 */
export function getShippingPolicyById(ebayPolicyId: string): ShippingPolicy | null {
  return SHIPPING_POLICIES.find(policy => policy.ebayPolicyId === ebayPolicyId) || null;
}

/**
 * Get policy name by weight
 */
export function getShippingPolicyName(weightGrams: number | null | undefined): string {
  const policyId = getShippingPolicyId(weightGrams);
  const policy = getShippingPolicyById(policyId);
  return policy?.name || DEFAULT_SHIPPING_POLICY_NAME;
}

/**
 * Get full policy details by weight
 */
export function getShippingPolicyByWeight(weightGrams: number | null | undefined): ShippingPolicy | null {
  const policyId = getShippingPolicyId(weightGrams);
  return getShippingPolicyById(policyId);
}

/**
 * Validate shipping policy mapping - check for gaps and overlaps
 */
export function validateShippingPolicies(): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check for overlapping ranges
  for (let i = 0; i < SHIPPING_POLICIES.length; i++) {
    for (let j = i + 1; j < SHIPPING_POLICIES.length; j++) {
      const policy1 = SHIPPING_POLICIES[i];
      const policy2 = SHIPPING_POLICIES[j];
      
      // Check for overlap
      if (!(policy1.weightRange.max < policy2.weightRange.min || 
            policy2.weightRange.max < policy1.weightRange.min)) {
        errors.push(`Overlapping weight ranges: ${policy1.name} and ${policy2.name}`);
      }
    }
  }

  // Check for gaps in coverage
  const sortedPolicies = [...SHIPPING_POLICIES].sort((a, b) => a.weightRange.min - b.weightRange.min);
  for (let i = 0; i < sortedPolicies.length - 1; i++) {
    const current = sortedPolicies[i];
    const next = sortedPolicies[i + 1];
    
    if (current.weightRange.max + 1 < next.weightRange.min) {
      errors.push(`Gap in weight coverage: ${current.weightRange.max + 1}g to ${next.weightRange.min - 1}g`);
    }
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Get all available shipping policies
 */
export function getAllShippingPolicies(): ShippingPolicy[] {
  return SHIPPING_POLICIES;
}

/**
 * Bulk assign shipping policies to products based on weight
 */
export function assignShippingPolicies(products: Array<{ id: number; weight: number | null }>): Array<{
  productId: number;
  weight: number | null;
  ebayPolicyId: string;
  policyName: string;
  price: string;
}> {
  return products.map(product => {
    const weightGrams = product.weight !== null ? product.weight : null;
    const policy = getShippingPolicyByWeight(weightGrams);
    return {
      productId: product.id,
      weight: product.weight,
      ebayPolicyId: getShippingPolicyId(weightGrams),
      policyName: policy?.name || DEFAULT_SHIPPING_POLICY_NAME,
      price: policy?.price || "£3.99"
    };
  });
}

/**
 * Generate shipping policy summary for admin dashboard
 */
export function generatePolicySummary(): string {
  let summary = "eBay Weight-Based Shipping Policies:\n\n";
  
  SHIPPING_POLICIES.forEach(policy => {
    summary += `${policy.name}\n`;
    summary += `  eBay Policy ID: ${policy.ebayPolicyId}\n`;
    summary += `  Weight Range: ${policy.weightRange.min}-${policy.weightRange.max}g\n`;
    summary += `  Price: ${policy.price} (additional: ${policy.additionalItemPrice})\n`;
    summary += `  Description: ${policy.description}\n\n`;
  });
  
  summary += `Default Policy: ${DEFAULT_SHIPPING_POLICY_NAME} (${DEFAULT_SHIPPING_POLICY_ID})\n`;
  summary += `Note: All policies exclude Belarus (BY) from shipping\n`;
  
  const validation = validateShippingPolicies();
  if (!validation.isValid) {
    summary += "\nConfiguration Issues:\n";
    validation.errors.forEach(error => {
      summary += `- ${error}\n`;
    });
  }
  
  return summary;
}

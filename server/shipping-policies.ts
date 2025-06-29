/**
 * eBay Shipping Policy Management
 * Maps product weight to appropriate shipping policy IDs
 */

export interface WeightRange {
  min: number;
  max: number;
}

export interface ShippingPolicy {
  id: string;
  name: string;
  weightRange: WeightRange;
  description: string;
  isDefault?: boolean;
}

// Shipping policy mapping based on weight ranges (in grams)
export const SHIPPING_POLICIES: ShippingPolicy[] = [
  {
    id: "policy_light",
    name: "Light Items (0-99g)",
    weightRange: { min: 0, max: 99 },
    description: "Small electronics components, resistors, LEDs"
  },
  {
    id: "policy_small",
    name: "Small Items (100-250g)", 
    weightRange: { min: 100, max: 250 },
    description: "Sensors, small modules, development boards"
  },
  {
    id: "policy_medium",
    name: "Medium Items (251-500g)",
    weightRange: { min: 251, max: 500 },
    description: "Arduino boards, larger modules, cables"
  },
  {
    id: "policy_heavy",
    name: "Heavy Items (501-999g)",
    weightRange: { min: 501, max: 999 },
    description: "Power supplies, larger boards, kits"
  },
  {
    id: "policy_very_heavy",
    name: "Very Heavy Items (1-4.9kg)",
    weightRange: { min: 1000, max: 4999 },
    description: "Large power supplies, complete kits, multiple items"
  },
  {
    id: "policy_oversized",
    name: "Oversized Items (5kg+)",
    weightRange: { min: 5000, max: 99999 },
    description: "Large equipment, bulk orders"
  }
];

// Default policy for items without weight or invalid weight
export const DEFAULT_SHIPPING_POLICY = "policy_medium";

/**
 * Get shipping policy ID based on product weight
 */
export function getShippingPolicyId(weightGrams: number | null | undefined): string {
  // Handle invalid weight
  if (weightGrams === null || weightGrams === undefined || weightGrams < 0) {
    console.warn(`Invalid weight: ${weightGrams}, using default policy: ${DEFAULT_SHIPPING_POLICY}`);
    return DEFAULT_SHIPPING_POLICY;
  }

  // Find matching policy
  for (const policy of SHIPPING_POLICIES) {
    if (weightGrams >= policy.weightRange.min && weightGrams <= policy.weightRange.max) {
      console.log(`Weight ${weightGrams}g matched to policy: ${policy.id} (${policy.name})`);
      return policy.id;
    }
  }

  // Fallback for extreme weights
  console.warn(`Weight ${weightGrams}g outside all ranges, using default policy: ${DEFAULT_SHIPPING_POLICY}`);
  return DEFAULT_SHIPPING_POLICY;
}

/**
 * Get policy details by ID
 */
export function getShippingPolicyById(policyId: string): ShippingPolicy | null {
  return SHIPPING_POLICIES.find(policy => policy.id === policyId) || null;
}

/**
 * Get policy name by weight
 */
export function getShippingPolicyName(weightGrams: number | null | undefined): string {
  const policyId = getShippingPolicyId(weightGrams);
  const policy = getShippingPolicyById(policyId);
  return policy?.name || "Default Policy";
}

/**
 * Validate shipping policy mapping
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
 * Bulk assign shipping policies to products
 */
export function assignShippingPolicies(products: Array<{ id: number; weight: number | null }>): Array<{
  productId: number;
  weight: number | null;
  policyId: string;
  policyName: string;
}> {
  return products.map(product => ({
    productId: product.id,
    weight: product.weight,
    policyId: getShippingPolicyId(product.weight),
    policyName: getShippingPolicyName(product.weight)
  }));
}

/**
 * Generate shipping policy summary for admin
 */
export function generatePolicySummary(): string {
  let summary = "eBay Shipping Policy Configuration:\n\n";
  
  SHIPPING_POLICIES.forEach(policy => {
    summary += `${policy.name}\n`;
    summary += `  Policy ID: ${policy.id}\n`;
    summary += `  Weight Range: ${policy.weightRange.min}-${policy.weightRange.max}g\n`;
    summary += `  Description: ${policy.description}\n\n`;
  });
  
  summary += `Default Policy: ${DEFAULT_SHIPPING_POLICY}\n`;
  
  const validation = validateShippingPolicies();
  if (!validation.isValid) {
    summary += "\nConfiguration Issues:\n";
    validation.errors.forEach(error => {
      summary += `- ${error}\n`;
    });
  }
  
  return summary;
}
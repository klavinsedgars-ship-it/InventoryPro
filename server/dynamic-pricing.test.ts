import { describe, it, expect, afterEach } from "vitest";
import {
  calculateDynamicPrice,
  calculatePackagePrice,
  dbTiersToPricingTiers,
  setActivePricingTiers,
} from "./dynamic-pricing";

// Restore the default tiers after any test that swaps them, so ordering
// between tests can't leak state (activeTiers is module-level).
afterEach(() => setActivePricingTiers(null));

describe("calculateDynamicPrice (default tiers)", () => {
  it("selects the tier by supplier price and applies the multiplier + .99 rounding", () => {
    const r = calculateDynamicPrice(3); // Budget tier: 1.00–5.00, ×4
    expect(r.isValid).toBe(true);
    expect(r.marginTier).toBe("Budget");
    expect(r.multiplier).toBe(4);
    expect(r.calculatedPrice).toBeCloseTo(12, 5);
    expect(r.finalPrice).toBe(12.99); // floor(12)+0.99
  });

  it("uses the correct higher-price tier", () => {
    const r = calculateDynamicPrice(20); // Medium-High: 15.01–25, ×2.5
    expect(r.marginTier).toBe("Medium-High");
    expect(r.finalPrice).toBe(50.99);
  });

  it("covers sub-€1 components (the band the old DB seed was missing)", () => {
    const r = calculateDynamicPrice(0.5); // Low Cost: 0.25–1.00, ×5 -> 2.50
    expect(r.isValid).toBe(true);
    expect(r.marginTier).toBe("Low Cost");
    expect(r.finalPrice).toBe(2.99);
  });

  it("rejects non-positive supplier prices", () => {
    expect(calculateDynamicPrice(0).isValid).toBe(false);
    expect(calculateDynamicPrice(-1).isValid).toBe(false);
    expect(calculateDynamicPrice("abc").isValid).toBe(false);
  });
});

describe("dbTiersToPricingTiers + setActivePricingTiers", () => {
  it("maps decimal-string rows to numbers, sorts, and drops invalid rows", () => {
    const tiers = dbTiersToPricingTiers([
      { min: "5.00", max: "10.00", multiplier: "2.00", label: "B", marginPercentage: "100" },
      { min: "0.00", max: "5.00", multiplier: "3.00", label: "A", marginPercentage: "200" },
      { min: "x", max: "y", multiplier: "z", label: "bad", marginPercentage: "0" },
    ]);
    expect(tiers.map((t) => t.label)).toEqual(["A", "B"]); // sorted by min, bad row dropped
    expect(tiers[0].multiplier).toBe(3);
  });

  it("makes edited tiers take effect in the calculation", () => {
    setActivePricingTiers([
      { min: 0, max: 1_000_000, multiplier: 2, label: "Flat 2x", marginPercentage: 100 },
    ]);
    const r = calculateDynamicPrice(10); // 10 × 2 = 20 -> 20.99
    expect(r.marginTier).toBe("Flat 2x");
    expect(r.finalPrice).toBe(20.99);
  });

  it("falls back to the built-in config when given empty tiers", () => {
    setActivePricingTiers([]);
    expect(calculateDynamicPrice(3).marginTier).toBe("Budget"); // default tier still used
  });
});

describe("calculatePackagePrice (MOQ)", () => {
  it("applies margin to the PACKAGE cost (unit × MOQ), not per-unit", () => {
    const r = calculatePackagePrice(0.08, 10); // pkg cost 0.80 -> Low Cost ×5 -> 4.00 -> 4.99
    expect(r.packageSupplierPrice).toBeCloseTo(0.8, 5);
    expect(r.packageFinalPrice).toBe(4.99);
    expect(r.pricePerUnit).toBeCloseTo(0.5, 2);
  });
});

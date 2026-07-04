import { describe, it, expect } from "vitest";
import {
  DEFAULT_FEE_CONFIG,
  calculateNetProfit,
  calculateProfitFloorPrice,
} from "./fee-model";

const ebay = DEFAULT_FEE_CONFIG.ebay;

describe("fee-model floor is the inverse of net-profit", () => {
  it("pricing exactly at the floor nets the target minimum profit", () => {
    const packageSupplierCost = 3.5;
    const weightGrams = 120;
    const floor = calculateProfitFloorPrice({ packageSupplierCost, weightGrams, marketplace: "ebay", config: ebay });

    const net = calculateNetProfit({
      salePrice: floor,
      packageSupplierCost,
      weightGrams,
      marketplace: "ebay",
      config: ebay,
    }).netProfit;

    // The floor is defined as the price where net == targetMinNetProfit.
    expect(net).toBeCloseTo(ebay.targetMinNetProfit, 4);
  });

  it("a higher sale price nets more than the floor price", () => {
    const base = { packageSupplierCost: 2, weightGrams: 50, marketplace: "ebay" as const, config: ebay };
    const floor = calculateProfitFloorPrice(base);
    const atFloor = calculateNetProfit({ ...base, salePrice: floor }).netProfit;
    const above = calculateNetProfit({ ...base, salePrice: floor + 5 }).netProfit;
    expect(above).toBeGreaterThan(atFloor);
  });

  it("net profit decreases as supplier cost rises (all else equal)", () => {
    const base = { salePrice: 20, weightGrams: 50, marketplace: "ebay" as const, config: ebay };
    const cheap = calculateNetProfit({ ...base, packageSupplierCost: 1 }).netProfit;
    const dear = calculateNetProfit({ ...base, packageSupplierCost: 8 }).netProfit;
    expect(cheap).toBeGreaterThan(dear);
    expect(cheap - dear).toBeCloseTo(7, 5); // €7 more cost -> €7 less profit
  });
});

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

describe("postage comes from the real tariff table", () => {
  const cfg = { ...DEFAULT_FEE_CONFIG.ebay };

  it("uses the published untracked rate by default", () => {
    // 200g of goods + 40g packaging = 240g → the 101-500g band. Untracked to
    // DE is 6.12 — the real tariff, where the old model inferred ~6.17 from
    // the buyer's shipping charge and happened to land nearby.
    const b = calculateNetProfit({
      salePrice: 20, packageSupplierCost: 5, weightGrams: 200,
      marketplace: "ebay", config: cfg, destinationCountry: "DE",
    });
    expect(b.actualPostageCost).toBe(6.12);
    expect(b.postageTracked).toBe(false);
  });

  it("charges the tracked rate when tracking is opted into", () => {
    const b = calculateNetProfit({
      salePrice: 20, packageSupplierCost: 5, weightGrams: 200,
      marketplace: "ebay", config: cfg, destinationCountry: "DE", trackedShipping: true,
    });
    expect(b.actualPostageCost).toBe(8.66);
    expect(b.postageBand).toBe("100-500g");
    expect(b.postageTracked).toBe(true);
  });

  it("counts packaging weight, which can push an order into the next band", () => {
    // 480g of goods is in the 101-500g band, but with 40g of packaging the
    // parcel is 520g and costs a band more. Ignoring that loses €2.04 a time.
    const light = calculateNetProfit({
      salePrice: 20, packageSupplierCost: 5, weightGrams: 400,
      marketplace: "ebay", config: cfg, destinationCountry: "DE",
    });
    const heavy = calculateNetProfit({
      salePrice: 20, packageSupplierCost: 5, weightGrams: 480,
      marketplace: "ebay", config: cfg, destinationCountry: "DE",
    });
    expect(light.actualPostageCost).toBe(6.12);
    expect(heavy.actualPostageCost).toBe(8.16);
  });

  it("raises the price floor by the postage that was previously missed", () => {
    // The floor must now recover the true carrier cost, so it sits above what
    // the old model demanded — this is the correction to every listing price.
    const floor = calculateProfitFloorPrice({
      packageSupplierCost: 5, weightGrams: 200,
      marketplace: "ebay", config: cfg, destinationCountry: "DE",
    });
    const achieved = calculateNetProfit({
      salePrice: floor, packageSupplierCost: 5, weightGrams: 200,
      marketplace: "ebay", config: cfg, destinationCountry: "DE",
    });
    // The floor is defined as the price that exactly hits the target profit.
    expect(achieved.netProfit).toBeCloseTo(cfg.targetMinNetProfit, 1);
    expect(achieved.meetsTarget).toBe(true);
  });

  it("still returns a usable floor for a destination with no tariff row", () => {
    const floor = calculateProfitFloorPrice({
      packageSupplierCost: 5, weightGrams: 200,
      marketplace: "ebay", config: cfg, destinationCountry: "ZZ",
    });
    expect(Number.isFinite(floor)).toBe(true);
    expect(floor).toBeGreaterThan(0);
  });
});

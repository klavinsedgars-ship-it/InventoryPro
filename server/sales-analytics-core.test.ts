import { describe, it, expect } from "vitest";
import {
  profitOf, perDay, summarizeSku, rankCategories, lossMakers,
  type CategorySalesRow, type SkuSalesRow,
} from "./sales-analytics-core";

const sku = (over: Partial<SkuSalesRow> = {}): SkuSalesRow => ({
  sku: "X", title: "X", category: "Sensors",
  units: 10, revenue: 100, cost: 60, orders: 8,
  firstSold: null, lastSold: null, ...over,
});

const cat = (over: Partial<CategorySalesRow> = {}): CategorySalesRow => ({
  category: "Sensors", units: 0, revenue: 0, cost: 0, orders: 0, distinctSkus: 0,
  productsInCatalogue: 0, productsListed: 0, productsListable: 0, ...over,
});

describe("profitOf", () => {
  it("computes profit and margin", () => {
    expect(profitOf(100, 60)).toEqual({ profit: 40, marginPct: 40 });
  });

  it("reports a negative margin rather than hiding it", () => {
    // Prices are recalculated automatically, so a SKU can quietly go
    // underwater; the report exists to surface exactly this.
    expect(profitOf(50, 80)).toEqual({ profit: -30, marginPct: -60 });
  });

  it("returns null margin when there is no revenue to divide by", () => {
    expect(profitOf(0, 0).marginPct).toBeNull();
    expect(profitOf(0, 25)).toEqual({ profit: -25, marginPct: null });
  });
});

describe("perDay", () => {
  it("divides by the window", () => {
    expect(perDay(60, 30)).toBe(2);
  });
  it("never divides by zero", () => {
    expect(perDay(5, 0)).toBe(5);
  });
});

describe("summarizeSku", () => {
  it("adds profit and velocity to a raw row", () => {
    const r = summarizeSku(sku({ units: 30, revenue: 300, cost: 180 }), 30);
    expect(r.profit).toBe(120);
    expect(r.marginPct).toBe(40);
    expect(r.unitsPerDay).toBe(1);
    expect(r.revenuePerDay).toBe(10);
  });
});

describe("rankCategories — where should the ramp go next", () => {
  it("ranks a category with headroom above an equally profitable exhausted one", () => {
    const ranked = rankCategories([
      cat({ category: "Exhausted", revenue: 1000, cost: 400, productsListed: 50, productsListable: 0 }),
      cat({ category: "Headroom", revenue: 1000, cost: 400, productsListed: 50, productsListable: 800 }),
    ], 30);
    expect(ranked[0].category).toBe("Headroom");
  });

  it("scores a category with nothing left to list at zero, however profitable", () => {
    // A sales report would put this first; it is not an opportunity, because
    // there is nothing left to act on.
    const ranked = rankCategories([
      cat({ category: "All listed", revenue: 99999, cost: 1, productsListed: 500, productsListable: 0 }),
    ], 30);
    expect(ranked[0].opportunityScore).toBe(0);
  });

  it("prefers profit earned across FEWER listings", () => {
    // Same profit: the one earning it from 20 listings is the better bet than
    // the one needing 2,000 to do it.
    const ranked = rankCategories([
      cat({ category: "Thin", revenue: 500, cost: 100, productsListed: 2000, productsListable: 500 }),
      cat({ category: "Efficient", revenue: 500, cost: 100, productsListed: 20, productsListable: 500 }),
    ], 30);
    expect(ranked[0].category).toBe("Efficient");
    expect(ranked[0].profitPerListing).toBeGreaterThan(ranked[1].profitPerListing!);
  });

  it("reports null profit-per-listing when nothing is listed yet", () => {
    const [r] = rankCategories([cat({ category: "New", revenue: 0, cost: 0, productsListable: 10 })], 30);
    expect(r.profitPerListing).toBeNull();
  });

  it("handles an empty set without dividing by zero", () => {
    expect(rankCategories([], 30)).toEqual([]);
  });
});

describe("lossMakers", () => {
  it("finds SKUs that sell at or below cost, worst first", () => {
    const rows = [
      summarizeSku(sku({ sku: "OK", revenue: 100, cost: 60 }), 30),
      summarizeSku(sku({ sku: "BAD", revenue: 40, cost: 70 }), 30),
      summarizeSku(sku({ sku: "WORSE", revenue: 20, cost: 90 }), 30),
      summarizeSku(sku({ sku: "BREAKEVEN", revenue: 50, cost: 50 }), 30),
    ];
    expect(lossMakers(rows).map((r) => r.sku)).toEqual(["WORSE", "BAD", "BREAKEVEN"]);
  });

  it("ignores rows with no recorded cost rather than calling them profitable", () => {
    // supplier_cost_at_sale is nullable on older rows; absent cost is unknown
    // profit, not a 100% margin.
    const rows = [summarizeSku(sku({ sku: "NOCOST", revenue: 10, cost: 0 }), 30)];
    expect(lossMakers(rows)).toEqual([]);
  });
});

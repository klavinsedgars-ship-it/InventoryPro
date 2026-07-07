import { describe, it, expect } from "vitest";
import {
  aggregateSoldItems,
  clusterKey,
  searchToken,
  median,
} from "./market-research-core";
import type { MarketSoldItem } from "./ebay-insights-api";

const mk = (o: Partial<MarketSoldItem>): MarketSoldItem => ({
  itemId: o.itemId ?? "x",
  title: o.title ?? "",
  price: o.price ?? null,
  currency: o.currency ?? "EUR",
  soldQuantity: o.soldQuantity ?? 1,
  lastSoldDate: o.lastSoldDate ?? null,
  sellerUsername: o.sellerUsername ?? null,
  country: o.country ?? null,
  categoryPath: o.categoryPath ?? null,
  itemWebUrl: o.itemWebUrl ?? null,
});

describe("clusterKey (groups near-identical listings, word-order-insensitive)", () => {
  it("collapses model-number variants regardless of word order", () => {
    const k = clusterKey("Bosch GLM40 Laser Measure");
    expect(clusterKey("GLM40 Bosch Laser Distance Meter New")).toBe(k);
    expect(clusterKey("Bosch GLM40 Professional")).toBe(k);
  });

  it("clusters brandless products by their significant words", () => {
    const k = clusterKey("Cotton Kitchen Towel Blue");
    expect(clusterKey("Kitchen Towel Cotton Large")).toBe(k);
  });

  it("does not merge genuinely different products", () => {
    expect(clusterKey("Bosch GLM40 Laser")).not.toBe(clusterKey("Makita DHP482 Drill"));
  });
});

describe("searchToken (distinctive token to look up in TME)", () => {
  it("prefers a part-number-like token", () => {
    expect(searchToken("Bosch GLM40 Laser Distance Meter")).toBe("glm40");
  });
  it("falls back to the longest significant word", () => {
    expect(searchToken("Stainless Kitchen Towel")).toBe("stainless");
  });
});

describe("median", () => {
  it("handles odd, even, and empty", () => {
    expect(median([30, 40, 50])).toBe(40);
    expect(median([20, 30])).toBe(25);
    expect(median([])).toBe(0);
  });
});

describe("aggregateSoldItems — clustering + sold maths", () => {
  const clusterA = [
    mk({ title: "Bosch GLM40 Laser Measure", price: 30, soldQuantity: 1, country: "DE" }),
    mk({ title: "GLM40 Bosch Laser Distance Meter", price: 40, soldQuantity: 2, country: "DE" }),
    mk({ title: "Bosch GLM40 Professional", price: 50, soldQuantity: 1, country: "PL" }),
  ];

  it("sums sold quantity across the cluster and computes price stats", () => {
    const { products } = aggregateSoldItems(clusterA, { minSold: 1 });
    expect(products).toHaveLength(1);
    const p = products[0];
    expect(p.soldCount).toBe(4); // 1 + 2 + 1
    expect(p.transactions).toBe(3);
    expect(p.minPrice).toBe(30);
    expect(p.medianPrice).toBe(40);
    expect(p.maxPrice).toBe(50);
    expect(p.gmv).toBe(160); // 30*1 + 40*2 + 50*1
    // Representative title is the longest (most descriptive) in the cluster.
    expect(p.title).toBe("GLM40 Bosch Laser Distance Meter");
  });

  it("drops clusters below minSold", () => {
    const items = [
      ...clusterA, // soldCount 4
      mk({ title: "Solo Random ZZ1 Thing", price: 15, soldQuantity: 1, country: "DE" }),
    ];
    const { products } = aggregateSoldItems(items, { minSold: 2 });
    expect(products).toHaveLength(1);
    expect(products[0].soldCount).toBe(4);
  });

  it("ignores null/zero prices in the stats but still counts the sale", () => {
    const items = [
      mk({ title: "Widget XY99 Gadget", price: null, soldQuantity: 1, country: "DE" }),
      mk({ title: "Widget XY99 Gadget", price: 0, soldQuantity: 1, country: "DE" }),
      mk({ title: "Widget XY99 Gadget", price: 20, soldQuantity: 1, country: "DE" }),
      mk({ title: "Widget XY99 Gadget", price: 30, soldQuantity: 1, country: "DE" }),
    ];
    const { products } = aggregateSoldItems(items, { minSold: 1 });
    expect(products).toHaveLength(1);
    expect(products[0].soldCount).toBe(4);
    expect(products[0].minPrice).toBe(20);
    expect(products[0].medianPrice).toBe(25);
    expect(products[0].maxPrice).toBe(30);
    expect(products[0].gmv).toBe(50);
  });

  it("ranks products by units sold (desc)", () => {
    const items = [
      mk({ title: "Gizmo AB12 Tool", price: 25, soldQuantity: 10, country: "DE" }),
      mk({ title: "Widget XY99 Gadget", price: 25, soldQuantity: 3, country: "DE" }),
    ];
    const { products } = aggregateSoldItems(items, { minSold: 1 });
    expect(products.map((p) => p.soldCount)).toEqual([10, 3]);
  });

  it("returns nothing for empty input", () => {
    expect(aggregateSoldItems([])).toEqual({ keptCount: 0, products: [] });
  });
});

describe("aggregateSoldItems — the 'not Chinese junk' location filter", () => {
  const sameTitle = (country: string | null) =>
    mk({ title: "Widget XY99 Gadget", price: 20, soldQuantity: 1, country });

  it("excludeCn drops CN/HK/MO but KEEPS unknown-country listings", () => {
    const items = [sameTitle("CN"), sameTitle("HK"), sameTitle(null), sameTitle("DE")];
    const { keptCount, products } = aggregateSoldItems(items, { excludeCn: true, minSold: 1 });
    expect(keptCount).toBe(2); // null + DE survive
    expect(products[0].soldCount).toBe(2);
    expect(products[0].cnShare).toBe(0); // no CN/HK left after the filter
  });

  it("keeps everything (incl. CN) when no filter is set", () => {
    const items = [sameTitle("CN"), sameTitle("HK"), sameTitle(null), sameTitle("DE")];
    const { keptCount, products } = aggregateSoldItems(items, { minSold: 1 });
    expect(keptCount).toBe(4);
    expect(products[0].cnShare).toBe(0.5); // 2 of 4 from CN/HK
  });

  it("euOnly keeps only EU/UK sellers, dropping unknown and non-EU", () => {
    const items = [
      sameTitle("DE"),
      sameTitle("GB"),
      sameTitle("US"),
      sameTitle(null),
      sameTitle("CN"),
    ];
    const { keptCount } = aggregateSoldItems(items, { euOnly: true, minSold: 1 });
    expect(keptCount).toBe(2); // DE + GB only
  });

  it("euOnly wins over excludeCn when both are set", () => {
    const items = [sameTitle("DE"), sameTitle(null), sameTitle("US")];
    const { keptCount } = aggregateSoldItems(items, { euOnly: true, excludeCn: true, minSold: 1 });
    expect(keptCount).toBe(1); // only DE (null dropped by euOnly, unlike excludeCn)
  });
});

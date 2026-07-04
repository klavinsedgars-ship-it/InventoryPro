import { describe, it, expect } from "vitest";
import {
  calculateEbayStock,
  validateStockLimit,
  getRecommendedStockLimit,
} from "./stock-manager";
import type { Product } from "@shared/schema";

const p = (o: Partial<Product>): Product => o as unknown as Product;

describe("calculateEbayStock (eBay quantity cap — the oversell guard)", () => {
  it("caps eBay stock at ebayStockLimit when TME stock is higher", () => {
    const r = calculateEbayStock(p({ stock: 100, ebayStockLimit: 2, useStockLimit: true }));
    expect(r.ebayStock).toBe(2);
    expect(r.isLimited).toBe(true);
  });

  it("still caps at 2 for the 70-unit expected-stock incident value", () => {
    // Documents current behavior: the qty cap holds even when TME reports
    // inflated (expected-delivery) stock. The real fix is upstream in
    // extractStock; this locks the cap so a regression can't quietly raise it.
    const r = calculateEbayStock(p({ stock: 70, ebayStockLimit: 2, useStockLimit: true }));
    expect(r.ebayStock).toBe(2);
  });

  it("reports 0 eBay stock when TME stock is 0", () => {
    expect(calculateEbayStock(p({ stock: 0, ebayStockLimit: 2, useStockLimit: true })).ebayStock).toBe(0);
  });

  it("passes through TME stock when it's at or below the limit", () => {
    expect(calculateEbayStock(p({ stock: 1, ebayStockLimit: 2, useStockLimit: true })).ebayStock).toBe(1);
    expect(calculateEbayStock(p({ stock: 2, ebayStockLimit: 2, useStockLimit: true })).ebayStock).toBe(2);
  });

  it("passes through full TME stock when the limit is disabled", () => {
    const r = calculateEbayStock(p({ stock: 100, ebayStockLimit: 2, useStockLimit: false }));
    expect(r.ebayStock).toBe(100);
    expect(r.isLimited).toBe(false);
  });

  it("defaults the limit to 2 when unset", () => {
    expect(calculateEbayStock(p({ stock: 100, useStockLimit: true } as any)).ebayStock).toBe(2);
  });
});

describe("validateStockLimit", () => {
  it("rejects non-positive, non-integer, and >999 limits", () => {
    expect(validateStockLimit(0).valid).toBe(false);
    expect(validateStockLimit(-1).valid).toBe(false);
    expect(validateStockLimit(2.5).valid).toBe(false);
    expect(validateStockLimit(1000).valid).toBe(false);
  });
  it("accepts 1..999", () => {
    expect(validateStockLimit(1).valid).toBe(true);
    expect(validateStockLimit(999).valid).toBe(true);
  });
});

describe("getRecommendedStockLimit", () => {
  it("returns the category limit, falling back to the default", () => {
    expect(getRecommendedStockLimit("Sensors")).toBe(10);
    expect(getRecommendedStockLimit("Something Unknown")).toBe(3);
  });
});

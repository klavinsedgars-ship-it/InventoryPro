import { describe, it, expect } from "vitest";
import {
  emptyRejectionCounts,
  filterIsActive,
  passesIngestFilter,
  type IngestCandidate,
} from "@shared/ingest-filter";

const c = (o: Partial<IngestCandidate> = {}): IngestCandidate => ({
  supplierPrice: 5,
  weightGrams: 20,
  stock: 10,
  imageUrl: "https://example.com/a.jpg",
  ean: "4016032198673",
  ...o,
});

describe("passesIngestFilter", () => {
  it("accepts an ordinary product under an empty filter", () => {
    expect(passesIngestFilter(c(), {})).toEqual({ ok: true });
  });

  it("always rejects a product with no usable price", () => {
    // Without a cost there is nothing to price against; it could never list.
    expect(passesIngestFilter(c({ supplierPrice: null }), {})).toEqual({ ok: false, reason: "noPrice" });
    expect(passesIngestFilter(c({ supplierPrice: 0 }), {})).toEqual({ ok: false, reason: "noPrice" });
    expect(passesIngestFilter(c({ supplierPrice: NaN }), {})).toEqual({ ok: false, reason: "noPrice" });
  });

  it("applies the price band inclusively", () => {
    const f = { minPrice: 2, maxPrice: 10 };
    expect(passesIngestFilter(c({ supplierPrice: 2 }), f).ok).toBe(true);
    expect(passesIngestFilter(c({ supplierPrice: 10 }), f).ok).toBe(true);
    expect(passesIngestFilter(c({ supplierPrice: 1.99 }), f)).toEqual({ ok: false, reason: "priceBelowMin" });
    expect(passesIngestFilter(c({ supplierPrice: 10.01 }), f)).toEqual({ ok: false, reason: "priceAboveMax" });
  });

  it("rejects an unknown weight when a weight cap is set", () => {
    // The pricing model reads a missing weight as zero grams — the cheapest
    // postal band — so "unknown" would silently mean "free to ship", and the
    // products that flatters are the heavy ones that lose money.
    expect(passesIngestFilter(c({ weightGrams: null }), { maxWeightGrams: 500 }))
      .toEqual({ ok: false, reason: "weightUnknown" });
    expect(passesIngestFilter(c({ weightGrams: 0 }), { maxWeightGrams: 500 }))
      .toEqual({ ok: false, reason: "weightUnknown" });
  });

  it("allows an unknown weight when no cap is set", () => {
    // No cap means weight is not being used to decide anything.
    expect(passesIngestFilter(c({ weightGrams: null }), { maxPrice: 50 }).ok).toBe(true);
  });

  it("applies the weight cap inclusively", () => {
    expect(passesIngestFilter(c({ weightGrams: 500 }), { maxWeightGrams: 500 }).ok).toBe(true);
    expect(passesIngestFilter(c({ weightGrams: 501 }), { maxWeightGrams: 500 }))
      .toEqual({ ok: false, reason: "tooHeavy" });
  });

  it("checks stock only when asked", () => {
    expect(passesIngestFilter(c({ stock: 0 }), {}).ok).toBe(true);
    expect(passesIngestFilter(c({ stock: 0 }), { inStockOnly: true }))
      .toEqual({ ok: false, reason: "outOfStock" });
    expect(passesIngestFilter(c({ stock: null }), { inStockOnly: true }))
      .toEqual({ ok: false, reason: "outOfStock" });
  });

  it("checks image and EAN only when asked", () => {
    expect(passesIngestFilter(c({ imageUrl: null, ean: null }), {}).ok).toBe(true);
    expect(passesIngestFilter(c({ imageUrl: "" }), { requireImage: true }))
      .toEqual({ ok: false, reason: "noImage" });
    expect(passesIngestFilter(c({ imageUrl: "   " }), { requireImage: true }))
      .toEqual({ ok: false, reason: "noImage" });
    expect(passesIngestFilter(c({ ean: null }), { requireEan: true }))
      .toEqual({ ok: false, reason: "noEan" });
  });

  it("reports the first failing rule, so a rejection has one cause", () => {
    const bad = c({ supplierPrice: 100, weightGrams: 9000, stock: 0 });
    expect(passesIngestFilter(bad, { maxPrice: 10, maxWeightGrams: 500, inStockOnly: true }))
      .toEqual({ ok: false, reason: "priceAboveMax" });
  });
});

describe("filterIsActive", () => {
  it("knows when nothing is being filtered", () => {
    expect(filterIsActive({})).toBe(false);
    expect(filterIsActive({ minPrice: null, maxWeightGrams: null })).toBe(false);
  });

  it("notices any single restriction", () => {
    expect(filterIsActive({ maxWeightGrams: 500 })).toBe(true);
    expect(filterIsActive({ inStockOnly: true })).toBe(true);
    expect(filterIsActive({ minPrice: 0 })).toBe(true);
  });
});

describe("emptyRejectionCounts", () => {
  it("starts every reason at zero, so a report never omits one", () => {
    const counts = emptyRejectionCounts();
    expect(counts.tooHeavy).toBe(0);
    expect(counts.weightUnknown).toBe(0);
    expect(Object.values(counts).every((v) => v === 0)).toBe(true);
  });
});

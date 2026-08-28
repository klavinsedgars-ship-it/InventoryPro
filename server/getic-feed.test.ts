import { describe, it, expect } from "vitest";
import {
  mapGeticRecord,
  parseFeedNumber,
  parseFeedStock,
  parseFeedWeight,
  coverageOf,
} from "./getic-feed";

describe("parseFeedNumber", () => {
  it("handles EU and US decimal conventions", () => {
    expect(parseFeedNumber("12.34")).toBe(12.34);
    expect(parseFeedNumber("12,34")).toBe(12.34);
    expect(parseFeedNumber("1 234,56")).toBe(1234.56);
    expect(parseFeedNumber("1,234.56")).toBe(1234.56);
    expect(parseFeedNumber("1.234,56")).toBe(1234.56);
    expect(parseFeedNumber("1,234")).toBe(1234); // comma-thousands
    expect(parseFeedNumber("€12.30")).toBe(12.3);
    expect(parseFeedNumber("")).toBeNull();
    expect(parseFeedNumber("n/a")).toBeNull();
  });
});

describe("parseFeedStock", () => {
  it("parses numbers, bounds and availability text", () => {
    expect(parseFeedStock("5")).toBe(5);
    expect(parseFeedStock(">10")).toBe(10);
    expect(parseFeedStock("10+")).toBe(10);
    expect(parseFeedStock("yes")).toBeNull(); // available, qty unknown
    expect(parseFeedStock("")).toBeNull();
  });
});

describe("parseFeedWeight", () => {
  it("takes the unit from the key or the value", () => {
    expect(parseFeedWeight("weight_g", "250")).toEqual({ grams: 250, assumed: false });
    expect(parseFeedWeight("weight_kg", "1.5")).toEqual({ grams: 1500, assumed: false });
    expect(parseFeedWeight("weight", "0.75 kg")).toEqual({ grams: 750, assumed: false });
    expect(parseFeedWeight("weight", "250 g")).toEqual({ grams: 250, assumed: false });
  });
  it("assumes kilograms for bare numbers and never applies thousands grouping", () => {
    expect(parseFeedWeight("weight", "1.234")).toEqual({ grams: 1234, assumed: true });
    expect(parseFeedWeight("weight", "2")).toEqual({ grams: 2000, assumed: true });
  });
});

describe("mapGeticRecord", () => {
  it("maps a flat shop-style record", () => {
    const offer = mapGeticRecord({
      id: "12345",
      name: "USB-C Cable 1m",
      ean: "4750123456789",
      manufacturer: "Acme",
      price: "3,49",
      currency: "EUR",
      quantity: "17",
      weight: "0.05",
      image: "https://cdn.example.com/1.jpg",
      url: "https://getic.com/p/12345",
      category: "Cables",
    });
    expect(offer.supplierSku).toBe("12345");
    expect(offer.name).toBe("USB-C Cable 1m");
    expect(offer.ean).toBe("4750123456789");
    expect(offer.manufacturer).toBe("Acme");
    expect(offer.price).toBe(3.49);
    expect(offer.currency).toBe("EUR");
    expect(offer.stock).toBe(17);
    expect(offer.weightG).toBe(50);
    expect(offer.imageUrl).toBe("https://cdn.example.com/1.jpg");
    expect(offer.productUrl).toBe("https://getic.com/p/12345");
    expect(offer.categoryPath).toBe("Cables");
    expect(offer.sourceKeys.sku).toBe("id");
    expect(offer.sourceKeys.weight).toContain("assumed kg");
  });

  it("prefers an explicit SKU over a generic id, and net price over gross", () => {
    const offer = mapGeticRecord({
      id: "999",
      sku: "AB-123",
      price: "10,00",
      price_vat: "12,10",
    });
    expect(offer.supplierSku).toBe("AB-123");
    expect(offer.price).toBe(10);
    expect(offer.sourceKeys.price).toBe("price");
    // The unconsumed id stays visible in attributes.
    expect(offer.attributes.id).toBe("999");
  });

  it("falls back to a gross price and says so", () => {
    const offer = mapGeticRecord({ code: "X1", price_vat: "12,10" });
    expect(offer.price).toBe(12.1);
    expect(offer.sourceKeys.price).toContain("fallback");
  });

  it("collects nested and repeated images, first one primary", () => {
    const offer = mapGeticRecord({
      code: "X1",
      images: { image: ["https://a/1.jpg", "https://a/2.jpg", "https://a/2.jpg"] },
    });
    expect(offer.imageUrl).toBe("https://a/1.jpg");
    expect(offer.additionalImages).toEqual(["https://a/2.jpg"]);
  });

  it("joins multi-valued categories into a path", () => {
    const offer = mapGeticRecord({ code: "X1", category: ["Electronics", "Cables"] });
    expect(offer.categoryPath).toBe("Electronics > Cables");
  });

  it("keeps unmapped fields verbatim in attributes", () => {
    const offer = mapGeticRecord({ code: "X1", warranty_months: "24", color: "black" });
    expect(offer.attributes.warranty_months).toBe("24");
    expect(offer.attributes.color).toBe("black");
  });

  it("keeps the raw value of lossy parses in attributes", () => {
    const offer = mapGeticRecord({ code: "X1", stock: "yes", weight: "0.5 kg" });
    expect(offer.stock).toBeNull();
    expect(offer.attributes.stock).toBe("yes");
    expect(offer.attributes.weight).toBe("0.5 kg");
  });

  it("returns null SKU when nothing identifies the record", () => {
    const offer = mapGeticRecord({ name: "mystery item" });
    expect(offer.supplierSku).toBeNull();
  });

  it("upper-cases SKUs to match blocklist/product-code conventions", () => {
    expect(mapGeticRecord({ code: "ab-12c" }).supplierSku).toBe("AB-12C");
  });
});

describe("coverageOf", () => {
  it("counts non-null fields", () => {
    const a = mapGeticRecord({ code: "A", price: "1,00", quantity: "3", image: "https://a/1.jpg" });
    const b = mapGeticRecord({ code: "B", name: "thing" });
    const c = coverageOf([a, b]);
    expect(c.sku).toBe(2);
    expect(c.name).toBe(1);
    expect(c.price).toBe(1);
    expect(c.stockPositive).toBe(1);
    expect(c.image).toBe(1);
    expect(c.ean).toBe(0);
  });
});

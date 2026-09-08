import { describe, it, expect } from "vitest";
import {
  isValidBarcode,
  preflightAmazon,
  amazonSellerSku,
  buildOfferOnlyListing,
  buildOfferPatches,
  pickAsinForBarcode,
} from "./amazon-listing";
import type { Product } from "@shared/schema";

const baseProduct = {
  id: 1,
  sku: "GC-1234",
  name: "Green Cell UPS 600VA",
  ean: "5903317225539",
  amazonAsin: "B07XYZ1234",
  salePrice: "49.99",
  stock: 5,
  status: "active",
  excludeFromListing: false,
  ebayStockLimit: 2,
  useStockLimit: true,
  moq: 1,
  multiples: 1,
} as unknown as Product;

describe("isValidBarcode", () => {
  it("accepts EAN-8, UPC-12, EAN-13 and GTIN-14", () => {
    expect(isValidBarcode("12345678")).toBe(true);
    expect(isValidBarcode("012345678905")).toBe(true);
    expect(isValidBarcode("5903317225539")).toBe(true);
    expect(isValidBarcode("05903317225539")).toBe(true);
  });

  it("rejects empty, short, and non-numeric codes", () => {
    expect(isValidBarcode(null)).toBe(false);
    expect(isValidBarcode("")).toBe(false);
    expect(isValidBarcode("1234567")).toBe(false);
    expect(isValidBarcode("ABC1234567890")).toBe(false);
  });
});

describe("preflightAmazon", () => {
  it("passes a fully prepared product", () => {
    const r = preflightAmazon(baseProduct);
    expect(r.ok).toBe(true);
    expect(r.reasons).toEqual([]);
  });

  it("blocks permanently when there is no usable barcode", () => {
    const r = preflightAmazon({ ...baseProduct, ean: null } as any);
    expect(r.ok).toBe(false);
    expect(r.reasons.join(" ")).toContain("no valid EAN");
    expect(r.transient).toBe(false); // never fixes itself
  });

  it("blocks transiently when the ASIN has not been matched yet", () => {
    const r = preflightAmazon({ ...baseProduct, amazonAsin: null } as any);
    expect(r.ok).toBe(false);
    expect(r.transient).toBe(true);
    expect(r.reasons.join(" ")).toContain("no ASIN matched");
  });

  it("blocks transiently on zero sellable stock", () => {
    const r = preflightAmazon({ ...baseProduct, stock: 0 } as any);
    expect(r.ok).toBe(false);
    expect(r.transient).toBe(true);
    expect(r.reasons.join(" ")).toContain("no sellable stock");
  });

  it("respects the operator's exclusion flag", () => {
    const r = preflightAmazon({ ...baseProduct, excludeFromListing: true } as any);
    expect(r.ok).toBe(false);
    expect(r.reasons[0]).toContain("excluded from listing");
  });

  it("reports every blocking reason at once, not just the first", () => {
    const r = preflightAmazon({ ...baseProduct, ean: null, amazonAsin: null, salePrice: "0" } as any);
    expect(r.reasons.length).toBeGreaterThanOrEqual(3);
  });
});

describe("amazonSellerSku", () => {
  it("reuses the product SKU so orders map back with no lookup table", () => {
    expect(amazonSellerSku({ sku: "GC-1234" })).toBe("GC-1234");
  });

  it("caps at Amazon's 40-character limit", () => {
    const long = "X".repeat(60);
    expect(amazonSellerSku({ sku: long })).toHaveLength(40);
  });
});

describe("buildOfferOnlyListing", () => {
  const input = { product: baseProduct, marketplaceId: "A1PA6795UKMFR9", currency: "EUR" };

  it("attaches the offer to the matched ASIN", () => {
    const l = buildOfferOnlyListing(input);
    expect(l.requirements).toBe("LISTING_OFFER_ONLY");
    expect((l.attributes.merchant_suggested_asin as any)[0].value).toBe("B07XYZ1234");
  });

  it("publishes the sale price in the marketplace currency", () => {
    const l = buildOfferOnlyListing(input);
    const offer = (l.attributes.purchasable_offer as any)[0];
    expect(offer.currency).toBe("EUR");
    expect(offer.our_price[0].schedule[0].value_with_tax).toBe(49.99);
  });

  it("caps quantity by the same stock policy as eBay", () => {
    const l = buildOfferOnlyListing(input);
    // stock 5, ebayStockLimit 2, useStockLimit true -> 2
    expect((l.attributes.fulfillment_availability as any)[0].quantity).toBe(2);
    expect((l.attributes.fulfillment_availability as any)[0].fulfillment_channel_code).toBe("DEFAULT");
  });

  it("omits the shipping template unless one is configured", () => {
    expect(buildOfferOnlyListing(input).attributes.merchant_shipping_group).toBeUndefined();
    const withGroup = buildOfferOnlyListing({ ...input, shippingGroup: "std-eu" });
    expect((withGroup.attributes.merchant_shipping_group as any)[0].value).toBe("std-eu");
  });

  it("refuses to build a payload without an ASIN", () => {
    expect(() => buildOfferOnlyListing({ ...input, product: { ...baseProduct, amazonAsin: null } as any }))
      .toThrow(/no ASIN/);
  });
});

describe("buildOfferPatches", () => {
  it("emits only the fields that changed", () => {
    const priceOnly = buildOfferPatches({ marketplaceId: "M", currency: "EUR", price: 12.5 });
    expect(priceOnly).toHaveLength(1);
    expect(priceOnly[0].path).toBe("/attributes/purchasable_offer");

    const both = buildOfferPatches({ marketplaceId: "M", currency: "EUR", price: 12.5, quantity: 3 });
    expect(both).toHaveLength(2);
    expect(buildOfferPatches({ marketplaceId: "M", currency: "EUR" })).toEqual([]);
  });

  it("floors quantity and never sends a negative", () => {
    const p = buildOfferPatches({ marketplaceId: "M", currency: "EUR", quantity: -4 });
    expect((p[0].value as any)[0].quantity).toBe(0);
  });
});

describe("pickAsinForBarcode", () => {
  const withIds = (asin: string, ean: string) => ({
    asin,
    identifiers: [{ marketplaceId: "A1PA6795UKMFR9", identifiers: [{ identifierType: "EAN", identifier: ean }] }],
    summaries: [{ itemName: `Item ${asin}`, brand: "Green Cell" }],
  });

  it("prefers the ASIN whose own identifiers echo the barcode searched for", () => {
    const res = { items: [withIds("BWRONG", "9999999999999"), withIds("BRIGHT", "5903317225539")] };
    expect(pickAsinForBarcode(res, "5903317225539")?.asin).toBe("BRIGHT");
  });

  it("accepts a lone result even when identifiers are absent", () => {
    const res = { items: [{ asin: "BONLY", summaries: [{ itemName: "Only match" }] }] };
    expect(pickAsinForBarcode(res, "5903317225539")?.asin).toBe("BONLY");
  });

  it("refuses to guess between several non-matching ASINs", () => {
    const res = { items: [{ asin: "B1" }, { asin: "B2" }] };
    expect(pickAsinForBarcode(res, "5903317225539")).toBeNull();
  });

  it("returns null for an empty catalogue response", () => {
    expect(pickAsinForBarcode({ items: [] }, "5903317225539")).toBeNull();
    expect(pickAsinForBarcode({}, "5903317225539")).toBeNull();
  });
});

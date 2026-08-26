import { describe, it, expect, afterEach } from "vitest";
import { normalizeEan, noIdentifierValue, eanForListing, identifiersForListing } from "./ebay-identifiers";

const originalSite = process.env.EBAY_MARKETPLACE_SITE_ID;
afterEach(() => {
  if (originalSite === undefined) delete process.env.EBAY_MARKETPLACE_SITE_ID;
  else process.env.EBAY_MARKETPLACE_SITE_ID = originalSite;
});

describe("normalizeEan", () => {
  it("accepts a valid EAN-13 and strips separators", () => {
    expect(normalizeEan("4006381333931")).toBe("4006381333931");
    expect(normalizeEan("4-006381-333931")).toBe("4006381333931");
  });

  it("accepts a valid EAN-8", () => {
    expect(normalizeEan("96385074")).toBe("96385074");
  });

  it("rejects a wrong check digit rather than forwarding it", () => {
    // eBay validates the check digit and fails the publish, so a bad value
    // must degrade to "no EAN" instead of trading one rejection for another.
    expect(normalizeEan("4006381333932")).toBeNull();
  });

  it("rejects wrong lengths, empty values, and all-zero placeholders", () => {
    expect(normalizeEan("12345")).toBeNull();
    expect(normalizeEan("")).toBeNull();
    expect(normalizeEan(null)).toBeNull();
    expect(normalizeEan(undefined)).toBeNull();
    expect(normalizeEan("0000000000000")).toBeNull();
  });
});

describe("noIdentifierValue — localised per marketplace", () => {
  it("uses the marketplace's own wording", () => {
    expect(noIdentifierValue("77")).toBe("Nicht zutreffend");
    expect(noIdentifierValue("3")).toBe("Does not apply");
    expect(noIdentifierValue("71")).toBe("Non applicable");
  });

  it("defaults to the German marketplace, matching marketplaceId()", () => {
    delete process.env.EBAY_MARKETPLACE_SITE_ID;
    expect(noIdentifierValue()).toBe("Nicht zutreffend");
  });
});

describe("eanForListing", () => {
  it("sends the real GTIN when the supplier has one", () => {
    expect(eanForListing("4006381333931", "77")).toEqual(["4006381333931"]);
  });

  it("declares 'no identifier' instead of omitting the field", () => {
    // The regression: TME returns "ean": "" for many parts. Sending nothing
    // made eBay reject every publish with 25002 "Das Feld EAN fehlt" — the
    // offer was created, then rejected at the final step.
    expect(eanForListing("", "77")).toEqual(["Nicht zutreffend"]);
    expect(eanForListing(null, "77")).toEqual(["Nicht zutreffend"]);
  });

  it("never returns an empty array", () => {
    for (const raw of ["", null, undefined, "bad", "4006381333932"]) {
      expect(eanForListing(raw, "77")).toHaveLength(1);
    }
  });
});

describe("identifiersForListing — every field a category might demand", () => {
  it("declares all three, so an ISBN-requiring category cannot reject the publish", () => {
    // Regression: EAN alone still failed with "Das Feld ISBN fehlt" for
    // products whose category resolution landed in a media category.
    expect(identifiersForListing(null, "77")).toEqual({
      ean: ["Nicht zutreffend"],
      upc: ["Nicht zutreffend"],
      isbn: ["Nicht zutreffend"],
    });
  });

  it("routes a 13-digit GTIN to EAN and a 12-digit one to UPC", () => {
    expect(identifiersForListing("4006381333931", "77").ean).toEqual(["4006381333931"]);
    expect(identifiersForListing("4006381333931", "77").upc).toEqual(["Nicht zutreffend"]);
    // 12-digit UPC-A with a valid check digit.
    const upc = identifiersForListing("012345678905", "77");
    expect(upc.upc).toEqual(["012345678905"]);
    expect(upc.ean).toEqual(["Nicht zutreffend"]);
  });

  it("follows the marketplace language", () => {
    expect(identifiersForListing(null, "3").isbn).toEqual(["Does not apply"]);
  });
});

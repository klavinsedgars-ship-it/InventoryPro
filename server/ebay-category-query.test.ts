import { describe, it, expect } from "vitest";
import { categoryQueryFor, isTransientTaxonomyStatus, pickDefaultCategory, scoreCategoryGenerality } from "./ebay-category-query";

const p = (category: string, name: string) => ({ category, name }) as any;

describe("categoryQueryFor — the query IS the cache key", () => {
  it("asks by supplier category, so products in one category share a lookup", () => {
    // The regression: including the product name made every query unique, so
    // the Taxonomy cache never hit and the ramp made one call per product.
    const a = categoryQueryFor(p("Resistors > SMD", "RC0402FR-0710KL 10k 1% 0402"));
    const b = categoryQueryFor(p("Resistors > SMD", "RC0603FR-071KL 1k 1% 0603"));
    expect(a).toBe(b);
    expect(a).toBe("Resistors > SMD");
  });

  it("falls back to the product name when the category carries no signal", () => {
    // "Electronics" would map the entire catalogue to one arbitrary category.
    for (const generic of ["Electronics", "other", "Uncategorized", "general", ""]) {
      const q = categoryQueryFor(p(generic, "DHT22 temperature sensor"));
      expect(q).toContain("DHT22");
    }
  });

  it("never exceeds the Taxonomy query length limit", () => {
    const long = categoryQueryFor(p("x".repeat(200), "y".repeat(200)));
    expect(long.length).toBeLessThanOrEqual(80);
  });

  it("tolerates missing fields", () => {
    expect(() => categoryQueryFor({ category: null, name: null } as any)).not.toThrow();
  });
});

describe("isTransientTaxonomyStatus", () => {
  it("treats throttling and eBay-side errors as retryable", () => {
    // These must never be recorded as "this product has no category" — that is
    // what burned an attempt per product per tick and parked the catalogue.
    for (const s of [429, 408, 500, 502, 503, 504]) {
      expect(isTransientTaxonomyStatus(s)).toBe(true);
    }
  });

  it("treats a genuine client error as a real answer", () => {
    for (const s of [400, 401, 403, 404]) {
      expect(isTransientTaxonomyStatus(s)).toBe(false);
    }
  });
});

describe("scoreCategoryGenerality", () => {
  it("scores a specific product category as unusable for a fallback", () => {
    expect(scoreCategoryGenerality("Druckschalter")).toBe(0);
    expect(scoreCategoryGenerality("Widerstände")).toBe(0);
    expect(scoreCategoryGenerality("Platinen & Entwicklungskits")).toBe(0);
  });

  it("ranks a broad catch-all above a narrow one", () => {
    const broad = scoreCategoryGenerality("Sonstige Elektronik & Messtechnik");
    const narrow = scoreCategoryGenerality("Sonstiges Automations Equipment");
    const bare = scoreCategoryGenerality("Sonstige");
    expect(broad).toBeGreaterThan(narrow);
    expect(narrow).toBeGreaterThan(bare);
    expect(bare).toBeGreaterThan(0);
  });

  it("recognises catch-all wording on the other marketplaces we list on", () => {
    for (const n of ["Other Electronic Components", "Autres composants", "Altri componenti", "Otros"]) {
      expect(scoreCategoryGenerality(n)).toBeGreaterThan(0);
    }
  });
});

describe("pickDefaultCategory — generality first, frequency only as tie-break", () => {
  // The real distribution from the live account (tree 77, 2000 cached
  // suggestions). Ranking by frequency picked "Druckschalter" — pushbutton
  // switches — as the home for every unclassifiable product.
  const LIVE = [
    { id: "111607", name: "Druckschalter", count: 327 },
    { id: "36802", name: "Sonstiges Automations Equipment", count: 255 },
    { id: "159680", name: "Eingebettete Prozessoren & Steuerungen", count: 185 },
    { id: "65507", name: "Platinen & Entwicklungskits", count: 156 },
    { id: "25414", name: "Sonstige Messteile & Zubehör", count: 135 },
    { id: "57520", name: "Sonstige Sensoren", count: 102 },
    { id: "92078", name: "Sonstige Elektronik & Messtechnik", count: 98 },
    { id: "9715", name: "Sonstige", count: 94 },
    { id: "42886", name: "Anschlussdosen & Gehäuse", count: 53 },
    { id: "181912", name: "Widerstände", count: 49 },
  ];
  const expand = (rows: typeof LIVE) =>
    rows.flatMap((r) => Array.from({ length: r.count }, () => ({ id: r.id, name: r.name })));

  it("picks the broad electronics catch-all, not the most frequent category", () => {
    const picked = pickDefaultCategory(expand(LIVE));
    expect(picked?.id).toBe("92078");
    expect(picked?.name).toBe("Sonstige Elektronik & Messtechnik");
    // Chosen despite being only the 7th most common.
    expect(picked?.count).toBe(98);
  });

  it("never picks a specific category even when it dominates", () => {
    const picked = pickDefaultCategory(
      expand([{ id: "111607", name: "Druckschalter", count: 999 }, { id: "9715", name: "Sonstige", count: 5 }]),
    );
    expect(picked?.id).toBe("9715");
  });

  it("returns null when nothing in the evidence is a catch-all", () => {
    // Better to retry the product next tick than to file it under switches.
    expect(pickDefaultCategory(expand([{ id: "111607", name: "Druckschalter", count: 500 }]))).toBeNull();
  });

  it("ignores a catch-all seen too few times to corroborate", () => {
    const picked = pickDefaultCategory(
      expand([{ id: "111607", name: "Druckschalter", count: 50 }, { id: "92078", name: "Sonstige Elektronik", count: 2 }]),
    );
    expect(picked).toBeNull();
  });

  it("still requires a minimum sample, and tolerates malformed rows", () => {
    expect(pickDefaultCategory([{ id: "9715", name: "Sonstige" }])).toBeNull();
    expect(() => pickDefaultCategory([null, undefined, {}, { id: "" }])).not.toThrow();
  });

  it("breaks ties deterministically so the default doesn't flap", () => {
    const rows = [{ id: "999", name: "Sonstige Elektronik", count: 10 }, { id: "111", name: "Sonstige Elektronik", count: 10 }];
    const a = pickDefaultCategory(expand(rows));
    const b = pickDefaultCategory(expand([...rows].reverse()));
    expect(a?.id).toBe(b?.id);
  });
});

import { describe, it, expect } from "vitest";
import { categoryQueryFor, isTransientTaxonomyStatus, pickDefaultCategory } from "./ebay-category-query";

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

describe("pickDefaultCategory — learned, not hardcoded", () => {
  const many = (id: string, n: number, name = "") => Array.from({ length: n }, () => ({ id, name }));

  it("picks the category eBay has most often returned for this marketplace", () => {
    // Correct by construction: every candidate is an answer eBay gave for THIS
    // tree, so it cannot be an id borrowed from another site's category tree.
    const picked = pickDefaultCategory([
      ...many("4662", 7, "Elektronische Bauteile"),
      ...many("58277", 2),
      ...many("181939", 1),
    ]);
    expect(picked?.id).toBe("4662");
    expect(picked?.name).toBe("Elektronische Bauteile");
    expect(picked?.count).toBe(7);
    expect(picked?.sample).toBe(10);
    expect(picked?.share).toBeCloseTo(0.7);
  });

  it("returns null until there is enough evidence", () => {
    // No fallback beats one fixed on a fluke: the ramp simply retries later.
    expect(pickDefaultCategory(many("4662", 3))).toBeNull();
    expect(pickDefaultCategory([])).toBeNull();
  });

  it("ignores malformed and empty entries", () => {
    const picked = pickDefaultCategory([
      ...many("4662", 6),
      null,
      undefined,
      {},
      { id: "" },
    ]);
    expect(picked?.id).toBe("4662");
    expect(picked?.sample).toBe(6); // only real ids counted
  });

  it("breaks ties deterministically, so the default doesn't flap", () => {
    const a = pickDefaultCategory([...many("999", 3), ...many("111", 3)]);
    const b = pickDefaultCategory([...many("111", 3), ...many("999", 3)]);
    expect(a?.id).toBe(b?.id);
  });
});

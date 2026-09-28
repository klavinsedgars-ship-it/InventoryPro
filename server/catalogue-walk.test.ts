import { describe, it, expect } from "vitest";
import {
  MAX_CONSECUTIVE_FAILURES,
  isSupplierRefusal,
  nextCursor,
  shouldPauseSweep,
  sweepFinished,
} from "@shared/catalogue-walk";

describe("nextCursor", () => {
  it("walks pages inside a category", () => {
    expect(nextCursor({ categoryIndex: 3, page: 1 }, 5)).toEqual({ categoryIndex: 3, page: 2 });
  });

  it("moves to the next category off the last page", () => {
    expect(nextCursor({ categoryIndex: 3, page: 5 }, 5)).toEqual({ categoryIndex: 4, page: 1 });
  });

  it("treats a missing or nonsense page count as a single page", () => {
    expect(nextCursor({ categoryIndex: 0, page: 1 }, 0)).toEqual({ categoryIndex: 1, page: 1 });
    expect(nextCursor({ categoryIndex: 0, page: 1 }, Number.NaN)).toEqual({ categoryIndex: 1, page: 1 });
  });

  it("never goes backwards when the cursor is past the end of a category", () => {
    expect(nextCursor({ categoryIndex: 2, page: 9 }, 3)).toEqual({ categoryIndex: 3, page: 1 });
  });
});

describe("shouldPauseSweep", () => {
  it("skips the odd broken category", () => {
    expect(shouldPauseSweep(1)).toBe(false);
    expect(shouldPauseSweep(MAX_CONSECUTIVE_FAILURES - 1)).toBe(false);
  });

  it("pauses once the failures are clearly not about the categories", () => {
    expect(shouldPauseSweep(MAX_CONSECUTIVE_FAILURES)).toBe(true);
    expect(shouldPauseSweep(50)).toBe(true);
  });
});

describe("isSupplierRefusal", () => {
  it("recognises the statuses that mean stop sending", () => {
    expect(isSupplierRefusal("TME v2 /products/search failed: 429 Too Many Requests")).toBe(true);
    expect(isSupplierRefusal("TME v2 /products/search failed: 403 Forbidden")).toBe(true);
    expect(isSupplierRefusal("TME v2 auth failed: 401 invalid_client")).toBe(true);
  });

  it("leaves ordinary category trouble to the consecutive-failure rule", () => {
    expect(isSupplierRefusal("TME v2 /products/search failed: 500 upstream error")).toBe(false);
    expect(isSupplierRefusal("socket hang up")).toBe(false);
  });

  it("does not read a category id as a status code", () => {
    // Ids like 100429 must not look like a 429.
    expect(isSupplierRefusal("category 100429 page 3: socket hang up")).toBe(false);
  });
});

describe("sweepFinished", () => {
  it("is finished after walking every category", () => {
    expect(sweepFinished({ blocked: false, categoryIndex: 120, categoriesTotal: 120 })).toBe(true);
  });

  it("is not finished mid-walk", () => {
    expect(sweepFinished({ blocked: false, categoryIndex: 3, categoriesTotal: 120 })).toBe(false);
  });

  it("is NOT finished when it gave up because TME stopped answering", () => {
    // The regression this protects: a refusing supplier used to walk the
    // whole list one failure at a time, then disable the sweep as complete.
    expect(sweepFinished({ blocked: true, categoryIndex: 120, categoriesTotal: 120 })).toBe(false);
  });

  it("is NOT finished when there were no categories to walk", () => {
    // An empty list means the tree failed to load, not that the work is done.
    expect(sweepFinished({ blocked: false, categoryIndex: 0, categoriesTotal: 0 })).toBe(false);
  });
});

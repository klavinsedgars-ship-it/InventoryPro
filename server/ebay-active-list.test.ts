import { describe, it, expect } from "vitest";
import {
  ACTIVE_LIST_CEILING,
  activeListLooksTruncated,
  canClearMissingFlags,
} from "@shared/ebay-active-list";

describe("activeListLooksTruncated", () => {
  it("recognises the ceiling", () => {
    expect(activeListLooksTruncated(ACTIVE_LIST_CEILING)).toBe(true);
    expect(activeListLooksTruncated(ACTIVE_LIST_CEILING + 1)).toBe(true);
  });

  it("leaves a real, smaller total alone", () => {
    expect(activeListLooksTruncated(24_999)).toBe(false);
    expect(activeListLooksTruncated(0)).toBe(false);
  });

  it("does not throw on nonsense", () => {
    expect(activeListLooksTruncated(Number.NaN)).toBe(false);
  });
});

describe("canClearMissingFlags", () => {
  const complete = { apply: true, fetchedAllPages: true, activeOnEbay: 12_000 };

  it("allows a complete walk of an uncapped list to clear flags", () => {
    expect(canClearMissingFlags(complete).allowed).toBe(true);
  });

  it("never clears on a dry run", () => {
    expect(canClearMissingFlags({ ...complete, apply: false }).allowed).toBe(false);
  });

  it("never clears on a partial walk", () => {
    expect(canClearMissingFlags({ ...complete, fetchedAllPages: false }).allowed).toBe(false);
  });

  it("never clears when eBay stopped counting", () => {
    // The regression this exists for: an account with 169,244 live listings
    // whose active-list call answered 25,000. Clearing on that answer would
    // have unlisted 144,244 products that are live right now.
    const d = canClearMissingFlags({ ...complete, activeOnEbay: 25_000 });
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/ceiling/i);
  });

  it("explains itself whenever it refuses", () => {
    for (const opts of [
      { ...complete, apply: false },
      { ...complete, fetchedAllPages: false },
      { ...complete, activeOnEbay: 30_000 },
    ]) {
      const d = canClearMissingFlags(opts);
      expect(d.allowed).toBe(false);
      expect(d.reason.length).toBeGreaterThan(10);
    }
  });
});

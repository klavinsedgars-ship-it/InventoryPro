import { describe, it, expect } from "vitest";
import { parseProductCodes, normalizeCode } from "@shared/product-codes";

describe("normalizeCode", () => {
  it("upper-cases and trims, so matching is case-insensitive", () => {
    expect(normalizeCode(" df-dfr0077 ")).toBe("DF-DFR0077");
  });

  it("strips quotes and trailing separators a paste leaves behind", () => {
    expect(normalizeCode('"DF-DFR0077",')).toBe("DF-DFR0077");
    expect(normalizeCode("'OKY3061';")).toBe("OKY3061");
  });
});

describe("parseProductCodes", () => {
  it("accepts one code per line, the usual paste from an email", () => {
    expect(parseProductCodes("DF-DFR0077\nOKY3061\nSF-GPS-14030").codes)
      .toEqual(["DF-DFR0077", "OKY3061", "SF-GPS-14030"]);
  });

  it("accepts commas, semicolons and tabs too", () => {
    expect(parseProductCodes("A1, B2; C3\tD4").codes).toEqual(["A1", "B2", "C3", "D4"]);
  });

  it("removes duplicates and counts them", () => {
    const r = parseProductCodes("A1\na1\nA1\nB2");
    expect(r.codes).toEqual(["A1", "B2"]);
    expect(r.duplicates).toBe(2);
  });

  it("rejects text that is plainly not a code, rather than blocking it", () => {
    // Pasting a whole email line must not create a block on a sentence.
    const r = parseProductCodes("DF-DFR0077\nYour listing was removed because it violated");
    expect(r.codes).toEqual(["DF-DFR0077"]);
    expect(r.rejected.length).toBe(1);
  });

  it("ignores blank lines and stray whitespace", () => {
    expect(parseProductCodes("\n\n  A1  \n\n\n B2 \n").codes).toEqual(["A1", "B2"]);
  });

  it("caps a runaway paste", () => {
    const many = Array.from({ length: 6000 }, (_, i) => `SKU${i}`).join("\n");
    expect(parseProductCodes(many, { max: 100 }).codes).toHaveLength(100);
  });

  it("handles empty input without throwing", () => {
    expect(parseProductCodes("").codes).toEqual([]);
    expect(parseProductCodes(null as any).codes).toEqual([]);
  });
});

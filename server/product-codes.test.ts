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

describe("parseProductCodes — pasting a marketplace removal email", () => {
  // Verbatim from eBay's removal notice, which is what the operator has to
  // hand. Splitting these on separators yields prose fragments and blocks
  // nothing, leaving 28 codes to be retyped by hand.
  const EMAIL = `Item: 298622261187 10x Needle: steel; 1"; Size: 18; straight; Mounting: Luer - 918100-TE | EU Stock
Reference ID: 2-108150915418

Item: 307150129072 10x Needle: steel; 0.25"; Size: 23; straight; 0.33mm; - FIS-23-1/4-ES | EU Stock
Reference ID: 2-108150865402

Item: 298622261191 10x Needle: steel; 0.5"; Size: 30; bent at 45°; 0.15mm; p - FIS-30K45 | EU Stock
Reference ID: 2-108150805197`;

  it("pulls the supplier code out of each removal line", () => {
    const r = parseProductCodes(EMAIL);
    expect(r.codes).toEqual(["918100-TE", "FIS-23-1/4-ES", "FIS-30K45"]);
  });

  it("keeps codes containing slashes, which fractional sizes produce", () => {
    expect(parseProductCodes(`x - FIS-22-1/2-ES | EU Stock`).codes).toEqual(["FIS-22-1/2-ES"]);
  });

  it("does not turn the eBay item number or reference id into a block", () => {
    const r = parseProductCodes(EMAIL);
    expect(r.codes).not.toContain("298622261187");
    expect(r.codes.some((c) => c.startsWith("2-1081"))).toBe(false);
  });

  it("still accepts a plain list, so both paste styles work", () => {
    expect(parseProductCodes("918100-TE\nFIS-30K45").codes).toEqual(["918100-TE", "FIS-30K45"]);
  });

  it("handles a mixed paste of email lines and bare codes", () => {
    const r = parseProductCodes(`Item: 1 thing - 920100-TE | EU Stock\n914100-TE`);
    expect(r.codes).toEqual(["920100-TE", "914100-TE"]);
  });
});

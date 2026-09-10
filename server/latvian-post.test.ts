import { describe, it, expect } from "vitest";
import { quotePostage, TRACKING_FEE } from "@shared/latvian-post";

/**
 * Verification against real Latvijas Pasts counter receipts (2026-09-08 and
 * 2026-09-09). Costs, weights and destinations are transcribed from the
 * receipts; recipient names and addresses are deliberately not reproduced.
 */
describe("real receipt verification (2026-09)", () => {
  const sikpaka: Array<[string, number, number]> = [
    ["SE", 34, 5.16],
    ["DK", 33, 5.39],
    ["DK", 9, 5.35],
    ["RO", 77, 4.13],
    ["DE", 34, 5.08],
    ["DE", 9, 5.03],
    ["DE", 16, 5.03],
    ["DE", 18, 5.03],
    ["DE", 73, 5.08],
  ];

  it.each(sikpaka)("prices an untracked Sīkpaka to %s at %ig exactly as the counter did", (country, grams, charged) => {
    expect(quotePostage(grams, country, { tracked: false }).cost).toBe(charged);
  });

  it("adds exactly the receipted tracking surcharge", () => {
    // The one tracked item on the receipts: DE 73g, 5.08 + 2.54 tracking.
    expect(quotePostage(73, "DE", { tracked: true }).cost).toBe(7.62);
    expect(quotePostage(73, "DE", { tracked: true }).cost - quotePostage(73, "DE", { tracked: false }).cost)
      .toBeCloseTo(TRACKING_FEE, 2);
  });

  it("prices Latvia domestically instead of falling to the unlisted fallback", () => {
    // Receipted: 54g = 3.56, 203g = 4.70. Before Latvia had a row these were
    // priced at the highest EEA rate and profit was understated by ~3 EUR.
    expect(quotePostage(54, "LV", { tracked: false }).cost).toBe(3.56);
    expect(quotePostage(203, "LV", { tracked: false }).cost).toBe(4.7);
    expect(quotePostage(54, "LV", { tracked: false }).estimated).toBe(false);
  });

  it("prices letter post at the flat international rate plus the marking fee", () => {
    // Receipted: IE 14g and 19g and CZ 13g all 3.00; AT 79g and PT 44g 3.85.
    for (const [country, grams] of [["IE", 14], ["IE", 19], ["CZ", 13]] as Array<[string, number]>) {
      expect(quotePostage(grams, country, { postalClass: "korespondence" }).cost).toBe(3.06);
    }
    for (const [country, grams] of [["AT", 79], ["PT", 44]] as Array<[string, number]>) {
      expect(quotePostage(grams, country, { postalClass: "korespondence" }).cost).toBe(3.91);
    }
  });

  it("letter post is materially cheaper than the small packet it replaces", () => {
    const letter = quotePostage(14, "IE", { postalClass: "korespondence" }).cost;
    const packet = quotePostage(14, "IE", { tracked: false }).cost;
    expect(letter).toBeLessThan(packet / 1.9); // 3.06 vs 6.29
  });

  it("refuses to invent a letter rate outside the evidence", () => {
    // Over 100g, and domestic, both fall back to sīkpaka rather than guess.
    expect(quotePostage(250, "DE", { postalClass: "korespondence", tracked: false }).service).toBe("sikpaka");
    expect(quotePostage(50, "LV", { postalClass: "korespondence", tracked: false }).service).toBe("sikpaka");
  });
});

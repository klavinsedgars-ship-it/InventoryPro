import { describe, it, expect } from "vitest";
import { normalizeErrorReason, summarizeRunErrors, shouldContinueRamp } from "./list-ramp-core";

describe("normalizeErrorReason", () => {
  it("collapses eBay ids so the same failure groups together", () => {
    expect(normalizeErrorReason("25002 Ein Nutzerfehler ist aufgetreten")).toBe(
      "N Ein Nutzerfehler ist aufgetreten",
    );
  });

  it("leaves short numbers alone (quantities, not ids)", () => {
    expect(normalizeErrorReason("TME cannot ship 2 today (only 0 in stock)")).toBe(
      "TME cannot ship 2 today (only 0 in stock)",
    );
  });
});

describe("summarizeRunErrors — reports THIS run, not the whole table", () => {
  it("ranks the run's own failures by frequency", () => {
    const top = summarizeRunErrors([
      { sku: "A", ok: false, error: "merchant location: 25802 not found" },
      { sku: "B", ok: false, error: "merchant location: 25815 not found" },
      { sku: "C", ok: false, error: "offer: 25002 Ein Nutzerfehler ist aufgetreten" },
      { sku: "D", ok: true },
    ]);
    expect(top[0].count).toBe(2);
    expect(top[0].reason).toContain("merchant location");
  });

  it("ignores successes and error-less entries", () => {
    expect(summarizeRunErrors([{ sku: "A", ok: true }, { sku: "B", ok: false }])).toEqual([]);
  });

  it("does not let a louder historical error outrank the run's real blocker", () => {
    // The regression: a run where every SKU failed on the same account-level
    // problem must report THAT, even though a different error may sit on far
    // more rows in the products table. Only run results are considered here.
    const runResults = Array.from({ length: 25 }, (_, i) => ({
      sku: `S${i}`,
      ok: false,
      error: "merchant location: location not found",
    }));
    const top = summarizeRunErrors(runResults);
    expect(top).toHaveLength(1);
    expect(top[0]).toEqual({ reason: "merchant location: location not found", count: 25 });
  });
});

describe("shouldContinueRamp", () => {
  const base = {
    elapsedMs: 0,
    budgetMs: 270_000,
    batches: 1,
    maxBatches: 0,
    limitHit: false,
    budgetStop: false,
    blocked: false,
  };

  it("keeps going inside the time budget", () => {
    expect(shouldContinueRamp(base)).toBe(true);
  });

  it("stops on an account-level blocker instead of burning the budget", () => {
    // 75 batches x 25 SKUs, 0 published: the run kept retrying a problem that
    // no product could have fixed.
    expect(shouldContinueRamp({ ...base, blocked: true })).toBe(false);
  });

  it("stops on a rate limit, a spend cap, an exhausted budget, or maxBatches", () => {
    expect(shouldContinueRamp({ ...base, limitHit: true })).toBe(false);
    expect(shouldContinueRamp({ ...base, budgetStop: true })).toBe(false);
    expect(shouldContinueRamp({ ...base, elapsedMs: 270_000 })).toBe(false);
    expect(shouldContinueRamp({ ...base, maxBatches: 1 })).toBe(false);
  });
});

describe("error classification — what may burn a listing attempt", () => {
  // Mirrors the regexes in ebay-lister.ts. Attempts exist to park products
  // with something wrong with them; these three categories are not that.
  const LIMIT_RX = /\blimit\b|too many|rate.?limit|2001\b|21917|exceed/i;
  const POLICY_RX = /\b25019\b|eBay-Grunds|nicht erlaubt|prohibited|restricted item|violat/i;
  const TRANSIENT_RX = /system error|internal server error|temporarily unavailable|try again|service unavailable|\b50[0234]\b|\b25604\b|availability not found|verfügbarkeit nicht gefunden/i;

  it("treats an eBay outage as transient, not as a product defect", () => {
    const err = "publish: 25001 A system error has occurred. Internal Server Error";
    expect(TRANSIENT_RX.test(err)).toBe(true);
    expect(POLICY_RX.test(err)).toBe(false);
  });

  it("treats a prohibited-item refusal as permanent", () => {
    const err =
      "publish: 25019 Cannot revise listing. Die Artikelbezeichnung und/oder -beschreibung enthalten unter Umständen unzulässige Begriffe oder das Angebot verstößt gegen die eBay-Grundsätze.";
    expect(POLICY_RX.test(err)).toBe(true);
    expect(TRANSIENT_RX.test(err)).toBe(false);
  });

  it("still burns an attempt for a real payload problem", () => {
    const err = "inventory_item: 25717 imageUrls darf nicht Null oder leer sein.";
    expect(LIMIT_RX.test(err)).toBe(false);
    expect(POLICY_RX.test(err)).toBe(false);
    expect(TRANSIENT_RX.test(err)).toBe(false);
  });

  it("does not mistake a plain user error for a system error", () => {
    // "A user error has occurred" must not match the transient rule.
    expect(TRANSIENT_RX.test("25002 A user error has occurred. Das Feld EAN fehlt.")).toBe(false);
  });
});

describe("25604 'Availability not found' is a propagation delay, not a defect", () => {
  const TRANSIENT_RX = /system error|internal server error|temporarily unavailable|try again|service unavailable|\b50[0234]\b|\b25604\b|availability not found|verfügbarkeit nicht gefunden/i;
  const POLICY_RX = /\b25019\b|eBay-Grunds|nicht erlaubt|prohibited|restricted item|violat/i;

  it("classifies the live error text as transient in both languages", () => {
    // Seen at 2-6% of publishes once the ramp reached ~800 listings a tick.
    // The offer is created moments before the publish that rejects it, and the
    // products all carry stock, so burning an attempt would park good SKUs.
    const en = "publish: 25604 Input error. Seller Inventory Service can not publish the data. Availability not found. Please try again or contact customer service..";
    const de = "25604 Eingabefehler. Seller Inventory Service kann die Daten nicht veröffentlichen. Verfügbarkeit nicht gefunden. Bitte versuchen Sie es noch einmal.";
    expect(TRANSIENT_RX.test(en)).toBe(true);
    expect(TRANSIENT_RX.test(de)).toBe(true);
    expect(POLICY_RX.test(en)).toBe(false);
  });

  it("still treats a genuine payload fault as the product's problem", () => {
    expect(TRANSIENT_RX.test("inventory_item: 25717 imageUrls darf nicht Null oder leer sein.")).toBe(false);
    expect(TRANSIENT_RX.test("25002 A user error has occurred. Das Feld EAN fehlt.")).toBe(false);
  });
});

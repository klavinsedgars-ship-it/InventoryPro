import { describe, it, expect, afterEach } from "vitest";
import {
  quotePostage, LATVIAN_POST_TARIFFS, TRACKING_FEE, MANS_PASTS_DISCOUNT,
  trackedShippingDefault,
} from "@shared/latvian-post";

describe("tariff table matches the published book", () => {
  it("has Germany's Sīkpaka rates exactly as printed", () => {
    // Tariff book, Vācija / EEZ row. Germany is where nearly all our parcels go.
    expect(LATVIAN_POST_TARIFFS.DE.economy).toEqual([5.03, 5.08, 6.12, 8.16, 9.55]);
    expect(LATVIAN_POST_TARIFFS.DE.tracked).toEqual([7.57, 7.62, 8.66, 10.7, 12.09]);
    expect(LATVIAN_POST_TARIFFS.DE.parcel).toEqual([17.89, 2.37]);
  });

  it("keeps tracked = economy + the tracking fee, for every country listed", () => {
    // The book states this rule, and it held for all 240 countries when the
    // table was extracted — so it doubles as a check on the data itself.
    for (const [iso, t] of Object.entries(LATVIAN_POST_TARIFFS)) {
      t.economy.forEach((eco, i) => {
        expect(Math.abs(t.tracked[i] - eco - TRACKING_FEE), `${iso} band ${i}`).toBeLessThan(0.011);
      });
    }
  });

  it("covers the EU/EEA destinations we sell to", () => {
    for (const iso of ["DE", "FR", "IT", "ES", "NL", "PL", "AT", "SE", "FI", "DK", "BE", "LT", "EE"]) {
      expect(LATVIAN_POST_TARIFFS[iso], iso).toBeDefined();
    }
  });
});

describe("quotePostage", () => {
  it("prices a typical component order to Germany", () => {
    // A few resistors and a sensor: comfortably inside the 101-500g band.
    const q = quotePostage(250, "DE");
    expect(q.cost).toBe(8.66);
    expect(q.service).toBe("sikpaka");
    expect(q.bandLabel).toBe("100-500g");
    expect(q.estimated).toBe(false);
  });

  it("charges by band, so cost jumps at the boundary rather than scaling", () => {
    expect(quotePostage(100, "DE").cost).toBe(7.62);
    expect(quotePostage(101, "DE").cost).toBe(8.66);
    expect(quotePostage(500, "DE").cost).toBe(8.66);
    expect(quotePostage(501, "DE").cost).toBe(10.7);
  });

  it("switches to parcel pricing above 2 kg", () => {
    const q = quotePostage(2500, "DE");
    expect(q.service).toBe("paka");
    // First kg 17.89 + two further kg at 2.37. Written as the rounded result
    // because 17.89 + 2*2.37 is 22.630000000000003 in binary floating point.
    expect(q.cost).toBe(22.63);
  });

  it("applies the Mans Pasts discount only when asked, and only when tracked", () => {
    expect(quotePostage(250, "DE", { mansPastsDiscount: true }).cost).toBe(8.66 - MANS_PASTS_DISCOUNT);
    expect(quotePostage(250, "DE", { mansPastsDiscount: true, tracked: false }).cost).toBe(6.12);
  });

  it("falls back to the DEAREST rate for an unknown destination", () => {
    // Under-estimating postage inflates profit, which is exactly what this
    // table exists to stop — so an unknown country must not be cheap.
    const q = quotePostage(250, "ZZ");
    expect(q.estimated).toBe(true);
    expect(q.cost).toBeGreaterThanOrEqual(quotePostage(250, "DE").cost);
    expect(q.note).toMatch(/no tariff/i);
  });

  it("never prices a missing or absurd weight as free", () => {
    expect(quotePostage(0, "DE").cost).toBeGreaterThan(0);
    expect(quotePostage(NaN as any, "DE").cost).toBeGreaterThan(0);
    expect(quotePostage(-5, "DE").cost).toBeGreaterThan(0);
  });

  it("handles a missing country without throwing", () => {
    expect(() => quotePostage(250, null)).not.toThrow();
    expect(quotePostage(250, null).estimated).toBe(true);
  });
});

describe("trackedShippingDefault — untracked unless opted in", () => {
  const saved = process.env.SHIP_TRACKED;
  afterEach(() => {
    if (saved === undefined) delete process.env.SHIP_TRACKED;
    else process.env.SHIP_TRACKED = saved;
  });

  it("defaults to untracked", () => {
    // Tracking is €2.54 a parcel; replacing the rare lost order is cheaper for
    // a basket of low-value components.
    delete process.env.SHIP_TRACKED;
    expect(trackedShippingDefault()).toBe(false);
  });

  it("opts in only on an explicit true", () => {
    process.env.SHIP_TRACKED = "true";
    expect(trackedShippingDefault()).toBe(true);
    process.env.SHIP_TRACKED = "false";
    expect(trackedShippingDefault()).toBe(false);
    process.env.SHIP_TRACKED = "yes";
    expect(trackedShippingDefault()).toBe(false);
  });

  it("shows why: tracking costs far more than self-insuring at real loss rates", () => {
    const perParcelTrackingCost = quotePostage(250, "DE", { tracked: true }).cost
      - quotePostage(250, "DE", { tracked: false }).cost;
    expect(perParcelTrackingCost).toBeCloseTo(TRACKING_FEE, 2);
    const resendCost = 3 /* goods */ + quotePostage(250, "DE", { tracked: false }).cost;
    const breakEvenLossRate = perParcelTrackingCost / resendCost;
    expect(breakEvenLossRate).toBeGreaterThan(0.25); // ~28% — far above real postal loss
  });
});

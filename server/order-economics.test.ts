import { describe, it, expect } from "vitest";
import { vatForSale, vatFromGross, netFromGross } from "@shared/vat-rates";
import { computeOrderEconomics } from "@shared/order-economics";

const config = { feePct: 0.12, fixedFee: 0.35, packagingCost: 0.3, homeCountry: "LV" };

describe("vatForSale — the buyer's country decides, not ours", () => {
  it("applies the destination rate for an EU consumer sale", () => {
    // The whole point: a Latvian seller shipping to Germany owes 19%, not 21%.
    expect(vatForSale("DE")).toMatchObject({ ratePct: 19, basis: "eu_destination" });
    expect(vatForSale("FR")).toMatchObject({ ratePct: 20 });
    expect(vatForSale("lv")).toMatchObject({ ratePct: 21 });
  });

  it("zero-rates an export outside the EU VAT area", () => {
    expect(vatForSale("GB")).toMatchObject({ ratePct: 0, basis: "export_zero_rated" });
    expect(vatForSale("US")).toMatchObject({ ratePct: 0 });
  });

  it("falls back to the home rate rather than assuming zero", () => {
    // Reporting 0% for an unknown destination would book the state's money as
    // profit. Over-reserving is the safe direction to be wrong in.
    expect(vatForSale(null)).toMatchObject({ ratePct: 21, basis: "home_fallback" });
    expect(vatForSale("XX")).toMatchObject({ ratePct: 21, basis: "home_fallback" });
    expect(vatForSale("XX").note).toMatch(/verify/i);
  });

  it("honours an override, so a rate change needs no deploy", () => {
    expect(vatForSale("DE", { overrides: "DE:20" })).toMatchObject({ ratePct: 20, basis: "override" });
  });
});

describe("vatFromGross — extracted, never added", () => {
  it("takes VAT out of a VAT-inclusive price", () => {
    // €119 at 19% contains €19 of VAT, not €22.61.
    expect(vatFromGross(119, 19)).toBeCloseTo(19, 6);
    expect(netFromGross(119, 19)).toBeCloseTo(100, 6);
  });

  it("is zero for zero-rated sales and empty amounts", () => {
    expect(vatFromGross(100, 0)).toBe(0);
    expect(vatFromGross(0, 19)).toBe(0);
  });
});

describe("computeOrderEconomics", () => {
  const base = {
    itemsGross: 100,
    shippingCharged: 19,
    destinationCountry: "DE",
    supplierCost: 40,
    actualMarketplaceFee: null,
    postageCost: 8,
  };

  it("subtracts destination VAT before anything else", () => {
    const e = computeOrderEconomics(base, config);
    expect(e.grossReceived).toBe(119);
    expect(e.vatOwed).toBe(19); // 19% of 119 gross = 19
    expect(e.netRevenue).toBe(100);
  });

  it("charges the eBay fee on the GROSS, including VAT", () => {
    // A fee taken on net revenue would understate it — eBay bills on what the
    // buyer paid.
    const e = computeOrderEconomics(base, config);
    expect(e.marketplaceFee).toBe(14.63); // 119 * 0.12 + 0.35
  });

  it("computes profit and margin on net revenue", () => {
    const e = computeOrderEconomics(base, config);
    // 100 net − 40 goods − 14.63 fee − 8 postage − 0.30 packaging
    expect(e.netProfit).toBe(37.07);
    expect(e.netMarginPct).toBe(37.07);
    // The same profit over the buyer's payment is a smaller number; both are
    // reported so they can't be confused.
    expect(e.grossMarginPct).toBeCloseTo(31.15, 1);
  });

  it("prefers eBay's actual fee over the model, and says which was used", () => {
    const e = computeOrderEconomics({ ...base, actualMarketplaceFee: 13.1 }, config);
    expect(e.marketplaceFee).toBe(13.1);
    expect(e.ledger.find((l) => l.key === "marketplace_fee")?.actual).toBe(true);

    const modelled = computeOrderEconomics(base, config);
    expect(modelled.ledger.find((l) => l.key === "marketplace_fee")?.actual).toBe(false);
  });

  it("flags an order whose supplier cost is missing instead of reporting it as pure profit", () => {
    const e = computeOrderEconomics({ ...base, supplierCost: 0 }, config);
    const cogs = e.ledger.find((l) => l.key === "cogs");
    expect(cogs?.actual).toBe(false);
    expect(cogs?.note).toMatch(/overstated/i);
    expect(e.fullyActual).toBe(false);
  });

  it("keeps the full sale when the destination is zero-rated", () => {
    const e = computeOrderEconomics({ ...base, destinationCountry: "GB" }, config);
    expect(e.vatOwed).toBe(0);
    expect(e.netRevenue).toBe(119);
  });

  it("reports a loss as a negative rather than clamping it", () => {
    const e = computeOrderEconomics({ ...base, supplierCost: 95 }, config);
    expect(e.netProfit).toBeLessThan(0);
    expect(e.netMarginPct).toBeLessThan(0);
  });

  it("produces a ledger that balances", () => {
    const e = computeOrderEconomics(base, config);
    const outs = e.ledger.filter((l) => l.kind === "out").reduce((s, l) => s + l.amount, 0);
    expect(Math.round((e.grossReceived - outs) * 100) / 100).toBe(e.netProfit);
  });
});

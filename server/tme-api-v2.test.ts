import { describe, it, expect } from "vitest";
import { availableNow, incomingSupplyDate, isListable, type V2ProductData } from "./tme-api-v2";

const p = (over: Partial<V2ProductData>): V2ProductData => ({
  symbol: "X",
  stock_quantity: 0,
  ...over,
});

describe("availableNow — the oversell fix", () => {
  it("counts only stock that can ship today, never incoming deliveries", () => {
    // The exact shape of the 2026-06 incident: plenty on paper, none shippable.
    const item = p({
      stock_quantity: 70,
      deliveries: { elements: [
        { status: "DS_DELIVERY_NEEDS_CONFIRMATION", amount: 70, data: { waiting_period: "P5W", supply_date: "2026-09-30" } },
      ]},
    });
    expect(availableNow(item)).toBe(0);
  });

  it("sums the in-stock portion of a split response", () => {
    const item = p({
      stock_quantity: 1000,
      deliveries: { elements: [
        { status: "DS_AVAILABLE_IN_STOCK", amount: 647, data: null },
        { status: "DS_DELIVERY_NEEDS_CONFIRMATION", amount: 353, data: { supply_date: "2026-06-17" } },
      ]},
    });
    expect(availableNow(item)).toBe(647);
  });

  it("falls back to stock_quantity when deliveries were not requested", () => {
    expect(availableNow(p({ stock_quantity: 168752 }))).toBe(168752);
    expect(availableNow(p({ stock_quantity: 0 }))).toBe(0);
  });
});

describe("incomingSupplyDate", () => {
  it("returns the earliest incoming supply date", () => {
    const item = p({ deliveries: { elements: [
      { status: "DS_AVAILABLE_IN_STOCK", amount: 5, data: null },
      { status: "DS_DELIVERY_NEEDS_CONFIRMATION", amount: 10, data: { supply_date: "2026-10-05" } },
      { status: "DS_DELIVERY_NEEDS_CONFIRMATION", amount: 20, data: { supply_date: "2026-09-01" } },
    ]}});
    expect(incomingSupplyDate(item)).toBe("2026-09-01");
  });
  it("is null when everything is in stock", () => {
    expect(incomingSupplyDate(p({ deliveries: { elements: [
      { status: "DS_AVAILABLE_IN_STOCK", amount: 5, data: null },
    ]}}))).toBeNull();
  });
});

describe("isListable — product statuses we previously ignored", () => {
  it("blocks products we are not permitted or able to sell", () => {
    for (const s of ["CANNOT_BE_ORDERED", "NOT_IN_OFFER", "PRODUCT_BLOCKED", "ONLY_FOR_SPECIAL_ORDER", "INVALID"]) {
      expect(isListable([s]).ok, s).toBe(false);
    }
  });
  it("allows normal products, including promoted/new ones", () => {
    expect(isListable([]).ok).toBe(true);
    expect(isListable(["NEW", "PROMOTED", "AVAILABLE_WHILE_STOCKS_LAST"]).ok).toBe(true);
  });
  it("allows but flags products needing shipping or lead-time care", () => {
    const r = isListable(["DANGEROUS", "EXTERNAL_WAREHOUSE"]);
    expect(r.ok).toBe(true);
    expect(r.cautions).toEqual(["DANGEROUS", "EXTERNAL_WAREHOUSE"]);
  });
  it("reports every blocking reason, not just the first", () => {
    const r = isListable(["NOT_IN_OFFER", "DANGEROUS", "PRODUCT_BLOCKED"]);
    expect(r.ok).toBe(false);
    expect(r.blockedBy).toEqual(["NOT_IN_OFFER", "PRODUCT_BLOCKED"]);
    expect(r.cautions).toEqual(["DANGEROUS"]);
  });
  it("tolerates a missing status list", () => {
    expect(isListable(undefined).ok).toBe(true);
  });
});

import { describe, it, expect } from "vitest";
import { deliveryShippable, shippableNow, canShipNow, incomingSupplyDate, isListable, type V2ProductData } from "./tme-api-v2";

const p = (over: Partial<V2ProductData>): V2ProductData => ({
  symbol: "X",
  stock_quantity: 0,
  ...over,
});

describe("deliveryShippable — answers about a REQUESTED quantity", () => {
  it("reports 0 when the whole requested amount is still incoming", () => {
    // The exact shape of the 2026-06 incident: stock on paper, none shippable.
    // A NON-EMPTY all-incoming breakdown is real evidence and must still block.
    const item = p({
      stock_quantity: 70,
      deliveries: { elements: [
        { status: "DS_DELIVERY_NEEDS_CONFIRMATION", amount: 70, data: { waiting_period: "P5W", supply_date: "2026-09-30" } },
      ]},
    });
    expect(deliveryShippable(item)).toBe(0);
    expect(shippableNow(item)).toEqual({ units: 0, basis: "deliveries" });
    expect(canShipNow(item, 70)).toBe(false);
  });

  it("sums only the in-stock portion of a split response", () => {
    const item = p({
      stock_quantity: 1000,
      deliveries: { elements: [
        { status: "DS_AVAILABLE_IN_STOCK", amount: 647, data: null },
        { status: "DS_DELIVERY_NEEDS_CONFIRMATION", amount: 353, data: { supply_date: "2026-06-17" } },
      ]},
    });
    expect(deliveryShippable(item)).toBe(647);
    expect(canShipNow(item, 647)).toBe(true);
    expect(canShipNow(item, 1000)).toBe(false);
  });

  it("is NOT a measure of total stock — it mirrors the quantity asked about", () => {
    // Live regression: asking for 1 unit of a product with 1,628 in stock
    // returns DS_AVAILABLE_IN_STOCK: 1. Treating that as total sellable stock
    // would cap every listing at the amount we happened to request.
    const askedForOne = p({
      stock_quantity: 1628,
      deliveries: { elements: [{ status: "DS_AVAILABLE_IN_STOCK", amount: 1, data: null }] },
    });
    expect(deliveryShippable(askedForOne)).toBe(1);
    expect(askedForOne.stock_quantity).toBe(1628); // the real stock figure
    expect(canShipNow(askedForOne, 1)).toBe(true);
  });

  it("is null — not 0 — when TME supplied no breakdown", () => {
    expect(deliveryShippable(p({ stock_quantity: 168752 }))).toBeNull();
    expect(deliveryShippable(p({ stock_quantity: 48, deliveries: { elements: [] } }))).toBeNull();
  });
});

describe("shippableNow — a missing answer is not a zero", () => {
  it("falls back to warehouse stock when TME sends an EMPTY deliveries array", () => {
    // Live regression: TME returned stock_quantity 48 with deliveries: [].
    // Reading that as "0 shippable" blocked every such product from listing —
    // 9 of 10 ramp candidates, all of them genuinely in stock.
    const item = p({ stock_quantity: 48, deliveries: { elements: [] } });
    expect(shippableNow(item)).toEqual({ units: 48, basis: "stock_quantity" });
    expect(canShipNow(item, 2)).toBe(true);
  });

  it("falls back to warehouse stock when the delivery scope was never requested", () => {
    expect(shippableNow(p({ stock_quantity: 168752 }))).toEqual({
      units: 168752,
      basis: "stock_quantity",
    });
  });

  it("still reports zero when the warehouse genuinely holds nothing", () => {
    expect(shippableNow(p({ stock_quantity: 0 }))).toEqual({ units: 0, basis: "stock_quantity" });
    expect(canShipNow(p({ stock_quantity: 0 }), 1)).toBe(false);
  });

  it("prefers the breakdown over warehouse stock when both exist", () => {
    // Stock can exist yet be committed; the breakdown knows, the total doesn't.
    const item = p({
      stock_quantity: 100,
      deliveries: { elements: [{ status: "DS_AVAILABLE_IN_STOCK", amount: 3, data: null }] },
    });
    expect(shippableNow(item)).toEqual({ units: 3, basis: "deliveries" });
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

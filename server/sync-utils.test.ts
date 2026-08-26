import { describe, it, expect } from "vitest";
import { extractStock, staleCutoffs } from "./sync-utils";

describe("extractStock", () => {
  // TME support (2026-08): Amount "shows the real warehouse stock", real-time.
  // It therefore WINS over StockList, which we previously summed — summing
  // across warehouses can exceed what is actually sellable and is the most
  // plausible mechanism behind the 2026-06-16 oversell.
  it("prefers the real-time Amount over StockList", () => {
    expect(extractStock({ Amount: 5, StockList: [{ Amount: 40 }, { Amount: 30 }] }, 0)).toBe(5);
  });
  it("uses Amount when there is no StockList", () => {
    expect(extractStock({ Amount: 70 }, 0)).toBe(70);
    expect(extractStock({ Amount: 0 }, 42)).toBe(0); // 0 is a real value, not missing
  });
  it("falls back to the LARGEST single warehouse when Amount is absent", () => {
    // Never the sum: one warehouse is a quantity we can actually ship from,
    // the sum assumes fulfilment pools every location.
    expect(extractStock({ StockList: [{ Amount: 5 }, { Amount: 3 }] }, 0)).toBe(5);
  });
  it("falls back when neither StockList (non-empty) nor Amount is present", () => {
    expect(extractStock({}, 42)).toBe(42);
    expect(extractStock({ StockList: [] }, 9)).toBe(9);
  });
  it("treats missing warehouse Amounts as 0", () => {
    expect(extractStock({ StockList: [{ Amount: 4 }, {} as any] }, 0)).toBe(4);
  });
});

describe("staleCutoffs", () => {
  it("defaults to listed 4h / unlisted 48h behind now", () => {
    const now = 1_000_000_000_000;
    const { listed, unlisted } = staleCutoffs(now);
    expect(now - listed.getTime()).toBe(4 * 3600 * 1000);
    expect(now - unlisted.getTime()).toBe(48 * 3600 * 1000);
  });
  it("keeps listed at least as fresh as unlisted", () => {
    const { listed, unlisted } = staleCutoffs();
    expect(listed.getTime()).toBeGreaterThanOrEqual(unlisted.getTime());
  });
});

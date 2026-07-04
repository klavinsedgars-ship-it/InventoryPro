import { describe, it, expect } from "vitest";
import { extractStock, staleCutoffs } from "./sync-utils";

describe("extractStock", () => {
  it("sums StockList warehouse amounts", () => {
    expect(extractStock({ StockList: [{ Amount: 5 }, { Amount: 3 }] }, 0)).toBe(8);
  });
  it("uses the flat Amount when there is no StockList", () => {
    expect(extractStock({ Amount: 70 }, 0)).toBe(70);
    expect(extractStock({ Amount: 0 }, 42)).toBe(0); // 0 is a real value, not missing
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

import { describe, it, expect } from "vitest";
import { getShippingPolicyByWeight } from "./shipping-policies";

const price = (w: number | null | undefined) => getShippingPolicyByWeight(w)?.price;

describe("getShippingPolicyByWeight (weight bands feed the profit floor)", () => {
  it("uses the lightest band for null / undefined / non-positive weight", () => {
    expect(price(null)).toBe("5.79");
    expect(price(undefined)).toBe("5.79");
    expect(price(0)).toBe("5.79");
    expect(price(-5)).toBe("5.79");
  });

  it("selects the band by [min, max) — inclusive lower, exclusive upper", () => {
    expect(price(10)).toBe("5.79");   // 0–21
    expect(price(20)).toBe("5.79");
    expect(price(21)).toBe("5.89");   // 21–101
    expect(price(100)).toBe("5.89");
    expect(price(101)).toBe("7.09");  // 101–501
    expect(price(500)).toBe("7.09");
    expect(price(501)).toBe("9.39");  // 501–1001
    expect(price(1000)).toBe("9.39");
    expect(price(1001)).toBe("10.99"); // 1001–2001
    expect(price(2000)).toBe("10.99");
  });

  it("uses the heaviest band above the top of the range", () => {
    expect(price(2001)).toBe("10.99");
    expect(price(50000)).toBe("10.99");
  });
});

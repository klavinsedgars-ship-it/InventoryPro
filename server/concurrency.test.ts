import { describe, it, expect } from "vitest";
import { mapPool } from "./concurrency";

describe("mapPool", () => {
  it("keeps results positionally aligned regardless of completion order", async () => {
    // Callers zip the output back against their input, so a fast item
    // finishing first must not move ahead of a slow one in the results.
    const delays = [30, 1, 20, 2, 10];
    const out = await mapPool(delays, 3, async (ms, i) => {
      await new Promise((r) => setTimeout(r, ms));
      return `${i}:${ms}`;
    });
    expect(out).toEqual(["0:30", "1:1", "2:20", "3:2", "4:10"]);
  });

  it("never exceeds the concurrency limit", async () => {
    let inFlight = 0;
    let peak = 0;
    await mapPool(Array.from({ length: 20 }, (_, i) => i), 4, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return null;
    });
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1); // and it really did run in parallel
  });

  it("handles an empty list and a limit larger than the list", async () => {
    expect(await mapPool([], 8, async () => 1)).toEqual([]);
    expect(await mapPool([1, 2], 99, async (n) => n * 2)).toEqual([2, 4]);
  });

  it("runs concurrently rather than serially", async () => {
    const started = Date.now();
    await mapPool(Array.from({ length: 8 }, (_, i) => i), 8, async () => {
      await new Promise((r) => setTimeout(r, 25));
      return null;
    });
    // 8 x 25ms serial would be 200ms; concurrent should be far under.
    expect(Date.now() - started).toBeLessThan(150);
  });
});

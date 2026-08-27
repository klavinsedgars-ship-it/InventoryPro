import { describe, it, expect } from "vitest";
import { RateLimiter, intervalForRps } from "./rate-limiter";

/** Virtual clock: sleeping advances time, so spacing is asserted exactly. */
function virtualLimiter() {
  let now = 0;
  const limiter = new RateLimiter(
    () => now,
    async (ms) => { now += ms; },
  );
  return { limiter, at: () => now };
}

describe("RateLimiter", () => {
  it("spaces sequential calls by the interval", async () => {
    const { limiter, at } = virtualLimiter();
    await limiter.acquire("data", 250);
    expect(at()).toBe(0); // first call goes immediately
    await limiter.acquire("data", 250);
    expect(at()).toBe(250);
    await limiter.acquire("data", 250);
    expect(at()).toBe(500);
  });

  it("spaces CONCURRENT callers instead of releasing them together", async () => {
    // The regression this class exists for: the previous limiter had every
    // concurrent caller read the same timestamp, wait the same delay, and then
    // fire simultaneously — so 4 parallel slices meant 4 requests at once.
    //
    // Real timers here on purpose: a shared virtual clock cannot represent
    // several callers sleeping at the same time, which is precisely the
    // situation under test.
    const l = new RateLimiter();
    const interval = 40;
    const t0 = Date.now();
    const marks: number[] = [];
    await Promise.all(
      Array.from({ length: 5 }, () =>
        l.acquire("data", interval).then(() => marks.push(Date.now() - t0)),
      ),
    );
    marks.sort((a, b) => a - b);
    for (let i = 1; i < marks.length; i++) {
      // Slack for timer jitter; the point is they are spaced, not simultaneous.
      expect(marks[i] - marks[i - 1]).toBeGreaterThanOrEqual(interval * 0.75);
    }
    // Five calls at 40ms apart cannot have finished in a single burst.
    expect(marks[marks.length - 1]).toBeGreaterThanOrEqual(interval * 3);
  });

  it("keeps rate classes independent", async () => {
    // /products/data is 4/sec while the other endpoints allow 10/sec; one must
    // not consume the other's budget.
    const { limiter, at } = virtualLimiter();
    await limiter.acquire("data", 250);
    await limiter.acquire("default", 100);
    expect(at()).toBe(0); // different class: no wait
    await limiter.acquire("data", 250);
    expect(at()).toBe(250);
  });

  it("does not wait when calls are already far apart", async () => {
    let now = 0;
    const l = new RateLimiter(() => now, async (ms) => { now += ms; });
    await l.acquire("data", 250);
    now += 10_000; // a long gap between batches
    await l.acquire("data", 250);
    expect(now).toBe(10_000); // no artificial delay
  });

  it("treats a zero or negative interval as no limit", async () => {
    const { limiter, at } = virtualLimiter();
    await limiter.acquire("x", 0);
    await limiter.acquire("x", -5);
    expect(at()).toBe(0);
  });
});

describe("intervalForRps", () => {
  it("converts a rate to spacing with headroom", () => {
    expect(intervalForRps(4)).toBe(275);   // 250ms + 10%
    expect(intervalForRps(10)).toBe(110);  // 100ms + 10%
  });

  it("never divides by zero", () => {
    expect(intervalForRps(0)).toBeGreaterThan(0);
  });
});

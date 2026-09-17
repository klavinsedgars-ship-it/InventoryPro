import { describe, it, expect } from "vitest";
import { shouldRetryAcc } from "./acc-api";

/**
 * ACC requests cross an extra hop (the whitelisted VPS running tinyproxy),
 * which can fail independently of ACC. The policy below decides what is worth
 * another go and what is ACC's actual answer — the second must never be
 * hammered.
 */
describe("shouldRetryAcc", () => {
  it("does not retry a success", () => {
    expect(shouldRetryAcc({ ok: true }, 1)).toBe(false);
  });

  it("retries a transient failure until the attempt budget runs out", () => {
    const flaky = { ok: false, transient: true };
    expect(shouldRetryAcc(flaky, 1)).toBe(true);
    expect(shouldRetryAcc(flaky, 3)).toBe(true);
    expect(shouldRetryAcc(flaky, 4)).toBe(false);
    expect(shouldRetryAcc(flaky, 9)).toBe(false);
  });

  it("never retries their 15-minute identical-request refusal", () => {
    // Immediately repeating the same call is guaranteed to be refused again;
    // only a different request or a quarter of an hour clears it.
    expect(shouldRetryAcc({ ok: false, throttled: true }, 1)).toBe(false);
    expect(shouldRetryAcc({ ok: false, throttled: true, transient: true }, 1)).toBe(false);
  });

  it("treats a definite rejection as the answer", () => {
    // A bad licence key is not a flaky tunnel; hammering it four times only
    // makes the account look abusive.
    expect(shouldRetryAcc({ ok: false, transient: false }, 1)).toBe(false);
    expect(shouldRetryAcc({ ok: false }, 1)).toBe(false);
  });

  it("honours a caller-supplied budget", () => {
    expect(shouldRetryAcc({ ok: false, transient: true }, 1, 1)).toBe(false);
    expect(shouldRetryAcc({ ok: false, transient: true }, 1, 2)).toBe(true);
  });
});

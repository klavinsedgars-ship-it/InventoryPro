import { describe, it, expect } from "vitest";
import { buildAccRequest, shouldRetryAcc } from "./acc-api";

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

describe("buildAccRequest", () => {
  const cfg = { licenseKey: "KEY", locale: "en", currency: "EUR", companyId: "_al" };

  it("sends the licence key on every method", () => {
    for (const m of ["GetProducts", "GetTreeBranches", "GetProduct", "SomethingNew"]) {
      expect(buildAccRequest(cfg, m).LicenseKey).toBe("KEY");
    }
  });

  it("does NOT send Currency to GetTreeBranches", () => {
    // Observed in production: ACC validates the parameter set, and an
    // unexpected Currency here is HTTP 400 "parameters : An error has
    // occurred." — not a silently ignored extra.
    const body = buildAccRequest(cfg, "GetTreeBranches");
    expect(body.Currency).toBeUndefined();
    expect(body.Locale).toBe("en");
    expect(body.CompanyId).toBe("_al");
  });

  it("sends Currency to the product methods, which price in it", () => {
    expect(buildAccRequest(cfg, "GetProducts").Currency).toBe("EUR");
    expect(buildAccRequest(cfg, "GetProduct").Currency).toBe("EUR");
  });

  it("is conservative about a method it does not know", () => {
    // Adding a parameter a method does not accept is a hard 400; omitting an
    // optional one just takes ACC's default.
    const body = buildAccRequest(cfg, "GetInvoiceList");
    expect(body.Currency).toBeUndefined();
    expect(body.Locale).toBe("en");
  });

  it("lets the method's own arguments through untouched", () => {
    const body = buildAccRequest(cfg, "GetProducts", { Offset: "10", Limit: "50" });
    expect(body.Offset).toBe("10");
    expect(body.Limit).toBe("50");
  });

  it("lets a caller override a common parameter for one call", () => {
    expect(buildAccRequest(cfg, "GetProducts", { Currency: "USD" }).Currency).toBe("USD");
  });

  it("omits an empty common parameter rather than sending a blank", () => {
    const body = buildAccRequest({ ...cfg, locale: "", companyId: "" }, "GetProducts");
    expect(body.Locale).toBeUndefined();
    expect(body.CompanyId).toBeUndefined();
  });
});

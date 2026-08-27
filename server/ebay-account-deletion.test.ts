import { describe, it, expect, afterEach } from "vitest";
import { createHash } from "crypto";
import { challengeResponse, validateVerificationToken, deletionEndpointUrl } from "./ebay-account-deletion";

const saved = { ...process.env };
afterEach(() => {
  process.env.EBAY_DELETION_ENDPOINT_URL = saved.EBAY_DELETION_ENDPOINT_URL;
  process.env.PUBLIC_BASE_URL = saved.PUBLIC_BASE_URL;
});

describe("challengeResponse", () => {
  it("hashes challengeCode + verificationToken + endpointUrl, in that order", () => {
    const code = "abc123";
    const token = "a".repeat(32);
    const url = "https://example.com/api/ebay/account-deletion";
    const expected = createHash("sha256").update(code).update(token).update(url).digest("hex");
    expect(challengeResponse(code, token, url)).toBe(expected);
  });

  it("is order-sensitive — the usual cause of a rejected verification", () => {
    const token = "a".repeat(32);
    const url = "https://example.com/hook";
    expect(challengeResponse("code", token, url)).not.toBe(challengeResponse(token, "code", url));
  });

  it("returns hex, which is what eBay compares against", () => {
    const r = challengeResponse("c", "t", "u");
    expect(r).toMatch(/^[0-9a-f]{64}$/);
  });

  it("treats a trailing slash as a different endpoint", () => {
    // eBay hashes the URL it has registered; a mismatch here looks valid but
    // fails verification, so it must not be silently normalised.
    const token = "a".repeat(32);
    expect(challengeResponse("c", token, "https://x.com/hook"))
      .not.toBe(challengeResponse("c", token, "https://x.com/hook/"));
  });
});

describe("validateVerificationToken", () => {
  it("accepts a token inside eBay's limits", () => {
    expect(validateVerificationToken("a".repeat(32)).ok).toBe(true);
    expect(validateVerificationToken("A-b_9".repeat(10)).ok).toBe(true);
  });

  it("rejects tokens that are too short or too long", () => {
    expect(validateVerificationToken("a".repeat(31)).ok).toBe(false);
    expect(validateVerificationToken("a".repeat(81)).ok).toBe(false);
  });

  it("rejects disallowed characters and a missing token", () => {
    expect(validateVerificationToken("a".repeat(31) + "!").ok).toBe(false);
    expect(validateVerificationToken(undefined).ok).toBe(false);
    expect(validateVerificationToken("").ok).toBe(false);
  });
});

describe("deletionEndpointUrl", () => {
  it("prefers the explicit override, since it must match the registration", () => {
    process.env.EBAY_DELETION_ENDPOINT_URL = "https://registered.example/hook";
    process.env.PUBLIC_BASE_URL = "https://other.example";
    expect(deletionEndpointUrl("ignored.example")).toBe("https://registered.example/hook");
  });

  it("falls back to the public base URL, without doubling the slash", () => {
    delete process.env.EBAY_DELETION_ENDPOINT_URL;
    process.env.PUBLIC_BASE_URL = "https://app.example/";
    expect(deletionEndpointUrl()).toBe("https://app.example/api/ebay/account-deletion");
  });

  it("falls back to the request host when nothing is configured", () => {
    delete process.env.EBAY_DELETION_ENDPOINT_URL;
    delete process.env.PUBLIC_BASE_URL;
    expect(deletionEndpointUrl("app.example")).toBe("https://app.example/api/ebay/account-deletion");
  });
});

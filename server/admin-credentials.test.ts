import { describe, it, expect } from "vitest";
import { adminCredentialsFromEnv } from "./admin-credentials";

describe("adminCredentialsFromEnv", () => {
  it("reports 'not configured' when no password is set, leaving the account alone", () => {
    // The common case for a deployment that hasn't opted in — it must not be
    // an error, or every such boot would log a failure.
    expect(adminCredentialsFromEnv({} as any)).toEqual({ configured: false });
  });

  it("accepts a username and email pair", () => {
    const r = adminCredentialsFromEnv({
      ADMIN_USERNAME: "someone@example.com",
      ADMIN_EMAIL: "someone@example.com",
      ADMIN_PASSWORD: "a-long-enough-secret",
    } as any);
    expect(r).toEqual({
      configured: true,
      ok: true,
      credentials: { username: "someone@example.com", email: "someone@example.com", password: "a-long-enough-secret" },
    });
  });

  it("lets an email alone serve as the username", () => {
    const r = adminCredentialsFromEnv({
      ADMIN_EMAIL: "solo@example.com",
      ADMIN_PASSWORD: "a-long-enough-secret",
    } as any);
    expect(r).toMatchObject({ ok: true, credentials: { username: "solo@example.com", email: "solo@example.com" } });
  });

  it("refuses the seeded default password", () => {
    // Otherwise "configured" could still mean the published default is live.
    const r = adminCredentialsFromEnv({ ADMIN_USERNAME: "admin", ADMIN_PASSWORD: "admin123" } as any);
    expect(r).toMatchObject({ configured: true, ok: false });
  });

  it("refuses a password set without an identity, instead of guessing one", () => {
    const r = adminCredentialsFromEnv({ ADMIN_PASSWORD: "a-long-enough-secret" } as any);
    expect(r).toMatchObject({ configured: true, ok: false });
  });

  it("refuses a too-short password and a malformed email", () => {
    expect(adminCredentialsFromEnv({ ADMIN_USERNAME: "a", ADMIN_PASSWORD: "short" } as any))
      .toMatchObject({ ok: false });
    expect(adminCredentialsFromEnv({ ADMIN_EMAIL: "not-an-email", ADMIN_PASSWORD: "a-long-enough-secret" } as any))
      .toMatchObject({ ok: false });
  });

  it("trims surrounding whitespace, a common copy-paste artefact in env vars", () => {
    const r = adminCredentialsFromEnv({
      ADMIN_EMAIL: "  spaced@example.com  ",
      ADMIN_PASSWORD: "a-long-enough-secret",
    } as any);
    expect(r).toMatchObject({ ok: true, credentials: { email: "spaced@example.com" } });
  });
});

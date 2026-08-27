/**
 * eBay Marketplace Account Deletion / Closure notifications.
 *
 * eBay requires every production application to expose an endpoint it can
 * notify when a user closes their account. It is also a stated prerequisite
 * for the Application Growth Check, so an application without it is refused
 * before anyone reads the use case.
 *
 * Two behaviours on one URL:
 *   GET  ?challenge_code=…  -> prove we own the endpoint, by returning
 *                              sha256(challengeCode + verificationToken + endpointUrl)
 *   POST <notification>     -> acknowledge with 2xx
 *
 * The hash inputs must be concatenated in exactly that order, and the endpoint
 * URL must be byte-identical to the one registered with eBay — a trailing
 * slash or http/https mismatch produces a valid-looking hash that eBay
 * rejects, which is the usual reason verification fails.
 */
import { createHash } from "crypto";

export function challengeResponse(
  challengeCode: string,
  verificationToken: string,
  endpointUrl: string,
): string {
  return createHash("sha256")
    .update(challengeCode)
    .update(verificationToken)
    .update(endpointUrl)
    .digest("hex");
}

/**
 * eBay's constraints on the verification token: 32-80 characters, and only
 * alphanumerics, underscore and hyphen. Checked at startup rather than at
 * verification time, so a bad token is a clear message instead of a silent
 * hash mismatch during eBay's callback.
 */
export function validateVerificationToken(token: string | undefined): { ok: boolean; error?: string } {
  if (!token) return { ok: false, error: "EBAY_DELETION_VERIFICATION_TOKEN is not set" };
  if (token.length < 32 || token.length > 80) {
    return { ok: false, error: `token must be 32-80 characters (got ${token.length})` };
  }
  if (!/^[A-Za-z0-9_-]+$/.test(token)) {
    return { ok: false, error: "token may contain only letters, digits, underscore and hyphen" };
  }
  return { ok: true };
}

/**
 * The endpoint URL to hash. Must match the registration exactly, so an
 * explicit override wins over anything inferred from the request.
 */
export function deletionEndpointUrl(host?: string): string {
  const explicit = process.env.EBAY_DELETION_ENDPOINT_URL;
  if (explicit) return explicit.trim();
  const base = process.env.PUBLIC_BASE_URL || (host ? `https://${host}` : "");
  return base ? `${base.replace(/\/+$/, "")}/api/ebay/account-deletion` : "";
}

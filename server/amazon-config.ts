/**
 * Amazon Selling Partner API configuration.
 *
 * Deliberately env-driven and side-effect free: this module must be safe to
 * import when Amazon is not configured at all (which is the state until the
 * developer registration completes), so nothing here throws and nothing here
 * makes a network call. `describeAmazonConfig()` is the self-describing
 * readiness report the status endpoint serves — it never returns secrets,
 * only whether each one is present.
 *
 * Auth is Login with Amazon (LWA) only. AWS IAM / Signature Version 4 has not
 * been required since October 2023; requests carry an `x-amz-access-token`
 * header and nothing else.
 */

/** SP-API regional endpoints. EU covers all European marketplaces. */
export const SP_API_ENDPOINTS = {
  eu: "https://sellingpartnerapi-eu.amazon.com",
  na: "https://sellingpartnerapi-na.amazon.com",
  fe: "https://sellingpartnerapi-fe.amazon.com",
} as const;

export type SpApiRegion = keyof typeof SP_API_ENDPOINTS;

/** LWA token endpoint (same for every region). */
export const LWA_TOKEN_URL = "https://api.amazon.com/auth/o2/token";

/**
 * European marketplace ids. A single European Unified Account can sell on all
 * of these, but each listing call names ONE marketplace — we start with DE
 * (the eBay marketplace we already sell on, same buyers, same language).
 */
export const AMAZON_MARKETPLACES: Record<string, { id: string; country: string; currency: string; domain: string }> = {
  DE: { id: "A1PA6795UKMFR9", country: "DE", currency: "EUR", domain: "amazon.de" },
  FR: { id: "A13V1IB3VIYZZH", country: "FR", currency: "EUR", domain: "amazon.fr" },
  IT: { id: "APJ6JRA9NG5V4", country: "IT", currency: "EUR", domain: "amazon.it" },
  ES: { id: "A1RKKUPIHCS9HS", country: "ES", currency: "EUR", domain: "amazon.es" },
  NL: { id: "A1805IZSGTT6HS", country: "NL", currency: "EUR", domain: "amazon.nl" },
  BE: { id: "AMEN7PMS3EDWL", country: "BE", currency: "EUR", domain: "amazon.com.be" },
  SE: { id: "A2NODRKZP88ZB9", country: "SE", currency: "SEK", domain: "amazon.se" },
  PL: { id: "A1C3SOZRARQ6R3", country: "PL", currency: "PLN", domain: "amazon.pl" },
  IE: { id: "A28R8C7NBKEWEA", country: "IE", currency: "EUR", domain: "amazon.ie" },
  UK: { id: "A1F83G8C2ARO7P", country: "GB", currency: "GBP", domain: "amazon.co.uk" },
};

export interface AmazonConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  /** Seller (merchant) id — the path parameter on every Listings Items call. */
  sellerId: string;
  region: SpApiRegion;
  endpoint: string;
  marketplaceId: string;
  marketplaceCode: string;
  currency: string;
  /** Sandbox swaps the host; LWA and the payloads stay the same. */
  sandbox: boolean;
}

export function getAmazonConfig(): AmazonConfig {
  const region = (process.env.AMAZON_SP_API_REGION || "eu") as SpApiRegion;
  const code = (process.env.AMAZON_MARKETPLACE || "DE").toUpperCase();
  const market = AMAZON_MARKETPLACES[code] ?? AMAZON_MARKETPLACES.DE;
  const sandbox = process.env.AMAZON_SP_API_SANDBOX === "true";
  const base = SP_API_ENDPOINTS[region] ?? SP_API_ENDPOINTS.eu;
  return {
    clientId: process.env.AMAZON_LWA_CLIENT_ID || "",
    clientSecret: process.env.AMAZON_LWA_CLIENT_SECRET || "",
    refreshToken: process.env.AMAZON_LWA_REFRESH_TOKEN || "",
    sellerId: process.env.AMAZON_SELLER_ID || "",
    region,
    endpoint: sandbox ? base.replace("://", "://sandbox.") : base,
    marketplaceId: process.env.AMAZON_MARKETPLACE_ID || market.id,
    marketplaceCode: code,
    currency: process.env.AMAZON_LISTING_CURRENCY || market.currency,
    sandbox,
  };
}

/** Every credential present? The gate every Amazon route checks first. */
export function isAmazonConfigured(): boolean {
  const c = getAmazonConfig();
  return !!(c.clientId && c.clientSecret && c.refreshToken && c.sellerId);
}

/**
 * Readiness report for the status endpoint: which env vars are set, which are
 * missing, and what the resolved target is. Never returns a secret's value —
 * only a boolean — so it is safe to expose in the CRM.
 */
export function describeAmazonConfig(): {
  configured: boolean;
  missing: string[];
  present: string[];
  target: { region: string; endpoint: string; marketplace: string; marketplaceId: string; currency: string; sandbox: boolean };
} {
  const c = getAmazonConfig();
  const required: Array<[string, string]> = [
    ["AMAZON_LWA_CLIENT_ID", c.clientId],
    ["AMAZON_LWA_CLIENT_SECRET", c.clientSecret],
    ["AMAZON_LWA_REFRESH_TOKEN", c.refreshToken],
    ["AMAZON_SELLER_ID", c.sellerId],
  ];
  return {
    configured: isAmazonConfigured(),
    missing: required.filter(([, v]) => !v).map(([k]) => k),
    present: required.filter(([, v]) => !!v).map(([k]) => k),
    target: {
      region: c.region,
      endpoint: c.endpoint,
      marketplace: c.marketplaceCode,
      marketplaceId: c.marketplaceId,
      currency: c.currency,
      sandbox: c.sandbox,
    },
  };
}

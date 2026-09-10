/**
 * Amazon Selling Partner API client.
 *
 * Auth is Login with Amazon only: exchange the long-lived refresh token for a
 * short-lived access token, send it as `x-amz-access-token`. AWS SigV4 has not
 * been required since 2023-10-02, so there is deliberately no AWS SDK, no IAM
 * role and no request signing here.
 *
 * Two things this client takes seriously, both learned from the eBay side:
 *
 *  - RATE LIMITS ARE PER OPERATION, not per account, and Amazon publishes them
 *    as rate+burst. Exceeding them returns 429 with a QuotaExceeded payload.
 *    Every call goes through a token bucket keyed by operation, so a matching
 *    sweep cannot starve a listing publish.
 *  - A THROTTLED CALL IS NOT A VERDICT ABOUT THE PRODUCT. `transient` on the
 *    error tells callers to retry later instead of burning an attempt and
 *    parking a listable SKU (the exact failure mode that parked thousands of
 *    eBay candidates in one night).
 */

import { getAmazonConfig, isAmazonConfigured, LWA_TOKEN_URL, type AmazonConfig } from "./amazon-config";
import { storage } from "./storage";
import { proxyDispatcher } from "./http-proxy";

export interface SpApiResult<T> {
  ok: boolean;
  status: number;
  data?: T;
  /** First Amazon error message, flattened for logs and the UI. */
  error?: string;
  /** Amazon's error code, e.g. "QuotaExceeded", "InvalidInput". */
  code?: string;
  /** True when retrying later could succeed (429/5xx/network). */
  transient?: boolean;
}

/**
 * Published rate limits (requests/second, burst) for the operations we use.
 * Conservative on purpose: Amazon grants higher limits to accounts that need
 * them, but starting above the documented floor just earns 429s.
 */
const RATE_LIMITS: Record<string, { rate: number; burst: number }> = {
  getMarketplaceParticipations: { rate: 0.016, burst: 15 },
  searchCatalogItems: { rate: 2, burst: 2 },
  getCatalogItem: { rate: 2, burst: 2 },
  getListingsItem: { rate: 5, burst: 10 },
  putListingsItem: { rate: 5, burst: 10 },
  patchListingsItem: { rate: 5, burst: 10 },
  deleteListingsItem: { rate: 5, burst: 10 },
  getProductTypeDefinition: { rate: 5, burst: 10 },
  searchProductTypes: { rate: 5, burst: 10 },
  default: { rate: 1, burst: 1 },
};

/** Simple token bucket; one per operation, kept for the life of the process. */
class TokenBucket {
  private tokens: number;
  private last = Date.now();
  constructor(private rate: number, private burst: number) {
    this.tokens = burst;
  }
  /** Resolves when a token is available. */
  async take(): Promise<void> {
    for (;;) {
      const now = Date.now();
      this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.rate);
      this.last = now;
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      const waitMs = Math.ceil(((1 - this.tokens) / this.rate) * 1000);
      // Cap a single wait so a serverless invocation can't park for minutes
      // on a slow bucket; the loop re-checks and waits again if needed.
      await sleep(Math.min(waitMs, 5_000));
    }
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class AmazonSpApiService {
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;
  private buckets = new Map<string, TokenBucket>();

  private config(): AmazonConfig {
    return getAmazonConfig();
  }

  private bucket(operation: string): TokenBucket {
    let b = this.buckets.get(operation);
    if (!b) {
      const limit = RATE_LIMITS[operation] ?? RATE_LIMITS.default;
      b = new TokenBucket(limit.rate, limit.burst);
      this.buckets.set(operation, b);
    }
    return b;
  }

  /**
   * LWA access token, cached until 60s before expiry. Tokens last an hour, so
   * a warm serverless instance reuses one across many calls; a cold one pays
   * a single extra round trip.
   */
  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt) return this.accessToken;
    const c = this.config();
    if (!isAmazonConfigured()) {
      throw new Error(
        "Amazon SP-API is not configured — set AMAZON_LWA_CLIENT_ID, AMAZON_LWA_CLIENT_SECRET, AMAZON_LWA_REFRESH_TOKEN and AMAZON_SELLER_ID",
      );
    }
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: c.refreshToken,
      client_id: c.clientId,
      client_secret: c.clientSecret,
    });
    const res = await fetch(LWA_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const text = await res.text();
    if (!res.ok) {
      // Self-describing: LWA errors are terse and the cause is nearly always
      // one specific credential, so say which call failed and what came back.
      throw new Error(`LWA token request failed: HTTP ${res.status} — ${text.slice(0, 300)}`);
    }
    const json = JSON.parse(text) as { access_token: string; expires_in: number };
    this.accessToken = json.access_token;
    this.tokenExpiresAt = Date.now() + (json.expires_in - 60) * 1000;
    return this.accessToken;
  }

  /** Force the next call to re-fetch a token (used after a 403 token error). */
  private invalidateToken(): void {
    this.accessToken = null;
    this.tokenExpiresAt = 0;
  }

  /**
   * One SP-API request: rate-limited, authorised, retried on throttling and
   * server errors. Never throws for an API-level failure — returns a result
   * so callers can record a per-product reason instead of aborting a sweep.
   */
  async request<T = any>(
    operation: string,
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    opts: { query?: Record<string, string | number | undefined>; body?: unknown; maxRetries?: number } = {},
  ): Promise<SpApiResult<T>> {
    const c = this.config();
    const maxRetries = opts.maxRetries ?? 3;

    let url = `${c.endpoint}${path}`;
    if (opts.query) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(opts.query)) {
        if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
      }
      const s = qs.toString();
      if (s) url += `?${s}`;
    }

    for (let attempt = 0; ; attempt++) {
      await this.bucket(operation).take();
      let token: string;
      try {
        token = await this.getAccessToken();
      } catch (e) {
        return { ok: false, status: 0, error: (e as Error).message, transient: false };
      }

      try {
        await storage.trackApiCall("amazon");
      } catch {
        /* usage tracking must never block a call */
      }

      let res: Response;
      let text: string;
      try {
        // AMAZON_USE_PROXY routes SP-API through the static-IP proxy too.
        // Off by default: Amazon does not whitelist, so the extra hop only
        // earns its keep if their side ever cares about our egress address.
        const dispatcher = process.env.AMAZON_USE_PROXY === "true" ? proxyDispatcher() : undefined;
        res = await fetch(url, {
          method,
          headers: {
            "x-amz-access-token": token,
            "content-type": "application/json",
            accept: "application/json",
            "user-agent": "InventoryPro/1.0 (Language=TypeScript)",
          },
          body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
          ...(dispatcher ? { dispatcher } : {}),
        } as RequestInit);
        text = await res.text();
      } catch (e) {
        // Network failure: transient by nature.
        if (attempt < maxRetries) {
          await sleep(backoffMs(attempt));
          continue;
        }
        return { ok: false, status: 0, error: (e as Error).message, transient: true };
      }

      const parsed = text ? safeJson(text) : undefined;

      if (res.ok) {
        return { ok: true, status: res.status, data: parsed as T };
      }

      const { message, code } = firstError(parsed, text);

      // 403 with a token complaint means the cached token went stale early
      // (clock skew, revocation). Refresh once and retry before giving up.
      if (res.status === 403 && /token|unauthor/i.test(message) && attempt < maxRetries) {
        this.invalidateToken();
        await sleep(backoffMs(attempt));
        continue;
      }

      const transient = res.status === 429 || res.status >= 500;
      if (transient && attempt < maxRetries) {
        await sleep(backoffMs(attempt));
        continue;
      }

      return { ok: false, status: res.status, error: message, code, transient, data: parsed as T };
    }
  }

  // -------------------------------------------------------------------------
  // Operations
  // -------------------------------------------------------------------------

  /**
   * Connection test. Uses the Sellers API, which needs no restricted role and
   * no product data, so it verifies credentials the moment they exist and
   * tells us which marketplaces the account may actually sell on.
   */
  async getMarketplaceParticipations(): Promise<SpApiResult<any>> {
    return this.request("getMarketplaceParticipations", "GET", "/sellers/v1/marketplaceParticipations");
  }

  /**
   * Find the Amazon catalogue entry for a barcode. This is the core of the
   * reseller strategy: we do not create ASINs, we attach an offer to the one
   * that already exists for the manufacturer's product.
   */
  async searchCatalogItemsByIdentifier(
    identifiers: string[],
    identifiersType: "EAN" | "UPC" | "GTIN" | "ASIN" | "SKU" = "EAN",
  ): Promise<SpApiResult<any>> {
    const c = this.config();
    return this.request("searchCatalogItems", "GET", "/catalog/2022-04-01/items", {
      query: {
        identifiers: identifiers.join(","),
        identifiersType,
        marketplaceIds: c.marketplaceId,
        includedData: "identifiers,summaries,attributes,productTypes,salesRanks",
      },
    });
  }

  async getCatalogItem(asin: string): Promise<SpApiResult<any>> {
    const c = this.config();
    return this.request("getCatalogItem", "GET", `/catalog/2022-04-01/items/${encodeURIComponent(asin)}`, {
      query: {
        marketplaceIds: c.marketplaceId,
        includedData: "identifiers,summaries,attributes,productTypes,salesRanks,images",
      },
    });
  }

  async getListingsItem(sku: string): Promise<SpApiResult<any>> {
    const c = this.config();
    return this.request(
      "getListingsItem",
      "GET",
      `/listings/2021-08-01/items/${encodeURIComponent(c.sellerId)}/${encodeURIComponent(sku)}`,
      { query: { marketplaceIds: c.marketplaceId, includedData: "summaries,attributes,issues,offers,fulfillmentAvailability" } },
    );
  }

  /** Create or fully replace a listing. `body` comes from amazon-listing.ts. */
  async putListingsItem(sku: string, body: unknown, opts: { dryRun?: boolean } = {}): Promise<SpApiResult<any>> {
    const c = this.config();
    return this.request(
      "putListingsItem",
      "PUT",
      `/listings/2021-08-01/items/${encodeURIComponent(c.sellerId)}/${encodeURIComponent(sku)}`,
      {
        // mode=VALIDATION_PREVIEW asks Amazon to validate the payload and
        // report issues WITHOUT creating the listing — the Amazon equivalent
        // of ?maxBatches=1, and the only safe way to test a payload live.
        query: { marketplaceIds: c.marketplaceId, ...(opts.dryRun ? { mode: "VALIDATION_PREVIEW" } : {}) },
        body,
      },
    );
  }

  /** Partial update — used for price and quantity changes on a live listing. */
  async patchListingsItem(sku: string, patches: unknown[]): Promise<SpApiResult<any>> {
    const c = this.config();
    return this.request(
      "patchListingsItem",
      "PATCH",
      `/listings/2021-08-01/items/${encodeURIComponent(c.sellerId)}/${encodeURIComponent(sku)}`,
      { query: { marketplaceIds: c.marketplaceId }, body: { productType: "PRODUCT", patches } },
    );
  }

  async deleteListingsItem(sku: string): Promise<SpApiResult<any>> {
    const c = this.config();
    return this.request(
      "deleteListingsItem",
      "DELETE",
      `/listings/2021-08-01/items/${encodeURIComponent(c.sellerId)}/${encodeURIComponent(sku)}`,
      { query: { marketplaceIds: c.marketplaceId } },
    );
  }

  /** Attribute schema for a product type — needed before creating new ASINs. */
  async getProductTypeDefinition(productType: string): Promise<SpApiResult<any>> {
    const c = this.config();
    return this.request(
      "getProductTypeDefinition",
      "GET",
      `/definitions/2020-09-01/productTypes/${encodeURIComponent(productType)}`,
      { query: { marketplaceIds: c.marketplaceId, requirements: "LISTING_OFFER_ONLY", locale: "DEFAULT" } },
    );
  }
}

function backoffMs(attempt: number): number {
  // 1s, 2s, 4s with jitter — Amazon's throttle windows are per second, so a
  // short exponential backoff clears almost every 429.
  return Math.round((2 ** attempt) * 1000 * (0.75 + Math.random() * 0.5));
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 500) };
  }
}

/** Flatten Amazon's `{errors:[{code,message,details}]}` to one line. */
function firstError(parsed: unknown, fallback: string): { message: string; code?: string } {
  const errs = (parsed as any)?.errors;
  if (Array.isArray(errs) && errs.length > 0) {
    const e = errs[0];
    return { message: [e.message, e.details].filter(Boolean).join(" — ") || "unknown error", code: e.code };
  }
  return { message: fallback.slice(0, 300) || "unknown error" };
}

export const amazonSpApi = new AmazonSpApiService();

/**
 * ACC Distribution Customer API v1 client.
 *
 * Shape of the API, from their specification:
 *  - POST only, every method at https://api.accdistribution.net/v1/<Method>
 *  - auth is a LicenseKey INSIDE the JSON body, not a header — so the key
 *    lands in request bodies and must never be logged. It is mandatory on
 *    every call (spec §3.4, Occurs = 1) and is issued by an ACC sales manager;
 *    it is an API credential and does not appear in the B2B portal. Locale,
 *    Currency and CompanyId are all optional (Occurs = 0…n) with sane
 *    published defaults
 *  - body envelope is {"request": { ... }}
 *  - 300 requests per minute overall
 *  - GetProducts additionally rejects IDENTICAL requests sent less than 15
 *    minutes apart ("Repeated requests not allowed") — paging is fine because
 *    each page differs by Offset, but re-running the same import twice inside
 *    the window is not
 *
 * ACC whitelists a single source IP, so every call goes through the outbound
 * proxy and FAILS if the proxy is missing rather than leaking out of Vercel's
 * rotating pool, where it would be rejected for a reason invisible from here.
 */

import { fetchMaybeProxied, describeProxy } from "./http-proxy";
import { productsFromResponse, type AccBranch, type AccProduct } from "./acc-map";

export interface AccConfig {
  baseUrl: string;
  licenseKey: string;
  companyId: string;
  locale: string;
  currency: string;
}

/** Their published demo key: production data, EUR, stock capped at 1. */
export const ACC_DEMO_LICENSE_KEY = "498ec72c-e8e7-48f2-b300-d95666aeb141";

/**
 * CompanyId is NOT a per-customer credential — it selects which company of the
 * group you are buying from, and the specification publishes the complete list
 * (§4 Company codes). There is nothing to request from ACC here; `_al` is the
 * one we trade with.
 *
 * Worth encoding rather than leaving as a free string: a typo would not fail,
 * it would quietly return a different company's catalogue, or none.
 */
export const ACC_COMPANY_CODES: Record<string, string> = {
  _al: "ACC Distribution",
  _xl: "Avad Baltic",
};
export const DEFAULT_ACC_COMPANY_ID = "_al";

export function getAccConfig(): AccConfig | null {
  const licenseKey = (process.env.ACC_LICENSE_KEY || "").trim();
  if (!licenseKey) return null;
  return {
    baseUrl: (process.env.ACC_BASE_URL || "https://api.accdistribution.net/v1").replace(/\/+$/, ""),
    licenseKey,
    companyId: (process.env.ACC_COMPANY_ID || DEFAULT_ACC_COMPANY_ID).trim(),
    locale: (process.env.ACC_LOCALE || "en").trim(),
    currency: (process.env.ACC_CURRENCY || "EUR").trim().toUpperCase(),
  };
}

export function isAccConfigured(): boolean {
  return getAccConfig() !== null;
}

/**
 * Safe to return to a browser: says whether we are wired up and which account
 * shape we will send, and never the key itself. The demo-key flag matters
 * operationally — a demo run reports stock 1 for everything, which would look
 * like a catastrophic stock collapse if mistaken for real data.
 */
export function describeAccConfig(): {
  configured: boolean;
  baseUrl: string | null;
  companyId: string | null;
  /** Which group company that code selects, or null if it is not a known one. */
  company: string | null;
  locale: string | null;
  currency: string | null;
  usingDemoKey: boolean;
  /** The only thing ACC has to issue. Everything else is a published default. */
  needs: string[];
  proxy: ReturnType<typeof describeProxy>;
} {
  const cfg = getAccConfig();
  const companyId = cfg?.companyId ?? DEFAULT_ACC_COMPANY_ID;
  const company = ACC_COMPANY_CODES[companyId] ?? null;
  const needs: string[] = [];
  if (!cfg) needs.push("ACC_LICENSE_KEY — ask your ACC sales manager; it is an API credential, not something the B2B portal shows");
  else if (cfg.licenseKey === ACC_DEMO_LICENSE_KEY) needs.push("a real ACC_LICENSE_KEY — this is their public demo key, so every stock figure is capped at 1 and nothing can be purchased");
  if (!company) needs.push(`ACC_COMPANY_ID "${companyId}" is not a published company code (${Object.keys(ACC_COMPANY_CODES).join(", ")})`);
  if (!describeProxy().configured) needs.push("FEED_PROXY_URL — ACC only answers the whitelisted IP");
  return {
    configured: cfg !== null,
    baseUrl: cfg?.baseUrl ?? null,
    companyId: cfg?.companyId ?? null,
    company,
    locale: cfg?.locale ?? null,
    currency: cfg?.currency ?? null,
    usingDemoKey: cfg?.licenseKey === ACC_DEMO_LICENSE_KEY,
    needs,
    proxy: describeProxy(),
  };
}

export interface AccFilter {
  id: "updatedAfter" | "branch" | "producer" | "stockFlag" | "saleFlag" | string;
  values: string[];
}

export interface AccCallResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error?: string;
  /** Worth retrying right now: network, timeout, 429 or 5xx. */
  transient?: boolean;
  /**
   * Refused by their 15-minute identical-request rule. Distinct from
   * `transient` because retrying it immediately is guaranteed to fail again —
   * only a different request, or a quarter of an hour, clears it.
   */
  throttled?: boolean;
  /** How many attempts it took, so a flaky path is visible in the result. */
  attempts?: number;
  ms: number;
}

/** Their throttle message is a 200-with-text in some cases, so match on it. */
const REPEATED_REQUEST_RE = /repeated requests not allowed/i;

/**
 * How many times to try one call before giving up.
 *
 * Every ACC request crosses an extra hop — a 2 EUR VPS running tinyproxy —
 * which can fail (CONNECT refused, tunnel timeout) entirely independently of
 * ACC being healthy. A full catalogue walk is ~25 paged calls, and without
 * retries any single hiccup ends the slice with the cursor stuck where it was.
 * Cheap insurance, bounded by the caller's deadline below so it cannot turn
 * into a slice that spends its whole budget on one page.
 */
const MAX_ATTEMPTS = 4;

/**
 * Per-attempt timeout. A page of products comes back in a couple of seconds
 * when the tunnel is healthy; anything near a minute is a tunnel that will not
 * recover, and waiting two more minutes for it only burns the slice.
 */
const DEFAULT_TIMEOUT_MS = 60_000;

/** 1s, 3s, 9s — long enough for a stuck tunnel to be torn down and remade. */
function backoffMs(attempt: number): number {
  return 1000 * Math.pow(3, attempt - 1);
}

/**
 * Should this outcome be tried again?
 *
 * Pure, so the policy is testable without a network: a throttle refusal is
 * never retried in-process (their window is 15 minutes), and a definite answer
 * from ACC — success, or a 4xx that is not 429 — is the answer.
 */
export function shouldRetryAcc(
  result: Pick<AccCallResult<unknown>, "ok" | "transient" | "throttled">,
  attempt: number,
  maxAttempts = MAX_ATTEMPTS,
): boolean {
  if (result.ok) return false;
  if (result.throttled) return false;
  if (!result.transient) return false;
  return attempt < maxAttempts;
}

/**
 * Request budget. Their published ceiling is 300/min; we pace well under it —
 * nothing here is latency-critical, and a distributor that IP-whitelists us
 * can un-whitelist us just as easily.
 */
class MinuteBudget {
  private stamps: number[] = [];
  constructor(private readonly max: number) {}

  async take(): Promise<void> {
    for (;;) {
      const now = Date.now();
      this.stamps = this.stamps.filter((t) => now - t < 60_000);
      if (this.stamps.length < this.max) {
        this.stamps.push(now);
        return;
      }
      const waitMs = 60_000 - (now - this.stamps[0]) + 50;
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
}

export class AccApiService {
  private readonly budget = new MinuteBudget(120);

  constructor(private readonly cfg: AccConfig) {}

  /**
   * One POST, retried while the failure looks like the flaky tunnel rather
   * than an answer from ACC. Never throws for an API-level failure — callers
   * get a result object and decide, the same contract as the Amazon client,
   * because a half-finished import must be able to report what it did before
   * it stopped.
   */
  async call<T = unknown>(
    method: string,
    request: Record<string, unknown>,
    opts: { timeoutMs?: number; deadline?: number } = {},
  ): Promise<AccCallResult<T>> {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    let last: AccCallResult<T> | null = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      last = await this.attemptCall<T>(method, request, timeoutMs);
      if (!shouldRetryAcc(last, attempt)) return { ...last, attempts: attempt };
      // Retries must not eat the caller's whole time budget. A slice that
      // spends 250s retrying one stuck page makes no progress and will do the
      // same thing on its next tick; better to stop, report, and resume.
      const wait = backoffMs(attempt);
      if (opts.deadline && Date.now() + wait + timeoutMs > opts.deadline) {
        return { ...last, attempts: attempt };
      }
      await new Promise((r) => setTimeout(r, wait));
    }
    return { ...(last as AccCallResult<T>), attempts: MAX_ATTEMPTS };
  }

  private async attemptCall<T = unknown>(method: string, request: Record<string, unknown>, timeoutMs: number): Promise<AccCallResult<T>> {
    const started = Date.now();
    await this.budget.take();

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    (timer as any).unref?.();

    try {
      const res = await fetchMaybeProxied(
        `${this.cfg.baseUrl}/${method}`,
        {
          method: "POST",
          signal: ac.signal,
          headers: {
            "Content-Type": "application/json; charset=UTF-8",
            Accept: "application/json",
            "User-Agent": "InventoryPro/1.0 (catalogue import)",
          },
          body: JSON.stringify({
            request: {
              LicenseKey: this.cfg.licenseKey,
              Locale: this.cfg.locale,
              Currency: this.cfg.currency,
              CompanyId: this.cfg.companyId,
              ...request,
            },
          }),
        },
        // ACC whitelists one IP: going direct is worse than failing.
        { useProxy: true, requireProxy: true },
      );

      const text = await res.text();
      const ms = Date.now() - started;

      if (REPEATED_REQUEST_RE.test(text)) {
        return {
          ok: false,
          status: res.status,
          data: null,
          error: "ACC refused an identical request — their GetProducts throttle is 15 minutes between identical calls",
          throttled: true,
          ms,
        };
      }

      if (!res.ok) {
        return {
          ok: false,
          status: res.status,
          data: null,
          // Their errors come back as text or OData JSON; either way the body
          // is the only useful diagnostic, so pass a bounded slice through.
          error: `HTTP ${res.status} ${res.statusText}: ${text.slice(0, 500)}`,
          transient: res.status === 429 || res.status >= 500,
          ms,
        };
      }

      let data: T;
      try {
        data = JSON.parse(text) as T;
      } catch {
        return {
          ok: false,
          status: res.status,
          data: null,
          error: `expected JSON, got ${(res.headers.get("content-type") || "?")}: ${text.slice(0, 300)}`,
          ms,
        };
      }
      return { ok: true, status: res.status, data, ms };
    } catch (e) {
      const message = (e as Error).message || String(e);
      return {
        ok: false,
        status: 0,
        data: null,
        error: message,
        // An abort here is our own timeout, which is worth another go.
        transient: true,
        ms: Date.now() - started,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /** One page of the catalogue. */
  async getProducts(opts: { offset?: number; limit?: number; filters?: AccFilter[]; deadline?: number } = {}): Promise<AccCallResult<{ products: AccProduct[]; raw: unknown }>> {
    const request: Record<string, unknown> = {};
    if (opts.offset != null) request.Offset = String(opts.offset);
    if (opts.limit != null) request.Limit = String(opts.limit);
    if (opts.filters?.length) request.Filters = opts.filters;

    const r = await this.call<unknown>("GetProducts", request, { deadline: opts.deadline });
    if (!r.ok) return { ...r, data: null } as AccCallResult<{ products: AccProduct[]; raw: unknown }>;
    return { ...r, data: { products: productsFromResponse(r.data), raw: r.data } };
  }

  /** Full product detail — the only place parameters (and any weight) live. */
  async getProduct(productId: string): Promise<AccCallResult<AccProduct | null>> {
    const r = await this.call<{ Product?: AccProduct }>("GetProduct", { ProductId: productId });
    if (!r.ok) return { ...r, data: null };
    return { ...r, data: r.data?.Product ?? null };
  }

  /** The e-commerce category tree, for turning branch ids into a real path. */
  async getTreeBranches(): Promise<AccCallResult<AccBranch[]>> {
    const r = await this.call<{ TreeBranches?: AccBranch[] }>("GetTreeBranches", {});
    if (!r.ok) return { ...r, data: null };
    return { ...r, data: Array.isArray(r.data?.TreeBranches) ? r.data!.TreeBranches! : [] };
  }
}

export function accApi(): AccApiService | null {
  const cfg = getAccConfig();
  return cfg ? new AccApiService(cfg) : null;
}

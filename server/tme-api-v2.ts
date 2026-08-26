/**
 * TME API v2 client.
 *
 * v2 is a REST/OAuth API ("Current Version"); v1 is the HMAC-signed legacy
 * one we have been running on. Confirmed against the live account:
 *   - the EXISTING v1 token/secret authenticate against v2 unchanged
 *   - prices come back EUR / NET, matching what our margin maths assumes
 *   - /products/data carries the availability split we could not get from v1
 *
 * Why migrating is worth it (TME support + spec, 2026-08):
 *   - /products/data allows 4 req/sec vs v1's 2 — double the sync throughput
 *   - product_status exposes CANNOT_BE_ORDERED / NOT_IN_OFFER / DANGEROUS …
 *   - search returns up to 100 per page instead of 20
 *   - /products/symbols enumerates the catalogue cheaply
 *   - Accept-Language returns localised (e.g. German) product data
 *
 * This client is additive: getPricesAndStocksCompat() returns the exact v1
 * shape, so the sync can switch over without touching downstream code.
 */
const V2_BASE = "https://api.tme.eu";

// TME support (2026-08), v2 limits: /products/data 4 req/sec, everything
// else 10 req/sec. No published daily quota.
const RPS_PRODUCTS_DATA = Number(process.env.TME_V2_RPS_DATA) || 4;
const RPS_DEFAULT = Number(process.env.TME_V2_RPS_DEFAULT) || 10;

// Documented maximum symbols per request for the batch endpoints.
export const V2_MAX_SYMBOLS = 50;

export interface V2PriceTier { amount: number; price: number; special: boolean }
export interface V2Delivery {
  status: string;               // DS_AVAILABLE_IN_STOCK | DS_DELIVERY_NEEDS_CONFIRMATION | …
  amount: number;
  data: { waiting_period?: string; supply_date?: string } | null;
}
export interface V2ProductData {
  symbol: string;
  stock_quantity: number;
  prices?: { elements: V2PriceTier[]; tax?: { type: string; rate: number }; currency?: string; type?: string };
  deliveries?: { elements: V2Delivery[] };
}

/** Availability statuses that mean "shippable from stock right now". */
const IN_STOCK_STATUSES = new Set(["DS_AVAILABLE_IN_STOCK"]);

/**
 * Product statuses that must PREVENT listing. Straight from the spec:
 *   CANNOT_BE_ORDERED  — not available for sale in your country
 *   NOT_IN_OFFER       — no longer in TME's offer
 *   PRODUCT_BLOCKED    — blocked for sale
 *   ONLY_FOR_SPECIAL_ORDER — requires contacting their sales department
 *   INVALID            — TME holds no usable information about it
 */
export const BLOCKING_PRODUCT_STATUSES = new Set([
  "CANNOT_BE_ORDERED",
  "NOT_IN_OFFER",
  "PRODUCT_BLOCKED",
  "ONLY_FOR_SPECIAL_ORDER",
  "INVALID",
]);

/** Statuses that don't block listing but must change how we ship or price. */
export const CAUTION_PRODUCT_STATUSES = new Set([
  "DANGEROUS",        // cannot go by air — shipping policy must account for it
  "OVERSIZED",        // large package — likewise
  "EXTERNAL_WAREHOUSE", // longer lead time -> handling time
  "HARDLY_AVAILABLE",
  "MOQ_VALID_WHILE_STOCKS_LAST", // MOQ may change once sold out
]);

export function isListable(statuses: string[] | undefined | null): { ok: boolean; blockedBy: string[]; cautions: string[] } {
  const list = statuses ?? [];
  const blockedBy = list.filter((s) => BLOCKING_PRODUCT_STATUSES.has(s));
  const cautions = list.filter((s) => CAUTION_PRODUCT_STATUSES.has(s));
  return { ok: blockedBy.length === 0, blockedBy, cautions };
}

/**
 * How many units can actually ship NOW.
 *
 * `deliveries` is returned per requested quantity (amounts[]), split by
 * status: in-stock versus awaiting a supply date. Summing only the in-stock
 * entries is the honest sellable figure — the distinction v1 never gave us.
 * Falls back to stock_quantity when the delivery scope wasn't requested.
 */
export function availableNow(p: V2ProductData): number {
  const els = p.deliveries?.elements;
  if (els && els.length > 0) {
    // An all-incoming response legitimately sums to 0: nothing ships today.
    return els
      .filter((d) => IN_STOCK_STATUSES.has(d.status))
      .reduce((sum, d) => sum + (Number(d.amount) || 0), 0);
  }
  return Number(p.stock_quantity) || 0;
}

/** Earliest supply date across incoming deliveries, if any. */
export function incomingSupplyDate(p: V2ProductData): string | null {
  const els = p.deliveries?.elements ?? [];
  const dates = els
    .filter((d) => !IN_STOCK_STATUSES.has(d.status) && d.data?.supply_date)
    .map((d) => d.data!.supply_date as string)
    .sort();
  return dates[0] ?? null;
}

export class TmeApiV2 {
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;
  private lastCallAt = 0;

  private get credentials() {
    return {
      token: process.env.TME_V2_TOKEN || process.env.TME_TOKEN || "",
      secret: process.env.TME_V2_SECRET || process.env.TME_APPLICATION_SECRET || "",
    };
  }

  isConfigured(): boolean {
    const c = this.credentials;
    return !!(c.token && c.secret);
  }

  /**
   * OAuth access token, cached. Tokens live 300 s; refresh 60 s early so a
   * long batch never dies mid-flight on a serverless invocation.
   */
  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 60_000) {
      return this.accessToken;
    }
    const { token, secret } = this.credentials;
    if (!token || !secret) throw new Error("TME v2: credentials not configured");

    const basic = Buffer.from(`${token}:${secret}`).toString("base64");
    const r = await fetch(`${V2_BASE}/auth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${basic}` },
      body: "grant_type=client_credentials",
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`TME v2 auth failed: ${r.status} ${text.slice(0, 200)}`);
    const data = JSON.parse(text);
    this.accessToken = data.access_token;
    this.tokenExpiresAt = Date.now() + (Number(data.expires_in) || 300) * 1000;
    return this.accessToken!;
  }

  private async pace(path: string): Promise<void> {
    const rps = path.startsWith("/products/data") ? RPS_PRODUCTS_DATA : RPS_DEFAULT;
    const minInterval = Math.ceil((1000 / rps) * 1.1); // 10% headroom
    const elapsed = Date.now() - this.lastCallAt;
    if (this.lastCallAt > 0 && elapsed < minInterval) {
      await new Promise((r) => setTimeout(r, minInterval - elapsed));
    }
  }

  private async get<T = any>(path: string, params: URLSearchParams): Promise<T> {
    await this.pace(path);
    const token = await this.getAccessToken();

    // Defaults that must never be implicit: currency (TME otherwise returns
    // the customer-configuration default) and language.
    if (!params.has("currency")) params.set("currency", process.env.TME_CURRENCY || "EUR");
    if (process.env.TME_COUNTRY && !params.has("country")) params.set("country", process.env.TME_COUNTRY);

    const maxAttempts = 3;
    for (let attempt = 1; ; attempt++) {
      this.lastCallAt = Date.now();
      const r = await fetch(`${V2_BASE}${path}?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "Accept-Language": process.env.TME_LANGUAGE_V2 || "en",
        },
      });
      // Imported lazily: a module-level storage import pulls in db.ts, which
      // throws when DATABASE_URL is absent — that would make this file's pure
      // helpers (availableNow, isListable) impossible to unit-test.
      try {
        const { storage } = await import("./storage");
        await storage.trackApiCall("tme");
      } catch { /* best-effort */ }

      if ((r.status === 429 || r.status >= 500) && attempt < maxAttempts) {
        const retryAfter = Number(r.headers.get("retry-after"));
        await new Promise((res) => setTimeout(res, retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** (attempt - 1)));
        continue;
      }
      const text = await r.text();
      if (!r.ok) throw new Error(`TME v2 ${path} failed: ${r.status} ${text.slice(0, 300)}`);
      return JSON.parse(text);
    }
  }

  /**
   * Prices, stock and (optionally) per-quantity delivery availability.
   * `amounts` is required by TME whenever the delivery scope is requested and
   * must be positionally aligned with `symbols`.
   */
  async getProductsData(
    symbols: string[],
    opts: { withDeliveries?: boolean; amounts?: number[] } = {},
  ): Promise<V2ProductData[]> {
    if (symbols.length === 0) return [];
    const out: V2ProductData[] = [];

    for (let i = 0; i < symbols.length; i += V2_MAX_SYMBOLS) {
      const batch = symbols.slice(i, i + V2_MAX_SYMBOLS);
      const params = new URLSearchParams();
      params.append("scope[]", "prices");
      params.append("scope[]", "stock");
      if (opts.withDeliveries) {
        params.append("scope[]", "delivery");
        const amounts = opts.amounts?.slice(i, i + V2_MAX_SYMBOLS) ?? batch.map(() => 1);
        for (const a of amounts) params.append("amounts[]", String(a));
      }
      for (const s of batch) params.append("symbols[]", s);

      const data = await this.get(`/products/data`, params);
      const els: V2ProductData[] = data?.data?.elements ?? [];

      // Guard the price basis exactly as the v1 client does: a currency or
      // tax-basis change must fail loudly, never silently reprice everything.
      const first = els.find((e) => e.prices);
      if (first?.prices) {
        const expected = (process.env.TME_CURRENCY || "EUR").toUpperCase();
        const got = (first.prices.currency || "").toUpperCase();
        if (got && got !== expected) {
          throw new Error(`TME v2 returned ${got} prices but we price in ${expected}`);
        }
        const type = (first.prices.type || "").toUpperCase();
        if (type && type !== "NET") {
          throw new Error(`TME v2 returned ${type} prices; margin maths assumes NET`);
        }
      }
      out.push(...els);
    }
    return out;
  }

  /** Product details (descriptions, weight, MOQ, status, images). */
  async getProducts(symbols: string[]): Promise<any[]> {
    if (symbols.length === 0) return [];
    const out: any[] = [];
    for (let i = 0; i < symbols.length; i += V2_MAX_SYMBOLS) {
      const params = new URLSearchParams();
      for (const s of symbols.slice(i, i + V2_MAX_SYMBOLS)) params.append("symbols[]", s);
      const data = await this.get(`/products`, params);
      out.push(...(data?.data?.products?.elements ?? data?.data?.elements ?? []));
    }
    return out;
  }

  /**
   * Catalogue search. Page size up to 100 — five times v1's fixed 20, which
   * is the direct cure for slow category browsing in TME Browser.
   */
  async search(opts: { phrase?: string; categoryId?: number | string; page?: number; limit?: number }): Promise<{
    products: any[]; page: number; pages: number; count: number;
  }> {
    const params = new URLSearchParams();
    params.append("scope[]", "products");
    params.append("scope[]", "counters");
    if (opts.phrase) params.set("phrase", opts.phrase);
    if (opts.categoryId != null) params.set("category_id", String(opts.categoryId));
    params.set("page", String(opts.page ?? 1));
    params.set("limit", String(Math.min(100, Math.max(1, opts.limit ?? 100))));

    const data = await this.get(`/products/search`, params);
    const counters = data?.data?.counters ?? {};
    return {
      products: data?.data?.products?.elements ?? [],
      page: counters.page ?? opts.page ?? 1,
      pages: counters.pages ?? 1,
      count: counters.count ?? 0,
    };
  }

  /** Symbols only — the cheap way to enumerate a category or the catalogue. */
  async getSymbols(opts: { categoryId?: number | string; page?: number } = {}): Promise<{ symbols: string[]; pages: number }> {
    const params = new URLSearchParams();
    if (opts.categoryId != null) params.set("category_id", String(opts.categoryId));
    if (opts.page != null) params.set("page", String(opts.page));
    const data = await this.get(`/products/symbols`, params);
    return { symbols: data?.data?.elements ?? [], pages: data?.data?.pages ?? 1 };
  }

  /** Technical parameters — the source for eBay item specifics. */
  async getParameters(symbols: string[]): Promise<any[]> {
    if (symbols.length === 0) return [];
    const out: any[] = [];
    for (let i = 0; i < symbols.length; i += V2_MAX_SYMBOLS) {
      const params = new URLSearchParams();
      for (const s of symbols.slice(i, i + V2_MAX_SYMBOLS)) params.append("symbols[]", s);
      const data = await this.get(`/products/parameters`, params);
      out.push(...(data?.data?.elements ?? []));
    }
    return out;
  }

  /**
   * v1-shaped price/stock, so the existing sync can switch to v2 without any
   * downstream change. `Amount` carries the TRULY sellable quantity (the
   * in-stock portion of deliveries) rather than raw warehouse stock.
   */
  async getPricesAndStocksCompat(symbols: string[]): Promise<Array<{
    Symbol: string;
    Amount: number;
    PriceList: Array<{ Amount: number; PriceValue: number; PriceBase: number; Special: boolean }>;
    StockQuantity: number;
    SupplyDate: string | null;
  }>> {
    const els = await this.getProductsData(symbols, {
      withDeliveries: true,
      amounts: symbols.map(() => 1),
    });
    return els.map((e) => ({
      Symbol: e.symbol,
      Amount: availableNow(e),
      StockQuantity: Number(e.stock_quantity) || 0,
      SupplyDate: incomingSupplyDate(e),
      PriceList: (e.prices?.elements ?? []).map((t) => ({
        Amount: t.amount,
        PriceValue: t.price,
        PriceBase: t.price,
        Special: !!t.special,
      })),
    }));
  }
}

export const tmeApiV2 = new TmeApiV2();

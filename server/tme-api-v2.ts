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
 * TME product language for the eBay marketplace we sell on. Must be one of
 * the codes /utils/languages returns; TME falls back to English per-field
 * where no translation exists, so an unsupported choice degrades rather than
 * fails. Keyed off EBAY_MARKETPLACE_SITE_ID so language and marketplace can
 * never drift apart.
 */
export function tmeLanguageForMarketplace(): string {
  const map: Record<string, string> = {
    "0": "en", "3": "en", "77": "de", "71": "fr", "101": "it", "186": "es",
    "205": "en", "146": "nl", "23": "fr", "16": "en",
  };
  return map[process.env.EBAY_MARKETPLACE_SITE_ID || "77"] || "en";
}

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
 * Of a REQUESTED quantity, how many units ship from stock right now.
 *
 * IMPORTANT semantics: `deliveries` is not a general availability breakdown —
 * it answers "how would the quantity in amounts[] be fulfilled?". Ask for 1
 * unit and a product with 1,628 in stock replies DS_AVAILABLE_IN_STOCK: 1.
 * So this is only meaningful relative to the quantity that was requested, and
 * must never be treated as the product's total sellable stock (doing so caps
 * every listing at the amount we happened to ask about).
 *
 * For "how much stock exists", use stock_quantity — TME support confirmed it
 * is the real, real-time warehouse figure.
 */
export function shippableOfRequested(p: V2ProductData): number {
  const els = p.deliveries?.elements;
  if (!els || els.length === 0) return 0;
  // An all-incoming response legitimately sums to 0: nothing ships today.
  return els
    .filter((d) => IN_STOCK_STATUSES.has(d.status))
    .reduce((sum, d) => sum + (Number(d.amount) || 0), 0);
}

/**
 * Can `requested` units ship today? The real oversell guard: run it for the
 * quantity we actually intend to sell, not for 1.
 */
export function canShipNow(p: V2ProductData, requested: number): boolean {
  return shippableOfRequested(p) >= requested;
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
          // Match TME's product language to the marketplace we actually sell
          // on: eBay.de listings built from English descriptions rank worse
          // and read badly to German buyers. Derived from the configured eBay
          // site so the two can't drift apart; TME falls back to English for
          // any field it has no translation for. TME_LANGUAGE_V2 overrides.
          "Accept-Language": process.env.TME_LANGUAGE_V2 || tmeLanguageForMarketplace(),
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

  /**
   * Map a v2 product onto the v1 shape the TME Browser UI already renders,
   * so the browser gains v2's benefits without a frontend rewrite.
   * Also carries ProductStatusList, which v1 never populated.
   */
  static toV1Shape(p: any): any {
    const photo = p?.assets?.primary_photo?.prime || null;
    const thumb = p?.assets?.primary_photo?.thumbnail || null;
    const abs = (u: string | null) => (u && u.startsWith("//") ? `https:${u}` : u);
    return {
      Symbol: p.symbol,
      Description: p.description ?? "",
      Producer: p?.manufacturer?.name ?? "",
      EAN: p.ean ?? "",
      CategoryId: p?.category?.id ?? null,
      Category: p?.category?.name ?? "",
      Photo: abs(photo),
      Thumbnail: abs(thumb),
      Weight: p?.weight?.value ?? null,
      WeightUnit: p?.weight?.unit ?? null,
      MinAmount: p.minimal_amount ?? 1,
      Multiples: p.multiples ?? 1,
      ProductStatusList: Array.isArray(p.product_status) ? p.product_status : [],
    };
  }

  /**
   * One page of a category, WITH live stock and price.
   *
   * v1 could only fetch 20 per page and returned neither stock nor price, so
   * the browser showed "Unknown" until the operator clicked Load Prices. v2
   * fetches 100 per page and we enrich with /products/data, which costs 2
   * extra calls per 100 products but replaces a separate manual step — and
   * lets us apply the in-stock filter server-side (v2 search has a `filter`
   * object whose syntax the documentation does not expand, so we filter on
   * the stock figures we already fetched).
   */
  async getCategoryPageEnriched(
    categoryId: string | number,
    page: number,
    opts: { limit?: number; inStockOnly?: boolean } = {},
  ): Promise<{ products: any[]; page: number; pages: number; total: number }> {
    const limit = Math.min(100, Math.max(1, opts.limit ?? 100));
    const res = await this.search({ categoryId, page, limit });
    const mapped = res.products.map((p: any) => TmeApiV2.toV1Shape(p));
    if (mapped.length === 0) return { products: [], page: res.page, pages: res.pages, total: res.count };

    // Enrich with stock/price (2 calls per 100 symbols).
    let dataBySymbol = new Map<string, V2ProductData>();
    try {
      const data = await this.getProductsData(mapped.map((m) => m.Symbol));
      dataBySymbol = new Map(data.map((d) => [d.symbol, d]));
    } catch {
      /* enrichment is best-effort: the page still renders without it */
    }

    let products = mapped.map((m) => {
      const d = dataBySymbol.get(m.Symbol);
      return {
        ...m,
        Amount: d ? Number(d.stock_quantity) || 0 : null,
        PriceList: (d?.prices?.elements ?? []).map((t) => ({
          Amount: t.amount, PriceValue: t.price, PriceBase: t.price, Special: !!t.special,
        })),
      };
    });
    if (opts.inStockOnly) {
      // null = stock unknown (enrichment failed); keep it rather than hide a
      // product because of our own fetch problem.
      products = products.filter((p) => p.Amount == null || p.Amount > 0);
    }
    return { products, page: res.page, pages: res.pages, total: res.count };
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
   * v1-shaped price/stock so the sync can switch to v2 with no downstream
   * change. `Amount` is stock_quantity — TME's real, real-time warehouse
   * figure. It deliberately does NOT use the deliveries split: that answers
   * "how would N units be fulfilled?" for the N you asked about, so folding
   * it in here would cap every product at the requested quantity.
   *
   * Use checkShippable() for the oversell guard at the quantity that matters.
   */
  async getPricesAndStocksCompat(symbols: string[]): Promise<Array<{
    Symbol: string;
    Amount: number;
    PriceList: Array<{ Amount: number; PriceValue: number; PriceBase: number; Special: boolean }>;
  }>> {
    const els = await this.getProductsData(symbols);
    return els.map((e) => ({
      Symbol: e.symbol,
      Amount: Number(e.stock_quantity) || 0,
      PriceList: (e.prices?.elements ?? []).map((t) => ({
        Amount: t.amount,
        PriceValue: t.price,
        PriceBase: t.price,
        Special: !!t.special,
      })),
    }));
  }

  /**
   * THE oversell guard: for each symbol, ask TME whether the specific
   * quantity we intend to sell can ship today, and when the rest arrives.
   * Run this for the eBay listing quantity — not for 1 — before publishing
   * or raising stock on a listing.
   */
  async checkShippable(
    symbols: string[],
    quantities: number[],
  ): Promise<Map<string, { requested: number; shippableNow: number; canShip: boolean; supplyDate: string | null }>> {
    const out = new Map<string, { requested: number; shippableNow: number; canShip: boolean; supplyDate: string | null }>();
    if (symbols.length === 0) return out;
    const amounts = symbols.map((_, i) => Math.max(1, quantities[i] ?? 1));
    const els = await this.getProductsData(symbols, { withDeliveries: true, amounts });
    const wantBySymbol = new Map(symbols.map((s, i) => [s, amounts[i]]));
    for (const e of els) {
      const requested = wantBySymbol.get(e.symbol) ?? 1;
      const shippableNow = shippableOfRequested(e);
      out.set(e.symbol, {
        requested,
        shippableNow,
        canShip: shippableNow >= requested,
        supplyDate: incomingSupplyDate(e),
      });
    }
    return out;
  }
}

export const tmeApiV2 = new TmeApiV2();

/**
 * eBay Marketplace Insights API client — READ ONLY (beta).
 *
 * Endpoint: /buy/marketplace_insights/v1_beta/item_sales/search
 * Returns recently-SOLD items for a query — the actual sales signal, vs
 * Browse which only shows active listings (potential sales).
 *
 * IMPORTANT: this API is gated. Your eBay developer app must be approved
 * for the buy.marketplace.insights scope before any call returns data; an
 * unapproved app gets 403. The client surfaces that case clearly so the
 * caller can show "needs eBay approval" instead of failing silently.
 */
import { ebayOAuth } from "./ebay-oauth";
import { storage } from "./storage";

const INSIGHTS_BASE = "https://api.ebay.com/buy/marketplace_insights/v1_beta";

function marketplaceId(): string {
  const map: Record<string, string> = {
    "0": "EBAY_US", "3": "EBAY_GB", "77": "EBAY_DE",
    "71": "EBAY_FR", "101": "EBAY_IT", "186": "EBAY_ES",
  };
  return map[process.env.EBAY_MARKETPLACE_SITE_ID || "77"] || "EBAY_DE";
}

export interface InsightsSoldItem {
  itemId: string;
  title: string;
  price?: { value: string; currency: string };
  // Sold-date field name varies in Marketplace Insights' beta payloads;
  // we accept any of the plausible candidates and normalise on parse.
  lastSoldDate?: string;
  soldDate?: string;
  dateOfSale?: string;
  seller?: { username?: string };
}

export interface InsightsSearchResult {
  ok: boolean;
  total: number;
  items: InsightsSoldItem[];
  // Distinct from generic error: the app isn't allow-listed. The page can
  // surface a specific call-to-action instead of a generic failure.
  notApproved?: boolean;
  error?: string;
  httpStatus?: number;
}

// A single sold transaction, normalised for the market-research aggregator.
// Unlike InsightsSoldItem this captures the seller/item COUNTRY (for the
// "exclude CN/HK" junk filter) and the sold QUANTITY (an item can sell many
// units in the window).
export interface MarketSoldItem {
  itemId: string;
  title: string;
  price: number | null;
  currency: string | null;
  soldQuantity: number;
  lastSoldDate: string | null;
  sellerUsername: string | null;
  country: string | null; // ISO-2 item-location country, uppercased
  categoryPath: string | null;
  itemWebUrl: string | null;
}

export interface MarketSearchResult {
  ok: boolean;
  total: number;
  items: MarketSoldItem[];
  notApproved?: boolean;
  error?: string;
  httpStatus?: number;
}

export class EbayInsightsApiService {
  private async headers(): Promise<Record<string, string>> {    const token = await ebayOAuth.getValidAccessToken();
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-EBAY-C-MARKETPLACE-ID": marketplaceId(),
    };
  }

  /**
   * Search sold items in the last `windowDays` for `query` (EAN or SKU),
   * sorted newest first. Up to `limit` items (Insights caps at 200).
   */
  async searchSold(query: string, opts: { limit?: number; windowDays?: number } = {}): Promise<InsightsSearchResult> {
    if (!query || !query.trim()) {
      return { ok: false, total: 0, items: [], error: "empty query" };
    }
    const limit = Math.min(200, Math.max(1, opts.limit ?? 50));
    const windowDays = Math.min(90, Math.max(1, opts.windowDays ?? 30));
    // Insights expects a lastSoldDate range filter; we cap to the window.
    const from = new Date(Date.now() - windowDays * 24 * 3600 * 1000).toISOString();
    const filter = `lastSoldDate:[${from}..]`;

    const params = new URLSearchParams({
      q: query.trim(),
      filter,
      limit: String(limit),
    });
    const url = `${INSIGHTS_BASE}/item_sales/search?${params.toString()}`;
    try {
      const resp = await fetch(url, { headers: await this.headers() });
      try { await storage.trackApiCall("ebay"); } catch { /* best-effort */ }
      const text = await resp.text();
      if (!resp.ok) {
        // 403 from the gateway/edge with "Insufficient permissions"-style
        // body is the unapproved-app signal. 404 on the endpoint itself
        // also indicates the API isn't enabled for this token.
        const notApproved =
          resp.status === 403 ||
          (resp.status === 404 && /insights|not.*enabled|scope/i.test(text));
        return {
          ok: false,
          total: 0,
          items: [],
          notApproved,
          httpStatus: resp.status,
          error: text.slice(0, 300),
        };
      }
      const data = text ? JSON.parse(text) : {};
      // Tolerate field-name variants between Insights beta versions.
      const items: InsightsSoldItem[] = data.itemSales ?? data.items ?? [];
      return { ok: true, total: data.total ?? items.length, items };
    } catch (e) {
      return { ok: false, total: 0, items: [], error: (e as Error).message };
    }
  }

  /**
   * MARKET-first sold search: query the whole marketplace by keyword and/or
   * category (not a single EAN), returning normalised sold transactions with
   * seller country + sold quantity so the caller can aggregate the real top
   * sellers and filter out junk. This is the Terapeak "sold items" signal.
   *
   * The price floor is applied at the API level (cheap junk never fetched);
   * country filtering is done by the caller on the parsed `country` field,
   * because Insights' itemLocationCountry filter is inclusive-only (can't
   * express "not CN").
   */
  async searchSoldMarket(opts: {
    q?: string;
    categoryIds?: string;
    limit?: number;
    windowDays?: number;
    minPrice?: number;
    currency?: string;
  }): Promise<MarketSearchResult> {
    const q = (opts.q || "").trim();
    const categoryIds = (opts.categoryIds || "").trim();
    if (!q && !categoryIds) {
      return { ok: false, total: 0, items: [], error: "provide a keyword or a category" };
    }
    const limit = Math.min(200, Math.max(1, opts.limit ?? 200));
    const windowDays = Math.min(90, Math.max(1, opts.windowDays ?? 30));
    const currency = opts.currency || "EUR";
    const from = new Date(Date.now() - windowDays * 24 * 3600 * 1000).toISOString();

    const filters = [`lastSoldDate:[${from}..]`];
    if (opts.minPrice && opts.minPrice > 0) {
      filters.push(`price:[${opts.minPrice}..]`, `priceCurrency:${currency}`);
    }

    const params = new URLSearchParams({ filter: filters.join(","), limit: String(limit) });
    if (q) params.set("q", q);
    if (categoryIds) params.set("category_ids", categoryIds);
    // No sort param: Insights' item_sales sort values are narrow and an
    // unsupported one 400s the whole call. We fetch the window and rank by
    // aggregated sold count ourselves, so response order is irrelevant.

    const url = `${INSIGHTS_BASE}/item_sales/search?${params.toString()}`;
    try {
      const resp = await fetch(url, { headers: await this.headers() });
      try { await storage.trackApiCall("ebay"); } catch { /* best-effort */ }
      const text = await resp.text();
      if (!resp.ok) {
        const notApproved =
          resp.status === 403 ||
          (resp.status === 404 && /insights|not.*enabled|scope/i.test(text));
        return { ok: false, total: 0, items: [], notApproved, httpStatus: resp.status, error: text.slice(0, 300) };
      }
      const data = text ? JSON.parse(text) : {};
      const raw: any[] = data.itemSales ?? data.items ?? [];
      const items: MarketSoldItem[] = raw.map((it) => {
        const priceVal = it.price?.value ?? it.lastSoldPrice?.value;
        const price = priceVal != null ? parseFloat(priceVal) : null;
        const cat = Array.isArray(it.categories) && it.categories.length
          ? (it.categories[it.categories.length - 1].categoryName || null)
          : null;
        return {
          itemId: String(it.itemId ?? it.legacyItemId ?? ""),
          title: String(it.title ?? ""),
          price: Number.isFinite(price as number) ? (price as number) : null,
          currency: it.price?.currency ?? it.lastSoldPrice?.currency ?? currency,
          soldQuantity: Math.max(1, Number(it.totalSoldQuantity ?? it.soldQuantity ?? 1) || 1),
          lastSoldDate: it.lastSoldDate ?? it.soldDate ?? null,
          sellerUsername: it.seller?.username ?? null,
          country: (it.itemLocation?.country ?? it.seller?.country ?? null)?.toString().toUpperCase() ?? null,
          categoryPath: cat,
          itemWebUrl: it.itemWebUrl ?? null,
        };
      });
      return { ok: true, total: data.total ?? items.length, items };
    } catch (e) {
      return { ok: false, total: 0, items: [], error: (e as Error).message };
    }
  }
}

export const ebayInsightsApi = new EbayInsightsApiService();

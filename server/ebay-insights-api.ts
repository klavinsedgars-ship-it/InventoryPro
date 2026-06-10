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

export class EbayInsightsApiService {
  private async headers(): Promise<Record<string, string>> {
    const token = await ebayOAuth.getValidAccessToken();
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
}

export const ebayInsightsApi = new EbayInsightsApiService();

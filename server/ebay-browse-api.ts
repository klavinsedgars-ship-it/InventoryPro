/**
 * Minimal eBay Browse API client — READ ONLY.
 *
 * Used exclusively by the competitor-repricing shadow analytics feature. It
 * never modifies a listing or pushes a price; it only fetches the cheapest
 * live FIXED_PRICE listings for a query so the UI can show where our price
 * sits relative to the market.
 *
 * Endpoint: /buy/browse/v1/item_summary/search
 * Auth:     reuses ebayOAuth — Browse needs a user/app access token; the
 *           same one the rest of the app holds is sufficient for read.
 * Quota:    Browse calls are tracked via storage.trackApiCall("ebay"); the
 *           daily eBay cap is 2,000,000 (routes.ts:1175), so even checking
 *           the whole listed catalogue daily is ~0.5% of the budget.
 */
import { ebayOAuth } from "./ebay-oauth";
import { storage } from "./storage";

const BROWSE_BASE = "https://api.ebay.com/buy/browse/v1";

// eBay marketplace ID matches the rest of the app's mapping.
function marketplaceId(): string {
  const map: Record<string, string> = {
    "0": "EBAY_US", "3": "EBAY_GB", "77": "EBAY_DE",
    "71": "EBAY_FR", "101": "EBAY_IT", "186": "EBAY_ES",
  };
  return map[process.env.EBAY_MARKETPLACE_SITE_ID || "77"] || "EBAY_DE";
}

export interface BrowseItemSummary {
  itemId: string;
  title: string;
  price?: { value: string; currency: string };
  shippingOptions?: Array<{ shippingCost?: { value: string; currency: string } }>;
  seller?: { username?: string };
  itemWebUrl?: string;
}

export interface BrowseSearchResult {
  ok: boolean;
  total: number;
  items: BrowseItemSummary[];
  error?: string;
  httpStatus?: number;
}

export class EbayBrowseApiService {
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
   * Search the cheapest live FIXED_PRICE listings for `query` (typically the
   * product SKU). Returns up to `limit` items sorted by price ascending. We
   * deliberately keep the call surface tiny — this is for analytics, not for
   * driving any decision in the listing path.
   */
  async searchCheapest(query: string, limit = 10): Promise<BrowseSearchResult> {
    if (!query || !query.trim()) {
      return { ok: false, total: 0, items: [], error: "empty query" };
    }
    const params = new URLSearchParams({
      q: query.trim(),
      filter: "buyingOptions:{FIXED_PRICE},conditionIds:{1000}",
      sort: "price",
      limit: String(Math.min(50, Math.max(1, limit))),
    });
    const url = `${BROWSE_BASE}/item_summary/search?${params.toString()}`;
    try {
      const resp = await fetch(url, { headers: await this.headers() });
      try { await storage.trackApiCall("ebay"); } catch { /* best-effort */ }
      const text = await resp.text();
      if (!resp.ok) {
        return {
          ok: false,
          total: 0,
          items: [],
          httpStatus: resp.status,
          error: text.slice(0, 300),
        };
      }
      const data = text ? JSON.parse(text) : {};
      const items: BrowseItemSummary[] = data.itemSummaries ?? [];
      return { ok: true, total: data.total ?? items.length, items };
    } catch (e) {
      return { ok: false, total: 0, items: [], error: (e as Error).message };
    }
  }
}

export const ebayBrowseApi = new EbayBrowseApiService();

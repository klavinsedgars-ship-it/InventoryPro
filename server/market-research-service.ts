/**
 * Market-first product research — the "what's actually selling that I could
 * source?" engine behind the Market Research page.
 *
 * Flow: query eBay Marketplace Insights (the Terapeak sold-items signal) by
 * keyword and/or category → normalise + cluster the sold transactions into
 * real products → filter out junk (CN/HK sellers, sub-floor prices, one-off
 * sales) → cross-reference each winner against the local TME catalogue and
 * project the net margin after eBay fees + VAT + shipping.
 *
 * SHADOW / READ-ONLY: one Insights call per search, TME matching is a local
 * DB lookup (no TME API calls), and nothing is ever listed or priced.
 */
import { ebayInsightsApi } from "./ebay-insights-api";
import { storage } from "./storage";
import { getFeeConfig } from "./fee-config";
import { calculateNetProfit } from "./fee-model";
import { aggregateSoldItems, searchToken, type MarketProduct } from "./market-research-core";

// Re-export so existing importers of these types keep working.
export type { MarketProduct, TmeMatch } from "./market-research-core";

export interface MarketResearchResult {
  ok: boolean;
  notApproved?: boolean;
  error?: string;
  query: string;
  categoryIds: string | null;
  windowDays: number;
  rawSold: number;        // transactions returned by the API
  keptSold: number;       // after the location filter
  products: MarketProduct[];
}

export interface MarketResearchInput {
  q?: string;
  categoryIds?: string;
  windowDays?: number;
  minPrice?: number;      // API-level price floor (junk filter)
  minSold?: number;       // drop clusters below this many sold
  excludeCn?: boolean;    // drop CN/HK listings
  euOnly?: boolean;       // keep only EU/UK listings
  currency?: string;
  maxProducts?: number;   // cap on returned rows (default 40)
  tmeMatch?: boolean;     // cross-reference the TME catalogue (default true)
}

export async function researchMarket(input: MarketResearchInput): Promise<MarketResearchResult> {
  const windowDays = Math.min(90, Math.max(1, input.windowDays ?? 30));
  const currency = input.currency || "EUR";
  const maxProducts = Math.min(100, Math.max(1, input.maxProducts ?? 40));
  const minSold = Math.max(1, input.minSold ?? 2);

  const search = await ebayInsightsApi.searchSoldMarket({
    q: input.q,
    categoryIds: input.categoryIds,
    limit: 200,
    windowDays,
    minPrice: input.minPrice,
    currency,
  });

  const base = {
    query: (input.q || "").trim(),
    categoryIds: (input.categoryIds || "").trim() || null,
    windowDays,
  };

  if (!search.ok) {
    return {
      ok: false,
      notApproved: search.notApproved,
      error: search.error,
      ...base,
      rawSold: 0,
      keptSold: 0,
      products: [],
    };
  }

  // Filter + cluster + stats — pure, unit-tested in isolation.
  const { keptCount, products } = aggregateSoldItems(search.items, {
    excludeCn: input.excludeCn,
    euOnly: input.euOnly,
    minSold,
    currency,
    maxProducts,
  });

  // TME cross-reference + margin projection (local DB only — no TME API).
  if (input.tmeMatch !== false && products.length) {
    const config = await getFeeConfig("ebay");
    for (const p of products) {
      const token = searchToken(p.title);
      if (!token) continue;
      try {
        const { rows } = await storage.getProductsPaged({ search: token, limit: 1, offset: 0 });
        const row = rows[0];
        if (!row) continue;
        const supplierPrice = row.supplierPrice != null ? parseFloat(row.supplierPrice) : null;
        const moq = row.moq && row.moq > 0 ? row.moq : 1;
        const weightGrams = row.weight != null ? parseFloat(row.weight) : null;
        let projectedNetProfit: number | null = null;
        let projectedMarginPct: number | null = null;
        let meetsTarget = false;
        if (supplierPrice != null && p.medianPrice > 0) {
          const b = calculateNetProfit({
            salePrice: p.medianPrice,
            packageSupplierCost: supplierPrice * moq,
            weightGrams,
            marketplace: "ebay",
            config,
          });
          projectedNetProfit = Math.round(b.netProfit * 100) / 100;
          projectedMarginPct = Math.round(b.netMarginPct * 10) / 10;
          meetsTarget = b.meetsTarget;
        }
        p.tme = {
          productId: row.id,
          sku: row.sku,
          name: row.name,
          supplierPrice: row.supplierPrice ?? null,
          stock: row.stock ?? 0,
          listedOnEbay: !!row.listedOnEbay,
          projectedNetProfit,
          projectedMarginPct,
          meetsTarget,
        };
      } catch {
        /* best-effort: a match failure just leaves tme null */
      }
    }
  }

  return {
    ok: true,
    ...base,
    rawSold: search.items.length,
    keptSold: keptCount,
    products,
  };
}

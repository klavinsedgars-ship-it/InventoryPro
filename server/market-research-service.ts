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
import { ebayInsightsApi, type MarketSoldItem } from "./ebay-insights-api";
import { storage } from "./storage";
import { getFeeConfig } from "./fee-config";
import { calculateNetProfit } from "./fee-model";

// Country buckets for the junk filter. GB/UK is treated as European.
const CN_COUNTRIES = new Set(["CN", "HK", "MO"]);
const EU_COUNTRIES = new Set([
  "DE", "GB", "FR", "IT", "ES", "PL", "NL", "BE", "AT", "IE", "PT", "SE",
  "DK", "FI", "CZ", "SK", "HU", "RO", "GR", "LU", "LT", "LV", "EE", "SI",
  "HR", "BG", "CH", "NO",
]);

// Noise tokens that don't help identify a distinct product.
const STOP = new Set([
  "the", "and", "for", "with", "new", "genuine", "original", "official",
  "pcs", "pack", "set", "lot", "pair", "kit", "pro", "plus", "max", "mini",
  "free", "shipping", "fast", "uk", "eu", "us", "de", "quality", "high",
  "premium", "best", "top", "hot", "sale", "black", "white", "red", "blue",
  "green", "silver", "gold", "grey", "gray", "small", "large", "size",
  "color", "colour", "style", "type", "brand", "oem", "replacement",
]);

function titleTokens(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t.length >= 2 && !STOP.has(t));
}

// A "model" token looks like a part number: mixes letters and digits.
function modelTokens(toks: string[]): string[] {
  return toks.filter((t) => /[a-z]/.test(t) && /[0-9]/.test(t) && t.length >= 3);
}

// Cluster key: brand + model when a part-number-like token exists, else the
// top alphabetic tokens sorted (word-order-insensitive) so near-identical
// listings collapse together. Heuristic, but good enough to surface the real
// repeat sellers without EANs in the Insights payload.
function clusterKey(title: string): string {
  const toks = titleTokens(title);
  const models = modelTokens(toks);
  if (models.length) {
    const brand = toks.find((t) => /^[a-z]+$/.test(t) && t.length >= 3) || "";
    return [brand, ...models.slice(0, 2)].filter(Boolean).sort().join(" ");
  }
  const sig = toks.filter((t) => /^[a-z]+$/.test(t) && t.length >= 3).slice(0, 4).sort();
  return sig.join(" ") || toks.slice(0, 4).sort().join(" ");
}

// Most distinctive token to search the TME catalogue with (model number first).
function searchToken(title: string): string | null {
  const toks = titleTokens(title);
  const models = modelTokens(toks);
  if (models.length) return models[0];
  const alpha = toks.filter((t) => /^[a-z]+$/.test(t) && t.length >= 4);
  return alpha.sort((a, b) => b.length - a.length)[0] || null;
}

function median(sorted: number[]): number {
  if (!sorted.length) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export interface TmeMatch {
  productId: number;
  sku: string;
  name: string;
  supplierPrice: string | null;
  stock: number;
  listedOnEbay: boolean;
  projectedNetProfit: number | null;
  projectedMarginPct: number | null;
  meetsTarget: boolean;
}

export interface MarketProduct {
  key: string;
  title: string;
  soldCount: number;      // sum of sold quantities in the window
  transactions: number;   // distinct sold listings clustered here
  gmv: number;            // sum(price * qty) over the window
  avgPrice: number;
  medianPrice: number;
  minPrice: number;
  maxPrice: number;
  currency: string;
  topCountries: Array<{ country: string; count: number }>;
  cnShare: number;        // fraction of listings from CN/HK
  sampleUrl: string | null;
  tme: TmeMatch | null;
}

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

  // Location junk filter. euOnly is stricter than excludeCn and wins.
  const kept = search.items.filter((it: MarketSoldItem) => {
    const c = it.country;
    if (input.euOnly) return c != null && EU_COUNTRIES.has(c);
    if (input.excludeCn) return c == null || !CN_COUNTRIES.has(c); // keep unknowns
    return true;
  });

  // Cluster.
  const clusters = new Map<string, MarketSoldItem[]>();
  for (const it of kept) {
    if (!it.title) continue;
    const key = clusterKey(it.title);
    if (!key) continue;
    let arr = clusters.get(key);
    if (!arr) { arr = []; clusters.set(key, arr); }
    arr.push(it);
  }

  let products: MarketProduct[] = [];
  for (const [key, items] of Array.from(clusters.entries())) {
    const prices = items.map((i) => i.price).filter((p): p is number => p != null && p > 0).sort((a, b) => a - b);
    const soldCount = items.reduce((s, i) => s + i.soldQuantity, 0);
    if (soldCount < minSold) continue;
    const gmv = items.reduce((s, i) => s + (i.price != null ? i.price * i.soldQuantity : 0), 0);
    const cnCount = items.filter((i) => i.country != null && CN_COUNTRIES.has(i.country)).length;
    const byCountry = new Map<string, number>();
    for (const i of items) {
      const c = i.country || "??";
      byCountry.set(c, (byCountry.get(c) ?? 0) + 1);
    }
    const topCountries = Array.from(byCountry.entries())
      .map(([country, count]) => ({ country, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);
    // Representative title = the longest (most descriptive) in the cluster.
    const title = items.reduce((a, b) => (b.title.length > a.title.length ? b : a)).title;

    products.push({
      key,
      title,
      soldCount,
      transactions: items.length,
      gmv: Math.round(gmv * 100) / 100,
      avgPrice: prices.length ? Math.round((prices.reduce((a, b) => a + b, 0) / prices.length) * 100) / 100 : 0,
      medianPrice: Math.round(median(prices) * 100) / 100,
      minPrice: prices[0] ?? 0,
      maxPrice: prices[prices.length - 1] ?? 0,
      currency,
      topCountries,
      cnShare: items.length ? Math.round((cnCount / items.length) * 100) / 100 : 0,
      sampleUrl: items.find((i) => i.itemWebUrl)?.itemWebUrl ?? null,
      tme: null,
    });
  }

  products.sort((a, b) => b.soldCount - a.soldCount || b.gmv - a.gmv);
  products = products.slice(0, maxProducts);

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
    keptSold: kept.length,
    products,
  };
}

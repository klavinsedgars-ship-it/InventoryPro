/**
 * Pure core of the market-research aggregator — NO API, NO DB, NO env.
 *
 * Extracted from market-research-service.ts (which does the eBay/TME I/O) so
 * the correctness-critical logic — the "not Chinese junk" location filter,
 * title clustering, and price maths — is unit-testable in isolation, the same
 * way sync-utils.ts is split out of the sync path. Only the MarketSoldItem
 * TYPE is imported (erased at runtime), so importing this file never pulls in
 * storage or the eBay client.
 */
import type { MarketSoldItem } from "./ebay-insights-api";

// Country buckets for the junk filter. GB/UK is treated as European.
export const CN_COUNTRIES = new Set(["CN", "HK", "MO"]);
export const EU_COUNTRIES = new Set([
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

export function titleTokens(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t.length >= 2 && !STOP.has(t));
}

// A "model" token looks like a part number: mixes letters and digits.
export function modelTokens(toks: string[]): string[] {
  return toks.filter((t) => /[a-z]/.test(t) && /[0-9]/.test(t) && t.length >= 3);
}

// Cluster key: brand + model when a part-number-like token exists, else the
// top alphabetic tokens sorted (word-order-insensitive) so near-identical
// listings collapse together. Heuristic, but good enough to surface the real
// repeat sellers without EANs in the Insights payload.
export function clusterKey(title: string): string {
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
export function searchToken(title: string): string | null {
  const toks = titleTokens(title);
  const models = modelTokens(toks);
  if (models.length) return models[0];
  const alpha = toks.filter((t) => /^[a-z]+$/.test(t) && t.length >= 4);
  return alpha.sort((a, b) => b.length - a.length)[0] || null;
}

export function median(sorted: number[]): number {
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

/**
 * Pure aggregation: apply the location junk filter, cluster the sold items
 * into products, and compute per-product stats. No API and no DB.
 */
export function aggregateSoldItems(
  items: MarketSoldItem[],
  opts: {
    excludeCn?: boolean;
    euOnly?: boolean;
    minSold?: number;
    currency?: string;
    maxProducts?: number;
  } = {},
): { keptCount: number; products: MarketProduct[] } {
  const minSold = Math.max(1, opts.minSold ?? 2);
  const currency = opts.currency || "EUR";
  const maxProducts = Math.min(100, Math.max(1, opts.maxProducts ?? 40));

  // Location junk filter. euOnly is stricter than excludeCn and wins.
  const kept = items.filter((it) => {
    const c = it.country;
    if (opts.euOnly) return c != null && EU_COUNTRIES.has(c);
    if (opts.excludeCn) return c == null || !CN_COUNTRIES.has(c); // keep unknowns
    return true;
  });

  // Cluster near-identical titles together.
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
  for (const [key, clItems] of Array.from(clusters.entries())) {
    const prices = clItems.map((i) => i.price).filter((p): p is number => p != null && p > 0).sort((a, b) => a - b);
    const soldCount = clItems.reduce((s, i) => s + i.soldQuantity, 0);
    if (soldCount < minSold) continue;
    const gmv = clItems.reduce((s, i) => s + (i.price != null ? i.price * i.soldQuantity : 0), 0);
    const cnCount = clItems.filter((i) => i.country != null && CN_COUNTRIES.has(i.country)).length;
    const byCountry = new Map<string, number>();
    for (const i of clItems) {
      const c = i.country || "??";
      byCountry.set(c, (byCountry.get(c) ?? 0) + 1);
    }
    const topCountries = Array.from(byCountry.entries())
      .map(([country, count]) => ({ country, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);
    // Representative title = the longest (most descriptive) in the cluster.
    const title = clItems.reduce((a, b) => (b.title.length > a.title.length ? b : a)).title;

    products.push({
      key,
      title,
      soldCount,
      transactions: clItems.length,
      gmv: Math.round(gmv * 100) / 100,
      avgPrice: prices.length ? Math.round((prices.reduce((a, b) => a + b, 0) / prices.length) * 100) / 100 : 0,
      medianPrice: Math.round(median(prices) * 100) / 100,
      minPrice: prices[0] ?? 0,
      maxPrice: prices[prices.length - 1] ?? 0,
      currency,
      topCountries,
      cnShare: clItems.length ? Math.round((cnCount / clItems.length) * 100) / 100 : 0,
      sampleUrl: clItems.find((i) => i.itemWebUrl)?.itemWebUrl ?? null,
      tme: null,
    });
  }

  products.sort((a, b) => b.soldCount - a.soldCount || b.gmv - a.gmv);
  products = products.slice(0, maxProducts);
  return { keptCount: kept.length, products };
}

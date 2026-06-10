/**
 * Competitor repricing — SHADOW analytics service.
 *
 * For each product checked, queries the eBay Browse API for the cheapest live
 * listings of the same SKU, computes summary stats and a "where do we sit"
 * signal, and writes an append-only snapshot row. Nothing here is ever read
 * by the sync/listing path or modifies a product's salePrice.
 *
 * The service is deliberately single-purpose:
 *   checkProduct(product)      — one SKU, one Browse call, one snapshot row.
 *   checkProducts(products)    — iterate; bounded inline concurrency.
 *
 * The caller (a route handler) decides which products to check (e.g. only
 * the eBay-listed ones) and what the time budget is.
 */
import { ebayBrowseApi } from "./ebay-browse-api";
import { storage } from "./storage";
import type { Product, InsertCompetitorSnapshot } from "@shared/schema";

// Tolerance band: ±UNDERCUT_PCT around the top-3 market average is "in line".
// Outside that, we're "overpriced" (above market) or "underpriced" (below).
const UNDERCUT_PCT = 0.02;
// Minimum competitor samples before we judge. <1 = no_data; 1-2 = thin_market.
const MIN_SAMPLES_FOR_SIGNAL = 3;
// Inline concurrency for batch checks. Browse is fast and the eBay daily
// quota is huge, but we still want to be polite (and protect Vercel from a
// burst of concurrent fetches).
const DEFAULT_CONCURRENCY = 4;

export interface CheckResult {
  productId: number;
  sku: string;
  ok: boolean;
  signal?: string;
  cheapest?: number;
  top3Avg?: number;
  sampleCount?: number;
  error?: string;
}

/**
 * Parse a Browse item summary into a numeric price in EUR-equivalent.
 * Browse usually returns the marketplace's currency directly; for now we
 * trust the value and skip currency-conversion (DE marketplace -> EUR).
 */
function priceOf(item: { price?: { value: string } }): number | null {
  const v = item.price?.value;
  if (v == null) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function classify(ourPrice: number | null, top3Avg: number | null, sampleCount: number): string {
  if (sampleCount === 0) return "no_data";
  if (sampleCount < MIN_SAMPLES_FOR_SIGNAL) return "thin_market";
  if (ourPrice == null || top3Avg == null || top3Avg === 0) return "no_data";
  const delta = (ourPrice - top3Avg) / top3Avg;
  if (delta > UNDERCUT_PCT) return "overpriced";
  if (delta < -UNDERCUT_PCT) return "underpriced";
  return "in_line";
}

export async function checkProduct(product: Product): Promise<CheckResult> {
  const sku = product.sku;
  const ourPriceNum = product.salePrice ? parseFloat(product.salePrice) : null;
  // Prefer EAN — a universal product identifier other sellers also list
  // under — over our internal supplier SKU, which rarely matches competitor
  // listings (and is why SKU-only search returns mostly "thin market").
  // Fall back to SKU when the product has no EAN.
  const ean = (product.ean || "").trim();
  const query = ean || sku;
  const search = await ebayBrowseApi.searchCheapest(query, 10);

  // Always write a snapshot — even on Browse error — so the UI can show
  // "we tried and got this error" instead of silently missing.
  if (!search.ok) {
    const row: InsertCompetitorSnapshot = {
      productId: product.id,
      sku,
      marketplace: "ebay",
      searchQuery: query,
      ourPrice: product.salePrice ?? null,
      cheapestPrice: null,
      top3AvgPrice: null,
      sampleCount: 0,
      currency: "EUR",
      signal: "no_data",
      deltaPct: null,
      recommendedPrice: null,
      errorMessage: search.error ?? null,
    };
    await storage.createCompetitorSnapshot(row);
    return { productId: product.id, sku, ok: false, error: search.error };
  }

  // Filter our own listings out — if we're searching for our SKU, our own
  // active listing(s) will be in the result set. Drop them by checking the
  // seller username against the configured one.
  const ourSeller = (process.env.EBAY_SELLER_USERNAME || "").toLowerCase();
  const competitorItems = ourSeller
    ? search.items.filter((it) => (it.seller?.username || "").toLowerCase() !== ourSeller)
    : search.items;

  const prices = competitorItems
    .map(priceOf)
    .filter((p): p is number => p != null)
    .sort((a, b) => a - b);
  const sampleCount = prices.length;
  const cheapest = sampleCount > 0 ? prices[0] : null;
  const top3Avg = sampleCount >= 3 ? (prices[0] + prices[1] + prices[2]) / 3 : null;

  const signal = classify(ourPriceNum, top3Avg, sampleCount);
  const deltaPct =
    ourPriceNum != null && top3Avg != null && top3Avg > 0
      ? ((ourPriceNum - top3Avg) / top3Avg) * 100
      : null;
  // Shadow recommendation = market anchor minus undercut. The operator
  // compares this to the supplier price separately.
  const recommendedPrice = top3Avg != null ? top3Avg * (1 - UNDERCUT_PCT) : null;

  const row: InsertCompetitorSnapshot = {
    productId: product.id,
    sku,
    marketplace: "ebay",
    searchQuery: query,
    ourPrice: product.salePrice ?? null,
    cheapestPrice: cheapest != null ? cheapest.toFixed(2) : null,
    top3AvgPrice: top3Avg != null ? top3Avg.toFixed(2) : null,
    sampleCount,
    currency: "EUR",
    signal,
    deltaPct: deltaPct != null ? deltaPct.toFixed(2) : null,
    recommendedPrice: recommendedPrice != null ? recommendedPrice.toFixed(2) : null,
    errorMessage: null,
  };
  await storage.createCompetitorSnapshot(row);
  return {
    productId: product.id,
    sku,
    ok: true,
    signal,
    cheapest: cheapest ?? undefined,
    top3Avg: top3Avg ?? undefined,
    sampleCount,
  };
}

export async function checkProducts(
  products: Product[],
  opts: { concurrency?: number; budgetMs?: number } = {},
): Promise<{ checked: number; ok: number; failed: number; results: CheckResult[] }> {
  const concurrency = opts.concurrency ?? DEFAULT_CONCURRENCY;
  const start = Date.now();
  const budgetMs = opts.budgetMs ?? 270_000;
  const results: CheckResult[] = [];
  let cursor = 0;

  async function worker() {
    while (true) {
      if (Date.now() - start > budgetMs) return;
      const i = cursor++;
      if (i >= products.length) return;
      try {
        const r = await checkProduct(products[i]);
        results.push(r);
      } catch (e) {
        results.push({
          productId: products[i].id,
          sku: products[i].sku,
          ok: false,
          error: (e as Error).message,
        });
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  const ok = results.filter((r) => r.ok).length;
  return { checked: results.length, ok, failed: results.length - ok, results };
}

/**
 * Sold-through demand checks via eBay Marketplace Insights.
 *
 * Mirrors repricing-service.ts in shape (checkProduct / checkProducts) so the
 * Opportunity Finder can run both demand sources side-by-side with the same
 * bounded-concurrency / Vercel-budget primitives.
 *
 * SHADOW — writes a demand_snapshots row per check; never lists or prices
 * anything.
 */
import { ebayInsightsApi } from "./ebay-insights-api";
import { storage } from "./storage";
import type { Product, InsertDemandSnapshot } from "@shared/schema";

const DEFAULT_WINDOW_DAYS = 30;
const SAMPLE_LIMIT = 50; // up to 50 sold items per query for stats
const DEFAULT_CONCURRENCY = 3; // a bit lower than Browse — Insights quota is tighter

export interface DemandCheckResult {
  productId: number;
  sku: string;
  ok: boolean;
  notApproved?: boolean;
  soldCount?: number;
  error?: string;
}

function priceOf(item: { price?: { value: string } }): number | null {
  const v = item.price?.value;
  if (v == null) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export async function checkProductDemand(product: Product, windowDays = DEFAULT_WINDOW_DAYS): Promise<DemandCheckResult> {
  const sku = product.sku;
  // EAN-first (matches the repricing service's strategy) — sold-through
  // accuracy depends entirely on querying an identifier other sellers also
  // listed under.
  const ean = (product.ean || "").trim();
  const query = ean || sku;
  const search = await ebayInsightsApi.searchSold(query, { limit: SAMPLE_LIMIT, windowDays });

  if (!search.ok) {
    const row: InsertDemandSnapshot = {
      productId: product.id,
      sku,
      searchQuery: query,
      windowDays,
      soldCount: null,
      sampleCount: 0,
      avgSoldPrice: null,
      medianSoldPrice: null,
      lowSoldPrice: null,
      highSoldPrice: null,
      currency: "EUR",
      errorMessage: search.error ?? null,
      notApproved: !!search.notApproved,
    };
    await storage.createDemandSnapshot(row);
    return {
      productId: product.id,
      sku,
      ok: false,
      notApproved: search.notApproved,
      error: search.error,
    };
  }

  const prices = search.items
    .map(priceOf)
    .filter((p): p is number => p != null)
    .sort((a, b) => a - b);
  const sampleCount = prices.length;
  const avg = sampleCount > 0 ? prices.reduce((a, b) => a + b, 0) / sampleCount : null;

  const row: InsertDemandSnapshot = {
    productId: product.id,
    sku,
    searchQuery: query,
    windowDays,
    soldCount: search.total ?? sampleCount, // API-reported total is the authoritative count
    sampleCount,
    avgSoldPrice: avg != null ? avg.toFixed(2) : null,
    medianSoldPrice: (() => {
      const m = median(prices);
      return m != null ? m.toFixed(2) : null;
    })(),
    lowSoldPrice: sampleCount > 0 ? prices[0].toFixed(2) : null,
    highSoldPrice: sampleCount > 0 ? prices[prices.length - 1].toFixed(2) : null,
    currency: "EUR",
    errorMessage: null,
    notApproved: false,
  };
  await storage.createDemandSnapshot(row);
  return { productId: product.id, sku, ok: true, soldCount: search.total ?? sampleCount };
}

export async function checkProductsDemand(
  products: Product[],
  opts: { concurrency?: number; budgetMs?: number; windowDays?: number } = {},
): Promise<{ checked: number; ok: number; failed: number; notApproved: boolean; results: DemandCheckResult[] }> {
  const concurrency = opts.concurrency ?? DEFAULT_CONCURRENCY;
  const start = Date.now();
  const budgetMs = opts.budgetMs ?? 270_000;
  const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;
  const results: DemandCheckResult[] = [];
  let cursor = 0;
  let notApproved = false;
  // Short-circuit the moment we get a "not approved" signal so we don't
  // burn through the whole batch on a guaranteed-failing API call.

  async function worker() {
    while (true) {
      if (notApproved) return;
      if (Date.now() - start > budgetMs) return;
      const i = cursor++;
      if (i >= products.length) return;
      try {
        const r = await checkProductDemand(products[i], windowDays);
        results.push(r);
        if (r.notApproved) notApproved = true;
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
  return { checked: results.length, ok, failed: results.length - ok, notApproved, results };
}

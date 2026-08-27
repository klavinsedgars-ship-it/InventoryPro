/**
 * Turning order history into sourcing and listing decisions.
 *
 * The point of this module is the join nobody had made yet: what SELLS versus
 * what is merely IN the catalogue. With ~65k products imported and ~13k listed,
 * the useful question is no longer "what could we sell?" but "which corner of
 * the catalogue already earns, and how much of it is still unlisted?".
 *
 * Pure: no storage, no network, so the arithmetic is testable on its own.
 */

/** One SKU's realised sales over a window, straight from order_items. */
export interface SkuSalesRow {
  sku: string;
  title: string;
  category: string | null;
  units: number;
  revenue: number;
  /** Supplier cost captured AT SALE, so past profit doesn't drift with prices. */
  cost: number;
  orders: number;
  firstSold: string | null;
  lastSold: string | null;
}

export interface CategorySalesRow {
  category: string;
  units: number;
  revenue: number;
  cost: number;
  orders: number;
  distinctSkus: number;
  /** Catalogue context — the whole reason to group by category. */
  productsInCatalogue: number;
  productsListed: number;
  productsListable: number;
}

export interface SkuPerformance extends SkuSalesRow {
  profit: number;
  marginPct: number | null;
  unitsPerDay: number;
  revenuePerDay: number;
}

export interface CategoryPerformance extends CategorySalesRow {
  profit: number;
  marginPct: number | null;
  unitsPerDay: number;
  revenuePerDay: number;
  /** Realised profit per listed product — "is listing here worth it?". */
  profitPerListing: number | null;
  /** Unlisted products sitting in a category that demonstrably sells. */
  unlistedOpportunity: number;
  /** 0-100, for ranking where to point the listing ramp next. */
  opportunityScore: number;
}

/** Profit and margin from money in and cost out. Null margin when no revenue. */
export function profitOf(revenue: number, cost: number): { profit: number; marginPct: number | null } {
  const profit = round2(revenue - cost);
  if (!(revenue > 0)) return { profit, marginPct: null };
  return { profit, marginPct: round2((profit / revenue) * 100) };
}

export function perDay(total: number, days: number): number {
  const d = Math.max(1, days);
  return round4(total / d);
}

export function summarizeSku(row: SkuSalesRow, days: number): SkuPerformance {
  const { profit, marginPct } = profitOf(row.revenue, row.cost);
  return {
    ...row,
    profit,
    marginPct,
    unitsPerDay: perDay(row.units, days),
    revenuePerDay: round2(perDay(row.revenue, days)),
  };
}

/**
 * Rank categories by where listing effort would pay off next.
 *
 * Three things have to be true for a category to deserve the ramp:
 * it earns (profit), each listing there earns (profit per listing — a category
 * making money across 3,000 listings is far weaker than one making the same
 * across 30), and there is room left to list (unlisted products). A category
 * that scores high on earnings but has nothing left to list is not an
 * opportunity, however good it looks in a sales report.
 */
export function scoreCategory(
  row: CategorySalesRow,
  days: number,
  maxima: { profit: number; profitPerListing: number; unlisted: number },
): CategoryPerformance {
  const { profit, marginPct } = profitOf(row.revenue, row.cost);
  const profitPerListing = row.productsListed > 0 ? round2(profit / row.productsListed) : null;
  const unlistedOpportunity = Math.max(0, row.productsListable);

  const norm = (v: number, max: number) => (max > 0 ? Math.min(1, Math.max(0, v) / max) : 0);
  // Earnings dominate, efficiency next, headroom last — but headroom is a
  // gate, not just a term: no room to list means no opportunity.
  const score =
    unlistedOpportunity === 0
      ? 0
      : 100 *
        (0.5 * norm(profit, maxima.profit) +
          0.3 * norm(profitPerListing ?? 0, maxima.profitPerListing) +
          0.2 * norm(unlistedOpportunity, maxima.unlisted));

  return {
    ...row,
    profit,
    marginPct,
    unitsPerDay: perDay(row.units, days),
    revenuePerDay: round2(perDay(row.revenue, days)),
    profitPerListing,
    unlistedOpportunity,
    opportunityScore: round2(score),
  };
}

/** Score a whole set, normalising each term against the best in the set. */
export function rankCategories(rows: CategorySalesRow[], days: number): CategoryPerformance[] {
  const profits = rows.map((r) => profitOf(r.revenue, r.cost).profit);
  const perListing = rows.map((r, i) => (r.productsListed > 0 ? profits[i] / r.productsListed : 0));
  const maxima = {
    profit: Math.max(0, ...profits),
    profitPerListing: Math.max(0, ...perListing),
    unlisted: Math.max(0, ...rows.map((r) => r.productsListable)),
  };
  return rows
    .map((r) => scoreCategory(r, days, maxima))
    .sort((a, b) => b.opportunityScore - a.opportunityScore || b.profit - a.profit);
}

/**
 * Products that sell but are priced at or below cost — the report that pays
 * for itself. A dropshipping catalogue reprices automatically, so a margin
 * that has gone negative is invisible until someone counts the money.
 */
export function lossMakers(rows: SkuPerformance[], minUnits = 1): SkuPerformance[] {
  return rows
    .filter((r) => r.units >= minUnits && r.cost > 0 && r.profit <= 0)
    .sort((a, b) => a.profit - b.profit);
}

function round2(n: number): number {
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
}
function round4(n: number): number {
  return Math.round((Number.isFinite(n) ? n : 0) * 10000) / 10000;
}

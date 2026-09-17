/**
 * Weight backfill for ACC offers.
 *
 * ACC's bulk `GetProducts` carries no weight; the per-product `GetProduct`
 * carries five (see server/acc-map.ts for which one is the right one and why
 * the other four are traps). So a weight costs one API call per product.
 *
 * That cost decides where this runs. Sweeping 25,000 products would be ~80
 * minutes of their request budget for data we mostly never use, so instead it
 * runs at PROMOTION — the handful of products actually being listed — and
 * writes the answer back to supplier_offers so it is fetched once, not once
 * per re-promotion.
 *
 * Why it matters more than it sounds: fee-model.ts prices an unknown weight as
 * `(weightGrams ?? 0) + packaging`, i.e. the cheapest postal band there is.
 * For TME components that is nearly true. For ACC — where a sampled page held
 * a 17-inch, 30-metre roll of proofing paper — it would price a multi-kilo
 * parcel as a letter, and every such sale would lose money.
 */

import { sql } from "drizzle-orm";
import { db } from "./db";
import { accApi } from "./acc-api";
import { pickWeightGrams } from "./acc-map";
import { mapPool } from "./concurrency";

/**
 * Detail calls in flight. Their published ceiling is 300/minute and the
 * client's own budget caps us at 120; this only governs how quickly we reach
 * that cap, and a promotion is interactive, so it should not crawl.
 */
const WEIGHT_CONCURRENCY = 6;

export interface WeightBackfillResult {
  /** sku → gross weight in grams. Absent means ACC published none. */
  weights: Map<string, number>;
  fetched: number;
  missing: number;
  failed: number;
  /** True when the deadline stopped us before every sku was tried. */
  budgetHit: boolean;
  sampleErrors: string[];
}

/**
 * Fetch gross weights for the given ACC product ids and persist them.
 *
 * Never throws: a promotion that cannot reach ACC must still be able to report
 * what it managed, and the caller decides whether a missing weight is fatal.
 */
export async function backfillAccWeights(
  skus: string[],
  opts: { deadline?: number } = {},
): Promise<WeightBackfillResult> {
  const result: WeightBackfillResult = {
    weights: new Map(),
    fetched: 0,
    missing: 0,
    failed: 0,
    budgetHit: false,
    sampleErrors: [],
  };
  if (skus.length === 0) return result;

  const api = accApi();
  if (!api) {
    result.failed = skus.length;
    result.sampleErrors.push("ACC_LICENSE_KEY is not set — cannot fetch weights");
    return result;
  }

  await mapPool(skus, WEIGHT_CONCURRENCY, async (sku) => {
    if (opts.deadline && Date.now() > opts.deadline) {
      result.budgetHit = true;
      return;
    }
    const r = await api.getProduct(sku);
    if (!r.ok) {
      result.failed++;
      if (result.sampleErrors.length < 3 && r.error) result.sampleErrors.push(`${sku}: ${r.error}`);
      return;
    }
    const grams = pickWeightGrams(r.data?.Parameters);
    if (grams == null || grams <= 0) {
      // A clean answer of "no weight published" — not a failure to ask.
      result.missing++;
      return;
    }
    result.weights.set(sku, grams);
    result.fetched++;
  });

  await persistWeights(result.weights);
  return result;
}

/**
 * Write the weights back to staging so the next promotion, and the freshness
 * refresh, do not pay for them again.
 *
 * One statement for the whole batch via a VALUES join: a promotion of 200
 * products should not be 200 round trips to Neon on top of 200 to ACC.
 */
async function persistWeights(weights: Map<string, number>): Promise<void> {
  if (weights.size === 0) return;
  const rows = Array.from(weights.entries());
  const values = sql.join(
    rows.map(([sku, grams]) => sql`(${sku}, ${String(grams)}::numeric)`),
    sql`, `,
  );
  await db.execute(sql`
    UPDATE supplier_offers AS o
       SET weight_g = v.grams
      FROM (VALUES ${values}) AS v(sku, grams)
     WHERE o.supplier = 'ACC' AND o.supplier_sku = v.sku
  `);
}

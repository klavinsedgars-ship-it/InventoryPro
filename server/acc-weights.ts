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
import {
  accDescriptionFromParameters,
  accListingCondition,
  accParameterPairs,
  pickWeightGrams,
  type ListingCondition,
} from "./acc-map";
import { mapPool } from "./concurrency";

/**
 * Detail calls in flight. Their published ceiling is 300/minute and the
 * client's own budget caps us at 120; this only governs how quickly we reach
 * that cap, and a promotion is interactive, so it should not crawl.
 */
const WEIGHT_CONCURRENCY = 6;

export interface AccProductDetail {
  weightGrams: number | null;
  /** [{name, value}] for eBay item specifics. */
  parameters: Array<{ name: string; value: string }>;
  /** Built from the parameters ACC flags for description use. */
  description: string | null;
  /** NEW unless ACC flagged the unit as sale-out or defective. */
  condition: ListingCondition;
  /** Buyer-facing note for a non-NEW condition. */
  disclosure: string | null;
}

export interface WeightBackfillResult {
  /** sku → gross weight in grams. Absent means ACC published none. */
  weights: Map<string, number>;
  /** sku → everything else the detail call gave us. */
  details: Map<string, AccProductDetail>;
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
    details: new Map(),
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
    // One detail call, three answers. Fetching the weight and then fetching
    // the specifications separately would double the cost of the most
    // expensive thing we do against ACC.
    const params = r.data?.Parameters ?? null;
    const grams = pickWeightGrams(params);
    const verdict = accListingCondition(r.data, params);
    result.details.set(sku, {
      weightGrams: grams,
      parameters: accParameterPairs(params),
      description: accDescriptionFromParameters(params),
      condition: verdict.condition,
      disclosure: verdict.disclosure,
    });
    if (grams == null || grams <= 0) {
      // A clean answer of "no weight published" — not a failure to ask.
      result.missing++;
      return;
    }
    result.weights.set(sku, grams);
    result.fetched++;
  });

  await persistDetails(result.details);
  return result;
}

/**
 * Write what the detail call gave us back to staging, so the next promotion
 * and the freshness refresh do not pay for it again.
 *
 * One statement for the whole batch via a VALUES join: a promotion of 200
 * products should not be 200 round trips to Neon on top of 200 to ACC.
 * COALESCE keeps a previously known value when this call returned none.
 */
async function persistDetails(details: Map<string, AccProductDetail>): Promise<void> {
  if (details.size === 0) return;
  const values = sql.join(
    Array.from(details.entries()).map(([sku, d]) =>
      sql`(${sku}, ${d.weightGrams != null ? String(d.weightGrams) : null}::numeric, ${d.description})`,
    ),
    sql`, `,
  );
  await db.execute(sql`
    UPDATE supplier_offers AS o
       SET weight_g = COALESCE(v.grams, o.weight_g),
           description = COALESCE(v.description, o.description)
      FROM (VALUES ${values}) AS v(sku, grams, description)
     WHERE o.supplier = 'ACC' AND o.supplier_sku = v.sku
  `);
}

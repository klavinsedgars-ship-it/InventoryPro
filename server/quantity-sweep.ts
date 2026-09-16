/**
 * Catalogue-wide eBay quantity cap sweep (2026-09-16).
 *
 * eBay's selling limits count ITEMS, not listings — the quantity on every live
 * listing draws on the same monthly allowance. At a cap of 2 units per listing
 * only half as much of the catalogue can be online as at a cap of 1. This
 * sweep changes the cap on the live listings.
 *
 * Changing the column is instant (one UPDATE); changing eBay is not. The
 * hourly sync only revisits a product when TME's price or stock MOVES, so
 * without a deliberate pass most listings would keep their old quantity
 * indefinitely. Same shape as reprice-sweep and recategorize-sweep:
 * cron-driven time-bounded slices, DB kill-switch ('ebay'/'quantity_sweep'),
 * lease, resumable via a persisted id cursor ('ebay'/'quantity_cursor').
 *
 * Reversible: set the target back to 2, restart, and the same pass puts it
 * back.
 */

import { and, asc, eq, gt, isNotNull, ne, or, sql } from "drizzle-orm";
import { db } from "./db";
import { products, type Product } from "@shared/schema";
import { storage } from "./storage";
import { ebayInventoryApi } from "./ebay-inventory-api";
import { mapPool } from "./concurrency";
import { DEFAULT_EBAY_STOCK_LIMIT, clampTarget } from "@shared/stock-policy";

export { clampTarget };

const BATCH = 200;
const PUSH_CHUNK = 25; // eBay's bulk_update_price_quantity ceiling
/**
 * Bulk calls in flight at once. Each 200-product batch is 8 calls, and run
 * sequentially those calls — not the database — are the whole cost of a slice.
 * Four at a time is a meaningful speedup over ~84k listings while staying far
 * below anything eBay would consider abusive.
 */
const PUSH_CONCURRENCY = 4;

export interface QuantitySweepStats {
  enabled: boolean;
  done: boolean;
  target: number;
  scanned: number;
  pushedToEbay: number;
  pushFailed: number;
  skippedNoPrice: number;
  cursor: number;
  budgetHit: boolean;
  sampleErrors: string[];
  /** Reset each time the running totals are written; not part of the report. */
  pushedSinceLastPersist: number;
  failedSinceLastPersist: number;
}

async function getSetting(name: string): Promise<string | undefined> {
  const rows = await storage.getMarketplaceSettings("ebay");
  return (rows as any[]).find((s) => s.setting === name)?.value;
}

/** The cap the sweep is driving the catalogue towards. */
export async function quantityTarget(): Promise<number> {
  const raw = Number((await getSetting("quantity_target")) ?? NaN);
  return clampTarget(Number.isFinite(raw) ? raw : DEFAULT_EBAY_STOCK_LIMIT);
}

export async function isQuantitySweepEnabled(): Promise<boolean> {
  return (await getSetting("quantity_sweep")) === "on";
}

export async function setQuantitySweepEnabled(on: boolean): Promise<void> {
  await storage.setMarketplaceSetting({ marketplace: "ebay", setting: "quantity_sweep", value: on ? "on" : "off" });
  if (on) {
    await storage.setMarketplaceSetting({ marketplace: "ebay", setting: "quantity_cursor", value: "0" });
    // A fresh pass starts a fresh tally, or the counters would describe two
    // runs at once.
    for (const k of ["quantity_pushed", "quantity_failed"]) {
      await storage.setMarketplaceSetting({ marketplace: "ebay", setting: k, value: "0" });
    }
    await storage.setMarketplaceSetting({ marketplace: "ebay", setting: "quantity_errors", value: "" });
  }
}

/**
 * Fold this slice's push tally into the running totals.
 *
 * Each slice is a separate function invocation, so its in-memory stats vanish
 * when it ends; without this the only record of 84k eBay writes would be
 * whichever slice's response an operator happened to be looking at.
 */
async function persistTotals(stats: QuantitySweepStats): Promise<void> {
  const prevPushed = Number((await getSetting("quantity_pushed")) ?? 0) || 0;
  const prevFailed = Number((await getSetting("quantity_failed")) ?? 0) || 0;
  await storage.setMarketplaceSetting({
    marketplace: "ebay",
    setting: "quantity_pushed",
    value: String(prevPushed + stats.pushedSinceLastPersist),
  });
  await storage.setMarketplaceSetting({
    marketplace: "ebay",
    setting: "quantity_failed",
    value: String(prevFailed + stats.failedSinceLastPersist),
  });
  if (stats.sampleErrors.length) {
    await storage.setMarketplaceSetting({
      marketplace: "ebay",
      setting: "quantity_errors",
      value: JSON.stringify(stats.sampleErrors.slice(0, 3)),
    });
  }
  stats.pushedSinceLastPersist = 0;
  stats.failedSinceLastPersist = 0;
}

/**
 * Set the cap on every product row in one statement, and record it as the
 * sweep's target.
 *
 * Deliberately touches the WHOLE catalogue, not only listed products: a row
 * that lists tomorrow must go up at the new cap, not the old one. Products
 * with useStockLimit = false are the operator's explicit "sell as many as we
 * have" decision and are left alone.
 */
export async function applyTargetToCatalogue(target: number): Promise<{
  target: number;
  offTargetBefore: number;
  offTargetAfter: number;
  rowsChanged: number;
  driverRowCount: number | null;
}> {
  const clamped = clampTarget(target);
  // Counted either side of the UPDATE rather than trusting the driver's
  // rowCount, which is not reliably surfaced through drizzle's db.execute on
  // every driver — and an UPDATE has no RETURNING rows to fall back on, so a
  // missing rowCount reads as a confident "0 rows changed" on a statement
  // that actually rewrote the whole catalogue.
  const offTargetBefore = await countOffTarget(clamped);
  const r: any = await db.execute(sql`
    UPDATE products
       SET ebay_stock_limit = ${clamped}, updated_at = now()
     WHERE ebay_stock_limit <> ${clamped}
       AND use_stock_limit IS DISTINCT FROM false
  `);
  const offTargetAfter = await countOffTarget(clamped);
  await storage.setMarketplaceSetting({ marketplace: "ebay", setting: "quantity_target", value: String(clamped) });
  return {
    target: clamped,
    offTargetBefore,
    offTargetAfter,
    rowsChanged: Math.max(0, offTargetBefore - offTargetAfter),
    driverRowCount: typeof r?.rowCount === "number" ? r.rowCount : null,
  };
}

/** Products whose cap is not the target (ignoring the opt-outs). */
async function countOffTarget(target: number): Promise<number> {
  const q: any = await db.execute(sql`
    SELECT count(*)::int AS c
      FROM products
     WHERE ebay_stock_limit <> ${target}
       AND use_stock_limit IS DISTINCT FROM false
  `);
  return (q.rows ?? q)?.[0]?.c ?? 0;
}

/**
 * Size and position of the pass.
 *
 * `overCap` is the workload: listings holding more stock than the cap, so the
 * ones whose eBay quantity the cap actually binds. It does NOT shrink as the
 * sweep runs — nothing records what was already pushed, and stock stays above
 * the cap after the push. `remaining` is the honest progress number: it counts
 * only what still sits beyond the cursor, and reaches zero when the pass ends.
 */
export async function quantityProgress(): Promise<{
  target: number;
  cursor: number;
  listedTotal: number;
  overCap: number;
  remaining: number;
  capDistribution: Array<{ limit: number | null; products: number }>;
  capOptOuts: number;
  offTarget: number;
  pushedToEbay: number;
  pushFailed: number;
  lastErrors: string[];
}> {
  const target = await quantityTarget();
  const cursor = Number((await getSetting("quantity_cursor")) ?? 0) || 0;
  const q: any = await db.execute(sql`
    SELECT count(*)::int AS listed_total,
           count(*) FILTER (WHERE ${changeableSql(target)})::int AS over_cap,
           count(*) FILTER (WHERE ${changeableSql(target)} AND id > ${cursor})::int AS remaining
      FROM products
     WHERE listed_on_ebay = true AND ebay_offer_id IS NOT NULL
  `);
  // What the products table actually holds. The sweep pushes the target to
  // eBay regardless of this column, but the HOURLY SYNC recomputes quantity
  // from it — so a column left on the old cap quietly puts the old quantity
  // back, product by product, as TME stock moves. Worth being able to see.
  const distQ: any = await db.execute(sql`
    SELECT ebay_stock_limit AS limit, count(*)::int AS products
      FROM products
     WHERE use_stock_limit IS DISTINCT FROM false
     GROUP BY ebay_stock_limit
     ORDER BY ebay_stock_limit
  `);
  const optOutQ: any = await db.execute(
    sql`SELECT count(*)::int AS c FROM products WHERE use_stock_limit = false`,
  );

  const row = (q.rows ?? q)?.[0] ?? {};
  const capDistribution = ((distQ.rows ?? distQ) as any[]).map((d) => ({
    limit: d.limit === null || d.limit === undefined ? null : Number(d.limit),
    products: Number(d.products) || 0,
  }));
  let lastErrors: string[] = [];
  try {
    const raw = (await getSetting("quantity_errors")) || "";
    if (raw) lastErrors = JSON.parse(raw);
  } catch {
    lastErrors = [];
  }

  return {
    target,
    cursor,
    listedTotal: row.listed_total ?? 0,
    overCap: row.over_cap ?? 0,
    remaining: row.remaining ?? 0,
    pushedToEbay: Number((await getSetting("quantity_pushed")) ?? 0) || 0,
    pushFailed: Number((await getSetting("quantity_failed")) ?? 0) || 0,
    lastErrors,
    capDistribution,
    capOptOuts: (optOutQ.rows ?? optOutQ)?.[0]?.c ?? 0,
    offTarget: capDistribution
      .filter((d) => d.limit !== target)
      .reduce((sum, d) => sum + d.products, 0),
  };
}

/** The "the cap binds this listing" predicate, in one place. */
function changeableSql(target: number) {
  return sql`use_stock_limit IS DISTINCT FROM false AND stock > ${target}`;
}

/** One time-bounded slice; call repeatedly (the cron does) until done. */
export async function runQuantitySweep(budgetMs = 250_000): Promise<QuantitySweepStats> {
  const started = Date.now();
  const target = await quantityTarget();
  const stats: QuantitySweepStats = {
    enabled: true,
    done: false,
    target,
    scanned: 0,
    pushedToEbay: 0,
    pushFailed: 0,
    skippedNoPrice: 0,
    cursor: 0,
    budgetHit: false,
    sampleErrors: [],
    pushedSinceLastPersist: 0,
    failedSinceLastPersist: 0,
  };

  let cursor = Number((await getSetting("quantity_cursor")) ?? 0) || 0;

  for (;;) {
    if (Date.now() - started >= budgetMs) {
      stats.budgetHit = true;
      break;
    }

    const batch = await db
      .select()
      .from(products)
      .where(
        and(
          eq(products.listedOnEbay, true),
          isNotNull(products.ebayOfferId),
          gt(products.id, cursor),
          // Only rows whose eBay quantity actually moves. Narrowing here
          // rather than in the loop is what keeps a 90k-listing pass to the
          // few thousand listings that are really over the cap.
          gt(products.stock, target),
          or(ne(products.useStockLimit, false), sql`${products.useStockLimit} IS NULL`),
        ),
      )
      .orderBy(asc(products.id))
      .limit(BATCH);

    if (batch.length === 0) {
      stats.done = true;
      break;
    }

    const toPush: Array<{ sku: string; offerId: string; quantity: number; price: number }> = [];
    for (const p of batch as Product[]) {
      stats.scanned++;
      const price = parseFloat(p.salePrice);
      if (!Number.isFinite(price) || price <= 0) {
        // bulkUpdatePriceQuantity requires a price and would refuse the item
        // anyway; counting it here makes the reason visible.
        stats.skippedNoPrice++;
        continue;
      }
      toPush.push({
        sku: p.sku,
        offerId: p.ebayOfferId!,
        quantity: target,
        price,
      });
    }

    const chunks: Array<typeof toPush> = [];
    for (let i = 0; i < toPush.length; i += PUSH_CHUNK) chunks.push(toPush.slice(i, i + PUSH_CHUNK));
    const results = await mapPool(chunks, PUSH_CONCURRENCY, (chunk) =>
      ebayInventoryApi.bulkUpdatePriceQuantity(chunk),
    );
    for (const r of results) {
      r.forEach((v) => {
        if (v.ok) {
          stats.pushedToEbay++;
          stats.pushedSinceLastPersist++;
        } else {
          stats.pushFailed++;
          stats.failedSinceLastPersist++;
          if (stats.sampleErrors.length < 3 && v.error) stats.sampleErrors.push(v.error);
        }
      });
    }

    cursor = (batch[batch.length - 1] as Product).id;
    // Cursor and totals move together. A cursor that advanced while every push
    // failed would look exactly like progress, so the counters that say
    // whether eBay accepted anything have to survive the slice too — they are
    // the only view an operator has of 84k writes.
    await storage.setMarketplaceSetting({ marketplace: "ebay", setting: "quantity_cursor", value: String(cursor) });
    await persistTotals(stats);
  }

  stats.cursor = cursor;
  // A finished pass disables itself, the same as the other sweeps: an idle
  // cron that keeps re-scanning a converged catalogue is pure waste.
  if (stats.done) await setQuantitySweepEnabled(false);
  return stats;
}

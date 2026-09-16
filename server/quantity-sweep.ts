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
import { DEFAULT_EBAY_STOCK_LIMIT, clampTarget } from "@shared/stock-policy";

export { clampTarget };

const BATCH = 200;
const PUSH_CHUNK = 25; // eBay's bulk_update_price_quantity ceiling

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
  }
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
export async function applyTargetToCatalogue(target: number): Promise<{ target: number; rowsChanged: number }> {
  const clamped = clampTarget(target);
  const r: any = await db.execute(sql`
    UPDATE products
       SET ebay_stock_limit = ${clamped}, updated_at = now()
     WHERE ebay_stock_limit <> ${clamped}
       AND use_stock_limit IS DISTINCT FROM false
  `);
  await storage.setMarketplaceSetting({ marketplace: "ebay", setting: "quantity_target", value: String(clamped) });
  return { target: clamped, rowsChanged: r.rowCount ?? r.rows?.length ?? 0 };
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
  const row = (q.rows ?? q)?.[0] ?? {};
  return {
    target,
    cursor,
    listedTotal: row.listed_total ?? 0,
    overCap: row.over_cap ?? 0,
    remaining: row.remaining ?? 0,
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

    for (let i = 0; i < toPush.length; i += PUSH_CHUNK) {
      const r = await ebayInventoryApi.bulkUpdatePriceQuantity(toPush.slice(i, i + PUSH_CHUNK));
      r.forEach((v) => {
        if (v.ok) stats.pushedToEbay++;
        else {
          stats.pushFailed++;
          if (stats.sampleErrors.length < 3 && v.error) stats.sampleErrors.push(v.error);
        }
      });
    }

    cursor = (batch[batch.length - 1] as Product).id;
    await storage.setMarketplaceSetting({ marketplace: "ebay", setting: "quantity_cursor", value: String(cursor) });
  }

  stats.cursor = cursor;
  // A finished pass disables itself, the same as the other sweeps: an idle
  // cron that keeps re-scanning a converged catalogue is pure waste.
  if (stats.done) await setQuantitySweepEnabled(false);
  return stats;
}

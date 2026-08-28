/**
 * Catalogue-wide re-categorisation sweep (2026-08-28 incident).
 *
 * Every live listing's category was chosen by an unvalidated Taxonomy
 * suggestion, and products.ebay_category_id was only introduced after the
 * incident — so for existing listings we cannot tell locally which sit in a
 * wrong category. The honest remediation is to re-file EVERY live listing
 * through the guarded resolver rather than guess which ones are fine: eBay
 * Inventory calls are not the scarce resource (2M/day; Taxonomy lookups are
 * one per TME category, cached), and a re-file to the same category is a
 * harmless no-op for buyers.
 *
 * Shape follows the house pattern for long jobs: time-bounded slices driven
 * by a cron, a DB kill-switch (marketplace_settings 'ebay'/'recategorize_sweep'
 * = 'on'), a lease so slices never overlap, and convergence recorded in the
 * products table (ebay_category_id = target). Categories whose cached v1
 * suggestion is provably absurd are swept FIRST — those are the listings
 * buyers see and complain about.
 */

import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { products, type Product } from "@shared/schema";
import { storage } from "./storage";
import { ebayInventoryApi } from "./ebay-inventory-api";
import { isImplausibleCategoryPath } from "./ebay-category-query";

const FAIL_MARK = "recategorize: ";
const POOL = 4;

export interface SweepStats {
  enabled: boolean;
  done: boolean;
  categoriesTouched: number;
  moved: number;
  failed: number;
  /** Listed products not yet converged (excludes marked failures). */
  remaining: number;
  /** Listed products parked behind a recategorize failure marker. */
  parkedFailures: number;
  budgetHit: boolean;
  notes: string[];
}

export async function isSweepEnabled(): Promise<boolean> {
  const settings = await storage.getMarketplaceSettings("ebay");
  return settings.find((s: any) => s.setting === "recategorize_sweep")?.value === "on";
}

export async function setSweepEnabled(on: boolean): Promise<void> {
  await storage.setMarketplaceSetting({
    marketplace: "ebay",
    setting: "recategorize_sweep",
    value: on ? "on" : "off",
  });
}

/** Progress counters, cheap enough for a status endpoint. */
export async function sweepProgress(): Promise<{ remaining: number; parkedFailures: number; converged: number }> {
  const q: any = await db.execute(sql`
    SELECT
      count(*) FILTER (WHERE ebay_category_id IS NULL
        AND (ebay_listing_error IS NULL OR ebay_listing_error NOT LIKE ${FAIL_MARK + "%"}))::int AS remaining,
      count(*) FILTER (WHERE ebay_category_id IS NULL
        AND ebay_listing_error LIKE ${FAIL_MARK + "%"})::int AS parked,
      count(*) FILTER (WHERE ebay_category_id IS NOT NULL)::int AS converged
    FROM products
    WHERE supplier = 'TME' AND listed_on_ebay = true
  `);
  const row = (q.rows ?? q)?.[0] ?? {};
  return { remaining: row.remaining ?? 0, parkedFailures: row.parked ?? 0, converged: row.converged ?? 0 };
}

/**
 * One time-bounded slice. Walks TME categories — provably-miscategorised ones
 * first, then by listed count — and re-files their listed products until the
 * budget runs out. Safe to call repeatedly; converged products are skipped by
 * construction.
 */
export async function runRecategorizeSweep(budgetMs = 250_000): Promise<SweepStats> {
  const started = Date.now();
  const stats: SweepStats = {
    enabled: true,
    done: false,
    categoriesTouched: 0,
    moved: 0,
    failed: 0,
    remaining: 0,
    parkedFailures: 0,
    budgetHit: false,
    notes: [],
  };

  // Priority order: categories whose OLD cached suggestion is provably absurd
  // first (that is where the buyer-visible damage is), then by listed count.
  const treeId = process.env.EBAY_MARKETPLACE_SITE_ID || "77";
  const v1: any = await db.execute(sql`
    SELECT cache_key, value FROM ebay_taxonomy_cache
    WHERE cache_key LIKE ${`suggest:${treeId}:%`}
  `);
  const v1NameByKey = new Map<string, string>();
  for (const r of v1.rows ?? v1) {
    try {
      v1NameByKey.set(String(r.cache_key).slice(`suggest:${treeId}:`.length), JSON.parse(r.value)?.name ?? "");
    } catch { /* evidence only — a bad row must not stop the sweep */ }
  }

  // ALL categories with live listings — not just never-converged ones: an
  // operator pin (category override) applied after a category converged must
  // re-file it, so pending is judged per category against the CURRENT target.
  const catsQ: any = await db.execute(sql`
    SELECT category, count(*)::int AS listed
    FROM products
    WHERE supplier = 'TME' AND listed_on_ebay = true
    GROUP BY category
  `);
  let anyPending = false;
  const cats = (catsQ.rows ?? catsQ)
    .map((r: any) => ({
      category: String(r.category),
      listed: r.listed as number,
      flagged: isImplausibleCategoryPath(v1NameByKey.get(String(r.category).toLowerCase()) ?? ""),
    }))
    .sort((a: any, b: any) => Number(b.flagged) - Number(a.flagged) || b.listed - a.listed);

  for (const cat of cats) {
    if (Date.now() - started >= budgetMs) {
      stats.budgetHit = true;
      break;
    }

    const scopeCond = and(
      eq(products.supplier, "TME"),
      eq(products.listedOnEbay, true),
      eq(products.category, cat.category),
    );
    const [first] = await db.select().from(products).where(scopeCond).orderBy(asc(products.id)).limit(1);
    if (!first) continue;

    // One guarded resolution per category (override > cached suggestion).
    let targetId = "";
    try {
      targetId = (await ebayInventoryApi.resolveCategoryDetailed(first)).id;
    } catch (e) {
      stats.notes.push(`${cat.category}: category resolution failed (${(e as Error).message})`);
      continue;
    }
    if (!targetId) {
      stats.notes.push(`${cat.category}: no plausible category and no fallback — skipped`);
      continue;
    }

    const pendingCond = and(
      scopeCond,
      sql`${products.ebayCategoryId} IS DISTINCT FROM ${targetId}`,
      sql`(${products.ebayListingError} IS NULL OR ${products.ebayListingError} NOT LIKE ${FAIL_MARK + "%"})`,
    );

    const [firstPending] = await db.select({ id: products.id }).from(products).where(pendingCond).limit(1);
    if (!firstPending) continue;
    anyPending = true;

    stats.categoriesTouched++;

    // Re-file this category's pending products until it converges or the
    // budget runs out. ebay_category_id is set per success, so the query
    // shrinks as we go; the batch keeps memory and lease renewals sane.
    for (;;) {
      if (Date.now() - started >= budgetMs) {
        stats.budgetHit = true;
        break;
      }
      const batch = await db.select().from(products).where(pendingCond).orderBy(asc(products.id)).limit(40);
      if (batch.length === 0) break;

      let cursor = 0;
      const worker = async () => {
        while (cursor < batch.length && Date.now() - started < budgetMs) {
          const p: Product = batch[cursor++];
          try {
            const r = await ebayInventoryApi.recategorizeOne(p);
            if (r.ok) {
              stats.moved++;
            } else {
              stats.failed++;
              // Park it so the sweep doesn't retry a broken listing forever;
              // visible in ebay_listing_error, cleared by a later success.
              await storage.updateProduct(p.id, {
                ebayListingError: (FAIL_MARK + String(r.error)).slice(0, 500),
              });
            }
          } catch (e) {
            stats.failed++;
            await storage.updateProduct(p.id, {
              ebayListingError: (FAIL_MARK + (e as Error).message).slice(0, 500),
            });
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(POOL, batch.length) }, worker));
    }

    if (stats.budgetHit) break;
  }

  const progress = await sweepProgress();
  stats.remaining = progress.remaining;
  stats.parkedFailures = progress.parkedFailures;
  // Done = a full pass over every category found nothing pending against its
  // CURRENT target. The NULL-based `remaining` is only a coarse progress
  // proxy (it cannot see a re-pinned category), so it must not gate this.
  stats.done = !stats.budgetHit && !anyPending;
  return stats;
}

/**
 * Supplier promotion: copy selected staging offers into `products`.
 *
 * This is the one deliberate door in the staging quarantine (see the comment
 * on supplierOffers in shared/schema.ts). A promoted offer becomes a normal
 * product row carrying its supplier code, priced through the same
 * calculatePriceWithFloor path as TME products, and from there the listing
 * ramp picks it up like any other candidate — IF the supplier is named in
 * LISTING_SUPPLIERS (shared/suppliers.ts); that list stays the boundary.
 *
 * What refuses to cross the door, per offer:
 *  - already promoted (promoted_product_id set) — idempotence;
 *  - SKU on the operator's blocked list;
 *  - a product with the same SKU already exists (collision — usually the
 *    part is already carried by another supplier under the same code);
 *  - a product with the same EAN already exists (same physical item under a
 *    different code — listing it twice means bidding against ourselves);
 *  - no usable feed price (salePrice is NOT NULL; nothing to price from);
 *  - a price in a currency that is not EUR — the whole pricing pipeline is
 *    EUR, so a PLN/USD feed price would silently become a wrong eBay price.
 *    A feed that states no currency is taken as EUR (Getic's case).
 *
 * Feeds rarely carry MOQ/multiples/weight, so promoted products get
 * moq=1, multiples=1, weight from the feed when present else NULL — the
 * profit floor then works from the unit price and the config's default
 * shipping assumption.
 */

import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import { db } from "./db";
import { products, supplierOffers, type SupplierOffer } from "@shared/schema";
import { storage } from "./storage";
import { ensureSupplierTables } from "./supplier-feed-sync";
import {
  calculatePriceWithFloor,
  setActivePricingTiers,
  dbTiersToPricingTiers,
} from "./dynamic-pricing";
import { getFeeConfig } from "./fee-config";

/** EUR, or an unstated currency we take to be EUR. */
function isEurOrUnstated(currency: string | null): boolean {
  const c = (currency ?? "").trim();
  return c === "" || /^(eur|euro|€)$/i.test(c);
}

const CHUNK = 200;

/**
 * When the feed gives no category (Getic's doesn't), file the product under a
 * deliberately generic name: categoryQueryFor() treats it as "no signal" and
 * falls back to the product NAME for the Taxonomy query at listing time,
 * which is the right lever for these feeds — their names are full product
 * titles.
 */
const FALLBACK_CATEGORY = "Electronics";

// ---------------------------------------------------------------------------
// Shared browse/promote filter — one builder so "Add all N filtered" promotes
// exactly the rows the operator is looking at.
// ---------------------------------------------------------------------------
export interface SupplierOfferFilter {
  search?: string;
  category?: string;
  manufacturer?: string;
  inStockOnly?: boolean;
  priceMin?: number;
  priceMax?: number;
  /** "yes" = only promoted rows, "no" = only unpromoted. */
  promoted?: "yes" | "no";
}

export function offerConds(supplier: string, f: SupplierOfferFilter): SQL[] {
  const conds: SQL[] = [sql`supplier = ${supplier}`];
  if (f.search) {
    const like = `%${f.search}%`;
    conds.push(
      sql`(name ILIKE ${like} OR supplier_sku ILIKE ${like} OR ean ILIKE ${like} OR manufacturer ILIKE ${like})`,
    );
  }
  if (f.category) conds.push(sql`category_path = ${f.category}`);
  if (f.manufacturer) conds.push(sql`manufacturer = ${f.manufacturer}`);
  if (f.inStockOnly) conds.push(sql`stock > 0`);
  if (f.priceMin != null && Number.isFinite(f.priceMin)) conds.push(sql`price >= ${f.priceMin}`);
  if (f.priceMax != null && Number.isFinite(f.priceMax)) conds.push(sql`price <= ${f.priceMax}`);
  if (f.promoted === "yes") conds.push(sql`promoted_product_id IS NOT NULL`);
  if (f.promoted === "no") conds.push(sql`promoted_product_id IS NULL`);
  return conds;
}

/** Whitelisted ORDER BY clauses; anything else falls back to id. */
export const OFFER_SORTS: Record<string, SQL> = {
  id: sql`id`,
  name: sql`name ASC NULLS LAST, id`,
  price_asc: sql`price ASC NULLS LAST, id`,
  price_desc: sql`price DESC NULLS LAST, id`,
  stock_desc: sql`stock DESC NULLS LAST, id`,
  newest: sql`first_seen_at DESC, id`,
};

export function offerSortSql(sort: string | undefined): SQL {
  return OFFER_SORTS[sort ?? "id"] ?? OFFER_SORTS.id;
}

// ---------------------------------------------------------------------------
// Promotion
// ---------------------------------------------------------------------------
export interface PromoteResult {
  ok: boolean;
  requested: number;
  promoted: number;
  skipped: {
    alreadyPromoted: number;
    blocked: number;
    skuExists: number;
    eanExists: number;
    noPrice: number;
    wrongCurrency: number;
  };
  /** First 50 skips, with reasons — enough to see WHY without a log dive. */
  skippedSamples: Array<{ sku: string; reason: string }>;
  budgetHit: boolean;
  /** Offers not reached before the time budget — call again to continue. */
  remaining: number;
}

/**
 * Promote the given offer ids. Chunked and time-bounded: a serverless caller
 * gets a partial result with `remaining` instead of a 504. Safe to re-run —
 * everything it did is stamped, everything it skipped is stable.
 */
export async function promoteSupplierOffers(
  supplier: string,
  ids: number[],
  opts: { budgetMs?: number } = {},
): Promise<PromoteResult> {
  const started = Date.now();
  const budgetMs = opts.budgetMs ?? 240_000;
  await ensureSupplierTables();

  const result: PromoteResult = {
    ok: true,
    requested: ids.length,
    promoted: 0,
    skipped: { alreadyPromoted: 0, blocked: 0, skuExists: 0, eanExists: 0, noPrice: 0, wrongCurrency: 0 },
    skippedSamples: [],
    budgetHit: false,
    remaining: 0,
  };
  if (ids.length === 0) return result;

  const skip = (sku: string, key: keyof PromoteResult["skipped"], reason: string) => {
    result.skipped[key]++;
    if (result.skippedSamples.length < 50) result.skippedSamples.push({ sku, reason });
  };

  // Same loading order as reprice-sweep: module tier state resets per
  // serverless invocation, so tiers must be loaded before any price math.
  setActivePricingTiers(dbTiersToPricingTiers(await storage.getPricingTiers()));
  const feeConfig = await getFeeConfig("ebay");

  for (let i = 0; i < ids.length; i += CHUNK) {
    if (Date.now() - started >= budgetMs) {
      result.budgetHit = true;
      result.remaining = ids.length - i;
      break;
    }
    const chunkIds = ids.slice(i, i + CHUNK);
    const offers = (await db
      .select()
      .from(supplierOffers)
      .where(and(eq(supplierOffers.supplier, supplier), inArray(supplierOffers.id, chunkIds)))) as SupplierOffer[];

    const fresh = offers.filter((o) => {
      if (o.promotedProductId != null) {
        skip(o.supplierSku, "alreadyPromoted", `already product #${o.promotedProductId}`);
        return false;
      }
      return true;
    });
    if (fresh.length === 0) continue;

    // Batch lookups once per chunk, not per offer.
    const skus = fresh.map((o) => o.supplierSku.toUpperCase());
    const blocked = await storage.filterBlockedCodes(skus);
    const skuRows = await db
      .select({ sku: sql<string>`upper(${products.sku})` })
      .from(products)
      .where(inArray(sql`upper(${products.sku})`, skus));
    const existingSkus = new Set(skuRows.map((r) => r.sku));
    const eans = Array.from(new Set(fresh.map((o) => o.ean).filter((e): e is string => !!e)));
    const existingEans = new Set<string>();
    if (eans.length > 0) {
      const eanRows = await db
        .select({ ean: products.ean })
        .from(products)
        .where(inArray(products.ean, eans));
      for (const r of eanRows) if (r.ean) existingEans.add(r.ean);
    }

    type ProductInsert = typeof products.$inferInsert;
    const toInsert: Array<{ offerId: number; row: ProductInsert }> = [];
    for (const o of fresh) {
      const sku = o.supplierSku.toUpperCase();
      if (blocked.has(sku)) {
        skip(sku, "blocked", "SKU is on the blocked list");
        continue;
      }
      if (existingSkus.has(sku)) {
        skip(sku, "skuExists", "a product with this SKU already exists");
        continue;
      }
      if (o.ean && existingEans.has(o.ean)) {
        skip(sku, "eanExists", `EAN ${o.ean} already carried by an existing product`);
        continue;
      }
      if (!isEurOrUnstated(o.currency)) {
        skip(sku, "wrongCurrency", `feed price is in ${o.currency} — only EUR can be promoted`);
        continue;
      }
      const unit = o.price != null ? parseFloat(String(o.price)) : NaN;
      if (!Number.isFinite(unit) || unit <= 0) {
        skip(sku, "noPrice", "offer has no usable price");
        continue;
      }
      let priced;
      try {
        priced = calculatePriceWithFloor(unit, {
          moq: 1,
          multiples: 1,
          weightGrams: o.weightG != null ? parseFloat(String(o.weightG)) : null,
          marketplace: "ebay",
          config: feeConfig,
        });
      } catch {
        skip(sku, "noPrice", "price calculation failed");
        continue;
      }
      if (!Number.isFinite(priced.finalPrice) || priced.finalPrice <= 0) {
        skip(sku, "noPrice", "price calculation produced no price");
        continue;
      }
      toInsert.push({
        offerId: o.id,
        row: {
          name: o.name || sku,
          sku,
          ean: o.ean,
          category: o.categoryPath || FALLBACK_CATEGORY,
          description: o.description,
          supplierPrice: unit.toFixed(2),
          salePrice: priced.finalPrice.toFixed(2),
          calculatedPrice: priced.calculatedPrice.toFixed(2),
          marginTier: priced.marginTier,
          marginPercentage: priced.marginPercentage.toString(),
          priceUpdatedAt: new Date(),
          useCalculatedPrice: true,
          stock: o.stock ?? 0,
          moq: 1,
          multiples: 1,
          weight: o.weightG != null ? String(o.weightG) : null,
          status: "active",
          supplier,
          supplierProductId: sku,
          imageUrl: o.imageUrl,
          dataSheetUrl: o.datasheetUrl,
          productUrl: o.productUrl,
          lastSyncedAt: new Date(),
        },
      });
      // The chunk itself could carry two offers resolving to one SKU (it
      // can't within one supplier, but don't rely on that invariant here).
      existingSkus.add(sku);
    }
    if (toInsert.length === 0) continue;

    // onConflictDoNothing: a concurrent promotion or sync racing us turns
    // into a skip, not a 500. .returning() reports only actually-new rows.
    const inserted = await db
      .insert(products)
      .values(toInsert.map((t) => t.row))
      .onConflictDoNothing({ target: products.sku })
      .returning({ id: products.id, sku: products.sku });
    const idBySku = new Map(inserted.map((r) => [r.sku.toUpperCase(), r.id]));

    for (const t of toInsert) {
      const productId = idBySku.get(t.row.sku!.toUpperCase());
      if (productId == null) {
        skip(t.row.sku!, "skuExists", "lost insert race — product appeared concurrently");
        continue;
      }
      await db
        .update(supplierOffers)
        .set({ promotedProductId: productId, promotedAt: new Date() })
        .where(eq(supplierOffers.id, t.offerId));
      result.promoted++;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Freshness: after each feed import, promoted products must follow the feed.
// ---------------------------------------------------------------------------
export interface SupplierRefreshStats {
  scanned: number;
  updated: number;
  pushedToEbay: number;
  pushFailed: number;
  budgetHit: boolean;
  sampleErrors: string[];
}

/**
 * Copy the latest feed price/stock from promoted offers onto their product
 * rows, recompute the floor price (manual-priced products keep their price —
 * same rule as everywhere else), and push changes for live listings to eBay.
 * Called after every successful real import (see runSupplierFeedImport), so
 * a promoted product tracks its feed exactly like a TME product tracks TME.
 */
export async function refreshPromotedProducts(supplier: string, budgetMs = 120_000): Promise<SupplierRefreshStats> {
  const started = Date.now();
  const stats: SupplierRefreshStats = {
    scanned: 0,
    updated: 0,
    pushedToEbay: 0,
    pushFailed: 0,
    budgetHit: false,
    sampleErrors: [],
  };

  setActivePricingTiers(dbTiersToPricingTiers(await storage.getPricingTiers()));
  const feeConfig = await getFeeConfig("ebay");
  // Lazy: keeps supplier-feed-sync → supplier-promote import-safe (this
  // module imports supplier-feed-sync at module scope; the eBay client pulls
  // in a large graph that must not load for a plain import with nothing
  // promoted).
  const { ebayInventoryApi } = await import("./ebay-inventory-api");
  const { calculateEbayStock } = await import("./stock-manager");

  let cursor = 0;
  const toPush: Array<{ sku: string; offerId: string; quantity: number; price: number }> = [];
  for (;;) {
    if (Date.now() - started >= budgetMs) {
      stats.budgetHit = true;
      break;
    }
    const pairs = await db
      .select({ offer: supplierOffers, product: products })
      .from(supplierOffers)
      .innerJoin(products, eq(products.id, supplierOffers.promotedProductId))
      .where(and(eq(supplierOffers.supplier, supplier), sql`${supplierOffers.id} > ${cursor}`))
      .orderBy(supplierOffers.id)
      .limit(500);
    if (pairs.length === 0) break;
    cursor = pairs[pairs.length - 1].offer.id;

    for (const { offer, product } of pairs) {
      stats.scanned++;
      const patch: Record<string, unknown> = {};

      const newStock = offer.stock ?? 0;
      if (newStock !== product.stock) patch.stock = newStock;

      const unit = offer.price != null ? parseFloat(String(offer.price)) : NaN;
      let newSale = parseFloat(product.salePrice) || 0;
      // A non-EUR price never flows into the catalogue (same rule as
      // promotion); stock still refreshes below.
      if (Number.isFinite(unit) && unit > 0 && isEurOrUnstated(offer.currency)) {
        if (unit.toFixed(2) !== product.supplierPrice) patch.supplierPrice = unit.toFixed(2);
        if (product.useCalculatedPrice !== false) {
          try {
            const priced = calculatePriceWithFloor(unit, {
              moq: product.moq || 1,
              multiples: product.multiples || 1,
              weightGrams: product.weight ? parseFloat(product.weight) : null,
              marketplace: "ebay",
              config: feeConfig,
            });
            if (
              Number.isFinite(priced.finalPrice) &&
              priced.finalPrice > 0 &&
              Math.abs(priced.finalPrice - newSale) >= 0.01
            ) {
              newSale = priced.finalPrice;
              patch.salePrice = priced.finalPrice.toFixed(2);
              patch.calculatedPrice = priced.calculatedPrice.toFixed(2);
              patch.marginTier = priced.marginTier;
              patch.marginPercentage = priced.marginPercentage.toString();
              patch.priceUpdatedAt = new Date();
            }
          } catch {
            // a broken tier lookup must not stop the refresh
          }
        }
      }

      if (Object.keys(patch).length === 0) continue;
      patch.lastSyncedAt = new Date();
      await storage.updateProduct(product.id, patch as any);
      stats.updated++;

      if (product.listedOnEbay && product.ebayOfferId) {
        toPush.push({
          sku: product.sku,
          offerId: product.ebayOfferId,
          quantity: calculateEbayStock({ ...product, stock: newStock }).ebayStock,
          price: newSale,
        });
      }
    }
  }

  for (let i = 0; i < toPush.length; i += 25) {
    const r = await ebayInventoryApi.bulkUpdatePriceQuantity(toPush.slice(i, i + 25));
    r.forEach((v: { ok: boolean; error?: string }) => {
      if (v.ok) stats.pushedToEbay++;
      else {
        stats.pushFailed++;
        if (stats.sampleErrors.length < 3 && v.error) stats.sampleErrors.push(v.error);
      }
    });
  }

  return stats;
}

/** How many offers have been promoted — the gate for the hourly cron. */
export async function promotedProductCount(supplier: string): Promise<number> {
  const q: any = await db.execute(
    sql`SELECT count(*)::int AS c FROM products WHERE supplier = ${supplier}`,
  );
  return (q.rows ?? q)?.[0]?.c ?? 0;
}

/**
 * Resolve a filter to the promotable (still-unpromoted) offer ids, oldest
 * first so repeat calls after a budget hit continue rather than reshuffle.
 */
export async function promotableIdsFor(supplier: string, filter: SupplierOfferFilter): Promise<number[]> {
  await ensureSupplierTables();
  const conds = offerConds(supplier, { ...filter, promoted: "no" });
  const q: any = await db.execute(sql`
    SELECT id FROM supplier_offers WHERE ${sql.join(conds, sql` AND `)} ORDER BY id
  `);
  return ((q.rows ?? q) as Array<{ id: number }>).map((r) => r.id);
}

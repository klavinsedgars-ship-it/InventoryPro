/**
 * Chunked TME -> DB -> eBay sync that fits inside Vercel's function
 * timeout. Instead of one long-running pass over all products (which
 * exceeds the 60s limit and can't run as a background loop on serverless),
 * each call processes the N *stalest* TME products (those not yet synced
 * today), refreshes their price/stock from TME (via the optimized combined
 * endpoint, 100/call), recomputes pricing, updates the DB, and pushes
 * inventory changes to eBay for already-listed items.
 *
 * Callers loop until `done`:
 *   - Manual "Sync Now": the browser drives the loop, showing progress.
 *   - Vercel Cron (daily): a server-side loop runs chunks within a time
 *     budget.
 */
import { storage } from "./storage";
import type { InsertSyncAudit } from "@shared/schema";
import { tmeApiOptimized } from "./tme-api-optimized";
import {
  getSupplierPriceForMoq,
  calculatePriceWithFloor,
  setActivePricingTiers,
  dbTiersToPricingTiers,
} from "./dynamic-pricing";
import { getFeeConfig } from "./fee-config";
import { ebayInventoryApi } from "./ebay-inventory-api";
import { extractStock, staleCutoffs } from "./sync-utils";

// Marks a listing we ended automatically because TME stock hit 0, so we can
// tell it apart from manual unlists and auto-republish it when stock returns.
const ENDED_OOS = "ended_oos";

export interface SyncChunkResult {
  total: number; // total TME products
  remaining: number; // TME products still not synced today (after this chunk)
  processedThisChunk: number;
  processedListed: number; // of processedThisChunk, how many were eBay-listed
  changed: number; // products whose price or stock actually changed
  ebayUpdated: number; // eBay listings updated
  ebayUnlisted: number; // listings withdrawn because stock hit 0
  ebayRelisted: number; // listings re-published because stock returned
  done: boolean;
  errors: string[];
}

// Per-SKU audit draft. `_intent` records the eBay action we *attempted* so the
// outcome can be patched in once the (async) eBay calls resolve; it's stripped
// before the row is written.
type AuditDraft = InsertSyncAudit & { _intent: string };

export async function runSyncChunk(
  limit = 50,
  source: "cron" | "manual" = "cron",
): Promise<SyncChunkResult> {
  const errors: string[] = [];

  // DB-side: load only the next `limit` stalest TME products (indexed),
  // not the whole table. Tiered staleness — listed first.
  const cutoffs = staleCutoffs();
  const total = await storage.getTmeProductCount();
  const slice = (await storage.getStaleTmeProducts(limit, cutoffs.listed, cutoffs.unlisted))
    .filter((p) => p.sku);
  if (slice.length === 0) {
    return { total, remaining: 0, processedThisChunk: 0, processedListed: 0, changed: 0, ebayUpdated: 0, ebayUnlisted: 0, ebayRelisted: 0, done: true, errors };
  }

  // Resolve fee config once per chunk (drives the net-profit price floor).
  const feeConfig = await getFeeConfig("ebay");

  // Load the operator's DB pricing tiers so Configuration-UI edits take effect
  // (calculations previously ignored them). Falls back to the built-in config
  // if the table is empty.
  setActivePricingTiers(dbTiersToPricingTiers(await storage.getPricingTiers()));

  const symbols = slice.map((p) => p.supplierProductId || p.sku);
  // Optimized client: one combined GetPricesAndStocks call per 100 symbols
  // (vs the standard client's 2 calls per 50), and it persists the count via
  // storage.trackApiCall('tme'). MOQ/multiples/weight come from the DB row
  // (captured at import/list time and effectively static), so the cron needs
  // no per-product GetProducts call — ~4x fewer TME calls at 100k scale.
  // TME_API_VERSION=v2 switches the price/stock fetch to the v2 client, which
  // TME allows at 4 req/sec vs v1's 2 (double the sync throughput) and which
  // returns product_status so we can stop listing items TME will not sell us.
  // The compat method returns the v1 shape, so nothing below changes.
  const useV2 = process.env.TME_API_VERSION === "v2";
  let priceStocks: Array<any> = [];
  let statusBySymbol = new Map<string, string[]>();
  const paramsBySymbol = new Map<string, Array<{ name: string; value: string }>>();
  try {
    if (useV2) {
      const { tmeApiV2 } = await import("./tme-api-v2");
      priceStocks = await tmeApiV2.getPricesAndStocksCompat(symbols);
      // Statuses come from /products — one extra call per chunk, worth it to
      // keep unsellable items out of the listing queue.
      try {
        const details = await tmeApiV2.getProducts(symbols);
        statusBySymbol = new Map(
          details.map((d: any) => [d.symbol, Array.isArray(d.product_status) ? d.product_status : []]),
        );
      } catch (e) {
        errors.push(`TME v2 product_status fetch failed: ${(e as Error).message}`);
      }
      // Technical parameters -> eBay item specifics. Static per product, so
      // fetch ONLY for rows that don't have them yet: at steady state this
      // costs nothing, and it back-fills the catalogue as the sync sweeps.
      const needParams = slice
        .filter((p) => !(p as any).tmeParameters)
        .map((p) => p.supplierProductId || p.sku);
      if (needParams.length > 0) {
        try {
          const { flattenTmeParameters } = await import("./tme-aspects");
          const paramRows = await tmeApiV2.getParameters(needParams);
          for (const row of paramRows) {
            const flat = flattenTmeParameters(row);
            if (flat.length > 0) paramsBySymbol.set(row.symbol, flat);
          }
        } catch (e) {
          errors.push(`TME v2 parameters fetch failed: ${(e as Error).message}`);
        }
      }
    } else {
      priceStocks = await tmeApiOptimized.getProductsPricesAndStocks(symbols);
    }
  } catch (e) {
    // TME fetch failed for the whole chunk (outage / rate-limit exhausted).
    // Abort WITHOUT touching lastSyncedAt so these products stay stale and get
    // retried next run, and surface the error rather than logging a fake
    // success. done:true stops this tick's loop from hammering a down TME;
    // the next scheduled cron retries.
    errors.push(`TME fetch failed: ${(e as Error).message}`);
    const remaining = Math.max(
      0,
      await storage.getStaleTmeProductCount(cutoffs.listed, cutoffs.unlisted),
    );
    return {
      total, remaining, processedThisChunk: 0, processedListed: 0, changed: 0,
      ebayUpdated: 0, ebayUnlisted: 0, ebayRelisted: 0, done: true, errors,
    };
  }
  const bySymbol = new Map(priceStocks.map((ps) => [ps.Symbol, ps]));

  let changed = 0;
  // Inventory-model listings (offerId) -> bulkUpdatePriceQuantity.
  const inventoryUpdates: Array<{ product: any; quantity: number; price: number }> = [];
  // Listed products whose stock hit 0 -> withdraw the offer.
  const withdrawals: any[] = [];
  // Previously auto-ended products back in stock -> re-publish the offer.
  const relists: any[] = [];
  const now = new Date();
  // Collect DB writes and flush them together at the end of the chunk
  // instead of awaiting one round-trip per product (the old bottleneck).
  const writes: Array<Promise<unknown>> = [];
  // Per-SKU audit drafts, keyed by product id so eBay outcomes can be patched
  // in once the bulk eBay calls return.
  const audits = new Map<number, AuditDraft>();

  for (const product of slice) {
    const sym = product.supplierProductId || product.sku;
    const ps = bySymbol.get(sym);

    // Couldn't fetch this one: still bump lastSyncedAt so the cursor
    // advances (it retries on the next sync), but record nothing.
    if (!ps) {
      writes.push(storage.updateProduct(product.id, { lastSyncedAt: now }));
      continue;
    }

    const moq = product.moq || 1;
    const multiples = product.multiples || 1;
    const supplierPrice = getSupplierPriceForMoq(ps.PriceList as any, moq);
    const stock = extractStock(ps, product.stock ?? 0);
    const weightGrams = product.weight ? parseFloat(product.weight) : null;

    const pricing =
      supplierPrice > 0
        ? calculatePriceWithFloor(supplierPrice, {
            moq,
            multiples,
            weightGrams,
            marketplace: "ebay",
            config: feeConfig,
          })
        : null;

    const localSupplier = parseFloat(product.supplierPrice?.toString() || "0");
    const priceChanged = supplierPrice > 0 && Math.abs(localSupplier - supplierPrice) > 0.01;
    const stockChanged = (product.stock || 0) !== stock;

    const update: any = { lastSyncedAt: now, stock };
    // Record TME's product_status so the listing-candidate filter can exclude
    // items TME will not sell us (CANNOT_BE_ORDERED, NOT_IN_OFFER, ...).
    // Only written when v2 actually returned statuses, so a v1 run never
    // clears what v2 previously learned.
    if (useV2) {
      const st = statusBySymbol.get(sym);
      if (st) update.tmeProductStatus = st.length ? st.join(",") : "";
      const pars = paramsBySymbol.get(sym);
      if (pars && pars.length > 0) update.tmeParameters = JSON.stringify(pars);
    }
    if (supplierPrice > 0) update.supplierPrice = String(supplierPrice);
    if (pricing && product.useCalculatedPrice !== false) {
      update.salePrice = String(pricing.finalPrice);
      update.calculatedPrice = String(pricing.calculatedPrice);
      update.marginTier = pricing.marginTier;
      update.marginPercentage = String(pricing.marginPercentage);
      update.priceUpdatedAt = now;
    }
    writes.push(storage.updateProduct(product.id, update));

    if (priceChanged || stockChanged) changed++;

    // Effective sellable quantity after any per-product eBay stock cap.
    const limited =
      product.useStockLimit && product.ebayStockLimit != null
        ? Math.min(stock, product.ebayStockLimit)
        : stock;
    const hasOffer = !!product.ebayOfferId;
    const changedFlag = priceChanged || stockChanged;

    // Default intent reflects whether a change could even reach eBay; the
    // branches below override it when a concrete eBay action is queued.
    let intent = "none";
    if (changedFlag) {
      intent = !product.listedOnEbay ? "not_listed" : hasOffer ? "update" : "skipped_no_offer";
    }

    if (product.listedOnEbay && hasOffer && limited <= 0) {
      // Out of stock -> withdraw the live listing (idempotent; withdrawOffer
      // tolerates an already-ended offer). Gated on state, not on `changed`,
      // so a previously-missed 0-stock listing is still recovered.
      withdrawals.push(product);
      intent = "unlist";
    } else if (!product.listedOnEbay && hasOffer && product.ebayListingStatus === ENDED_OOS && limited > 0) {
      // Back in stock and we're the ones who ended it -> would re-publish.
      // SAFETY (incident 2026-06-16): TME's stock figure can include
      // not-yet-arrived "expected" deliveries (a 0-available / 70-expected SKU
      // reported 70 here), so an automatic relist risks selling stock TME
      // can't ship. Suppressed by default until extractStock is corrected to
      // exclude expected stock; set RELIST_ON_RESTOCK=true to restore the old
      // behavior once that fix lands.
      if (process.env.RELIST_ON_RESTOCK === "true") {
        relists.push(product);
        intent = "relist";
      } else {
        intent = "relist_suppressed";
      }
    } else if (product.listedOnEbay && hasOffer && (priceChanged || stockChanged)) {
      // Still in stock with a change -> push qty/price via the Inventory API.
      inventoryUpdates.push({
        product: { ...product, stock },
        quantity: Math.max(0, limited),
        price: pricing ? Number(pricing.finalPrice) : parseFloat(product.salePrice) || 0,
      });
      intent = "update";
    }

    // Record an audit row when TME data changed, or when an eBay state action
    // (un/relist, or a suppressed relist) fires even without a price/stock delta.
    if (changedFlag || intent === "unlist" || intent === "relist" || intent === "relist_suppressed") {
      audits.set(product.id, {
        productId: product.id,
        sku: product.sku,
        source,
        priceChanged,
        stockChanged,
        oldSupplierPrice: product.supplierPrice != null ? String(product.supplierPrice) : null,
        newSupplierPrice: supplierPrice > 0 ? String(supplierPrice) : null,
        oldStock: product.stock ?? 0,
        newStock: stock,
        ebayAction: "none",
        ebayError: null,
        _intent: intent,
      });
    }
  }

  // Flush this chunk's DB writes concurrently (pool-bounded) rather than
  // serially — the main per-chunk latency win at scale.
  if (writes.length > 0) {
    const settled = await Promise.allSettled(writes);
    const failedWrites = settled.filter((s) => s.status === "rejected").length;
    if (failedWrites > 0) errors.push(`DB writes: ${failedWrites} failed`);
  }

  let ebayUpdated = 0;
  const invResultBySku = new Map<string, { ok: boolean; error?: string }>();
  if (inventoryUpdates.length > 0) {
    try {
      const { updateListedProductsViaInventory } = await import("./ebay-lister");
      const r = await updateListedProductsViaInventory(inventoryUpdates);
      ebayUpdated += r.updated;
      for (const res of r.results) invResultBySku.set(res.sku, res);
      if (r.failed) errors.push(`eBay updates: ${r.failed} failed`);
    } catch (e) {
      errors.push(`eBay update failed: ${(e as Error).message}`);
    }
  }

  // Withdraw listings that went out of stock; mark them so we can re-list
  // automatically (and keep the ramp from creating a duplicate offer).
  let ebayUnlisted = 0;
  for (const product of withdrawals) {
    const a = audits.get(product.id);
    try {
      const r = await ebayInventoryApi.withdrawOffer(product.ebayOfferId);
      if (r.ok) {
        ebayUnlisted++;
        await storage.updateProduct(product.id, {
          listedOnEbay: false,
          ebayListingStatus: ENDED_OOS,
        });
        if (a) a.ebayAction = "unlisted";
      } else {
        errors.push(`withdraw ${product.sku}: ${r.error || r.httpStatus}`);
        if (a) { a.ebayAction = "failed"; a.ebayError = String(r.error || r.httpStatus); }
      }
    } catch (e) {
      errors.push(`withdraw ${product.sku}: ${(e as Error).message}`);
      if (a) { a.ebayAction = "failed"; a.ebayError = (e as Error).message; }
    }
  }

  // Re-publish offers we previously auto-ended, now that stock is back.
  let ebayRelisted = 0;
  for (const product of relists) {
    const a = audits.get(product.id);
    try {
      const r = await ebayInventoryApi.publishOffer(product.ebayOfferId);
      if (r.ok) {
        ebayRelisted++;
        await storage.updateProduct(product.id, {
          listedOnEbay: true,
          ebayListingStatus: "published",
          ...(r.listingId ? { ebayListingId: r.listingId } : {}),
        });
        if (a) a.ebayAction = "relisted";
      } else {
        errors.push(`relist ${product.sku}: ${r.error || r.httpStatus}`);
        if (a) { a.ebayAction = "failed"; a.ebayError = String(r.error || r.httpStatus); }
      }
    } catch (e) {
      errors.push(`relist ${product.sku}: ${(e as Error).message}`);
      if (a) { a.ebayAction = "failed"; a.ebayError = (e as Error).message; }
    }
  }

  // Resolve the remaining intents (un/relist were patched in-loop above) and
  // persist the per-SKU audit trail. Best-effort: a logging failure must not
  // fail the sync itself.
  const auditRows: InsertSyncAudit[] = [];
  for (const a of Array.from(audits.values())) {
    const { _intent, ...row } = a;
    switch (_intent) {
      case "update": {
        const r = invResultBySku.get(a.sku);
        if (r?.ok) row.ebayAction = "updated";
        else {
          row.ebayAction = "failed";
          row.ebayError = r?.error ?? "not attempted (eBay daily limit?)";
        }
        break;
      }
      case "skipped_no_offer":
        row.ebayAction = "skipped_no_offer";
        break;
      case "not_listed":
        row.ebayAction = "not_listed";
        break;
      case "unlist":
      case "relist":
        // Already set on the draft during the withdrawal/relist loops; if the
        // action somehow didn't run, fall back to a failed marker.
        if (row.ebayAction === "none") {
          row.ebayAction = "failed";
          row.ebayError = "eBay action not executed";
        }
        break;
      case "relist_suppressed":
        // Would have relisted, but auto-relist on restock is disabled because
        // TME stock may include not-yet-arrived expected deliveries.
        row.ebayAction = "relist_suppressed";
        row.ebayError = "auto-relist suppressed (stock may include expected delivery)";
        break;
      default:
        row.ebayAction = "none";
    }
    auditRows.push(row);
  }
  try {
    await storage.createSyncAuditEntries(auditRows);
  } catch (e) {
    errors.push(`audit write failed: ${(e as Error).message}`);
  }

  // Tiered staleness (batch 3): count listed + unlisted against their own
  // cutoffs, not a single staleBefore.
  const remaining = Math.max(
    0,
    await storage.getStaleTmeProductCount(cutoffs.listed, cutoffs.unlisted),
  );
  return {
    total,
    remaining,
    processedThisChunk: slice.length,
    processedListed: slice.filter((p) => p.listedOnEbay).length,
    changed,
    ebayUpdated,
    ebayUnlisted,
    ebayRelisted,
    done: remaining === 0,
    errors,
  };
}

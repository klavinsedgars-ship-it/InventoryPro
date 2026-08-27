/**
 * Bulk eBay listing via the Inventory API: takes products, runs them
 * through inventory item -> offer -> publish in 25-SKU bulk batches, and
 * persists the resulting offer/listing ids + status on each product.
 * Stops early if eBay signals a rate/call limit so the ramp resumes later.
 */
import type { Product } from "@shared/schema";
import { storage } from "./storage";
import { ebayInventoryApi } from "./ebay-inventory-api";
import { validateListingEnv } from "./ebay-env";
import { calculateEbayStock } from "./stock-manager";
import { mapPool } from "./concurrency";

/** Category lookups per batch to run at once — cache hits or Taxonomy calls. */
const CATEGORY_CONCURRENCY = Math.min(12, Math.max(1, Number(process.env.EBAY_CATEGORY_CONCURRENCY) || 8));

export interface ListBatchResult {
  attempted: number;
  published: number;
  failed: number;
  limitHit: boolean;
  results: Array<{ sku: string; ok: boolean; listingId?: string; error?: string }>;
}

const LIMIT_RX = /\blimit\b|too many|rate.?limit|2001\b|21917|exceed/i;

/**
 * eBay refused the item on policy grounds — a prohibited or restricted
 * product, not a fixable payload problem. Observed: a GPS receiver module
 * rejected as a suspected signal jammer (25019).
 *
 * These must not be retried. Nothing about the next attempt differs, and
 * repeatedly pushing an item eBay has called prohibited is exactly the
 * behaviour that attracts selling restrictions.
 */
const POLICY_RX = /\b25019\b|eBay-Grunds|nicht erlaubt|prohibited|restricted item|violat/i;

/**
 * eBay broke, not the listing: "A system error has occurred. Internal Server
 * Error" and friends. Observed at ~2% of publishes under load.
 *
 * These must not burn an attempt. Nothing is wrong with the product, and three
 * unlucky ticks would otherwise park a perfectly listable SKU permanently
 * until someone noticed and requeued it.
 *
 * 25604 "Availability not found" belongs here too, though it reads like a
 * payload fault. The inventory item is written and the offer created moments
 * before the publish that rejects it, the products carry stock (the candidate
 * query and the shippability guard both require it), and eBay's own message
 * ends "Please try again" — the signature of a service that has not yet
 * propagated the availability it was just given. It tracks listing volume,
 * ~2-6% per tick, rather than any property of the products.
 */
const TRANSIENT_RX = /system error|internal server error|temporarily unavailable|try again|service unavailable|\b50[0234]\b|\b25604\b|availability not found|verfügbarkeit nicht gefunden/i;

export async function listProductsViaInventory(allProducts: Product[]): Promise<ListBatchResult & { skipped: number }> {
  const results: ListBatchResult["results"] = [];
  let published = 0;
  let failed = 0;
  let limitHit = false;

  // Never list out-of-stock items (eBay won't publish a 0-qty offer, and
  // it's an oversell risk). Report them as skipped.
  const products = allProducts.filter((p) => (p.stock ?? 0) > 0);
  const skipped = allProducts.length - products.length;
  for (const p of allProducts.filter((p) => (p.stock ?? 0) <= 0)) {
    results.push({ sku: p.sku, ok: false, error: "skipped: out of stock" });
  }

  // Per-product flow: independent and resilient (one failure never blocks
  // the rest, unlike a bulk batch which rejects everything on one bad item).
  //
  // CONCURRENT, not sequential: each listing spends ~6s in 4 serial eBay
  // calls plus image processing, so one-at-a-time meant 250 listings ≈ 25
  // minutes of mostly waiting. A pool of workers (default 6, tune via
  // EBAY_LIST_CONCURRENCY) cuts that to ~4 minutes. eBay's call budget is
  // ~2M/day — request volume is unchanged, only the waiting overlaps. On a
  // rate-limit error the pool stops LAUNCHING new products but lets
  // in-flight ones finish.
  const CONCURRENCY = Math.min(12, Math.max(1, Number(process.env.EBAY_LIST_CONCURRENCY) || 6));
  let cursor = 0;

  const listOne = async (prod: Product): Promise<void> => {
    const r = await ebayInventoryApi.listOneProduct(prod);

    if (r.ok && r.listingId) {
      published++;
      // Reset the attempt counter on success so a previously-stuck SKU that
      // we just listed manually is back in clean state.
      await storage.updateProduct(prod.id, {
        listedOnEbay: true,
        ebayOfferId: r.offerId ?? null,
        ebayListingId: r.listingId,
        ebayItemId: r.listingId,
        ebayListingStatus: "published",
        ebayListingError: null,
        ebayListAttempts: 0,
      });
      results.push({ sku: prod.sku, ok: true, listingId: r.listingId });
    } else {
      failed++;
      const err = r.error || "unknown error";
      const status = r.offerId ? "offer_created" : r.failedStep === "inventory_item" ? "error" : "error";
      await storage.updateProduct(prod.id, {
        ebayOfferId: r.offerId ?? null,
        ebayListingStatus: status,
        ebayListingError: String(err).slice(0, 500),
      });
      // Atomic increment so the candidate query can park this SKU after
      // EBAY_LIST_MAX_ATTEMPTS (default 3) instead of retrying forever.
      // Don't increment when we're stopping on a rate/call limit — that's
      // not a SKU-level failure and would unfairly penalise the next batch.
      if (!LIMIT_RX.test(String(err))) {
        await storage.incrementEbayListAttempts(prod.id);
      }
      results.push({ sku: prod.sku, ok: false, error: `${r.failedStep || ""}: ${err}`.trim() });
      if (LIMIT_RX.test(String(err))) limitHit = true;
    }
  };

  const worker = async (): Promise<void> => {
    while (!limitHit) {
      const i = cursor++;
      if (i >= products.length) return;
      try {
        await listOne(products[i]);
      } catch (e) {
        // A worker must never die silently mid-pool: record the product as
        // failed and keep the lane running.
        failed++;
        results.push({ sku: products[i].sku, ok: false, error: (e as Error).message });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, products.length) }, () => worker()));

  return { attempted: allProducts.length, published, failed, limitHit, skipped, results };
}

/** Push stock/price updates for already-listed products (25-SKU bulk). */
export async function updateListedProductsViaInventory(
  items: Array<{ product: Product; quantity: number; price: number }>,
): Promise<{
  updated: number;
  failed: number;
  limitHit: boolean;
  results: Array<{ sku: string; ok: boolean; error?: string }>;
}> {
  let updated = 0;
  let failed = 0;
  let limitHit = false;
  const results: Array<{ sku: string; ok: boolean; error?: string }> = [];

  for (let i = 0; i < items.length && !limitHit; i += 25) {
    const chunk = items.slice(i, i + 25).filter((it) => it.product.ebayOfferId);
    if (chunk.length === 0) continue;
    const res = await ebayInventoryApi.bulkUpdatePriceQuantity(
      chunk.map((it) => ({
        sku: it.product.sku,
        offerId: it.product.ebayOfferId!,
        quantity: it.quantity,
        price: it.price,
      })),
    );
    for (const it of chunk) {
      const r = res.get(it.product.sku);
      if (r?.ok) {
        updated++;
        results.push({ sku: it.product.sku, ok: true });
      } else {
        failed++;
        results.push({ sku: it.product.sku, ok: false, error: String(r?.error ?? "unknown") });
        if (LIMIT_RX.test(String(r?.error))) limitHit = true;
      }
    }
  }
  return { updated, failed, limitHit, results };
}

/**
 * Bulk listing via the 25-SKU eBay endpoints: per batch, resolve categories
 * then bulk_create_or_replace_inventory_item -> bulk_create_offer ->
 * bulk_publish_offer, persisting offer/listing ids on each product. ~3 eBay
 * calls per 25 products instead of 3 per product (plus per-product category
 * resolution, cached upstream) — the path for the listing ramp. Each eBay
 * bulk call returns per-SKU status, so one bad item doesn't sink the batch.
 * Stops early on a rate/call limit so the ramp resumes on the next run.
 */
export async function listProductsViaInventoryBulk(
  allProducts: Product[],
): Promise<ListBatchResult & {
  skipped: number;
  envBlocked?: boolean;
  envIssues?: { level: string; key: string; message: string }[];
  locationBlocked?: boolean;
  locationError?: string;
  taxonomyBlocked?: boolean;
  taxonomyError?: string;
}> {
  const results: ListBatchResult["results"] = [];
  let published = 0;
  let failed = 0;
  let limitHit = false;

  // Pre-flight: refuse to start if the env would make every publish fail
  // (missing policies, image token, OAuth). Otherwise we'd burn quota and
  // mark thousands of products as errored for one config issue.
  const env = validateListingEnv();
  if (!env.ok) {
    return {
      attempted: allProducts.length,
      published: 0,
      failed: 0,
      skipped: 0,
      limitHit: false,
      results: [],
      envBlocked: true,
      envIssues: env.issues,
    };
  }

  const products = allProducts.filter((p) => (p.stock ?? 0) > 0);
  const skipped = allProducts.length - products.length;
  for (const p of allProducts.filter((p) => (p.stock ?? 0) <= 0)) {
    results.push({ sku: p.sku, ok: false, error: "skipped: out of stock" });
  }

  // The offer payload references the merchant location, so it must exist
  // before we create offers. The single-product flow does this per call;
  // the bulk flow must do it once up front (this was the gap that made
  // bulk publish fail where single succeeded).
  if (products.length > 0) {
    const loc = await ebayInventoryApi.ensureMerchantLocation();
    if (!loc.ok) {
      // Account-level config problem, not a per-product one: every batch would
      // fail identically. Flag it so the caller stops the whole run instead of
      // grinding through the catalogue marking products as failed.
      return {
        attempted: allProducts.length,
        published: 0,
        failed: products.length,
        skipped,
        limitHit: false,
        locationBlocked: true,
        locationError: `merchant location: ${loc.error}`,
        results: products.map((p) => ({ sku: p.sku, ok: false, error: `merchant location: ${loc.error}` })),
      };
    }
  }

  for (let i = 0; i < products.length && !limitHit; i += 25) {
    let batch = products.slice(i, i + 25);

    // 0) OVERSELL GUARD (TME v2 only). Ask TME whether the quantity we are
    //    about to publish can actually ship today. v1 could only report a
    //    stock number; v2's delivery scope answers per requested quantity,
    //    which is the check that would have prevented the 2026-06 incident.
    if (process.env.TME_API_VERSION === "v2") {
      try {
        const { tmeApiV2 } = await import("./tme-api-v2");
        const symbols = batch.map((p) => p.supplierProductId || p.sku);
        const wanted = batch.map((p) => Math.max(1, calculateEbayStock(p).ebayStock));
        const ship = await tmeApiV2.checkShippable(symbols, wanted);
        const blocked: typeof batch = [];
        batch = batch.flatMap((p, idx) => {
          const r = ship.get(symbols[idx]);
          if (!r) return [p]; // TME said nothing about it — don't invent a block
          if (r.shippableNow <= 0) { blocked.push(p); return []; }
          // Partial availability is a smaller listing, not a skipped one. A
          // product with 1 unit shippable of the 2 we wanted was being dropped
          // entirely; now it lists at 1. Capping stock here is enough — every
          // downstream quantity flows from calculateEbayStock(product).
          if (r.shippableNow < wanted[idx]) {
            return [{ ...p, stock: Math.min(p.stock ?? 0, r.shippableNow) }];
          }
          return [p];
        });
        for (const p of blocked) {
          const r = ship.get(p.supplierProductId || p.sku);
          const msg = `TME cannot ship today (0 available${r?.supplyDate ? `, next supply ${r.supplyDate}` : ""})`;
          failed++;
          results.push({ sku: p.sku, ok: false, error: msg });
          // Record what TME actually says is sellable. Not burning an attempt
          // is right — the stock state will change and the ramp should retry —
          // but leaving stock as-is made these products candidates AGAIN on
          // every tick, so each hour re-fetched, re-asked TME and re-failed the
          // same SKUs forever. Writing the true figure takes them out of the
          // queue until a sync sees stock return, which is also the honest
          // catalogue state and one less way to oversell.
          await storage.updateProduct(p.id, {
            stock: 0,
            status: "inactive",
            ebayListingStatus: "error",
            ebayListingError: msg.slice(0, 500),
          });
        }
      } catch (e) {
        console.warn(`shippability pre-check skipped: ${(e as Error).message}`);
      }
      if (batch.length === 0) continue;
    }

    // 1) Resolve a category per product (Taxonomy, cached upstream). Items
    //    with no category can't be listed.
    // Resolved concurrently: each lookup is an independent cache hit or
    // Taxonomy call, and 25 in sequence added a full serial round-trip chain
    // to every batch before any listing work began.
    const resolved = await mapPool(batch, CATEGORY_CONCURRENCY, async (product) =>
      ({ product, ...(await ebayInventoryApi.resolveCategoryDetailed(product)
        .catch(() => ({ id: "", transient: true }))) }),
    );
    const withCat: Array<{ product: Product; categoryId: string }> = [];
    let transientCategoryFailures = 0;
    for (const { product, id: categoryId, transient } of resolved) {
      if (!categoryId) {
        failed++;
        if (transient) transientCategoryFailures++;
        // A throttled Taxonomy service is not a property of the product. This
        // distinction matters at ramp scale: treating it as one burned an
        // attempt per product per tick and parked thousands of listable SKUs
        // in a single night.
        const msg = transient
          ? "category lookup unavailable (eBay Taxonomy throttled) — will retry"
          : "no category resolved";
        results.push({ sku: product.sku, ok: false, error: msg });
        await storage.updateProduct(product.id, {
          ebayListingStatus: "error",
          ebayListingError: msg,
        });
        if (!transient) await storage.incrementEbayListAttempts(product.id);
        continue;
      }
      withCat.push({ product, categoryId });
    }
    // A whole batch lost to Taxonomy being unavailable is an account-level
    // condition, not 25 unlucky products. Report it so the ramp stops rather
    // than marching through the catalogue at ~25 failures per second — which
    // is exactly how one throttled night produced 3,000 failures and 69
    // listings.
    if (withCat.length === 0 && transientCategoryFailures > 0) {
      return {
        attempted: allProducts.length,
        published,
        failed,
        skipped,
        limitHit,
        taxonomyBlocked: true,
        taxonomyError: "eBay Taxonomy unavailable (throttled). Set EBAY_DEFAULT_CATEGORY_ID to keep listing through it.",
        results,
      };
    }
    if (withCat.length === 0) continue;
    const productBySku = new Map(withCat.map(({ product }) => [product.sku, product]));

    // 2) Inventory items.
    const invRes = await ebayInventoryApi.bulkCreateOrReplaceInventoryItem(withCat);
    const offerInputs = withCat.filter(({ product }) => invRes.get(product.sku)?.ok);
    for (const { product } of withCat) {
      const r = invRes.get(product.sku);
      if (r && !r.ok) {
        failed++;
        results.push({ sku: product.sku, ok: false, error: `inventory_item: ${r.error}` });
        await storage.updateProduct(product.id, {
          ebayListingStatus: "error",
          ebayListingError: `inventory_item: ${String(r.error)}`.slice(0, 500),
        });
        if (!LIMIT_RX.test(String(r.error)) && !TRANSIENT_RX.test(String(r.error))) {
          await storage.incrementEbayListAttempts(product.id);
        }
        if (LIMIT_RX.test(String(r.error))) limitHit = true;
      }
    }
    if (offerInputs.length === 0) continue;

    // 3) Offers.
    const offerRes = await ebayInventoryApi.bulkCreateOffer(offerInputs);
    const toPublish: Array<{ sku: string; offerId: string }> = [];
    for (const { product } of offerInputs) {
      const r = offerRes.get(product.sku);
      if (r?.ok && r.offerId) {
        toPublish.push({ sku: product.sku, offerId: r.offerId });
      } else {
        failed++;
        results.push({ sku: product.sku, ok: false, error: `offer: ${r?.error}` });
        await storage.updateProduct(product.id, {
          ebayOfferId: r?.offerId ?? null,
          ebayListingStatus: r?.offerId ? "offer_created" : "error",
          ebayListingError: `offer: ${String(r?.error)}`.slice(0, 500),
        });
        if (!LIMIT_RX.test(String(r?.error)) && !TRANSIENT_RX.test(String(r?.error))) {
          await storage.incrementEbayListAttempts(product.id);
        }
        if (LIMIT_RX.test(String(r?.error))) limitHit = true;
      }
    }
    if (toPublish.length === 0) continue;

    // 4) Publish. Some publishes fail for reasons that have nothing to do with
    //    the listing: eBay 500s under load, and 25604 "Availability not found"
    //    where the inventory item we just wrote hasn't propagated yet. The
    //    offer already exists, so retrying just those recovers them in this run
    //    instead of leaving them for the next tick.
    //
    //    Backoff, not a single retry: a propagation delay that outlasts one
    //    second is exactly the case a fixed 1s retry cannot fix, and at ~800
    //    listings a tick a few percent is dozens of products an hour.
    let pubRes = await ebayInventoryApi.bulkPublishOffer(toPublish);
    const RETRY_DELAYS_MS = [1000, 4000];
    for (const delay of RETRY_DELAYS_MS) {
      const retryable = toPublish.filter((o) => {
        const r = pubRes.get(o.sku);
        return !(r?.ok && r.listingId) && TRANSIENT_RX.test(String(r?.error));
      });
      if (retryable.length === 0) break;
      await new Promise((res) => setTimeout(res, delay));
      const retryRes = await ebayInventoryApi.bulkPublishOffer(retryable);
      // Merge: a successful retry replaces the transient failure, and a second
      // failure keeps the newer message.
      pubRes = new Map(pubRes);
      retryRes.forEach((r, sku) => pubRes.set(sku, r));
    }
    for (const { sku, offerId } of toPublish) {
      const product = productBySku.get(sku)!;
      const r = pubRes.get(sku);
      if (r?.ok && r.listingId) {
        published++;
        results.push({ sku, ok: true, listingId: r.listingId });
        await storage.updateProduct(product.id, {
          listedOnEbay: true,
          ebayOfferId: offerId,
          ebayListingId: r.listingId,
          ebayItemId: r.listingId,
          ebayListingStatus: "published",
          ebayListingError: null,
          ebayListAttempts: 0,
        });
      } else {
        failed++;
        const err = String(r?.error);
        results.push({ sku, ok: false, error: `publish: ${err}` });
        // A policy refusal is permanent: take the product out of the queue for
        // a human to review, rather than re-offering it until it parks.
        const policyBlocked = POLICY_RX.test(err);
        const transient = TRANSIENT_RX.test(err);
        await storage.updateProduct(product.id, {
          ebayOfferId: offerId,
          ebayListingStatus: policyBlocked ? "error" : "offer_created",
          ebayListingError: (policyBlocked ? `policy: ${err}` : `publish: ${err}`).slice(0, 500),
          ...(policyBlocked ? { excludeFromListing: true } : {}),
        });
        // Attempts are for problems with the product. A rate limit, a policy
        // refusal and an eBay outage are none of them.
        if (!LIMIT_RX.test(err) && !policyBlocked && !transient) {
          await storage.incrementEbayListAttempts(product.id);
        }
        if (LIMIT_RX.test(err)) limitHit = true;
      }
    }
  }

  return { attempted: allProducts.length, published, failed, limitHit, skipped, results };
}

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

export interface ListBatchResult {
  attempted: number;
  published: number;
  failed: number;
  limitHit: boolean;
  results: Array<{ sku: string; ok: boolean; listingId?: string; error?: string }>;
}

const LIMIT_RX = /\blimit\b|too many|rate.?limit|2001\b|21917|exceed/i;

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
  for (const prod of products) {
    if (limitHit) break;
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
  }

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
): Promise<ListBatchResult & { skipped: number; envBlocked?: boolean; envIssues?: { level: string; key: string; message: string }[] }> {
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
      return {
        attempted: allProducts.length,
        published: 0,
        failed: products.length,
        skipped,
        limitHit: false,
        results: products.map((p) => ({ sku: p.sku, ok: false, error: `merchant location: ${loc.error}` })),
      };
    }
  }

  for (let i = 0; i < products.length && !limitHit; i += 25) {
    const batch = products.slice(i, i + 25);

    // 1) Resolve a category per product (Taxonomy, cached upstream). Items
    //    with no category can't be listed.
    const withCat: Array<{ product: Product; categoryId: string }> = [];
    for (const product of batch) {
      const categoryId = await ebayInventoryApi.resolveCategory(product);
      if (!categoryId) {
        failed++;
        results.push({ sku: product.sku, ok: false, error: "no category resolved" });
        await storage.updateProduct(product.id, {
          ebayListingStatus: "error",
          ebayListingError: "no category resolved",
        });
        await storage.incrementEbayListAttempts(product.id);
        continue;
      }
      withCat.push({ product, categoryId });
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
        if (!LIMIT_RX.test(String(r.error))) {
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
        if (!LIMIT_RX.test(String(r?.error))) {
          await storage.incrementEbayListAttempts(product.id);
        }
        if (LIMIT_RX.test(String(r?.error))) limitHit = true;
      }
    }
    if (toPublish.length === 0) continue;

    // 4) Publish.
    const pubRes = await ebayInventoryApi.bulkPublishOffer(toPublish);
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
        results.push({ sku, ok: false, error: `publish: ${r?.error}` });
        await storage.updateProduct(product.id, {
          ebayOfferId: offerId,
          ebayListingStatus: "offer_created",
          ebayListingError: `publish: ${String(r?.error)}`.slice(0, 500),
        });
        if (!LIMIT_RX.test(String(r?.error))) {
          await storage.incrementEbayListAttempts(product.id);
        }
        if (LIMIT_RX.test(String(r?.error))) limitHit = true;
      }
    }
  }

  return { attempted: allProducts.length, published, failed, limitHit, skipped, results };
}

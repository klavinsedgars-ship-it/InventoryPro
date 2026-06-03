/**
 * Bulk eBay listing via the Inventory API: takes products, runs them
 * through inventory item -> offer -> publish in 25-SKU bulk batches, and
 * persists the resulting offer/listing ids + status on each product.
 * Stops early if eBay signals a rate/call limit so the ramp resumes later.
 */
import type { Product } from "@shared/schema";
import { storage } from "./storage";
import { ebayInventoryApi } from "./ebay-inventory-api";

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

  for (let i = 0; i < products.length && !limitHit; i += 25) {
    const chunk = products.slice(i, i + 25);

    // Resolve categories (cached upstream in the Taxonomy resolver).
    const withCat: Array<{ product: Product; categoryId: string }> = [];
    for (const p of chunk) {
      withCat.push({ product: p, categoryId: await ebayInventoryApi.resolveCategory(p) });
    }

    // 1. inventory items
    const invRes = await ebayInventoryApi.bulkCreateOrReplaceInventoryItem(withCat);
    // 2. offers (only where the inventory item succeeded)
    const offerInput = withCat.filter((w) => invRes.get(w.product.sku)?.ok);
    const offerRes = await ebayInventoryApi.bulkCreateOffer(offerInput);
    // 3. publish (only where the offer exists)
    const toPublish: Array<{ sku: string; offerId: string }> = [];
    for (const w of offerInput) {
      const o = offerRes.get(w.product.sku);
      if (o?.ok && o.offerId) toPublish.push({ sku: w.product.sku, offerId: o.offerId });
    }
    const pubRes = toPublish.length ? await ebayInventoryApi.bulkPublishOffer(toPublish) : new Map();

    for (const prod of chunk) {
      const sku = prod.sku;
      const inv = invRes.get(sku);
      const offer = offerRes.get(sku);
      const pub = pubRes.get(sku);

      if (pub?.ok && pub.listingId) {
        published++;
        await storage.updateProduct(prod.id, {
          listedOnEbay: true,
          ebayOfferId: offer?.offerId ?? null,
          ebayListingId: pub.listingId,
          ebayItemId: pub.listingId,
          ebayListingStatus: "published",
          ebayListingError: null,
        });
        results.push({ sku, ok: true, listingId: pub.listingId });
      } else {
        failed++;
        const err = pub?.error || offer?.error || inv?.error || "unknown error";
        const status = offer?.offerId ? "offer_created" : inv?.ok ? "inventory_created" : "error";
        await storage.updateProduct(prod.id, {
          ebayOfferId: offer?.offerId ?? null,
          ebayListingStatus: status,
          ebayListingError: String(err).slice(0, 500),
        });
        results.push({ sku, ok: false, error: String(err) });
        if (LIMIT_RX.test(String(err))) limitHit = true;
      }
    }
  }

  return { attempted: allProducts.length, published, failed, limitHit, skipped, results };
}

/** Push stock/price updates for already-listed products (25-SKU bulk). */
export async function updateListedProductsViaInventory(
  items: Array<{ product: Product; quantity: number; price: number }>,
): Promise<{ updated: number; failed: number; limitHit: boolean }> {
  let updated = 0;
  let failed = 0;
  let limitHit = false;

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
      if (r?.ok) updated++;
      else {
        failed++;
        if (LIMIT_RX.test(String(r?.error))) limitHit = true;
      }
    }
  }
  return { updated, failed, limitHit };
}

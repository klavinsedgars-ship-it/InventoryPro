/**
 * eBay ↔ DB listing reconciliation.
 *
 * After the August database rebuild the products table knew nothing about
 * listings still LIVE on the eBay account: those listings would never receive
 * stock/price updates (oversell risk), and re-listing the same SKUs would
 * create duplicates. This module walks every active listing on the account
 * (GetMyeBaySelling — covers Inventory-API and legacy Trading listings alike),
 * matches them to products by SKU, and — in apply mode — restores the local
 * listing state (listedOnEbay, ebayItemId, ebayListingId, ebayOfferId via an
 * Inventory-API offer lookup, so the hourly sync can push updates again).
 *
 * Dry-run by default; nothing on eBay is ever modified — this reads eBay and
 * writes only the local DB.
 */
import { ebayApi } from "./ebay-api";
import { ebayInventoryApi } from "./ebay-inventory-api";
import { storage } from "./storage";

export interface ReconcileReport {
  ok: boolean;
  apply: boolean;
  activeOnEbay: number;
  pagesFetched: number;
  fetchedAllPages: boolean;
  matched: number;            // eBay listing SKU found in products table
  updated: number;            // rows updated (apply mode only)
  offerIdRecovered: number;   // matched listings whose Inventory-API offerId was found
  legacyNoOffer: number;      // matched but no Inventory-API offer (Trading-era listing)
  orphanedOnEbay: Array<{ itemId: string; sku: string | null; title: string; price: number | null; quantity: number | null }>;
  noSkuOnEbay: Array<{ itemId: string; title: string }>;
  dbListedNotOnEbay: number;  // products flagged listed locally but absent from eBay
  dbFlagsCleared: number;     // those flags cleared (apply mode + full fetch only)
  errors: string[];
}

export async function reconcileEbayListings(opts: {
  apply?: boolean;
  maxPages?: number;          // safety cap on Trading API pagination
  maxOfferLookups?: number;   // cap on per-SKU Inventory-API offer lookups
} = {}): Promise<ReconcileReport> {
  const apply = opts.apply === true;
  const maxPages = Math.min(50, Math.max(1, opts.maxPages ?? 25)); // 25×200 = 5k listings
  const maxOfferLookups = Math.max(0, opts.maxOfferLookups ?? 500);
  const errors: string[] = [];

  // 1) Walk the account's active listings.
  const live: Array<{ itemId: string; sku: string | null; title: string; price: number | null; quantity: number | null }> = [];
  let page = 1;
  let totalPages = 1;
  do {
    const r = await ebayApi.getMyActiveListings(page);
    live.push(...r.items);
    totalPages = r.totalPages || 1;
    page++;
  } while (page <= totalPages && page <= maxPages);
  const fetchedAllPages = totalPages <= maxPages;

  // 2) Match by SKU.
  const withSku = live.filter((l) => l.sku);
  const noSkuOnEbay = live.filter((l) => !l.sku).map((l) => ({ itemId: l.itemId, title: l.title }));
  const bySku = new Map(withSku.map((l) => [l.sku as string, l]));
  const products = await storage.getProductsBySkus(Array.from(bySku.keys()));
  const productBySku = new Map(products.map((p) => [p.sku, p]));

  const orphanedOnEbay = withSku
    .filter((l) => !productBySku.has(l.sku as string))
    .map((l) => ({ itemId: l.itemId, sku: l.sku, title: l.title, price: l.price, quantity: l.quantity }));

  // 3) Restore local listing state for matches.
  let updated = 0;
  let offerIdRecovered = 0;
  let legacyNoOffer = 0;
  let offerLookups = 0;
  for (const [sku, listing] of Array.from(bySku.entries())) {
    const product = productBySku.get(sku);
    if (!product) continue;

    let offerId: string | null = null;
    let listingId: string | null = listing.itemId;
    if (offerLookups < maxOfferLookups) {
      offerLookups++;
      try {
        const offer = await ebayInventoryApi.getOfferBySku(sku);
        if (offer) {
          offerId = offer.offerId;
          listingId = offer.listingId ?? listing.itemId;
          offerIdRecovered++;
        } else {
          legacyNoOffer++;
        }
      } catch (e) {
        errors.push(`offer lookup ${sku}: ${(e as Error).message}`);
      }
    }

    if (apply) {
      try {
        await storage.updateProduct(product.id, {
          listedOnEbay: true,
          ebayItemId: listing.itemId,
          ebayListingId: listingId,
          ...(offerId ? { ebayOfferId: offerId } : {}),
          ebayListingStatus: "published",
          ebayListingError: null,
        } as any);
        updated++;
      } catch (e) {
        errors.push(`db update ${sku}: ${(e as Error).message}`);
      }
    }
  }

  // 4) Reverse orphans: products the DB believes are listed but eBay doesn't
  // show as active. Only trustworthy — and only cleared — when every page of
  // the active list was actually fetched.
  const liveSkus = new Set(withSku.map((l) => l.sku as string));
  let dbListed: any[] = [];
  try {
    dbListed = await storage.getProductsWithFilters({ listedOnEbay: true });
  } catch (e) {
    errors.push(`db listed-products query: ${(e as Error).message}`);
  }
  const dbGhosts = dbListed.filter((p) => p.sku && !liveSkus.has(p.sku));
  let dbFlagsCleared = 0;
  if (apply && fetchedAllPages) {
    for (const p of dbGhosts) {
      try {
        await storage.updateProduct(p.id, {
          listedOnEbay: false,
          ebayListingStatus: "unlisted",
        } as any);
        dbFlagsCleared++;
      } catch (e) {
        errors.push(`clear flag ${p.sku}: ${(e as Error).message}`);
      }
    }
  }

  const report: ReconcileReport = {
    ok: true,
    apply,
    activeOnEbay: live.length,
    pagesFetched: page - 1,
    fetchedAllPages,
    matched: withSku.length - orphanedOnEbay.length,
    updated,
    offerIdRecovered,
    legacyNoOffer,
    orphanedOnEbay: orphanedOnEbay.slice(0, 200),
    noSkuOnEbay: noSkuOnEbay.slice(0, 100),
    dbListedNotOnEbay: dbGhosts.length,
    dbFlagsCleared,
    errors: errors.slice(0, 30),
  };

  try {
    await storage.createSyncLog({
      source: "ebay",
      operation: "reconcile_listings",
      status: errors.length === 0 ? "success" : "partial",
      message: `Reconcile${apply ? "" : " (dry-run)"}: ${live.length} active on eBay, ${report.matched} matched, ${updated} restored, ${orphanedOnEbay.length} orphaned, ${dbGhosts.length} DB-ghosts`,
      details: JSON.stringify({ ...report, orphanedOnEbay: report.orphanedOnEbay.slice(0, 30) }),
    });
  } catch { /* best-effort log */ }

  return report;
}

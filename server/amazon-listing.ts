/**
 * Amazon listing payload construction and pre-flight checks. PURE — no
 * network, no database — so the rules that decide what reaches Amazon are
 * unit-testable before a single credential exists.
 *
 * STRATEGY: offer-only listings against EXISTING ASINs.
 *
 * We resell branded manufacturer goods (TME, Getic, Green Cell, ACC). Those
 * products are already in Amazon's catalogue, so the right move is to attach
 * an offer to the existing ASIN rather than create one. Creating an ASIN means
 * supplying a full product-type attribute set, owning the brand or holding a
 * GTIN exemption, and taking responsibility for the detail page — none of
 * which apply to a reseller. Offer-only listings need just: the ASIN
 * (merchant_suggested_asin), condition, price, and fulfilment availability.
 *
 * A product with no EAN therefore cannot be listed on Amazon at all. That is a
 * property of the catalogue, not a bug: on eBay we can invent a listing from a
 * name; on Amazon there is nothing to attach an offer to.
 */

import type { Product } from "@shared/schema";
import { calculateEbayStock } from "./stock-manager";

/** Amazon requires an EAN/UPC-shaped barcode: 8, 12, 13 or 14 digits. */
export function isValidBarcode(ean: string | null | undefined): boolean {
  if (!ean) return false;
  const digits = ean.trim();
  return /^\d{8}$|^\d{12,14}$/.test(digits);
}

export interface PreflightResult {
  ok: boolean;
  /** Why this product cannot be listed, in operator language. */
  reasons: string[];
  /** True when the block is expected to clear on its own (stock, matching). */
  transient: boolean;
}

/**
 * Can this product be listed on Amazon right now? Ordered so the permanent
 * reasons come first — an operator scanning a parked list wants "no EAN"
 * (never fixable) separated from "out of stock" (fixes itself).
 */
export function preflightAmazon(
  product: Pick<Product,
    | "sku" | "ean" | "amazonAsin" | "salePrice" | "stock" | "status"
    | "excludeFromListing" | "ebayStockLimit" | "useStockLimit"
  >,
): PreflightResult {
  const reasons: string[] = [];
  let transient = false;

  if (product.excludeFromListing) reasons.push("excluded from listing by operator");
  if (!isValidBarcode(product.ean)) {
    reasons.push("no valid EAN — Amazon offers must attach to an existing ASIN, which we find by barcode");
  }
  if (!product.amazonAsin) {
    reasons.push("no ASIN matched yet — run the EAN→ASIN match first");
    transient = true;
  }
  const price = parseFloat(String(product.salePrice ?? ""));
  if (!Number.isFinite(price) || price <= 0) reasons.push("no sale price");
  if (product.status !== "active") {
    reasons.push(`product status is ${product.status}`);
    transient = true;
  }
  const qty = amazonQuantity(product as Product);
  if (qty <= 0) {
    reasons.push("no sellable stock");
    transient = true;
  }

  return { ok: reasons.length === 0, reasons, transient: reasons.length > 0 && transient };
}

/**
 * Quantity to publish. Reuses the eBay stock policy deliberately: the same
 * physical stock backs both marketplaces, and the per-product limit exists to
 * cap oversell exposure — a reason that applies to Amazon at least as much,
 * where late shipment metrics can suspend an account.
 */
export function amazonQuantity(product: Product): number {
  return Math.max(0, calculateEbayStock(product).ebayStock);
}

/**
 * The seller SKU we publish under. Same code as everywhere else in the system
 * (supplier code = products.sku = eBay SKU), so an Amazon order maps back to a
 * product with no extra lookup table. Amazon allows up to 40 characters and
 * forbids nothing we use, but the length cap is real.
 */
export function amazonSellerSku(product: Pick<Product, "sku">): string {
  return product.sku.trim().slice(0, 40);
}

export interface OfferListingInput {
  product: Product;
  marketplaceId: string;
  currency: string;
  /** Defaults to the product's sale price. */
  price?: number;
  quantity?: number;
  /** Handling time in days shown to the buyer. */
  handlingDays?: number;
  /**
   * Merchant shipping template name. Omitted unless set: Amazon falls back to
   * the account's default template, and naming a template that does not exist
   * fails the whole submission.
   */
  shippingGroup?: string;
  condition?: "new_new" | "used_like_new" | "used_very_good" | "used_good" | "used_acceptable";
}

/**
 * Build the Listings Items payload for an offer against an existing ASIN.
 *
 * `productType: "PRODUCT"` is the generic type Amazon accepts for offer-only
 * submissions — we are not describing the product (the ASIN already does
 * that), only our offer on it. `merchant_suggested_asin` is what ties the two
 * together; without it Amazon would treat this as a new-product submission and
 * demand the full attribute set for a real product type.
 */
export function buildOfferOnlyListing(input: OfferListingInput): {
  productType: string;
  requirements: string;
  attributes: Record<string, unknown>;
} {
  const { product, marketplaceId, currency } = input;
  const asin = product.amazonAsin;
  if (!asin) throw new Error(`buildOfferOnlyListing: ${product.sku} has no ASIN`);

  const price = input.price ?? parseFloat(String(product.salePrice));
  const quantity = input.quantity ?? amazonQuantity(product);
  const handlingDays = input.handlingDays ?? 3;
  const condition = input.condition ?? "new_new";
  const m = [{ marketplace_id: marketplaceId }];

  return {
    productType: "PRODUCT",
    // LISTING_OFFER_ONLY tells Amazon to validate this as an offer on an
    // existing ASIN, not as a new product definition.
    requirements: "LISTING_OFFER_ONLY",
    attributes: {
      condition_type: [{ value: condition, ...m[0] }],
      merchant_suggested_asin: [{ value: asin, ...m[0] }],
      purchasable_offer: [
        {
          currency,
          our_price: [{ schedule: [{ value_with_tax: Number(price.toFixed(2)) }] }],
          ...m[0],
        },
      ],
      fulfillment_availability: [
        {
          fulfillment_channel_code: "DEFAULT", // merchant-fulfilled (we ship)
          quantity,
          lead_time_to_ship_max_days: handlingDays,
        },
      ],
      ...(input.shippingGroup
        ? { merchant_shipping_group: [{ value: input.shippingGroup, ...m[0] }] }
        : {}),
    },
  };
}

/**
 * JSON Patch operations for a price/quantity change on a live listing — the
 * cheap path used by the repricing and stock sweeps, versus a full PUT.
 */
export function buildOfferPatches(opts: {
  marketplaceId: string;
  currency: string;
  price?: number;
  quantity?: number;
  handlingDays?: number;
}): Array<{ op: string; path: string; value: unknown }> {
  const patches: Array<{ op: string; path: string; value: unknown }> = [];
  if (opts.price != null && Number.isFinite(opts.price)) {
    patches.push({
      op: "replace",
      path: "/attributes/purchasable_offer",
      value: [
        {
          marketplace_id: opts.marketplaceId,
          currency: opts.currency,
          our_price: [{ schedule: [{ value_with_tax: Number(opts.price.toFixed(2)) }] }],
        },
      ],
    });
  }
  if (opts.quantity != null && Number.isFinite(opts.quantity)) {
    patches.push({
      op: "replace",
      path: "/attributes/fulfillment_availability",
      value: [
        {
          fulfillment_channel_code: "DEFAULT",
          quantity: Math.max(0, Math.floor(opts.quantity)),
          ...(opts.handlingDays != null ? { lead_time_to_ship_max_days: opts.handlingDays } : {}),
        },
      ],
    });
  }
  return patches;
}

/**
 * Pick the best ASIN from a Catalog Items search result.
 *
 * Amazon can return several ASINs for one barcode (regional variants, bundle
 * listings, stale duplicates). Preferring an item whose own identifiers echo
 * the barcode we searched for keeps us off "similar but not the same" pages —
 * attaching an offer to the wrong ASIN is the Amazon version of the eBay
 * miscategorisation incident, and buyers notice it just as fast.
 */
export function pickAsinForBarcode(searchResponse: unknown, ean: string): { asin: string; title?: string; brand?: string } | null {
  const items = (searchResponse as any)?.items;
  if (!Array.isArray(items) || items.length === 0) return null;

  const wanted = ean.trim();
  const echoesBarcode = (item: any) =>
    (item?.identifiers ?? []).some((block: any) =>
      (block?.identifiers ?? []).some(
        (id: any) => String(id?.identifier ?? "").trim() === wanted && /EAN|UPC|GTIN/i.test(String(id?.identifierType ?? "")),
      ),
    );

  const chosen = items.find(echoesBarcode) ?? (items.length === 1 ? items[0] : null);
  if (!chosen?.asin) return null;

  const summary = Array.isArray(chosen.summaries) ? chosen.summaries[0] : undefined;
  return { asin: chosen.asin, title: summary?.itemName, brand: summary?.brand };
}

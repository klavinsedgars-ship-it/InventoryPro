/**
 * eBay Sell Inventory API adapter (REST). Replaces the Trading-API XML
 * listing path for scale: SKU-keyed inventory items, offers, and
 * publishing, with bulk endpoints (25 SKUs/call) and bulkUpdatePriceQuantity
 * for the hot stock/price path.
 *
 * Model (per SKU):
 *   1. PUT  /inventory_item/{sku}     -> the product (title, aspects, images, weight)
 *   2. POST /offer                    -> the marketplace offer (price, qty, policies, category) -> offerId
 *   3. POST /offer/{offerId}/publish  -> goes live -> listingId
 * Updates:
 *      POST /bulk_update_price_quantity (offerId + qty/price), 25/call
 *
 * Reuses existing assets: OAuth (ebay-oauth), weight->shipping policy,
 * Taxonomy category resolver (ebayApi.getSuggestedCategory), Vercel Blob
 * images, business-policy IDs and marketplace/currency from env.
 */
import type { Product } from "@shared/schema";
import { ebayOAuth } from "./ebay-oauth";
import { ebayApi, filterBundleWords } from "./ebay-api";
import { getShippingPolicyId } from "./shipping-policies";
import { calculateEbayStock } from "./stock-manager";
import { imageProcessingService } from "./image-processing";
import { storage } from "./storage";
import { extractProductSpecs } from "./ebay-unified-template";

const INV_BASE = "https://api.ebay.com/sell/inventory/v1";

function marketplaceId(): string {
  const map: Record<string, string> = {
    "0": "EBAY_US", "3": "EBAY_GB", "77": "EBAY_DE",
    "71": "EBAY_FR", "101": "EBAY_IT", "186": "EBAY_ES",
  };
  return map[process.env.EBAY_MARKETPLACE_SITE_ID || "77"] || "EBAY_DE";
}

// eBay validates Content-Language AND Accept-Language on Inventory API
// calls; they must be a supported locale for the marketplace.
function localeFor(): string {
  const map: Record<string, string> = {
    "0": "en-US", "3": "en-GB", "77": "de-DE",
    "71": "fr-FR", "101": "it-IT", "186": "es-ES",
  };
  return map[process.env.EBAY_MARKETPLACE_SITE_ID || "77"] || "de-DE";
}

interface StepResult {
  step: string;
  ok: boolean;
  httpStatus?: number;
  data?: any;
  error?: string;
}

export class EbayInventoryApiService {
  private currency = process.env.EBAY_LISTING_CURRENCY || "EUR";
  private merchantLocationKey = process.env.EBAY_MERCHANT_LOCATION_KEY || "default-location";
  // Per-request memo to avoid duplicate DB hits inside a single batch.
  private aspectMemo = new Map<string, { name: string; values: string[] }[]>();

  /**
   * Fetch the REQUIRED item aspects for a category (Taxonomy API), cached in
   * Postgres so the cache survives serverless cold starts. eBay rejects
   * publish if a category-required aspect (e.g. "Produktart") is missing,
   * and the set differs per category — so we discover them.
   */
  async getRequiredAspects(categoryId: string): Promise<{ name: string; values: string[] }[]> {
    if (this.aspectMemo.has(categoryId)) return this.aspectMemo.get(categoryId)!;
    const treeId = process.env.EBAY_MARKETPLACE_SITE_ID || "77";
    const cacheKey = `aspects:${treeId}:${categoryId}`;
    const cached = await storage.getTaxonomyCache(cacheKey);
    if (cached) { this.aspectMemo.set(categoryId, cached); return cached; }
    try {
      const token = await ebayOAuth.getValidAccessToken();
      const url =
        `https://api.ebay.com/commerce/taxonomy/v1/category_tree/${treeId}` +
        `/get_item_aspects_for_category?category_id=${encodeURIComponent(categoryId)}`;
      const resp = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "Accept-Language": localeFor(),
          "X-EBAY-C-MARKETPLACE-ID": marketplaceId(),
        },
      });
      if (!resp.ok) return [];
      const data = await resp.json();
      const required = (data?.aspects || [])
        .filter((a: any) => a?.aspectConstraint?.aspectRequired)
        .map((a: any) => ({
          name: a.localizedAspectName as string,
          values: (a.aspectValues || []).map((v: any) => v.localizedValue as string),
        }));
      this.aspectMemo.set(categoryId, required);
      await storage.setTaxonomyCache(cacheKey, required); // 30-day TTL
      return required;
    } catch {
      return [];
    }
  }

  /**
   * Build the aspects object satisfying a category's required aspects.
   * Brand/MPN get the accepted no-info combo; other required aspects get a
   * sensible value (prefer "Sonstige/Other/Nicht zutreffend", else the
   * first allowed value, else free-text "Sonstige").
   */
  // Maps an extracted spec value to a required aspect when the aspect name
  // matches a known shape (voltage / current / power / frequency / brand /
  // mpn). Returns undefined if no real spec applies — caller falls back to
  // the generic "Sonstige" choice. On a parts marketplace these mapped
  // aspects matter for search filterability and conversion.
  private mapSpecToAspect(
    aspectName: string,
    specs: ReturnType<typeof extractProductSpecs>,
    product: Product,
  ): string | undefined {
    const n = aspectName.toLowerCase();
    if (specs.voltage && /(volt|spannung|nennspannung|operating[- ]?voltage)/.test(n)) {
      return `${specs.voltage}V`;
    }
    if (specs.current && /(current|strom|stromstärke|ampere|nennstrom)/.test(n)) {
      return `${specs.current}A`;
    }
    if (specs.power && /(power|leistung|watt|wattage|nennleistung)/.test(n)) {
      return `${specs.power}W`;
    }
    if (specs.frequency && /(frequen|takt|clock)/.test(n)) {
      return `${specs.frequency}Hz`;
    }
    if (specs.temperature && /(temp|temperatur)/.test(n)) {
      return `${specs.temperature}°C`;
    }
    if (specs.brand && /(brand|marke|hersteller|manufactur)/.test(n)) {
      return specs.brand;
    }
    if (/(mpn|herstellernummer|teilenummer|part[- ]?number)/.test(n)) {
      // SKU is a real, unique part number — much better than "Nicht zutreffend"
      // for buyer search and the eBay product-identifier matcher.
      return product.sku;
    }
    return undefined;
  }

  /**
   * Build the aspects object satisfying a category's required aspects. Prefers
   * REAL values extracted from product name/description (voltage/current/etc.),
   * falling back to the safest accepted value for that aspect, then to a
   * generic "Sonstige"/"Markenlos". The fallback ladder used to be the only
   * path — every product shipped with junk aspects, which kills filterable
   * search on a parts marketplace.
   */
  private async buildAspects(product: Product, categoryId: string): Promise<Record<string, string[]>> {
    const aspects: Record<string, string[]> = {};
    const required = await this.getRequiredAspects(categoryId);
    const specs = extractProductSpecs(product);

    for (const a of required) {
      const mapped = this.mapSpecToAspect(a.name, specs, product);
      if (mapped) {
        // If the aspect has a constrained value list, only use the mapped value
        // when it's accepted; otherwise fall through to the existing logic.
        if (a.values.length === 0 || a.values.some((v) => v.toLowerCase() === mapped.toLowerCase())) {
          aspects[a.name] = [mapped];
          continue;
        }
      }
      const lname = a.name.toLowerCase();
      if (lname === "marke" || lname === "brand") {
        aspects[a.name] = [specs.brand || "Markenlos"];
      } else if (lname === "herstellernummer" || lname === "mpn") {
        aspects[a.name] = [product.sku];
      } else if (a.values.length > 0) {
        const generic = a.values.find((v) => /sonst|other|nicht zutreffend|n\/a/i.test(v));
        aspects[a.name] = [generic || a.values[0]];
      } else {
        aspects[a.name] = ["Sonstige"];
      }
    }
    // Always ensure Brand/MPN present even if not flagged required
    if (!aspects["Marke"] && !aspects["Brand"]) aspects["Marke"] = [specs.brand || "Markenlos"];
    if (!aspects["Herstellernummer"] && !aspects["MPN"]) aspects["Herstellernummer"] = [product.sku];
    return aspects;
  }

  private async headers(): Promise<Record<string, string>> {
    const token = await ebayOAuth.getValidAccessToken();
    const locale = localeFor();
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "Content-Language": locale,
      "Accept-Language": locale,
      "X-EBAY-C-MARKETPLACE-ID": marketplaceId(),
    };
  }

  private async req(
    method: string,
    path: string,
    body?: any,
  ): Promise<{ ok: boolean; status: number; data: any; text: string }> {
    const maxAttempts = 4;
    for (let attempt = 1; ; attempt++) {
      const resp = await fetch(`${INV_BASE}${path}`, {
        method,
        headers: await this.headers(),
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      // Count every HTTP call against the daily eBay budget (used by the
      // ops dashboard / usage endpoints). Best-effort.
      try { await storage.trackApiCall("ebay"); } catch {}

      // Retry rate-limit (429) and transient 5xx with backoff, honoring
      // Retry-After when present. Other statuses return immediately.
      if ((resp.status === 429 || resp.status >= 500) && attempt < maxAttempts) {
        const retryAfter = Number(resp.headers.get("retry-after"));
        const waitMs =
          Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : Math.min(16000, 1000 * 2 ** (attempt - 1));
        await resp.body?.cancel?.().catch(() => {});
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }

      const text = await resp.text();
      let data: any = null;
      try { data = text ? JSON.parse(text) : null; } catch {}
      return { ok: resp.ok, status: resp.status, data, text };
    }
  }

  private firstEbayError(data: any, text: string): string {
    const e = data?.errors?.[0];
    if (e) return `${e.errorId ?? ""} ${e.message ?? ""} ${e.parameters ? JSON.stringify(e.parameters) : ""}`.trim();
    return (text || "").slice(0, 400);
  }

  /**
   * Ensure a merchant inventory location exists (required to publish
   * offers). Idempotent: a 409/already-exists is treated as success.
   */
  async ensureMerchantLocation(): Promise<StepResult> {
    // GET first
    const got = await this.req("GET", `/location/${this.merchantLocationKey}`);
    if (got.ok) return { step: "location", ok: true, httpStatus: got.status, data: { existing: true } };

    const body = {
      location: {
        address: {
          addressLine1: process.env.EBAY_LOCATION_ADDRESS || "Riga",
          city: process.env.EBAY_LOCATION_CITY || "Riga",
          postalCode: process.env.EBAY_LOCATION_POSTAL || "LV-1001",
          country: process.env.EBAY_LISTING_COUNTRY || "LV",
        },
      },
      locationInstructions: "Ships from EU warehouse",
      name: process.env.EBAY_LOCATION_NAME || "EU Warehouse",
      merchantLocationStatus: "ENABLED",
      locationTypes: ["WAREHOUSE"],
    };
    const created = await this.req("POST", `/location/${this.merchantLocationKey}`, body);
    if (created.ok || created.status === 204) {
      return { step: "location", ok: true, httpStatus: created.status, data: { created: true } };
    }
    // 409 = already exists
    if (created.status === 409) {
      return { step: "location", ok: true, httpStatus: 409, data: { existing: true } };
    }
    return { step: "location", ok: false, httpStatus: created.status, error: this.firstEbayError(created.data, created.text) };
  }

  /** Resolve the image URL(s) for a product (Blob-processed when available). */
  // Resolves a product's image to the URL that ends up on the eBay offer.
  // The TME source image carries a competitor watermark, so we try to strip
  // it via imageProcessingService. On failure the historical behaviour was
  // to silently ship the watermarked image — a conversion killer and a
  // potential policy issue.
  //
  // REQUIRE_WATERMARK_REMOVAL=true switches to fail-closed: throws so the
  // publish path returns an error and the listing isn't created with the
  // watermarked image. Default stays at "best-effort fallback" to preserve
  // the current ramp behaviour until the operator opts in.
  private async resolveImages(product: Product): Promise<string[]> {
    if (!product.imageUrl) return [];
    const fixed = product.imageUrl.startsWith("//") ? "https:" + product.imageUrl : product.imageUrl;
    const hasBlob = !!process.env.BLOB_READ_WRITE_TOKEN;
    const publicBaseUrl = process.env.PUBLIC_BASE_URL || process.env.REPL_URL;
    const strict = process.env.REQUIRE_WATERMARK_REMOVAL === "true";
    if (!hasBlob && !publicBaseUrl) {
      if (strict) throw new Error("watermark removal not configured (no BLOB_READ_WRITE_TOKEN / PUBLIC_BASE_URL)");
      return [fixed];
    }
    try {
      const r = await imageProcessingService.removeWatermark(fixed);
      if (r.success && r.processedImageUrl) {
        return [r.processedImageUrl.startsWith("http") ? r.processedImageUrl : `${publicBaseUrl}${r.processedImageUrl}`];
      }
      if (strict) throw new Error(`watermark removal failed: ${r.error || "unknown"}`);
    } catch (e) {
      if (strict) throw e instanceof Error ? e : new Error(String(e));
      /* fall through to raw image */
    }
    return [fixed];
  }

  /** Build a <=80-char eBay title that always contains the SKU (findability). */
  private async buildTitle(product: Product): Promise<string> {
    let base = product.name;
    try {
      const { generateUnifiedEbayTemplate } = await import("./ebay-unified-template");
      base = generateUnifiedEbayTemplate(product)?.title || product.name;
    } catch { /* fall back to name */ }
    let title = filterBundleWords(base).trim();
    // Guarantee the SKU is present (it makes the listing findable by part no.)
    if (!title.toLowerCase().includes(product.sku.toLowerCase())) {
      const room = 80 - product.sku.length - 1;
      title = `${title.slice(0, Math.max(0, room)).trim()} ${product.sku}`;
    }
    return title.slice(0, 80).trim();
  }

  /** Build the inventory_item payload from a product. */
  private async buildInventoryItem(product: Product, categoryId: string) {
    const stock = calculateEbayStock(product).ebayStock;
    const images = await this.resolveImages(product);
    const title = await this.buildTitle(product);
    const weightG = product.weight ? parseFloat(product.weight) : 0;
    const aspects = await this.buildAspects(product, categoryId);

    const qty = Math.max(0, stock);
    return {
      // availabilityDistributions is REQUIRED by bulk_create_or_replace_
      // inventory_item (the single PUT /inventory_item accepts a bare
      // quantity). Without it eBay rejects every item in the batch with
      // "valid quantity and location information must be provided" — which
      // is why single-product listing worked while the whole ramp failed.
      availability: {
        shipToLocationAvailability: {
          quantity: qty,
          availabilityDistributions: [
            { merchantLocationKey: this.merchantLocationKey, quantity: qty },
          ],
        },
      },
      condition: "NEW",
      product: {
        title,
        description: title, // offer carries the rich HTML description
        aspects,
        imageUrls: images,
        brand: "Markenlos",
        mpn: "Nicht zutreffend",
      },
      packageWeightAndSize: weightG > 0 ? { weight: { value: weightG, unit: "GRAM" } } : undefined,
    };
  }

  async createOrReplaceInventoryItem(sku: string, product: Product, categoryId: string): Promise<StepResult & { quantity?: number; aspects?: any }> {
    const item = await this.buildInventoryItem(product, categoryId);
    const quantity = item.availability.shipToLocationAvailability.quantity;
    const r = await this.req("PUT", `/inventory_item/${encodeURIComponent(sku)}`, item);
    if (r.ok || r.status === 204) return { step: "inventory_item", ok: true, httpStatus: r.status, quantity, aspects: item.product.aspects };
    return { step: "inventory_item", ok: false, httpStatus: r.status, quantity, aspects: item.product.aspects, error: this.firstEbayError(r.data, r.text) };
  }

  /** Build an offer payload (price/qty/policies/category) for a SKU. */
  private async buildOffer(product: Product, categoryId: string) {
    const stock = calculateEbayStock(product).ebayStock;
    const price = parseFloat(product.salePrice) || 0;
    const shippingPolicyId = getShippingPolicyId(product.weight ? parseFloat(product.weight) : undefined);

    let description = product.description || product.name;
    try {
      const { generateUnifiedEbayTemplate } = await import("./ebay-unified-template");
      const tpl = generateUnifiedEbayTemplate(product);
      description = tpl?.htmlDescription || tpl?.description || description;
    } catch { /* use fallback */ }

    return {
      sku: product.sku,
      marketplaceId: marketplaceId(),
      format: "FIXED_PRICE",
      availableQuantity: Math.max(0, stock),
      categoryId,
      listingDescription: String(description).slice(0, 500000),
      listingPolicies: {
        paymentPolicyId: process.env.EBAY_PAYMENT_PROFILE_ID,
        returnPolicyId: process.env.EBAY_RETURN_PROFILE_ID,
        fulfillmentPolicyId: shippingPolicyId,
      },
      pricingSummary: { price: { value: price.toFixed(2), currency: this.currency } },
      merchantLocationKey: this.merchantLocationKey,
    };
  }

  /** Create an offer; if one already exists for the SKU, reuse its id. */
  async createOffer(product: Product, categoryId: string): Promise<StepResult & { offerId?: string }> {
    // Never create/refresh an offer at 0.00: a null/NaN salePrice parsed to 0
    // and published a live listing at zero. Fail loudly instead.
    const guardPrice = parseFloat(product.salePrice as any);
    if (!Number.isFinite(guardPrice) || guardPrice <= 0) {
      return { step: "offer", ok: false, error: `refusing to create offer for ${product.sku} at invalid price "${product.salePrice}"` };
    }
    const payload = await this.buildOffer(product, categoryId);
    const r = await this.req("POST", `/offer`, payload);
    if (r.ok && r.data?.offerId) return { step: "offer", ok: true, httpStatus: r.status, offerId: r.data.offerId };

    // Already-exists: eBay returns errorId 25002 with the existing offerId in parameters
    const existing = r.data?.errors?.find((e: any) => String(e.errorId) === "25002");
    const offerIdParam = existing?.parameters?.find((p: any) => p.name === "offerId")?.value;
    if (offerIdParam) {
      // update it to current values
      await this.req("PUT", `/offer/${offerIdParam}`, payload);
      return { step: "offer", ok: true, httpStatus: r.status, offerId: offerIdParam, data: { reused: true } };
    }
    return { step: "offer", ok: false, httpStatus: r.status, error: this.firstEbayError(r.data, r.text) };
  }

  /**
   * Look up the existing offer for a SKU (used by reconciliation to recover
   * offerIds for listings the DB has lost track of). Returns null when the
   * SKU has no Inventory-API offer — e.g. a legacy Trading-API listing.
   */
  async getOfferBySku(sku: string): Promise<{ offerId: string; listingId: string | null; status: string | null } | null> {
    const r = await this.req("GET", `/offer?sku=${encodeURIComponent(sku)}`);
    const offer = r.data?.offers?.[0];
    if (!r.ok || !offer?.offerId) return null;
    return {
      offerId: offer.offerId,
      listingId: offer.listing?.listingId ?? null,
      status: offer.status ?? null,
    };
  }

  async publishOffer(offerId: string): Promise<StepResult & { listingId?: string }> {
    const r = await this.req("POST", `/offer/${offerId}/publish`, {});
    if (r.ok && r.data?.listingId) return { step: "publish", ok: true, httpStatus: r.status, listingId: r.data.listingId };
    return { step: "publish", ok: false, httpStatus: r.status, error: this.firstEbayError(r.data, r.text) };
  }

  // ─── Bulk operations (25 SKUs/call) for the listing ramp & updates ───

  /**
   * Create/replace up to 25 inventory items in one call. Each product is
   * resolved to its category (for aspects) via the Taxonomy resolver.
   * Returns per-SKU ok/error.
   */
  async bulkCreateOrReplaceInventoryItem(
    items: Array<{ product: Product; categoryId: string }>,
  ): Promise<Map<string, { ok: boolean; error?: string }>> {
    const out = new Map<string, { ok: boolean; error?: string }>();
    const requests = [];
    for (const { product, categoryId } of items.slice(0, 25)) {
      requests.push({ sku: product.sku, ...(await this.buildInventoryItem(product, categoryId)) });
    }
    const r = await this.req("POST", `/bulk_create_or_replace_inventory_item`, { requests });
    const responses = r.data?.responses || [];
    for (const resp of responses) {
      const ok = resp.statusCode >= 200 && resp.statusCode < 300;
      out.set(resp.sku, { ok, error: ok ? undefined : this.firstEbayError(resp, JSON.stringify(resp)) });
    }
    // If the envelope itself failed, mark all as failed
    if (!r.ok && responses.length === 0) {
      for (const { product } of items.slice(0, 25)) out.set(product.sku, { ok: false, error: this.firstEbayError(r.data, r.text) });
    }
    return out;
  }

  /** Create up to 25 offers. Returns per-SKU offerId or error. */
  async bulkCreateOffer(
    items: Array<{ product: Product; categoryId: string }>,
  ): Promise<Map<string, { ok: boolean; offerId?: string; error?: string }>> {
    const out = new Map<string, { ok: boolean; offerId?: string; error?: string }>();
    const requests = [];
    for (const { product, categoryId } of items.slice(0, 25)) {
      // Same zero-price guard as createOffer: never offer a SKU at 0.00.
      const p = parseFloat(product.salePrice as any);
      if (!Number.isFinite(p) || p <= 0) {
        out.set(product.sku, { ok: false, error: `invalid price "${product.salePrice}" — offer not created` });
        continue;
      }
      requests.push(await this.buildOffer(product, categoryId));
    }
    if (requests.length === 0) return out;
    const r = await this.req("POST", `/bulk_create_offer`, { requests });
    const responses = r.data?.responses || [];
    for (const resp of responses) {
      const ok = (resp.statusCode >= 200 && resp.statusCode < 300) && resp.offerId;
      if (ok) { out.set(resp.sku, { ok: true, offerId: resp.offerId }); continue; }
      // reuse existing offer (25002 with offerId param)
      const existing = resp.errors?.find((e: any) => String(e.errorId) === "25002");
      const offerIdParam = existing?.parameters?.find((p: any) => p.name === "offerId")?.value;
      if (offerIdParam) out.set(resp.sku, { ok: true, offerId: offerIdParam });
      else out.set(resp.sku, { ok: false, error: this.firstEbayError(resp, JSON.stringify(resp)) });
    }
    if (!r.ok && responses.length === 0) {
      for (const { product } of items.slice(0, 25)) out.set(product.sku, { ok: false, error: this.firstEbayError(r.data, r.text) });
    }
    return out;
  }

  /** Publish up to 25 offers. Returns per-offer listingId or error. */
  async bulkPublishOffer(
    offers: Array<{ sku: string; offerId: string }>,
  ): Promise<Map<string, { ok: boolean; listingId?: string; error?: string }>> {
    const out = new Map<string, { ok: boolean; listingId?: string; error?: string }>();
    const requests = offers.slice(0, 25).map((o) => ({ offerId: o.offerId }));
    const bySku = new Map(offers.map((o) => [o.offerId, o.sku]));
    const r = await this.req("POST", `/bulk_publish_offer`, { requests });
    const responses = r.data?.responses || [];
    for (const resp of responses) {
      const sku = bySku.get(resp.offerId) || resp.offerId;
      const ok = (resp.statusCode >= 200 && resp.statusCode < 300) && resp.listingId;
      out.set(sku, ok ? { ok: true, listingId: resp.listingId } : { ok: false, error: this.firstEbayError(resp, JSON.stringify(resp)) });
    }
    if (!r.ok && responses.length === 0) {
      for (const o of offers.slice(0, 25)) out.set(o.sku, { ok: false, error: this.firstEbayError(r.data, r.text) });
    }
    return out;
  }

  /**
   * Update price + available quantity for up to 25 SKUs (the hot path).
   * `items` carry the offerId, new quantity and price.
   */
  async bulkUpdatePriceQuantity(
    items: Array<{ sku: string; offerId: string; quantity: number; price: number }>,
  ): Promise<Map<string, { ok: boolean; error?: string }>> {
    const out = new Map<string, { ok: boolean; error?: string }>();
    // Guard: a NaN/zero price here repriced a LIVE listing to "0.00"/"NaN".
    // Refuse those items individually; the rest of the batch proceeds.
    const valid = items.slice(0, 25).filter((it) => {
      if (Number.isFinite(it.price) && it.price > 0) return true;
      out.set(it.sku, { ok: false, error: `invalid price ${it.price} — update refused` });
      return false;
    });
    if (valid.length === 0) return out;
    const requests = valid.map((it) => ({
      sku: it.sku,
      shipToLocationAvailability: { quantity: Math.max(0, it.quantity) },
      offers: [{ offerId: it.offerId, availableQuantity: Math.max(0, it.quantity), price: { value: it.price.toFixed(2), currency: this.currency } }],
    }));
    const r = await this.req("POST", `/bulk_update_price_quantity`, { requests });
    const responses = r.data?.responses || [];
    for (const resp of responses) {
      const ok = resp.statusCode >= 200 && resp.statusCode < 300;
      out.set(resp.sku, { ok, error: ok ? undefined : this.firstEbayError(resp, JSON.stringify(resp)) });
    }
    if (!r.ok && responses.length === 0) {
      // Only the items actually sent — don't clobber the per-item refusals.
      for (const it of valid) out.set(it.sku, { ok: false, error: this.firstEbayError(r.data, r.text) });
    }
    return out;
  }

  /** Resolve a product's eBay category via the Taxonomy resolver (cached upstream). */
  async resolveCategory(product: Product): Promise<string> {
    try {
      const s = await ebayApi.getSuggestedCategory(`${product.category} ${product.name}`.slice(0, 80));
      return s?.id || process.env.EBAY_DEFAULT_CATEGORY_ID || "";
    } catch {
      return process.env.EBAY_DEFAULT_CATEGORY_ID || "";
    }
  }

  /** End a live listing by withdrawing its offer (keeps the inventory item). */
  async withdrawOffer(offerId: string): Promise<StepResult> {
    const r = await this.req("POST", `/offer/${offerId}/withdraw`, {});
    if (r.ok || r.status === 200 || r.status === 204) return { step: "withdraw", ok: true, httpStatus: r.status };
    // Already ended / not published is fine
    if (r.status === 400 && /not.*published|already|25710|withdraw/i.test(r.text)) {
      return { step: "withdraw", ok: true, httpStatus: r.status, data: { note: "already ended" } };
    }
    return { step: "withdraw", ok: false, httpStatus: r.status, error: this.firstEbayError(r.data, r.text) };
  }

  private locationEnsured = false;

  /**
   * Full single-product flow: location -> category -> inventory item ->
   * offer -> publish. One product is independent, so a failure here never
   * blocks others (unlike a bulk batch which rejects all on one bad item).
   * This is the proven path used for both the diagnostic and the ramp.
   */
  async listOneProduct(product: Product): Promise<{
    ok: boolean;
    sku: string;
    offerId?: string;
    listingId?: string;
    failedStep?: string;
    error?: string;
    steps: StepResult[];
  }> {
    const steps: StepResult[] = [];

    if (!this.locationEnsured) {
      const loc = await this.ensureMerchantLocation();
      steps.push(loc);
      if (!loc.ok) return { ok: false, sku: product.sku, failedStep: "location", error: loc.error, steps };
      this.locationEnsured = true;
    }

    let categoryId = "";
    try {
      const suggested = await ebayApi.getSuggestedCategory(`${product.category} ${product.name}`.slice(0, 80));
      categoryId = suggested?.id || process.env.EBAY_DEFAULT_CATEGORY_ID || "";
    } catch {
      categoryId = process.env.EBAY_DEFAULT_CATEGORY_ID || "";
    }
    if (!categoryId) return { ok: false, sku: product.sku, failedStep: "category", error: "no category resolved", steps };

    const inv = await this.createOrReplaceInventoryItem(product.sku, product, categoryId);
    steps.push(inv);
    if (!inv.ok) return { ok: false, sku: product.sku, failedStep: "inventory_item", error: inv.error, steps };

    const offer = await this.createOffer(product, categoryId);
    steps.push(offer);
    if (!offer.ok || !offer.offerId) return { ok: false, sku: product.sku, failedStep: "offer", error: offer.error, steps };

    const pub = await this.publishOffer(offer.offerId);
    steps.push(pub);
    return {
      ok: pub.ok,
      sku: product.sku,
      offerId: offer.offerId,
      listingId: pub.listingId,
      failedStep: pub.ok ? undefined : "publish",
      error: pub.error,
      steps,
    };
  }

  /** Diagnostic wrapper: list a single product by id. */
  async listSingleProduct(productId: number, getProduct: (id: number) => Promise<Product | undefined>) {
    const product = await getProduct(productId);
    if (!product) return { ok: false, steps: [{ step: "product", ok: false, error: "Product not found" }] };
    return this.listOneProduct(product);
  }
}

export const ebayInventoryApi = new EbayInventoryApiService();

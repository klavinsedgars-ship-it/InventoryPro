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
  // Cache the required-aspect spec per category (one Taxonomy call each).
  private aspectCache = new Map<string, { name: string; values: string[] }[]>();

  /**
   * Fetch the REQUIRED item aspects for a category (Taxonomy API), cached.
   * eBay rejects publish if a category-required aspect (e.g. "Produktart")
   * is missing, and the set differs per category — so we discover them.
   */
  async getRequiredAspects(categoryId: string): Promise<{ name: string; values: string[] }[]> {
    if (this.aspectCache.has(categoryId)) return this.aspectCache.get(categoryId)!;
    const treeId = process.env.EBAY_MARKETPLACE_SITE_ID || "77";
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
      this.aspectCache.set(categoryId, required);
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
  private async buildAspects(product: Product, categoryId: string): Promise<Record<string, string[]>> {
    const aspects: Record<string, string[]> = {};
    const required = await this.getRequiredAspects(categoryId);
    for (const a of required) {
      const lname = a.name.toLowerCase();
      if (lname === "marke" || lname === "brand") {
        aspects[a.name] = ["Markenlos"];
      } else if (lname === "herstellernummer" || lname === "mpn") {
        aspects[a.name] = ["Nicht zutreffend"];
      } else if (a.values.length > 0) {
        const generic = a.values.find((v) => /sonst|other|nicht zutreffend|n\/a/i.test(v));
        aspects[a.name] = [generic || a.values[0]];
      } else {
        aspects[a.name] = ["Sonstige"];
      }
    }
    // Always ensure Brand/MPN present even if not flagged required
    if (!aspects["Marke"] && !aspects["Brand"]) aspects["Marke"] = ["Markenlos"];
    if (!aspects["Herstellernummer"] && !aspects["MPN"]) aspects["Herstellernummer"] = ["Nicht zutreffend"];
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
    const resp = await fetch(`${INV_BASE}${path}`, {
      method,
      headers: await this.headers(),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await resp.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch {}
    return { ok: resp.ok, status: resp.status, data, text };
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
  private async resolveImages(product: Product): Promise<string[]> {
    if (!product.imageUrl) return [];
    const fixed = product.imageUrl.startsWith("//") ? "https:" + product.imageUrl : product.imageUrl;
    const hasBlob = !!process.env.BLOB_READ_WRITE_TOKEN;
    const publicBaseUrl = process.env.PUBLIC_BASE_URL || process.env.REPL_URL;
    if (!hasBlob && !publicBaseUrl) return [fixed];
    try {
      const r = await imageProcessingService.removeWatermark(fixed);
      if (r.success && r.processedImageUrl) {
        return [r.processedImageUrl.startsWith("http") ? r.processedImageUrl : `${publicBaseUrl}${r.processedImageUrl}`];
      }
    } catch { /* fall through */ }
    return [fixed];
  }

  /** Build the inventory_item payload from a product. */
  private async buildInventoryItem(product: Product, categoryId: string) {
    const stock = calculateEbayStock(product).ebayStock;
    const images = await this.resolveImages(product);
    const title = filterBundleWords(product.name).slice(0, 80);
    const weightG = product.weight ? parseFloat(product.weight) : 0;
    const aspects = await this.buildAspects(product, categoryId);

    return {
      availability: { shipToLocationAvailability: { quantity: Math.max(0, stock) } },
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

  async publishOffer(offerId: string): Promise<StepResult & { listingId?: string }> {
    const r = await this.req("POST", `/offer/${offerId}/publish`, {});
    if (r.ok && r.data?.listingId) return { step: "publish", ok: true, httpStatus: r.status, listingId: r.data.listingId };
    return { step: "publish", ok: false, httpStatus: r.status, error: this.firstEbayError(r.data, r.text) };
  }

  /**
   * Full single-SKU flow: location -> inventory item -> offer -> publish.
   * Returns every step so failures are precisely visible. Used by the
   * diagnostic and (later) the per-item listing path.
   */
  async listSingleProduct(productId: number, getProduct: (id: number) => Promise<Product | undefined>): Promise<{
    ok: boolean;
    sku?: string;
    offerId?: string;
    listingId?: string;
    steps: StepResult[];
  }> {
    const steps: StepResult[] = [];
    const product = await getProduct(productId);
    if (!product) return { ok: false, steps: [{ step: "product", ok: false, error: "Product not found" }] };

    const loc = await this.ensureMerchantLocation();
    steps.push(loc);
    if (!loc.ok) return { ok: false, sku: product.sku, steps };

    // Category via the existing Taxonomy resolver
    let categoryId = "";
    try {
      const suggested = await ebayApi.getSuggestedCategory(`${product.category} ${product.name}`.slice(0, 80));
      categoryId = suggested?.id || process.env.EBAY_DEFAULT_CATEGORY_ID || "";
    } catch {
      categoryId = process.env.EBAY_DEFAULT_CATEGORY_ID || "";
    }
    steps.push({ step: "category", ok: !!categoryId, data: { categoryId } });
    if (!categoryId) return { ok: false, sku: product.sku, steps };

    const inv = await this.createOrReplaceInventoryItem(product.sku, product, categoryId);
    steps.push(inv);
    if (!inv.ok) return { ok: false, sku: product.sku, steps };

    const offer = await this.createOffer(product, categoryId);
    steps.push(offer);
    if (!offer.ok || !offer.offerId) return { ok: false, sku: product.sku, steps };

    const pub = await this.publishOffer(offer.offerId);
    steps.push(pub);
    return {
      ok: pub.ok,
      sku: product.sku,
      offerId: offer.offerId,
      listingId: pub.listingId,
      steps,
    };
  }
}

export const ebayInventoryApi = new EbayInventoryApiService();

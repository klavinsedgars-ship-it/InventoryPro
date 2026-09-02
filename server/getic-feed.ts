/**
 * Getic feed record → normalized supplier offer. Pure: NO network, NO DB.
 *
 * We have not seen the feed's schema, so the mapping is by field-name
 * heuristics over the parsed record, with three guarantees that make a wrong
 * guess cheap to correct:
 *   1. the complete record is stored as `raw` (re-derivable without re-fetch),
 *   2. every field the mapper did NOT consume lands verbatim in `attributes`,
 *   3. `sourceKeys` records which feed key each normalized field was read
 *      from, so the probe endpoint shows the mapping for review.
 */

import type { JsonRecord, JsonValue } from "./xml-feed";

export interface NormalizedOffer {
  supplierSku: string | null;
  name: string | null;
  ean: string | null;
  manufacturer: string | null;
  mpn: string | null;
  categoryPath: string | null;
  description: string | null;
  price: number | null;
  currency: string | null;
  stock: number | null;
  weightG: number | null;
  imageUrl: string | null;
  additionalImages: string[];
  datasheetUrl: string | null;
  productUrl: string | null;
  /** Feed fields the mapper did not consume, verbatim. */
  attributes: Record<string, string | string[]>;
  /** normalized field -> the feed key it came from. */
  sourceKeys: Record<string, string>;
}

/** One flattened feed field: lowercased basename, full path, values. */
interface FlatField {
  key: string; // lowercased last path segment, e.g. "price"
  path: string; // full dotted path as in the feed, e.g. "prices.price"
  values: string[]; // string leaves collected under this path
}

/**
 * Flatten a parsed record into fields keyed by their basename. Arrays and
 * single-child wrappers (<images><image>…</image></images>) collapse into
 * multi-value fields.
 */
export function flattenRecord(rec: JsonRecord): FlatField[] {
  const byPath = new Map<string, FlatField>();

  const add = (path: string, value: string) => {
    const v = value.trim();
    if (!v) return;
    let f = byPath.get(path);
    if (!f) {
      // Basename with the attribute marker and any XML namespace prefix
      // stripped: Google-Merchant-style feeds name everything <g:id>,
      // <g:title>; attribute-style feeds write <product id=".." price="..">.
      // Neither prefix may hide the field from the synonym match — the full
      // path keeps the original spelling.
      let base = (path.split(".").pop() ?? path).replace(/^@/, "").replace(/^[^:]+:/, "");
      // A "[key]" suffix comes from the key-in-attribute dialect above and IS
      // the field's real name.
      const bracket = /\[([^\]]+)\]$/.exec(base);
      if (bracket) base = bracket[1];
      f = { key: base.toLowerCase(), path, values: [] };
      byPath.set(path, f);
    }
    f.values.push(v);
  };

  const walk = (value: JsonValue, path: string) => {
    if (typeof value === "string") {
      add(path, value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item, path);
      return;
    }
    // Key-in-attribute dialect: <field name="sku">ABC</field> parses to
    // {"@name":"sku","#text":"ABC"} — the field's NAME is an attribute VALUE,
    // invisible to element-name matching. Register the text under that name
    // (as well as under the element's own path, for the raw record).
    const keyAttr = value["@name"] ?? value["@key"] ?? value["@field"];
    const text = value["#text"];
    const keyed =
      typeof keyAttr === "string" && typeof text === "string" && /^[\w.-]{1,64}$/.test(keyAttr.trim());
    if (keyed) {
      add(path ? `${path}[${(keyAttr as string).trim()}]` : (keyAttr as string).trim(), text as string);
    }
    for (const [k, v] of Object.entries(value)) {
      // In the keyed dialect the marker attribute and the text are ALREADY the
      // field — walking them as ordinary entries would invent a bogus "name"
      // field whose value is the literal key ("sku").
      if (keyed && (k === "@name" || k === "@key" || k === "@field" || k === "#text")) continue;
      walk(v, path ? `${path}.${k}` : k);
    }
  };

  walk(rec, "");
  return Array.from(byPath.values());
}

/** "1 234,56" → 1234.56; "€12.30" → 12.3; "1,234" → 1234; "1.5" → 1.5 */
export function parseFeedNumber(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  let s = String(raw).replace(/[\s ]/g, "").replace(/[^0-9.,-]/g, "");
  if (!s) return null;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma !== -1 && lastDot !== -1) {
    // Both present: the later one is the decimal separator.
    if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (lastComma !== -1) {
    // Comma only: thousands when it forms 1,234,567; decimal otherwise.
    if (/^-?\d{1,3}(,\d{3})+$/.test(s)) s = s.replace(/,/g, "");
    else s = s.replace(/,/g, ".");
  } else if (lastDot !== -1 && /^-?\d{1,3}(\.\d{3})+$/.test(s) && !/\.\d{1,2}$/.test(s)) {
    // Dot-as-thousands (1.234.567). A trailing 1–2 digit group stays decimal.
    s = s.replace(/\./g, "");
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * "5" → 5, ">10"/"10+" → 10, "out of stock" → 0,
 * "yes"/"in stock" → null (available, quantity unknown).
 */
export function parseFeedStock(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase();
  const m = /^[><]?\s*(\d+)\s*\+?$/.exec(s);
  if (m) return parseInt(m[1], 10);
  const n = parseFeedNumber(s);
  if (n != null) return Math.max(0, Math.floor(n));
  // Availability text: definite "no" is 0; a bare "yes" stays null because
  // the quantity is unknown — inventing 1 would understate real stock.
  if (/^(out.?of.?stock|not.?available|unavailable|no|false|none|nav pieejams|nav)$/.test(s)) return 0;
  return null;
}

/** Weight in grams. Unit from the key or a value suffix; bare numbers = kg. */
export function parseFeedWeight(key: string, raw: string): { grams: number | null; assumed: boolean } {
  const s = raw.trim().toLowerCase();
  // NOT parseFeedNumber: "1.234" here is 1.234 kg, never a thousands group.
  const numeric = s.replace(/[^0-9.,-]/g, "").replace(",", ".");
  const n = numeric ? parseFloat(numeric) : NaN;
  if (!Number.isFinite(n) || n < 0) return { grams: null, assumed: false };
  const k = key.toLowerCase();
  if (/(^|_)(g|gram|grams)$/.test(k) || /\d\s*(g|gr)\b/.test(s)) return { grams: n, assumed: false };
  if (/kg/.test(k) || /\d\s*kg\b/.test(s)) return { grams: n * 1000, assumed: false };
  // No unit anywhere: consumer-electronics feeds quote kilograms.
  return { grams: n * 1000, assumed: true };
}

// Synonyms cover the feed dialects seen in the Baltics: generic shop XML,
// Google Merchant (namespace prefix already stripped by flattenRecord),
// Heureka-style SHOPITEM (uppercase in the feed, lowercased here), and
// Latvian field names.
const SKU_KEYS = ["sku", "symbol", "product_code", "productcode", "code", "kods", "article", "artikuls", "item_code", "item_id", "itemid", "reference", "product_id", "id"];
const NAME_KEYS = ["name", "title", "product_name", "productname", "nosaukums", "model_name", "model", "product"];
const EAN_KEYS = ["ean", "ean13", "barcode", "bar_code", "gtin", "gtin13"];
const MANUFACTURER_KEYS = ["manufacturer", "brand", "producer", "vendor", "razotajs"];
const MPN_KEYS = ["mpn", "manufacturer_code", "producer_code", "part_number", "partnumber", "manufacturer_sku", "vendor_code", "supplier_code"];
// Supplier/net prices first — that is our cost; retail-ish prices only as a
// fallback (and the sourceKeys entry makes the fallback visible).
const PRICE_KEYS = ["wholesale_price", "purchase_price", "net_price", "price_net", "b2b_price", "dealer_price", "price", "cena"];
const PRICE_FALLBACK_KEYS = ["price_vat", "price_with_vat", "gross_price", "retail_price", "sale_price", "rrp", "msrp"];
const CURRENCY_KEYS = ["currency", "currency_code", "cur", "valuta"];
const STOCK_KEYS = ["stock", "quantity", "qty", "stock_quantity", "stock_qty", "amount", "daudzums", "balance", "in_stock", "instock", "availability", "available", "pieejamiba"];
const WEIGHT_KEYS = ["weight_g", "weight_gram", "weight_grams", "weight_kg", "shipping_weight", "weight", "svars", "mass"];
const IMAGE_KEYS = ["image", "image_url", "image_link", "additional_image_link", "main_image", "picture", "photo", "img", "imgurl", "imgurl_alternative", "attels", "thumbnail"];
const IMAGE_KEY_RE = /^(image|img|photo|picture)_?\d+$/;
const PRODUCT_URL_KEYS = ["url", "link", "product_url", "product_link", "deeplink", "saite"];
const DATASHEET_KEYS = ["datasheet", "datasheet_url", "data_sheet"];
const CATEGORY_KEYS = ["category_path", "category_full", "categoryfullpath", "category", "categories", "category_name", "categorytext", "product_type", "kategorija", "cat", "google_product_category"];
const DESCRIPTION_KEYS = ["description", "long_description", "short_description", "desc", "apraksts", "content"];

const MAX_DESCRIPTION = 20_000;

function isHttpUrl(v: string): boolean {
  return /^https?:\/\//i.test(v.trim());
}

/** Map one parsed feed record to a normalized offer. */
export function mapGeticRecord(rec: JsonRecord): NormalizedOffer {
  const fields = flattenRecord(rec);
  const consumed = new Set<FlatField>();

  // First field whose basename matches, in the priority order of `keys`.
  const find = (keys: string[], opts?: { keep?: boolean }): FlatField | null => {
    for (const key of keys) {
      const f = fields.find((x) => x.key === key && !consumed.has(x));
      if (f) {
        if (!opts?.keep) consumed.add(f);
        return f;
      }
    }
    return null;
  };

  const sourceKeys: Record<string, string> = {};
  const first = (f: FlatField | null): string | null => (f ? f.values[0] : null);

  // Fuzzy fallback for the identity-critical fields: exact basename matching
  // misses compound names (Latvian "preces_kods", "cena_bez_pvn"; English
  // "product_sku_code"). Fires only when the exact pass found nothing, and
  // only on keys free of known other-purpose substrings, so "category_code"
  // can never become the SKU.
  const fuzzyFind = (tokens: string[], excludes: RegExp): FlatField | null => {
    for (const token of tokens) {
      const f = fields.find(
        (x) => !consumed.has(x) && x.key.includes(token) && !excludes.test(x.key),
      );
      if (f) {
        consumed.add(f);
        return f;
      }
    }
    return null;
  };

  // Images FIRST: every matching field, keeping feed order; primary = first
  // URL. Matched by leaf key AND by path: gallery dialects nest the URL
  // under a generic child (<images><image><url>…</url></image></images>
  // flattens to key "url") — and that generic "url"/"link" leaf is exactly
  // what PRODUCT_URL_KEYS would grab, so images must claim their fields
  // before any URL-ish find runs. No other synonym list overlaps these.
  const imagePathRe = /(^|\.)@?(images?|imgs?|photos?|pictures?|gallery|foto)s?(\.|\[|$)/i;
  const imageFields = fields.filter(
    (f) =>
      !consumed.has(f) &&
      (IMAGE_KEYS.includes(f.key) ||
        IMAGE_KEY_RE.test(f.key) ||
        (imagePathRe.test(f.path) && f.values.some((v) => isHttpUrl(v)))),
  );
  const imageUrls: string[] = [];
  for (const f of imageFields) {
    consumed.add(f);
    for (const v of f.values) if (isHttpUrl(v) && !imageUrls.includes(v.trim())) imageUrls.push(v.trim());
  }

  const skuF =
    find(SKU_KEYS) ??
    fuzzyFind(["sku", "kods", "code", "symbol", "artikul"], /categor|manufactur|producer|vendor|country|postal|zip|color|barcode|currenc/);
  const nameF =
    find(NAME_KEYS) ??
    fuzzyFind(["nosaukum", "title", "name"], /manufactur|producer|brand|categor|file|attach|user|shop|supplier/);
  const eanF = find(EAN_KEYS);
  const manufacturerF = find(MANUFACTURER_KEYS);
  const mpnF = find(MPN_KEYS);
  const currencyF = find(CURRENCY_KEYS);
  const descriptionF = find(DESCRIPTION_KEYS);
  const productUrlF = find(PRODUCT_URL_KEYS);
  const datasheetF = find(DATASHEET_KEYS);
  const categoryF = find(CATEGORY_KEYS);

  let priceF = find(PRICE_KEYS);
  if (!priceF || parseFeedNumber(first(priceF)) == null) {
    const fb = find(PRICE_FALLBACK_KEYS);
    if (fb && parseFeedNumber(first(fb)) != null) priceF = fb;
  }
  if (!priceF || parseFeedNumber(first(priceF)) == null) {
    const fz = fuzzyFind(["cena", "price"], /old|rrp|retail|msrp|shipping|delivery|ar_pvn/);
    if (fz && parseFeedNumber(first(fz)) != null) priceF = fz;
  }

  const stockF =
    find(STOCK_KEYS) ??
    fuzzyFind(["daudzum", "noliktav", "quantity", "stock", "qty"], /min|max|limit|warehouse_id|location/);
  const weightF = find(WEIGHT_KEYS);

  // Lossy parses keep their original value visible in attributes.
  const attributes: Record<string, string | string[]> = {};
  const keepRaw = (f: FlatField | null) => {
    if (f) attributes[f.path] = f.values.length === 1 ? f.values[0] : f.values;
  };
  for (const f of fields) {
    if (!consumed.has(f)) attributes[f.path] = f.values.length === 1 ? f.values[0] : f.values;
  }
  keepRaw(stockF);
  keepRaw(weightF);
  keepRaw(priceF);

  const note = (field: string, f: FlatField | null, suffix = "") => {
    if (f) sourceKeys[field] = f.path + suffix;
  };
  note("sku", skuF);
  note("name", nameF);
  note("ean", eanF);
  note("manufacturer", manufacturerF);
  note("mpn", mpnF);
  note("currency", currencyF);
  note("description", descriptionF);
  note("productUrl", productUrlF);
  note("datasheet", datasheetF);
  note("category", categoryF);
  note("price", priceF, priceF && PRICE_FALLBACK_KEYS.includes(priceF.key) ? " (gross/retail fallback)" : "");
  note("stock", stockF);
  if (imageFields.length > 0) sourceKeys.images = imageFields.map((f) => f.path).join(", ");

  let weightG: number | null = null;
  if (weightF) {
    const w = parseFeedWeight(weightF.key, weightF.values[0]);
    weightG = w.grams;
    note("weight", weightF, w.assumed ? " (assumed kg)" : "");
  }

  const categoryPath = categoryF ? categoryF.values.join(" > ") : null;
  const description = first(descriptionF);
  const productUrl = first(productUrlF);
  const datasheetUrl = first(datasheetF);

  // Google-style feeds put the currency inside the price ("419.00 EUR") and
  // have no separate currency field.
  let currency = first(currencyF)?.toUpperCase() ?? null;
  if (!currency && priceF) {
    const iso = /\b(EUR|USD|GBP|PLN|SEK|DKK|NOK|CZK|HUF|RON|BGN|CHF)\b/i.exec(first(priceF)!);
    if (iso) {
      currency = iso[1].toUpperCase();
      sourceKeys.currency = `${priceF.path} (from price value)`;
    }
  }

  const sku = first(skuF);
  const ean = first(eanF)?.replace(/[^0-9Xx]/g, "") || null;
  const mpn = first(mpnF);

  // Some feeds carry NO product-code field at all (the live Getic feed's
  // records are exactly: title, link, price, image, qty, brand, mpn, ean).
  // The EAN is unique and stable per product, which is all a supplier SKU
  // must be — derive it, and say so in sourceKeys. MPN is the second resort
  // (unique only per brand).
  let supplierSku = sku ? sku.trim().toUpperCase() : null;
  if (!supplierSku && ean) {
    supplierSku = ean.toUpperCase();
    sourceKeys.sku = `${eanF!.path} (EAN used as SKU — feed has no code field)`;
  } else if (!supplierSku && mpn) {
    supplierSku = mpn.trim().toUpperCase();
    sourceKeys.sku = `${mpnF!.path} (MPN used as SKU — feed has no code field)`;
  }

  return {
    supplierSku,
    name: first(nameF),
    ean,
    manufacturer: first(manufacturerF),
    mpn: mpn ?? null,
    categoryPath,
    description: description ? description.slice(0, MAX_DESCRIPTION) : null,
    price: priceF ? parseFeedNumber(first(priceF)) : null,
    currency,
    stock: stockF ? parseFeedStock(first(stockF)) : null,
    weightG,
    imageUrl: imageUrls[0] ?? null,
    additionalImages: imageUrls.slice(1),
    datasheetUrl: datasheetUrl && isHttpUrl(datasheetUrl) ? datasheetUrl : null,
    productUrl: productUrl && isHttpUrl(productUrl) ? productUrl : null,
    attributes,
    sourceKeys,
  };
}

/** Non-null counts per normalized field — the "is this feed listable?" view. */
export function coverageOf(offers: NormalizedOffer[]): Record<string, number> {
  const c: Record<string, number> = {
    sku: 0, name: 0, ean: 0, manufacturer: 0, mpn: 0, category: 0, description: 0,
    price: 0, currency: 0, stock: 0, stockPositive: 0, weight: 0, image: 0, productUrl: 0,
  };
  for (const o of offers) {
    if (o.supplierSku) c.sku++;
    if (o.name) c.name++;
    if (o.ean) c.ean++;
    if (o.manufacturer) c.manufacturer++;
    if (o.mpn) c.mpn++;
    if (o.categoryPath) c.category++;
    if (o.description) c.description++;
    if (o.price != null) c.price++;
    if (o.currency) c.currency++;
    if (o.stock != null) c.stock++;
    if ((o.stock ?? 0) > 0) c.stockPositive++;
    if (o.weightG != null) c.weight++;
    if (o.imageUrl) c.image++;
    if (o.productUrl) c.productUrl++;
  }
  return c;
}

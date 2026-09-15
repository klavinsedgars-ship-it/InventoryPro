/**
 * ACC Distribution product JSON → the same NormalizedOffer the XML feeds
 * produce, so ACC lands in supplier_offers alongside Getic and Green Cell and
 * promotes through exactly the same door.
 *
 * Pure: no db, no fetch, no config. Everything here is driven by the shapes in
 * ACC's API specification (GetProducts / GetProduct, v1).
 *
 * Two things about their data model are worth stating up front, because both
 * cost money if assumed away:
 *
 *  - Picture URLs are INCOMPLETE. The API returns a directory; the caller must
 *    append a size. A raw Uri fetched as-is 404s.
 *  - There is NO WEIGHT anywhere in GetProducts. Postage is our largest single
 *    cost line, so a promoted ACC product without a weight cannot be priced
 *    against a real shipping cost. pickWeightGrams below recovers one from the
 *    GetProduct parameter list where the vendor happens to publish it; for the
 *    bulk list it is simply null, and that has to be filled before listing.
 */

import type { NormalizedOffer } from "./getic-feed";

// ---------------------------------------------------------------------------
// Wire shapes (only the fields we read; ACC sends a great many more)
// ---------------------------------------------------------------------------

export interface AccStock {
  WhId?: string | null;
  Amount?: number | string | null;
  ExpectedDate?: string | null;
  AmountArriving?: number | string | null;
}

export interface AccMedia {
  Type?: number | null;
  Uri?: string | null;
  OriginalUri?: string | null;
  Order?: number | null;
}

export interface AccParameter {
  ParameterName?: string | null;
  ParameterGroupName?: string | null;
  Value?: string | number | null;
  MeasureAbbr?: string | null;
}

export interface AccProduct {
  PID?: string | number | null;
  MPN?: string | null;
  EAN?: string | null;
  Name?: string | null;
  Picture?: string | null;
  Producer?: { OId?: string | null; Name?: string | null } | null;
  Price?: {
    Value?: number | string | null;
    OldValue?: number | string | null;
    LatgaValue?: number | string | null;
    CurrencyCode?: string | null;
  } | null;
  Stocks?: AccStock[] | null;
  Branches?: Array<{ OId?: number | null; Name?: string | null }> | null;
  Medias?: AccMedia[] | null;
  Parameters?: AccParameter[] | null;
  ByOrder?: boolean | null;
  IsNew?: boolean | null;
  IsDefect?: boolean | null;
  IsEsd?: boolean | null;
  EOLSale?: boolean | null;
  HasCampaign?: boolean | null;
  HasSaleOut?: boolean | null;
  Warranty?: number | null;
  IntraCode?: string | null;
  CountryOfOrigin?: string | null;
  UpdatedAt?: string | null;
}

/**
 * Image size to request. ACC serves 50/220/440/1920 px PNG plus the original
 * JPEG; 440 is the largest guaranteed size (1920 exists only where the source
 * TIFF was bigger than 440), so it is the only one that is always there.
 */
export const ACC_IMAGE_SIZE = "440x440.png";

/**
 * Complete a picture directory into a fetchable URL.
 *
 * `Picture` and `Medias[].Uri` are directories, not files. Anything that
 * already ends in a file extension is left alone — OriginalUri does come back
 * fully qualified, and double-suffixing it would break a URL that worked.
 */
export function accImageUrl(uri: string | null | undefined, size = ACC_IMAGE_SIZE): string | null {
  const raw = (uri ?? "").trim();
  if (!raw || !/^https?:\/\//i.test(raw)) return null;
  const withoutQuery = raw.split(/[?#]/)[0];
  if (/\.(png|jpe?g|gif|webp|tiff?|bmp)$/i.test(withoutQuery)) return raw;
  return `${raw.replace(/\/+$/, "")}/${size}`;
}

/** Digits-only barcode, 8–14 digits. Anything else is not an EAN. */
export function cleanEan(value: unknown): string | null {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 14 ? digits : null;
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : null;
}

/**
 * Sellable stock across warehouses.
 *
 * `Amount` is what is on the shelf now; `AmountArriving` is not ours to sell
 * and is deliberately excluded — counting it would put items on eBay against
 * stock that does not exist yet. Negative amounts (ACC does return them for
 * oversold lines) floor at zero rather than subtracting from another
 * warehouse's real stock.
 */
export function totalStock(stocks: AccStock[] | null | undefined): number | null {
  if (!Array.isArray(stocks) || stocks.length === 0) return null;
  let total = 0;
  let sawNumber = false;
  for (const s of stocks) {
    const amount = num(s?.Amount);
    if (amount === null) continue;
    sawNumber = true;
    total += Math.max(0, amount);
  }
  return sawNumber ? Math.floor(total) : null;
}

/** Branch names as a path. GetProducts returns them flat — no parent links. */
export function branchPath(
  branches: AccProduct["Branches"],
  resolve?: (oid: number) => string[] | null,
): string | null {
  if (!Array.isArray(branches) || branches.length === 0) return null;
  const first = branches.find((b) => b && (b.Name || b.OId != null));
  if (!first) return null;
  // With the branch tree loaded (GetTreeBranches) we can say
  // "Computers > Storage > Media"; without it, the leaf name is all there is.
  if (resolve && first.OId != null) {
    const path = resolve(Number(first.OId));
    if (path && path.length) return path.join(" > ");
  }
  return (first.Name ?? "").trim() || null;
}

const WEIGHT_PARAM_RE = /\b(weight|gross weight|net weight|svoris)\b/i;

/**
 * Recover a weight in grams from GetProduct's parameter list.
 *
 * Only ever from a parameter whose unit we actually recognise: a bare number
 * with no unit could be kilograms or grams, and guessing wrong is a 1000×
 * error in the one input the shipping cost turns on. Prefers net weight —
 * gross includes packaging that the carrier does bill for, so where only gross
 * exists it is used, but net is the better estimate of the item itself.
 */
export function pickWeightGrams(parameters: AccParameter[] | null | undefined): number | null {
  if (!Array.isArray(parameters)) return null;
  let gross: number | null = null;
  for (const p of parameters) {
    const name = String(p?.ParameterName ?? "");
    if (!WEIGHT_PARAM_RE.test(name)) continue;
    const value = num(p?.Value);
    if (value === null || value <= 0) continue;
    const unit = String(p?.MeasureAbbr ?? "").trim().toLowerCase();
    let grams: number | null = null;
    if (unit === "g" || unit === "gr" || unit === "gram" || unit === "grams") grams = value;
    else if (unit === "kg") grams = value * 1000;
    else continue; // unknown or absent unit — refuse to guess
    if (/\bnet\b/i.test(name)) return Math.round(grams);
    gross = gross ?? Math.round(grams);
  }
  return gross;
}

/** Flags and codes we keep but do not model as columns. */
function attributesOf(p: AccProduct): Record<string, string | string[]> {
  const attrs: Record<string, string | string[]> = {};
  const put = (key: string, value: unknown) => {
    if (value === null || value === undefined || value === "") return;
    attrs[key] = String(value);
  };
  put("byOrder", p.ByOrder);
  put("isNew", p.IsNew);
  put("isDefect", p.IsDefect);
  put("isEsd", p.IsEsd);
  put("eolSale", p.EOLSale);
  put("hasCampaign", p.HasCampaign);
  put("hasSaleOut", p.HasSaleOut);
  put("warrantyMonths", p.Warranty);
  put("intraCode", p.IntraCode);
  put("countryOfOrigin", p.CountryOfOrigin);
  put("updatedAt", p.UpdatedAt);
  put("producerCode", p.Producer?.OId);
  // Kept because it is a real cost component in some markets and must not be
  // silently folded into the unit price we treat as our cost.
  put("latgaValue", p.Price?.LatgaValue);
  put("oldPrice", p.Price?.OldValue);
  const warehouses = (p.Stocks ?? [])
    .filter((s) => s && s.WhId)
    .map((s) => `${s.WhId}:${num(s.Amount) ?? 0}`);
  if (warehouses.length) attrs.warehouses = warehouses;
  return attrs;
}

export interface AccMapOptions {
  /** Resolve a branch id to its full ancestry, from GetTreeBranches. */
  resolveBranch?: (oid: number) => string[] | null;
  imageSize?: string;
}

/**
 * One ACC product → one NormalizedOffer.
 *
 * `sourceKeys` mirrors what the XML mapper records: which upstream field each
 * normalized value came from, so the browse page can show why a column is
 * empty without anyone re-reading the specification.
 */
export function mapAccProduct(p: AccProduct, opts: AccMapOptions = {}): NormalizedOffer {
  const size = opts.imageSize ?? ACC_IMAGE_SIZE;
  const pid = String(p?.PID ?? "").trim();

  const gallery: string[] = [];
  for (const m of (p.Medias ?? []).slice().sort((a, b) => (a?.Order ?? 0) - (b?.Order ?? 0))) {
    const url = accImageUrl(m?.Uri, size);
    if (url && !gallery.includes(url)) gallery.push(url);
  }
  const primary = accImageUrl(p.Picture, size) ?? gallery[0] ?? null;
  const additional = gallery.filter((u) => u !== primary);

  const sourceKeys: Record<string, string> = {};
  const from = (field: string, key: string, value: unknown) => {
    if (value !== null && value !== undefined && value !== "") sourceKeys[field] = key;
  };

  const price = num(p.Price?.Value);
  const stock = totalStock(p.Stocks);
  const ean = cleanEan(p.EAN);
  const manufacturer = (p.Producer?.Name ?? "").trim() || null;
  const category = branchPath(p.Branches, opts.resolveBranch);
  const weightG = pickWeightGrams(p.Parameters);

  from("supplierSku", "PID", pid);
  from("name", "Name", p.Name);
  from("ean", "EAN", ean);
  from("manufacturer", "Producer.Name", manufacturer);
  from("mpn", "MPN", p.MPN);
  from("categoryPath", "Branches", category);
  from("price", "Price.Value", price);
  from("currency", "Price.CurrencyCode", p.Price?.CurrencyCode);
  from("stock", "Stocks[].Amount", stock);
  from("weightG", "Parameters[Weight]", weightG);
  from("imageUrl", p.Picture ? "Picture" : "Medias[].Uri", primary);
  from("additionalImages", "Medias[].Uri", additional.length ? additional : null);

  return {
    supplierSku: pid || null,
    name: (p.Name ?? "").trim() || null,
    ean,
    manufacturer,
    mpn: (p.MPN ?? "").trim() || null,
    categoryPath: category,
    // GetProducts carries no description; GetProduct's is HTML we do not need
    // for staging. eBay listings build their own from the title and specifics.
    description: null,
    price,
    currency: (p.Price?.CurrencyCode ?? "").trim().toUpperCase() || null,
    stock,
    weightG,
    imageUrl: primary,
    additionalImages: additional,
    datasheetUrl: null,
    productUrl: null,
    attributes: attributesOf(p),
    sourceKeys,
  };
}

/**
 * GetProducts responses have been observed under more than one envelope key
 * across ACC's own examples (`Products` in the product methods, `value` in the
 * OData collection methods). Accept either rather than returning zero rows and
 * calling the import a success.
 */
export function productsFromResponse(body: unknown): AccProduct[] {
  if (!body || typeof body !== "object") return [];
  const obj = body as Record<string, unknown>;
  for (const key of ["Products", "value", "Product"]) {
    const v = obj[key];
    if (Array.isArray(v)) return v as AccProduct[];
    if (key === "Product" && v && typeof v === "object") return [v as AccProduct];
  }
  return [];
}

export interface AccBranch {
  Id?: number | null;
  Name?: string | null;
  ParentId?: number | null;
}

/**
 * Turn the flat branch list into an id → ancestry lookup.
 *
 * Guards against a cycle in the parent chain: a malformed tree must not hang
 * an import that is otherwise fine.
 */
export function branchPathResolver(branches: AccBranch[]): (oid: number) => string[] | null {
  const byId = new Map<number, AccBranch>();
  for (const b of branches) {
    if (b && b.Id != null) byId.set(Number(b.Id), b);
  }
  const cache = new Map<number, string[] | null>();
  return (oid: number) => {
    if (cache.has(oid)) return cache.get(oid)!;
    const path: string[] = [];
    const seen = new Set<number>();
    let cursor: number | null = oid;
    while (cursor != null && !seen.has(cursor)) {
      seen.add(cursor);
      const node = byId.get(cursor);
      if (!node) break;
      if (node.Name) path.unshift(String(node.Name).trim());
      cursor = node.ParentId != null ? Number(node.ParentId) : null;
    }
    const result = path.length ? path : null;
    cache.set(oid, result);
    return result;
  };
}

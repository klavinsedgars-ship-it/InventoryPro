/**
 * Which supplier products are worth putting in the catalogue at all.
 *
 * Until now everything a human selected in the TME Browser was imported, and
 * the filtering happened later — at listing time, on price alone. That does
 * not scale to a 500k-product supplier, and price is the wrong axis anyway:
 * postage has run HIGHER than supplier cost on real orders, so weight decides
 * whether a sale makes money far more than price does.
 *
 * Pure, so the rules can be tested and so the same predicate can drive both
 * the dry run ("how many of TME's catalogue would pass?") and the import.
 */

export interface IngestFilter {
  /** Supplier (cost) price bounds, in EUR. Null/undefined = unbounded. */
  minPrice?: number | null;
  maxPrice?: number | null;
  /** The one that protects margin. Null = no weight limit. */
  maxWeightGrams?: number | null;
  /** Skip anything the supplier cannot ship today. */
  inStockOnly?: boolean;
  /** eBay refuses a listing with no image, so importing one is wasted space. */
  requireImage?: boolean;
  /** Amazon matching needs a barcode; eBay ranks better with one. */
  requireEan?: boolean;
}

export interface IngestCandidate {
  supplierPrice: number | null;
  weightGrams: number | null;
  stock: number | null;
  imageUrl: string | null;
  ean: string | null;
}

export type IngestVerdict = { ok: true } | { ok: false; reason: IngestRejection };

export type IngestRejection =
  | "noPrice"
  | "priceBelowMin"
  | "priceAboveMax"
  | "weightUnknown"
  | "tooHeavy"
  | "outOfStock"
  | "noImage"
  | "noEan";

const hasText = (v: string | null | undefined) => typeof v === "string" && v.trim() !== "";

/**
 * Judge one candidate.
 *
 * The notable rule is weightUnknown: when a weight cap is set and the supplier
 * published no weight, the product is REJECTED rather than assumed light. The
 * pricing model treats a missing weight as zero grams — the cheapest postal
 * band there is — so "unknown" silently becomes "free to ship", and the
 * products that behaviour flatters are exactly the heavy ones that lose money.
 * No cap set means weight is not being used to decide, and unknown is fine.
 */
export function passesIngestFilter(c: IngestCandidate, f: IngestFilter): IngestVerdict {
  const price = typeof c.supplierPrice === "number" && Number.isFinite(c.supplierPrice) ? c.supplierPrice : null;
  if (price === null || price <= 0) return { ok: false, reason: "noPrice" };
  if (f.minPrice != null && price < f.minPrice) return { ok: false, reason: "priceBelowMin" };
  if (f.maxPrice != null && price > f.maxPrice) return { ok: false, reason: "priceAboveMax" };

  if (f.maxWeightGrams != null) {
    const w = typeof c.weightGrams === "number" && Number.isFinite(c.weightGrams) ? c.weightGrams : null;
    if (w === null || w <= 0) return { ok: false, reason: "weightUnknown" };
    if (w > f.maxWeightGrams) return { ok: false, reason: "tooHeavy" };
  }

  if (f.inStockOnly && !(typeof c.stock === "number" && c.stock > 0)) {
    return { ok: false, reason: "outOfStock" };
  }
  if (f.requireImage && !hasText(c.imageUrl)) return { ok: false, reason: "noImage" };
  if (f.requireEan && !hasText(c.ean)) return { ok: false, reason: "noEan" };

  return { ok: true };
}

/** Every rejection reason, so counters can be initialised without guessing. */
export const INGEST_REJECTIONS: IngestRejection[] = [
  "noPrice",
  "priceBelowMin",
  "priceAboveMax",
  "weightUnknown",
  "tooHeavy",
  "outOfStock",
  "noImage",
  "noEan",
];

export function emptyRejectionCounts(): Record<IngestRejection, number> {
  return Object.fromEntries(INGEST_REJECTIONS.map((r) => [r, 0])) as Record<IngestRejection, number>;
}

/** Is this filter actually restricting anything? */
export function filterIsActive(f: IngestFilter): boolean {
  return (
    f.minPrice != null ||
    f.maxPrice != null ||
    f.maxWeightGrams != null ||
    !!f.inStockOnly ||
    !!f.requireImage ||
    !!f.requireEan
  );
}

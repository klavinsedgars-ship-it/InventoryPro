/**
 * What to ask eBay's Taxonomy service when resolving a product's category.
 *
 * This is a caching decision more than a search one. The query string is the
 * cache key (see getSuggestedCategory), so a query containing the product NAME
 * is unique per product — which meant one Taxonomy call for every product
 * listed, and effectively a 0% cache hit rate. Under the ramp's concurrency
 * that overran eBay's Taxonomy rate limit, every lookup started failing, and
 * because a failed lookup was indistinguishable from "no such category" the
 * ramp recorded thousands of products as permanently uncategorisable.
 *
 * Keying on the supplier CATEGORY instead collapses thousands of calls into
 * dozens: parts in one TME category belong in the same eBay category, which is
 * also more consistent than letting one product's wording pull it elsewhere.
 * The product name is only used when a product has no category at all.
 *
 * Pure: no network, no storage.
 */
import type { Product } from "@shared/schema";

/** eBay's Taxonomy endpoint rejects overly long queries. */
const MAX_QUERY_LEN = 80;

export function categoryQueryFor(product: Pick<Product, "category" | "name">): string {
  const category = (product.category ?? "").trim();
  // A generic placeholder carries no signal and would map every product in the
  // catalogue to one arbitrary eBay category — worse than asking by name.
  const useful = category && !/^(electronics|other|misc|uncategori[sz]ed|general)$/i.test(category);
  if (useful) return category.slice(0, MAX_QUERY_LEN);
  return `${category} ${product.name ?? ""}`.trim().slice(0, MAX_QUERY_LEN);
}

/**
 * Is this HTTP status a temporary Taxonomy failure rather than a verdict about
 * the product? Rate limiting and eBay-side errors must never be recorded as
 * "this product has no category" — that burns a listing attempt for something
 * the product had no part in.
 */
export function isTransientTaxonomyStatus(status: number): boolean {
  return status === 429 || status === 408 || status >= 500;
}

/**
 * Choose a last-resort category from categories eBay has already given us.
 *
 * Hardcoding an id is not safe: eBay category ids are per-marketplace, so a
 * value copied from the US tree can be meaningless (or worse, wrong but valid)
 * on eBay.de. Every cached suggestion, by contrast, is eBay's own answer for
 * THIS marketplace tree, and the popular ones have already produced live
 * listings on this account — so the fallback is correct by construction and
 * needs no operator to look one up.
 *
 * Frequency alone is the WRONG rule, which the live data showed: the most
 * common suggestion was "Druckschalter" (pushbutton switches) at 16% — a
 * specific product category. Filing an unknown product there is a
 * miscategorisation, and the whole point of a fallback is to be somewhere
 * broad enough to be defensible for a product we could not classify.
 *
 * So candidates are ranked by GENERALITY first: a category eBay itself names
 * as a catch-all ("Sonstige…", "Other…"), preferring one that also names the
 * broad domain this catalogue lives in (electronics / measurement / components)
 * over a narrower one (automation, sensors). Frequency only breaks ties.
 *
 * Returns null when no catch-all exists; no fallback is better than confidently
 * filing products under pushbutton switches.
 */

/** eBay's own wording for a catch-all node, across the marketplaces we list on. */
const CATCH_ALL_RX = /\b(sonstige[sr]?|other|misc\.?|miscellaneous|autres?|altro|altri|otros?)\b/i;
/** The broad domain this catalogue belongs to. */
const BROAD_DOMAIN_RX = /elektronik|elektronisch|electronic|messtechnik|bauteil|bauelement|component/i;
/** On-topic but narrower — acceptable, not preferred. */
const NARROW_DOMAIN_RX = /automation|sensor|messteil|prozessor|platine|equipment|zubehör|zubehor/i;

export function scoreCategoryGenerality(name: string): number {
  const n = name ?? "";
  if (!CATCH_ALL_RX.test(n)) return 0; // not a catch-all: never a fallback
  let score = 3;
  if (BROAD_DOMAIN_RX.test(n)) score += 3;
  else if (NARROW_DOMAIN_RX.test(n)) score += 1;
  return score;
}

export function pickDefaultCategory(
  suggestions: Array<{ id?: string; name?: string } | null | undefined>,
  opts: { minSample?: number; minCount?: number } = {},
): {
  id: string;
  name: string;
  count: number;
  sample: number;
  share: number;
  generality: number;
} | null {
  const minSample = opts.minSample ?? 5;
  // A catch-all seen once could be a stray classification; require a little
  // corroboration before it becomes the destination for unknown products.
  const minCount = opts.minCount ?? 3;
  const counts = new Map<string, { name: string; count: number }>();
  let sample = 0;
  for (const s of suggestions) {
    const id = s?.id ? String(s.id) : "";
    if (!id) continue;
    sample++;
    const e = counts.get(id);
    if (e) {
      e.count++;
      if (!e.name && s?.name) e.name = s.name;
    } else {
      counts.set(id, { name: s?.name ?? "", count: 1 });
    }
  }
  if (sample < minSample) return null;

  let best: { id: string; name: string; count: number; generality: number } | null = null;
  for (const [id, e] of Array.from(counts.entries())) {
    const generality = scoreCategoryGenerality(e.name);
    if (generality === 0) continue;
    if (e.count < minCount) continue;
    const better =
      !best ||
      generality > best.generality ||
      (generality === best.generality && e.count > best.count) ||
      // Deterministic tie-break so the default doesn't flap between runs.
      (generality === best.generality && e.count === best.count && id < best.id);
    if (better) best = { id, name: e.name, count: e.count, generality };
  }
  if (!best) return null;
  return { ...best, sample, share: best.count / sample };
}

/**
 * The ceiling on eBay's active-listing count, and what it means for us.
 *
 * `GetMyeBaySelling`'s ActiveList does not report an unbounded total. On an
 * account holding 169,244 live listings it answered with exactly 25,000
 * across exactly 1,000 pages — while the same account's selling privilege
 * allowed 190,756 items and twenty randomly sampled SKUs all came back
 * PUBLISHED with matching listing ids. The count is a ceiling, not a total.
 *
 * That distinction is not academic. The reconciler clears `listed_on_ebay`
 * for every product it does not find in the active list, and it decided the
 * list was complete from eBay's own page count — so a capped answer would
 * have unlisted 144,244 products that are live on eBay right now, inviting
 * duplicate listings for every one of them and stopping stock updates to all
 * of them.
 */

/** Entries GetMyeBaySelling's ActiveList will report before it stops counting. */
export const ACTIVE_LIST_CEILING = 25_000;

/** Did eBay stop counting, rather than run out of listings? */
export function activeListLooksTruncated(totalEntries: number): boolean {
  return Number.isFinite(totalEntries) && totalEntries >= ACTIVE_LIST_CEILING;
}

export interface ClearDecision {
  allowed: boolean;
  reason: string;
}

/**
 * May a reconcile run clear the listed flag on products it did not see?
 *
 * Three conditions, and the third is the one that was missing: the walk has
 * to be genuinely complete, not merely complete as far as a capped API said.
 */
export function canClearMissingFlags(opts: {
  apply: boolean;
  fetchedAllPages: boolean;
  activeOnEbay: number;
}): ClearDecision {
  if (!opts.apply) {
    return { allowed: false, reason: "dry run — nothing is written without ?apply=1" };
  }
  if (!opts.fetchedAllPages) {
    return { allowed: false, reason: "partial walk — unread pages would look like missing listings" };
  }
  if (activeListLooksTruncated(opts.activeOnEbay)) {
    return {
      allowed: false,
      reason:
        `eBay reported ${opts.activeOnEbay.toLocaleString()} active listings, which is its counting ceiling ` +
        `(${ACTIVE_LIST_CEILING.toLocaleString()}) rather than a total. Everything past it would be read as ` +
        `missing from eBay, so no flags are cleared. Verify individual SKUs with ` +
        `/api/ebay/listing-count?sample=20 instead.`,
    };
  }
  return { allowed: true, reason: "complete walk of an uncapped active list" };
}

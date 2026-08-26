/**
 * Pure helpers for the eBay listing ramp. Kept free of storage/eBay imports so
 * they can be tested without a database or network.
 */

export interface RampItemResult {
  sku: string;
  ok: boolean;
  error?: string;
}

/**
 * Normalise one per-SKU error into a groupable reason. eBay embeds ids and
 * parameter values in its messages, so two instances of the same failure never
 * match verbatim; collapsing runs of 3+ digits makes them group.
 */
export function normalizeErrorReason(error: string): string {
  return String(error).replace(/[0-9]{3,}/g, "N").slice(0, 140);
}

/**
 * The failure reasons for ONE ramp run, most frequent first.
 *
 * This exists because the previous implementation asked the products table
 * "what are the most common ebay_listing_error values?" with no time bound and
 * no link to the run. A run whose every batch failed on a merchant-location
 * problem would still report a months-old error from a manual listing session
 * as its "top error", because that error was simply attached to more rows.
 */
export function summarizeRunErrors(
  results: RampItemResult[],
  limit = 3,
): Array<{ reason: string; count: number }> {
  const counts = new Map<string, number>();
  for (const r of results) {
    if (r.ok || !r.error) continue;
    const reason = normalizeErrorReason(r.error);
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

/**
 * Does this run still have room to attempt another batch?
 *
 * Forward progress is the invariant that matters: the candidate query is
 * ordered by id, and two failure paths (merchant location, TME shippability)
 * deliberately leave ebay_list_attempts untouched, so a batch that fails
 * through either is handed back identically on the next query. The caller must
 * therefore exclude everything it has already attempted this run — otherwise
 * one stuck batch consumes the entire time budget retrying the same 25 SKUs.
 */
export function shouldContinueRamp(state: {
  elapsedMs: number;
  budgetMs: number;
  batches: number;
  maxBatches: number;
  limitHit: boolean;
  budgetStop: boolean;
  blocked: boolean;
}): boolean {
  if (state.limitHit || state.budgetStop || state.blocked) return false;
  if (state.elapsedMs >= state.budgetMs) return false;
  if (state.maxBatches > 0 && state.batches >= state.maxBatches) return false;
  return true;
}

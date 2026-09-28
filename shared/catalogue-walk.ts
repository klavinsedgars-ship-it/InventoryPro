/**
 * The walk rules for the TME catalogue sweep, kept pure so the decisions can
 * be tested without a database, a network or five minutes of cron.
 *
 * The rule that matters most is the last one. A sweep that treats "TME will
 * not answer" the same as "this category is odd" skips a category per failure,
 * burns through the whole list in a tick or two, reaches the end, declares
 * itself finished and switches itself off — having imported nothing, and
 * taking its own progress banner off the screen with it.
 */

export interface SweepCursor {
  categoryIndex: number;
  page: number;
}

/** Five in a row is not five bad categories. */
export const MAX_CONSECUTIVE_FAILURES = 5;

/** The next page of this category, or the start of the next one. */
export function nextCursor(cursor: SweepCursor, pagesInCategory: number): SweepCursor {
  const pages = Math.max(1, Math.floor(pagesInCategory) || 1);
  return cursor.page >= pages
    ? { categoryIndex: cursor.categoryIndex + 1, page: 1 }
    : { categoryIndex: cursor.categoryIndex, page: cursor.page + 1 };
}

/**
 * A refusal aimed at us, rather than a problem with one category.
 *
 * TME's own words on limits: "the limit is per token, but if we see high
 * traffic we can cut the traffic." When that happens every category fails,
 * and walking the list to find that out costs thousands of further requests
 * at exactly the moment we should be sending none.
 */
export function isSupplierRefusal(message: string): boolean {
  return /\b(401|403|429)\b/.test(message) || /too many requests|rate limit|forbidden|unauthor/i.test(message);
}

/** Skip the category, or stop the slice and keep the cursor? */
export function shouldPauseSweep(
  consecutiveFailures: number,
  max = MAX_CONSECUTIVE_FAILURES,
): boolean {
  return consecutiveFailures >= max;
}

/**
 * A sweep is finished only when it walked to the end of the list. Giving up
 * because the supplier stopped answering is not finishing.
 */
export function sweepFinished(opts: {
  blocked: boolean;
  categoryIndex: number;
  categoriesTotal: number;
}): boolean {
  if (opts.blocked) return false;
  if (opts.categoriesTotal <= 0) return false;
  return opts.categoryIndex >= opts.categoriesTotal;
}

/**
 * How many units of one product we let a marketplace show.
 *
 * eBay's selling limits are denominated in ITEMS, not listings: the quantity
 * on every live listing counts against the same monthly allowance. Showing two
 * of everything therefore costs twice the allowance per listing and halves how
 * much of the catalogue can be online at once.
 *
 * Lowered from 2 to 1 on 2026-09-16 to roughly double listing coverage under
 * the same eBay limit. The trade-off is real and worth remembering: a buyer
 * can no longer put two of the SAME part in one basket, and multi-unit orders
 * are where the margin is (1 unit averaged €4.51 net, 4 units €29.84). It is
 * a bet that breadth of catalogue beats depth per listing — reversible by
 * setting the sweep target back to 2 and re-running it.
 *
 * Lives in shared/ because three places must agree on the number: the column
 * default in schema.ts, the runtime fallback in server/stock-manager.ts, and
 * the default target of the quantity sweep.
 */
export const DEFAULT_EBAY_STOCK_LIMIT = 1;

/** Bounds for an operator-supplied limit. eBay rejects a negative quantity. */
export const MIN_EBAY_STOCK_LIMIT = 1;
export const MAX_EBAY_STOCK_LIMIT = 999;

/**
 * Coerce an operator-supplied cap into something eBay will accept.
 *
 * A cap of 0 would silently unlist the whole catalogue, so it floors at 1
 * rather than being taken at face value.
 */
export function clampTarget(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_EBAY_STOCK_LIMIT;
  return Math.max(MIN_EBAY_STOCK_LIMIT, Math.min(MAX_EBAY_STOCK_LIMIT, Math.floor(value)));
}

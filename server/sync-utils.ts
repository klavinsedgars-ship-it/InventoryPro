/**
 * Pure helpers used by the TME sync chunk. Kept storage/DB-free so they can be
 * unit-tested without a database connection.
 */

// Sum stock across TME warehouses (StockList), falling back to the flat Amount
// field, then to the value we already hold in the DB.
//
// NOTE (oversell): TME's Amount can include not-yet-arrived "expected"
// deliveries — see the 2026-06-16 incident. Correcting that requires the TME
// stock-field breakdown and is handled elsewhere; this helper only sums what
// it's given.
export function extractStock(
  ps: { StockList?: Array<{ Amount: number }>; Amount?: number },
  fallback: number,
): number {
  if (ps.StockList && ps.StockList.length > 0) {
    return ps.StockList.reduce((sum, w) => sum + (w.Amount || 0), 0);
  }
  if (typeof ps.Amount === "number") return ps.Amount;
  return fallback;
}

// A product is "stale" if it hasn't been synced within this many hours.
// Tiered: listed eBay products refresh ~3× faster than unlisted, because the
// oversell risk (TME going to 0 between cron ticks) only matters for listed
// SKUs. Defaults: listed 4h (≈ 6×/day) ; unlisted 48h (≈ 0.5×/day).
//   Tune via SYNC_STALE_HOURS_LISTED / SYNC_STALE_HOURS_UNLISTED.
//   SYNC_STALE_HOURS (legacy) is the fallback when only one var is set.
export function staleCutoffs(now = Date.now()): { listed: Date; unlisted: Date } {
  const legacy = Number(process.env.SYNC_STALE_HOURS) || 12;
  const listedHours = Number(process.env.SYNC_STALE_HOURS_LISTED) || Math.min(4, legacy);
  const unlistedHours = Number(process.env.SYNC_STALE_HOURS_UNLISTED) || Math.max(48, legacy);
  return {
    listed: new Date(now - listedHours * 3600 * 1000),
    unlisted: new Date(now - unlistedHours * 3600 * 1000),
  };
}

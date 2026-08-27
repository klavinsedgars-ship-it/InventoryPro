/**
 * Pure helpers used by the TME sync chunk. Kept storage/DB-free so they can be
 * unit-tested without a database connection.
 */

/**
 * Sellable stock for a TME product.
 *
 * TME support (2026-08) confirmed that `Amount` "shows the real warehouse
 * stock" and is real-time. So Amount is now the PRIMARY source. Previously we
 * summed `StockList` across warehouses first, which can exceed what is
 * actually sellable (external/regional warehouses are not equivalent to
 * on-hand stock) — the most plausible mechanism behind the 2026-06-16
 * oversell, where a SKU reported far more than could ship.
 *
 * StockList is kept only as a fallback for responses that omit Amount, and
 * even then we take the MAXIMUM single warehouse rather than the sum: one
 * warehouse's quantity is a figure we can actually ship from, whereas the sum
 * assumes fulfilment can pool every location.
 *
 * Note also (TME support): stock is reserved only when payment is finalised,
 * so a small race remains on the last unit — which is what the per-product
 * eBay quantity cap exists to absorb.
 */
export function extractStock(
  ps: { StockList?: Array<{ Amount: number }>; Amount?: number },
  fallback: number,
): number {
  if (typeof ps.Amount === "number") return ps.Amount;
  if (ps.StockList && ps.StockList.length > 0) {
    return ps.StockList.reduce((max, w) => Math.max(max, w.Amount || 0), 0);
  }
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

/**
 * Split one fetched batch into the slices that will be synced concurrently.
 *
 * The batch is fetched ONCE per round and divided here, rather than each
 * concurrent worker querying for its own slice. That ordering is the whole
 * correctness argument: getStaleTmeProducts returns the stalest rows, and
 * lastSyncedAt is not written until a slice finishes, so parallel queries
 * would each receive the SAME products and sync them several times over.
 */
export function sliceEvenly<T>(batch: readonly T[], chunkSize: number): T[][] {
  const size = Math.max(1, Math.floor(chunkSize));
  const out: T[][] = [];
  for (let i = 0; i < batch.length; i += size) out.push(batch.slice(i, i + size));
  return out;
}

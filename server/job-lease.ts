/**
 * Run-once-at-a-time leases for background jobs.
 *
 * The listing ramp, the daily sync and the import drain can each be started by
 * more than one trigger: a Vercel cron, an operator pressing a button, and (for
 * imports) a browser pump. Nothing stopped two of them running at once over the
 * same rows — the ramp's already-attempted set is per-run memory, so a second
 * run simply redid the first run's work.
 *
 * A lease is a row that expires. That matters more than a flag: a serverless
 * invocation can be killed without ever running its cleanup, and a flag left
 * "true" by a crashed run would block the job forever. An expiring lease
 * unblocks itself, and a live run keeps its lease alive by renewing it.
 *
 * The store is an interface so this logic is testable without a database; the
 * Postgres implementation lives in storage.ts.
 */

export interface LeaseHandle {
  name: string;
  owner: string;
  expiresAt: Date;
}

export interface LeaseStore {
  /**
   * Claim `name` for `owner` for `ttlSeconds`. MUST be atomic — a single
   * conditional statement — or two callers racing will both believe they won.
   * Resolves null when someone else holds an unexpired lease.
   */
  tryAcquire(name: string, owner: string, ttlSeconds: number): Promise<LeaseHandle | null>;
  /** Push the expiry out. False when the lease was lost (expired and taken). */
  renew(name: string, owner: string, ttlSeconds: number): Promise<boolean>;
  /** Release, but only if still ours — never steal a successor's lease. */
  release(name: string, owner: string): Promise<void>;
  /** Who holds it and until when, for reporting a refusal. */
  peek(name: string): Promise<{ owner: string; acquiredAt: Date | null; expiresAt: Date } | null>;
}

export type LeaseResult<T> =
  | { ran: true; result: T }
  | { ran: false; heldBy?: string; heldForMs?: number };

export interface LeaseOptions {
  ttlSeconds?: number;
  heartbeatMs?: number;
  /** Identifies this run in the lease row; defaults to a random id. */
  owner?: string;
}

let ownerCounter = 0;
/** Unique per invocation — the pid alone would collide across warm reuses. */
export function newOwnerId(prefix = "run"): string {
  ownerCounter += 1;
  return `${prefix}-${process.pid}-${Date.now().toString(36)}-${ownerCounter}`;
}

/**
 * Run `fn` only if this process can claim the lease.
 *
 * Renews in the background while `fn` runs, and always releases — including
 * when `fn` throws, so a failing job never blocks the next scheduled run.
 */
export async function withLease<T>(
  store: LeaseStore,
  name: string,
  opts: LeaseOptions,
  fn: () => Promise<T>,
): Promise<LeaseResult<T>> {
  const ttlSeconds = Math.max(5, opts.ttlSeconds ?? 60);
  // Renew at a third of the TTL: frequent enough that one failed renewal
  // doesn't lose the lease, rare enough not to matter.
  const heartbeatMs = Math.max(1000, opts.heartbeatMs ?? Math.floor((ttlSeconds * 1000) / 3));
  const owner = opts.owner ?? newOwnerId(name);

  const handle = await store.tryAcquire(name, owner, ttlSeconds);
  if (!handle) {
    const holder = await store.peek(name).catch(() => null);
    return {
      ran: false,
      heldBy: holder?.owner,
      heldForMs: holder?.acquiredAt ? Date.now() - holder.acquiredAt.getTime() : undefined,
    };
  }

  const timer = setInterval(() => {
    // A failed renewal is not fatal on its own: the next tick may succeed, and
    // the work is still valid. Never let it reject an unhandled promise.
    store.renew(name, owner, ttlSeconds).catch(() => {});
  }, heartbeatMs);
  // Node keeps the process alive for pending timers; this one must never be
  // the reason a serverless invocation lingers.
  (timer as any).unref?.();

  try {
    return { ran: true, result: await fn() };
  } finally {
    clearInterval(timer);
    await store.release(name, owner).catch(() => {});
  }
}

/** Human-readable refusal, e.g. for an API response or a toast. */
export function describeRefusal(name: string, r: { heldForMs?: number }): string {
  const age = r.heldForMs != null ? ` (started ${Math.round(r.heldForMs / 1000)}s ago)` : "";
  return `a ${name} run is already in progress${age}`;
}

/**
 * A rate limiter that holds under concurrency.
 *
 * The obvious implementation — remember the last call's timestamp, and sleep
 * if the next one comes too soon — silently fails the moment two callers
 * overlap: they read the same timestamp, compute the same delay, sleep in
 * parallel and then fire together. Serial code hides this completely, which is
 * why it survived until the sync and the listing ramp started running several
 * slices at once.
 *
 * Here each caller instead RESERVES the next free slot, and the reservation
 * itself is serialised. Concurrent callers therefore receive distinct,
 * correctly spaced slots and wait until theirs arrives.
 *
 * Clock and sleep are injectable so the spacing can be tested directly.
 */
export class RateLimiter {
  /** Earliest time the next call may start, per rate class. */
  private nextAt = new Map<string, number>();
  /** Serialises slot reservation (not the calls themselves). */
  private gate: Promise<void> = Promise.resolve();

  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((r) => setTimeout(r, ms)),
  ) {}

  /**
   * Wait until this caller's slot in `key`'s schedule. Callers are served in
   * arrival order, each at least `minIntervalMs` after the previous one.
   */
  async acquire(key: string, minIntervalMs: number): Promise<void> {
    const interval = Math.max(0, minIntervalMs);
    const prev = this.gate;
    let release!: () => void;
    this.gate = new Promise<void>((r) => (release = r));

    let waitMs = 0;
    try {
      await prev;
      const now = this.now();
      const earliest = Math.max(now, this.nextAt.get(key) ?? 0);
      waitMs = earliest - now;
      // Claim the slot BEFORE sleeping, so the next caller queues behind it
      // rather than racing for the same moment.
      this.nextAt.set(key, earliest + interval);
    } finally {
      release();
    }

    if (waitMs > 0) await this.sleep(waitMs);
  }

  /** Testing/diagnostics: when the next call on `key` would be allowed. */
  nextAllowedAt(key: string): number {
    return this.nextAt.get(key) ?? 0;
  }
}

/** Requests per second -> minimum spacing, with a little headroom. */
export function intervalForRps(rps: number, headroomPct = 10): number {
  const safe = Math.max(0.001, rps);
  // Multiply before dividing: (1000/10) * 1.1 is 110.00000000000001 in binary
  // floating point, which ceil() turns into an extra millisecond per call.
  return Math.ceil(((1000 / safe) * (100 + headroomPct)) / 100);
}

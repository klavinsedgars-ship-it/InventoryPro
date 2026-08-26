import { describe, it, expect, vi } from "vitest";
import { withLease, describeRefusal, newOwnerId, type LeaseStore, type LeaseHandle } from "./job-lease";

/**
 * In-memory stand-in with the one property that matters: tryAcquire is atomic,
 * so a held-and-unexpired lease is never handed out twice.
 */
function fakeStore(now = () => Date.now()): LeaseStore & { rows: Map<string, { owner: string; acquiredAt: number; expiresAt: number }> } {
  const rows = new Map<string, { owner: string; acquiredAt: number; expiresAt: number }>();
  return {
    rows,
    async tryAcquire(name, owner, ttlSeconds): Promise<LeaseHandle | null> {
      const existing = rows.get(name);
      if (existing && existing.expiresAt > now()) return null;
      const expiresAt = now() + ttlSeconds * 1000;
      rows.set(name, { owner, acquiredAt: now(), expiresAt });
      return { name, owner, expiresAt: new Date(expiresAt) };
    },
    async renew(name, owner, ttlSeconds) {
      const existing = rows.get(name);
      if (!existing || existing.owner !== owner) return false;
      existing.expiresAt = now() + ttlSeconds * 1000;
      return true;
    },
    async release(name, owner) {
      if (rows.get(name)?.owner === owner) rows.delete(name);
    },
    async peek(name) {
      const e = rows.get(name);
      return e ? { owner: e.owner, acquiredAt: new Date(e.acquiredAt), expiresAt: new Date(e.expiresAt) } : null;
    },
  };
}

describe("withLease", () => {
  it("runs the job and returns its result", async () => {
    const store = fakeStore();
    const r = await withLease(store, "list_ramp", {}, async () => 42);
    expect(r).toEqual({ ran: true, result: 42 });
  });

  it("refuses a second run while the first holds the lease", async () => {
    const store = fakeStore();
    let release!: () => void;
    const gate = new Promise<void>((res) => { release = res; });

    const first = withLease(store, "list_ramp", {}, async () => { await gate; return "first"; });
    // Second caller arrives while the first is still inside its job.
    const second = await withLease(store, "list_ramp", {}, async () => "second");

    expect(second.ran).toBe(false);
    release();
    expect(await first).toEqual({ ran: true, result: "first" });
  });

  it("reports who holds the lease and for how long", async () => {
    const store = fakeStore();
    let release!: () => void;
    const gate = new Promise<void>((res) => { release = res; });
    const first = withLease(store, "daily_sync", { owner: "owner-A" }, async () => { await gate; return 1; });

    const second = await withLease(store, "daily_sync", {}, async () => 2);
    expect(second.ran).toBe(false);
    if (!second.ran) {
      expect(second.heldBy).toBe("owner-A");
      expect(second.heldForMs).toBeGreaterThanOrEqual(0);
    }
    release();
    await first;
  });

  it("releases the lease when the job THROWS, so the next run isn't blocked", async () => {
    // The reason a lease beats a boolean flag: failure must not wedge the job.
    const store = fakeStore();
    await expect(
      withLease(store, "list_ramp", {}, async () => { throw new Error("eBay exploded"); }),
    ).rejects.toThrow("eBay exploded");

    expect(store.rows.has("list_ramp")).toBe(false);
    const after = await withLease(store, "list_ramp", {}, async () => "recovered");
    expect(after).toEqual({ ran: true, result: "recovered" });
  });

  it("lets a later run take over an EXPIRED lease from a killed process", async () => {
    // A serverless invocation can die without running cleanup. The lease must
    // expire on its own or the job is blocked forever.
    let clock = 1_000_000;
    const store = fakeStore(() => clock);
    await store.tryAcquire("list_ramp", "dead-process", 60);

    // Still held: refused.
    const blocked = await withLease(store, "list_ramp", {}, async () => "nope");
    expect(blocked.ran).toBe(false);

    clock += 61_000; // lease lapses
    const taken = await withLease(store, "list_ramp", {}, async () => "took over");
    expect(taken).toEqual({ ran: true, result: "took over" });
  });

  it("renews while the job runs so a long run doesn't lose its lease", async () => {
    vi.useFakeTimers();
    try {
      const store = fakeStore();
      const renew = vi.spyOn(store, "renew");
      let release!: () => void;
      const gate = new Promise<void>((res) => { release = res; });

      const running = withLease(store, "list_ramp", { ttlSeconds: 60, heartbeatMs: 20_000 }, async () => {
        await gate;
        return "done";
      });
      await vi.advanceTimersByTimeAsync(65_000);
      expect(renew.mock.calls.length).toBeGreaterThanOrEqual(3);

      release();
      await vi.advanceTimersByTimeAsync(0);
      expect(await running).toEqual({ ran: true, result: "done" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops renewing once the job finishes", async () => {
    vi.useFakeTimers();
    try {
      const store = fakeStore();
      await withLease(store, "list_ramp", { ttlSeconds: 60, heartbeatMs: 20_000 }, async () => "quick");
      const renew = vi.spyOn(store, "renew");
      await vi.advanceTimersByTimeAsync(120_000);
      expect(renew).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not release a lease that a successor now owns", async () => {
    let clock = 1_000_000;
    const store = fakeStore(() => clock);
    const slow = withLease(store, "list_ramp", { ttlSeconds: 10, owner: "slow" }, async () => {
      clock += 11_000;                                    // our lease lapses
      await store.tryAcquire("list_ramp", "successor", 60); // someone else takes it
      return "finished late";
    });
    await slow;
    // The straggler's cleanup must not have deleted the successor's lease.
    expect(store.rows.get("list_ramp")?.owner).toBe("successor");
  });
});

describe("newOwnerId", () => {
  it("is unique across calls within one process", () => {
    const ids = new Set(Array.from({ length: 50 }, () => newOwnerId("list_ramp")));
    expect(ids.size).toBe(50);
  });
});

describe("describeRefusal", () => {
  it("says what is running and since when", () => {
    expect(describeRefusal("list_ramp", { heldForMs: 42_000 })).toBe(
      "a list_ramp run is already in progress (started 42s ago)",
    );
    expect(describeRefusal("daily_sync", {})).toBe("a daily_sync run is already in progress");
  });
});

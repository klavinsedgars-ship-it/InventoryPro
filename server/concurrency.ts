/**
 * Bounded-concurrency map. Pure: no imports, no I/O of its own.
 *
 * Exists because the alternatives are both wrong for this codebase's hot
 * paths: a serial `for (… of …) await` wastes wall-clock on independent
 * network calls, while a bare `Promise.all` over 25 items launches 25
 * simultaneous image downloads and eBay calls from a serverless function with
 * one weak CPU.
 */
export async function mapPool<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const n = items.length;
  if (n === 0) return [];
  const width = Math.max(1, Math.min(limit, n));
  const out = new Array<R>(n);
  let cursor = 0;

  const worker = async (): Promise<void> => {
    while (true) {
      const i = cursor++;
      if (i >= n) return;
      // Results are written by index, so completion order never reorders the
      // output — callers rely on positional alignment with `items`.
      out[i] = await fn(items[i], i);
    }
  };

  await Promise.all(Array.from({ length: width }, () => worker()));
  return out;
}

/**
 * Outbound HTTP proxy support.
 *
 * Some distributors (ACC Distribution, and this will not be the last) only
 * accept API calls from an IP address they have whitelisted. Vercel functions
 * egress from a rotating pool, so there is no address to give them — the fix
 * is a small VPS with a static IP running a forward proxy, and routing just
 * those suppliers through it.
 *
 * Two hard-won rules are baked in here:
 *
 * 1. NOTHING IS IMPORTED AT MODULE SCOPE. The first version of this file did
 *    `import { ProxyAgent } from "undici"` at the top, esbuild leaves the
 *    package external, and the installed undici turned out to require a newer
 *    Node than the project pins. The import threw while the bundle was
 *    loading, which takes down EVERY route — the login page and every
 *    diagnostic with it. Loading it lazily inside a try/catch means the worst
 *    case is "this one supplier cannot fetch", not an outage.
 *
 * 2. PROXIED CALLS USE UNDICI'S OWN FETCH. Node's global fetch does not honour
 *    HTTP_PROXY/HTTPS_PROXY (setting them looks like it works and changes
 *    nothing), and its `dispatcher` option expects Node's *internal* undici
 *    class — handing it one from the userland package is not guaranteed to be
 *    accepted. Calling undici's fetch with undici's dispatcher keeps both
 *    halves from the same copy of the library.
 */

/** Where the proxy lives, e.g. http://user:pass@203.0.113.10:8888 */
export function proxyUrl(): string | null {
  const raw = (process.env.FEED_PROXY_URL || "").trim();
  return raw || null;
}

export function isProxyConfigured(): boolean {
  return proxyUrl() !== null;
}

interface ProxyRuntime {
  fetch: (url: string, init?: unknown) => Promise<any>;
  dispatcher: unknown;
}

// One agent for the process: it holds a connection pool, so building a fresh
// one per request would open a new TCP connection every time. Cached by URL so
// rotating the credential takes effect without a redeploy.
let cached: { url: string; runtime: ProxyRuntime } | null = null;
let loadFailure: string | null = null;

/**
 * Load undici and build the proxy agent. Returns null — never throws — when
 * no proxy is configured or the library cannot be loaded, so a caller can ask
 * unconditionally and simply not get one.
 */
async function proxyRuntime(): Promise<ProxyRuntime | null> {
  const url = proxyUrl();
  if (!url) return null;
  if (cached && cached.url === url) return cached.runtime;

  try {
    const undici = await import("undici");
    const dispatcher = new undici.ProxyAgent({ uri: url });
    const runtime: ProxyRuntime = { fetch: undici.fetch as any, dispatcher };
    cached = { url, runtime };
    loadFailure = null;
    return runtime;
  } catch (e) {
    // A bad proxy URL or an unloadable library must not take down the app.
    // Record it for the status endpoint and let the caller decide.
    loadFailure = (e as Error).message;
    console.warn(`proxy unavailable, calls that require it will fail: ${loadFailure}`);
    return null;
  }
}

/**
 * Fetch, through the proxy when the caller asks for it.
 *
 * `requireProxy` is deliberate: a supplier that whitelists our IP must FAIL
 * rather than quietly go direct, because going direct means the distributor
 * rejects us and the reason is invisible.
 */
export async function fetchMaybeProxied(
  url: string,
  init: Record<string, unknown> = {},
  opts: { useProxy?: boolean; requireProxy?: boolean } = {},
): Promise<Response> {
  if (!opts.useProxy) return fetch(url, init as RequestInit);

  const runtime = await proxyRuntime();
  if (!runtime) {
    if (opts.requireProxy !== false) {
      throw new Error(
        isProxyConfigured()
          ? `outbound proxy could not be initialised: ${loadFailure ?? "unknown error"}`
          : "this request requires a whitelisted IP but FEED_PROXY_URL is not set — it would go out from Vercel's rotating pool and be rejected",
      );
    }
    return fetch(url, init as RequestInit);
  }
  return (await runtime.fetch(url, { ...init, dispatcher: runtime.dispatcher })) as Response;
}

/**
 * Redacted description for status endpoints — the proxy URL carries a
 * password, so it must never be echoed back to a browser.
 */
export function describeProxy(): {
  configured: boolean;
  host: string | null;
  hasCredentials: boolean;
  loadError: string | null;
} {
  const url = proxyUrl();
  if (!url) return { configured: false, host: null, hasCredentials: false, loadError: null };
  try {
    const u = new URL(url);
    return {
      configured: true,
      host: `${u.protocol}//${u.hostname}:${u.port || "(default)"}`,
      hasCredentials: !!(u.username || u.password),
      loadError: loadFailure,
    };
  } catch {
    return { configured: true, host: "(unparseable)", hasCredentials: false, loadError: loadFailure };
  }
}

/**
 * Confirm the proxy works AND that it is the address a supplier would see.
 * Worth its own call: a whitelist is granted for one IP, and finding out it
 * is wrong from a supplier's 403 is a slow way to learn it.
 */
export async function checkProxyEgressIp(timeoutMs = 15_000): Promise<{
  ok: boolean;
  ip?: string;
  viaProxy: boolean;
  error?: string;
}> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  (timer as any).unref?.();
  const configured = isProxyConfigured();
  try {
    const res = await fetchMaybeProxied(
      "https://api.ipify.org?format=json",
      { signal: ac.signal },
      { useProxy: configured, requireProxy: false },
    );
    if (!res.ok) return { ok: false, viaProxy: configured, error: `HTTP ${res.status}` };
    const json = (await res.json()) as { ip?: string };
    return { ok: true, ip: json.ip, viaProxy: configured };
  } catch (e) {
    return { ok: false, viaProxy: configured, error: (e as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

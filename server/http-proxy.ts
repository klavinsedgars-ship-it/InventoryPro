/**
 * Outbound HTTP proxy support.
 *
 * Some distributors (ACC Distribution, and this will not be the last) only
 * accept API calls from an IP address they have whitelisted. Vercel functions
 * egress from a rotating pool, so there is no address to give them — the fix
 * is a small VPS with a static IP running a forward proxy, and routing just
 * those suppliers through it.
 *
 * Node's global fetch does NOT honour HTTP_PROXY/HTTPS_PROXY environment
 * variables, which is the trap here: setting them looks like it works and
 * silently changes nothing. A dispatcher has to be passed explicitly, which is
 * what this module builds.
 *
 * Opt-in per supplier. A proxy is another thing that can be down, so the
 * suppliers that do not need it keep going direct.
 */

import { ProxyAgent, type Dispatcher } from "undici";

/** Where the proxy lives, e.g. http://user:pass@203.0.113.10:8888 */
export function proxyUrl(): string | null {
  const raw = (process.env.FEED_PROXY_URL || "").trim();
  return raw || null;
}

export function isProxyConfigured(): boolean {
  return proxyUrl() !== null;
}

// One agent for the process: it holds a connection pool, and building a fresh
// one per request would open a new TCP connection every time.
let cached: { url: string; agent: ProxyAgent } | null = null;

/**
 * The dispatcher to pass to fetch for a proxied call, or undefined to go
 * direct. Returns undefined rather than throwing when no proxy is set, so a
 * caller can ask for one unconditionally and simply not get one.
 */
export function proxyDispatcher(): Dispatcher | undefined {
  const url = proxyUrl();
  if (!url) return undefined;
  if (cached && cached.url === url) return cached.agent;
  try {
    const agent = new ProxyAgent({ uri: url });
    cached = { url, agent };
    return agent;
  } catch (e) {
    // A malformed proxy URL must not take down every supplier fetch — say so
    // loudly and let the call go direct, where it will fail with the
    // supplier's own error rather than a confusing local one.
    console.warn(`FEED_PROXY_URL is not a usable proxy URL, going direct: ${(e as Error).message}`);
    return undefined;
  }
}

/**
 * Redacted description for status endpoints — the proxy URL carries a
 * password, so it must never be echoed back to a browser.
 */
export function describeProxy(): { configured: boolean; host: string | null; hasCredentials: boolean } {
  const url = proxyUrl();
  if (!url) return { configured: false, host: null, hasCredentials: false };
  try {
    const u = new URL(url);
    return {
      configured: true,
      host: `${u.protocol}//${u.hostname}:${u.port || "(default)"}`,
      hasCredentials: !!(u.username || u.password),
    };
  } catch {
    return { configured: true, host: "(unparseable)", hasCredentials: false };
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
  const dispatcher = proxyDispatcher();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  (timer as any).unref?.();
  try {
    const res = await fetch("https://api.ipify.org?format=json", {
      signal: ac.signal,
      ...(dispatcher ? { dispatcher } : {}),
    } as RequestInit);
    if (!res.ok) return { ok: false, viaProxy: !!dispatcher, error: `HTTP ${res.status}` };
    const json = (await res.json()) as { ip?: string };
    return { ok: true, ip: json.ip, viaProxy: !!dispatcher };
  } catch (e) {
    return { ok: false, viaProxy: !!dispatcher, error: (e as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

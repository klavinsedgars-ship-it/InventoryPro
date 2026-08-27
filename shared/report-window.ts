/**
 * Resolving "which period does this report cover?".
 *
 * "Today" is a calendar day in the SELLER's timezone, not a rolling 24 hours
 * and not UTC midnight. The server runs in UTC and Latvia is two or three
 * hours ahead of it, so a UTC-midnight boundary would drop the evening's
 * orders out of "today" at 2am local and quietly show a different figure to
 * the one a person counts.
 *
 * Pure: the clock is injected, so the boundary behaviour is testable.
 */

export interface ReportWindow {
  from: Date;
  label: string;
  period: "today" | "days";
}

export interface WindowRequest {
  period?: string | null;
  days?: number | null;
  /** Browser's Date.getTimezoneOffset(): minutes to ADD to local to get UTC. */
  tzOffsetMin?: number | null;
  now?: Date;
}

export function resolveReportWindow(req: WindowRequest = {}): ReportWindow {
  const now = req.now ?? new Date();

  if (String(req.period ?? "") === "today") {
    const offset = clampOffset(req.tzOffsetMin);
    // Shift into the seller's local clock, take that date's midnight, then
    // shift back to the instant it corresponds to in UTC.
    const local = new Date(now.getTime() - offset * 60_000);
    const localMidnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
    return { from: new Date(localMidnight + offset * 60_000), label: "Today", period: "today" };
  }

  // A nonsense value falls back to the default rather than being squeezed into
  // range: asking for -5 days and silently getting a one-day report is worse
  // than getting the usual thirty.
  const raw = Math.floor(Number(req.days));
  const days = Number.isFinite(raw) && raw > 0 ? Math.min(1825, raw) : 30;
  const from = new Date(now.getTime() - days * 86_400_000);
  return { from, label: `Last ${days} days`, period: "days" };
}

/** Guard against a nonsensical or hostile offset from a client. */
function clampOffset(v: number | null | undefined): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(-14 * 60, Math.min(14 * 60, Math.trunc(n)));
}

import { describe, it, expect } from "vitest";
import { resolveReportWindow } from "@shared/report-window";

// Latvia in summer is UTC+3, which JS reports as an offset of -180.
const LV_SUMMER = -180;

describe("resolveReportWindow — 'today' means the seller's calendar day", () => {
  it("starts at local midnight, not UTC midnight", () => {
    // 01:30 UTC on the 27th is already 04:30 local, so 'today' starts at
    // 21:00 UTC on the 26th.
    const now = new Date("2026-08-27T01:30:00Z");
    const w = resolveReportWindow({ period: "today", tzOffsetMin: LV_SUMMER, now });
    expect(w.from.toISOString()).toBe("2026-08-26T21:00:00.000Z");
  });

  it("keeps last night's orders inside today until local midnight", () => {
    // The failure this prevents: at 02:00 local, a UTC-midnight boundary would
    // have already rolled over and dropped the evening's sales.
    const now = new Date("2026-08-27T23:30:00Z"); // 02:30 local on the 28th
    const w = resolveReportWindow({ period: "today", tzOffsetMin: LV_SUMMER, now });
    expect(w.from.toISOString()).toBe("2026-08-27T21:00:00.000Z");
  });

  it("falls back to UTC when the client sends no offset", () => {
    const now = new Date("2026-08-27T10:00:00Z");
    const w = resolveReportWindow({ period: "today", now });
    expect(w.from.toISOString()).toBe("2026-08-27T00:00:00.000Z");
  });

  it("ignores an impossible offset rather than trusting the client", () => {
    const now = new Date("2026-08-27T10:00:00Z");
    const w = resolveReportWindow({ period: "today", tzOffsetMin: 99999, now });
    expect(w.from.getTime()).toBeLessThanOrEqual(now.getTime());
    expect(Number.isFinite(w.from.getTime())).toBe(true);
  });
});

describe("resolveReportWindow — day ranges", () => {
  it("counts back the requested number of days", () => {
    const now = new Date("2026-08-27T12:00:00Z");
    expect(resolveReportWindow({ days: 7, now }).from.toISOString()).toBe("2026-08-20T12:00:00.000Z");
  });

  it("defaults to 30 days and clamps nonsense", () => {
    const now = new Date("2026-08-27T12:00:00Z");
    expect(resolveReportWindow({ now }).label).toBe("Last 30 days");
    expect(resolveReportWindow({ days: 0, now }).label).toBe("Last 30 days");
    expect(resolveReportWindow({ days: -5, now }).label).toBe("Last 30 days");
    expect(resolveReportWindow({ days: 99999, now }).label).toBe("Last 1825 days");
  });
});

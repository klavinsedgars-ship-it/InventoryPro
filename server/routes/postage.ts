/**
 * Recording what postage actually cost, from Latvijas Pasts counter receipts.
 *
 * The profit model prices postage from the tariff book, and that estimate is
 * exact for the class it assumes — it matched nine receipted small packets to
 * the cent. What it cannot know is which class was chosen at the counter, and
 * the same 14g item is 3.06 as a letter or 6.29 as a small packet to Ireland.
 * So a receipted figure always wins, and this is how one gets in.
 *
 * Two steps on purpose: /parse shows the proposed matches and changes nothing;
 * /apply writes only the lines the operator confirms. Money is being restated
 * on closed orders, which is not something to do on a guess.
 */

import type { Express } from "express";
import { and, eq, gte, sql } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import { db } from "../db";
import { orders } from "@shared/schema";
import { storage } from "../storage";
import {
  parsePostageReceipt,
  attributeSurcharges,
  shipmentTotalCost,
  type ParsedReceiptLine,
} from "@shared/postage-receipt";

/** Names compare on letters only: case, punctuation and spacing all vary. */
function foldName(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

interface MatchCandidate {
  line: ParsedReceiptLine;
  cost: number;
  orderId: number | null;
  marketplaceOrderId: string | null;
  confidence: "tracking" | "name+country" | "name" | "none";
  /** Other orders that fit equally well — never auto-applied. */
  alternatives: Array<{ orderId: number; marketplaceOrderId: string; shippingName: string }>;
  reason: string;
}

/**
 * Bind receipt lines to orders.
 *
 * Tracking number is an exact key and is tried first. Failing that, the
 * recipient name plus destination country identifies an order well enough for
 * a human to confirm — but only when it is UNIQUE: two orders to the same
 * name are reported as alternatives rather than guessed between, because
 * attaching a cost to the wrong order corrupts two P&Ls at once.
 */
function matchLines(lines: Array<{ line: ParsedReceiptLine; cost: number }>, candidates: any[]): MatchCandidate[] {
  const byTracking = new Map<string, any>();
  const byName = new Map<string, any[]>();
  for (const o of candidates) {
    if (o.trackingNumber) byTracking.set(String(o.trackingNumber).trim().toUpperCase(), o);
    const key = foldName(o.shippingName);
    if (key) byName.set(key, [...(byName.get(key) ?? []), o]);
  }

  return lines.map(({ line, cost }) => {
    const base = {
      line,
      cost,
      alternatives: [] as MatchCandidate["alternatives"],
    };

    if (line.trackingNumber) {
      const hit = byTracking.get(line.trackingNumber.toUpperCase());
      if (hit) {
        return {
          ...base,
          orderId: hit.id,
          marketplaceOrderId: hit.marketplaceOrderId,
          confidence: "tracking" as const,
          reason: `tracking number ${line.trackingNumber}`,
        };
      }
    }

    const nameKey = foldName(line.recipient);
    const byNameHits = nameKey ? (byName.get(nameKey) ?? []) : [];
    const sameCountry = line.countryIso
      ? byNameHits.filter((o) => String(o.shippingCountry ?? "").toUpperCase() === line.countryIso)
      : byNameHits;

    const pool = sameCountry.length > 0 ? sameCountry : byNameHits;
    if (pool.length === 1) {
      return {
        ...base,
        orderId: pool[0].id,
        marketplaceOrderId: pool[0].marketplaceOrderId,
        confidence: (sameCountry.length === 1 ? "name+country" : "name") as MatchCandidate["confidence"],
        reason: `recipient "${line.recipient}"${sameCountry.length === 1 && line.countryIso ? ` in ${line.countryIso}` : ""}`,
      };
    }

    return {
      ...base,
      orderId: null,
      marketplaceOrderId: null,
      confidence: "none" as const,
      alternatives: pool.slice(0, 5).map((o) => ({
        orderId: o.id,
        marketplaceOrderId: o.marketplaceOrderId,
        shippingName: o.shippingName,
      })),
      reason:
        pool.length > 1
          ? `${pool.length} orders share this recipient — pick one`
          : line.recipient
            ? `no order found for "${line.recipient}"`
            : "letter post carries no recipient on the receipt — match by hand",
    };
  });
}

export function registerPostageRoutes(app: Express): void {
  /**
   * Parse a receipt and propose matches. Writes NOTHING — this is the preview
   * half of the flow, in the same "look first" spirit as every other sweep.
   */
  app.post("/api/postage/receipt/parse", requireAuth, async (req, res) => {
    try {
      const text = String(req.body?.text ?? "");
      if (!text.trim()) return res.status(400).json({ ok: false, error: "pass the receipt text as { text }" });

      const receipt = parsePostageReceipt(text);
      const extras = attributeSurcharges(receipt);
      const lines = receipt.shipments.map((line) => ({ line, cost: shipmentTotalCost(line, extras) }));

      // Only look at orders that could plausibly be on this receipt: shipped
      // (or awaiting shipment) and recent. A cost must never land on an order
      // from six months ago because two buyers share a surname.
      const since = new Date(Date.now() - 90 * 24 * 3600 * 1000);
      const candidates = await db
        .select({
          id: orders.id,
          marketplaceOrderId: orders.marketplaceOrderId,
          shippingName: orders.shippingName,
          shippingCountry: orders.shippingCountry,
          trackingNumber: orders.trackingNumber,
          actualPostageCost: orders.actualPostageCost,
          orderDate: orders.orderDate,
        })
        .from(orders)
        .where(gte(orders.orderDate, since))
        .limit(2000);

      const matches = matchLines(lines, candidates);
      res.json({
        ok: true,
        receipt: {
          reference: receipt.reference,
          date: receipt.date,
          printedTotal: receipt.printedTotal,
          parsedTotal: receipt.parsedTotal,
          balanced: receipt.balanced,
          unparsed: receipt.unparsed,
          surchargeTotal: receipt.surcharges.reduce((s, l) => s + l.amount, 0),
        },
        matches,
        summary: {
          shipments: lines.length,
          matched: matches.filter((m) => m.orderId != null).length,
          unmatched: matches.filter((m) => m.orderId == null).length,
          totalCost: Math.round(lines.reduce((s, l) => s + l.cost, 0) * 100) / 100,
        },
        // Say plainly when the receipt does not add up: a missed line is a
        // shipment whose cost never reaches the P&L.
        warning: receipt.balanced
          ? undefined
          : `Parsed lines total ${receipt.parsedTotal.toFixed(2)} but the receipt says ${receipt.printedTotal?.toFixed(2)} — a line was missed, check before applying`,
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: (error as Error).message });
    }
  });

  /**
   * Write confirmed costs onto orders. Body: { reference, assignments:
   * [{ orderId, cost, postalClass?, trackingNumber? }] }.
   */
  app.post("/api/postage/receipt/apply", requireAuth, async (req, res) => {
    try {
      const reference = req.body?.reference ? String(req.body.reference) : null;
      const assignments = Array.isArray(req.body?.assignments) ? req.body.assignments : [];
      if (assignments.length === 0) {
        return res.status(400).json({ ok: false, error: "pass { assignments: [{ orderId, cost }] }" });
      }

      const applied: Array<{ orderId: number; cost: number; previous: number | null }> = [];
      const skipped: Array<{ orderId: unknown; reason: string }> = [];

      for (const a of assignments) {
        const orderId = Number(a?.orderId);
        const cost = Number(a?.cost);
        if (!Number.isFinite(orderId) || !Number.isFinite(cost) || cost <= 0) {
          skipped.push({ orderId: a?.orderId, reason: "orderId and a positive cost are required" });
          continue;
        }
        const [existing] = await db
          .select({ id: orders.id, actualPostageCost: orders.actualPostageCost })
          .from(orders)
          .where(eq(orders.id, orderId))
          .limit(1);
        if (!existing) {
          skipped.push({ orderId, reason: "no such order" });
          continue;
        }
        const previous = existing.actualPostageCost != null ? Number(existing.actualPostageCost) : null;
        // Re-applying the same receipt is harmless; overwriting a DIFFERENT
        // figure is not, so it takes an explicit override.
        if (previous != null && Math.abs(previous - cost) >= 0.01 && a?.overwrite !== true) {
          skipped.push({ orderId, reason: `already has ${previous.toFixed(2)} — pass overwrite:true to replace it` });
          continue;
        }

        await db
          .update(orders)
          .set({
            actualPostageCost: cost.toFixed(2),
            actualPostageSource: "receipt",
            postageReceiptRef: reference,
            ...(a?.postalClass ? { postalClassUsed: String(a.postalClass) } : {}),
            ...(a?.trackingNumber ? { trackingNumber: String(a.trackingNumber) } : {}),
            updatedAt: new Date(),
          })
          .where(eq(orders.id, orderId));
        applied.push({ orderId, cost, previous });
      }

      if (applied.length > 0) {
        await storage.createSyncLog({
          source: "postage",
          operation: "receipt_applied",
          status: "success",
          message: `actual postage recorded on ${applied.length} order(s) from receipt ${reference ?? "(no ref)"}`,
        });
      }

      res.json({ ok: true, applied, skipped, reference });
    } catch (error) {
      res.status(500).json({ ok: false, error: (error as Error).message });
    }
  });

  /** Coverage: how much of the P&L's postage is receipted vs modelled. */
  app.get("/api/postage/coverage", requireAuth, async (_req, res) => {
    try {
      const q: any = await db.execute(sql`
        SELECT count(*)::int AS total,
               count(*) FILTER (WHERE actual_postage_cost IS NOT NULL)::int AS receipted,
               COALESCE(sum(actual_postage_cost), 0)::float AS receipted_total,
               count(*) FILTER (WHERE actual_postage_cost IS NULL AND shipped_at IS NOT NULL)::int AS shipped_without_receipt
        FROM orders
      `);
      res.json({ ok: true, coverage: (q.rows ?? q)?.[0] ?? null });
    } catch (error) {
      res.status(500).json({ ok: false, error: (error as Error).message });
    }
  });
}

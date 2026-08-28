/**
 * Getic distributor feed — probe, import, and catalogue browsing.
 *
 * Everything here reads/writes the supplier_offers STAGING tables only.
 * Nothing touches `products`, the listing ramp, or TME sync — a Getic offer
 * cannot reach eBay from this surface. (See shared/schema.ts on why the
 * quarantine matters.)
 */

import type { Express } from "express";
import { sql } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import { db } from "../db";
import { withLease, describeRefusal } from "../job-lease";
import { leaseStore } from "../storage";
import {
  GETIC_SUPPLIER,
  GETIC_FEED_URL,
  fetchGeticFeed,
  runGeticImport,
  ensureSupplierTables,
} from "../getic-sync";
import { sniffFeedStructure, recordsOf, nodeToJson } from "../xml-feed";
import { mapGeticRecord } from "../getic-feed";

export function registerGeticRoutes(app: Express): void {
  /**
   * What does the feed actually look like? Fetches it and reports transport
   * details, the sniffed structure, the first raw record and how the mapper
   * reads it — WITHOUT writing anything. This is the post-deploy checkpoint
   * for the feed, in the ?maxBatches=1 tradition: look first, then import.
   */
  app.get("/api/getic/probe", requireAuth, async (req, res) => {
    try {
      const feed = await fetchGeticFeed();
      const structure = sniffFeedStructure(feed.xml);
      const recordElement = (req.query.record as string) || structure.recordElement;

      let firstRecordJson: unknown = null;
      let mappedPreview: unknown[] = [];
      if (recordElement) {
        for (const node of recordsOf(feed.xml, recordElement)) {
          const json = nodeToJson(node);
          if (firstRecordJson === null) firstRecordJson = json;
          mappedPreview.push(mapGeticRecord(typeof json === "string" ? {} : json));
          if (mappedPreview.length >= 3) break;
        }
      }

      res.json({
        ok: true,
        url: GETIC_FEED_URL,
        httpStatus: feed.httpStatus,
        contentType: feed.contentType,
        bytes: feed.bytes,
        encoding: feed.encoding,
        head: feed.xml.slice(0, 2048),
        structure,
        recordElement,
        firstRecordJson,
        mappedPreview,
      });
    } catch (error) {
      res.status(502).json({ ok: false, error: (error as Error).message });
    }
  });

  /**
   * Import the feed into supplier_offers. ?dryRun=1 parses a sample and
   * returns the mapping without writing; a real run is lease-guarded so a
   * double click cannot run two imports over each other.
   */
  app.post("/api/getic/import", requireAuth, async (req, res) => {
    const dryRun = req.query.dryRun === "1" || req.body?.dryRun === true;
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : undefined;
    const recordElement = (req.query.record as string) || req.body?.record || undefined;
    try {
      if (dryRun) {
        return res.json(await runGeticImport({ dryRun: true, limit, recordElement }));
      }
      const r = await withLease(leaseStore, "getic-import", { ttlSeconds: 300 }, () =>
        runGeticImport({ dryRun: false, recordElement }),
      );
      if (!r.ran) {
        return res.status(409).json({ ok: false, error: describeRefusal("getic-import", r) });
      }
      res.json(r.result);
    } catch (error) {
      res.status(500).json({ ok: false, error: (error as Error).message });
    }
  });

  /** Import history + headline counts for the browser page. */
  app.get("/api/getic/status", requireAuth, async (_req, res) => {
    try {
      await ensureSupplierTables();
      const runsQ: any = await db.execute(sql`
        SELECT id, status, http_status, bytes, encoding, record_element,
               records_seen, records_upserted, records_failed, new_records,
               duplicate_skus, error, started_at, finished_at
        FROM supplier_feed_runs
        WHERE supplier = ${GETIC_SUPPLIER}
        ORDER BY id DESC
        LIMIT 10
      `);
      const countsQ: any = await db.execute(sql`
        SELECT count(*)::int AS total,
               count(*) FILTER (WHERE stock > 0)::int AS in_stock,
               count(*) FILTER (WHERE ean IS NOT NULL AND ean <> '')::int AS with_ean,
               count(*) FILTER (WHERE weight_g IS NOT NULL)::int AS with_weight,
               count(*) FILTER (WHERE image_url IS NOT NULL)::int AS with_image,
               count(*) FILTER (WHERE price IS NOT NULL)::int AS with_price,
               max(last_seen_at) AS last_seen_at
        FROM supplier_offers
        WHERE supplier = ${GETIC_SUPPLIER}
      `);
      res.json({
        ok: true,
        feedUrl: GETIC_FEED_URL,
        counts: (countsQ.rows ?? countsQ)?.[0] ?? null,
        runs: runsQ.rows ?? runsQ,
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: (error as Error).message });
    }
  });

  /**
   * Paginated catalogue browse. A PROJECTION, not whole rows: description,
   * attributes and raw stay out of the list (the getStaleTmeProducts egress
   * lesson) — the detail endpoint serves them one row at a time.
   */
  app.get("/api/getic/offers", requireAuth, async (req, res) => {
    try {
      await ensureSupplierTables();
      const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? "50"), 10) || 50));
      const search = String(req.query.search ?? "").trim();
      const category = String(req.query.category ?? "").trim();
      const inStockOnly = req.query.inStockOnly === "1";

      const conds = [sql`supplier = ${GETIC_SUPPLIER}`];
      if (search) {
        const like = `%${search}%`;
        conds.push(sql`(name ILIKE ${like} OR supplier_sku ILIKE ${like} OR ean ILIKE ${like} OR manufacturer ILIKE ${like})`);
      }
      if (category) conds.push(sql`category_path = ${category}`);
      if (inStockOnly) conds.push(sql`stock > 0`);
      const where = sql.join(conds, sql` AND `);

      const rowsQ: any = await db.execute(sql`
        SELECT id, supplier_sku, name, ean, manufacturer, mpn, category_path,
               price, currency, stock, weight_g, image_url, product_url, last_seen_at
        FROM supplier_offers
        WHERE ${where}
        ORDER BY id
        LIMIT ${limit} OFFSET ${(page - 1) * limit}
      `);
      const totalQ: any = await db.execute(
        sql`SELECT count(*)::int AS c FROM supplier_offers WHERE ${where}`,
      );
      res.json({
        ok: true,
        page,
        limit,
        total: (totalQ.rows ?? totalQ)?.[0]?.c ?? 0,
        offers: rowsQ.rows ?? rowsQ,
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: (error as Error).message });
    }
  });

  /** Full detail for one offer, raw record included. */
  app.get("/api/getic/offers/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "bad id" });
      const q: any = await db.execute(
        sql`SELECT * FROM supplier_offers WHERE id = ${id} AND supplier = ${GETIC_SUPPLIER}`,
      );
      const row = (q.rows ?? q)?.[0];
      if (!row) return res.status(404).json({ ok: false, error: "not found" });
      res.json({ ok: true, offer: row });
    } catch (error) {
      res.status(500).json({ ok: false, error: (error as Error).message });
    }
  });

  /** Distinct categories with counts, for the browse filter. */
  app.get("/api/getic/categories", requireAuth, async (_req, res) => {
    try {
      await ensureSupplierTables();
      const q: any = await db.execute(sql`
        SELECT category_path, count(*)::int AS count
        FROM supplier_offers
        WHERE supplier = ${GETIC_SUPPLIER} AND category_path IS NOT NULL
        GROUP BY category_path
        ORDER BY count DESC
        LIMIT 300
      `);
      res.json({ ok: true, categories: q.rows ?? q });
    } catch (error) {
      res.status(500).json({ ok: false, error: (error as Error).message });
    }
  });

  /**
   * Overlap with the live TME catalogue, by SKU and by EAN. If Getic and TME
   * both carry a part and both get listed, we bid against ourselves on eBay —
   * this is the number to look at before any promotion step gets built.
   */
  app.get("/api/getic/overlap", requireAuth, async (_req, res) => {
    try {
      await ensureSupplierTables();
      const q: any = await db.execute(sql`
        SELECT
          (SELECT count(*)::int FROM supplier_offers o
             JOIN products p ON upper(p.sku) = o.supplier_sku
           WHERE o.supplier = ${GETIC_SUPPLIER}) AS sku_overlap,
          (SELECT count(*)::int FROM supplier_offers o
             JOIN products p ON p.ean = o.ean AND o.ean IS NOT NULL AND o.ean <> ''
           WHERE o.supplier = ${GETIC_SUPPLIER}) AS ean_overlap
      `);
      res.json({ ok: true, overlap: (q.rows ?? q)?.[0] ?? null });
    } catch (error) {
      res.status(500).json({ ok: false, error: (error as Error).message });
    }
  });
}

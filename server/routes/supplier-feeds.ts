/**
 * XML feed distributors — probe, import, catalogue browsing, and promotion.
 * One set of handlers, registered once per FEED_SUPPLIERS entry:
 * /api/getic/*, /api/greencell/*, … plus /api/cron/<slug>-import each.
 *
 * Probe/import/browse read and write the supplier_offers STAGING tables
 * only. POST /promote is the one deliberate door out of the quarantine: it
 * copies selected offers into `products`, from where the listing ramp treats
 * them like any other candidate — provided the supplier is also named in
 * LISTING_SUPPLIERS. (See shared/schema.ts and server/supplier-promote.ts.)
 */

import type { Express } from "express";
import { sql } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import { db } from "../db";
import { withLease, describeRefusal } from "../job-lease";
import { leaseStore } from "../storage";
import {
  FEED_SUPPLIERS,
  fetchSupplierFeed,
  runSupplierFeedImport,
  ensureSupplierTables,
  type SupplierFeedConfig,
} from "../supplier-feed-sync";
import {
  offerConds,
  offerSortSql,
  promoteSupplierOffers,
  promotableIdsFor,
  promotedProductCount,
  type SupplierOfferFilter,
} from "../supplier-promote";
import { sniffFeedStructure, recordsOf, nodeToJson } from "../xml-feed";
import { mapGeticRecord } from "../getic-feed";

/**
 * One filter parser for both surfaces — GET /offers (query params) and
 * POST /promote {all, filter} (JSON body) — so "Add all N filtered"
 * promotes exactly the rows the browse view is showing.
 */
function offerFilterFrom(src: Record<string, unknown>): SupplierOfferFilter {
  const s = (k: string) => String(src[k] ?? "").trim();
  const num = (k: string) => {
    const v = parseFloat(String(src[k] ?? ""));
    return Number.isFinite(v) ? v : undefined;
  };
  const promoted = s("promoted");
  return {
    search: s("search") || undefined,
    category: s("category") || undefined,
    manufacturer: s("manufacturer") || undefined,
    inStockOnly: src["inStockOnly"] === "1" || src["inStockOnly"] === true,
    priceMin: num("priceMin"),
    priceMax: num("priceMax"),
    promoted: promoted === "yes" || promoted === "no" ? promoted : undefined,
  };
}

export function registerSupplierFeedRoutes(app: Express): void {
  for (const config of FEED_SUPPLIERS) {
    registerOneSupplier(app, config);
  }
}

function registerOneSupplier(app: Express, config: SupplierFeedConfig): void {
  const base = `/api/${config.slug}`;
  const importLease = `${config.slug}-import`;
  const promoteLease = `${config.slug}-promote`;

  /**
   * What does the feed actually look like? Fetches it and reports transport
   * details, the sniffed structure, the first raw record and how the mapper
   * reads it — WITHOUT writing anything. This is the post-deploy checkpoint
   * for the feed, in the ?maxBatches=1 tradition: look first, then import.
   */
  app.get(`${base}/probe`, requireAuth, async (req, res) => {
    try {
      const feed = await fetchSupplierFeed(config);
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
        url: config.feedUrl,
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
  app.post(`${base}/import`, requireAuth, async (req, res) => {
    const dryRun = req.query.dryRun === "1" || req.body?.dryRun === true;
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : undefined;
    const recordElement = (req.query.record as string) || req.body?.record || undefined;
    try {
      if (dryRun) {
        return res.json(await runSupplierFeedImport(config, { dryRun: true, limit, recordElement }));
      }
      const r = await withLease(leaseStore, importLease, { ttlSeconds: 300 }, () =>
        runSupplierFeedImport(config, { dryRun: false, recordElement }),
      );
      if (!r.ran) {
        return res.status(409).json({ ok: false, error: describeRefusal(importLease, r) });
      }
      res.json(r.result);
    } catch (error) {
      res.status(500).json({ ok: false, error: (error as Error).message });
    }
  });

  /**
   * Hourly feed refresh — but only once something is promoted. While the
   * catalogue is pure staging, the operator imports by hand from the browser
   * page; the moment promoted products exist, their price/stock must track
   * the feed unattended (the post-import refresh inside runSupplierFeedImport
   * does the propagation). Same no-auth posture as the other /api/cron/*
   * handlers (Vercel cron calls carry no session).
   */
  const importCronHandler = async (_req: any, res: any) => {
    try {
      if ((await promotedProductCount(config.supplier)) === 0) {
        return res.json({ ok: true, skipped: true, reason: `no promoted ${config.displayName} products yet — import manually from the browser page` });
      }
      const r = await withLease(leaseStore, importLease, { ttlSeconds: 300 }, () =>
        runSupplierFeedImport(config, { dryRun: false }),
      );
      if (!r.ran) {
        return res.json({ ok: true, skipped: true, reason: describeRefusal(importLease, r) });
      }
      res.json(r.result);
    } catch (error) {
      res.status(500).json({ ok: false, error: (error as Error).message });
    }
  };
  app.get(`/api/cron/${config.slug}-import`, importCronHandler);
  app.post(`/api/cron/${config.slug}-import`, importCronHandler);

  /** Import history + headline counts for the browser page. */
  app.get(`${base}/status`, requireAuth, async (_req, res) => {
    try {
      await ensureSupplierTables();
      const runsQ: any = await db.execute(sql`
        SELECT id, status, http_status, bytes, encoding, record_element,
               records_seen, records_upserted, records_failed, new_records,
               duplicate_skus, error, started_at, finished_at
        FROM supplier_feed_runs
        WHERE supplier = ${config.supplier}
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
               count(*) FILTER (WHERE promoted_product_id IS NOT NULL)::int AS promoted,
               max(last_seen_at) AS last_seen_at
        FROM supplier_offers
        WHERE supplier = ${config.supplier}
      `);
      res.json({
        ok: true,
        feedUrl: config.feedUrl,
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
  app.get(`${base}/offers`, requireAuth, async (req, res) => {
    try {
      await ensureSupplierTables();
      const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? "50"), 10) || 50));

      const where = sql.join(offerConds(config.supplier, offerFilterFrom(req.query as Record<string, unknown>)), sql` AND `);
      const orderBy = offerSortSql(String(req.query.sort ?? "id"));

      const rowsQ: any = await db.execute(sql`
        SELECT id, supplier_sku, name, ean, manufacturer, mpn, category_path,
               price, currency, stock, weight_g, image_url, additional_images,
               product_url, last_seen_at, promoted_product_id, promoted_at
        FROM supplier_offers
        WHERE ${where}
        ORDER BY ${orderBy}
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
  app.get(`${base}/offers/:id`, requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "bad id" });
      const q: any = await db.execute(
        sql`SELECT * FROM supplier_offers WHERE id = ${id} AND supplier = ${config.supplier}`,
      );
      const row = (q.rows ?? q)?.[0];
      if (!row) return res.status(404).json({ ok: false, error: "not found" });
      res.json({ ok: true, offer: row });
    } catch (error) {
      res.status(500).json({ ok: false, error: (error as Error).message });
    }
  });

  /** Distinct categories with counts, for the browse filter. */
  app.get(`${base}/categories`, requireAuth, async (_req, res) => {
    try {
      await ensureSupplierTables();
      const q: any = await db.execute(sql`
        SELECT category_path, count(*)::int AS count
        FROM supplier_offers
        WHERE supplier = ${config.supplier} AND category_path IS NOT NULL
        GROUP BY category_path
        ORDER BY count DESC
        LIMIT 300
      `);
      res.json({ ok: true, categories: q.rows ?? q });
    } catch (error) {
      res.status(500).json({ ok: false, error: (error as Error).message });
    }
  });

  /** Distinct manufacturers with counts, for the browse filter. */
  app.get(`${base}/manufacturers`, requireAuth, async (_req, res) => {
    try {
      await ensureSupplierTables();
      const q: any = await db.execute(sql`
        SELECT manufacturer, count(*)::int AS count
        FROM supplier_offers
        WHERE supplier = ${config.supplier} AND manufacturer IS NOT NULL AND manufacturer <> ''
        GROUP BY manufacturer
        ORDER BY count DESC
        LIMIT 500
      `);
      res.json({ ok: true, manufacturers: q.rows ?? q });
    } catch (error) {
      res.status(500).json({ ok: false, error: (error as Error).message });
    }
  });

  /**
   * Overlap with the rest of the live catalogue, by SKU and by EAN. If two
   * suppliers both carry a part and both get listed, we bid against
   * ourselves on eBay — this is the number to look at before a bulk
   * promotion.
   */
  app.get(`${base}/overlap`, requireAuth, async (_req, res) => {
    try {
      await ensureSupplierTables();
      const q: any = await db.execute(sql`
        SELECT
          (SELECT count(*)::int FROM supplier_offers o
             JOIN products p ON upper(p.sku) = o.supplier_sku
           WHERE o.supplier = ${config.supplier}) AS sku_overlap,
          (SELECT count(*)::int FROM supplier_offers o
             JOIN products p ON p.ean = o.ean AND o.ean IS NOT NULL AND o.ean <> ''
           WHERE o.supplier = ${config.supplier}) AS ean_overlap
      `);
      res.json({ ok: true, overlap: (q.rows ?? q)?.[0] ?? null });
    } catch (error) {
      res.status(500).json({ ok: false, error: (error as Error).message });
    }
  });

  /**
   * Promote offers into `products`. Body is either {ids: [...]} (explicit
   * selection) or {all: true, filter: {...}} (everything the current browse
   * filter matches). Lease-guarded: a double click must not race two
   * promotions into duplicate-SKU errors. Time-bounded: a huge "all"
   * returns a partial result with `remaining` — call again to continue
   * (already-promoted rows are skipped, so repeats converge).
   */
  app.post(`${base}/promote`, requireAuth, async (req, res) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      let ids: number[];
      if (Array.isArray(body.ids) && body.ids.length > 0) {
        ids = (body.ids as unknown[])
          .map((n) => parseInt(String(n), 10))
          .filter((n) => Number.isFinite(n));
      } else if (body.all === true) {
        ids = await promotableIdsFor(config.supplier, offerFilterFrom((body.filter ?? {}) as Record<string, unknown>));
      } else {
        return res.status(400).json({ ok: false, error: "pass {ids:[...]} or {all:true, filter:{...}}" });
      }
      const r = await withLease(leaseStore, promoteLease, { ttlSeconds: 300 }, () =>
        promoteSupplierOffers(config.supplier, ids),
      );
      if (!r.ran) {
        return res.status(409).json({ ok: false, error: describeRefusal(promoteLease, r) });
      }
      res.json(r.result);
    } catch (error) {
      res.status(500).json({ ok: false, error: (error as Error).message });
    }
  });
}

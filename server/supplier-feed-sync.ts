/**
 * XML supplier feed → supplier_offers staging table.
 *
 * Built for Getic (2026-08-28), generalized when Green Cell arrived
 * (2026-09-02): every distributor that hands us a product XML runs through
 * this same engine, keyed by the `supplier` column. Adding a distributor is
 * one entry in FEED_SUPPLIERS below — the parser discovers the record
 * element, the mapper reads fields by name heuristics (server/getic-feed.ts,
 * generic despite the name), and the routes/UI are registered per config.
 *
 * Everything here writes to the staging tables only (see the comment on
 * supplierOffers in shared/schema.ts); promotion into `products` lives in
 * server/supplier-promote.ts.
 *
 * The import is a single pass: fetch the whole feed (it is one document — no
 * pagination to resume), stream-scan it record by record, upsert in batches.
 * Idempotent: re-running updates the same rows via (supplier, supplier_sku).
 */

import { sql } from "drizzle-orm";
import { db } from "./db";
import { supplierOffers, supplierFeedRuns, type SupplierFeedRun } from "@shared/schema";
import { sniffFeedStructure, recordsOf, nodeToJson, detectXmlEncoding, type FeedStructure, type JsonRecord } from "./xml-feed";
import { mapGeticRecord, coverageOf, flattenRecord, type NormalizedOffer } from "./getic-feed";
import type { SupplierRefreshStats } from "./supplier-promote";

export interface SupplierFeedConfig {
  /** Value of the `supplier` column, e.g. "GETIC". Uppercase, stable. */
  supplier: string;
  /** URL path segment: /api/<slug>/*, /api/cron/<slug>-import. */
  slug: string;
  /** What the UI calls it. */
  displayName: string;
  feedUrl: string;
}

export const GETIC_FEED: SupplierFeedConfig = {
  supplier: "GETIC",
  slug: "getic",
  displayName: "Getic",
  feedUrl: process.env.GETIC_FEED_URL || "https://api.getic.com/xml/rentbox/xml",
};

// The default URL carries the b2b portal's secure key. That is how Green
// Cell hands the feed out; set GREENCELL_FEED_URL to rotate the key without
// a deploy.
export const GREENCELL_FEED: SupplierFeedConfig = {
  supplier: "GREENCELL",
  slug: "greencell",
  displayName: "Green Cell",
  feedUrl:
    process.env.GREENCELL_FEED_URL ||
    "https://b2b.greencell.global/modules/xmlgenerator/get.php?secure_key=f82911a066faf27873aaa5d80c875fd2",
};

/** Every XML-feed distributor. Routes, crons and the UI iterate this. */
export const FEED_SUPPLIERS: SupplierFeedConfig[] = [GETIC_FEED, GREENCELL_FEED];

/** Refuse to buffer a feed beyond this — something is wrong upstream. */
const MAX_FEED_BYTES = 150 * 1024 * 1024;
const UPSERT_BATCH = 400;

// ---------------------------------------------------------------------------
// Schema safety net: applyScaleMigration creates these at boot, but the first
// request after a deploy can beat it. Same pattern as ensureLeaseTable.
// ---------------------------------------------------------------------------
let supplierTablesReady = false;
export async function ensureSupplierTables(): Promise<void> {
  if (supplierTablesReady) return;
  for (const s of SUPPLIER_SCHEMA_STATEMENTS) {
    try {
      await db.execute(sql.raw(s));
    } catch (e) {
      console.warn(`ensureSupplierTables: skipped "${s.slice(0, 60)}…": ${(e as Error).message}`);
    }
  }
  supplierTablesReady = true;
}

/** Shared with applyScaleMigration so boot and lazy paths cannot drift. */
export const SUPPLIER_SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS supplier_offers (
     id serial PRIMARY KEY,
     supplier text NOT NULL,
     supplier_sku text NOT NULL,
     name text,
     ean text,
     manufacturer text,
     mpn text,
     category_path text,
     description text,
     price numeric(12,4),
     currency text,
     stock integer,
     weight_g numeric(10,2),
     image_url text,
     additional_images text,
     datasheet_url text,
     product_url text,
     attributes text,
     raw text,
     feed_run_id integer,
     promoted_product_id integer,
     promoted_at timestamp,
     first_seen_at timestamp DEFAULT now(),
     last_seen_at timestamp DEFAULT now()
   )`,
  // Existing deployments predate the promotion columns.
  `ALTER TABLE supplier_offers ADD COLUMN IF NOT EXISTS promoted_product_id integer`,
  `ALTER TABLE supplier_offers ADD COLUMN IF NOT EXISTS promoted_at timestamp`,
  `CREATE UNIQUE INDEX IF NOT EXISTS supplier_offers_supplier_sku_uniq ON supplier_offers (supplier, supplier_sku)`,
  `CREATE INDEX IF NOT EXISTS supplier_offers_category_idx ON supplier_offers (supplier, category_path)`,
  // Browse-page search is ILIKE '%term%'; trigram is the only index that
  // serves it (same lesson as the products table). Harmless to skip if the
  // extension is unavailable.
  `CREATE INDEX IF NOT EXISTS supplier_offers_name_trgm_idx ON supplier_offers USING gin (name gin_trgm_ops)`,
  `CREATE INDEX IF NOT EXISTS supplier_offers_sku_trgm_idx ON supplier_offers USING gin (supplier_sku gin_trgm_ops)`,
  `CREATE TABLE IF NOT EXISTS supplier_feed_runs (
     id serial PRIMARY KEY,
     supplier text NOT NULL,
     status text NOT NULL DEFAULT 'running',
     url text,
     http_status integer,
     content_type text,
     bytes integer,
     encoding text,
     record_element text,
     records_seen integer NOT NULL DEFAULT 0,
     records_upserted integer NOT NULL DEFAULT 0,
     records_failed integer NOT NULL DEFAULT 0,
     new_records integer NOT NULL DEFAULT 0,
     duplicate_skus integer NOT NULL DEFAULT 0,
     error text,
     field_coverage text,
     mapping_sample text,
     started_at timestamp DEFAULT now(),
     finished_at timestamp
   )`,
];

// ---------------------------------------------------------------------------
// Fetch + decode
// ---------------------------------------------------------------------------
export interface FetchedFeed {
  xml: string;
  bytes: number;
  httpStatus: number;
  contentType: string | null;
  encoding: string;
}

export async function fetchSupplierFeed(config: SupplierFeedConfig, opts?: { timeoutMs?: number; url?: string }): Promise<FetchedFeed> {
  const url = opts?.url ?? config.feedUrl;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), opts?.timeoutMs ?? 120_000);
  (timer as any).unref?.();
  let res: Response;
  try {
    res = await fetch(url, {
      signal: ac.signal,
      headers: {
        // Some feed servers 403 the default undici UA.
        "User-Agent": "InventoryPro/1.0 (catalogue import)",
        Accept: "application/xml, text/xml, */*",
      },
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    throw new Error(`Feed fetch failed: HTTP ${res.status} ${res.statusText}`);
  }
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_FEED_BYTES) {
    throw new Error(`Feed is ${(buf.byteLength / 1e6).toFixed(0)} MB — over the ${MAX_FEED_BYTES / 1e6} MB guard`);
  }
  const contentType = res.headers.get("content-type");
  // Sniff the declaration from the first bytes read as ASCII, then decode the
  // body with the declared charset (feeds lie in the HTTP header).
  const head = new TextDecoder("latin1").decode(buf.slice(0, 1024));
  const encoding = detectXmlEncoding(head, contentType);
  let xml: string;
  try {
    xml = new TextDecoder(encoding).decode(buf);
  } catch {
    xml = new TextDecoder("utf-8").decode(buf); // unknown label — best effort
  }
  return { xml, bytes: buf.byteLength, httpStatus: res.status, contentType, encoding };
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------
export interface SupplierImportOptions {
  dryRun?: boolean;
  /** Dry run: how many records to sample (default 25). */
  limit?: number;
  /** Override the auto-detected record element. */
  recordElement?: string;
  timeBudgetMs?: number;
}

export interface SupplierImportResult {
  ok: boolean;
  dryRun: boolean;
  structure: FeedStructure;
  recordElement: string | null;
  bytes: number;
  encoding: string;
  recordsSeen: number;
  recordsUpserted: number;
  recordsFailed: number;
  duplicateSkus: number;
  newRecords: number;
  coverage: Record<string, number>;
  mappingSample: Record<string, string> | null;
  /** Dry run only: the mapped sample for eyeballing. */
  sample?: NormalizedOffer[];
  /** Real runs: promoted products refreshed from the new feed state. */
  refresh?: SupplierRefreshStats | { skipped: string } | { error: string };
  runId?: number;
  status?: string;
  error?: string;
}

export async function runSupplierFeedImport(config: SupplierFeedConfig, opts: SupplierImportOptions = {}): Promise<SupplierImportResult> {
  const dryRun = !!opts.dryRun;
  const started = Date.now();
  const timeBudgetMs = opts.timeBudgetMs ?? 240_000;

  const feed = await fetchSupplierFeed(config);
  const structure = sniffFeedStructure(feed.xml);
  const recordElement = opts.recordElement || structure.recordElement;

  const base: Omit<SupplierImportResult, "ok"> = {
    dryRun,
    structure,
    recordElement,
    bytes: feed.bytes,
    encoding: feed.encoding,
    recordsSeen: 0,
    recordsUpserted: 0,
    recordsFailed: 0,
    duplicateSkus: 0,
    newRecords: 0,
    coverage: {},
    mappingSample: null,
  };

  if (!recordElement) {
    return { ...base, ok: false, error: "Could not detect a repeating record element — pass ?record=<name>" };
  }

  if (dryRun) {
    // NaN-safe: a bad ?limit= must not defeat the clamp and sample everything.
    const limit = Number.isFinite(Number(opts.limit))
      ? Math.max(1, Math.min(200, Number(opts.limit)))
      : 25;
    const sample: NormalizedOffer[] = [];
    for (const node of recordsOf(feed.xml, recordElement)) {
      const json = nodeToJson(node);
      sample.push(mapGeticRecord(typeof json === "string" ? {} : json));
      if (sample.length >= limit) break;
    }
    return {
      ...base,
      ok: true,
      recordsSeen: sample.length,
      coverage: coverageOf(sample),
      mappingSample: sample[0]?.sourceKeys ?? null,
      sample: sample.map((s) => ({ ...s, description: s.description ? s.description.slice(0, 300) : null })),
    };
  }

  await ensureSupplierTables();

  const [runRow] = await db
    .insert(supplierFeedRuns)
    .values({
      supplier: config.supplier,
      status: "running",
      url: config.feedUrl,
      httpStatus: feed.httpStatus,
      contentType: feed.contentType,
      bytes: feed.bytes,
      encoding: feed.encoding,
      recordElement,
    })
    .returning();
  const runId = runRow.id;

  const countBefore = await countOffers(config.supplier);

  const seenSkus = new Set<string>();
  type OfferRow = typeof supplierOffers.$inferInsert;
  let batch: OfferRow[] = [];
  let recordsSeen = 0;
  let recordsUpserted = 0;
  let recordsFailed = 0;
  let duplicateSkus = 0;
  let mappingSample: Record<string, string> | null = null;
  let budgetHit = false;
  const coverageTotals: Record<string, number> = {};
  const errors: string[] = [];

  const toRow = (o: NormalizedOffer, rawJson: JsonRecord): OfferRow => ({
    supplier: config.supplier,
    supplierSku: o.supplierSku!,
    name: o.name,
    ean: o.ean,
    manufacturer: o.manufacturer,
    mpn: o.mpn,
    categoryPath: o.categoryPath,
    description: o.description,
    price: o.price != null ? String(o.price) : null,
    currency: o.currency,
    stock: o.stock,
    weightG: o.weightG != null ? String(Math.round(o.weightG * 100) / 100) : null,
    imageUrl: o.imageUrl,
    additionalImages: o.additionalImages.length ? JSON.stringify(o.additionalImages) : null,
    datasheetUrl: o.datasheetUrl,
    productUrl: o.productUrl,
    attributes: JSON.stringify(o.attributes),
    raw: JSON.stringify({ record: rawJson, sourceKeys: o.sourceKeys }),
    feedRunId: runId,
  });

  const flush = async () => {
    if (batch.length === 0) return;
    const rows = batch;
    batch = [];
    await db
      .insert(supplierOffers)
      .values(rows)
      .onConflictDoUpdate({
        target: [supplierOffers.supplier, supplierOffers.supplierSku],
        set: {
          name: sql`excluded.name`,
          ean: sql`excluded.ean`,
          manufacturer: sql`excluded.manufacturer`,
          mpn: sql`excluded.mpn`,
          categoryPath: sql`excluded.category_path`,
          description: sql`excluded.description`,
          price: sql`excluded.price`,
          currency: sql`excluded.currency`,
          stock: sql`excluded.stock`,
          weightG: sql`excluded.weight_g`,
          imageUrl: sql`excluded.image_url`,
          additionalImages: sql`excluded.additional_images`,
          datasheetUrl: sql`excluded.datasheet_url`,
          productUrl: sql`excluded.product_url`,
          attributes: sql`excluded.attributes`,
          raw: sql`excluded.raw`,
          feedRunId: sql`excluded.feed_run_id`,
          lastSeenAt: sql`now()`,
        },
      });
    recordsUpserted += rows.length;
  };

  try {
    // Stream the feed record by record; one batch at a time is in memory
    // beyond the source string, and each flush is awaited before the scan
    // continues — a 100k-record feed must not open 250 concurrent upserts
    // against Neon's pool.
    for (const node of recordsOf(feed.xml, recordElement)) {
      recordsSeen++;
      const json = nodeToJson(node);
      const offer = mapGeticRecord(typeof json === "string" ? {} : json);
      if (!offer.supplierSku) {
        recordsFailed++;
        // Self-describing: name the fields the record ACTUALLY has, so a
        // synonym miss is diagnosable from the UI without re-probing.
        if (errors.length === 0 && typeof json !== "string") {
          const keys = flattenRecord(json).map((f) => f.path).slice(0, 20);
          errors.push(`record #${recordsSeen}: no SKU field found — record fields: ${keys.join(", ") || "(none)"}`);
        } else if (errors.length < 3) {
          errors.push(`record #${recordsSeen}: no SKU field found`);
        }
        continue;
      }
      if (seenSkus.has(offer.supplierSku)) {
        // The same SKU twice in one feed: first occurrence wins, and a
        // second-in-batch row would break ON CONFLICT anyway.
        duplicateSkus++;
        continue;
      }
      seenSkus.add(offer.supplierSku);
      if (!mappingSample) mappingSample = offer.sourceKeys;
      for (const [k, v] of Object.entries(coverageOf([offer]))) {
        coverageTotals[k] = (coverageTotals[k] ?? 0) + v;
      }
      batch.push(toRow(offer, typeof json === "string" ? {} : json));
      if (batch.length >= UPSERT_BATCH) {
        await flush();
        if (Date.now() - started > timeBudgetMs) {
          budgetHit = true;
          break;
        }
      }
    }
    await flush();
  } catch (e) {
    const countAfterErr = await countOffers(config.supplier).catch(() => countBefore);
    await finishRun(runId, {
      status: "failed",
      error: (e as Error).message,
      recordsSeen,
      recordsUpserted,
      recordsFailed,
      duplicateSkus,
      newRecords: Math.max(0, countAfterErr - countBefore),
      fieldCoverage: JSON.stringify(coverageTotals),
      mappingSample: mappingSample ? JSON.stringify(mappingSample) : null,
    });
    return {
      ...base,
      ok: false,
      runId,
      status: "failed",
      error: (e as Error).message,
      recordsSeen,
      recordsUpserted,
      recordsFailed,
      duplicateSkus,
      coverage: coverageTotals,
      mappingSample,
    };
  }

  const countAfter = await countOffers(config.supplier);
  const newRecords = Math.max(0, countAfter - countBefore);
  const status = budgetHit ? "partial" : "completed";
  await finishRun(runId, {
    status,
    error: errors.length ? errors.join("; ") : budgetHit ? "time budget hit — run again to continue" : null,
    recordsSeen,
    recordsUpserted,
    recordsFailed,
    duplicateSkus,
    newRecords,
    fieldCoverage: JSON.stringify(coverageTotals),
    mappingSample: mappingSample ? JSON.stringify(mappingSample) : null,
  });

  // Freshness: promoted products must follow the feed. Dynamic import —
  // supplier-promote imports this module at top level, so a static import
  // here would be a cycle. Refresh errors are reported, never thrown: the
  // import itself succeeded and its result must say so.
  let refresh: SupplierImportResult["refresh"];
  const remainingMs = timeBudgetMs - (Date.now() - started);
  if (budgetHit || remainingMs < 20_000) {
    refresh = { skipped: budgetHit ? "import hit its time budget" : "not enough time budget left" };
  } else {
    try {
      const { promotedProductCount, refreshPromotedProducts } = await import("./supplier-promote");
      refresh =
        (await promotedProductCount(config.supplier)) > 0
          ? await refreshPromotedProducts(config.supplier, remainingMs)
          : { skipped: "nothing promoted yet" };
    } catch (e) {
      refresh = { error: (e as Error).message };
    }
  }

  return {
    ...base,
    ok: true,
    runId,
    status,
    recordsSeen,
    recordsUpserted,
    recordsFailed,
    duplicateSkus,
    newRecords,
    coverage: coverageTotals,
    mappingSample,
    refresh,
  };
}

async function countOffers(supplier: string): Promise<number> {
  const q: any = await db.execute(
    sql`SELECT count(*)::int AS c FROM supplier_offers WHERE supplier = ${supplier}`,
  );
  return (q.rows ?? q)?.[0]?.c ?? 0;
}

async function finishRun(
  id: number,
  patch: Partial<SupplierFeedRun> & { status: string },
): Promise<void> {
  await db
    .update(supplierFeedRuns)
    .set({ ...patch, finishedAt: new Date() } as any)
    .where(sql`${supplierFeedRuns.id} = ${id}`);
}

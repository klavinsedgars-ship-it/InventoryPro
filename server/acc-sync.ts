/**
 * ACC Distribution catalogue → supplier_offers.
 *
 * Same destination as the XML feeds, different transport. Where Getic and
 * Green Cell hand over one document that we stream, ACC is a paged JSON API,
 * so this importer is built the way every other long job here is built: a
 * time-bounded slice that upserts as it goes, records where it stopped, and
 * can be resumed from that offset by the next call.
 *
 * Their throttle shapes the design. Identical GetProducts requests are
 * refused inside a 15-minute window, so a resumed run must NOT repeat the
 * page it already fetched — the cursor is persisted on the run row and the
 * next slice starts after it, which also happens to be the cheapest way to
 * page a 25k-item catalogue inside a 300-second function.
 */

import { sql } from "drizzle-orm";
import { db } from "./db";
import { accApi, type AccApiService, type AccFilter } from "./acc-api";
import { branchPathResolver, mapAccProduct, type AccProduct } from "./acc-map";
import { coverageOf, type NormalizedOffer } from "./getic-feed";
import {
  ensureSupplierTables,
  finishFeedRun,
  offerToRow,
  startFeedRun,
  upsertOfferRows,
  countSupplierOffers,
  type SupplierFeedConfig,
  type SupplierOfferRow,
} from "./supplier-feed-sync";
import type { SupplierRefreshStats } from "./supplier-promote";

/**
 * Page size. ACC's own guidance is Limit 25000 for a full list in one call,
 * but a single 25k-product JSON body is tens of megabytes to buffer and parse
 * inside a serverless function with a fixed memory ceiling — and one failure
 * loses the whole thing. 1000 keeps each response small enough to be cheap to
 * retry while staying far inside the 300-requests-per-minute budget.
 */
const PAGE_SIZE = 1000;

/** Stop short of Vercel's 300s ceiling with room to finish the run row. */
const DEFAULT_TIME_BUDGET_MS = 240_000;

export interface AccImportOptions {
  dryRun?: boolean;
  /** Dry run: how many products to map for inspection (default 25). */
  limit?: number;
  /** Resume from here instead of the last run's cursor. */
  offset?: number;
  /** ISO date; only products changed since. The cheap daily mode. */
  updatedAfter?: string;
  /** Restrict to one branch id — useful for a first look at the catalogue. */
  branch?: string;
  timeBudgetMs?: number;
  pageSize?: number;
}

export interface AccImportResult {
  ok: boolean;
  dryRun: boolean;
  configured: boolean;
  pagesFetched: number;
  recordsSeen: number;
  recordsUpserted: number;
  recordsFailed: number;
  duplicateSkus: number;
  newRecords: number;
  /** Where the next slice should start. Null once the catalogue is exhausted. */
  nextOffset: number | null;
  complete: boolean;
  coverage: Record<string, number>;
  branchesLoaded: number;
  /** How many mapped offers carry no weight — they cannot be priced to ship. */
  missingWeight: number;
  /** normalized field -> the ACC field it came from, for the dry-run preview. */
  mappingSample: Record<string, string> | null;
  sample?: NormalizedOffer[];
  refresh?: SupplierRefreshStats | { skipped: string } | { error: string };
  runId?: number;
  status?: string;
  error?: string;
}

function emptyResult(dryRun: boolean): Omit<AccImportResult, "ok" | "configured"> {
  return {
    dryRun,
    pagesFetched: 0,
    recordsSeen: 0,
    recordsUpserted: 0,
    recordsFailed: 0,
    duplicateSkus: 0,
    newRecords: 0,
    nextOffset: null,
    complete: false,
    coverage: {},
    branchesLoaded: 0,
    missingWeight: 0,
    mappingSample: null,
  };
}

/**
 * The branch tree, fetched once per import so category paths read
 * "Computers > Storage" rather than a bare leaf name. A failure here is not
 * fatal: a catalogue with shallow categories beats no catalogue.
 */
async function loadBranches(api: AccApiService): Promise<{ resolve?: (oid: number) => string[] | null; count: number }> {
  const r = await api.getTreeBranches();
  if (!r.ok || !r.data?.length) return { count: 0 };
  return { resolve: branchPathResolver(r.data), count: r.data.length };
}

function filtersFor(opts: AccImportOptions): AccFilter[] {
  const filters: AccFilter[] = [];
  if (opts.updatedAfter) filters.push({ id: "updatedAfter", values: [opts.updatedAfter] });
  if (opts.branch) filters.push({ id: "branch", values: [opts.branch] });
  return filters;
}

/**
 * A cursor belongs to one query shape. A filtered run (a daily delta, or a
 * single branch) walks a completely different, much shorter result set, so its
 * offsets are meaningless to a full-catalogue run and vice versa — mixing them
 * would resume a full import at an offset past the end of a delta and silently
 * declare the catalogue complete. Runs are tagged, and only full runs carry a
 * resumable cursor.
 */
const FULL_RUN_MARKER = "GetProducts";
const FILTERED_RUN_MARKER = "GetProducts:filtered";

/**
 * Where a resumed run should pick up.
 *
 * A previous slice that stopped on its time budget leaves its cursor on the
 * run row; anything else (completed, failed, or no history) starts at zero.
 * Reading it back from the database rather than holding it in memory is what
 * makes the cron resumable across separate function invocations.
 */
async function lastCursor(supplier: string): Promise<number> {
  // The MOST RECENT run, then check whether it was partial — filtering to
  // partial rows in SQL would happily resume from a stale cursor left behind
  // before a later run completed the catalogue.
  const q: any = await db.execute(sql`
    SELECT records_seen, status
    FROM supplier_feed_runs
    WHERE supplier = ${supplier} AND record_element = ${FULL_RUN_MARKER}
    ORDER BY id DESC
    LIMIT 1
  `);
  const row = (q.rows ?? q)?.[0];
  if (!row || row.status !== "partial") return 0;
  const seen = Number(row.records_seen ?? 0);
  return Number.isFinite(seen) && seen > 0 ? seen : 0;
}

export async function runAccImport(
  config: SupplierFeedConfig,
  opts: AccImportOptions = {},
): Promise<AccImportResult> {
  const dryRun = !!opts.dryRun;
  const started = Date.now();
  const timeBudgetMs = opts.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS;
  const pageSize = Math.max(1, Math.min(5000, opts.pageSize ?? PAGE_SIZE));
  const base = emptyResult(dryRun);

  const api = accApi();
  if (!api) {
    return {
      ...base,
      ok: false,
      configured: false,
      error: "ACC_LICENSE_KEY is not set — ask ACC for a licence key, or set it to their published demo key to see the shape of the data",
    };
  }

  const filters = filtersFor(opts);
  const branches = await loadBranches(api);
  const mapOpts = { resolveBranch: branches.resolve };

  // -------------------------------------------------------------------------
  // Dry run: one page, mapped, nothing written.
  // -------------------------------------------------------------------------
  if (dryRun) {
    const limit = Number.isFinite(Number(opts.limit))
      ? Math.max(1, Math.min(200, Number(opts.limit)))
      : 25;
    const page = await api.getProducts({ offset: opts.offset ?? 0, limit, filters });
    if (!page.ok) {
      return { ...base, ok: false, configured: true, branchesLoaded: branches.count, error: page.error };
    }
    const sample = (page.data?.products ?? []).map((p) => mapAccProduct(p, mapOpts));
    return {
      ...base,
      ok: true,
      configured: true,
      pagesFetched: 1,
      recordsSeen: sample.length,
      branchesLoaded: branches.count,
      coverage: coverageOf(sample),
      missingWeight: sample.filter((s) => s.weightG == null).length,
      // Same shape the XML importer reports, so the dry-run dialog can show
      // which ACC field fed each column instead of an empty object.
      mappingSample: sample[0]?.sourceKeys ?? null,
      sample,
    };
  }

  // -------------------------------------------------------------------------
  // Real run
  // -------------------------------------------------------------------------
  await ensureSupplierTables();

  const fullCatalogue = filters.length === 0;
  const startOffset = opts.offset ?? (fullCatalogue ? await lastCursor(config.supplier) : 0);
  const runId = await startFeedRun({
    supplier: config.supplier,
    url: `${config.slug}:GetProducts offset=${startOffset}${filters.length ? ` filters=${filters.map((f) => `${f.id}=${f.values.join("|")}`).join(",")}` : ""}`,
    recordElement: fullCatalogue ? FULL_RUN_MARKER : FILTERED_RUN_MARKER,
  });
  const countBefore = await countSupplierOffers(config.supplier);

  let offset = startOffset;
  let pagesFetched = 0;
  let recordsSeen = 0;
  let recordsUpserted = 0;
  let recordsFailed = 0;
  let duplicateSkus = 0;
  let missingWeight = 0;
  let mappingSample: Record<string, string> | null = null;
  let complete = false;
  let budgetHit = false;
  const coverageTotals: Record<string, number> = {};
  const errors: string[] = [];
  // Within one run only. Two pages cannot both carry a SKU unless the
  // catalogue shifted under us mid-page, and a repeat inside one batch would
  // break ON CONFLICT.
  const seenSkus = new Set<string>();

  const fail = async (message: string, status = "failed") => {
    const countAfter = await countSupplierOffers(config.supplier).catch(() => countBefore);
    await finishFeedRun(runId, {
      status,
      error: message,
      recordsSeen: fullCatalogue ? offset : recordsSeen,
      recordsUpserted,
      recordsFailed,
      duplicateSkus,
      newRecords: Math.max(0, countAfter - countBefore),
      fieldCoverage: JSON.stringify(coverageTotals),
    } as any);
    return {
      ...base,
      ok: false,
      configured: true,
      runId,
      status,
      error: message,
      pagesFetched,
      recordsSeen,
      recordsUpserted,
      recordsFailed,
      duplicateSkus,
      newRecords: Math.max(0, countAfter - countBefore),
      nextOffset: fullCatalogue ? offset : null,
      branchesLoaded: branches.count,
      coverage: coverageTotals,
      missingWeight,
    } as AccImportResult;
  };

  while (!complete) {
    if (Date.now() - started > timeBudgetMs) {
      budgetHit = true;
      break;
    }

    const page = await api.getProducts({
      offset,
      limit: pageSize,
      filters,
      // Retries stop rather than overrun the slice; the cursor is already
      // persisted, so the next tick picks up exactly here.
      deadline: started + timeBudgetMs,
    });
    if (!page.ok) {
      // A page that failed after real work is a partial run, not a failed one:
      // the rows already written are good and the cursor is worth keeping.
      return await fail(page.error ?? "ACC request failed", recordsUpserted > 0 ? "partial" : "failed");
    }
    pagesFetched++;

    const products: AccProduct[] = page.data?.products ?? [];
    if (products.length === 0) {
      complete = true;
      break;
    }

    const rows: SupplierOfferRow[] = [];
    for (const p of products) {
      recordsSeen++;
      const offer = mapAccProduct(p, mapOpts);
      if (!offer.supplierSku) {
        recordsFailed++;
        if (errors.length < 3) {
          errors.push(`product at offset ${offset + rows.length}: no PID — keys: ${Object.keys(p ?? {}).slice(0, 15).join(", ") || "(none)"}`);
        }
        continue;
      }
      if (seenSkus.has(offer.supplierSku)) {
        duplicateSkus++;
        continue;
      }
      seenSkus.add(offer.supplierSku);
      if (!mappingSample) mappingSample = offer.sourceKeys;
      if (offer.weightG == null) missingWeight++;
      for (const [k, v] of Object.entries(coverageOf([offer]))) {
        coverageTotals[k] = (coverageTotals[k] ?? 0) + v;
      }
      rows.push(offerToRow(config.supplier, offer, p, runId));
    }

    try {
      await upsertOfferRows(rows);
    } catch (e) {
      return await fail(`upsert failed at offset ${offset}: ${(e as Error).message}`, recordsUpserted > 0 ? "partial" : "failed");
    }
    recordsUpserted += rows.length;

    offset += products.length;
    // A short page is the end of the catalogue — ACC has no total count, so
    // this is the only termination signal it gives us.
    if (products.length < pageSize) complete = true;
  }

  const countAfter = await countSupplierOffers(config.supplier);
  const newRecords = Math.max(0, countAfter - countBefore);
  const status = complete ? "completed" : "partial";
  const note = complete
    ? errors.length
      ? errors.join("; ")
      : null
    : `time budget hit at offset ${offset} — run again to continue${errors.length ? `; ${errors.join("; ")}` : ""}`;

  await finishFeedRun(runId, {
    status,
    error: note,
    // For a full run records_seen doubles as the resume cursor, so it holds
    // the absolute offset reached rather than this slice's own count. A
    // filtered run has nothing to resume, so it reports what it actually saw.
    recordsSeen: fullCatalogue ? offset : recordsSeen,
    recordsUpserted,
    recordsFailed,
    duplicateSkus,
    newRecords,
    fieldCoverage: JSON.stringify(coverageTotals),
  } as any);

  // Promoted products must follow the catalogue, exactly as for the XML feeds.
  // Dynamic import: supplier-promote pulls in supplier-feed-sync at top level.
  let refresh: AccImportResult["refresh"];
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
    configured: true,
    runId,
    status,
    pagesFetched,
    recordsSeen,
    recordsUpserted,
    recordsFailed,
    duplicateSkus,
    newRecords,
    // Only a full run can be continued; a filtered one is re-requested whole.
    nextOffset: complete || !fullCatalogue ? null : offset,
    complete,
    branchesLoaded: branches.count,
    coverage: coverageTotals,
    missingWeight,
    mappingSample,
    refresh,
  };
}

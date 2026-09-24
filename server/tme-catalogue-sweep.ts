/**
 * Whole-catalogue TME ingest (2026-09-23).
 *
 * Until now, getting TME products into `products` meant opening a category in
 * the TME Browser, paging through it, selecting everything and starting a sync
 * job — by hand, per category, against a supplier with over 500,000 products.
 * 129k got in that way. The rest never will.
 *
 * This walks TME's category tree server-side and imports what passes an
 * ingest filter (see shared/ingest-filter.ts). The filter is the point: the
 * goal is emphatically NOT to import everything. Every row in `products` is
 * re-priced and stock-synced for as long as it exists, so an unfiltered import
 * would quadruple that standing cost to carry stock we would never sell.
 *
 * House pattern: cron-driven time-bounded slices, DB kill-switch
 * ('ebay'/'catalogue_sweep'), lease, resumable cursor, self-disabling.
 *
 * Rate limits shape the walk. TME allows 10 req/sec for search and 2-4/sec for
 * the price/stock endpoints, so discovery (search, symbols only) is cheap and
 * enrichment is not — the sweep therefore discovers a page, drops symbols it
 * already has, and only pays for detail on what is genuinely new.
 */

import { storage } from "./storage";
import { tmeApi } from "./tme-api";
import { processTmeSyncChunk } from "./tme-sync";
import {
  emptyRejectionCounts,
  type IngestFilter,
  type IngestRejection,
} from "@shared/ingest-filter";

/** TME's search endpoint caps a page at 100. */
const PAGE_SIZE = 100;
/** Detail fetches batch at 50 per call inside getEnhancedProductInfo. */
const IMPORT_CHUNK = 100;
const DEFAULT_BUDGET_MS = 240_000;

interface Cursor {
  categoryIndex: number;
  page: number;
}

interface LeafCategory {
  id: string;
  name: string;
  count: number;
}

interface RawCategory {
  id: string;
  name: string;
  count: number;
  parentId: string | null;
}

/** Restrict a sweep to one branch of the tree, or null for the whole thing. */
export interface CatalogueScope {
  rootCategoryId: string | null;
  rootName: string | null;
}

export interface CatalogueTotals {
  discovered: number;
  alreadyHad: number;
  imported: number;
  filtered: number;
  failed: number;
  filteredBy: Record<IngestRejection, number>;
}

export interface CatalogueSweepStats extends CatalogueTotals {
  enabled: boolean;
  done: boolean;
  categoriesDone: number;
  categoriesTotal: number;
  cursor: Cursor;
  budgetHit: boolean;
  sampleErrors: string[];
}

async function getSetting(name: string): Promise<string | undefined> {
  const rows = await storage.getMarketplaceSettings("ebay");
  return (rows as any[]).find((s) => s.setting === name)?.value;
}

async function setSetting(name: string, value: string): Promise<void> {
  await storage.setMarketplaceSetting({ marketplace: "ebay", setting: name, value });
}

async function readJson<T>(name: string, fallback: T): Promise<T> {
  const raw = await getSetting(name);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Filter
// ---------------------------------------------------------------------------

/**
 * Defaults chosen from what this business has actually learned, not from
 * caution: postage has exceeded supplier cost on real orders, so weight is
 * capped; a product with no image can never list on eBay; and TME publishes
 * plenty of items priced in fractions of a cent that cannot clear the floor.
 */
export const DEFAULT_INGEST_FILTER: IngestFilter = {
  minPrice: 0.1,
  maxPrice: 40,
  maxWeightGrams: 500,
  inStockOnly: true,
  requireImage: true,
  requireEan: false,
};

export async function getIngestFilter(): Promise<IngestFilter> {
  return readJson<IngestFilter>("catalogue_filter", DEFAULT_INGEST_FILTER);
}

export async function setIngestFilter(filter: IngestFilter): Promise<IngestFilter> {
  const clean: IngestFilter = {
    minPrice: numOrNull(filter.minPrice),
    maxPrice: numOrNull(filter.maxPrice),
    maxWeightGrams: numOrNull(filter.maxWeightGrams),
    inStockOnly: !!filter.inStockOnly,
    requireImage: !!filter.requireImage,
    requireEan: !!filter.requireEan,
  };
  await setSetting("catalogue_filter", JSON.stringify(clean));
  return clean;
}

function numOrNull(v: unknown): number | null {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

/**
 * Leaf categories only.
 *
 * TME's tree reports `TotalProducts` on parents INCLUSIVE of their children,
 * so walking every node would fetch most of the catalogue several times over
 * and make the progress total meaningless. A leaf is a category no other
 * category names as its parent.
 *
 * Cached in settings for the life of a sweep: the tree is thousands of nodes
 * and does not change during a run.
 */
async function loadRawCategories(refresh = false): Promise<RawCategory[]> {
  if (!refresh) {
    const cached = await readJson<RawCategory[]>("catalogue_tree", []);
    if (cached.length > 0) return cached;
  }
  const all = await tmeApi.getAllCategories();
  const raw: RawCategory[] = all.map((c) => ({
    id: String(c.CategoryId),
    name: c.Name,
    count: c.ProductCount ?? 0,
    parentId: c.ParentId ? String(c.ParentId) : null,
  }));
  await setSetting("catalogue_tree", JSON.stringify(raw));
  return raw;
}

/**
 * Every category beneath `rootId`, inclusive — the branch an operator means
 * when they point at "Fuses and Circuit Breakers" rather than its eleven
 * sub-categories and their sub-categories.
 */
function descendantsOf(all: RawCategory[], rootId: string): Set<string> {
  const byParent = new Map<string, RawCategory[]>();
  for (const c of all) {
    if (!c.parentId) continue;
    const list = byParent.get(c.parentId) ?? [];
    list.push(c);
    byParent.set(c.parentId, list);
  }
  const out = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length) {
    const id = queue.pop()!;
    for (const child of byParent.get(id) ?? []) {
      // Guard a malformed tree: a cycle must not hang the walk.
      if (out.has(child.id)) continue;
      out.add(child.id);
      queue.push(child.id);
    }
  }
  return out;
}

export async function getCatalogueScope(): Promise<CatalogueScope> {
  return readJson<CatalogueScope>("catalogue_scope", { rootCategoryId: null, rootName: null });
}

/**
 * Leaf categories the sweep should walk, honouring the current scope.
 *
 * Leaves only, because TME reports `TotalProducts` on parents INCLUSIVE of
 * their children: walking every node would fetch most of the branch several
 * times over and make the progress total meaningless.
 */
export async function loadLeafCategories(refresh = false, scope?: CatalogueScope): Promise<LeafCategory[]> {
  if (!refresh) {
    const cached = await readJson<LeafCategory[]>("catalogue_categories", []);
    if (cached.length > 0) return cached;
  }
  const all = await loadRawCategories(refresh);
  const parents = new Set(all.map((c) => c.parentId).filter((p): p is string => !!p));
  const effective = scope ?? (await getCatalogueScope());
  const inScope = effective.rootCategoryId ? descendantsOf(all, effective.rootCategoryId) : null;

  const leaves = all
    .filter((c) => !parents.has(c.id))
    .filter((c) => !inScope || inScope.has(c.id))
    .map((c) => ({ id: c.id, name: c.name, count: c.count }))
    // Biggest first: if a sweep is stopped early, it will have covered the
    // most of the catalogue it could in the time it had.
    .sort((a, b) => b.count - a.count);
  await setSetting("catalogue_categories", JSON.stringify(leaves));
  return leaves;
}

/** Name and leaf/product totals for a branch, without starting anything. */
export async function describeBranch(rootCategoryId: string): Promise<{
  rootCategoryId: string;
  rootName: string | null;
  leafCategories: number;
  products: number;
}> {
  const all = await loadRawCategories();
  const ids = descendantsOf(all, rootCategoryId);
  const parents = new Set(all.map((c) => c.parentId).filter((p): p is string => !!p));
  const leaves = all.filter((c) => ids.has(c.id) && !parents.has(c.id));
  return {
    rootCategoryId,
    rootName: all.find((c) => c.id === rootCategoryId)?.name ?? null,
    leafCategories: leaves.length,
    products: leaves.reduce((sum, c) => sum + (c.count || 0), 0),
  };
}

// ---------------------------------------------------------------------------
// Control
// ---------------------------------------------------------------------------

export async function isCatalogueSweepEnabled(): Promise<boolean> {
  return (await getSetting("catalogue_sweep")) === "on";
}

export async function setCatalogueSweepEnabled(on: boolean, scope?: CatalogueScope): Promise<void> {
  await setSetting("catalogue_sweep", on ? "on" : "off");
  if (on) {
    await setSetting("catalogue_scope", JSON.stringify(scope ?? { rootCategoryId: null, rootName: null }));
    await setSetting("catalogue_cursor", JSON.stringify({ categoryIndex: 0, page: 1 } satisfies Cursor));
    await setSetting("catalogue_totals", JSON.stringify(emptyTotals()));
  }
}

function emptyTotals(): CatalogueTotals {
  return {
    discovered: 0,
    alreadyHad: 0,
    imported: 0,
    filtered: 0,
    failed: 0,
    filteredBy: emptyRejectionCounts(),
  };
}

export async function catalogueProgress(): Promise<{
  enabled: boolean;
  scope: CatalogueScope;
  filter: IngestFilter;
  cursor: Cursor;
  categoriesTotal: number;
  categoriesDone: number;
  productsInCategories: number;
  totals: CatalogueTotals;
  tmeProductsHeld: number;
}> {
  const categories = await readJson<LeafCategory[]>("catalogue_categories", []);
  const cursor = await readJson<Cursor>("catalogue_cursor", { categoryIndex: 0, page: 1 });
  const held = await storage.getTmeProductCount().catch(() => 0);
  return {
    enabled: await isCatalogueSweepEnabled(),
    scope: await getCatalogueScope(),
    filter: await getIngestFilter(),
    cursor,
    categoriesTotal: categories.length,
    categoriesDone: Math.min(cursor.categoryIndex, categories.length),
    productsInCategories: categories.reduce((sum, c) => sum + (c.count || 0), 0),
    totals: await readJson<CatalogueTotals>("catalogue_totals", emptyTotals()),
    tmeProductsHeld: held,
  };
}

// ---------------------------------------------------------------------------
// The slice
// ---------------------------------------------------------------------------

/** One time-bounded slice; call repeatedly (the cron does) until done. */
export async function runCatalogueSweep(budgetMs = DEFAULT_BUDGET_MS): Promise<CatalogueSweepStats> {
  const started = Date.now();
  const filter = await getIngestFilter();
  const categories = await loadLeafCategories();
  const totals = await readJson<CatalogueTotals>("catalogue_totals", emptyTotals());
  let cursor = await readJson<Cursor>("catalogue_cursor", { categoryIndex: 0, page: 1 });

  const stats: CatalogueSweepStats = {
    ...totals,
    enabled: true,
    done: false,
    categoriesDone: cursor.categoryIndex,
    categoriesTotal: categories.length,
    cursor,
    budgetHit: false,
    sampleErrors: [],
  };

  const { tmeApiV2 } = await import("./tme-api-v2");

  while (cursor.categoryIndex < categories.length) {
    if (Date.now() - started > budgetMs) {
      stats.budgetHit = true;
      break;
    }

    const category = categories[cursor.categoryIndex];
    let page: { products: any[]; pages: number };
    try {
      // Discovery only — no stock/price enrichment. Those endpoints are the
      // slow ones, and most of what a page returns is already in `products`.
      page = await tmeApiV2.getCategoryPageEnriched(category.id, cursor.page, {
        limit: PAGE_SIZE,
        inStockOnly: false,
        withStock: false,
      });
    } catch (e) {
      if (stats.sampleErrors.length < 3) {
        stats.sampleErrors.push(`category ${category.id} page ${cursor.page}: ${(e as Error).message}`);
      }
      // A category that will not page is not worth stalling the whole sweep.
      cursor = { categoryIndex: cursor.categoryIndex + 1, page: 1 };
      await setSetting("catalogue_cursor", JSON.stringify(cursor));
      continue;
    }

    const symbols = page.products.map((p: any) => String(p.Symbol)).filter(Boolean);
    totals.discovered += symbols.length;

    if (symbols.length > 0) {
      // Skip what we already hold BEFORE paying for detail: re-importing a
      // known product costs the expensive rate-limited endpoints and changes
      // nothing, since the hourly sync already keeps it fresh.
      const existing = await storage.getProductsBySkus(symbols);
      const have = new Set(existing.map((p) => p.sku.toUpperCase()));
      const fresh = symbols.filter((s) => !have.has(s.toUpperCase()));
      totals.alreadyHad += symbols.length - fresh.length;

      for (let i = 0; i < fresh.length; i += IMPORT_CHUNK) {
        const chunk = fresh.slice(i, i + IMPORT_CHUNK);
        try {
          const r = await processTmeSyncChunk(chunk, {
            applyDynamicPricing: true,
            ingestFilter: filter,
          });
          totals.imported += r.syncedCount + r.updatedCount;
          totals.filtered += r.filteredCount;
          totals.failed += r.failedCount;
          for (const [reason, n] of Object.entries(r.filteredBy)) {
            totals.filteredBy[reason as IngestRejection] += n;
          }
          if (r.errors.length && stats.sampleErrors.length < 3) {
            stats.sampleErrors.push(r.errors[0]);
          }
        } catch (e) {
          totals.failed += chunk.length;
          if (stats.sampleErrors.length < 3) stats.sampleErrors.push((e as Error).message);
        }
        if (Date.now() - started > budgetMs) break;
      }
    }

    // Advance. A page past the end of a category moves to the next one.
    cursor =
      cursor.page >= (page.pages || 1)
        ? { categoryIndex: cursor.categoryIndex + 1, page: 1 }
        : { categoryIndex: cursor.categoryIndex, page: cursor.page + 1 };
    await setSetting("catalogue_cursor", JSON.stringify(cursor));
    await setSetting("catalogue_totals", JSON.stringify(totals));
  }

  if (cursor.categoryIndex >= categories.length) {
    stats.done = true;
    await setCatalogueSweepEnabled(false);
  }

  await setSetting("catalogue_totals", JSON.stringify(totals));
  Object.assign(stats, totals);
  stats.cursor = cursor;
  stats.categoriesDone = Math.min(cursor.categoryIndex, categories.length);
  return stats;
}

// ---------------------------------------------------------------------------
// Dry run
// ---------------------------------------------------------------------------

export interface CatalogueDryRun {
  filter: IngestFilter;
  categoriesTotal: number;
  productsInCategories: number;
  sampled: number;
  passed: number;
  alreadyHeld: number;
  filteredBy: Record<IngestRejection, number>;
  passRate: number;
  /** productsInCategories x passRate. An ESTIMATE, and labelled as one. */
  projectedImportable: number;
  categoriesSampled: string[];
  note: string;
}

/**
 * Sample the catalogue and report what the filter would let through, WITHOUT
 * writing anything.
 *
 * This exists because the honest answer to "how many of TME's 500k would we
 * import?" is not guessable — it depends entirely on how many products carry a
 * weight, which only TME knows. Sampling spreads across the biggest categories
 * rather than taking the first page of the first one, so the estimate is not
 * dominated by a single product type.
 */
export async function dryRunCatalogue(opts: { categories?: number; pagesPerCategory?: number } = {}): Promise<CatalogueDryRun> {
  const filter = await getIngestFilter();
  const categories = await loadLeafCategories();
  const catCount = Math.max(1, Math.min(25, opts.categories ?? 8));
  const pagesPer = Math.max(1, Math.min(5, opts.pagesPerCategory ?? 1));
  const { tmeApiV2 } = await import("./tme-api-v2");

  // Spread the sample across the size range instead of taking the top N,
  // which would be all connectors and resistors.
  const step = Math.max(1, Math.floor(categories.length / catCount));
  const picked = Array.from({ length: catCount }, (_, i) => categories[i * step]).filter(Boolean);

  const filteredBy = emptyRejectionCounts();
  let sampled = 0;
  let passed = 0;
  let alreadyHeld = 0;

  for (const category of picked) {
    for (let page = 1; page <= pagesPer; page++) {
      let r: { products: any[]; pages: number };
      try {
        r = await tmeApiV2.getCategoryPageEnriched(category.id, page, {
          limit: PAGE_SIZE,
          inStockOnly: false,
          withStock: false,
        });
      } catch {
        break;
      }
      const symbols = r.products.map((p: any) => String(p.Symbol)).filter(Boolean);
      if (symbols.length === 0) break;

      const existing = await storage.getProductsBySkus(symbols);
      const have = new Set(existing.map((p) => p.sku.toUpperCase()));
      const fresh = symbols.filter((s) => !have.has(s.toUpperCase()));
      alreadyHeld += symbols.length - fresh.length;
      sampled += symbols.length;

      if (fresh.length > 0) {
        // Judge them exactly as the real run would — same fetch, same
        // predicate — but with a filter that cannot write. processTmeSyncChunk
        // writes, so the dry run asks TME directly and applies the predicate
        // itself.
        const enhanced = await tmeApi.getEnhancedProductInfo(fresh).catch(() => [] as any[]);
        const { passesIngestFilter } = await import("@shared/ingest-filter");
        const { getSupplierPriceForMoq } = await import("./dynamic-pricing");
        for (const e of enhanced) {
          const product = e.product ?? {};
          const moq = product.MinAmount || 1;
          const verdict = passesIngestFilter(
            {
              supplierPrice: getSupplierPriceForMoq(e.price?.PriceList, moq) || null,
              weightGrams: product.Weight ?? null,
              stock: e.stock?.Amount ?? null,
              imageUrl: product.Photo ?? null,
              ean: product.EAN ?? null,
            },
            filter,
          );
          if (verdict.ok) passed++;
          else filteredBy[verdict.reason]++;
        }
      }
      if (page >= (r.pages || 1)) break;
    }
  }

  const judged = passed + Object.values(filteredBy).reduce((a, b) => a + b, 0);
  const passRate = judged > 0 ? passed / judged : 0;
  const productsInCategories = categories.reduce((sum, c) => sum + (c.count || 0), 0);

  return {
    filter,
    categoriesTotal: categories.length,
    productsInCategories,
    sampled,
    passed,
    alreadyHeld,
    filteredBy,
    passRate,
    projectedImportable: Math.round(productsInCategories * passRate),
    categoriesSampled: picked.map((c) => `${c.name} (${c.count})`),
    note:
      "projectedImportable extrapolates the sample's pass rate across the whole catalogue. It is an estimate, not a count — categories differ, and the sample is a few hundred products out of half a million.",
  };
}

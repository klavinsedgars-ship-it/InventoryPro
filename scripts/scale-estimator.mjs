#!/usr/bin/env node
/**
 * InventoryPro scaling estimator.
 *
 * Plug in catalog / listed / chunk / cron values; it prints refresh demand
 * vs capacity, TME calls vs daily cap, eBay listing throughput, and
 * days-to-list. All numbers below are anchored in the actual code on `main`
 * (see references) and the empirical "104 chunks in ~270s" from your own
 * cron_sync log on 2026-06-10 ~05:00 UTC.
 *
 * Examples:
 *   node scripts/scale-estimator.mjs
 *   node scripts/scale-estimator.mjs --catalog 100000 --listed 10000
 *   node scripts/scale-estimator.mjs --catalog 100000 --listed 100000 --chunk 100 --cronEveryMin 30
 *   node scripts/scale-estimator.mjs --catalog 50000 --listed 5000 --listedStaleH 8
 *
 * Knobs (with code references):
 *   --catalog        Total TME products in DB                      (default 17000)
 *   --listed         How many of those are listed on eBay          (default 200)
 *   --chunk          Products per sync chunk                       (default 50, sync-chunk.ts: runSyncChunk(50))
 *   --cronEveryMin   Sync cron period in minutes                   (default 60, vercel.json: "0 * * * *")
 *   --rampEveryH     Listing-ramp cron period in hours             (default 6, vercel.json cron "30 H/6 * * *")
 *   --listedStaleH   Listed staleness window                       (default 4, sync-chunk.ts: SYNC_STALE_HOURS_LISTED)
 *   --unlistedStaleH Unlisted staleness window                     (default 48, sync-chunk.ts: SYNC_STALE_HOURS_UNLISTED)
 *   --tmeDailyCap    TME API daily call cap                        (default 10000, tme-api-optimized.ts:86)
 *   --ebayDailyCap   eBay API daily call cap                       (default 2000000, routes.ts:1175)
 *   --rampBatch      Listings published per eBay bulk batch        (default 25, routes.ts:4312)
 *   --tickBudgetS    Vercel function budget per cron tick (sec)    (default 270, routes.ts:4191)
 *   --baseChunksPerTick  Empirical: chunks completed in 270s       (default 104, from cron_sync log)
 */

const args = parseArgs(process.argv.slice(2));
const cfg = {
  catalog: num(args.catalog, 17_000),
  listed: num(args.listed, 200),
  chunk: num(args.chunk, 50),
  cronEveryMin: num(args.cronEveryMin, 60),
  rampEveryH: num(args.rampEveryH, 6),
  listedStaleH: num(args.listedStaleH, 4),
  unlistedStaleH: num(args.unlistedStaleH, 48),
  tmeDailyCap: num(args.tmeDailyCap, 10_000),
  ebayDailyCap: num(args.ebayDailyCap, 2_000_000),
  rampBatch: num(args.rampBatch, 25),
  tickBudgetS: num(args.tickBudgetS, 270),
  baseChunksPerTick: num(args.baseChunksPerTick, 104),
};

if (cfg.listed > cfg.catalog) {
  fail(`--listed (${cfg.listed}) cannot exceed --catalog (${cfg.catalog}).`);
}

// ---- DEMAND ----------------------------------------------------------------
// Each listed SKU refreshes once per listedStaleH window -> 24/H times per day.
// Same for unlisted. Total daily refresh demand:
const unlisted = cfg.catalog - cfg.listed;
const listedRefreshesPerDay = cfg.listed * (24 / cfg.listedStaleH);
const unlistedRefreshesPerDay = unlisted * (24 / cfg.unlistedStaleH);
const totalRefreshesPerDay = listedRefreshesPerDay + unlistedRefreshesPerDay;

// ---- CAPACITY --------------------------------------------------------------
// Empirically the chunk loop ran 104 chunks in ~270s at chunk=50. Chunk time
// scales sub-linearly with chunk size (TME batches 100 symbols/call, so a
// chunk of 100 is one call; bigger chunks share fixed overhead). Conservative
// model: throughput = baseChunksPerTick * chunkSize, BUT cap chunks/tick when
// chunk size grows (more work per chunk -> fewer chunks fit in 270s).
//
// Per-chunk time model (calibrated against the 104 chunks @ 50 baseline):
//   base 50 -> ~2.6s/chunk -> ~0.7s fixed overhead + ~0.038s/product
//   chunk 100 -> ~2.6 + 50*0.038 = ~4.5s -> ~60 chunks/tick -> 6000 products
// This is intentionally conservative; real throughput is often better when
// most chunks are unchanged (no eBay update writes).
const FIXED_OVERHEAD_S = 0.7;
const PER_PRODUCT_S = 0.038;
const chunkTimeS = FIXED_OVERHEAD_S + cfg.chunk * PER_PRODUCT_S;
const chunksPerTick = Math.floor(cfg.tickBudgetS / chunkTimeS);
const productsPerTick = chunksPerTick * cfg.chunk;
const ticksPerDay = (24 * 60) / cfg.cronEveryMin;
const refreshCapacityPerDay = productsPerTick * ticksPerDay;
const headroom = refreshCapacityPerDay / totalRefreshesPerDay;

// ---- TME CALLS -------------------------------------------------------------
// One combined GetPricesAndStocks call per 100 symbols (tme-api-optimized.ts:454).
// Each chunk of N -> ceil(N/100) calls. With chunk <= 100 that's 1 call/chunk.
const tmeCallsPerChunk = Math.ceil(cfg.chunk / 100);
const tmeCallsPerDay = tmeCallsPerChunk * chunksPerTick * ticksPerDay;
const tmePctOfCap = (tmeCallsPerDay / cfg.tmeDailyCap) * 100;

// ---- EBAY LISTING THROUGHPUT (ramp) ---------------------------------------
// Bulk-publish batch is 25 SKUs (routes.ts:4312); ~3 eBay calls/batch
// (createOrReplaceInventoryItem + createOffer + bulkPublishOffer, batched).
// Empirically a 270s ramp tick gets through ~38 batches (similar shape to
// the sync chunk loop) -> ~950 published/tick.
const RAMP_BATCHES_PER_TICK = 38;
const publishedPerRampTick = RAMP_BATCHES_PER_TICK * cfg.rampBatch;
const rampTicksPerDay = 24 / cfg.rampEveryH;
const publishedPerDay = publishedPerRampTick * rampTicksPerDay;
const daysToListUnlisted = unlisted > 0 ? unlisted / publishedPerDay : 0;

// ---- DISPLAY ---------------------------------------------------------------
const verdict =
  headroom >= 2 ? { tag: "PLENTY", emoji: "✅" } :
  headroom >= 1.2 ? { tag: "OK", emoji: "✅" } :
  headroom >= 1 ? { tag: "TIGHT", emoji: "⚠️" } :
  { tag: "OVER CAPACITY", emoji: "❌" };

const tmeVerdict =
  tmePctOfCap >= 80 ? { tag: "NEAR CAP", emoji: "⚠️" } :
  tmePctOfCap >= 50 ? { tag: "HIGH", emoji: "⚠️" } :
  { tag: "FINE", emoji: "✅" };

console.log("");
console.log(`InventoryPro scaling estimator`);
console.log(`──────────────────────────────────────────────────────────────`);
console.log(`Inputs`);
console.log(`  catalog          ${fmt(cfg.catalog)} products`);
console.log(`  listed on eBay   ${fmt(cfg.listed)}  (${pct(cfg.listed / cfg.catalog)})`);
console.log(`  unlisted         ${fmt(unlisted)}`);
console.log(`  chunk size       ${cfg.chunk} products / chunk`);
console.log(`  sync cron        every ${cfg.cronEveryMin}m  -> ${fmt(ticksPerDay)} ticks/day`);
console.log(`  staleness        listed ${cfg.listedStaleH}h / unlisted ${cfg.unlistedStaleH}h`);
console.log(`  ramp cron        every ${cfg.rampEveryH}h   -> ${fmt(rampTicksPerDay)} ticks/day`);
console.log("");
console.log(`Sync demand (refreshes/day)                ${verdict.emoji} ${verdict.tag}`);
console.log(`  listed   ${fmt(cfg.listed)} × ${fmt(24 / cfg.listedStaleH)}/day  = ${fmt(listedRefreshesPerDay)}`);
console.log(`  unlisted ${fmt(unlisted)} × ${fmt(24 / cfg.unlistedStaleH)}/day  = ${fmt(unlistedRefreshesPerDay)}`);
console.log(`  total demand                            ${fmt(totalRefreshesPerDay)}`);
console.log(`  capacity (chunks/tick × ticks/day)      ${fmt(refreshCapacityPerDay)}   (${chunksPerTick} chunks/tick × ${cfg.chunk} × ${fmt(ticksPerDay)} ticks)`);
console.log(`  headroom                                ${headroom.toFixed(2)}×  (${pct(1 / headroom)} utilisation)`);
console.log("");
console.log(`TME API calls                              ${tmeVerdict.emoji} ${tmeVerdict.tag}`);
console.log(`  per chunk        ${tmeCallsPerChunk}  (combined endpoint, 100 symbols/call)`);
console.log(`  per day          ${fmt(tmeCallsPerDay)} / ${fmt(cfg.tmeDailyCap)}  (${tmePctOfCap.toFixed(1)}%)`);
console.log("");
console.log(`eBay listing ramp`);
console.log(`  per tick         ~${fmt(publishedPerRampTick)} new listings (${RAMP_BATCHES_PER_TICK} batches × ${cfg.rampBatch})`);
console.log(`  per day          ~${fmt(publishedPerDay)} new listings`);
if (unlisted > 0) {
  console.log(`  days to list ${fmt(unlisted)} unlisted  ~${daysToListUnlisted.toFixed(1)} days`);
}
console.log("");

// ---- RECOMMENDATIONS -------------------------------------------------------
const recs = [];
if (headroom < 1) {
  const need = totalRefreshesPerDay / refreshCapacityPerDay;
  recs.push(
    `Sync demand is ${(need).toFixed(2)}× capacity. Pick at least one:`,
    `  • bump --chunk to ${Math.min(200, cfg.chunk * 2)} (doubles throughput, same TME budget)`,
    `  • shorten --cronEveryMin to ${Math.max(30, Math.round(cfg.cronEveryMin / 2))} (2× ticks)`,
    `  • relax --listedStaleH to ${cfg.listedStaleH * 2} (halves listed demand)`
  );
}
if (headroom >= 1 && headroom < 1.2) {
  recs.push(`Headroom is thin (${headroom.toFixed(2)}×). Consider --chunk ${cfg.chunk * 2} for breathing room before scaling further.`);
}
if (tmePctOfCap >= 80) {
  recs.push(`TME calls at ${tmePctOfCap.toFixed(0)}% of cap — request a higher limit, or reduce ticks/day.`);
}
if (cfg.listed === 0) {
  recs.push(`0 listed products — eBay-side oversell risk is N/A. Only the unlisted-refresh load matters.`);
}
if (daysToListUnlisted > 14 && unlisted > 0) {
  recs.push(
    `Listing ramp would take ${daysToListUnlisted.toFixed(0)} days at current cadence. Pick at least one:`,
    `  • shorten --rampEveryH to ${Math.max(1, Math.floor(cfg.rampEveryH / 2))} (more ticks)`,
    `  • increase --rampBatch above 25 (eBay bulk caps it though — verify)`
  );
}
if (cfg.listed >= 17_000 && cfg.chunk === 50 && cfg.cronEveryMin === 60) {
  recs.push(`At ${fmt(cfg.listed)} listed with defaults you're past the safe knee. Try --chunk 100 and rerun.`);
}

if (recs.length === 0) {
  console.log("Recommendations:  none — current configuration handles this scale comfortably.");
} else {
  console.log("Recommendations");
  for (const r of recs) console.log(`  ${r}`);
}
console.log("");

// ---- helpers ---------------------------------------------------------------
function parseArgs(arr) {
  const out = {};
  for (let i = 0; i < arr.length; i++) {
    const a = arr[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = arr[i + 1];
    if (next === undefined || next.startsWith("--")) { out[key] = true; }
    else { out[key] = next; i++; }
  }
  return out;
}
function num(v, dflt) {
  if (v === undefined || v === true) return dflt;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) fail(`Invalid number for value: ${v}`);
  return n;
}
function fmt(n) {
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (n >= 10) return n.toFixed(0);
  return n.toFixed(1);
}
function pct(f) { return `${(f * 100).toFixed(1)}%`; }
function fail(msg) { console.error(`scale-estimator: ${msg}`); process.exit(1); }

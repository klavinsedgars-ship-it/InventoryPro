# InventoryPro — session handover

Written 2026-08-28. Read this first in a new chat; it is the state of the
system, the decisions behind it, and what is still open.

## What this is

An eBay dropshipping CRM for **components_electronics** (eBay.de), sourcing from
**TME** (Polish distributor). Latvian company, ships via Latvijas Pasts.

- Live at **https://inventory-pro-mu.vercel.app**
- Repo `klavinsedgars-ship-it/InventoryPro`, work branch
  `claude/elegant-pascal-h9kNJ`, merged fast-forward into `main`; Vercel deploys
  from `main`
- React + Express + Drizzle, Vercel serverless (`api/proxy.js`, 300s max),
  Neon Postgres (eu-central-1)
- **271 tests, 25 files** — `npx vitest run`, `npx tsc --noEmit -p tsconfig.json`

## Where things stand (2026-08-28)

| | |
|---|---|
| Products | 99,285 (all TME) |
| Listed on eBay | ~39,700 — eBay's own count agreed within 0.3% |
| Orders | 1 (the first sale, 27 Aug, €32.78 to Germany) |
| Listing rate | ~860 published per hourly tick, ~1% failures |
| Neon | Launch plan, metered (~$0.35/GB-month, $0.106/CU-hour) |

Target is 200,000 listings.

## How it runs

Crons in `vercel.json`:

```
daily-sync     0 * * * *          TME price/stock sweep
list-ramp      3,18,33,48 * * * * publishes new listings (4x/hour since the
                                  Taxonomy limit rose to 100k/day; ~3,400/h ceiling)
orders         5 * * * *          pulls eBay orders
messages       40 */2 * * *       pulls buyer messages
maintenance    50 3 * * *         prunes old rows, trims message bodies
recategorize   */10 * * * *       category-repair sweep slices (no-op unless enabled)
```

Every job takes a **lease** (`server/job-lease.ts`) so it cannot run twice.
Deploys are safe mid-run: Vercel finishes in-flight invocations on the old code,
and every job is resumable from database state. See `DEPLOY_SAFETY.md`.

## Decisions worth not re-litigating

**Shipping is untracked.** Tracking costs €2.54/parcel; self-insuring (reposting
the rare lost order) breaks even around a 30% loss rate. `SHIP_TRACKED=true`
flips it. Postage comes from the real Latvijas Pasts tariff table
(`shared/latvian-post.ts`), by weight band and destination.

**VAT is charged at the DESTINATION rate** (OSS): 19% for Germany, not 21% for
Latvia. Bought from TME at 0% under reverse charge, so there is **no input VAT
to offset** — the full collected amount is payable. Profit is therefore measured
on NET revenue. `shared/vat-rates.ts`, `shared/order-economics.ts`.

**TME's DANGEROUS status blocks listing.** Liquids, aerosols, flammables:
Latvijas Pasts will not carry them. `TME_ALLOW_DANGEROUS=true` reverses it.

**Blocked products live in their own table** (`blocked_products`), not as a flag
on the product — a catalogue import recreates product rows, so a flag would be
wiped. Blocking also ends the live eBay listing and skips the code at import.

**Messages come from `GetMemberMessages`, not `GetMyMessages`.** The latter
returns eBay's notification *emails* — a whole HTML document around one
sentence. This was the last thing changed and is the least proven; see below.

## Open items

1. **VERIFY THE MESSAGING REBUILD.** Press "Sync from eBay" and check the
   giorgio thread reads as a real exchange. Threads created from the old source
   have different message ids, so **duplicates may appear** — a cleanup for
   notification-derived threads that now have a conversation equivalent was
   offered and not built.
2. **eBay account verification** — red banner, deadline **24 Sept 2026**.
   Account-level restriction risk; nothing in the CRM protects against it.
3. **Needles were removed under eBay's medical-devices policy.** 36 codes
   blocked. The "Find everything like it" search on the Blocklist page has
   presets (DANGEROUS, needles, liquids, batteries) — the sweep was not
   confirmed as done.
4. ~~eBay Taxonomy limit~~ **RESOLVED 2026-08**: the Application Growth Check
   passed — Taxonomy limit raised 5,000 → **100,000/day** for the production
   App ID. Taxonomy is no longer the binding constraint on the ramp; nothing
   in code assumed the old number, so no changes were needed. STILL OPEN from
   the same application: whether `buy.marketplace.insights` was granted (it
   gates the Repricing/Opportunities features) — check the developer portal.
5. **Reconcile has never completed.** ~199 pages at 200 listings; it runs in
   time-bounded slices — call it, then follow `nextPage` until null.
6. **`BYPASS_AUTH=true` is still set** in production. The user asked not to be
   nagged about auth, but it means the login page gates nothing.
7. Postage is priced from the tariff book, not from carrier invoices; orders
   whose products lack a weight are flagged as possibly under-charged.

## Category incident (2026-08-28)

Two buyers reported listings in absurd categories (a ball latch and a spacer
sleeve under musical-instrument categories). Root cause: the resolver took
eBay's FIRST Taxonomy text suggestion for the TME category name, unvalidated,
and cached it per TME category — one bad hit miscategorised every product in
that category. Fixed by a domain guard (`isImplausibleCategoryPath`,
`pickPlausibleSuggestion` in `server/ebay-category-query.ts`): implausible
suggestions are skipped in favour of the next plausible one, else the learned
catch-all. The suggestion cache was version-bumped (`suggest2:`) so every
category re-resolves through the guard; v1 rows remain as evidence.
`products.ebay_category_id` now records each listing's category at publish.

```
/api/__category-map            damage report: TME category → eBay category, listed counts, flagged
/api/ebay/recategorize         ?category=<TME cat> or ?sku=<SKU>; dry-run unless &confirm=1;
                               &limit=25..100 per slice; repeat until remaining is 0
```

The live damage report showed the blocklist alone was not enough (screws under
fishing bait via "Angelsport", crocodile clips under model airplanes, LEGO):
when a suggestion carries its ancestor chain, the ROOT must also be in a small
allowlist (`isPlausibleRoot`) — Business & Industrie, Heimwerker, Computer,
TV/Video, Handys, Foto, Auto & Motorrad, Möbel & Wohnen, Bürobedarf.

Remediation is a catalogue-wide SWEEP (`server/recategorize-sweep.ts`): every
live listing is re-filed in place through the guarded resolver (offer PUT —
item numbers survive, no unlist/relist), provably-miscategorised categories
first. House pattern: `/api/cron/recategorize` every 10 min, DB kill-switch
`recategorize_sweep`, lease, convergence in products.ebay_category_id,
failures parked under an `ebay_listing_error` marker so they never loop.

```
/api/__category-map?resolve=1          fills guardedCategory (1 cached Taxonomy call/category), adds `changed`
/api/ebay/recategorize?sweep=start     enable sweep (&run=1 = first slice inline); stop | status
```

SWEEP COMPLETED: 45,526 listings verified/re-filed (98%), 860 parked with
individual errors (ebay_listing_error LIKE 'recategorize: %') — triage via
/api/ops/list-ramp/failures; expect mostly GPSR manufacturer-contact blocks
(eBay 25019, an EU-compliance task of its own) . The transition trick that
made moves work: eBay validates an inventory-item write against the LIVE
offer's category, so recategorizeOne merges old+new aspects, moves the
offer, then cleans up (see recategorizeOne). New ramp listings resolve
through pins → guard → fallback and record ebay_category_id at publish.
19 operator pins live in marketplace_settings 'category_override:*'
(GET/POST /api/ebay/category-overrides).

## Margin correction (2026-08-31)

Two real orders showed the profit floor undershooting its EUR 4 target: the
floor's fee assumption (12% + 0.35) was ~half of eBay's actual take (~21% of
gross — ad fees / category FVF), and order snapshots recorded TME's per-piece
price instead of the pack cost (fixed; backfill:
`/api/__fix-pack-cost-snapshots?confirm=1`). Levers, all data-driven:

```
GET  /api/ebay/fee-config     resolved config + MEASURED actual fee % from orders
POST /api/ebay/fee-config     set fvfPct/fixedFee/vatPct/packagingCost/postageMarkup/targetMinNetProfit
/api/ebay/reprice?sweep=start re-floor the whole catalogue with current config,
                              push changed prices to live listings (cron
                              /api/cron/reprice, cursor-resumable, self-stops;
                              manual prices useCalculatedPrice=false untouched)
```

Order of operations: measure via GET, set config (fee evidence, VAT worst-case
~0.25 for OSS), then start the reprice sweep.

## XML feed distributors (Getic, Green Cell)

Staging built 2026-08-28 for Getic, promotion 2026-09-02, generalized the
same day when Green Cell arrived. **One engine serves every XML
distributor** (`server/supplier-feed-sync.ts`): adding one is a config entry
in `FEED_SUPPLIERS` (supplier code, URL slug, display name, feed URL) plus a
route in `App.tsx`, a sidebar link, a `vercel.json` cron line, and — once
promotion is wanted — the code in `LISTING_SUPPLIERS`. Feeds import into
**`supplier_offers`** (keyed by `supplier`), NOT `products`. Feed schemas
are unknown up front, so the parser discovers the record element and maps
fields by name heuristics (`server/xml-feed.ts`, `server/getic-feed.ts` —
generic despite the name; both pure, both tested); every record's full JSON
is kept in `raw`, and the probe shows which feed key each field was read
from.

**Promotion** (`server/supplier-promote.ts`) is the one door out of staging:
selected offers become `products` rows (`supplier=<code>`,
`moq=1/multiples=1`, category `"Electronics"` → Taxonomy resolves by product
NAME at listing time, floor-priced `salePrice` via `calculatePriceWithFloor`).
Skipped with reasons: already promoted, blocked SKU, SKU collision, EAN
already carried (never list the same physical item twice), no usable price,
**non-EUR currency** (the whole pricing pipeline is EUR; unstated currency is
taken as EUR). Offers get stamped `promoted_product_id`/`promoted_at`.
`LISTING_SUPPLIERS` (`shared/suppliers.ts`) = TME, GETIC, GREENCELL; the TME
v2 shippability guard applies only to `supplier='TME'` rows.

**Freshness:** every successful real import ends by refreshing that
supplier's promoted products (stock + price from the feed, floor reprice
unless `useCalculatedPrice=false`, changed listed prices pushed to eBay).
Per-supplier hourly crons (`/api/cron/getic-import` :24,
`/api/cron/greencell-import` :42) are self-gated — no-ops until that
supplier has promoted products, so pure staging costs no hourly fetches.

Endpoints, identical per supplier under `/api/getic/*` and `/api/greencell/*`:

```
GET  probe          fetch the feed, show structure + mapping — writes nothing
POST import         ?dryRun=1 = sample without writing; real run lease-guarded,
                    ends by refreshing promoted products
POST promote        {ids:[...]} or {all:true, filter:{...}} — lease-guarded,
                    time-bounded (partial result carries `remaining`)
GET  status         import history + coverage counts (incl. promoted)
GET  offers         paginated browse: search/category/manufacturer/priceMin/
                    priceMax/promoted=yes|no/inStockOnly/sort
                    (also /offers/:id, /categories, /manufacturers)
GET  overlap        SKU/EAN collisions with the live products table
```

UI: one parameterized page (`client/src/pages/supplier-browser.tsx`) mounted
as **Getic Browser** and **Green Cell Browser**; the Products page
Distributor filter has TME / Getic / Green Cell / Manual.

Per-supplier notes:
- **Getic** (`https://api.getic.com/xml/rentbox/xml`, override
  `GETIC_FEED_URL`): feed has NO product-code field → **EAN used as SKU**
  (MPN second choice); no category/weight/MOQ/currency — prices assumed EUR
  and possibly RETAIL, spot-check margin against a real invoice before bulk
  promotion.
- **Green Cell** (b2b portal XML, PrestaShop-style; the default URL embeds
  the portal's `secure_key` — rotate via `GREENCELL_FEED_URL` env var
  without a deploy). Schema unseen at build time (sandbox egress blocks the
  host): run probe + dry-run after deploy. The mapper already prefers
  `wholesale_price` over `price` and knows `reference`/`ean13`/`quantity`.
  CHECK THE CURRENCY in the probe — if the portal serves PLN unstated, the
  EUR assumption would misprice; a stated non-EUR currency is refused by
  the promotion guard.

First deploy of any new feed: probe → check mapping → dry-run → import →
promote a handful → verify price/category on eBay → bulk. If record
detection guesses wrong, `?record=<element>` overrides it.

## Diagnostics (all read-only unless noted)

```
/api/__system-check        schema, TME version, env inventory
/api/__data-integrity      duplicate SKUs, listing ids, count sanity
/api/ops/storage           row counts and size per table
/api/__ebay-rate-limits    eBay's own view of limits and usage
/api/__ramp-block-check    why listing candidates are blocked
/api/ops/list-ramp/failures  failures grouped, one full error each
/api/__default-category    the learned fallback eBay category
/api/cron/list-ramp?maxBatches=1   THE post-deploy checkpoint
```

## Working style that has paid off here

- **`?maxBatches=1` after every deploy.** It caught every regression in the
  listing pipeline; the unit tests never could, because none of them execute
  SQL against the real database.
- **Diagnose before fixing.** Several bugs were only found by building an
  endpoint that dumped the raw upstream response — guessing cost two rounds on
  the eBay 25733 error before that lesson landed.
- **Distinguish "no data" from "the request failed".** A blank Reports page and
  a silent 500 looked identical until error states were added.
- Verify claims against primary sources; the user pushes back hard and
  correctly when something is asserted without evidence.

## Recent history

`git log --oneline -40` reads as a narrative: the outage and database rebuild,
TME v2 migration, the listing pipeline (EAN → retry stall → shippability guard →
Taxonomy throttling), financial reporting, the blocklist, then messaging.

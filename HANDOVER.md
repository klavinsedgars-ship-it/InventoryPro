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

**Images:** the mapper collects the whole gallery (primary → `image_url`,
rest → `additional_images` JSON), including PrestaShop-style nesting where
the URL sits under a generic child (`<images><image><url>`) — image fields
are claimed BEFORE the product-URL synonym match, or that generic `url` leaf
would be mis-read as the product link. The browser shows a +N badge and a
gallery in the offer detail; promotion copies the gallery to
`products.additional_images`, and the eBay lister sends primary + gallery
(≤24) — only the primary goes through watermark removal (TME-only concern).

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

## Amazon (SP-API) — foundation, not yet live

Built 2026-09-08, before credentials existed; everything degrades gracefully
until they do (`/api/amazon/status` reports which env vars are missing).

**Strategy: offer-only listings on EXISTING ASINs.** We resell branded goods,
so we attach an offer to the manufacturer's existing Amazon page rather than
create ASINs (which needs brand ownership or a GTIN exemption and full
product-type attributes). Consequence: **a product with no EAN can never be
listed on Amazon** — there is nothing to attach to. Matching EAN→ASIN is
therefore the gate before any listing.

Auth is **LWA only** — AWS IAM / SigV4 has not been required since
2023-10-02, so there is no AWS SDK and no request signing. Rate limits are
per operation (token bucket in `amazon-sp-api.ts`); a 429 is `transient` and
never burns a listing attempt, the lesson from the eBay Taxonomy incident.

```
server/amazon-config.ts    endpoints, EU marketplace ids, env, readiness report
server/amazon-sp-api.ts    LWA token cache, rate-limited request, catalog/listings ops
server/amazon-listing.ts   PURE + tested: preflight, offer payload, ASIN picking
server/amazon-matcher.ts   EAN→ASIN sweep (cursor, lease, kill-switch, self-stopping)
server/routes/amazon.ts    status/test-connection/match/preview/list/sync-offer
client/src/pages/amazon.tsx  readiness + match coverage + per-SKU tools
```

```
GET  /api/amazon/status          readiness + match coverage (works unconfigured)
GET  /api/amazon/test-connection Sellers API — no restricted role needed
GET  /api/amazon/match?sweep=start|stop|status
POST /api/amazon/match/<sku>     match one product
GET  /api/amazon/preview/<sku>   the payload we WOULD send — pure, no API call
POST /api/amazon/list/<sku>?dryRun=1   mode=VALIDATION_PREVIEW: Amazon validates,
                                 creates nothing. THE post-credential checkpoint.
POST /api/amazon/sync-offer/<sku>  patch price+quantity on a live listing
GET  /api/cron/amazon-match      :12,:32,:52 — gated on config + sweep enabled
```

Match outcomes recorded per product (`amazon_match_status`): `matched`,
`no_ean` (permanent), `no_asin`, `ambiguous` (needs a human), `error`
(retried). Settled states are not re-queried, so the sweep converges.

**Deliberately NOT built yet:** a bulk Amazon ramp. First listings go one at a
time through `?dryRun=1` — same "look first, then ramp" order the eBay
pipeline earned the hard way.

Env vars: `AMAZON_LWA_CLIENT_ID`, `AMAZON_LWA_CLIENT_SECRET`,
`AMAZON_LWA_REFRESH_TOKEN`, `AMAZON_SELLER_ID`, optional
`AMAZON_MARKETPLACE` (default DE), `AMAZON_SP_API_REGION` (eu),
`AMAZON_SP_API_SANDBOX`, `AMAZON_SHIPPING_GROUP`.

**Business blockers that are not code** (see the operator checklist): Amazon's
dropshipping policy requires we are the sole seller of record on every
packing slip and invoice — supplier-direct shipping with supplier paperwork
is a suspension risk; EU EPR registrations (LUCID packaging, WEEE/EAR,
batteries) are legally required before the first sale into Germany.

## Postage: real receipts vs the model (2026-09-10)

Two Latvijas Pasts counter receipts (2026-09-08, 2026-09-09; 16 shipments,
EUR 73.08) were checked against the tariff estimate. Result:

- **The Sīkpaka table is exactly right** — all 9 receipted small packets
  matched to the cent (SE 34g 5.16, DK 33g 5.39, DK 9g 5.35, RO 77g 4.13,
  DE 9/16/18g 5.03, DE 34/73g 5.08), and the tracking surcharge billed as
  exactly 2.54. No corrections needed there.
- **Letters were being priced as small packets.** Korespondence is a flat
  international rate — 3.00 up to 20g, 3.85 to 100g, plus a 0.06 marking fee —
  regardless of destination. Ireland at 3.06 against a 6.29 Sīkpaka is less
  than half. Five of the sixteen shipments went this way.
- **Latvia had no row at all**, so domestic orders were priced at the
  unlisted-destination fallback (6.37 against a real 3.56).

Net: the model overstated postage by EUR 11.68 across those 16 shipments
(14%), so profit on them was understated by about the same. The one tracked
parcel went the other way — modelled untracked, so understated by 2.54.

**Actual beats modelled.** `orders.actual_postage_cost` now holds the
receipted figure and the P&L prefers it; the ledger line says which it used
and `fullyActual` demands a receipt, not an estimate. The tariff estimate
remains the fallback for every order without one.

```
POST /api/postage/receipt/parse   paste the receipt, see proposed matches, writes NOTHING
POST /api/postage/receipt/apply   record confirmed costs ({reference, assignments:[{orderId,cost}]})
GET  /api/postage/coverage        how much of the P&L is receipted vs modelled
```

Matching is by tracking number first (exact), then recipient name + country,
and NEVER between two orders sharing a recipient — those are offered as
alternatives for a human to pick. Note the printed line number is **not
unique** on a receipt (a real one carried two lines numbered 2512), so lines
are identified by position. UI: **Postage** page.

Still modelled, not receipted: the profit floor in `calculatePriceWithFloor`
prices postage as a small packet. For light items actually posted as letters
that is conservative by ~2 EUR an order — real margin on those is better than
the floor assumes, and there is pricing headroom there if it is ever wanted.

## Static-IP proxy for whitelisted suppliers (2026-09-10)

ACC Distribution — and B2B distributors generally — only accept API calls from
an IP they have whitelisted. Vercel functions egress from a rotating pool, so
there is no address to give them. Fix: a small VPS (netcup, ~2 EUR/month)
running tinyproxy, with only the suppliers that need it routed through it.

**The trap:** Node's global fetch does NOT honour HTTP_PROXY/HTTPS_PROXY.
Setting them looks like it works and silently changes nothing — a dispatcher
must be passed explicitly. `server/http-proxy.ts` builds one from
`FEED_PROXY_URL` (cached, since it holds a connection pool).

Opt-in per supplier via `useProxy` on the feed config, so a proxy outage
cannot take down feeds that never needed one. A supplier marked `useProxy`
with no `FEED_PROXY_URL` set fails with that sentence rather than a bare 403.
`AMAZON_USE_PROXY=true` does the same for SP-API (off by default — Amazon
does not whitelist).

```
GET /api/suppliers/proxy-check   is the proxy up, and WHICH IP do suppliers see?
```

That endpoint is the one to run before asking any distributor to enable
access: a whitelist is granted for one address, and finding out it is wrong
here beats finding out from their 403. It never echoes the proxy password.

## eBay quantity cap: 2 → 1 (2026-09-16)

**Why.** eBay's selling limits are denominated in ITEMS, not listings — the
quantity on every live listing draws on the same monthly allowance. Showing two
of everything costs twice the allowance per listing, so the cap decides how
much of the catalogue can be online at once. Halving it roughly doubles
coverage under the same limit.

**What it costs — measured, not assumed.** A buyer can no longer put two of the
SAME part in one basket. `/api/ops/basket-mix` exists to price that, because
order-level unit counts cannot: four different parts and four of the same part
both read as "4 units", and only the second is lost to a cap of 1.

Measured 2026-09-16 over the 13 days of order history then present:

| | |
|---|---|
| Order lines | 33 |
| Lines where one buyer took 2 of the same item | **10 (30%)** |
| Units sold | 43 → would have been 33 |
| Max quantity on any line | **2** — i.e. exactly the cap |
| Gross revenue from the second units | €241.80 |

The second unit on a line is the most profitable unit in the business: postage
and eBay's fixed fee are already paid by the first. At €4.51 net for a 1-unit
order and €13.51 for a 2-unit order, those ten second-units are worth roughly
€90–100 per fortnight — about 40% of the €237/fortnight contribution. Every one
of the ten sat between €15.98 and €43.98; the cheap components sell singly.

`max_line_quantity` landing exactly on the cap, with ten lines piled there and
none above, is what a censored distribution looks like. Suggestive, not proof.

**The decision (2026-09-16): blanket cap at 1 anyway**, taken by the operator
with these figures in hand, to unlock full catalogue coverage under eBay's item
allowance. A price-banded cap (1 below ~€15, 2 above) was offered as the
version that keeps the multi-unit revenue and was declined. Re-run
`/api/ops/basket-mix` after a few weeks: if orders and units do not make up the
difference, `action=apply&target=2` reverses it.

Note the cap alone changes nothing about coverage — it only frees allowance.
The listing ramp has to spend it (`POST /api/ops/list-ramp/resume`).

**The number lives in `shared/stock-policy.ts`**, because three places must
agree: the `products.ebay_stock_limit` column default, the runtime fallback in
`calculateEbayStock`, and the quantity sweep's default target.

**Changing the database is instant; changing eBay is not.** The hourly sync
only revisits a product when TME's price or stock MOVES, so without a
deliberate pass most of ~88k live listings would keep quantity 2 indefinitely.
Hence `server/quantity-sweep.ts`, the same shape as reprice-sweep: cron-driven
time-bounded slices, kill-switch `'ebay'/'quantity_sweep'`, lease, resumable
cursor `'ebay'/'quantity_cursor'`, self-disabling at the end.

```
GET /api/ebay/quantity?action=status         where the pass is
GET /api/ebay/quantity?action=apply&target=1 set the cap on every row (instant)
GET /api/ebay/quantity?action=start&run=1    push it to live listings
GET /api/ebay/quantity?action=stop           halt, keeping the cursor
GET /api/cron/quantity                       the tick (:09, :29, :49)
```

apply and start are separate deliberately: apply changes what we believe and
what future listings go up with; start rewrites ~90k live listings on eBay.

Two things to know before touching it:

- **The sweep only visits listings the cap actually binds** (`stock > target`).
  A product with one unit in stock already shows 1 whatever the cap says, and
  re-pushing it would spend eBay API budget writing the same number back.
- **`overCap` in the progress output does not shrink as the sweep runs.**
  Nothing records what was already pushed, and stock stays above the cap after
  the push. `remaining` — what is still beyond the cursor — is the honest
  progress number.
- **`remaining` falling is NOT evidence that eBay accepted anything.** The
  cursor advances whether a push succeeded or failed, so a pass where every
  single write was rejected looks identical to a healthy one. `pushedToEbay` /
  `pushFailed` / `lastErrors` in the progress output are the counters that
  actually answer it; they are persisted per batch because each slice is a
  separate function invocation whose in-memory stats die with it.
- **`apply` counts rows off-target either side of its UPDATE** rather than
  trusting `rowCount`, which drizzle's `db.execute` does not reliably surface —
  an UPDATE has no RETURNING rows to fall back on, so a missing count reads as
  a confident "0 rows changed" on a statement that rewrote the catalogue.
  `capDistribution` in the progress output shows what the column really holds.

Reversible: `action=apply&target=2` then `action=start` puts it back.
Products with `use_stock_limit = false` are the operator's explicit "sell as
many as we have" and are never touched by either step.

## ACC Distribution (2026-09-15)

The third staged distributor, and the first that is an API rather than a feed
document. Consumer electronics out of Lithuania — a different catalogue shape
from TME's components.

**Transport.** `POST https://api.accdistribution.net/v1/<Method>`, JSON, body
`{"request": {...}}`. Auth is a **LicenseKey inside the body**, not a header —
so a request body must never be logged. Methods used: `GetProducts` (paged
list), `GetProduct` (detail, the only place parameters live), and
`GetTreeBranches` (the category tree, so a branch id becomes
"Computers > Storage" rather than a bare leaf name).

**Their throttle shapes the importer.** 300 requests/minute overall, but
`GetProducts` separately refuses *identical* requests inside a 15-minute
window ("Repeated requests not allowed"). Paging is safe because each page
differs by Offset; re-running the same import twice is not. The client
reports it as `throttled` rather than `transient` — the distinction matters,
because retrying a throttle refusal in-process is guaranteed to fail again,
while a transient one is worth another go immediately.

It bit the probe first: always asking for offset 0 made a diagnostic that
could only be run once a quarter of an hour. It now picks a random offset per
run (override with `?offset=`), which sidesteps the rule and samples a
different corner of the catalogue each time. The daily delta cron is immune
for the same reason — its `updatedAfter` timestamp is computed per call, so no
two requests are identical.

**Layout:**

| File | What it is |
|---|---|
| `server/acc-api.ts` | Client. Proxy-forced, per-minute budget, never throws for an API-level failure. |
| `server/acc-map.ts` | Pure: ACC product JSON → the same `NormalizedOffer` the XML feeds produce. |
| `server/acc-sync.ts` | Paged, time-bounded, resumable import into `supplier_offers`. |

Everything downstream — browsing, promotion, the listing ramp, repricing — is
the code that already existed; ACC reaches it because its rows land in the same
staging table. `ACC` is in `LISTING_SUPPLIERS`, so promoted rows are *allowed*
to list; promotion itself is still per-offer and manual.

Three things that will bite whoever touches this next:

- **There is no weight in ACC's product list. None.** Not in `GetProducts`, not
  as a first-class field in `GetProduct`. Postage is the largest single cost
  line in this business, so a promoted ACC product with no weight is priced
  against the shipping model's fallback, not against what the parcel will
  actually cost. `pickWeightGrams()` recovers one from `GetProduct`'s parameter
  list where the vendor publishes it, and **refuses a bare number with no
  unit** — 2 could be kilograms or grams, and guessing is a 1000× error on the
  one input that decides whether an order makes money. The import result and
  the UI both report how many offers arrived weightless. Fix this before
  listing anything heavy.
- **Picture URLs are incomplete, and arrive over http.** `Picture` and
  `Medias[].Uri` are directories; a size must be appended (`/440x440.png` — the
  largest size guaranteed to exist; 1920 only exists where the source TIFF was
  bigger). Fetched as returned, they 404. Live responses also use `http://`
  despite the documentation showing https, which the CRM (served over https)
  blocks as mixed content — `accImageUrl` upgrades the scheme.
- **`GetProducts` carries no `Medias` array** — only the single `Picture`. A
  bulk import therefore yields one image per product; the gallery needs
  `GetProduct` per item.
- **ACC validates the parameter SET, not just the values.** `GetTreeBranches`
  accepts LicenseKey, Locale and CompanyId — and sending it `Currency` as well
  is HTTP 400 `"parameters : An error has occurred."`, not a silently ignored
  extra. `ACC_METHOD_PARAMS` in `server/acc-api.ts` says which common
  parameters each method takes; a method not listed gets the conservative set,
  because adding an unknown parameter fails hard while omitting an optional one
  merely takes ACC's default.
- **`QuantityPacking` is a carton size, NOT a minimum order.** Settled
  2026-09-17 in ACC's own basket: PID 003192 (Digitus patch cord) reports
  `QuantityPacking: 250`, and the portal accepts a quantity of 1 at €0.38.
  A promotion guard that skipped these was briefly added and then removed —
  the unit price is the unit price. The value is still kept in `attributes`
  because a 250-piece carton may yet matter for shipping.
- **Weights are in `GetProduct`, not `GetProducts`.** The bulk list carries no
  weight at all; the per-product detail call carries five of them. For PID
  003192:

  | Parameter | Value | What it is |
  |---|---|---|
  | Net weight | 0.0216 kg | the item |
  | **Gross weight** | **0.0272 kg** | **the item as posted — use this** |
  | Net weight master carton | 5.4 kg | 250 pieces |
  | Tare weight master carton | 0.207 kg | the empty carton |
  | Tare weight (kg) | 0.0056 kg | the item's own wrapper |

  They are internally consistent (net + tare = gross; 250 × net = carton net),
  and ACC's own basket bills shipping on **gross** — `Svars 0.027 kg`. So
  `pickWeightGrams` prefers gross and keeps net only as a fallback for products
  that publish no gross figure. Four of those five numbers would be wrong, one
  of them by 200×, so the packaging names are excluded explicitly — including
  **tare**, which contains none of the obvious packaging words.

  `MeasureFraction` is 0.001 on every weight parameter and must NOT be applied:
  `MeasureAbbr` already says kg, and multiplying would turn 27 grams into 27
  micrograms. It appears to be display precision.

  Consequence for the importer: a bulk catalogue import yields no weights.
  Getting them means one `GetProduct` per item — 80 minutes of their request
  budget for all 25,000, seconds for the handful actually promoted. So
  `server/acc-weights.ts` runs at **promotion**, not as a catalogue sweep, and
  writes each answer back to `supplier_offers.weight_g` so it is paid for once.

  **Promotion refuses an ACC offer with no weight** (`noWeight`). This is not
  caution for its own sake. `fee-model.ts` prices an unknown weight as
  `(weightGrams ?? 0) + packaging` — the cheapest postal band there is — so a
  weightless product is not "priced conservatively", it is a multi-kilo parcel
  priced as a letter. Feed suppliers (Getic, Green Cell, TME) are deliberately
  left on the old behaviour: their weights arrive with the catalogue, and
  changing what they do is a separate decision. **That `?? 0` is a live
  exposure for every weightless product already in `products`** — worth a
  deliberate look, separately from ACC.
- **A cursor belongs to one query shape.** A full-catalogue run and a filtered
  run (daily `updatedAfter` delta, or one branch) walk completely different
  result sets. Runs are tagged in `record_element`, and only full runs carry a
  resumable cursor — without that, a delta would resume a full import at an
  offset past the end of its own short result set and silently declare the
  catalogue complete.

**Confirmed against the live API on 2026-09-16** (demo key, through the
whitelisted proxy — `server/acc-map.test.ts` holds the captured response):
the list envelope is `Products`; `Picture` really is a bare directory;
there is no weight field on any product; `Price.Value` is the cost and
`Price.LatgaValue` is the price *including* the levy, while the product-level
`LatgaValue` is the levy itself (confusing the two misstates cost). The live
response also carries fields the specification never documented —
`VisibleInB2B`, `Readonly`, `QuantityPacking`, `FullPackageShipping`,
`CourierShippingIsForbidden`, `DacPrice`, `ProductDimensions` — all kept in
`attributes`. `ProductDimensions` has been empty on every product seen so far,
so its shape is unknown and it is stored verbatim rather than parsed; it is the
most likely home for a weight if one exists.

Data quality is uneven: one of the first two live products was named
"Vogels | Maximum weight (capacity) 10 kg  kg". Titles like that must not
reach eBay unedited.

A sampled page also showed two of three products at zero stock with
`ByOrder: true` (Epson consumables). If that ratio holds, the sellable
catalogue is much smaller than the headline count — check `in_stock` against
`total` on `/api/acc/status` after the first import before judging ACC.

**What ACC actually has to give you is one thing: the licence key.** Checked
against the specification twice, because it is easy to assume otherwise:

| | Spec | Where it comes from |
|---|---|---|
| `LicenseKey` | §3.4, Occurs **1** — required on every call | An ACC **sales manager** issues it. It is an API credential and does NOT appear in the B2B portal. |
| `CompanyId` | Occurs 0…n — optional | **Not a credential.** §4 publishes the complete list: `_al` = ACC Distribution, `_xl` = Avad Baltic. Nothing to request. |
| `Locale`, `Currency` | Occurs 0…n — optional | Our defaults (`en`, `EUR`). |
| IP address | §3.1 | "All clients should send their IP address to their ACC Distribution manager before using the API." Done — 202.61.250.153. |

`ACC_COMPANY_CODES` in `server/acc-api.ts` encodes the two published codes and
`describeAccConfig()` rejects anything else, because a typo there would not
fail — it would quietly return a different company's catalogue, or none.
`describeAccConfig().needs` lists exactly what is still missing, so the answer
to "what do I have to get from them" lives in the API rather than in a memory
of this conversation.

**Environment:** `ACC_LICENSE_KEY` (required), `ACC_COMPANY_ID` (default
`_al` — leave it alone), `ACC_LOCALE` (`en`), `ACC_CURRENCY` (`EUR`),
`ACC_BASE_URL`. Requests go through `FEED_PROXY_URL` and **fail** without it,
because ACC whitelists one address and going direct means a rejection whose
reason is invisible from here.

Their specification publishes a demo key, `498ec72c-e8e7-48f2-b300-d95666aeb141`
— a real production account with **every stock figure capped at 1**. Useful for
seeing the shape of the data; mistaking it for real stock would look like a
catastrophic collapse. The UI badges it in red when that key is in use.

```
GET  /api/acc/probe    connection, branch tree, 3 products raw + mapped
GET  /api/acc/probe?offset=1200             sample a specific slice
POST /api/acc/import?dryRun=1&limit=25      map a page, write nothing
POST /api/acc/import                         a slice; repeat while nextOffset
POST /api/acc/import?offset=0                force a full re-walk
GET  /api/cron/acc-import                    hourly; 2-day updatedAfter delta
```

The cron only runs once something is promoted, same posture as the other
distributors: while the catalogue is pure staging, the operator imports by hand.

## Order search (2026-09-12)

`/api/orders` used to accept `search` and match it against three columns
(marketplace order id, buyer username, shipping name), and the Orders page
never sent it — it fetched every order and filtered them in the browser. So
the only reliable way to find an order was its order number.

Search is now server-side and spans the item lines:

| Scope | Columns |
|---|---|
| Order number | `orders.marketplace_order_id` |
| Part no / SKU / EAN | `order_items.sku`, `order_items.tme_product_id`, `order_items.marketplace_item_id`, `products.sku`, `products.supplier_product_id`, `products.ean` |
| Item title | `order_items.title`, `products.name` |
| Buyer | `orders.buyer_username`, `buyer_email`, `shipping_name` |
| Address | both address lines, city, postal code, country |
| Tracking number | `orders.tracking_number` |

Plus non-text filters: marketplace, destination country, and an order-date
range. `Everything` (the default) searches all of the above at once.

Three things worth knowing before changing it:

- **The item columns are reached through a subquery, not a join.** An order
  with four lines must appear once, not four times, so the condition is
  `orders.id in (select order_id from order_items left join products ...)`.
  The join to `products` is a LEFT join on purpose — an item whose
  `product_id` never got mapped still matches on its own sku/symbol.
- **Identifier columns are matched twice**: as typed, and with every
  non-alphanumeric stripped from both sides
  (`regexp_replace(col, '[^A-Za-z0-9]', '', 'g')`). That is what lets
  `NE 555 P` find `NE555P` and a de-hyphenated paste find `12-34567-89012`.
  `compactIdentifier()` in `shared/order-search.ts` must strip exactly the
  same character set or the fallback silently stops matching.
- **`getOrdersCount` takes the same filter object as `getOrders`.** It used
  to accept only marketplace/status, so a searched page reported the
  unfiltered total. If you add a filter, add it to `orderFilterConditions`
  and both get it.

The matching SQL lives in `server/order-search-sql.ts`, deliberately free of
any `db` import so `orderFilterConditions()` can be rendered to SQL and
asserted in `server/order-search-sql.test.ts` — the generated query is
checked offline rather than only observed against Neon. The scope list is in
`shared/order-search.ts` so the dropdown and the server cannot drift.

Performance: these are `ilike '%…%'` scans with no supporting index. At the
current scale (hundreds of orders, low thousands of items) that is nothing.
If the orders table reaches six figures, the fix is a pg_trgm GIN index on
the identifier columns, not a narrower search.

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

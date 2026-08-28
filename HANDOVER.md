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
daily-sync     0 * * * *      TME price/stock sweep
list-ramp      30 * * * *     publishes new listings to eBay
orders         5 * * * *      pulls eBay orders
messages       40 */2 * * *   pulls buyer messages
maintenance    50 3 * * *     prunes old rows, trims message bodies
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
4. **eBay Taxonomy is the binding API limit**: 5,000/day, ~2,200 used. An
   Application Growth Check was being filled in to raise it to 25,000 and to
   request `buy.marketplace.insights`. Prerequisites are built:
   `/api/ebay/account-deletion` (needs `EBAY_DELETION_VERIFICATION_TOKEN` and
   `EBAY_DELETION_ENDPOINT_URL` set, then registered with eBay).
5. **Reconcile has never completed.** ~199 pages at 200 listings; it runs in
   time-bounded slices — call it, then follow `nextPage` until null.
6. **`BYPASS_AUTH=true` is still set** in production. The user asked not to be
   nagged about auth, but it means the login page gates nothing.
7. Postage is priced from the tariff book, not from carrier invoices; orders
   whose products lack a weight are flagged as possibly under-charged.

## Getic (second distributor, staging only)

Added 2026-08-28. The Getic XML feed (`https://api.getic.com/xml/rentbox/xml`,
override with `GETIC_FEED_URL`) imports into **`supplier_offers`** — its own
staging table, NOT `products`. Nothing there can reach the listing ramp, TME
sync, or eBay; promotion into `products` deliberately does not exist yet.
The feed's schema was unknown when this was built, so the parser discovers the
record element and maps fields by name heuristics (`server/xml-feed.ts`,
`server/getic-feed.ts` — both pure, both tested); every record's full JSON is
kept in `raw`, unconsumed fields in `attributes`, and the probe endpoint shows
which feed key each field was read from. UI: **Getic Browser** page.

```
GET  /api/getic/probe      fetch the feed, show structure + mapping — writes nothing
POST /api/getic/import     ?dryRun=1 = sample without writing; real run is lease-guarded
GET  /api/getic/status     import history + coverage counts
GET  /api/getic/offers     paginated browse (also /offers/:id, /categories)
GET  /api/getic/overlap    SKU/EAN collisions with the TME catalogue
```

First deploy: run the probe, check the mapping reads sensibly, dry-run, then
import. If the record detection guesses wrong, `?record=<element>` overrides it.

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

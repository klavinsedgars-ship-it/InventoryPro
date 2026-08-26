# Deploying while the CRM runs 24/7

The system runs unattended: an hourly listing ramp, an hourly TME sync, and
imports that finish themselves via the cron drain. This is what you need to
know to keep shipping without breaking a run in progress.

## Deploying mid-run is safe

Vercel deployments are immutable. An invocation that is already running
finishes on the code it started with — a redeploy does not kill a ramp or sync
that is halfway through. New invocations pick up the new code.

The jobs are also resumable by design, so even a hard failure costs one tick,
not the work:

| Job | Where its progress lives | On interruption |
|---|---|---|
| Listing ramp | each product row (`listed_on_ebay`, `ebay_offer_id`) | next tick lists what's left |
| TME sync | `products.last_synced_at` cursor | next tick continues the sweep |
| Catalogue import | `sync_jobs.processed` | cron drain adopts it after 2 idle minutes |

In-memory state that resets on a new process — OAuth tokens, the merchant
location check, pricing tiers — is all re-derived on demand.

## The four rules

### 1. Schema changes are additive in the deploy that uses them

Add columns and indexes in `applyScaleMigration()` (`server/storage.ts`) using
`IF NOT EXISTS`, and let the new code read them in the same deploy. The app
awaits that migration before serving, so a new process never answers a request
against a schema it predates.

**Dropping or renaming is a two-deploy job.** Deploy the code that stops using
the column first; drop the column only once nothing running reads it. During a
rollout, old and new code are briefly live at the same time — a rename in one
deploy breaks whichever half loses the race.

### 2. Env var changes need a redeploy

Running processes hold the values they booted with. Changing a variable in the
Vercel dashboard does nothing until you redeploy. This applies to the ramp
knobs (`EBAY_RAMP_BATCH_CONCURRENCY`, `EBAY_BUILD_CONCURRENCY`,
`LISTING_RAMP_ENABLED`) as much as to credentials.

### 3. Verify with one batch before letting a change go wide

```
https://inventory-pro-mu.vercel.app/api/cron/list-ramp?maxBatches=1
```

Returns `published`, `failed` and `topErrors` for a single round. Every
regression in the listing pipeline was caught by this and by
`/api/__ramp-block-check`, which shows what TME says about the current queue
next to what the database believes. Both are read-only apart from the listing
itself.

### 4. Jobs refuse to run twice, and say so

The ramp, the daily sync and each import job take a **lease** before working
(`server/job-lease.ts`). A second trigger — cron firing while you press Start —
returns `{ skipped: true, reason: "a list_ramp run is already in progress
(started 42s ago)" }` instead of duplicating the work.

Leases expire (60–120s) and are renewed by the live run. A process killed
mid-run therefore frees its lease within about a minute; nothing needs manual
clearing. If you ever need to look:

```sql
SELECT * FROM job_leases;
```

## When something looks wrong

1. **Operations → Recent activity.** Each `list_ramp` line reports that run's
   own counts and its top error verbatim.
2. `/api/ops/list-ramp/failures` — failures grouped, with one full untruncated
   example each. Truncated messages have hidden the real cause more than once.
3. `/api/__ramp-block-check` — why current candidates aren't listing.
4. `/api/__system-check` — schema, TME version, env inventory.

After fixing a systemic cause, click **Requeue failed** in Operations.
Products parked at `EBAY_LIST_MAX_ATTEMPTS` are skipped by the candidate query
until their attempt counters are cleared, so a fix alone doesn't bring them
back.

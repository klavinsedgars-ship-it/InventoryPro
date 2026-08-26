import type { Express } from "express";
import { storage } from "../storage";
import { ebayInventoryApi } from "../ebay-inventory-api";
import { ebayOAuth } from "../ebay-oauth";
import { ebayAccountApi } from "../ebay-account-api";

/**
 * Diagnostic, migration, and one-off maintenance endpoints (all prefixed
 * `/api/__`). Extracted from the routes monolith into one module so the whole
 * suite can be gated behind a single env guard later (most are intentionally
 * unauthenticated for browser-based diagnostics — flagged in the security
 * review). Behaviour is identical to the previous inline handlers.
 */
export function registerDebugRoutes(app: Express) {
  /**
   * Which database is THIS deployment actually talking to, and what's in it?
   *
   * Written during the 2026-08 outage, when it was impossible to tell whether
   * the app was pointed at the production catalogue, a dev copy, or a
   * suspended database — the answer lived in host dashboards nobody could
   * cross-check quickly. Reports the connection TARGET (host/database only —
   * never user or password), the live product count, whether rows have been
   * deleted (id gap), and which runtime has been writing sync logs:
   *   cron_sync            -> Vercel serverless crons
   *   daily_sync_complete  -> a long-lived server (Replit) in-process scheduler
   * so two deployments sharing (or not sharing) a database is obvious at a glance.
   */
  app.get("/api/__db-info", async (_req, res) => {
    const raw =
      process.env.DATABASE_URL ||
      process.env.NEON_DATABASE_URL ||
      process.env.POSTGRES_URL ||
      "";
    let target: any = { configured: !!raw };
    try {
      if (raw) {
        const u = new URL(raw);
        target = {
          configured: true,
          host: u.hostname, // credentials deliberately omitted
          database: u.pathname.replace(/^\//, ""),
          pooled: /-pooler\./.test(u.hostname),
          provider: /neon\.tech/.test(u.hostname) ? "neon" : "other",
        };
      }
    } catch {
      target = { configured: true, host: "(unparseable DATABASE_URL)" };
    }

    try {
      const { db } = await import("../db");
      const { sql } = await import("drizzle-orm");
      const q = async (text: string) => {
        const r: any = await db.execute(sql.raw(text));
        return r.rows ?? r;
      };
      const [products, ops, dbName] = await Promise.all([
        q("SELECT COUNT(*)::int AS rows, MIN(id)::int AS min_id, MAX(id)::int AS max_id FROM products"),
        q(`SELECT operation, COUNT(*)::int AS runs, MAX(synced_at) AS last_run
            FROM sync_logs GROUP BY operation ORDER BY MAX(synced_at) DESC LIMIT 12`),
        q("SELECT current_database() AS db, inet_server_addr()::text AS server"),
      ]);
      const p = products[0] ?? {};
      // A max id far above the row count means rows were deleted at some point.
      const deletedEstimate =
        p.max_id != null && p.rows != null ? Math.max(0, p.max_id - p.rows) : null;
      res.json({
        ok: true,
        target,
        connected: dbName[0] ?? null,
        products: { rows: p.rows ?? 0, minId: p.min_id ?? null, maxId: p.max_id ?? null, deletedEstimate },
        syncLogsByOperation: ops,
        writtenBy: {
          vercelCron: ops.some((o: any) => o.operation === "cron_sync"),
          longLivedServer: ops.some((o: any) => o.operation === "daily_sync_complete"),
        },
        time: new Date().toISOString(),
      });
    } catch (err) {
      // A failure here IS the answer when the database is unreachable.
      res.status(503).json({ ok: false, target, error: (err as Error).message });
    }
  });

  /**
   * WHERE IS THE DATA? Probes EVERY database credential present in the
   * environment — not just the one db.ts happens to pick — and reports what
   * each one contains.
   *
   * Written because a provider/integration can silently overwrite DATABASE_URL
   * (pointing the app at a new, empty database) while the real production data
   * sits untouched behind a *different* env var that nothing reads any more.
   * From the outside both look identical: "the CRM is down / empty".
   *
   * Never returns credentials — host and database name only.
   */
  app.get("/api/__db-probe", async (_req, res) => {
    const VARS = [
      "DATABASE_URL",
      "DATABASE_URL_UNPOOLED",
      "NEON_DATABASE_URL",
      "POSTGRES_URL",
      "POSTGRES_URL_NON_POOLING",
      "POSTGRES_PRISMA_URL",
      "POSTGRES_URL_NO_SSL",
    ];

    // Group env vars by the database they actually point at, so N aliases of
    // one database are probed once and obvious duplicates collapse.
    const byTarget = new Map<string, { vars: string[]; url: string; host: string; database: string }>();
    for (const name of VARS) {
      const raw = process.env[name];
      if (!raw) continue;
      try {
        const u = new URL(raw);
        const key = `${u.hostname.replace(/-pooler\./, ".")}${u.pathname}`;
        const hit = byTarget.get(key);
        if (hit) hit.vars.push(name);
        else byTarget.set(key, { vars: [name], url: raw, host: u.hostname, database: u.pathname.replace(/^\//, "") });
      } catch { /* unparseable value */ }
    }

    const { Pool, neonConfig } = await import("@neondatabase/serverless");
    const ws = (await import("ws")).default;
    (neonConfig as any).webSocketConstructor = ws;

    const results = await Promise.all(
      Array.from(byTarget.values()).map(async (t) => {
        const base = { vars: t.vars, host: t.host, database: t.database };
        const pool = new Pool({ connectionString: t.url });
        try {
          const q = async (text: string) => (await pool.query(text)).rows;
          const [prod, logs, tables] = await Promise.all([
            q("SELECT COUNT(*)::int AS rows, MAX(id)::int AS max_id, MAX(last_synced_at) AS last_sync FROM products")
              .catch((e) => [{ error: e.message }]),
            q("SELECT operation, COUNT(*)::int AS runs, MAX(synced_at) AS last_run FROM sync_logs GROUP BY operation ORDER BY MAX(synced_at) DESC LIMIT 6")
              .catch(() => []),
            q("SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_schema='public'")
              .catch(() => [{ n: null }]),
          ]);
          return {
            ...base,
            reachable: true,
            tables: tables[0]?.n ?? null,
            products: prod[0] ?? null,
            recentSyncOperations: logs,
          };
        } catch (e) {
          return { ...base, reachable: false, error: (e as Error).message };
        } finally {
          try { await pool.end(); } catch { /* ignore */ }
        }
      }),
    );

    // Which one is the app actually using? (db.ts precedence order.)
    const active =
      process.env.DATABASE_URL || process.env.NEON_DATABASE_URL || process.env.POSTGRES_URL || "";
    let activeHost: string | null = null;
    try { activeHost = active ? new URL(active).hostname : null; } catch { /* ignore */ }

    res.json({
      ok: true,
      activeHost,
      note: "The app uses DATABASE_URL, else NEON_DATABASE_URL, else POSTGRES_URL. If a target below holds your data but is NOT activeHost, repoint DATABASE_URL at it.",
      targets: results,
      time: new Date().toISOString(),
    });
  });

  /**
   * FACTORY-RESET the connected database to the CURRENT schema, then seed
   * defaults (admin user, categories, pricing tiers).
   *
   * Exists because the app cannot otherwise provision its own tables: the
   * base schema historically came from a manual `drizzle-kit push` on the dev
   * box, which cannot run on Vercel. When the app is pointed at a brand-new
   * (or stale-schema) database, this endpoint brings it to exactly what the
   * running code expects — schema from server/schema-bootstrap-sql.ts
   * (generated from shared/schema.ts) plus the applyScaleMigration indexes.
   *
   * DESTRUCTIVE: drops schema `public`. Two interlocks, both required:
   *   1. env ALLOW_SCHEMA_RESET=true  (set it, run this once, REMOVE it)
   *   2. query ?confirm=RESET
   * GET without confirm reports status + row counts without touching anything.
   */
  app.get("/api/__schema-reset", async (req, res) => {
    const armed = process.env.ALLOW_SCHEMA_RESET === "true";
    const { db } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const q = async (text: string) => {
      const r: any = await db.execute(sql.raw(text));
      return r.rows ?? r;
    };

    // Dry-run status for GET without ?confirm=RESET.
    if (req.query.confirm !== "RESET") {
      let state: any = {};
      try {
        const t = await q(`SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_schema='public'`);
        let productRows: number | string = "n/a";
        try { productRows = (await q(`SELECT COUNT(*)::int AS n FROM products`))[0].n; } catch { productRows = "table missing"; }
        state = { tables: t[0].n, productRows };
      } catch (e) {
        state = { error: (e as Error).message };
      }
      return res.json({
        armed,
        wouldApplyStatements: (await import("../schema-bootstrap-sql")).SCHEMA_STATEMENTS.length,
        currentDatabase: state,
        howTo: armed
          ? "Call again with ?confirm=RESET to WIPE this database and provision the current schema."
          : "Set ALLOW_SCHEMA_RESET=true in the environment (and redeploy) to arm this endpoint.",
      });
    }

    if (!armed) {
      return res.status(403).json({
        ok: false,
        error: "Not armed. Set ALLOW_SCHEMA_RESET=true in the environment, redeploy, then retry. Remove the var afterwards.",
      });
    }

    try {
      const { SCHEMA_STATEMENTS } = await import("../schema-bootstrap-sql");
      console.warn("⚠️  SCHEMA RESET requested — dropping schema public and re-provisioning.");

      await q(`DROP SCHEMA public CASCADE`);
      await q(`CREATE SCHEMA public`);

      let applied = 0;
      for (const stmt of SCHEMA_STATEMENTS) {
        await q(stmt);
        applied++;
      }

      // Post-DDL: performance indexes + the incremental columns the runtime
      // self-migrations manage, so a fresh DB matches a long-lived one.
      await storage.applyScaleMigration();
      await storage.ensureOrderIntegritySchema();
      // Session store table (connect-pg-simple would lazily recreate it, but
      // do it now so the first login after reset doesn't race).
      await q(`CREATE TABLE IF NOT EXISTS user_sessions (
        sid varchar NOT NULL COLLATE "default" PRIMARY KEY,
        sess json NOT NULL,
        expire timestamp(6) NOT NULL)`);
      await q(`CREATE INDEX IF NOT EXISTS user_sessions_expire_idx ON user_sessions (expire)`);

      // Seed defaults: admin user, categories, pricing tiers.
      await storage.seedDefaults();

      const tables = await q(`SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_schema='public'`);
      const admin = await q(`SELECT COUNT(*)::int AS n FROM users WHERE username='admin'`);
      res.json({
        ok: true,
        droppedAndRecreated: true,
        schemaStatements: applied,
        tables: tables[0].n,
        adminSeeded: admin[0].n === 1,
        next: [
          "REMOVE ALLOW_SCHEMA_RESET from the environment and redeploy",
          "Log in as admin / admin123 and CHANGE THE PASSWORD",
          "Re-import the catalogue via TME Browser",
        ],
      });
    } catch (err) {
      console.error("Schema reset failed:", err);
      res.status(500).json({ ok: false, error: (err as Error).message });
    }
  });

  /**
   * FULL SYSTEM SELF-CHECK — one URL that answers "is everything actually
   * working, and if not, which exact piece is broken?"
   *
   * Probes, in order: database (connection, tables, key row counts, a real
   * write+delete), TME API (each endpoint separately, so a v2 permission
   * denial on GetProducts shows up even while Search still works — the exact
   * failure mode that made imports complete with 0 products), eBay OAuth
   * (token refresh), and env inventory. Finishes with a human-readable
   * verdict list. Diagnostic-only: the one write it makes is deleted again.
   */
  app.get("/api/__system-check", async (_req, res) => {
    const verdicts: string[] = [];
    const report: any = { time: new Date().toISOString() };

    // ---- Database ----
    try {
      const { db } = await import("../db");
      const { sql } = await import("drizzle-orm");
      const q = async (text: string) => {
        const r: any = await db.execute(sql.raw(text));
        return r.rows ?? r;
      };
      const raw = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL || process.env.POSTGRES_URL || "";
      let host = null;
      try { host = raw ? new URL(raw).hostname : null; } catch { /* unparseable */ }
      const tables = (await q(`SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_schema='public'`))[0].n;
      const counts: Record<string, number | string> = {};
      for (const t of ["products", "users", "categories", "pricing_tiers", "sync_jobs", "sync_logs", "sync_audit"]) {
        try { counts[t] = (await q(`SELECT COUNT(*)::int AS n FROM ${t}`))[0].n; }
        catch (e) { counts[t] = `ERROR: ${(e as Error).message.slice(0, 60)}`; }
      }
      // Write test: insert a probe log row, then remove it.
      let writeOk = false;
      try {
        const ins: any = await q(`INSERT INTO sync_logs (source, operation, status, message) VALUES ('system','self_check','success','write probe') RETURNING id`);
        const id = (ins[0] ?? {}).id;
        if (id != null) { await q(`DELETE FROM sync_logs WHERE id = ${Number(id)}`); writeOk = true; }
      } catch (e) {
        verdicts.push(`DB writes failing: ${(e as Error).message.slice(0, 100)}`);
      }
      report.database = { ok: true, host, tables, counts, writeOk };
      if (tables < 28) verdicts.push(`Only ${tables} tables — schema incomplete, run /api/__schema-reset`);
      if (counts.users === 0) verdicts.push("No users — admin missing; seeding did not run");
    } catch (e) {
      report.database = { ok: false, error: (e as Error).message };
      verdicts.push(`DATABASE UNREACHABLE: ${(e as Error).message.slice(0, 120)}`);
    }

    // ---- TME API, endpoint by endpoint ----
    const { tmeApi } = await import("../tme-api");
    const PROBE_SYMBOL = "1N4148";
    const tme: any = {};
    try {
      const s = await tmeApi.searchProducts("1N4148", 1);
      tme.search = { ok: true, results: s.length };
    } catch (e) { tme.search = { ok: false, error: (e as Error).message.slice(0, 160) }; }
    try {
      const d = await (tmeApi as any).getProductDetails([PROBE_SYMBOL]);
      tme.getProducts = { ok: true, results: d.length };
    } catch (e) { tme.getProducts = { ok: false, error: (e as Error).message.slice(0, 160) }; }
    try {
      const p = await (tmeApi as any).getPricesAndStocks([PROBE_SYMBOL]);
      tme.getPricesAndStocks = { ok: true, results: p.length };
    } catch (e) { tme.getPricesAndStocks = { ok: false, error: (e as Error).message.slice(0, 160) }; }
    report.tme = tme;
    if (!tme.search.ok && !tme.getProducts.ok) {
      verdicts.push("TME API fully down/denied — imports and sync cannot work. Check TME_TOKEN/TME_APPLICATION_SECRET (v2 tokens: developers.tme.eu).");
    } else if (!tme.getProducts.ok || !tme.getPricesAndStocks.ok) {
      verdicts.push("TME partially denied: Search works but product-data endpoints fail — imports will fail. Your token likely lacks v2 API permissions; regenerate at developers.tme.eu.");
    }

    // ---- eBay OAuth ----
    try {
      await ebayOAuth.getValidAccessToken();
      report.ebay = { ok: true, tokenRefresh: "working" };
    } catch (e) {
      report.ebay = { ok: false, error: (e as Error).message.slice(0, 160) };
      verdicts.push(`eBay OAuth failing: listings/orders/messages sync will not work (${(e as Error).message.slice(0, 80)})`);
    }

    // ---- Env inventory ----
    report.env = {
      database: !!(process.env.DATABASE_URL || process.env.NEON_DATABASE_URL || process.env.POSTGRES_URL),
      staleNeonVar: !!process.env.NEON_DATABASE_URL,
      tmeCreds: !!(process.env.TME_TOKEN && process.env.TME_APPLICATION_SECRET),
      ebayCreds: !!((process.env.EBAY_OAUTH_CLIENT_ID || process.env.EBAY_APP_ID) && (process.env.EBAY_OAUTH_REFRESH_TOKEN || process.env.EBAY_REFRESH_TOKEN)),
      cronSecret: !!process.env.CRON_SECRET,
      bypassAuth: process.env.BYPASS_AUTH === "true",
      schemaResetArmed: process.env.ALLOW_SCHEMA_RESET === "true",
    };
    if (report.env.bypassAuth) verdicts.push("BYPASS_AUTH is ON — the app has no login; remove it in production");
    if (report.env.schemaResetArmed) verdicts.push("ALLOW_SCHEMA_RESET is still armed — remove it now that the reset is done");
    if (report.env.staleNeonVar) verdicts.push("NEON_DATABASE_URL still set — delete it (stale fallback caused the August outage)");

    report.healthy = verdicts.length === 0;
    report.verdicts = verdicts.length ? verdicts : ["All checks passed."];
    res.json(report);
  });

  /**
   * eBay merchant-location diagnostic + repair.
   *
   * Error 25733 ("valid inventory units and location information must be
   * provided") on every inventory item points at the merchant location, but
   * ensureMerchantLocation only checks that a GET succeeds — a location that
   * exists yet is DISABLED, or lacks an address, passes that check and still
   * fails every listing. This shows what eBay actually holds.
   *
   * ?fix=1 additionally force-writes the location (POST is an upsert for an
   * existing key), which repairs a disabled/incomplete record.
   */
  app.get("/api/__ebay-location", async (req, res) => {
    try {
      const info = await ebayInventoryApi.inspectMerchantLocations();
      let repair: any = null;
      if (String(req.query.fix) === "1") {
        repair = await ebayInventoryApi.ensureMerchantLocation();
        // Re-read so the response shows the post-repair state.
        (info as any).afterFix = await ebayInventoryApi.inspectMerchantLocations();
      }
      res.json({
        ok: true,
        ...info,
        repair,
        envUsed: {
          EBAY_MERCHANT_LOCATION_KEY: process.env.EBAY_MERCHANT_LOCATION_KEY || "(unset -> 'default-location')",
          EBAY_LISTING_COUNTRY: process.env.EBAY_LISTING_COUNTRY || "(unset -> LV)",
          EBAY_LOCATION_POSTAL: process.env.EBAY_LOCATION_POSTAL || "(unset -> LV-1001)",
          EBAY_LOCATION_CITY: process.env.EBAY_LOCATION_CITY || "(unset -> Riga)",
        },
        hint: "A usable location must exist under configuredKey with merchantLocationStatus ENABLED and a full address. Add ?fix=1 to rewrite it.",
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: (error as Error).message });
    }
  });

  /**
   * Dump the EXACT payloads we send to eBay for one product — the single
   * inventory-item PUT body, the bulk wrapper, and the offer — without
   * calling eBay at all.
   *
   * Needed because error 25733 names "inventory units and location
   * information" while both are demonstrably valid on our side, so the fault
   * has to be in the payload's shape. Comparing the built JSON against eBay's
   * schema is faster than another round of guess-and-deploy.
   *   GET /api/__inventory-payload?productId=123
   */
  app.get("/api/__inventory-payload", async (req, res) => {
    try {
      let product: any = null;
      if (req.query.productId) {
        product = await storage.getProduct(Number(req.query.productId));
      } else if (req.query.sku) {
        product = await storage.getProductBySku(String(req.query.sku));
      } else {
        const c = await storage.getListingCandidates(1);
        product = c[0] ?? null;
      }
      if (!product) return res.status(404).json({ ok: false, error: "product not found (pass ?productId= or ?sku=)" });

      const api: any = ebayInventoryApi;
      const categoryId = (await api.resolveCategory(product)) || process.env.EBAY_DEFAULT_CATEGORY_ID || null;
      const inventoryItem = categoryId ? await api.buildInventoryItem(product, categoryId) : null;
      const offer = categoryId ? await api.buildOffer(product, categoryId) : null;

      res.json({
        ok: true,
        product: {
          id: product.id, sku: product.sku, stock: product.stock,
          salePrice: product.salePrice, weight: product.weight,
          useStockLimit: product.useStockLimit, ebayStockLimit: product.ebayStockLimit,
        },
        categoryId,
        // What PUT /inventory_item/{sku} receives:
        singleInventoryItemBody: inventoryItem,
        // What POST /bulk_create_or_replace_inventory_item receives:
        bulkInventoryItemBody: inventoryItem ? { requests: [{ sku: product.sku, ...inventoryItem }] } : null,
        offerBody: offer,
        merchantLocationKey: api.merchantLocationKey,
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: (error as Error).message, stack: (error as Error).stack?.split("\n").slice(0, 4) });
    }
  });

  // Diagnostic endpoint - no auth required, no DB access.
  // Use to verify which commit is actually running and whether
  // BYPASS_AUTH is being read by the function.
  app.get("/api/__version", (req, res) => {
    const clientId =
      process.env.EBAY_OAUTH_CLIENT_ID || process.env.EBAY_APP_ID || "";
    const clientSecret =
      process.env.EBAY_OAUTH_CLIENT_SECRET || process.env.EBAY_CERT_ID || "";
    const refreshToken =
      process.env.EBAY_OAUTH_REFRESH_TOKEN ||
      process.env.EBAY_REFRESH_TOKEN ||
      "";

    res.json({
      commit: process.env.VERCEL_GIT_COMMIT_SHA || "unknown",
      branch: process.env.VERCEL_GIT_COMMIT_REF || "unknown",
      bypassAuth: process.env.BYPASS_AUTH === "true",
      nodeEnv: process.env.NODE_ENV || "unknown",
      hasDatabase:
        !!(process.env.DATABASE_URL || process.env.NEON_DATABASE_URL || process.env.POSTGRES_URL),
      ebay: {
        hasClientId: !!clientId,
        clientIdLength: clientId.length,
        hasClientSecret: !!clientSecret,
        clientSecretLength: clientSecret.length,
        hasRefreshToken: !!refreshToken,
        refreshTokenLength: refreshToken.length,
      },
      ebayMarketplace: {
        siteId: process.env.EBAY_MARKETPLACE_SITE_ID || "(unset -> defaults to 77/DE)",
        currency: process.env.EBAY_LISTING_CURRENCY || "(unset -> defaults to EUR)",
        country: process.env.EBAY_LISTING_COUNTRY || "(unset -> LV)",
        paymentProfileId: process.env.EBAY_PAYMENT_PROFILE_ID || "(unset)",
        returnProfileId: process.env.EBAY_RETURN_PROFILE_ID || "(unset)",
        shipping_0_20: process.env.EBAY_SHIPPING_POLICY_0_20GR || "(unset)",
      },
      tme: {
        hasToken: !!process.env.TME_TOKEN,
        hasAppSecret: !!process.env.TME_APPLICATION_SECRET,
        hasCustomerNumber: !!process.env.TME_CUSTOMER_NUMBER,
        hasContactNumber: !!process.env.TME_CONTACT_NUMBER,
      },
      time: new Date().toISOString(),
    });
  });

  // One-shot OAuth code exchange. Pass ?code=<auth-code>&ruName=<RuName>
  // (or rely on the configured RuName env var) and we hit eBay's token
  // endpoint with the configured client_id/secret. Returns the new
  // refresh_token so it can be saved to EBAY_OAUTH_REFRESH_TOKEN.
  // Codes are single-use and expire in ~5 minutes, so this is safe to
  // expose temporarily.
  app.get("/api/__ebay-exchange", async (req, res) => {
    const code = String(req.query.code || "");
    const ruName =
      String(req.query.ruName || "") || process.env.EBAY_RUNAME || "";

    if (!code || !ruName) {
      return res.status(400).json({
        ok: false,
        message:
          "Both ?code=<authcode> and ?ruName=<RuName> required (or set EBAY_RUNAME env var)",
        haveCode: !!code,
        haveRuName: !!ruName,
      });
    }

    const clientId =
      process.env.EBAY_OAUTH_CLIENT_ID || process.env.EBAY_APP_ID || "";
    const clientSecret =
      process.env.EBAY_OAUTH_CLIENT_SECRET || process.env.EBAY_CERT_ID || "";

    if (!clientId || !clientSecret) {
      return res.status(400).json({
        ok: false,
        message: "Client ID or Client Secret missing from env",
      });
    }

    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString(
      "base64",
    );
    try {
      const response = await fetch(
        "https://api.ebay.com/identity/v1/oauth2/token",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: `Basic ${credentials}`,
          },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: ruName,
          }).toString(),
        },
      );
      const bodyText = await response.text();
      let bodyJson: any = null;
      try {
        bodyJson = JSON.parse(bodyText);
      } catch {}

      if (!response.ok) {
        return res.status(200).json({
          ok: false,
          stage: "ebay-rejected",
          httpStatus: response.status,
          ebayError: bodyJson?.error,
          ebayErrorDescription: bodyJson?.error_description,
          rawBody: bodyText.slice(0, 500),
        });
      }

      return res.json({
        ok: true,
        message:
          "Save the refresh_token below to Vercel env var EBAY_OAUTH_REFRESH_TOKEN.",
        refresh_token: bodyJson?.refresh_token,
        refresh_token_expires_in: bodyJson?.refresh_token_expires_in,
        access_token_expires_in: bodyJson?.expires_in,
        token_type: bodyJson?.token_type,
      });
    } catch (err) {
      return res.status(500).json({
        ok: false,
        stage: "network",
        error: (err as Error).message,
      });
    }
  });

  // One-shot DE business-policy bootstrap.
  // Creates 1 payment + 1 return + 4 shipping policies on the EBAY_DE
  // marketplace using the existing OAuth credentials (sell.account scope
  // required, which the refresh token already has).
  //
  // Accepts JSON body to override prices/labels; everything has defaults
  // appropriate for a Latvia-based seller shipping to Germany. Returns
  // every policy ID in one response, plus a copy-paste env-var block.
  //
  // Designed to be safe to re-run: if eBay rejects a policy because one
  // with the same name already exists, the error is surfaced per-policy
  // instead of crashing the whole batch.
  app.post("/api/__bootstrap-de-policies", async (req, res) => {
    const body = (req.body || {}) as any;

    const paymentName = String(body.paymentName || "EU Managed Payments");
    const returnName = String(body.returnName || "30 Tage Rückgabe");

    // 5 weight bands matching Latvijas Pasts' Sīkpaka (parcel-with-goods)
    // tariff brackets. Prices are Economy service + 15% packaging markup,
    // rounded up. Per band:
    //   de = Germany domestic rate (used by eBay.de buyers)
    //   eu = AVERAGE EU postal rate +15% across all 23 non-DE EU countries
    //        (Baltics, Western, Southern, Eastern). More competitive than
    //        the worst-case max; the small over/under per destination
    //        balances on average over the EU mix.
    // (eBay's shipping-policy API only supports broad regions like EUROPE,
    // not per-country flat rates — per-country tiering returns errorId
    // 216347 "unsupported destinations".)
    type Band = {
      label: string;
      varKey: string;
      de: string;
      eu: string;
      additional: string;
      weightMin: number;
      weightMax: number;
    };

    const bandsInput = Array.isArray(body.shipping) ? body.shipping : null;
    const defaultBands: Band[] = [
      { label: "0-20g",     varKey: "EBAY_SHIPPING_POLICY_0_20GR",     de: "5.79", eu: "5.49",  additional: "1.00", weightMin: 0,    weightMax: 20 },
      { label: "21-100g",   varKey: "EBAY_SHIPPING_POLICY_21_100GR",   de: "5.89", eu: "5.49",  additional: "1.00", weightMin: 21,   weightMax: 100 },
      { label: "101-500g",  varKey: "EBAY_SHIPPING_POLICY_101_500GR",  de: "7.09", eu: "6.99",  additional: "1.00", weightMin: 101,  weightMax: 500 },
      { label: "501-1000g", varKey: "EBAY_SHIPPING_POLICY_501_1000GR", de: "9.39", eu: "10.49", additional: "2.00", weightMin: 501,  weightMax: 1000 },
      { label: "1001-2000g",varKey: "EBAY_SHIPPING_POLICY_1001_2000GR",de: "10.99",eu: "12.99", additional: "5.00", weightMin: 1001, weightMax: 2000 },
    ];

    const bands: Band[] = bandsInput && bandsInput.length === defaultBands.length
      ? bandsInput.map((b: any, i: number) => ({
          ...defaultBands[i],
          de: String(b.de ?? defaultBands[i].de),
          eu: String(b.eu ?? defaultBands[i].eu),
          additional: String(b.additional ?? defaultBands[i].additional),
        }))
      : defaultBands;

    const results: any = { payment: null, return: null, shipping: [] };
    const errors: string[] = [];

    // Call eBay's Account API directly so we can surface the actual HTTP
    // error body instead of the swallow-and-return-null pattern the
    // ebayAccountApi helper uses.
    const ebayApiCall = async (
      endpoint: string,
      body: any,
    ): Promise<{ ok: true; data: any } | { ok: false; status: number; error: string }> => {
      try {
        const token = await ebayOAuth.getValidAccessToken();
        const url = `https://api.ebay.com${endpoint}`;
        const response = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Content-Language": "de-DE",
            "Accept-Language": "de-DE",
          },
          body: JSON.stringify(body),
        });
        const text = await response.text();
        let parsed: any = null;
        try {
          parsed = JSON.parse(text);
        } catch {}
        if (!response.ok) {
          const err = parsed?.errors?.[0];
          const msg = err
            ? `${err.errorId ?? ""} ${err.longMessage ?? err.message ?? ""} ${
                err.parameters ? JSON.stringify(err.parameters) : ""
              }`.trim()
            : text.slice(0, 500);
          return { ok: false, status: response.status, error: msg };
        }
        return { ok: true, data: parsed };
      } catch (err) {
        return { ok: false, status: 0, error: (err as Error).message };
      }
    };

    // Fetch existing policies of a type for EBAY_DE (used as a fallback when
    // creation fails because an equivalent policy already exists).
    const fetchExisting = async (
      type: "payment" | "return" | "fulfillment",
    ): Promise<any[]> => {
      try {
        const token = await ebayOAuth.getValidAccessToken();
        const resp = await fetch(
          `https://api.ebay.com/sell/account/v1/${type}_policy?marketplace_id=EBAY_DE`,
          { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } },
        );
        if (!resp.ok) return [];
        const data = await resp.json();
        return data[`${type}Policies`] || [];
      } catch {
        return [];
      }
    };

    {
      const r = await ebayApiCall("/sell/account/v1/payment_policy", {
        name: paymentName,
        description: "eBay-managed payments for EU marketplace",
        marketplaceId: "EBAY_DE",
        categoryTypes: [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES" }],
        paymentMethods: [],
        immediatePay: true,
      });
      if (r.ok) {
        results.payment = { id: r.data.paymentPolicyId, name: r.data.name };
      } else {
        // eBay returns 20400 with `duplicatePolicyId` when a policy with
        // the same name (or auto-created equivalent) already exists. Use
        // it instead of erroring out.
        const dupMatch = r.error.match(/duplicatePolicyId.*?(\d{8,})/);
        if (dupMatch) {
          results.payment = { id: dupMatch[1], name: "(existing eBay policy)" };
        } else {
          errors.push(`Payment policy [HTTP ${r.status}]: ${r.error}`);
        }
      }
    }

    {
      // DE consumer law (Widerrufsrecht): the seller normally pays
      // return shipping for consumer goods. eBay rejects BUYER as
      // returnShippingCostPayer on EBAY_DE with errorId 200002.
      const r = await ebayApiCall("/sell/account/v1/return_policy", {
        name: returnName,
        description: "30 Tage Rückgabe, Verkäufer zahlt Rückversand",
        marketplaceId: "EBAY_DE",
        categoryTypes: [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES" }],
        returnsAccepted: true,
        returnPeriod: { value: 30, unit: "DAY" },
        refundMethod: "MONEY_BACK",
        returnShippingCostPayer: "SELLER",
      });
      if (r.ok) {
        results.return = { id: r.data.returnPolicyId, name: r.data.name };
      } else {
        const dupMatch = r.error.match(/duplicatePolicyId.*?(\d{8,})/);
        if (dupMatch) {
          results.return = { id: dupMatch[1], name: "(existing eBay policy)" };
        } else {
          // Reuse an existing return policy if one is already set up
          // (eBay 200002 fires when the requested method/an equivalent
          // policy already exists on this marketplace).
          const existing = await fetchExisting("return");
          if (existing.length > 0) {
            results.return = {
              id: existing[0].returnPolicyId,
              name: `(reused existing: ${existing[0].name})`,
            };
          } else {
            errors.push(`Return policy [HTTP ${r.status}]: ${r.error}`);
          }
        }
      }
    }

    for (const band of bands) {
      // Domestic (Germany) uses DHL Paket — DE_OtherShippingMethods failed
      // LSAS validation ("LOGISTICS_INFO_IS_MISSING"); eBay DE wants a
      // concrete carrier+service pair. The actual fulfilment carrier
      // (Omniva / Latvijas Pasts) is independent of what we declare.
      // International (rest of EU/EEA) uses a generic economy international
      // service. Buyers in DE see the domestic rate; EU buyers see the eu
      // rate. Both are Economy (untracked) + 15% packaging markup.
      // 1 domestic (DE) + 3 international tier services (EU-1/2/3). eBay
      // allows up to 4 international services; we use 3. Each tier targets
      // an explicit country list at that tier's max rate. Tier 3 also
      // catches the whole EUROPE region so any EU country we didn't
      // explicitly tier still ships (at the priciest, safe rate).
      const r = await ebayApiCall("/sell/account/v1/fulfillment_policy", {
        name: `EU ${band.label} (DE €${band.de})`,
        description: `Economy shipping for items ${band.label}`,
        marketplaceId: "EBAY_DE",
        categoryTypes: [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES" }],
        handlingTime: { value: 2, unit: "DAY" },
        shippingOptions: [
          {
            optionType: "DOMESTIC",
            costType: "FLAT_RATE",
            shippingServices: [
              {
                shippingCarrierCode: "DHL",
                shippingServiceCode: "DE_DHLPaket",
                shippingCost: { value: band.de, currency: "EUR" },
                additionalShippingCost: { value: band.additional, currency: "EUR" },
                freeShipping: false,
                sortOrder: 1,
              },
            ],
          },
          {
            optionType: "INTERNATIONAL",
            costType: "FLAT_RATE",
            shippingServices: [
              {
                shippingServiceCode: "DE_SonstigerVersandInternational",
                shippingCost: { value: band.eu, currency: "EUR" },
                additionalShippingCost: { value: band.additional, currency: "EUR" },
                freeShipping: false,
                sortOrder: 1,
                shipToLocations: {
                  regionIncluded: [{ regionName: "EUROPE", regionType: "WORLD_REGION" }],
                },
              },
            ],
          },
        ],
        shipToLocations: {
          regionIncluded: [
            { regionName: "DE", regionType: "COUNTRY" },
            { regionName: "EUROPE", regionType: "WORLD_REGION" },
          ],
        },
        globalShipping: false,
      });
      if (r.ok) {
        results.shipping.push({
          id: r.data.fulfillmentPolicyId,
          name: r.data.name,
          band: band.label,
          weightMin: band.weightMin,
          weightMax: band.weightMax,
        });
      } else {
        const dupMatch = r.error.match(/duplicatePolicyId.*?(\d{8,})/);
        if (dupMatch) {
          results.shipping.push({
            id: dupMatch[1],
            name: "(existing eBay policy)",
            band: band.label,
            weightMin: band.weightMin,
            weightMax: band.weightMax,
          });
        } else {
          errors.push(`Shipping ${band.label} [HTTP ${r.status}]: ${r.error}`);
        }
      }
    }

    const envSnippet: string[] = [];
    if (results.payment?.id) envSnippet.push(`EBAY_PAYMENT_PROFILE_ID=${results.payment.id}`);
    if (results.return?.id) envSnippet.push(`EBAY_RETURN_PROFILE_ID=${results.return.id}`);
    const bandToVar: Record<string, string> = Object.fromEntries(
      bands.map((b) => [b.label, b.varKey]),
    );
    for (const s of results.shipping) {
      const varName = bandToVar[s.band];
      if (varName) envSnippet.push(`${varName}=${s.id}`);
    }
    envSnippet.push("EBAY_MARKETPLACE_SITE_ID=77");
    envSnippet.push("EBAY_LISTING_CURRENCY=EUR");

    res.json({
      ok: errors.length === 0,
      results,
      errors,
      envSnippet: envSnippet.join("\n"),
      note:
        "Save the envSnippet block to Vercel Project Settings -> Environment Variables. " +
        "Redeploy with 'Use existing Build Cache' unchecked. The code switch wiring up " +
        "these vars lands in the next commit.",
    });
  });

  // List valid eBay shipping service codes for a site (default DE=77),
  // so we stop guessing international service codes. Returns domestic and
  // international service codes via Trading GeteBayDetails.
  //   GET /api/__ebay-shipping-services?siteId=77
  app.get("/api/__ebay-shipping-services", async (req, res) => {
    const siteId = String(req.query.siteId || "77");
    try {
      const token = await ebayOAuth.getValidAccessToken();
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<GeteBayDetailsRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <DetailName>ShippingServiceDetails</DetailName>
</GeteBayDetailsRequest>`;
      const resp = await fetch("https://api.ebay.com/ws/api.dll", {
        method: "POST",
        headers: {
          "Content-Type": "text/xml; charset=utf-8",
          "X-EBAY-API-COMPATIBILITY-LEVEL": "967",
          "X-EBAY-API-DEV-NAME": process.env.EBAY_DEV_ID || "",
          "X-EBAY-API-APP-NAME": process.env.EBAY_APP_ID || "",
          "X-EBAY-API-CERT-NAME": process.env.EBAY_CERT_ID || "",
          "X-EBAY-API-CALL-NAME": "GeteBayDetails",
          "X-EBAY-API-SITEID": siteId,
          "X-EBAY-API-IAF-TOKEN": token,
        },
        body: xml,
      });
      const text = await resp.text();
      // Each <ShippingServiceDetails> has <ShippingService>code</ShippingService>,
      // optional <InternationalService>true</InternationalService>, and
      // <ValidForSellingFlow>true</ValidForSellingFlow>.
      const blocks = text.match(/<ShippingServiceDetails>[\s\S]*?<\/ShippingServiceDetails>/g) || [];
      const domestic: string[] = [];
      const international: string[] = [];
      for (const b of blocks) {
        if (!/<ValidForSellingFlow>true<\/ValidForSellingFlow>/.test(b)) continue;
        const code = b.match(/<ShippingService>(.*?)<\/ShippingService>/)?.[1];
        if (!code) continue;
        if (/<InternationalService>true<\/InternationalService>/.test(b)) international.push(code);
        else domestic.push(code);
      }
      res.json({
        ok: true,
        siteId,
        counts: { domestic: domestic.length, international: international.length },
        international,
        domestic,
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: (err as Error).message });
    }
  });

  // End (remove) an eBay listing by raw ItemID, on a specified site.
  // Needed because the old UK listing was created on site 3 (UK) while the
  // app is now configured for site 77 (DE); ending it needs the UK site
  // context + EndFixedPriceItem. Usage:
  //   GET /api/__end-ebay-item?itemId=306978602604&siteId=3
  app.get("/api/__end-ebay-item", async (req, res) => {
    const itemId = String(req.query.itemId || "");
    const siteId = String(req.query.siteId || "3"); // 3=UK, 77=DE
    if (!/^\d+$/.test(itemId)) {
      return res.status(400).json({ ok: false, message: "valid numeric ?itemId= required" });
    }
    try {
      const token = await ebayOAuth.getValidAccessToken();
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<EndFixedPriceItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ItemID>${itemId}</ItemID>
  <EndingReason>NotAvailable</EndingReason>
</EndFixedPriceItemRequest>`;
      const resp = await fetch("https://api.ebay.com/ws/api.dll", {
        method: "POST",
        headers: {
          "Content-Type": "text/xml; charset=utf-8",
          "X-EBAY-API-COMPATIBILITY-LEVEL": "967",
          "X-EBAY-API-DEV-NAME": process.env.EBAY_DEV_ID || "",
          "X-EBAY-API-APP-NAME": process.env.EBAY_APP_ID || "",
          "X-EBAY-API-CERT-NAME": process.env.EBAY_CERT_ID || "",
          "X-EBAY-API-CALL-NAME": "EndFixedPriceItem",
          "X-EBAY-API-SITEID": siteId,
          "X-EBAY-API-IAF-TOKEN": token,
        },
        body: xml,
      });
      const text = await resp.text();
      const ack = text.match(/<Ack>(.*?)<\/Ack>/)?.[1] || "Unknown";
      const shortMsg = text.match(/<ShortMessage>(.*?)<\/ShortMessage>/)?.[1];
      const ended = ack === "Success" || ack === "Warning";
      // If it's already ended, eBay reports an error we can treat as success
      const alreadyEnded = /auction.*already|ended|not.*active|1047|cannot be ended/i.test(text);
      res.json({
        ok: ended || alreadyEnded,
        ack,
        itemId,
        siteId,
        message: shortMsg || (ended ? "Listing ended" : "See raw"),
        raw: text.slice(0, 600),
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: (err as Error).message });
    }
  });

  // TME connectivity check. Hits TME's GetPing equivalent (a tiny
  // Products.GetPrices call) with the configured creds and reports the
  // raw response — so we know whether TME is actually reachable, vs the
  // env vars being missing, vs HMAC signature failing.
  app.get("/api/__tme-check", async (_req, res) => {
    const have = {
      TME_TOKEN: !!process.env.TME_TOKEN,
      TME_APPLICATION_SECRET: !!process.env.TME_APPLICATION_SECRET,
      TME_CUSTOMER_NUMBER: !!process.env.TME_CUSTOMER_NUMBER,
      TME_CONTACT_NUMBER: !!process.env.TME_CONTACT_NUMBER,
    };
    if (!have.TME_TOKEN || !have.TME_APPLICATION_SECRET) {
      return res.json({
        ok: false,
        stage: "config",
        have,
        message:
          "TME_TOKEN and/or TME_APPLICATION_SECRET are not set in env. Get a token from https://developers.tme.eu/ and add both to Vercel.",
      });
    }
    try {
      const { tmeApi } = await import("../tme-api");
      // Cheapest live call: ask for one well-known TME SKU.
      // The method is getPricesAndStocks — the previous name belonged to the
      // OPTIMIZED client, so optional chaining short-circuited the whole call
      // and this endpoint reported stage:"success" without ever contacting
      // TME. Call it directly so a failure is a failure.
      let probe: any;
      try {
        probe = await tmeApi.getPricesAndStocks(["1N4148-DIO"]);
      } catch (e) {
        return res.json({ ok: false, stage: "tme-api", have, error: (e as Error).message });
      }
      // Surface the price BASIS: TME returns the customer-configuration
      // currency unless we name one, so this confirms we are reading EUR/NET
      // rather than (e.g.) PLN figures being consumed as EUR.
      let basis: any = null;
      try {
        const raw: any = await (tmeApi as any).makeRequest?.("/Products/GetPricesAndStocks.json", { SymbolList: ["1N4148-DIO"] });
        basis = { Currency: raw?.Data?.Currency ?? null, PriceType: raw?.Data?.PriceType ?? null, Language: raw?.Data?.Language ?? null };
      } catch (e) { basis = { error: (e as Error).message.slice(0, 200) }; }
      return res.json({
        ok: true,
        stage: "success",
        have,
        priceBasis: basis,
        expected: { currency: process.env.TME_CURRENCY || "EUR", priceType: "NET" },
        sampleCount: Array.isArray(probe) ? probe.length : null,
        sample: Array.isArray(probe) ? probe.slice(0, 1) : probe,
      });
    } catch (err) {
      res.status(500).json({ ok: false, stage: "exception", have, error: (err as Error).message });
    }
  });

  // Inventory API end-to-end check on ONE product: location -> inventory
  // item -> offer -> publish. Returns every step so we can see exactly
  // what works / fails before wiring the bulk flow.
  //   GET /api/__inventory-check?productId=123
  app.get("/api/__inventory-check", async (req, res) => {
    const productId = Number(req.query.productId);
    if (!productId) {
      // fall back to the first IN-STOCK TME product (publish needs qty > 0)
      const products = await storage.getProducts();
      const cand = products.find((p) => p.supplier === "TME" && p.sku && (p.stock ?? 0) > 0);
      if (!cand) return res.status(400).json({ ok: false, message: "?productId= required (no in-stock TME product found)" });
      const result = await ebayInventoryApi.listSingleProduct(cand.id, (id) => storage.getProduct(id));
      return res.json({ pickedProductId: cand.id, ...result });
    }
    try {
      const result = await ebayInventoryApi.listSingleProduct(productId, (id) => storage.getProduct(id));
      // surface the category's required-aspect spec for debugging
      const catStep = result.steps.find((s) => s.step === "category");
      const categoryId = (catStep as any)?.data?.categoryId;
      const requiredAspects = categoryId ? await ebayInventoryApi.getRequiredAspects(categoryId) : [];
      res.json({ ...result, requiredAspects });
    } catch (err) {
      res.status(500).json({ ok: false, error: (err as Error).message });
    }
  });

  // One-shot idempotent schema upgrade (inventory columns + scale indexes).
  // Hit once after deploying the scale rewrite. Safe to re-run.
  app.get("/api/__apply-migration", async (_req, res) => {
    try {
      const result = await storage.applyScaleMigration();
      res.json({ ...result, message: "Schema upgrade applied (idempotent)." });
    } catch (error) {
      res.status(500).json({ ok: false, error: (error as Error).message });
    }
  });

  // Test the stock/price update path: push a quantity (and optional price)
  // to a listed product's Inventory offer via bulkUpdatePriceQuantity.
  // Verify on the eBay listing that the quantity/price changed.
  //   GET /api/__inventory-update-check?productId=123&qty=1&price=9.99
  app.get("/api/__inventory-update-check", async (req, res) => {
    try {
      const productId = Number(req.query.productId);
      if (!productId) return res.status(400).json({ ok: false, message: "?productId= required" });
      const product = await storage.getProduct(productId);
      if (!product) return res.status(404).json({ ok: false, message: "Product not found" });
      if (!product.ebayOfferId) {
        return res.status(400).json({ ok: false, message: "Product has no ebayOfferId (not listed via Inventory API)", sku: product.sku, listingStatus: product.ebayListingStatus });
      }
      const qty = req.query.qty !== undefined ? Number(req.query.qty) : (product.stock ?? 1);
      const price = req.query.price !== undefined ? Number(req.query.price) : (parseFloat(product.salePrice) || 0);

      const result = await ebayInventoryApi.bulkUpdatePriceQuantity([
        { sku: product.sku, offerId: product.ebayOfferId, quantity: qty, price },
      ]);
      const r = result.get(product.sku);
      res.json({
        ok: !!r?.ok,
        sku: product.sku,
        offerId: product.ebayOfferId,
        listingId: product.ebayListingId,
        sentQuantity: qty,
        sentPrice: price,
        error: r?.error,
        verifyUrl: product.ebayListingId ? `https://www.ebay.de/itm/${product.ebayListingId}` : undefined,
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: (err as Error).message });
    }
  });

  // List currently-listed Inventory products (id, sku, qty, offer, listing)
  // to pick one for the update test. GET /api/__listed-products
  app.get("/api/__listed-products", async (_req, res) => {
    try {
      const listed = await storage.getProductsWithOffers(20);
      res.json({
        count: listed.length,
        products: listed.map((p) => ({
          id: p.id, sku: p.sku, name: p.name, stock: p.stock,
          salePrice: p.salePrice, ebayOfferId: p.ebayOfferId, ebayListingId: p.ebayListingId,
          url: p.ebayListingId ? `https://www.ebay.de/itm/${p.ebayListingId}` : undefined,
        })),
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: (err as Error).message });
    }
  });

  // End an Inventory-API listing by withdrawing its offer.
  //   GET /api/__inventory-end?offerId=264031332018
  app.get("/api/__inventory-end", async (req, res) => {
    const offerId = String(req.query.offerId || "");
    if (!offerId) return res.status(400).json({ ok: false, message: "?offerId= required" });
    try {
      const r = await ebayInventoryApi.withdrawOffer(offerId);
      res.json(r);
    } catch (err) {
      res.status(500).json({ ok: false, error: (err as Error).message });
    }
  });

  // Show what eBay suggests as the category for a query on the active
  // site (DE). Returns the raw eBay XML so we can see the real structure /
  // any error. GET /api/__ebay-suggest-category?q=wheel%20robot
  app.get("/api/__ebay-suggest-category", async (req, res) => {
    const q = String(req.query.q || "");
    if (!q) return res.status(400).json({ ok: false, message: "?q= required" });
    try {
      const token = await ebayOAuth.getValidAccessToken();
      const treeId = process.env.EBAY_MARKETPLACE_SITE_ID || "77";
      const marketplaceId =
        ({ "0": "EBAY_US", "3": "EBAY_GB", "77": "EBAY_DE" } as Record<string, string>)[treeId] || "EBAY_DE";
      const url =
        `https://api.ebay.com/commerce/taxonomy/v1/category_tree/${treeId}` +
        `/get_category_suggestions?q=${encodeURIComponent(q)}`;
      const resp = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "Accept-Language": "de-DE",
          "X-EBAY-C-MARKETPLACE-ID": marketplaceId,
        },
      });
      const text = await resp.text();
      let data: any = null;
      try { data = JSON.parse(text); } catch {}
      const suggestions = (data?.categorySuggestions || []).slice(0, 5).map((s: any) => ({
        id: s.category?.categoryId,
        name: s.category?.categoryName,
        path: (s.categoryTreeNodeAncestors || []).map((a: any) => a.categoryName).reverse().join(" > "),
      }));
      res.json({
        ok: resp.ok && suggestions.length > 0,
        query: q,
        treeId,
        httpStatus: resp.status,
        suggestions,
        raw: suggestions.length ? undefined : text.slice(0, 800),
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: (err as Error).message });
    }
  });

  // credentials and returns the raw response. No DB, no listing logic.
  // Reveals exact reason for "OAuth authentication fail" errors.
  app.get("/api/__ebay-check", async (_req, res) => {
    const clientId =
      process.env.EBAY_OAUTH_CLIENT_ID || process.env.EBAY_APP_ID || "";
    const clientSecret =
      process.env.EBAY_OAUTH_CLIENT_SECRET || process.env.EBAY_CERT_ID || "";
    const refreshToken =
      process.env.EBAY_OAUTH_REFRESH_TOKEN ||
      process.env.EBAY_REFRESH_TOKEN ||
      "";

    if (!clientId || !clientSecret || !refreshToken) {
      return res.status(400).json({
        ok: false,
        stage: "config",
        message: "One or more eBay OAuth env vars are missing",
        hasClientId: !!clientId,
        hasClientSecret: !!clientSecret,
        hasRefreshToken: !!refreshToken,
      });
    }

    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString(
      "base64",
    );
    const scopes = [
      "https://api.ebay.com/oauth/api_scope",
      "https://api.ebay.com/oauth/api_scope/sell.account",
      "https://api.ebay.com/oauth/api_scope/sell.inventory",
      "https://api.ebay.com/oauth/api_scope/sell.marketing",
      "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
    ].join(" ");

    try {
      const response = await fetch(
        "https://api.ebay.com/identity/v1/oauth2/token",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: `Basic ${credentials}`,
          },
          body: new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: refreshToken,
            scope: scopes,
          }).toString(),
        },
      );

      const bodyText = await response.text();
      let bodyJson: any = null;
      try {
        bodyJson = JSON.parse(bodyText);
      } catch {}

      if (!response.ok) {
        return res.status(200).json({
          ok: false,
          stage: "ebay-rejected",
          httpStatus: response.status,
          ebayError: bodyJson?.error,
          ebayErrorDescription: bodyJson?.error_description,
          rawBody: bodyText.slice(0, 500),
        });
      }

      return res.json({
        ok: true,
        stage: "success",
        tokenType: bodyJson?.token_type,
        expiresIn: bodyJson?.expires_in,
        accessTokenPreview:
          typeof bodyJson?.access_token === "string"
            ? bodyJson.access_token.slice(0, 12) + "..."
            : null,
      });
    } catch (err) {
      return res.status(500).json({
        ok: false,
        stage: "network",
        error: (err as Error).message,
      });
    }
  });
}

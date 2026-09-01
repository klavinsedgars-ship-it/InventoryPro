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
    const tme: any = {
      // Which client the sync actually uses right now. Reported because an
      // env var only takes effect on a NEW deployment — "I set it" and "it is
      // running" are different states, and this is where that gets confirmed.
      activeVersion: process.env.TME_API_VERSION === "v2" ? "v2" : "v1 (default)",
    };
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
    if (process.env.TME_API_VERSION === "v2") {
      try {
        const { tmeApiV2 } = await import("../tme-api-v2");
        const rows = await tmeApiV2.getPricesAndStocksCompat([PROBE_SYMBOL + "-DIO"]);
        tme.v2 = { ok: true, results: rows.length, sampleStock: rows[0]?.Amount ?? null, samplePrice: rows[0]?.PriceList?.[0]?.PriceValue ?? null };
      } catch (e) {
        tme.v2 = { ok: false, error: (e as Error).message.slice(0, 200) };
        verdicts.push("TME_API_VERSION=v2 is set but the v2 client is failing — the sync cannot fetch prices/stock. Unset it to fall back to v1.");
      }
    }
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
      tmeApiVersion: process.env.TME_API_VERSION || "(unset -> v1)",
      tmeCountry: process.env.TME_COUNTRY || "(unset)",
      tmeCurrency: process.env.TME_CURRENCY || "(unset -> EUR)",
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

  /**
   * Do our EXISTING TME credentials work against API v2?
   *
   * v1 authenticates with an HMAC-SHA1 signature over (token, secret); v2 uses
   * OAuth 2.0 client_credentials with the same pair as HTTP Basic. Whether one
   * credential set serves both is not stated in the documentation, and it
   * decides whether the v2 migration starts with a portal visit or with code.
   * This answers it in one request, using only what is already in the
   * environment. Set TME_V2_TOKEN / TME_V2_SECRET to test a NEW pair instead.
   *
   * Read-only: fetches a token, then reads one product's price/stock.
   */
  app.get("/api/__tme-v2-check", async (_req, res) => {
    const token = process.env.TME_V2_TOKEN || process.env.TME_TOKEN || "";
    const secret = process.env.TME_V2_SECRET || process.env.TME_APPLICATION_SECRET || "";
    const usingDedicated = !!(process.env.TME_V2_TOKEN && process.env.TME_V2_SECRET);
    if (!token || !secret) {
      return res.json({ ok: false, stage: "config", error: "TME_TOKEN / TME_APPLICATION_SECRET not set" });
    }

    const out: any = {
      credentials: usingDedicated ? "TME_V2_TOKEN/SECRET (dedicated v2 pair)" : "existing v1 TME_TOKEN/SECRET",
      tokenLength: token.length,
    };

    // Step 1 — OAuth token
    let accessToken = "";
    try {
      const basic = Buffer.from(`${token}:${secret}`).toString("base64");
      const r = await fetch("https://api.tme.eu/auth/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${basic}`,
        },
        body: "grant_type=client_credentials",
      });
      const text = await r.text();
      let data: any = null;
      try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
      out.authToken = {
        ok: r.ok,
        httpStatus: r.status,
        expiresIn: data?.expires_in ?? null,
        hasRefreshToken: !!data?.refresh_token,
        error: r.ok ? null : (text || "").slice(0, 300),
      };
      if (!r.ok) {
        out.verdict = "Existing credentials were REJECTED by v2 — generate an API key in the developer portal (developers.tme.eu) and set TME_V2_TOKEN / TME_V2_SECRET.";
        return res.json({ ok: false, ...out });
      }
      accessToken = data?.access_token || "";
    } catch (e) {
      out.authToken = { ok: false, error: (e as Error).message };
      return res.json({ ok: false, ...out, verdict: "Could not reach https://api.tme.eu/auth/token" });
    }

    // Step 2 — a real v2 read, exercising the fields the migration depends on
    try {
      const params = new URLSearchParams();
      params.append("symbols[]", "1N4148-DIO");
      params.append("scope[]", "prices");
      params.append("scope[]", "stock");
      params.append("scope[]", "delivery");
      params.append("amounts[]", "1");
      params.append("currency", process.env.TME_CURRENCY || "EUR");
      if (process.env.TME_COUNTRY) params.append("country", process.env.TME_COUNTRY);

      const r = await fetch(`https://api.tme.eu/products/data?${params.toString()}`, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      });
      const text = await r.text();
      let data: any = null;
      try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
      const el = data?.data?.elements?.[0] ?? null;
      out.productsData = {
        ok: r.ok,
        httpStatus: r.status,
        symbol: el?.symbol ?? null,
        stockQuantity: el?.stock_quantity ?? null,
        priceCurrency: el?.prices?.currency ?? null,
        priceType: el?.prices?.type ?? null,
        taxRate: el?.prices?.tax?.rate ?? null,
        // The availability split that the whole oversell question hinges on.
        deliveries: (el?.deliveries?.elements ?? []).map((d: any) => ({ status: d.status, amount: d.amount, data: d.data })),
        error: r.ok ? null : (text || "").slice(0, 300),
      };
    } catch (e) {
      out.productsData = { ok: false, error: (e as Error).message };
    }

    const good = out.authToken?.ok && out.productsData?.ok;
    out.verdict = good
      ? (usingDedicated
          ? "v2 works with the dedicated credentials."
          : "Your EXISTING v1 credentials work on v2 — no new credentials needed. Migration is code-only.")
      : "Token issued but the v2 product read failed — see productsData.error.";
    res.json({ ok: !!good, ...out });
  });

  /**
   * Compare v1 and v2 side by side on REAL products before any cutover.
   *
   * The v2 migration changes the numbers that drive pricing and stock, so it
   * must be verified against live data rather than trusted. For each SKU this
   * reports v1's price/stock next to v2's, plus what v2 knows and v1 cannot:
   * the sellable-now quantity, incoming supply dates, and product statuses
   * that should block listing entirely.
   *   GET /api/__tme-compare?skus=1N4148-DIO,POLOLU-4037
   * With no ?skus it samples the local catalogue.
   */
  app.get("/api/__tme-compare", async (req, res) => {
    try {
      const { tmeApi } = await import("../tme-api");
      const { tmeApiV2, incomingSupplyDate, isListable } = await import("../tme-api-v2");

      let symbols: string[] = String(req.query.skus || "")
        .split(",").map((s) => s.trim()).filter(Boolean);
      if (symbols.length === 0) {
        const { rows } = await storage.getProductsPaged({ limit: 8, offset: 0 });
        symbols = rows.map((r: any) => r.supplierProductId || r.sku).filter(Boolean);
      }
      symbols = symbols.slice(0, 25);
      if (symbols.length === 0) return res.json({ ok: false, error: "no symbols to compare" });

      // No deliveries scope here: it answers "how would N units be fulfilled?"
      // for the N requested, so asking for 1 would report 1 for every product
      // regardless of real stock. Compare warehouse stock against v1 instead,
      // and use checkShippable() when the question is a specific quantity.
      const [v1, v2, v2products] = await Promise.all([
        tmeApi.getPricesAndStocks(symbols).catch((e) => ({ __error: (e as Error).message })),
        tmeApiV2.getProductsData(symbols).catch((e) => ({ __error: (e as Error).message })),
        tmeApiV2.getProducts(symbols).catch(() => [] as any[]),
      ]);
      if ((v1 as any).__error) return res.json({ ok: false, stage: "v1", error: (v1 as any).__error });
      if ((v2 as any).__error) return res.json({ ok: false, stage: "v2", error: (v2 as any).__error });

      const v1By = new Map((v1 as any[]).map((p: any) => [p.Symbol, p]));
      const statusBy = new Map((v2products as any[]).map((p: any) => [p.symbol, p.product_status ?? []]));

      const rows = (v2 as any[]).map((e: any) => {
        const a = v1By.get(e.symbol);
        const v1Stock = a ? (typeof a.Amount === "number" ? a.Amount : null) : null;
        const v1Price = a?.PriceList?.[0]?.PriceValue ?? null;
        const v2Price = e.prices?.elements?.[0]?.price ?? null;
        const sellable = Number(e.stock_quantity) || 0;
        const statuses = statusBy.get(e.symbol) ?? [];
        const listable = isListable(statuses);
        return {
          symbol: e.symbol,
          v1: { stock: v1Stock, unitPrice: v1Price },
          v2: { warehouseStock: e.stock_quantity, stock: sellable, unitPrice: v2Price, currency: e.prices?.currency, priceType: e.prices?.type },
          // The decision-relevant deltas.
          priceMatches: v1Price != null && v2Price != null ? Math.abs(v1Price - v2Price) < 0.0001 : null,
          stockDelta: v1Stock != null ? sellable - v1Stock : null,
          productStatus: statuses,
          wouldBlockListing: !listable.ok ? listable.blockedBy : null,
          shippingCautions: listable.cautions.length ? listable.cautions : null,
          incomingSupplyDate: incomingSupplyDate(e),
        };
      });

      res.json({
        ok: true,
        compared: rows.length,
        summary: {
          priceMismatches: rows.filter((r) => r.priceMatches === false).length,
          stockDiffers: rows.filter((r) => r.stockDelta != null && r.stockDelta !== 0).length,
          wouldBlock: rows.filter((r) => r.wouldBlockListing).length,
          withCautions: rows.filter((r) => r.shippingCautions).length,
        },
        rows,
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: (error as Error).message });
    }
  });

  /**
   * Why is the listing ramp's shippability guard blocking its candidates?
   *
   * The guard reported "TME cannot ship N today (only 0 in stock)" for nearly
   * every candidate while the products table said those SKUs were in stock.
   * One of the two is wrong, and the answer needs the RAW TME response next to
   * the DB row — the guard's own summary can't distinguish "TME says zero",
   * "our stock is stale", and "we asked TME the wrong question".
   *
   * Read-only: no writes, no eBay calls.
   */
  /**
   * What the ramp will use as a category when Taxonomy can't answer, and the
   * evidence behind it. The fallback is learned from suggestions eBay returned
   * for this marketplace tree, so it is worth being able to see which one won.
   */
  /**
   * THE category damage report (2026-08-28, after two buyer complaints).
   *
   * Every product's eBay category comes from one cached Taxonomy suggestion
   * per TME category, so this table IS the complete mapping: each TME
   * category, how many products (and live listings) it carries, the v1
   * suggestion that was used unvalidated, the v2 suggestion the domain guard
   * now produces, and whether the v1 answer is implausible (flagged = these
   * listings are live in a wrong category and need recategorizing).
   */
  /**
   * Repair supplier-cost snapshots on existing orders (multi-pack bug,
   * 2026-08-31): supplier_cost_at_sale was captured as TME's PER-PIECE price,
   * but a listing with MOQ 50 sells a 50-pack — real cost is unit x MOQ.
   * Dry-run by default; &confirm=1 applies. Only rows whose snapshot still
   * EQUALS the product's current unit price are touched (proof they carry the
   * buggy capture); rows where TME has since repriced are reported for a
   * manual look instead of being guessed at.
   */
  app.get("/api/__fix-pack-cost-snapshots", async (req, res) => {
    try {
      const { db } = await import("../db");
      const { sql } = await import("drizzle-orm");
      const confirm = req.query.confirm === "1";

      const affectedQ: any = await db.execute(sql`
        SELECT oi.id, oi.sku, oi.quantity, oi.supplier_cost_at_sale, p.supplier_price, p.moq
        FROM order_items oi JOIN products p ON p.id = oi.product_id
        WHERE p.moq > 1 AND oi.supplier_cost_at_sale IS NOT NULL
          AND abs(oi.supplier_cost_at_sale - p.supplier_price) < 0.005
      `);
      const fixable = (affectedQ.rows ?? affectedQ).map((r: any) => ({
        orderItemId: r.id,
        sku: r.sku,
        moq: r.moq,
        wrongCost: Number(r.supplier_cost_at_sale),
        correctedCost: Math.round(Number(r.supplier_price) * r.moq * 100) / 100,
      }));

      const driftedQ: any = await db.execute(sql`
        SELECT oi.id, oi.sku, oi.supplier_cost_at_sale, p.supplier_price, p.moq
        FROM order_items oi JOIN products p ON p.id = oi.product_id
        WHERE p.moq > 1 AND oi.supplier_cost_at_sale IS NOT NULL
          AND abs(oi.supplier_cost_at_sale - p.supplier_price) >= 0.005
          AND abs(oi.supplier_cost_at_sale - p.supplier_price * p.moq) >= 0.005
      `);

      let updated = 0;
      if (confirm && fixable.length > 0) {
        const r: any = await db.execute(sql`
          UPDATE order_items oi
          SET supplier_cost_at_sale = round(p.supplier_price * p.moq, 2)
          FROM products p
          WHERE p.id = oi.product_id AND p.moq > 1 AND oi.supplier_cost_at_sale IS NOT NULL
            AND abs(oi.supplier_cost_at_sale - p.supplier_price) < 0.005
        `);
        updated = r.rowCount ?? 0;
      }

      res.json({
        ok: true,
        dryRun: !confirm,
        fixable,
        updated,
        // Snapshot matches neither the unit nor the package price — TME
        // repriced since the sale; decide these by hand (there should be
        // very few orders in total).
        needsManualLook: driftedQ.rows ?? driftedQ,
        hint: confirm ? "done" : "add &confirm=1 to apply the corrections listed in fixable",
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: (error as Error).message });
    }
  });

  app.get("/api/__category-map", async (_req, res) => {
    try {
      const { isImplausibleCategoryPath, categoryQueryFor } = await import("../ebay-category-query");
      const { db } = await import("../db");
      const { sql } = await import("drizzle-orm");
      const treeId = process.env.EBAY_MARKETPLACE_SITE_ID || "77";

      const prodQ: any = await db.execute(sql`
        SELECT category,
               count(*)::int AS products,
               count(*) FILTER (WHERE listed_on_ebay = true)::int AS listed
        FROM products
        WHERE supplier = 'TME'
        GROUP BY category
        ORDER BY count(*) FILTER (WHERE listed_on_ebay = true) DESC, count(*) DESC
      `);
      const cacheQ: any = await db.execute(sql`
        SELECT cache_key, value FROM ebay_taxonomy_cache
        WHERE (cache_key LIKE ${"suggest:" + treeId + ":%"} OR cache_key LIKE ${"suggest2:" + treeId + ":%"})
          AND expires_at > now()
      `);
      const v1 = new Map<string, any>();
      const v2 = new Map<string, any>();
      for (const r of cacheQ.rows ?? cacheQ) {
        try {
          const val = JSON.parse(r.value);
          const k: string = r.cache_key;
          if (k.startsWith("suggest2:")) v2.set(k.slice(`suggest2:${treeId}:`.length), val);
          else v1.set(k.slice(`suggest:${treeId}:`.length), val);
        } catch { /* skip malformed rows */ }
      }

      // ?resolve=1: actively resolve every category with live listings
      // through the guarded path (one cached Taxonomy call each) so
      // guardedCategory fills in and old-vs-new becomes definitive. ~1 call
      // per category on the first run, cached 30 days after.
      const doResolve = _req.query?.resolve === "1";
      if (doResolve) {
        const { ebayApi } = await import("../ebay-api");
        for (const p of prodQ.rows ?? prodQ) {
          if (!p.listed) continue;
          const key = categoryQueryFor({ category: p.category, name: "" }).trim().toLowerCase();
          if (v2.has(key)) continue;
          const resolved = await ebayApi.getSuggestedCategory(key).catch(() => null);
          v2.set(key, resolved ?? { id: "", name: "", path: "" });
        }
      }

      let flaggedListed = 0;
      const rows = (prodQ.rows ?? prodQ).map((p: any) => {
        const key = categoryQueryFor({ category: p.category, name: "" }).trim().toLowerCase();
        const old = v1.get(key) ?? null;
        const now = v2.get(key) ?? null;
        // v1 cached only id+name; judge what we can see. A name like
        // "Synthesizer-Teile" is enough to convict.
        const flagged = !!old?.id && isImplausibleCategoryPath(old.name ?? "");
        if (flagged) flaggedListed += p.listed;
        return {
          tmeCategory: p.category,
          products: p.products,
          listed: p.listed,
          usedCategory: old, // what live listings were filed under (v1)
          guardedCategory: now, // what the guard resolves now (v2; null = not yet looked up, id "" = fallback)
          // The definitive signal once both sides are known: the live
          // listings sit somewhere the guarded resolver would not put them.
          changed: !!old?.id && now != null && old.id !== (now.id || null),
          flagged,
        };
      });

      res.json({
        ok: true,
        treeId,
        note: "flagged = the v1 name alone is provably wrong; v1 names without an obvious domain word can still be wrong — sort by listed and eyeball usedCategory.",
        categories: rows.length,
        flaggedCategories: rows.filter((r: any) => r.flagged).length,
        flaggedListedListings: flaggedListed,
        rows,
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: (error as Error).message });
    }
  });

  app.get("/api/__default-category", async (_req, res) => {
    try {
      const { ebayInventoryApi } = await import("../ebay-inventory-api");
      const { pickDefaultCategory } = await import("../ebay-category-query");
      const treeId = process.env.EBAY_MARKETPLACE_SITE_ID || "77";
      const suggestions = await storage.getCachedCategorySuggestions(treeId);
      const { scoreCategoryGenerality } = await import("../ebay-category-query");
      const picked = pickDefaultCategory(suggestions);
      const top = new Map<string, { name: string; count: number }>();
      for (const s of suggestions) {
        if (!s.id) continue;
        const e = top.get(s.id);
        if (e) e.count++;
        else top.set(s.id, { name: s.name ?? "", count: 1 });
      }
      res.json({
        ok: true,
        treeId,
        inUse: await ebayInventoryApi.defaultCategoryId(),
        source: process.env.EBAY_DEFAULT_CATEGORY_ID ? "env override" : "learned from eBay's own suggestions",
        learned: picked,
        cachedSuggestions: suggestions.length,
        // generality 0 = a specific product category, never eligible as a
        // fallback however often eBay suggests it.
        distribution: Array.from(top.entries())
          .map(([id, e]) => ({ id, name: e.name, count: e.count, generality: scoreCategoryGenerality(e.name) }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 10),
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: (error as Error).message });
    }
  });

  /**
   * Did eBay really return no orders, or did we drop them?
   *
   * A sync reporting 0 new / 0 updated / 0 failed is ambiguous: an account
   * with no sales and a parser that discards every order look identical from
   * the outside. This shows eBay's own totals next to what we hold, so the
   * three cases separate: no sales, an auth/scope problem, or an import bug.
   */
  /**
   * Is the catalogue count real?
   *
   * `sku` is UNIQUE, so exact duplicates cannot exist — but Postgres compares
   * it case-sensitively, so "DF-0077" and "df-0077" are two rows to the
   * database and one product to a supplier. This checks that and the other
   * ways a headline count misleads: rows counted that are blocked or not
   * really ours, two products claiming the same eBay listing, and the same TME
   * symbol behind different SKUs.
   *
   * Read-only.
   */
  app.get("/api/__data-integrity", async (_req, res) => {
    try {
      const { db } = await import("../db");
      const { sql } = await import("drizzle-orm");
      const one = async (q: any) => ((await db.execute(q)) as any).rows?.[0] ?? {};
      const many = async (q: any) => (((await db.execute(q)) as any).rows ?? []) as any[];

      const counts = await one(sql`
        SELECT
          COUNT(*)::int                                          AS total_rows,
          COUNT(DISTINCT upper(sku))::int                        AS distinct_sku_ci,
          COUNT(*) FILTER (WHERE supplier = 'TME')::int          AS tme_rows,
          COUNT(*) FILTER (WHERE supplier <> 'TME' OR supplier IS NULL)::int AS non_tme_rows,
          COUNT(*) FILTER (WHERE listed_on_ebay)::int            AS listed,
          COUNT(*) FILTER (WHERE listed_on_ebay AND ebay_listing_id IS NULL)::int AS listed_without_listing_id,
          COUNT(DISTINCT ebay_listing_id) FILTER (WHERE ebay_listing_id IS NOT NULL)::int AS distinct_listing_ids,
          COUNT(*) FILTER (WHERE ebay_listing_id IS NOT NULL)::int AS rows_with_listing_id,
          COUNT(*) FILTER (WHERE status = 'blocked')::int        AS blocked_rows,
          COUNT(*) FILTER (WHERE stock = 0)::int                 AS zero_stock,
          COUNT(*) FILTER (WHERE sale_price IS NULL OR sale_price::numeric <= 0)::int AS no_price
        FROM products
      `);

      // Same supplier symbol behind more than one SKU: a genuine duplicate
      // product, which the UNIQUE constraint on sku cannot catch.
      const dupSymbols = await many(sql`
        SELECT upper(supplier_product_id) AS symbol, COUNT(*)::int AS rows,
               array_agg(sku ORDER BY id) AS skus
        FROM products
        WHERE supplier_product_id IS NOT NULL AND supplier_product_id <> ''
        GROUP BY 1 HAVING COUNT(*) > 1
        ORDER BY 2 DESC LIMIT 20
      `);

      // Two products pointing at one eBay listing — an oversell waiting to
      // happen, since both would push stock to the same item.
      const dupListings = await many(sql`
        SELECT ebay_listing_id, COUNT(*)::int AS rows, array_agg(sku ORDER BY id) AS skus
        FROM products
        WHERE ebay_listing_id IS NOT NULL AND ebay_listing_id <> ''
        GROUP BY 1 HAVING COUNT(*) > 1
        ORDER BY 2 DESC LIMIT 20
      `);

      const caseDupes = await many(sql`
        SELECT upper(sku) AS code, COUNT(*)::int AS rows, array_agg(sku ORDER BY id) AS variants
        FROM products GROUP BY 1 HAVING COUNT(*) > 1
        ORDER BY 2 DESC LIMIT 20
      `);

      const totalRows = Number(counts.total_rows) || 0;
      const findings: string[] = [];
      if (Number(counts.distinct_sku_ci) < totalRows) {
        findings.push(`${totalRows - Number(counts.distinct_sku_ci)} SKU(s) differ only by letter case — the same product stored twice`);
      }
      if (dupSymbols.length > 0) findings.push(`${dupSymbols.length}+ TME symbol(s) appear under more than one SKU`);
      if (dupListings.length > 0) findings.push(`${dupListings.length}+ eBay listing id(s) claimed by more than one product — oversell risk`);
      if (Number(counts.listed_without_listing_id) > 0) {
        findings.push(`${counts.listed_without_listing_id} product(s) marked listed but carry no eBay listing id`);
      }
      if (Number(counts.blocked_rows) > 0) {
        findings.push(`${counts.blocked_rows} blocked product(s) are still counted in the dashboard's "Total Products"`);
      }

      res.json({
        ok: true,
        headline: {
          totalProducts: totalRows,
          distinctSkusCaseInsensitive: Number(counts.distinct_sku_ci),
          listed: Number(counts.listed),
          distinctEbayListingIds: Number(counts.distinct_listing_ids),
        },
        counts,
        duplicateSymbols: dupSymbols,
        duplicateListingIds: dupListings,
        caseOnlyDuplicateSkus: caseDupes,
        findings: findings.length ? findings : ["No duplicate or inconsistency found"],
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: (error as Error).message });
    }
  });

  app.get("/api/__ebay-orders-probe", async (req, res) => {
    try {
      const days = Math.min(365, Math.max(1, Number(req.query.days) || 90));
      const { ebayOrdersApi } = await import("../ebay-orders-api");
      const from = new Date();
      from.setDate(from.getDate() - days);

      const out: any = { days, windowFrom: from.toISOString() };

      // 1) Filtered exactly as the sync asks for it.
      try {
        const r: any = await ebayOrdersApi.getOrders({
          creationDateFrom: from.toISOString(),
          creationDateTo: new Date().toISOString(),
          limit: 10,
        });
        out.filtered = {
          total: r?.total ?? null,
          returned: (r?.orders ?? []).length,
          firstOrder: (r?.orders ?? [])[0]
            ? {
                orderId: r.orders[0].orderId,
                creationDate: r.orders[0].creationDate,
                orderFulfillmentStatus: r.orders[0].orderFulfillmentStatus,
                lineItemCount: (r.orders[0].lineItems ?? []).length,
                firstSku: r.orders[0].lineItems?.[0]?.sku ?? null,
              }
            : null,
        };
      } catch (e) {
        out.filtered = { error: (e as Error).message };
      }

      // 2) UNFILTERED. If this returns orders while the filtered call doesn't,
      //    the date filter is the problem, not the account.
      try {
        const r: any = await ebayOrdersApi.getOrders({ limit: 10 });
        out.unfiltered = {
          total: r?.total ?? null,
          returned: (r?.orders ?? []).length,
          newestCreationDate: (r?.orders ?? [])[0]?.creationDate ?? null,
        };
      } catch (e) {
        out.unfiltered = { error: (e as Error).message };
      }

      // 3) What we actually hold, so "eBay has them but we don't" is visible.
      try {
        const { db } = await import("../db");
        const { sql } = await import("drizzle-orm");
        const q: any = await db.execute(sql`
          SELECT COUNT(*)::int AS orders,
                 MIN(order_date) AS oldest,
                 MAX(order_date) AS newest
          FROM orders`);
        const items: any = await db.execute(sql`SELECT COUNT(*)::int AS line_items FROM order_items`);
        out.local = { ...((q.rows ?? q)[0] ?? {}), ...((items.rows ?? items)[0] ?? {}) };
      } catch (e) {
        out.local = { error: (e as Error).message };
      }

      out.verdict =
        out.filtered?.error || out.unfiltered?.error
          ? "eBay call failed — check the error (scope/auth most likely)"
          : (out.unfiltered?.total ?? 0) === 0
            ? "eBay reports no orders on this account at all"
            : (out.filtered?.total ?? 0) === 0
              ? "eBay has orders, but none in the requested window — check the date filter"
              : (out.local?.orders ?? 0) === 0
                ? "eBay returned orders but none were imported — import bug"
                : "orders present on both sides";

      res.json({ ok: true, ...out });
    } catch (error) {
      res.status(500).json({ ok: false, error: (error as Error).message });
    }
  });

  app.get("/api/__ramp-block-check", async (req, res) => {
    try {
      const { tmeApiV2, shippableNow, deliveryShippable, incomingSupplyDate } = await import("../tme-api-v2");
      const { calculateEbayStock } = await import("../stock-manager");

      const { getRampPriceRange } = await import("../ramp-config");
      const limit = Math.min(25, Math.max(1, Number(req.query.limit) || 10));
      // Same band the ramp uses, so this inspects the ramp's real queue.
      const range = await getRampPriceRange();

      const candidates = await storage.getListingCandidates(limit, range);
      if (candidates.length === 0) return res.json({ ok: true, candidates: 0, note: "no ramp candidates in the current price band" });

      const symbols = candidates.map((p: any) => p.supplierProductId || p.sku);
      const wanted = candidates.map((p: any) => Math.max(1, calculateEbayStock(p).ebayStock));

      // The exact call the guard makes, plus a no-deliveries call for the same
      // symbols so warehouse stock can be compared against the delivery split.
      const [withDel, plain] = await Promise.all([
        tmeApiV2.getProductsData(symbols, { withDeliveries: true, amounts: wanted })
          .catch((e) => ({ __error: (e as Error).message })),
        tmeApiV2.getProductsData(symbols).catch((e) => ({ __error: (e as Error).message })),
      ]);
      if ((withDel as any).__error) return res.json({ ok: false, stage: "deliveries", error: (withDel as any).__error });

      const delBy = new Map((withDel as any[]).map((e: any) => [e.symbol, e]));
      const plainBy = new Map((Array.isArray(plain) ? plain : []).map((e: any) => [e.symbol, e]));

      const rows = candidates.map((p: any, i: number) => {
        const sym = symbols[i];
        const d = delBy.get(sym);
        const pl = plainBy.get(sym);
        return {
          sku: p.sku,
          symbol: sym,
          requested: wanted[i],
          db: { stock: p.stock, moq: p.moq, multiples: p.multiples, salePrice: p.salePrice, lastSyncedAt: p.lastSyncedAt },
          tme: {
            returned: !!d,
            warehouseStock: d?.stock_quantity ?? pl?.stock_quantity ?? null,
            shippableNow: d ? shippableNow(d).units : null,
            basis: d ? shippableNow(d).basis : null,
            // null here means TME supplied no breakdown at all — which is NOT
            // the same as a breakdown that says nothing ships.
            fromDeliveries: d ? deliveryShippable(d) : null,
            deliveries: d?.deliveries?.elements ?? null,
            incomingSupplyDate: d ? incomingSupplyDate(d) : null,
          },
          verdict: !d
            ? "not returned by TME (guard lets it through)"
            : shippableNow(d).units <= 0
              ? "BLOCKED — nothing shippable"
              : shippableNow(d).units < wanted[i]
                ? `would list at reduced quantity ${shippableNow(d).units}`
                : "would list",
        };
      });

      // Every distinct delivery status seen, so a status we don't treat as
      // in-stock shows up by name instead of silently summing to zero.
      const statusCounts: Record<string, number> = {};
      for (const r of rows) {
        for (const d of (r.tme.deliveries ?? []) as any[]) {
          statusCounts[d.status] = (statusCounts[d.status] ?? 0) + 1;
        }
      }

      res.json({
        ok: true,
        candidates: rows.length,
        priceBand: range,
        summary: {
          blocked: rows.filter((r) => r.verdict.startsWith("BLOCKED")).length,
          wouldList: rows.filter((r) => r.verdict.startsWith("would list")).length,
          reducedQuantity: rows.filter((r) => r.verdict.includes("reduced")).length,
          dbSaysInStockButTmeSaysZero: rows.filter(
            (r) => (r.db.stock ?? 0) > 0 && (r.tme.warehouseStock ?? 0) === 0,
          ).length,
          // The bug this endpoint was built to find: TME sends no delivery
          // breakdown, which the guard used to read as "nothing can ship".
          warehouseStockButNoDeliveryData: rows.filter(
            (r) => (r.tme.warehouseStock ?? 0) > 0 && r.tme.fromDeliveries === null,
          ).length,
        },
        deliveryStatusesSeen: statusCounts,
        rows,
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: (error as Error).message });
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

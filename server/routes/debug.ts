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
      // Cheapest live call: ask for one well-known TME SKU
      const probe = await (tmeApi as any)
        .getProductsPricesAndStocks?.(["AVT-LITE"])
        .catch((e: Error) => ({ __error: e.message }));
      if (probe?.__error) {
        return res.json({ ok: false, stage: "tme-api", have, error: probe.__error });
      }
      return res.json({
        ok: true,
        stage: "success",
        have,
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

import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { requireAuth } from "./middleware/auth";
import { registerRepricingRoutes } from "./routes/repricing";
import { registerMessageRoutes } from "./routes/messages";
import { registerOrderRoutes } from "./routes/orders";
import { registerEbayConfigRoutes } from "./routes/ebay-config";
import { registerTmeRoutes } from "./routes/tme";
import { registerProductRoutes } from "./routes/products";
import { registerImageRoutes } from "./routes/images";
import { registerSyncRoutes } from "./routes/sync";
import { registerOpsRoutes } from "./routes/ops";
import { registerPricingRoutes } from "./routes/pricing";
import { registerEbayListingRoutes } from "./routes/ebay-listing";
import {
  insertProductSchema,
  insertUserSchema, 
  insertCategorySchema, 
  loginSchema,
  type Product,
  type User 
} from "@shared/schema";
import { ZodError, z } from "zod";
import bcrypt from "bcryptjs";
import { tmeApi } from "./tme-api";
import { tmeApiOptimized } from "./tme-api-optimized";
import { ebayInventoryApi } from "./ebay-inventory-api";
import { ebayOAuth } from "./ebay-oauth";
import { ebayAccountApi } from "./ebay-account-api";
import fs from 'fs';
import path from 'path';
import { findValidEbayCategory, getCategoryNameById } from "./ebay-category-finder";
import { findBestCategoryForProduct, explainCategoryChoice, categorizeBatch } from "./product-category-matcher";
import {
  calculateDynamicPrice,
  calculatePriceWithFloor,
} from "./dynamic-pricing";
import { getFeeConfig } from "./fee-config";
import { calculateNetProfit } from "./fee-model";
import { calculateEbayStock, calculateBulkEbayStock, validateStockLimit, getRecommendedStockLimit } from "./stock-manager";
import { processTmeSyncChunk } from "./tme-sync";
import { randomUUID } from "crypto";
import { ebayOrdersApi } from "./ebay-orders-api";
import { ebayMessagesApi } from "./ebay-messages-api";
import { 
  insertMessageTemplateSchema, 
  insertAutoMessageRuleSchema 
} from "@shared/schema";

// Type for authenticated requests
interface AuthenticatedRequest extends Request {
  session: any;
}

// How many TME symbols to import per sync-job chunk. Kept small so each chunk
// finishes well within the serverless function timeout.

// Shape the client polls for live sync progress.

export async function registerRoutes(app: Express): Promise<Server> {

  // Auth middleware - production-ready with optional bypass.
  // When BYPASS_AUTH=true, every request is treated as authenticated as
  // the seeded admin (looked up by username, since the auto-generated id
  // depends on insert order and varies per DB). Intended for demo/staging
  // only; never set this in real production.
  // Auth routes
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { username, password } = loginSchema.parse(req.body);

      const user = await storage.getUserByUsername(username);
      if (!user) {
        return res.status(401).json({ message: "Invalid credentials" });
      }

      const isPasswordValid = await bcrypt.compare(password, user.password);
      if (!isPasswordValid) {
        return res.status(401).json({ message: "Invalid credentials" });
      }

      (req.session as any).userId = user.id;
      const { password: _, ...userWithoutPassword } = user;
      res.json({ user: userWithoutPassword });
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({ message: "Invalid input", errors: error.errors });
      }
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy((err: any) => {
      if (err) {
        return res.status(500).json({ message: "Could not log out" });
      }
      res.json({ message: "Logged out successfully" });
    });
  });

  // Public, unauthenticated config the frontend needs to render correctly
  // (e.g. which eBay domain to link listings to). No secrets.
  app.get("/api/public-config", (_req, res) => {
    const siteId = process.env.EBAY_MARKETPLACE_SITE_ID || "3";
    // eBay site-id -> consumer domain
    const SITE_DOMAINS: Record<string, string> = {
      "0": "www.ebay.com",
      "3": "www.ebay.co.uk",
      "77": "www.ebay.de",
      "71": "www.ebay.fr",
      "101": "www.ebay.it",
      "186": "www.ebay.es",
      "205": "www.ebay.ie",
      "23": "www.ebay.be",
      "146": "www.ebay.nl",
      "16": "www.ebay.com.au",
    };
    res.json({
      ebaySiteId: siteId,
      ebayDomain: SITE_DOMAINS[siteId] || "www.ebay.com",
    });
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
      const { tmeApi } = await import("./tme-api");
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

  // List a batch of candidate products on eBay via the Inventory API.
  // Body: { limit } (default 25) lists the next N unlisted in-stock TME
  // products; or { productIds: [...] } to list specific ones.
  app.post("/api/ebay/inventory-list-batch", requireAuth, async (req, res) => {
    try {
      const { listProductsViaInventory, listProductsViaInventoryBulk } = await import("./ebay-lister");
      let products;
      if (Array.isArray(req.body?.productIds) && req.body.productIds.length) {
        products = (await Promise.all(req.body.productIds.map((id: number) => storage.getProduct(id)))).filter(Boolean);
      } else {
        const limit = Math.min(Number(req.body?.limit) || 25, 200);
        products = await storage.getListingCandidates(limit);
      }
      if (!products.length) return res.json({ success: true, attempted: 0, published: 0, failed: 0, message: "No candidates" });
      // Default to the proven per-product flow (ensures location, resilient
      // per item). Pass mode:"bulk" to use the 25-SKU bulk path. The server
      // ramp calls the bulk function directly, not this route.
      const result = req.body?.mode === "bulk"
        ? await listProductsViaInventoryBulk(products as any)
        : await listProductsViaInventory(products as any);
      res.json({ success: true, mode: req.body?.mode === "bulk" ? "bulk" : "single", ...result });
    } catch (error) {
      console.error("Inventory list-batch failed:", error);
      res.status(500).json({ success: false, error: (error as Error).message });
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

  app.get("/api/auth/me", requireAuth, async (req, res) => {
    // When BYPASS_AUTH is on, never depend on the DB - return a synthetic
    // admin so the frontend can render even on a fresh / mis-seeded DB.
    if (process.env.BYPASS_AUTH === "true") {
      return res.json({
        user: {
          id: (req.session as any).userId ?? 0,
          username: "admin",
          email: "admin@inventorysync.com",
          role: "admin",
        },
      });
    }

    try {
      const user = await storage.getUser((req.session as any).userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      const { password: _, ...userWithoutPassword } = user;
      res.json({ user: userWithoutPassword });
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Dashboard routes
  app.get("/api/dashboard/metrics", requireAuth, async (req, res) => {
    try {
      const metrics = await storage.getDashboardMetrics();
      res.json(metrics);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch dashboard metrics" });
    }
  });

  // Dynamic Pricing API routes
  registerPricingRoutes(app);

  // Unauthenticated diagnostic: confirms whether THIS deployment has the
  // €4-net price floor active. Open in a browser:
  //   /api/__pricing-check?supplierPrice=0.5&weight=10&moq=1
  // If "floorApplied" is true and finalPriceWithFloor > tierPriceNoFloor,
  // the new pricing is live. A 404 means the old build is deployed.
  app.get("/api/__pricing-check", async (req, res) => {
    try {
      const supplierPrice = parseFloat((req.query.supplierPrice as string) || "0.5");
      const weightGrams = req.query.weight ? parseFloat(req.query.weight as string) : null;
      const moq = req.query.moq ? parseInt(req.query.moq as string, 10) : 1;
      const config = await getFeeConfig("ebay");
      const tier = calculateDynamicPrice(supplierPrice);
      const withFloor = calculatePriceWithFloor(supplierPrice, {
        moq,
        weightGrams,
        marketplace: "ebay",
        config,
      });
      const breakdown = calculateNetProfit({
        salePrice: withFloor.finalPrice,
        packageSupplierCost: supplierPrice * (moq > 1 ? moq : 1),
        weightGrams,
        marketplace: "ebay",
        config,
      });
      res.json({
        input: { supplierPrice, weightGrams, moq },
        targetMinNetProfit: config.targetMinNetProfit,
        tierPriceNoFloor: tier.finalPrice,
        finalPriceWithFloor: withFloor.finalPrice,
        floorApplied: withFloor.finalPrice > tier.finalPrice,
        netProfitAtFinal: breakdown.netProfit,
        note: "If floorApplied is true, the €4-net pricing is live in this deployment.",
      });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Read-only diagnostic: how eBay listing ids are distributed across TME
  // products. The cron pushes price/stock to eBay ONLY for listed products
  // that carry an Inventory-API ebay_offer_id; legacy Trading-API listings
  // (ebay_item_id only) are currently skipped. Open on the deployed URL:
  //   /api/__ebay-id-stats
  // "cronCanPush" = listings the cron updates today; "cronSkipsLegacy" =
  // listed products it silently skips because they have no offer id.
  app.get("/api/__ebay-id-stats", async (_req, res) => {
    try {
      const s = await storage.getEbayListingStats();
      res.json({
        ...s,
        cronCanPush: s.listedWithOfferId,
        cronSkipsLegacy: s.listedItemIdOnly,
        note:
          "Cron pushes price/stock to eBay only for listed products with ebay_offer_id (Inventory API). " +
          "cronSkipsLegacy are listed via Trading-API ebay_item_id only and are NOT updated on eBay by the cron.",
      });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  registerOpsRoutes(app);

  // Marketplace settings (fee rates, VAT, target profit, etc.)
  app.get("/api/marketplace-settings/:marketplace", requireAuth, async (req, res) => {
    try {
      const rows = await storage.getMarketplaceSettings(req.params.marketplace);
      res.json({ settings: rows });
    } catch (error) {
      res.status(500).json({ message: "Failed to load marketplace settings" });
    }
  });

  app.put("/api/marketplace-settings/:marketplace", requireAuth, async (req, res) => {
    try {
      const marketplace = req.params.marketplace;
      const settings = req.body?.settings;
      if (!Array.isArray(settings)) {
        return res.status(400).json({ message: "settings array is required" });
      }
      const saved = [];
      for (const entry of settings) {
        if (!entry || typeof entry.setting !== "string") continue;
        saved.push(
          await storage.setMarketplaceSetting({
            marketplace,
            setting: entry.setting,
            value: String(entry.value),
          }),
        );
      }
      res.json({ settings: saved });
    } catch (error) {
      res.status(500).json({ message: "Failed to save marketplace settings" });
    }
  });

  // Inventory analytics for the Reports page (DB-side aggregates).
  app.get("/api/analytics/inventory", requireAuth, async (_req, res) => {
    try {
      const data = await storage.getInventoryAnalytics();
      res.json(data);
    } catch (error) {
      console.error("Inventory analytics failed:", error);
      res.status(500).json({ message: "Failed to fetch inventory analytics" });
    }
  });

  // Realized sales & real profit (revenue − eBay fees − VAT − supplier cost
  // − postage − packaging), aggregated from synced orders.
  app.get("/api/analytics/sales", requireAuth, async (req, res) => {
    try {
      const config = await getFeeConfig("ebay");
      const vatFrac = config.vatPct / (1 + config.vatPct);
      const round2 = (n: number) => Math.round(n * 100) / 100;

      // Bound the analytics window. Default 12 months — overridable via
      // ?months=N (max 60). Was unbounded, which loaded every order ever
      // PLUS every product (for supplier-cost lookup) into JS.
      const months = Math.min(60, Math.max(1, Number(req.query.months) || 12));
      const since = new Date();
      since.setMonth(since.getMonth() - months);
      const orders = await storage.getOrders({ fromDate: since });

      const totals = {
        orders: 0, items: 0, revenue: 0, shipping: 0,
        fees: 0, vat: 0, supplierCost: 0, postage: 0, packaging: 0, netProfit: 0,
      };
      const monthlyMap = new Map<string, { month: string; revenue: number; netProfit: number; orders: number }>();
      const mpMap = new Map<string, { marketplace: string; orders: number; revenue: number; netProfit: number }>();
      let usedActualFees = false;

      // Batch-load order items and fees in two queries (was 2N queries — one
      // per order — which would time out at a few thousand orders).
      const activeOrders = orders.filter((o) => o.status !== "cancelled");
      const orderIds = activeOrders.map((o) => o.id);
      const itemsByOrder = await storage.getOrderItemsByOrderIds(orderIds);
      const feesByOrder = await storage.getOrderFeesByOrderIds(orderIds);

      // Only fetch supplier prices for SKUs actually present in these orders
      // (typically a small fraction of the catalogue). Replaces loading all
      // 100k products into a bySku map.
      const skuSet = new Set<string>();
      for (const items of Array.from(itemsByOrder.values())) {
        for (const it of items) if (it.sku) skuSet.add(it.sku);
      }
      const supplierBySku = await storage.getSupplierPricesBySkus(Array.from(skuSet));

      for (const order of activeOrders) {
        const items = itemsByOrder.get(order.id) ?? [];
        const feeRows = feesByOrder.get(order.id) ?? [];

        const subtotal = parseFloat(order.subtotal) || 0;
        const shipping = parseFloat(order.shippingCost) || 0;
        const gross = subtotal + shipping;

        const actualFee = feeRows.reduce((s, f) => s + (parseFloat(f.amount) || 0), 0);
        const fee = actualFee > 0 ? actualFee : config.ebayFvfPct * gross + config.ebayFixedFee;
        if (actualFee > 0) usedActualFees = true;

        const vat = vatFrac * subtotal;
        const postage = shipping / (1 + config.postageMarkup);
        const packaging = config.packagingCost;

        let supplierCost = 0;
        let itemCount = 0;
        for (const it of items) {
          // Prefer the cost snapshotted at sale time (accurate, immune to later
          // TME price drift); fall back to the current product price for orders
          // imported before snapshotting existed.
          const snapshot = (it as any).supplierCostAtSale;
          const fallbackPrice = supplierBySku.get(it.sku);
          const cost = snapshot != null
            ? parseFloat(snapshot) || 0
            : (fallbackPrice ? parseFloat(fallbackPrice) || 0 : 0);
          supplierCost += cost * (it.quantity || 1);
          itemCount += it.quantity || 1;
        }

        const netProfit = gross - fee - vat - supplierCost - postage - packaging;

        totals.orders++;
        totals.items += itemCount;
        totals.revenue += subtotal;
        totals.shipping += shipping;
        totals.fees += fee;
        totals.vat += vat;
        totals.supplierCost += supplierCost;
        totals.postage += postage;
        totals.packaging += packaging;
        totals.netProfit += netProfit;

        const d = order.orderDate ? new Date(order.orderDate) : new Date(order.createdAt as any);
        const month = isNaN(d.getTime()) ? "unknown" : d.toISOString().slice(0, 7);
        const m = monthlyMap.get(month) || { month, revenue: 0, netProfit: 0, orders: 0 };
        m.revenue += subtotal;
        m.netProfit += netProfit;
        m.orders++;
        monthlyMap.set(month, m);

        const mp = order.marketplace || "unknown";
        const mm = mpMap.get(mp) || { marketplace: mp, orders: 0, revenue: 0, netProfit: 0 };
        mm.orders++;
        mm.revenue += subtotal;
        mm.netProfit += netProfit;
        mpMap.set(mp, mm);
      }

      const totalsRounded: Record<string, number> = {};
      for (const [k, v] of Object.entries(totals)) totalsRounded[k] = round2(v);
      totalsRounded.netMarginPct = totals.revenue > 0 ? round2((totals.netProfit / totals.revenue) * 100) : 0;

      res.json({
        totals: totalsRounded,
        monthly: Array.from(monthlyMap.values())
          .sort((a, b) => a.month.localeCompare(b.month))
          .map((m) => ({ ...m, revenue: round2(m.revenue), netProfit: round2(m.netProfit) })),
        byMarketplace: Array.from(mpMap.values()).map((m) => ({
          ...m,
          revenue: round2(m.revenue),
          netProfit: round2(m.netProfit),
        })),
        assumptions: [
          usedActualFees
            ? "eBay fees use actual recorded marketplace fees where available."
            : `eBay fees estimated at ${(config.ebayFvfPct * 100).toFixed(1)}% + €${config.ebayFixedFee.toFixed(2)} (no actual fees recorded yet).`,
          "Supplier cost uses the current TME cost (cost at sale time is not stored).",
          `VAT ${(config.vatPct * 100).toFixed(0)}% on item subtotal; postage = buyer shipping / ${(1 + config.postageMarkup).toFixed(2)}.`,
        ],
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to compute sales analytics" });
    }
  });


  // Server-side paginated + filtered products (Products page). Returns the page
  // rows + the total matching count so the page never downloads the whole
  // catalogue. Left the legacy array endpoint below untouched (other callers
  // still use it).
  registerProductRoutes(app);

  // Categories routes
  app.get("/api/categories", requireAuth, async (req, res) => {
    try {
      const categories = await storage.getCategories();
      res.json(categories);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch categories" });
    }
  });

  app.post("/api/categories", requireAuth, async (req, res) => {
    try {
      const categoryData = insertCategorySchema.parse(req.body);
      const category = await storage.createCategory(categoryData);
      res.status(201).json(category);
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({ message: "Invalid input", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create category" });
    }
  });

  // eBay API routes
  registerEbayListingRoutes(app);

  // Reset ALL local eBay listing flags (green-E). Use after ending every
  // listing on eBay so the CRM matches reality. GET /api/__reset-ebay-flags
  app.get("/api/__reset-ebay-flags", async (_req, res) => {
    try {
      const cleared = await storage.resetAllEbayListingState();
      res.json({ ok: true, cleared, message: `Cleared eBay listing state on ${cleared} products.` });
    } catch (error) {
      res.status(500).json({ ok: false, error: (error as Error).message });
    }
  });


  registerEbayConfigRoutes(app);

    // TME API routes - Enhanced

    // DIAGNOSTIC: dump the raw GetPricesAndStocks response for one symbol so we
    // can see exactly which fields TME returns for available vs expected stock.
    // Added for the 2026-06-16 oversell incident: a "0 available / 70 expected"
    // SKU reported stock 70 to our sync and got relisted. We need the real
    // field names before correcting extractStock — do NOT guess.
    //   GET /api/tme/stock-debug?symbol=CA-HDMI11CC-0005BK
  registerTmeRoutes(app);


  // Stock Management Endpoints
  app.get("/api/stock/info", async (req, res) => {
    try {
      const products = await storage.getProducts();
      const stockInfo = calculateBulkEbayStock(products);

      res.json({
        success: true,
        stockInfo: stockInfo.map(item => ({
          id: item.id,
          ...item.stockInfo
        }))
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: (error as Error).message
      });
    }
  });

  // Update stock limit for a product
  app.patch("/api/products/:id/stock-limit", async (req, res) => {
    try {
      const productId = parseInt(req.params.id);
      const { ebayStockLimit, useStockLimit } = req.body;

      if (ebayStockLimit !== undefined) {
        const validation = validateStockLimit(ebayStockLimit);
        if (!validation.valid) {
          return res.status(400).json({
            success: false,
            error: validation.error
          });
        }
      }

      const updateData: any = {};
      if (ebayStockLimit !== undefined) updateData.ebayStockLimit = ebayStockLimit;
      if (useStockLimit !== undefined) updateData.useStockLimit = useStockLimit;

      await storage.updateProduct(productId, updateData);
      const updatedProduct = await storage.getProduct(productId);

      if (!updatedProduct) {
        return res.status(404).json({
          success: false,
          error: "Product not found"
        });
      }

      const stockInfo = calculateEbayStock(updatedProduct);

      res.json({
        success: true,
        product: updatedProduct,
        stockInfo
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: (error as Error).message
      });
    }
  });

    // Get recommended stock limit for a category
    app.get("/api/stock/recommended/:category", async (req, res) => {
      try {
        const category = decodeURIComponent(req.params.category);
        const recommendedLimit = getRecommendedStockLimit(category);

        res.json({
          success: true,
          category,
          recommendedLimit
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: (error as Error).message
        });
      }
    });

  registerRepricingRoutes(app);
  registerSyncRoutes(app);

  // Image processing endpoints
  registerImageRoutes(app);

  // ==========================================
  // ORDERS MANAGEMENT ROUTES
  // ==========================================

  // Get all orders with filtering
  registerOrderRoutes(app);

  // ==========================================
  // MESSAGING SYSTEM ROUTES
  // ==========================================

  // Get all message threads
  registerMessageRoutes(app);

  const httpServer = createServer(app);
  return httpServer;
}
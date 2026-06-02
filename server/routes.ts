import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
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
import { ebayApi } from "./ebay-api";
import { createSimpleUKListingXML } from "./ebay-uk-config";
import { createBasicUKListingXML } from "./ebay-basic-uk-config";
import { createTestListingXML } from "./ebay-test-listing";
import { createListingWithExternalImageXML } from "./ebay-external-image";
import { ebayOAuth } from "./ebay-oauth";
import { ebayAccountApi } from "./ebay-account-api";
import fs from 'fs';
import path from 'path';
import { findValidEbayCategory, getCategoryNameById } from "./ebay-category-finder";
import { findBestCategoryForProduct, explainCategoryChoice, categorizeBatch } from "./product-category-matcher";
import { 
  calculateDynamicPrice, 
  calculateBulkPricing, 
  getPricingTiers, 
  getPricingTierInfo,
  generatePricingSummary,
  validatePricingConfig,
  formatPrice
} from "./dynamic-pricing";
import { calculateEbayStock, calculateBulkEbayStock, validateStockLimit, getRecommendedStockLimit } from "./stock-manager";
import { imageProcessingService } from "./image-processing";
import { triggerManualSync } from "./cron-jobs";
import { ebayOrdersApi } from "./ebay-orders-api";
import { ebayMessagesApi } from "./ebay-messages-api";
import { autoMessageScheduler } from "./auto-message-scheduler";
import { 
  insertMessageTemplateSchema, 
  insertAutoMessageRuleSchema 
} from "@shared/schema";

// Type for authenticated requests
interface AuthenticatedRequest extends Request {
  session: any;
}

export async function registerRoutes(app: Express): Promise<Server> {

  // Auth middleware - production-ready with optional bypass.
  // When BYPASS_AUTH=true, every request is treated as authenticated as
  // the seeded admin (looked up by username, since the auto-generated id
  // depends on insert order and varies per DB). Intended for demo/staging
  // only; never set this in real production.
  const requireAuth = async (req: any, res: any, next: any) => {
    if (process.env.BYPASS_AUTH === 'true') {
      if (!req.session?.userId) {
        try {
          const admin = await storage.getUserByUsername('admin');
          if (admin) {
            req.session.userId = admin.id;
          }
        } catch (err) {
          console.error('BYPASS_AUTH admin lookup failed:', err);
        }
      }
      return next();
    }

    if (!req.session?.userId) {
      return res.status(401).json({ message: "Authentication required" });
    }
    next();
  };

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
    const returnName = String(body.returnName || "30 Tage Rückgabe (Käufer zahlt Versand)");
    const bandsInput = Array.isArray(body.shipping) ? body.shipping : null;

    type Band = {
      label: string;
      first: string;
      additional: string;
      weightMin: number;
      weightMax: number;
    };

    const bands: Band[] = bandsInput && bandsInput.length === 4
      ? bandsInput.map((b: any, i: number) => ({
          label: String(b.label ?? ["0-99g","100-499g","500-999g","1000-1999g"][i]),
          first: String(b.first ?? ""),
          additional: String(b.additional ?? "1.00"),
          weightMin: Number(b.weightMin ?? [0.01,100,500,1000][i]),
          weightMax: Number(b.weightMax ?? [99,499,999,1999][i]),
        }))
      : [
          { label: "0-99g",     first: "4.99",  additional: "1.00", weightMin: 0.01, weightMax: 99 },
          { label: "100-499g",  first: "6.99",  additional: "1.00", weightMin: 100,  weightMax: 499 },
          { label: "500-999g",  first: "9.99",  additional: "2.00", weightMin: 500,  weightMax: 999 },
          { label: "1000-1999g",first: "14.99", additional: "5.00", weightMin: 1000, weightMax: 1999 },
        ];

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
          errors.push(`Return policy [HTTP ${r.status}]: ${r.error}`);
        }
      }
    }

    for (const band of bands) {
      // DE_OtherShippingMethods + carrier "Other" failed LSAS validation
      // ("LOGISTICS_INFO_IS_MISSING") — eBay DE wants a concrete carrier +
      // service pair so it can track tracking-number quality. DHL Paket
      // is the universal default that German buyers expect; the actual
      // fulfillment carrier (Omniva / Latvijas Pasts / DPD) is independent
      // of what we declare here. Buyer sees "DHL Paket" as the service
      // category, which sets shipping expectations.
      const r = await ebayApiCall("/sell/account/v1/fulfillment_policy", {
        name: `EU ${band.label} (€${band.first})`,
        description: `Standard shipping for items ${band.label}`,
        marketplaceId: "EBAY_DE",
        categoryTypes: [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES" }],
        handlingTime: { value: 1, unit: "DAY" },
        shippingOptions: [
          {
            optionType: "DOMESTIC",
            costType: "FLAT_RATE",
            shippingServices: [
              {
                shippingCarrierCode: "DHL",
                shippingServiceCode: "DE_DHLPaket",
                shippingCost: { value: band.first, currency: "EUR" },
                additionalShippingCost: { value: band.additional, currency: "EUR" },
                freeShipping: false,
                sortOrder: 1,
              },
            ],
          },
        ],
        shipToLocations: {
          regionIncluded: [{ regionName: "DE", regionType: "COUNTRY" }],
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
    const bandToVar: Record<string, string> = {
      "0-99g": "EBAY_SHIPPING_POLICY_0_99GR",
      "100-499g": "EBAY_SHIPPING_POLICY_100_499GR",
      "500-999g": "EBAY_SHIPPING_POLICY_500_999GR",
      "1000-1999g": "EBAY_SHIPPING_POLICY_1000_1999GR",
    };
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
  app.post("/api/pricing/calculate", requireAuth, async (req, res) => {
    try {
      const { supplierPrice } = req.body;

      if (!supplierPrice) {
        return res.status(400).json({ message: "Supplier price is required" });
      }

      const result = calculateDynamicPrice(supplierPrice);
      res.json(result);
    } catch (error) {
      res.status(500).json({ message: "Failed to calculate pricing" });
    }
  });

  app.post("/api/pricing/bulk-calculate", requireAuth, async (req, res) => {
    try {
      const { productIds } = req.body;

      if (!Array.isArray(productIds)) {
        return res.status(400).json({ message: "Product IDs array is required" });
      }

      // Get products with their supplier prices
      const products = await Promise.all(
        productIds.map(async (id: number) => {
          const product = await storage.getProduct(id);
          return product ? { id: product.id, supplierPrice: parseFloat(product.supplierPrice) } : null;
        })
      );

      const validProducts = products.filter(p => p !== null);
      const results = calculateBulkPricing(validProducts);

      res.json({ results, processedCount: validProducts.length });
    } catch (error) {
      res.status(500).json({ message: "Failed to calculate bulk pricing" });
    }
  });

  app.post("/api/pricing/bulk-update", requireAuth, async (req, res) => {
    try {
      const { productIds, applyCalculated = true } = req.body;

      if (!Array.isArray(productIds)) {
        return res.status(400).json({ message: "Product IDs array is required" });
      }

      let updatedCount = 0;
      let errors: string[] = [];

      for (const productId of productIds) {
        try {
          const product = await storage.getProduct(productId);
          if (!product) {
            errors.push(`Product ${productId} not found`);
            continue;
          }

          const pricingResult = calculateDynamicPrice(parseFloat(product.supplierPrice));

          if (!pricingResult.isValid) {
            errors.push(`Product ${productId}: ${pricingResult.errors.join(', ')}`);
            continue;
          }

          // Update product with calculated pricing
          const updateData: any = {
            calculatedPrice: pricingResult.finalPrice.toString(),
            marginTier: pricingResult.marginTier,
            marginPercentage: pricingResult.marginPercentage.toString(),
            priceUpdatedAt: new Date(),
            useCalculatedPrice: applyCalculated
          };

          // If applying calculated price, update salePrice as well
          if (applyCalculated) {
            updateData.salePrice = pricingResult.finalPrice.toString();
          }

          await storage.updateProduct(productId, updateData);
          updatedCount++;
        } catch (error) {
          errors.push(`Product ${productId}: ${(error as Error).message}`);
        }
      }

      res.json({
        success: true,
        updatedCount,
        totalProducts: productIds.length,
        errors
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to update pricing" });
    }
  });

  app.get("/api/pricing/tiers", requireAuth, async (req, res) => {
    try {
      const tiers = await storage.getPricingTiers();

      res.json({
        tiers,
        isValid: true
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch pricing tiers" });
    }
  });

  app.get("/api/pricing/preview/:productId", requireAuth, async (req, res) => {
    try {
      const productId = parseInt(req.params.productId);
      const product = await storage.getProduct(productId);

      if (!product) {
        return res.status(404).json({ message: "Product not found" });
      }

      const currentSupplierPrice = parseFloat(product.supplierPrice);
      const pricingResult = calculateDynamicPrice(currentSupplierPrice);
      const summary = generatePricingSummary(currentSupplierPrice);
      const tierInfo = getPricingTierInfo(currentSupplierPrice);

      res.json({
        product: {
          id: product.id,
          name: product.name,
          currentSupplierPrice,
          currentSalePrice: parseFloat(product.salePrice),
          useCalculatedPrice: product.useCalculatedPrice || false
        },
        pricing: pricingResult,
        summary,
        tierInfo
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to generate pricing preview" });
    }
  });

  // Product routes
  app.get("/api/products", requireAuth, async (req, res) => {
    try {
      const filters = {
        category: req.query.category as string,
        status: req.query.status as string,
        listedOnEbay: req.query.listedOnEbay ? req.query.listedOnEbay === 'true' : undefined,
        listedOnAmazon: req.query.listedOnAmazon ? req.query.listedOnAmazon === 'true' : undefined,
        minStock: req.query.minStock ? parseInt(req.query.minStock as string) : undefined,
        maxStock: req.query.maxStock ? parseInt(req.query.maxStock as string) : undefined,
      };

      // Remove undefined values
      const cleanFilters = Object.fromEntries(
        Object.entries(filters).filter(([_, value]) => value !== undefined)
      );

      const products = await storage.getProductsWithFilters(cleanFilters);
      res.json(products);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch products" });
    }
  });

  app.get("/api/products/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const product = await storage.getProduct(id);
      if (!product) {
        return res.status(404).json({ message: "Product not found" });
      }
      res.json(product);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch product" });
    }
  });

  app.post("/api/products", requireAuth, async (req, res) => {
    try {
      const productData = insertProductSchema.parse(req.body);

      // Check if SKU already exists
      const existingProduct = await storage.getProductBySku(productData.sku);
      if (existingProduct) {
        return res.status(400).json({ message: "Product with this SKU already exists" });
      }

      const product = await storage.createProduct(productData);
      res.status(201).json(product);
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({ message: "Invalid input", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create product" });
    }
  });

  app.put("/api/products/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);

      // Convert number fields to strings for decimal database fields
      const requestBody = { ...req.body };
      const decimalFields = ['weight', 'supplierPrice', 'salePrice', 'calculatedPrice', 'marginPercentage', 'margin'];

      decimalFields.forEach(field => {
        if (requestBody[field] !== undefined && typeof requestBody[field] === 'number') {
          requestBody[field] = String(requestBody[field]);
        }
      });

      const updateData = insertProductSchema.partial().parse(requestBody);

      const product = await storage.updateProduct(id, updateData);
      if (!product) {
        return res.status(404).json({ message: "Product not found" });
      }
      res.json(product);
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({ message: "Invalid input", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to update product" });
    }
  });

  app.delete("/api/products/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const success = await storage.deleteProduct(id);
      if (!success) {
        return res.status(404).json({ message: "Product not found" });
      }
      res.json({ message: "Product deleted successfully" });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete product" });
    }
  });

  // Delete all products endpoint
  app.delete("/api/products", requireAuth, async (req, res) => {
    try {
      const deletedCount = await storage.deleteAllProducts();
      console.log(`Deleted all products: ${deletedCount} items removed`);
      res.json({ 
        success: true, 
        deletedCount,
        message: `Successfully deleted ${deletedCount} products` 
      });
    } catch (error) {
      console.error("Failed to delete all products:", error);
      res.status(500).json({ message: "Failed to delete all products" });
    }
  });

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
  app.post("/api/ebay/list", requireAuth, async (req, res) => {
    try {
      const { productId, listingDetails } = req.body;
      const result = await ebayApi.listProduct(productId, listingDetails);
      res.json(result);
    } catch (error) {
      console.error("eBay listing failed:", error);
      res.status(500).json({ 
        success: false, 
        message: (error as Error).message || "eBay listing failed",
        error: (error as Error).message
      });
    }
  });

  app.post("/api/ebay/bulk-list", requireAuth, async (req, res) => {
    try {
      const { productIds, categoryId } = req.body;
      
      if (!Array.isArray(productIds) || productIds.length === 0) {
        return res.status(400).json({
          success: false,
          message: "productIds array is required and must not be empty"
        });
      }

      // Create a unique job ID
      const jobId = `bulk-list-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      
      // Create the job record
      await storage.createBulkListingJob({
        id: jobId,
        status: "processing",
        total: productIds.length,
        processed: 0,
        succeeded: 0,
        failed: 0,
        currentProduct: null,
        lastMessage: "Starting bulk listing...",
        errorDetails: null
      });

      // On Vercel serverless, the function is killed the instant we
      // res.json() — any "background" work after that dies mid-flight.
      // So process inline. This works while the batch fits inside the
      // function timeout (10s on Hobby ≈ 2-3 items, 60s on Pro ≈ 15-20).
      // For larger batches we'd need a cron-driven queue worker.
      const FIRE_AND_FORGET = process.env.LONG_BACKGROUND_JOBS === "true";
      if (FIRE_AND_FORGET) {
        processAsyncBulkListing(jobId, productIds, categoryId);
        return res.json({
          success: true,
          jobId,
          message: `Bulk listing job started for ${productIds.length} products`,
          total: productIds.length,
        });
      }

      await processAsyncBulkListing(jobId, productIds, categoryId);
      const finalJob = await storage.getBulkListingJob(jobId);
      res.json({
        success: true,
        jobId,
        message: `Bulk listing complete: ${finalJob?.succeeded ?? 0} listed, ${finalJob?.failed ?? 0} failed`,
        total: productIds.length,
        job: finalJob,
      });
    } catch (error) {
      console.error("eBay bulk listing failed:", error);
      res.status(500).json({ 
        success: false, 
        message: (error as Error).message || "eBay bulk listing failed",
        error: (error as Error).message
      });
    }
  });

  // Job status endpoint for polling
  app.get("/api/ebay/bulk-list/:jobId/status", requireAuth, async (req, res) => {
    try {
      const { jobId } = req.params;
      const job = await storage.getBulkListingJob(jobId);
      
      if (!job) {
        return res.status(404).json({
          success: false,
          message: "Job not found"
        });
      }

      res.json({
        success: true,
        job: {
          id: job.id,
          status: job.status,
          total: job.total,
          processed: job.processed,
          succeeded: job.succeeded,
          failed: job.failed,
          currentProduct: job.currentProduct,
          lastMessage: job.lastMessage,
          errorDetails: job.errorDetails ? JSON.parse(job.errorDetails) : null,
          createdAt: job.createdAt,
          completedAt: job.completedAt
        }
      });
    } catch (error) {
      console.error("Error getting job status:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get job status"
      });
    }
  });

  // Helper function for async bulk listing processing
  async function processAsyncBulkListing(jobId: string, productIds: number[], categoryId?: string) {
    const errorDetails: Array<{ productId: number; error: string }> = [];
    let succeeded = 0;
    let failed = 0;

    try {
      for (let i = 0; i < productIds.length; i++) {
        const productId = productIds[i];
        
        // Get product name for progress display
        const product = await storage.getProduct(productId);
        const productName = product?.name || `Product ${productId}`;
        
        // Update job with current product
        await storage.updateBulkListingJob(jobId, {
          currentProduct: productName,
          lastMessage: `Listing product ${i + 1} of ${productIds.length}: ${productName}`
        });

        try {
          const result = await ebayApi.listProduct(productId, { categoryId });
          
          if (result.success) {
            succeeded++;
          } else {
            failed++;
            errorDetails.push({
              productId,
              error: result.message || "Unknown error"
            });
          }
        } catch (error) {
          failed++;
          errorDetails.push({
            productId,
            error: (error as Error).message
          });
        }

        // Update job progress
        await storage.updateBulkListingJob(jobId, {
          processed: i + 1,
          succeeded,
          failed,
          errorDetails: errorDetails.length > 0 ? JSON.stringify(errorDetails) : null
        });

        // Add delay between listings to avoid rate limits
        if (i < productIds.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      // Mark job as completed
      await storage.updateBulkListingJob(jobId, {
        status: "completed",
        currentProduct: null,
        lastMessage: `Completed: ${succeeded} listed, ${failed} failed`,
        completedAt: new Date()
      });

      // Create sync log
      await storage.createSyncLog({
        source: "ebay",
        operation: "bulk_listing",
        status: succeeded > 0 ? "success" : "error",
        message: `Bulk listing completed: ${succeeded} listed, ${failed} failed`,
        details: JSON.stringify({
          jobId,
          totalProducts: productIds.length,
          listedCount: succeeded,
          failedCount: failed
        })
      });

      console.log(`✅ Bulk listing job ${jobId} completed: ${succeeded} succeeded, ${failed} failed`);

    } catch (error) {
      // Mark job as failed
      await storage.updateBulkListingJob(jobId, {
        status: "failed",
        currentProduct: null,
        lastMessage: `Job failed: ${(error as Error).message}`,
        completedAt: new Date()
      });
      
      console.error(`❌ Bulk listing job ${jobId} failed:`, error);
    }
  }

  // Bulk inventory update - aggregates multiple updates into single eBay API calls
  app.post("/api/ebay/bulk-update-inventory", requireAuth, async (req, res) => {
    try {
      const { items } = req.body;
      
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Items array is required and must not be empty"
        });
      }

      // Validate and prepare items
      const validItems = [];
      for (const item of items) {
        if (!item.productId) {
          continue;
        }
        
        // Get product from database to get eBay item ID
        const product = await storage.getProduct(item.productId);
        if (!product || !product.ebayItemId || !product.listedOnEbay) {
          continue;
        }

        validItems.push({
          productId: item.productId,
          ebayItemId: product.ebayItemId,
          quantity: item.quantity,
          price: item.price,
          sku: product.sku
        });
      }

      if (validItems.length === 0) {
        return res.status(400).json({
          success: false,
          message: "No valid items found for bulk update"
        });
      }

      console.log(`📦 Bulk inventory update requested for ${validItems.length} items`);
      const result = await ebayApi.bulkUpdateInventory(validItems);
      
      res.json({
        success: result.success,
        processed: result.processed,
        succeeded: result.succeeded,
        failed: result.failed,
        message: `Bulk update: ${result.succeeded} items updated, ${result.failed} failed`
      });
    } catch (error) {
      console.error("Bulk inventory update failed:", error);
      res.status(500).json({
        success: false,
        message: `Bulk update failed: ${(error as Error).message}`
      });
    }
  });

  app.post("/api/ebay/unlist", requireAuth, async (req, res) => {
    try {
      const { productId } = req.body;
      const result = await ebayApi.unlistProduct(productId);
      res.json(result);
    } catch (error) {
      console.error("eBay unlisting failed:", error);
      res.json({ 
        success: false, 
        message: `Failed to unlist product: ${(error as Error).message}`,
        errors: [(error as Error).message]
      });
    }
  });

  // Bulk sync template to all eBay listings (updates title & description)
  app.post("/api/ebay/bulk-sync-template", requireAuth, async (req, res) => {
    try {
      // Get all products listed on eBay
      const allProducts = await storage.getProducts();
      const listedProducts = allProducts.filter(p => p.listedOnEbay && p.ebayItemId);
      
      if (listedProducts.length === 0) {
        return res.json({
          success: true,
          message: "No products are currently listed on eBay",
          processed: 0,
          succeeded: 0,
          failed: 0
        });
      }

      console.log(`📝 Starting bulk template sync for ${listedProducts.length} eBay listings`);
      
      const results: Array<{ productId: number; name: string; success: boolean; message: string }> = [];
      let succeeded = 0;
      let failed = 0;

      // Process each product with rate limiting (1 per second to avoid hitting eBay limits)
      for (let i = 0; i < listedProducts.length; i++) {
        const product = listedProducts[i];
        
        try {
          console.log(`⏳ Updating listing ${i + 1}/${listedProducts.length}: ${product.name}`);
          
          // Use updateProduct which regenerates the template
          const updateResult = await ebayApi.updateProduct(product.id, undefined, true);
          
          if (updateResult.success) {
            succeeded++;
            results.push({
              productId: product.id,
              name: product.name,
              success: true,
              message: "Template updated successfully"
            });
          } else {
            failed++;
            results.push({
              productId: product.id,
              name: product.name,
              success: false,
              message: updateResult.message || "Update failed"
            });
          }
        } catch (error) {
          failed++;
          results.push({
            productId: product.id,
            name: product.name,
            success: false,
            message: (error as Error).message
          });
        }

        // Rate limiting: wait 1.5 seconds between updates to stay under eBay limits
        if (i < listedProducts.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1500));
        }
      }

      console.log(`✅ Bulk template sync complete: ${succeeded} succeeded, ${failed} failed`);

      await storage.createSyncLog({
        source: "ebay",
        operation: "bulk_template_sync",
        status: failed === 0 ? "success" : "partial",
        itemsProcessed: listedProducts.length,
        itemsSucceeded: succeeded,
        itemsFailed: failed,
        details: JSON.stringify({ 
          message: `Template sync: ${succeeded} updated, ${failed} failed`,
          failedItems: results.filter(r => !r.success).slice(0, 10)
        })
      });

      res.json({
        success: failed === 0,
        message: `Template sync complete: ${succeeded} listings updated, ${failed} failed`,
        processed: listedProducts.length,
        succeeded,
        failed,
        results: results.slice(0, 50) // Return first 50 results
      });
    } catch (error) {
      console.error("Bulk template sync failed:", error);
      res.status(500).json({
        success: false,
        message: `Bulk template sync failed: ${(error as Error).message}`
      });
    }
  });

  app.get("/api/ebay/test", requireAuth, async (req, res) => {
    try {
      const result = await ebayApi.testConnection();
      res.json(result);
    } catch (error) {
      console.error("eBay test failed:", error);
      res.status(500).json({ 
        success: false, 
        message: (error as Error).message || "eBay test failed",
        error: (error as Error).message
      });
    }
  });

  app.get("/api/ebay/policies", requireAuth, async (req, res) => {
    try {
      const result = await ebayApi.getBusinessPolicies();
      res.json(result);
    } catch (error) {
      console.error("Failed to fetch eBay policies:", error);
      res.status(500).json({ 
        success: false, 
        message: (error as Error).message || "Failed to fetch eBay policies",
        error: (error as Error).message
      });
    }
  });

  app.get("/api/ebay/categories", requireAuth, async (req, res) => {
    try {
      const categories = await ebayApi.getEbayCategories();
      res.json({ success: true, categories });
    } catch (error) {
      console.error("eBay categories fetch failed:", error);
      res.status(500).json({ 
        success: false, 
        message: (error as Error).message || "Failed to fetch eBay categories",
        error: (error as Error).message
      });
    }
  });

  // ==========================================
  // eBay Business Policies Management (Account API)
  // ==========================================

  // Check OAuth configuration status
  app.get("/api/ebay/business-policies/status", requireAuth, async (req, res) => {
    try {
      const isConfigured = ebayAccountApi.isConfigured();
      res.json({ 
        success: true, 
        configured: isConfigured,
        message: isConfigured 
          ? "OAuth credentials configured. You can sync and manage policies."
          : "OAuth not configured. Set EBAY_OAUTH_CLIENT_ID, EBAY_OAUTH_CLIENT_SECRET, and EBAY_OAUTH_REFRESH_TOKEN to enable."
      });
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        message: (error as Error).message || "Failed to check status"
      });
    }
  });

  // Sync all policies from eBay to local database
  app.post("/api/ebay/business-policies/sync", requireAuth, async (req, res) => {
    try {
      // Check if OAuth is configured before attempting sync
      if (!ebayAccountApi.isConfigured()) {
        return res.status(400).json({ 
          success: false, 
          message: "OAuth not configured. Set EBAY_OAUTH_CLIENT_ID, EBAY_OAUTH_CLIENT_SECRET, and EBAY_OAUTH_REFRESH_TOKEN environment variables."
        });
      }
      
      const { marketplaceId } = req.body;
      const result = await ebayAccountApi.syncAllPolicies(marketplaceId);
      res.json({ 
        success: true, 
        message: "Policies synced from eBay",
        result 
      });
    } catch (error) {
      console.error("Failed to sync eBay policies:", error);
      res.status(500).json({ 
        success: false, 
        message: (error as Error).message || "Failed to sync eBay policies"
      });
    }
  });

  // Get available shipping services from eBay
  app.get("/api/ebay/shipping-services", requireAuth, async (req, res) => {
    try {
      const result = await ebayApi.getShippingServices();
      res.json(result);
    } catch (error) {
      console.error("Failed to get shipping services:", error);
      res.status(500).json({ 
        success: false, 
        domestic: [],
        international: [],
        error: (error as Error).message || "Failed to get shipping services"
      });
    }
  });

  // Get available shipping locations/regions from eBay
  app.get("/api/ebay/shipping-locations", requireAuth, async (req, res) => {
    try {
      const result = await ebayApi.getShippingLocations();
      res.json(result);
    } catch (error) {
      console.error("Failed to get shipping locations:", error);
      res.status(500).json({ 
        success: false, 
        regions: [],
        error: (error as Error).message || "Failed to get shipping locations"
      });
    }
  });

  // Get dispatch time options from eBay
  app.get("/api/ebay/dispatch-times", requireAuth, async (req, res) => {
    try {
      const result = await ebayApi.getDispatchTimeOptions();
      res.json(result);
    } catch (error) {
      console.error("Failed to get dispatch time options:", error);
      res.status(500).json({ 
        success: false, 
        options: [],
        error: (error as Error).message || "Failed to get dispatch time options"
      });
    }
  });

  // Get all local policies
  app.get("/api/ebay/business-policies", requireAuth, async (req, res) => {
    try {
      const policies = await ebayAccountApi.getLocalPolicies();
      res.json({ success: true, policies });
    } catch (error) {
      console.error("Failed to get local policies:", error);
      res.status(500).json({ 
        success: false, 
        message: (error as Error).message || "Failed to get policies"
      });
    }
  });

  // ---- Payment Policies ----
  app.get("/api/ebay/business-policies/payment", requireAuth, async (req, res) => {
    try {
      const policies = await storage.getEbayPaymentPolicies();
      res.json({ success: true, policies });
    } catch (error) {
      console.error("Failed to get payment policies:", error);
      res.status(500).json({ 
        success: false, 
        message: (error as Error).message || "Failed to get payment policies"
      });
    }
  });

  app.post("/api/ebay/business-policies/payment", requireAuth, async (req, res) => {
    try {
      const { name, description, marketplaceId, immediatePay, paymentMethods, createOnEbay } = req.body;
      
      if (createOnEbay) {
        // Create on eBay first, then save locally
        const ebayPolicy = await ebayAccountApi.createPaymentPolicy({
          name,
          description,
          marketplaceId,
          immediatePay,
          paymentMethods: paymentMethods ? JSON.parse(paymentMethods) : undefined
        });
        
        if (!ebayPolicy) {
          return res.status(500).json({ success: false, message: "Failed to create policy on eBay" });
        }

        const localPolicy = await storage.createEbayPaymentPolicy({
          policyId: ebayPolicy.paymentPolicyId,
          name: ebayPolicy.name,
          description: ebayPolicy.description,
          marketplaceId: ebayPolicy.marketplaceId,
          categoryTypes: JSON.stringify(ebayPolicy.categoryTypes || []),
          paymentMethods: JSON.stringify(ebayPolicy.paymentMethods || []),
          immediatePay: ebayPolicy.immediatePay,
          syncedFromEbay: true
        });

        res.json({ success: true, policy: localPolicy, ebayPolicy });
      } else {
        // Create locally only (for testing)
        const policy = await storage.createEbayPaymentPolicy({
          policyId: `local_${Date.now()}`,
          name,
          description,
          marketplaceId: marketplaceId || "EBAY_GB",
          paymentMethods: paymentMethods || "[]",
          immediatePay: immediatePay ?? true,
          syncedFromEbay: false
        });
        res.json({ success: true, policy });
      }
    } catch (error) {
      console.error("Failed to create payment policy:", error);
      res.status(500).json({ 
        success: false, 
        message: (error as Error).message || "Failed to create payment policy"
      });
    }
  });

  app.put("/api/ebay/business-policies/payment/:policyId", requireAuth, async (req, res) => {
    try {
      const { policyId } = req.params;
      const { name, description, immediatePay, updateOnEbay } = req.body;

      if (updateOnEbay && !policyId.startsWith('local_')) {
        // Update on eBay first
        const ebayPolicy = await ebayAccountApi.updatePaymentPolicy(policyId, {
          name,
          description,
          immediatePay
        });
        
        if (!ebayPolicy) {
          return res.status(500).json({ success: false, message: "Failed to update policy on eBay" });
        }
      }

      const policy = await storage.updateEbayPaymentPolicy(policyId, {
        name,
        description,
        immediatePay
      });

      res.json({ success: true, policy });
    } catch (error) {
      console.error("Failed to update payment policy:", error);
      res.status(500).json({ 
        success: false, 
        message: (error as Error).message || "Failed to update payment policy"
      });
    }
  });

  app.delete("/api/ebay/business-policies/payment/:policyId", requireAuth, async (req, res) => {
    try {
      const { policyId } = req.params;
      const { deleteOnEbay } = req.query;

      if (deleteOnEbay === 'true' && !policyId.startsWith('local_')) {
        // Delete on eBay first
        const deleted = await ebayAccountApi.deletePaymentPolicy(policyId);
        if (!deleted) {
          return res.status(500).json({ success: false, message: "Failed to delete policy on eBay" });
        }
      }

      await storage.deleteEbayPaymentPolicy(policyId);
      res.json({ success: true, message: "Payment policy deleted" });
    } catch (error) {
      console.error("Failed to delete payment policy:", error);
      res.status(500).json({ 
        success: false, 
        message: (error as Error).message || "Failed to delete payment policy"
      });
    }
  });

  // ---- Fulfillment (Shipping) Policies ----
  app.get("/api/ebay/business-policies/fulfillment", requireAuth, async (req, res) => {
    try {
      const policies = await storage.getEbayFulfillmentPolicies();
      res.json({ success: true, policies });
    } catch (error) {
      console.error("Failed to get fulfillment policies:", error);
      res.status(500).json({ 
        success: false, 
        message: (error as Error).message || "Failed to get fulfillment policies"
      });
    }
  });

  app.post("/api/ebay/business-policies/fulfillment", requireAuth, async (req, res) => {
    try {
      const { 
        name, description, marketplaceId, handlingTime, 
        shippingOptions, shipToLocations, globalShipping, createOnEbay, pickupDropOff 
      } = req.body;
      
      const parsedShippingOptions = Array.isArray(shippingOptions) 
        ? shippingOptions 
        : (shippingOptions ? JSON.parse(shippingOptions) : undefined);
      
      const parsedShipToLocations = typeof shipToLocations === 'object' && !Array.isArray(shipToLocations)
        ? shipToLocations
        : (shipToLocations ? JSON.parse(shipToLocations) : undefined);
      
      if (createOnEbay) {
        const ebayPolicy = await ebayAccountApi.createFulfillmentPolicy({
          name,
          description,
          marketplaceId,
          handlingTime: handlingTime ? { value: handlingTime, unit: "DAY" } : undefined,
          shippingOptions: parsedShippingOptions,
          shipToLocations: parsedShipToLocations,
          globalShipping,
          pickupDropOff
        });
        
        if (!ebayPolicy) {
          return res.status(500).json({ success: false, message: "Failed to create policy on eBay" });
        }

        const localPolicy = await storage.createEbayFulfillmentPolicy({
          policyId: ebayPolicy.fulfillmentPolicyId,
          name: ebayPolicy.name,
          description: ebayPolicy.description,
          marketplaceId: ebayPolicy.marketplaceId,
          categoryTypes: JSON.stringify(ebayPolicy.categoryTypes || []),
          handlingTime: ebayPolicy.handlingTime?.value || 1,
          shippingOptions: JSON.stringify(ebayPolicy.shippingOptions || []),
          shipToLocations: JSON.stringify(ebayPolicy.shipToLocations || {}),
          globalShipping: ebayPolicy.globalShipping,
          syncedFromEbay: true
        });

        res.json({ success: true, policy: localPolicy, ebayPolicy });
      } else {
        const policy = await storage.createEbayFulfillmentPolicy({
          policyId: `local_${Date.now()}`,
          name,
          description,
          marketplaceId: marketplaceId || "EBAY_GB",
          handlingTime: handlingTime || 1,
          shippingOptions: JSON.stringify(parsedShippingOptions || []),
          shipToLocations: JSON.stringify(parsedShipToLocations || {}),
          globalShipping: globalShipping ?? false,
          syncedFromEbay: false
        });
        res.json({ success: true, policy });
      }
    } catch (error) {
      console.error("Failed to create fulfillment policy:", error);
      res.status(500).json({ 
        success: false, 
        message: (error as Error).message || "Failed to create fulfillment policy"
      });
    }
  });

  app.put("/api/ebay/business-policies/fulfillment/:policyId", requireAuth, async (req, res) => {
    try {
      const { policyId } = req.params;
      const { name, description, handlingTime, globalShipping, updateOnEbay } = req.body;

      if (updateOnEbay && !policyId.startsWith('local_')) {
        const ebayPolicy = await ebayAccountApi.updateFulfillmentPolicy(policyId, {
          name,
          description,
          handlingTime: handlingTime ? { value: handlingTime, unit: "DAY" } : undefined,
          globalShipping
        });
        
        if (!ebayPolicy) {
          return res.status(500).json({ success: false, message: "Failed to update policy on eBay" });
        }
      }

      const policy = await storage.updateEbayFulfillmentPolicy(policyId, {
        name,
        description,
        handlingTime,
        globalShipping
      });

      res.json({ success: true, policy });
    } catch (error) {
      console.error("Failed to update fulfillment policy:", error);
      res.status(500).json({ 
        success: false, 
        message: (error as Error).message || "Failed to update fulfillment policy"
      });
    }
  });

  app.delete("/api/ebay/business-policies/fulfillment/:policyId", requireAuth, async (req, res) => {
    try {
      const { policyId } = req.params;
      const { deleteOnEbay } = req.query;

      if (deleteOnEbay === 'true' && !policyId.startsWith('local_')) {
        const deleted = await ebayAccountApi.deleteFulfillmentPolicy(policyId);
        if (!deleted) {
          return res.status(500).json({ success: false, message: "Failed to delete policy on eBay" });
        }
      }

      await storage.deleteEbayFulfillmentPolicy(policyId);
      res.json({ success: true, message: "Fulfillment policy deleted" });
    } catch (error) {
      console.error("Failed to delete fulfillment policy:", error);
      res.status(500).json({ 
        success: false, 
        message: (error as Error).message || "Failed to delete fulfillment policy"
      });
    }
  });

  // ---- Return Policies ----
  app.get("/api/ebay/business-policies/return", requireAuth, async (req, res) => {
    try {
      const policies = await storage.getEbayReturnPolicies();
      res.json({ success: true, policies });
    } catch (error) {
      console.error("Failed to get return policies:", error);
      res.status(500).json({ 
        success: false, 
        message: (error as Error).message || "Failed to get return policies"
      });
    }
  });

  app.post("/api/ebay/business-policies/return", requireAuth, async (req, res) => {
    try {
      const { 
        name, description, marketplaceId, returnsAccepted, 
        returnPeriod, refundMethod, returnShippingCostPayer, createOnEbay 
      } = req.body;
      
      if (createOnEbay) {
        const ebayPolicy = await ebayAccountApi.createReturnPolicy({
          name,
          description,
          marketplaceId,
          returnsAccepted: returnsAccepted ?? true,
          returnPeriod: returnPeriod ? { value: returnPeriod, unit: "DAY" } : undefined,
          refundMethod,
          returnShippingCostPayer
        });
        
        if (!ebayPolicy) {
          return res.status(500).json({ success: false, message: "Failed to create policy on eBay" });
        }

        const localPolicy = await storage.createEbayReturnPolicy({
          policyId: ebayPolicy.returnPolicyId,
          name: ebayPolicy.name,
          description: ebayPolicy.description,
          marketplaceId: ebayPolicy.marketplaceId,
          categoryTypes: JSON.stringify(ebayPolicy.categoryTypes || []),
          returnsAccepted: ebayPolicy.returnsAccepted,
          returnPeriod: ebayPolicy.returnPeriod?.value || 30,
          refundMethod: ebayPolicy.refundMethod,
          returnShippingCostPayer: ebayPolicy.returnShippingCostPayer,
          syncedFromEbay: true
        });

        res.json({ success: true, policy: localPolicy, ebayPolicy });
      } else {
        const policy = await storage.createEbayReturnPolicy({
          policyId: `local_${Date.now()}`,
          name,
          description,
          marketplaceId: marketplaceId || "EBAY_GB",
          returnsAccepted: returnsAccepted ?? true,
          returnPeriod: returnPeriod || 30,
          refundMethod: refundMethod || "MONEY_BACK",
          returnShippingCostPayer: returnShippingCostPayer || "BUYER",
          syncedFromEbay: false
        });
        res.json({ success: true, policy });
      }
    } catch (error) {
      console.error("Failed to create return policy:", error);
      res.status(500).json({ 
        success: false, 
        message: (error as Error).message || "Failed to create return policy"
      });
    }
  });

  app.put("/api/ebay/business-policies/return/:policyId", requireAuth, async (req, res) => {
    try {
      const { policyId } = req.params;
      const { name, description, returnsAccepted, returnPeriod, refundMethod, returnShippingCostPayer, updateOnEbay } = req.body;

      if (updateOnEbay && !policyId.startsWith('local_')) {
        const ebayPolicy = await ebayAccountApi.updateReturnPolicy(policyId, {
          name,
          description,
          returnsAccepted,
          returnPeriod: returnPeriod ? { value: returnPeriod, unit: "DAY" } : undefined,
          refundMethod,
          returnShippingCostPayer
        });
        
        if (!ebayPolicy) {
          return res.status(500).json({ success: false, message: "Failed to update policy on eBay" });
        }
      }

      const policy = await storage.updateEbayReturnPolicy(policyId, {
        name,
        description,
        returnsAccepted,
        returnPeriod,
        refundMethod,
        returnShippingCostPayer
      });

      res.json({ success: true, policy });
    } catch (error) {
      console.error("Failed to update return policy:", error);
      res.status(500).json({ 
        success: false, 
        message: (error as Error).message || "Failed to update return policy"
      });
    }
  });

  app.delete("/api/ebay/business-policies/return/:policyId", requireAuth, async (req, res) => {
    try {
      const { policyId } = req.params;
      const { deleteOnEbay } = req.query;

      if (deleteOnEbay === 'true' && !policyId.startsWith('local_')) {
        const deleted = await ebayAccountApi.deleteReturnPolicy(policyId);
        if (!deleted) {
          return res.status(500).json({ success: false, message: "Failed to delete policy on eBay" });
        }
      }

      await storage.deleteEbayReturnPolicy(policyId);
      res.json({ success: true, message: "Return policy deleted" });
    } catch (error) {
      console.error("Failed to delete return policy:", error);
      res.status(500).json({ 
        success: false, 
        message: (error as Error).message || "Failed to delete return policy"
      });
    }
  });

    // TME API routes - Enhanced

    // Test TME API connection
    app.get("/api/tme/test", async (req, res) => {
      try {
        console.log("🧪 Testing TME API connection...");

        // Test basic connectivity with account status
        const response = await fetch("https://api.tme.eu/Accounts/GetAccountStatus.json", {
          method: 'POST',
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json",
            "User-Agent": "TME-API-Client/1.0"
          },
          body: new URLSearchParams({
            Token: process.env.TME_TOKEN || '',
            Language: "EN"
          }).toString()
        });

        const responseText = await response.text();
        console.log("📥 TME API Response:", responseText.substring(0, 500));

        if (response.ok) {
          const data = JSON.parse(responseText);
          res.json({
            success: true,
            status: "TME API connection successful",
            data: data,
            responseCode: response.status
          });
        } else {
          res.json({
            success: false,
            status: "TME API connection failed",
            error: `HTTP ${response.status}: ${response.statusText}`,
            response: responseText.substring(0, 1000)
          });
        }
      } catch (error) {
        console.error("❌ TME API test failed:", error);
        res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
          status: "TME API test failed"
        });
      }
    });

    // Debug endpoint to see raw TME categories structure
    app.get("/api/tme/categories/debug", async (req, res) => {
      try {
        console.log("Fetching raw TME categories for debug...");
        const rawData = await tmeApi.getAllCategoriesRaw();
        
        res.json({
          success: true,
          rawData: rawData
        });
      } catch (error) {
        console.error("Failed to fetch raw TME categories:", error);
        res.status(500).json({ 
          success: false, 
          error: (error as Error).message
        });
      }
    });

    // Get TME categories
    app.get("/api/tme/categories", async (req, res) => {
      try {
        console.log("Fetching TME categories...");

        const categories = await tmeApi.getAllCategories();

        res.json({
          success: true,
          categories: categories,
          totalCategories: categories.length,
          message: `Found ${categories.length} categories`
        });

      } catch (error) {
        console.error("Failed to fetch TME categories:", error);
        res.status(500).json({ 
          success: false, 
          message: `Failed to fetch TME categories: ${(error as Error).message}`,
          error: (error as Error).message
        });
      }
    });

    // Get TME products by category with enhanced filtering
    app.get("/api/tme/products", async (req, res) => {
      try {
        const { 
          categoryId, 
          page = "1", 
          limit = "50", 
          search = "", 
          priceMin = "", 
          priceMax = "", 
          stockMin = "1", 
          producer = "",
          inStockOnly = "true"
        } = req.query;

        if (!categoryId) {
          return res.status(400).json({
            success: false,
            error: "Category ID is required"
          });
        }

        console.log(`🔍 Fetching TME products for category: ${categoryId}, page: ${page}, limit: ${limit}`);

        const pageNum = parseInt(page as string);
        const limitNum = parseInt(limit as string);

        // Fetch products from TME API
        const result = await tmeApi.getProductsByCategory(categoryId as string, pageNum, limitNum);

        let products = result.products || [];

        // Apply client-side filters
        if (search) {
          const searchLower = (search as string).toLowerCase();
          products = products.filter((p: any) => 
            p.Description?.toLowerCase().includes(searchLower) ||
            p.Symbol?.toLowerCase().includes(searchLower) ||
            p.Producer?.toLowerCase().includes(searchLower)
          );
        }

        if (producer) {
          const producerLower = (producer as string).toLowerCase();
          products = products.filter((p: any) => 
            p.Producer?.toLowerCase().includes(producerLower)
          );
        }

        res.json({
          success: true,
          products: products,
          total: result.total,
          filtered: products.length,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil(result.total / limitNum),
          categoryId: categoryId
        });

      } catch (error) {
        console.error("TME products fetch error:", error);
        res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : "Failed to fetch TME products"
        });
      }
    });

    // Get enhanced product information (details + prices + stock)
    app.post("/api/tme/enhanced-info", async (req, res) => {
      try {
        const { symbols } = req.body;

        if (!symbols || !Array.isArray(symbols) || symbols.length === 0) {
          return res.status(400).json({ 
            success: false, 
            error: "Invalid symbols array" 
          });
        }

        console.log(`📊 Getting enhanced info for ${symbols.length} products`);

        const enhancedInfo = await tmeApi.getEnhancedProductInfo(symbols);

        console.log(`✅ Enhanced info result: ${enhancedInfo.length} products with data`);

        res.json(enhancedInfo);

      } catch (error) {
        console.error("Enhanced info error:", error);
        res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : "Failed to get enhanced product info"
        });
      }
    });

    // Get TME API usage statistics
    app.get("/api/tme/usage", async (req, res) => {
      try {
        // Get usage from database - persistent across page reloads
        const apiUsage = await storage.getApiUsage("tme");
        const callsToday = apiUsage?.callsToday || 0;
        const dailyLimit = apiUsage?.dailyLimit || 10000;
        const usagePercentage = Math.round((callsToday / dailyLimit) * 100);
        const remainingDaily = dailyLimit - callsToday;
        
        // Get real-time minute-based usage from TME API instance
        const minuteUsage = tmeApi.getApiUsage();
        const rateLimitPerMinute = 60;
        const safeRateLimit = 55; // We use 55 to be conservative
        const callsThisMinute = minuteUsage.callsThisMinute || 0;
        const remainingThisMinute = Math.max(0, safeRateLimit - callsThisMinute);

        const status = callsToday >= dailyLimit ? 'LIMIT_EXCEEDED' : 
                       callsThisMinute >= safeRateLimit ? 'RATE_LIMITED' :
                       usagePercentage >= 80 ? 'WARNING' : 'NORMAL';

        res.json({
          success: true,
          usage: {
            callsToday,
            dailyLimit,
            remainingDaily,
            usagePercentage,
            rateLimitPerMinute,
            callsThisMinute,
            remainingThisMinute,
            safeRateLimit,
            status,
            lastUpdated: apiUsage?.updatedAt || null,
            lastResetAt: apiUsage?.lastResetAt || null
          },
          limits: {
            daily: dailyLimit,
            perMinute: rateLimitPerMinute,
            safePerMinute: safeRateLimit
          },
          recommendations: status === 'RATE_LIMITED' ? [
            `Rate limit reached (${callsThisMinute}/${safeRateLimit} calls/min) - waiting for next minute`,
            "Sync will automatically resume when rate limit resets"
          ] : status === 'WARNING' ? [
            `You've used ${usagePercentage}% of your daily limit (${callsToday}/${dailyLimit} calls)`,
            "Consider reducing API calls or upgrading your TME plan"
          ] : status === 'LIMIT_EXCEEDED' ? [
            "Daily limit exceeded - API calls will fail until tomorrow",
            "Contact TME support to increase your daily limit"
          ] : [
            `API usage is within normal limits (${callsToday}/${dailyLimit} calls)`
          ]
        });
      } catch (error) {
        console.error("Failed to get TME usage:", error);
        res.status(500).json({
          success: false,
          error: "Failed to get TME usage statistics"
        });
      }
    });

    // Get eBay API usage statistics
    app.get("/api/ebay/usage", async (req, res) => {
      try {
        // Get usage from database - persistent across page reloads
        const apiUsage = await storage.getApiUsage("ebay");
        const callsToday = apiUsage?.callsToday || 0;
        const dailyLimit = apiUsage?.dailyLimit || 5000; // eBay typically allows 5000 calls/day
        const usagePercentage = Math.round((callsToday / dailyLimit) * 100);
        const remainingDaily = dailyLimit - callsToday;
        
        // eBay has different rate limits - typically 5000/day for Trading API
        const rateLimitPerMinute = 50;
        const safeRateLimit = 40; // Conservative limit

        const status = callsToday >= dailyLimit ? 'LIMIT_EXCEEDED' : 
                       usagePercentage >= 80 ? 'WARNING' : 'NORMAL';

        res.json({
          success: true,
          usage: {
            callsToday,
            dailyLimit,
            remainingDaily,
            usagePercentage,
            rateLimitPerMinute,
            safeRateLimit,
            status,
            lastUpdated: apiUsage?.updatedAt || null,
            lastResetAt: apiUsage?.lastResetAt || null
          },
          limits: {
            daily: dailyLimit,
            perMinute: rateLimitPerMinute,
            safePerMinute: safeRateLimit
          }
        });
      } catch (error) {
        console.error("Failed to get eBay usage:", error);
        res.status(500).json({
          success: false,
          error: "Failed to get eBay usage statistics"
        });
      }
    });

    // Get eBay seller limits (item count and value limits)
    app.get("/api/ebay/seller-limits", requireAuth, async (req, res) => {
      try {
        const result = await ebayAccountApi.getSellerLimitsWithUsage();
        res.json(result);
      } catch (error) {
        console.error("Failed to get eBay seller limits:", error);
        res.status(500).json({
          success: false,
          error: "Failed to get eBay seller limits"
        });
      }
    });

    // Sync selected TME products - alias to optimized endpoint
    app.post("/api/tme/sync-selected", async (req, res) => {
      try {
        console.log("📥 Received sync request:", JSON.stringify(req.body, null, 2));
        const { productSymbols, settings } = req.body;

        if (!productSymbols || !Array.isArray(productSymbols) || productSymbols.length === 0) {
          return res.status(400).json({
            success: false,
            error: "Product symbols array is required"
          });
        }

        console.log(`🔄 Starting sync of ${productSymbols.length} selected products`);

        let syncedCount = 0;
        let updatedCount = 0;
        let failedCount = 0;
        const errors: string[] = [];

        try {
          // OPTIMIZED: Pass all products at once - let getEnhancedProductInfo handle batching internally
          // Uses batch size of 50 and combined GetPricesAndStocks endpoint for maximum efficiency
          const enhancedProducts = await tmeApi.getEnhancedProductInfo(productSymbols);

          // Get existing products once for efficient lookup
          const existingProducts = await storage.getProducts();
          const existingBySku = new Map(existingProducts.map(p => [p.sku, p]));

          for (const enhanced of enhancedProducts) {
            try {
              const { product, price, stock } = enhanced;

              // Get MOQ (minimum order quantity) and multiples from TME product
              const moq = product.MinAmount || 1;
              const multiples = product.Multiples || 1;

              // Calculate pricing - use correct price tier for MOQ quantity
              const { getSupplierPriceForMoq, calculateDynamicPrice, calculatePackagePrice } = await import("./dynamic-pricing");
              const supplierPrice = getSupplierPriceForMoq(price?.PriceList, moq);
              
              let pricingResult = {
                finalPrice: supplierPrice,
                calculatedPrice: supplierPrice,
                marginTier: "No Margin",
                marginPercentage: 0
              };

              if (settings?.applyDynamicPricing && supplierPrice > 0) {
                // For MOQ > 1: apply margin to PACKAGE cost (unit price × MOQ)
                // This ensures margin is applied to what we actually pay TME
                const result = moq > 1
                  ? calculatePackagePrice(supplierPrice, moq, multiples)
                  : calculateDynamicPrice(supplierPrice);
                pricingResult = {
                  finalPrice: result.finalPrice,
                  calculatedPrice: result.calculatedPrice,
                  marginTier: result.marginTier,
                  marginPercentage: result.marginPercentage
                };
              }

              // Prepare product data
              const productData = {
                name: product.Description || product.Symbol,
                sku: product.Symbol,
                description: product.Description || "",
                category: product.Category || "Electronics",
                stock: stock?.Amount || 0,
                costPrice: String(supplierPrice),
                salePrice: String(pricingResult.finalPrice),
                supplierPrice: String(supplierPrice),
                supplier: "TME",
                imageUrl: product.Photo || null,
                status: (stock?.Amount || 0) > 0 ? "active" : "inactive",
                ean: product.EAN || null,
                weight: product.Weight?.toString() || null,
                tmeCategory: product.Category || null,
                tmeCategoryId: product.CategoryId ? String(product.CategoryId) : null,
                tmeSymbol: product.Symbol,
                moq: moq,
                multiples: multiples
              };

              // Check if product already exists by SKU
              const existing = existingBySku.get(product.Symbol);

              if (existing) {
                await storage.updateProduct(existing.id, productData);
                updatedCount++;
              } else {
                await storage.createProduct(productData as any);
                syncedCount++;
              }

            } catch (itemError) {
              console.error(`Failed to sync product:`, itemError);
              failedCount++;
              errors.push(`Failed to sync: ${(itemError as Error).message}`);
            }
          }
        } catch (batchError) {
          console.error(`Sync error:`, batchError);
          failedCount += productSymbols.length;
          errors.push(`Sync failed: ${(batchError as Error).message}`);
        }

        // Log the sync operation
        await storage.createSyncLog({
          source: 'tme_browser',
          operation: 'sync_selected',
          status: failedCount === 0 ? 'success' : failedCount < productSymbols.length ? 'partial' : 'error',
          message: `Synced ${syncedCount} new, updated ${updatedCount}, failed ${failedCount}`,
          details: JSON.stringify({ syncedCount, updatedCount, failedCount, errors })
        });

        res.json({
          success: true,
          syncedCount,
          updatedCount,
          failedCount,
          errors: errors.length > 0 ? errors : undefined
        });

      } catch (error) {
        console.error("Sync failed:", error);
        res.status(500).json({
          success: false,
          error: "Sync failed: " + (error as Error).message
        });
      }
    });

    // OPTIMIZED: Sync selected TME products using combined endpoints (80% fewer API calls)
    app.post("/api/tme/sync-selected-optimized", async (req, res) => {
      try {
        console.log("📥 Received sync request:", JSON.stringify(req.body, null, 2));
        const { productSymbols, settings } = req.body;

        if (!productSymbols || !Array.isArray(productSymbols) || productSymbols.length === 0) {
          return res.status(400).json({
            success: false,
            error: "Product symbols array is required"
          });
        }

        console.log(`🔄 Starting sync of ${productSymbols.length} selected products`);

        let syncedCount = 0;
        let updatedCount = 0;
        let failedCount = 0;
        const errors: string[] = [];

        // Get enhanced product information in batches
        const batchSize = 10;
        for (let i = 0; i < productSymbols.length; i += batchSize) {
          const batch = productSymbols.slice(i, i + batchSize);

          try {
            console.log(`📦 Processing batch ${Math.floor(i/batchSize) + 1}: ${batch.join(", ")}`);

            // Get enhanced product info (details + prices + stock)
            const enhancedProducts = await tmeApi.getEnhancedProductInfo(batch);

            for (const enhanced of enhancedProducts) {
              try {
                const { product, price, stock } = enhanced;

                // Get MOQ (minimum order quantity) and multiples from TME product
                const moq = product.MinAmount || 1;
                const multiples = product.Multiples || 1;

                // Calculate pricing - use correct price tier for MOQ quantity
                const { getSupplierPriceForMoq, calculateDynamicPrice, calculatePackagePrice } = await import("./dynamic-pricing");
                const supplierPrice = getSupplierPriceForMoq(price?.PriceList, moq);
                
                let pricingResult = {
                  finalPrice: supplierPrice,
                  calculatedPrice: supplierPrice,
                  marginTier: "No Margin",
                  marginPercentage: 0
                };

                if (settings.applyDynamicPricing && supplierPrice > 0) {
                  // For MOQ > 1: apply margin to PACKAGE cost (unit price × MOQ)
                  const result = moq > 1
                    ? calculatePackagePrice(supplierPrice, moq, multiples)
                    : calculateDynamicPrice(supplierPrice);
                  pricingResult = {
                    finalPrice: result.finalPrice,
                    calculatedPrice: result.calculatedPrice,
                    marginTier: result.marginTier,
                    marginPercentage: result.marginPercentage
                  };
                }

                // Prepare product data
                const productData = {
                  name: product.Description,
                  sku: product.Symbol,
                  ean: product.EAN || null,
                  category: product.Category || "Electronics",
                  description: product.Description,
                  supplierPrice: String(Number(supplierPrice)),
                  salePrice: String(Number(pricingResult.finalPrice)),
                  calculatedPrice: String(Number(pricingResult.calculatedPrice)),
                  marginTier: pricingResult.marginTier,
                  marginPercentage: String(Number(pricingResult.marginPercentage)),
                  stock: stock?.Amount || 100,
                  moq: moq,
                  multiples: multiples,
                  status: "active" as const,
                  weight: String(Number(product.Weight) || 10),
                  imageUrl: product.Photo ? (product.Photo.startsWith('//') ? `https:${product.Photo}` : product.Photo) : null,
                  dataSheetUrl: product.DataSheet ? `https://www.tme.eu${product.DataSheet}` : null,
                  productUrl: product.ProductInformationPage ? `https://www.tme.eu${product.ProductInformationPage}` : null,
                  supplier: "tme" as const,
                  supplierProductId: product.Symbol,
                  useStockLimit: settings.useStockLimit || false,
                  ebayStockLimit: settings.useStockLimit ? settings.ebayStockLimit : null
                };

                // Check if product already exists
                const existingProduct = await storage.getProductBySku(productData.sku);

                if (existingProduct) {
                  await storage.updateProduct(existingProduct.id, productData);
                  updatedCount++;
                  console.log(`✅ Updated product: ${product.Symbol}`);
                } else {
                  await storage.createProduct(productData);
                  syncedCount++;
                  console.log(`✅ Created product: ${product.Symbol}`);
                }

              } catch (error) {
                console.error(`❌ Error processing ${enhanced.product.Symbol}:`, error);
                failedCount++;
                errors.push(`Error processing ${enhanced.product.Symbol}: ${error instanceof Error ? error.message : 'Unknown error'}`);
              }
            }

            // Rate limiting between batches
            if (i + batchSize < productSymbols.length) {
              await new Promise(resolve => setTimeout(resolve, 1000));
            }

          } catch (error) {
            console.error(`❌ Batch processing failed:`, error);
            failedCount += batch.length;
            errors.push(`Batch processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
        }

        const totalProcessed = syncedCount + updatedCount + failedCount;

        res.json({
          success: true,
          results: {
            totalRequested: productSymbols.length,
            totalProcessed: totalProcessed,
            syncedCount: syncedCount,
            updatedCount: updatedCount,
            failedCount: failedCount,
            errors: errors
          },
          message: `Sync completed: ${syncedCount} new, ${updatedCount} updated, ${failedCount} failed`
        });

      } catch (error) {
        console.error("Sync selected products error:", error);
        res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : "Failed to sync selected products"
        });
      }
    });

  // Apply dynamic pricing to all products
  app.post("/api/pricing/apply-bulk", requireAuth, async (req, res) => {
    try {
      // Get all products
      const products = await storage.getProducts();

      // Filter products with valid supplier prices (> 0)
      const validProducts = products.filter(p => parseFloat(p.supplierPrice) > 0);

      let updatedCount = 0;
      let errors: string[] = [];

      for (const product of validProducts) {
        try {
          const pricingResult = calculateDynamicPrice(parseFloat(product.supplierPrice));

          if (!pricingResult.isValid) {
            errors.push(`Product ${product.name}: ${pricingResult.errors.join(', ')}`);
            continue;
          }

          // Update product with calculated pricing
          await storage.updateProduct(product.id, {
            calculatedPrice: pricingResult.finalPrice.toString(),
            marginTier: pricingResult.marginTier,
            marginPercentage: pricingResult.marginPercentage.toString(),
            priceUpdatedAt: new Date(),
            useCalculatedPrice: true,
            salePrice: pricingResult.finalPrice.toString()
          });

          updatedCount++;
        } catch (error) {
          errors.push(`Product ${product.name}: ${(error as Error).message}`);
        }
      }

      res.json({
        success: true,
        updatedCount,
        totalProducts: validProducts.length,
        skippedProducts: products.length - validProducts.length,
        errors,
        message: `Successfully applied dynamic pricing to ${updatedCount} products`
      });
    } catch (error) {
      res.status(500).json({ 
        success: false,
        message: "Failed to apply bulk pricing" 
      });
    }
  });

  // Create new pricing tier
  app.post("/api/pricing/tiers", async (req, res) => {
    try {
      const { min, max, multiplier, label, marginPercentage } = req.body;

      // Create the tier in the database
      const createdTier = await storage.createPricingTier({
        min: min.toString(),
        max: max.toString(),
        multiplier: multiplier.toString(),
        label,
        marginPercentage: marginPercentage.toString()
      });

      // Trigger recalculation for all affected products
      const products = await storage.getProducts();
      let updatedCount = 0;

      for (const product of products) {
        if (product.supplierPrice) {
          const supplierPrice = parseFloat(product.supplierPrice);
          const tierMin = parseFloat(createdTier.min);
          const tierMax = parseFloat(createdTier.max);

          if (supplierPrice >= tierMin && supplierPrice <= tierMax) {
            const result = calculateDynamicPrice(supplierPrice);
            await storage.updateProduct(product.id, {
              calculatedPrice: String(result.finalPrice),
              marginTier: result.marginTier,
              marginPercentage: String(result.marginPercentage)
            });
            updatedCount++;
          }
        }
      }

      res.json({ 
        success: true, 
        message: "Pricing tier created successfully",
        tier: createdTier,
        productsUpdated: updatedCount
      });
    } catch (error) {
      console.error("Error creating pricing tier:", error);
      res.status(500).json({ 
        success: false, 
        error: "Failed to create pricing tier" 
      });
    }
  });

  // Update pricing tier
  app.put("/api/pricing/tiers/:id", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const { min, max, multiplier, label, marginPercentage } = req.body;

      // Update the tier in thedatabase
      const updatedTier = await storage.updatePricingTier(parseInt(id), {
        min: min.toString(),
        max: max.toString(),
        multiplier: multiplier.toString(),
        label,
        marginPercentage: marginPercentage.toString()
      });

      if (!updatedTier) {
        return res.status(404).json({ 
          success: false, 
          error: "Pricing tier not found" 
        });
      }

      // Trigger recalculation for all products in this tier range
      const products = await storage.getProducts();
      let updatedCount = 0;

      for (const product of products) {
        if (product.supplierPrice) {
          const supplierPrice = parseFloat(product.supplierPrice);
          const tierMin = parseFloat(updatedTier.min);
          const tierMax = parseFloat(updatedTier.max);

          if (supplierPrice >= tierMin && supplierPrice <= tierMax) {
            const result = calculateDynamicPrice(supplierPrice);
            await storage.updateProduct(product.id, {
              calculatedPrice: String(result.finalPrice),
              marginTier: result.marginTier,
              marginPercentage: String(result.marginPercentage)
            });
            updatedCount++;
          }
        }
      }

      res.json({ 
        success: true, 
        message: "Pricing tier updated successfully",
        tier: updatedTier,
        productsUpdated: updatedCount
      });
    } catch (error) {
      console.error("Error updating pricing tier:", error);
      res.status(500).json({ 
        success: false, 
        error: "Failed to update pricing tier" 
      });
    }
  });

  // Delete pricing tier
  app.delete("/api/pricing/tiers/:id", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;

      const deleted = await storage.deletePricingTier(parseInt(id));

      if (!deleted) {
        return res.status(404).json({ 
          success: false, 
          error: "Pricing tier not found" 
        });
      }

      res.json({ 
        success: true, 
        message: "Pricing tier deleted successfully"
      });
    } catch (error) {
      console.error("Error deleting pricing tier:", error);
      res.status(500).json({ 
        success: false, 
        error: "Failed to delete pricing tier" 
      });
    }
  });

  // Product routes
  app.get("/api/products", requireAuth, async (req, res) => {
    try {
      const filters = {
        category: req.query.category as string,
        status: req.query.status as string,
        listedOnEbay: req.query.listedOnEbay ? req.query.listedOnEbay === 'true' : undefined,
        listedOnAmazon: req.query.listedOnAmazon ? req.query.listedOnAmazon === 'true' : undefined,
        minStock: req.query.minStock ? parseInt(req.query.minStock as string) : undefined,
        maxStock: req.query.maxStock ? parseInt(req.query.maxStock as string) : undefined,
      };

      // Remove undefined values
      const cleanFilters = Object.fromEntries(
        Object.entries(filters).filter(([_, value]) => value !== undefined)
      );

      const products = await storage.getProductsWithFilters(cleanFilters);
      res.json(products);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch products" });
    }
  });

  app.get("/api/products/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const product = await storage.getProduct(id);
      if (!product) {
        return res.status(404).json({ message: "Product not found" });
      }
      res.json(product);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch product" });
    }
  });

  app.post("/api/products", requireAuth, async (req, res) => {
    try {
      const productData = insertProductSchema.parse(req.body);

      // Check if SKU already exists
      const existingProduct = await storage.getProductBySku(productData.sku);
      if (existingProduct) {
        return res.status(400).json({ message: "Product with this SKU already exists" });
      }

      const product = await storage.createProduct(productData);
      res.status(201).json(product);
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({ message: "Invalid input", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create product" });
    }
  });

  app.put("/api/products/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);

      // Convert number fields to strings for decimal database fields
      const requestBody = { ...req.body };
      const decimalFields = ['weight', 'supplierPrice', 'salePrice', 'calculatedPrice', 'marginPercentage', 'margin'];

      decimalFields.forEach(field => {
        if (requestBody[field] !== undefined && typeof requestBody[field] === 'number') {
          requestBody[field] = String(requestBody[field]);
        }
      });

      const updateData = insertProductSchema.partial().parse(requestBody);

      const product = await storage.updateProduct(id, updateData);
      if (!product) {
        return res.status(404).json({ message: "Product not found" });
      }
      res.json(product);
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({ message: "Invalid input", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to update product" });
    }
  });

  app.delete("/api/products/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const success = await storage.deleteProduct(id);
      if (!success) {
        return res.status(404).json({ message: "Product not found" });
      }
      res.json({ message: "Product deleted successfully" });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete product" });
    }
  });


    // OPTIMIZED: Sync selected TME products using combined endpoints (80% fewer API calls)
    app.post("/api/tme/sync-selected-optimized", async (req, res) => {
      try {
        console.log("📥 Received sync request:", JSON.stringify(req.body, null, 2));
        const { productSymbols, settings } = req.body;

        if (!productSymbols || !Array.isArray(productSymbols) || productSymbols.length === 0) {
          return res.status(400).json({
            success: false,
            error: "Product symbols array is required"
          });
        }

        console.log(`🔄 Starting sync of ${productSymbols.length} selected products`);

        let syncedCount = 0;
        let updatedCount = 0;
        let failedCount = 0;
        const errors: string[] = [];

        // Get enhanced product information in batches
        const batchSize = 10;
        for (let i = 0; i < productSymbols.length; i += batchSize) {
          const batch = productSymbols.slice(i, i + batchSize);

          try {
            console.log(`📦 Processing batch ${Math.floor(i/batchSize) + 1}: ${batch.join(", ")}`);

            // Get enhanced product info (details + prices + stock)
            const enhancedProducts = await tmeApi.getEnhancedProductInfo(batch);

            for (const enhanced of enhancedProducts) {
              try {
                const { product, price, stock } = enhanced;

                // Get MOQ (minimum order quantity) and multiples from TME product
                const moq = product.MinAmount || 1;
                const multiples = product.Multiples || 1;

                // Calculate pricing - use correct price tier for MOQ quantity
                const { getSupplierPriceForMoq, calculateDynamicPrice, calculatePackagePrice } = await import("./dynamic-pricing");
                const supplierPrice = getSupplierPriceForMoq(price?.PriceList, moq);
                
                let pricingResult = {
                  finalPrice: supplierPrice,
                  calculatedPrice: supplierPrice,
                  marginTier: "No Margin",
                  marginPercentage: 0
                };

                if (settings.applyDynamicPricing && supplierPrice > 0) {
                  // For MOQ > 1: apply margin to PACKAGE cost (unit price × MOQ)
                  const result = moq > 1
                    ? calculatePackagePrice(supplierPrice, moq, multiples)
                    : calculateDynamicPrice(supplierPrice);
                  pricingResult = {
                    finalPrice: result.finalPrice,
                    calculatedPrice: result.calculatedPrice,
                    marginTier: result.marginTier,
                    marginPercentage: result.marginPercentage
                  };
                }

                // Prepare product data
                const productData = {
                  name: product.Description,
                  sku: product.Symbol,
                  ean: product.EAN || null,
                  category: product.Category || "Electronics",
                  description: product.Description,
                  supplierPrice: String(Number(supplierPrice)),
                  salePrice: String(Number(pricingResult.finalPrice)),
                  calculatedPrice: String(Number(pricingResult.calculatedPrice)),
                  marginTier: pricingResult.marginTier,
                  marginPercentage: String(Number(pricingResult.marginPercentage)),
                  stock: stock?.Amount || 100,
                  moq: moq,
                  multiples: multiples,
                  status: "active" as const,
                  weight: String(Number(product.Weight) || 10),
                  imageUrl: product.Photo ? (product.Photo.startsWith('//') ? `https:${product.Photo}` : product.Photo) : null,
                  dataSheetUrl: product.DataSheet ? `https://www.tme.eu${product.DataSheet}` : null,
                  productUrl: product.ProductInformationPage ? `https://www.tme.eu${product.ProductInformationPage}` : null,
                  supplier: "tme" as const,
                  supplierProductId: product.Symbol,
                  useStockLimit: settings.useStockLimit || false,
                  ebayStockLimit: settings.useStockLimit ? settings.ebayStockLimit : null
                };

                // Check if product already exists
                const existingProduct = await storage.getProductBySku(productData.sku);

                if (existingProduct) {
                  await storage.updateProduct(existingProduct.id, productData);
                  updatedCount++;
                  console.log(`✅ Updated product: ${product.Symbol}`);
                } else {
                  await storage.createProduct(productData);
                  syncedCount++;
                  console.log(`✅ Created product: ${product.Symbol}`);
                }

              } catch (error) {
                console.error(`❌ Error processing ${enhanced.product.Symbol}:`, error);
                failedCount++;
                errors.push(`Error processing ${enhanced.product.Symbol}: ${error instanceof Error ? error.message : 'Unknown error'}`);
              }
            }

            // Rate limiting between batches
            if (i + batchSize < productSymbols.length) {
              await new Promise(resolve => setTimeout(resolve, 1000));
            }

          } catch (error) {
            console.error(`❌ Batch processing failed:`, error);
            failedCount += batch.length;
            errors.push(`Batch processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
        }

        const totalProcessed = syncedCount + updatedCount + failedCount;

        res.json({
          success: true,
          results: {
            totalRequested: productSymbols.length,
            totalProcessed: totalProcessed,
            syncedCount: syncedCount,
            updatedCount: updatedCount,
            failedCount: failedCount,
            errors: errors
          },
          message: `Sync completed: ${syncedCount} new, ${updatedCount} updated, ${failedCount} failed`
        });

      } catch (error) {
        console.error("Sync selected products error:", error);
        res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : "Failed to sync selected products"
        });
      }
    });

  // Apply dynamic pricing to all products
  app.post("/api/pricing/apply-bulk", requireAuth, async (req, res) => {
    try {
      // Get all products
      const products = await storage.getProducts();

      // Filter products with valid supplier prices (> 0)
      const validProducts = products.filter(p => parseFloat(p.supplierPrice) > 0);

      let updatedCount = 0;
      let errors: string[] = [];

      for (const product of validProducts) {
        try {
          const pricingResult = calculateDynamicPrice(parseFloat(product.supplierPrice));

          if (!pricingResult.isValid) {
            errors.push(`Product ${product.name}: ${pricingResult.errors.join(', ')}`);
            continue;
          }

          // Update product with calculated pricing
          await storage.updateProduct(product.id, {
            calculatedPrice: pricingResult.finalPrice.toString(),
            marginTier: pricingResult.marginTier,
            marginPercentage: pricingResult.marginPercentage.toString(),
            priceUpdatedAt: new Date(),
            useCalculatedPrice: true,
            salePrice: pricingResult.finalPrice.toString()
          });

          updatedCount++;
        } catch (error) {
          errors.push(`Product ${product.name}: ${(error as Error).message}`);
        }
      }

      res.json({
        success: true,
        updatedCount,
        totalProducts: validProducts.length,
        skippedProducts: products.length - validProducts.length,
        errors,
        message: `Successfully applied dynamic pricing to ${updatedCount} products`
      });
    } catch (error) {
      res.status(500).json({ 
        success: false,
        message: "Failed to apply bulk pricing" 
      });
    }
  });

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

  app.get("/api/sync/logs", requireAuth, async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
      const logs = await storage.getSyncLogs(limit);
      res.json(logs);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch sync logs" });
    }
  });

  // Sync Status Dashboard - Aggregated stats for all sync jobs
  app.get("/api/sync/status", requireAuth, async (req, res) => {
    try {
      const logs = await storage.getSyncLogs(500); // Get more logs to calculate stats
      
      // Helper to get latest log by operation type
      const getLatestByOperation = (source: string, operation: string) => {
        return logs.find(log => log.source === source && log.operation === operation);
      };
      
      // Helper to count logs by source and status in last 24 hours
      const countRecentBySourceAndStatus = (source: string, status: string, hours: number = 24) => {
        const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
        return logs.filter(log => 
          log.source === source && 
          log.status === status && 
          log.syncedAt && new Date(log.syncedAt) > cutoff
        ).length;
      };
      
      // Daily Sync Stats - find latest cron log regardless of operation type
      const cronLogs = logs.filter(log => log.source === 'cron' && log.syncedAt);
      const latestCronLog = cronLogs[0]; // Already sorted by syncedAt desc
      
      // Determine daily sync status based on the MOST RECENT cron log
      let dailySyncStatus = 'unknown';
      let dailySyncLastRun: Date | string | null = null;
      let dailySyncMessage = 'No sync runs recorded';
      
      if (latestCronLog?.syncedAt) {
        dailySyncLastRun = latestCronLog.syncedAt;
        
        if (latestCronLog.operation === 'daily_sync_complete') {
          dailySyncStatus = 'success';
          dailySyncMessage = latestCronLog.message || 'Sync completed successfully';
        } else if (latestCronLog.operation === 'daily_sync_error') {
          dailySyncStatus = 'error';
          dailySyncMessage = latestCronLog.message || 'Sync failed';
        } else if (latestCronLog.operation === 'daily_sync_start') {
          // Check if there's a completion or error after this start
          const startTime = new Date(latestCronLog.syncedAt).getTime();
          const laterComplete = cronLogs.find(log => 
            log.operation === 'daily_sync_complete' && 
            log.syncedAt && new Date(log.syncedAt).getTime() > startTime
          );
          const laterError = cronLogs.find(log => 
            log.operation === 'daily_sync_error' && 
            log.syncedAt && new Date(log.syncedAt).getTime() > startTime
          );
          
          if (laterComplete) {
            dailySyncStatus = 'success';
            dailySyncLastRun = laterComplete.syncedAt;
            dailySyncMessage = laterComplete.message || 'Sync completed successfully';
          } else if (laterError) {
            dailySyncStatus = 'error';
            dailySyncLastRun = laterError.syncedAt;
            dailySyncMessage = laterError.message || 'Sync failed';
          } else {
            // Still running or stalled
            dailySyncStatus = 'running';
            dailySyncMessage = latestCronLog.message || 'Sync in progress...';
          }
        }
      }
      
      // Get the last complete for details
      const lastDailyComplete = cronLogs.find(log => log.operation === 'daily_sync_complete');
      
      // eBay Sync Stats (last 24 hours)
      const ebayListingSuccess = countRecentBySourceAndStatus('ebay', 'success');
      const ebayListingError = countRecentBySourceAndStatus('ebay', 'error');
      const lastEbayLog = logs.find(log => log.source === 'ebay');
      
      // TME Sync Stats (last 24 hours)
      const tmeSuccess = countRecentBySourceAndStatus('tme', 'success');
      const tmeError = countRecentBySourceAndStatus('tme', 'error');
      const lastTmeLog = logs.find(log => log.source === 'tme');
      
      // Parse details from last daily complete to get actual numbers
      let dailySyncDetails = { changedProducts: 0, ebayUpdates: 0, totalProducts: 0 };
      if (lastDailyComplete?.details) {
        try {
          const parsed = JSON.parse(lastDailyComplete.details);
          dailySyncDetails = {
            changedProducts: parsed.changedProducts || parsed.changes || 0,
            ebayUpdates: parsed.ebayUpdates || parsed.ebaySync?.succeeded || 0,
            totalProducts: parsed.totalProducts || 0
          };
        } catch (e) {
          // Ignore parse errors
        }
      }
      
      res.json({
        success: true,
        syncStatus: {
          dailySync: {
            status: dailySyncStatus,
            lastRun: dailySyncLastRun,
            message: dailySyncMessage,
            nextScheduled: '02:00 AM',
            details: dailySyncDetails
          },
          ebaySync: {
            status: ebayListingError > 0 && ebayListingSuccess === 0 ? 'error' : 
                   ebayListingSuccess > 0 ? 'success' : 'idle',
            lastRun: lastEbayLog?.syncedAt || null,
            successCount24h: ebayListingSuccess,
            errorCount24h: ebayListingError,
            lastMessage: lastEbayLog?.message || 'No recent eBay operations'
          },
          tmeSync: {
            status: tmeError > 0 && tmeSuccess === 0 ? 'error' :
                   tmeSuccess > 0 ? 'success' : 'idle',
            lastRun: lastTmeLog?.syncedAt || null,
            successCount24h: tmeSuccess,
            errorCount24h: tmeError,
            lastMessage: lastTmeLog?.message || 'No recent TME operations'
          }
        },
        recentLogs: logs.slice(0, 20) // Include recent logs for detail view
      });
    } catch (error) {
      console.error('Failed to get sync status:', error);
      res.status(500).json({ 
        success: false,
        message: "Failed to fetch sync status",
        error: (error as Error).message
      });
    }
  });

  app.post("/api/sync/trigger-daily", requireAuth, async (req, res) => {
    try {
      console.log('🔧 Manual daily sync triggered via API');
      
      const result = await triggerManualSync();
      
      res.json({
        success: true,
        message: 'Daily sync completed',
        result: {
          totalProducts: result.totalProducts,
          changedProducts: result.changedProducts,
          queuedItems: result.queuedItems,
          ebaySync: result.ebaySync,
          duration: result.duration
        }
      });
    } catch (error) {
      console.error('Manual sync trigger failed:', error);
      res.status(500).json({ 
        success: false,
        message: "Failed to trigger daily sync",
        error: (error as Error).message
      });
    }
  });

  app.post("/api/sync/trigger-ebay", requireAuth, async (req, res) => {
    try {
      console.log('🔧 Manual eBay sync triggered via API');
      
      const products = await storage.getProducts();
      const ebayProducts = products.filter(p => p.ebayItemId && p.listedOnEbay);
      
      if (ebayProducts.length === 0) {
        return res.json({
          success: true,
          message: 'No eBay-listed products to sync',
          result: { attempted: 0, succeeded: 0, failed: 0, skipped: 0 }
        });
      }
      
      // Use calculateEbayStock to apply stock limits (default 3) instead of raw TME stock
      const updates = ebayProducts.map(product => {
        const stockInfo = calculateEbayStock(product);
        console.log(`📊 Product ${product.sku}: TME stock ${stockInfo.tmeStock} → eBay stock ${stockInfo.ebayStock} (${stockInfo.limitReason})`);
        return {
          productId: product.id,
          ebayItemId: product.ebayItemId!,
          quantity: stockInfo.ebayStock, // Use limited eBay stock, not raw TME stock
          price: parseFloat(product.salePrice?.toString() || '0'),
          sku: product.sku
        };
      });
      
      const result = await ebayApi.bulkUpdateInventory(updates);
      
      res.json({
        success: true,
        message: 'eBay sync completed with stock limits applied',
        result: {
          attempted: updates.length,
          succeeded: result.succeeded,
          failed: result.failed,
          skipped: 0
        }
      });
    } catch (error) {
      console.error('Manual eBay sync failed:', error);
      res.status(500).json({ 
        success: false,
        message: "Failed to trigger eBay sync",
        error: (error as Error).message
      });
    }
  });

  // Backfill tmeCategoryId for existing products from TME API
  app.post("/api/sync/backfill-category-ids", requireAuth, async (req, res) => {
    try {
      console.log('🔄 Starting category ID backfill for existing products...');
      
      const products = await storage.getProducts();
      const tmeProducts = products.filter(p => 
        (p.supplier?.toLowerCase() === 'tme') && p.sku && !p.tmeCategoryId
      );
      
      if (tmeProducts.length === 0) {
        return res.json({
          success: true,
          message: 'No products need category ID backfill',
          result: { total: 0, updated: 0 }
        });
      }
      
      console.log(`📦 Backfilling category IDs for ${tmeProducts.length} TME products`);
      
      let updatedCount = 0;
      const batchSize = 50;
      
      for (let i = 0; i < tmeProducts.length; i += batchSize) {
        const batch = tmeProducts.slice(i, i + batchSize);
        const symbols = batch.map(p => p.sku);
        
        try {
          const tmeProductDetails = await tmeApi.getEnhancedProductInfo(symbols);
          
          for (const enhanced of tmeProductDetails) {
            const { product: tmeProduct } = enhanced;
            const localProduct = batch.find(p => p.sku === tmeProduct.Symbol);
            
            if (localProduct && tmeProduct.CategoryId) {
              await storage.updateProduct(localProduct.id, {
                tmeCategoryId: String(tmeProduct.CategoryId)
              });
              updatedCount++;
            }
          }
          
          if (i + batchSize < tmeProducts.length) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        } catch (error) {
          console.error(`❌ Batch category backfill failed:`, error);
        }
      }
      
      console.log(`🎉 Category ID backfill complete: ${updatedCount}/${tmeProducts.length} products updated`);
      
      res.json({
        success: true,
        message: `Category ID backfill completed`,
        result: {
          total: tmeProducts.length,
          updated: updatedCount
        }
      });
    } catch (error) {
      console.error('Category ID backfill failed:', error);
      res.status(500).json({ 
        success: false,
        message: "Failed to backfill category IDs",
        error: (error as Error).message
      });
    }
  });

  // Update MOQ (minimum order quantity) for existing products from TME API
  app.post("/api/sync/update-moq", requireAuth, async (req, res) => {
    try {
      console.log('🔄 Starting MOQ update for existing products...');
      
      const products = await storage.getProducts();
      const tmeProducts = products.filter(p => (p.supplier?.toLowerCase() === 'tme') && p.sku);
      
      if (tmeProducts.length === 0) {
        return res.json({
          success: true,
          message: 'No TME products to update',
          result: { total: 0, updated: 0 }
        });
      }
      
      console.log(`📦 Updating MOQ for ${tmeProducts.length} TME products`);
      
      let updatedCount = 0;
      const batchSize = 50;
      
      for (let i = 0; i < tmeProducts.length; i += batchSize) {
        const batch = tmeProducts.slice(i, i + batchSize);
        const symbols = batch.map(p => p.sku);
        
        try {
          // Fetch product details from TME to get MinAmount/Multiples
          const tmeProductDetails = await tmeApi.getEnhancedProductInfo(symbols);
          
          for (const enhanced of tmeProductDetails) {
            const { product: tmeProduct } = enhanced;
            const localProduct = batch.find(p => p.sku === tmeProduct.Symbol);
            
            if (localProduct && tmeProduct) {
              const moq = tmeProduct.MinAmount || 1;
              const multiples = tmeProduct.Multiples || 1;
              
              // Only update if different
              if (localProduct.moq !== moq || localProduct.multiples !== multiples) {
                await storage.updateProduct(localProduct.id, {
                  moq,
                  multiples
                });
                updatedCount++;
                console.log(`✅ Updated ${tmeProduct.Symbol}: MOQ=${moq}, Multiples=${multiples}`);
              }
            }
          }
          
          // Rate limiting
          if (i + batchSize < tmeProducts.length) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        } catch (error) {
          console.error(`❌ Batch MOQ update failed:`, error);
        }
      }
      
      console.log(`🎉 MOQ update complete: ${updatedCount}/${tmeProducts.length} products updated`);
      
      res.json({
        success: true,
        message: `MOQ update completed`,
        result: {
          total: tmeProducts.length,
          updated: updatedCount
        }
      });
    } catch (error) {
      console.error('MOQ update failed:', error);
      res.status(500).json({ 
        success: false,
        message: "Failed to update MOQ",
        error: (error as Error).message
      });
    }
  });

  // Image processing endpoints
  app.post('/api/images/process-watermark', async (req, res) => {
    try {
      const { imageUrl, advanced = false } = req.body;

      if (!imageUrl) {
        return res.status(400).json({ error: 'Image URL is required' });
      }

      console.log(`🖼️ Processing watermark removal for: ${imageUrl}`);

      const result = advanced 
        ? await imageProcessingService.removeWatermarkAdvanced(imageUrl)
        : await imageProcessingService.removeWatermark(imageUrl);

      res.json(result);
    } catch (error) {
      console.error('Watermark removal failed:', error);
      res.status(500).json({ 
        error: 'Failed to process image',
        details: (error as Error).message 
      });
    }
  });

  app.post('/api/images/process-batch', async (req, res) => {
    try {
      const { imageUrls } = req.body;

      if (!Array.isArray(imageUrls) || imageUrls.length === 0) {
        return res.status(400).json({ error: 'Array of image URLs is required' });
      }

      if (imageUrls.length > 20) {
        return res.status(400).json({ error: 'Maximum 20 images per batch' });
      }

      console.log(`🖼️ Processing batch watermark removal for ${imageUrls.length} images`);

      const results = await imageProcessingService.processMultipleImages(imageUrls);

      const summary = {
        total: results.length,
        successful: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
        results
      };

      res.json(summary);
    } catch (error) {
      console.error('Batch watermark removal failed:', error);
      res.status(500).json({ 
        error: 'Failed to process image batch',
        details: (error as Error).message 
      });
    }
  });

  app.get('/api/images/processed/:filename', async (req, res) => {
    try {
      const { filename } = req.params;

      const imageBuffer = await imageProcessingService.getProcessedImage(filename);

      if (!imageBuffer) {
        return res.status(404).json({ error: 'Processed image not found' });
      }

      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours
      res.send(imageBuffer);
    } catch (error) {
      console.error('Failed to serve processed image:', error);
      res.status(500).json({ error: 'Failed to serve image' });
    }
  });

  app.post('/api/images/cleanup', async (req, res) => {
    try {
      const { maxAgeHours = 24 } = req.body;

      await imageProcessingService.cleanupOldImages(maxAgeHours);

      res.json({ 
        success: true, 
        message: `Cleaned up processed images older than ${maxAgeHours} hours` 
      });
    } catch (error) {
      console.error('Image cleanup failed:', error);
      res.status(500).json({ 
        error: 'Failed to cleanup images',
        details: (error as Error).message 
      });
    }
  });

  // ==========================================
  // ORDERS MANAGEMENT ROUTES
  // ==========================================

  // Get all orders with filtering
  app.get('/api/orders', requireAuth, async (req, res) => {
    try {
      const filters: {
        marketplace?: string;
        status?: string;
        search?: string;
        fromDate?: Date;
        toDate?: Date;
        limit?: number;
        offset?: number;
      } = {};

      if (req.query.marketplace) filters.marketplace = req.query.marketplace as string;
      if (req.query.status) filters.status = req.query.status as string;
      if (req.query.search) filters.search = req.query.search as string;
      if (req.query.fromDate) filters.fromDate = new Date(req.query.fromDate as string);
      if (req.query.toDate) filters.toDate = new Date(req.query.toDate as string);
      if (req.query.limit) filters.limit = parseInt(req.query.limit as string);
      if (req.query.offset) filters.offset = parseInt(req.query.offset as string);

      const orders = await storage.getOrders(filters);
      const total = await storage.getOrdersCount({
        marketplace: filters.marketplace,
        status: filters.status
      });

      // Include items for each order
      const ordersWithItems = await Promise.all(
        orders.map(async (order) => {
          const items = await storage.getOrderItems(order.id);
          return { ...order, items };
        })
      );

      res.json({
        success: true,
        orders: ordersWithItems,
        total,
        limit: filters.limit,
        offset: filters.offset
      });
    } catch (error) {
      console.error('Failed to fetch orders:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch orders'
      });
    }
  });

  // Get order statistics/summary
  app.get('/api/orders/stats', requireAuth, async (req, res) => {
    try {
      const [totalOrders, newOrders, packedOrders, shippedOrders] = await Promise.all([
        storage.getOrdersCount(),
        storage.getOrdersCount({ status: 'new' }),
        storage.getOrdersCount({ status: 'packed' }),
        storage.getOrdersCount({ status: 'shipped' })
      ]);

      const [ebayOrders, amazonOrders] = await Promise.all([
        storage.getOrdersCount({ marketplace: 'ebay' }),
        storage.getOrdersCount({ marketplace: 'amazon' })
      ]);

      res.json({
        success: true,
        stats: {
          total: totalOrders,
          byStatus: {
            new: newOrders,
            packed: packedOrders,
            shipped: shippedOrders
          },
          byMarketplace: {
            ebay: ebayOrders,
            amazon: amazonOrders
          }
        }
      });
    } catch (error) {
      console.error('Failed to fetch order stats:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch order statistics'
      });
    }
  });

  // Get single order with full details
  app.get('/api/orders/:id', requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const order = await storage.getOrder(id);

      if (!order) {
        return res.status(404).json({
          success: false,
          error: 'Order not found'
        });
      }

      // Get related data
      const [items, fees, events] = await Promise.all([
        storage.getOrderItems(id),
        storage.getOrderFees(id),
        storage.getOrderEvents(id)
      ]);

      res.json({
        success: true,
        order: {
          ...order,
          items,
          fees,
          events
        }
      });
    } catch (error) {
      console.error('Failed to fetch order:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch order'
      });
    }
  });

  // Update order status
  app.patch('/api/orders/:id/status', requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { status, notes, trackingNumber, trackingCarrier } = req.body;

      const order = await storage.getOrder(id);
      if (!order) {
        return res.status(404).json({
          success: false,
          error: 'Order not found'
        });
      }

      // Validate status transition
      const validTransitions: Record<string, string[]> = {
        'new': ['packed', 'cancelled'],
        'packed': ['shipped', 'new'],
        'shipped': ['delivered', 'returned'],
        'delivered': ['completed', 'returned'],
        'completed': [],
        'returned': [],
        'cancelled': []
      };

      if (!validTransitions[order.status]?.includes(status)) {
        return res.status(400).json({
          success: false,
          error: `Invalid status transition from ${order.status} to ${status}`
        });
      }

      // Update the order
      const updateData: any = { status };
      if (trackingNumber) updateData.trackingNumber = trackingNumber;
      if (trackingCarrier) updateData.shippingCarrier = trackingCarrier;
      if (status === 'shipped' && !updateData.shippedAt) updateData.shippedAt = new Date();
      if (status === 'delivered' && !updateData.deliveredAt) updateData.deliveredAt = new Date();

      const updatedOrder = await storage.updateOrder(id, updateData);

      // Log the status change event
      await storage.createOrderEvent({
        orderId: id,
        eventType: 'status_change',
        fromStatus: order.status,
        toStatus: status,
        note: notes || null
      });

      // Trigger auto-message rules for this status change
      const triggerMap: Record<string, 'order_packed' | 'order_shipped' | 'order_delivered' | null> = {
        'packed': 'order_packed',
        'shipped': 'order_shipped',
        'delivered': 'order_delivered'
      };
      const triggerType = triggerMap[status];
      if (triggerType) {
        const items = await storage.getOrderItems(id);
        autoMessageScheduler.processAutoMessageTrigger(triggerType, {
          order: updatedOrder!,
          items: items.map(i => ({ marketplaceItemId: i.marketplaceItemId || undefined, title: i.title })),
          trackingNumber: updatedOrder?.trackingNumber || undefined
        }).catch(err => console.error('Auto-message trigger failed:', err));
      }

      res.json({
        success: true,
        order: updatedOrder
      });
    } catch (error) {
      console.error('Failed to update order status:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update order status'
      });
    }
  });

  // Add tracking information
  app.patch('/api/orders/:id/tracking', requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { trackingNumber, trackingCarrier, trackingUrl } = req.body;

      const order = await storage.getOrder(id);
      if (!order) {
        return res.status(404).json({
          success: false,
          error: 'Order not found'
        });
      }

      const updatedOrder = await storage.updateOrder(id, {
        trackingNumber,
        shippingCarrier: trackingCarrier,
        trackingUrl
      });

      // Log the tracking update event
      await storage.createOrderEvent({
        orderId: id,
        eventType: 'tracking_update',
        note: `Tracking: ${trackingCarrier} - ${trackingNumber}`
      });

      res.json({
        success: true,
        order: updatedOrder
      });
    } catch (error) {
      console.error('Failed to update tracking:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update tracking information'
      });
    }
  });

  // Add note to order
  app.post('/api/orders/:id/notes', requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { notes } = req.body;

      const order = await storage.getOrder(id);
      if (!order) {
        return res.status(404).json({
          success: false,
          error: 'Order not found'
        });
      }

      // Log the note as an event
      const event = await storage.createOrderEvent({
        orderId: id,
        eventType: 'note',
        note: notes
      });

      res.json({
        success: true,
        event
      });
    } catch (error) {
      console.error('Failed to add order note:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to add order note'
      });
    }
  });

  // Get order events/history
  app.get('/api/orders/:id/events', requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const events = await storage.getOrderEvents(id);

      res.json({
        success: true,
        events
      });
    } catch (error) {
      console.error('Failed to fetch order events:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch order events'
      });
    }
  });

  // Print shipping label placeholder (for Latvian Post integration later)
  app.post('/api/orders/:id/print-label', requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const order = await storage.getOrder(id);

      if (!order) {
        return res.status(404).json({
          success: false,
          error: 'Order not found'
        });
      }

      // Log the print label request
      await storage.createOrderEvent({
        orderId: id,
        eventType: 'label_print',
        note: 'Shipping label print requested (integration pending)'
      });

      // Placeholder response - will be replaced with actual Latvian Post API integration
      res.json({
        success: true,
        message: 'Shipping label printing is not yet configured. Latvian Post API integration coming soon.',
        order: {
          id: order.id,
          shippingName: order.shippingName,
          shippingAddressLine1: order.shippingAddressLine1,
          shippingAddressLine2: order.shippingAddressLine2,
          shippingCity: order.shippingCity,
          shippingStateOrProvince: order.shippingStateOrProvince,
          shippingPostalCode: order.shippingPostalCode,
          shippingCountry: order.shippingCountry
        },
        labelReady: false,
        integrationStatus: 'pending'
      });
    } catch (error) {
      console.error('Failed to print label:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to process print label request'
      });
    }
  });

  // Delete order (admin only)
  app.delete('/api/orders/:id', requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const deleted = await storage.deleteOrder(id);

      if (!deleted) {
        return res.status(404).json({
          success: false,
          error: 'Order not found'
        });
      }

      res.json({
        success: true,
        message: 'Order deleted successfully'
      });
    } catch (error) {
      console.error('Failed to delete order:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to delete order'
      });
    }
  });

  // ==========================================
  // EBAY ORDERS SYNC ROUTES
  // ==========================================

  // Sync orders from eBay
  app.post('/api/orders/sync/ebay', requireAuth, async (req, res) => {
    try {
      const { daysBack = 30 } = req.body;
      
      console.log(`📦 Starting eBay orders sync (${daysBack} days)...`);
      
      const result = await ebayOrdersApi.syncOrdersFromEbay(daysBack);
      
      res.json({
        success: true,
        message: `Synced ${result.synced} new orders, updated ${result.updated} existing orders`,
        ...result
      });
    } catch (error) {
      console.error('eBay orders sync failed:', error);
      res.status(500).json({
        success: false,
        error: (error as Error).message
      });
    }
  });

  // Check eBay OAuth status for orders
  app.get('/api/orders/sync/status', requireAuth, async (req, res) => {
    try {
      const isConfigured = ebayOAuth.isOAuthConfigured();
      
      res.json({
        success: true,
        ebay: {
          configured: isConfigured,
          message: isConfigured 
            ? 'eBay OAuth is configured and ready to sync orders'
            : 'eBay OAuth not configured. Set EBAY_OAUTH_CLIENT_ID, EBAY_OAUTH_CLIENT_SECRET, and EBAY_OAUTH_REFRESH_TOKEN'
        },
        amazon: {
          configured: false,
          message: 'Amazon SP-API integration coming soon'
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: (error as Error).message
      });
    }
  });

  // ==========================================
  // MESSAGING SYSTEM ROUTES
  // ==========================================

  // Get all message threads
  app.get('/api/messages/threads', requireAuth, async (req, res) => {
    try {
      const filters = {
        marketplace: req.query.marketplace as string | undefined,
        status: req.query.status as string | undefined,
        isRead: req.query.isRead === 'true' ? true : req.query.isRead === 'false' ? false : undefined,
        buyerUsername: req.query.search as string | undefined,
        limit: req.query.limit ? parseInt(req.query.limit as string) : 50,
        offset: req.query.offset ? parseInt(req.query.offset as string) : 0
      };

      const threads = await storage.getMessageThreads(filters);
      const unreadCount = await storage.getUnreadThreadCount();

      res.json({
        success: true,
        threads,
        unreadCount
      });
    } catch (error) {
      console.error('Failed to fetch message threads:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch message threads'
      });
    }
  });

  // Get single thread with messages
  app.get('/api/messages/threads/:id', requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const thread = await storage.getMessageThread(id);

      if (!thread) {
        return res.status(404).json({
          success: false,
          error: 'Thread not found'
        });
      }

      const threadMessages = await storage.getMessages(id);

      // Mark thread as read
      if (!thread.isRead) {
        await storage.updateMessageThread(id, { isRead: true });
      }

      res.json({
        success: true,
        thread,
        messages: threadMessages
      });
    } catch (error) {
      console.error('Failed to fetch thread:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch thread'
      });
    }
  });

  // Mark thread as read/unread
  app.patch('/api/messages/threads/:id/read', requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { isRead } = req.body;

      const updated = await storage.updateMessageThread(id, { isRead });

      if (!updated) {
        return res.status(404).json({
          success: false,
          error: 'Thread not found'
        });
      }

      res.json({
        success: true,
        thread: updated
      });
    } catch (error) {
      console.error('Failed to update thread:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update thread'
      });
    }
  });

  // Star/unstar thread
  app.patch('/api/messages/threads/:id/star', requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { isStarred } = req.body;

      const updated = await storage.updateMessageThread(id, { isStarred });

      if (!updated) {
        return res.status(404).json({
          success: false,
          error: 'Thread not found'
        });
      }

      res.json({
        success: true,
        thread: updated
      });
    } catch (error) {
      console.error('Failed to update thread:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update thread'
      });
    }
  });

  // Send message reply
  app.post('/api/messages/threads/:id/reply', requireAuth, async (req, res) => {
    try {
      const threadId = parseInt(req.params.id);
      const { body, templateId } = req.body;

      if (!body || body.trim().length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Message body is required'
        });
      }

      const thread = await storage.getMessageThread(threadId);
      if (!thread) {
        return res.status(404).json({
          success: false,
          error: 'Thread not found'
        });
      }

      // Check if we can still send messages (90-day limit for eBay)
      if (thread.marketplace === 'ebay' && thread.orderId) {
        const order = await storage.getOrder(thread.orderId);
        if (order) {
          const eligibility = ebayMessagesApi.checkOrderMessageEligibility(new Date(order.orderDate || order.createdAt!));
          if (!eligibility.eligible) {
            return res.status(400).json({
              success: false,
              error: 'Cannot send message - 90-day limit exceeded for eBay orders'
            });
          }
        }
      }

      // Send to eBay if configured
      let ebayResult: { success: boolean; error?: string } = { success: true };
      if (thread.marketplace === 'ebay' && thread.itemId && ebayOAuth.isOAuthConfigured()) {
        ebayResult = await ebayMessagesApi.sendMessageToPartner(
          thread.itemId,
          thread.buyerUsername,
          body
        );

        if (!ebayResult.success) {
          return res.status(500).json({
            success: false,
            error: `Failed to send message to eBay: ${ebayResult.error}`
          });
        }
      }

      // Store the message
      const message = await storage.createMessage({
        threadId,
        direction: 'outbound',
        body,
        senderUsername: 'seller',
        status: ebayResult.success ? 'sent' : 'failed',
        errorMessage: ebayResult.error,
        templateId: templateId || null,
        sentAt: new Date()
      });

      // Update template usage if used
      if (templateId) {
        await storage.incrementTemplateUsage(templateId);
      }

      res.json({
        success: true,
        message,
        ebayStatus: ebayResult.success ? 'sent' : 'failed'
      });
    } catch (error) {
      console.error('Failed to send reply:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to send reply'
      });
    }
  });

  // Helper function to clean HTML from message bodies
  const cleanMessageBodyForStorage = (html: string): string => {
    if (!html) return '';
    let text = html
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'");
    if (text.includes('<') || text.includes('&lt;')) {
      // Remove entire style blocks including content
      text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
      // Remove entire script blocks including content
      text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
      // Remove head section entirely
      text = text.replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '');
      // Remove HTML comments
      text = text.replace(/<!--[\s\S]*?-->/g, '');
      // Remove DOCTYPE and XML declarations
      text = text.replace(/<!DOCTYPE[^>]*>/gi, '');
      text = text.replace(/<\?xml[^>]*\?>/gi, '');
      // Replace block elements with newlines
      text = text.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n')
        .replace(/<\/div>/gi, '\n').replace(/<\/tr>/gi, '\n').replace(/<\/li>/gi, '\n');
      // Remove all remaining HTML tags
      text = text.replace(/<[^>]+>/g, '');
      // Clean up whitespace
      text = text.replace(/\n\s*\n\s*\n/g, '\n\n').replace(/[ \t]+/g, ' ').trim();
    }
    return text.trim();
  };

  // Sync messages from eBay
  app.post('/api/messages/sync/ebay', requireAuth, async (req, res) => {
    try {
      if (!ebayOAuth.isOAuthConfigured()) {
        return res.status(400).json({
          success: false,
          error: 'eBay OAuth not configured'
        });
      }

      const { daysBack = 30 } = req.body;
      const startTime = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);

      console.log(`📬 Syncing eBay messages from last ${daysBack} days...`);

      let synced = 0;
      let updated = 0;
      let pageNum = 1;
      let hasMore = true;

      // Keep fetching pages until no more messages
      while (hasMore) {
        console.log(`📬 Fetching message page ${pageNum}...`);
        const result = await ebayMessagesApi.getMyMessages(startTime, undefined, 'Inbox', 100, pageNum);

        if (!result.success) {
          return res.status(500).json({
            success: false,
            error: result.error
          });
        }

        hasMore = result.hasMoreMessages || false;

        for (const msg of result.messages) {
          // Find or create thread
          let thread = await storage.getMessageThreadByBuyer(msg.sender, msg.itemId);

          if (!thread) {
            thread = await storage.createMessageThread({
              marketplace: 'ebay',
              marketplaceThreadId: msg.messageId,
              buyerUsername: msg.sender,
              buyerEmail: msg.senderEmail,
              itemId: msg.itemId,
              itemTitle: msg.itemTitle,
              subject: cleanMessageBodyForStorage(msg.subject),
              status: 'open',
              isRead: msg.isRead,
              lastMessageAt: new Date(msg.creationDate)
            });
            synced++;
          } else {
            // Update thread subject with cleaned content if needed
            const cleanedSubject = cleanMessageBodyForStorage(msg.subject);
            if (thread.subject !== cleanedSubject) {
              await storage.updateMessageThread(thread.id, {
                subject: cleanedSubject,
                lastMessageAt: new Date(msg.creationDate)
              });
            }
            updated++;
          }

          // Check if message already exists
          const existingMessages = await storage.getMessages(thread.id);
          const existingMsg = existingMessages.find(m => m.marketplaceMessageId === msg.messageId);

          if (!existingMsg) {
            await storage.createMessage({
              threadId: thread.id,
              direction: 'inbound',
              subject: cleanMessageBodyForStorage(msg.subject),
              body: cleanMessageBodyForStorage(msg.body),
              marketplaceMessageId: msg.messageId,
              senderUsername: msg.sender,
              senderEmail: msg.senderEmail,
              status: 'delivered'
            });
          } else {
            // Update existing message with cleaned HTML content
            const cleanedBody = cleanMessageBodyForStorage(msg.body);
            const cleanedSubject = cleanMessageBodyForStorage(msg.subject);
            if (existingMsg.body !== cleanedBody || existingMsg.subject !== cleanedSubject) {
              await storage.updateMessage(existingMsg.id, {
                body: cleanedBody,
                subject: cleanedSubject
              });
            }
          }
        }

        if (hasMore) pageNum++;
      }

      console.log(`📬 Synced ${synced} new threads, updated ${updated} existing threads`);

      res.json({
        success: true,
        synced,
        updated,
        totalMessages: synced + updated
      });
    } catch (error) {
      console.error('Failed to sync eBay messages:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to sync messages from eBay'
      });
    }
  });

  // Get message templates
  app.get('/api/messages/templates', requireAuth, async (req, res) => {
    try {
      const category = req.query.category as string | undefined;
      const templates = await storage.getMessageTemplates(category);

      res.json({
        success: true,
        templates
      });
    } catch (error) {
      console.error('Failed to fetch templates:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch templates'
      });
    }
  });

  // Create message template
  app.post('/api/messages/templates', requireAuth, async (req, res) => {
    try {
      const data = insertMessageTemplateSchema.parse(req.body);
      const template = await storage.createMessageTemplate(data);

      res.json({
        success: true,
        template
      });
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({
          success: false,
          error: 'Invalid template data',
          details: error.errors
        });
      }
      console.error('Failed to create template:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to create template'
      });
    }
  });

  // Update message template
  app.patch('/api/messages/templates/:id', requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const updated = await storage.updateMessageTemplate(id, req.body);

      if (!updated) {
        return res.status(404).json({
          success: false,
          error: 'Template not found'
        });
      }

      res.json({
        success: true,
        template: updated
      });
    } catch (error) {
      console.error('Failed to update template:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update template'
      });
    }
  });

  // Delete message template
  app.delete('/api/messages/templates/:id', requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const deleted = await storage.deleteMessageTemplate(id);

      if (!deleted) {
        return res.status(404).json({
          success: false,
          error: 'Template not found'
        });
      }

      res.json({
        success: true,
        message: 'Template deleted'
      });
    } catch (error) {
      console.error('Failed to delete template:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to delete template'
      });
    }
  });

  // Render template with variables
  app.post('/api/messages/templates/:id/preview', requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { variables } = req.body;

      const template = await storage.getMessageTemplate(id);

      if (!template) {
        return res.status(404).json({
          success: false,
          error: 'Template not found'
        });
      }

      const renderedBody = ebayMessagesApi.renderTemplate(template.body, variables || {});
      const renderedSubject = template.subject 
        ? ebayMessagesApi.renderTemplate(template.subject, variables || {})
        : undefined;

      res.json({
        success: true,
        preview: {
          subject: renderedSubject,
          body: renderedBody
        }
      });
    } catch (error) {
      console.error('Failed to preview template:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to preview template'
      });
    }
  });

  // Get auto-message rules
  app.get('/api/messages/auto-rules', requireAuth, async (req, res) => {
    try {
      const triggerType = req.query.triggerType as string | undefined;
      const rules = await storage.getAutoMessageRules(triggerType);

      res.json({
        success: true,
        rules
      });
    } catch (error) {
      console.error('Failed to fetch auto-message rules:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch rules'
      });
    }
  });

  // Create auto-message rule
  app.post('/api/messages/auto-rules', requireAuth, async (req, res) => {
    try {
      const data = insertAutoMessageRuleSchema.parse(req.body);
      const rule = await storage.createAutoMessageRule(data);

      res.json({
        success: true,
        rule
      });
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({
          success: false,
          error: 'Invalid rule data',
          details: error.errors
        });
      }
      console.error('Failed to create auto-message rule:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to create rule'
      });
    }
  });

  // Update auto-message rule
  app.patch('/api/messages/auto-rules/:id', requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const updated = await storage.updateAutoMessageRule(id, req.body);

      if (!updated) {
        return res.status(404).json({
          success: false,
          error: 'Rule not found'
        });
      }

      res.json({
        success: true,
        rule: updated
      });
    } catch (error) {
      console.error('Failed to update auto-message rule:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update rule'
      });
    }
  });

  // Delete auto-message rule
  app.delete('/api/messages/auto-rules/:id', requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const deleted = await storage.deleteAutoMessageRule(id);

      if (!deleted) {
        return res.status(404).json({
          success: false,
          error: 'Rule not found'
        });
      }

      res.json({
        success: true,
        message: 'Rule deleted'
      });
    } catch (error) {
      console.error('Failed to delete auto-message rule:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to delete rule'
      });
    }
  });

  // Get scheduled messages
  app.get('/api/messages/scheduled', requireAuth, async (req, res) => {
    try {
      const status = req.query.status as string | undefined;
      const scheduledMsgs = await storage.getScheduledMessages(status);

      res.json({
        success: true,
        scheduled: scheduledMsgs
      });
    } catch (error) {
      console.error('Failed to fetch scheduled messages:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch scheduled messages'
      });
    }
  });

  // Cancel scheduled message
  app.delete('/api/messages/scheduled/:id', requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const cancelled = await storage.cancelScheduledMessage(id);

      if (!cancelled) {
        return res.status(404).json({
          success: false,
          error: 'Scheduled message not found'
        });
      }

      res.json({
        success: true,
        message: 'Scheduled message cancelled'
      });
    } catch (error) {
      console.error('Failed to cancel scheduled message:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to cancel scheduled message'
      });
    }
  });

  // Send message from order page (quick message to buyer)
  app.post('/api/orders/:id/message', requireAuth, async (req, res) => {
    try {
      const orderId = parseInt(req.params.id);
      const { body, templateId } = req.body;

      if (!body || body.trim().length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Message body is required'
        });
      }

      const order = await storage.getOrder(orderId);
      if (!order) {
        return res.status(404).json({
          success: false,
          error: 'Order not found'
        });
      }

      // Check 90-day eligibility for eBay
      if (order.marketplace === 'ebay') {
        const eligibility = ebayMessagesApi.checkOrderMessageEligibility(new Date(order.orderDate || order.createdAt!));
        if (!eligibility.eligible) {
          return res.status(400).json({
            success: false,
            error: `Cannot send message - 90-day limit exceeded (${eligibility.daysRemaining} days past limit)`
          });
        }
      }

      // Find or create thread for this order
      let thread = await storage.getMessageThreadByBuyer(order.buyerUsername!, order.marketplaceOrderId);
      if (!thread) {
        thread = await storage.createMessageThread({
          marketplace: order.marketplace,
          buyerUsername: order.buyerUsername!,
          buyerEmail: order.buyerEmail,
          orderId: order.id,
          marketplaceOrderId: order.marketplaceOrderId,
          subject: `Order ${order.marketplaceOrderId}`,
          status: 'open',
          isRead: true,
          lastMessageAt: new Date()
        });
      }

      // Send to eBay
      let ebayResult: { success: boolean; error?: string } = { success: true };
      if (order.marketplace === 'ebay' && ebayOAuth.isOAuthConfigured()) {
        // Get first item's ID for the message
        const items = await storage.getOrderItems(orderId);
        const itemId = items[0]?.marketplaceItemId;

        if (itemId) {
          ebayResult = await ebayMessagesApi.sendMessageToPartner(
            itemId,
            order.buyerUsername!,
            body
          );
        }
      }

      // Store the message
      const message = await storage.createMessage({
        threadId: thread.id,
        direction: 'outbound',
        body,
        senderUsername: 'seller',
        status: ebayResult.success ? 'sent' : 'failed',
        errorMessage: ebayResult.error,
        templateId: templateId || null,
        sentAt: new Date()
      });

      // Log the event
      await storage.createOrderEvent({
        orderId,
        eventType: 'message_sent',
        note: `Message sent to buyer: ${body.substring(0, 100)}${body.length > 100 ? '...' : ''}`
      });

      res.json({
        success: true,
        message,
        threadId: thread.id,
        ebayStatus: ebayResult.success ? 'sent' : 'failed'
      });
    } catch (error) {
      console.error('Failed to send order message:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to send message'
      });
    }
  });

  // Get messages for an order
  app.get('/api/orders/:id/messages', requireAuth, async (req, res) => {
    try {
      const orderId = parseInt(req.params.id);

      const threads = await storage.getMessageThreads({ orderId });
      
      if (threads.length === 0) {
        return res.json({
          success: true,
          thread: null,
          messages: []
        });
      }

      const thread = threads[0];
      const threadMessages = await storage.getMessages(thread.id);

      res.json({
        success: true,
        thread,
        messages: threadMessages
      });
    } catch (error) {
      console.error('Failed to fetch order messages:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch messages'
      });
    }
  });

  // Check messaging status
  app.get('/api/messages/status', requireAuth, async (req, res) => {
    try {
      const isConfigured = ebayOAuth.isOAuthConfigured();
      const unreadCount = await storage.getUnreadThreadCount();
      const templates = await storage.getMessageTemplates();
      const rules = await storage.getAutoMessageRules();

      res.json({
        success: true,
        ebay: {
          configured: isConfigured,
          message: isConfigured 
            ? 'eBay messaging is configured and ready'
            : 'eBay OAuth not configured'
        },
        unreadCount,
        templatesCount: templates.length,
        activeRulesCount: rules.filter(r => r.isActive).length
      });
    } catch (error) {
      console.error('Failed to get messaging status:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get messaging status'
      });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
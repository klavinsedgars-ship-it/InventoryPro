import type { Express } from "express";
import { storage } from "../storage";
import { requireAuth } from "../middleware/auth";
import { tmeApi } from "../tme-api";
import { tmeApiOptimized } from "../tme-api-optimized";
import { ebayAccountApi } from "../ebay-account-api";
import { processTmeSyncChunk } from "../tme-sync";
import { getFeeConfig } from "../fee-config";
import { calculatePriceWithFloor } from "../dynamic-pricing";
import { randomUUID } from "crypto";

const TME_SYNC_CHUNK_SIZE = 100;

// Shape a sync_jobs row into the progress payload the client polls.
function syncJobProgress(job: any) {
  return {
    jobId: job.jobId,
    status: job.status,
    total: job.total,
    processed: job.processed,
    syncedCount: job.syncedCount,
    updatedCount: job.updatedCount,
    failedCount: job.failedCount,
    message: job.message ?? null,
    errors: job.errors ? JSON.parse(job.errors) : [],
  };
}

// TME browsing, product/price/stock lookups, chunked import jobs, usage — plus
// the two eBay usage/seller-limit lookups interleaved here. Extracted from the
// routes.ts monolith (behaviour unchanged).
export function registerTmeRoutes(app: Express): void {
    app.get("/api/tme/stock-debug", requireAuth, async (req, res) => {
      try {
        const symbol = ((req.query.symbol as string) || "").trim();
        if (!symbol) {
          return res.status(400).json({ success: false, error: "symbol query param required" });
        }
        const raw = await tmeApiOptimized.getProductsPricesAndStocks([symbol]);
        // Return everything, untyped, so any expected/delivery fields TME sends
        // that we don't currently model are visible.
        res.json({ success: true, symbol, count: raw.length, raw });
      } catch (e) {
        res.status(500).json({ success: false, error: (e as Error).message });
      }
    });

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

        // TME's Search.json returns a fixed 20 products per page — to honour
        // a larger UI page size (e.g. 50), aggregate consecutive TME pages
        // and slice the requested window. Each fetched TME page is one API
        // call; cap with a sane max so a misconfigured huge limit can't
        // burn through the rate budget.
        const TME_PAGE = 20;
        const MAX_LIMIT = 100;
        const effectiveLimit = Math.min(Math.max(limitNum, 1), MAX_LIMIT);
        const startIndex = (pageNum - 1) * effectiveLimit;
        const firstTmePage = Math.floor(startIndex / TME_PAGE) + 1;
        const lastTmePage = Math.floor((startIndex + effectiveLimit - 1) / TME_PAGE) + 1;

        let aggregated: any[] = [];
        let total = 0;
        for (let p = firstTmePage; p <= lastTmePage; p++) {
          const r = await tmeApi.getProductsByCategory(categoryId as string, p, TME_PAGE);
          aggregated = aggregated.concat(r.products || []);
          total = r.total || total;
          // TME returned fewer than the page size => past the end.
          if (!r.products || r.products.length < TME_PAGE) break;
        }

        // Trim the aggregated batch to the requested window so page math
        // ("Page X of Y") on the client matches what's actually displayed.
        const windowStart = startIndex - (firstTmePage - 1) * TME_PAGE;
        let products = aggregated.slice(windowStart, windowStart + effectiveLimit);

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
          total: total,
          filtered: products.length,
          page: pageNum,
          limit: effectiveLimit,
          totalPages: Math.ceil(total / effectiveLimit),
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

    // ALL in-stock products for a category, paged until exhausted. Backs the
    // "Select All" button reliably — unlike /api/tme/products it does not
    // window-slice or fall back to keyword/mock search, so "Select All (N)"
    // actually returns everything TME has for the category (capped for safety).
    app.get("/api/tme/category-all", async (req, res) => {
      try {
        const categoryId = req.query.categoryId as string;
        if (!categoryId) {
          return res.status(400).json({ success: false, error: "categoryId is required" });
        }
        const search = ((req.query.search as string) || "").toLowerCase();
        const producer = ((req.query.producer as string) || "").toLowerCase();
        const priceMin = req.query.priceMin ? parseFloat(req.query.priceMin as string) : null;
        const priceMax = req.query.priceMax ? parseFloat(req.query.priceMax as string) : null;

        const MAX_PAGES = 100; // 100 * 20 = 2000 products hard cap per category
        const all: any[] = [];
        const seen = new Set<string>();
        let total = 0;
        let pagesFetched = 0;
        let truncated = false;

        for (let page = 1; page <= MAX_PAGES; page++) {
          const r = await tmeApi.getCategoryPageRaw(categoryId, page);
          pagesFetched++;
          total = r.total || total;
          for (const p of r.products) {
            if (!seen.has(p.Symbol)) {
              seen.add(p.Symbol);
              all.push(p);
            }
          }
          if (!r.hasMore) break;
          if (page === MAX_PAGES) truncated = true;
          // Gentle pacing so a big category doesn't hammer TME's rate limit.
          await new Promise((resolve) => setTimeout(resolve, 250));
        }

        // Apply the same client-side filters the grid uses (price needs a
        // loaded price, which Search doesn't include — so price filters are
        // best-effort and only drop items whose price is known and out of band).
        let products = all;
        if (search) {
          products = products.filter((p) =>
            p.Description?.toLowerCase().includes(search) ||
            p.Symbol?.toLowerCase().includes(search) ||
            p.Producer?.toLowerCase().includes(search),
          );
        }
        if (producer) {
          products = products.filter((p) => p.Producer?.toLowerCase().includes(producer));
        }

        res.json({
          success: true,
          products,
          fetched: all.length,
          filtered: products.length,
          total,
          pagesFetched,
          truncated,
        });
      } catch (error) {
        console.error("TME category-all fetch error:", error);
        res.status(500).json({ success: false, error: (error as Error).message });
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
        // Honest usage: only "calls today" is real (DB-persisted via
        // storage.trackApiCall, survives serverless cold starts). The old
        // per-minute meter was an in-memory counter that resets on every
        // cold start (always ~0 on Vercel) and the "10000" daily limit was
        // a fabricated constant — both removed.
        //
        // Real daily limit is account-specific and TME doesn't return it,
        // so it's optional via TME_DAILY_LIMIT. When set, we show a %; when
        // not, we just show the count with no fake denominator.
        const apiUsage = await storage.getApiUsage("tme");
        const callsToday = apiUsage?.callsToday || 0;
        const dailyLimit = process.env.TME_DAILY_LIMIT
          ? Number(process.env.TME_DAILY_LIMIT)
          : null;
        const usagePercentage =
          dailyLimit && dailyLimit > 0 ? Math.round((callsToday / dailyLimit) * 100) : null;

        res.json({
          success: true,
          usage: {
            callsToday,
            dailyLimit, // null unless TME_DAILY_LIMIT is configured
            remainingDaily: dailyLimit ? Math.max(0, dailyLimit - callsToday) : null,
            usagePercentage,
            lastUpdated: apiUsage?.updatedAt || null,
            lastResetAt: apiUsage?.lastResetAt || null,
          },
          note:
            "callsToday is real (DB-tracked). Per-minute metering removed " +
            "(meaningless on serverless). Set TME_DAILY_LIMIT to show a % " +
            "against your actual TME tier.",
        });
      } catch (error) {
        console.error("Failed to get TME usage:", error);
        res.status(500).json({ success: false, error: "Failed to get TME usage statistics" });
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

          // Resolve fee config once (drives the net-profit price floor).
          const feeConfig = await getFeeConfig("ebay");

          for (const enhanced of enhancedProducts) {
            try {
              const { product, price, stock } = enhanced;

              // Get MOQ (minimum order quantity) and multiples from TME product
              const moq = product.MinAmount || 1;
              const multiples = product.Multiples || 1;

              // Calculate pricing - use correct price tier for MOQ quantity
              const { getSupplierPriceForMoq } = await import("../dynamic-pricing");
              const supplierPrice = getSupplierPriceForMoq(price?.PriceList, moq);
              const weightGrams =
                (product as any).Weight ?? null;

              let pricingResult = {
                finalPrice: supplierPrice,
                calculatedPrice: supplierPrice,
                marginTier: "No Margin",
                marginPercentage: 0
              };

              if (settings?.applyDynamicPricing && supplierPrice > 0) {
                // Tier markup with the net-profit floor applied (package-aware).
                const result = calculatePriceWithFloor(supplierPrice, {
                  moq,
                  multiples,
                  weightGrams,
                  marketplace: "ebay",
                  config: feeConfig
                });
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
                salePrice: String(pricingResult.finalPrice),
                supplierPrice: String(supplierPrice),
                supplier: "TME",
                imageUrl: product.Photo || null,
                status: (stock?.Amount || 0) > 0 ? "active" : "inactive",
                ean: product.EAN || null,
                weight: product.Weight?.toString() || null,
                tmeCategoryId: product.CategoryId ? String(product.CategoryId) : null,
                supplierProductId: product.Symbol,
                moq: moq,
                multiples: multiples
              };

              // Check if product already exists by SKU
              const existing = existingBySku.get(product.Symbol);

              if (existing) {
                await storage.updateProduct(existing.id, productData);
                updatedCount++;
              } else {
                await storage.createProduct(productData);
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

    // ── Async chunked sync (job + polling) ──────────────────────────────────
    // Replaces the single blocking request above for large selections. The job
    // state lives in the DB so progress survives serverless recycling / page
    // refreshes, and the client drives + polls real progress.

    // 1) Create a job, return its id immediately (no long-running work here).
    app.post("/api/tme/sync-job-start", async (req, res) => {
      try {
        const { productSymbols, settings } = req.body;
        if (!productSymbols || !Array.isArray(productSymbols) || productSymbols.length === 0) {
          return res.status(400).json({ success: false, error: "Product symbols array is required" });
        }

        // De-dupe symbols so total/processed math is exact.
        const symbols = Array.from(new Set(productSymbols.map((s: any) => String(s))));
        const jobId = randomUUID();

        const job = await storage.createSyncJob({
          jobId,
          source: "tme_browser",
          status: "pending",
          total: symbols.length,
          processed: 0,
          syncedCount: 0,
          updatedCount: 0,
          failedCount: 0,
          symbols: JSON.stringify(symbols),
          settings: settings ? JSON.stringify(settings) : null,
          errors: null,
          message: `Queued ${symbols.length} products`,
        });

        console.log(`🆕 TME sync job ${jobId} created for ${symbols.length} products`);
        res.json({ success: true, ...syncJobProgress(job), done: false });
      } catch (error) {
        console.error("Failed to start sync job:", error);
        res.status(500).json({ success: false, error: (error as Error).message });
      }
    });

    // 2) Process the next chunk of a job. Called repeatedly by the client until
    //    `done` is true. Each call imports up to TME_SYNC_CHUNK_SIZE products.
    app.post("/api/tme/sync-job-chunk", async (req, res) => {
      try {
        const { jobId } = req.body;
        if (!jobId) return res.status(400).json({ success: false, error: "jobId is required" });

        const job = await storage.getSyncJob(jobId);
        if (!job) return res.status(404).json({ success: false, error: "Sync job not found" });

        // Already finished (or cancelled) — nothing to do.
        if (["completed", "completed_with_errors", "failed", "cancelled"].includes(job.status)) {
          return res.json({ success: true, done: true, ...syncJobProgress(job) });
        }

        const allSymbols: string[] = JSON.parse(job.symbols);
        const settings = job.settings ? JSON.parse(job.settings) : {};
        const chunk = allSymbols.slice(job.processed, job.processed + TME_SYNC_CHUNK_SIZE);

        if (job.status === "pending") {
          await storage.updateSyncJob(jobId, { status: "processing" });
        }

        const r = await processTmeSyncChunk(chunk, settings);

        const processed = job.processed + chunk.length;
        const syncedCount = job.syncedCount + r.syncedCount;
        const updatedCount = job.updatedCount + r.updatedCount;
        const failedCount = job.failedCount + r.failedCount;
        const prevErrors: string[] = job.errors ? JSON.parse(job.errors) : [];
        const errors = [...prevErrors, ...r.errors].slice(0, 50); // cap stored errors

        const done = processed >= allSymbols.length;
        const status = done ? (failedCount > 0 ? "completed_with_errors" : "completed") : "processing";
        const message = `Synced ${syncedCount} new, updated ${updatedCount}, failed ${failedCount}`;

        const updated = await storage.updateSyncJob(jobId, {
          processed,
          syncedCount,
          updatedCount,
          failedCount,
          errors: errors.length ? JSON.stringify(errors) : null,
          status,
          message,
        });

        if (done) {
          await storage.createSyncLog({
            source: "tme_browser",
            operation: "sync_selected",
            status: failedCount === 0 ? "success" : failedCount < allSymbols.length ? "partial" : "error",
            message,
            details: JSON.stringify({ jobId, syncedCount, updatedCount, failedCount }),
          });
          console.log(`✅ TME sync job ${jobId} ${status}: ${message}`);
        }

        res.json({ success: true, done, ...syncJobProgress(updated) });
      } catch (error) {
        console.error("Sync job chunk failed:", error);
        res.status(500).json({ success: false, error: (error as Error).message });
      }
    });

    // 3) Poll job progress (also used to resume a job after a page refresh).
    app.get("/api/tme/sync-job-status", async (req, res) => {
      try {
        const jobId = String(req.query.jobId || "");
        if (!jobId) return res.status(400).json({ success: false, error: "jobId is required" });
        const job = await storage.getSyncJob(jobId);
        if (!job) return res.status(404).json({ success: false, error: "Sync job not found" });
        const done = ["completed", "completed_with_errors", "failed", "cancelled"].includes(job.status);
        res.json({ success: true, done, ...syncJobProgress(job) });
      } catch (error) {
        res.status(500).json({ success: false, error: (error as Error).message });
      }
    });

    // 4) Find an in-progress job so the UI can resume after a reload.
    app.get("/api/tme/sync-job-active", async (_req, res) => {
      try {
        const job = await storage.getActiveSyncJob("tme_browser");
        if (!job) return res.json({ success: true, active: false });
        res.json({ success: true, active: true, ...syncJobProgress(job), done: false });
      } catch (error) {
        res.status(500).json({ success: false, error: (error as Error).message });
      }
    });

    // 5) Cancel a running job (the client stops pumping chunks after this).
    app.post("/api/tme/sync-job-cancel", async (req, res) => {
      try {
        const { jobId } = req.body;
        if (!jobId) return res.status(400).json({ success: false, error: "jobId is required" });
        const job = await storage.getSyncJob(jobId);
        if (!job) return res.status(404).json({ success: false, error: "Sync job not found" });
        if (["completed", "completed_with_errors", "failed"].includes(job.status)) {
          return res.json({ success: true, done: true, ...syncJobProgress(job) });
        }
        const updated = await storage.updateSyncJob(jobId, {
          status: "cancelled",
          message: `Cancelled after ${job.processed}/${job.total}`,
        });
        res.json({ success: true, done: true, ...syncJobProgress(updated) });
      } catch (error) {
        res.status(500).json({ success: false, error: (error as Error).message });
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

        // Resolve fee config once (drives the net-profit price floor).
        const feeConfig = await getFeeConfig("ebay");

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
                const { getSupplierPriceForMoq } = await import("../dynamic-pricing");
                const supplierPrice = getSupplierPriceForMoq(price?.PriceList, moq);
                const weightGrams = (product as any).Weight ?? null;

                let pricingResult = {
                  finalPrice: supplierPrice,
                  calculatedPrice: supplierPrice,
                  marginTier: "No Margin",
                  marginPercentage: 0
                };

                if (settings.applyDynamicPricing && supplierPrice > 0) {
                  // Tier markup with the net-profit floor applied (package-aware).
                  const result = calculatePriceWithFloor(supplierPrice, {
                    moq,
                    multiples,
                    weightGrams,
                    marketplace: "ebay",
                    config: feeConfig
                  });
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
}

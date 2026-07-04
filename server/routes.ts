import type { Express } from "express";
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
import { registerDebugRoutes } from "./routes/debug";
import {
  insertCategorySchema,
  loginSchema,
  type Product,
  type User,
} from "@shared/schema";
import { ZodError } from "zod";
import bcrypt from "bcryptjs";
import path from "path";
import { calculateDynamicPrice, calculatePriceWithFloor } from "./dynamic-pricing";
import { getFeeConfig } from "./fee-config";
import { calculateNetProfit } from "./fee-model";
import { calculateEbayStock, calculateBulkEbayStock, validateStockLimit, getRecommendedStockLimit } from "./stock-manager";

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

  // Diagnostic / migration endpoints (see server/routes/debug.ts)
  registerDebugRoutes(app);

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
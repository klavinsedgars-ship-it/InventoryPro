import type { Express } from "express";
import { storage } from "../storage";
import { requireAuth } from "../middleware/auth";
import {
  calculateDynamicPrice,
  calculateBulkPricing,
  generatePricingSummary,
  getPricingTierInfo,
  calculatePriceWithFloor,
  setActivePricingTiers,
  dbTiersToPricingTiers,
} from "../dynamic-pricing";
import { getFeeConfig } from "../fee-config";
import { calculateNetProfit } from "../fee-model";

/**
 * Pricing routes: dynamic-price preview/calculate, net-profit breakdown, bulk
 * recalculation, and pricing-tier CRUD (which reloads the active tier set and
 * recalculates affected products). Extracted from the routes monolith;
 * behaviour is identical to the previous inline handlers.
 */
export function registerPricingRoutes(app: Express) {
  /**
   * The fee assumptions behind the pricing floor — view and set.
   * GET also measures what eBay ACTUALLY charged on recorded orders, so the
   * fvf setting can be grounded in evidence instead of a brochure number
   * (order #14-87824: modeled 12% + 0.35, actual 21.7% of gross).
   * POST body: any of { fvfPct, fixedFee, vatPct, packagingCost,
   * postageMarkup, targetMinNetProfit } — stored in marketplace_settings,
   * picked up by every later price calculation.
   */
  app.get("/api/ebay/fee-config", requireAuth, async (_req, res) => {
    try {
      const config = await getFeeConfig("ebay");
      const { db } = await import("../db");
      const { sql } = await import("drizzle-orm");
      const q: any = await db.execute(sql`
        SELECT o.id, o.marketplace_order_id,
               (o.subtotal + o.shipping_cost)::float AS gross,
               COALESCE(SUM(f.amount), 0)::float AS actual_fee
        FROM orders o LEFT JOIN order_fees f ON f.order_id = o.id
        GROUP BY o.id ORDER BY o.order_date DESC LIMIT 50
      `);
      const orders = (q.rows ?? q)
        .filter((r: any) => r.gross > 0 && r.actual_fee > 0)
        .map((r: any) => ({
          orderId: r.marketplace_order_id,
          gross: r.gross,
          actualFee: r.actual_fee,
          feePctOfGross: Math.round((r.actual_fee / r.gross) * 1000) / 10,
        }));
      const avgFeePct = orders.length
        ? Math.round((orders.reduce((s: number, o: any) => s + o.actualFee, 0) /
            orders.reduce((s: number, o: any) => s + o.gross, 0)) * 1000) / 10
        : null;
      res.json({
        ok: true,
        config,
        measured: {
          ordersWithFees: orders.length,
          avgActualFeePctOfGross: avgFeePct,
          note: "config models fee as fvfPct*gross + fixedFee; if avgActualFeePctOfGross is well above fvfPct*100, the floor is being lied to (promoted-listing ad fees, category FVF differences)",
          orders,
        },
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: (error as Error).message });
    }
  });
  app.post("/api/ebay/fee-config", requireAuth, async (req, res) => {
    try {
      const FIELDS: Record<string, { key: string; min: number; max: number }> = {
        fvfPct: { key: "fee.fvf_pct", min: 0, max: 0.5 },
        fixedFee: { key: "fee.fixed", min: 0, max: 5 },
        vatPct: { key: "fee.vat_pct", min: 0, max: 0.3 },
        packagingCost: { key: "fee.packaging", min: 0, max: 5 },
        postageMarkup: { key: "fee.postage_markup", min: 0, max: 1 },
        targetMinNetProfit: { key: "fee.target_min_profit", min: 0, max: 50 },
      };
      const applied: Record<string, number> = {};
      for (const [field, spec] of Object.entries(FIELDS)) {
        const raw = req.body?.[field];
        if (raw === undefined) continue;
        const v = Number(raw);
        if (!Number.isFinite(v) || v < spec.min || v > spec.max) {
          return res.status(400).json({ ok: false, error: `${field} must be a number in [${spec.min}, ${spec.max}]` });
        }
        await storage.setMarketplaceSetting({ marketplace: "ebay", setting: spec.key, value: String(v) });
        applied[field] = v;
      }
      if (Object.keys(applied).length === 0) {
        return res.status(400).json({ ok: false, error: "nothing to set — pass fvfPct, fixedFee, vatPct, packagingCost, postageMarkup and/or targetMinNetProfit" });
      }
      res.json({
        ok: true,
        applied,
        config: await getFeeConfig("ebay"),
        note: "applies to prices computed from now on; run /api/ebay/reprice?sweep=start to re-floor the existing catalogue",
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: (error as Error).message });
    }
  });

  /**
   * Catalogue-wide floor reprice: recompute every TME product with the
   * CURRENT tiers + fee config and push changed prices to live listings.
   * ?sweep=start|stop|status (&run=1 with start executes the first slice
   * inline); slices continue via /api/cron/reprice until the cursor walks
   * off the end, then it disables itself. Manual prices
   * (useCalculatedPrice=false) are never touched.
   */
  const repriceHandler = async (req: any, res: any) => {
    try {
      const { isRepriceEnabled, setRepriceEnabled, repriceProgress, runRepriceSweep } = await import("../reprice-sweep");
      const { withLease, describeRefusal } = await import("../job-lease");
      const { leaseStore } = await import("../storage");
      const sweep = String(req.query.sweep ?? req.body?.sweep ?? "").trim();
      if (!["start", "stop", "status"].includes(sweep)) {
        return res.status(400).json({ ok: false, error: "pass ?sweep=start|stop|status" });
      }
      if (sweep === "start") await setRepriceEnabled(true);
      if (sweep === "stop") await setRepriceEnabled(false);
      let slice = null;
      if (sweep === "start" && (req.query.run === "1" || req.body?.run === true)) {
        const leased = await withLease(leaseStore, "reprice", { ttlSeconds: 300 }, () => runRepriceSweep(240_000));
        slice = leased.ran ? leased.result : { refused: describeRefusal("reprice", leased) };
      }
      res.json({
        ok: true,
        sweep,
        enabled: await isRepriceEnabled(),
        progress: await repriceProgress(),
        ...(slice ? { slice } : {}),
        note: "the /api/cron/reprice tick (every 10 min) works the sweep while enabled; it disables itself when the cursor reaches the end",
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: (error as Error).message });
    }
  };
  app.get("/api/ebay/reprice", requireAuth, repriceHandler);
  app.post("/api/ebay/reprice", requireAuth, repriceHandler);

  const repriceCronHandler = async (_req: any, res: any) => {
    try {
      const { isRepriceEnabled, setRepriceEnabled, runRepriceSweep } = await import("../reprice-sweep");
      const { withLease, describeRefusal } = await import("../job-lease");
      const { leaseStore } = await import("../storage");
      if (!(await isRepriceEnabled())) {
        return res.json({ ok: true, skipped: true, reason: "reprice sweep not enabled" });
      }
      const leased = await withLease(leaseStore, "reprice", { ttlSeconds: 300 }, () => runRepriceSweep(250_000));
      if (!leased.ran) {
        return res.json({ ok: true, skipped: true, reason: describeRefusal("reprice", leased) });
      }
      const r = leased.result;
      if (r.done) {
        await setRepriceEnabled(false);
        await storage.createSyncLog({
          source: "reprice",
          operation: "sweep_complete",
          status: "success",
          message: `floor reprice complete — last slice: ${r.repriced} repriced, ${r.pushedToEbay} pushed, ${r.pushFailed} push failures`,
        });
      }
      res.json({ ok: true, ...r });
    } catch (error) {
      res.status(500).json({ ok: false, error: (error as Error).message });
    }
  };
  app.get("/api/cron/reprice", repriceCronHandler);
  app.post("/api/cron/reprice", repriceCronHandler);

  // Dynamic Pricing API routes
  app.post("/api/pricing/calculate", requireAuth, async (req, res) => {
    try {
      const { supplierPrice, weightGrams, moq, multiples, marketplace } = req.body;

      if (!supplierPrice) {
        return res.status(400).json({ message: "Supplier price is required" });
      }

      // When weight is supplied, apply the net-profit floor so the preview
      // matches what the sync would actually list. Otherwise raw tier price.
      if (weightGrams != null) {
        const mp = marketplace === "amazon" ? "amazon" : "ebay";
        const config = await getFeeConfig(mp);
        const result = calculatePriceWithFloor(supplierPrice, {
          moq: moq != null ? Number(moq) : 1,
          multiples: multiples != null ? Number(multiples) : 1,
          weightGrams: Number(weightGrams),
          marketplace: mp,
          config,
        });
        return res.json(result);
      }

      const result = calculateDynamicPrice(supplierPrice);
      res.json(result);
    } catch (error) {
      res.status(500).json({ message: "Failed to calculate pricing" });
    }
  });

  // Real net-profit breakdown after eBay fees + VAT + shipping. Single source
  // of truth for the per-product breakdown card (no client/server drift).
  app.post("/api/pricing/net-profit", requireAuth, async (req, res) => {
    try {
      const { salePrice, supplierPrice, moq, weightGrams, marketplace } = req.body;

      if (salePrice == null || supplierPrice == null) {
        return res
          .status(400)
          .json({ message: "salePrice and supplierPrice are required" });
      }

      const mp = marketplace === "amazon" ? "amazon" : "ebay";
      const config = await getFeeConfig(mp);
      const moqNum = Number(moq) > 1 ? Number(moq) : 1;
      const packageSupplierCost = Number(supplierPrice) * moqNum;

      const breakdown = calculateNetProfit({
        salePrice: Number(salePrice),
        packageSupplierCost,
        weightGrams: weightGrams != null ? Number(weightGrams) : null,
        marketplace: mp,
        config,
      });

      res.json(breakdown);
    } catch (error) {
      res.status(500).json({ message: "Failed to compute net profit" });
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

      const bulkFeeConfig = await getFeeConfig("ebay");
      setActivePricingTiers(dbTiersToPricingTiers(await storage.getPricingTiers()));

      for (const productId of productIds) {
        try {
          const product = await storage.getProduct(productId);
          if (!product) {
            errors.push(`Product ${productId} not found`);
            continue;
          }

          const supplierPrice = parseFloat(product.supplierPrice);
          if (!Number.isFinite(supplierPrice) || supplierPrice <= 0) {
            errors.push(`Product ${productId}: no valid supplier price`);
            continue;
          }

          // Full pipeline (MOQ package + net-profit floor), same as every
          // other pricing path — calculateDynamicPrice alone underpriced
          // MOQ>1 products by ~1/MOQ.
          const pricingResult = calculatePriceWithFloor(supplierPrice, {
            moq: product.moq || 1,
            multiples: product.multiples || 1,
            weightGrams: product.weight ? parseFloat(product.weight) : null,
            marketplace: "ebay",
            config: bulkFeeConfig,
          });

          // Update product with calculated pricing
          const updateData: any = {
            calculatedPrice: pricingResult.calculatedPrice.toString(),
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

  // Apply dynamic pricing to all products
  app.post("/api/pricing/apply-bulk", requireAuth, async (req, res) => {
    try {
      // Use the operator's current DB tiers for the recalculation.
      setActivePricingTiers(dbTiersToPricingTiers(await storage.getPricingTiers()));
      const feeConfig = await getFeeConfig("ebay");
      // Get all products
      const products = await storage.getProducts();

      // Filter products with valid supplier prices (> 0)
      const validProducts = products.filter(p => parseFloat(p.supplierPrice) > 0);

      let updatedCount = 0;
      let errors: string[] = [];

      for (const product of validProducts) {
        try {
          // calculatePriceWithFloor, not calculateDynamicPrice: the bare tier
          // calculation ignores MOQ package multiplication and the net-profit
          // floor, so MOQ>1 products were bulk-repriced at ~1/MOQ of the
          // correct package price — under cost.
          const pricingResult = calculatePriceWithFloor(parseFloat(product.supplierPrice), {
            moq: product.moq || 1,
            multiples: product.multiples || 1,
            weightGrams: product.weight ? parseFloat(product.weight) : null,
            marketplace: "ebay",
            config: feeConfig,
          });

          // Update product with calculated pricing
          await storage.updateProduct(product.id, {
            calculatedPrice: pricingResult.calculatedPrice.toString(),
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

      // Reload the active tier set so the recalculation below (and every later
      // pricing call) uses the new tier — calculations read DB tiers now.
      setActivePricingTiers(dbTiersToPricingTiers(await storage.getPricingTiers()));

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

      // Reload active tiers so the edit is reflected in the recalculation.
      setActivePricingTiers(dbTiersToPricingTiers(await storage.getPricingTiers()));

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
}

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

  // Apply dynamic pricing to all products
  app.post("/api/pricing/apply-bulk", requireAuth, async (req, res) => {
    try {
      // Use the operator's current DB tiers for the recalculation.
      setActivePricingTiers(dbTiersToPricingTiers(await storage.getPricingTiers()));
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

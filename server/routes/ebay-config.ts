import type { Express } from "express";
import { storage } from "../storage";
import { requireAuth } from "../middleware/auth";
import { ebayApi } from "../ebay-api";
import { ebayAccountApi } from "../ebay-account-api";

// eBay account configuration: business policies (payment / fulfillment /
// return CRUD + sync) and metadata lookups (categories, shipping services /
// locations, dispatch times). Extracted from the routes.ts monolith.
export function registerEbayConfigRoutes(app: Express): void {
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
          marketplaceId: marketplaceId || "EBAY_DE",
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
          marketplaceId: marketplaceId || "EBAY_DE",
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
          marketplaceId: marketplaceId || "EBAY_DE",
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
}

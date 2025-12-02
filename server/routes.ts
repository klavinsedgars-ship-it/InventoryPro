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

// Type for authenticated requests
interface AuthenticatedRequest extends Request {
  session: any;
}

export async function registerRoutes(app: Express): Promise<Server> {

  // Auth middleware - production-ready with optional dev bypass
  const requireAuth = (req: any, res: any, next: any) => {
    // Allow bypass only in development with explicit environment variable
    if (process.env.NODE_ENV === 'development' && process.env.BYPASS_AUTH === 'true') {
      console.warn('⚠️ Auth bypassed - development mode');
      return next();
    }
    
    // Production authentication check
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

  app.get("/api/auth/me", requireAuth, async (req, res) => {
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

      // Start async processing - don't await
      processAsyncBulkListing(jobId, productIds, categoryId);

      // Return immediately with job ID
      res.json({
        success: true,
        jobId,
        message: `Bulk listing job started for ${productIds.length} products`,
        total: productIds.length
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
      
      const updates = ebayProducts.map(product => ({
        productId: product.id,
        ebayItemId: product.ebayItemId!,
        quantity: product.stock || 0,
        price: parseFloat(product.salePrice?.toString() || '0'),
        sku: product.sku
      }));
      
      const result = await ebayApi.bulkUpdateInventory(updates);
      
      res.json({
        success: true,
        message: 'eBay sync completed',
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

  const httpServer = createServer(app);
  return httpServer;
}
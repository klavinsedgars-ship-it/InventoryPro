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

// Type for authenticated requests
interface AuthenticatedRequest extends Request {
  session: any;
}

export async function registerRoutes(app: Express): Promise<Server> {

  // Auth middleware - temporarily disabled for development
  const requireAuth = (req: any, res: any, next: any) => {
    // Temporarily bypass authentication
    next();
    // if (!req.session?.userId) {
    //   return res.status(401).json({ message: "Authentication required" });
    // }
    // next();
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
      const result = await ebayApi.bulkListProducts(productIds, categoryId);
      res.json(result);
    } catch (error) {
      console.error("eBay bulk listing failed:", error);
      res.status(500).json({ 
        success: false, 
        message: (error as Error).message || "eBay bulk listing failed",
        error: (error as Error).message
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
            Token: process.env.TME_TOKEN || "05bb5ef39f7b451aad7892c53e39db484ca8dd25693a599f96",
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
        const usage = tmeApi.getApiUsage();

        res.json({
          success: true,
          usage: usage,
          limits: {
            daily: usage.dailyLimit,
            perMinute: usage.rateLimitPerMinute
          },
          recommendations: usage.status === 'WARNING' ? [
            "You've used over 80% of your daily limit",
            "Consider reducing API calls or upgrading your TME plan"
          ] : usage.status === 'LIMIT_EXCEEDED' ? [
            "Daily limit exceeded - API calls will fail until tomorrow",
            "Contact TME support to increase your daily limit"
          ] : [
            "API usage is within normal limits"
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

    // Sync selected TME products - Enhanced
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

                // Calculate pricing
                const supplierPrice = price?.PriceList?.[0]?.PriceValue || 0;
                let pricingResult = {
                  finalPrice: supplierPrice,
                  calculatedPrice: supplierPrice,
                  marginTier: "No Margin",
                  marginPercentage: 0
                };

                if (settings.applyDynamicPricing && supplierPrice > 0) {
                  const { calculateDynamicPrice } = await import("./dynamic-pricing");
                  const result = calculateDynamicPrice(supplierPrice);
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
      const result = await ebayApi.bulkListProducts(productIds, categoryId);
      res.json(result);
    } catch (error) {
      console.error("eBay bulk listing failed:", error);
      res.status(500).json({ 
        success: false, 
        message: (error as Error).message || "eBay bulk listing failed",
        error: (error as Error).message
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

  const httpServer = createServer(app);
  return httpServer;
}
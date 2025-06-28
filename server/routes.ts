import type { Express, Request } from "express";
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
import { ZodError } from "zod";
import bcrypt from "bcryptjs";

// Type for authenticated requests
interface AuthenticatedRequest extends Request {
  session: any;
}

export async function registerRoutes(app: Express): Promise<Server> {
  
  // Auth middleware
  const requireAuth = (req: any, res: any, next: any) => {
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
      const updateData = insertProductSchema.partial().parse(req.body);
      
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

  // TME sync routes
  app.post("/api/sync/tme", requireAuth, async (req, res) => {
    try {
      // Simulate TME API data sync with realistic updates
      const products = await storage.getProducts();
      const tmeProducts = products.filter(p => p.tmeProductId);
      
      let updatedCount = 0;
      let priceUpdates = 0;
      let stockUpdates = 0;

      // Simulate price and stock updates for TME products
      for (const product of tmeProducts) {
        const shouldUpdate = Math.random() > 0.3; // 70% chance of update
        if (shouldUpdate) {
          const updates: any = {};
          
          // Simulate price fluctuations (±5%)
          if (Math.random() > 0.5) {
            const currentPrice = parseFloat(product.supplierPrice);
            const fluctuation = (Math.random() - 0.5) * 0.1; // ±5%
            const newPrice = currentPrice * (1 + fluctuation);
            updates.supplierPrice = newPrice.toFixed(2);
            priceUpdates++;
          }
          
          // Simulate stock updates
          if (Math.random() > 0.4) {
            const stockChange = Math.floor((Math.random() - 0.5) * 20); // ±10 units
            const newStock = Math.max(0, product.stock + stockChange);
            updates.stock = newStock;
            
            // Update status based on stock
            if (newStock === 0) {
              updates.status = 'out_of_stock';
            } else if (newStock < 20) {
              updates.status = 'low_stock';
            } else {
              updates.status = 'active';
            }
            stockUpdates++;
          }
          
          if (Object.keys(updates).length > 0) {
            await storage.updateProduct(product.id, updates);
            updatedCount++;
          }
        }
      }

      // Create detailed sync log
      const message = `Synchronized ${updatedCount} products: ${priceUpdates} price updates, ${stockUpdates} stock updates`;
      await storage.createSyncLog({
        source: "tme",
        status: "success",
        message
      });

      res.json({ 
        message: "TME sync completed successfully",
        details: {
          totalProducts: tmeProducts.length,
          updatedProducts: updatedCount,
          priceUpdates,
          stockUpdates
        }
      });
    } catch (error) {
      await storage.createSyncLog({
        source: "tme",
        status: "error",
        message: "TME sync failed: " + (error as Error).message
      });
      res.status(500).json({ message: "Failed to sync with TME" });
    }
  });

  // Marketplace listing routes
  app.post("/api/marketplace/list", requireAuth, async (req, res) => {
    try {
      const { productIds, marketplaces } = req.body;
      
      if (!Array.isArray(productIds) || !Array.isArray(marketplaces)) {
        return res.status(400).json({ message: "Invalid input format" });
      }

      const results = [];
      for (const productId of productIds) {
        const product = await storage.getProduct(productId);
        if (product) {
          const updateData: any = {};
          if (marketplaces.includes('ebay')) {
            updateData.listedOnEbay = true;
          }
          if (marketplaces.includes('amazon')) {
            updateData.listedOnAmazon = true;
          }
          
          const updated = await storage.updateProduct(productId, updateData);
          results.push(updated);
        }
      }

      res.json({ 
        message: `Successfully listed ${results.length} products on ${marketplaces.join(', ')}`,
        products: results 
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to list products" });
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

  // Advanced analytics and reporting routes
  app.get("/api/analytics/inventory", requireAuth, async (req, res) => {
    try {
      const products = await storage.getProducts();
      const categories = await storage.getCategories();
      
      const analytics = {
        categoryBreakdown: categories.map(cat => ({
          category: cat.name,
          count: products.filter(p => p.category === cat.name).length,
          totalValue: products
            .filter(p => p.category === cat.name)
            .reduce((sum, p) => sum + (parseFloat(p.salePrice) * p.stock), 0)
        })),
        statusBreakdown: {
          active: products.filter(p => p.status === 'active').length,
          inactive: products.filter(p => p.status === 'inactive').length,
          outOfStock: products.filter(p => p.status === 'out_of_stock').length,
          lowStock: products.filter(p => p.status === 'low_stock').length
        },
        marketplacePresence: {
          ebayOnly: products.filter(p => p.listedOnEbay && !p.listedOnAmazon).length,
          amazonOnly: products.filter(p => !p.listedOnEbay && p.listedOnAmazon).length,
          both: products.filter(p => p.listedOnEbay && p.listedOnAmazon).length,
          none: products.filter(p => !p.listedOnEbay && !p.listedOnAmazon).length
        },
        topProducts: products
          .sort((a, b) => (parseFloat(b.salePrice) * b.stock) - (parseFloat(a.salePrice) * a.stock))
          .slice(0, 5)
          .map(p => ({
            name: p.name,
            sku: p.sku,
            value: parseFloat(p.salePrice) * p.stock,
            margin: p.margin
          })),
        lowStockAlerts: products
          .filter(p => p.stock < 20 && p.stock > 0)
          .map(p => ({
            name: p.name,
            sku: p.sku,
            stock: p.stock,
            category: p.category
          }))
      };

      res.json(analytics);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch analytics" });
    }
  });

  app.get("/api/analytics/sales", requireAuth, async (req, res) => {
    try {
      const products = await storage.getProducts();
      
      // Simulate sales data for demonstration
      const salesData = {
        monthlyRevenue: Array.from({length: 12}, (_, i) => ({
          month: new Date(2024, i).toLocaleString('default', { month: 'short' }),
          revenue: Math.floor(Math.random() * 50000) + 20000,
          orders: Math.floor(Math.random() * 200) + 50
        })),
        topSellingCategories: [
          { category: 'Electronics', sales: 15420, growth: 12.5 },
          { category: 'Accessories', sales: 8930, growth: 8.2 },
          { category: 'Gaming', sales: 6540, growth: -2.1 },
          { category: 'Home & Garden', sales: 4230, growth: 15.8 }
        ],
        marketplacePerformance: {
          ebay: { revenue: 28450, orders: 156, avgOrderValue: 182.37 },
          amazon: { revenue: 42380, orders: 198, avgOrderValue: 214.04 }
        }
      };

      res.json(salesData);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch sales analytics" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}

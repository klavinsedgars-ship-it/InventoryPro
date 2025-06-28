import { 
  users, 
  products, 
  categories, 
  marketplaceSettings, 
  syncLogs,
  type User, 
  type InsertUser, 
  type Product, 
  type InsertProduct,
  type Category,
  type InsertCategory,
  type MarketplaceSettings,
  type InsertMarketplaceSettings,
  type SyncLog,
  type InsertSyncLog
} from "@shared/schema";
import { db } from "./db";
import { eq, and, gte, lte, desc } from "drizzle-orm";
import bcrypt from "bcryptjs";

export interface IStorage {
  // Users
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  // Products
  getProducts(): Promise<Product[]>;
  getProduct(id: number): Promise<Product | undefined>;
  getProductBySku(sku: string): Promise<Product | undefined>;
  createProduct(product: InsertProduct): Promise<Product>;
  updateProduct(id: number, product: Partial<InsertProduct>): Promise<Product | undefined>;
  deleteProduct(id: number): Promise<boolean>;
  getProductsByCategory(category: string): Promise<Product[]>;
  getProductsWithFilters(filters: {
    category?: string;
    status?: string;
    listedOnEbay?: boolean;
    listedOnAmazon?: boolean;
    minStock?: number;
    maxStock?: number;
  }): Promise<Product[]>;

  // Categories
  getCategories(): Promise<Category[]>;
  createCategory(category: InsertCategory): Promise<Category>;

  // Marketplace Settings
  getMarketplaceSettings(marketplace: string): Promise<MarketplaceSettings[]>;
  setMarketplaceSetting(setting: InsertMarketplaceSettings): Promise<MarketplaceSettings>;

  // Sync Logs
  getSyncLogs(limit?: number): Promise<SyncLog[]>;
  createSyncLog(log: InsertSyncLog): Promise<SyncLog>;

  // Dashboard metrics
  getDashboardMetrics(): Promise<{
    totalProducts: number;
    ebayListings: number;
    amazonListings: number;
    totalRevenue: number;
    outOfStock: number;
  }>;
}

export class DatabaseStorage implements IStorage {
  constructor() {
    this.initializeDatabase();
  }

  private async initializeDatabase() {
    try {
      // Create default admin user if it doesn't exist
      const existingAdmin = await this.getUserByUsername("admin");
      if (!existingAdmin) {
        const hashedPassword = await bcrypt.hash("admin123", 10);
        await this.createUser({
          username: "admin",
          password: hashedPassword,
          email: "admin@inventorysync.com",
          role: "admin"
        });
      }

      // Create default categories if they don't exist
      const existingCategories = await this.getCategories();
      if (existingCategories.length === 0) {
        await this.createCategory({ name: "Electronics", ebayMapping: "Electronics", amazonMapping: "Electronics" });
        await this.createCategory({ name: "Accessories", ebayMapping: "Accessories", amazonMapping: "Accessories" });
        await this.createCategory({ name: "Gaming", ebayMapping: "Gaming", amazonMapping: "Gaming" });
        await this.createCategory({ name: "Home & Garden", ebayMapping: "Home & Garden", amazonMapping: "Home & Garden" });
      }
    } catch (error) {
      console.error("Error initializing database:", error);
    }
  }

  private initializeSampleProducts() {
    const sampleProducts = [
      {
        name: "Arduino Uno R3 Microcontroller Board",
        sku: "ARD-UNO-R3",
        ean: "7501234567890",
        category: "Electronics",
        description: "Official Arduino Uno R3 with USB cable. Perfect for beginners and prototyping.",
        supplierPrice: "15.50",
        salePrice: "24.99",
        stock: 150,
        weight: 25,
        status: "active",
        listedOnEbay: true,
        listedOnAmazon: true,
        excludeFromListing: false,
        tmeProductId: "TME001"
      },
      {
        name: "Raspberry Pi 4 Model B 8GB RAM",
        sku: "RPI4-8GB",
        ean: "7501234567891", 
        category: "Electronics",
        description: "Latest Raspberry Pi 4 with 8GB RAM, dual 4K display support, Gigabit Ethernet.",
        supplierPrice: "68.00",
        salePrice: "89.99",
        stock: 75,
        weight: 46,
        status: "active",
        listedOnEbay: true,
        listedOnAmazon: false,
        excludeFromListing: false,
        tmeProductId: "TME002"
      },
      {
        name: "ESP32 Development Board WiFi Bluetooth",
        sku: "ESP32-DEV",
        ean: "7501234567892",
        category: "Electronics",
        description: "ESP32 dual-core microcontroller with WiFi and Bluetooth capabilities.",
        supplierPrice: "8.20",
        salePrice: "14.99",
        stock: 0,
        weight: 10,
        status: "out_of_stock",
        listedOnEbay: false,
        listedOnAmazon: false,
        excludeFromListing: false,
        tmeProductId: "TME003"
      },
      {
        name: "Breadboard 830 Point Solderless",
        sku: "BB-830",
        ean: "7501234567893",
        category: "Accessories",
        description: "High-quality solderless breadboard with 830 tie points for prototyping.",
        supplierPrice: "3.50",
        salePrice: "7.99",
        stock: 200,
        weight: 15,
        status: "active",
        listedOnEbay: true,
        listedOnAmazon: true,
        excludeFromListing: false,
        tmeProductId: "TME004"
      },
      {
        name: "LED Strip 5050 RGB 5m Waterproof",
        sku: "LED-5050-5M",
        ean: "7501234567894",
        category: "Electronics",
        description: "Waterproof RGB LED strip with remote control and power adapter included.",
        supplierPrice: "12.80",
        salePrice: "19.99",
        stock: 45,
        weight: 120,
        status: "active",
        listedOnEbay: false,
        listedOnAmazon: true,
        excludeFromListing: false,
        tmeProductId: "TME005"
      },
      {
        name: "Servo Motor SG90 9g Micro",
        sku: "SERVO-SG90",
        ean: "7501234567895",
        category: "Electronics",
        description: "Lightweight micro servo motor for RC applications and robotics projects.",
        supplierPrice: "2.30",
        salePrice: "4.99",
        stock: 300,
        weight: 9,
        status: "active",
        listedOnEbay: true,
        listedOnAmazon: false,
        excludeFromListing: false,
        tmeProductId: "TME006"
      },
      {
        name: "LCD Display 16x2 Character Blue Backlight",
        sku: "LCD-16X2-BLUE",
        ean: "7501234567896",
        category: "Electronics",
        description: "16x2 character LCD display with blue backlight and I2C interface module.",
        supplierPrice: "6.40",
        salePrice: "11.99",
        stock: 80,
        weight: 35,
        status: "active",
        listedOnEbay: true,
        listedOnAmazon: true,
        excludeFromListing: false,
        tmeProductId: "TME007"
      },
      {
        name: "Ultrasonic Sensor HC-SR04",
        sku: "US-HCSR04",
        ean: "7501234567897",
        category: "Electronics",
        description: "Ultrasonic distance sensor with 2cm-400cm range for Arduino projects.",
        supplierPrice: "1.80",
        salePrice: "3.99",
        stock: 120,
        weight: 8,
        status: "active",
        listedOnEbay: false,
        listedOnAmazon: false,
        excludeFromListing: false,
        tmeProductId: "TME008"
      }
    ];

    sampleProducts.forEach(product => {
      this.createProduct(product);
    });
  }

  private initializeSampleSyncLogs() {
    const now = new Date();
    const sampleLogs = [
      {
        source: "tme",
        status: "success",
        message: "Successfully synchronized 8 products from TME catalog",
      },
      {
        source: "tme", 
        status: "success",
        message: "Product prices updated for 6 items",
      },
      {
        source: "ebay",
        status: "success", 
        message: "Uploaded 5 products to eBay marketplace",
      },
      {
        source: "amazon",
        status: "error",
        message: "API rate limit exceeded. Retry scheduled for next hour",
      },
      {
        source: "tme",
        status: "success",
        message: "Stock levels updated for all active products",
      }
    ];

    // Create logs with different timestamps (going back in time)
    sampleLogs.forEach((log, index) => {
      const logDate = new Date(now.getTime() - (index * 2 * 60 * 60 * 1000)); // 2 hours apart
      const syncLog = {
        ...log,
        syncedAt: logDate
      };
      
      // Manually create the log with custom timestamp
      const id = this.currentSyncLogId++;
      const fullLog = { 
        ...syncLog, 
        id, 
        syncedAt: logDate 
      };
      this.syncLogs.set(id, fullLog as any);
    });
  }

  // Users
  async getUser(id: number): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(user => user.username === username);
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(user => user.email === email);
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = this.currentUserId++;
    const user: User = { 
      ...insertUser, 
      id, 
      createdAt: new Date() 
    };
    this.users.set(id, user);
    return user;
  }

  // Products
  async getProducts(): Promise<Product[]> {
    return Array.from(this.products.values()).sort((a, b) => 
      new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime()
    );
  }

  async getProduct(id: number): Promise<Product | undefined> {
    return this.products.get(id);
  }

  async getProductBySku(sku: string): Promise<Product | undefined> {
    return Array.from(this.products.values()).find(product => product.sku === sku);
  }

  async createProduct(insertProduct: InsertProduct): Promise<Product> {
    const id = this.currentProductId++;
    const now = new Date();
    
    // Calculate margin if not provided
    const supplierPrice = Number(insertProduct.supplierPrice);
    const salePrice = Number(insertProduct.salePrice);
    const margin = insertProduct.margin || 
      (salePrice > 0 ? ((salePrice - supplierPrice) / salePrice * 100).toFixed(2) : "0");

    const product: Product = { 
      ...insertProduct,
      id,
      margin: margin.toString(),
      createdAt: now,
      updatedAt: now
    };
    this.products.set(id, product);
    return product;
  }

  async updateProduct(id: number, updateData: Partial<InsertProduct>): Promise<Product | undefined> {
    const existing = this.products.get(id);
    if (!existing) return undefined;

    // Recalculate margin if prices changed
    const supplierPrice = Number(updateData.supplierPrice || existing.supplierPrice);
    const salePrice = Number(updateData.salePrice || existing.salePrice);
    const margin = salePrice > 0 ? ((salePrice - supplierPrice) / salePrice * 100).toFixed(2) : "0";

    const updated: Product = {
      ...existing,
      ...updateData,
      margin: margin,
      updatedAt: new Date()
    };
    this.products.set(id, updated);
    return updated;
  }

  async deleteProduct(id: number): Promise<boolean> {
    return this.products.delete(id);
  }

  async getProductsByCategory(category: string): Promise<Product[]> {
    return Array.from(this.products.values()).filter(product => product.category === category);
  }

  async getProductsWithFilters(filters: {
    category?: string;
    status?: string;
    listedOnEbay?: boolean;
    listedOnAmazon?: boolean;
    minStock?: number;
    maxStock?: number;
  }): Promise<Product[]> {
    let products = Array.from(this.products.values());

    if (filters.category) {
      products = products.filter(p => p.category === filters.category);
    }
    if (filters.status) {
      products = products.filter(p => p.status === filters.status);
    }
    if (filters.listedOnEbay !== undefined) {
      products = products.filter(p => p.listedOnEbay === filters.listedOnEbay);
    }
    if (filters.listedOnAmazon !== undefined) {
      products = products.filter(p => p.listedOnAmazon === filters.listedOnAmazon);
    }
    if (filters.minStock !== undefined) {
      products = products.filter(p => p.stock >= filters.minStock!);
    }
    if (filters.maxStock !== undefined) {
      products = products.filter(p => p.stock <= filters.maxStock!);
    }

    return products.sort((a, b) => 
      new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime()
    );
  }

  // Categories
  async getCategories(): Promise<Category[]> {
    return Array.from(this.categories.values());
  }

  async createCategory(insertCategory: InsertCategory): Promise<Category> {
    const id = this.currentCategoryId++;
    const category: Category = { ...insertCategory, id };
    this.categories.set(id, category);
    return category;
  }

  // Marketplace Settings
  async getMarketplaceSettings(marketplace: string): Promise<MarketplaceSettings[]> {
    return Array.from(this.marketplaceSettings.values()).filter(s => s.marketplace === marketplace);
  }

  async setMarketplaceSetting(insertSetting: InsertMarketplaceSettings): Promise<MarketplaceSettings> {
    const id = this.currentMarketplaceSettingsId++;
    const setting: MarketplaceSettings = { ...insertSetting, id };
    this.marketplaceSettings.set(id, setting);
    return setting;
  }

  // Sync Logs
  async getSyncLogs(limit = 50): Promise<SyncLog[]> {
    const logs = Array.from(this.syncLogs.values())
      .sort((a, b) => new Date(b.syncedAt!).getTime() - new Date(a.syncedAt!).getTime());
    return logs.slice(0, limit);
  }

  async createSyncLog(insertLog: InsertSyncLog): Promise<SyncLog> {
    const id = this.currentSyncLogId++;
    const log: SyncLog = { 
      ...insertLog, 
      id, 
      syncedAt: new Date() 
    };
    this.syncLogs.set(id, log);
    return log;
  }

  // Dashboard metrics
  async getDashboardMetrics(): Promise<{
    totalProducts: number;
    ebayListings: number;
    amazonListings: number;
    totalRevenue: number;
    outOfStock: number;
  }> {
    const products = Array.from(this.products.values());
    
    const totalProducts = products.length;
    const ebayListings = products.filter(p => p.listedOnEbay).length;
    const amazonListings = products.filter(p => p.listedOnAmazon).length;
    const outOfStock = products.filter(p => p.stock === 0).length;
    
    // Calculate estimated revenue (this would be actual sales data in real app)
    const totalRevenue = products.reduce((sum, product) => {
      const revenue = Number(product.salePrice) * (product.stock * 0.1); // Simulate 10% sold
      return sum + revenue;
    }, 0);

    return {
      totalProducts,
      ebayListings,
      amazonListings,
      totalRevenue: Math.round(totalRevenue),
      outOfStock
    };
  }
}

export const storage = new DatabaseStorage();

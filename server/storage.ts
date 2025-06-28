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

export class MemStorage implements IStorage {
  private users: Map<number, User> = new Map();
  private products: Map<number, Product> = new Map();
  private categories: Map<number, Category> = new Map();
  private marketplaceSettings: Map<number, MarketplaceSettings> = new Map();
  private syncLogs: Map<number, SyncLog> = new Map();
  private currentUserId = 1;
  private currentProductId = 1;
  private currentCategoryId = 1;
  private currentMarketplaceSettingsId = 1;
  private currentSyncLogId = 1;

  constructor() {
    // Create default admin user
    this.createUser({
      username: "admin",
      password: "admin123", // In real app, this would be hashed
      email: "admin@inventorysync.com",
      role: "admin"
    });

    // Create default categories
    this.createCategory({ name: "Electronics", ebayMapping: "Electronics", amazonMapping: "Electronics" });
    this.createCategory({ name: "Accessories", ebayMapping: "Accessories", amazonMapping: "Accessories" });
    this.createCategory({ name: "Gaming", ebayMapping: "Gaming", amazonMapping: "Gaming" });
    this.createCategory({ name: "Home & Garden", ebayMapping: "Home & Garden", amazonMapping: "Home & Garden" });
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

export const storage = new MemStorage();

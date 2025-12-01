import { 
  users, 
  products, 
  categories, 
  marketplaceSettings, 
  syncLogs,
  syncQueue,
  pricingTiers,
  shippingPolicies,
  apiUsageTracking,
  tmeProductCache,
  type User, 
  type InsertUser, 
  type Product, 
  type InsertProduct,
  type Category,
  type InsertCategory,
  type MarketplaceSettings,
  type InsertMarketplaceSettings,
  type SyncLog,
  type InsertSyncLog,
  type SyncQueue,
  type InsertSyncQueue,
  type ShippingPolicy,
  type InsertShippingPolicy,
  type PricingTier,
  type InsertPricingTier,
  type ApiUsageTracking,
  type InsertApiUsageTracking,
  type TmeProductCache,
  type InsertTmeProductCache
} from "@shared/schema";
import { db } from "./db";
import { eq, and, gte, lte, desc, asc, count } from "drizzle-orm";
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

  // Sync Queue Operations
  createSyncQueueItem(item: InsertSyncQueue): Promise<SyncQueue>;
  createBulkSyncQueueItems(items: InsertSyncQueue[]): Promise<void>;
  getPendingSyncQueueItems(limit?: number): Promise<SyncQueue[]>;
  updateSyncQueueItem(id: number, updates: Partial<InsertSyncQueue> & { processedAt?: Date }): Promise<void>;
  getSyncQueueCount(status?: string): Promise<number>;
  getSyncQueueStats(): Promise<{
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    byPriority: Record<string, number>;
  }>;

  // Pricing Tiers
  getPricingTiers(): Promise<PricingTier[]>;
  createPricingTier(tier: InsertPricingTier): Promise<PricingTier>;
  updatePricingTier(id: number, tier: Partial<InsertPricingTier>): Promise<PricingTier | undefined>;
  deletePricingTier(id: number): Promise<boolean>;

  // Shipping Policies
  getShippingPolicies(): Promise<ShippingPolicy[]>;
  createShippingPolicy(policy: InsertShippingPolicy): Promise<ShippingPolicy>;
  updateShippingPolicy(id: string, policy: Partial<InsertShippingPolicy>): Promise<ShippingPolicy | undefined>;
  deleteShippingPolicy(id: string): Promise<boolean>;

  // API Usage Tracking
  getApiUsage(provider?: string): Promise<ApiUsageTracking | undefined>;
  trackApiCall(provider: string): Promise<void>;
  resetApiUsageIfNewDay(provider: string): Promise<void>;

  // TME Product Cache - PostgreSQL-based caching for 150k+ products
  getTmeCachedProduct(symbol: string): Promise<TmeProductCache | undefined>;
  getTmeCachedProducts(symbols: string[]): Promise<TmeProductCache[]>;
  setTmeCachedProduct(cache: InsertTmeProductCache): Promise<TmeProductCache>;
  setTmeCachedProducts(caches: InsertTmeProductCache[]): Promise<void>;
  getStaleProductSymbols(olderThan24Hours?: boolean): Promise<string[]>;
  cleanExpiredCache(): Promise<number>;
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

      // Create default pricing tiers if they don't exist
      const existingTiers = await this.getPricingTiers();
      if (existingTiers.length === 0) {
        await this.createPricingTier({ min: "1.00", max: "5.00", multiplier: "6.00", label: "Ultra High", marginPercentage: "500" });
        await this.createPricingTier({ min: "5.01", max: "9.99", multiplier: "4.00", label: "Very High", marginPercentage: "300" });
        await this.createPricingTier({ min: "10.00", max: "15.00", multiplier: "3.00", label: "High", marginPercentage: "200" });
        await this.createPricingTier({ min: "15.01", max: "25.00", multiplier: "2.50", label: "Medium-High", marginPercentage: "150" });
        await this.createPricingTier({ min: "25.01", max: "50.00", multiplier: "2.00", label: "Medium", marginPercentage: "100" });
        await this.createPricingTier({ min: "50.01", max: "100.00", multiplier: "1.75", label: "Low-Medium", marginPercentage: "75" });
        await this.createPricingTier({ min: "100.01", max: "999999", multiplier: "1.50", label: "Low", marginPercentage: "50" });
      }
    } catch (error) {
      console.error("Error initializing database:", error);
    }
  }

  // User methods
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user || undefined;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(insertUser)
      .returning();
    return user;
  }

  // Product methods
  async getProducts(): Promise<Product[]> {
    return await db.select().from(products).orderBy(desc(products.createdAt));
  }

  async getProduct(id: number): Promise<Product | undefined> {
    const [product] = await db.select().from(products).where(eq(products.id, id));
    return product || undefined;
  }

  async getProductBySku(sku: string): Promise<Product | undefined> {
    const [product] = await db.select().from(products).where(eq(products.sku, sku));
    return product || undefined;
  }

  async createProduct(insertProduct: InsertProduct): Promise<Product> {
    const [product] = await db
      .insert(products)
      .values(insertProduct)
      .returning();
    return product;
  }

  async updateProduct(id: number, updateData: Partial<InsertProduct>): Promise<Product | undefined> {
    const [updated] = await db
      .update(products)
      .set({ ...updateData, updatedAt: new Date() })
      .where(eq(products.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteProduct(id: number): Promise<boolean> {
    const result = await db.delete(products).where(eq(products.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  async getProductsByCategory(category: string): Promise<Product[]> {
    return await db.select().from(products).where(eq(products.category, category));
  }

  async getProductsWithFilters(filters: {
    category?: string;
    status?: string;
    listedOnEbay?: boolean;
    listedOnAmazon?: boolean;
    minStock?: number;
    maxStock?: number;
  }): Promise<Product[]> {
    const conditions = [];
    if (filters.category) conditions.push(eq(products.category, filters.category));
    if (filters.status) conditions.push(eq(products.status, filters.status));
    if (filters.listedOnEbay !== undefined) conditions.push(eq(products.listedOnEbay, filters.listedOnEbay));
    if (filters.listedOnAmazon !== undefined) conditions.push(eq(products.listedOnAmazon, filters.listedOnAmazon));
    if (filters.minStock !== undefined) conditions.push(gte(products.stock, filters.minStock));
    if (filters.maxStock !== undefined) conditions.push(lte(products.stock, filters.maxStock));
    
    if (conditions.length > 0) {
      return await db.select().from(products).where(and(...conditions)).orderBy(desc(products.createdAt));
    }
    
    return await db.select().from(products).orderBy(desc(products.createdAt));
  }

  // Category methods
  async getCategories(): Promise<Category[]> {
    return await db.select().from(categories);
  }

  async createCategory(insertCategory: InsertCategory): Promise<Category> {
    const [category] = await db
      .insert(categories)
      .values(insertCategory)
      .returning();
    return category;
  }

  // Marketplace settings methods
  async getMarketplaceSettings(marketplace: string): Promise<MarketplaceSettings[]> {
    return await db.select().from(marketplaceSettings).where(eq(marketplaceSettings.marketplace, marketplace));
  }

  async setMarketplaceSetting(insertSetting: InsertMarketplaceSettings): Promise<MarketplaceSettings> {
    const [setting] = await db
      .insert(marketplaceSettings)
      .values(insertSetting)
      .returning();
    return setting;
  }

  // Sync log methods
  async getSyncLogs(limit = 50): Promise<SyncLog[]> {
    return await db.select().from(syncLogs).orderBy(desc(syncLogs.syncedAt)).limit(limit);
  }

  async createSyncLog(insertLog: InsertSyncLog): Promise<SyncLog> {
    const [log] = await db
      .insert(syncLogs)
      .values(insertLog)
      .returning();
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
    const allProducts = await db.select().from(products);
    
    const totalProducts = allProducts.length;
    const ebayListings = allProducts.filter(p => p.listedOnEbay).length;
    const amazonListings = allProducts.filter(p => p.listedOnAmazon).length;
    const outOfStock = allProducts.filter(p => p.stock === 0).length;
    
    const totalRevenue = allProducts.reduce((sum, product) => {
      const price = parseFloat(product.salePrice) || 0;
      return sum + (price * product.stock);
    }, 0);

    return {
      totalProducts,
      ebayListings,
      amazonListings,
      totalRevenue: Math.round(totalRevenue),
      outOfStock
    };
  }

  // Sync Queue Operations
  async createSyncQueueItem(item: InsertSyncQueue): Promise<SyncQueue> {
    const [result] = await db.insert(syncQueue).values(item).returning();
    return result;
  }

  async createBulkSyncQueueItems(items: InsertSyncQueue[]): Promise<void> {
    if (items.length === 0) return;
    await db.insert(syncQueue).values(items);
  }

  async getPendingSyncQueueItems(limit: number = 100): Promise<SyncQueue[]> {
    return await db
      .select()
      .from(syncQueue)
      .where(eq(syncQueue.status, 'pending'))
      .orderBy(asc(syncQueue.priority), asc(syncQueue.createdAt))
      .limit(limit);
  }

  async updateSyncQueueItem(id: number, updates: Partial<InsertSyncQueue> & { processedAt?: Date }): Promise<void> {
    await db
      .update(syncQueue)
      .set(updates)
      .where(eq(syncQueue.id, id));
  }

  async getSyncQueueCount(status?: string): Promise<number> {
    const conditions = status ? [eq(syncQueue.status, status)] : [];
    const [result] = await db
      .select({ count: count() })
      .from(syncQueue)
      .where(and(...conditions));
    return result.count;
  }

  async getSyncQueueStats(): Promise<{
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    byPriority: Record<string, number>;
  }> {
    const [statusCounts, priorityCounts] = await Promise.all([
      db
        .select({ 
          status: syncQueue.status, 
          count: count() 
        })
        .from(syncQueue)
        .groupBy(syncQueue.status),
      db
        .select({ 
          priority: syncQueue.priority, 
          count: count() 
        })
        .from(syncQueue)
        .where(eq(syncQueue.status, 'pending'))
        .groupBy(syncQueue.priority)
    ]);

    const stats = {
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      byPriority: {} as Record<string, number>
    };

    statusCounts.forEach(row => {
      if (row.status === 'pending') stats.pending = row.count;
      else if (row.status === 'processing') stats.processing = row.count;
      else if (row.status === 'completed') stats.completed = row.count;
      else if (row.status === 'failed') stats.failed = row.count;
    });

    priorityCounts.forEach(row => {
      stats.byPriority[String(row.priority)] = row.count;
    });

    return stats;
  }

  // Pricing Tier methods
  async getPricingTiers(): Promise<PricingTier[]> {
    const result = await db.select().from(pricingTiers).orderBy(asc(pricingTiers.min));
    return result;
  }

  async createPricingTier(tier: InsertPricingTier): Promise<PricingTier> {
    const result = await db.insert(pricingTiers).values(tier).returning();
    return result[0];
  }

  async updatePricingTier(id: number, tier: Partial<InsertPricingTier>): Promise<PricingTier | undefined> {
    const result = await db.update(pricingTiers)
      .set({ ...tier, updatedAt: new Date() })
      .where(eq(pricingTiers.id, id))
      .returning();
    return result[0];
  }

  async deletePricingTier(id: number): Promise<boolean> {
    const result = await db.delete(pricingTiers).where(eq(pricingTiers.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  // Shipping Policy methods
  async getShippingPolicies(): Promise<ShippingPolicy[]> {
    const result = await db.select().from(shippingPolicies).orderBy(asc(shippingPolicies.minWeight));
    return result;
  }

  async createShippingPolicy(policy: InsertShippingPolicy): Promise<ShippingPolicy> {
    const result = await db.insert(shippingPolicies).values(policy).returning();
    return result[0];
  }

  async updateShippingPolicy(id: string, policy: Partial<InsertShippingPolicy>): Promise<ShippingPolicy | undefined> {
    const result = await db.update(shippingPolicies)
      .set({ ...policy, updatedAt: new Date() })
      .where(eq(shippingPolicies.id, id))
      .returning();
    return result[0];
  }

  async deleteShippingPolicy(id: string): Promise<boolean> {
    const result = await db.delete(shippingPolicies).where(eq(shippingPolicies.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  // API Usage Tracking methods
  async getApiUsage(provider: string = "tme"): Promise<ApiUsageTracking | undefined> {
    const result = await db.select().from(apiUsageTracking).where(eq(apiUsageTracking.provider, provider)).limit(1);
    return result[0];
  }

  async trackApiCall(provider: string): Promise<void> {
    const existing = await this.getApiUsage(provider);
    
    if (existing) {
      // Check if we need to reset (new day)
      const lastReset = new Date(existing.lastResetAt || new Date());
      const now = new Date();
      const isNewDay = lastReset.toDateString() !== now.toDateString();
      
      if (isNewDay) {
        // Reset for new day
        await db.update(apiUsageTracking)
          .set({ callsToday: 1, lastResetAt: now, updatedAt: now })
          .where(eq(apiUsageTracking.provider, provider));
      } else {
        // Increment
        await db.update(apiUsageTracking)
          .set({ callsToday: existing.callsToday + 1, updatedAt: now })
          .where(eq(apiUsageTracking.provider, provider));
      }
    } else {
      // Create new tracking record
      await db.insert(apiUsageTracking).values({
        provider,
        callsToday: 1,
        dailyLimit: 10000,
        lastResetAt: new Date(),
        updatedAt: new Date()
      });
    }
  }

  async resetApiUsageIfNewDay(provider: string): Promise<void> {
    const existing = await this.getApiUsage(provider);
    if (existing) {
      const lastReset = new Date(existing.lastResetAt || new Date());
      const now = new Date();
      if (lastReset.toDateString() !== now.toDateString()) {
        await db.update(apiUsageTracking)
          .set({ callsToday: 0, lastResetAt: now, updatedAt: now })
          .where(eq(apiUsageTracking.provider, provider));
      }
    }
  }

  // TME Product Cache methods - PostgreSQL-based caching for 150k+ products
  async getTmeCachedProduct(symbol: string): Promise<TmeProductCache | undefined> {
    const now = new Date();
    const result = await db.select()
      .from(tmeProductCache)
      .where(and(
        eq(tmeProductCache.symbol, symbol),
        gte(tmeProductCache.expiresAt, now)
      ))
      .limit(1);
    return result[0];
  }

  async getTmeCachedProducts(symbols: string[]): Promise<TmeProductCache[]> {
    if (symbols.length === 0) return [];
    const now = new Date();
    // Query for each symbol and filter non-expired
    const results: TmeProductCache[] = [];
    for (const symbol of symbols) {
      const cached = await this.getTmeCachedProduct(symbol);
      if (cached) results.push(cached);
    }
    return results;
  }

  async setTmeCachedProduct(cache: InsertTmeProductCache): Promise<TmeProductCache> {
    // Upsert: update if exists, insert if not
    const existing = await db.select()
      .from(tmeProductCache)
      .where(eq(tmeProductCache.symbol, cache.symbol))
      .limit(1);
    
    if (existing.length > 0) {
      const result = await db.update(tmeProductCache)
        .set({
          productData: cache.productData,
          priceData: cache.priceData,
          stockData: cache.stockData,
          categoryId: cache.categoryId,
          fetchedAt: new Date(),
          expiresAt: cache.expiresAt
        })
        .where(eq(tmeProductCache.symbol, cache.symbol))
        .returning();
      return result[0];
    } else {
      const result = await db.insert(tmeProductCache).values({
        ...cache,
        fetchedAt: new Date()
      }).returning();
      return result[0];
    }
  }

  async setTmeCachedProducts(caches: InsertTmeProductCache[]): Promise<void> {
    if (caches.length === 0) return;
    
    // Process in batches to avoid overwhelming the database
    const batchSize = 50;
    for (let i = 0; i < caches.length; i += batchSize) {
      const batch = caches.slice(i, i + batchSize);
      await Promise.all(batch.map(cache => this.setTmeCachedProduct(cache)));
    }
  }

  async getStaleProductSymbols(olderThan24Hours: boolean = true): Promise<string[]> {
    const cutoffTime = new Date(Date.now() - (olderThan24Hours ? 24 * 60 * 60 * 1000 : 0));
    const result = await db.select({ symbol: tmeProductCache.symbol })
      .from(tmeProductCache)
      .where(lte(tmeProductCache.expiresAt, cutoffTime));
    return result.map(r => r.symbol);
  }

  async cleanExpiredCache(): Promise<number> {
    const now = new Date();
    const result = await db.delete(tmeProductCache)
      .where(lte(tmeProductCache.expiresAt, now));
    return result.rowCount ?? 0;
  }
}

export const storage = new DatabaseStorage();
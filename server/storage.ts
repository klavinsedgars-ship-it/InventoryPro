import { 
  users, 
  products, 
  categories, 
  marketplaceSettings, 
  syncLogs,
  syncQueue,
  syncJobs,
  pricingTiers,
  shippingPolicies,
  apiUsageTracking,
  tmeProductCache,
  ebayTaxonomyCache,
  bulkListingJobs,
  ebayPaymentPolicies,
  ebayFulfillmentPolicies,
  ebayReturnPolicies,
  orders,
  orderItems,
  orderFees,
  orderEvents,
  messageThreads,
  messages,
  messageTemplates,
  autoMessageRules,
  scheduledMessages,
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
  type SyncJob,
  type InsertSyncJob,
  type SyncQueue,
  type InsertSyncQueue,
  type ShippingPolicy,
  type InsertShippingPolicy,
  type PricingTier,
  type InsertPricingTier,
  type ApiUsageTracking,
  type InsertApiUsageTracking,
  type TmeProductCache,
  type InsertTmeProductCache,
  type BulkListingJob,
  type InsertBulkListingJob,
  type EbayPaymentPolicy,
  type InsertEbayPaymentPolicy,
  type EbayFulfillmentPolicy,
  type InsertEbayFulfillmentPolicy,
  type EbayReturnPolicy,
  type InsertEbayReturnPolicy,
  type Order,
  type InsertOrder,
  type OrderItem,
  type InsertOrderItem,
  type OrderFee,
  type InsertOrderFee,
  type OrderEvent,
  type InsertOrderEvent,
  type MessageThread,
  type InsertMessageThread,
  type Message,
  type InsertMessage,
  type MessageTemplate,
  type InsertMessageTemplate,
  type AutoMessageRule,
  type InsertAutoMessageRule,
  type ScheduledMessage,
  type InsertScheduledMessage
} from "@shared/schema";
import { db } from "./db";
import { eq, ne, and, gte, lte, lt, desc, asc, count, or, ilike, isNull, isNotNull, sql, inArray } from "drizzle-orm";
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
  getProductsBySkus(skus: string[]): Promise<Product[]>;
  createProduct(product: InsertProduct): Promise<Product>;
  updateProduct(id: number, product: Partial<InsertProduct>): Promise<Product | undefined>;
  deleteProduct(id: number): Promise<boolean>;
  deleteProducts(ids: number[]): Promise<number>;
  deleteAllProducts(): Promise<number>;
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
  ensureSyncJobsTable(): Promise<void>;
  createSyncJob(job: InsertSyncJob): Promise<SyncJob>;
  getSyncJob(jobId: string): Promise<SyncJob | undefined>;
  updateSyncJob(jobId: string, updates: Partial<SyncJob>): Promise<SyncJob | undefined>;
  getActiveSyncJob(source?: string): Promise<SyncJob | undefined>;

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

  // Bulk Listing Jobs - track progress of bulk listing operations
  createBulkListingJob(job: InsertBulkListingJob): Promise<BulkListingJob>;
  getBulkListingJob(id: string): Promise<BulkListingJob | undefined>;
  updateBulkListingJob(id: string, updates: Partial<InsertBulkListingJob>): Promise<BulkListingJob | undefined>;
  cleanOldBulkListingJobs(olderThanHours?: number): Promise<number>;

  // eBay Payment Policies
  getEbayPaymentPolicies(): Promise<EbayPaymentPolicy[]>;
  getEbayPaymentPolicy(policyId: string): Promise<EbayPaymentPolicy | undefined>;
  createEbayPaymentPolicy(policy: InsertEbayPaymentPolicy): Promise<EbayPaymentPolicy>;
  updateEbayPaymentPolicy(policyId: string, policy: Partial<InsertEbayPaymentPolicy>): Promise<EbayPaymentPolicy | undefined>;
  deleteEbayPaymentPolicy(policyId: string): Promise<boolean>;

  // eBay Fulfillment (Shipping) Policies
  getEbayFulfillmentPolicies(): Promise<EbayFulfillmentPolicy[]>;
  getEbayFulfillmentPolicy(policyId: string): Promise<EbayFulfillmentPolicy | undefined>;
  createEbayFulfillmentPolicy(policy: InsertEbayFulfillmentPolicy): Promise<EbayFulfillmentPolicy>;
  updateEbayFulfillmentPolicy(policyId: string, policy: Partial<InsertEbayFulfillmentPolicy>): Promise<EbayFulfillmentPolicy | undefined>;
  deleteEbayFulfillmentPolicy(policyId: string): Promise<boolean>;

  // eBay Return Policies
  getEbayReturnPolicies(): Promise<EbayReturnPolicy[]>;
  getEbayReturnPolicy(policyId: string): Promise<EbayReturnPolicy | undefined>;
  createEbayReturnPolicy(policy: InsertEbayReturnPolicy): Promise<EbayReturnPolicy>;
  updateEbayReturnPolicy(policyId: string, policy: Partial<InsertEbayReturnPolicy>): Promise<EbayReturnPolicy | undefined>;
  deleteEbayReturnPolicy(policyId: string): Promise<boolean>;

  // Orders Management
  getOrders(filters?: {
    marketplace?: string;
    status?: string;
    search?: string;
    fromDate?: Date;
    toDate?: Date;
    limit?: number;
    offset?: number;
  }): Promise<Order[]>;
  getOrder(id: number): Promise<Order | undefined>;
  getOrderByMarketplaceId(marketplace: string, marketplaceOrderId: string): Promise<Order | undefined>;
  createOrder(order: InsertOrder): Promise<Order>;
  updateOrder(id: number, order: Partial<InsertOrder>): Promise<Order | undefined>;
  deleteOrder(id: number): Promise<boolean>;
  getOrdersCount(filters?: { marketplace?: string; status?: string }): Promise<number>;

  // Order Items
  getOrderItems(orderId: number): Promise<OrderItem[]>;
  createOrderItem(item: InsertOrderItem): Promise<OrderItem>;
  createOrderItems(items: InsertOrderItem[]): Promise<void>;

  // Order Fees
  getOrderFees(orderId: number): Promise<OrderFee[]>;
  createOrderFee(fee: InsertOrderFee): Promise<OrderFee>;
  createOrderFees(fees: InsertOrderFee[]): Promise<void>;

  // Order Events
  getOrderEvents(orderId: number): Promise<OrderEvent[]>;
  createOrderEvent(event: InsertOrderEvent): Promise<OrderEvent>;

  // Message Threads
  getMessageThreads(filters?: {
    marketplace?: string;
    status?: string;
    isRead?: boolean;
    orderId?: number;
    buyerUsername?: string;
    limit?: number;
    offset?: number;
  }): Promise<MessageThread[]>;
  getMessageThread(id: number): Promise<MessageThread | undefined>;
  getMessageThreadByBuyer(buyerUsername: string, itemId?: string): Promise<MessageThread | undefined>;
  createMessageThread(thread: InsertMessageThread): Promise<MessageThread>;
  updateMessageThread(id: number, thread: Partial<InsertMessageThread>): Promise<MessageThread | undefined>;
  getUnreadThreadCount(): Promise<number>;

  // Messages
  getMessages(threadId: number): Promise<Message[]>;
  getMessage(id: number): Promise<Message | undefined>;
  createMessage(message: InsertMessage): Promise<Message>;
  updateMessage(id: number, message: Partial<InsertMessage>): Promise<Message | undefined>;

  // Message Templates
  getMessageTemplates(category?: string): Promise<MessageTemplate[]>;
  getMessageTemplate(id: number): Promise<MessageTemplate | undefined>;
  createMessageTemplate(template: InsertMessageTemplate): Promise<MessageTemplate>;
  updateMessageTemplate(id: number, template: Partial<InsertMessageTemplate>): Promise<MessageTemplate | undefined>;
  deleteMessageTemplate(id: number): Promise<boolean>;
  incrementTemplateUsage(id: number): Promise<void>;

  // Auto Message Rules
  getAutoMessageRules(triggerType?: string): Promise<AutoMessageRule[]>;
  getAutoMessageRule(id: number): Promise<AutoMessageRule | undefined>;
  getActiveAutoMessageRules(triggerType: string): Promise<AutoMessageRule[]>;
  createAutoMessageRule(rule: InsertAutoMessageRule): Promise<AutoMessageRule>;
  updateAutoMessageRule(id: number, rule: Partial<InsertAutoMessageRule>): Promise<AutoMessageRule | undefined>;
  deleteAutoMessageRule(id: number): Promise<boolean>;
  incrementRuleSentCount(id: number): Promise<void>;

  // Scheduled Messages
  getScheduledMessages(status?: string): Promise<ScheduledMessage[]>;
  getPendingScheduledMessages(): Promise<ScheduledMessage[]>;
  createScheduledMessage(message: InsertScheduledMessage): Promise<ScheduledMessage>;
  updateScheduledMessage(id: number, message: Partial<InsertScheduledMessage>): Promise<ScheduledMessage | undefined>;
  cancelScheduledMessage(id: number): Promise<boolean>;
}

// Set once the sync_jobs table has been ensured in this process.
let syncJobsTableEnsured = false;

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

  // One-shot, idempotent schema upgrade for the scale rewrite: Inventory
  // API listing-state columns + the indexes the poll/drainer rely on.
  // Safe to run repeatedly (IF NOT EXISTS). Used instead of drizzle-kit
  // push since the table is small and we can't run the CLI on Vercel.
  async applyScaleMigration(): Promise<{ ok: boolean; statements: number }> {
    const stmts = [
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS ebay_offer_id text`,
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS ebay_listing_id text`,
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS ebay_listing_status text`,
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS ebay_listing_error text`,
      `CREATE INDEX IF NOT EXISTS products_supplier_stale_idx ON products (supplier, last_synced_at)`,
      `CREATE INDEX IF NOT EXISTS products_status_idx ON products (status)`,
      `CREATE INDEX IF NOT EXISTS products_ebay_idx ON products (listed_on_ebay, ebay_item_id)`,
      `CREATE INDEX IF NOT EXISTS products_list_candidate_idx ON products (supplier, listed_on_ebay, exclude_from_listing)`,
      `CREATE INDEX IF NOT EXISTS products_offer_idx ON products (listed_on_ebay, ebay_offer_id)`,
      `CREATE INDEX IF NOT EXISTS tme_cache_expires_idx ON tme_product_cache (expires_at)`,
      `CREATE INDEX IF NOT EXISTS sync_queue_status_priority_idx ON sync_queue (status, priority, scheduled_for)`,
    ];
    for (const s of stmts) {
      await db.execute(sql.raw(s));
    }
    return { ok: true, statements: stmts.length };
  }

  // Clear all eBay listing state locally (use after ending every listing
  // on eBay, to resync the green-E flags). Returns rows affected.
  async resetAllEbayListingState(): Promise<number> {
    const r: any = await db.execute(sql.raw(
      `UPDATE products SET listed_on_ebay = false, ebay_offer_id = NULL, ebay_listing_id = NULL, ebay_item_id = NULL, ebay_listing_status = 'unlisted', ebay_listing_error = NULL WHERE listed_on_ebay = true OR ebay_offer_id IS NOT NULL OR ebay_item_id IS NOT NULL`,
    ));
    return r.rowCount ?? 0;
  }

  // Stale TME products for the sync poll (DB-side, indexed by
  // products_supplier_stale_idx). Stalest first; never-synced win.
  async getStaleTmeProducts(limit: number, staleBefore: Date): Promise<Product[]> {
    return await db
      .select()
      .from(products)
      .where(
        and(
          eq(products.supplier, "TME"),
          or(isNull(products.lastSyncedAt), lt(products.lastSyncedAt, staleBefore)),
        ),
      )
      .orderBy(asc(products.lastSyncedAt))
      .limit(limit);
  }

  async getStaleTmeProductCount(staleBefore: Date): Promise<number> {
    const [r] = await db
      .select({ c: count() })
      .from(products)
      .where(
        and(
          eq(products.supplier, "TME"),
          or(isNull(products.lastSyncedAt), lt(products.lastSyncedAt, staleBefore)),
        ),
      );
    return r?.c ?? 0;
  }

  async getTmeProductCount(): Promise<number> {
    const [r] = await db.select({ c: count() }).from(products).where(eq(products.supplier, "TME"));
    return r?.c ?? 0;
  }

  // Diagnostic: how eBay listing ids are distributed across TME products.
  // The cron pushes price/stock to eBay only for listed products that carry
  // an Inventory-API ebay_offer_id. Legacy Trading-API listings have only
  // ebay_item_id and are currently skipped, so this split tells us how many
  // changed products the cron can actually update on eBay vs silently skips.
  async getEbayListingStats(): Promise<{
    totalTme: number;
    listed: number;
    listedWithOfferId: number;
    listedItemIdOnly: number;
    listedNeither: number;
    notListedWithOfferId: number;
  }> {
    const r: any = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE supplier = 'TME') AS total_tme,
        COUNT(*) FILTER (WHERE supplier = 'TME' AND listed_on_ebay = true) AS listed,
        COUNT(*) FILTER (WHERE supplier = 'TME' AND listed_on_ebay = true AND ebay_offer_id IS NOT NULL) AS listed_with_offer,
        COUNT(*) FILTER (WHERE supplier = 'TME' AND listed_on_ebay = true AND ebay_offer_id IS NULL AND ebay_item_id IS NOT NULL) AS listed_item_only,
        COUNT(*) FILTER (WHERE supplier = 'TME' AND listed_on_ebay = true AND ebay_offer_id IS NULL AND ebay_item_id IS NULL) AS listed_neither,
        COUNT(*) FILTER (WHERE supplier = 'TME' AND (listed_on_ebay = false OR listed_on_ebay IS NULL) AND ebay_offer_id IS NOT NULL) AS not_listed_with_offer
      FROM products
    `);
    const row = (r.rows ?? r)[0] ?? {};
    return {
      totalTme: Number(row.total_tme ?? 0),
      listed: Number(row.listed ?? 0),
      listedWithOfferId: Number(row.listed_with_offer ?? 0),
      listedItemIdOnly: Number(row.listed_item_only ?? 0),
      listedNeither: Number(row.listed_neither ?? 0),
      notListedWithOfferId: Number(row.not_listed_with_offer ?? 0),
    };
  }

  // Candidates to list on eBay: TME products, in stock, not already listed,
  // not excluded. DB-side filter + limit (no full-table load).
  // Eligible-to-list products. Optional sale-price band (min/max, inclusive)
  // lets the ramp target a price range. salePrice is the eBay list price.
  private listingCandidateConds(opts?: { minPrice?: number; maxPrice?: number }) {
    const conds = [
      eq(products.supplier, "TME"),
      eq(products.listedOnEbay, false),
      gte(products.stock, 1),
      or(eq(products.excludeFromListing, false), isNull(products.excludeFromListing)),
      // Skip products we auto-ended for being out of stock — sync-chunk
      // re-publishes their existing offer when stock returns, so the ramp
      // must not create a parallel offer for the same SKU.
      or(isNull(products.ebayListingStatus), ne(products.ebayListingStatus, "ended_oos")),
    ];
    if (opts?.minPrice != null) conds.push(gte(products.salePrice, String(opts.minPrice)));
    if (opts?.maxPrice != null) conds.push(lte(products.salePrice, String(opts.maxPrice)));
    return and(...conds);
  }

  async getListingCandidates(
    limit: number,
    opts?: { minPrice?: number; maxPrice?: number },
  ): Promise<Product[]> {
    return await db
      .select()
      .from(products)
      .where(this.listingCandidateConds(opts))
      .orderBy(asc(products.id))
      .limit(limit);
  }

  async getListingCandidateCount(opts?: { minPrice?: number; maxPrice?: number }): Promise<number> {
    const [r] = await db.select({ c: count() }).from(products).where(this.listingCandidateConds(opts));
    return r?.c ?? 0;
  }

  // Listed products needing an eBay stock/price push (have an offer id).
  async getProductsWithOffers(limit: number): Promise<Product[]> {
    return await db
      .select()
      .from(products)
      .where(and(eq(products.listedOnEbay, true), isNotNull(products.ebayOfferId)))
      .orderBy(asc(products.lastSyncedAt))
      .limit(limit);
  }

  async getProduct(id: number): Promise<Product | undefined> {
    const [product] = await db.select().from(products).where(eq(products.id, id));
    return product || undefined;
  }

  async getProductBySku(sku: string): Promise<Product | undefined> {
    const [product] = await db.select().from(products).where(eq(products.sku, sku));
    return product || undefined;
  }

  async getProductsBySkus(skus: string[]): Promise<Product[]> {
    if (skus.length === 0) return [];
    return await db.select().from(products).where(inArray(products.sku, skus));
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
    return await db.transaction(async (tx) => {
      await tx.delete(syncQueue).where(eq(syncQueue.productId, id));
      await tx
        .update(orderItems)
        .set({ productId: null })
        .where(eq(orderItems.productId, id));
      const result = await tx.delete(products).where(eq(products.id, id));
      return (result.rowCount ?? 0) > 0;
    });
  }

  async deleteProducts(ids: number[]): Promise<number> {
    if (ids.length === 0) return 0;
    return await db.transaction(async (tx) => {
      await tx.delete(syncQueue).where(inArray(syncQueue.productId, ids));
      await tx
        .update(orderItems)
        .set({ productId: null })
        .where(inArray(orderItems.productId, ids));
      const result = await tx.delete(products).where(inArray(products.id, ids));
      return result.rowCount ?? 0;
    });
  }

  async deleteAllProducts(): Promise<number> {
    return await db.transaction(async (tx) => {
      await tx.delete(syncQueue);
      await tx
        .update(orderItems)
        .set({ productId: null })
        .where(isNotNull(orderItems.productId));
      const result = await tx.delete(products);
      return result.rowCount ?? 0;
    });
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
    // Upsert on (marketplace, setting): update the existing row's value, else
    // insert. The table has no unique constraint, so do it explicitly.
    const [existing] = await db
      .select()
      .from(marketplaceSettings)
      .where(
        and(
          eq(marketplaceSettings.marketplace, insertSetting.marketplace),
          eq(marketplaceSettings.setting, insertSetting.setting),
        ),
      );
    if (existing) {
      const [updated] = await db
        .update(marketplaceSettings)
        .set({ value: insertSetting.value })
        .where(eq(marketplaceSettings.id, existing.id))
        .returning();
      return updated;
    }
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

  // Ops dashboard: today's job run counts per source + error rollup,
  // computed DB-side (not by loading rows into JS). "Today" is UTC day.
  async getSyncLogStatsToday(): Promise<{
    bySource: Record<string, number>;
    total: number;
    errors: number;
    recentErrors: Array<{ source: string; operation: string; message: string; syncedAt: string }>;
  }> {
    const grouped: any = await db.execute(sql`
      SELECT source,
             COUNT(*)::int AS n,
             COUNT(*) FILTER (WHERE status = 'error')::int AS errs
      FROM sync_logs
      WHERE synced_at >= date_trunc('day', now())
      GROUP BY source
    `);
    const bySource: Record<string, number> = {};
    let total = 0;
    let errors = 0;
    for (const r of (grouped.rows ?? grouped)) {
      bySource[r.source] = Number(r.n);
      total += Number(r.n);
      errors += Number(r.errs);
    }
    const errRes: any = await db.execute(sql`
      SELECT source, operation, message, synced_at
      FROM sync_logs
      WHERE status = 'error' AND synced_at >= date_trunc('day', now())
      ORDER BY synced_at DESC
      LIMIT 10
    `);
    const recentErrors = (errRes.rows ?? errRes).map((r: any) => ({
      source: r.source,
      operation: r.operation,
      message: r.message,
      syncedAt: r.synced_at,
    }));
    return { bySource, total, errors, recentErrors };
  }

  async createSyncLog(insertLog: InsertSyncLog): Promise<SyncLog> {
    const [log] = await db
      .insert(syncLogs)
      .values(insertLog)
      .returning();
    return log;
  }

  // Create the sync_jobs table on first use so deploys don't require a manual
  // `db:push`. CREATE TABLE IF NOT EXISTS is idempotent and additive; the
  // in-process flag just avoids re-issuing the DDL on every call.
  async ensureSyncJobsTable(): Promise<void> {
    if (syncJobsTableEnsured) return;
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS sync_jobs (
        id            SERIAL PRIMARY KEY,
        job_id        TEXT NOT NULL UNIQUE,
        source        TEXT NOT NULL DEFAULT 'tme_browser',
        status        TEXT NOT NULL DEFAULT 'pending',
        total         INTEGER NOT NULL DEFAULT 0,
        processed     INTEGER NOT NULL DEFAULT 0,
        synced_count  INTEGER NOT NULL DEFAULT 0,
        updated_count INTEGER NOT NULL DEFAULT 0,
        failed_count  INTEGER NOT NULL DEFAULT 0,
        symbols       TEXT NOT NULL,
        settings      TEXT,
        errors        TEXT,
        message       TEXT,
        created_at    TIMESTAMP DEFAULT now(),
        updated_at    TIMESTAMP DEFAULT now()
      )
    `);
    syncJobsTableEnsured = true;
  }

  async createSyncJob(job: InsertSyncJob): Promise<SyncJob> {
    await this.ensureSyncJobsTable();
    const [created] = await db.insert(syncJobs).values(job).returning();
    return created;
  }

  async getSyncJob(jobId: string): Promise<SyncJob | undefined> {
    await this.ensureSyncJobsTable();
    const [job] = await db.select().from(syncJobs).where(eq(syncJobs.jobId, jobId));
    return job || undefined;
  }

  async updateSyncJob(jobId: string, updates: Partial<SyncJob>): Promise<SyncJob | undefined> {
    const [updated] = await db
      .update(syncJobs)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(syncJobs.jobId, jobId))
      .returning();
    return updated || undefined;
  }

  async getActiveSyncJob(source = "tme_browser"): Promise<SyncJob | undefined> {
    await this.ensureSyncJobsTable();
    const [job] = await db
      .select()
      .from(syncJobs)
      .where(and(eq(syncJobs.source, source), inArray(syncJobs.status, ["pending", "processing"])))
      .orderBy(desc(syncJobs.createdAt))
      .limit(1);
    return job || undefined;
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
      const lastReset = new Date(existing.lastResetAt || new Date());
      const now = new Date();
      const isNewDay = lastReset.toDateString() !== now.toDateString();
      
      if (isNewDay) {
        await db.update(apiUsageTracking)
          .set({ callsToday: 1, lastResetAt: now, updatedAt: now })
          .where(eq(apiUsageTracking.provider, provider));
      } else {
        await db.update(apiUsageTracking)
          .set({ callsToday: existing.callsToday + 1, updatedAt: now })
          .where(eq(apiUsageTracking.provider, provider));
      }
    } else {
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

  // eBay Taxonomy cache (category suggestions + required-aspects per
  // category). DB-backed so it survives serverless cold starts — eliminates
  // re-spending Taxonomy quota every time a new function instance warms up.
  // Lazy CREATE TABLE IF NOT EXISTS avoids needing a separate migration.
  private taxonomyTableEnsured = false;
  private async ensureTaxonomyTable(): Promise<void> {
    if (this.taxonomyTableEnsured) return;
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ebay_taxonomy_cache (
        id SERIAL PRIMARY KEY,
        cache_key TEXT NOT NULL UNIQUE,
        value TEXT NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    this.taxonomyTableEnsured = true;
  }

  // Cache helpers are best-effort: a cache problem must never break listing
  // (which depends on category resolution), so all errors are swallowed.
  async getTaxonomyCache(key: string): Promise<any | null> {
    try {
      await this.ensureTaxonomyTable();
      const now = new Date();
      const rows = await db
        .select()
        .from(ebayTaxonomyCache)
        .where(and(eq(ebayTaxonomyCache.cacheKey, key), gte(ebayTaxonomyCache.expiresAt, now)))
        .limit(1);
      if (rows[0]) return JSON.parse(rows[0].value);
      return null;
    } catch (e) {
      console.warn("taxonomy cache read failed (ignored):", (e as Error).message);
      return null;
    }
  }

  async setTaxonomyCache(key: string, value: any, ttlHours = 24 * 30): Promise<void> {
    try {
      await this.ensureTaxonomyTable();
      const expiresAt = new Date(Date.now() + ttlHours * 3600 * 1000);
      const payload = JSON.stringify(value);
      await db.execute(sql`
        INSERT INTO ebay_taxonomy_cache (cache_key, value, expires_at, updated_at)
        VALUES (${key}, ${payload}, ${expiresAt}, NOW())
        ON CONFLICT (cache_key) DO UPDATE
          SET value = EXCLUDED.value,
              expires_at = EXCLUDED.expires_at,
              updated_at = NOW()
      `);
    } catch (e) {
      console.warn("taxonomy cache write failed (ignored):", (e as Error).message);
    }
  }

  // Bulk Listing Jobs - track progress of bulk listing operations
  async createBulkListingJob(job: InsertBulkListingJob): Promise<BulkListingJob> {
    const result = await db.insert(bulkListingJobs).values(job).returning();
    return result[0];
  }

  async getBulkListingJob(id: string): Promise<BulkListingJob | undefined> {
    const result = await db.select().from(bulkListingJobs).where(eq(bulkListingJobs.id, id));
    return result[0] || undefined;
  }

  async updateBulkListingJob(id: string, updates: Partial<InsertBulkListingJob>): Promise<BulkListingJob | undefined> {
    const result = await db.update(bulkListingJobs)
      .set(updates)
      .where(eq(bulkListingJobs.id, id))
      .returning();
    return result[0] || undefined;
  }

  async cleanOldBulkListingJobs(olderThanHours: number = 24): Promise<number> {
    const cutoffTime = new Date(Date.now() - (olderThanHours * 60 * 60 * 1000));
    const result = await db.delete(bulkListingJobs)
      .where(lte(bulkListingJobs.createdAt, cutoffTime));
    return result.rowCount ?? 0;
  }

  // eBay Payment Policies
  async getEbayPaymentPolicies(): Promise<EbayPaymentPolicy[]> {
    return await db.select().from(ebayPaymentPolicies).orderBy(desc(ebayPaymentPolicies.createdAt));
  }

  async getEbayPaymentPolicy(policyId: string): Promise<EbayPaymentPolicy | undefined> {
    const result = await db.select().from(ebayPaymentPolicies).where(eq(ebayPaymentPolicies.policyId, policyId));
    return result[0] || undefined;
  }

  async createEbayPaymentPolicy(policy: InsertEbayPaymentPolicy): Promise<EbayPaymentPolicy> {
    const result = await db.insert(ebayPaymentPolicies).values(policy).returning();
    return result[0];
  }

  async updateEbayPaymentPolicy(policyId: string, policy: Partial<InsertEbayPaymentPolicy>): Promise<EbayPaymentPolicy | undefined> {
    const result = await db.update(ebayPaymentPolicies)
      .set({ ...policy, updatedAt: new Date() })
      .where(eq(ebayPaymentPolicies.policyId, policyId))
      .returning();
    return result[0] || undefined;
  }

  async deleteEbayPaymentPolicy(policyId: string): Promise<boolean> {
    const result = await db.delete(ebayPaymentPolicies).where(eq(ebayPaymentPolicies.policyId, policyId));
    return (result.rowCount ?? 0) > 0;
  }

  // eBay Fulfillment (Shipping) Policies
  async getEbayFulfillmentPolicies(): Promise<EbayFulfillmentPolicy[]> {
    return await db.select().from(ebayFulfillmentPolicies).orderBy(desc(ebayFulfillmentPolicies.createdAt));
  }

  async getEbayFulfillmentPolicy(policyId: string): Promise<EbayFulfillmentPolicy | undefined> {
    const result = await db.select().from(ebayFulfillmentPolicies).where(eq(ebayFulfillmentPolicies.policyId, policyId));
    return result[0] || undefined;
  }

  async createEbayFulfillmentPolicy(policy: InsertEbayFulfillmentPolicy): Promise<EbayFulfillmentPolicy> {
    const result = await db.insert(ebayFulfillmentPolicies).values(policy).returning();
    return result[0];
  }

  async updateEbayFulfillmentPolicy(policyId: string, policy: Partial<InsertEbayFulfillmentPolicy>): Promise<EbayFulfillmentPolicy | undefined> {
    const result = await db.update(ebayFulfillmentPolicies)
      .set({ ...policy, updatedAt: new Date() })
      .where(eq(ebayFulfillmentPolicies.policyId, policyId))
      .returning();
    return result[0] || undefined;
  }

  async deleteEbayFulfillmentPolicy(policyId: string): Promise<boolean> {
    const result = await db.delete(ebayFulfillmentPolicies).where(eq(ebayFulfillmentPolicies.policyId, policyId));
    return (result.rowCount ?? 0) > 0;
  }

  // eBay Return Policies
  async getEbayReturnPolicies(): Promise<EbayReturnPolicy[]> {
    return await db.select().from(ebayReturnPolicies).orderBy(desc(ebayReturnPolicies.createdAt));
  }

  async getEbayReturnPolicy(policyId: string): Promise<EbayReturnPolicy | undefined> {
    const result = await db.select().from(ebayReturnPolicies).where(eq(ebayReturnPolicies.policyId, policyId));
    return result[0] || undefined;
  }

  async createEbayReturnPolicy(policy: InsertEbayReturnPolicy): Promise<EbayReturnPolicy> {
    const result = await db.insert(ebayReturnPolicies).values(policy).returning();
    return result[0];
  }

  async updateEbayReturnPolicy(policyId: string, policy: Partial<InsertEbayReturnPolicy>): Promise<EbayReturnPolicy | undefined> {
    const result = await db.update(ebayReturnPolicies)
      .set({ ...policy, updatedAt: new Date() })
      .where(eq(ebayReturnPolicies.policyId, policyId))
      .returning();
    return result[0] || undefined;
  }

  async deleteEbayReturnPolicy(policyId: string): Promise<boolean> {
    const result = await db.delete(ebayReturnPolicies).where(eq(ebayReturnPolicies.policyId, policyId));
    return (result.rowCount ?? 0) > 0;
  }

  // ==========================================
  // ORDERS MANAGEMENT
  // ==========================================

  async getOrders(filters?: {
    marketplace?: string;
    status?: string;
    search?: string;
    fromDate?: Date;
    toDate?: Date;
    limit?: number;
    offset?: number;
  }): Promise<Order[]> {
    const conditions = [];
    
    if (filters?.marketplace) {
      conditions.push(eq(orders.marketplace, filters.marketplace));
    }
    if (filters?.status) {
      conditions.push(eq(orders.status, filters.status));
    }
    if (filters?.fromDate) {
      conditions.push(gte(orders.orderDate, filters.fromDate));
    }
    if (filters?.toDate) {
      conditions.push(lte(orders.orderDate, filters.toDate));
    }
    if (filters?.search) {
      conditions.push(
        or(
          ilike(orders.marketplaceOrderId, `%${filters.search}%`),
          ilike(orders.buyerUsername, `%${filters.search}%`),
          ilike(orders.shippingName, `%${filters.search}%`)
        )
      );
    }

    let query = db.select().from(orders);
    
    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as any;
    }
    
    query = query.orderBy(desc(orders.orderDate)) as any;
    
    if (filters?.limit) {
      query = query.limit(filters.limit) as any;
    }
    if (filters?.offset) {
      query = query.offset(filters.offset) as any;
    }
    
    return await query;
  }

  async getOrder(id: number): Promise<Order | undefined> {
    const result = await db.select().from(orders).where(eq(orders.id, id));
    return result[0] || undefined;
  }

  async getOrderByMarketplaceId(marketplace: string, marketplaceOrderId: string): Promise<Order | undefined> {
    const result = await db.select().from(orders).where(
      and(
        eq(orders.marketplace, marketplace),
        eq(orders.marketplaceOrderId, marketplaceOrderId)
      )
    );
    return result[0] || undefined;
  }

  async createOrder(order: InsertOrder): Promise<Order> {
    const result = await db.insert(orders).values(order).returning();
    return result[0];
  }

  async updateOrder(id: number, order: Partial<InsertOrder>): Promise<Order | undefined> {
    const result = await db.update(orders)
      .set({ ...order, updatedAt: new Date() })
      .where(eq(orders.id, id))
      .returning();
    return result[0] || undefined;
  }

  async deleteOrder(id: number): Promise<boolean> {
    await db.delete(orderEvents).where(eq(orderEvents.orderId, id));
    await db.delete(orderFees).where(eq(orderFees.orderId, id));
    await db.delete(orderItems).where(eq(orderItems.orderId, id));
    const result = await db.delete(orders).where(eq(orders.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  async getOrdersCount(filters?: { marketplace?: string; status?: string }): Promise<number> {
    const conditions = [];
    
    if (filters?.marketplace) {
      conditions.push(eq(orders.marketplace, filters.marketplace));
    }
    if (filters?.status) {
      conditions.push(eq(orders.status, filters.status));
    }

    let query = db.select({ count: count() }).from(orders);
    
    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as any;
    }
    
    const result = await query;
    return result[0]?.count || 0;
  }

  // Order Items
  async getOrderItems(orderId: number): Promise<OrderItem[]> {
    return await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
  }

  async createOrderItem(item: InsertOrderItem): Promise<OrderItem> {
    const result = await db.insert(orderItems).values(item).returning();
    return result[0];
  }

  async createOrderItems(items: InsertOrderItem[]): Promise<void> {
    if (items.length > 0) {
      await db.insert(orderItems).values(items);
    }
  }

  // Order Fees
  async getOrderFees(orderId: number): Promise<OrderFee[]> {
    return await db.select().from(orderFees).where(eq(orderFees.orderId, orderId));
  }

  async createOrderFee(fee: InsertOrderFee): Promise<OrderFee> {
    const result = await db.insert(orderFees).values(fee).returning();
    return result[0];
  }

  async createOrderFees(fees: InsertOrderFee[]): Promise<void> {
    if (fees.length > 0) {
      await db.insert(orderFees).values(fees);
    }
  }

  // Order Events
  async getOrderEvents(orderId: number): Promise<OrderEvent[]> {
    return await db.select().from(orderEvents)
      .where(eq(orderEvents.orderId, orderId))
      .orderBy(desc(orderEvents.createdAt));
  }

  async createOrderEvent(event: InsertOrderEvent): Promise<OrderEvent> {
    const result = await db.insert(orderEvents).values(event).returning();
    return result[0];
  }

  // ============================================
  // MESSAGING SYSTEM
  // ============================================

  // Message Threads
  async getMessageThreads(filters?: {
    marketplace?: string;
    status?: string;
    isRead?: boolean;
    orderId?: number;
    buyerUsername?: string;
    limit?: number;
    offset?: number;
  }): Promise<MessageThread[]> {
    const conditions = [];
    
    if (filters?.marketplace) {
      conditions.push(eq(messageThreads.marketplace, filters.marketplace));
    }
    if (filters?.status) {
      conditions.push(eq(messageThreads.status, filters.status));
    }
    if (filters?.isRead !== undefined) {
      conditions.push(eq(messageThreads.isRead, filters.isRead));
    }
    if (filters?.orderId) {
      conditions.push(eq(messageThreads.orderId, filters.orderId));
    }
    if (filters?.buyerUsername) {
      conditions.push(ilike(messageThreads.buyerUsername, `%${filters.buyerUsername}%`));
    }

    let query = db.select().from(messageThreads)
      .orderBy(desc(messageThreads.lastMessageAt), desc(messageThreads.createdAt));

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as any;
    }
    if (filters?.limit) {
      query = query.limit(filters.limit) as any;
    }
    if (filters?.offset) {
      query = query.offset(filters.offset) as any;
    }

    return await query;
  }

  async getMessageThread(id: number): Promise<MessageThread | undefined> {
    const result = await db.select().from(messageThreads).where(eq(messageThreads.id, id));
    return result[0] || undefined;
  }

  async getMessageThreadByBuyer(buyerUsername: string, itemId?: string): Promise<MessageThread | undefined> {
    const conditions = [eq(messageThreads.buyerUsername, buyerUsername)];
    if (itemId) {
      conditions.push(eq(messageThreads.itemId, itemId));
    }
    const result = await db.select().from(messageThreads)
      .where(and(...conditions))
      .orderBy(desc(messageThreads.createdAt))
      .limit(1);
    return result[0] || undefined;
  }

  async createMessageThread(thread: InsertMessageThread): Promise<MessageThread> {
    const result = await db.insert(messageThreads).values(thread).returning();
    return result[0];
  }

  async updateMessageThread(id: number, thread: Partial<InsertMessageThread>): Promise<MessageThread | undefined> {
    const result = await db.update(messageThreads)
      .set({ ...thread, updatedAt: new Date() })
      .where(eq(messageThreads.id, id))
      .returning();
    return result[0] || undefined;
  }

  async getUnreadThreadCount(): Promise<number> {
    const result = await db.select({ count: count() }).from(messageThreads)
      .where(eq(messageThreads.isRead, false));
    return result[0]?.count || 0;
  }

  // Messages
  async getMessages(threadId: number): Promise<Message[]> {
    return await db.select().from(messages)
      .where(eq(messages.threadId, threadId))
      .orderBy(asc(messages.createdAt));
  }

  async getMessage(id: number): Promise<Message | undefined> {
    const result = await db.select().from(messages).where(eq(messages.id, id));
    return result[0] || undefined;
  }

  async createMessage(message: InsertMessage): Promise<Message> {
    const result = await db.insert(messages).values(message).returning();
    
    // Update thread's message count and last message time
    if (result[0]) {
      const countResult = await db.select({ count: count() }).from(messages)
        .where(eq(messages.threadId, message.threadId));
      const msgCount = countResult[0]?.count || 0;
      
      await db.update(messageThreads)
        .set({
          messageCount: msgCount,
          lastMessageAt: new Date(),
          updatedAt: new Date()
        })
        .where(eq(messageThreads.id, message.threadId));
    }
    
    return result[0];
  }

  async updateMessage(id: number, message: Partial<InsertMessage>): Promise<Message | undefined> {
    const result = await db.update(messages)
      .set(message)
      .where(eq(messages.id, id))
      .returning();
    return result[0] || undefined;
  }

  // Message Templates
  async getMessageTemplates(category?: string): Promise<MessageTemplate[]> {
    if (category) {
      return await db.select().from(messageTemplates)
        .where(eq(messageTemplates.category, category))
        .orderBy(desc(messageTemplates.usageCount));
    }
    return await db.select().from(messageTemplates)
      .orderBy(desc(messageTemplates.usageCount));
  }

  async getMessageTemplate(id: number): Promise<MessageTemplate | undefined> {
    const result = await db.select().from(messageTemplates).where(eq(messageTemplates.id, id));
    return result[0] || undefined;
  }

  async createMessageTemplate(template: InsertMessageTemplate): Promise<MessageTemplate> {
    const result = await db.insert(messageTemplates).values(template).returning();
    return result[0];
  }

  async updateMessageTemplate(id: number, template: Partial<InsertMessageTemplate>): Promise<MessageTemplate | undefined> {
    const result = await db.update(messageTemplates)
      .set({ ...template, updatedAt: new Date() })
      .where(eq(messageTemplates.id, id))
      .returning();
    return result[0] || undefined;
  }

  async deleteMessageTemplate(id: number): Promise<boolean> {
    const result = await db.delete(messageTemplates).where(eq(messageTemplates.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  async incrementTemplateUsage(id: number): Promise<void> {
    const template = await this.getMessageTemplate(id);
    if (template) {
      await db.update(messageTemplates)
        .set({
          usageCount: template.usageCount + 1,
          lastUsedAt: new Date()
        })
        .where(eq(messageTemplates.id, id));
    }
  }

  // Auto Message Rules
  async getAutoMessageRules(triggerType?: string): Promise<AutoMessageRule[]> {
    if (triggerType) {
      return await db.select().from(autoMessageRules)
        .where(eq(autoMessageRules.triggerType, triggerType))
        .orderBy(desc(autoMessageRules.createdAt));
    }
    return await db.select().from(autoMessageRules)
      .orderBy(desc(autoMessageRules.createdAt));
  }

  async getAutoMessageRule(id: number): Promise<AutoMessageRule | undefined> {
    const result = await db.select().from(autoMessageRules).where(eq(autoMessageRules.id, id));
    return result[0] || undefined;
  }

  async getActiveAutoMessageRules(triggerType: string): Promise<AutoMessageRule[]> {
    return await db.select().from(autoMessageRules)
      .where(and(
        eq(autoMessageRules.triggerType, triggerType),
        eq(autoMessageRules.isActive, true)
      ));
  }

  async createAutoMessageRule(rule: InsertAutoMessageRule): Promise<AutoMessageRule> {
    const result = await db.insert(autoMessageRules).values(rule).returning();
    return result[0];
  }

  async updateAutoMessageRule(id: number, rule: Partial<InsertAutoMessageRule>): Promise<AutoMessageRule | undefined> {
    const result = await db.update(autoMessageRules)
      .set({ ...rule, updatedAt: new Date() })
      .where(eq(autoMessageRules.id, id))
      .returning();
    return result[0] || undefined;
  }

  async deleteAutoMessageRule(id: number): Promise<boolean> {
    const result = await db.delete(autoMessageRules).where(eq(autoMessageRules.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  async incrementRuleSentCount(id: number): Promise<void> {
    const rule = await this.getAutoMessageRule(id);
    if (rule) {
      await db.update(autoMessageRules)
        .set({
          sentCount: rule.sentCount + 1,
          lastTriggeredAt: new Date()
        })
        .where(eq(autoMessageRules.id, id));
    }
  }

  // Scheduled Messages
  async getScheduledMessages(status?: string): Promise<ScheduledMessage[]> {
    if (status) {
      return await db.select().from(scheduledMessages)
        .where(eq(scheduledMessages.status, status))
        .orderBy(asc(scheduledMessages.scheduledFor));
    }
    return await db.select().from(scheduledMessages)
      .orderBy(asc(scheduledMessages.scheduledFor));
  }

  async getPendingScheduledMessages(): Promise<ScheduledMessage[]> {
    return await db.select().from(scheduledMessages)
      .where(and(
        eq(scheduledMessages.status, 'pending'),
        lte(scheduledMessages.scheduledFor, new Date())
      ))
      .orderBy(asc(scheduledMessages.scheduledFor));
  }

  async createScheduledMessage(message: InsertScheduledMessage): Promise<ScheduledMessage> {
    const result = await db.insert(scheduledMessages).values(message).returning();
    return result[0];
  }

  async updateScheduledMessage(id: number, message: Partial<InsertScheduledMessage>): Promise<ScheduledMessage | undefined> {
    const result = await db.update(scheduledMessages)
      .set(message)
      .where(eq(scheduledMessages.id, id))
      .returning();
    return result[0] || undefined;
  }

  async cancelScheduledMessage(id: number): Promise<boolean> {
    const result = await db.update(scheduledMessages)
      .set({ status: 'cancelled' })
      .where(eq(scheduledMessages.id, id));
    return (result.rowCount ?? 0) > 0;
  }
}

export const storage = new DatabaseStorage();
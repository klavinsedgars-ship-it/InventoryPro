import { pgTable, text, serial, integer, boolean, decimal, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  email: text("email").notNull().unique(),
  role: text("role").notNull().default("user"), // admin or user
  createdAt: timestamp("created_at").defaultNow(),
});

export const products = pgTable("products", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  sku: text("sku").notNull().unique(),
  ean: text("ean"),
  category: text("category").notNull(),
  description: text("description"),
  supplierPrice: decimal("supplier_price", { precision: 10, scale: 2 }).notNull(),
  salePrice: decimal("sale_price", { precision: 10, scale: 2 }).notNull(),
  calculatedPrice: decimal("calculated_price", { precision: 10, scale: 2 }), // auto-calculated price
  marginTier: text("margin_tier"), // tier label (e.g., "Ultra High", "Medium")
  marginPercentage: decimal("margin_percentage", { precision: 5, scale: 2 }), // applied margin %
  priceUpdatedAt: timestamp("price_updated_at"), // last price calculation
  useCalculatedPrice: boolean("use_calculated_price").default(true), // use dynamic vs manual pricing
  stock: integer("stock").notNull().default(0), // Real TME stock
  moq: integer("moq").notNull().default(1), // Minimum order quantity from TME
  multiples: integer("multiples").notNull().default(1), // Order multiples from TME
  ebayStockLimit: integer("ebay_stock_limit").notNull().default(3), // Max stock to show on eBay
  useStockLimit: boolean("use_stock_limit").default(true), // Whether to apply eBay stock limits
  weight: decimal("weight", { precision: 8, scale: 2 }), // in grams
  margin: decimal("margin", { precision: 5, scale: 2 }), // percentage (legacy field)
  status: text("status").notNull().default("active"), // active, inactive, out_of_stock
  listedOnEbay: boolean("listed_on_ebay").default(false),
  listedOnAmazon: boolean("listed_on_amazon").default(false),
  excludeFromListing: boolean("exclude_from_listing").default(false),
  ebayItemId: text("ebay_item_id"),
  amazonAsin: text("amazon_asin"),
  tmeProductId: text("tme_product_id"),
  supplier: text("supplier").default("manual"), // manual, TME, etc.
  supplierProductId: text("supplier_product_id"),
  imageUrl: text("image_url"),
  dataSheetUrl: text("datasheet_url"),
  productUrl: text("product_url"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  lastSyncedAt: timestamp("last_synced_at"), // When product was last synced from TME
});

export const categories = pgTable("categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  ebayMapping: text("ebay_mapping"),
  amazonMapping: text("amazon_mapping"),
});

export const marketplaceSettings = pgTable("marketplace_settings", {
  id: serial("id").primaryKey(),
  marketplace: text("marketplace").notNull(), // ebay or amazon
  setting: text("setting").notNull(),
  value: text("value").notNull(),
});

export const syncLogs = pgTable("sync_logs", {
  id: serial("id").primaryKey(),
  source: text("source").notNull(), // tme, ebay, amazon
  operation: text("operation").default("sync"), // sync_start, sync_complete, price_update, etc.
  status: text("status").notNull(), // success, error, pending, in_progress
  message: text("message"),
  details: text("details"), // JSON string for additional data
  syncedAt: timestamp("synced_at").defaultNow(),
});

export const syncQueue = pgTable("sync_queue", {
  id: serial("id").primaryKey(),
  productId: integer("product_id").references(() => products.id).notNull(),
  operation: text("operation").notNull(), // 'list', 'update_price', 'update_stock', 'unlist'
  priority: integer("priority").notNull().default(3), // 1=critical, 2=high, 3=medium, 4=low
  status: text("status").notNull().default("pending"), // 'pending', 'processing', 'completed', 'failed'
  retryCount: integer("retry_count").notNull().default(0),
  maxRetries: integer("max_retries").notNull().default(3),
  marketplace: text("marketplace").notNull().default("ebay"), // ebay, amazon
  scheduledFor: timestamp("scheduled_for").defaultNow(),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow(),
  processedAt: timestamp("processed_at"),
});

export const pricingTiers = pgTable("pricing_tiers", {
  id: serial("id").primaryKey(),
  min: decimal("min", { precision: 10, scale: 2 }).notNull(),
  max: decimal("max", { precision: 10, scale: 2 }).notNull(),
  multiplier: decimal("multiplier", { precision: 5, scale: 2 }).notNull(),
  label: text("label").notNull(),
  marginPercentage: decimal("margin_percentage", { precision: 5, scale: 2 }).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const shippingPolicies = pgTable("shipping_policies", {
  id: text("id").primaryKey(), // e.g., "policy_light", "policy_heavy"
  name: text("name").notNull(),
  description: text("description").notNull(),
  minWeight: integer("min_weight").notNull(), // in grams
  maxWeight: integer("max_weight").notNull(), // in grams
  type: text("type").default("standard"), // standard, express, overnight
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const apiUsageTracking = pgTable("api_usage_tracking", {
  id: serial("id").primaryKey(),
  provider: text("provider").notNull().default("tme"), // tme, ebay, amazon
  callsToday: integer("calls_today").notNull().default(0),
  dailyLimit: integer("daily_limit").notNull().default(10000),
  lastResetAt: timestamp("last_reset_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// TME Product Cache - replaces in-memory Map for production scalability
export const tmeProductCache = pgTable("tme_product_cache", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull().unique(), // TME product SKU/Symbol
  productData: text("product_data").notNull(), // JSON string of product info
  priceData: text("price_data"), // JSON string of pricing info
  stockData: text("stock_data"), // JSON string of stock info
  categoryId: integer("category_id"),
  fetchedAt: timestamp("fetched_at").defaultNow().notNull(), // When data was fetched
  expiresAt: timestamp("expires_at").notNull(), // When cache should be refreshed (24 hours)
});

// Insert schemas
export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
});

export const insertProductSchema = createInsertSchema(products).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertCategorySchema = createInsertSchema(categories).omit({
  id: true,
});

export const insertMarketplaceSettingsSchema = createInsertSchema(marketplaceSettings).omit({
  id: true,
});

export const insertSyncLogSchema = createInsertSchema(syncLogs).omit({
  id: true,
  syncedAt: true,
});

export const insertSyncQueueSchema = createInsertSchema(syncQueue).omit({
  id: true,
  createdAt: true,
  processedAt: true,
});

export const insertPricingTierSchema = createInsertSchema(pricingTiers).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertShippingPolicySchema = createInsertSchema(shippingPolicies).omit({
  createdAt: true,
  updatedAt: true,
});

export const insertApiUsageTrackingSchema = createInsertSchema(apiUsageTracking).omit({
  id: true,
  lastResetAt: true,
  updatedAt: true,
});

export const insertTmeProductCacheSchema = createInsertSchema(tmeProductCache).omit({
  id: true,
  fetchedAt: true,
});

// Login schema
export const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

// Types
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type Product = typeof products.$inferSelect;
export type InsertProduct = z.infer<typeof insertProductSchema>;
export type Category = typeof categories.$inferSelect;
export type InsertCategory = z.infer<typeof insertCategorySchema>;
export type MarketplaceSettings = typeof marketplaceSettings.$inferSelect;
export type InsertMarketplaceSettings = z.infer<typeof insertMarketplaceSettingsSchema>;
export type SyncLog = typeof syncLogs.$inferSelect;
export type InsertSyncLog = z.infer<typeof insertSyncLogSchema>;
export type SyncQueue = typeof syncQueue.$inferSelect;
export type InsertSyncQueue = z.infer<typeof insertSyncQueueSchema>;
export type PricingTier = typeof pricingTiers.$inferSelect;
export type InsertPricingTier = z.infer<typeof insertPricingTierSchema>;
export type ShippingPolicy = typeof shippingPolicies.$inferSelect;
export type InsertShippingPolicy = z.infer<typeof insertShippingPolicySchema>;
export type ApiUsageTracking = typeof apiUsageTracking.$inferSelect;
export type InsertApiUsageTracking = z.infer<typeof insertApiUsageTrackingSchema>;
export type TmeProductCache = typeof tmeProductCache.$inferSelect;
export type InsertTmeProductCache = z.infer<typeof insertTmeProductCacheSchema>;
export type LoginData = z.infer<typeof loginSchema>;

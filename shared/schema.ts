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
  ebayStockLimit: integer("ebay_stock_limit").notNull().default(2), // Max stock to show on eBay
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
  tmeCategoryId: text("tme_category_id"), // TME category ID for synced products
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

// Bulk Listing Jobs - tracks progress of bulk listing operations
export const bulkListingJobs = pgTable("bulk_listing_jobs", {
  id: text("id").primaryKey(), // UUID for job tracking
  status: text("status").notNull().default("pending"), // pending, processing, completed, failed
  total: integer("total").notNull().default(0),
  processed: integer("processed").notNull().default(0),
  succeeded: integer("succeeded").notNull().default(0),
  failed: integer("failed").notNull().default(0),
  currentProduct: text("current_product"), // Name of product currently being processed
  lastMessage: text("last_message"),
  errorDetails: text("error_details"), // JSON array of failed items with reasons
  createdAt: timestamp("created_at").defaultNow(),
  completedAt: timestamp("completed_at"),
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

// eBay Business Policies - Payment Policies
export const ebayPaymentPolicies = pgTable("ebay_payment_policies", {
  id: serial("id").primaryKey(),
  policyId: text("policy_id").notNull().unique(), // eBay's policy ID
  name: text("name").notNull(),
  description: text("description"),
  marketplaceId: text("marketplace_id").notNull().default("EBAY_GB"), // EBAY_US, EBAY_GB, etc.
  categoryTypes: text("category_types"), // JSON array of category types
  paymentMethods: text("payment_methods"), // JSON array of payment methods
  immediatePay: boolean("immediate_pay").default(true),
  isDefault: boolean("is_default").default(false),
  syncedFromEbay: boolean("synced_from_ebay").default(false), // true if fetched from eBay
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// eBay Business Policies - Fulfillment (Shipping) Policies
export const ebayFulfillmentPolicies = pgTable("ebay_fulfillment_policies", {
  id: serial("id").primaryKey(),
  policyId: text("policy_id").notNull().unique(), // eBay's policy ID
  name: text("name").notNull(),
  description: text("description"),
  marketplaceId: text("marketplace_id").notNull().default("EBAY_GB"),
  categoryTypes: text("category_types"), // JSON array
  handlingTime: integer("handling_time").notNull().default(1), // Days to dispatch
  shippingOptions: text("shipping_options"), // JSON array of shipping options
  shipToLocations: text("ship_to_locations"), // JSON - regions included/excluded
  globalShipping: boolean("global_shipping").default(false),
  pickupDropOff: boolean("pickup_drop_off").default(false),
  freightShipping: boolean("freight_shipping").default(false),
  isDefault: boolean("is_default").default(false),
  syncedFromEbay: boolean("synced_from_ebay").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// eBay Business Policies - Return Policies
export const ebayReturnPolicies = pgTable("ebay_return_policies", {
  id: serial("id").primaryKey(),
  policyId: text("policy_id").notNull().unique(), // eBay's policy ID
  name: text("name").notNull(),
  description: text("description"),
  marketplaceId: text("marketplace_id").notNull().default("EBAY_GB"),
  categoryTypes: text("category_types"), // JSON array
  returnsAccepted: boolean("returns_accepted").notNull().default(true),
  returnPeriod: integer("return_period").default(30), // Days
  refundMethod: text("refund_method").default("MONEY_BACK"), // MONEY_BACK, EXCHANGE
  returnShippingCostPayer: text("return_shipping_cost_payer").default("BUYER"), // BUYER, SELLER
  restockingFeePercentage: text("restocking_fee_percentage"), // Optional restocking fee
  isDefault: boolean("is_default").default(false),
  syncedFromEbay: boolean("synced_from_ebay").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ==========================================
// ORDERS MANAGEMENT SYSTEM
// ==========================================

// Main Orders Table - supports eBay and Amazon
export const orders = pgTable("orders", {
  id: serial("id").primaryKey(),
  marketplace: text("marketplace").notNull(), // ebay, amazon
  marketplaceOrderId: text("marketplace_order_id").notNull(), // eBay order ID, Amazon order ID
  status: text("status").notNull().default("new"), // new, packed, shipped, delivered, return_requested, returned, completed, cancelled, on_hold
  
  // Buyer Information
  buyerUsername: text("buyer_username").notNull(), // eBay nickname or Amazon customer name
  buyerEmail: text("buyer_email"),
  
  // Shipping Address (JSON for flexibility across marketplaces)
  shippingName: text("shipping_name").notNull(),
  shippingAddressLine1: text("shipping_address_line1").notNull(),
  shippingAddressLine2: text("shipping_address_line2"),
  shippingCity: text("shipping_city").notNull(),
  shippingStateOrProvince: text("shipping_state_or_province"),
  shippingPostalCode: text("shipping_postal_code").notNull(),
  shippingCountry: text("shipping_country").notNull(),
  shippingPhone: text("shipping_phone"),
  
  // Order Totals
  subtotal: decimal("subtotal", { precision: 10, scale: 2 }).notNull(),
  shippingCost: decimal("shipping_cost", { precision: 10, scale: 2 }).notNull().default("0.00"),
  totalPrice: decimal("total_price", { precision: 10, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("GBP"),
  
  // Marketplace Fees
  marketplaceFee: decimal("marketplace_fee", { precision: 10, scale: 2 }), // eBay/Amazon fee
  paymentProcessingFee: decimal("payment_processing_fee", { precision: 10, scale: 2 }),
  
  // Shipping Details
  shippingService: text("shipping_service"), // e.g., "Royal Mail 2nd Class"
  shippingCarrier: text("shipping_carrier"), // e.g., "Royal Mail"
  trackingNumber: text("tracking_number"),
  trackingUrl: text("tracking_url"),
  
  // Fulfillment
  paidAt: timestamp("paid_at"),
  shippedAt: timestamp("shipped_at"),
  deliveredAt: timestamp("delivered_at"),
  expectedDeliveryStart: timestamp("expected_delivery_start"),
  expectedDeliveryEnd: timestamp("expected_delivery_end"),
  
  // Logistics Integration (for Latvian Post, etc.)
  logisticsCarrier: text("logistics_carrier"), // pasts_lv, dhl, ups, etc.
  logisticsLabelUrl: text("logistics_label_url"),
  logisticsLabelData: text("logistics_label_data"), // JSON for carrier-specific data
  
  // Notes and Metadata
  buyerNote: text("buyer_note"), // Message from buyer
  sellerNote: text("seller_note"), // Internal seller notes
  rawOrderData: text("raw_order_data"), // Full marketplace response JSON
  
  // Timestamps
  orderDate: timestamp("order_date").notNull(), // When order was placed
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  lastSyncedAt: timestamp("last_synced_at"),
});

// Order Items (Line Items)
export const orderItems = pgTable("order_items", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").references(() => orders.id).notNull(),
  
  // Product Reference
  productId: integer("product_id").references(() => products.id), // Can be null for unmapped products
  sku: text("sku").notNull(),
  tmeProductId: text("tme_product_id"), // TME SKU for direct link
  
  // Item Details
  title: text("title").notNull(), // Product title as shown on marketplace
  quantity: integer("quantity").notNull().default(1),
  unitPrice: decimal("unit_price", { precision: 10, scale: 2 }).notNull(),
  totalPrice: decimal("total_price", { precision: 10, scale: 2 }).notNull(),
  
  // Marketplace-specific
  marketplaceItemId: text("marketplace_item_id"), // eBay listing ID, Amazon ASIN
  imageUrl: text("image_url"),
  
  createdAt: timestamp("created_at").defaultNow(),
});

// Order Fees (for detailed fee tracking)
export const orderFees = pgTable("order_fees", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").references(() => orders.id).notNull(),
  
  feeType: text("fee_type").notNull(), // ebay_final_value, ebay_international, shipping, payment_processing, promoted_listing, refund
  description: text("description"),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("GBP"),
  
  createdAt: timestamp("created_at").defaultNow(),
});

// Order Events (for status tracking and audit trail)
export const orderEvents = pgTable("order_events", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").references(() => orders.id).notNull(),
  
  eventType: text("event_type").notNull(), // status_change, note_added, tracking_added, label_printed, synced, refund_initiated
  fromStatus: text("from_status"), // Previous status (for status_change events)
  toStatus: text("to_status"), // New status (for status_change events)
  note: text("note"),
  userId: integer("user_id").references(() => users.id), // Who performed the action
  
  createdAt: timestamp("created_at").defaultNow(),
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

export const insertBulkListingJobSchema = createInsertSchema(bulkListingJobs).omit({
  createdAt: true,
});

export const insertEbayPaymentPolicySchema = createInsertSchema(ebayPaymentPolicies).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertEbayFulfillmentPolicySchema = createInsertSchema(ebayFulfillmentPolicies).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertEbayReturnPolicySchema = createInsertSchema(ebayReturnPolicies).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertOrderSchema = createInsertSchema(orders).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  lastSyncedAt: true,
});

export const insertOrderItemSchema = createInsertSchema(orderItems).omit({
  id: true,
  createdAt: true,
});

export const insertOrderFeeSchema = createInsertSchema(orderFees).omit({
  id: true,
  createdAt: true,
});

export const insertOrderEventSchema = createInsertSchema(orderEvents).omit({
  id: true,
  createdAt: true,
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
export type BulkListingJob = typeof bulkListingJobs.$inferSelect;
export type InsertBulkListingJob = z.infer<typeof insertBulkListingJobSchema>;
export type EbayPaymentPolicy = typeof ebayPaymentPolicies.$inferSelect;
export type InsertEbayPaymentPolicy = z.infer<typeof insertEbayPaymentPolicySchema>;
export type EbayFulfillmentPolicy = typeof ebayFulfillmentPolicies.$inferSelect;
export type InsertEbayFulfillmentPolicy = z.infer<typeof insertEbayFulfillmentPolicySchema>;
export type EbayReturnPolicy = typeof ebayReturnPolicies.$inferSelect;
export type InsertEbayReturnPolicy = z.infer<typeof insertEbayReturnPolicySchema>;
export type Order = typeof orders.$inferSelect;
export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type OrderItem = typeof orderItems.$inferSelect;
export type InsertOrderItem = z.infer<typeof insertOrderItemSchema>;
export type OrderFee = typeof orderFees.$inferSelect;
export type InsertOrderFee = z.infer<typeof insertOrderFeeSchema>;
export type OrderEvent = typeof orderEvents.$inferSelect;
export type InsertOrderEvent = z.infer<typeof insertOrderEventSchema>;
export type LoginData = z.infer<typeof loginSchema>;

// Order Status Enum for type safety
export const OrderStatus = {
  NEW: 'new',
  PACKED: 'packed',
  SHIPPED: 'shipped',
  DELIVERED: 'delivered',
  RETURN_REQUESTED: 'return_requested',
  RETURNED: 'returned',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  ON_HOLD: 'on_hold',
} as const;

export type OrderStatusType = typeof OrderStatus[keyof typeof OrderStatus];

// Marketplace Enum
export const Marketplace = {
  EBAY: 'ebay',
  AMAZON: 'amazon',
} as const;

export type MarketplaceType = typeof Marketplace[keyof typeof Marketplace];

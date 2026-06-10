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
  ebayItemId: text("ebay_item_id"), // legacy Trading-API listing id (migrated listings)
  // Inventory API listing state (SKU-keyed model: inventory item -> offer -> publish)
  ebayOfferId: text("ebay_offer_id"),
  ebayListingId: text("ebay_listing_id"),
  ebayListingStatus: text("ebay_listing_status"), // unlisted|inventory_created|offer_created|published|error
  ebayListingError: text("ebay_listing_error"),
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

// Per-SKU audit trail of what the TME->DB->eBay sync actually changed. Unlike
// syncLogs (one aggregate row per run), this records one row per product that
// changed during a chunk, with the old/new price+stock and the resulting eBay
// action. Powers the "Sync Activity" view: "TME changed SKU X, did it reach
// eBay?". Written by runSyncChunk; append-only.
export const syncAudit = pgTable("sync_audit", {
  id: serial("id").primaryKey(),
  productId: integer("product_id"), // FK-ish; nullable so audit survives product deletion
  sku: text("sku").notNull(),
  source: text("source").notNull().default("cron"), // cron | manual
  priceChanged: boolean("price_changed").notNull().default(false),
  stockChanged: boolean("stock_changed").notNull().default(false),
  oldSupplierPrice: decimal("old_supplier_price", { precision: 10, scale: 2 }),
  newSupplierPrice: decimal("new_supplier_price", { precision: 10, scale: 2 }),
  oldStock: integer("old_stock"),
  newStock: integer("new_stock"),
  // none | not_listed | updated | unlisted | relisted | failed | skipped_no_offer
  ebayAction: text("ebay_action").notNull().default("none"),
  ebayError: text("ebay_error"),
  createdAt: timestamp("created_at").defaultNow(),
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

// Long-running TME import jobs. State lives in the DB (not in memory) so a
// chunked sync survives serverless function recycling and page refreshes,
// and the client can poll real progress instead of a fake bar.
export const syncJobs = pgTable("sync_jobs", {
  id: serial("id").primaryKey(),
  jobId: text("job_id").notNull().unique(), // opaque id returned to the client
  source: text("source").notNull().default("tme_browser"),
  // pending | processing | completed | completed_with_errors | failed | cancelled
  status: text("status").notNull().default("pending"),
  total: integer("total").notNull().default(0),
  processed: integer("processed").notNull().default(0),
  syncedCount: integer("synced_count").notNull().default(0),
  updatedCount: integer("updated_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  symbols: text("symbols").notNull(), // JSON array of all selected TME symbols
  settings: text("settings"), // JSON of sync settings (dynamic pricing, etc.)
  errors: text("errors"), // JSON array of error strings (capped)
  message: text("message"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
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

// eBay Taxonomy Cache - persists Taxonomy lookups (category suggestions and
// required-aspects per category) across serverless cold starts. Avoids
// re-spending Taxonomy quota on every new function instance.
export const ebayTaxonomyCache = pgTable("ebay_taxonomy_cache", {
  id: serial("id").primaryKey(),
  // "suggest:<treeId>:<query>" or "aspects:<treeId>:<categoryId>"
  cacheKey: text("cache_key").notNull().unique(),
  value: text("value").notNull(), // JSON string
  expiresAt: timestamp("expires_at").notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
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
  // Supplier (TME) cost per unit captured AT SALE TIME, so realized-profit
  // reports don't drift when the live TME price later changes.
  supplierCostAtSale: decimal("supplier_cost_at_sale", { precision: 10, scale: 2 }),
  
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

export const insertSyncAuditSchema = createInsertSchema(syncAudit).omit({
  id: true,
  createdAt: true,
});

export const insertSyncQueueSchema = createInsertSchema(syncQueue).omit({
  id: true,
  createdAt: true,
  processedAt: true,
});

export const insertSyncJobSchema = createInsertSchema(syncJobs).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
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

export type SyncAudit = typeof syncAudit.$inferSelect;
export type InsertSyncAudit = z.infer<typeof insertSyncAuditSchema>;
export type SyncJob = typeof syncJobs.$inferSelect;
export type InsertSyncJob = z.infer<typeof insertSyncJobSchema>;
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

// ============================================
// MESSAGING SYSTEM
// ============================================

// Message Threads - Conversations with buyers
export const messageThreads = pgTable("message_threads", {
  id: serial("id").primaryKey(),
  
  // Marketplace context
  marketplace: text("marketplace").notNull().default("ebay"), // ebay, amazon
  marketplaceThreadId: text("marketplace_thread_id"), // eBay message ID for thread reference
  
  // Buyer info
  buyerUsername: text("buyer_username").notNull(),
  buyerEmail: text("buyer_email"),
  
  // Order context (optional - some messages may not be order-related)
  orderId: integer("order_id").references(() => orders.id),
  marketplaceOrderId: text("marketplace_order_id"), // eBay/Amazon order ID
  
  // Item context
  itemId: text("item_id"), // eBay listing ID
  itemTitle: text("item_title"),
  
  // Thread status
  status: text("status").notNull().default("open"), // open, closed, archived
  isRead: boolean("is_read").notNull().default(false),
  isStarred: boolean("is_starred").notNull().default(false),
  lastMessageAt: timestamp("last_message_at"),
  messageCount: integer("message_count").notNull().default(0),
  
  // Metadata
  subject: text("subject"),
  tags: text("tags").array(), // custom tags for organization
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Individual Messages within threads
export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  threadId: integer("thread_id").references(() => messageThreads.id).notNull(),
  
  // Message content
  direction: text("direction").notNull(), // inbound (from buyer), outbound (to buyer)
  subject: text("subject"),
  body: text("body").notNull(),
  bodyHtml: text("body_html"), // HTML version if available
  
  // Marketplace reference
  marketplaceMessageId: text("marketplace_message_id"), // eBay's message ID
  
  // Sender info
  senderUsername: text("sender_username").notNull(),
  senderEmail: text("sender_email"),
  
  // Status
  status: text("status").notNull().default("sent"), // draft, pending, sent, delivered, failed, read
  errorMessage: text("error_message"), // If sending failed
  
  // Auto-message reference
  templateId: integer("template_id").references(() => messageTemplates.id),
  autoMessageRuleId: integer("auto_message_rule_id"),
  
  // Metadata
  rawPayload: text("raw_payload"), // Original XML/JSON from eBay
  sentAt: timestamp("sent_at"),
  readAt: timestamp("read_at"),
  
  createdAt: timestamp("created_at").defaultNow(),
});

// Message Templates - Reusable message templates
export const messageTemplates = pgTable("message_templates", {
  id: serial("id").primaryKey(),
  
  name: text("name").notNull(), // Template name for quick selection
  description: text("description"),
  
  // Content
  subject: text("subject"),
  body: text("body").notNull(),
  
  // Template type
  category: text("category").notNull().default("general"), // general, thank_you, shipping, follow_up, return, custom
  
  // Placeholders available in this template
  // {{buyer_name}}, {{order_id}}, {{item_title}}, {{tracking_number}}, {{shop_name}}, etc.
  placeholders: text("placeholders").array(),
  
  // Usage stats
  usageCount: integer("usage_count").notNull().default(0),
  lastUsedAt: timestamp("last_used_at"),
  
  // Status
  isActive: boolean("is_active").notNull().default(true),
  isDefault: boolean("is_default").notNull().default(false), // Default for a category
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Auto Message Rules - Automated messaging triggers
export const autoMessageRules = pgTable("auto_message_rules", {
  id: serial("id").primaryKey(),
  
  name: text("name").notNull(),
  description: text("description"),
  
  // Trigger configuration
  triggerType: text("trigger_type").notNull(), // order_placed, order_packed, order_shipped, order_delivered, days_after_delivery
  triggerDelay: integer("trigger_delay").default(0), // Delay in minutes/hours before sending
  triggerDelayUnit: text("trigger_delay_unit").default("minutes"), // minutes, hours, days
  
  // Template to use
  templateId: integer("template_id").references(() => messageTemplates.id).notNull(),
  
  // Conditions
  marketplaces: text("marketplaces").array().default(["ebay"]), // Which marketplaces this applies to
  minOrderValue: decimal("min_order_value", { precision: 10, scale: 2 }), // Only trigger if order value >= this
  excludeCountries: text("exclude_countries").array(), // Don't send to these countries
  
  // Status
  isActive: boolean("is_active").notNull().default(true),
  
  // Stats
  sentCount: integer("sent_count").notNull().default(0),
  lastTriggeredAt: timestamp("last_triggered_at"),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Scheduled Messages - Queue for pending auto-messages
export const scheduledMessages = pgTable("scheduled_messages", {
  id: serial("id").primaryKey(),
  
  // References
  orderId: integer("order_id").references(() => orders.id),
  ruleId: integer("rule_id").references(() => autoMessageRules.id),
  templateId: integer("template_id").references(() => messageTemplates.id).notNull(),
  
  // Target
  buyerUsername: text("buyer_username").notNull(),
  itemId: text("item_id"),
  
  // Schedule
  scheduledFor: timestamp("scheduled_for").notNull(),
  
  // Status
  status: text("status").notNull().default("pending"), // pending, sent, cancelled, failed
  sentAt: timestamp("sent_at"),
  errorMessage: text("error_message"),
  messageId: integer("message_id").references(() => messages.id), // Reference to sent message
  
  createdAt: timestamp("created_at").defaultNow(),
});

// Insert schemas for messaging
export const insertMessageThreadSchema = createInsertSchema(messageThreads).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertMessageSchema = createInsertSchema(messages).omit({
  id: true,
  createdAt: true,
});

export const insertMessageTemplateSchema = createInsertSchema(messageTemplates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  usageCount: true,
  lastUsedAt: true,
});

export const insertAutoMessageRuleSchema = createInsertSchema(autoMessageRules).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  sentCount: true,
  lastTriggeredAt: true,
});

export const insertScheduledMessageSchema = createInsertSchema(scheduledMessages).omit({
  id: true,
  createdAt: true,
});

// Types for messaging
export type MessageThread = typeof messageThreads.$inferSelect;
export type InsertMessageThread = z.infer<typeof insertMessageThreadSchema>;
export type Message = typeof messages.$inferSelect;
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type MessageTemplate = typeof messageTemplates.$inferSelect;
export type InsertMessageTemplate = z.infer<typeof insertMessageTemplateSchema>;
export type AutoMessageRule = typeof autoMessageRules.$inferSelect;
export type InsertAutoMessageRule = z.infer<typeof insertAutoMessageRuleSchema>;
export type ScheduledMessage = typeof scheduledMessages.$inferSelect;
export type InsertScheduledMessage = z.infer<typeof insertScheduledMessageSchema>;

// Competitor repricing — SHADOW analytics only. Append-only snapshot of what
// the eBay Browse API returned for a SKU at a point in time. Never read by
// the sync/listing path; never modifies our prices. Querying "the current
// state" means "latest row per product_id".
export const competitorSnapshots = pgTable("competitor_snapshots", {
  id: serial("id").primaryKey(),
  productId: integer("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  sku: text("sku").notNull(),
  marketplace: text("marketplace").notNull().default("ebay"),
  // The query string actually sent to Browse (SKU; later could be EAN).
  searchQuery: text("search_query").notNull(),
  // Our sale price at the time of the check — frozen so historical analysis
  // doesn't shift under us when products.salePrice changes.
  ourPrice: decimal("our_price", { precision: 10, scale: 2 }),
  // Competitor stats over the result set we kept (typically top-10 cheapest).
  cheapestPrice: decimal("cheapest_price", { precision: 10, scale: 2 }),
  top3AvgPrice: decimal("top3_avg_price", { precision: 10, scale: 2 }),
  sampleCount: integer("sample_count").notNull().default(0),
  // Browse API's total active-listing count for the query — the market-size /
  // demand proxy (sampleCount is capped at the 10 we fetch; this is the full
  // count). Used by the Opportunity Finder's demand band.
  marketTotal: integer("market_total"),
  currency: text("currency").default("EUR"),
  // Computed at write time so the analytics UI doesn't have to recompute.
  // overpriced | underpriced | in_line | thin_market (1-2 samples) | no_data (0 samples)
  signal: text("signal").notNull().default("no_data"),
  // (ourPrice - top3AvgPrice) / top3AvgPrice as a percentage, signed.
  deltaPct: decimal("delta_pct", { precision: 6, scale: 2 }),
  // Shadow-only recommendation = max(supplierFloor, market * (1 - undercutPct)).
  // We don't have a per-SKU profit floor cheaply here, so this is purely the
  // "market - 2%" anchor; the UI compares it to ourPrice for the operator.
  recommendedPrice: decimal("recommended_price", { precision: 10, scale: 2 }),
  // Error from Browse API if the call failed for this SKU.
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCompetitorSnapshotSchema = createInsertSchema(competitorSnapshots).omit({
  id: true,
  createdAt: true,
});
export type CompetitorSnapshot = typeof competitorSnapshots.$inferSelect;
export type InsertCompetitorSnapshot = z.infer<typeof insertCompetitorSnapshotSchema>;

// Sold-through demand snapshots — parallel to competitor_snapshots, but the
// data source is eBay Marketplace Insights (item_sales/search), which
// returns actually-SOLD items in a recent window. This is the real demand
// signal; competitor_snapshots is the supply-side competition signal. Both
// are joined into the Opportunity Finder side-by-side.
export const demandSnapshots = pgTable("demand_snapshots", {
  id: serial("id").primaryKey(),
  productId: integer("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  sku: text("sku").notNull(),
  searchQuery: text("search_query").notNull(),
  windowDays: integer("window_days").notNull().default(30),
  // Total sold items eBay reports for the query in the window. The API may
  // return a higher value than the items we paged through (sample below).
  soldCount: integer("sold_count"),
  // Aggregates over the page of items we actually fetched.
  sampleCount: integer("sample_count").notNull().default(0),
  avgSoldPrice: decimal("avg_sold_price", { precision: 10, scale: 2 }),
  medianSoldPrice: decimal("median_sold_price", { precision: 10, scale: 2 }),
  lowSoldPrice: decimal("low_sold_price", { precision: 10, scale: 2 }),
  highSoldPrice: decimal("high_sold_price", { precision: 10, scale: 2 }),
  currency: text("currency").default("EUR"),
  errorMessage: text("error_message"),
  notApproved: boolean("not_approved").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertDemandSnapshotSchema = createInsertSchema(demandSnapshots).omit({
  id: true,
  createdAt: true,
});
export type DemandSnapshot = typeof demandSnapshots.$inferSelect;
export type InsertDemandSnapshot = z.infer<typeof insertDemandSnapshotSchema>;

export type OrderStatusType = typeof OrderStatus[keyof typeof OrderStatus];

// Marketplace Enum
export const Marketplace = {
  EBAY: 'ebay',
  AMAZON: 'amazon',
} as const;

export type MarketplaceType = typeof Marketplace[keyof typeof Marketplace];

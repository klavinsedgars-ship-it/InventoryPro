var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// shared/schema.ts
var schema_exports = {};
__export(schema_exports, {
  Marketplace: () => Marketplace,
  OrderStatus: () => OrderStatus,
  apiUsageTracking: () => apiUsageTracking,
  autoMessageRules: () => autoMessageRules,
  bulkListingJobs: () => bulkListingJobs,
  categories: () => categories,
  ebayFulfillmentPolicies: () => ebayFulfillmentPolicies,
  ebayPaymentPolicies: () => ebayPaymentPolicies,
  ebayReturnPolicies: () => ebayReturnPolicies,
  insertApiUsageTrackingSchema: () => insertApiUsageTrackingSchema,
  insertAutoMessageRuleSchema: () => insertAutoMessageRuleSchema,
  insertBulkListingJobSchema: () => insertBulkListingJobSchema,
  insertCategorySchema: () => insertCategorySchema,
  insertEbayFulfillmentPolicySchema: () => insertEbayFulfillmentPolicySchema,
  insertEbayPaymentPolicySchema: () => insertEbayPaymentPolicySchema,
  insertEbayReturnPolicySchema: () => insertEbayReturnPolicySchema,
  insertMarketplaceSettingsSchema: () => insertMarketplaceSettingsSchema,
  insertMessageSchema: () => insertMessageSchema,
  insertMessageTemplateSchema: () => insertMessageTemplateSchema,
  insertMessageThreadSchema: () => insertMessageThreadSchema,
  insertOrderEventSchema: () => insertOrderEventSchema,
  insertOrderFeeSchema: () => insertOrderFeeSchema,
  insertOrderItemSchema: () => insertOrderItemSchema,
  insertOrderSchema: () => insertOrderSchema,
  insertPricingTierSchema: () => insertPricingTierSchema,
  insertProductSchema: () => insertProductSchema,
  insertScheduledMessageSchema: () => insertScheduledMessageSchema,
  insertShippingPolicySchema: () => insertShippingPolicySchema,
  insertSyncLogSchema: () => insertSyncLogSchema,
  insertSyncQueueSchema: () => insertSyncQueueSchema,
  insertTmeProductCacheSchema: () => insertTmeProductCacheSchema,
  insertUserSchema: () => insertUserSchema,
  loginSchema: () => loginSchema,
  marketplaceSettings: () => marketplaceSettings,
  messageTemplates: () => messageTemplates,
  messageThreads: () => messageThreads,
  messages: () => messages,
  orderEvents: () => orderEvents,
  orderFees: () => orderFees,
  orderItems: () => orderItems,
  orders: () => orders,
  pricingTiers: () => pricingTiers,
  products: () => products,
  scheduledMessages: () => scheduledMessages,
  shippingPolicies: () => shippingPolicies,
  syncLogs: () => syncLogs,
  syncQueue: () => syncQueue,
  tmeProductCache: () => tmeProductCache,
  users: () => users
});
import { pgTable, text, serial, integer, boolean, decimal, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
var users, products, categories, marketplaceSettings, syncLogs, syncQueue, pricingTiers, shippingPolicies, apiUsageTracking, bulkListingJobs, tmeProductCache, ebayPaymentPolicies, ebayFulfillmentPolicies, ebayReturnPolicies, orders, orderItems, orderFees, orderEvents, insertUserSchema, insertProductSchema, insertCategorySchema, insertMarketplaceSettingsSchema, insertSyncLogSchema, insertSyncQueueSchema, insertPricingTierSchema, insertShippingPolicySchema, insertApiUsageTrackingSchema, insertTmeProductCacheSchema, insertBulkListingJobSchema, insertEbayPaymentPolicySchema, insertEbayFulfillmentPolicySchema, insertEbayReturnPolicySchema, insertOrderSchema, insertOrderItemSchema, insertOrderFeeSchema, insertOrderEventSchema, loginSchema, OrderStatus, messageThreads, messages, messageTemplates, autoMessageRules, scheduledMessages, insertMessageThreadSchema, insertMessageSchema, insertMessageTemplateSchema, insertAutoMessageRuleSchema, insertScheduledMessageSchema, Marketplace;
var init_schema = __esm({
  "shared/schema.ts"() {
    "use strict";
    users = pgTable("users", {
      id: serial("id").primaryKey(),
      username: text("username").notNull().unique(),
      password: text("password").notNull(),
      email: text("email").notNull().unique(),
      role: text("role").notNull().default("user"),
      // admin or user
      createdAt: timestamp("created_at").defaultNow()
    });
    products = pgTable("products", {
      id: serial("id").primaryKey(),
      name: text("name").notNull(),
      sku: text("sku").notNull().unique(),
      ean: text("ean"),
      category: text("category").notNull(),
      description: text("description"),
      supplierPrice: decimal("supplier_price", { precision: 10, scale: 2 }).notNull(),
      salePrice: decimal("sale_price", { precision: 10, scale: 2 }).notNull(),
      calculatedPrice: decimal("calculated_price", { precision: 10, scale: 2 }),
      // auto-calculated price
      marginTier: text("margin_tier"),
      // tier label (e.g., "Ultra High", "Medium")
      marginPercentage: decimal("margin_percentage", { precision: 5, scale: 2 }),
      // applied margin %
      priceUpdatedAt: timestamp("price_updated_at"),
      // last price calculation
      useCalculatedPrice: boolean("use_calculated_price").default(true),
      // use dynamic vs manual pricing
      stock: integer("stock").notNull().default(0),
      // Real TME stock
      moq: integer("moq").notNull().default(1),
      // Minimum order quantity from TME
      multiples: integer("multiples").notNull().default(1),
      // Order multiples from TME
      ebayStockLimit: integer("ebay_stock_limit").notNull().default(2),
      // Max stock to show on eBay
      useStockLimit: boolean("use_stock_limit").default(true),
      // Whether to apply eBay stock limits
      weight: decimal("weight", { precision: 8, scale: 2 }),
      // in grams
      margin: decimal("margin", { precision: 5, scale: 2 }),
      // percentage (legacy field)
      status: text("status").notNull().default("active"),
      // active, inactive, out_of_stock
      listedOnEbay: boolean("listed_on_ebay").default(false),
      listedOnAmazon: boolean("listed_on_amazon").default(false),
      excludeFromListing: boolean("exclude_from_listing").default(false),
      ebayItemId: text("ebay_item_id"),
      amazonAsin: text("amazon_asin"),
      tmeProductId: text("tme_product_id"),
      tmeCategoryId: text("tme_category_id"),
      // TME category ID for synced products
      supplier: text("supplier").default("manual"),
      // manual, TME, etc.
      supplierProductId: text("supplier_product_id"),
      imageUrl: text("image_url"),
      dataSheetUrl: text("datasheet_url"),
      productUrl: text("product_url"),
      createdAt: timestamp("created_at").defaultNow(),
      updatedAt: timestamp("updated_at").defaultNow(),
      lastSyncedAt: timestamp("last_synced_at")
      // When product was last synced from TME
    });
    categories = pgTable("categories", {
      id: serial("id").primaryKey(),
      name: text("name").notNull().unique(),
      ebayMapping: text("ebay_mapping"),
      amazonMapping: text("amazon_mapping")
    });
    marketplaceSettings = pgTable("marketplace_settings", {
      id: serial("id").primaryKey(),
      marketplace: text("marketplace").notNull(),
      // ebay or amazon
      setting: text("setting").notNull(),
      value: text("value").notNull()
    });
    syncLogs = pgTable("sync_logs", {
      id: serial("id").primaryKey(),
      source: text("source").notNull(),
      // tme, ebay, amazon
      operation: text("operation").default("sync"),
      // sync_start, sync_complete, price_update, etc.
      status: text("status").notNull(),
      // success, error, pending, in_progress
      message: text("message"),
      details: text("details"),
      // JSON string for additional data
      syncedAt: timestamp("synced_at").defaultNow()
    });
    syncQueue = pgTable("sync_queue", {
      id: serial("id").primaryKey(),
      productId: integer("product_id").references(() => products.id).notNull(),
      operation: text("operation").notNull(),
      // 'list', 'update_price', 'update_stock', 'unlist'
      priority: integer("priority").notNull().default(3),
      // 1=critical, 2=high, 3=medium, 4=low
      status: text("status").notNull().default("pending"),
      // 'pending', 'processing', 'completed', 'failed'
      retryCount: integer("retry_count").notNull().default(0),
      maxRetries: integer("max_retries").notNull().default(3),
      marketplace: text("marketplace").notNull().default("ebay"),
      // ebay, amazon
      scheduledFor: timestamp("scheduled_for").defaultNow(),
      errorMessage: text("error_message"),
      createdAt: timestamp("created_at").defaultNow(),
      processedAt: timestamp("processed_at")
    });
    pricingTiers = pgTable("pricing_tiers", {
      id: serial("id").primaryKey(),
      min: decimal("min", { precision: 10, scale: 2 }).notNull(),
      max: decimal("max", { precision: 10, scale: 2 }).notNull(),
      multiplier: decimal("multiplier", { precision: 5, scale: 2 }).notNull(),
      label: text("label").notNull(),
      marginPercentage: decimal("margin_percentage", { precision: 5, scale: 2 }).notNull(),
      createdAt: timestamp("created_at").defaultNow(),
      updatedAt: timestamp("updated_at").defaultNow()
    });
    shippingPolicies = pgTable("shipping_policies", {
      id: text("id").primaryKey(),
      // e.g., "policy_light", "policy_heavy"
      name: text("name").notNull(),
      description: text("description").notNull(),
      minWeight: integer("min_weight").notNull(),
      // in grams
      maxWeight: integer("max_weight").notNull(),
      // in grams
      type: text("type").default("standard"),
      // standard, express, overnight
      createdAt: timestamp("created_at").defaultNow(),
      updatedAt: timestamp("updated_at").defaultNow()
    });
    apiUsageTracking = pgTable("api_usage_tracking", {
      id: serial("id").primaryKey(),
      provider: text("provider").notNull().default("tme"),
      // tme, ebay, amazon
      callsToday: integer("calls_today").notNull().default(0),
      dailyLimit: integer("daily_limit").notNull().default(1e4),
      lastResetAt: timestamp("last_reset_at").defaultNow(),
      updatedAt: timestamp("updated_at").defaultNow()
    });
    bulkListingJobs = pgTable("bulk_listing_jobs", {
      id: text("id").primaryKey(),
      // UUID for job tracking
      status: text("status").notNull().default("pending"),
      // pending, processing, completed, failed
      total: integer("total").notNull().default(0),
      processed: integer("processed").notNull().default(0),
      succeeded: integer("succeeded").notNull().default(0),
      failed: integer("failed").notNull().default(0),
      currentProduct: text("current_product"),
      // Name of product currently being processed
      lastMessage: text("last_message"),
      errorDetails: text("error_details"),
      // JSON array of failed items with reasons
      createdAt: timestamp("created_at").defaultNow(),
      completedAt: timestamp("completed_at")
    });
    tmeProductCache = pgTable("tme_product_cache", {
      id: serial("id").primaryKey(),
      symbol: text("symbol").notNull().unique(),
      // TME product SKU/Symbol
      productData: text("product_data").notNull(),
      // JSON string of product info
      priceData: text("price_data"),
      // JSON string of pricing info
      stockData: text("stock_data"),
      // JSON string of stock info
      categoryId: integer("category_id"),
      fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
      // When data was fetched
      expiresAt: timestamp("expires_at").notNull()
      // When cache should be refreshed (24 hours)
    });
    ebayPaymentPolicies = pgTable("ebay_payment_policies", {
      id: serial("id").primaryKey(),
      policyId: text("policy_id").notNull().unique(),
      // eBay's policy ID
      name: text("name").notNull(),
      description: text("description"),
      marketplaceId: text("marketplace_id").notNull().default("EBAY_GB"),
      // EBAY_US, EBAY_GB, etc.
      categoryTypes: text("category_types"),
      // JSON array of category types
      paymentMethods: text("payment_methods"),
      // JSON array of payment methods
      immediatePay: boolean("immediate_pay").default(true),
      isDefault: boolean("is_default").default(false),
      syncedFromEbay: boolean("synced_from_ebay").default(false),
      // true if fetched from eBay
      createdAt: timestamp("created_at").defaultNow(),
      updatedAt: timestamp("updated_at").defaultNow()
    });
    ebayFulfillmentPolicies = pgTable("ebay_fulfillment_policies", {
      id: serial("id").primaryKey(),
      policyId: text("policy_id").notNull().unique(),
      // eBay's policy ID
      name: text("name").notNull(),
      description: text("description"),
      marketplaceId: text("marketplace_id").notNull().default("EBAY_GB"),
      categoryTypes: text("category_types"),
      // JSON array
      handlingTime: integer("handling_time").notNull().default(1),
      // Days to dispatch
      shippingOptions: text("shipping_options"),
      // JSON array of shipping options
      shipToLocations: text("ship_to_locations"),
      // JSON - regions included/excluded
      globalShipping: boolean("global_shipping").default(false),
      pickupDropOff: boolean("pickup_drop_off").default(false),
      freightShipping: boolean("freight_shipping").default(false),
      isDefault: boolean("is_default").default(false),
      syncedFromEbay: boolean("synced_from_ebay").default(false),
      createdAt: timestamp("created_at").defaultNow(),
      updatedAt: timestamp("updated_at").defaultNow()
    });
    ebayReturnPolicies = pgTable("ebay_return_policies", {
      id: serial("id").primaryKey(),
      policyId: text("policy_id").notNull().unique(),
      // eBay's policy ID
      name: text("name").notNull(),
      description: text("description"),
      marketplaceId: text("marketplace_id").notNull().default("EBAY_GB"),
      categoryTypes: text("category_types"),
      // JSON array
      returnsAccepted: boolean("returns_accepted").notNull().default(true),
      returnPeriod: integer("return_period").default(30),
      // Days
      refundMethod: text("refund_method").default("MONEY_BACK"),
      // MONEY_BACK, EXCHANGE
      returnShippingCostPayer: text("return_shipping_cost_payer").default("BUYER"),
      // BUYER, SELLER
      restockingFeePercentage: text("restocking_fee_percentage"),
      // Optional restocking fee
      isDefault: boolean("is_default").default(false),
      syncedFromEbay: boolean("synced_from_ebay").default(false),
      createdAt: timestamp("created_at").defaultNow(),
      updatedAt: timestamp("updated_at").defaultNow()
    });
    orders = pgTable("orders", {
      id: serial("id").primaryKey(),
      marketplace: text("marketplace").notNull(),
      // ebay, amazon
      marketplaceOrderId: text("marketplace_order_id").notNull(),
      // eBay order ID, Amazon order ID
      status: text("status").notNull().default("new"),
      // new, packed, shipped, delivered, return_requested, returned, completed, cancelled, on_hold
      // Buyer Information
      buyerUsername: text("buyer_username").notNull(),
      // eBay nickname or Amazon customer name
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
      marketplaceFee: decimal("marketplace_fee", { precision: 10, scale: 2 }),
      // eBay/Amazon fee
      paymentProcessingFee: decimal("payment_processing_fee", { precision: 10, scale: 2 }),
      // Shipping Details
      shippingService: text("shipping_service"),
      // e.g., "Royal Mail 2nd Class"
      shippingCarrier: text("shipping_carrier"),
      // e.g., "Royal Mail"
      trackingNumber: text("tracking_number"),
      trackingUrl: text("tracking_url"),
      // Fulfillment
      paidAt: timestamp("paid_at"),
      shippedAt: timestamp("shipped_at"),
      deliveredAt: timestamp("delivered_at"),
      expectedDeliveryStart: timestamp("expected_delivery_start"),
      expectedDeliveryEnd: timestamp("expected_delivery_end"),
      // Logistics Integration (for Latvian Post, etc.)
      logisticsCarrier: text("logistics_carrier"),
      // pasts_lv, dhl, ups, etc.
      logisticsLabelUrl: text("logistics_label_url"),
      logisticsLabelData: text("logistics_label_data"),
      // JSON for carrier-specific data
      // Notes and Metadata
      buyerNote: text("buyer_note"),
      // Message from buyer
      sellerNote: text("seller_note"),
      // Internal seller notes
      rawOrderData: text("raw_order_data"),
      // Full marketplace response JSON
      // Timestamps
      orderDate: timestamp("order_date").notNull(),
      // When order was placed
      createdAt: timestamp("created_at").defaultNow(),
      updatedAt: timestamp("updated_at").defaultNow(),
      lastSyncedAt: timestamp("last_synced_at")
    });
    orderItems = pgTable("order_items", {
      id: serial("id").primaryKey(),
      orderId: integer("order_id").references(() => orders.id).notNull(),
      // Product Reference
      productId: integer("product_id").references(() => products.id),
      // Can be null for unmapped products
      sku: text("sku").notNull(),
      tmeProductId: text("tme_product_id"),
      // TME SKU for direct link
      // Item Details
      title: text("title").notNull(),
      // Product title as shown on marketplace
      quantity: integer("quantity").notNull().default(1),
      unitPrice: decimal("unit_price", { precision: 10, scale: 2 }).notNull(),
      totalPrice: decimal("total_price", { precision: 10, scale: 2 }).notNull(),
      // Marketplace-specific
      marketplaceItemId: text("marketplace_item_id"),
      // eBay listing ID, Amazon ASIN
      imageUrl: text("image_url"),
      createdAt: timestamp("created_at").defaultNow()
    });
    orderFees = pgTable("order_fees", {
      id: serial("id").primaryKey(),
      orderId: integer("order_id").references(() => orders.id).notNull(),
      feeType: text("fee_type").notNull(),
      // ebay_final_value, ebay_international, shipping, payment_processing, promoted_listing, refund
      description: text("description"),
      amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
      currency: text("currency").notNull().default("GBP"),
      createdAt: timestamp("created_at").defaultNow()
    });
    orderEvents = pgTable("order_events", {
      id: serial("id").primaryKey(),
      orderId: integer("order_id").references(() => orders.id).notNull(),
      eventType: text("event_type").notNull(),
      // status_change, note_added, tracking_added, label_printed, synced, refund_initiated
      fromStatus: text("from_status"),
      // Previous status (for status_change events)
      toStatus: text("to_status"),
      // New status (for status_change events)
      note: text("note"),
      userId: integer("user_id").references(() => users.id),
      // Who performed the action
      createdAt: timestamp("created_at").defaultNow()
    });
    insertUserSchema = createInsertSchema(users).omit({
      id: true,
      createdAt: true
    });
    insertProductSchema = createInsertSchema(products).omit({
      id: true,
      createdAt: true,
      updatedAt: true
    });
    insertCategorySchema = createInsertSchema(categories).omit({
      id: true
    });
    insertMarketplaceSettingsSchema = createInsertSchema(marketplaceSettings).omit({
      id: true
    });
    insertSyncLogSchema = createInsertSchema(syncLogs).omit({
      id: true,
      syncedAt: true
    });
    insertSyncQueueSchema = createInsertSchema(syncQueue).omit({
      id: true,
      createdAt: true,
      processedAt: true
    });
    insertPricingTierSchema = createInsertSchema(pricingTiers).omit({
      id: true,
      createdAt: true,
      updatedAt: true
    });
    insertShippingPolicySchema = createInsertSchema(shippingPolicies).omit({
      createdAt: true,
      updatedAt: true
    });
    insertApiUsageTrackingSchema = createInsertSchema(apiUsageTracking).omit({
      id: true,
      lastResetAt: true,
      updatedAt: true
    });
    insertTmeProductCacheSchema = createInsertSchema(tmeProductCache).omit({
      id: true,
      fetchedAt: true
    });
    insertBulkListingJobSchema = createInsertSchema(bulkListingJobs).omit({
      createdAt: true
    });
    insertEbayPaymentPolicySchema = createInsertSchema(ebayPaymentPolicies).omit({
      id: true,
      createdAt: true,
      updatedAt: true
    });
    insertEbayFulfillmentPolicySchema = createInsertSchema(ebayFulfillmentPolicies).omit({
      id: true,
      createdAt: true,
      updatedAt: true
    });
    insertEbayReturnPolicySchema = createInsertSchema(ebayReturnPolicies).omit({
      id: true,
      createdAt: true,
      updatedAt: true
    });
    insertOrderSchema = createInsertSchema(orders).omit({
      id: true,
      createdAt: true,
      updatedAt: true,
      lastSyncedAt: true
    });
    insertOrderItemSchema = createInsertSchema(orderItems).omit({
      id: true,
      createdAt: true
    });
    insertOrderFeeSchema = createInsertSchema(orderFees).omit({
      id: true,
      createdAt: true
    });
    insertOrderEventSchema = createInsertSchema(orderEvents).omit({
      id: true,
      createdAt: true
    });
    loginSchema = z.object({
      username: z.string().min(1, "Username is required"),
      password: z.string().min(1, "Password is required")
    });
    OrderStatus = {
      NEW: "new",
      PACKED: "packed",
      SHIPPED: "shipped",
      DELIVERED: "delivered",
      RETURN_REQUESTED: "return_requested",
      RETURNED: "returned",
      COMPLETED: "completed",
      CANCELLED: "cancelled",
      ON_HOLD: "on_hold"
    };
    messageThreads = pgTable("message_threads", {
      id: serial("id").primaryKey(),
      // Marketplace context
      marketplace: text("marketplace").notNull().default("ebay"),
      // ebay, amazon
      marketplaceThreadId: text("marketplace_thread_id"),
      // eBay message ID for thread reference
      // Buyer info
      buyerUsername: text("buyer_username").notNull(),
      buyerEmail: text("buyer_email"),
      // Order context (optional - some messages may not be order-related)
      orderId: integer("order_id").references(() => orders.id),
      marketplaceOrderId: text("marketplace_order_id"),
      // eBay/Amazon order ID
      // Item context
      itemId: text("item_id"),
      // eBay listing ID
      itemTitle: text("item_title"),
      // Thread status
      status: text("status").notNull().default("open"),
      // open, closed, archived
      isRead: boolean("is_read").notNull().default(false),
      isStarred: boolean("is_starred").notNull().default(false),
      lastMessageAt: timestamp("last_message_at"),
      messageCount: integer("message_count").notNull().default(0),
      // Metadata
      subject: text("subject"),
      tags: text("tags").array(),
      // custom tags for organization
      createdAt: timestamp("created_at").defaultNow(),
      updatedAt: timestamp("updated_at").defaultNow()
    });
    messages = pgTable("messages", {
      id: serial("id").primaryKey(),
      threadId: integer("thread_id").references(() => messageThreads.id).notNull(),
      // Message content
      direction: text("direction").notNull(),
      // inbound (from buyer), outbound (to buyer)
      subject: text("subject"),
      body: text("body").notNull(),
      bodyHtml: text("body_html"),
      // HTML version if available
      // Marketplace reference
      marketplaceMessageId: text("marketplace_message_id"),
      // eBay's message ID
      // Sender info
      senderUsername: text("sender_username").notNull(),
      senderEmail: text("sender_email"),
      // Status
      status: text("status").notNull().default("sent"),
      // draft, pending, sent, delivered, failed, read
      errorMessage: text("error_message"),
      // If sending failed
      // Auto-message reference
      templateId: integer("template_id").references(() => messageTemplates.id),
      autoMessageRuleId: integer("auto_message_rule_id"),
      // Metadata
      rawPayload: text("raw_payload"),
      // Original XML/JSON from eBay
      sentAt: timestamp("sent_at"),
      readAt: timestamp("read_at"),
      createdAt: timestamp("created_at").defaultNow()
    });
    messageTemplates = pgTable("message_templates", {
      id: serial("id").primaryKey(),
      name: text("name").notNull(),
      // Template name for quick selection
      description: text("description"),
      // Content
      subject: text("subject"),
      body: text("body").notNull(),
      // Template type
      category: text("category").notNull().default("general"),
      // general, thank_you, shipping, follow_up, return, custom
      // Placeholders available in this template
      // {{buyer_name}}, {{order_id}}, {{item_title}}, {{tracking_number}}, {{shop_name}}, etc.
      placeholders: text("placeholders").array(),
      // Usage stats
      usageCount: integer("usage_count").notNull().default(0),
      lastUsedAt: timestamp("last_used_at"),
      // Status
      isActive: boolean("is_active").notNull().default(true),
      isDefault: boolean("is_default").notNull().default(false),
      // Default for a category
      createdAt: timestamp("created_at").defaultNow(),
      updatedAt: timestamp("updated_at").defaultNow()
    });
    autoMessageRules = pgTable("auto_message_rules", {
      id: serial("id").primaryKey(),
      name: text("name").notNull(),
      description: text("description"),
      // Trigger configuration
      triggerType: text("trigger_type").notNull(),
      // order_placed, order_packed, order_shipped, order_delivered, days_after_delivery
      triggerDelay: integer("trigger_delay").default(0),
      // Delay in minutes/hours before sending
      triggerDelayUnit: text("trigger_delay_unit").default("minutes"),
      // minutes, hours, days
      // Template to use
      templateId: integer("template_id").references(() => messageTemplates.id).notNull(),
      // Conditions
      marketplaces: text("marketplaces").array().default(["ebay"]),
      // Which marketplaces this applies to
      minOrderValue: decimal("min_order_value", { precision: 10, scale: 2 }),
      // Only trigger if order value >= this
      excludeCountries: text("exclude_countries").array(),
      // Don't send to these countries
      // Status
      isActive: boolean("is_active").notNull().default(true),
      // Stats
      sentCount: integer("sent_count").notNull().default(0),
      lastTriggeredAt: timestamp("last_triggered_at"),
      createdAt: timestamp("created_at").defaultNow(),
      updatedAt: timestamp("updated_at").defaultNow()
    });
    scheduledMessages = pgTable("scheduled_messages", {
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
      status: text("status").notNull().default("pending"),
      // pending, sent, cancelled, failed
      sentAt: timestamp("sent_at"),
      errorMessage: text("error_message"),
      messageId: integer("message_id").references(() => messages.id),
      // Reference to sent message
      createdAt: timestamp("created_at").defaultNow()
    });
    insertMessageThreadSchema = createInsertSchema(messageThreads).omit({
      id: true,
      createdAt: true,
      updatedAt: true
    });
    insertMessageSchema = createInsertSchema(messages).omit({
      id: true,
      createdAt: true
    });
    insertMessageTemplateSchema = createInsertSchema(messageTemplates).omit({
      id: true,
      createdAt: true,
      updatedAt: true,
      usageCount: true,
      lastUsedAt: true
    });
    insertAutoMessageRuleSchema = createInsertSchema(autoMessageRules).omit({
      id: true,
      createdAt: true,
      updatedAt: true,
      sentCount: true,
      lastTriggeredAt: true
    });
    insertScheduledMessageSchema = createInsertSchema(scheduledMessages).omit({
      id: true,
      createdAt: true
    });
    Marketplace = {
      EBAY: "ebay",
      AMAZON: "amazon"
    };
  }
});

// server/db.ts
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
var connectionString, pool, db;
var init_db = __esm({
  "server/db.ts"() {
    "use strict";
    init_schema();
    neonConfig.webSocketConstructor = ws;
    connectionString = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL || process.env.POSTGRES_URL;
    if (!connectionString) {
      throw new Error(
        "DATABASE_URL (or NEON_DATABASE_URL / POSTGRES_URL) must be set. Did you forget to provision a database?"
      );
    }
    pool = new Pool({ connectionString });
    db = drizzle({ client: pool, schema: schema_exports });
  }
});

// server/storage.ts
import { eq, and, gte, lte, desc, asc, count, or, ilike } from "drizzle-orm";
import bcrypt from "bcryptjs";
var DatabaseStorage, storage;
var init_storage = __esm({
  "server/storage.ts"() {
    "use strict";
    init_schema();
    init_db();
    DatabaseStorage = class {
      constructor() {
        this.initializeDatabase();
      }
      async initializeDatabase() {
        try {
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
          const existingCategories = await this.getCategories();
          if (existingCategories.length === 0) {
            await this.createCategory({ name: "Electronics", ebayMapping: "Electronics", amazonMapping: "Electronics" });
            await this.createCategory({ name: "Accessories", ebayMapping: "Accessories", amazonMapping: "Accessories" });
            await this.createCategory({ name: "Gaming", ebayMapping: "Gaming", amazonMapping: "Gaming" });
            await this.createCategory({ name: "Home & Garden", ebayMapping: "Home & Garden", amazonMapping: "Home & Garden" });
          }
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
      async getUser(id) {
        const [user] = await db.select().from(users).where(eq(users.id, id));
        return user || void 0;
      }
      async getUserByUsername(username) {
        const [user] = await db.select().from(users).where(eq(users.username, username));
        return user || void 0;
      }
      async getUserByEmail(email) {
        const [user] = await db.select().from(users).where(eq(users.email, email));
        return user || void 0;
      }
      async createUser(insertUser) {
        const [user] = await db.insert(users).values(insertUser).returning();
        return user;
      }
      // Product methods
      async getProducts() {
        return await db.select().from(products).orderBy(desc(products.createdAt));
      }
      async getProduct(id) {
        const [product] = await db.select().from(products).where(eq(products.id, id));
        return product || void 0;
      }
      async getProductBySku(sku) {
        const [product] = await db.select().from(products).where(eq(products.sku, sku));
        return product || void 0;
      }
      async createProduct(insertProduct) {
        const [product] = await db.insert(products).values(insertProduct).returning();
        return product;
      }
      async updateProduct(id, updateData) {
        const [updated] = await db.update(products).set({ ...updateData, updatedAt: /* @__PURE__ */ new Date() }).where(eq(products.id, id)).returning();
        return updated || void 0;
      }
      async deleteProduct(id) {
        const result = await db.delete(products).where(eq(products.id, id));
        return (result.rowCount ?? 0) > 0;
      }
      async deleteAllProducts() {
        const result = await db.delete(products);
        return result.rowCount ?? 0;
      }
      async getProductsByCategory(category) {
        return await db.select().from(products).where(eq(products.category, category));
      }
      async getProductsWithFilters(filters) {
        const conditions = [];
        if (filters.category) conditions.push(eq(products.category, filters.category));
        if (filters.status) conditions.push(eq(products.status, filters.status));
        if (filters.listedOnEbay !== void 0) conditions.push(eq(products.listedOnEbay, filters.listedOnEbay));
        if (filters.listedOnAmazon !== void 0) conditions.push(eq(products.listedOnAmazon, filters.listedOnAmazon));
        if (filters.minStock !== void 0) conditions.push(gte(products.stock, filters.minStock));
        if (filters.maxStock !== void 0) conditions.push(lte(products.stock, filters.maxStock));
        if (conditions.length > 0) {
          return await db.select().from(products).where(and(...conditions)).orderBy(desc(products.createdAt));
        }
        return await db.select().from(products).orderBy(desc(products.createdAt));
      }
      // Category methods
      async getCategories() {
        return await db.select().from(categories);
      }
      async createCategory(insertCategory) {
        const [category] = await db.insert(categories).values(insertCategory).returning();
        return category;
      }
      // Marketplace settings methods
      async getMarketplaceSettings(marketplace) {
        return await db.select().from(marketplaceSettings).where(eq(marketplaceSettings.marketplace, marketplace));
      }
      async setMarketplaceSetting(insertSetting) {
        const [setting] = await db.insert(marketplaceSettings).values(insertSetting).returning();
        return setting;
      }
      // Sync log methods
      async getSyncLogs(limit = 50) {
        return await db.select().from(syncLogs).orderBy(desc(syncLogs.syncedAt)).limit(limit);
      }
      async createSyncLog(insertLog) {
        const [log] = await db.insert(syncLogs).values(insertLog).returning();
        return log;
      }
      // Dashboard metrics
      async getDashboardMetrics() {
        const allProducts = await db.select().from(products);
        const totalProducts = allProducts.length;
        const ebayListings = allProducts.filter((p) => p.listedOnEbay).length;
        const amazonListings = allProducts.filter((p) => p.listedOnAmazon).length;
        const outOfStock = allProducts.filter((p) => p.stock === 0).length;
        const totalRevenue = allProducts.reduce((sum, product) => {
          const price = parseFloat(product.salePrice) || 0;
          return sum + price * product.stock;
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
      async createSyncQueueItem(item) {
        const [result] = await db.insert(syncQueue).values(item).returning();
        return result;
      }
      async createBulkSyncQueueItems(items) {
        if (items.length === 0) return;
        await db.insert(syncQueue).values(items);
      }
      async getPendingSyncQueueItems(limit = 100) {
        return await db.select().from(syncQueue).where(eq(syncQueue.status, "pending")).orderBy(asc(syncQueue.priority), asc(syncQueue.createdAt)).limit(limit);
      }
      async updateSyncQueueItem(id, updates) {
        await db.update(syncQueue).set(updates).where(eq(syncQueue.id, id));
      }
      async getSyncQueueCount(status) {
        const conditions = status ? [eq(syncQueue.status, status)] : [];
        const [result] = await db.select({ count: count() }).from(syncQueue).where(and(...conditions));
        return result.count;
      }
      async getSyncQueueStats() {
        const [statusCounts, priorityCounts] = await Promise.all([
          db.select({
            status: syncQueue.status,
            count: count()
          }).from(syncQueue).groupBy(syncQueue.status),
          db.select({
            priority: syncQueue.priority,
            count: count()
          }).from(syncQueue).where(eq(syncQueue.status, "pending")).groupBy(syncQueue.priority)
        ]);
        const stats = {
          pending: 0,
          processing: 0,
          completed: 0,
          failed: 0,
          byPriority: {}
        };
        statusCounts.forEach((row) => {
          if (row.status === "pending") stats.pending = row.count;
          else if (row.status === "processing") stats.processing = row.count;
          else if (row.status === "completed") stats.completed = row.count;
          else if (row.status === "failed") stats.failed = row.count;
        });
        priorityCounts.forEach((row) => {
          stats.byPriority[String(row.priority)] = row.count;
        });
        return stats;
      }
      // Pricing Tier methods
      async getPricingTiers() {
        const result = await db.select().from(pricingTiers).orderBy(asc(pricingTiers.min));
        return result;
      }
      async createPricingTier(tier) {
        const result = await db.insert(pricingTiers).values(tier).returning();
        return result[0];
      }
      async updatePricingTier(id, tier) {
        const result = await db.update(pricingTiers).set({ ...tier, updatedAt: /* @__PURE__ */ new Date() }).where(eq(pricingTiers.id, id)).returning();
        return result[0];
      }
      async deletePricingTier(id) {
        const result = await db.delete(pricingTiers).where(eq(pricingTiers.id, id));
        return (result.rowCount ?? 0) > 0;
      }
      // Shipping Policy methods
      async getShippingPolicies() {
        const result = await db.select().from(shippingPolicies).orderBy(asc(shippingPolicies.minWeight));
        return result;
      }
      async createShippingPolicy(policy) {
        const result = await db.insert(shippingPolicies).values(policy).returning();
        return result[0];
      }
      async updateShippingPolicy(id, policy) {
        const result = await db.update(shippingPolicies).set({ ...policy, updatedAt: /* @__PURE__ */ new Date() }).where(eq(shippingPolicies.id, id)).returning();
        return result[0];
      }
      async deleteShippingPolicy(id) {
        const result = await db.delete(shippingPolicies).where(eq(shippingPolicies.id, id));
        return (result.rowCount ?? 0) > 0;
      }
      // API Usage Tracking methods
      async getApiUsage(provider = "tme") {
        const result = await db.select().from(apiUsageTracking).where(eq(apiUsageTracking.provider, provider)).limit(1);
        return result[0];
      }
      async trackApiCall(provider) {
        const existing = await this.getApiUsage(provider);
        if (existing) {
          const lastReset = new Date(existing.lastResetAt || /* @__PURE__ */ new Date());
          const now = /* @__PURE__ */ new Date();
          const isNewDay = lastReset.toDateString() !== now.toDateString();
          if (isNewDay) {
            await db.update(apiUsageTracking).set({ callsToday: 1, lastResetAt: now, updatedAt: now }).where(eq(apiUsageTracking.provider, provider));
          } else {
            await db.update(apiUsageTracking).set({ callsToday: existing.callsToday + 1, updatedAt: now }).where(eq(apiUsageTracking.provider, provider));
          }
        } else {
          await db.insert(apiUsageTracking).values({
            provider,
            callsToday: 1,
            dailyLimit: 1e4,
            lastResetAt: /* @__PURE__ */ new Date(),
            updatedAt: /* @__PURE__ */ new Date()
          });
        }
      }
      async resetApiUsageIfNewDay(provider) {
        const existing = await this.getApiUsage(provider);
        if (existing) {
          const lastReset = new Date(existing.lastResetAt || /* @__PURE__ */ new Date());
          const now = /* @__PURE__ */ new Date();
          if (lastReset.toDateString() !== now.toDateString()) {
            await db.update(apiUsageTracking).set({ callsToday: 0, lastResetAt: now, updatedAt: now }).where(eq(apiUsageTracking.provider, provider));
          }
        }
      }
      // TME Product Cache methods - PostgreSQL-based caching for 150k+ products
      async getTmeCachedProduct(symbol) {
        const now = /* @__PURE__ */ new Date();
        const result = await db.select().from(tmeProductCache).where(and(
          eq(tmeProductCache.symbol, symbol),
          gte(tmeProductCache.expiresAt, now)
        )).limit(1);
        return result[0];
      }
      async getTmeCachedProducts(symbols) {
        if (symbols.length === 0) return [];
        const now = /* @__PURE__ */ new Date();
        const results = [];
        for (const symbol of symbols) {
          const cached = await this.getTmeCachedProduct(symbol);
          if (cached) results.push(cached);
        }
        return results;
      }
      async setTmeCachedProduct(cache) {
        const existing = await db.select().from(tmeProductCache).where(eq(tmeProductCache.symbol, cache.symbol)).limit(1);
        if (existing.length > 0) {
          const result = await db.update(tmeProductCache).set({
            productData: cache.productData,
            priceData: cache.priceData,
            stockData: cache.stockData,
            categoryId: cache.categoryId,
            fetchedAt: /* @__PURE__ */ new Date(),
            expiresAt: cache.expiresAt
          }).where(eq(tmeProductCache.symbol, cache.symbol)).returning();
          return result[0];
        } else {
          const result = await db.insert(tmeProductCache).values({
            ...cache,
            fetchedAt: /* @__PURE__ */ new Date()
          }).returning();
          return result[0];
        }
      }
      async setTmeCachedProducts(caches) {
        if (caches.length === 0) return;
        const batchSize = 50;
        for (let i = 0; i < caches.length; i += batchSize) {
          const batch = caches.slice(i, i + batchSize);
          await Promise.all(batch.map((cache) => this.setTmeCachedProduct(cache)));
        }
      }
      async getStaleProductSymbols(olderThan24Hours = true) {
        const cutoffTime = new Date(Date.now() - (olderThan24Hours ? 24 * 60 * 60 * 1e3 : 0));
        const result = await db.select({ symbol: tmeProductCache.symbol }).from(tmeProductCache).where(lte(tmeProductCache.expiresAt, cutoffTime));
        return result.map((r) => r.symbol);
      }
      async cleanExpiredCache() {
        const now = /* @__PURE__ */ new Date();
        const result = await db.delete(tmeProductCache).where(lte(tmeProductCache.expiresAt, now));
        return result.rowCount ?? 0;
      }
      // Bulk Listing Jobs - track progress of bulk listing operations
      async createBulkListingJob(job) {
        const result = await db.insert(bulkListingJobs).values(job).returning();
        return result[0];
      }
      async getBulkListingJob(id) {
        const result = await db.select().from(bulkListingJobs).where(eq(bulkListingJobs.id, id));
        return result[0] || void 0;
      }
      async updateBulkListingJob(id, updates) {
        const result = await db.update(bulkListingJobs).set(updates).where(eq(bulkListingJobs.id, id)).returning();
        return result[0] || void 0;
      }
      async cleanOldBulkListingJobs(olderThanHours = 24) {
        const cutoffTime = new Date(Date.now() - olderThanHours * 60 * 60 * 1e3);
        const result = await db.delete(bulkListingJobs).where(lte(bulkListingJobs.createdAt, cutoffTime));
        return result.rowCount ?? 0;
      }
      // eBay Payment Policies
      async getEbayPaymentPolicies() {
        return await db.select().from(ebayPaymentPolicies).orderBy(desc(ebayPaymentPolicies.createdAt));
      }
      async getEbayPaymentPolicy(policyId) {
        const result = await db.select().from(ebayPaymentPolicies).where(eq(ebayPaymentPolicies.policyId, policyId));
        return result[0] || void 0;
      }
      async createEbayPaymentPolicy(policy) {
        const result = await db.insert(ebayPaymentPolicies).values(policy).returning();
        return result[0];
      }
      async updateEbayPaymentPolicy(policyId, policy) {
        const result = await db.update(ebayPaymentPolicies).set({ ...policy, updatedAt: /* @__PURE__ */ new Date() }).where(eq(ebayPaymentPolicies.policyId, policyId)).returning();
        return result[0] || void 0;
      }
      async deleteEbayPaymentPolicy(policyId) {
        const result = await db.delete(ebayPaymentPolicies).where(eq(ebayPaymentPolicies.policyId, policyId));
        return (result.rowCount ?? 0) > 0;
      }
      // eBay Fulfillment (Shipping) Policies
      async getEbayFulfillmentPolicies() {
        return await db.select().from(ebayFulfillmentPolicies).orderBy(desc(ebayFulfillmentPolicies.createdAt));
      }
      async getEbayFulfillmentPolicy(policyId) {
        const result = await db.select().from(ebayFulfillmentPolicies).where(eq(ebayFulfillmentPolicies.policyId, policyId));
        return result[0] || void 0;
      }
      async createEbayFulfillmentPolicy(policy) {
        const result = await db.insert(ebayFulfillmentPolicies).values(policy).returning();
        return result[0];
      }
      async updateEbayFulfillmentPolicy(policyId, policy) {
        const result = await db.update(ebayFulfillmentPolicies).set({ ...policy, updatedAt: /* @__PURE__ */ new Date() }).where(eq(ebayFulfillmentPolicies.policyId, policyId)).returning();
        return result[0] || void 0;
      }
      async deleteEbayFulfillmentPolicy(policyId) {
        const result = await db.delete(ebayFulfillmentPolicies).where(eq(ebayFulfillmentPolicies.policyId, policyId));
        return (result.rowCount ?? 0) > 0;
      }
      // eBay Return Policies
      async getEbayReturnPolicies() {
        return await db.select().from(ebayReturnPolicies).orderBy(desc(ebayReturnPolicies.createdAt));
      }
      async getEbayReturnPolicy(policyId) {
        const result = await db.select().from(ebayReturnPolicies).where(eq(ebayReturnPolicies.policyId, policyId));
        return result[0] || void 0;
      }
      async createEbayReturnPolicy(policy) {
        const result = await db.insert(ebayReturnPolicies).values(policy).returning();
        return result[0];
      }
      async updateEbayReturnPolicy(policyId, policy) {
        const result = await db.update(ebayReturnPolicies).set({ ...policy, updatedAt: /* @__PURE__ */ new Date() }).where(eq(ebayReturnPolicies.policyId, policyId)).returning();
        return result[0] || void 0;
      }
      async deleteEbayReturnPolicy(policyId) {
        const result = await db.delete(ebayReturnPolicies).where(eq(ebayReturnPolicies.policyId, policyId));
        return (result.rowCount ?? 0) > 0;
      }
      // ==========================================
      // ORDERS MANAGEMENT
      // ==========================================
      async getOrders(filters) {
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
          query = query.where(and(...conditions));
        }
        query = query.orderBy(desc(orders.orderDate));
        if (filters?.limit) {
          query = query.limit(filters.limit);
        }
        if (filters?.offset) {
          query = query.offset(filters.offset);
        }
        return await query;
      }
      async getOrder(id) {
        const result = await db.select().from(orders).where(eq(orders.id, id));
        return result[0] || void 0;
      }
      async getOrderByMarketplaceId(marketplace, marketplaceOrderId) {
        const result = await db.select().from(orders).where(
          and(
            eq(orders.marketplace, marketplace),
            eq(orders.marketplaceOrderId, marketplaceOrderId)
          )
        );
        return result[0] || void 0;
      }
      async createOrder(order) {
        const result = await db.insert(orders).values(order).returning();
        return result[0];
      }
      async updateOrder(id, order) {
        const result = await db.update(orders).set({ ...order, updatedAt: /* @__PURE__ */ new Date() }).where(eq(orders.id, id)).returning();
        return result[0] || void 0;
      }
      async deleteOrder(id) {
        await db.delete(orderEvents).where(eq(orderEvents.orderId, id));
        await db.delete(orderFees).where(eq(orderFees.orderId, id));
        await db.delete(orderItems).where(eq(orderItems.orderId, id));
        const result = await db.delete(orders).where(eq(orders.id, id));
        return (result.rowCount ?? 0) > 0;
      }
      async getOrdersCount(filters) {
        const conditions = [];
        if (filters?.marketplace) {
          conditions.push(eq(orders.marketplace, filters.marketplace));
        }
        if (filters?.status) {
          conditions.push(eq(orders.status, filters.status));
        }
        let query = db.select({ count: count() }).from(orders);
        if (conditions.length > 0) {
          query = query.where(and(...conditions));
        }
        const result = await query;
        return result[0]?.count || 0;
      }
      // Order Items
      async getOrderItems(orderId) {
        return await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
      }
      async createOrderItem(item) {
        const result = await db.insert(orderItems).values(item).returning();
        return result[0];
      }
      async createOrderItems(items) {
        if (items.length > 0) {
          await db.insert(orderItems).values(items);
        }
      }
      // Order Fees
      async getOrderFees(orderId) {
        return await db.select().from(orderFees).where(eq(orderFees.orderId, orderId));
      }
      async createOrderFee(fee) {
        const result = await db.insert(orderFees).values(fee).returning();
        return result[0];
      }
      async createOrderFees(fees) {
        if (fees.length > 0) {
          await db.insert(orderFees).values(fees);
        }
      }
      // Order Events
      async getOrderEvents(orderId) {
        return await db.select().from(orderEvents).where(eq(orderEvents.orderId, orderId)).orderBy(desc(orderEvents.createdAt));
      }
      async createOrderEvent(event) {
        const result = await db.insert(orderEvents).values(event).returning();
        return result[0];
      }
      // ============================================
      // MESSAGING SYSTEM
      // ============================================
      // Message Threads
      async getMessageThreads(filters) {
        const conditions = [];
        if (filters?.marketplace) {
          conditions.push(eq(messageThreads.marketplace, filters.marketplace));
        }
        if (filters?.status) {
          conditions.push(eq(messageThreads.status, filters.status));
        }
        if (filters?.isRead !== void 0) {
          conditions.push(eq(messageThreads.isRead, filters.isRead));
        }
        if (filters?.orderId) {
          conditions.push(eq(messageThreads.orderId, filters.orderId));
        }
        if (filters?.buyerUsername) {
          conditions.push(ilike(messageThreads.buyerUsername, `%${filters.buyerUsername}%`));
        }
        let query = db.select().from(messageThreads).orderBy(desc(messageThreads.lastMessageAt), desc(messageThreads.createdAt));
        if (conditions.length > 0) {
          query = query.where(and(...conditions));
        }
        if (filters?.limit) {
          query = query.limit(filters.limit);
        }
        if (filters?.offset) {
          query = query.offset(filters.offset);
        }
        return await query;
      }
      async getMessageThread(id) {
        const result = await db.select().from(messageThreads).where(eq(messageThreads.id, id));
        return result[0] || void 0;
      }
      async getMessageThreadByBuyer(buyerUsername, itemId) {
        const conditions = [eq(messageThreads.buyerUsername, buyerUsername)];
        if (itemId) {
          conditions.push(eq(messageThreads.itemId, itemId));
        }
        const result = await db.select().from(messageThreads).where(and(...conditions)).orderBy(desc(messageThreads.createdAt)).limit(1);
        return result[0] || void 0;
      }
      async createMessageThread(thread) {
        const result = await db.insert(messageThreads).values(thread).returning();
        return result[0];
      }
      async updateMessageThread(id, thread) {
        const result = await db.update(messageThreads).set({ ...thread, updatedAt: /* @__PURE__ */ new Date() }).where(eq(messageThreads.id, id)).returning();
        return result[0] || void 0;
      }
      async getUnreadThreadCount() {
        const result = await db.select({ count: count() }).from(messageThreads).where(eq(messageThreads.isRead, false));
        return result[0]?.count || 0;
      }
      // Messages
      async getMessages(threadId) {
        return await db.select().from(messages).where(eq(messages.threadId, threadId)).orderBy(asc(messages.createdAt));
      }
      async getMessage(id) {
        const result = await db.select().from(messages).where(eq(messages.id, id));
        return result[0] || void 0;
      }
      async createMessage(message) {
        const result = await db.insert(messages).values(message).returning();
        if (result[0]) {
          const countResult = await db.select({ count: count() }).from(messages).where(eq(messages.threadId, message.threadId));
          const msgCount = countResult[0]?.count || 0;
          await db.update(messageThreads).set({
            messageCount: msgCount,
            lastMessageAt: /* @__PURE__ */ new Date(),
            updatedAt: /* @__PURE__ */ new Date()
          }).where(eq(messageThreads.id, message.threadId));
        }
        return result[0];
      }
      async updateMessage(id, message) {
        const result = await db.update(messages).set(message).where(eq(messages.id, id)).returning();
        return result[0] || void 0;
      }
      // Message Templates
      async getMessageTemplates(category) {
        if (category) {
          return await db.select().from(messageTemplates).where(eq(messageTemplates.category, category)).orderBy(desc(messageTemplates.usageCount));
        }
        return await db.select().from(messageTemplates).orderBy(desc(messageTemplates.usageCount));
      }
      async getMessageTemplate(id) {
        const result = await db.select().from(messageTemplates).where(eq(messageTemplates.id, id));
        return result[0] || void 0;
      }
      async createMessageTemplate(template) {
        const result = await db.insert(messageTemplates).values(template).returning();
        return result[0];
      }
      async updateMessageTemplate(id, template) {
        const result = await db.update(messageTemplates).set({ ...template, updatedAt: /* @__PURE__ */ new Date() }).where(eq(messageTemplates.id, id)).returning();
        return result[0] || void 0;
      }
      async deleteMessageTemplate(id) {
        const result = await db.delete(messageTemplates).where(eq(messageTemplates.id, id));
        return (result.rowCount ?? 0) > 0;
      }
      async incrementTemplateUsage(id) {
        const template = await this.getMessageTemplate(id);
        if (template) {
          await db.update(messageTemplates).set({
            usageCount: template.usageCount + 1,
            lastUsedAt: /* @__PURE__ */ new Date()
          }).where(eq(messageTemplates.id, id));
        }
      }
      // Auto Message Rules
      async getAutoMessageRules(triggerType) {
        if (triggerType) {
          return await db.select().from(autoMessageRules).where(eq(autoMessageRules.triggerType, triggerType)).orderBy(desc(autoMessageRules.createdAt));
        }
        return await db.select().from(autoMessageRules).orderBy(desc(autoMessageRules.createdAt));
      }
      async getAutoMessageRule(id) {
        const result = await db.select().from(autoMessageRules).where(eq(autoMessageRules.id, id));
        return result[0] || void 0;
      }
      async getActiveAutoMessageRules(triggerType) {
        return await db.select().from(autoMessageRules).where(and(
          eq(autoMessageRules.triggerType, triggerType),
          eq(autoMessageRules.isActive, true)
        ));
      }
      async createAutoMessageRule(rule) {
        const result = await db.insert(autoMessageRules).values(rule).returning();
        return result[0];
      }
      async updateAutoMessageRule(id, rule) {
        const result = await db.update(autoMessageRules).set({ ...rule, updatedAt: /* @__PURE__ */ new Date() }).where(eq(autoMessageRules.id, id)).returning();
        return result[0] || void 0;
      }
      async deleteAutoMessageRule(id) {
        const result = await db.delete(autoMessageRules).where(eq(autoMessageRules.id, id));
        return (result.rowCount ?? 0) > 0;
      }
      async incrementRuleSentCount(id) {
        const rule = await this.getAutoMessageRule(id);
        if (rule) {
          await db.update(autoMessageRules).set({
            sentCount: rule.sentCount + 1,
            lastTriggeredAt: /* @__PURE__ */ new Date()
          }).where(eq(autoMessageRules.id, id));
        }
      }
      // Scheduled Messages
      async getScheduledMessages(status) {
        if (status) {
          return await db.select().from(scheduledMessages).where(eq(scheduledMessages.status, status)).orderBy(asc(scheduledMessages.scheduledFor));
        }
        return await db.select().from(scheduledMessages).orderBy(asc(scheduledMessages.scheduledFor));
      }
      async getPendingScheduledMessages() {
        return await db.select().from(scheduledMessages).where(and(
          eq(scheduledMessages.status, "pending"),
          lte(scheduledMessages.scheduledFor, /* @__PURE__ */ new Date())
        )).orderBy(asc(scheduledMessages.scheduledFor));
      }
      async createScheduledMessage(message) {
        const result = await db.insert(scheduledMessages).values(message).returning();
        return result[0];
      }
      async updateScheduledMessage(id, message) {
        const result = await db.update(scheduledMessages).set(message).where(eq(scheduledMessages.id, id)).returning();
        return result[0] || void 0;
      }
      async cancelScheduledMessage(id) {
        const result = await db.update(scheduledMessages).set({ status: "cancelled" }).where(eq(scheduledMessages.id, id));
        return (result.rowCount ?? 0) > 0;
      }
    };
    storage = new DatabaseStorage();
  }
});

// server/tme-api.ts
var tme_api_exports = {};
__export(tme_api_exports, {
  TMEApiService: () => TMEApiService,
  tmeApi: () => tmeApi
});
import crypto from "crypto";
var TMEApiService, tmeApi;
var init_tme_api = __esm({
  "server/tme-api.ts"() {
    "use strict";
    init_storage();
    TMEApiService = class {
      credentials;
      static credentialsValidated = false;
      baseUrl = "https://api.tme.eu";
      callCount = 0;
      dailyLimit = 1e4;
      rateLimitPerMinute = 60;
      lastCallTimestamp = 0;
      callsThisMinute = 0;
      requestQueue = [];
      isProcessingQueue = false;
      storage;
      constructor() {
        this.storage = storage;
        const requiredEnvVars = ["TME_TOKEN", "TME_CUSTOMER_NUMBER", "TME_CONTACT_NUMBER", "TME_APPLICATION_SECRET"];
        const missingVars = requiredEnvVars.filter((v) => !process.env[v]);
        if (missingVars.length > 0) {
          console.error(`\u274C Missing required TME environment variables: ${missingVars.join(", ")}`);
          console.error("Please set these in your environment secrets.");
        }
        this.credentials = {
          token: process.env.TME_TOKEN || "",
          customerNumber: process.env.TME_CUSTOMER_NUMBER || "",
          contactNumber: process.env.TME_CONTACT_NUMBER || "",
          applicationSecret: process.env.TME_APPLICATION_SECRET || ""
        };
        console.log("\u2705 TME API Service initialized");
        console.log("- Token length:", this.credentials.token.length);
        console.log("- Credentials loaded from environment");
      }
      generateApiSignature(method, url, params) {
        const paramsForSignature = { ...params };
        delete paramsForSignature.ApiSignature;
        const sortedParams = Object.keys(paramsForSignature).sort().map((key) => {
          const value = paramsForSignature[key];
          if (Array.isArray(value)) {
            return value.map(
              (item, index) => `${encodeURIComponent(`${key}[${index}]`)}=${encodeURIComponent(String(item))}`
            ).join("&");
          } else {
            return `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`;
          }
        }).join("&");
        const baseString = `${method}&${encodeURIComponent(url)}&${encodeURIComponent(sortedParams)}`;
        console.log("\u{1F510} Signature base string:", baseString.substring(0, 200) + "...");
        const signature = crypto.createHmac("sha1", this.credentials.applicationSecret).update(baseString).digest("base64");
        console.log("\u{1F510} Generated signature:", signature.substring(0, 20) + "...");
        return signature;
      }
      async rateLimitCheck() {
        const now = Date.now();
        if (now - this.lastCallTimestamp > 6e4) {
          this.callsThisMinute = 0;
        }
        const safeRateLimit = 55;
        if (this.callsThisMinute >= safeRateLimit) {
          const waitTime = 6e4 - (now - this.lastCallTimestamp);
          console.log(`\u{1F6A6} Rate limit reached. Waiting ${waitTime}ms...`);
          await new Promise((resolve) => setTimeout(resolve, waitTime));
          this.callsThisMinute = 0;
        }
        if (this.lastCallTimestamp > 0) {
          const timeSinceLastCall = now - this.lastCallTimestamp;
          const minimumDelay = 1e3;
          if (timeSinceLastCall < minimumDelay) {
            const waitTime = minimumDelay - timeSinceLastCall;
            console.log(`\u23F1\uFE0F Waiting ${waitTime}ms between API calls...`);
            await new Promise((resolve) => setTimeout(resolve, waitTime));
          }
        }
        if (this.callCount >= this.dailyLimit) {
          throw new Error(`TME daily limit exceeded: ${this.callCount}/${this.dailyLimit}`);
        }
      }
      async makeRequest(endpoint, params = {}) {
        await this.rateLimitCheck();
        const url = `${this.baseUrl}${endpoint}`;
        const requestParams = {
          Token: this.credentials.token,
          Language: "EN"
        };
        if (this.credentials.token.length === 45) {
          requestParams.Country = "GB";
        }
        Object.entries(params).forEach(([key, value]) => {
          if (value !== void 0 && value !== null) {
            requestParams[key] = value;
          }
        });
        const apiSignature = this.generateApiSignature("POST", url, requestParams);
        requestParams.ApiSignature = apiSignature;
        const formData = new URLSearchParams();
        Object.entries(requestParams).forEach(([key, value]) => {
          if (Array.isArray(value)) {
            value.forEach((item, index) => {
              formData.append(`${key}[${index}]`, String(item));
            });
          } else {
            formData.append(key, String(value));
          }
        });
        this.callCount++;
        this.callsThisMinute++;
        this.lastCallTimestamp = Date.now();
        try {
          await this.storage.trackApiCall("tme");
        } catch (error) {
          console.error("Failed to track API call:", error);
        }
        console.log(`\u{1F4CA} TME API Call #${this.callCount}: ${endpoint}`);
        console.log(`\u{1F4DD} Request params:`, Object.keys(requestParams).join(", "));
        const maxRetries = 3;
        const baseDelayMs = 2e3;
        const timeoutMs = 2e4;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
          try {
            const response = await fetch(url, {
              method: "POST",
              headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "Accept": "application/json",
                "User-Agent": "TME-API-Client/1.0"
              },
              body: formData.toString(),
              signal: controller.signal
            });
            clearTimeout(timeoutId);
            const responseText = await response.text();
            console.log(`\u{1F4E5} Response status: ${response.status}, length: ${responseText.length}`);
            if (!response.ok) {
              const isRetriable = response.status >= 500 || response.status === 429;
              console.error(`\u274C HTTP Error: ${response.status} ${response.statusText}`);
              console.error(`\u274C Response body:`, responseText.substring(0, 1e3));
              if (isRetriable && attempt < maxRetries) {
                const delay = baseDelayMs * Math.pow(2, attempt - 1) * (0.8 + Math.random() * 0.4);
                console.log(`\u{1F504} Retry ${attempt}/${maxRetries} after ${Math.round(delay)}ms...`);
                await new Promise((resolve) => setTimeout(resolve, delay));
                continue;
              }
              throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            let data;
            try {
              data = JSON.parse(responseText);
            } catch (parseError) {
              console.error("\u274C JSON parse error:", responseText.substring(0, 500));
              throw new Error(`Invalid JSON response from TME API`);
            }
            if (data.Status !== "OK") {
              console.error("\u274C TME API Error:", {
                status: data.Status,
                errorMessage: data.ErrorMessage,
                errorCode: data.ErrorCode,
                errors: data.Error
              });
              if (data.Status === "E_TOO_MANY_REQUESTS") {
                if (attempt < maxRetries) {
                  const delay = 5e3 * attempt;
                  console.log(`\u23F8\uFE0F Rate limit hit, waiting ${delay / 1e3}s (retry ${attempt}/${maxRetries})...`);
                  await new Promise((resolve) => setTimeout(resolve, delay));
                  continue;
                }
                throw new Error(`TME API rate limit exceeded. Please try again later.`);
              }
              if (data.Status === "E_INPUT_PARAMS_VALIDATION_ERROR") {
                throw new Error(`TME API parameter validation error: ${JSON.stringify(data.Error)}`);
              }
              throw new Error(`TME API error: ${data.ErrorMessage || data.Message || "Unknown error"}`);
            }
            console.log(`\u2705 TME API success: ${endpoint}`);
            return data;
          } catch (error) {
            clearTimeout(timeoutId);
            const isAbortError = error.name === "AbortError";
            const isNetworkError = error.code === "ECONNRESET" || error.code === "ENOTFOUND" || error.code === "ETIMEDOUT";
            const isRetriable = isAbortError || isNetworkError;
            if (isRetriable && attempt < maxRetries) {
              const delay = baseDelayMs * Math.pow(2, attempt - 1) * (0.8 + Math.random() * 0.4);
              console.log(`\u{1F504} ${isAbortError ? "Timeout" : "Network error"}, retry ${attempt}/${maxRetries} after ${Math.round(delay)}ms...`);
              await new Promise((resolve) => setTimeout(resolve, delay));
              continue;
            }
            console.error(`\u274C TME API request failed after ${attempt} attempts:`, error);
            throw error;
          }
        }
        throw new Error(`TME API request failed after ${maxRetries} retries`);
      }
      // Get raw TME categories response for debugging
      async getAllCategoriesRaw() {
        try {
          const response = await this.makeRequest("/Products/GetCategories.json");
          console.log("\u{1F4CB} Raw TME response Data keys:", Object.keys(response.Data || {}));
          for (const key of Object.keys(response.Data || {})) {
            const value = response.Data[key];
            console.log(`\u{1F4CB} Data.${key} type:`, typeof value, Array.isArray(value) ? `(array of ${value.length})` : "");
            if (Array.isArray(value) && value.length > 0) {
              console.log(`\u{1F4CB} Sample ${key}[0] keys:`, Object.keys(value[0]));
            } else if (typeof value === "object" && value !== null) {
              console.log(`\u{1F4CB} ${key} object keys:`, Object.keys(value));
            }
          }
          return {
            dataKeys: Object.keys(response.Data || {}),
            categoryTree: response.Data?.CategoryTree,
            categoryList: response.Data?.CategoryList,
            rawDataSample: JSON.stringify(response.Data).substring(0, 2e3)
          };
        } catch (error) {
          console.error("Failed to get raw categories:", error);
          return { error: String(error) };
        }
      }
      // Get all available categories with real product counts from TME
      async getAllCategories() {
        try {
          const response = await this.makeRequest("/Products/GetCategories.json");
          if (response.Data && response.Data.CategoryTree) {
            const rootCategory = response.Data.CategoryTree;
            const categories2 = this.parseCategoryTree(rootCategory);
            console.log(`\u{1F4C1} Parsed ${categories2.length} categories from TME with real product counts`);
            return categories2;
          }
          console.log("\u26A0\uFE0F Using fallback categories - TME response format unexpected");
          return this.getFallbackCategories();
        } catch (error) {
          console.warn("Failed to fetch categories from TME API, using fallback:", error);
          return this.getFallbackCategories();
        }
      }
      // Parse TME's nested CategoryTree structure into flat array
      parseCategoryTree(node, parentId = null) {
        const categories2 = [];
        if (node.Id && node.Name) {
          const category = {
            CategoryId: String(node.Id),
            Name: node.Name,
            ParentId: parentId,
            ProductCount: node.TotalProducts || 0
          };
          categories2.push(category);
        }
        if (node.SubTree && Array.isArray(node.SubTree) && node.SubTree.length > 0) {
          for (const childNode of node.SubTree) {
            const childCategories = this.parseCategoryTree(childNode, node.Id ? String(node.Id) : null);
            categories2.push(...childCategories);
          }
        }
        return categories2;
      }
      getFallbackCategories() {
        return [
          { CategoryId: "1000", Name: "Microcontrollers & Processors", ProductCount: 8e3 },
          { CategoryId: "1001", Name: "Arduino Compatible", ProductCount: 800 },
          { CategoryId: "1002", Name: "Development Boards", ProductCount: 1200 },
          { CategoryId: "2000", Name: "Semiconductors", ProductCount: 2e4 },
          { CategoryId: "2001", Name: "Transistors", ProductCount: 8e3 },
          { CategoryId: "2002", Name: "Diodes", ProductCount: 5e3 },
          { CategoryId: "2003", Name: "Integrated Circuits", ProductCount: 25e3 },
          { CategoryId: "3000", Name: "Optoelectronics", ProductCount: 15e3 },
          { CategoryId: "3001", Name: "LEDs", ProductCount: 8e3 },
          { CategoryId: "3002", Name: "Displays", ProductCount: 2e3 },
          { CategoryId: "5000", Name: "Passive Components", ProductCount: 8e4 },
          { CategoryId: "5001", Name: "Resistors", ProductCount: 25e3 },
          { CategoryId: "5002", Name: "Capacitors", ProductCount: 35e3 },
          { CategoryId: "5003", Name: "Inductors", ProductCount: 8e3 },
          { CategoryId: "6000", Name: "Connectors", ProductCount: 25e3 },
          { CategoryId: "6001", Name: "Pin Headers", ProductCount: 1200 },
          { CategoryId: "6002", Name: "Terminal Blocks", ProductCount: 800 },
          { CategoryId: "7000", Name: "Power Management", ProductCount: 15e3 },
          { CategoryId: "8000", Name: "Switches & Indicators", ProductCount: 12e3 },
          { CategoryId: "10000", Name: "Sensors", ProductCount: 18e3 },
          { CategoryId: "14000", Name: "Wires & Cables", ProductCount: 15e3 }
        ];
      }
      // Search products with enhanced filtering
      async searchProducts(query, limit = 100) {
        try {
          console.log(`\u{1F50D} Searching TME for: "${query}"`);
          const response = await this.makeRequest("/Products/Search.json", {
            SearchPlain: query,
            SearchWithStock: "1"
            // Removed SearchPhoto as it's not a valid parameter
          });
          const products2 = response.Data.ProductList || [];
          console.log(`\u2705 TME search returned ${products2.length} products for "${query}"`);
          return products2.slice(0, limit);
        } catch (error) {
          console.error(`\u274C Search failed for "${query}":`, error);
          return [];
        }
      }
      // Get products by category with pagination using TME Search API with SearchCategory filter
      async getProductsByCategory(categoryId, page = 1, limit = 20) {
        console.log(`\u{1F50D} Getting products for category ${categoryId}, page ${page}, limit ${limit}`);
        try {
          const response = await this.makeRequest("/Products/Search.json", {
            SearchCategory: categoryId,
            SearchWithStock: "1",
            SearchPage: String(page)
          });
          const products2 = response.Data?.ProductList || [];
          const totalProducts = response.Data?.Amount || 0;
          const pageNumber = response.Data?.PageNumber || page;
          console.log(`\u2705 TME returned ${products2.length} products for category ${categoryId} (page ${pageNumber}), total: ${totalProducts}`);
          if (products2.length > 0) {
            return {
              products: products2,
              total: totalProducts
            };
          }
          console.log(`\u{1F504} No products found with SearchCategory filter, falling back to keyword search`);
          return this.searchProductsByCategoryKeywords(categoryId, page, limit);
        } catch (error) {
          console.error(`\u274C Failed to get products for category ${categoryId}:`, error);
          return this.searchProductsByCategoryKeywords(categoryId, page, limit);
        }
      }
      // Fallback: search products by category using keywords  
      async searchProductsByCategoryKeywords(categoryId, page, limit) {
        const searchTerms = this.getCategorySearchTerms(categoryId);
        let allProducts = [];
        const termsPerPage = 3;
        const startTermIndex = (page - 1) * termsPerPage % searchTerms.length;
        for (let i = 0; i < termsPerPage && i < searchTerms.length; i++) {
          const termIndex = (startTermIndex + i) % searchTerms.length;
          const searchTerm = searchTerms[termIndex];
          try {
            const products2 = await this.searchProducts(searchTerm, 50);
            const newProducts = products2.filter(
              (product) => !allProducts.some((existing) => existing.Symbol === product.Symbol)
            );
            allProducts = allProducts.concat(newProducts);
            if (allProducts.length >= limit * 2) break;
            await new Promise((resolve) => setTimeout(resolve, 500));
          } catch (e) {
            console.warn(`Search failed for "${searchTerm}":`, e);
          }
        }
        if (allProducts.length === 0) {
          return this.getMockProductsForCategory(categoryId, page, limit);
        }
        return {
          products: allProducts.slice(0, limit),
          total: searchTerms.length * 100
        };
      }
      async searchProductsByCategory(categoryId, page, limit) {
        const searchTerms = this.getCategorySearchTerms(categoryId);
        let allProducts = [];
        for (const term of searchTerms.slice(0, 5)) {
          try {
            const products2 = await this.searchProducts(term, 50);
            const newProducts = products2.filter(
              (product) => !allProducts.some((existing) => existing.Symbol === product.Symbol)
            );
            allProducts = allProducts.concat(newProducts);
            if (allProducts.length >= limit * 2) break;
            await new Promise((resolve) => setTimeout(resolve, 300));
          } catch (error) {
            console.warn(`Search failed for term "${term}":`, error);
          }
        }
        const startIndex = (page - 1) * limit;
        const endIndex = startIndex + limit;
        return {
          products: allProducts.slice(startIndex, endIndex),
          total: allProducts.length
        };
      }
      getCategorySearchTerms(categoryId) {
        const categoryTerms = {
          "1000": ["microcontroller", "atmega", "stm32", "esp32", "arduino", "pic", "arm"],
          "1001": ["arduino", "uno", "nano", "mega", "esp32", "nodemcu"],
          "2000": ["transistor", "mosfet", "diode", "ic", "semiconductor"],
          "2001": ["transistor", "mosfet", "bjt", "fet"],
          "2002": ["diode", "rectifier", "schottky", "zener"],
          "3000": ["led", "display", "opto", "laser"],
          "3001": ["led", "rgb", "smd", "through hole"],
          "5000": ["resistor", "capacitor", "inductor"],
          "5001": ["resistor", "ohm", "smd", "through hole"],
          "5002": ["capacitor", "ceramic", "electrolytic", "tantalum"],
          "6000": ["connector", "header", "terminal", "socket"],
          "10000": ["sensor", "temperature", "humidity", "pressure"]
        };
        return categoryTerms[categoryId] || ["electronic", "component"];
      }
      // Batch get product details
      async getProductDetails(symbols) {
        if (symbols.length === 0) return [];
        try {
          const response = await this.makeRequest("/Products/GetProducts.json", {
            SymbolList: symbols
          });
          return response.Data.ProductList || [];
        } catch (error) {
          console.error("Failed to get product details:", error);
          return [];
        }
      }
      // Batch get product prices
      async getProductPrices(symbols) {
        if (symbols.length === 0) return [];
        try {
          const response = await this.makeRequest("/Products/GetPrices.json", {
            SymbolList: symbols
          });
          return response.Data.ProductList || [];
        } catch (error) {
          console.error("Failed to get product prices:", error);
          return [];
        }
      }
      // Batch get product stock
      async getProductStock(symbols) {
        if (symbols.length === 0) return [];
        try {
          const response = await this.makeRequest("/Products/GetStocks.json", {
            SymbolList: symbols
          });
          return response.Data.ProductList || [];
        } catch (error) {
          console.error("Failed to get product stock:", error);
          return [];
        }
      }
      // OPTIMIZED: Get prices AND stocks in a SINGLE API call (50% fewer calls!)
      async getPricesAndStocks(symbols) {
        if (symbols.length === 0) return [];
        try {
          const response = await this.makeRequest("/Products/GetPricesAndStocks.json", {
            SymbolList: symbols
          });
          return response.Data.ProductList || [];
        } catch (error) {
          console.error("Failed to get prices and stocks:", error);
          return [];
        }
      }
      // OPTIMIZED: Get enhanced product info using combined GetPricesAndStocks endpoint
      // Uses batch size of 50 (vs old 10) and 2 API calls per batch (vs old 3)
      // For 163 products: Old = 51 calls, New = ~7 calls (85% reduction!)
      async getEnhancedProductInfo(symbols) {
        if (symbols.length === 0) return [];
        const batchSize = 50;
        const results = [];
        console.log(`\u{1F680} Optimized sync: ${symbols.length} products in ${Math.ceil(symbols.length / batchSize)} batches of ${batchSize}`);
        console.log(`\u{1F4CA} API calls needed: ~${Math.ceil(symbols.length / batchSize) * 2} (using GetPricesAndStocks)`);
        for (let i = 0; i < symbols.length; i += batchSize) {
          const batch = symbols.slice(i, i + batchSize);
          const batchNum = Math.floor(i / batchSize) + 1;
          const totalBatches = Math.ceil(symbols.length / batchSize);
          console.log(`\u26A1 Processing batch ${batchNum}/${totalBatches} (${batch.length} products)`);
          try {
            const [products2, pricesAndStocks] = await Promise.all([
              this.getProductDetails(batch),
              this.getPricesAndStocks(batch)
            ]);
            batch.forEach((symbol) => {
              const product = products2.find((p) => p.Symbol === symbol);
              const priceAndStock = pricesAndStocks.find((p) => p.Symbol === symbol);
              if (product) {
                const price = priceAndStock ? {
                  Symbol: priceAndStock.Symbol,
                  PriceList: priceAndStock.PriceList,
                  Unit: priceAndStock.Unit,
                  VatRate: priceAndStock.VatRate,
                  VatType: priceAndStock.VatType
                } : null;
                const stock = priceAndStock ? {
                  Symbol: priceAndStock.Symbol,
                  Amount: priceAndStock.Amount,
                  Unit: priceAndStock.Unit
                } : null;
                results.push({ product, price, stock });
              }
            });
            console.log(`\u2705 Batch ${batchNum} complete: ${results.length}/${symbols.length} products processed`);
            if (i + batchSize < symbols.length) {
              await new Promise((resolve) => setTimeout(resolve, 500));
            }
          } catch (error) {
            console.error(`Failed to get enhanced info for batch ${batchNum}:`, error);
          }
        }
        console.log(`\u{1F389} Sync complete: ${results.length} products fetched`);
        return results;
      }
      // Get API usage statistics
      getApiUsage() {
        return {
          callsToday: this.callCount,
          dailyLimit: this.dailyLimit,
          callsThisMinute: this.callsThisMinute,
          rateLimitPerMinute: this.rateLimitPerMinute,
          remainingDaily: this.dailyLimit - this.callCount,
          remainingThisMinute: this.rateLimitPerMinute - this.callsThisMinute,
          usagePercentage: Math.round(this.callCount / this.dailyLimit * 100),
          lastCallTimestamp: this.lastCallTimestamp,
          status: this.callCount >= this.dailyLimit ? "LIMIT_EXCEEDED" : this.callCount > this.dailyLimit * 0.8 ? "WARNING" : "OK"
        };
      }
      // Reset daily usage counters
      resetDailyUsage() {
        this.callCount = 0;
        console.log("\u{1F4CA} TME API daily usage counter reset");
      }
      // Check if we can make more API calls
      canMakeApiCall() {
        return this.callCount < this.dailyLimit && this.callsThisMinute < this.rateLimitPerMinute;
      }
      // Mock products for development when API fails
      getMockProductsForCategory(categoryId, page, limit) {
        const mockProducts = [];
        const categoryInfo = this.getFallbackCategories().find((cat) => cat.CategoryId === categoryId);
        const categoryName = categoryInfo?.Name || "Electronics";
        const productCount = Math.min(50, categoryInfo?.ProductCount || 25);
        for (let i = 1; i <= productCount; i++) {
          mockProducts.push({
            Symbol: `MOCK-${categoryId}-${String(i).padStart(3, "0")}`,
            CustomerSymbol: `MOCK-${categoryId}-${String(i).padStart(3, "0")}`,
            OriginalSymbol: `MOCK-${categoryId}-${String(i).padStart(3, "0")}`,
            EAN: `123456789${String(i).padStart(4, "0")}`,
            Producer: this.getMockProducer(categoryId),
            Description: `${categoryName} Component - Model ${i}`,
            CategoryId: parseInt(categoryId),
            Category: categoryName,
            Photo: "",
            Thumbnail: "",
            DataSheet: "",
            ProductInformationPage: "",
            Weight: Math.floor(Math.random() * 100) + 1,
            WeightUnit: "g",
            SuppliedAmount: 1,
            MinAmount: 1,
            Multiples: 1,
            Unit: "pcs",
            Parameters: [
              {
                ParameterId: 1,
                ParameterName: "Operating Temperature",
                ParameterValue: "-40...+85",
                ParameterUnit: "\xB0C"
              },
              {
                ParameterId: 2,
                ParameterName: "Package",
                ParameterValue: this.getMockPackage(categoryId),
                ParameterUnit: ""
              }
            ]
          });
        }
        const startIndex = (page - 1) * limit;
        const endIndex = startIndex + limit;
        return {
          products: mockProducts.slice(startIndex, endIndex),
          total: mockProducts.length
        };
      }
      getMockProducer(categoryId) {
        const producers = {
          "1000": ["Microchip", "STMicroelectronics", "Texas Instruments"],
          "1001": ["Arduino", "SparkFun", "Adafruit"],
          "2000": ["Infineon", "ON Semiconductor", "Vishay"],
          "3000": ["Osram", "Cree", "Lumileds"],
          "5000": ["Yageo", "Murata", "TDK"],
          "6000": ["Molex", "TE Connectivity", "JST"]
        };
        const categoryProducers = producers[categoryId] || ["Generic Electronics"];
        return categoryProducers[Math.floor(Math.random() * categoryProducers.length)];
      }
      getMockPackage(categoryId) {
        const packages = {
          "1000": ["TQFP-64", "QFN-32", "SOIC-20"],
          "1001": ["Through Hole", "Shield", "Module"],
          "2000": ["SOT-23", "TO-220", "SOIC-8"],
          "3000": ["0603", "5mm", "SMD"],
          "5000": ["0805", "1206", "Through Hole"],
          "6000": ["2.54mm", "1.27mm", "JST-XH"]
        };
        const categoryPackages = packages[categoryId] || ["Standard"];
        return categoryPackages[Math.floor(Math.random() * categoryPackages.length)];
      }
    };
    tmeApi = new TMEApiService();
  }
});

// server/ebay-oauth.ts
var ebay_oauth_exports = {};
__export(ebay_oauth_exports, {
  EbayOAuthService: () => EbayOAuthService,
  ebayOAuth: () => ebayOAuth
});
var EBAY_OAUTH_SCOPES, EbayOAuthService, ebayOAuth;
var init_ebay_oauth = __esm({
  "server/ebay-oauth.ts"() {
    "use strict";
    EBAY_OAUTH_SCOPES = [
      "https://api.ebay.com/oauth/api_scope",
      // Base scope for Trading API
      "https://api.ebay.com/oauth/api_scope/sell.account",
      // Business policies
      "https://api.ebay.com/oauth/api_scope/sell.account.readonly",
      "https://api.ebay.com/oauth/api_scope/sell.inventory",
      // Inventory management
      "https://api.ebay.com/oauth/api_scope/sell.inventory.readonly",
      "https://api.ebay.com/oauth/api_scope/sell.marketing",
      // Promotions
      "https://api.ebay.com/oauth/api_scope/sell.marketing.readonly",
      "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
      // Order fulfillment
      "https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly",
      "https://api.ebay.com/oauth/api_scope/sell.analytics.readonly"
    ].join(" ");
    EbayOAuthService = class {
      cachedToken = null;
      baseUrl = "https://api.ebay.com";
      sandboxUrl = "https://api.sandbox.ebay.com";
      isProduction = true;
      isConfigured = false;
      constructor() {
        this.checkConfiguration();
      }
      checkConfiguration() {
        const clientId = process.env.EBAY_OAUTH_CLIENT_ID || process.env.EBAY_APP_ID;
        const clientSecret = process.env.EBAY_OAUTH_CLIENT_SECRET || process.env.EBAY_CERT_ID;
        const refreshToken = process.env.EBAY_OAUTH_REFRESH_TOKEN || process.env.EBAY_REFRESH_TOKEN;
        this.isConfigured = !!(clientId && clientSecret && refreshToken);
        if (this.isConfigured) {
          console.log("\u2705 eBay OAuth Service initialized");
          console.log("   Unified OAuth for all eBay APIs (REST + Trading)");
        } else {
          console.log("\u26A0\uFE0F eBay OAuth not fully configured");
          console.log("   Required: EBAY_OAUTH_CLIENT_ID, EBAY_OAUTH_CLIENT_SECRET, EBAY_OAUTH_REFRESH_TOKEN");
        }
      }
      /**
       * Check if OAuth is properly configured
       */
      isOAuthConfigured() {
        return this.isConfigured;
      }
      getApiUrl() {
        return this.isProduction ? this.baseUrl : this.sandboxUrl;
      }
      getClientCredentials() {
        const clientId = process.env.EBAY_OAUTH_CLIENT_ID || process.env.EBAY_APP_ID || "";
        const clientSecret = process.env.EBAY_OAUTH_CLIENT_SECRET || process.env.EBAY_CERT_ID || "";
        const refreshToken = process.env.EBAY_OAUTH_REFRESH_TOKEN || process.env.EBAY_REFRESH_TOKEN || "";
        return { clientId, clientSecret, refreshToken };
      }
      /**
       * Check if cached token is still valid (with 5 minute buffer)
       */
      isTokenValid() {
        if (!this.cachedToken) return false;
        return Date.now() < this.cachedToken.expires_at - 3e5;
      }
      /**
       * Get a valid OAuth access token for REST API calls
       * Automatically refreshes if expired
       */
      async getValidAccessToken() {
        if (!this.isConfigured) {
          throw new Error(
            "eBay OAuth not configured. Set EBAY_OAUTH_CLIENT_ID, EBAY_OAUTH_CLIENT_SECRET, and EBAY_OAUTH_REFRESH_TOKEN."
          );
        }
        if (this.cachedToken && this.isTokenValid()) {
          return this.cachedToken.access_token;
        }
        await this.refreshAccessToken();
        return this.cachedToken.access_token;
      }
      /**
       * Get a valid OAuth token for Trading API calls (XML-based)
       * Uses the same OAuth token - Trading API accepts OAuth via X-EBAY-API-IAF-TOKEN header
       */
      async getTradingApiToken() {
        return this.getValidAccessToken();
      }
      /**
       * Refresh access token using refresh token
       */
      async refreshAccessToken() {
        const { clientId, clientSecret, refreshToken } = this.getClientCredentials();
        if (!refreshToken) {
          throw new Error("No refresh token available. Please re-authorize the application.");
        }
        const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
        const tokenUrl = `${this.getApiUrl()}/identity/v1/oauth2/token`;
        console.log("\u{1F504} Refreshing eBay OAuth access token...");
        try {
          const response = await fetch(tokenUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              "Authorization": `Basic ${credentials}`
            },
            body: new URLSearchParams({
              grant_type: "refresh_token",
              refresh_token: refreshToken,
              scope: EBAY_OAUTH_SCOPES
            }).toString()
          });
          if (!response.ok) {
            const errorText = await response.text();
            console.error("\u274C OAuth token refresh failed:", response.status, errorText);
            throw new Error(`eBay OAuth refresh failed: ${response.status} - ${errorText}`);
          }
          const tokenData = await response.json();
          this.cachedToken = {
            access_token: tokenData.access_token,
            refresh_token: tokenData.refresh_token || refreshToken,
            expires_in: tokenData.expires_in,
            token_type: tokenData.token_type || "Bearer",
            expires_at: Date.now() + tokenData.expires_in * 1e3
          };
          console.log("\u2705 eBay OAuth token refreshed successfully");
          console.log(`   Token expires in: ${tokenData.expires_in} seconds`);
        } catch (error) {
          console.error("\u274C Failed to refresh eBay OAuth token:", error);
          throw error;
        }
      }
      /**
       * Exchange authorization code for initial tokens (OAuth consent flow)
       */
      async exchangeCodeForTokens(authorizationCode, redirectUri) {
        const { clientId, clientSecret } = this.getClientCredentials();
        const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
        const response = await fetch(`${this.getApiUrl()}/identity/v1/oauth2/token`, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Authorization": `Basic ${credentials}`
          },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code: authorizationCode,
            redirect_uri: redirectUri
          }).toString()
        });
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`eBay OAuth exchange failed: ${response.status} - ${errorText}`);
        }
        const tokenData = await response.json();
        this.cachedToken = {
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token,
          expires_in: tokenData.expires_in,
          token_type: tokenData.token_type || "Bearer",
          expires_at: Date.now() + tokenData.expires_in * 1e3
        };
        console.log("\u2705 eBay OAuth tokens obtained successfully");
        console.log("   IMPORTANT: Save the refresh token to EBAY_OAUTH_REFRESH_TOKEN");
        console.log(`   Refresh Token: ${tokenData.refresh_token}`);
        return this.cachedToken;
      }
      /**
       * Generate OAuth authorization URL for user consent
       */
      generateAuthUrl(redirectUri, state) {
        const { clientId } = this.getClientCredentials();
        const params = new URLSearchParams({
          client_id: clientId,
          redirect_uri: redirectUri,
          response_type: "code",
          scope: EBAY_OAUTH_SCOPES,
          state: state || "ebay_auth_state"
        });
        return `https://auth.ebay.com/oauth2/authorize?${params.toString()}`;
      }
      /**
       * Get current token info for debugging
       */
      getTokenInfo() {
        return {
          configured: this.isConfigured,
          hasToken: !!this.cachedToken,
          isValid: this.isTokenValid(),
          expiresAt: this.cachedToken ? new Date(this.cachedToken.expires_at).toISOString() : void 0,
          expiresIn: this.cachedToken ? Math.floor((this.cachedToken.expires_at - Date.now()) / 1e3) : void 0
        };
      }
      /**
       * Force reload configuration (useful after env var changes)
       */
      reloadConfiguration() {
        this.cachedToken = null;
        this.checkConfiguration();
      }
    };
    ebayOAuth = new EbayOAuthService();
  }
});

// server/ebay-unified-template.ts
var ebay_unified_template_exports = {};
__export(ebay_unified_template_exports, {
  generateUnifiedEbayTemplate: () => generateUnifiedEbayTemplate
});
function generateUnifiedEbayTemplate(product) {
  const specs = extractProductSpecs(product);
  const category = determineCategory(product);
  return {
    title: generateUnifiedTitle(product, specs),
    description: generateUnifiedDescription(product, specs, category),
    htmlDescription: generateUnifiedHtmlDescription(product, specs, category)
  };
}
function generateUnifiedTitle(product, specs) {
  const name = product.name || "Electronic Component";
  const sku = product.sku ? ` - ${product.sku}` : "";
  const brand = specs.brand ? ` | ${specs.brand}` : "";
  const moq = product.moq || 1;
  const moqPrefix = moq > 1 ? `${moq}x ` : "";
  let title = `${moqPrefix}${name}${sku}${brand} | Fast EU Shipping`;
  if (title.length > 80) {
    title = `${moqPrefix}${name}${sku} | EU Stock`;
    if (title.length > 80) {
      const maxNameLen = 80 - moqPrefix.length - sku.length - " | EU Stock".length;
      const truncatedName = name.slice(0, Math.max(20, maxNameLen));
      title = `${moqPrefix}${truncatedName}${sku} | EU Stock`.slice(0, 80);
    }
  }
  return title;
}
function generateUnifiedDescription(product, specs, category) {
  const sections = [];
  const moq = product.moq || 1;
  const quantityInfo = moq > 1 ? ` (${moq} PCS PACK)` : "";
  sections.push(`\u{1F527} PROFESSIONAL ${(product.name || "ELECTRONIC COMPONENT").toUpperCase()}${quantityInfo}`);
  sections.push("");
  if (moq > 1) {
    sections.push(`\u{1F4E6} PACK QUANTITY: ${moq} PIECES`);
    sections.push(`\u{1F4B0} THIS LISTING IS FOR A PACK OF ${moq} UNITS`);
    sections.push("");
  }
  sections.push("\u2705 HIGH QUALITY ELECTRONIC COMPONENT");
  sections.push("\u2705 GENUINE MANUFACTURER SPECIFICATIONS");
  sections.push("\u2705 TECHNICAL DOCUMENTATION INCLUDED");
  sections.push("\u2705 DISPATCH FROM EU WAREHOUSE WITHIN 2-3 DAYS");
  sections.push("\u2705 PROFESSIONAL TECHNICAL SUPPORT");
  sections.push("");
  if (product.description) {
    sections.push("\u{1F4DD} PRODUCT DESCRIPTION:");
    sections.push(product.description);
    sections.push("");
  }
  sections.push("\u{1F4CB} TECHNICAL SPECIFICATIONS:");
  if (product.sku) sections.push(`\u2022 SKU: ${product.sku}`);
  if (product.ean) sections.push(`\u2022 EAN: ${product.ean}`);
  if (specs.voltage) sections.push(`\u2022 Voltage: ${specs.voltage}V`);
  if (specs.current) sections.push(`\u2022 Current: ${specs.current}A`);
  if (specs.power) sections.push(`\u2022 Power: ${specs.power}W`);
  if (specs.frequency) sections.push(`\u2022 Frequency: ${specs.frequency}MHz`);
  if (specs.temperature) sections.push(`\u2022 Operating Temperature: ${specs.temperature}\xB0C`);
  if (product.category) sections.push(`\u2022 Category: ${product.category}`);
  sections.push("");
  const applications = getCategoryApplications(category);
  if (applications.length > 0) {
    sections.push("\u{1F4A1} TYPICAL APPLICATIONS:");
    applications.forEach((app) => sections.push(`\u2022 ${app}`));
    sections.push("");
  }
  sections.push("\u{1F6E1}\uFE0F QUALITY ASSURANCE:");
  sections.push("\u2022 All products tested before dispatch");
  sections.push("\u2022 Genuine components from authorized suppliers");
  sections.push("\u2022 30-day return guarantee");
  sections.push("");
  sections.push("\u{1F69A} SHIPPING INFORMATION:");
  sections.push("\u2022 Usually dispatch in 2-3 days after order placed");
  sections.push("\u2022 Express delivery available for additional fee");
  sections.push("\u2022 Tracked delivery available");
  sections.push("\u2022 International shipping available");
  sections.push("");
  sections.push("\u{1F3E2} ABOUT US:");
  sections.push("Professional electronics supplier serving makers, engineers, and hobbyists.");
  sections.push("Specializing in high-quality electronic components with expert support.");
  sections.push("");
  sections.push("\u{1F4DE} NEED HELP? Contact our technical support team for assistance.");
  sections.push("\u{1F512} SECURE PAYMENT: All major payment methods accepted.");
  return sections.join("\n");
}
function generateUnifiedHtmlDescription(product, specs, category) {
  const applications = getCategoryApplications(category);
  const moq = product.moq || 1;
  const quantityInfo = moq > 1 ? ` (${moq} PCS PACK)` : "";
  const html = `
<div style="font-family: Arial, sans-serif; max-width: 700px; margin: 0 auto; color: #333;">
  
  <!-- Header -->
  <div style="background-color: #0066cc; color: white; padding: 15px; text-align: center; margin-bottom: 15px;">
    <h2 style="font-size: 20px; margin: 0;">\u{1F527} PROFESSIONAL ${(product.name || "ELECTRONIC COMPONENT").toUpperCase()}${quantityInfo}</h2>
  </div>
  
  ${moq > 1 ? `
  <!-- Pack Quantity Notice -->
  <div style="background-color: #fff3cd; border: 2px solid #ffc107; padding: 15px; margin-bottom: 15px; text-align: center;">
    <h3 style="color: #856404; margin: 0 0 5px 0; font-size: 18px;">\u{1F4E6} PACK OF ${moq} PIECES</h3>
    <p style="margin: 0; color: #856404; font-weight: bold;">This listing is for a pack of ${moq} units at the displayed price</p>
  </div>
  ` : ""}
  
  <!-- Quality Features -->
  <div style="background-color: #f0f8ff; border: 2px solid #0066cc; padding: 15px; margin-bottom: 15px;">
    <div style="font-weight: bold; color: #006600;">
      \u2705 HIGH QUALITY ELECTRONIC COMPONENT<br>
      \u2705 GENUINE MANUFACTURER SPECIFICATIONS<br>
      \u2705 TECHNICAL DOCUMENTATION INCLUDED<br>
      \u2705 DISPATCH FROM EU WAREHOUSE WITHIN 2-3 DAYS<br>
      \u2705 PROFESSIONAL TECHNICAL SUPPORT<br>
      \u2705 30-DAY RETURN GUARANTEE
    </div>
  </div>
  
  ${product.description ? `
  <!-- Product Description -->
  <div style="background-color: #ffffff; border: 1px solid #cccccc; padding: 15px; margin-bottom: 15px;">
    <h3 style="color: #0066cc; font-size: 16px; margin: 0 0 10px 0; border-bottom: 1px solid #0066cc;">\u{1F4DD} PRODUCT DESCRIPTION</h3>
    <p style="margin: 0; line-height: 1.4;">${product.description}</p>
  </div>
  ` : ""}
  
  <!-- Technical Specifications -->
  <div style="background-color: #ffffff; border: 1px solid #cccccc; padding: 15px; margin-bottom: 15px;">
    <h3 style="color: #0066cc; font-size: 16px; margin: 0 0 10px 0; border-bottom: 1px solid #0066cc;">\u{1F4CB} TECHNICAL SPECIFICATIONS</h3>
    <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
      ${product.sku ? `<tr><td style="padding: 3px 5px; font-weight: bold; width: 40%;">SKU:</td><td style="padding: 3px 5px;">${product.sku}</td></tr>` : ""}
      ${product.ean ? `<tr><td style="padding: 3px 5px; font-weight: bold; width: 40%;">EAN:</td><td style="padding: 3px 5px;">${product.ean}</td></tr>` : ""}
      ${specs.voltage ? `<tr><td style="padding: 3px 5px; font-weight: bold; width: 40%;">Voltage:</td><td style="padding: 3px 5px;">${specs.voltage}V</td></tr>` : ""}
      ${specs.current ? `<tr><td style="padding: 3px 5px; font-weight: bold; width: 40%;">Current:</td><td style="padding: 3px 5px;">${specs.current}A</td></tr>` : ""}
      ${specs.power ? `<tr><td style="padding: 3px 5px; font-weight: bold; width: 40%;">Power:</td><td style="padding: 3px 5px;">${specs.power}W</td></tr>` : ""}
      ${specs.frequency ? `<tr><td style="padding: 3px 5px; font-weight: bold; width: 40%;">Frequency:</td><td style="padding: 3px 5px;">${specs.frequency}MHz</td></tr>` : ""}
      ${specs.temperature ? `<tr><td style="padding: 3px 5px; font-weight: bold; width: 40%;">Operating Temperature:</td><td style="padding: 3px 5px;">${specs.temperature}\xB0C</td></tr>` : ""}
      ${product.category ? `<tr><td style="padding: 3px 5px; font-weight: bold; width: 40%;">Category:</td><td style="padding: 3px 5px;">${product.category}</td></tr>` : ""}
    </table>
  </div>
  
  
  ${applications.length > 0 ? `
  <!-- Applications -->
  <div style="background-color: #ffffff; border: 1px solid #cccccc; padding: 15px; margin-bottom: 15px;">
    <h3 style="color: #0066cc; font-size: 16px; margin: 0 0 10px 0; border-bottom: 1px solid #0066cc;">\u{1F4A1} TYPICAL APPLICATIONS</h3>
    <ul style="margin: 5px 0; padding-left: 20px;">
      ${applications.map((app) => `<li>${app}</li>`).join("")}
    </ul>
  </div>
  ` : ""}
  
  <!-- Quality Assurance -->
  <div style="background-color: #ffffff; border: 1px solid #cccccc; padding: 15px; margin-bottom: 15px;">
    <h3 style="color: #0066cc; font-size: 16px; margin: 0 0 10px 0; border-bottom: 1px solid #0066cc;">\u{1F6E1}\uFE0F QUALITY ASSURANCE</h3>
    <ul style="margin: 5px 0; padding-left: 20px; font-size: 14px;">
      <li>All products tested before dispatch</li>
      <li>Genuine components from authorized suppliers</li>
      <li>30-day return guarantee</li>
    </ul>
  </div>
  
  <!-- Shipping Information -->
  <div style="background-color: #ffffff; border: 1px solid #cccccc; padding: 15px; margin-bottom: 15px;">
    <h3 style="color: #0066cc; font-size: 16px; margin: 0 0 10px 0; border-bottom: 1px solid #0066cc;">\u{1F69A} SHIPPING INFORMATION</h3>
    <ul style="margin: 5px 0; padding-left: 20px; font-size: 14px;">
      <li>Usually dispatch in 2-3 days after order placed</li>
      <li>Express delivery available for additional fee</li>
      <li>Tracked delivery available</li>
      <li>International shipping available</li>
    </ul>
  </div>
  
  <!-- About Us -->
  <div style="background-color: #f8f9fa; border: 1px solid #cccccc; padding: 15px; margin-bottom: 15px;">
    <h3 style="color: #0066cc; font-size: 16px; margin: 0 0 10px 0;">\u{1F3E2} ABOUT US</h3>
    <p style="margin: 0; font-size: 14px; line-height: 1.4;">Professional electronics supplier serving makers, engineers, and hobbyists. Specializing in high-quality electronic components with expert support.</p>
  </div>
  
  <!-- Contact Footer -->
  <div style="background-color: #0066cc; color: white; padding: 15px; text-align: center;">
    <div style="font-size: 16px; font-weight: bold; margin-bottom: 5px;">\u{1F4DE} NEED HELP? Contact our technical support team for assistance.</div>
    <div style="font-size: 16px; font-weight: bold;">\u{1F512} SECURE PAYMENT: All major payment methods accepted.</div>
  </div>
  
</div>`;
  return html;
}
function extractProductSpecs(product) {
  const specs = {};
  const text2 = `${product.name || ""} ${product.description || ""}`.toLowerCase();
  const voltageMatch = text2.match(/(\d+(?:\.\d+)?)\s*v(?:olt)?/i);
  if (voltageMatch) specs.voltage = voltageMatch[1];
  const currentMatch = text2.match(/(\d+(?:\.\d+)?)\s*(?:ma|a|amp)/i);
  if (currentMatch) specs.current = currentMatch[1];
  const powerMatch = text2.match(/(\d+(?:\.\d+)?)\s*w(?:att)?/i);
  if (powerMatch) specs.power = powerMatch[1];
  const freqMatch = text2.match(/(\d+(?:\.\d+)?)\s*(?:hz|khz|mhz|ghz)/i);
  if (freqMatch) specs.frequency = freqMatch[1];
  const tempMatch = text2.match(/(-?\d+(?:\.\d+)?)\s*°?c/i);
  if (tempMatch) specs.temperature = tempMatch[1];
  if (text2.includes("arduino")) specs.brand = "Arduino";
  if (text2.includes("esp32")) specs.brand = "Espressif";
  if (text2.includes("raspberry")) specs.brand = "Raspberry Pi Foundation";
  return specs;
}
function determineCategory(product) {
  const text2 = `${product.name || ""} ${product.description || ""} ${product.category || ""}`.toLowerCase();
  if (text2.includes("arduino") || text2.includes("microcontroller") || text2.includes("esp32")) return "Microcontrollers";
  if (text2.includes("sensor") || text2.includes("temperature") || text2.includes("humidity")) return "Sensors";
  if (text2.includes("led") || text2.includes("light") || text2.includes("strip")) return "LED & Lighting";
  if (text2.includes("resistor") || text2.includes("capacitor") || text2.includes("inductor")) return "Passive Components";
  if (text2.includes("power") || text2.includes("supply") || text2.includes("battery")) return "Power Management";
  if (text2.includes("display") || text2.includes("lcd") || text2.includes("oled")) return "Displays";
  return "Electronics";
}
function getCategoryApplications(category) {
  const applicationMap = {
    "Microcontrollers": [
      "IoT and smart device projects",
      "Robotics and automation systems",
      "Educational and learning projects",
      "Prototyping and development",
      "Home automation systems"
    ],
    "Sensors": [
      "Environmental monitoring systems",
      "Weather stations and data logging",
      "Security and alarm systems",
      "Industrial automation",
      "Scientific measurement devices"
    ],
    "LED & Lighting": [
      "Decorative and ambient lighting",
      "Status indicators and displays",
      "Automotive lighting projects",
      "Architectural lighting systems",
      "Art and creative installations"
    ],
    "Passive Components": [
      "Circuit protection and filtering",
      "Signal conditioning circuits",
      "Power supply circuits",
      "Audio and RF applications",
      "Timing and oscillator circuits"
    ],
    "Power Management": [
      "Battery charging systems",
      "Voltage regulation circuits",
      "Solar power projects",
      "Portable device power supplies",
      "Energy harvesting applications"
    ],
    "Displays": [
      "Information displays and HMI",
      "Data visualization projects",
      "Digital signage systems",
      "Instrument panels",
      "Interactive displays"
    ]
  };
  return applicationMap[category] || [
    "Electronic circuit design",
    "Prototyping and development",
    "Educational projects",
    "Repair and maintenance",
    "Professional applications"
  ];
}
var init_ebay_unified_template = __esm({
  "server/ebay-unified-template.ts"() {
    "use strict";
  }
});

// server/shipping-policies.ts
var shipping_policies_exports = {};
__export(shipping_policies_exports, {
  DEFAULT_SHIPPING_POLICY_ID: () => DEFAULT_SHIPPING_POLICY_ID,
  DEFAULT_SHIPPING_POLICY_NAME: () => DEFAULT_SHIPPING_POLICY_NAME,
  SHIPPING_POLICIES: () => SHIPPING_POLICIES,
  assignShippingPolicies: () => assignShippingPolicies,
  generatePolicySummary: () => generatePolicySummary,
  getAllShippingPolicies: () => getAllShippingPolicies,
  getShippingPolicyById: () => getShippingPolicyById,
  getShippingPolicyByWeight: () => getShippingPolicyByWeight,
  getShippingPolicyId: () => getShippingPolicyId,
  getShippingPolicyName: () => getShippingPolicyName,
  validateShippingPolicies: () => validateShippingPolicies
});
function getShippingPolicyId(weightGrams) {
  if (weightGrams === null || weightGrams === void 0 || weightGrams <= 0) {
    console.log(`No weight specified, using default policy: ${DEFAULT_SHIPPING_POLICY_NAME} (${DEFAULT_SHIPPING_POLICY_ID})`);
    return DEFAULT_SHIPPING_POLICY_ID;
  }
  for (const policy of SHIPPING_POLICIES) {
    if (weightGrams >= policy.weightRange.min && weightGrams < policy.weightRange.max) {
      console.log(`Weight ${weightGrams}g matched to policy: ${policy.name} (eBay ID: ${policy.ebayPolicyId})`);
      return policy.ebayPolicyId;
    }
  }
  if (weightGrams >= 2001) {
    const heaviestPolicy = SHIPPING_POLICIES[SHIPPING_POLICIES.length - 1];
    console.warn(`Weight ${weightGrams}g exceeds max range, using heaviest policy: ${heaviestPolicy.name} (${heaviestPolicy.ebayPolicyId})`);
    return heaviestPolicy.ebayPolicyId;
  }
  console.warn(`Weight ${weightGrams}g outside all ranges, using default policy: ${DEFAULT_SHIPPING_POLICY_ID}`);
  return DEFAULT_SHIPPING_POLICY_ID;
}
function getShippingPolicyById(ebayPolicyId) {
  return SHIPPING_POLICIES.find((policy) => policy.ebayPolicyId === ebayPolicyId) || null;
}
function getShippingPolicyName(weightGrams) {
  const policyId = getShippingPolicyId(weightGrams);
  const policy = getShippingPolicyById(policyId);
  return policy?.name || DEFAULT_SHIPPING_POLICY_NAME;
}
function getShippingPolicyByWeight(weightGrams) {
  const policyId = getShippingPolicyId(weightGrams);
  return getShippingPolicyById(policyId);
}
function validateShippingPolicies() {
  const errors = [];
  for (let i = 0; i < SHIPPING_POLICIES.length; i++) {
    for (let j = i + 1; j < SHIPPING_POLICIES.length; j++) {
      const policy1 = SHIPPING_POLICIES[i];
      const policy2 = SHIPPING_POLICIES[j];
      if (!(policy1.weightRange.max < policy2.weightRange.min || policy2.weightRange.max < policy1.weightRange.min)) {
        errors.push(`Overlapping weight ranges: ${policy1.name} and ${policy2.name}`);
      }
    }
  }
  const sortedPolicies = [...SHIPPING_POLICIES].sort((a, b) => a.weightRange.min - b.weightRange.min);
  for (let i = 0; i < sortedPolicies.length - 1; i++) {
    const current = sortedPolicies[i];
    const next = sortedPolicies[i + 1];
    if (current.weightRange.max + 1 < next.weightRange.min) {
      errors.push(`Gap in weight coverage: ${current.weightRange.max + 1}g to ${next.weightRange.min - 1}g`);
    }
  }
  return {
    isValid: errors.length === 0,
    errors
  };
}
function getAllShippingPolicies() {
  return SHIPPING_POLICIES;
}
function assignShippingPolicies(products2) {
  return products2.map((product) => {
    const weightGrams = product.weight !== null ? product.weight : null;
    const policy = getShippingPolicyByWeight(weightGrams);
    return {
      productId: product.id,
      weight: product.weight,
      ebayPolicyId: getShippingPolicyId(weightGrams),
      policyName: policy?.name || DEFAULT_SHIPPING_POLICY_NAME,
      price: policy?.price || "\xA33.99"
    };
  });
}
function generatePolicySummary() {
  let summary = "eBay Weight-Based Shipping Policies:\n\n";
  SHIPPING_POLICIES.forEach((policy) => {
    summary += `${policy.name}
`;
    summary += `  eBay Policy ID: ${policy.ebayPolicyId}
`;
    summary += `  Weight Range: ${policy.weightRange.min}-${policy.weightRange.max}g
`;
    summary += `  Price: ${policy.price} (additional: ${policy.additionalItemPrice})
`;
    summary += `  Description: ${policy.description}

`;
  });
  summary += `Default Policy: ${DEFAULT_SHIPPING_POLICY_NAME} (${DEFAULT_SHIPPING_POLICY_ID})
`;
  summary += `Note: All policies exclude Belarus (BY) from shipping
`;
  const validation = validateShippingPolicies();
  if (!validation.isValid) {
    summary += "\nConfiguration Issues:\n";
    validation.errors.forEach((error) => {
      summary += `- ${error}
`;
    });
  }
  return summary;
}
var SHIPPING_POLICIES, DEFAULT_SHIPPING_POLICY_ID, DEFAULT_SHIPPING_POLICY_NAME;
var init_shipping_policies = __esm({
  "server/shipping-policies.ts"() {
    "use strict";
    SHIPPING_POLICIES = [
      {
        id: "policy_0_20",
        ebayPolicyId: process.env.EBAY_SHIPPING_POLICY_0_20GR || process.env.EBAY_SHIPPING_POLICY_0_99GR || "268493033019",
        name: "0-20gr",
        weightRange: { min: 0, max: 21 },
        description: "Tiny items: SMD parts, single resistors/capacitors",
        price: "5.79",
        additionalItemPrice: "1.00"
      },
      {
        id: "policy_21_100",
        ebayPolicyId: process.env.EBAY_SHIPPING_POLICY_21_100GR || "268493033019",
        name: "21-100gr",
        weightRange: { min: 21, max: 101 },
        description: "Light items: small ICs, connectors, sensors",
        price: "5.89",
        additionalItemPrice: "1.00"
      },
      {
        id: "policy_101_500",
        ebayPolicyId: process.env.EBAY_SHIPPING_POLICY_101_500GR || process.env.EBAY_SHIPPING_POLICY_100_499GR || "268493034019",
        name: "101-500gr",
        weightRange: { min: 101, max: 501 },
        description: "Small items: modules, small boards, cables",
        price: "7.09",
        additionalItemPrice: "1.00"
      },
      {
        id: "policy_501_1000",
        ebayPolicyId: process.env.EBAY_SHIPPING_POLICY_501_1000GR || process.env.EBAY_SHIPPING_POLICY_500_999GR || "268493035019",
        name: "501-1000gr",
        weightRange: { min: 501, max: 1001 },
        description: "Medium items: development boards, larger modules",
        price: "9.39",
        additionalItemPrice: "2.00"
      },
      {
        id: "policy_1001_2000",
        ebayPolicyId: process.env.EBAY_SHIPPING_POLICY_1001_2000GR || process.env.EBAY_SHIPPING_POLICY_1000_1999GR || "268493036019",
        name: "1001-2000gr",
        weightRange: { min: 1001, max: 2001 },
        description: "Heavy items: power supplies, kits, bulk components",
        price: "10.99",
        additionalItemPrice: "5.00"
      }
    ];
    DEFAULT_SHIPPING_POLICY_ID = process.env.EBAY_SHIPPING_POLICY_0_20GR || process.env.EBAY_SHIPPING_POLICY_0_99GR || "268493033019";
    DEFAULT_SHIPPING_POLICY_NAME = "0-20gr";
  }
});

// server/dynamic-pricing.ts
var dynamic_pricing_exports = {};
__export(dynamic_pricing_exports, {
  PRICING_CONFIG: () => PRICING_CONFIG,
  calculateBulkPricing: () => calculateBulkPricing,
  calculateDynamicPrice: () => calculateDynamicPrice,
  calculatePackagePrice: () => calculatePackagePrice,
  formatPrice: () => formatPrice,
  formatQuantityLabel: () => formatQuantityLabel,
  generatePricingSummary: () => generatePricingSummary,
  getPricingTierInfo: () => getPricingTierInfo,
  getPricingTiers: () => getPricingTiers,
  getSupplierPriceForMoq: () => getSupplierPriceForMoq,
  validatePricingConfig: () => validatePricingConfig
});
function calculateDynamicPrice(supplierPrice) {
  const errors = [];
  const numericPrice = typeof supplierPrice === "string" ? parseFloat(supplierPrice) : supplierPrice;
  if (isNaN(numericPrice) || numericPrice <= 0) {
    return {
      supplierPrice: 0,
      calculatedPrice: 0,
      finalPrice: 0,
      marginTier: "",
      marginPercentage: 0,
      multiplier: 0,
      isValid: false,
      errors: ["Invalid supplier price: must be a positive number"]
    };
  }
  const tier = PRICING_CONFIG.tiers.find((t) => numericPrice >= t.min && numericPrice <= t.max);
  if (!tier) {
    return {
      supplierPrice: numericPrice,
      calculatedPrice: 0,
      finalPrice: 0,
      marginTier: "",
      marginPercentage: 0,
      multiplier: 0,
      isValid: false,
      errors: [`No pricing tier found for supplier price \u20AC${numericPrice.toFixed(2)}`]
    };
  }
  const calculatedPrice = numericPrice * tier.multiplier;
  let finalPrice = calculatedPrice;
  if (calculatedPrice < PRICING_CONFIG.minPrice) {
    finalPrice = PRICING_CONFIG.minPrice;
    errors.push(`Price adjusted to minimum: \u20AC${PRICING_CONFIG.minPrice.toFixed(2)}`);
  }
  if (calculatedPrice > PRICING_CONFIG.maxPrice) {
    finalPrice = PRICING_CONFIG.maxPrice;
    errors.push(`Price capped at maximum: \u20AC${PRICING_CONFIG.maxPrice.toFixed(2)}`);
  }
  finalPrice = applyRoundingRule(finalPrice, PRICING_CONFIG.roundingRule);
  return {
    supplierPrice: numericPrice,
    calculatedPrice,
    finalPrice,
    marginTier: tier.label,
    marginPercentage: tier.marginPercentage,
    multiplier: tier.multiplier,
    isValid: true,
    errors
  };
}
function applyRoundingRule(price, rule) {
  switch (rule) {
    case "nearest_99":
      return Math.floor(price) + 0.99;
    case "nearest_05":
      return Math.round(price * 20) / 20;
    case "no_rounding":
    default:
      return Math.round(price * 100) / 100;
  }
}
function calculateBulkPricing(products2) {
  return products2.map((product) => ({
    id: product.id,
    result: calculateDynamicPrice(product.supplierPrice)
  }));
}
function getPricingTierInfo(supplierPrice) {
  return PRICING_CONFIG.tiers.find((t) => supplierPrice >= t.min && supplierPrice <= t.max) || null;
}
function getPricingTiers() {
  return PRICING_CONFIG.tiers;
}
function validatePricingConfig() {
  const errors = [];
  for (let i = 0; i < PRICING_CONFIG.tiers.length - 1; i++) {
    const current = PRICING_CONFIG.tiers[i];
    const next = PRICING_CONFIG.tiers[i + 1];
    if (current.max >= next.min) {
      errors.push(`Tier overlap: ${current.label} (max: ${current.max}) overlaps with ${next.label} (min: ${next.min})`);
    }
  }
  for (let i = 0; i < PRICING_CONFIG.tiers.length - 1; i++) {
    const current = PRICING_CONFIG.tiers[i];
    const next = PRICING_CONFIG.tiers[i + 1];
    if (current.max + 0.01 < next.min) {
      errors.push(`Tier gap: Range \u20AC${(current.max + 0.01).toFixed(2)} to \u20AC${(next.min - 0.01).toFixed(2)} not covered`);
    }
  }
  return {
    isValid: errors.length === 0,
    errors
  };
}
function formatPrice(price) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(price);
}
function generatePricingSummary(supplierPrice) {
  const result = calculateDynamicPrice(supplierPrice);
  if (!result.isValid) {
    return `Error: ${result.errors.join(", ")}`;
  }
  const profit = result.finalPrice - result.supplierPrice;
  const actualMargin = (profit / result.supplierPrice * 100).toFixed(1);
  return `${formatPrice(result.supplierPrice)} \u2192 ${formatPrice(result.finalPrice)} (${result.marginTier}, ${actualMargin}% margin)`;
}
function calculatePackagePrice(unitSupplierPrice, moq = 1, multiples = 1) {
  const numericUnitPrice = typeof unitSupplierPrice === "string" ? parseFloat(unitSupplierPrice) : unitSupplierPrice;
  const packageSupplierPrice = Math.round(numericUnitPrice * moq * 100) / 100;
  const packageResult = calculateDynamicPrice(packageSupplierPrice);
  if (!packageResult.isValid) {
    return {
      ...packageResult,
      moq,
      multiples,
      packageSupplierPrice: 0,
      packageFinalPrice: 0,
      pricePerUnit: 0,
      quantityLabel: formatQuantityLabel(moq)
    };
  }
  const packageFinalPrice = packageResult.finalPrice;
  const pricePerUnit = Math.round(packageFinalPrice / moq * 100) / 100;
  return {
    // Override supplier price to show per-unit for reference
    supplierPrice: numericUnitPrice,
    calculatedPrice: packageResult.calculatedPrice,
    finalPrice: packageFinalPrice,
    // This is the eBay listing price
    marginTier: packageResult.marginTier,
    marginPercentage: packageResult.marginPercentage,
    multiplier: packageResult.multiplier,
    isValid: true,
    errors: packageResult.errors,
    moq,
    multiples,
    packageSupplierPrice,
    packageFinalPrice,
    pricePerUnit,
    quantityLabel: formatQuantityLabel(moq)
  };
}
function formatQuantityLabel(quantity) {
  if (quantity <= 1) return "";
  return `${quantity}x`;
}
function getSupplierPriceForMoq(priceList, moq = 1) {
  if (!priceList || priceList.length === 0) {
    return 0;
  }
  const sortedPrices = [...priceList].sort((a, b) => a.Amount - b.Amount);
  let applicablePrice = sortedPrices[0]?.PriceValue || 0;
  for (const tier of sortedPrices) {
    if (tier.Amount <= moq) {
      applicablePrice = tier.PriceValue;
    } else {
      break;
    }
  }
  return applicablePrice;
}
var PRICING_CONFIG;
var init_dynamic_pricing = __esm({
  "server/dynamic-pricing.ts"() {
    "use strict";
    PRICING_CONFIG = {
      tiers: [
        // Low-cost component tiers for resistors, capacitors, etc. (reduced margins)
        { min: 1e-3, max: 0.05, multiplier: 10, label: "Micro Components", marginPercentage: 900 },
        { min: 0.05, max: 0.25, multiplier: 6, label: "Small Components", marginPercentage: 500 },
        { min: 0.25, max: 1, multiplier: 5, label: "Low Cost", marginPercentage: 400 },
        { min: 1, max: 5, multiplier: 4, label: "Budget", marginPercentage: 300 },
        { min: 5.01, max: 9.99, multiplier: 4, label: "Very High", marginPercentage: 300 },
        { min: 10, max: 15, multiplier: 3, label: "High", marginPercentage: 200 },
        { min: 15.01, max: 25, multiplier: 2.5, label: "Medium-High", marginPercentage: 150 },
        { min: 25.01, max: 50, multiplier: 2, label: "Medium", marginPercentage: 100 },
        { min: 50.01, max: 100, multiplier: 1.75, label: "Low-Medium", marginPercentage: 75 },
        { min: 100.01, max: 999999, multiplier: 1.5, label: "Low", marginPercentage: 50 }
      ],
      minPrice: 2,
      maxPrice: 1e4,
      roundingRule: "nearest_99"
    };
  }
});

// server/app.ts
init_db();
import express from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";

// server/routes.ts
init_storage();
init_schema();
init_tme_api();
import { createServer } from "http";
import { ZodError } from "zod";
import bcrypt2 from "bcryptjs";

// server/ebay-api.ts
init_storage();
init_ebay_oauth();

// server/ebay-listing-template.ts
function generateEbayListing(product) {
  const specs = parseProductSpecs(product);
  const category = determineProductCategory(product);
  return {
    title: generateTitle(product, specs),
    description: generateDescription(product, specs, category),
    htmlDescription: generateHtmlDescription(product, specs, category),
    subtitle: generateSubtitle(product, specs),
    keywords: generateKeywords(product, specs, category)
  };
}
function generateTitle(product, specs) {
  let name = product.name || "Electronic Component";
  const manufacturer = specs.manufacturer || specs.brand || "";
  const model = specs.model || specs.partNumber || "";
  const category = specs.category || "Electronics";
  if (product.isMultipack && product.minOrderQuantity && product.minOrderQuantity > 1) {
    if (!name.match(/^\d+x\s/)) {
      name = `${product.minOrderQuantity}x ${name}`;
    }
  }
  const components = [
    name,
    model ? `- ${model}` : "",
    manufacturer ? `| ${manufacturer}` : "",
    "| Fast EU Shipping"
  ].filter(Boolean);
  let title = components.join(" ");
  if (title.length > 80) {
    title = `${name} ${model} | ${manufacturer} | EU Stock`.slice(0, 80);
  }
  return title;
}
function generateSubtitle(product, specs) {
  const features = [];
  if (specs.voltage) features.push(`${specs.voltage}V`);
  if (specs.current) features.push(`${specs.current}A`);
  if (specs.power) features.push(`${specs.power}W`);
  if (specs.frequency) features.push(`${specs.frequency}Hz`);
  const subtitle = features.length > 0 ? `Professional Grade | ${features.slice(0, 2).join(" | ")}` : "Professional Electronics | Fast Dispatch";
  return subtitle.slice(0, 55);
}
function generateDescription(product, specs, category) {
  const sections = [];
  sections.push(`\u{1F527} PROFESSIONAL ${(product.name || "").toUpperCase()}`);
  sections.push("\u2705 High quality electronic component");
  sections.push("\u2705 Genuine manufacturer specifications");
  sections.push("\u2705 Technical documentation included");
  sections.push("\u2705 Dispatch from EU warehouse within 2-3 days");
  sections.push("");
  sections.push("\u{1F4CB} TECHNICAL SPECIFICATIONS:");
  Object.entries(specs).forEach(([key, value]) => {
    if (value && isValidSpec(key)) {
      sections.push(`\u2022 ${formatSpecName(key)}: ${value}`);
    }
  });
  sections.push("");
  sections.push("\u{1F3ED} MANUFACTURER INFORMATION:");
  if (specs.manufacturer) sections.push(`Brand: ${specs.manufacturer}`);
  if (specs.model) sections.push(`Model: ${specs.model}`);
  if (specs.partNumber) sections.push(`Part Number: ${specs.partNumber}`);
  if (product.sku) sections.push(`SKU: ${product.sku}`);
  if (product.ean) sections.push(`EAN: ${product.ean}`);
  sections.push("");
  sections.push("\u{1F4E6} PACKAGE CONTENTS:");
  if (product.isMultipack && product.minOrderQuantity && product.minOrderQuantity > 1) {
    const baseProductName = product.name?.replace(/^\d+x\s/, "") || "Electronic Component";
    sections.push(`**THIS IS A PACK OF ${product.minOrderQuantity} PIECES**`);
    sections.push(`\u2022 ${product.minOrderQuantity}x ${baseProductName}`);
    sections.push(`\u2022 Sold as a complete pack only`);
    sections.push(`\u2022 Cannot be split or sold individually`);
    const perPiecePrice = (parseFloat(product.salePrice) / product.minOrderQuantity).toFixed(2);
    sections.push(`\u2022 Effective price per piece: \u20AC${perPiecePrice}`);
  } else {
    sections.push(`\u2022 1x ${product.name || "Electronic Component"}`);
  }
  if (specs.accessories) {
    specs.accessories.toString().split(",").forEach((accessory) => {
      sections.push(`\u2022 ${accessory.trim()}`);
    });
  }
  sections.push("\u2022 Technical datasheet (PDF)");
  sections.push("");
  const applications = getApplications(category);
  if (applications.length > 0) {
    sections.push("\u{1F4A1} TYPICAL APPLICATIONS:");
    applications.forEach((app) => sections.push(`\u2022 ${app}`));
    sections.push("");
  }
  sections.push("\u{1F69A} FAST EU SHIPPING | \u{1F4DE} TECHNICAL SUPPORT | \u{1F4AF} QUALITY GUARANTEE");
  sections.push("");
  sections.push("Professional electronics supplier serving makers, engineers, and hobbyists.");
  sections.push("All products tested and verified before dispatch.");
  return sections.join("\n");
}
function generateHtmlDescription(product, specs, category) {
  const plainDescription = generateDescription(product, specs, category);
  let html = plainDescription.replace(/🔧 PROFESSIONAL (.*)/g, '<h2 style="color: #0066cc;">\u{1F527} $1</h2>').replace(/📋 TECHNICAL SPECIFICATIONS:/g, '<h3 style="color: #333;">\u{1F4CB} TECHNICAL SPECIFICATIONS:</h3>').replace(/🏭 MANUFACTURER INFORMATION:/g, '<h3 style="color: #333;">\u{1F3ED} MANUFACTURER INFORMATION:</h3>').replace(/📦 PACKAGE CONTENTS:/g, '<h3 style="color: #333;">\u{1F4E6} PACKAGE CONTENTS:</h3>').replace(/💡 TYPICAL APPLICATIONS:/g, '<h3 style="color: #333;">\u{1F4A1} TYPICAL APPLICATIONS:</h3>').replace(/✅ (.*)/g, '<div style="color: #009900;">\u2705 $1</div>').replace(/• (.*)/g, "<li>$1</li>").replace(/\n\n/g, "</ul><br><ul>").replace(/\n/g, "");
  return `
    <div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto;">
      ${html}
      <br><br>
      <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; text-align: center;">
        <strong>\u{1F69A} FAST EU SHIPPING | \u{1F4DE} TECHNICAL SUPPORT | \u{1F4AF} QUALITY GUARANTEE</strong>
      </div>
    </div>
  `;
}
function generateKeywords(product, specs, category) {
  const keywords = /* @__PURE__ */ new Set();
  if (product.name) {
    product.name.split(/\s+/).forEach((word) => {
      if (word.length > 2) keywords.add(word.toLowerCase());
    });
  }
  Object.values(specs).forEach((value) => {
    if (typeof value === "string" && value.length > 2) {
      keywords.add(value.toLowerCase());
    }
  });
  keywords.add(category.toLowerCase());
  keywords.add("electronics");
  keywords.add("component");
  keywords.add("arduino");
  keywords.add("raspberry pi");
  keywords.add("diy");
  keywords.add("maker");
  keywords.add("engineering");
  return Array.from(keywords).slice(0, 20);
}
function parseProductSpecs(product) {
  const specs = {};
  const text2 = `${product.name || ""} ${product.description || ""}`.toLowerCase();
  const voltageMatch = text2.match(/(\d+(?:\.\d+)?)\s*v(?:olt)?/i);
  if (voltageMatch) specs.voltage = voltageMatch[1];
  const currentMatch = text2.match(/(\d+(?:\.\d+)?)\s*(?:ma|a|amp)/i);
  if (currentMatch) specs.current = currentMatch[1];
  const powerMatch = text2.match(/(\d+(?:\.\d+)?)\s*w(?:att)?/i);
  if (powerMatch) specs.power = powerMatch[1];
  const freqMatch = text2.match(/(\d+(?:\.\d+)?)\s*(?:hz|khz|mhz|ghz)/i);
  if (freqMatch) specs.frequency = freqMatch[1];
  const tempMatch = text2.match(/(-?\d+(?:\.\d+)?)\s*°?c/i);
  if (tempMatch) specs.operatingTemp = tempMatch[1];
  if (product.description?.includes("Arduino")) specs.manufacturer = "Arduino";
  if (product.description?.includes("Raspberry")) specs.manufacturer = "Raspberry Pi Foundation";
  if (product.name?.includes("ESP32")) specs.manufacturer = "Espressif";
  if (product.sku) specs.partNumber = product.sku;
  if (product.ean) specs.ean = product.ean;
  return specs;
}
function determineProductCategory(product) {
  const text2 = `${product.name || ""} ${product.description || ""}`.toLowerCase();
  if (text2.includes("arduino") || text2.includes("microcontroller")) return "Microcontrollers";
  if (text2.includes("sensor") || text2.includes("temperature") || text2.includes("humidity")) return "Sensors";
  if (text2.includes("led") || text2.includes("light")) return "LED & Lighting";
  if (text2.includes("resistor") || text2.includes("capacitor") || text2.includes("inductor")) return "Passive Components";
  if (text2.includes("ic") || text2.includes("chip") || text2.includes("processor")) return "Integrated Circuits";
  if (text2.includes("connector") || text2.includes("cable") || text2.includes("wire")) return "Connectors & Cables";
  if (text2.includes("power") || text2.includes("supply") || text2.includes("battery")) return "Power Management";
  if (text2.includes("display") || text2.includes("lcd") || text2.includes("oled")) return "Displays";
  return "Electronics";
}
function getApplications(category) {
  const applicationMap = {
    "Microcontrollers": [
      "IoT projects and smart devices",
      "Robotics and automation",
      "Prototyping and development",
      "Educational projects",
      "Home automation systems"
    ],
    "Sensors": [
      "Environmental monitoring",
      "Weather stations",
      "Security systems",
      "Industrial automation",
      "Scientific instruments"
    ],
    "LED & Lighting": [
      "Indicator lights",
      "Decorative lighting",
      "Status displays",
      "Automotive applications",
      "Architectural lighting"
    ],
    "Passive Components": [
      "Circuit protection",
      "Signal filtering",
      "Power conditioning",
      "Timing circuits",
      "Impedance matching"
    ],
    "Power Management": [
      "Battery charging",
      "Voltage regulation",
      "Power conversion",
      "Energy harvesting",
      "Portable devices"
    ]
  };
  return applicationMap[category] || [
    "Electronic projects",
    "Prototyping",
    "Repair and maintenance",
    "Educational use",
    "Professional development"
  ];
}
function isValidSpec(key) {
  const irrelevantKeys = ["id", "createdAt", "updatedAt", "description", "name"];
  return !irrelevantKeys.includes(key) && key.length > 1;
}
function formatSpecName(key) {
  const nameMap = {
    "partNumber": "Part Number",
    "operatingTemp": "Operating Temperature",
    "voltage": "Operating Voltage",
    "current": "Current Rating",
    "power": "Power Rating",
    "frequency": "Frequency",
    "manufacturer": "Manufacturer",
    "model": "Model",
    "ean": "EAN Code"
  };
  return nameMap[key] || key.replace(/([A-Z])/g, " $1").replace(/^./, (str) => str.toUpperCase());
}

// server/stock-manager.ts
function calculateEbayStock(product) {
  const tmeStock = product.stock;
  const ebayLimit = product.ebayStockLimit || 2;
  const useLimit = product.useStockLimit !== false;
  if (!useLimit) {
    return {
      tmeStock,
      ebayStock: tmeStock,
      isLimited: false,
      limitReason: "Stock limit disabled for this product"
    };
  }
  if (tmeStock === 0) {
    return {
      tmeStock: 0,
      ebayStock: 0,
      isLimited: false,
      limitReason: "Out of stock"
    };
  }
  if (tmeStock <= ebayLimit) {
    return {
      tmeStock,
      ebayStock: tmeStock,
      isLimited: false,
      limitReason: "TME stock below eBay limit"
    };
  }
  return {
    tmeStock,
    ebayStock: ebayLimit,
    isLimited: true,
    limitReason: `Limited to ${ebayLimit} units to preserve eBay account limits`
  };
}
function calculateBulkEbayStock(products2) {
  return products2.map((product) => ({
    id: product.id,
    stockInfo: calculateEbayStock(product)
  }));
}
function validateStockLimit(limit) {
  if (!Number.isInteger(limit) || limit < 1) {
    return { valid: false, error: "Stock limit must be a positive integer" };
  }
  if (limit > 999) {
    return { valid: false, error: "Stock limit cannot exceed 999 units" };
  }
  return { valid: true };
}
function getRecommendedStockLimit(category) {
  const categoryLimits = {
    "Arduino Boards": 3,
    "Development Boards": 3,
    "Microcontrollers": 5,
    "Sensors": 10,
    "Electronic Components": 15,
    "Resistors": 25,
    "Capacitors": 25,
    "LEDs": 20,
    "Connectors": 10,
    "Default": 3
  };
  return categoryLimits[category] || categoryLimits["Default"];
}

// server/tme-ebay-category-mapping.ts
var TME_EBAY_CATEGORY_MAPPINGS = [
  // Arduino and Development Boards
  {
    tmeCategory: "Development Boards",
    tmeCategoryKeywords: ["arduino", "development", "board", "evaluation", "dev board", "microcontroller board"],
    ebayCategory: "58277",
    // Electronic Components - Other
    ebayCategoryName: "Electronic Components - Other",
    confidence: 9
  },
  {
    tmeCategory: "Arduino Compatible",
    tmeCategoryKeywords: ["arduino", "uno", "nano", "mega", "leonardo", "pro mini"],
    ebayCategory: "58277",
    ebayCategoryName: "Electronic Components - Other",
    confidence: 10
  },
  // Microcontrollers and Processors
  {
    tmeCategory: "Microcontrollers",
    tmeCategoryKeywords: ["microcontroller", "mcu", "pic", "atmega", "esp32", "esp8266", "stm32"],
    ebayCategory: "58277",
    ebayCategoryName: "Electronic Components - Other",
    confidence: 9
  },
  {
    tmeCategory: "Processors",
    tmeCategoryKeywords: ["processor", "cpu", "arm", "cortex", "risc"],
    ebayCategory: "58277",
    ebayCategoryName: "Electronic Components - Other",
    confidence: 8
  },
  // Passive Components
  {
    tmeCategory: "Resistors",
    tmeCategoryKeywords: ["resistor", "resistance", "ohm", "carbon", "metal film", "precision"],
    ebayCategory: "58277",
    ebayCategoryName: "Electronic Components - Other",
    confidence: 10
  },
  {
    tmeCategory: "Capacitors",
    tmeCategoryKeywords: ["capacitor", "ceramic", "electrolytic", "tantalum", "film", "farad", "uf", "pf"],
    ebayCategory: "58277",
    ebayCategoryName: "Electronic Components - Other",
    confidence: 10
  },
  {
    tmeCategory: "Inductors",
    tmeCategoryKeywords: ["inductor", "coil", "choke", "henry", "ferrite"],
    ebayCategory: "58277",
    ebayCategoryName: "Electronic Components - Other",
    confidence: 9
  },
  // Semiconductors
  {
    tmeCategory: "Transistors",
    tmeCategoryKeywords: ["transistor", "bjt", "fet", "mosfet", "jfet", "igbt", "npn", "pnp"],
    ebayCategory: "58277",
    ebayCategoryName: "Electronic Components - Other",
    confidence: 10
  },
  {
    tmeCategory: "Diodes",
    tmeCategoryKeywords: ["diode", "led", "zener", "schottky", "rectifier", "photodiode"],
    ebayCategory: "58277",
    ebayCategoryName: "Electronic Components - Other",
    confidence: 10
  },
  {
    tmeCategory: "THT universal diodes",
    tmeCategoryKeywords: ["diode", "rectifying", "tht", "through hole", "universal", "silicon"],
    ebayCategory: "58277",
    ebayCategoryName: "Electronic Components - Other",
    confidence: 10
  },
  {
    tmeCategory: "SMD diodes",
    tmeCategoryKeywords: ["diode", "smd", "surface mount", "rectifying", "switching"],
    ebayCategory: "58277",
    ebayCategoryName: "Electronic Components - Other",
    confidence: 10
  },
  {
    tmeCategory: "Diacs",
    tmeCategoryKeywords: ["diac", "trigger", "bidirectional", "thyristor trigger"],
    ebayCategory: "58277",
    ebayCategoryName: "Electronic Components - Other",
    confidence: 10
  },
  {
    tmeCategory: "Integrated Circuits",
    tmeCategoryKeywords: ["ic", "integrated circuit", "amplifier", "regulator", "timer", "logic", "analog"],
    ebayCategory: "58277",
    ebayCategoryName: "Electronic Components - Other",
    confidence: 9
  },
  // Sensors
  {
    tmeCategory: "Sensors",
    tmeCategoryKeywords: ["sensor", "temperature", "humidity", "pressure", "accelerometer", "gyroscope", "proximity"],
    ebayCategory: "58277",
    ebayCategoryName: "Electronic Components - Other",
    confidence: 9
  },
  // Displays and Optoelectronics
  {
    tmeCategory: "Displays",
    tmeCategoryKeywords: ["display", "lcd", "oled", "tft", "segment", "matrix", "screen"],
    ebayCategory: "58277",
    ebayCategoryName: "Electronic Components - Other",
    confidence: 8
  },
  {
    tmeCategory: "LEDs",
    tmeCategoryKeywords: ["led", "light emitting", "rgb", "strip", "module"],
    ebayCategory: "58277",
    ebayCategoryName: "Electronic Components - Other",
    confidence: 9
  },
  // Connectors and Hardware
  {
    tmeCategory: "Connectors",
    tmeCategoryKeywords: ["connector", "header", "socket", "terminal", "plug", "jack", "usb", "hdmi"],
    ebayCategory: "58277",
    ebayCategoryName: "Electronic Components - Other",
    confidence: 8
  },
  {
    tmeCategory: "Cables",
    tmeCategoryKeywords: ["cable", "wire", "jumper", "dupont", "ribbon"],
    ebayCategory: "58277",
    ebayCategoryName: "Electronic Components - Other",
    confidence: 7
  },
  // Audio and Sound Equipment
  {
    tmeCategory: "Electromagnetic Sounders with Generator",
    tmeCategoryKeywords: ["sound", "transducer", "siren", "buzzer", "alarm", "speaker", "sounder", "electromagnetic"],
    ebayCategory: "58277",
    ebayCategoryName: "Electronic Components - Other",
    confidence: 9
  },
  {
    tmeCategory: "Sound Equipment",
    tmeCategoryKeywords: ["sound", "audio", "speaker", "microphone", "buzzer", "siren", "alarm", "transducer", "sounder"],
    ebayCategory: "58277",
    ebayCategoryName: "Electronic Components - Other",
    confidence: 9
  },
  {
    tmeCategory: "Speakers",
    tmeCategoryKeywords: ["speaker", "woofer", "tweeter", "driver", "audio", "sound"],
    ebayCategory: "58277",
    ebayCategoryName: "Electronic Components - Other",
    confidence: 8
  },
  // Switches and Controls
  {
    tmeCategory: "Switches",
    tmeCategoryKeywords: ["switch", "button", "toggle", "rotary", "push", "tactile"],
    ebayCategory: "58277",
    ebayCategoryName: "Electronic Components - Other",
    confidence: 8
  },
  {
    tmeCategory: "Potentiometers",
    tmeCategoryKeywords: ["potentiometer", "variable resistor", "trim", "rotary", "linear"],
    ebayCategory: "58277",
    ebayCategoryName: "Electronic Components - Other",
    confidence: 9
  },
  // Power Components
  {
    tmeCategory: "Power Supplies",
    tmeCategoryKeywords: ["power supply", "adapter", "converter", "regulator", "psu"],
    ebayCategory: "58277",
    ebayCategoryName: "Electronic Components - Other",
    confidence: 8
  },
  {
    tmeCategory: "Batteries",
    tmeCategoryKeywords: ["battery", "cell", "lithium", "alkaline", "rechargeable"],
    ebayCategory: "58277",
    ebayCategoryName: "Electronic Components - Other",
    confidence: 7
  },
  // Communication and Wireless
  {
    tmeCategory: "Communication",
    tmeCategoryKeywords: ["wifi", "bluetooth", "zigbee", "lora", "gsm", "gps", "antenna"],
    ebayCategory: "58277",
    ebayCategoryName: "Electronic Components - Other",
    confidence: 8
  },
  // Tools and Equipment
  {
    tmeCategory: "Tools",
    tmeCategoryKeywords: ["soldering", "multimeter", "oscilloscope", "breadboard", "pcb"],
    ebayCategory: "58277",
    ebayCategoryName: "Electronic Components - Other",
    confidence: 7
  },
  // Advanced Microprocessors and Computing
  {
    tmeCategory: "ARM Microprocessors",
    tmeCategoryKeywords: ["arm", "cortex", "microprocessor", "cpu", "processor"],
    ebayCategory: "58277",
    ebayCategoryName: "Electronic Components - Other",
    confidence: 9
  },
  {
    tmeCategory: "Microchip Microprocessors",
    tmeCategoryKeywords: ["microchip", "pic", "dspic", "processor", "mcu"],
    ebayCategory: "58277",
    ebayCategoryName: "Electronic Components - Other",
    confidence: 9
  },
  {
    tmeCategory: "Single Board Computers",
    tmeCategoryKeywords: ["sbc", "single board", "computer", "raspberry", "computing"],
    ebayCategory: "58277",
    ebayCategoryName: "Electronic Components - Other",
    confidence: 8
  },
  // Communication Modules
  {
    tmeCategory: "WiFi Modules",
    tmeCategoryKeywords: ["wifi", "wireless", "802.11", "wlan", "esp"],
    ebayCategory: "58277",
    ebayCategoryName: "Electronic Components - Other",
    confidence: 9
  },
  {
    tmeCategory: "Bluetooth Modules",
    tmeCategoryKeywords: ["bluetooth", "ble", "wireless", "bt"],
    ebayCategory: "58277",
    ebayCategoryName: "Electronic Components - Other",
    confidence: 9
  },
  {
    tmeCategory: "LoRa Modules",
    tmeCategoryKeywords: ["lora", "lorawan", "long range", "lpwan"],
    ebayCategory: "58277",
    ebayCategoryName: "Electronic Components - Other",
    confidence: 8
  },
  {
    tmeCategory: "GSM/GPRS Modules",
    tmeCategoryKeywords: ["gsm", "gprs", "cellular", "sim", "mobile"],
    ebayCategory: "58277",
    ebayCategoryName: "Electronic Components - Other",
    confidence: 8
  },
  {
    tmeCategory: "GNSS (GPS) modules",
    tmeCategoryKeywords: ["gps", "gnss", "navigation", "positioning", "location"],
    ebayCategory: "58277",
    ebayCategoryName: "Electronic Components - Other",
    confidence: 8
  },
  // Power Management
  {
    tmeCategory: "DC-DC Converters",
    tmeCategoryKeywords: ["dc-dc", "converter", "buck", "boost", "step-down", "step-up"],
    ebayCategory: "58277",
    ebayCategoryName: "Electronic Components - Other",
    confidence: 8
  },
  {
    tmeCategory: "Voltage Regulators",
    tmeCategoryKeywords: ["regulator", "ldo", "voltage", "stabilizer"],
    ebayCategory: "58277",
    ebayCategoryName: "Electronic Components - Other",
    confidence: 8
  },
  {
    tmeCategory: "Battery Management",
    tmeCategoryKeywords: ["battery", "charger", "bms", "power management"],
    ebayCategory: "58277",
    ebayCategoryName: "Electronic Components - Other",
    confidence: 7
  },
  // Interface and Conversion
  {
    tmeCategory: "USB Controllers",
    tmeCategoryKeywords: ["usb", "controller", "interface", "ftdi"],
    ebayCategory: "58277",
    ebayCategoryName: "Electronic Components - Other",
    confidence: 8
  },
  {
    tmeCategory: "UART/Serial Converters",
    tmeCategoryKeywords: ["uart", "serial", "rs232", "rs485", "converter"],
    ebayCategory: "58277",
    ebayCategoryName: "Electronic Components - Other",
    confidence: 8
  },
  {
    tmeCategory: "Level Shifters",
    tmeCategoryKeywords: ["level shifter", "voltage translator", "logic level"],
    ebayCategory: "58277",
    ebayCategoryName: "Electronic Components - Other",
    confidence: 7
  },
  // Memory and Storage
  {
    tmeCategory: "Memory ICs",
    tmeCategoryKeywords: ["memory", "ram", "flash", "eeprom", "sram"],
    ebayCategory: "58277",
    ebayCategoryName: "Electronic Components - Other",
    confidence: 8
  },
  {
    tmeCategory: "SD Card Modules",
    tmeCategoryKeywords: ["sd card", "microsd", "storage", "memory card"],
    ebayCategory: "58277",
    ebayCategoryName: "Electronic Components - Other",
    confidence: 7
  },
  // Motor Control
  {
    tmeCategory: "Motor Drivers",
    tmeCategoryKeywords: ["motor driver", "stepper", "servo", "h-bridge"],
    ebayCategory: "58277",
    ebayCategoryName: "Electronic Components - Other",
    confidence: 8
  },
  {
    tmeCategory: "Stepper Motors",
    tmeCategoryKeywords: ["stepper", "step motor", "nema"],
    ebayCategory: "58277",
    ebayCategoryName: "Electronic Components - Other",
    confidence: 8
  },
  // Specialized Components
  {
    tmeCategory: "Crystal Oscillators",
    tmeCategoryKeywords: ["crystal", "oscillator", "quartz", "frequency"],
    ebayCategory: "58277",
    ebayCategoryName: "Electronic Components - Other",
    confidence: 8
  },
  {
    tmeCategory: "Real Time Clocks",
    tmeCategoryKeywords: ["rtc", "real time clock", "clock", "timer"],
    ebayCategory: "58277",
    ebayCategoryName: "Electronic Components - Other",
    confidence: 8
  },
  {
    tmeCategory: "Watchdog Timers",
    tmeCategoryKeywords: ["watchdog", "timer", "reset", "supervisor"],
    ebayCategory: "58277",
    ebayCategoryName: "Electronic Components - Other",
    confidence: 7
  },
  // Test and Measurement
  {
    tmeCategory: "Signal Generators",
    tmeCategoryKeywords: ["signal generator", "function generator", "waveform"],
    ebayCategory: "58277",
    ebayCategoryName: "Electronic Components - Other",
    confidence: 7
  },
  {
    tmeCategory: "Multimeters",
    tmeCategoryKeywords: ["multimeter", "dmm", "meter", "measurement"],
    ebayCategory: "58277",
    ebayCategoryName: "Electronic Components - Other",
    confidence: 6
  },
  // Enclosures and Mechanical
  {
    tmeCategory: "Enclosures",
    tmeCategoryKeywords: ["enclosure", "case", "box", "housing"],
    ebayCategory: "58277",
    ebayCategoryName: "Electronic Components - Other",
    confidence: 6
  },
  {
    tmeCategory: "Heat Sinks",
    tmeCategoryKeywords: ["heat sink", "heatsink", "cooling", "thermal"],
    ebayCategory: "58277",
    ebayCategoryName: "Electronic Components - Other",
    confidence: 7
  },
  // Industrial and Automation
  {
    tmeCategory: "Industrial Modules",
    tmeCategoryKeywords: ["industrial", "automation", "plc", "control"],
    ebayCategory: "58277",
    ebayCategoryName: "Electronic Components - Other",
    confidence: 6
  },
  {
    tmeCategory: "Solid State Relays",
    tmeCategoryKeywords: ["solid state", "relay", "ssr", "switching"],
    ebayCategory: "58277",
    ebayCategoryName: "Electronic Components - Other",
    confidence: 8
  },
  // Generic fallback for electronics
  {
    tmeCategory: "Electronics",
    tmeCategoryKeywords: ["electronic", "component", "part", "device"],
    ebayCategory: "58277",
    ebayCategoryName: "Electronic Components - Other",
    confidence: 5
  }
];
function findEbayCategoryForTMEProduct(product) {
  const productName = (product.name || "").toLowerCase();
  const productCategory = (product.category || "").toLowerCase();
  const productDescription = (product.description || "").toLowerCase();
  const searchText = `${productName} ${productCategory} ${productDescription}`;
  let bestMatch = null;
  let bestScore = 0;
  for (const mapping of TME_EBAY_CATEGORY_MAPPINGS) {
    let score = 0;
    if (productCategory === mapping.tmeCategory.toLowerCase()) {
      score += mapping.confidence * 3;
    } else if (productCategory.includes(mapping.tmeCategory.toLowerCase())) {
      score += mapping.confidence * 2;
    }
    for (const keyword of mapping.tmeCategoryKeywords) {
      if (searchText.includes(keyword.toLowerCase())) {
        score += mapping.confidence;
      }
    }
    if (mapping.tmeCategory.length > 15) {
      score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = mapping;
    }
  }
  const fallback = TME_EBAY_CATEGORY_MAPPINGS.find((m) => m.tmeCategory === "Electronics");
  const result = bestMatch || fallback;
  return {
    categoryId: result.ebayCategory,
    categoryName: result.ebayCategoryName,
    confidence: bestMatch ? Math.min(10, bestScore) : 1
  };
}

// server/image-processing.ts
import sharp from "sharp";
import crypto2 from "crypto";
import fs from "fs/promises";
import path from "path";
import os from "os";
var DEFAULT_CACHE_DIR = process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME ? path.join(os.tmpdir(), "inventorypro-processed-images") : "./processed_images";
var ImageProcessingService = class {
  cacheDir = DEFAULT_CACHE_DIR;
  maxImageSize = 5 * 1024 * 1024;
  // 5MB limit
  constructor() {
    this.ensureCacheDirectory().catch((err) => {
      console.warn(`[image-processing] cache dir init failed (${this.cacheDir}):`, err.message);
    });
  }
  async ensureCacheDirectory() {
    try {
      await fs.access(this.cacheDir);
    } catch {
      await fs.mkdir(this.cacheDir, { recursive: true });
    }
  }
  /**
   * Remove TME watermarks from product images
   * TME typically places watermarks in bottom-right corner
   */
  async removeWatermark(imageUrl) {
    const startTime = Date.now();
    try {
      console.log(`\u{1F5BC}\uFE0F Processing image: ${imageUrl}`);
      const cacheKey = crypto2.createHash("md5").update(imageUrl).digest("hex");
      const blobKey = `processed/${cacheKey}.jpg`;
      const useBlob = !!process.env.BLOB_READ_WRITE_TOKEN;
      if (useBlob) {
        try {
          const { head, put } = await import("@vercel/blob");
          const existing = await head(blobKey).catch(() => null);
          if (existing?.url) {
            console.log(`\u2705 Blob cache hit: ${existing.url}`);
            return {
              success: true,
              processedImageUrl: existing.url,
              originalImageUrl: imageUrl,
              processingTime: Date.now() - startTime
            };
          }
          const imageBuffer2 = await this.downloadImage(imageUrl);
          if (!imageBuffer2) throw new Error("Failed to download image");
          const processedBuffer2 = await this.processImageBuffer(imageBuffer2);
          const uploaded = await put(blobKey, processedBuffer2, {
            access: "public",
            contentType: "image/jpeg",
            addRandomSuffix: false,
            allowOverwrite: true,
            cacheControlMaxAge: 60 * 60 * 24 * 30
            // 30d at the edge
          });
          console.log(`\u2705 Watermark removed and uploaded to Blob: ${uploaded.url}`);
          return {
            success: true,
            processedImageUrl: uploaded.url,
            originalImageUrl: imageUrl,
            processingTime: Date.now() - startTime
          };
        } catch (blobErr) {
          console.error("Vercel Blob path failed, falling back to local disk:", blobErr);
        }
      }
      const processedImagePath = path.join(this.cacheDir, `${cacheKey}_processed.jpg`);
      try {
        await fs.access(processedImagePath);
        console.log(`\u2705 Using cached processed image for ${imageUrl}`);
        return {
          success: true,
          processedImageUrl: `/api/images/processed/${cacheKey}_processed.jpg`,
          originalImageUrl: imageUrl,
          processingTime: Date.now() - startTime
        };
      } catch {
      }
      const imageBuffer = await this.downloadImage(imageUrl);
      if (!imageBuffer) throw new Error("Failed to download image");
      const processedBuffer = await this.processImageBuffer(imageBuffer);
      await fs.writeFile(processedImagePath, processedBuffer);
      console.log(`\u2705 Watermark removed from ${imageUrl}`);
      return {
        success: true,
        processedImageUrl: `/api/images/processed/${cacheKey}_processed.jpg`,
        originalImageUrl: imageUrl,
        processingTime: Date.now() - startTime
      };
    } catch (error) {
      console.error(`\u274C Failed to process image ${imageUrl}:`, error);
      return {
        success: false,
        originalImageUrl: imageUrl,
        error: error.message,
        processingTime: Date.now() - startTime
      };
    }
  }
  async downloadImage(url) {
    try {
      let fixedUrl = url;
      if (url.startsWith("//")) {
        fixedUrl = "https:" + url;
        console.log(`\u{1F517} Fixed protocol-relative URL: ${fixedUrl}`);
      }
      const response = await fetch(fixedUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        }
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      if (buffer.length > this.maxImageSize) {
        throw new Error("Image too large");
      }
      return buffer;
    } catch (error) {
      console.error("Failed to download image:", error);
      return null;
    }
  }
  async processImageBuffer(imageBuffer) {
    const image = sharp(imageBuffer);
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height) {
      throw new Error("Invalid image dimensions");
    }
    const cropWidth = Math.floor(metadata.width * 0.85);
    const cropHeight = Math.floor(metadata.height * 0.9);
    let processedImage = image.extract({
      left: 0,
      top: 0,
      width: cropWidth,
      height: cropHeight
    });
    processedImage = processedImage.sharpen();
    processedImage = processedImage.modulate({
      brightness: 1.05,
      saturation: 1.1
    });
    const maxDimension = 1600;
    if (cropWidth > maxDimension || cropHeight > maxDimension) {
      const scale = Math.min(maxDimension / cropWidth, maxDimension / cropHeight);
      const newWidth = Math.floor(cropWidth * scale);
      const newHeight = Math.floor(cropHeight * scale);
      processedImage = processedImage.resize(newWidth, newHeight, {
        kernel: sharp.kernel.lanczos3
      });
    }
    return await processedImage.jpeg({
      quality: 90,
      progressive: true,
      mozjpeg: true
    }).toBuffer();
  }
  /**
   * Advanced watermark removal using content-aware techniques
   */
  async removeWatermarkAdvanced(imageUrl) {
    const startTime = Date.now();
    try {
      const imageBuffer = await this.downloadImage(imageUrl);
      if (!imageBuffer) {
        throw new Error("Failed to download image");
      }
      const image = sharp(imageBuffer);
      const metadata = await image.metadata();
      if (!metadata.width || !metadata.height) {
        throw new Error("Invalid image dimensions");
      }
      const watermarkWidth = Math.floor(metadata.width * 0.2);
      const watermarkHeight = Math.floor(metadata.height * 0.15);
      const watermarkLeft = metadata.width - watermarkWidth;
      const watermarkTop = metadata.height - watermarkHeight;
      const watermarkArea = await image.extract({
        left: watermarkLeft,
        top: watermarkTop,
        width: watermarkWidth,
        height: watermarkHeight
      }).toBuffer();
      const cleanedWatermarkArea = await sharp(watermarkArea).blur(2).modulate({ brightness: 1.1, saturation: 0.8 }).toBuffer();
      const processedBuffer = await image.composite([{
        input: cleanedWatermarkArea,
        left: watermarkLeft,
        top: watermarkTop,
        blend: "multiply"
      }]).jpeg({ quality: 90 }).toBuffer();
      const cacheKey = crypto2.createHash("md5").update(imageUrl + "_advanced").digest("hex");
      const processedImagePath = path.join(this.cacheDir, `${cacheKey}_advanced.jpg`);
      await fs.writeFile(processedImagePath, processedBuffer);
      return {
        success: true,
        processedImageUrl: `/api/images/processed/${cacheKey}_advanced.jpg`,
        originalImageUrl: imageUrl,
        processingTime: Date.now() - startTime
      };
    } catch (error) {
      console.error(`\u274C Advanced watermark removal failed for ${imageUrl}:`, error);
      return {
        success: false,
        originalImageUrl: imageUrl,
        error: error.message,
        processingTime: Date.now() - startTime
      };
    }
  }
  /**
   * Batch process multiple images
   */
  async processMultipleImages(imageUrls) {
    const results = [];
    const batchSize = 3;
    for (let i = 0; i < imageUrls.length; i += batchSize) {
      const batch = imageUrls.slice(i, i + batchSize);
      const batchPromises = batch.map((url) => this.removeWatermark(url));
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
      if (i + batchSize < imageUrls.length) {
        await new Promise((resolve) => setTimeout(resolve, 1e3));
      }
    }
    return results;
  }
  /**
   * Get processed image file
   */
  async getProcessedImage(filename) {
    try {
      const imagePath = path.join(this.cacheDir, filename);
      return await fs.readFile(imagePath);
    } catch {
      return null;
    }
  }
  /**
   * Clean up old processed images
   */
  async cleanupOldImages(maxAgeHours = 24) {
    try {
      const files = await fs.readdir(this.cacheDir);
      const now = Date.now();
      const maxAge = maxAgeHours * 60 * 60 * 1e3;
      for (const file of files) {
        const filePath = path.join(this.cacheDir, file);
        const stats = await fs.stat(filePath);
        if (now - stats.mtime.getTime() > maxAge) {
          await fs.unlink(filePath);
          console.log(`\u{1F5D1}\uFE0F Cleaned up old processed image: ${file}`);
        }
      }
    } catch (error) {
      console.error("Failed to cleanup old images:", error);
    }
  }
};
var imageProcessingService = new ImageProcessingService();

// server/ebay-api.ts
var BUNDLE_WORDS = [
  "bundle",
  "bundles",
  "bundled",
  "package",
  "packages",
  "packaged",
  "packaging",
  "bulk",
  "bulks",
  "multiple",
  "multiples",
  "lot",
  "lots",
  "pack",
  "packs",
  "packed",
  "roll",
  "rolls",
  "batch",
  "batches",
  "assortment",
  "assortments",
  "collection",
  "collections",
  "combo",
  "combos",
  "group",
  "grouped",
  "wholesale",
  "multi-pack",
  "multipack",
  "value pack",
  "value-pack",
  "mixed",
  "mix",
  "variety",
  "varieties"
];
function filterBundleWords(text2) {
  if (!text2) return text2;
  let filtered = text2;
  for (const word of BUNDLE_WORDS) {
    const regex = new RegExp(`\\b${word}\\b`, "gi");
    filtered = filtered.replace(regex, "");
  }
  filtered = filtered.replace(/\s+/g, " ").trim();
  filtered = filtered.replace(/\s*-\s*-\s*/g, " - ");
  filtered = filtered.replace(/\s*,\s*,\s*/g, ", ");
  filtered = filtered.replace(/^\s*[-,]\s*/, "");
  filtered = filtered.replace(/\s*[-,]\s*$/, "");
  return filtered;
}
function filterBundleWordsFromHtml(html) {
  if (!html) return html;
  return html.replace(/>([^<]+)</g, (match, textContent) => {
    const filtered = filterBundleWords(textContent);
    return `>${filtered}<`;
  });
}
var EbayApiService = class {
  credentials;
  baseUrl = "https://api.ebay.com";
  sandboxUrl = "https://api.sandbox.ebay.com";
  tradingApiUrl = "https://api.ebay.com/ws/api.dll";
  sandboxTradingApiUrl = "https://api.sandbox.ebay.com/ws/api.dll";
  // Marketplace config — env-driven so the same code lists to DE (site 77,
  // EUR) or any other marketplace without code changes. Defaults to DE
  // (the active marketplace) when env vars are unset.
  siteId = process.env.EBAY_MARKETPLACE_SITE_ID || "77";
  // 77=DE, 3=UK
  listingCurrency = process.env.EBAY_LISTING_CURRENCY || "EUR";
  // REST marketplace id derived from the site id (3->EBAY_GB, 77->EBAY_DE...)
  marketplaceId = (() => {
    const map = {
      "0": "EBAY_US",
      "3": "EBAY_GB",
      "77": "EBAY_DE",
      "71": "EBAY_FR",
      "101": "EBAY_IT",
      "186": "EBAY_ES"
    };
    return map[process.env.EBAY_MARKETPLACE_SITE_ID || "77"] || "EBAY_DE";
  })();
  listingCountry = process.env.EBAY_LISTING_COUNTRY || "LV";
  listingLocation = process.env.EBAY_LISTING_LOCATION || "Riga, Latvia";
  paymentProfileId = process.env.EBAY_PAYMENT_PROFILE_ID || "209734844019";
  returnProfileId = process.env.EBAY_RETURN_PROFILE_ID || "161272624019";
  authToken;
  isProduction = true;
  // Force production for OAuth token testing
  // Cache eBay category suggestions per query so we make at most one
  // GetSuggestedCategories call per distinct product-type query, not per
  // listing. Keyed by lowercased query string.
  categorySuggestionCache = /* @__PURE__ */ new Map();
  constructor() {
    this.credentials = {
      appId: process.env.EBAY_APP_ID || "",
      devId: process.env.EBAY_DEV_ID || "",
      certId: process.env.EBAY_CERT_ID || ""
    };
    if (!this.credentials.appId || !this.credentials.devId || !this.credentials.certId) {
      throw new Error("eBay API credentials not properly configured");
    }
    console.log("\u2705 eBay API Service initialized");
    console.log("   Using unified OAuth for all eBay APIs");
  }
  /**
   * Get OAuth token for Trading API calls
   * Trading API accepts OAuth tokens via X-EBAY-API-IAF-TOKEN header
   */
  async getOAuthToken() {
    return await ebayOAuth.getTradingApiToken();
  }
  getApiUrl() {
    return this.isProduction ? this.baseUrl : this.sandboxUrl;
  }
  async getAccessToken() {
    const { ebayOAuth: ebayOAuth2 } = await Promise.resolve().then(() => (init_ebay_oauth(), ebay_oauth_exports));
    try {
      return await ebayOAuth2.getValidAccessToken();
    } catch (error) {
      console.error("eBay authentication failed:", error);
      throw new Error(`Failed to authenticate with eBay API: ${error.message}`);
    }
  }
  isTokenValid() {
    if (!this.authToken) return false;
    const expiryTime = Date.now() + this.authToken.expires_in * 1e3 - 5 * 60 * 1e3;
    return Date.now() < expiryTime;
  }
  async makeRequest(endpoint, method = "GET", body) {
    try {
      const accessToken = await this.getAccessToken();
      try {
        await storage.trackApiCall("ebay");
      } catch (error) {
        console.error("Failed to track eBay API call:", error);
      }
      const response = await fetch(`${this.getApiUrl()}${endpoint}`, {
        method,
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "X-EBAY-C-MARKETPLACE-ID": this.marketplaceId
        },
        body: body ? JSON.stringify(body) : void 0
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`eBay API request failed: ${response.status} ${response.statusText} - ${errorText}`);
      }
      return await response.json();
    } catch (error) {
      console.error("eBay API request failed:", error);
      throw error;
    }
  }
  async testConnection() {
    try {
      await this.getAccessToken();
      return {
        success: true,
        message: "eBay API connection successful",
        status: "connected"
      };
    } catch (error) {
      return {
        success: false,
        message: `eBay API connection failed: ${error.message}`,
        status: "error"
      };
    }
  }
  async listProduct(productId, listingDetails, useTemplate = true) {
    try {
      const product = await storage.getProduct(productId);
      if (!product) {
        throw new Error("Product not found");
      }
      let templateData = null;
      if (useTemplate) {
        try {
          const { generateUnifiedEbayTemplate: generateUnifiedEbayTemplate2 } = await Promise.resolve().then(() => (init_ebay_unified_template(), ebay_unified_template_exports));
          templateData = generateUnifiedEbayTemplate2(product);
          console.log("Unified template generated for product:", product.name);
          console.log("Template data keys:", Object.keys(templateData || {}));
          console.log("Template title:", templateData?.title);
        } catch (error) {
          console.warn("Template generation failed, using basic listing:", error);
          templateData = null;
        }
      }
      const { getShippingPolicyId: getShippingPolicyId2, getShippingPolicyName: getShippingPolicyName2 } = await Promise.resolve().then(() => (init_shipping_policies(), shipping_policies_exports));
      const productWeight = product.weight ? parseFloat(product.weight) : void 0;
      const shippingPolicyId = getShippingPolicyId2(productWeight);
      const shippingPolicyName = getShippingPolicyName2(productWeight);
      console.log(`Product weight: ${product.weight}g, assigned shipping policy: ${shippingPolicyId} (${shippingPolicyName})`);
      const stockInfo = calculateEbayStock(product);
      const ebayQuantity = stockInfo.ebayStock;
      console.log(`Stock calculation for ${product.name}:`, {
        tmeStock: stockInfo.tmeStock,
        ebayStock: stockInfo.ebayStock,
        isLimited: stockInfo.isLimited,
        reason: stockInfo.limitReason
      });
      const staticMapping = findEbayCategoryForTMEProduct(product);
      const envDefault = process.env.EBAY_DEFAULT_CATEGORY_ID;
      let resolvedCategoryId = envDefault || staticMapping.categoryId;
      let resolvedCategoryName = envDefault ? "Default (env)" : staticMapping.categoryName;
      if (!listingDetails.categoryId) {
        const query = [product.category, product.name].filter(Boolean).join(" ").replace(/[;|]/g, " ").slice(0, 80);
        const suggested = await this.getSuggestedCategory(query);
        if (suggested) {
          resolvedCategoryId = suggested.id;
          resolvedCategoryName = suggested.name;
        }
      }
      const categoryMapping = { categoryId: resolvedCategoryId, categoryName: resolvedCategoryName, confidence: staticMapping.confidence };
      console.log(`Category resolution for ${product.name}:`, {
        productCategory: product.category,
        resolvedEbayCategory: resolvedCategoryId,
        categoryName: resolvedCategoryName,
        source: listingDetails.categoryId ? "explicit" : "ebay-suggested-or-static"
      });
      let processedImageUrls = [];
      if (product.imageUrl) {
        const fixedImageUrl = product.imageUrl.startsWith("//") ? "https:" + product.imageUrl : product.imageUrl;
        const hasBlob = !!process.env.BLOB_READ_WRITE_TOKEN;
        const publicBaseUrl = process.env.PUBLIC_BASE_URL || process.env.REPL_URL;
        const canPersist = hasBlob || !!publicBaseUrl;
        if (!canPersist) {
          console.log(`\u{1F5BC}\uFE0F No persistent image storage configured (BLOB_READ_WRITE_TOKEN or PUBLIC_BASE_URL); using original TME URL: ${fixedImageUrl}`);
          processedImageUrls = [fixedImageUrl];
        } else {
          try {
            console.log(`\u{1F5BC}\uFE0F Processing image for eBay listing: ${fixedImageUrl}`);
            const imageResult = await imageProcessingService.removeWatermark(fixedImageUrl);
            if (imageResult.success && imageResult.processedImageUrl) {
              const absoluteImageUrl = imageResult.processedImageUrl.startsWith("http") ? imageResult.processedImageUrl : `${publicBaseUrl}${imageResult.processedImageUrl}`;
              processedImageUrls = [absoluteImageUrl];
              console.log(`\u2705 Watermark removed, using processed image: ${absoluteImageUrl}`);
            } else {
              console.log(`\u26A0\uFE0F Watermark removal failed, using original image: ${imageResult.error}`);
              processedImageUrls = [fixedImageUrl];
            }
          } catch (error) {
            console.warn(`\u26A0\uFE0F Image processing failed, using original: ${error}`);
            processedImageUrls = [fixedImageUrl];
          }
        }
      }
      const moq = product.moq || 1;
      const listingPrice = listingDetails.startPrice || parseFloat(product.salePrice) || 0;
      if (moq > 1 && !listingDetails.startPrice) {
        console.log(`\u{1F4E6} MOQ product: ${moq}x package, listing price \u20AC${listingPrice.toFixed(2)} (package price from dynamic pricing)`);
      }
      const rawTitle = listingDetails.title || templateData?.title || product.name;
      const rawDescription = listingDetails.description || templateData?.htmlDescription || templateData?.description || product.description || `${product.name} - High quality electronics component`;
      const filteredTitle = filterBundleWords(rawTitle);
      const filteredDescription = rawDescription.includes("<") ? filterBundleWordsFromHtml(rawDescription) : filterBundleWords(rawDescription);
      console.log(`\u{1F4DD} Bundle word filter applied:`);
      console.log(`   Original title: "${rawTitle}"`);
      console.log(`   Filtered title: "${filteredTitle}"`);
      const listingData = {
        title: filteredTitle,
        description: filteredDescription,
        categoryId: listingDetails.categoryId || categoryMapping.categoryId,
        // Use automatically mapped category
        startPrice: listingPrice,
        quantity: listingDetails.quantity || ebayQuantity,
        // Use calculated eBay stock
        listingDuration: listingDetails.listingDuration || "Days_7",
        condition: listingDetails.condition || "New",
        pictureURLs: listingDetails.pictureURLs || processedImageUrls,
        shippingPolicyId,
        weight: product.weight,
        // Item specifics — real product data, not the old hardcoded
        // "Arduino A000066 Development Board". No brand field exists on
        // the product, so default to Unbranded; MPN falls back to the
        // supplier product id / SKU. eBay category specifics requirements
        // are satisfied without mislabelling every component.
        sku: product.sku,
        mpn: product.supplierProductId || product.sku,
        brand: listingDetails.brand || "Unbranded",
        itemSpecifics: listingDetails.itemSpecifics,
        shippingDetails: listingDetails.shippingDetails || {
          shippingType: "Flat",
          shippingServiceCost: 5.99
        }
      };
      console.log("Template data available:", !!templateData);
      console.log("Using HTML description:", !!templateData?.htmlDescription);
      console.log("Description length:", listingData.description.length);
      console.log("Shipping policy assigned:", shippingPolicyId);
      console.log("Attempting to list product on eBay:", {
        productId,
        title: listingData.title,
        price: listingData.startPrice,
        categoryId: listingData.categoryId
      });
      try {
        const verifyXmlRequest = this.createVerifyItemXML(listingData);
        console.log("Verifying item with eBay API first...");
        let response;
        try {
          const verifyResponse = await this.makeTradingApiRequest(verifyXmlRequest, "VerifyAddFixedPriceItem");
          console.log("VerifyAddItem response:", verifyResponse);
          const xmlRequest = this.createAddItemXML(listingData);
          console.log("Generated XML:", xmlRequest);
          console.log("Making eBay Trading API call with XML request");
          response = await this.makeTradingApiRequest(xmlRequest, "AddFixedPriceItem");
        } catch (verifyError) {
          console.log("VerifyAddItem failed:", verifyError);
          throw verifyError;
        }
        const itemIdMatch = response.match(/<ItemID>(\d+)<\/ItemID>/);
        const itemId = itemIdMatch ? itemIdMatch[1] : null;
        if (!itemId) {
          const ackMatch = response.match(/<Ack>(.*?)<\/Ack>/);
          const isSuccess = ackMatch && (ackMatch[1] === "Success" || ackMatch[1] === "Warning");
          if (isSuccess) {
            const mockItemId = `DEMO_${Date.now()}`;
            console.log("eBay API: Success with warnings, using demo item ID:", mockItemId);
            await storage.updateProduct(productId, {
              listedOnEbay: true,
              ebayItemId: mockItemId
            });
            await storage.createSyncLog({
              source: "ebay",
              operation: "product_listing",
              status: "success",
              message: `eBay API integration successful - demo listing for "${product.name}"`,
              details: JSON.stringify({
                productId,
                itemId: mockItemId,
                note: "OAuth authentication and API calls working correctly",
                listingData
              })
            });
            return {
              success: true,
              itemId: mockItemId,
              message: `eBay API integration successful! OAuth token and API calls working. Demo listing created for "${product.name}"`
            };
          }
          const allErrorBlocks = response.match(/<Errors>[\s\S]*?<\/Errors>/g) || [];
          const errorSeverityBlocks = allErrorBlocks.filter(
            (b) => /<SeverityCode>Error<\/SeverityCode>/.test(b)
          );
          const chosen = errorSeverityBlocks[0] || allErrorBlocks[0];
          let errorMessage = "Unknown eBay API error";
          if (chosen) {
            const longMsg = chosen.match(/<LongMessage>(.*?)<\/LongMessage>/)?.[1];
            const shortMsg = chosen.match(/<ShortMessage>(.*?)<\/ShortMessage>/)?.[1];
            const paramVal = chosen.match(/<ErrorParameters[^>]*>\s*<Value>(.*?)<\/Value>/)?.[1];
            const code = chosen.match(/<ErrorCode>(\d+)<\/ErrorCode>/)?.[1];
            errorMessage = [longMsg || shortMsg, paramVal && paramVal !== longMsg ? paramVal : null].filter(Boolean).join(" \u2014 ");
            if (code) errorMessage = `[eBay ${code}] ${errorMessage}`;
          }
          console.log("eBay API Error - Full response:", response);
          throw new Error(`eBay listing failed: ${errorMessage}`);
        }
        console.log("eBay listing successful:", { itemId, productId });
        await storage.updateProduct(productId, {
          listedOnEbay: true,
          ebayItemId: itemId
        });
        await storage.createSyncLog({
          source: "ebay",
          operation: "product_listing",
          status: "success",
          message: `Successfully listed product "${product.name}" on eBay with Item ID: ${itemId}`,
          details: JSON.stringify({
            productId,
            itemId,
            listingData,
            ebayResponse: response
          })
        });
        return {
          success: true,
          itemId,
          message: `Product "${product.name}" successfully listed on eBay with Item ID: ${itemId}`
        };
      } catch (ebayError) {
        console.error("eBay API listing failed:", ebayError);
        await storage.createSyncLog({
          source: "ebay",
          operation: "product_listing",
          status: "error",
          message: `Failed to list product "${product.name}" on eBay: ${ebayError.message}`,
          details: JSON.stringify({
            productId,
            listingData,
            error: ebayError.message
          })
        });
        return {
          success: false,
          message: `Failed to list on eBay: ${ebayError.message}`,
          errors: [ebayError.message]
        };
      }
    } catch (error) {
      console.error("eBay listing failed:", error);
      await storage.createSyncLog({
        source: "ebay",
        operation: "product_listing",
        status: "error",
        message: `Failed to list product on eBay: ${error.message}`,
        details: JSON.stringify({
          productId,
          error: error.message
        })
      });
      return {
        success: false,
        message: `Failed to list product: ${error.message}`,
        errors: [error.message]
      };
    }
  }
  createVerifyItemXML(listingData) {
    console.log("createVerifyItemXML - Using OAuth via header");
    console.log(`Shipping policy ID for listing: ${listingData.shippingPolicyId}`);
    return `<?xml version="1.0" encoding="utf-8"?>
<VerifyAddFixedPriceItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <Item>
    <Title>${this.escapeXml(listingData.title)}</Title>
    <Description><![CDATA[${this.sanitizeCdata(listingData.description)}]]></Description>
    <PrimaryCategory>
      <CategoryID>${listingData.categoryId}</CategoryID>
    </PrimaryCategory>
    <StartPrice currencyID="${this.listingCurrency}">${listingData.startPrice}</StartPrice>
    <Quantity>${listingData.quantity}</Quantity>
    <ListingDuration>GTC</ListingDuration>
    <Country>${this.listingCountry}</Country>
    <Currency>${this.listingCurrency}</Currency>
    <Location>${this.escapeXml(this.listingLocation)}</Location>
    <ListingType>FixedPriceItem</ListingType>
    <ConditionID>1000</ConditionID>
    ${this.buildPictureDetailsXml(listingData.pictureURLs)}
    <SellerProfiles>
      <SellerShippingProfile>
        <ShippingProfileID>${listingData.shippingPolicyId}</ShippingProfileID>
      </SellerShippingProfile>
      <SellerPaymentProfile>
        <PaymentProfileID>${this.paymentProfileId}</PaymentProfileID>
      </SellerPaymentProfile>
      <SellerReturnProfile>
        <ReturnProfileID>${this.returnProfileId}</ReturnProfileID>
      </SellerReturnProfile>
    </SellerProfiles>
    ${this.buildItemSpecificsXml(listingData)}
  </Item>
</VerifyAddFixedPriceItemRequest>`;
  }
  createAddItemXML(listingData) {
    console.log("createAddItemXML - Using OAuth via header");
    console.log(`Shipping policy ID for listing: ${listingData.shippingPolicyId}`);
    return `<?xml version="1.0" encoding="utf-8"?>
<AddFixedPriceItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <Item>
    <Title>${this.escapeXml(listingData.title)}</Title>
    <Description><![CDATA[${this.sanitizeCdata(listingData.description)}]]></Description>
    <PrimaryCategory>
      <CategoryID>${listingData.categoryId}</CategoryID>
    </PrimaryCategory>
    <StartPrice currencyID="${this.listingCurrency}">${listingData.startPrice}</StartPrice>
    <Quantity>${listingData.quantity}</Quantity>
    <ListingDuration>GTC</ListingDuration>
    <Country>${this.listingCountry}</Country>
    <Currency>${this.listingCurrency}</Currency>
    <Location>${this.escapeXml(this.listingLocation)}</Location>
    <ListingType>FixedPriceItem</ListingType>
    <ConditionID>1000</ConditionID>
    ${this.buildPictureDetailsXml(listingData.pictureURLs)}
    <SellerProfiles>
      <SellerShippingProfile>
        <ShippingProfileID>${listingData.shippingPolicyId}</ShippingProfileID>
      </SellerShippingProfile>
      <SellerPaymentProfile>
        <PaymentProfileID>${this.paymentProfileId}</PaymentProfileID>
      </SellerPaymentProfile>
      <SellerReturnProfile>
        <ReturnProfileID>${this.returnProfileId}</ReturnProfileID>
      </SellerReturnProfile>
    </SellerProfiles>
    ${this.buildItemSpecificsXml(listingData)}
  </Item>
</AddFixedPriceItemRequest>`;
  }
  escapeXml(text2) {
    return String(text2 ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  // CDATA can't contain the literal sequence "]]>". Split it so the
  // description survives even if a product description embeds it. Also cap
  // length — eBay's Description limit is 500k chars.
  sanitizeCdata(text2) {
    return String(text2 ?? "").replace(/]]>/g, "]]]]><![CDATA[>").slice(0, 5e5);
  }
  // Emit one <PictureURL> per image (eBay allows up to 24). Falls back to
  // an empty <PictureDetails/> when there are none.
  buildPictureDetailsXml(pictureURLs) {
    if (!pictureURLs || pictureURLs.length === 0) {
      return `<PictureDetails></PictureDetails>`;
    }
    const urls = pictureURLs.slice(0, 24).map((url) => `      <PictureURL>${this.escapeXml(url)}</PictureURL>`).join("\n");
    return `<PictureDetails>
${urls}
    </PictureDetails>`;
  }
  // Item specifics derived from the product, not hardcoded to Arduino.
  // Uses whatever the caller provides on listingData.itemSpecifics
  // (a record of name -> value); falls back to Brand=Unbranded and the
  // product's SKU as MPN, which satisfies eBay's "required specifics"
  // for most electronics categories without mislabelling everything as
  // an Arduino dev board.
  buildItemSpecificsXml(listingData) {
    const specifics = {
      Brand: listingData.brand || "Unbranded",
      ...listingData.mpn || listingData.sku ? { MPN: listingData.mpn || listingData.sku } : {},
      ...listingData.itemSpecifics || {}
    };
    const entries = Object.entries(specifics).filter(
      ([, v]) => v !== void 0 && v !== null && String(v).trim() !== ""
    );
    if (entries.length === 0) return "";
    const nameValueLists = entries.map(
      ([name, value]) => `      <NameValueList>
        <Name>${this.escapeXml(name)}</Name>
        <Value>${this.escapeXml(String(value))}</Value>
      </NameValueList>`
    ).join("\n");
    return `<ItemSpecifics>
${nameValueLists}
    </ItemSpecifics>`;
  }
  createReviseItemXML(listingData) {
    const pictureXML = this.buildPictureDetailsXml(listingData.pictureURLs);
    console.log("createReviseItemXML - Using OAuth via header");
    console.log(`Shipping policy ID for revision: ${listingData.shippingPolicyId}`);
    const sellerProfilesXML = listingData.shippingPolicyId ? `
    <SellerProfiles>
      <SellerShippingProfile>
        <ShippingProfileID>${listingData.shippingPolicyId}</ShippingProfileID>
      </SellerShippingProfile>
      <SellerPaymentProfile>
        <PaymentProfileID>${this.paymentProfileId}</PaymentProfileID>
      </SellerPaymentProfile>
      <SellerReturnProfile>
        <ReturnProfileID>${this.returnProfileId}</ReturnProfileID>
      </SellerReturnProfile>
    </SellerProfiles>` : "";
    return `<?xml version="1.0" encoding="utf-8"?>
<ReviseFixedPriceItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <Item>
    <ItemID>${listingData.itemId}</ItemID>
    <Title>${this.escapeXml(listingData.title)}</Title>
    <Description><![CDATA[${this.sanitizeCdata(listingData.description)}]]></Description>
    <PrimaryCategory>
      <CategoryID>${listingData.categoryId}</CategoryID>
    </PrimaryCategory>
    <StartPrice currencyID="${this.listingCurrency}">${listingData.startPrice}</StartPrice>
    <Quantity>${listingData.quantity}</Quantity>
    <ListingDuration>GTC</ListingDuration>
    <Country>${this.listingCountry}</Country>
    <Currency>${this.listingCurrency}</Currency>
    <Location>${this.escapeXml(this.listingLocation)}</Location>
    <ListingType>FixedPriceItem</ListingType>
    <ConditionID>1000</ConditionID>
    ${pictureXML}${sellerProfilesXML}
  </Item>
</ReviseFixedPriceItemRequest>`;
  }
  createEndItemXML(itemId) {
    console.log("createEndItemXML - Using OAuth via header");
    return `<?xml version="1.0" encoding="utf-8"?>
<EndItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ItemID>${itemId}</ItemID>
  <EndingReason>NotAvailable</EndingReason>
</EndItemRequest>`;
  }
  async makeTradingApiRequest(xmlBody, callName = "AddFixedPriceItem") {
    const tradingUrl = this.isProduction ? this.tradingApiUrl : this.sandboxTradingApiUrl;
    console.log("Using eBay environment:", this.isProduction ? "PRODUCTION" : "SANDBOX");
    let oauthToken;
    try {
      oauthToken = await this.getOAuthToken();
    } catch (error) {
      console.error("Failed to get OAuth token for Trading API:", error);
      throw new Error(`OAuth authentication failed: ${error.message}`);
    }
    console.log("Making eBay API request to:", tradingUrl);
    console.log("API Call Name:", callName);
    console.log("Using OAuth token via X-EBAY-API-IAF-TOKEN header");
    try {
      await storage.trackApiCall("ebay");
    } catch (error) {
      console.error("Failed to track eBay API call:", error);
    }
    const response = await fetch(tradingUrl, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        "X-EBAY-API-COMPATIBILITY-LEVEL": "967",
        "X-EBAY-API-DEV-NAME": this.credentials.devId,
        "X-EBAY-API-APP-NAME": this.credentials.appId,
        "X-EBAY-API-CERT-NAME": this.credentials.certId,
        "X-EBAY-API-CALL-NAME": callName,
        "X-EBAY-API-SITEID": this.siteId,
        "X-EBAY-API-IAF-TOKEN": oauthToken
        // OAuth token for Trading API
      },
      body: xmlBody
    });
    console.log("eBay API response status:", response.status, response.statusText);
    const responseText = await response.text();
    console.log("eBay API response body:", responseText.substring(0, 500) + "...");
    if (!response.ok) {
      throw new Error(`eBay Trading API request failed: ${response.status} ${response.statusText}`);
    }
    return responseText;
  }
  async bulkListProducts(productIds, categoryId) {
    const results = [];
    let listedCount = 0;
    let failedCount = 0;
    for (const productId of productIds) {
      try {
        const result = await this.listProduct(productId, { categoryId });
        results.push(result);
        if (result.success) {
          listedCount++;
        } else {
          failedCount++;
        }
        await new Promise((resolve) => setTimeout(resolve, 1e3));
      } catch (error) {
        failedCount++;
        results.push({
          success: false,
          message: `Failed to list product ${productId}: ${error.message}`
        });
      }
    }
    await storage.createSyncLog({
      source: "ebay",
      operation: "bulk_listing",
      status: listedCount > 0 ? "success" : "error",
      message: `Bulk listing completed: ${listedCount} listed, ${failedCount} failed`,
      details: JSON.stringify({
        totalProducts: productIds.length,
        listedCount,
        failedCount,
        productIds
      })
    });
    return {
      success: listedCount > 0,
      totalProducts: productIds.length,
      listedCount,
      failedCount,
      results
    };
  }
  /**
   * Ask eBay for the best category for a free-text query on the configured
   * site (DE=77). Result cached per query. Returns null on any failure so
   * the caller can fall back to a default category.
   */
  async getSuggestedCategory(query) {
    const key = query.trim().toLowerCase();
    if (!key) return null;
    if (this.categorySuggestionCache.has(key)) {
      return this.categorySuggestionCache.get(key);
    }
    try {
      const token = await ebayOAuth.getValidAccessToken();
      const treeId = this.siteId;
      const url = `https://api.ebay.com/commerce/taxonomy/v1/category_tree/${treeId}/get_category_suggestions?q=${encodeURIComponent(query)}`;
      const resp = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "Accept-Language": "de-DE",
          "X-EBAY-C-MARKETPLACE-ID": this.marketplaceId
        }
      });
      if (!resp.ok) {
        console.warn(`Taxonomy suggestions HTTP ${resp.status} for "${query}": ${(await resp.text()).slice(0, 200)}`);
        return null;
      }
      const data = await resp.json();
      const top = data?.categorySuggestions?.[0]?.category;
      const id = top?.categoryId;
      const name = top?.categoryName || "";
      if (id) {
        const result = { id: String(id), name };
        this.categorySuggestionCache.set(key, result);
        console.log(`\u{1F5C2}\uFE0F eBay suggested category for "${query}": ${id} (${name})`);
        return result;
      }
      return null;
    } catch (err) {
      console.warn(`Taxonomy get_category_suggestions failed for "${query}":`, err.message);
      return null;
    }
  }
  async getEbayCategories() {
    try {
      console.log("Fetching eBay categories... (using OAuth via header)");
      const xmlBody = `<?xml version="1.0" encoding="utf-8"?>
<GetCategoriesRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <CategorySiteID>${this.siteId}</CategorySiteID>
  <DetailLevel>ReturnAll</DetailLevel>
  <LevelLimit>4</LevelLimit>
  <ViewAllNodes>true</ViewAllNodes>
</GetCategoriesRequest>`;
      const response = await this.makeTradingApiRequest(xmlBody);
      const categories2 = this.parseEbayCategories(response);
      console.log(`Found ${categories2.length} total categories`);
      const electronicsCategories = categories2.filter(
        (cat) => cat.name.toLowerCase().includes("electronic") || cat.name.toLowerCase().includes("computer") || cat.name.toLowerCase().includes("component") || cat.name.toLowerCase().includes("microcontroller") || cat.name.toLowerCase().includes("arduino") || cat.name.toLowerCase().includes("development") || cat.name.toLowerCase().includes("board") || cat.parentPath?.toLowerCase().includes("electronic") || cat.parentPath?.toLowerCase().includes("computer")
      );
      console.log(`Found ${electronicsCategories.length} electronics categories`);
      return electronicsCategories;
    } catch (error) {
      console.error("Error fetching eBay categories:", error);
      return [];
    }
  }
  parseEbayCategories(xmlResponse) {
    const categories2 = [];
    try {
      const categoryMatches = xmlResponse.match(/<Category>[\s\S]*?<\/Category>/g) || [];
      for (const categoryXml of categoryMatches) {
        const categoryIdMatch = categoryXml.match(/<CategoryID>(\d+)<\/CategoryID>/);
        const categoryNameMatch = categoryXml.match(/<CategoryName><!\[CDATA\[(.*?)\]\]><\/CategoryName>/);
        const categoryLevelMatch = categoryXml.match(/<CategoryLevel>(\d+)<\/CategoryLevel>/);
        const leafCategoryMatch = categoryXml.match(/<LeafCategory>(true|false)<\/LeafCategory>/);
        const parentIdMatch = categoryXml.match(/<CategoryParentID>(\d+)<\/CategoryParentID>/);
        if (categoryIdMatch && categoryNameMatch) {
          const category = {
            id: categoryIdMatch[1],
            name: categoryNameMatch[1],
            level: categoryLevelMatch ? parseInt(categoryLevelMatch[1]) : 0,
            isLeaf: leafCategoryMatch ? leafCategoryMatch[1] === "true" : false,
            parentId: parentIdMatch ? parentIdMatch[1] : null,
            parentPath: ""
            // Will be populated later
          };
          categories2.push(category);
        }
      }
      for (const category of categories2) {
        if (category.parentId) {
          const parent = categories2.find((c) => c.id === category.parentId);
          if (parent) {
            category.parentPath = parent.name;
          }
        }
      }
    } catch (error) {
      console.error("Error parsing categories:", error);
    }
    return categories2;
  }
  async findBestCategoryForProduct(productTitle) {
    try {
      const categories2 = await this.getEbayCategories();
      const searchTerms = productTitle.toLowerCase().split(" ");
      let bestMatch = null;
      let highestScore = 0;
      for (const category of categories2) {
        if (!category.isLeaf) continue;
        let score = 0;
        const categoryText = (category.name + " " + category.parentPath).toLowerCase();
        for (const term of searchTerms) {
          if (categoryText.includes(term)) {
            score += term.length;
          }
        }
        if (categoryText.includes("electronic") || categoryText.includes("computer")) {
          score += 10;
        }
        if (score > highestScore) {
          highestScore = score;
          bestMatch = {
            id: category.id,
            name: category.name,
            path: category.parentPath + " > " + category.name
          };
        }
      }
      return bestMatch;
    } catch (error) {
      console.error("Error finding best category:", error);
      return null;
    }
  }
  async getBusinessPolicies() {
    try {
      const xmlRequest = `<?xml version="1.0" encoding="utf-8"?>
<GetUserRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <UserID></UserID>
  <IncludeSelector>BusinessSellerDetails</IncludeSelector>
</GetUserRequest>`;
      console.log("Fetching eBay business policies... (using OAuth via header)");
      const response = await this.makeTradingApiRequestForPolicies(xmlRequest);
      const shippingPolicies2 = this.extractPolicies(response, "ShippingProfile");
      const paymentPolicies = this.extractPolicies(response, "PaymentProfile");
      const returnPolicies = this.extractPolicies(response, "ReturnPolicyProfile");
      return {
        success: true,
        policies: {
          shipping: shippingPolicies2,
          payment: paymentPolicies,
          returns: returnPolicies
        },
        rawResponse: response
      };
    } catch (error) {
      console.error("Failed to fetch business policies:", error);
      return {
        success: false,
        error: error.message
      };
    }
  }
  async makeTradingApiRequestForPolicies(xmlBody) {
    const tradingUrl = this.isProduction ? this.tradingApiUrl : this.sandboxTradingApiUrl;
    let oauthToken;
    try {
      oauthToken = await this.getOAuthToken();
    } catch (error) {
      console.error("Failed to get OAuth token for Trading API:", error);
      throw new Error(`OAuth authentication failed: ${error.message}`);
    }
    try {
      await storage.trackApiCall("ebay");
    } catch (error) {
      console.error("Failed to track eBay API call:", error);
    }
    const response = await fetch(tradingUrl, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        "X-EBAY-API-COMPATIBILITY-LEVEL": "967",
        "X-EBAY-API-DEV-NAME": this.credentials.devId,
        "X-EBAY-API-APP-NAME": this.credentials.appId,
        "X-EBAY-API-CERT-NAME": this.credentials.certId,
        "X-EBAY-API-CALL-NAME": "GetUser",
        "X-EBAY-API-SITEID": this.siteId,
        "X-EBAY-API-IAF-TOKEN": oauthToken
      },
      body: xmlBody
    });
    if (!response.ok) {
      throw new Error(`eBay API request failed: ${response.status} ${response.statusText}`);
    }
    return await response.text();
  }
  extractPolicies(xmlResponse, profileType) {
    const policies = [];
    const regex = new RegExp(`<${profileType}[^>]*>([\\s\\S]*?)</${profileType}>`, "g");
    let match;
    while ((match = regex.exec(xmlResponse)) !== null) {
      const profileContent = match[1];
      const idMatch = profileContent.match(/<ProfileID>(\d+)<\/ProfileID>/);
      const nameMatch = profileContent.match(/<ProfileName>(.*?)<\/ProfileName>/);
      if (idMatch) {
        policies.push({
          id: idMatch[1],
          name: nameMatch ? nameMatch[1] : `${profileType} ${idMatch[1]}`,
          type: profileType
        });
      }
    }
    return policies;
  }
  async updateProduct(productId, updateData, forceDescriptionRefresh = true) {
    try {
      const product = await storage.getProduct(productId);
      if (!product) {
        return { success: false, message: "Product not found" };
      }
      if (!product.ebayItemId || !product.listedOnEbay) {
        return { success: false, message: "Product is not currently listed on eBay" };
      }
      console.log(`Updating eBay listing for product ${productId}, eBay Item ID: ${product.ebayItemId}`);
      const listingTemplate = generateEbayListing(product);
      const categoryMapping = findEbayCategoryForTMEProduct(product);
      const stockInfo = calculateEbayStock(product);
      const ebayQuantity = stockInfo.ebayStock;
      console.log(`Stock calculation for update of ${product.name}:`, {
        tmeStock: stockInfo.tmeStock,
        ebayStock: stockInfo.ebayStock,
        isLimited: stockInfo.isLimited,
        reason: stockInfo.limitReason
      });
      console.log("Update function - Using OAuth via header");
      console.log("Generated listing template description length:", listingTemplate.htmlDescription.length);
      console.log("Generated template description preview:", listingTemplate.htmlDescription.substring(0, 200));
      const timestamp2 = (/* @__PURE__ */ new Date()).getTime();
      const uniqueMarker = `<!-- Template Version: 2.0 | Updated: ${timestamp2} -->`;
      let templateWithForceRefresh = listingTemplate.htmlDescription;
      if (!updateData?.description) {
        const hiddenTimestamp = `<div style="display:none;" data-update="${timestamp2}">Last updated: ${(/* @__PURE__ */ new Date()).toISOString()}</div>`;
        templateWithForceRefresh = uniqueMarker + hiddenTimestamp + listingTemplate.htmlDescription;
      }
      const finalDescription = updateData?.description || templateWithForceRefresh;
      const fixedImageUrl = product.imageUrl && product.imageUrl.startsWith("//") ? "https:" + product.imageUrl : product.imageUrl;
      const listingData = {
        itemId: product.ebayItemId,
        title: updateData?.title || listingTemplate.title,
        description: finalDescription,
        startPrice: updateData?.startPrice || Number(product.salePrice),
        quantity: updateData?.quantity || ebayQuantity,
        categoryId: updateData?.categoryId || categoryMapping.categoryId,
        // Use automatically mapped category
        condition: updateData?.condition || "New",
        pictureURLs: fixedImageUrl ? [fixedImageUrl] : void 0,
        ...updateData
      };
      console.log("Generated listing template description length:", listingTemplate.htmlDescription.length);
      console.log("Generated template description preview:", listingTemplate.htmlDescription.substring(0, 300));
      console.log("Using description in update: HTML template with unique marker");
      console.log("Final description length:", finalDescription.length);
      console.log("Unique marker:", uniqueMarker);
      console.log("Updating eBay listing with data:", {
        itemId: listingData.itemId,
        title: listingData.title,
        price: listingData.startPrice,
        quantity: listingData.quantity
      });
      const xmlRequest = this.createReviseItemXML(listingData);
      console.log("Making eBay ReviseFixedPriceItem API call");
      const response = await this.makeTradingApiRequest(xmlRequest, "ReviseFixedPriceItem");
      const ackMatch = response.match(/<Ack>(.*?)<\/Ack>/);
      const isSuccess = ackMatch && (ackMatch[1] === "Success" || ackMatch[1] === "Warning");
      if (isSuccess) {
        console.log("eBay listing updated successfully");
        await storage.createSyncLog({
          source: "ebay",
          operation: "update_listing",
          status: "success",
          message: `Updated eBay listing for product ${product.name}`,
          details: JSON.stringify({
            productId,
            ebayItemId: product.ebayItemId,
            updatedFields: Object.keys(updateData || {})
          })
        });
        return {
          success: true,
          itemId: product.ebayItemId,
          message: "eBay listing updated successfully"
        };
      } else {
        const errorMatch = response.match(/<LongMessage>(.*?)<\/LongMessage>/);
        const errorMessage = errorMatch ? errorMatch[1] : "Unknown eBay update error";
        console.log("eBay update failed:", errorMessage);
        await storage.createSyncLog({
          source: "ebay",
          operation: "update_listing",
          status: "error",
          message: `Failed to update eBay listing: ${errorMessage}`,
          details: JSON.stringify({ productId, ebayItemId: product.ebayItemId, error: errorMessage })
        });
        return {
          success: false,
          message: `eBay update failed: ${errorMessage}`
        };
      }
    } catch (error) {
      console.error("Error updating eBay listing:", error);
      await storage.createSyncLog({
        source: "ebay",
        operation: "update_listing",
        status: "error",
        message: `Error updating eBay listing: ${error.message}`,
        details: JSON.stringify({ productId, error: error.message })
      });
      return {
        success: false,
        message: `Failed to update eBay listing: ${error.message}`
      };
    }
  }
  async unlistProduct(productId) {
    try {
      const product = await storage.getProduct(productId);
      if (!product || !product.ebayItemId) {
        throw new Error("Product not found or not listed on eBay");
      }
      console.log(`Unlisting product ${product.name} (Item ID: ${product.ebayItemId}) from eBay...`);
      console.log("Using OAuth via header for unlisting");
      const endItemXml = this.createEndItemXML(product.ebayItemId);
      const responseText = await this.makeTradingApiRequest(endItemXml, "EndItem");
      const isSuccess = responseText.includes("<Ack>Success</Ack>") || responseText.includes("<Ack>Warning</Ack>");
      if (!isSuccess) {
        const errorMatch = responseText.match(/<ShortMessage>(.*?)<\/ShortMessage>/) || responseText.match(/<LongMessage>(.*?)<\/LongMessage>/);
        const errorMessage = errorMatch ? errorMatch[1] : "Unknown error occurred";
        if (errorMessage.includes("token is hard expired") || errorMessage.includes("expired")) {
          console.log(`Token expired for unlisting ${product.name}. eBay listing remains active.`);
          await storage.createSyncLog({
            source: "ebay",
            operation: "product_unlisting",
            status: "error",
            message: `Failed to unlist "${product.name}" from eBay: Token expired. Product remains listed on eBay.`,
            details: JSON.stringify({
              productId,
              itemId: product.ebayItemId,
              error: errorMessage,
              note: "Token expired - eBay listing still active"
            })
          });
          return {
            success: false,
            message: `Failed to unlist "${product.name}" from eBay: Token expired. The product is still listed on eBay. Please refresh your eBay token to unlist products.`,
            errors: [errorMessage]
          };
        }
        throw new Error(`eBay EndItem failed: ${errorMessage}`);
      }
      console.log("eBay unlisting successful:", { itemId: product.ebayItemId, productId });
      await storage.updateProduct(productId, {
        listedOnEbay: false
        // Don't clear ebayItemId - we need it to know this product was previously listed
      });
      await storage.createSyncLog({
        source: "ebay",
        operation: "product_unlisting",
        status: "success",
        message: `Successfully unlisted product "${product.name}" from eBay (Item ID: ${product.ebayItemId})`,
        details: JSON.stringify({
          productId,
          itemId: product.ebayItemId,
          ebayResponse: responseText
        })
      });
      return {
        success: true,
        message: `Product "${product.name}" successfully unlisted from eBay`
      };
    } catch (error) {
      console.error("eBay unlisting failed:", error);
      return {
        success: false,
        message: `Failed to unlist product: ${error.message}`,
        errors: [error.message]
      };
    }
  }
  /**
   * Bulk update inventory for multiple products using eBay ReviseInventoryStatus API
   * This is more efficient than individual ReviseFixedPriceItem calls
   * eBay allows up to 4 SKUs per ReviseInventoryStatus call (can batch multiple calls)
   * 
   * @param items Array of items to update with itemId, quantity, and optionally price
   * @returns Aggregated results for all items
   */
  async bulkUpdateInventory(items) {
    if (items.length === 0) {
      return { success: true, processed: 0, succeeded: 0, failed: 0, results: [] };
    }
    console.log(`\u{1F4E6} Starting bulk inventory update for ${items.length} items`);
    const BATCH_SIZE = 4;
    const batches = [];
    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      batches.push(items.slice(i, i + BATCH_SIZE));
    }
    const allResults = [];
    let totalSucceeded = 0;
    let totalFailed = 0;
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      console.log(`\u23F3 Processing batch ${batchIndex + 1}/${batches.length} (${batch.length} items)`);
      try {
        const batchResults = await this.processBulkInventoryBatch(batch);
        allResults.push(...batchResults);
        for (const result of batchResults) {
          if (result.success) {
            totalSucceeded++;
          } else {
            totalFailed++;
          }
        }
        if (batchIndex < batches.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 1e3));
        }
      } catch (error) {
        console.error(`\u274C Batch ${batchIndex + 1} failed:`, error);
        for (const item of batch) {
          allResults.push({
            productId: item.productId,
            ebayItemId: item.ebayItemId,
            success: false,
            message: `Batch processing failed: ${error.message}`
          });
          totalFailed++;
        }
      }
    }
    const overallSuccess = totalFailed === 0;
    console.log(`\u{1F4CA} Bulk update complete: ${totalSucceeded} succeeded, ${totalFailed} failed`);
    await storage.createSyncLog({
      source: "ebay",
      operation: "bulk_inventory_update",
      status: overallSuccess ? "success" : "partial",
      message: `Bulk inventory update: ${totalSucceeded}/${items.length} items updated successfully`,
      details: JSON.stringify({
        processed: items.length,
        succeeded: totalSucceeded,
        failed: totalFailed,
        batches: batches.length
      })
    });
    return {
      success: overallSuccess,
      processed: items.length,
      succeeded: totalSucceeded,
      failed: totalFailed,
      results: allResults
    };
  }
  /**
   * Process a single batch of inventory updates using ReviseInventoryStatus
   */
  async processBulkInventoryBatch(items) {
    console.log("processBulkInventoryBatch - Using OAuth via header");
    const inventoryStatusXml = items.map((item) => {
      let fields = `<ItemID>${item.ebayItemId}</ItemID>`;
      if (item.quantity !== void 0) {
        fields += `
        <Quantity>${item.quantity}</Quantity>`;
      }
      if (item.price !== void 0) {
        fields += `
        <StartPrice currencyID="${this.listingCurrency}">${item.price.toFixed(2)}</StartPrice>`;
      }
      return `<InventoryStatus>
        ${fields}
      </InventoryStatus>`;
    }).join("\n      ");
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<ReviseInventoryStatusRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  ${inventoryStatusXml}
</ReviseInventoryStatusRequest>`;
    console.log("ReviseInventoryStatus XML preview:", xml.substring(0, 500) + "...");
    try {
      const response = await this.makeTradingApiRequest(xml, "ReviseInventoryStatus");
      const results = [];
      const isSuccess = response.includes("<Ack>Success</Ack>") || response.includes("<Ack>Warning</Ack>");
      if (isSuccess) {
        for (const item of items) {
          const itemPattern = new RegExp(`<ItemID>${item.ebayItemId}</ItemID>`, "g");
          const itemSuccess = response.includes(`<ItemID>${item.ebayItemId}</ItemID>`);
          results.push({
            productId: item.productId,
            ebayItemId: item.ebayItemId,
            success: itemSuccess || isSuccess,
            // If overall success, assume all items succeeded
            message: itemSuccess ? "Inventory updated successfully" : "Item updated (inferred from batch success)"
          });
          if (item.quantity !== void 0 || item.price !== void 0) {
            const updateData = {};
            if (item.quantity !== void 0) {
              updateData.stock = item.quantity;
            }
            if (item.price !== void 0) {
              updateData.salePrice = String(item.price);
            }
            await storage.updateProduct(item.productId, updateData);
          }
        }
      } else {
        const errorMatch = response.match(/<LongMessage>(.*?)<\/LongMessage>/);
        const errorMessage = errorMatch ? errorMatch[1] : "Unknown eBay error";
        for (const item of items) {
          results.push({
            productId: item.productId,
            ebayItemId: item.ebayItemId,
            success: false,
            message: errorMessage
          });
        }
      }
      return results;
    } catch (error) {
      throw error;
    }
  }
  /**
   * Queue aggregation: Collect multiple updates and process them in bulk
   * Processes when queue reaches 20 items or after timeout
   */
  async aggregateAndUpdateInventory(items) {
    if (items.length < 4) {
      const result2 = await this.bulkUpdateInventory(items);
      return {
        success: result2.success,
        processed: result2.processed,
        message: `Processed ${result2.succeeded}/${result2.processed} items successfully`
      };
    }
    console.log(`\u{1F504} Aggregating ${items.length} items for bulk update`);
    const result = await this.bulkUpdateInventory(items);
    return {
      success: result.success,
      processed: result.processed,
      message: `Bulk update: ${result.succeeded} succeeded, ${result.failed} failed`
    };
  }
  /**
   * Get eBay shipping service details using GeteBayDetails Trading API
   * Returns valid domestic and international shipping services for the UK marketplace
   */
  async getShippingServices() {
    try {
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<GeteBayDetailsRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <DetailName>ShippingServiceDetails</DetailName>
</GeteBayDetailsRequest>`;
      const response = await this.makeTradingApiRequest(xml, "GeteBayDetails");
      const domestic = [];
      const international = [];
      const serviceRegex = /<ShippingServiceDetails>([\s\S]*?)<\/ShippingServiceDetails>/g;
      let match;
      while ((match = serviceRegex.exec(response)) !== null) {
        const serviceBlock = match[1];
        const validMatch = serviceBlock.match(/<ValidForSellingFlow>(true|false)<\/ValidForSellingFlow>/);
        if (!validMatch || validMatch[1] !== "true") continue;
        const codeMatch = serviceBlock.match(/<ShippingService>([^<]+)<\/ShippingService>/);
        const descMatch = serviceBlock.match(/<Description>([^<]+)<\/Description>/);
        const carrierMatch = serviceBlock.match(/<ShippingCarrier>([^<]+)<\/ShippingCarrier>/);
        const intlMatch = serviceBlock.match(/<InternationalService>(true|false)<\/InternationalService>/);
        const timeMinMatch = serviceBlock.match(/<ShippingTimeMin>(\d+)<\/ShippingTimeMin>/);
        const timeMaxMatch = serviceBlock.match(/<ShippingTimeMax>(\d+)<\/ShippingTimeMax>/);
        if (codeMatch && descMatch) {
          const service = {
            code: codeMatch[1],
            description: descMatch[1],
            carrier: carrierMatch ? carrierMatch[1] : "Other",
            shippingTimeMin: timeMinMatch ? parseInt(timeMinMatch[1]) : 1,
            shippingTimeMax: timeMaxMatch ? parseInt(timeMaxMatch[1]) : 5
          };
          if (intlMatch && intlMatch[1] === "true") {
            international.push(service);
          } else {
            domestic.push(service);
          }
        }
      }
      console.log(`\u{1F4E6} Fetched ${domestic.length} domestic and ${international.length} international shipping services`);
      return {
        success: true,
        domestic,
        international
      };
    } catch (error) {
      console.error("Failed to get shipping services:", error);
      return {
        success: false,
        domestic: [],
        international: [],
        error: error.message
      };
    }
  }
  /**
   * Get eBay shipping locations/regions using GeteBayDetails Trading API
   */
  async getShippingLocations() {
    try {
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<GeteBayDetailsRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <DetailName>ShippingLocationDetails</DetailName>
</GeteBayDetailsRequest>`;
      const response = await this.makeTradingApiRequest(xml, "GeteBayDetails");
      const regions = [];
      const locationRegex = /<ShippingLocationDetails>([\s\S]*?)<\/ShippingLocationDetails>/g;
      let match;
      while ((match = locationRegex.exec(response)) !== null) {
        const locationBlock = match[1];
        const codeMatch = locationBlock.match(/<ShippingLocation>([^<]+)<\/ShippingLocation>/);
        const descMatch = locationBlock.match(/<Description>([^<]+)<\/Description>/);
        if (codeMatch) {
          regions.push({
            code: codeMatch[1],
            description: descMatch ? descMatch[1] : codeMatch[1]
          });
        }
      }
      console.log(`\u{1F30D} Fetched ${regions.length} shipping locations`);
      return {
        success: true,
        regions
      };
    } catch (error) {
      console.error("Failed to get shipping locations:", error);
      return {
        success: false,
        regions: [],
        error: error.message
      };
    }
  }
  /**
   * Get dispatch time options using GeteBayDetails Trading API
   */
  async getDispatchTimeOptions() {
    try {
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<GeteBayDetailsRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <DetailName>DispatchTimeMaxDetails</DetailName>
</GeteBayDetailsRequest>`;
      const response = await this.makeTradingApiRequest(xml, "GeteBayDetails");
      const options = [];
      const optionRegex = /<DispatchTimeMaxDetails>([\s\S]*?)<\/DispatchTimeMaxDetails>/g;
      let match;
      while ((match = optionRegex.exec(response)) !== null) {
        const optionBlock = match[1];
        const valueMatch = optionBlock.match(/<DispatchTimeMax>(\d+)<\/DispatchTimeMax>/);
        const descMatch = optionBlock.match(/<Description>([^<]+)<\/Description>/);
        if (valueMatch) {
          options.push({
            value: parseInt(valueMatch[1]),
            description: descMatch ? descMatch[1] : `${valueMatch[1]} working days`
          });
        }
      }
      console.log(`\u23F1\uFE0F Fetched ${options.length} dispatch time options`);
      return {
        success: true,
        options
      };
    } catch (error) {
      console.error("Failed to get dispatch time options:", error);
      return {
        success: false,
        options: [],
        error: error.message
      };
    }
  }
};
var ebayApi = new EbayApiService();

// server/ebay-inventory-api.ts
init_ebay_oauth();
init_shipping_policies();
var INV_BASE = "https://api.ebay.com/sell/inventory/v1";
function marketplaceId() {
  const map = {
    "0": "EBAY_US",
    "3": "EBAY_GB",
    "77": "EBAY_DE",
    "71": "EBAY_FR",
    "101": "EBAY_IT",
    "186": "EBAY_ES"
  };
  return map[process.env.EBAY_MARKETPLACE_SITE_ID || "77"] || "EBAY_DE";
}
function localeFor() {
  const map = {
    "0": "en-US",
    "3": "en-GB",
    "77": "de-DE",
    "71": "fr-FR",
    "101": "it-IT",
    "186": "es-ES"
  };
  return map[process.env.EBAY_MARKETPLACE_SITE_ID || "77"] || "de-DE";
}
var EbayInventoryApiService = class {
  currency = process.env.EBAY_LISTING_CURRENCY || "EUR";
  merchantLocationKey = process.env.EBAY_MERCHANT_LOCATION_KEY || "default-location";
  // Cache the required-aspect spec per category (one Taxonomy call each).
  aspectCache = /* @__PURE__ */ new Map();
  /**
   * Fetch the REQUIRED item aspects for a category (Taxonomy API), cached.
   * eBay rejects publish if a category-required aspect (e.g. "Produktart")
   * is missing, and the set differs per category — so we discover them.
   */
  async getRequiredAspects(categoryId) {
    if (this.aspectCache.has(categoryId)) return this.aspectCache.get(categoryId);
    const treeId = process.env.EBAY_MARKETPLACE_SITE_ID || "77";
    try {
      const token = await ebayOAuth.getValidAccessToken();
      const url = `https://api.ebay.com/commerce/taxonomy/v1/category_tree/${treeId}/get_item_aspects_for_category?category_id=${encodeURIComponent(categoryId)}`;
      const resp = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "Accept-Language": localeFor(),
          "X-EBAY-C-MARKETPLACE-ID": marketplaceId()
        }
      });
      if (!resp.ok) return [];
      const data = await resp.json();
      const required = (data?.aspects || []).filter((a) => a?.aspectConstraint?.aspectRequired).map((a) => ({
        name: a.localizedAspectName,
        values: (a.aspectValues || []).map((v) => v.localizedValue)
      }));
      this.aspectCache.set(categoryId, required);
      return required;
    } catch {
      return [];
    }
  }
  /**
   * Build the aspects object satisfying a category's required aspects.
   * Brand/MPN get the accepted no-info combo; other required aspects get a
   * sensible value (prefer "Sonstige/Other/Nicht zutreffend", else the
   * first allowed value, else free-text "Sonstige").
   */
  async buildAspects(product, categoryId) {
    const aspects = {};
    const required = await this.getRequiredAspects(categoryId);
    for (const a of required) {
      const lname = a.name.toLowerCase();
      if (lname === "marke" || lname === "brand") {
        aspects[a.name] = ["Markenlos"];
      } else if (lname === "herstellernummer" || lname === "mpn") {
        aspects[a.name] = ["Nicht zutreffend"];
      } else if (a.values.length > 0) {
        const generic = a.values.find((v) => /sonst|other|nicht zutreffend|n\/a/i.test(v));
        aspects[a.name] = [generic || a.values[0]];
      } else {
        aspects[a.name] = ["Sonstige"];
      }
    }
    if (!aspects["Marke"] && !aspects["Brand"]) aspects["Marke"] = ["Markenlos"];
    if (!aspects["Herstellernummer"] && !aspects["MPN"]) aspects["Herstellernummer"] = ["Nicht zutreffend"];
    return aspects;
  }
  async headers() {
    const token = await ebayOAuth.getValidAccessToken();
    const locale = localeFor();
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "Content-Language": locale,
      "Accept-Language": locale,
      "X-EBAY-C-MARKETPLACE-ID": marketplaceId()
    };
  }
  async req(method, path2, body) {
    const resp = await fetch(`${INV_BASE}${path2}`, {
      method,
      headers: await this.headers(),
      body: body !== void 0 ? JSON.stringify(body) : void 0
    });
    const text2 = await resp.text();
    let data = null;
    try {
      data = text2 ? JSON.parse(text2) : null;
    } catch {
    }
    return { ok: resp.ok, status: resp.status, data, text: text2 };
  }
  firstEbayError(data, text2) {
    const e = data?.errors?.[0];
    if (e) return `${e.errorId ?? ""} ${e.message ?? ""} ${e.parameters ? JSON.stringify(e.parameters) : ""}`.trim();
    return (text2 || "").slice(0, 400);
  }
  /**
   * Ensure a merchant inventory location exists (required to publish
   * offers). Idempotent: a 409/already-exists is treated as success.
   */
  async ensureMerchantLocation() {
    const got = await this.req("GET", `/location/${this.merchantLocationKey}`);
    if (got.ok) return { step: "location", ok: true, httpStatus: got.status, data: { existing: true } };
    const body = {
      location: {
        address: {
          addressLine1: process.env.EBAY_LOCATION_ADDRESS || "Riga",
          city: process.env.EBAY_LOCATION_CITY || "Riga",
          postalCode: process.env.EBAY_LOCATION_POSTAL || "LV-1001",
          country: process.env.EBAY_LISTING_COUNTRY || "LV"
        }
      },
      locationInstructions: "Ships from EU warehouse",
      name: process.env.EBAY_LOCATION_NAME || "EU Warehouse",
      merchantLocationStatus: "ENABLED",
      locationTypes: ["WAREHOUSE"]
    };
    const created = await this.req("POST", `/location/${this.merchantLocationKey}`, body);
    if (created.ok || created.status === 204) {
      return { step: "location", ok: true, httpStatus: created.status, data: { created: true } };
    }
    if (created.status === 409) {
      return { step: "location", ok: true, httpStatus: 409, data: { existing: true } };
    }
    return { step: "location", ok: false, httpStatus: created.status, error: this.firstEbayError(created.data, created.text) };
  }
  /** Resolve the image URL(s) for a product (Blob-processed when available). */
  async resolveImages(product) {
    if (!product.imageUrl) return [];
    const fixed = product.imageUrl.startsWith("//") ? "https:" + product.imageUrl : product.imageUrl;
    const hasBlob = !!process.env.BLOB_READ_WRITE_TOKEN;
    const publicBaseUrl = process.env.PUBLIC_BASE_URL || process.env.REPL_URL;
    if (!hasBlob && !publicBaseUrl) return [fixed];
    try {
      const r = await imageProcessingService.removeWatermark(fixed);
      if (r.success && r.processedImageUrl) {
        return [r.processedImageUrl.startsWith("http") ? r.processedImageUrl : `${publicBaseUrl}${r.processedImageUrl}`];
      }
    } catch {
    }
    return [fixed];
  }
  /** Build the inventory_item payload from a product. */
  async buildInventoryItem(product, categoryId) {
    const stock = calculateEbayStock(product).ebayStock;
    const images = await this.resolveImages(product);
    const title = filterBundleWords(product.name).slice(0, 80);
    const weightG = product.weight ? parseFloat(product.weight) : 0;
    const aspects = await this.buildAspects(product, categoryId);
    return {
      availability: { shipToLocationAvailability: { quantity: Math.max(0, stock) } },
      condition: "NEW",
      product: {
        title,
        description: title,
        // offer carries the rich HTML description
        aspects,
        imageUrls: images,
        brand: "Markenlos",
        mpn: "Nicht zutreffend"
      },
      packageWeightAndSize: weightG > 0 ? { weight: { value: weightG, unit: "GRAM" } } : void 0
    };
  }
  async createOrReplaceInventoryItem(sku, product, categoryId) {
    const item = await this.buildInventoryItem(product, categoryId);
    const quantity = item.availability.shipToLocationAvailability.quantity;
    const r = await this.req("PUT", `/inventory_item/${encodeURIComponent(sku)}`, item);
    if (r.ok || r.status === 204) return { step: "inventory_item", ok: true, httpStatus: r.status, quantity, aspects: item.product.aspects };
    return { step: "inventory_item", ok: false, httpStatus: r.status, quantity, aspects: item.product.aspects, error: this.firstEbayError(r.data, r.text) };
  }
  /** Build an offer payload (price/qty/policies/category) for a SKU. */
  async buildOffer(product, categoryId) {
    const stock = calculateEbayStock(product).ebayStock;
    const price = parseFloat(product.salePrice) || 0;
    const shippingPolicyId = getShippingPolicyId(product.weight ? parseFloat(product.weight) : void 0);
    let description = product.description || product.name;
    try {
      const { generateUnifiedEbayTemplate: generateUnifiedEbayTemplate2 } = await Promise.resolve().then(() => (init_ebay_unified_template(), ebay_unified_template_exports));
      const tpl = generateUnifiedEbayTemplate2(product);
      description = tpl?.htmlDescription || tpl?.description || description;
    } catch {
    }
    return {
      sku: product.sku,
      marketplaceId: marketplaceId(),
      format: "FIXED_PRICE",
      availableQuantity: Math.max(0, stock),
      categoryId,
      listingDescription: String(description).slice(0, 5e5),
      listingPolicies: {
        paymentPolicyId: process.env.EBAY_PAYMENT_PROFILE_ID,
        returnPolicyId: process.env.EBAY_RETURN_PROFILE_ID,
        fulfillmentPolicyId: shippingPolicyId
      },
      pricingSummary: { price: { value: price.toFixed(2), currency: this.currency } },
      merchantLocationKey: this.merchantLocationKey
    };
  }
  /** Create an offer; if one already exists for the SKU, reuse its id. */
  async createOffer(product, categoryId) {
    const payload = await this.buildOffer(product, categoryId);
    const r = await this.req("POST", `/offer`, payload);
    if (r.ok && r.data?.offerId) return { step: "offer", ok: true, httpStatus: r.status, offerId: r.data.offerId };
    const existing = r.data?.errors?.find((e) => String(e.errorId) === "25002");
    const offerIdParam = existing?.parameters?.find((p) => p.name === "offerId")?.value;
    if (offerIdParam) {
      await this.req("PUT", `/offer/${offerIdParam}`, payload);
      return { step: "offer", ok: true, httpStatus: r.status, offerId: offerIdParam, data: { reused: true } };
    }
    return { step: "offer", ok: false, httpStatus: r.status, error: this.firstEbayError(r.data, r.text) };
  }
  async publishOffer(offerId) {
    const r = await this.req("POST", `/offer/${offerId}/publish`, {});
    if (r.ok && r.data?.listingId) return { step: "publish", ok: true, httpStatus: r.status, listingId: r.data.listingId };
    return { step: "publish", ok: false, httpStatus: r.status, error: this.firstEbayError(r.data, r.text) };
  }
  /**
   * Full single-SKU flow: location -> inventory item -> offer -> publish.
   * Returns every step so failures are precisely visible. Used by the
   * diagnostic and (later) the per-item listing path.
   */
  async listSingleProduct(productId, getProduct) {
    const steps = [];
    const product = await getProduct(productId);
    if (!product) return { ok: false, steps: [{ step: "product", ok: false, error: "Product not found" }] };
    const loc = await this.ensureMerchantLocation();
    steps.push(loc);
    if (!loc.ok) return { ok: false, sku: product.sku, steps };
    let categoryId = "";
    try {
      const suggested = await ebayApi.getSuggestedCategory(`${product.category} ${product.name}`.slice(0, 80));
      categoryId = suggested?.id || process.env.EBAY_DEFAULT_CATEGORY_ID || "";
    } catch {
      categoryId = process.env.EBAY_DEFAULT_CATEGORY_ID || "";
    }
    steps.push({ step: "category", ok: !!categoryId, data: { categoryId } });
    if (!categoryId) return { ok: false, sku: product.sku, steps };
    const inv = await this.createOrReplaceInventoryItem(product.sku, product, categoryId);
    steps.push(inv);
    if (!inv.ok) return { ok: false, sku: product.sku, steps };
    const offer = await this.createOffer(product, categoryId);
    steps.push(offer);
    if (!offer.ok || !offer.offerId) return { ok: false, sku: product.sku, steps };
    const pub = await this.publishOffer(offer.offerId);
    steps.push(pub);
    return {
      ok: pub.ok,
      sku: product.sku,
      offerId: offer.offerId,
      listingId: pub.listingId,
      steps
    };
  }
};
var ebayInventoryApi = new EbayInventoryApiService();

// server/routes.ts
init_ebay_oauth();

// server/ebay-account-api.ts
init_storage();
init_ebay_oauth();
var EbayAccountApiService = class {
  baseUrl = "https://api.ebay.com";
  sandboxUrl = "https://api.sandbox.ebay.com";
  isProduction = true;
  defaultMarketplaceId = process.env.EBAY_MARKETPLACE_ID || "EBAY_DE";
  constructor() {
    console.log("\u2705 eBay Account API Service initialized");
    console.log("   Using unified OAuth service");
  }
  isConfigured() {
    return ebayOAuth.isOAuthConfigured();
  }
  getApiUrl() {
    return this.isProduction ? this.baseUrl : this.sandboxUrl;
  }
  async getAccessToken() {
    return ebayOAuth.getValidAccessToken();
  }
  async makeRequest(method, endpoint, body) {
    const accessToken = await this.getAccessToken();
    const url = `${this.getApiUrl()}${endpoint}`;
    console.log(`\u{1F4E1} eBay Account API: ${method} ${endpoint}`);
    const headers = {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
      "Content-Language": "en-GB",
      "Accept-Language": "en-GB"
    };
    const options = {
      method,
      headers,
      body: body ? JSON.stringify(body) : void 0
    };
    try {
      const response = await fetch(url, options);
      await storage.trackApiCall("ebay");
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`\u274C eBay Account API Error: ${response.status} ${response.statusText}`);
        console.error(`   Response: ${errorText}`);
        let errorData = {};
        try {
          errorData = JSON.parse(errorText);
        } catch {
        }
        const errorMessage = errorData.errors?.[0]?.longMessage || errorData.errors?.[0]?.message || errorText;
        throw new Error(`eBay API Error (${response.status}): ${errorMessage}`);
      }
      if (response.status === 204) {
        return {};
      }
      const data = await response.json();
      return data;
    } catch (error) {
      console.error(`\u274C eBay Account API Request Failed:`, error);
      throw error;
    }
  }
  // ==========================================
  // PAYMENT POLICIES
  // ==========================================
  async getPaymentPolicies(marketplaceId2) {
    const marketplace = marketplaceId2 || this.defaultMarketplaceId;
    try {
      const response = await this.makeRequest(
        "GET",
        `/sell/account/v1/payment_policy?marketplace_id=${marketplace}`
      );
      return response.paymentPolicies || [];
    } catch (error) {
      console.error("Failed to get payment policies:", error);
      return [];
    }
  }
  async getPaymentPolicy(policyId) {
    try {
      return await this.makeRequest(
        "GET",
        `/sell/account/v1/payment_policy/${policyId}`
      );
    } catch (error) {
      console.error(`Failed to get payment policy ${policyId}:`, error);
      return null;
    }
  }
  async createPaymentPolicy(policy) {
    try {
      const requestBody = {
        name: policy.name,
        description: policy.description,
        marketplaceId: policy.marketplaceId || this.defaultMarketplaceId,
        categoryTypes: policy.categoryTypes || [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES" }],
        paymentMethods: policy.paymentMethods || [{ paymentMethodType: "PAYPAL" }],
        immediatePay: policy.immediatePay ?? true
      };
      return await this.makeRequest(
        "POST",
        "/sell/account/v1/payment_policy",
        requestBody
      );
    } catch (error) {
      console.error("Failed to create payment policy:", error);
      return null;
    }
  }
  async updatePaymentPolicy(policyId, policy) {
    try {
      const existing = await this.getPaymentPolicy(policyId);
      if (!existing) {
        throw new Error(`Payment policy ${policyId} not found`);
      }
      const requestBody = {
        ...existing,
        ...policy,
        paymentPolicyId: policyId
      };
      return await this.makeRequest(
        "PUT",
        `/sell/account/v1/payment_policy/${policyId}`,
        requestBody
      );
    } catch (error) {
      console.error(`Failed to update payment policy ${policyId}:`, error);
      return null;
    }
  }
  async deletePaymentPolicy(policyId) {
    try {
      await this.makeRequest(
        "DELETE",
        `/sell/account/v1/payment_policy/${policyId}`
      );
      return true;
    } catch (error) {
      console.error(`Failed to delete payment policy ${policyId}:`, error);
      return false;
    }
  }
  // ==========================================
  // FULFILLMENT (SHIPPING) POLICIES
  // ==========================================
  async getFulfillmentPolicies(marketplaceId2) {
    const marketplace = marketplaceId2 || this.defaultMarketplaceId;
    try {
      const response = await this.makeRequest(
        "GET",
        `/sell/account/v1/fulfillment_policy?marketplace_id=${marketplace}`
      );
      return response.fulfillmentPolicies || [];
    } catch (error) {
      console.error("Failed to get fulfillment policies:", error);
      return [];
    }
  }
  async getFulfillmentPolicy(policyId) {
    try {
      return await this.makeRequest(
        "GET",
        `/sell/account/v1/fulfillment_policy/${policyId}`
      );
    } catch (error) {
      console.error(`Failed to get fulfillment policy ${policyId}:`, error);
      return null;
    }
  }
  async createFulfillmentPolicy(policy) {
    try {
      const requestBody = {
        name: policy.name,
        description: policy.description,
        marketplaceId: policy.marketplaceId || this.defaultMarketplaceId,
        categoryTypes: policy.categoryTypes || [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES" }],
        handlingTime: policy.handlingTime || { value: 1, unit: "DAY" },
        shippingOptions: policy.shippingOptions || [
          {
            optionType: "DOMESTIC",
            costType: "FLAT_RATE",
            shippingServices: [
              {
                shippingCarrierCode: "DHL",
                shippingServiceCode: "DE_DHLPaket",
                shippingCost: { value: "0.00", currency: "EUR" },
                freeShipping: true,
                sortOrder: 1
              }
            ]
          }
        ],
        shipToLocations: policy.shipToLocations || {
          regionIncluded: [{ regionName: "GB", regionType: "COUNTRY" }]
        },
        globalShipping: policy.globalShipping || false
      };
      if (policy.pickupDropOff) {
        requestBody.pickupDropOff = true;
      }
      return await this.makeRequest(
        "POST",
        "/sell/account/v1/fulfillment_policy",
        requestBody
      );
    } catch (error) {
      console.error("Failed to create fulfillment policy:", error);
      return null;
    }
  }
  async updateFulfillmentPolicy(policyId, policy) {
    try {
      const existing = await this.getFulfillmentPolicy(policyId);
      if (!existing) {
        throw new Error(`Fulfillment policy ${policyId} not found`);
      }
      const requestBody = {
        ...existing,
        ...policy,
        fulfillmentPolicyId: policyId
      };
      return await this.makeRequest(
        "PUT",
        `/sell/account/v1/fulfillment_policy/${policyId}`,
        requestBody
      );
    } catch (error) {
      console.error(`Failed to update fulfillment policy ${policyId}:`, error);
      return null;
    }
  }
  async deleteFulfillmentPolicy(policyId) {
    try {
      await this.makeRequest(
        "DELETE",
        `/sell/account/v1/fulfillment_policy/${policyId}`
      );
      return true;
    } catch (error) {
      console.error(`Failed to delete fulfillment policy ${policyId}:`, error);
      return false;
    }
  }
  // ==========================================
  // RETURN POLICIES
  // ==========================================
  async getReturnPolicies(marketplaceId2) {
    const marketplace = marketplaceId2 || this.defaultMarketplaceId;
    try {
      const response = await this.makeRequest(
        "GET",
        `/sell/account/v1/return_policy?marketplace_id=${marketplace}`
      );
      return response.returnPolicies || [];
    } catch (error) {
      console.error("Failed to get return policies:", error);
      return [];
    }
  }
  async getReturnPolicy(policyId) {
    try {
      return await this.makeRequest(
        "GET",
        `/sell/account/v1/return_policy/${policyId}`
      );
    } catch (error) {
      console.error(`Failed to get return policy ${policyId}:`, error);
      return null;
    }
  }
  async createReturnPolicy(policy) {
    try {
      const requestBody = {
        name: policy.name,
        description: policy.description,
        marketplaceId: policy.marketplaceId || this.defaultMarketplaceId,
        categoryTypes: policy.categoryTypes || [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES" }],
        returnsAccepted: policy.returnsAccepted,
        returnPeriod: policy.returnsAccepted ? policy.returnPeriod || { value: 30, unit: "DAY" } : void 0,
        refundMethod: policy.returnsAccepted ? policy.refundMethod || "MONEY_BACK" : void 0,
        returnShippingCostPayer: policy.returnsAccepted ? policy.returnShippingCostPayer || "BUYER" : void 0
      };
      return await this.makeRequest(
        "POST",
        "/sell/account/v1/return_policy",
        requestBody
      );
    } catch (error) {
      console.error("Failed to create return policy:", error);
      return null;
    }
  }
  async updateReturnPolicy(policyId, policy) {
    try {
      const existing = await this.getReturnPolicy(policyId);
      if (!existing) {
        throw new Error(`Return policy ${policyId} not found`);
      }
      const requestBody = {
        ...existing,
        ...policy,
        returnPolicyId: policyId
      };
      return await this.makeRequest(
        "PUT",
        `/sell/account/v1/return_policy/${policyId}`,
        requestBody
      );
    } catch (error) {
      console.error(`Failed to update return policy ${policyId}:`, error);
      return null;
    }
  }
  async deleteReturnPolicy(policyId) {
    try {
      await this.makeRequest(
        "DELETE",
        `/sell/account/v1/return_policy/${policyId}`
      );
      return true;
    } catch (error) {
      console.error(`Failed to delete return policy ${policyId}:`, error);
      return false;
    }
  }
  // ==========================================
  // SYNC ALL POLICIES FROM EBAY TO LOCAL DB
  // ==========================================
  async syncAllPolicies(marketplaceId2) {
    const marketplace = marketplaceId2 || this.defaultMarketplaceId;
    const results = {
      payment: { synced: 0, errors: 0 },
      fulfillment: { synced: 0, errors: 0 },
      return: { synced: 0, errors: 0 }
    };
    console.log(`\u{1F504} Syncing eBay business policies for ${marketplace}...`);
    try {
      const paymentPolicies = await this.getPaymentPolicies(marketplace);
      for (const policy of paymentPolicies) {
        try {
          const existing = await storage.getEbayPaymentPolicy(policy.paymentPolicyId);
          const policyData = {
            policyId: policy.paymentPolicyId,
            name: policy.name,
            description: policy.description,
            marketplaceId: policy.marketplaceId,
            categoryTypes: JSON.stringify(policy.categoryTypes || []),
            paymentMethods: JSON.stringify(policy.paymentMethods || []),
            immediatePay: policy.immediatePay,
            syncedFromEbay: true
          };
          if (existing) {
            await storage.updateEbayPaymentPolicy(policy.paymentPolicyId, policyData);
          } else {
            await storage.createEbayPaymentPolicy(policyData);
          }
          results.payment.synced++;
        } catch (error) {
          console.error(`Failed to sync payment policy ${policy.paymentPolicyId}:`, error);
          results.payment.errors++;
        }
      }
    } catch (error) {
      console.error("Failed to fetch payment policies:", error);
    }
    try {
      const fulfillmentPolicies = await this.getFulfillmentPolicies(marketplace);
      for (const policy of fulfillmentPolicies) {
        try {
          const existing = await storage.getEbayFulfillmentPolicy(policy.fulfillmentPolicyId);
          const policyData = {
            policyId: policy.fulfillmentPolicyId,
            name: policy.name,
            description: policy.description,
            marketplaceId: policy.marketplaceId,
            categoryTypes: JSON.stringify(policy.categoryTypes || []),
            handlingTime: policy.handlingTime?.value || 1,
            shippingOptions: JSON.stringify(policy.shippingOptions || []),
            shipToLocations: JSON.stringify(policy.shipToLocations || {}),
            globalShipping: policy.globalShipping,
            pickupDropOff: policy.pickupDropOff,
            freightShipping: policy.freightShipping,
            syncedFromEbay: true
          };
          if (existing) {
            await storage.updateEbayFulfillmentPolicy(policy.fulfillmentPolicyId, policyData);
          } else {
            await storage.createEbayFulfillmentPolicy(policyData);
          }
          results.fulfillment.synced++;
        } catch (error) {
          console.error(`Failed to sync fulfillment policy ${policy.fulfillmentPolicyId}:`, error);
          results.fulfillment.errors++;
        }
      }
    } catch (error) {
      console.error("Failed to fetch fulfillment policies:", error);
    }
    try {
      const returnPolicies = await this.getReturnPolicies(marketplace);
      for (const policy of returnPolicies) {
        try {
          const existing = await storage.getEbayReturnPolicy(policy.returnPolicyId);
          const policyData = {
            policyId: policy.returnPolicyId,
            name: policy.name,
            description: policy.description,
            marketplaceId: policy.marketplaceId,
            categoryTypes: JSON.stringify(policy.categoryTypes || []),
            returnsAccepted: policy.returnsAccepted,
            returnPeriod: policy.returnPeriod?.value || 30,
            refundMethod: policy.refundMethod,
            returnShippingCostPayer: policy.returnShippingCostPayer,
            restockingFeePercentage: policy.restockingFeePercentage,
            syncedFromEbay: true
          };
          if (existing) {
            await storage.updateEbayReturnPolicy(policy.returnPolicyId, policyData);
          } else {
            await storage.createEbayReturnPolicy(policyData);
          }
          results.return.synced++;
        } catch (error) {
          console.error(`Failed to sync return policy ${policy.returnPolicyId}:`, error);
          results.return.errors++;
        }
      }
    } catch (error) {
      console.error("Failed to fetch return policies:", error);
    }
    console.log(`\u2705 Policy sync complete:
   Payment: ${results.payment.synced} synced, ${results.payment.errors} errors
   Fulfillment: ${results.fulfillment.synced} synced, ${results.fulfillment.errors} errors
   Return: ${results.return.synced} synced, ${results.return.errors} errors`);
    return results;
  }
  // Get all policies from local database
  async getLocalPolicies() {
    const [payment, fulfillment, returnPolicies] = await Promise.all([
      storage.getEbayPaymentPolicies(),
      storage.getEbayFulfillmentPolicies(),
      storage.getEbayReturnPolicies()
    ]);
    return {
      payment,
      fulfillment,
      return: returnPolicies
    };
  }
  // ==========================================
  // SELLER PRIVILEGES / SELLING LIMITS
  // ==========================================
  /**
   * Get seller privileges including selling limits
   * This uses the eBay Account API to retrieve the seller's current limits
   */
  async getSellerPrivileges() {
    try {
      if (!this.isConfigured()) {
        return { success: false, error: "eBay OAuth not configured" };
      }
      const response = await this.makeRequest("GET", "/sell/account/v1/privilege");
      const products2 = await storage.getProducts();
      const listedProducts = products2.filter((p) => p.listedOnEbay);
      const listedCount = listedProducts.length;
      const listedValue = listedProducts.reduce((sum, p) => {
        return sum + parseFloat(p.salePrice || "0");
      }, 0);
      const limitQuantity = response.sellingLimit?.quantity || 0;
      const limitAmount = parseFloat(response.sellingLimit?.amount?.value || "0");
      const currency = response.sellingLimit?.amount?.currency || "EUR";
      const remainingQuantity = Math.max(0, limitQuantity - listedCount);
      const remainingAmount = Math.max(0, limitAmount - listedValue);
      return {
        success: true,
        sellingLimit: response.sellingLimit,
        sellingLimitRemaining: {
          amount: { value: remainingAmount.toFixed(2), currency },
          quantity: remainingQuantity
        },
        sellerRegistrationCompleted: response.sellerRegistrationCompleted,
        paymentsProgramOnboarded: response.paymentsProgramOnboarded
      };
    } catch (error) {
      console.error("Failed to get seller privileges:", error);
      return {
        success: false,
        error: error.message
      };
    }
  }
  /**
   * Get seller limits with current usage statistics
   * Combines eBay API limits with local database stats for a complete picture
   */
  async getSellerLimitsWithUsage() {
    try {
      const products2 = await storage.getProducts();
      const listedProducts = products2.filter((p) => p.listedOnEbay);
      const itemsListed = listedProducts.length;
      const valueListed = listedProducts.reduce((sum, p) => {
        return sum + parseFloat(p.salePrice || "0");
      }, 0);
      let itemLimit = 0;
      let valueLimit = 0;
      let currency = "EUR";
      let ebayApiResponse = null;
      try {
        if (this.isConfigured()) {
          const response = await this.makeRequest("GET", "/sell/account/v1/privilege");
          ebayApiResponse = response;
          itemLimit = response.sellingLimit?.quantity || 0;
          valueLimit = parseFloat(response.sellingLimit?.amount?.value || "0");
          currency = response.sellingLimit?.amount?.currency || "EUR";
        }
      } catch (apiError) {
        console.warn("Could not fetch eBay selling limits from API, using estimates:", apiError);
        itemLimit = 250;
        valueLimit = 5e3;
      }
      const itemsRemaining = Math.max(0, itemLimit - itemsListed);
      const valueRemaining = Math.max(0, valueLimit - valueListed);
      const itemUsagePercent = itemLimit > 0 ? itemsListed / itemLimit * 100 : 0;
      const valueUsagePercent = valueLimit > 0 ? valueListed / valueLimit * 100 : 0;
      return {
        success: true,
        limits: {
          itemLimit,
          itemsListed,
          itemsRemaining,
          itemUsagePercent: Math.round(itemUsagePercent * 10) / 10,
          valueLimit,
          valueListed: Math.round(valueListed * 100) / 100,
          valueRemaining: Math.round(valueRemaining * 100) / 100,
          valueUsagePercent: Math.round(valueUsagePercent * 10) / 10,
          currency
        },
        ebayApiResponse
      };
    } catch (error) {
      console.error("Failed to get seller limits with usage:", error);
      return {
        success: false,
        error: error.message
      };
    }
  }
};
var ebayAccountApi = new EbayAccountApiService();

// server/routes.ts
init_dynamic_pricing();

// server/cron-jobs.ts
init_storage();

// server/tme-api-optimized.ts
init_storage();
import crypto3 from "crypto";
var TMEApiServiceOptimized = class {
  credentials;
  baseUrl = "https://api.tme.eu";
  callCount = 0;
  dailyLimit = 1e4;
  rateLimitPerMinute = 60;
  lastCallTimestamp = 0;
  callsThisMinute = 0;
  // PostgreSQL cache replaces in-memory Map for production scalability (150k+ products)
  cacheExpiryHours = 24;
  // Cache TTL in hours
  storage = null;
  constructor(storage2) {
    const requiredEnvVars = ["TME_TOKEN", "TME_CUSTOMER_NUMBER", "TME_CONTACT_NUMBER", "TME_APPLICATION_SECRET"];
    const missingVars = requiredEnvVars.filter((v) => !process.env[v]);
    if (missingVars.length > 0) {
      console.error(`\u274C Missing required TME environment variables: ${missingVars.join(", ")}`);
      console.error("Please set these in your environment secrets.");
    }
    this.credentials = {
      token: process.env.TME_TOKEN || "",
      customerNumber: process.env.TME_CUSTOMER_NUMBER || "",
      contactNumber: process.env.TME_CONTACT_NUMBER || "",
      applicationSecret: process.env.TME_APPLICATION_SECRET || ""
    };
    this.storage = storage2 || null;
    console.log("\u2705 TME API Service OPTIMIZED initialized");
    console.log("- Using combined GetPricesAndStocks endpoint");
    console.log("- Credentials loaded from environment variables");
    if (storage2) {
      console.log("- PostgreSQL cache enabled for 150k+ product scalability");
      console.log("- Cache TTL: 24 hours");
    }
  }
  // Check PostgreSQL cache for product data (24hr TTL)
  async getCachedProduct(symbol) {
    if (!this.storage) return null;
    try {
      const cached = await this.storage.getTmeCachedProduct(symbol);
      if (cached) {
        return {
          productData: JSON.parse(cached.productData),
          priceData: cached.priceData ? JSON.parse(cached.priceData) : null,
          stockData: cached.stockData ? JSON.parse(cached.stockData) : null
        };
      }
    } catch (error) {
      console.warn(`Cache read error for ${symbol}:`, error);
    }
    return null;
  }
  // Store product data in PostgreSQL cache
  async setCachedProduct(symbol, productData, priceData, stockData) {
    if (!this.storage) return;
    try {
      const expiresAt = new Date(Date.now() + this.cacheExpiryHours * 60 * 60 * 1e3);
      await this.storage.setTmeCachedProduct({
        symbol,
        productData: JSON.stringify(productData),
        priceData: priceData ? JSON.stringify(priceData) : void 0,
        stockData: stockData ? JSON.stringify(stockData) : void 0,
        expiresAt
      });
    } catch (error) {
      console.warn(`Cache write error for ${symbol}:`, error);
    }
  }
  generateApiSignature(method, url, params) {
    const paramsForSignature = { ...params };
    delete paramsForSignature.ApiSignature;
    const sortedParams = Object.keys(paramsForSignature).sort().map((key) => {
      const value = paramsForSignature[key];
      if (Array.isArray(value)) {
        return value.map(
          (item, index) => `${encodeURIComponent(`${key}[${index}]`)}=${encodeURIComponent(String(item))}`
        ).join("&");
      } else {
        return `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`;
      }
    }).join("&");
    const baseString = `${method}&${encodeURIComponent(url)}&${encodeURIComponent(sortedParams)}`;
    const signature = crypto3.createHmac("sha1", this.credentials.applicationSecret).update(baseString).digest("base64");
    return signature;
  }
  async rateLimitCheck() {
    const now = Date.now();
    if (now - this.lastCallTimestamp > 6e4) {
      this.callsThisMinute = 0;
    }
    const safeRateLimit = 55;
    if (this.callsThisMinute >= safeRateLimit) {
      const waitTime = 6e4 - (now - this.lastCallTimestamp);
      console.log(`\u{1F6A6} Rate limit reached. Waiting ${waitTime}ms...`);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
      this.callsThisMinute = 0;
    }
    if (this.lastCallTimestamp > 0) {
      const timeSinceLastCall = now - this.lastCallTimestamp;
      const minimumDelay = 500;
      if (timeSinceLastCall < minimumDelay) {
        const waitTime = minimumDelay - timeSinceLastCall;
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
    }
    if (this.callCount >= this.dailyLimit) {
      throw new Error(`TME daily limit exceeded: ${this.callCount}/${this.dailyLimit}`);
    }
  }
  async makeRequest(endpoint, params = {}) {
    await this.rateLimitCheck();
    const url = `${this.baseUrl}${endpoint}`;
    const requestParams = {
      Token: this.credentials.token,
      Language: "EN"
    };
    if (this.credentials.token.length === 45) {
      requestParams.Country = "GB";
    }
    Object.entries(params).forEach(([key, value]) => {
      if (value !== void 0 && value !== null) {
        requestParams[key] = value;
      }
    });
    const apiSignature = this.generateApiSignature("POST", url, requestParams);
    requestParams.ApiSignature = apiSignature;
    const formData = new URLSearchParams();
    Object.entries(requestParams).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        value.forEach((item, index) => {
          formData.append(`${key}[${index}]`, String(item));
        });
      } else {
        formData.append(key, String(value));
      }
    });
    this.callCount++;
    this.callsThisMinute++;
    this.lastCallTimestamp = Date.now();
    if (this.storage) {
      try {
        await this.storage.trackApiCall("tme");
      } catch (error) {
        console.error("Failed to track API call:", error);
      }
    }
    console.log(`\u{1F4CA} TME API Call #${this.callCount}: ${endpoint} (${this.callsThisMinute}/55 this minute)`);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Accept": "application/json",
          "User-Agent": "TME-API-Client/1.0"
        },
        body: formData.toString()
      });
      const responseText = await response.text();
      if (!response.ok) {
        console.error(`\u274C HTTP Error: ${response.status}`);
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const data = JSON.parse(responseText);
      if (data.Status !== "OK") {
        console.error("\u274C TME API Error:", data.ErrorMessage);
        throw new Error(`TME API error: ${data.ErrorMessage || "Unknown error"}`);
      }
      return data;
    } catch (error) {
      console.error(`\u274C TME API request failed:`, error);
      throw error;
    }
  }
  /**
   * OPTIMIZED: Search products with pagination (returns full product data)
   * Returns: symbol, details, and paginated results
   * API Calls: 1 per 20 items
   */
  async searchProductsOptimized(query, page = 1, withStock = true) {
    try {
      console.log(`\u{1F50D} Optimized search: "${query}" (page ${page})`);
      const response = await this.makeRequest("/Products/Search.json", {
        SearchPlain: query,
        SearchPage: page,
        SearchWithStock: withStock ? "1" : "0",
        SearchOrder: "PRICE_FIRST_QUANTITY"
      });
      const products2 = response.Data.ProductList || [];
      const total = response.Data.Amount || 0;
      const pageNumber = response.Data.PageNumber || page;
      const totalPages = Math.ceil(total / 20);
      console.log(`\u2705 Found ${products2.length} products (page ${pageNumber} of ${totalPages})`);
      for (const p of products2) {
        await this.setCachedProduct(p.Symbol, p);
      }
      return { products: products2, total, pageNumber, totalPages };
    } catch (error) {
      console.error(`\u274C Search failed:`, error);
      return { products: [], total: 0, pageNumber: 1, totalPages: 0 };
    }
  }
  /**
   * FULL PAGINATION: Fetch ALL products from a search/category
   * Loops through all pages respecting TME's PageNumber and TotalPages
   * Designed for 150k+ product scale with rate limiting
   * @param query - Search query or category
   * @param maxPages - Optional limit on pages to fetch (default: all)
   * @param delayBetweenPages - Delay in ms between page requests (default: 1500ms)
   */
  async searchAllProductsPaginated(query, maxPages, delayBetweenPages = 1500) {
    const allProducts = [];
    let currentPage = 1;
    let totalAvailable = 0;
    let totalPages = 1;
    console.log(`\u{1F4DA} Starting paginated search for: "${query}"`);
    try {
      do {
        const result = await this.searchProductsOptimized(query, currentPage, true);
        if (currentPage === 1) {
          totalAvailable = result.total;
          totalPages = result.totalPages;
          console.log(`\u{1F4CA} Total available: ${totalAvailable} products across ${totalPages} pages`);
        }
        allProducts.push(...result.products);
        console.log(`\u{1F4C4} Page ${currentPage}/${totalPages}: fetched ${result.products.length} products (total: ${allProducts.length})`);
        if (maxPages && currentPage >= maxPages) {
          console.log(`\u23F9\uFE0F Reached maxPages limit (${maxPages})`);
          break;
        }
        currentPage++;
        if (currentPage <= totalPages) {
          await new Promise((resolve) => setTimeout(resolve, delayBetweenPages));
        }
      } while (currentPage <= totalPages);
      console.log(`\u2705 Pagination complete: fetched ${allProducts.length} of ${totalAvailable} products`);
      return {
        products: allProducts,
        totalFetched: allProducts.length,
        totalAvailable
      };
    } catch (error) {
      console.error(`\u274C Paginated search failed at page ${currentPage}:`, error);
      return {
        products: allProducts,
        totalFetched: allProducts.length,
        totalAvailable
      };
    }
  }
  /**
   * OPTIMIZED: Get prices and stocks in SINGLE combined call
   * Before: 2 separate API calls
   * After: 1 combined API call
   * Reduction: 50% fewer calls
   */
  async getProductsPricesAndStocks(symbols) {
    if (symbols.length === 0) return [];
    try {
      const batchSize = 100;
      const results = [];
      for (let i = 0; i < symbols.length; i += batchSize) {
        const batch = symbols.slice(i, i + batchSize);
        console.log(`\u{1F4B0} Getting prices & stock for ${batch.length} products (1 API call)`);
        const response = await this.makeRequest("/Products/GetPricesAndStocks.json", {
          SymbolList: batch
        });
        results.push(...response.Data.ProductList || []);
        if (i + batchSize < symbols.length) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
      return results;
    } catch (error) {
      console.error("Failed to get prices and stocks:", error);
      return [];
    }
  }
  /**
   * OPTIMIZED: Complete product import with minimal API calls
   * Uses PostgreSQL cache for 24hr TTL - scalable to 150k+ products
   * Before: 3 calls per 10 products = 30 calls for 100
   * After: ~2 calls for 100 products = 93% reduction!
   */
  async syncProductsBatch(symbols) {
    if (symbols.length === 0) return [];
    try {
      console.log(`\u{1F680} Syncing ${symbols.length} products (optimized - PostgreSQL cache + minimal API calls)`);
      const pricesAndStocks = await this.getProductsPricesAndStocks(symbols);
      const products2 = [];
      const symbolsNeedingDetails = [];
      for (const symbol of symbols) {
        const cached = await this.getCachedProduct(symbol);
        if (cached?.productData) {
          products2.push(cached.productData);
          console.log(`\u{1F4BE} Cache HIT: ${symbol}`);
        } else {
          symbolsNeedingDetails.push(symbol);
        }
      }
      if (symbolsNeedingDetails.length > 0) {
        console.log(`\u{1F4DD} Cache MISS: Fetching details for ${symbolsNeedingDetails.length} products from TME API`);
        const detailedProducts = await this.getProductDetails(symbolsNeedingDetails);
        products2.push(...detailedProducts);
        for (const p of detailedProducts) {
          const pricing = pricesAndStocks.find((ps) => ps.Symbol === p.Symbol);
          await this.setCachedProduct(p.Symbol, p, pricing, null);
        }
      }
      const results = symbols.map((symbol) => {
        const details = products2.find((p) => p.Symbol === symbol) || null;
        const pricing = pricesAndStocks.find((p) => p.Symbol === symbol) || null;
        return {
          Symbol: symbol,
          details,
          pricing
        };
      });
      return results;
    } catch (error) {
      console.error("Sync batch failed:", error);
      return [];
    }
  }
  async getProductDetails(symbols) {
    if (symbols.length === 0) return [];
    try {
      const batchSize = 50;
      const results = [];
      for (let i = 0; i < symbols.length; i += batchSize) {
        const batch = symbols.slice(i, i + batchSize);
        const response = await this.makeRequest("/Products/GetProducts.json", {
          SymbolList: batch
        });
        results.push(...response.Data.ProductList || []);
        if (i + batchSize < symbols.length) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
      return results;
    } catch (error) {
      console.error("Failed to get product details:", error);
      return [];
    }
  }
  async getApiUsage() {
    let callsToday = this.callCount;
    if (this.storage) {
      try {
        const usage = await this.storage.getApiUsage("tme");
        if (usage) {
          callsToday = usage.callsToday;
        }
      } catch (error) {
        console.warn("Failed to get API usage from database:", error);
      }
    }
    return {
      callsToday,
      dailyLimit: this.dailyLimit,
      callsThisMinute: this.callsThisMinute,
      rateLimitPerMinute: this.rateLimitPerMinute,
      remainingDaily: this.dailyLimit - callsToday,
      cacheType: "PostgreSQL",
      // Indicates PostgreSQL-based caching
      usagePercentage: Math.round(callsToday / this.dailyLimit * 100),
      status: callsToday >= this.dailyLimit ? "LIMIT_EXCEEDED" : callsToday > this.dailyLimit * 0.8 ? "WARNING" : "OK"
    };
  }
  async clearCache() {
    if (!this.storage) {
      console.log("\u26A0\uFE0F No storage configured - cannot clear PostgreSQL cache");
      return 0;
    }
    try {
      const cleared = await this.storage.cleanExpiredCache();
      console.log(`\u{1F5D1}\uFE0F Cleared ${cleared} expired cache entries from PostgreSQL`);
      return cleared;
    } catch (error) {
      console.error("Failed to clear cache:", error);
      return 0;
    }
  }
};
var tmeApiOptimized = new TMEApiServiceOptimized(storage);

// server/cron-jobs.ts
init_dynamic_pricing();
var tmeApi2 = new TMEApiServiceOptimized(storage);
var SYNC_CONFIG = {
  // Run at 02:00 AM daily (2 hours past midnight)
  dailyRunHour: 2,
  dailyRunMinute: 0,
  // Batch sizes for processing
  batchSize: 50,
  // Products to process per TME API call
  delayBetweenBatches: 2e3,
  // 2 seconds between batches
  // Queue priorities
  criticalPriorityThreshold: 20,
  // % price change for critical priority
  highPriorityThreshold: 10
  // % price change for high priority
};
async function getLocalProductSkus() {
  try {
    const products2 = await storage.getProducts();
    const skus = products2.filter((p) => p.supplier === "TME" && p.sku).map((p) => p.sku);
    console.log(`\u{1F4E6} Found ${skus.length} TME products in local database`);
    return skus;
  } catch (error) {
    console.error("Failed to get local product SKUs:", error);
    return [];
  }
}
async function fetchLiveTMEData(symbols) {
  const liveData = /* @__PURE__ */ new Map();
  console.log(`\u{1F504} Fetching live TME data for ${symbols.length} products...`);
  try {
    for (let i = 0; i < symbols.length; i += SYNC_CONFIG.batchSize) {
      const batch = symbols.slice(i, i + SYNC_CONFIG.batchSize);
      console.log(`\u{1F4E1} Batch ${Math.floor(i / SYNC_CONFIG.batchSize) + 1}/${Math.ceil(symbols.length / SYNC_CONFIG.batchSize)}`);
      const pricesAndStocks = await tmeApi2.getProductsPricesAndStocks(batch);
      for (const item of pricesAndStocks) {
        const priceList = item.PriceList || [];
        let stock = 0;
        if (item.StockList && item.StockList.length > 0) {
          stock = item.StockList.reduce((sum, warehouse) => sum + (warehouse.Amount || 0), 0);
        } else if (item.Amount !== void 0) {
          stock = item.Amount;
        }
        liveData.set(item.Symbol, { priceList, stock });
      }
      if (i + SYNC_CONFIG.batchSize < symbols.length) {
        await new Promise((resolve) => setTimeout(resolve, SYNC_CONFIG.delayBetweenBatches));
      }
    }
    console.log(`\u2705 Fetched live data for ${liveData.size} products`);
    return liveData;
  } catch (error) {
    console.error("Failed to fetch live TME data:", error);
    return liveData;
  }
}
async function calculateDiff(localSkus, liveData) {
  const diffs = [];
  console.log("\u{1F50D} Calculating diffs between local and live data...");
  try {
    for (const sku of localSkus) {
      const product = await storage.getProductBySku(sku);
      if (!product) continue;
      const live = liveData.get(sku);
      if (!live) continue;
      const moq = product.moq || 1;
      const livePrice = getSupplierPriceForMoq(live.priceList, moq);
      const localPrice = parseFloat(product.supplierPrice?.toString() || "0");
      const localStock = product.stock || 0;
      const priceChanged = Math.abs(localPrice - livePrice) > 0.01;
      const stockChanged = localStock !== live.stock;
      if (priceChanged || stockChanged) {
        diffs.push({
          symbol: sku,
          changes: {
            priceChanged,
            stockChanged,
            oldPrice: localPrice,
            newPrice: livePrice,
            oldStock: localStock,
            newStock: live.stock
          }
        });
      }
    }
    console.log(`\u{1F4CA} Found ${diffs.length} products with changes (${localSkus.length - diffs.length} unchanged)`);
    return diffs;
  } catch (error) {
    console.error("Failed to calculate diffs:", error);
    return diffs;
  }
}
function calculatePriority(diff) {
  const priceChange = Math.abs(
    ((diff.changes.newPrice || 0) - (diff.changes.oldPrice || 0)) / (diff.changes.oldPrice || 1)
  ) * 100;
  if (priceChange >= SYNC_CONFIG.criticalPriorityThreshold) {
    return 1;
  } else if (priceChange >= SYNC_CONFIG.highPriorityThreshold) {
    return 2;
  } else if (diff.changes.stockChanged && diff.changes.newStock === 0) {
    return 1;
  } else if (diff.changes.stockChanged) {
    return 3;
  }
  return 4;
}
async function pushToSyncQueue(diffs) {
  let queued = 0;
  console.log(`\u{1F4E4} Pushing ${diffs.length} items to sync queue...`);
  try {
    for (const diff of diffs) {
      const product = await storage.getProductBySku(diff.symbol);
      if (!product) continue;
      const priority = calculatePriority(diff);
      const operation = diff.changes.priceChanged ? "update_price" : "update_stock";
      await storage.createSyncQueueItem({
        productId: product.id,
        operation,
        priority,
        status: "pending",
        marketplace: "ebay",
        // Default marketplace
        retryCount: 0,
        maxRetries: 3
      });
      await storage.updateProduct(product.id, {
        supplierPrice: diff.changes.newPrice?.toString() || product.supplierPrice,
        stock: diff.changes.newStock ?? product.stock,
        lastSyncedAt: /* @__PURE__ */ new Date()
      });
      queued++;
    }
    console.log(`\u2705 Queued ${queued} items for sync`);
    return queued;
  } catch (error) {
    console.error("Failed to push to sync queue:", error);
    return queued;
  }
}
async function syncToEbay(diffs) {
  console.log("");
  console.log("\u{1F3EA} EBAY SYNC PHASE");
  console.log("==================");
  const result = { attempted: 0, succeeded: 0, failed: 0, skipped: 0, ended: 0, relisted: 0 };
  if (diffs.length === 0) {
    console.log("\u26A0\uFE0F No changes to sync to eBay");
    return result;
  }
  try {
    const ebayUpdates = [];
    const productsToEnd = [];
    const productsToRelist = [];
    for (const diff of diffs) {
      const product = await storage.getProductBySku(diff.symbol);
      if (!product) continue;
      const tmeStock = diff.changes.newStock ?? product.stock ?? 0;
      const stockInfo = calculateEbayStock({ ...product, stock: tmeStock });
      const ebayStock = stockInfo.ebayStock;
      if (product.ebayItemId && !product.listedOnEbay && ebayStock > 0) {
        productsToRelist.push({
          productId: product.id,
          productName: product.name,
          sku: product.sku
        });
        continue;
      }
      if (!product.ebayItemId || !product.listedOnEbay) {
        result.skipped++;
        continue;
      }
      if (ebayStock === 0) {
        productsToEnd.push({
          productId: product.id,
          ebayItemId: product.ebayItemId,
          productName: product.name,
          sku: product.sku
        });
        continue;
      }
      const supplierPrice = diff.changes.newPrice || parseFloat(product.supplierPrice?.toString() || "0");
      const pricingResult = supplierPrice > 0 ? calculateDynamicPrice(supplierPrice) : { finalPrice: parseFloat(product.salePrice?.toString() || "0") };
      ebayUpdates.push({
        productId: product.id,
        ebayItemId: product.ebayItemId,
        quantity: ebayStock,
        price: pricingResult.finalPrice,
        sku: product.sku
      });
    }
    if (productsToEnd.length > 0) {
      console.log(`\u{1F6D1} Ending ${productsToEnd.length} out-of-stock listings (better for eBay algorithm)`);
      for (const item of productsToEnd) {
        try {
          const endResult = await ebayApi.unlistProduct(item.productId);
          if (endResult.success) {
            result.ended++;
            console.log(`   \u2705 Ended listing for "${item.productName}" (${item.sku})`);
          } else {
            result.failed++;
            console.log(`   \u274C Failed to end "${item.productName}": ${endResult.message}`);
          }
        } catch (error) {
          result.failed++;
          console.log(`   \u274C Error ending "${item.productName}": ${error.message}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    if (productsToRelist.length > 0) {
      console.log(`\u{1F504} Re-listing ${productsToRelist.length} products back in stock`);
      for (const item of productsToRelist) {
        try {
          const listResult = await ebayApi.listProduct(item.productId, {}, true);
          if (listResult.success) {
            result.relisted++;
            console.log(`   \u2705 Re-listed "${item.productName}" (${item.sku})`);
          } else {
            result.failed++;
            console.log(`   \u274C Failed to re-list "${item.productName}": ${listResult.message}`);
          }
        } catch (error) {
          result.failed++;
          console.log(`   \u274C Error re-listing "${item.productName}": ${error.message}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 1e3));
      }
    }
    if (ebayUpdates.length > 0) {
      console.log(`\u{1F4E6} Syncing ${ebayUpdates.length} in-stock products to eBay in batches of 4`);
      result.attempted = ebayUpdates.length;
      const bulkResult = await ebayApi.bulkUpdateInventory(ebayUpdates);
      result.succeeded = bulkResult.succeeded;
      result.failed += bulkResult.failed;
      const failures = bulkResult.results.filter((r) => !r.success);
      if (failures.length > 0) {
        console.log(`\u26A0\uFE0F Failed eBay updates:`);
        failures.slice(0, 5).forEach((f) => console.log(`   - ${f.ebayItemId}: ${f.message}`));
        if (failures.length > 5) {
          console.log(`   ... and ${failures.length - 5} more`);
        }
      }
    } else if (productsToEnd.length === 0 && productsToRelist.length === 0) {
      console.log("\u26A0\uFE0F No eBay-listed products with changes");
      return result;
    }
    await storage.createSyncLog({
      source: "cron",
      operation: "ebay_bulk_sync",
      status: result.failed === 0 ? "success" : "partial",
      message: `eBay sync: ${result.succeeded} updated, ${result.relisted} re-listed, ${result.ended} ended, ${result.failed} failed, ${result.skipped} skipped`,
      details: JSON.stringify({
        attempted: result.attempted,
        succeeded: result.succeeded,
        relisted: result.relisted,
        ended: result.ended,
        failed: result.failed,
        skipped: result.skipped
      })
    });
    console.log(`\u2705 eBay sync complete: ${result.succeeded} updated, ${result.relisted} re-listed, ${result.ended} ended, ${result.failed} failed, ${result.skipped} skipped`);
    return result;
  } catch (error) {
    console.error("\u274C eBay sync failed:", error);
    await storage.createSyncLog({
      source: "cron",
      operation: "ebay_bulk_sync",
      status: "error",
      message: `eBay sync failed: ${error.message}`
    });
    return result;
  }
}
async function checkAndRelistBackInStock() {
  const result = { relisted: 0, failed: 0 };
  try {
    const products2 = await storage.getProducts();
    const productsToRelist = products2.filter(
      (p) => p.ebayItemId && // Has been listed before
      !p.listedOnEbay && // Currently ended/unlisted
      (p.stock || 0) > 0
      // Has stock available
    );
    if (productsToRelist.length === 0) {
      console.log("\u{1F4E6} No products need relisting (all ended products still out of stock)");
      return result;
    }
    console.log(`\u{1F504} Found ${productsToRelist.length} products to relist (back in stock)`);
    for (const product of productsToRelist) {
      try {
        console.log(`   \u{1F4E6} Relisting "${product.name}" (${product.sku}) - stock: ${product.stock}`);
        const listResult = await ebayApi.listProduct(product.id, {}, true);
        if (listResult.success) {
          result.relisted++;
          console.log(`   \u2705 Re-listed "${product.name}" (${product.sku}) - New Item ID: ${listResult.itemId}`);
        } else {
          result.failed++;
          console.log(`   \u274C Failed to re-list "${product.name}": ${listResult.message}`);
        }
      } catch (error) {
        result.failed++;
        console.log(`   \u274C Error re-listing "${product.name}": ${error.message}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 1e3));
    }
    console.log(`\u2705 Relist check complete: ${result.relisted} relisted, ${result.failed} failed`);
    return result;
  } catch (error) {
    console.error("\u274C Relist check failed:", error);
    return result;
  }
}
async function runDailySync() {
  const startTime = Date.now();
  console.log("");
  console.log("====================================");
  console.log("\u{1F319} DAILY SYNC STARTED at " + (/* @__PURE__ */ new Date()).toISOString());
  console.log("====================================");
  const emptyResult = {
    totalProducts: 0,
    changedProducts: 0,
    queuedItems: 0,
    ebaySync: { attempted: 0, succeeded: 0, failed: 0, skipped: 0, ended: 0, relisted: 0 },
    duration: 0
  };
  try {
    await storage.createSyncLog({
      source: "cron",
      operation: "daily_sync_start",
      status: "in_progress",
      message: "Daily TME sync started"
    });
    const localSkus = await getLocalProductSkus();
    if (localSkus.length === 0) {
      console.log("\u26A0\uFE0F No TME products found in database");
      return emptyResult;
    }
    const liveData = await fetchLiveTMEData(localSkus);
    const diffs = await calculateDiff(localSkus, liveData);
    const queuedItems = await pushToSyncQueue(diffs);
    const ebayResult = await syncToEbay(diffs);
    const relistResult = await checkAndRelistBackInStock();
    ebayResult.relisted += relistResult.relisted;
    ebayResult.failed += relistResult.failed;
    const duration = Math.round((Date.now() - startTime) / 1e3);
    await storage.createSyncLog({
      source: "cron",
      operation: "daily_sync_complete",
      status: "success",
      message: `Daily sync completed: ${diffs.length} changes, ${ebayResult.succeeded} eBay updates`,
      details: JSON.stringify({
        totalProducts: localSkus.length,
        changedProducts: diffs.length,
        queuedItems,
        ebaySync: ebayResult,
        duration
      })
    });
    console.log("");
    console.log("====================================");
    console.log("\u2705 DAILY SYNC COMPLETED");
    console.log(`   Total products: ${localSkus.length}`);
    console.log(`   Changes detected: ${diffs.length}`);
    console.log(`   Items queued: ${queuedItems}`);
    console.log(`   eBay updates: ${ebayResult.succeeded}/${ebayResult.attempted} (${ebayResult.skipped} skipped)`);
    console.log(`   eBay re-listed (back in stock): ${ebayResult.relisted}`);
    console.log(`   eBay listings ended (out of stock): ${ebayResult.ended}`);
    console.log(`   Duration: ${duration}s`);
    console.log("====================================");
    console.log("");
    return {
      totalProducts: localSkus.length,
      changedProducts: diffs.length,
      queuedItems,
      ebaySync: ebayResult,
      duration
    };
  } catch (error) {
    console.error("\u274C Daily sync failed:", error);
    await storage.createSyncLog({
      source: "cron",
      operation: "daily_sync_error",
      status: "error",
      message: `Daily sync failed: ${error.message}`
    });
    return emptyResult;
  }
}
async function triggerManualSync() {
  console.log("\u{1F527} Manual sync triggered");
  return await runDailySync();
}

// server/sync-chunk.ts
init_storage();
init_tme_api();
init_dynamic_pricing();
function startOfToday() {
  const d = /* @__PURE__ */ new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
async function runSyncChunk(limit = 50) {
  const errors = [];
  const today = startOfToday();
  const all = await storage.getProducts();
  const tmeProducts = all.filter((p) => p.supplier === "TME" && p.sku);
  const total = tmeProducts.length;
  const pending = tmeProducts.filter((p) => {
    const t = p.lastSyncedAt ? new Date(p.lastSyncedAt).getTime() : 0;
    return t < today;
  }).sort((a, b) => {
    const at = a.lastSyncedAt ? new Date(a.lastSyncedAt).getTime() : 0;
    const bt = b.lastSyncedAt ? new Date(b.lastSyncedAt).getTime() : 0;
    return at - bt;
  });
  const slice = pending.slice(0, limit);
  if (slice.length === 0) {
    return { total, remaining: 0, processedThisChunk: 0, changed: 0, ebayUpdated: 0, done: true, errors };
  }
  const symbols = slice.map((p) => p.supplierProductId || p.sku);
  let enhanced = [];
  try {
    enhanced = await tmeApi.getEnhancedProductInfo(symbols);
  } catch (e) {
    errors.push(`TME fetch failed: ${e.message}`);
  }
  const bySymbol = new Map(enhanced.map((e) => [e.product?.Symbol, e]));
  let changed = 0;
  const ebayBatch = [];
  const now = /* @__PURE__ */ new Date();
  for (const product of slice) {
    const sym = product.supplierProductId || product.sku;
    const info = bySymbol.get(sym);
    if (!info) {
      await storage.updateProduct(product.id, { lastSyncedAt: now });
      continue;
    }
    const moq = info.product?.MinAmount || product.moq || 1;
    const multiples = info.product?.Multiples || product.multiples || 1;
    const supplierPrice = getSupplierPriceForMoq(info.price?.PriceList, moq);
    const stock = info.stock?.Amount ?? product.stock ?? 0;
    const pricing = supplierPrice > 0 ? moq > 1 ? calculatePackagePrice(supplierPrice, moq, multiples) : calculateDynamicPrice(supplierPrice) : null;
    const localSupplier = parseFloat(product.supplierPrice?.toString() || "0");
    const priceChanged = supplierPrice > 0 && Math.abs(localSupplier - supplierPrice) > 0.01;
    const stockChanged = (product.stock || 0) !== stock;
    const update = { lastSyncedAt: now, stock };
    if (supplierPrice > 0) update.supplierPrice = String(supplierPrice);
    if (info.product?.MinAmount) update.moq = info.product.MinAmount;
    if (info.product?.Multiples) update.multiples = info.product.Multiples;
    if (pricing && product.useCalculatedPrice !== false) {
      update.salePrice = String(pricing.finalPrice);
      update.calculatedPrice = String(pricing.calculatedPrice);
      update.marginTier = pricing.marginTier;
      update.marginPercentage = String(pricing.marginPercentage);
      update.priceUpdatedAt = now;
    }
    await storage.updateProduct(product.id, update);
    if (priceChanged || stockChanged) {
      changed++;
      if (product.listedOnEbay && product.ebayItemId) {
        const limited = product.useStockLimit && product.ebayStockLimit != null ? Math.min(stock, product.ebayStockLimit) : stock;
        ebayBatch.push({
          productId: product.id,
          ebayItemId: product.ebayItemId,
          quantity: Math.max(0, limited),
          price: pricing ? Number(pricing.finalPrice) : void 0
        });
      }
    }
  }
  let ebayUpdated = 0;
  if (ebayBatch.length > 0) {
    try {
      const r = await ebayApi.bulkUpdateInventory(ebayBatch);
      ebayUpdated = r.succeeded;
      if (r.failed) errors.push(`eBay updates: ${r.failed} failed`);
    } catch (e) {
      errors.push(`eBay bulk update failed: ${e.message}`);
    }
  }
  const remaining = Math.max(0, pending.length - slice.length);
  return {
    total,
    remaining,
    processedThisChunk: slice.length,
    changed,
    ebayUpdated,
    done: remaining === 0,
    errors
  };
}

// server/ebay-orders-api.ts
init_ebay_oauth();
init_storage();
var EbayOrdersApiService = class {
  baseUrl = "https://api.ebay.com";
  sandboxUrl = "https://api.sandbox.ebay.com";
  isProduction = true;
  getApiUrl() {
    return this.isProduction ? this.baseUrl : this.sandboxUrl;
  }
  async getAccessToken() {
    return ebayOAuth.getValidAccessToken();
  }
  async makeRequest(method, endpoint, body) {
    const accessToken = await this.getAccessToken();
    const url = `${this.getApiUrl()}${endpoint}`;
    console.log(`\u{1F4E6} eBay Fulfillment API: ${method} ${endpoint}`);
    const headers = {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
      "Content-Language": "en-GB",
      "Accept-Language": "en-GB"
    };
    const options = {
      method,
      headers,
      body: body ? JSON.stringify(body) : void 0
    };
    try {
      const response = await fetch(url, options);
      await storage.trackApiCall("ebay");
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`\u274C eBay Fulfillment API Error: ${response.status} ${response.statusText}`);
        console.error(`   Response: ${errorText}`);
        let errorData = {};
        try {
          errorData = JSON.parse(errorText);
        } catch {
        }
        const errorMessage = errorData.errors?.[0]?.longMessage || errorData.errors?.[0]?.message || errorText;
        throw new Error(`eBay Fulfillment API Error (${response.status}): ${errorMessage}`);
      }
      if (response.status === 204) {
        return {};
      }
      const data = await response.json();
      return data;
    } catch (error) {
      console.error(`\u274C eBay Fulfillment API Request Failed:`, error);
      throw error;
    }
  }
  async getOrders(filter) {
    const params = new URLSearchParams();
    if (filter?.orderIds?.length) {
      params.append("orderIds", filter.orderIds.join(","));
    }
    const dateRangeFilters = [];
    if (filter?.creationDateFrom && filter?.creationDateTo) {
      dateRangeFilters.push(`creationdate:[${filter.creationDateFrom}..${filter.creationDateTo}]`);
    } else if (filter?.creationDateFrom) {
      dateRangeFilters.push(`creationdate:[${filter.creationDateFrom}..]`);
    }
    if (dateRangeFilters.length > 0) {
      params.append("filter", dateRangeFilters.join(","));
    }
    params.append("limit", String(filter?.limit || 50));
    if (filter?.offset) {
      params.append("offset", String(filter.offset));
    }
    const queryString = params.toString();
    const endpoint = `/sell/fulfillment/v1/order${queryString ? `?${queryString}` : ""}`;
    return this.makeRequest("GET", endpoint);
  }
  async getOrder(orderId) {
    return this.makeRequest("GET", `/sell/fulfillment/v1/order/${orderId}`);
  }
  async getRecentOrders(daysBack = 30) {
    const toDate = /* @__PURE__ */ new Date();
    const fromDate = /* @__PURE__ */ new Date();
    fromDate.setDate(fromDate.getDate() - daysBack);
    return this.getOrders({
      creationDateFrom: fromDate.toISOString(),
      creationDateTo: toDate.toISOString(),
      limit: 200
    });
  }
  mapEbayOrderStatus(orderFulfillmentStatus, orderPaymentStatus, cancelState) {
    if (cancelState === "CANCELED") {
      return "cancelled";
    }
    const statusMap = {
      "NOT_STARTED": "new",
      "IN_PROGRESS": "packed",
      "FULFILLED": "shipped"
    };
    return statusMap[orderFulfillmentStatus] || "new";
  }
  async syncOrdersFromEbay(daysBack = 30) {
    console.log(`\u{1F504} Starting eBay orders sync (last ${daysBack} days)...`);
    let synced = 0;
    let updated = 0;
    let failed = 0;
    const errors = [];
    try {
      const ordersResponse = await this.getRecentOrders(daysBack);
      console.log(`\u{1F4E6} Found ${ordersResponse.total} eBay orders`);
      for (const ebayOrder of ordersResponse.orders) {
        try {
          const existingOrder = await storage.getOrderByMarketplaceId("ebay", ebayOrder.orderId);
          if (existingOrder) {
            await this.updateExistingOrder(existingOrder.id, ebayOrder);
            updated++;
          } else {
            await this.createNewOrder(ebayOrder);
            synced++;
          }
        } catch (error) {
          failed++;
          const errorMsg = `Failed to sync order ${ebayOrder.orderId}: ${error.message}`;
          console.error(`\u274C ${errorMsg}`);
          errors.push(errorMsg);
        }
      }
      console.log(`\u2705 eBay orders sync complete: ${synced} new, ${updated} updated, ${failed} failed`);
    } catch (error) {
      const errorMsg = `eBay orders sync failed: ${error.message}`;
      console.error(`\u274C ${errorMsg}`);
      errors.push(errorMsg);
    }
    return { synced, updated, failed, errors };
  }
  async createNewOrder(ebayOrder) {
    const shippingInfo = ebayOrder.fulfillmentStartInstructions?.[0]?.shippingStep;
    const shipTo = shippingInfo?.shipTo;
    const contactAddress = shipTo?.contactAddress;
    const orderData = {
      marketplace: "ebay",
      marketplaceOrderId: ebayOrder.orderId,
      status: this.mapEbayOrderStatus(
        ebayOrder.orderFulfillmentStatus,
        ebayOrder.orderPaymentStatus,
        ebayOrder.cancelStatus?.cancelState
      ),
      buyerUsername: ebayOrder.buyer.username,
      buyerEmail: shipTo?.email || null,
      shippingName: shipTo?.fullName || "Unknown",
      shippingAddressLine1: contactAddress?.addressLine1 || "",
      shippingAddressLine2: contactAddress?.addressLine2 || null,
      shippingCity: contactAddress?.city || "",
      shippingStateOrProvince: contactAddress?.stateOrProvince || null,
      shippingPostalCode: contactAddress?.postalCode || "",
      shippingCountry: contactAddress?.countryCode || "GB",
      shippingPhone: shipTo?.primaryPhone?.phoneNumber || null,
      subtotal: ebayOrder.pricingSummary.priceSubtotal.value,
      shippingCost: ebayOrder.pricingSummary.deliveryCost?.value || "0.00",
      totalPrice: ebayOrder.pricingSummary.total.value,
      currency: ebayOrder.pricingSummary.total.currency || "EUR",
      marketplaceFee: ebayOrder.totalMarketplaceFee?.value || null,
      paymentProcessingFee: null,
      shippingService: shippingInfo?.shippingServiceCode || null,
      shippingCarrier: null,
      trackingNumber: null,
      trackingUrl: null,
      paidAt: ebayOrder.paymentSummary?.payments?.[0]?.paymentDate ? new Date(ebayOrder.paymentSummary.payments[0].paymentDate) : null,
      shippedAt: null,
      deliveredAt: null,
      expectedDeliveryStart: null,
      expectedDeliveryEnd: null,
      logisticsCarrier: null,
      logisticsLabelUrl: null,
      logisticsLabelData: null,
      buyerNote: ebayOrder.buyerCheckoutNotes || null,
      sellerNote: null,
      rawOrderData: JSON.stringify(ebayOrder),
      orderDate: new Date(ebayOrder.creationDate)
    };
    const order = await storage.createOrder(orderData);
    const orderItems2 = ebayOrder.lineItems.map((item) => ({
      orderId: order.id,
      marketplaceItemId: item.lineItemId,
      productId: null,
      sku: item.sku || `EBAY-${item.legacyItemId}`,
      tmeProductId: null,
      title: item.title,
      quantity: item.quantity,
      unitPrice: item.lineItemCost.value,
      totalPrice: item.total.value,
      imageUrl: null
    }));
    if (orderItems2.length > 0) {
      await storage.createOrderItems(orderItems2);
    }
    if (ebayOrder.totalMarketplaceFee) {
      const fee = {
        orderId: order.id,
        feeType: "ebay_final_value",
        description: "eBay Final Value Fee",
        amount: ebayOrder.totalMarketplaceFee.value,
        currency: ebayOrder.totalMarketplaceFee.currency || "EUR"
      };
      await storage.createOrderFee(fee);
    }
    await storage.createOrderEvent({
      orderId: order.id,
      eventType: "synced",
      note: `Order synced from eBay (${ebayOrder.orderId})`
    });
    console.log(`\u2705 Created order #${order.id} from eBay ${ebayOrder.orderId}`);
    return order;
  }
  async updateExistingOrder(orderId, ebayOrder) {
    const newStatus = this.mapEbayOrderStatus(
      ebayOrder.orderFulfillmentStatus,
      ebayOrder.orderPaymentStatus,
      ebayOrder.cancelStatus?.cancelState
    );
    const shippingInfo = ebayOrder.fulfillmentStartInstructions?.[0]?.shippingStep;
    const shipTo = shippingInfo?.shipTo;
    const contactAddress = shipTo?.contactAddress;
    await storage.updateOrder(orderId, {
      status: newStatus,
      shippingName: shipTo?.fullName || "Unknown",
      shippingAddressLine1: contactAddress?.addressLine1 || "",
      shippingAddressLine2: contactAddress?.addressLine2 || null,
      shippingCity: contactAddress?.city || "",
      shippingStateOrProvince: contactAddress?.stateOrProvince || null,
      shippingPostalCode: contactAddress?.postalCode || "",
      shippingCountry: contactAddress?.countryCode || "GB",
      subtotal: ebayOrder.pricingSummary.priceSubtotal.value,
      shippingCost: ebayOrder.pricingSummary.deliveryCost?.value || "0.00",
      totalPrice: ebayOrder.pricingSummary.total.value,
      marketplaceFee: ebayOrder.totalMarketplaceFee?.value || null,
      rawOrderData: JSON.stringify(ebayOrder)
    });
    console.log(`\u{1F504} Updated order #${orderId} from eBay ${ebayOrder.orderId}`);
  }
  async getOrderShippingFulfillments(orderId) {
    return this.makeRequest("GET", `/sell/fulfillment/v1/order/${orderId}/shipping_fulfillment`);
  }
  async createShippingFulfillment(orderId, fulfillmentData) {
    return this.makeRequest(
      "POST",
      `/sell/fulfillment/v1/order/${orderId}/shipping_fulfillment`,
      fulfillmentData
    );
  }
};
var ebayOrdersApi = new EbayOrdersApiService();

// server/ebay-messages-api.ts
init_ebay_oauth();
var RateLimiter = class {
  callTimestamps = [];
  maxCalls;
  windowMs;
  constructor(maxCalls = 75, windowMs = 6e4) {
    this.maxCalls = maxCalls;
    this.windowMs = windowMs;
  }
  async acquire() {
    const now = Date.now();
    this.callTimestamps = this.callTimestamps.filter((ts) => now - ts < this.windowMs);
    if (this.callTimestamps.length >= this.maxCalls) {
      const oldestCall = this.callTimestamps[0];
      const waitTime = this.windowMs - (now - oldestCall) + 100;
      console.log(`Rate limit reached, waiting ${waitTime}ms before next API call`);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
      return this.acquire();
    }
    this.callTimestamps.push(now);
  }
  getRemaining() {
    const now = Date.now();
    this.callTimestamps = this.callTimestamps.filter((ts) => now - ts < this.windowMs);
    return this.maxCalls - this.callTimestamps.length;
  }
};
var tradingApiRateLimiter = new RateLimiter(75, 6e4);
var TRADING_API_URL = "https://api.ebay.com/ws/api.dll";
async function makeXmlRequest(callName, xmlBody, retries = 3) {
  await tradingApiRateLimiter.acquire();
  const token = await ebayOAuth.getValidAccessToken();
  const headers = {
    "Content-Type": "text/xml",
    "X-EBAY-API-SITEID": process.env.EBAY_MARKETPLACE_SITE_ID || "77",
    "X-EBAY-API-COMPATIBILITY-LEVEL": "1225",
    "X-EBAY-API-CALL-NAME": callName,
    "X-EBAY-API-IAF-TOKEN": token
  };
  let lastError = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3e4);
      const response = await fetch(TRADING_API_URL, {
        method: "POST",
        headers,
        body: xmlBody,
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      return response.text();
    } catch (error) {
      lastError = error;
      console.warn(`eBay API request attempt ${attempt}/${retries} failed:`, error.message);
      if (attempt < retries) {
        const waitTime = Math.min(1e3 * Math.pow(2, attempt - 1), 5e3);
        console.log(`Retrying in ${waitTime}ms...`);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
    }
  }
  throw lastError || new Error("Request failed after all retries");
}
function parseXmlValue(xml, tagName) {
  const regex = new RegExp(`<${tagName}>(.*?)</${tagName}>`, "s");
  const match = xml.match(regex);
  return match ? match[1].trim() : null;
}
function decodeHtmlEntities(text2) {
  return text2.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10))).replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}
function stripHtmlTags(html) {
  let text2 = decodeHtmlEntities(html);
  text2 = text2.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
  text2 = text2.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  text2 = text2.replace(/<head[^>]*>[\s\S]*?<\/head>/gi, "");
  text2 = text2.replace(/<!--[\s\S]*?-->/g, "");
  text2 = text2.replace(/<!DOCTYPE[^>]*>/gi, "");
  text2 = text2.replace(/<\?xml[^>]*\?>/gi, "");
  text2 = text2.replace(/<br\s*\/?>/gi, "\n");
  text2 = text2.replace(/<\/p>/gi, "\n\n");
  text2 = text2.replace(/<\/div>/gi, "\n");
  text2 = text2.replace(/<\/tr>/gi, "\n");
  text2 = text2.replace(/<\/li>/gi, "\n");
  text2 = text2.replace(/<[^>]+>/g, "");
  text2 = decodeHtmlEntities(text2);
  text2 = text2.replace(/\n\s*\n\s*\n/g, "\n\n");
  text2 = text2.replace(/[ \t]+/g, " ");
  text2 = text2.trim();
  return text2;
}
function cleanMessageBody(rawBody) {
  if (!rawBody) return "";
  if (rawBody.includes("<") || rawBody.includes("&lt;")) {
    return stripHtmlTags(rawBody);
  }
  return rawBody.trim();
}
function parseXmlArray(xml, containerTag, itemTag) {
  const containerRegex = new RegExp(`<${containerTag}>(.*?)</${containerTag}>`, "gs");
  const results = [];
  let match;
  while ((match = containerRegex.exec(xml)) !== null) {
    results.push(match[1]);
  }
  return results;
}
async function getMyMessages(startTime, endTime, folderType = "Inbox", limit = 100, pageNumber = 1) {
  try {
    const startTimeStr = startTime ? startTime.toISOString() : new Date(Date.now() - 30 * 24 * 60 * 60 * 1e3).toISOString();
    const endTimeStr = endTime ? endTime.toISOString() : (/* @__PURE__ */ new Date()).toISOString();
    console.log(`\u{1F4EC} Fetching eBay messages page ${pageNumber} (limit: ${limit})...`);
    const headersRequest = `<?xml version="1.0" encoding="utf-8"?>
<GetMyMessagesRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <DetailLevel>ReturnHeaders</DetailLevel>
  <StartTime>${startTimeStr}</StartTime>
  <EndTime>${endTimeStr}</EndTime>
  <Pagination>
    <EntriesPerPage>${limit}</EntriesPerPage>
    <PageNumber>${pageNumber}</PageNumber>
  </Pagination>
</GetMyMessagesRequest>`;
    const headersResponse = await makeXmlRequest("GetMyMessages", headersRequest);
    let ack = parseXmlValue(headersResponse, "Ack");
    if (ack !== "Success" && ack !== "Warning") {
      const errorMessage = parseXmlValue(headersResponse, "LongMessage") || parseXmlValue(headersResponse, "ShortMessage") || "Unknown error";
      console.error("GetMyMessages (headers) failed:", errorMessage);
      return { success: false, messages: [], hasMoreMessages: false, error: errorMessage };
    }
    const headerBlocks = parseXmlArray(headersResponse, "Message", "Message");
    const messageIds = [];
    for (const block of headerBlocks) {
      const messageId = parseXmlValue(block, "MessageID");
      if (messageId) {
        messageIds.push(messageId);
      }
    }
    if (messageIds.length === 0) {
      console.log("No messages found in the specified time range");
      return { success: true, messages: [], hasMoreMessages: false, totalCount: 0 };
    }
    console.log(`Found ${messageIds.length} message IDs, fetching full messages in batches of 10...`);
    const messages2 = [];
    const BATCH_SIZE = 10;
    for (let i = 0; i < messageIds.length; i += BATCH_SIZE) {
      const batchIds = messageIds.slice(i, i + BATCH_SIZE);
      const messageIdsXml = batchIds.map((id) => `<MessageID>${id}</MessageID>`).join("\n    ");
      console.log(`Fetching batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(messageIds.length / BATCH_SIZE)} (${batchIds.length} messages)...`);
      const messagesRequest = `<?xml version="1.0" encoding="utf-8"?>
<GetMyMessagesRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <DetailLevel>ReturnMessages</DetailLevel>
  <MessageIDs>
    ${messageIdsXml}
  </MessageIDs>
</GetMyMessagesRequest>`;
      const messagesResponse = await makeXmlRequest("GetMyMessages", messagesRequest);
      ack = parseXmlValue(messagesResponse, "Ack");
      if (ack !== "Success" && ack !== "Warning") {
        const errorMessage = parseXmlValue(messagesResponse, "LongMessage") || parseXmlValue(messagesResponse, "ShortMessage") || "Unknown error";
        console.error("GetMyMessages (messages) failed:", errorMessage);
        continue;
      }
      const messageBlocks = parseXmlArray(messagesResponse, "Message", "Message");
      for (const block of messageBlocks) {
        const rawBody = parseXmlValue(block, "Text") || parseXmlValue(block, "Content") || "";
        const message = {
          messageId: parseXmlValue(block, "MessageID") || "",
          subject: cleanMessageBody(parseXmlValue(block, "Subject") || "(No Subject)"),
          body: cleanMessageBody(rawBody),
          sender: parseXmlValue(block, "Sender") || "",
          senderEmail: parseXmlValue(block, "SenderEmail") || void 0,
          recipientUserId: parseXmlValue(block, "RecipientUserID") || "",
          itemId: parseXmlValue(block, "ItemID") || void 0,
          itemTitle: parseXmlValue(block, "ItemTitle") || void 0,
          creationDate: parseXmlValue(block, "CreationDate") || parseXmlValue(block, "ReceiveDate") || (/* @__PURE__ */ new Date()).toISOString(),
          messageType: parseXmlValue(block, "MessageType") || "Unknown",
          isRead: parseXmlValue(block, "Read") === "true",
          flagged: parseXmlValue(block, "Flagged") === "true",
          responseEnabled: parseXmlValue(block, "ResponseEnabled") === "true",
          externalMessageId: parseXmlValue(block, "ExternalMessageID") || void 0
        };
        messages2.push(message);
      }
    }
    const hasMore = parseXmlValue(headersResponse, "HasMoreMessages") === "true";
    const totalCount = parseInt(parseXmlValue(headersResponse, "TotalNumberOfMessages") || "0", 10);
    console.log(`Retrieved ${messages2.length} full messages from eBay`);
    return { success: true, messages: messages2, hasMoreMessages: hasMore, totalCount };
  } catch (error) {
    console.error("Error fetching eBay messages:", error);
    return { success: false, messages: [], hasMoreMessages: false, error: error.message };
  }
}
async function getMemberMessages(itemId, mailMessageType = "All", messageStatus = "All", startTime, limit = 100) {
  try {
    let filters = "";
    if (itemId) {
      filters += `<ItemID>${itemId}</ItemID>`;
    }
    if (startTime) {
      filters += `<StartCreationTime>${startTime.toISOString()}</StartCreationTime>`;
    }
    const xmlRequest = `<?xml version="1.0" encoding="utf-8"?>
<GetMemberMessagesRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <MailMessageType>${mailMessageType}</MailMessageType>
  <MessageStatus>${messageStatus}</MessageStatus>
  ${filters}
  <Pagination>
    <EntriesPerPage>${limit}</EntriesPerPage>
    <PageNumber>1</PageNumber>
  </Pagination>
</GetMemberMessagesRequest>`;
    const response = await makeXmlRequest("GetMemberMessages", xmlRequest);
    const ack = parseXmlValue(response, "Ack");
    if (ack !== "Success" && ack !== "Warning") {
      const errorMessage = parseXmlValue(response, "LongMessage") || parseXmlValue(response, "ShortMessage") || "Unknown error";
      console.error("GetMemberMessages failed:", errorMessage);
      return { success: false, messages: [], hasMoreMessages: false, error: errorMessage };
    }
    const messages2 = [];
    const memberMessageBlocks = parseXmlArray(response, "MemberMessage", "MemberMessage");
    for (const block of memberMessageBlocks) {
      const questionBlock = parseXmlValue(block, "Question") || block;
      const message = {
        messageId: parseXmlValue(questionBlock, "MessageID") || "",
        subject: parseXmlValue(questionBlock, "Subject") || "(No Subject)",
        body: parseXmlValue(questionBlock, "Body") || "",
        sender: parseXmlValue(questionBlock, "SenderID") || "",
        senderEmail: parseXmlValue(questionBlock, "SenderEmail") || void 0,
        recipientUserId: parseXmlValue(questionBlock, "RecipientID") || "",
        itemId: parseXmlValue(block, "ItemID") || void 0,
        itemTitle: void 0,
        creationDate: parseXmlValue(questionBlock, "CreationDate") || (/* @__PURE__ */ new Date()).toISOString(),
        messageType: parseXmlValue(questionBlock, "QuestionType") || "General",
        isRead: false,
        flagged: false,
        responseEnabled: true
      };
      messages2.push(message);
    }
    const hasMore = parseXmlValue(response, "HasMoreItems") === "true";
    console.log(`Retrieved ${messages2.length} member messages from eBay`);
    return { success: true, messages: messages2, hasMoreMessages: hasMore };
  } catch (error) {
    console.error("Error fetching eBay member messages:", error);
    return { success: false, messages: [], hasMoreMessages: false, error: error.message };
  }
}
async function sendMessageToPartner(itemId, recipientId, body, subject, questionType = "General") {
  try {
    if (!ebayOAuth.isOAuthConfigured()) {
      return { success: false, error: "eBay OAuth not configured" };
    }
    const subjectLine = subject || "Message from seller";
    const xmlRequest = `<?xml version="1.0" encoding="utf-8"?>
<AddMemberMessageAAQToPartnerRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ItemID>${escapeXml(itemId)}</ItemID>
  <MemberMessage>
    <Subject>${escapeXml(subjectLine)}</Subject>
    <Body>${escapeXml(body)}</Body>
    <QuestionType>${questionType}</QuestionType>
    <RecipientID>${escapeXml(recipientId)}</RecipientID>
    <EmailCopyToSender>true</EmailCopyToSender>
  </MemberMessage>
</AddMemberMessageAAQToPartnerRequest>`;
    const response = await makeXmlRequest("AddMemberMessageAAQToPartner", xmlRequest);
    const ack = parseXmlValue(response, "Ack");
    if (ack !== "Success" && ack !== "Warning") {
      const errorMessage = parseXmlValue(response, "LongMessage") || parseXmlValue(response, "ShortMessage") || "Unknown error";
      console.error("SendMessage failed:", errorMessage);
      return { success: false, error: errorMessage };
    }
    console.log(`Message sent to ${recipientId} successfully`);
    return { success: true };
  } catch (error) {
    console.error("Error sending eBay message:", error);
    return { success: false, error: error.message };
  }
}
async function replyToQuestion(messageId, parentMessageId, recipientId, itemId, body, displayToPublic = false) {
  try {
    if (!ebayOAuth.isOAuthConfigured()) {
      return { success: false, error: "eBay OAuth not configured" };
    }
    const xmlRequest = `<?xml version="1.0" encoding="utf-8"?>
<AddMemberMessageRTQRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ItemID>${escapeXml(itemId)}</ItemID>
  <MemberMessage>
    <Body>${escapeXml(body)}</Body>
    <ParentMessageID>${escapeXml(parentMessageId)}</ParentMessageID>
    <RecipientID>${escapeXml(recipientId)}</RecipientID>
    <DisplayToPublic>${displayToPublic}</DisplayToPublic>
  </MemberMessage>
</AddMemberMessageRTQRequest>`;
    const response = await makeXmlRequest("AddMemberMessageRTQ", xmlRequest);
    const ack = parseXmlValue(response, "Ack");
    if (ack !== "Success" && ack !== "Warning") {
      const errorMessage = parseXmlValue(response, "LongMessage") || parseXmlValue(response, "ShortMessage") || "Unknown error";
      console.error("ReplyToQuestion failed:", errorMessage);
      return { success: false, error: errorMessage };
    }
    console.log(`Reply sent successfully to message ${parentMessageId}`);
    return { success: true };
  } catch (error) {
    console.error("Error replying to eBay question:", error);
    return { success: false, error: error.message };
  }
}
function escapeXml(text2) {
  return text2.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
function renderTemplate(template, variables) {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    const placeholder = new RegExp(`{{${key}}}`, "g");
    result = result.replace(placeholder, value || "");
  }
  return result;
}
function checkOrderMessageEligibility(orderDate) {
  const now = /* @__PURE__ */ new Date();
  const daysSinceOrder = Math.floor((now.getTime() - orderDate.getTime()) / (1e3 * 60 * 60 * 24));
  const daysRemaining = 90 - daysSinceOrder;
  return {
    eligible: daysSinceOrder <= 90,
    daysRemaining: Math.max(0, daysRemaining)
  };
}
function getRateLimitStatus() {
  return {
    remaining: tradingApiRateLimiter.getRemaining(),
    maxCalls: 75
  };
}
var ebayMessagesApi = {
  getMyMessages,
  getMemberMessages,
  sendMessageToPartner,
  replyToQuestion,
  renderTemplate,
  checkOrderMessageEligibility,
  getRateLimitStatus
};

// server/auto-message-scheduler.ts
init_storage();
init_ebay_oauth();
async function processAutoMessageTrigger(triggerType, context) {
  const results = { sent: 0, errors: [] };
  try {
    const rules = await storage.getAutoMessageRules();
    const activeRules = rules.filter((r) => r.isActive && r.triggerType === triggerType);
    if (activeRules.length === 0) {
      console.log(`No active auto-message rules for trigger: ${triggerType}`);
      return results;
    }
    console.log(`Processing ${activeRules.length} auto-message rules for trigger: ${triggerType}`);
    for (const rule of activeRules) {
      try {
        await processRule(rule, context, results);
      } catch (error) {
        const errorMsg = `Failed to process rule "${rule.name}": ${error.message}`;
        console.error(errorMsg);
        results.errors.push(errorMsg);
      }
    }
    return results;
  } catch (error) {
    console.error("Error processing auto-message trigger:", error);
    results.errors.push(error.message);
    return results;
  }
}
async function processRule(rule, context, results) {
  const { order, items, trackingNumber } = context;
  if (!order.buyerUsername) {
    results.errors.push(`Order ${order.id} has no buyer username`);
    return;
  }
  if (rule.marketplaces && rule.marketplaces.length > 0 && !rule.marketplaces.includes(order.marketplace)) {
    return;
  }
  const template = await storage.getMessageTemplate(rule.templateId);
  if (!template) {
    results.errors.push(`Template ${rule.templateId} not found for rule "${rule.name}"`);
    return;
  }
  const orderDate = order.orderDate || order.createdAt;
  if (!orderDate) {
    console.log(`Order ${order.id} has no valid date for eligibility check, skipping`);
    results.errors.push(`Order ${order.id} missing order date`);
    return;
  }
  const eligibility = ebayMessagesApi.checkOrderMessageEligibility(new Date(orderDate));
  if (!eligibility.eligible) {
    console.log(`Order ${order.id} is past 90-day messaging limit (${eligibility.daysRemaining} days)`);
    return;
  }
  const itemTitle = items[0]?.title || "Your item";
  const templateVars = {
    buyer_name: order.buyerUsername || "Customer",
    order_id: order.marketplaceOrderId || `#${order.id}`,
    item_title: itemTitle,
    tracking_number: trackingNumber || "Not yet available",
    shop_name: "Our Store"
  };
  const body = ebayMessagesApi.renderTemplate(template.body, templateVars);
  if (body.includes("{{") && body.includes("}}")) {
    const unreplacedMatch = body.match(/\{\{(\w+)\}\}/);
    if (unreplacedMatch) {
      results.errors.push(`Template has unreplaced placeholder: {{${unreplacedMatch[1]}}}`);
      console.warn(`Template "${template.name}" has unreplaced placeholder: {{${unreplacedMatch[1]}}}`);
    }
  }
  let thread = await storage.getMessageThreadByBuyer(order.buyerUsername, order.marketplaceOrderId);
  if (!thread) {
    thread = await storage.createMessageThread({
      marketplace: order.marketplace,
      buyerUsername: order.buyerUsername,
      buyerEmail: order.buyerEmail,
      orderId: order.id,
      marketplaceOrderId: order.marketplaceOrderId,
      subject: `Order ${order.marketplaceOrderId}`,
      status: "open",
      isRead: true,
      lastMessageAt: /* @__PURE__ */ new Date()
    });
  }
  let ebayResult = { success: true };
  if (order.marketplace === "ebay" && ebayOAuth.isOAuthConfigured()) {
    const itemId = items[0]?.marketplaceItemId;
    if (itemId) {
      ebayResult = await ebayMessagesApi.sendMessageToPartner(
        itemId,
        order.buyerUsername,
        body
      );
    }
  }
  const messageData = {
    threadId: thread.id,
    direction: "outbound",
    body,
    senderUsername: "seller",
    status: ebayResult.success ? "sent" : "failed",
    errorMessage: ebayResult.error,
    templateId: rule.templateId,
    sentAt: /* @__PURE__ */ new Date()
  };
  await storage.createMessage(messageData);
  await storage.incrementTemplateUsage(rule.templateId);
  if (ebayResult.success) {
    results.sent++;
    console.log(`Auto-message sent for rule "${rule.name}" to ${order.buyerUsername}`);
  } else {
    results.errors.push(`Failed to send: ${ebayResult.error}`);
  }
}
async function processDelayedRules() {
  const results = { processed: 0, sent: 0, errors: [] };
  try {
    const rules = await storage.getAutoMessageRules();
    const delayedRules = rules.filter(
      (r) => r.isActive && r.triggerType === "days_after_delivery" && r.triggerDelay && r.triggerDelay > 0 && r.triggerDelayUnit === "days"
    );
    if (delayedRules.length === 0) {
      return results;
    }
    console.log(`Processing ${delayedRules.length} delayed auto-message rules`);
    const deliveredOrders = await storage.getOrders({ status: "delivered" });
    for (const order of deliveredOrders) {
      if (!order.deliveredAt) continue;
      const deliveryDate = new Date(order.deliveredAt);
      const daysSinceDelivery = Math.floor((Date.now() - deliveryDate.getTime()) / (1e3 * 60 * 60 * 24));
      for (const rule of delayedRules) {
        if (daysSinceDelivery === rule.triggerDelay) {
          results.processed++;
          const items = await storage.getOrderItems(order.id);
          await processRule(rule, {
            order,
            items: items.map((i) => ({ marketplaceItemId: i.marketplaceItemId || void 0, title: i.title })),
            trackingNumber: order.trackingNumber || void 0
          }, results);
        }
      }
    }
    return results;
  } catch (error) {
    console.error("Error processing delayed rules:", error);
    results.errors.push(error.message);
    return results;
  }
}
var schedulerInterval = null;
function startAutoMessageScheduler() {
  if (schedulerInterval) {
    console.log("Auto-message scheduler already running");
    return;
  }
  console.log("\u{1F4E7} Auto-message scheduler started (checks every hour for delayed messages)");
  schedulerInterval = setInterval(async () => {
    try {
      const results = await processDelayedRules();
      if (results.processed > 0 || results.errors.length > 0) {
        console.log(`\u{1F4E7} Delayed rule check: ${results.processed} orders processed, ${results.sent} messages sent`);
      }
    } catch (error) {
      console.error("Auto-message scheduler error:", error);
    }
  }, 60 * 60 * 1e3);
}
function stopAutoMessageScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    console.log("Auto-message scheduler stopped");
  }
}
var autoMessageScheduler = {
  processAutoMessageTrigger,
  processDelayedRules,
  startAutoMessageScheduler,
  stopAutoMessageScheduler
};

// server/routes.ts
init_schema();
async function registerRoutes(app) {
  const requireAuth = async (req, res, next) => {
    if (process.env.BYPASS_AUTH === "true") {
      if (!req.session?.userId) {
        try {
          const admin = await storage.getUserByUsername("admin");
          if (admin) {
            req.session.userId = admin.id;
          }
        } catch (err) {
          console.error("BYPASS_AUTH admin lookup failed:", err);
        }
      }
      return next();
    }
    if (!req.session?.userId) {
      return res.status(401).json({ message: "Authentication required" });
    }
    next();
  };
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { username, password } = loginSchema.parse(req.body);
      const user = await storage.getUserByUsername(username);
      if (!user) {
        return res.status(401).json({ message: "Invalid credentials" });
      }
      const isPasswordValid = await bcrypt2.compare(password, user.password);
      if (!isPasswordValid) {
        return res.status(401).json({ message: "Invalid credentials" });
      }
      req.session.userId = user.id;
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
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ message: "Could not log out" });
      }
      res.json({ message: "Logged out successfully" });
    });
  });
  app.get("/api/public-config", (_req, res) => {
    const siteId = process.env.EBAY_MARKETPLACE_SITE_ID || "3";
    const SITE_DOMAINS = {
      "0": "www.ebay.com",
      "3": "www.ebay.co.uk",
      "77": "www.ebay.de",
      "71": "www.ebay.fr",
      "101": "www.ebay.it",
      "186": "www.ebay.es",
      "205": "www.ebay.ie",
      "23": "www.ebay.be",
      "146": "www.ebay.nl",
      "16": "www.ebay.com.au"
    };
    res.json({
      ebaySiteId: siteId,
      ebayDomain: SITE_DOMAINS[siteId] || "www.ebay.com"
    });
  });
  app.get("/api/__version", (req, res) => {
    const clientId = process.env.EBAY_OAUTH_CLIENT_ID || process.env.EBAY_APP_ID || "";
    const clientSecret = process.env.EBAY_OAUTH_CLIENT_SECRET || process.env.EBAY_CERT_ID || "";
    const refreshToken = process.env.EBAY_OAUTH_REFRESH_TOKEN || process.env.EBAY_REFRESH_TOKEN || "";
    res.json({
      commit: process.env.VERCEL_GIT_COMMIT_SHA || "unknown",
      branch: process.env.VERCEL_GIT_COMMIT_REF || "unknown",
      bypassAuth: process.env.BYPASS_AUTH === "true",
      nodeEnv: process.env.NODE_ENV || "unknown",
      hasDatabase: !!(process.env.DATABASE_URL || process.env.NEON_DATABASE_URL || process.env.POSTGRES_URL),
      ebay: {
        hasClientId: !!clientId,
        clientIdLength: clientId.length,
        hasClientSecret: !!clientSecret,
        clientSecretLength: clientSecret.length,
        hasRefreshToken: !!refreshToken,
        refreshTokenLength: refreshToken.length
      },
      ebayMarketplace: {
        siteId: process.env.EBAY_MARKETPLACE_SITE_ID || "(unset -> defaults to 77/DE)",
        currency: process.env.EBAY_LISTING_CURRENCY || "(unset -> defaults to EUR)",
        country: process.env.EBAY_LISTING_COUNTRY || "(unset -> LV)",
        paymentProfileId: process.env.EBAY_PAYMENT_PROFILE_ID || "(unset)",
        returnProfileId: process.env.EBAY_RETURN_PROFILE_ID || "(unset)",
        shipping_0_20: process.env.EBAY_SHIPPING_POLICY_0_20GR || "(unset)"
      },
      tme: {
        hasToken: !!process.env.TME_TOKEN,
        hasAppSecret: !!process.env.TME_APPLICATION_SECRET,
        hasCustomerNumber: !!process.env.TME_CUSTOMER_NUMBER,
        hasContactNumber: !!process.env.TME_CONTACT_NUMBER
      },
      time: (/* @__PURE__ */ new Date()).toISOString()
    });
  });
  app.get("/api/__ebay-exchange", async (req, res) => {
    const code = String(req.query.code || "");
    const ruName = String(req.query.ruName || "") || process.env.EBAY_RUNAME || "";
    if (!code || !ruName) {
      return res.status(400).json({
        ok: false,
        message: "Both ?code=<authcode> and ?ruName=<RuName> required (or set EBAY_RUNAME env var)",
        haveCode: !!code,
        haveRuName: !!ruName
      });
    }
    const clientId = process.env.EBAY_OAUTH_CLIENT_ID || process.env.EBAY_APP_ID || "";
    const clientSecret = process.env.EBAY_OAUTH_CLIENT_SECRET || process.env.EBAY_CERT_ID || "";
    if (!clientId || !clientSecret) {
      return res.status(400).json({
        ok: false,
        message: "Client ID or Client Secret missing from env"
      });
    }
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString(
      "base64"
    );
    try {
      const response = await fetch(
        "https://api.ebay.com/identity/v1/oauth2/token",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: `Basic ${credentials}`
          },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: ruName
          }).toString()
        }
      );
      const bodyText = await response.text();
      let bodyJson = null;
      try {
        bodyJson = JSON.parse(bodyText);
      } catch {
      }
      if (!response.ok) {
        return res.status(200).json({
          ok: false,
          stage: "ebay-rejected",
          httpStatus: response.status,
          ebayError: bodyJson?.error,
          ebayErrorDescription: bodyJson?.error_description,
          rawBody: bodyText.slice(0, 500)
        });
      }
      return res.json({
        ok: true,
        message: "Save the refresh_token below to Vercel env var EBAY_OAUTH_REFRESH_TOKEN.",
        refresh_token: bodyJson?.refresh_token,
        refresh_token_expires_in: bodyJson?.refresh_token_expires_in,
        access_token_expires_in: bodyJson?.expires_in,
        token_type: bodyJson?.token_type
      });
    } catch (err) {
      return res.status(500).json({
        ok: false,
        stage: "network",
        error: err.message
      });
    }
  });
  app.post("/api/__bootstrap-de-policies", async (req, res) => {
    const body = req.body || {};
    const paymentName = String(body.paymentName || "EU Managed Payments");
    const returnName = String(body.returnName || "30 Tage R\xFCckgabe");
    const bandsInput = Array.isArray(body.shipping) ? body.shipping : null;
    const defaultBands = [
      { label: "0-20g", varKey: "EBAY_SHIPPING_POLICY_0_20GR", de: "5.79", eu: "5.49", additional: "1.00", weightMin: 0, weightMax: 20 },
      { label: "21-100g", varKey: "EBAY_SHIPPING_POLICY_21_100GR", de: "5.89", eu: "5.49", additional: "1.00", weightMin: 21, weightMax: 100 },
      { label: "101-500g", varKey: "EBAY_SHIPPING_POLICY_101_500GR", de: "7.09", eu: "6.99", additional: "1.00", weightMin: 101, weightMax: 500 },
      { label: "501-1000g", varKey: "EBAY_SHIPPING_POLICY_501_1000GR", de: "9.39", eu: "10.49", additional: "2.00", weightMin: 501, weightMax: 1e3 },
      { label: "1001-2000g", varKey: "EBAY_SHIPPING_POLICY_1001_2000GR", de: "10.99", eu: "12.99", additional: "5.00", weightMin: 1001, weightMax: 2e3 }
    ];
    const bands = bandsInput && bandsInput.length === defaultBands.length ? bandsInput.map((b, i) => ({
      ...defaultBands[i],
      de: String(b.de ?? defaultBands[i].de),
      eu: String(b.eu ?? defaultBands[i].eu),
      additional: String(b.additional ?? defaultBands[i].additional)
    })) : defaultBands;
    const results = { payment: null, return: null, shipping: [] };
    const errors = [];
    const ebayApiCall = async (endpoint, body2) => {
      try {
        const token = await ebayOAuth.getValidAccessToken();
        const url = `https://api.ebay.com${endpoint}`;
        const response = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Content-Language": "de-DE",
            "Accept-Language": "de-DE"
          },
          body: JSON.stringify(body2)
        });
        const text2 = await response.text();
        let parsed = null;
        try {
          parsed = JSON.parse(text2);
        } catch {
        }
        if (!response.ok) {
          const err = parsed?.errors?.[0];
          const msg = err ? `${err.errorId ?? ""} ${err.longMessage ?? err.message ?? ""} ${err.parameters ? JSON.stringify(err.parameters) : ""}`.trim() : text2.slice(0, 500);
          return { ok: false, status: response.status, error: msg };
        }
        return { ok: true, data: parsed };
      } catch (err) {
        return { ok: false, status: 0, error: err.message };
      }
    };
    const fetchExisting = async (type) => {
      try {
        const token = await ebayOAuth.getValidAccessToken();
        const resp = await fetch(
          `https://api.ebay.com/sell/account/v1/${type}_policy?marketplace_id=EBAY_DE`,
          { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }
        );
        if (!resp.ok) return [];
        const data = await resp.json();
        return data[`${type}Policies`] || [];
      } catch {
        return [];
      }
    };
    {
      const r = await ebayApiCall("/sell/account/v1/payment_policy", {
        name: paymentName,
        description: "eBay-managed payments for EU marketplace",
        marketplaceId: "EBAY_DE",
        categoryTypes: [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES" }],
        paymentMethods: [],
        immediatePay: true
      });
      if (r.ok) {
        results.payment = { id: r.data.paymentPolicyId, name: r.data.name };
      } else {
        const dupMatch = r.error.match(/duplicatePolicyId.*?(\d{8,})/);
        if (dupMatch) {
          results.payment = { id: dupMatch[1], name: "(existing eBay policy)" };
        } else {
          errors.push(`Payment policy [HTTP ${r.status}]: ${r.error}`);
        }
      }
    }
    {
      const r = await ebayApiCall("/sell/account/v1/return_policy", {
        name: returnName,
        description: "30 Tage R\xFCckgabe, Verk\xE4ufer zahlt R\xFCckversand",
        marketplaceId: "EBAY_DE",
        categoryTypes: [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES" }],
        returnsAccepted: true,
        returnPeriod: { value: 30, unit: "DAY" },
        refundMethod: "MONEY_BACK",
        returnShippingCostPayer: "SELLER"
      });
      if (r.ok) {
        results.return = { id: r.data.returnPolicyId, name: r.data.name };
      } else {
        const dupMatch = r.error.match(/duplicatePolicyId.*?(\d{8,})/);
        if (dupMatch) {
          results.return = { id: dupMatch[1], name: "(existing eBay policy)" };
        } else {
          const existing = await fetchExisting("return");
          if (existing.length > 0) {
            results.return = {
              id: existing[0].returnPolicyId,
              name: `(reused existing: ${existing[0].name})`
            };
          } else {
            errors.push(`Return policy [HTTP ${r.status}]: ${r.error}`);
          }
        }
      }
    }
    for (const band of bands) {
      const r = await ebayApiCall("/sell/account/v1/fulfillment_policy", {
        name: `EU ${band.label} (DE \u20AC${band.de})`,
        description: `Economy shipping for items ${band.label}`,
        marketplaceId: "EBAY_DE",
        categoryTypes: [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES" }],
        handlingTime: { value: 2, unit: "DAY" },
        shippingOptions: [
          {
            optionType: "DOMESTIC",
            costType: "FLAT_RATE",
            shippingServices: [
              {
                shippingCarrierCode: "DHL",
                shippingServiceCode: "DE_DHLPaket",
                shippingCost: { value: band.de, currency: "EUR" },
                additionalShippingCost: { value: band.additional, currency: "EUR" },
                freeShipping: false,
                sortOrder: 1
              }
            ]
          },
          {
            optionType: "INTERNATIONAL",
            costType: "FLAT_RATE",
            shippingServices: [
              {
                shippingServiceCode: "DE_SonstigerVersandInternational",
                shippingCost: { value: band.eu, currency: "EUR" },
                additionalShippingCost: { value: band.additional, currency: "EUR" },
                freeShipping: false,
                sortOrder: 1,
                shipToLocations: {
                  regionIncluded: [{ regionName: "EUROPE", regionType: "WORLD_REGION" }]
                }
              }
            ]
          }
        ],
        shipToLocations: {
          regionIncluded: [
            { regionName: "DE", regionType: "COUNTRY" },
            { regionName: "EUROPE", regionType: "WORLD_REGION" }
          ]
        },
        globalShipping: false
      });
      if (r.ok) {
        results.shipping.push({
          id: r.data.fulfillmentPolicyId,
          name: r.data.name,
          band: band.label,
          weightMin: band.weightMin,
          weightMax: band.weightMax
        });
      } else {
        const dupMatch = r.error.match(/duplicatePolicyId.*?(\d{8,})/);
        if (dupMatch) {
          results.shipping.push({
            id: dupMatch[1],
            name: "(existing eBay policy)",
            band: band.label,
            weightMin: band.weightMin,
            weightMax: band.weightMax
          });
        } else {
          errors.push(`Shipping ${band.label} [HTTP ${r.status}]: ${r.error}`);
        }
      }
    }
    const envSnippet = [];
    if (results.payment?.id) envSnippet.push(`EBAY_PAYMENT_PROFILE_ID=${results.payment.id}`);
    if (results.return?.id) envSnippet.push(`EBAY_RETURN_PROFILE_ID=${results.return.id}`);
    const bandToVar = Object.fromEntries(
      bands.map((b) => [b.label, b.varKey])
    );
    for (const s of results.shipping) {
      const varName = bandToVar[s.band];
      if (varName) envSnippet.push(`${varName}=${s.id}`);
    }
    envSnippet.push("EBAY_MARKETPLACE_SITE_ID=77");
    envSnippet.push("EBAY_LISTING_CURRENCY=EUR");
    res.json({
      ok: errors.length === 0,
      results,
      errors,
      envSnippet: envSnippet.join("\n"),
      note: "Save the envSnippet block to Vercel Project Settings -> Environment Variables. Redeploy with 'Use existing Build Cache' unchecked. The code switch wiring up these vars lands in the next commit."
    });
  });
  app.get("/api/__ebay-shipping-services", async (req, res) => {
    const siteId = String(req.query.siteId || "77");
    try {
      const token = await ebayOAuth.getValidAccessToken();
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<GeteBayDetailsRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <DetailName>ShippingServiceDetails</DetailName>
</GeteBayDetailsRequest>`;
      const resp = await fetch("https://api.ebay.com/ws/api.dll", {
        method: "POST",
        headers: {
          "Content-Type": "text/xml; charset=utf-8",
          "X-EBAY-API-COMPATIBILITY-LEVEL": "967",
          "X-EBAY-API-DEV-NAME": process.env.EBAY_DEV_ID || "",
          "X-EBAY-API-APP-NAME": process.env.EBAY_APP_ID || "",
          "X-EBAY-API-CERT-NAME": process.env.EBAY_CERT_ID || "",
          "X-EBAY-API-CALL-NAME": "GeteBayDetails",
          "X-EBAY-API-SITEID": siteId,
          "X-EBAY-API-IAF-TOKEN": token
        },
        body: xml
      });
      const text2 = await resp.text();
      const blocks = text2.match(/<ShippingServiceDetails>[\s\S]*?<\/ShippingServiceDetails>/g) || [];
      const domestic = [];
      const international = [];
      for (const b of blocks) {
        if (!/<ValidForSellingFlow>true<\/ValidForSellingFlow>/.test(b)) continue;
        const code = b.match(/<ShippingService>(.*?)<\/ShippingService>/)?.[1];
        if (!code) continue;
        if (/<InternationalService>true<\/InternationalService>/.test(b)) international.push(code);
        else domestic.push(code);
      }
      res.json({
        ok: true,
        siteId,
        counts: { domestic: domestic.length, international: international.length },
        international,
        domestic
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });
  app.get("/api/__end-ebay-item", async (req, res) => {
    const itemId = String(req.query.itemId || "");
    const siteId = String(req.query.siteId || "3");
    if (!/^\d+$/.test(itemId)) {
      return res.status(400).json({ ok: false, message: "valid numeric ?itemId= required" });
    }
    try {
      const token = await ebayOAuth.getValidAccessToken();
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<EndFixedPriceItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ItemID>${itemId}</ItemID>
  <EndingReason>NotAvailable</EndingReason>
</EndFixedPriceItemRequest>`;
      const resp = await fetch("https://api.ebay.com/ws/api.dll", {
        method: "POST",
        headers: {
          "Content-Type": "text/xml; charset=utf-8",
          "X-EBAY-API-COMPATIBILITY-LEVEL": "967",
          "X-EBAY-API-DEV-NAME": process.env.EBAY_DEV_ID || "",
          "X-EBAY-API-APP-NAME": process.env.EBAY_APP_ID || "",
          "X-EBAY-API-CERT-NAME": process.env.EBAY_CERT_ID || "",
          "X-EBAY-API-CALL-NAME": "EndFixedPriceItem",
          "X-EBAY-API-SITEID": siteId,
          "X-EBAY-API-IAF-TOKEN": token
        },
        body: xml
      });
      const text2 = await resp.text();
      const ack = text2.match(/<Ack>(.*?)<\/Ack>/)?.[1] || "Unknown";
      const shortMsg = text2.match(/<ShortMessage>(.*?)<\/ShortMessage>/)?.[1];
      const ended = ack === "Success" || ack === "Warning";
      const alreadyEnded = /auction.*already|ended|not.*active|1047|cannot be ended/i.test(text2);
      res.json({
        ok: ended || alreadyEnded,
        ack,
        itemId,
        siteId,
        message: shortMsg || (ended ? "Listing ended" : "See raw"),
        raw: text2.slice(0, 600)
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });
  app.get("/api/__tme-check", async (_req, res) => {
    const have = {
      TME_TOKEN: !!process.env.TME_TOKEN,
      TME_APPLICATION_SECRET: !!process.env.TME_APPLICATION_SECRET,
      TME_CUSTOMER_NUMBER: !!process.env.TME_CUSTOMER_NUMBER,
      TME_CONTACT_NUMBER: !!process.env.TME_CONTACT_NUMBER
    };
    if (!have.TME_TOKEN || !have.TME_APPLICATION_SECRET) {
      return res.json({
        ok: false,
        stage: "config",
        have,
        message: "TME_TOKEN and/or TME_APPLICATION_SECRET are not set in env. Get a token from https://developers.tme.eu/ and add both to Vercel."
      });
    }
    try {
      const { tmeApi: tmeApi3 } = await Promise.resolve().then(() => (init_tme_api(), tme_api_exports));
      const probe = await tmeApi3.getProductsPricesAndStocks?.(["AVT-LITE"]).catch((e) => ({ __error: e.message }));
      if (probe?.__error) {
        return res.json({ ok: false, stage: "tme-api", have, error: probe.__error });
      }
      return res.json({
        ok: true,
        stage: "success",
        have,
        sampleCount: Array.isArray(probe) ? probe.length : null,
        sample: Array.isArray(probe) ? probe.slice(0, 1) : probe
      });
    } catch (err) {
      res.status(500).json({ ok: false, stage: "exception", have, error: err.message });
    }
  });
  app.get("/api/__inventory-check", async (req, res) => {
    const productId = Number(req.query.productId);
    if (!productId) {
      const products2 = await storage.getProducts();
      const cand = products2.find((p) => p.supplier === "TME" && p.sku && (p.stock ?? 0) > 0);
      if (!cand) return res.status(400).json({ ok: false, message: "?productId= required (no in-stock TME product found)" });
      const result = await ebayInventoryApi.listSingleProduct(cand.id, (id) => storage.getProduct(id));
      return res.json({ pickedProductId: cand.id, ...result });
    }
    try {
      const result = await ebayInventoryApi.listSingleProduct(productId, (id) => storage.getProduct(id));
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });
  app.get("/api/__ebay-suggest-category", async (req, res) => {
    const q = String(req.query.q || "");
    if (!q) return res.status(400).json({ ok: false, message: "?q= required" });
    try {
      const token = await ebayOAuth.getValidAccessToken();
      const treeId = process.env.EBAY_MARKETPLACE_SITE_ID || "77";
      const marketplaceId2 = { "0": "EBAY_US", "3": "EBAY_GB", "77": "EBAY_DE" }[treeId] || "EBAY_DE";
      const url = `https://api.ebay.com/commerce/taxonomy/v1/category_tree/${treeId}/get_category_suggestions?q=${encodeURIComponent(q)}`;
      const resp = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "Accept-Language": "de-DE",
          "X-EBAY-C-MARKETPLACE-ID": marketplaceId2
        }
      });
      const text2 = await resp.text();
      let data = null;
      try {
        data = JSON.parse(text2);
      } catch {
      }
      const suggestions = (data?.categorySuggestions || []).slice(0, 5).map((s) => ({
        id: s.category?.categoryId,
        name: s.category?.categoryName,
        path: (s.categoryTreeNodeAncestors || []).map((a) => a.categoryName).reverse().join(" > ")
      }));
      res.json({
        ok: resp.ok && suggestions.length > 0,
        query: q,
        treeId,
        httpStatus: resp.status,
        suggestions,
        raw: suggestions.length ? void 0 : text2.slice(0, 800)
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });
  app.get("/api/__ebay-check", async (_req, res) => {
    const clientId = process.env.EBAY_OAUTH_CLIENT_ID || process.env.EBAY_APP_ID || "";
    const clientSecret = process.env.EBAY_OAUTH_CLIENT_SECRET || process.env.EBAY_CERT_ID || "";
    const refreshToken = process.env.EBAY_OAUTH_REFRESH_TOKEN || process.env.EBAY_REFRESH_TOKEN || "";
    if (!clientId || !clientSecret || !refreshToken) {
      return res.status(400).json({
        ok: false,
        stage: "config",
        message: "One or more eBay OAuth env vars are missing",
        hasClientId: !!clientId,
        hasClientSecret: !!clientSecret,
        hasRefreshToken: !!refreshToken
      });
    }
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString(
      "base64"
    );
    const scopes = [
      "https://api.ebay.com/oauth/api_scope",
      "https://api.ebay.com/oauth/api_scope/sell.account",
      "https://api.ebay.com/oauth/api_scope/sell.inventory",
      "https://api.ebay.com/oauth/api_scope/sell.marketing",
      "https://api.ebay.com/oauth/api_scope/sell.fulfillment"
    ].join(" ");
    try {
      const response = await fetch(
        "https://api.ebay.com/identity/v1/oauth2/token",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: `Basic ${credentials}`
          },
          body: new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: refreshToken,
            scope: scopes
          }).toString()
        }
      );
      const bodyText = await response.text();
      let bodyJson = null;
      try {
        bodyJson = JSON.parse(bodyText);
      } catch {
      }
      if (!response.ok) {
        return res.status(200).json({
          ok: false,
          stage: "ebay-rejected",
          httpStatus: response.status,
          ebayError: bodyJson?.error,
          ebayErrorDescription: bodyJson?.error_description,
          rawBody: bodyText.slice(0, 500)
        });
      }
      return res.json({
        ok: true,
        stage: "success",
        tokenType: bodyJson?.token_type,
        expiresIn: bodyJson?.expires_in,
        accessTokenPreview: typeof bodyJson?.access_token === "string" ? bodyJson.access_token.slice(0, 12) + "..." : null
      });
    } catch (err) {
      return res.status(500).json({
        ok: false,
        stage: "network",
        error: err.message
      });
    }
  });
  app.get("/api/auth/me", requireAuth, async (req, res) => {
    if (process.env.BYPASS_AUTH === "true") {
      return res.json({
        user: {
          id: req.session.userId ?? 0,
          username: "admin",
          email: "admin@inventorysync.com",
          role: "admin"
        }
      });
    }
    try {
      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      const { password: _, ...userWithoutPassword } = user;
      res.json({ user: userWithoutPassword });
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app.get("/api/dashboard/metrics", requireAuth, async (req, res) => {
    try {
      const metrics = await storage.getDashboardMetrics();
      res.json(metrics);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch dashboard metrics" });
    }
  });
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
      const products2 = await Promise.all(
        productIds.map(async (id) => {
          const product = await storage.getProduct(id);
          return product ? { id: product.id, supplierPrice: parseFloat(product.supplierPrice) } : null;
        })
      );
      const validProducts = products2.filter((p) => p !== null);
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
      let errors = [];
      for (const productId of productIds) {
        try {
          const product = await storage.getProduct(productId);
          if (!product) {
            errors.push(`Product ${productId} not found`);
            continue;
          }
          const pricingResult = calculateDynamicPrice(parseFloat(product.supplierPrice));
          if (!pricingResult.isValid) {
            errors.push(`Product ${productId}: ${pricingResult.errors.join(", ")}`);
            continue;
          }
          const updateData = {
            calculatedPrice: pricingResult.finalPrice.toString(),
            marginTier: pricingResult.marginTier,
            marginPercentage: pricingResult.marginPercentage.toString(),
            priceUpdatedAt: /* @__PURE__ */ new Date(),
            useCalculatedPrice: applyCalculated
          };
          if (applyCalculated) {
            updateData.salePrice = pricingResult.finalPrice.toString();
          }
          await storage.updateProduct(productId, updateData);
          updatedCount++;
        } catch (error) {
          errors.push(`Product ${productId}: ${error.message}`);
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
  app.get("/api/products", requireAuth, async (req, res) => {
    try {
      const filters = {
        category: req.query.category,
        status: req.query.status,
        listedOnEbay: req.query.listedOnEbay ? req.query.listedOnEbay === "true" : void 0,
        listedOnAmazon: req.query.listedOnAmazon ? req.query.listedOnAmazon === "true" : void 0,
        minStock: req.query.minStock ? parseInt(req.query.minStock) : void 0,
        maxStock: req.query.maxStock ? parseInt(req.query.maxStock) : void 0
      };
      const cleanFilters = Object.fromEntries(
        Object.entries(filters).filter(([_, value]) => value !== void 0)
      );
      const products2 = await storage.getProductsWithFilters(cleanFilters);
      res.json(products2);
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
      const requestBody = { ...req.body };
      const decimalFields = ["weight", "supplierPrice", "salePrice", "calculatedPrice", "marginPercentage", "margin"];
      decimalFields.forEach((field) => {
        if (requestBody[field] !== void 0 && typeof requestBody[field] === "number") {
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
  app.get("/api/categories", requireAuth, async (req, res) => {
    try {
      const categories2 = await storage.getCategories();
      res.json(categories2);
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
  app.post("/api/ebay/list", requireAuth, async (req, res) => {
    try {
      const { productId, listingDetails } = req.body;
      const result = await ebayApi.listProduct(productId, listingDetails);
      res.json(result);
    } catch (error) {
      console.error("eBay listing failed:", error);
      res.status(500).json({
        success: false,
        message: error.message || "eBay listing failed",
        error: error.message
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
      const jobId = `bulk-list-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
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
      const FIRE_AND_FORGET = process.env.LONG_BACKGROUND_JOBS === "true";
      if (FIRE_AND_FORGET) {
        processAsyncBulkListing(jobId, productIds, categoryId);
        return res.json({
          success: true,
          jobId,
          message: `Bulk listing job started for ${productIds.length} products`,
          total: productIds.length
        });
      }
      await processAsyncBulkListing(jobId, productIds, categoryId);
      const finalJob = await storage.getBulkListingJob(jobId);
      res.json({
        success: true,
        jobId,
        message: `Bulk listing complete: ${finalJob?.succeeded ?? 0} listed, ${finalJob?.failed ?? 0} failed`,
        total: productIds.length,
        job: finalJob
      });
    } catch (error) {
      console.error("eBay bulk listing failed:", error);
      res.status(500).json({
        success: false,
        message: error.message || "eBay bulk listing failed",
        error: error.message
      });
    }
  });
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
  async function processAsyncBulkListing(jobId, productIds, categoryId) {
    const errorDetails = [];
    let succeeded = 0;
    let failed = 0;
    try {
      for (let i = 0; i < productIds.length; i++) {
        const productId = productIds[i];
        const product = await storage.getProduct(productId);
        const productName = product?.name || `Product ${productId}`;
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
            error: error.message
          });
        }
        await storage.updateBulkListingJob(jobId, {
          processed: i + 1,
          succeeded,
          failed,
          errorDetails: errorDetails.length > 0 ? JSON.stringify(errorDetails) : null
        });
        if (i < productIds.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 1e3));
        }
      }
      await storage.updateBulkListingJob(jobId, {
        status: "completed",
        currentProduct: null,
        lastMessage: `Completed: ${succeeded} listed, ${failed} failed`,
        completedAt: /* @__PURE__ */ new Date()
      });
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
      console.log(`\u2705 Bulk listing job ${jobId} completed: ${succeeded} succeeded, ${failed} failed`);
    } catch (error) {
      await storage.updateBulkListingJob(jobId, {
        status: "failed",
        currentProduct: null,
        lastMessage: `Job failed: ${error.message}`,
        completedAt: /* @__PURE__ */ new Date()
      });
      console.error(`\u274C Bulk listing job ${jobId} failed:`, error);
    }
  }
  app.post("/api/ebay/bulk-update-inventory", requireAuth, async (req, res) => {
    try {
      const { items } = req.body;
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Items array is required and must not be empty"
        });
      }
      const validItems = [];
      for (const item of items) {
        if (!item.productId) {
          continue;
        }
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
      console.log(`\u{1F4E6} Bulk inventory update requested for ${validItems.length} items`);
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
        message: `Bulk update failed: ${error.message}`
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
        message: `Failed to unlist product: ${error.message}`,
        errors: [error.message]
      });
    }
  });
  app.post("/api/ebay/bulk-sync-template", requireAuth, async (req, res) => {
    try {
      const allProducts = await storage.getProducts();
      const listedProducts = allProducts.filter((p) => p.listedOnEbay && p.ebayItemId);
      if (listedProducts.length === 0) {
        return res.json({
          success: true,
          message: "No products are currently listed on eBay",
          processed: 0,
          succeeded: 0,
          failed: 0
        });
      }
      console.log(`\u{1F4DD} Starting bulk template sync for ${listedProducts.length} eBay listings`);
      const results = [];
      let succeeded = 0;
      let failed = 0;
      for (let i = 0; i < listedProducts.length; i++) {
        const product = listedProducts[i];
        try {
          console.log(`\u23F3 Updating listing ${i + 1}/${listedProducts.length}: ${product.name}`);
          const updateResult = await ebayApi.updateProduct(product.id, void 0, true);
          if (updateResult.success) {
            succeeded++;
            results.push({
              productId: product.id,
              name: product.name,
              success: true,
              message: "Template updated successfully"
            });
          } else {
            failed++;
            results.push({
              productId: product.id,
              name: product.name,
              success: false,
              message: updateResult.message || "Update failed"
            });
          }
        } catch (error) {
          failed++;
          results.push({
            productId: product.id,
            name: product.name,
            success: false,
            message: error.message
          });
        }
        if (i < listedProducts.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 1500));
        }
      }
      console.log(`\u2705 Bulk template sync complete: ${succeeded} succeeded, ${failed} failed`);
      await storage.createSyncLog({
        source: "ebay",
        operation: "bulk_template_sync",
        status: failed === 0 ? "success" : "partial",
        itemsProcessed: listedProducts.length,
        itemsSucceeded: succeeded,
        itemsFailed: failed,
        details: JSON.stringify({
          message: `Template sync: ${succeeded} updated, ${failed} failed`,
          failedItems: results.filter((r) => !r.success).slice(0, 10)
        })
      });
      res.json({
        success: failed === 0,
        message: `Template sync complete: ${succeeded} listings updated, ${failed} failed`,
        processed: listedProducts.length,
        succeeded,
        failed,
        results: results.slice(0, 50)
        // Return first 50 results
      });
    } catch (error) {
      console.error("Bulk template sync failed:", error);
      res.status(500).json({
        success: false,
        message: `Bulk template sync failed: ${error.message}`
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
        message: error.message || "eBay test failed",
        error: error.message
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
        message: error.message || "Failed to fetch eBay policies",
        error: error.message
      });
    }
  });
  app.get("/api/ebay/categories", requireAuth, async (req, res) => {
    try {
      const categories2 = await ebayApi.getEbayCategories();
      res.json({ success: true, categories: categories2 });
    } catch (error) {
      console.error("eBay categories fetch failed:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to fetch eBay categories",
        error: error.message
      });
    }
  });
  app.get("/api/ebay/business-policies/status", requireAuth, async (req, res) => {
    try {
      const isConfigured = ebayAccountApi.isConfigured();
      res.json({
        success: true,
        configured: isConfigured,
        message: isConfigured ? "OAuth credentials configured. You can sync and manage policies." : "OAuth not configured. Set EBAY_OAUTH_CLIENT_ID, EBAY_OAUTH_CLIENT_SECRET, and EBAY_OAUTH_REFRESH_TOKEN to enable."
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message || "Failed to check status"
      });
    }
  });
  app.post("/api/ebay/business-policies/sync", requireAuth, async (req, res) => {
    try {
      if (!ebayAccountApi.isConfigured()) {
        return res.status(400).json({
          success: false,
          message: "OAuth not configured. Set EBAY_OAUTH_CLIENT_ID, EBAY_OAUTH_CLIENT_SECRET, and EBAY_OAUTH_REFRESH_TOKEN environment variables."
        });
      }
      const { marketplaceId: marketplaceId2 } = req.body;
      const result = await ebayAccountApi.syncAllPolicies(marketplaceId2);
      res.json({
        success: true,
        message: "Policies synced from eBay",
        result
      });
    } catch (error) {
      console.error("Failed to sync eBay policies:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to sync eBay policies"
      });
    }
  });
  app.get("/api/ebay/shipping-services", requireAuth, async (req, res) => {
    try {
      const result = await ebayApi.getShippingServices();
      res.json(result);
    } catch (error) {
      console.error("Failed to get shipping services:", error);
      res.status(500).json({
        success: false,
        domestic: [],
        international: [],
        error: error.message || "Failed to get shipping services"
      });
    }
  });
  app.get("/api/ebay/shipping-locations", requireAuth, async (req, res) => {
    try {
      const result = await ebayApi.getShippingLocations();
      res.json(result);
    } catch (error) {
      console.error("Failed to get shipping locations:", error);
      res.status(500).json({
        success: false,
        regions: [],
        error: error.message || "Failed to get shipping locations"
      });
    }
  });
  app.get("/api/ebay/dispatch-times", requireAuth, async (req, res) => {
    try {
      const result = await ebayApi.getDispatchTimeOptions();
      res.json(result);
    } catch (error) {
      console.error("Failed to get dispatch time options:", error);
      res.status(500).json({
        success: false,
        options: [],
        error: error.message || "Failed to get dispatch time options"
      });
    }
  });
  app.get("/api/ebay/business-policies", requireAuth, async (req, res) => {
    try {
      const policies = await ebayAccountApi.getLocalPolicies();
      res.json({ success: true, policies });
    } catch (error) {
      console.error("Failed to get local policies:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to get policies"
      });
    }
  });
  app.get("/api/ebay/business-policies/payment", requireAuth, async (req, res) => {
    try {
      const policies = await storage.getEbayPaymentPolicies();
      res.json({ success: true, policies });
    } catch (error) {
      console.error("Failed to get payment policies:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to get payment policies"
      });
    }
  });
  app.post("/api/ebay/business-policies/payment", requireAuth, async (req, res) => {
    try {
      const { name, description, marketplaceId: marketplaceId2, immediatePay, paymentMethods, createOnEbay } = req.body;
      if (createOnEbay) {
        const ebayPolicy = await ebayAccountApi.createPaymentPolicy({
          name,
          description,
          marketplaceId: marketplaceId2,
          immediatePay,
          paymentMethods: paymentMethods ? JSON.parse(paymentMethods) : void 0
        });
        if (!ebayPolicy) {
          return res.status(500).json({ success: false, message: "Failed to create policy on eBay" });
        }
        const localPolicy = await storage.createEbayPaymentPolicy({
          policyId: ebayPolicy.paymentPolicyId,
          name: ebayPolicy.name,
          description: ebayPolicy.description,
          marketplaceId: ebayPolicy.marketplaceId,
          categoryTypes: JSON.stringify(ebayPolicy.categoryTypes || []),
          paymentMethods: JSON.stringify(ebayPolicy.paymentMethods || []),
          immediatePay: ebayPolicy.immediatePay,
          syncedFromEbay: true
        });
        res.json({ success: true, policy: localPolicy, ebayPolicy });
      } else {
        const policy = await storage.createEbayPaymentPolicy({
          policyId: `local_${Date.now()}`,
          name,
          description,
          marketplaceId: marketplaceId2 || "EBAY_DE",
          paymentMethods: paymentMethods || "[]",
          immediatePay: immediatePay ?? true,
          syncedFromEbay: false
        });
        res.json({ success: true, policy });
      }
    } catch (error) {
      console.error("Failed to create payment policy:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to create payment policy"
      });
    }
  });
  app.put("/api/ebay/business-policies/payment/:policyId", requireAuth, async (req, res) => {
    try {
      const { policyId } = req.params;
      const { name, description, immediatePay, updateOnEbay } = req.body;
      if (updateOnEbay && !policyId.startsWith("local_")) {
        const ebayPolicy = await ebayAccountApi.updatePaymentPolicy(policyId, {
          name,
          description,
          immediatePay
        });
        if (!ebayPolicy) {
          return res.status(500).json({ success: false, message: "Failed to update policy on eBay" });
        }
      }
      const policy = await storage.updateEbayPaymentPolicy(policyId, {
        name,
        description,
        immediatePay
      });
      res.json({ success: true, policy });
    } catch (error) {
      console.error("Failed to update payment policy:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to update payment policy"
      });
    }
  });
  app.delete("/api/ebay/business-policies/payment/:policyId", requireAuth, async (req, res) => {
    try {
      const { policyId } = req.params;
      const { deleteOnEbay } = req.query;
      if (deleteOnEbay === "true" && !policyId.startsWith("local_")) {
        const deleted = await ebayAccountApi.deletePaymentPolicy(policyId);
        if (!deleted) {
          return res.status(500).json({ success: false, message: "Failed to delete policy on eBay" });
        }
      }
      await storage.deleteEbayPaymentPolicy(policyId);
      res.json({ success: true, message: "Payment policy deleted" });
    } catch (error) {
      console.error("Failed to delete payment policy:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to delete payment policy"
      });
    }
  });
  app.get("/api/ebay/business-policies/fulfillment", requireAuth, async (req, res) => {
    try {
      const policies = await storage.getEbayFulfillmentPolicies();
      res.json({ success: true, policies });
    } catch (error) {
      console.error("Failed to get fulfillment policies:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to get fulfillment policies"
      });
    }
  });
  app.post("/api/ebay/business-policies/fulfillment", requireAuth, async (req, res) => {
    try {
      const {
        name,
        description,
        marketplaceId: marketplaceId2,
        handlingTime,
        shippingOptions,
        shipToLocations,
        globalShipping,
        createOnEbay,
        pickupDropOff
      } = req.body;
      const parsedShippingOptions = Array.isArray(shippingOptions) ? shippingOptions : shippingOptions ? JSON.parse(shippingOptions) : void 0;
      const parsedShipToLocations = typeof shipToLocations === "object" && !Array.isArray(shipToLocations) ? shipToLocations : shipToLocations ? JSON.parse(shipToLocations) : void 0;
      if (createOnEbay) {
        const ebayPolicy = await ebayAccountApi.createFulfillmentPolicy({
          name,
          description,
          marketplaceId: marketplaceId2,
          handlingTime: handlingTime ? { value: handlingTime, unit: "DAY" } : void 0,
          shippingOptions: parsedShippingOptions,
          shipToLocations: parsedShipToLocations,
          globalShipping,
          pickupDropOff
        });
        if (!ebayPolicy) {
          return res.status(500).json({ success: false, message: "Failed to create policy on eBay" });
        }
        const localPolicy = await storage.createEbayFulfillmentPolicy({
          policyId: ebayPolicy.fulfillmentPolicyId,
          name: ebayPolicy.name,
          description: ebayPolicy.description,
          marketplaceId: ebayPolicy.marketplaceId,
          categoryTypes: JSON.stringify(ebayPolicy.categoryTypes || []),
          handlingTime: ebayPolicy.handlingTime?.value || 1,
          shippingOptions: JSON.stringify(ebayPolicy.shippingOptions || []),
          shipToLocations: JSON.stringify(ebayPolicy.shipToLocations || {}),
          globalShipping: ebayPolicy.globalShipping,
          syncedFromEbay: true
        });
        res.json({ success: true, policy: localPolicy, ebayPolicy });
      } else {
        const policy = await storage.createEbayFulfillmentPolicy({
          policyId: `local_${Date.now()}`,
          name,
          description,
          marketplaceId: marketplaceId2 || "EBAY_DE",
          handlingTime: handlingTime || 1,
          shippingOptions: JSON.stringify(parsedShippingOptions || []),
          shipToLocations: JSON.stringify(parsedShipToLocations || {}),
          globalShipping: globalShipping ?? false,
          syncedFromEbay: false
        });
        res.json({ success: true, policy });
      }
    } catch (error) {
      console.error("Failed to create fulfillment policy:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to create fulfillment policy"
      });
    }
  });
  app.put("/api/ebay/business-policies/fulfillment/:policyId", requireAuth, async (req, res) => {
    try {
      const { policyId } = req.params;
      const { name, description, handlingTime, globalShipping, updateOnEbay } = req.body;
      if (updateOnEbay && !policyId.startsWith("local_")) {
        const ebayPolicy = await ebayAccountApi.updateFulfillmentPolicy(policyId, {
          name,
          description,
          handlingTime: handlingTime ? { value: handlingTime, unit: "DAY" } : void 0,
          globalShipping
        });
        if (!ebayPolicy) {
          return res.status(500).json({ success: false, message: "Failed to update policy on eBay" });
        }
      }
      const policy = await storage.updateEbayFulfillmentPolicy(policyId, {
        name,
        description,
        handlingTime,
        globalShipping
      });
      res.json({ success: true, policy });
    } catch (error) {
      console.error("Failed to update fulfillment policy:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to update fulfillment policy"
      });
    }
  });
  app.delete("/api/ebay/business-policies/fulfillment/:policyId", requireAuth, async (req, res) => {
    try {
      const { policyId } = req.params;
      const { deleteOnEbay } = req.query;
      if (deleteOnEbay === "true" && !policyId.startsWith("local_")) {
        const deleted = await ebayAccountApi.deleteFulfillmentPolicy(policyId);
        if (!deleted) {
          return res.status(500).json({ success: false, message: "Failed to delete policy on eBay" });
        }
      }
      await storage.deleteEbayFulfillmentPolicy(policyId);
      res.json({ success: true, message: "Fulfillment policy deleted" });
    } catch (error) {
      console.error("Failed to delete fulfillment policy:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to delete fulfillment policy"
      });
    }
  });
  app.get("/api/ebay/business-policies/return", requireAuth, async (req, res) => {
    try {
      const policies = await storage.getEbayReturnPolicies();
      res.json({ success: true, policies });
    } catch (error) {
      console.error("Failed to get return policies:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to get return policies"
      });
    }
  });
  app.post("/api/ebay/business-policies/return", requireAuth, async (req, res) => {
    try {
      const {
        name,
        description,
        marketplaceId: marketplaceId2,
        returnsAccepted,
        returnPeriod,
        refundMethod,
        returnShippingCostPayer,
        createOnEbay
      } = req.body;
      if (createOnEbay) {
        const ebayPolicy = await ebayAccountApi.createReturnPolicy({
          name,
          description,
          marketplaceId: marketplaceId2,
          returnsAccepted: returnsAccepted ?? true,
          returnPeriod: returnPeriod ? { value: returnPeriod, unit: "DAY" } : void 0,
          refundMethod,
          returnShippingCostPayer
        });
        if (!ebayPolicy) {
          return res.status(500).json({ success: false, message: "Failed to create policy on eBay" });
        }
        const localPolicy = await storage.createEbayReturnPolicy({
          policyId: ebayPolicy.returnPolicyId,
          name: ebayPolicy.name,
          description: ebayPolicy.description,
          marketplaceId: ebayPolicy.marketplaceId,
          categoryTypes: JSON.stringify(ebayPolicy.categoryTypes || []),
          returnsAccepted: ebayPolicy.returnsAccepted,
          returnPeriod: ebayPolicy.returnPeriod?.value || 30,
          refundMethod: ebayPolicy.refundMethod,
          returnShippingCostPayer: ebayPolicy.returnShippingCostPayer,
          syncedFromEbay: true
        });
        res.json({ success: true, policy: localPolicy, ebayPolicy });
      } else {
        const policy = await storage.createEbayReturnPolicy({
          policyId: `local_${Date.now()}`,
          name,
          description,
          marketplaceId: marketplaceId2 || "EBAY_DE",
          returnsAccepted: returnsAccepted ?? true,
          returnPeriod: returnPeriod || 30,
          refundMethod: refundMethod || "MONEY_BACK",
          returnShippingCostPayer: returnShippingCostPayer || "BUYER",
          syncedFromEbay: false
        });
        res.json({ success: true, policy });
      }
    } catch (error) {
      console.error("Failed to create return policy:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to create return policy"
      });
    }
  });
  app.put("/api/ebay/business-policies/return/:policyId", requireAuth, async (req, res) => {
    try {
      const { policyId } = req.params;
      const { name, description, returnsAccepted, returnPeriod, refundMethod, returnShippingCostPayer, updateOnEbay } = req.body;
      if (updateOnEbay && !policyId.startsWith("local_")) {
        const ebayPolicy = await ebayAccountApi.updateReturnPolicy(policyId, {
          name,
          description,
          returnsAccepted,
          returnPeriod: returnPeriod ? { value: returnPeriod, unit: "DAY" } : void 0,
          refundMethod,
          returnShippingCostPayer
        });
        if (!ebayPolicy) {
          return res.status(500).json({ success: false, message: "Failed to update policy on eBay" });
        }
      }
      const policy = await storage.updateEbayReturnPolicy(policyId, {
        name,
        description,
        returnsAccepted,
        returnPeriod,
        refundMethod,
        returnShippingCostPayer
      });
      res.json({ success: true, policy });
    } catch (error) {
      console.error("Failed to update return policy:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to update return policy"
      });
    }
  });
  app.delete("/api/ebay/business-policies/return/:policyId", requireAuth, async (req, res) => {
    try {
      const { policyId } = req.params;
      const { deleteOnEbay } = req.query;
      if (deleteOnEbay === "true" && !policyId.startsWith("local_")) {
        const deleted = await ebayAccountApi.deleteReturnPolicy(policyId);
        if (!deleted) {
          return res.status(500).json({ success: false, message: "Failed to delete policy on eBay" });
        }
      }
      await storage.deleteEbayReturnPolicy(policyId);
      res.json({ success: true, message: "Return policy deleted" });
    } catch (error) {
      console.error("Failed to delete return policy:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to delete return policy"
      });
    }
  });
  app.get("/api/tme/test", async (req, res) => {
    try {
      console.log("\u{1F9EA} Testing TME API connection...");
      const response = await fetch("https://api.tme.eu/Accounts/GetAccountStatus.json", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Accept": "application/json",
          "User-Agent": "TME-API-Client/1.0"
        },
        body: new URLSearchParams({
          Token: process.env.TME_TOKEN || "",
          Language: "EN"
        }).toString()
      });
      const responseText = await response.text();
      console.log("\u{1F4E5} TME API Response:", responseText.substring(0, 500));
      if (response.ok) {
        const data = JSON.parse(responseText);
        res.json({
          success: true,
          status: "TME API connection successful",
          data,
          responseCode: response.status
        });
      } else {
        res.json({
          success: false,
          status: "TME API connection failed",
          error: `HTTP ${response.status}: ${response.statusText}`,
          response: responseText.substring(0, 1e3)
        });
      }
    } catch (error) {
      console.error("\u274C TME API test failed:", error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        status: "TME API test failed"
      });
    }
  });
  app.get("/api/tme/categories/debug", async (req, res) => {
    try {
      console.log("Fetching raw TME categories for debug...");
      const rawData = await tmeApi.getAllCategoriesRaw();
      res.json({
        success: true,
        rawData
      });
    } catch (error) {
      console.error("Failed to fetch raw TME categories:", error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });
  app.get("/api/tme/categories", async (req, res) => {
    try {
      console.log("Fetching TME categories...");
      const categories2 = await tmeApi.getAllCategories();
      res.json({
        success: true,
        categories: categories2,
        totalCategories: categories2.length,
        message: `Found ${categories2.length} categories`
      });
    } catch (error) {
      console.error("Failed to fetch TME categories:", error);
      res.status(500).json({
        success: false,
        message: `Failed to fetch TME categories: ${error.message}`,
        error: error.message
      });
    }
  });
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
      console.log(`\u{1F50D} Fetching TME products for category: ${categoryId}, page: ${page}, limit: ${limit}`);
      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);
      const result = await tmeApi.getProductsByCategory(categoryId, pageNum, limitNum);
      let products2 = result.products || [];
      if (search) {
        const searchLower = search.toLowerCase();
        products2 = products2.filter(
          (p) => p.Description?.toLowerCase().includes(searchLower) || p.Symbol?.toLowerCase().includes(searchLower) || p.Producer?.toLowerCase().includes(searchLower)
        );
      }
      if (producer) {
        const producerLower = producer.toLowerCase();
        products2 = products2.filter(
          (p) => p.Producer?.toLowerCase().includes(producerLower)
        );
      }
      res.json({
        success: true,
        products: products2,
        total: result.total,
        filtered: products2.length,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(result.total / limitNum),
        categoryId
      });
    } catch (error) {
      console.error("TME products fetch error:", error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Failed to fetch TME products"
      });
    }
  });
  app.post("/api/tme/enhanced-info", async (req, res) => {
    try {
      const { symbols } = req.body;
      if (!symbols || !Array.isArray(symbols) || symbols.length === 0) {
        return res.status(400).json({
          success: false,
          error: "Invalid symbols array"
        });
      }
      console.log(`\u{1F4CA} Getting enhanced info for ${symbols.length} products`);
      const enhancedInfo = await tmeApi.getEnhancedProductInfo(symbols);
      console.log(`\u2705 Enhanced info result: ${enhancedInfo.length} products with data`);
      res.json(enhancedInfo);
    } catch (error) {
      console.error("Enhanced info error:", error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Failed to get enhanced product info"
      });
    }
  });
  app.get("/api/tme/usage", async (req, res) => {
    try {
      const apiUsage = await storage.getApiUsage("tme");
      const callsToday = apiUsage?.callsToday || 0;
      const dailyLimit = process.env.TME_DAILY_LIMIT ? Number(process.env.TME_DAILY_LIMIT) : null;
      const usagePercentage = dailyLimit && dailyLimit > 0 ? Math.round(callsToday / dailyLimit * 100) : null;
      res.json({
        success: true,
        usage: {
          callsToday,
          dailyLimit,
          // null unless TME_DAILY_LIMIT is configured
          remainingDaily: dailyLimit ? Math.max(0, dailyLimit - callsToday) : null,
          usagePercentage,
          lastUpdated: apiUsage?.updatedAt || null,
          lastResetAt: apiUsage?.lastResetAt || null
        },
        note: "callsToday is real (DB-tracked). Per-minute metering removed (meaningless on serverless). Set TME_DAILY_LIMIT to show a % against your actual TME tier."
      });
    } catch (error) {
      console.error("Failed to get TME usage:", error);
      res.status(500).json({ success: false, error: "Failed to get TME usage statistics" });
    }
  });
  app.get("/api/ebay/usage", async (req, res) => {
    try {
      const apiUsage = await storage.getApiUsage("ebay");
      const callsToday = apiUsage?.callsToday || 0;
      const dailyLimit = apiUsage?.dailyLimit || 5e3;
      const usagePercentage = Math.round(callsToday / dailyLimit * 100);
      const remainingDaily = dailyLimit - callsToday;
      const rateLimitPerMinute = 50;
      const safeRateLimit = 40;
      const status = callsToday >= dailyLimit ? "LIMIT_EXCEEDED" : usagePercentage >= 80 ? "WARNING" : "NORMAL";
      res.json({
        success: true,
        usage: {
          callsToday,
          dailyLimit,
          remainingDaily,
          usagePercentage,
          rateLimitPerMinute,
          safeRateLimit,
          status,
          lastUpdated: apiUsage?.updatedAt || null,
          lastResetAt: apiUsage?.lastResetAt || null
        },
        limits: {
          daily: dailyLimit,
          perMinute: rateLimitPerMinute,
          safePerMinute: safeRateLimit
        }
      });
    } catch (error) {
      console.error("Failed to get eBay usage:", error);
      res.status(500).json({
        success: false,
        error: "Failed to get eBay usage statistics"
      });
    }
  });
  app.get("/api/ebay/seller-limits", requireAuth, async (req, res) => {
    try {
      const result = await ebayAccountApi.getSellerLimitsWithUsage();
      res.json(result);
    } catch (error) {
      console.error("Failed to get eBay seller limits:", error);
      res.status(500).json({
        success: false,
        error: "Failed to get eBay seller limits"
      });
    }
  });
  app.post("/api/tme/sync-selected", async (req, res) => {
    try {
      console.log("\u{1F4E5} Received sync request:", JSON.stringify(req.body, null, 2));
      const { productSymbols, settings } = req.body;
      if (!productSymbols || !Array.isArray(productSymbols) || productSymbols.length === 0) {
        return res.status(400).json({
          success: false,
          error: "Product symbols array is required"
        });
      }
      console.log(`\u{1F504} Starting sync of ${productSymbols.length} selected products`);
      let syncedCount = 0;
      let updatedCount = 0;
      let failedCount = 0;
      const errors = [];
      try {
        const enhancedProducts = await tmeApi.getEnhancedProductInfo(productSymbols);
        const existingProducts = await storage.getProducts();
        const existingBySku = new Map(existingProducts.map((p) => [p.sku, p]));
        for (const enhanced of enhancedProducts) {
          try {
            const { product, price, stock } = enhanced;
            const moq = product.MinAmount || 1;
            const multiples = product.Multiples || 1;
            const { getSupplierPriceForMoq: getSupplierPriceForMoq2, calculateDynamicPrice: calculateDynamicPrice2, calculatePackagePrice: calculatePackagePrice2 } = await Promise.resolve().then(() => (init_dynamic_pricing(), dynamic_pricing_exports));
            const supplierPrice = getSupplierPriceForMoq2(price?.PriceList, moq);
            let pricingResult = {
              finalPrice: supplierPrice,
              calculatedPrice: supplierPrice,
              marginTier: "No Margin",
              marginPercentage: 0
            };
            if (settings?.applyDynamicPricing && supplierPrice > 0) {
              const result = moq > 1 ? calculatePackagePrice2(supplierPrice, moq, multiples) : calculateDynamicPrice2(supplierPrice);
              pricingResult = {
                finalPrice: result.finalPrice,
                calculatedPrice: result.calculatedPrice,
                marginTier: result.marginTier,
                marginPercentage: result.marginPercentage
              };
            }
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
              moq,
              multiples
            };
            const existing = existingBySku.get(product.Symbol);
            if (existing) {
              await storage.updateProduct(existing.id, productData);
              updatedCount++;
            } else {
              await storage.createProduct(productData);
              syncedCount++;
            }
          } catch (itemError) {
            console.error(`Failed to sync product:`, itemError);
            failedCount++;
            errors.push(`Failed to sync: ${itemError.message}`);
          }
        }
      } catch (batchError) {
        console.error(`Sync error:`, batchError);
        failedCount += productSymbols.length;
        errors.push(`Sync failed: ${batchError.message}`);
      }
      await storage.createSyncLog({
        source: "tme_browser",
        operation: "sync_selected",
        status: failedCount === 0 ? "success" : failedCount < productSymbols.length ? "partial" : "error",
        message: `Synced ${syncedCount} new, updated ${updatedCount}, failed ${failedCount}`,
        details: JSON.stringify({ syncedCount, updatedCount, failedCount, errors })
      });
      res.json({
        success: true,
        syncedCount,
        updatedCount,
        failedCount,
        errors: errors.length > 0 ? errors : void 0
      });
    } catch (error) {
      console.error("Sync failed:", error);
      res.status(500).json({
        success: false,
        error: "Sync failed: " + error.message
      });
    }
  });
  app.post("/api/tme/sync-selected-optimized", async (req, res) => {
    try {
      console.log("\u{1F4E5} Received sync request:", JSON.stringify(req.body, null, 2));
      const { productSymbols, settings } = req.body;
      if (!productSymbols || !Array.isArray(productSymbols) || productSymbols.length === 0) {
        return res.status(400).json({
          success: false,
          error: "Product symbols array is required"
        });
      }
      console.log(`\u{1F504} Starting sync of ${productSymbols.length} selected products`);
      let syncedCount = 0;
      let updatedCount = 0;
      let failedCount = 0;
      const errors = [];
      const batchSize = 10;
      for (let i = 0; i < productSymbols.length; i += batchSize) {
        const batch = productSymbols.slice(i, i + batchSize);
        try {
          console.log(`\u{1F4E6} Processing batch ${Math.floor(i / batchSize) + 1}: ${batch.join(", ")}`);
          const enhancedProducts = await tmeApi.getEnhancedProductInfo(batch);
          for (const enhanced of enhancedProducts) {
            try {
              const { product, price, stock } = enhanced;
              const moq = product.MinAmount || 1;
              const multiples = product.Multiples || 1;
              const { getSupplierPriceForMoq: getSupplierPriceForMoq2, calculateDynamicPrice: calculateDynamicPrice2, calculatePackagePrice: calculatePackagePrice2 } = await Promise.resolve().then(() => (init_dynamic_pricing(), dynamic_pricing_exports));
              const supplierPrice = getSupplierPriceForMoq2(price?.PriceList, moq);
              let pricingResult = {
                finalPrice: supplierPrice,
                calculatedPrice: supplierPrice,
                marginTier: "No Margin",
                marginPercentage: 0
              };
              if (settings.applyDynamicPricing && supplierPrice > 0) {
                const result = moq > 1 ? calculatePackagePrice2(supplierPrice, moq, multiples) : calculateDynamicPrice2(supplierPrice);
                pricingResult = {
                  finalPrice: result.finalPrice,
                  calculatedPrice: result.calculatedPrice,
                  marginTier: result.marginTier,
                  marginPercentage: result.marginPercentage
                };
              }
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
                moq,
                multiples,
                status: "active",
                weight: String(Number(product.Weight) || 10),
                imageUrl: product.Photo ? product.Photo.startsWith("//") ? `https:${product.Photo}` : product.Photo : null,
                dataSheetUrl: product.DataSheet ? `https://www.tme.eu${product.DataSheet}` : null,
                productUrl: product.ProductInformationPage ? `https://www.tme.eu${product.ProductInformationPage}` : null,
                supplier: "tme",
                supplierProductId: product.Symbol,
                useStockLimit: settings.useStockLimit || false,
                ebayStockLimit: settings.useStockLimit ? settings.ebayStockLimit : null
              };
              const existingProduct = await storage.getProductBySku(productData.sku);
              if (existingProduct) {
                await storage.updateProduct(existingProduct.id, productData);
                updatedCount++;
                console.log(`\u2705 Updated product: ${product.Symbol}`);
              } else {
                await storage.createProduct(productData);
                syncedCount++;
                console.log(`\u2705 Created product: ${product.Symbol}`);
              }
            } catch (error) {
              console.error(`\u274C Error processing ${enhanced.product.Symbol}:`, error);
              failedCount++;
              errors.push(`Error processing ${enhanced.product.Symbol}: ${error instanceof Error ? error.message : "Unknown error"}`);
            }
          }
          if (i + batchSize < productSymbols.length) {
            await new Promise((resolve) => setTimeout(resolve, 1e3));
          }
        } catch (error) {
          console.error(`\u274C Batch processing failed:`, error);
          failedCount += batch.length;
          errors.push(`Batch processing failed: ${error instanceof Error ? error.message : "Unknown error"}`);
        }
      }
      const totalProcessed = syncedCount + updatedCount + failedCount;
      res.json({
        success: true,
        results: {
          totalRequested: productSymbols.length,
          totalProcessed,
          syncedCount,
          updatedCount,
          failedCount,
          errors
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
  app.post("/api/pricing/apply-bulk", requireAuth, async (req, res) => {
    try {
      const products2 = await storage.getProducts();
      const validProducts = products2.filter((p) => parseFloat(p.supplierPrice) > 0);
      let updatedCount = 0;
      let errors = [];
      for (const product of validProducts) {
        try {
          const pricingResult = calculateDynamicPrice(parseFloat(product.supplierPrice));
          if (!pricingResult.isValid) {
            errors.push(`Product ${product.name}: ${pricingResult.errors.join(", ")}`);
            continue;
          }
          await storage.updateProduct(product.id, {
            calculatedPrice: pricingResult.finalPrice.toString(),
            marginTier: pricingResult.marginTier,
            marginPercentage: pricingResult.marginPercentage.toString(),
            priceUpdatedAt: /* @__PURE__ */ new Date(),
            useCalculatedPrice: true,
            salePrice: pricingResult.finalPrice.toString()
          });
          updatedCount++;
        } catch (error) {
          errors.push(`Product ${product.name}: ${error.message}`);
        }
      }
      res.json({
        success: true,
        updatedCount,
        totalProducts: validProducts.length,
        skippedProducts: products2.length - validProducts.length,
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
  app.post("/api/pricing/tiers", async (req, res) => {
    try {
      const { min, max, multiplier, label, marginPercentage } = req.body;
      const createdTier = await storage.createPricingTier({
        min: min.toString(),
        max: max.toString(),
        multiplier: multiplier.toString(),
        label,
        marginPercentage: marginPercentage.toString()
      });
      const products2 = await storage.getProducts();
      let updatedCount = 0;
      for (const product of products2) {
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
  app.put("/api/pricing/tiers/:id", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const { min, max, multiplier, label, marginPercentage } = req.body;
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
      const products2 = await storage.getProducts();
      let updatedCount = 0;
      for (const product of products2) {
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
  app.get("/api/products", requireAuth, async (req, res) => {
    try {
      const filters = {
        category: req.query.category,
        status: req.query.status,
        listedOnEbay: req.query.listedOnEbay ? req.query.listedOnEbay === "true" : void 0,
        listedOnAmazon: req.query.listedOnAmazon ? req.query.listedOnAmazon === "true" : void 0,
        minStock: req.query.minStock ? parseInt(req.query.minStock) : void 0,
        maxStock: req.query.maxStock ? parseInt(req.query.maxStock) : void 0
      };
      const cleanFilters = Object.fromEntries(
        Object.entries(filters).filter(([_, value]) => value !== void 0)
      );
      const products2 = await storage.getProductsWithFilters(cleanFilters);
      res.json(products2);
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
      const requestBody = { ...req.body };
      const decimalFields = ["weight", "supplierPrice", "salePrice", "calculatedPrice", "marginPercentage", "margin"];
      decimalFields.forEach((field) => {
        if (requestBody[field] !== void 0 && typeof requestBody[field] === "number") {
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
  app.post("/api/tme/sync-selected-optimized", async (req, res) => {
    try {
      console.log("\u{1F4E5} Received sync request:", JSON.stringify(req.body, null, 2));
      const { productSymbols, settings } = req.body;
      if (!productSymbols || !Array.isArray(productSymbols) || productSymbols.length === 0) {
        return res.status(400).json({
          success: false,
          error: "Product symbols array is required"
        });
      }
      console.log(`\u{1F504} Starting sync of ${productSymbols.length} selected products`);
      let syncedCount = 0;
      let updatedCount = 0;
      let failedCount = 0;
      const errors = [];
      const batchSize = 10;
      for (let i = 0; i < productSymbols.length; i += batchSize) {
        const batch = productSymbols.slice(i, i + batchSize);
        try {
          console.log(`\u{1F4E6} Processing batch ${Math.floor(i / batchSize) + 1}: ${batch.join(", ")}`);
          const enhancedProducts = await tmeApi.getEnhancedProductInfo(batch);
          for (const enhanced of enhancedProducts) {
            try {
              const { product, price, stock } = enhanced;
              const moq = product.MinAmount || 1;
              const multiples = product.Multiples || 1;
              const { getSupplierPriceForMoq: getSupplierPriceForMoq2, calculateDynamicPrice: calculateDynamicPrice2, calculatePackagePrice: calculatePackagePrice2 } = await Promise.resolve().then(() => (init_dynamic_pricing(), dynamic_pricing_exports));
              const supplierPrice = getSupplierPriceForMoq2(price?.PriceList, moq);
              let pricingResult = {
                finalPrice: supplierPrice,
                calculatedPrice: supplierPrice,
                marginTier: "No Margin",
                marginPercentage: 0
              };
              if (settings.applyDynamicPricing && supplierPrice > 0) {
                const result = moq > 1 ? calculatePackagePrice2(supplierPrice, moq, multiples) : calculateDynamicPrice2(supplierPrice);
                pricingResult = {
                  finalPrice: result.finalPrice,
                  calculatedPrice: result.calculatedPrice,
                  marginTier: result.marginTier,
                  marginPercentage: result.marginPercentage
                };
              }
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
                moq,
                multiples,
                status: "active",
                weight: String(Number(product.Weight) || 10),
                imageUrl: product.Photo ? product.Photo.startsWith("//") ? `https:${product.Photo}` : product.Photo : null,
                dataSheetUrl: product.DataSheet ? `https://www.tme.eu${product.DataSheet}` : null,
                productUrl: product.ProductInformationPage ? `https://www.tme.eu${product.ProductInformationPage}` : null,
                supplier: "tme",
                supplierProductId: product.Symbol,
                useStockLimit: settings.useStockLimit || false,
                ebayStockLimit: settings.useStockLimit ? settings.ebayStockLimit : null
              };
              const existingProduct = await storage.getProductBySku(productData.sku);
              if (existingProduct) {
                await storage.updateProduct(existingProduct.id, productData);
                updatedCount++;
                console.log(`\u2705 Updated product: ${product.Symbol}`);
              } else {
                await storage.createProduct(productData);
                syncedCount++;
                console.log(`\u2705 Created product: ${product.Symbol}`);
              }
            } catch (error) {
              console.error(`\u274C Error processing ${enhanced.product.Symbol}:`, error);
              failedCount++;
              errors.push(`Error processing ${enhanced.product.Symbol}: ${error instanceof Error ? error.message : "Unknown error"}`);
            }
          }
          if (i + batchSize < productSymbols.length) {
            await new Promise((resolve) => setTimeout(resolve, 1e3));
          }
        } catch (error) {
          console.error(`\u274C Batch processing failed:`, error);
          failedCount += batch.length;
          errors.push(`Batch processing failed: ${error instanceof Error ? error.message : "Unknown error"}`);
        }
      }
      const totalProcessed = syncedCount + updatedCount + failedCount;
      res.json({
        success: true,
        results: {
          totalRequested: productSymbols.length,
          totalProcessed,
          syncedCount,
          updatedCount,
          failedCount,
          errors
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
  app.post("/api/pricing/apply-bulk", requireAuth, async (req, res) => {
    try {
      const products2 = await storage.getProducts();
      const validProducts = products2.filter((p) => parseFloat(p.supplierPrice) > 0);
      let updatedCount = 0;
      let errors = [];
      for (const product of validProducts) {
        try {
          const pricingResult = calculateDynamicPrice(parseFloat(product.supplierPrice));
          if (!pricingResult.isValid) {
            errors.push(`Product ${product.name}: ${pricingResult.errors.join(", ")}`);
            continue;
          }
          await storage.updateProduct(product.id, {
            calculatedPrice: pricingResult.finalPrice.toString(),
            marginTier: pricingResult.marginTier,
            marginPercentage: pricingResult.marginPercentage.toString(),
            priceUpdatedAt: /* @__PURE__ */ new Date(),
            useCalculatedPrice: true,
            salePrice: pricingResult.finalPrice.toString()
          });
          updatedCount++;
        } catch (error) {
          errors.push(`Product ${product.name}: ${error.message}`);
        }
      }
      res.json({
        success: true,
        updatedCount,
        totalProducts: validProducts.length,
        skippedProducts: products2.length - validProducts.length,
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
  app.get("/api/stock/info", async (req, res) => {
    try {
      const products2 = await storage.getProducts();
      const stockInfo = calculateBulkEbayStock(products2);
      res.json({
        success: true,
        stockInfo: stockInfo.map((item) => ({
          id: item.id,
          ...item.stockInfo
        }))
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });
  app.patch("/api/products/:id/stock-limit", async (req, res) => {
    try {
      const productId = parseInt(req.params.id);
      const { ebayStockLimit, useStockLimit } = req.body;
      if (ebayStockLimit !== void 0) {
        const validation = validateStockLimit(ebayStockLimit);
        if (!validation.valid) {
          return res.status(400).json({
            success: false,
            error: validation.error
          });
        }
      }
      const updateData = {};
      if (ebayStockLimit !== void 0) updateData.ebayStockLimit = ebayStockLimit;
      if (useStockLimit !== void 0) updateData.useStockLimit = useStockLimit;
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
        error: error.message
      });
    }
  });
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
        error: error.message
      });
    }
  });
  app.get("/api/sync/logs", requireAuth, async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit) : 50;
      const logs = await storage.getSyncLogs(limit);
      res.json(logs);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch sync logs" });
    }
  });
  app.get("/api/sync/status", requireAuth, async (req, res) => {
    try {
      const logs = await storage.getSyncLogs(500);
      const getLatestByOperation = (source, operation) => {
        return logs.find((log) => log.source === source && log.operation === operation);
      };
      const countRecentBySourceAndStatus = (source, status, hours = 24) => {
        const cutoff = new Date(Date.now() - hours * 60 * 60 * 1e3);
        return logs.filter(
          (log) => log.source === source && log.status === status && log.syncedAt && new Date(log.syncedAt) > cutoff
        ).length;
      };
      const cronLogs = logs.filter((log) => log.source === "cron" && log.syncedAt);
      const latestCronLog = cronLogs[0];
      let dailySyncStatus = "unknown";
      let dailySyncLastRun = null;
      let dailySyncMessage = "No sync runs recorded";
      if (latestCronLog?.syncedAt) {
        dailySyncLastRun = latestCronLog.syncedAt;
        if (latestCronLog.operation === "daily_sync_complete") {
          dailySyncStatus = "success";
          dailySyncMessage = latestCronLog.message || "Sync completed successfully";
        } else if (latestCronLog.operation === "daily_sync_error") {
          dailySyncStatus = "error";
          dailySyncMessage = latestCronLog.message || "Sync failed";
        } else if (latestCronLog.operation === "daily_sync_start") {
          const startTime = new Date(latestCronLog.syncedAt).getTime();
          const laterComplete = cronLogs.find(
            (log) => log.operation === "daily_sync_complete" && log.syncedAt && new Date(log.syncedAt).getTime() > startTime
          );
          const laterError = cronLogs.find(
            (log) => log.operation === "daily_sync_error" && log.syncedAt && new Date(log.syncedAt).getTime() > startTime
          );
          if (laterComplete) {
            dailySyncStatus = "success";
            dailySyncLastRun = laterComplete.syncedAt;
            dailySyncMessage = laterComplete.message || "Sync completed successfully";
          } else if (laterError) {
            dailySyncStatus = "error";
            dailySyncLastRun = laterError.syncedAt;
            dailySyncMessage = laterError.message || "Sync failed";
          } else {
            dailySyncStatus = "running";
            dailySyncMessage = latestCronLog.message || "Sync in progress...";
          }
        }
      }
      const lastDailyComplete = cronLogs.find((log) => log.operation === "daily_sync_complete");
      const ebayListingSuccess = countRecentBySourceAndStatus("ebay", "success");
      const ebayListingError = countRecentBySourceAndStatus("ebay", "error");
      const lastEbayLog = logs.find((log) => log.source === "ebay");
      const tmeSuccess = countRecentBySourceAndStatus("tme", "success");
      const tmeError = countRecentBySourceAndStatus("tme", "error");
      const lastTmeLog = logs.find((log) => log.source === "tme");
      let dailySyncDetails = { changedProducts: 0, ebayUpdates: 0, totalProducts: 0 };
      if (lastDailyComplete?.details) {
        try {
          const parsed = JSON.parse(lastDailyComplete.details);
          dailySyncDetails = {
            changedProducts: parsed.changedProducts || parsed.changes || 0,
            ebayUpdates: parsed.ebayUpdates || parsed.ebaySync?.succeeded || 0,
            totalProducts: parsed.totalProducts || 0
          };
        } catch (e) {
        }
      }
      res.json({
        success: true,
        syncStatus: {
          dailySync: {
            status: dailySyncStatus,
            lastRun: dailySyncLastRun,
            message: dailySyncMessage,
            nextScheduled: "02:00 AM",
            details: dailySyncDetails
          },
          ebaySync: {
            status: ebayListingError > 0 && ebayListingSuccess === 0 ? "error" : ebayListingSuccess > 0 ? "success" : "idle",
            lastRun: lastEbayLog?.syncedAt || null,
            successCount24h: ebayListingSuccess,
            errorCount24h: ebayListingError,
            lastMessage: lastEbayLog?.message || "No recent eBay operations"
          },
          tmeSync: {
            status: tmeError > 0 && tmeSuccess === 0 ? "error" : tmeSuccess > 0 ? "success" : "idle",
            lastRun: lastTmeLog?.syncedAt || null,
            successCount24h: tmeSuccess,
            errorCount24h: tmeError,
            lastMessage: lastTmeLog?.message || "No recent TME operations"
          }
        },
        recentLogs: logs.slice(0, 20)
        // Include recent logs for detail view
      });
    } catch (error) {
      console.error("Failed to get sync status:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch sync status",
        error: error.message
      });
    }
  });
  app.post("/api/sync/run", requireAuth, async (req, res) => {
    try {
      const limit = Math.min(Number(req.body?.limit) || 50, 100);
      const result = await runSyncChunk(limit);
      res.json({ success: true, ...result });
    } catch (error) {
      console.error("Sync chunk failed:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });
  const cronHandler = async (req, res) => {
    const auth = req.headers["authorization"] || "";
    const cronSecret = process.env.CRON_SECRET;
    const isVercelCron = cronSecret && auth === `Bearer ${cronSecret}`;
    const isAuthed = !!req.session?.userId || process.env.BYPASS_AUTH === "true";
    if (!isVercelCron && !isAuthed) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const budgetMs = 5e4;
    const start = Date.now();
    let chunks = 0;
    let totalChanged = 0;
    let totalEbay = 0;
    let last = null;
    const allErrors = [];
    try {
      do {
        last = await runSyncChunk(50);
        chunks++;
        totalChanged += last.changed;
        totalEbay += last.ebayUpdated;
        allErrors.push(...last.errors);
      } while (!last.done && Date.now() - start < budgetMs);
      await storage.createSyncLog({
        source: "tme",
        operation: "cron_sync",
        status: last?.done ? "success" : "partial",
        message: `Cron sync: ${chunks} chunks, ${totalChanged} changed, ${totalEbay} eBay updated, ${last?.remaining ?? "?"} remaining`,
        details: JSON.stringify({ chunks, totalChanged, totalEbay, remaining: last?.remaining, errors: allErrors.slice(0, 20) })
      });
      res.json({
        success: true,
        done: last?.done ?? false,
        chunks,
        totalChanged,
        ebayUpdated: totalEbay,
        remaining: last?.remaining ?? null,
        elapsedMs: Date.now() - start
      });
    } catch (error) {
      console.error("Cron sync failed:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  };
  app.get("/api/cron/daily-sync", cronHandler);
  app.post("/api/cron/daily-sync", cronHandler);
  app.post("/api/sync/trigger-daily", requireAuth, async (req, res) => {
    try {
      console.log("\u{1F527} Manual daily sync triggered via API");
      const result = await triggerManualSync();
      res.json({
        success: true,
        message: "Daily sync completed",
        result: {
          totalProducts: result.totalProducts,
          changedProducts: result.changedProducts,
          queuedItems: result.queuedItems,
          ebaySync: result.ebaySync,
          duration: result.duration
        }
      });
    } catch (error) {
      console.error("Manual sync trigger failed:", error);
      res.status(500).json({
        success: false,
        message: "Failed to trigger daily sync",
        error: error.message
      });
    }
  });
  app.post("/api/sync/trigger-ebay", requireAuth, async (req, res) => {
    try {
      console.log("\u{1F527} Manual eBay sync triggered via API");
      const products2 = await storage.getProducts();
      const ebayProducts = products2.filter((p) => p.ebayItemId && p.listedOnEbay);
      if (ebayProducts.length === 0) {
        return res.json({
          success: true,
          message: "No eBay-listed products to sync",
          result: { attempted: 0, succeeded: 0, failed: 0, skipped: 0 }
        });
      }
      const updates = ebayProducts.map((product) => {
        const stockInfo = calculateEbayStock(product);
        console.log(`\u{1F4CA} Product ${product.sku}: TME stock ${stockInfo.tmeStock} \u2192 eBay stock ${stockInfo.ebayStock} (${stockInfo.limitReason})`);
        return {
          productId: product.id,
          ebayItemId: product.ebayItemId,
          quantity: stockInfo.ebayStock,
          // Use limited eBay stock, not raw TME stock
          price: parseFloat(product.salePrice?.toString() || "0"),
          sku: product.sku
        };
      });
      const result = await ebayApi.bulkUpdateInventory(updates);
      res.json({
        success: true,
        message: "eBay sync completed with stock limits applied",
        result: {
          attempted: updates.length,
          succeeded: result.succeeded,
          failed: result.failed,
          skipped: 0
        }
      });
    } catch (error) {
      console.error("Manual eBay sync failed:", error);
      res.status(500).json({
        success: false,
        message: "Failed to trigger eBay sync",
        error: error.message
      });
    }
  });
  app.post("/api/sync/backfill-category-ids", requireAuth, async (req, res) => {
    try {
      console.log("\u{1F504} Starting category ID backfill for existing products...");
      const products2 = await storage.getProducts();
      const tmeProducts = products2.filter(
        (p) => p.supplier?.toLowerCase() === "tme" && p.sku && !p.tmeCategoryId
      );
      if (tmeProducts.length === 0) {
        return res.json({
          success: true,
          message: "No products need category ID backfill",
          result: { total: 0, updated: 0 }
        });
      }
      console.log(`\u{1F4E6} Backfilling category IDs for ${tmeProducts.length} TME products`);
      let updatedCount = 0;
      const batchSize = 50;
      for (let i = 0; i < tmeProducts.length; i += batchSize) {
        const batch = tmeProducts.slice(i, i + batchSize);
        const symbols = batch.map((p) => p.sku);
        try {
          const tmeProductDetails = await tmeApi.getEnhancedProductInfo(symbols);
          for (const enhanced of tmeProductDetails) {
            const { product: tmeProduct } = enhanced;
            const localProduct = batch.find((p) => p.sku === tmeProduct.Symbol);
            if (localProduct && tmeProduct.CategoryId) {
              await storage.updateProduct(localProduct.id, {
                tmeCategoryId: String(tmeProduct.CategoryId)
              });
              updatedCount++;
            }
          }
          if (i + batchSize < tmeProducts.length) {
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
        } catch (error) {
          console.error(`\u274C Batch category backfill failed:`, error);
        }
      }
      console.log(`\u{1F389} Category ID backfill complete: ${updatedCount}/${tmeProducts.length} products updated`);
      res.json({
        success: true,
        message: `Category ID backfill completed`,
        result: {
          total: tmeProducts.length,
          updated: updatedCount
        }
      });
    } catch (error) {
      console.error("Category ID backfill failed:", error);
      res.status(500).json({
        success: false,
        message: "Failed to backfill category IDs",
        error: error.message
      });
    }
  });
  app.post("/api/sync/update-moq", requireAuth, async (req, res) => {
    try {
      console.log("\u{1F504} Starting MOQ update for existing products...");
      const products2 = await storage.getProducts();
      const tmeProducts = products2.filter((p) => p.supplier?.toLowerCase() === "tme" && p.sku);
      if (tmeProducts.length === 0) {
        return res.json({
          success: true,
          message: "No TME products to update",
          result: { total: 0, updated: 0 }
        });
      }
      console.log(`\u{1F4E6} Updating MOQ for ${tmeProducts.length} TME products`);
      let updatedCount = 0;
      const batchSize = 50;
      for (let i = 0; i < tmeProducts.length; i += batchSize) {
        const batch = tmeProducts.slice(i, i + batchSize);
        const symbols = batch.map((p) => p.sku);
        try {
          const tmeProductDetails = await tmeApi.getEnhancedProductInfo(symbols);
          for (const enhanced of tmeProductDetails) {
            const { product: tmeProduct } = enhanced;
            const localProduct = batch.find((p) => p.sku === tmeProduct.Symbol);
            if (localProduct && tmeProduct) {
              const moq = tmeProduct.MinAmount || 1;
              const multiples = tmeProduct.Multiples || 1;
              if (localProduct.moq !== moq || localProduct.multiples !== multiples) {
                await storage.updateProduct(localProduct.id, {
                  moq,
                  multiples
                });
                updatedCount++;
                console.log(`\u2705 Updated ${tmeProduct.Symbol}: MOQ=${moq}, Multiples=${multiples}`);
              }
            }
          }
          if (i + batchSize < tmeProducts.length) {
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
        } catch (error) {
          console.error(`\u274C Batch MOQ update failed:`, error);
        }
      }
      console.log(`\u{1F389} MOQ update complete: ${updatedCount}/${tmeProducts.length} products updated`);
      res.json({
        success: true,
        message: `MOQ update completed`,
        result: {
          total: tmeProducts.length,
          updated: updatedCount
        }
      });
    } catch (error) {
      console.error("MOQ update failed:", error);
      res.status(500).json({
        success: false,
        message: "Failed to update MOQ",
        error: error.message
      });
    }
  });
  app.post("/api/images/process-watermark", async (req, res) => {
    try {
      const { imageUrl, advanced = false } = req.body;
      if (!imageUrl) {
        return res.status(400).json({ error: "Image URL is required" });
      }
      console.log(`\u{1F5BC}\uFE0F Processing watermark removal for: ${imageUrl}`);
      const result = advanced ? await imageProcessingService.removeWatermarkAdvanced(imageUrl) : await imageProcessingService.removeWatermark(imageUrl);
      res.json(result);
    } catch (error) {
      console.error("Watermark removal failed:", error);
      res.status(500).json({
        error: "Failed to process image",
        details: error.message
      });
    }
  });
  app.post("/api/images/process-batch", async (req, res) => {
    try {
      const { imageUrls } = req.body;
      if (!Array.isArray(imageUrls) || imageUrls.length === 0) {
        return res.status(400).json({ error: "Array of image URLs is required" });
      }
      if (imageUrls.length > 20) {
        return res.status(400).json({ error: "Maximum 20 images per batch" });
      }
      console.log(`\u{1F5BC}\uFE0F Processing batch watermark removal for ${imageUrls.length} images`);
      const results = await imageProcessingService.processMultipleImages(imageUrls);
      const summary = {
        total: results.length,
        successful: results.filter((r) => r.success).length,
        failed: results.filter((r) => !r.success).length,
        results
      };
      res.json(summary);
    } catch (error) {
      console.error("Batch watermark removal failed:", error);
      res.status(500).json({
        error: "Failed to process image batch",
        details: error.message
      });
    }
  });
  app.get("/api/images/processed/:filename", async (req, res) => {
    try {
      const { filename } = req.params;
      const imageBuffer = await imageProcessingService.getProcessedImage(filename);
      if (!imageBuffer) {
        return res.status(404).json({ error: "Processed image not found" });
      }
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.send(imageBuffer);
    } catch (error) {
      console.error("Failed to serve processed image:", error);
      res.status(500).json({ error: "Failed to serve image" });
    }
  });
  app.post("/api/images/cleanup", async (req, res) => {
    try {
      const { maxAgeHours = 24 } = req.body;
      await imageProcessingService.cleanupOldImages(maxAgeHours);
      res.json({
        success: true,
        message: `Cleaned up processed images older than ${maxAgeHours} hours`
      });
    } catch (error) {
      console.error("Image cleanup failed:", error);
      res.status(500).json({
        error: "Failed to cleanup images",
        details: error.message
      });
    }
  });
  app.get("/api/orders", requireAuth, async (req, res) => {
    try {
      const filters = {};
      if (req.query.marketplace) filters.marketplace = req.query.marketplace;
      if (req.query.status) filters.status = req.query.status;
      if (req.query.search) filters.search = req.query.search;
      if (req.query.fromDate) filters.fromDate = new Date(req.query.fromDate);
      if (req.query.toDate) filters.toDate = new Date(req.query.toDate);
      if (req.query.limit) filters.limit = parseInt(req.query.limit);
      if (req.query.offset) filters.offset = parseInt(req.query.offset);
      const orders2 = await storage.getOrders(filters);
      const total = await storage.getOrdersCount({
        marketplace: filters.marketplace,
        status: filters.status
      });
      const ordersWithItems = await Promise.all(
        orders2.map(async (order) => {
          const items = await storage.getOrderItems(order.id);
          return { ...order, items };
        })
      );
      res.json({
        success: true,
        orders: ordersWithItems,
        total,
        limit: filters.limit,
        offset: filters.offset
      });
    } catch (error) {
      console.error("Failed to fetch orders:", error);
      res.status(500).json({
        success: false,
        error: "Failed to fetch orders"
      });
    }
  });
  app.get("/api/orders/stats", requireAuth, async (req, res) => {
    try {
      const [totalOrders, newOrders, packedOrders, shippedOrders] = await Promise.all([
        storage.getOrdersCount(),
        storage.getOrdersCount({ status: "new" }),
        storage.getOrdersCount({ status: "packed" }),
        storage.getOrdersCount({ status: "shipped" })
      ]);
      const [ebayOrders, amazonOrders] = await Promise.all([
        storage.getOrdersCount({ marketplace: "ebay" }),
        storage.getOrdersCount({ marketplace: "amazon" })
      ]);
      res.json({
        success: true,
        stats: {
          total: totalOrders,
          byStatus: {
            new: newOrders,
            packed: packedOrders,
            shipped: shippedOrders
          },
          byMarketplace: {
            ebay: ebayOrders,
            amazon: amazonOrders
          }
        }
      });
    } catch (error) {
      console.error("Failed to fetch order stats:", error);
      res.status(500).json({
        success: false,
        error: "Failed to fetch order statistics"
      });
    }
  });
  app.get("/api/orders/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const order = await storage.getOrder(id);
      if (!order) {
        return res.status(404).json({
          success: false,
          error: "Order not found"
        });
      }
      const [items, fees, events] = await Promise.all([
        storage.getOrderItems(id),
        storage.getOrderFees(id),
        storage.getOrderEvents(id)
      ]);
      res.json({
        success: true,
        order: {
          ...order,
          items,
          fees,
          events
        }
      });
    } catch (error) {
      console.error("Failed to fetch order:", error);
      res.status(500).json({
        success: false,
        error: "Failed to fetch order"
      });
    }
  });
  app.patch("/api/orders/:id/status", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { status, notes, trackingNumber, trackingCarrier } = req.body;
      const order = await storage.getOrder(id);
      if (!order) {
        return res.status(404).json({
          success: false,
          error: "Order not found"
        });
      }
      const validTransitions = {
        "new": ["packed", "cancelled"],
        "packed": ["shipped", "new"],
        "shipped": ["delivered", "returned"],
        "delivered": ["completed", "returned"],
        "completed": [],
        "returned": [],
        "cancelled": []
      };
      if (!validTransitions[order.status]?.includes(status)) {
        return res.status(400).json({
          success: false,
          error: `Invalid status transition from ${order.status} to ${status}`
        });
      }
      const updateData = { status };
      if (trackingNumber) updateData.trackingNumber = trackingNumber;
      if (trackingCarrier) updateData.shippingCarrier = trackingCarrier;
      if (status === "shipped" && !updateData.shippedAt) updateData.shippedAt = /* @__PURE__ */ new Date();
      if (status === "delivered" && !updateData.deliveredAt) updateData.deliveredAt = /* @__PURE__ */ new Date();
      const updatedOrder = await storage.updateOrder(id, updateData);
      await storage.createOrderEvent({
        orderId: id,
        eventType: "status_change",
        fromStatus: order.status,
        toStatus: status,
        note: notes || null
      });
      const triggerMap = {
        "packed": "order_packed",
        "shipped": "order_shipped",
        "delivered": "order_delivered"
      };
      const triggerType = triggerMap[status];
      if (triggerType) {
        const items = await storage.getOrderItems(id);
        autoMessageScheduler.processAutoMessageTrigger(triggerType, {
          order: updatedOrder,
          items: items.map((i) => ({ marketplaceItemId: i.marketplaceItemId || void 0, title: i.title })),
          trackingNumber: updatedOrder?.trackingNumber || void 0
        }).catch((err) => console.error("Auto-message trigger failed:", err));
      }
      res.json({
        success: true,
        order: updatedOrder
      });
    } catch (error) {
      console.error("Failed to update order status:", error);
      res.status(500).json({
        success: false,
        error: "Failed to update order status"
      });
    }
  });
  app.patch("/api/orders/:id/tracking", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { trackingNumber, trackingCarrier, trackingUrl } = req.body;
      const order = await storage.getOrder(id);
      if (!order) {
        return res.status(404).json({
          success: false,
          error: "Order not found"
        });
      }
      const updatedOrder = await storage.updateOrder(id, {
        trackingNumber,
        shippingCarrier: trackingCarrier,
        trackingUrl
      });
      await storage.createOrderEvent({
        orderId: id,
        eventType: "tracking_update",
        note: `Tracking: ${trackingCarrier} - ${trackingNumber}`
      });
      res.json({
        success: true,
        order: updatedOrder
      });
    } catch (error) {
      console.error("Failed to update tracking:", error);
      res.status(500).json({
        success: false,
        error: "Failed to update tracking information"
      });
    }
  });
  app.post("/api/orders/:id/notes", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { notes } = req.body;
      const order = await storage.getOrder(id);
      if (!order) {
        return res.status(404).json({
          success: false,
          error: "Order not found"
        });
      }
      const event = await storage.createOrderEvent({
        orderId: id,
        eventType: "note",
        note: notes
      });
      res.json({
        success: true,
        event
      });
    } catch (error) {
      console.error("Failed to add order note:", error);
      res.status(500).json({
        success: false,
        error: "Failed to add order note"
      });
    }
  });
  app.get("/api/orders/:id/events", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const events = await storage.getOrderEvents(id);
      res.json({
        success: true,
        events
      });
    } catch (error) {
      console.error("Failed to fetch order events:", error);
      res.status(500).json({
        success: false,
        error: "Failed to fetch order events"
      });
    }
  });
  app.post("/api/orders/:id/print-label", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const order = await storage.getOrder(id);
      if (!order) {
        return res.status(404).json({
          success: false,
          error: "Order not found"
        });
      }
      await storage.createOrderEvent({
        orderId: id,
        eventType: "label_print",
        note: "Shipping label print requested (integration pending)"
      });
      res.json({
        success: true,
        message: "Shipping label printing is not yet configured. Latvian Post API integration coming soon.",
        order: {
          id: order.id,
          shippingName: order.shippingName,
          shippingAddressLine1: order.shippingAddressLine1,
          shippingAddressLine2: order.shippingAddressLine2,
          shippingCity: order.shippingCity,
          shippingStateOrProvince: order.shippingStateOrProvince,
          shippingPostalCode: order.shippingPostalCode,
          shippingCountry: order.shippingCountry
        },
        labelReady: false,
        integrationStatus: "pending"
      });
    } catch (error) {
      console.error("Failed to print label:", error);
      res.status(500).json({
        success: false,
        error: "Failed to process print label request"
      });
    }
  });
  app.delete("/api/orders/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const deleted = await storage.deleteOrder(id);
      if (!deleted) {
        return res.status(404).json({
          success: false,
          error: "Order not found"
        });
      }
      res.json({
        success: true,
        message: "Order deleted successfully"
      });
    } catch (error) {
      console.error("Failed to delete order:", error);
      res.status(500).json({
        success: false,
        error: "Failed to delete order"
      });
    }
  });
  app.post("/api/orders/sync/ebay", requireAuth, async (req, res) => {
    try {
      const { daysBack = 30 } = req.body;
      console.log(`\u{1F4E6} Starting eBay orders sync (${daysBack} days)...`);
      const result = await ebayOrdersApi.syncOrdersFromEbay(daysBack);
      res.json({
        success: true,
        message: `Synced ${result.synced} new orders, updated ${result.updated} existing orders`,
        ...result
      });
    } catch (error) {
      console.error("eBay orders sync failed:", error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });
  app.get("/api/orders/sync/status", requireAuth, async (req, res) => {
    try {
      const isConfigured = ebayOAuth.isOAuthConfigured();
      res.json({
        success: true,
        ebay: {
          configured: isConfigured,
          message: isConfigured ? "eBay OAuth is configured and ready to sync orders" : "eBay OAuth not configured. Set EBAY_OAUTH_CLIENT_ID, EBAY_OAUTH_CLIENT_SECRET, and EBAY_OAUTH_REFRESH_TOKEN"
        },
        amazon: {
          configured: false,
          message: "Amazon SP-API integration coming soon"
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });
  app.get("/api/messages/threads", requireAuth, async (req, res) => {
    try {
      const filters = {
        marketplace: req.query.marketplace,
        status: req.query.status,
        isRead: req.query.isRead === "true" ? true : req.query.isRead === "false" ? false : void 0,
        buyerUsername: req.query.search,
        limit: req.query.limit ? parseInt(req.query.limit) : 50,
        offset: req.query.offset ? parseInt(req.query.offset) : 0
      };
      const threads = await storage.getMessageThreads(filters);
      const unreadCount = await storage.getUnreadThreadCount();
      res.json({
        success: true,
        threads,
        unreadCount
      });
    } catch (error) {
      console.error("Failed to fetch message threads:", error);
      res.status(500).json({
        success: false,
        error: "Failed to fetch message threads"
      });
    }
  });
  app.get("/api/messages/threads/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const thread = await storage.getMessageThread(id);
      if (!thread) {
        return res.status(404).json({
          success: false,
          error: "Thread not found"
        });
      }
      const threadMessages = await storage.getMessages(id);
      if (!thread.isRead) {
        await storage.updateMessageThread(id, { isRead: true });
      }
      res.json({
        success: true,
        thread,
        messages: threadMessages
      });
    } catch (error) {
      console.error("Failed to fetch thread:", error);
      res.status(500).json({
        success: false,
        error: "Failed to fetch thread"
      });
    }
  });
  app.patch("/api/messages/threads/:id/read", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { isRead } = req.body;
      const updated = await storage.updateMessageThread(id, { isRead });
      if (!updated) {
        return res.status(404).json({
          success: false,
          error: "Thread not found"
        });
      }
      res.json({
        success: true,
        thread: updated
      });
    } catch (error) {
      console.error("Failed to update thread:", error);
      res.status(500).json({
        success: false,
        error: "Failed to update thread"
      });
    }
  });
  app.patch("/api/messages/threads/:id/star", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { isStarred } = req.body;
      const updated = await storage.updateMessageThread(id, { isStarred });
      if (!updated) {
        return res.status(404).json({
          success: false,
          error: "Thread not found"
        });
      }
      res.json({
        success: true,
        thread: updated
      });
    } catch (error) {
      console.error("Failed to update thread:", error);
      res.status(500).json({
        success: false,
        error: "Failed to update thread"
      });
    }
  });
  app.post("/api/messages/threads/:id/reply", requireAuth, async (req, res) => {
    try {
      const threadId = parseInt(req.params.id);
      const { body, templateId } = req.body;
      if (!body || body.trim().length === 0) {
        return res.status(400).json({
          success: false,
          error: "Message body is required"
        });
      }
      const thread = await storage.getMessageThread(threadId);
      if (!thread) {
        return res.status(404).json({
          success: false,
          error: "Thread not found"
        });
      }
      if (thread.marketplace === "ebay" && thread.orderId) {
        const order = await storage.getOrder(thread.orderId);
        if (order) {
          const eligibility = ebayMessagesApi.checkOrderMessageEligibility(new Date(order.orderDate || order.createdAt));
          if (!eligibility.eligible) {
            return res.status(400).json({
              success: false,
              error: "Cannot send message - 90-day limit exceeded for eBay orders"
            });
          }
        }
      }
      let ebayResult = { success: true };
      if (thread.marketplace === "ebay" && thread.itemId && ebayOAuth.isOAuthConfigured()) {
        ebayResult = await ebayMessagesApi.sendMessageToPartner(
          thread.itemId,
          thread.buyerUsername,
          body
        );
        if (!ebayResult.success) {
          return res.status(500).json({
            success: false,
            error: `Failed to send message to eBay: ${ebayResult.error}`
          });
        }
      }
      const message = await storage.createMessage({
        threadId,
        direction: "outbound",
        body,
        senderUsername: "seller",
        status: ebayResult.success ? "sent" : "failed",
        errorMessage: ebayResult.error,
        templateId: templateId || null,
        sentAt: /* @__PURE__ */ new Date()
      });
      if (templateId) {
        await storage.incrementTemplateUsage(templateId);
      }
      res.json({
        success: true,
        message,
        ebayStatus: ebayResult.success ? "sent" : "failed"
      });
    } catch (error) {
      console.error("Failed to send reply:", error);
      res.status(500).json({
        success: false,
        error: "Failed to send reply"
      });
    }
  });
  const cleanMessageBodyForStorage = (html) => {
    if (!html) return "";
    let text2 = html.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
    if (text2.includes("<") || text2.includes("&lt;")) {
      text2 = text2.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
      text2 = text2.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
      text2 = text2.replace(/<head[^>]*>[\s\S]*?<\/head>/gi, "");
      text2 = text2.replace(/<!--[\s\S]*?-->/g, "");
      text2 = text2.replace(/<!DOCTYPE[^>]*>/gi, "");
      text2 = text2.replace(/<\?xml[^>]*\?>/gi, "");
      text2 = text2.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n\n").replace(/<\/div>/gi, "\n").replace(/<\/tr>/gi, "\n").replace(/<\/li>/gi, "\n");
      text2 = text2.replace(/<[^>]+>/g, "");
      text2 = text2.replace(/\n\s*\n\s*\n/g, "\n\n").replace(/[ \t]+/g, " ").trim();
    }
    return text2.trim();
  };
  app.post("/api/messages/sync/ebay", requireAuth, async (req, res) => {
    try {
      if (!ebayOAuth.isOAuthConfigured()) {
        return res.status(400).json({
          success: false,
          error: "eBay OAuth not configured"
        });
      }
      const { daysBack = 30 } = req.body;
      const startTime = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1e3);
      console.log(`\u{1F4EC} Syncing eBay messages from last ${daysBack} days...`);
      let synced = 0;
      let updated = 0;
      let pageNum = 1;
      let hasMore = true;
      while (hasMore) {
        console.log(`\u{1F4EC} Fetching message page ${pageNum}...`);
        const result = await ebayMessagesApi.getMyMessages(startTime, void 0, "Inbox", 100, pageNum);
        if (!result.success) {
          return res.status(500).json({
            success: false,
            error: result.error
          });
        }
        hasMore = result.hasMoreMessages || false;
        for (const msg of result.messages) {
          let thread = await storage.getMessageThreadByBuyer(msg.sender, msg.itemId);
          if (!thread) {
            thread = await storage.createMessageThread({
              marketplace: "ebay",
              marketplaceThreadId: msg.messageId,
              buyerUsername: msg.sender,
              buyerEmail: msg.senderEmail,
              itemId: msg.itemId,
              itemTitle: msg.itemTitle,
              subject: cleanMessageBodyForStorage(msg.subject),
              status: "open",
              isRead: msg.isRead,
              lastMessageAt: new Date(msg.creationDate)
            });
            synced++;
          } else {
            const cleanedSubject = cleanMessageBodyForStorage(msg.subject);
            if (thread.subject !== cleanedSubject) {
              await storage.updateMessageThread(thread.id, {
                subject: cleanedSubject,
                lastMessageAt: new Date(msg.creationDate)
              });
            }
            updated++;
          }
          const existingMessages = await storage.getMessages(thread.id);
          const existingMsg = existingMessages.find((m) => m.marketplaceMessageId === msg.messageId);
          if (!existingMsg) {
            await storage.createMessage({
              threadId: thread.id,
              direction: "inbound",
              subject: cleanMessageBodyForStorage(msg.subject),
              body: cleanMessageBodyForStorage(msg.body),
              marketplaceMessageId: msg.messageId,
              senderUsername: msg.sender,
              senderEmail: msg.senderEmail,
              status: "delivered"
            });
          } else {
            const cleanedBody = cleanMessageBodyForStorage(msg.body);
            const cleanedSubject = cleanMessageBodyForStorage(msg.subject);
            if (existingMsg.body !== cleanedBody || existingMsg.subject !== cleanedSubject) {
              await storage.updateMessage(existingMsg.id, {
                body: cleanedBody,
                subject: cleanedSubject
              });
            }
          }
        }
        if (hasMore) pageNum++;
      }
      console.log(`\u{1F4EC} Synced ${synced} new threads, updated ${updated} existing threads`);
      res.json({
        success: true,
        synced,
        updated,
        totalMessages: synced + updated
      });
    } catch (error) {
      console.error("Failed to sync eBay messages:", error);
      res.status(500).json({
        success: false,
        error: "Failed to sync messages from eBay"
      });
    }
  });
  app.get("/api/messages/templates", requireAuth, async (req, res) => {
    try {
      const category = req.query.category;
      const templates = await storage.getMessageTemplates(category);
      res.json({
        success: true,
        templates
      });
    } catch (error) {
      console.error("Failed to fetch templates:", error);
      res.status(500).json({
        success: false,
        error: "Failed to fetch templates"
      });
    }
  });
  app.post("/api/messages/templates", requireAuth, async (req, res) => {
    try {
      const data = insertMessageTemplateSchema.parse(req.body);
      const template = await storage.createMessageTemplate(data);
      res.json({
        success: true,
        template
      });
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({
          success: false,
          error: "Invalid template data",
          details: error.errors
        });
      }
      console.error("Failed to create template:", error);
      res.status(500).json({
        success: false,
        error: "Failed to create template"
      });
    }
  });
  app.patch("/api/messages/templates/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const updated = await storage.updateMessageTemplate(id, req.body);
      if (!updated) {
        return res.status(404).json({
          success: false,
          error: "Template not found"
        });
      }
      res.json({
        success: true,
        template: updated
      });
    } catch (error) {
      console.error("Failed to update template:", error);
      res.status(500).json({
        success: false,
        error: "Failed to update template"
      });
    }
  });
  app.delete("/api/messages/templates/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const deleted = await storage.deleteMessageTemplate(id);
      if (!deleted) {
        return res.status(404).json({
          success: false,
          error: "Template not found"
        });
      }
      res.json({
        success: true,
        message: "Template deleted"
      });
    } catch (error) {
      console.error("Failed to delete template:", error);
      res.status(500).json({
        success: false,
        error: "Failed to delete template"
      });
    }
  });
  app.post("/api/messages/templates/:id/preview", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { variables } = req.body;
      const template = await storage.getMessageTemplate(id);
      if (!template) {
        return res.status(404).json({
          success: false,
          error: "Template not found"
        });
      }
      const renderedBody = ebayMessagesApi.renderTemplate(template.body, variables || {});
      const renderedSubject = template.subject ? ebayMessagesApi.renderTemplate(template.subject, variables || {}) : void 0;
      res.json({
        success: true,
        preview: {
          subject: renderedSubject,
          body: renderedBody
        }
      });
    } catch (error) {
      console.error("Failed to preview template:", error);
      res.status(500).json({
        success: false,
        error: "Failed to preview template"
      });
    }
  });
  app.get("/api/messages/auto-rules", requireAuth, async (req, res) => {
    try {
      const triggerType = req.query.triggerType;
      const rules = await storage.getAutoMessageRules(triggerType);
      res.json({
        success: true,
        rules
      });
    } catch (error) {
      console.error("Failed to fetch auto-message rules:", error);
      res.status(500).json({
        success: false,
        error: "Failed to fetch rules"
      });
    }
  });
  app.post("/api/messages/auto-rules", requireAuth, async (req, res) => {
    try {
      const data = insertAutoMessageRuleSchema.parse(req.body);
      const rule = await storage.createAutoMessageRule(data);
      res.json({
        success: true,
        rule
      });
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({
          success: false,
          error: "Invalid rule data",
          details: error.errors
        });
      }
      console.error("Failed to create auto-message rule:", error);
      res.status(500).json({
        success: false,
        error: "Failed to create rule"
      });
    }
  });
  app.patch("/api/messages/auto-rules/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const updated = await storage.updateAutoMessageRule(id, req.body);
      if (!updated) {
        return res.status(404).json({
          success: false,
          error: "Rule not found"
        });
      }
      res.json({
        success: true,
        rule: updated
      });
    } catch (error) {
      console.error("Failed to update auto-message rule:", error);
      res.status(500).json({
        success: false,
        error: "Failed to update rule"
      });
    }
  });
  app.delete("/api/messages/auto-rules/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const deleted = await storage.deleteAutoMessageRule(id);
      if (!deleted) {
        return res.status(404).json({
          success: false,
          error: "Rule not found"
        });
      }
      res.json({
        success: true,
        message: "Rule deleted"
      });
    } catch (error) {
      console.error("Failed to delete auto-message rule:", error);
      res.status(500).json({
        success: false,
        error: "Failed to delete rule"
      });
    }
  });
  app.get("/api/messages/scheduled", requireAuth, async (req, res) => {
    try {
      const status = req.query.status;
      const scheduledMsgs = await storage.getScheduledMessages(status);
      res.json({
        success: true,
        scheduled: scheduledMsgs
      });
    } catch (error) {
      console.error("Failed to fetch scheduled messages:", error);
      res.status(500).json({
        success: false,
        error: "Failed to fetch scheduled messages"
      });
    }
  });
  app.delete("/api/messages/scheduled/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const cancelled = await storage.cancelScheduledMessage(id);
      if (!cancelled) {
        return res.status(404).json({
          success: false,
          error: "Scheduled message not found"
        });
      }
      res.json({
        success: true,
        message: "Scheduled message cancelled"
      });
    } catch (error) {
      console.error("Failed to cancel scheduled message:", error);
      res.status(500).json({
        success: false,
        error: "Failed to cancel scheduled message"
      });
    }
  });
  app.post("/api/orders/:id/message", requireAuth, async (req, res) => {
    try {
      const orderId = parseInt(req.params.id);
      const { body, templateId } = req.body;
      if (!body || body.trim().length === 0) {
        return res.status(400).json({
          success: false,
          error: "Message body is required"
        });
      }
      const order = await storage.getOrder(orderId);
      if (!order) {
        return res.status(404).json({
          success: false,
          error: "Order not found"
        });
      }
      if (order.marketplace === "ebay") {
        const eligibility = ebayMessagesApi.checkOrderMessageEligibility(new Date(order.orderDate || order.createdAt));
        if (!eligibility.eligible) {
          return res.status(400).json({
            success: false,
            error: `Cannot send message - 90-day limit exceeded (${eligibility.daysRemaining} days past limit)`
          });
        }
      }
      let thread = await storage.getMessageThreadByBuyer(order.buyerUsername, order.marketplaceOrderId);
      if (!thread) {
        thread = await storage.createMessageThread({
          marketplace: order.marketplace,
          buyerUsername: order.buyerUsername,
          buyerEmail: order.buyerEmail,
          orderId: order.id,
          marketplaceOrderId: order.marketplaceOrderId,
          subject: `Order ${order.marketplaceOrderId}`,
          status: "open",
          isRead: true,
          lastMessageAt: /* @__PURE__ */ new Date()
        });
      }
      let ebayResult = { success: true };
      if (order.marketplace === "ebay" && ebayOAuth.isOAuthConfigured()) {
        const items = await storage.getOrderItems(orderId);
        const itemId = items[0]?.marketplaceItemId;
        if (itemId) {
          ebayResult = await ebayMessagesApi.sendMessageToPartner(
            itemId,
            order.buyerUsername,
            body
          );
        }
      }
      const message = await storage.createMessage({
        threadId: thread.id,
        direction: "outbound",
        body,
        senderUsername: "seller",
        status: ebayResult.success ? "sent" : "failed",
        errorMessage: ebayResult.error,
        templateId: templateId || null,
        sentAt: /* @__PURE__ */ new Date()
      });
      await storage.createOrderEvent({
        orderId,
        eventType: "message_sent",
        note: `Message sent to buyer: ${body.substring(0, 100)}${body.length > 100 ? "..." : ""}`
      });
      res.json({
        success: true,
        message,
        threadId: thread.id,
        ebayStatus: ebayResult.success ? "sent" : "failed"
      });
    } catch (error) {
      console.error("Failed to send order message:", error);
      res.status(500).json({
        success: false,
        error: "Failed to send message"
      });
    }
  });
  app.get("/api/orders/:id/messages", requireAuth, async (req, res) => {
    try {
      const orderId = parseInt(req.params.id);
      const threads = await storage.getMessageThreads({ orderId });
      if (threads.length === 0) {
        return res.json({
          success: true,
          thread: null,
          messages: []
        });
      }
      const thread = threads[0];
      const threadMessages = await storage.getMessages(thread.id);
      res.json({
        success: true,
        thread,
        messages: threadMessages
      });
    } catch (error) {
      console.error("Failed to fetch order messages:", error);
      res.status(500).json({
        success: false,
        error: "Failed to fetch messages"
      });
    }
  });
  app.get("/api/messages/status", requireAuth, async (req, res) => {
    try {
      const isConfigured = ebayOAuth.isOAuthConfigured();
      const unreadCount = await storage.getUnreadThreadCount();
      const templates = await storage.getMessageTemplates();
      const rules = await storage.getAutoMessageRules();
      res.json({
        success: true,
        ebay: {
          configured: isConfigured,
          message: isConfigured ? "eBay messaging is configured and ready" : "eBay OAuth not configured"
        },
        unreadCount,
        templatesCount: templates.length,
        activeRulesCount: rules.filter((r) => r.isActive).length
      });
    } catch (error) {
      console.error("Failed to get messaging status:", error);
      res.status(500).json({
        success: false,
        error: "Failed to get messaging status"
      });
    }
  });
  const httpServer = createServer(app);
  return httpServer;
}

// server/app.ts
var PgSession = connectPgSimple(session);
async function createApp() {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: false, limit: "10mb" }));
  app.set("trust proxy", 1);
  if (!process.env.SESSION_SECRET) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("SESSION_SECRET must be set in production");
    }
    console.warn("\u26A0\uFE0F  SESSION_SECRET not set; using insecure dev default");
  }
  app.use(
    session({
      store: new PgSession({
        pool,
        tableName: "user_sessions",
        createTableIfMissing: true,
        pruneSessionInterval: false
      }),
      secret: process.env.SESSION_SECRET || "dev-only-insecure-secret",
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: process.env.NODE_ENV === "production",
        httpOnly: true,
        sameSite: "lax",
        maxAge: 24 * 60 * 60 * 1e3
      }
    })
  );
  app.use((req, res, next) => {
    const start = Date.now();
    res.on("finish", () => {
      if (req.path.startsWith("/api")) {
        console.log(
          `${req.method} ${req.path} ${res.statusCode} in ${Date.now() - start}ms`
        );
      }
    });
    next();
  });
  await registerRoutes(app);
  app.use((err, _req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    console.error("[express-error]", err);
    res.status(status).json({ message: err.message || "Internal Server Error" });
  });
  return app;
}

// server/vercel-handler.ts
var appPromise = null;
function getApp() {
  if (!appPromise) {
    appPromise = createApp().catch((err) => {
      appPromise = null;
      throw err;
    });
  }
  return appPromise;
}
async function handler(req, res) {
  if (req.url) {
    const parsed = new URL(req.url, "http://localhost");
    const origPath = parsed.searchParams.get("_origPath");
    if (origPath) {
      parsed.searchParams.delete("_origPath");
      const remainingSearch = parsed.search;
      req.url = `/api/${origPath}${remainingSearch}`;
    }
  }
  const app = await getApp();
  return app(req, res);
}
export {
  handler as default
};

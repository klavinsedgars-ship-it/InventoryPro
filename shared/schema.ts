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
  stock: integer("stock").notNull().default(0),
  weight: integer("weight"), // in grams
  margin: decimal("margin", { precision: 5, scale: 2 }), // percentage
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
export type LoginData = z.infer<typeof loginSchema>;

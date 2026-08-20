CREATE TABLE "api_usage_tracking" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'tme' NOT NULL,
	"calls_today" integer DEFAULT 0 NOT NULL,
	"daily_limit" integer DEFAULT 10000 NOT NULL,
	"last_reset_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "auto_message_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"trigger_type" text NOT NULL,
	"trigger_delay" integer DEFAULT 0,
	"trigger_delay_unit" text DEFAULT 'minutes',
	"template_id" integer NOT NULL,
	"marketplaces" text[] DEFAULT '{"ebay"}',
	"min_order_value" numeric(10, 2),
	"exclude_countries" text[],
	"is_active" boolean DEFAULT true NOT NULL,
	"sent_count" integer DEFAULT 0 NOT NULL,
	"last_triggered_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "bulk_listing_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"processed" integer DEFAULT 0 NOT NULL,
	"succeeded" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"current_product" text,
	"last_message" text,
	"error_details" text,
	"created_at" timestamp DEFAULT now(),
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"ebay_mapping" text,
	"amazon_mapping" text,
	CONSTRAINT "categories_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "competitor_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"sku" text NOT NULL,
	"marketplace" text DEFAULT 'ebay' NOT NULL,
	"search_query" text NOT NULL,
	"our_price" numeric(10, 2),
	"cheapest_price" numeric(10, 2),
	"top3_avg_price" numeric(10, 2),
	"sample_count" integer DEFAULT 0 NOT NULL,
	"market_total" integer,
	"currency" text DEFAULT 'EUR',
	"signal" text DEFAULT 'no_data' NOT NULL,
	"delta_pct" numeric(6, 2),
	"recommended_price" numeric(10, 2),
	"error_message" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "demand_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"sku" text NOT NULL,
	"search_query" text NOT NULL,
	"window_days" integer DEFAULT 30 NOT NULL,
	"sold_count" integer,
	"sample_count" integer DEFAULT 0 NOT NULL,
	"avg_sold_price" numeric(10, 2),
	"median_sold_price" numeric(10, 2),
	"low_sold_price" numeric(10, 2),
	"high_sold_price" numeric(10, 2),
	"currency" text DEFAULT 'EUR',
	"error_message" text,
	"not_approved" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ebay_fulfillment_policies" (
	"id" serial PRIMARY KEY NOT NULL,
	"policy_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"marketplace_id" text DEFAULT 'EBAY_GB' NOT NULL,
	"category_types" text,
	"handling_time" integer DEFAULT 1 NOT NULL,
	"shipping_options" text,
	"ship_to_locations" text,
	"global_shipping" boolean DEFAULT false,
	"pickup_drop_off" boolean DEFAULT false,
	"freight_shipping" boolean DEFAULT false,
	"is_default" boolean DEFAULT false,
	"synced_from_ebay" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "ebay_fulfillment_policies_policy_id_unique" UNIQUE("policy_id")
);
--> statement-breakpoint
CREATE TABLE "ebay_payment_policies" (
	"id" serial PRIMARY KEY NOT NULL,
	"policy_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"marketplace_id" text DEFAULT 'EBAY_GB' NOT NULL,
	"category_types" text,
	"payment_methods" text,
	"immediate_pay" boolean DEFAULT true,
	"is_default" boolean DEFAULT false,
	"synced_from_ebay" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "ebay_payment_policies_policy_id_unique" UNIQUE("policy_id")
);
--> statement-breakpoint
CREATE TABLE "ebay_return_policies" (
	"id" serial PRIMARY KEY NOT NULL,
	"policy_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"marketplace_id" text DEFAULT 'EBAY_GB' NOT NULL,
	"category_types" text,
	"returns_accepted" boolean DEFAULT true NOT NULL,
	"return_period" integer DEFAULT 30,
	"refund_method" text DEFAULT 'MONEY_BACK',
	"return_shipping_cost_payer" text DEFAULT 'BUYER',
	"restocking_fee_percentage" text,
	"is_default" boolean DEFAULT false,
	"synced_from_ebay" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "ebay_return_policies_policy_id_unique" UNIQUE("policy_id")
);
--> statement-breakpoint
CREATE TABLE "ebay_taxonomy_cache" (
	"id" serial PRIMARY KEY NOT NULL,
	"cache_key" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "ebay_taxonomy_cache_cache_key_unique" UNIQUE("cache_key")
);
--> statement-breakpoint
CREATE TABLE "marketplace_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"marketplace" text NOT NULL,
	"setting" text NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"subject" text,
	"body" text NOT NULL,
	"category" text DEFAULT 'general' NOT NULL,
	"placeholders" text[],
	"usage_count" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "message_threads" (
	"id" serial PRIMARY KEY NOT NULL,
	"marketplace" text DEFAULT 'ebay' NOT NULL,
	"marketplace_thread_id" text,
	"buyer_username" text NOT NULL,
	"buyer_email" text,
	"order_id" integer,
	"marketplace_order_id" text,
	"item_id" text,
	"item_title" text,
	"status" text DEFAULT 'open' NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"is_starred" boolean DEFAULT false NOT NULL,
	"last_message_at" timestamp,
	"message_count" integer DEFAULT 0 NOT NULL,
	"subject" text,
	"tags" text[],
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"thread_id" integer NOT NULL,
	"direction" text NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"body_html" text,
	"marketplace_message_id" text,
	"sender_username" text NOT NULL,
	"sender_email" text,
	"status" text DEFAULT 'sent' NOT NULL,
	"error_message" text,
	"template_id" integer,
	"auto_message_rule_id" integer,
	"raw_payload" text,
	"sent_at" timestamp,
	"read_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "order_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"event_type" text NOT NULL,
	"from_status" text,
	"to_status" text,
	"note" text,
	"user_id" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "order_fees" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"fee_type" text NOT NULL,
	"description" text,
	"amount" numeric(10, 2) NOT NULL,
	"currency" text DEFAULT 'GBP' NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"product_id" integer,
	"sku" text NOT NULL,
	"tme_product_id" text,
	"title" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_price" numeric(10, 2) NOT NULL,
	"total_price" numeric(10, 2) NOT NULL,
	"supplier_cost_at_sale" numeric(10, 2),
	"marketplace_item_id" text,
	"image_url" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"marketplace" text NOT NULL,
	"marketplace_order_id" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"buyer_username" text NOT NULL,
	"buyer_email" text,
	"shipping_name" text NOT NULL,
	"shipping_address_line1" text NOT NULL,
	"shipping_address_line2" text,
	"shipping_city" text NOT NULL,
	"shipping_state_or_province" text,
	"shipping_postal_code" text NOT NULL,
	"shipping_country" text NOT NULL,
	"shipping_phone" text,
	"subtotal" numeric(10, 2) NOT NULL,
	"shipping_cost" numeric(10, 2) DEFAULT '0.00' NOT NULL,
	"total_price" numeric(10, 2) NOT NULL,
	"currency" text DEFAULT 'GBP' NOT NULL,
	"marketplace_fee" numeric(10, 2),
	"payment_processing_fee" numeric(10, 2),
	"shipping_service" text,
	"shipping_carrier" text,
	"tracking_number" text,
	"tracking_url" text,
	"paid_at" timestamp,
	"shipped_at" timestamp,
	"delivered_at" timestamp,
	"expected_delivery_start" timestamp,
	"expected_delivery_end" timestamp,
	"logistics_carrier" text,
	"logistics_label_url" text,
	"logistics_label_data" text,
	"buyer_note" text,
	"seller_note" text,
	"raw_order_data" text,
	"order_date" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"last_synced_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "pricing_tiers" (
	"id" serial PRIMARY KEY NOT NULL,
	"min" numeric(10, 2) NOT NULL,
	"max" numeric(10, 2) NOT NULL,
	"multiplier" numeric(5, 2) NOT NULL,
	"label" text NOT NULL,
	"margin_percentage" numeric(5, 2) NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"sku" text NOT NULL,
	"ean" text,
	"category" text NOT NULL,
	"description" text,
	"supplier_price" numeric(10, 2) NOT NULL,
	"sale_price" numeric(10, 2) NOT NULL,
	"calculated_price" numeric(10, 2),
	"margin_tier" text,
	"margin_percentage" numeric(5, 2),
	"price_updated_at" timestamp,
	"use_calculated_price" boolean DEFAULT true,
	"stock" integer DEFAULT 0 NOT NULL,
	"moq" integer DEFAULT 1 NOT NULL,
	"multiples" integer DEFAULT 1 NOT NULL,
	"ebay_stock_limit" integer DEFAULT 2 NOT NULL,
	"use_stock_limit" boolean DEFAULT true,
	"weight" numeric(8, 2),
	"margin" numeric(5, 2),
	"status" text DEFAULT 'active' NOT NULL,
	"listed_on_ebay" boolean DEFAULT false,
	"listed_on_amazon" boolean DEFAULT false,
	"exclude_from_listing" boolean DEFAULT false,
	"ebay_item_id" text,
	"ebay_offer_id" text,
	"ebay_listing_id" text,
	"ebay_listing_status" text,
	"ebay_listing_error" text,
	"ebay_list_attempts" integer DEFAULT 0 NOT NULL,
	"amazon_asin" text,
	"tme_product_id" text,
	"tme_category_id" text,
	"supplier" text DEFAULT 'manual',
	"supplier_product_id" text,
	"image_url" text,
	"datasheet_url" text,
	"product_url" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"last_synced_at" timestamp,
	CONSTRAINT "products_sku_unique" UNIQUE("sku")
);
--> statement-breakpoint
CREATE TABLE "scheduled_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer,
	"rule_id" integer,
	"template_id" integer NOT NULL,
	"buyer_username" text NOT NULL,
	"item_id" text,
	"scheduled_for" timestamp NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"sent_at" timestamp,
	"error_message" text,
	"message_id" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "shipping_policies" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"min_weight" integer NOT NULL,
	"max_weight" integer NOT NULL,
	"type" text DEFAULT 'standard',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sync_audit" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer,
	"sku" text NOT NULL,
	"source" text DEFAULT 'cron' NOT NULL,
	"price_changed" boolean DEFAULT false NOT NULL,
	"stock_changed" boolean DEFAULT false NOT NULL,
	"old_supplier_price" numeric(10, 2),
	"new_supplier_price" numeric(10, 2),
	"old_stock" integer,
	"new_stock" integer,
	"ebay_action" text DEFAULT 'none' NOT NULL,
	"ebay_error" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sync_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"source" text DEFAULT 'tme_browser' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"processed" integer DEFAULT 0 NOT NULL,
	"synced_count" integer DEFAULT 0 NOT NULL,
	"updated_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"symbols" text NOT NULL,
	"settings" text,
	"errors" text,
	"message" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "sync_jobs_job_id_unique" UNIQUE("job_id")
);
--> statement-breakpoint
CREATE TABLE "sync_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"operation" text DEFAULT 'sync',
	"status" text NOT NULL,
	"message" text,
	"details" text,
	"synced_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sync_queue" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"operation" text NOT NULL,
	"priority" integer DEFAULT 3 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"max_retries" integer DEFAULT 3 NOT NULL,
	"marketplace" text DEFAULT 'ebay' NOT NULL,
	"scheduled_for" timestamp DEFAULT now(),
	"error_message" text,
	"created_at" timestamp DEFAULT now(),
	"processed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "tme_product_cache" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"product_data" text NOT NULL,
	"price_data" text,
	"stock_data" text,
	"category_id" integer,
	"fetched_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	CONSTRAINT "tme_product_cache_symbol_unique" UNIQUE("symbol")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password" text NOT NULL,
	"email" text NOT NULL,
	"role" text DEFAULT 'user' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "users_username_unique" UNIQUE("username"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "auto_message_rules" ADD CONSTRAINT "auto_message_rules_template_id_message_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."message_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_snapshots" ADD CONSTRAINT "competitor_snapshots_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_snapshots" ADD CONSTRAINT "demand_snapshots_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_threads" ADD CONSTRAINT "message_threads_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_thread_id_message_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."message_threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_template_id_message_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."message_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_fees" ADD CONSTRAINT "order_fees_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_rule_id_auto_message_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."auto_message_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_template_id_message_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."message_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_queue" ADD CONSTRAINT "sync_queue_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;
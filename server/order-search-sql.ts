/**
 * SQL for the orders list filters, kept out of storage.ts so it carries no
 * database connection: the subquery is built with drizzle's standalone
 * QueryBuilder, which makes the generated SQL assertable in a unit test
 * instead of only observable against a live Neon instance.
 */
import { eq, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { QueryBuilder, type PgColumn } from "drizzle-orm/pg-core";
import { orderItems, orders, products } from "@shared/schema";
import {
  planOrderSearch,
  searchesGroup,
  type OrderSearchField,
  type OrderSearchPlan,
} from "@shared/order-search";

export interface OrderQueryFilters {
  marketplace?: string;
  status?: string;
  /** Free text; what it may match is decided by searchField. */
  search?: string;
  searchField?: OrderSearchField;
  /** ISO-3166 alpha-2, matched as a substring so "de" also finds "DE". */
  country?: string;
  fromDate?: Date;
  toDate?: Date;
  limit?: number;
  offset?: number;
}

/**
 * Compact an identifier column the same way compactIdentifier() compacts the
 * term. Both sides must strip exactly the same character set or the
 * separator-insensitive fallback matches nothing.
 */
function compactedColumn(column: PgColumn): SQL {
  return sql`regexp_replace(${column}, '[^A-Za-z0-9]', '', 'g')`;
}

/**
 * One ilike predicate per column, plus a separator-stripped predicate for
 * identifier columns — so a TME symbol read off a reel as "NE 555 P" still
 * finds the order that stored it as NE555P.
 */
function likeAnyOf(plan: OrderSearchPlan, columns: PgColumn[], identifiers = false): SQL[] {
  const predicates: SQL[] = [];
  for (const column of columns) {
    predicates.push(ilike(column, plan.pattern));
    if (identifiers && plan.compactPattern) {
      predicates.push(sql`${compactedColumn(column)} ilike ${plan.compactPattern}`);
    }
  }
  return predicates;
}

/**
 * Everything a search term is allowed to match. Order-level columns are
 * matched directly; item- and product-level columns are matched through an
 * EXISTS-style subquery on order_items so an order surfaces when ANY of its
 * lines carries the part number, without the join multiplying the result set.
 */
function orderSearchCondition(plan: OrderSearchPlan): SQL {
  const orderLevel: SQL[] = [];
  if (searchesGroup(plan, "order")) {
    orderLevel.push(...likeAnyOf(plan, [orders.marketplaceOrderId], true));
  }
  if (searchesGroup(plan, "buyer")) {
    orderLevel.push(...likeAnyOf(plan, [orders.buyerUsername, orders.buyerEmail, orders.shippingName]));
  }
  if (searchesGroup(plan, "address")) {
    orderLevel.push(...likeAnyOf(plan, [
      orders.shippingAddressLine1,
      orders.shippingAddressLine2,
      orders.shippingCity,
      orders.shippingPostalCode,
      orders.shippingCountry,
    ]));
  }
  if (searchesGroup(plan, "tracking")) {
    orderLevel.push(...likeAnyOf(plan, [orders.trackingNumber], true));
  }

  const itemLevel: SQL[] = [];
  if (searchesGroup(plan, "part")) {
    // orderItems carries what was sold (SKU and the supplier symbol captured
    // at sale time); products carries the catalogue identifiers, which is the
    // only place an EAN or a non-TME supplier's article number lives.
    itemLevel.push(...likeAnyOf(plan, [
      orderItems.sku,
      orderItems.tmeProductId,
      orderItems.marketplaceItemId,
      products.sku,
      products.supplierProductId,
      products.ean,
    ], true));
  }
  if (searchesGroup(plan, "title")) {
    itemLevel.push(...likeAnyOf(plan, [orderItems.title, products.name]));
  }

  const clauses: SQL[] = [...orderLevel];
  if (itemLevel.length > 0) {
    // left join: an item whose productId never got mapped must still match on
    // its own sku/symbol rather than dropping out of the subquery.
    const matchingOrderIds = new QueryBuilder()
      .select({ orderId: orderItems.orderId })
      .from(orderItems)
      .leftJoin(products, eq(products.id, orderItems.productId))
      .where(or(...itemLevel));
    clauses.push(inArray(orders.id, matchingOrderIds));
  }

  // Unreachable while every scope maps to at least one column, but a scope
  // added without columns must return nothing rather than everything.
  if (clauses.length === 0) return sql`false`;
  return or(...clauses)!;
}

/** Shared by getOrders and getOrdersCount so a page and its total agree. */
export function orderFilterConditions(filters?: OrderQueryFilters): SQL[] {
  const conditions: SQL[] = [];

  if (filters?.marketplace) conditions.push(eq(orders.marketplace, filters.marketplace));
  if (filters?.status) conditions.push(eq(orders.status, filters.status));
  if (filters?.country) conditions.push(ilike(orders.shippingCountry, `%${filters.country}%`));
  if (filters?.fromDate) conditions.push(gte(orders.orderDate, filters.fromDate));
  if (filters?.toDate) conditions.push(lte(orders.orderDate, filters.toDate));

  const plan = planOrderSearch(filters?.search, filters?.searchField);
  if (plan) conditions.push(orderSearchCondition(plan));

  return conditions;
}


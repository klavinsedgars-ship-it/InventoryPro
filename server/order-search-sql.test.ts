import { describe, it, expect } from "vitest";
import { and } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { orderFilterConditions, type OrderQueryFilters } from "./order-search-sql";

const dialect = new PgDialect();

/** Render the WHERE clause the storage layer would run, params and all. */
function render(filters: OrderQueryFilters) {
  const conditions = orderFilterConditions(filters);
  if (conditions.length === 0) return { sql: "", params: [] as unknown[] };
  const query = dialect.sqlToQuery(and(...conditions)!);
  return { sql: query.sql, params: query.params };
}

describe("orderFilterConditions", () => {
  it("filters nothing when given nothing", () => {
    expect(orderFilterConditions()).toEqual([]);
    expect(orderFilterConditions({})).toEqual([]);
    // A blank search box must not become a predicate.
    expect(orderFilterConditions({ search: "   " })).toEqual([]);
  });

  it("matches marketplace, status and country as equality-ish filters", () => {
    const { sql, params } = render({ marketplace: "ebay", status: "new", country: "de" });
    expect(sql).toContain('"marketplace" = $1');
    expect(sql).toContain('"status" = $2');
    expect(sql).toContain('"shipping_country" ilike $3');
    expect(params).toEqual(["ebay", "new", "%de%"]);
  });

  it("bounds the date range on order_date", () => {
    const from = new Date("2026-01-01T00:00:00Z");
    const to = new Date("2026-01-31T23:59:59Z");
    const { sql, params } = render({ fromDate: from, toDate: to });
    expect(sql).toContain('"order_date" >= $1');
    expect(sql).toContain('"order_date" <= $2');
    // drizzle serialises a timestamp column's bound value to ISO text.
    expect(params).toEqual([from.toISOString(), to.toISOString()]);
  });
});

describe("order search scopes", () => {
  it("reaches order_items and products through a subquery, not a join", () => {
    const { sql } = render({ search: "NE555P" });
    // An order must surface once however many of its lines match, so the item
    // columns are behind `orders.id in (select order_id from order_items ...)`
    // rather than joined into the outer select.
    expect(sql).toContain('"id" in (select');
    expect(sql).toContain('from "order_items"');
    expect(sql).toContain('left join "products"');
    expect(sql).not.toMatch(/^select .* from "orders" .*join/);
  });

  it("searches every advertised surface under the default scope", () => {
    const { sql } = render({ search: "NE555P" });
    for (const column of [
      '"marketplace_order_id"',
      '"buyer_username"',
      '"buyer_email"',
      '"shipping_name"',
      '"shipping_address_line1"',
      '"shipping_city"',
      '"shipping_postal_code"',
      '"tracking_number"',
      '"tme_product_id"',
      '"marketplace_item_id"',
      '"supplier_product_id"',
      '"ean"',
      '"title"',
    ]) {
      expect(sql, `expected ${column} to be searched`).toContain(column);
    }
  });

  it("confines the part-number scope to identifier columns", () => {
    const { sql } = render({ search: "NE555P", searchField: "part" });
    expect(sql).toContain('"tme_product_id"');
    expect(sql).toContain('"supplier_product_id"');
    expect(sql).toContain('"ean"');
    // A part number is not a buyer name and must not drag in address noise.
    expect(sql).not.toContain('"buyer_username"');
    expect(sql).not.toContain('"shipping_city"');
    expect(sql).not.toContain('"order_items"."title"');
  });

  it("confines the order-number scope to the order id column", () => {
    const { sql } = render({ search: "12-345", searchField: "order" });
    expect(sql).toContain('"marketplace_order_id"');
    expect(sql).not.toContain("order_items");
    expect(sql).not.toContain('"tracking_number"');
  });

  it("confines the tracking scope to the tracking column", () => {
    const { sql } = render({ search: "RR123456789LV", searchField: "tracking" });
    expect(sql).toContain('"tracking_number"');
    expect(sql).not.toContain('"marketplace_order_id"');
    expect(sql).not.toContain("order_items");
  });

  it("adds a separator-stripped predicate for identifiers only", () => {
    const { sql, params } = render({ search: "NE 555 P", searchField: "part" });
    expect(sql).toContain("regexp_replace");
    // Both the literal and the compacted form are bound.
    expect(params).toContain("%NE 555 P%");
    expect(params).toContain("%NE555P%");
  });

  it("skips the compacted predicate when compacting changes nothing", () => {
    const { sql } = render({ search: "NE555P", searchField: "part" });
    expect(sql).not.toContain("regexp_replace");
  });

  it("never compacts free-text columns, where separators are meaningful", () => {
    const { sql } = render({ search: "Green Cell", searchField: "title" });
    expect(sql).toContain('"title" ilike');
    expect(sql).not.toContain("regexp_replace");
  });

  it("binds the term as a parameter rather than inlining it", () => {
    const { sql, params } = render({ search: "'; drop table orders; --" });
    expect(sql).not.toContain("drop table");
    expect(params).toContain("%'; drop table orders; --%");
  });

  it("escapes LIKE wildcards so an underscore is not a wildcard", () => {
    const { params } = render({ search: "SMD_0805", searchField: "part" });
    expect(params).toContain("%SMD\\_0805%");
  });

  it("combines a search with the other filters as AND", () => {
    const conditions = orderFilterConditions({
      search: "NE555P",
      status: "shipped",
      marketplace: "ebay",
    });
    expect(conditions).toHaveLength(3);
  });

  it("falls back to searching everything when the scope is unrecognised", () => {
    const { sql } = render({ search: "x", searchField: "nonsense" as never });
    expect(sql).toContain('"buyer_username"');
    expect(sql).toContain("order_items");
  });
});

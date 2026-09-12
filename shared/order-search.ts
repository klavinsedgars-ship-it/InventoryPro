/**
 * Order search: which columns a typed term is allowed to match, and how the
 * raw string becomes a SQL LIKE pattern.
 *
 * Deliberately free of drizzle/db imports. The server turns a plan into SQL
 * and the client renders the same scope list the server enforces, so the two
 * cannot drift; the matching rules themselves stay unit-testable.
 */

/**
 * Scopes offered in the UI. `all` is the default; the narrower scopes exist
 * because a bare part number ("2N2222") is also a plausible substring of an
 * order number or a title, and an operator hunting a specific article wants
 * the noise gone.
 */
export const ORDER_SEARCH_FIELDS = [
  { value: "all", label: "Everything" },
  { value: "order", label: "Order number" },
  { value: "part", label: "Part no / SKU / EAN" },
  { value: "title", label: "Item title" },
  { value: "buyer", label: "Buyer" },
  { value: "address", label: "Address" },
  { value: "tracking", label: "Tracking number" },
] as const;

export type OrderSearchField = (typeof ORDER_SEARCH_FIELDS)[number]["value"];

const FIELD_VALUES: readonly string[] = ORDER_SEARCH_FIELDS.map((f) => f.value);

export function isOrderSearchField(value: unknown): value is OrderSearchField {
  return typeof value === "string" && FIELD_VALUES.includes(value);
}

/**
 * Escape the characters Postgres LIKE treats as wildcards. Part numbers really
 * do contain underscores (SMD_0805), and an unescaped `_` silently matches any
 * character — a widening the operator never asked for.
 *
 * Backslash is Postgres' default LIKE escape character, so no ESCAPE clause is
 * needed. The value is always bound as a parameter, never interpolated, so
 * standard_conforming_strings does not come into it.
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Strip everything that isn't alphanumeric. Identifiers get typed with
 * inconsistent separators — an eBay order number is stored `12-34567-89012`
 * but pasted from an email as `1234567 89012`, and a TME symbol is read off a
 * reel as `NE 555 P` — so identifier columns are matched a second time with
 * both sides compacted.
 *
 * MUST stay in lockstep with the `regexp_replace(col, '[^A-Za-z0-9]', '', 'g')`
 * the server applies to the column, or the two sides compact differently and
 * the fallback silently stops matching.
 */
export function compactIdentifier(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, "");
}

export interface OrderSearchPlan {
  field: OrderSearchField;
  /** LIKE pattern for the term as typed. */
  pattern: string;
  /**
   * LIKE pattern for the separator-stripped term, applied only to identifier
   * columns. Null when compacting changes nothing, so the common case costs
   * no extra predicates.
   */
  compactPattern: string | null;
}

/** Null for a blank or wildcard-only term — callers must not filter at all. */
export function planOrderSearch(raw: string | undefined | null, field?: unknown): OrderSearchPlan | null {
  const term = (raw ?? "").trim().replace(/\s+/g, " ");
  if (!term) return null;

  const compact = compactIdentifier(term);
  return {
    field: isOrderSearchField(field) ? field : "all",
    pattern: `%${escapeLike(term)}%`,
    compactPattern: compact && compact !== term ? `%${compact}%` : null,
  };
}

/** Does this plan's scope cover the given column group? */
export function searchesGroup(plan: OrderSearchPlan, group: OrderSearchField): boolean {
  return plan.field === "all" || plan.field === group;
}

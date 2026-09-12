import { describe, it, expect } from "vitest";
import {
  ORDER_SEARCH_FIELDS,
  compactIdentifier,
  escapeLike,
  isOrderSearchField,
  planOrderSearch,
  searchesGroup,
} from "@shared/order-search";

describe("escapeLike", () => {
  it("escapes the LIKE wildcards so a part number matches literally", () => {
    // SMD_0805 must not match SMDX0805.
    expect(escapeLike("SMD_0805")).toBe("SMD\\_0805");
    expect(escapeLike("50%")).toBe("50\\%");
    expect(escapeLike("a\\b")).toBe("a\\\\b");
  });

  it("leaves ordinary part numbers untouched", () => {
    expect(escapeLike("NE555P")).toBe("NE555P");
    expect(escapeLike("CRCW0805-10K")).toBe("CRCW0805-10K");
  });
});

describe("compactIdentifier", () => {
  it("strips every separator people type inconsistently", () => {
    expect(compactIdentifier("12-34567-89012")).toBe("123456789012");
    expect(compactIdentifier("NE 555 P")).toBe("NE555P");
    expect(compactIdentifier("SMD_0805")).toBe("SMD0805");
    expect(compactIdentifier("RR.123/456")).toBe("RR123456");
  });

  it("matches the character class the SQL side uses", () => {
    // regexp_replace(col, '[^A-Za-z0-9]', '', 'g') — same set, both sides.
    expect(compactIdentifier("Ä-1")).toBe("1");
  });
});

describe("planOrderSearch", () => {
  it("returns null for nothing to search on", () => {
    expect(planOrderSearch("")).toBeNull();
    expect(planOrderSearch("   ")).toBeNull();
    expect(planOrderSearch(undefined)).toBeNull();
    expect(planOrderSearch(null)).toBeNull();
  });

  it("wraps the term in wildcards for a substring match", () => {
    expect(planOrderSearch("NE555")?.pattern).toBe("%NE555%");
  });

  it("trims and collapses whitespace before building the pattern", () => {
    expect(planOrderSearch("  NE   555  ")?.pattern).toBe("%NE 555%");
  });

  it("adds a compacted pattern only when separators are present", () => {
    expect(planOrderSearch("NE555P")?.compactPattern).toBeNull();
    expect(planOrderSearch("12-34567-89012")?.compactPattern).toBe("%123456789012%");
    expect(planOrderSearch("NE 555 P")?.compactPattern).toBe("%NE555P%");
  });

  it("never leaves a wildcard in the compacted pattern", () => {
    // compactIdentifier strips % and _ along with everything non-alphanumeric,
    // so the compact pattern is safe without a second escape pass.
    expect(planOrderSearch("50%_off")?.compactPattern).toBe("%50off%");
  });

  it("degrades a wildcard-only term to no search rather than matching all rows", () => {
    const plan = planOrderSearch("%");
    expect(plan?.pattern).toBe("%\\%%");
    expect(plan?.compactPattern).toBeNull();
  });

  it("defaults an unknown or missing scope to everything", () => {
    expect(planOrderSearch("x")?.field).toBe("all");
    expect(planOrderSearch("x", "nonsense")?.field).toBe("all");
    expect(planOrderSearch("x", 7)?.field).toBe("all");
    expect(planOrderSearch("x", "part")?.field).toBe("part");
  });
});

describe("isOrderSearchField", () => {
  it("accepts every advertised scope and nothing else", () => {
    for (const f of ORDER_SEARCH_FIELDS) expect(isOrderSearchField(f.value)).toBe(true);
    expect(isOrderSearchField("sku")).toBe(false);
    expect(isOrderSearchField(null)).toBe(false);
  });
});

describe("searchesGroup", () => {
  it("lets the catch-all scope through to every group", () => {
    const plan = planOrderSearch("x", "all")!;
    for (const f of ORDER_SEARCH_FIELDS) expect(searchesGroup(plan, f.value)).toBe(true);
  });

  it("confines a narrowed scope to its own group", () => {
    const plan = planOrderSearch("x", "part")!;
    expect(searchesGroup(plan, "part")).toBe(true);
    expect(searchesGroup(plan, "title")).toBe(false);
    expect(searchesGroup(plan, "buyer")).toBe(false);
  });
});

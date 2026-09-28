import { describe, it, expect } from "vitest";
import { flattenCategoryTree, readCategoryTree } from "@shared/tme-category-tree";

/** The shape TME actually returns: one root object whose SubTree nests. */
const RESPONSE = {
  Status: "OK",
  Data: {
    CategoryTree: {
      Id: 111000,
      Name: "TME",
      TotalProducts: 500000,
      SubTree: [
        {
          Id: 100123,
          Name: "Passive components",
          TotalProducts: 191026,
          SubTree: [
            { Id: 100124, Name: "Resistors", TotalProducts: 91000, SubTree: [] },
            { Id: 100125, Name: "Capacitors", TotalProducts: 100026 },
          ],
        },
        { Id: 100200, Name: "Fuses", TotalProducts: 53104 },
      ],
    },
  },
};

describe("flattenCategoryTree", () => {
  it("flattens the tree and records each node's parent", () => {
    const flat = flattenCategoryTree(RESPONSE.Data.CategoryTree);
    expect(flat.map((c) => c.CategoryId)).toEqual([
      "111000",
      "100123",
      "100124",
      "100125",
      "100200",
    ]);
    expect(flat.find((c) => c.CategoryId === "100124")?.ParentId).toBe("100123");
    expect(flat.find((c) => c.CategoryId === "111000")?.ParentId).toBeNull();
  });

  it("carries TotalProducts across, which is inclusive of children", () => {
    const flat = flattenCategoryTree(RESPONSE.Data.CategoryTree);
    expect(flat.find((c) => c.CategoryId === "100123")?.ProductCount).toBe(191026);
    expect(flat.find((c) => c.CategoryId === "100200")?.ProductCount).toBe(53104);
  });

  it("keeps the grandparent when a node in between has no id", () => {
    const flat = flattenCategoryTree({
      Id: 1,
      Name: "Root",
      SubTree: [{ Name: "unnamed group", SubTree: [{ Id: 3, Name: "Leaf" }] }],
    });
    expect(flat.find((c) => c.CategoryId === "3")?.ParentId).toBe("1");
  });

  it("does not throw on junk", () => {
    expect(flattenCategoryTree(null)).toEqual([]);
    expect(flattenCategoryTree("nonsense")).toEqual([]);
    expect(flattenCategoryTree({ SubTree: "not an array" })).toEqual([]);
  });
});

describe("readCategoryTree", () => {
  it("reads a real response", () => {
    const r = readCategoryTree(RESPONSE);
    expect(r.error).toBeNull();
    expect(r.categories).toHaveLength(5);
  });

  it("reports a missing tree instead of inventing one", () => {
    const r = readCategoryTree({ Status: "E_TOKEN_WRONG", Data: {} });
    expect(r.categories).toEqual([]);
    expect(r.error).toMatch(/no CategoryTree/i);
  });

  it("reports an empty tree", () => {
    const r = readCategoryTree({ Data: { CategoryTree: { SubTree: [] } } });
    expect(r.categories).toEqual([]);
    expect(r.error).toMatch(/no categories/i);
  });

  it("survives a null response rather than throwing into a fallback", () => {
    expect(readCategoryTree(null).error).toMatch(/no CategoryTree/i);
    expect(readCategoryTree(undefined).categories).toEqual([]);
  });
});

/**
 * Reading TME's category tree.
 *
 * Kept pure and out of the API client so it can be tested without
 * credentials, a database or a network — and because the decision it encodes
 * matters more than the parsing: whether the response IS a category tree.
 * The client used to answer that question by falling back to a hardcoded list
 * of invented categories whenever anything went wrong, unlabelled, which made
 * a dead API look like a working one full of empty categories.
 */

export interface TmeCategoryNode {
  CategoryId: string;
  Name: string;
  ParentId: string | null;
  ProductCount: number;
}

/** TME nests the tree as a root object with a SubTree array of the same shape. */
export function flattenCategoryTree(node: any, parentId: string | null = null): TmeCategoryNode[] {
  const categories: TmeCategoryNode[] = [];
  if (!node || typeof node !== "object") return categories;

  if (node.Id && node.Name) {
    categories.push({
      CategoryId: String(node.Id),
      Name: String(node.Name),
      ParentId: parentId,
      // TotalProducts is INCLUSIVE of children, which is why only leaves are
      // counted when sizing a sweep.
      ProductCount: Number(node.TotalProducts) || 0,
    });
  }

  if (Array.isArray(node.SubTree)) {
    for (const child of node.SubTree) {
      categories.push(...flattenCategoryTree(child, node.Id ? String(node.Id) : parentId));
    }
  }
  return categories;
}

/**
 * The categories in a GetCategories response, or the reason there are none.
 * Never invents anything: an empty result with a reason is the honest answer.
 */
export function readCategoryTree(response: any): {
  categories: TmeCategoryNode[];
  error: string | null;
} {
  const tree = response?.Data?.CategoryTree;
  if (!tree) {
    return { categories: [], error: "TME returned no CategoryTree" };
  }
  const categories = flattenCategoryTree(tree);
  if (categories.length === 0) {
    return { categories: [], error: "TME returned a category tree with no categories in it" };
  }
  return { categories, error: null };
}

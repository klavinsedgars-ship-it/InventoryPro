import type { Express } from "express";
import { storage } from "../storage";
import { requireAuth, requireRealAuth } from "../middleware/auth";
import { insertProductSchema } from "@shared/schema";
import { ZodError } from "zod";

/**
 * Record a product deletion in sync_logs. Deletions previously left no trace
 * beyond a console.log, so a catalogue that shrank was impossible to explain
 * after the fact. Best-effort: an audit failure must not fail the delete.
 */
async function logDeletion(
  req: any,
  kind: "delete_all" | "bulk_delete",
  deletedCount: number,
  scope: string,
): Promise<void> {
  try {
    await storage.createSyncLog({
      source: "system",
      operation: `products_${kind}`,
      status: "success",
      message: `${deletedCount} product(s) deleted (${scope}) by user ${req.session?.userId ?? "unknown"} from ${req.ip ?? "unknown ip"}`,
      details: JSON.stringify({
        deletedCount,
        scope,
        userId: req.session?.userId ?? null,
        ip: req.ip ?? null,
        userAgent: req.headers?.["user-agent"] ?? null,
        at: new Date().toISOString(),
      }),
    });
  } catch (e) {
    console.error("Failed to write deletion audit log:", e);
  }
}

// Product CRUD + paged listing + bulk delete. Extracted from routes.ts
// (behaviour unchanged).
export function registerProductRoutes(app: Express): void {
  app.get("/api/products/paged", requireAuth, async (req, res) => {
    try {
      const q = req.query;
      const limit = Math.min(1000, Math.max(1, Number(q.limit) || 250));
      const offset = Math.max(0, Number(q.offset) || 0);
      const sortField = q.sortField === "price" || q.sortField === "stock" ? q.sortField : null;
      const result = await storage.getProductsPaged({
        search: (q.search as string) || undefined,
        category: (q.category as string) || undefined,
        status: (q.status as string) || undefined,
        priceMin: q.priceMin != null && q.priceMin !== "" ? Number(q.priceMin) : undefined,
        priceMax: q.priceMax != null && q.priceMax !== "" ? Number(q.priceMax) : undefined,
        stock: (q.stock as string) || undefined,
        marketplace: (q.marketplace as string) || undefined,
        moq: (q.moq as string) || undefined,
        supplier: (q.supplier as string) || undefined,
        sortField,
        sortDir: q.sortDir === "asc" ? "asc" : "desc",
        limit,
        offset,
      });
      res.json({ products: result.rows, total: result.total, limit, offset });
    } catch (error) {
      console.error("Paged products fetch failed:", error);
      res.status(500).json({ message: "Failed to fetch products" });
    }
  });

  // Product routes
  app.get("/api/products", requireAuth, async (req, res) => {
    try {
      const filters = {
        category: req.query.category as string,
        status: req.query.status as string,
        listedOnEbay: req.query.listedOnEbay ? req.query.listedOnEbay === 'true' : undefined,
        listedOnAmazon: req.query.listedOnAmazon ? req.query.listedOnAmazon === 'true' : undefined,
        minStock: req.query.minStock ? parseInt(req.query.minStock as string) : undefined,
        maxStock: req.query.maxStock ? parseInt(req.query.maxStock as string) : undefined,
      };

      // Remove undefined values
      const cleanFilters = Object.fromEntries(
        Object.entries(filters).filter(([_, value]) => value !== undefined)
      );

      const products = await storage.getProductsWithFilters(cleanFilters);
      res.json(products);
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

      // Check if SKU already exists
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

      // Convert number fields to strings for decimal database fields
      const requestBody = { ...req.body };
      const decimalFields = ['weight', 'supplierPrice', 'salePrice', 'calculatedPrice', 'marginPercentage', 'margin'];

      decimalFields.forEach(field => {
        if (requestBody[field] !== undefined && typeof requestBody[field] === 'number') {
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

  // Bulk delete by ids (single query — avoids fanning out N parallel requests
  // that saturate the DB connection pool on large selections).
  app.post("/api/products/bulk-delete", requireRealAuth, async (req, res) => {
    try {
      const ids = Array.isArray(req.body?.ids) ? req.body.ids : null;
      if (!ids) {
        return res.status(400).json({ message: "Body must include an 'ids' array" });
      }
      const numericIds = ids
        .map((v: unknown) => (typeof v === "number" ? v : parseInt(String(v), 10)))
        .filter((n: number) => Number.isInteger(n));
      const deletedCount = await storage.deleteProducts(numericIds);
      await logDeletion(req, "bulk_delete", deletedCount, `${numericIds.length} requested`);
      res.json({
        success: true,
        deletedCount,
        requestedCount: numericIds.length,
        message: `Successfully deleted ${deletedCount} products`,
      });
    } catch (error) {
      console.error("Failed to bulk delete products:", error);
      res.status(500).json({ message: "Failed to delete selected products" });
    }
  });

  // Delete all products endpoint. requireRealAuth (not requireAuth): wiping the
  // entire catalogue must never be reachable through BYPASS_AUTH.
  app.delete("/api/products", requireRealAuth, async (req, res) => {
    try {
      const deletedCount = await storage.deleteAllProducts();
      console.log(`Deleted all products: ${deletedCount} items removed`);
      await logDeletion(req, "delete_all", deletedCount, "entire catalogue");
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
}

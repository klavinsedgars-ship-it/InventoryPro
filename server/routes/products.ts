import type { Express } from "express";
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { requireAuth, requireRealAuth } from "../middleware/auth";
import { insertProductSchema, products } from "@shared/schema";
import { ZodError } from "zod";

/**
 * Record a product deletion in sync_logs. Deletions previously left no trace
 * beyond a console.log, so a catalogue that shrank was impossible to explain
 * after the fact. Best-effort: an audit failure must not fail the delete.
 */
async function logDeletion(
  req: any,
  kind: "delete_all" | "bulk_delete" | "purge_supplier",
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

  /**
   * Remove one supplier's promoted products and un-stamp their staging rows,
   * so that supplier can be promoted again from scratch.
   *
   * Two things make this its own endpoint rather than a filtered bulk-delete:
   *
   *  - **Deleting a product does NOT release its supplier_offers row.** The
   *    offer keeps `promoted_product_id`, promotion skips it as
   *    `alreadyPromoted`, and the catalogue can never be re-promoted. Anyone
   *    who "starts again" by selecting rows in the UI and hitting delete gets
   *    a staging table that refuses to work and no clue why.
   *  - **A product that is LIVE on eBay must not be deleted quietly.** The
   *    listing stays up, a buyer can still order it, and nothing here knows
   *    what it is any more. Those are refused unless explicitly forced.
   *
   * Defaults to a dry run; `confirm: true` performs it.
   */
  app.post("/api/products/purge-supplier", requireRealAuth, async (req, res) => {
    try {
      const supplier = String(req.body?.supplier ?? req.query.supplier ?? "").trim();
      if (!supplier) {
        return res.status(400).json({ message: "Pass a supplier, e.g. { \"supplier\": \"ACC\" }" });
      }
      const confirm = req.body?.confirm === true || req.query.confirm === "1";
      const force = req.body?.force === true || req.query.force === "1";

      const rows = await db
        .select({
          id: products.id,
          sku: products.sku,
          listedOnEbay: products.listedOnEbay,
          listedOnAmazon: products.listedOnAmazon,
        })
        .from(products)
        .where(eq(products.supplier, supplier));

      const live = rows.filter((r) => r.listedOnEbay === true || r.listedOnAmazon === true);

      // Staging rows stamped as promoted whose product no longer exists.
      // This is the state left behind by deleting products from the Products
      // page: the offers still say "In Products #152709", promotion skips
      // them as alreadyPromoted, and the catalogue is unusable until the
      // stamps are cleared. It is the whole reason releasing is separate from
      // deleting, and why this endpoint is worth running with nothing to
      // delete at all.
      const staleQ: any = await db.execute(sql`
        SELECT count(*) FILTER (WHERE promoted_product_id IS NOT NULL)::int AS stamped,
               count(*) FILTER (
                 WHERE promoted_product_id IS NOT NULL
                   AND NOT EXISTS (SELECT 1 FROM products p WHERE p.id = supplier_offers.promoted_product_id)
               )::int AS stale
          FROM supplier_offers
         WHERE supplier = ${supplier}
      `);
      const stampRow = (staleQ.rows ?? staleQ)?.[0] ?? {};

      const summary = {
        supplier,
        total: rows.length,
        liveOnMarketplace: live.length,
        liveSample: live.slice(0, 10).map((r) => r.sku),
        stampedOffers: stampRow.stamped ?? 0,
        staleStamps: stampRow.stale ?? 0,
      };

      if (!confirm) {
        const wouldDelete = force ? rows.length : rows.length - live.length;
        const wouldRelease = (summary.staleStamps ?? 0) + wouldDelete;
        const parts: string[] = [];
        if (wouldDelete > 0) parts.push(`${wouldDelete} product(s) would be deleted`);
        if (summary.staleStamps > 0) {
          parts.push(`${summary.staleStamps} catalogue row(s) are already stamped for products that no longer exist and would be released`);
        }
        if (parts.length === 0) parts.push("there is nothing to do");
        if (live.length && !force) {
          parts.push(`${live.length} are live on a marketplace and would be SKIPPED (force:true deletes them anyway, leaving their listings up as orphans)`);
        }
        return res.json({
          ...summary,
          dryRun: true,
          wouldDelete,
          wouldRelease,
          message: `${parts.join("; ")}.`,
        });
      }

      const target = force ? rows : rows.filter((r) => !live.includes(r));
      const ids = target.map((r) => r.id);
      const deletedCount = await storage.deleteProducts(ids);

      // The whole point: release the staging rows so the catalogue can be
      // promoted again. Scoped by supplier, and only rows whose product is
      // actually gone.
      const released: any = await db.execute(sql`
        UPDATE supplier_offers
           SET promoted_product_id = NULL, promoted_at = NULL
         WHERE supplier = ${supplier}
           AND promoted_product_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM products p WHERE p.id = supplier_offers.promoted_product_id)
      `);

      await logDeletion(req, "purge_supplier", deletedCount, `supplier=${supplier}${force ? " (forced over live listings)" : ""}`);
      res.json({
        ...summary,
        dryRun: false,
        deletedCount,
        skippedLive: force ? 0 : live.length,
        offersReleased: released.rowCount ?? null,
        message:
          `Deleted ${deletedCount} ${supplier} product(s); released ${released.rowCount ?? 0} catalogue row(s) for re-promotion.` +
          (force ? "" : live.length ? ` ${live.length} left alone because they are live on a marketplace.` : ""),
      });
    } catch (error) {
      console.error("Failed to purge supplier products:", error);
      res.status(500).json({ message: (error as Error).message });
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

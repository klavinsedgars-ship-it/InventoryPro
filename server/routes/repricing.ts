import type { Express } from "express";
import { storage } from "../storage";
import { requireAuth } from "../middleware/auth";

// Competitor repricing + Opportunity Finder routes (SHADOW analytics).
// First per-domain router extracted from the routes.ts monolith. Behaviour
// is identical — the handler bodies are unchanged.
export function registerRepricingRoutes(app: Express): void {
  // ===== Competitor repricing — SHADOW analytics =====
  // Read-only feature: queries eBay Browse for cheapest live listings per
  // SKU, computes signal/recommendation, stores append-only snapshots.
  // NOTHING here ever modifies a product's salePrice or pushes to eBay.

  // Latest snapshot per product, with signal/sku filters + pagination.
  app.get("/api/repricing/snapshots", requireAuth, async (req, res) => {
    try {
      const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
      const offset = Math.max(0, Number(req.query.offset) || 0);
      const result = await storage.getLatestCompetitorSnapshots({
        signal: (req.query.signal as string) || undefined,
        sku: (req.query.sku as string) || undefined,
        limit,
        offset,
      });
      res.json({ success: true, ...result });
    } catch (error) {
      console.error("Repricing snapshots fetch failed:", error);
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  // Summary rollup for the analytics page header.
  app.get("/api/repricing/stats", requireAuth, async (_req, res) => {
    try {
      const stats = await storage.getCompetitorRepricingStats();
      res.json({ success: true, stats });
    } catch (error) {
      console.error("Repricing stats fetch failed:", error);
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  // Manual refresh — checks competitors for the listed-on-eBay SKUs and writes
  // a new snapshot row per SKU. SHADOW: no listing/price is modified.
  // Bounded by the same 270s budget as the sync cron; remaining SKUs roll
  // over to the next manual run (the UI shows the rolling latest-per-product).
  app.post("/api/repricing/refresh", requireAuth, async (req, res) => {
    try {
      if (!(await import("../ebay-oauth")).ebayOAuth.isOAuthConfigured()) {
        return res.status(412).json({ success: false, error: "eBay OAuth not configured" });
      }
      // Selection: explicit productIds beat the default. Default = all listed
      // SKUs (the only ones where competitor pricing matters today).
      const explicitIds = Array.isArray(req.body?.productIds) ? (req.body.productIds as number[]) : null;
      const maxN = Math.min(500, Math.max(1, Number(req.body?.limit) || 200));
      const products = explicitIds && explicitIds.length > 0
        ? (await Promise.all(explicitIds.map((id) => storage.getProduct(id)))).filter(
            (p): p is NonNullable<typeof p> => !!p,
          )
        : await storage.getListedProductsForRepricing(maxN);

      if (products.length === 0) {
        return res.json({ success: true, checked: 0, ok: 0, failed: 0, message: "No listed products to check" });
      }

      const { checkProducts } = await import("../repricing-service");
      const result = await checkProducts(products, { budgetMs: 270_000, concurrency: 4 });
      res.json({
        success: true,
        checked: result.checked,
        ok: result.ok,
        failed: result.failed,
        // Don't ship the full per-product result set back over HTTP — the UI
        // re-fetches /snapshots to render the table.
      });
    } catch (error) {
      console.error("Repricing refresh failed:", error);
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  // Per-product snapshot history (for the future drill-down chart).
  app.get("/api/repricing/history/:productId", requireAuth, async (req, res) => {
    try {
      const productId = Number(req.params.productId);
      if (!Number.isFinite(productId)) {
        return res.status(400).json({ success: false, error: "invalid productId" });
      }
      const rows = await storage.getCompetitorSnapshotHistory(productId, 100);
      res.json({ success: true, rows });
    } catch (error) {
      console.error("Repricing history fetch failed:", error);
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  // ===== Opportunity Finder =====
  // Ranks the catalogue by intrinsic listing value (margin × availability ×
  // shippability), enriched with eBay Browse demand where checked. Read-only;
  // listing nothing — purely "which products are worth listing".

  // Ranked candidates (whole catalogue, DB-side score), with filters.
  app.get("/api/opportunities", requireAuth, async (req, res) => {
    try {
      const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
      const offset = Math.max(0, Number(req.query.offset) || 0);
      const result = await storage.getOpportunityCandidates({
        category: (req.query.category as string) || undefined,
        minMargin: req.query.minMargin != null ? Number(req.query.minMargin) : undefined,
        hideListed: req.query.hideListed === "true",
        limit,
        offset,
      });
      res.json({ success: true, ...result });
    } catch (error) {
      console.error("Opportunities fetch failed:", error);
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  // Distinct TME categories for the filter dropdown.
  app.get("/api/opportunities/categories", requireAuth, async (_req, res) => {
    try {
      const categories = await storage.getProductCategories();
      res.json({ success: true, categories });
    } catch (error) {
      console.error("Opportunity categories fetch failed:", error);
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  // Bounded sold-through check via eBay Marketplace Insights (the gated
  // buy.marketplace.insights API). SHADOW — writes demand_snapshots only.
  // Surfaces a specific "needs eBay approval" signal when the app isn't
  // allow-listed, so the UI can show a real call-to-action.
  app.post("/api/opportunities/check-insights", requireAuth, async (req, res) => {
    try {
      if (!(await import("../ebay-oauth")).ebayOAuth.isOAuthConfigured()) {
        return res.status(412).json({ success: false, error: "eBay OAuth not configured" });
      }
      const n = Math.min(200, Math.max(1, Number(req.body?.limit) || 50));
      const windowDays = Math.min(90, Math.max(1, Number(req.body?.windowDays) || 30));
      const targets = await storage.getDemandCheckTargets(n);
      if (targets.length === 0) {
        return res.json({ success: true, checked: 0, ok: 0, failed: 0, message: "No unchecked candidates" });
      }
      const { checkProductsDemand } = await import("../demand-service");
      const result = await checkProductsDemand(targets, { budgetMs: 270_000, concurrency: 3, windowDays });
      res.json({
        success: true,
        checked: result.checked,
        ok: result.ok,
        failed: result.failed,
        notApproved: result.notApproved,
        windowDays,
      });
    } catch (error) {
      console.error("Insights check failed:", error);
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  // Probe whether Insights is approved without checking many candidates.
  // Used by the UI to surface the approval gate up-front instead of after
  // the user clicks "Check sold-through".
  app.get("/api/opportunities/insights-status", requireAuth, async (_req, res) => {
    try {
      const hasIssue = await storage.hasInsightsApprovalIssue();
      res.json({ success: true, notApproved: hasIssue });
    } catch (error) {
      console.error("Insights status check failed:", error);
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  // Bounded demand enrichment: run eBay Browse on the top-N best-scoring
  // candidates that haven't been checked recently, persisting competitor
  // count + market price into competitor_snapshots. SHADOW — lists nothing.
  app.post("/api/opportunities/check-demand", requireAuth, async (req, res) => {
    try {
      if (!(await import("../ebay-oauth")).ebayOAuth.isOAuthConfigured()) {
        return res.status(412).json({ success: false, error: "eBay OAuth not configured" });
      }
      const n = Math.min(300, Math.max(1, Number(req.body?.limit) || 100));
      const targets = await storage.getOpportunityCheckTargets(n);
      if (targets.length === 0) {
        return res.json({ success: true, checked: 0, ok: 0, failed: 0, message: "No unchecked candidates" });
      }
      const { checkProducts } = await import("../repricing-service");
      const result = await checkProducts(targets, { budgetMs: 270_000, concurrency: 4 });
      res.json({ success: true, checked: result.checked, ok: result.ok, failed: result.failed });
    } catch (error) {
      console.error("Opportunity demand check failed:", error);
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });
}

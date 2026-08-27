import type { Express } from "express";
import { requireAuth } from "../middleware/auth";
import { storage } from "../storage";
import {
  summarizeSku, rankCategories, lossMakers, profitOf,
  type SkuSalesRow, type CategorySalesRow,
} from "../sales-analytics-core";

/**
 * Sales performance from our OWN order history.
 *
 * eBay's Terapeak-equivalent (Marketplace Insights) is gated behind an
 * approval we do not have, but the more decision-relevant data is already
 * here: what actually sold, at our prices, on our marketplace, against a
 * catalogue we can see. Read-only; nothing here lists or reprices anything.
 */
export function registerAnalyticsRoutes(app: Express) {
  app.get("/api/analytics/sales", requireAuth, async (req, res) => {
    try {
      const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
      const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));

      const [skuRows, catRows, totals] = await Promise.all([
        storage.getSkuSales(days, limit),
        storage.getCategorySales(days, 50),
        storage.getSalesTotals(days),
      ]);

      const skus = skuRows.map((r: any) =>
        summarizeSku(
          {
            sku: r.sku,
            title: r.title ?? r.sku,
            category: r.category ?? null,
            units: Number(r.units) || 0,
            revenue: Number(r.revenue) || 0,
            cost: Number(r.cost) || 0,
            orders: Number(r.orders) || 0,
            firstSold: r.first_sold ? new Date(r.first_sold).toISOString() : null,
            lastSold: r.last_sold ? new Date(r.last_sold).toISOString() : null,
          } as SkuSalesRow,
          days,
        ),
      );

      const categories = rankCategories(
        catRows.map((r: any) => ({
          category: r.category,
          units: Number(r.units) || 0,
          revenue: Number(r.revenue) || 0,
          cost: Number(r.cost) || 0,
          orders: Number(r.orders) || 0,
          distinctSkus: Number(r.distinct_skus) || 0,
          productsInCatalogue: Number(r.products_in_catalogue) || 0,
          productsListed: Number(r.products_listed) || 0,
          productsListable: Number(r.products_listable) || 0,
        }) as CategorySalesRow),
        days,
      );

      const { profit, marginPct } = profitOf(totals.revenue, totals.cost);

      res.json({
        success: true,
        days,
        totals: {
          ...totals,
          profit,
          marginPct,
          // Absent on older rows; without it "profit" is understated rather
          // than wrong, and the page should say so instead of implying zero.
          costCoverage: totals.revenue > 0 && totals.cost === 0 ? "missing" : "ok",
        },
        topSkus: skus,
        categories,
        lossMakers: lossMakers(skus).slice(0, 25),
      });
    } catch (error) {
      console.error("Sales analytics failed:", error);
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });
}

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
  /**
   * eBay Marketplace Account Deletion endpoint.
   *
   * NO AUTH: eBay calls this unauthenticated, and it is a prerequisite for
   * both production status and the Application Growth Check. GET proves we own
   * the URL; POST acknowledges a closure notification.
   *
   * We hold no personal data of eBay users beyond order records eBay itself
   * supplies, so acknowledging is the correct response; the notification is
   * logged so a deletion request is auditable.
   */
  const deletionHandler = async (req: any, res: any) => {
    const { challengeResponse, validateVerificationToken, deletionEndpointUrl } =
      await import("../ebay-account-deletion");
    const token = process.env.EBAY_DELETION_VERIFICATION_TOKEN;
    const check = validateVerificationToken(token);

    const challenge = req.query?.challenge_code;
    if (challenge) {
      if (!check.ok) {
        // 500, not 200: a wrong answer here would look verified to us and
        // fail silently at eBay's end.
        return res.status(500).json({ error: check.error });
      }
      const endpoint = deletionEndpointUrl(req.headers?.host);
      if (!endpoint) {
        return res.status(500).json({ error: "Set EBAY_DELETION_ENDPOINT_URL to the URL registered with eBay" });
      }
      return res
        .status(200)
        .json({ challengeResponse: challengeResponse(String(challenge), token!, endpoint) });
    }

    if (req.method === "POST") {
      try {
        const username = req.body?.notification?.data?.username ?? "(unknown)";
        await storage.createSyncLog({
          source: "ebay",
          operation: "account_deletion",
          status: "success",
          message: `eBay account closure notification received for ${username}`,
          details: JSON.stringify(req.body ?? {}).slice(0, 4000),
        });
      } catch {
        // Never fail the acknowledgement over our own logging: eBay retries
        // and repeatedly failing the endpoint puts production keys at risk.
      }
      return res.status(200).json({ ok: true });
    }

    // A plain GET without a challenge: report readiness, so the endpoint can be
    // checked before registering it with eBay.
    res.status(200).json({
      ok: check.ok,
      ready: check.ok,
      endpoint: deletionEndpointUrl(req.headers?.host),
      error: check.ok ? null : check.error,
    });
  };
  app.get("/api/ebay/account-deletion", deletionHandler);
  app.post("/api/ebay/account-deletion", deletionHandler);

  /**
   * eBay's OWN view of our rate limits and usage.
   *
   * Our stored 2M/day figure is an internal assumption; eBay's default is far
   * lower and varies per API. Guessing here is how an application growth
   * request gets refused for stating a call volume that doesn't match what
   * eBay measured.
   */
  app.get("/api/__ebay-rate-limits", async (_req, res) => {
    try {
      const { ebayOAuth } = await import("../ebay-oauth");
      const token = await ebayOAuth.getValidAccessToken();
      const r = await fetch("https://api.ebay.com/developer/analytics/v1_beta/rate_limit/", {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
      const text = await r.text();
      if (!r.ok) {
        return res.status(200).json({ ok: false, httpStatus: r.status, error: text.slice(0, 500) });
      }
      const data = JSON.parse(text);
      // Flattened: the raw payload nests limits per API per resource and is
      // unreadable when what you need is "which limit am I close to?".
      const rows: any[] = [];
      for (const api of data?.rateLimits ?? []) {
        for (const resource of api?.resources ?? []) {
          for (const rate of resource?.rates ?? []) {
            rows.push({
              api: api.apiName,
              context: api.apiContext,
              version: api.apiVersion,
              resource: resource.name,
              limit: rate.limit,
              remaining: rate.remaining,
              reset: rate.reset,
              timeWindowSec: rate.timeWindow,
            });
          }
        }
      }
      rows.sort((a, b) => (a.remaining ?? 0) / (a.limit || 1) - (b.remaining ?? 0) / (b.limit || 1));
      res.json({ ok: true, count: rows.length, closestToLimit: rows.slice(0, 10), all: rows });
    } catch (error) {
      res.status(500).json({ ok: false, error: (error as Error).message });
    }
  });

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

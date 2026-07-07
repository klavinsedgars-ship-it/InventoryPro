import type { Express } from "express";
import { requireAuth } from "../middleware/auth";
import { storage } from "../storage";
import { ebayInsightsApi } from "../ebay-insights-api";
import { ebayOAuth } from "../ebay-oauth";
import { researchMarket } from "../market-research-service";

/**
 * Market Research routes — the market-first "what's actually selling that I
 * could source?" page. Read-only: powered by eBay Marketplace Insights (the
 * Terapeak sold-items signal) plus a local TME catalogue cross-reference.
 * Nothing here lists or prices anything.
 */
export function registerResearchRoutes(app: Express) {
  // Cheap probe so the page can show the eBay-approval gate up-front (the
  // buy.marketplace.insights scope is allow-listed by eBay). One tiny call.
  app.get("/api/research/status", requireAuth, async (_req, res) => {
    try {
      const probe = await ebayInsightsApi.searchSoldMarket({ q: "laptop", limit: 1, windowDays: 7 });
      res.json({
        success: true,
        approved: probe.ok,
        notApproved: !!probe.notApproved,
        error: probe.ok ? null : probe.error ?? null,
      });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  // Kick off the Insights re-consent flow. Redirects the operator to eBay's
  // consent screen requesting the gated buy.marketplace.insights scope (via
  // EBAY_CONSENT_SCOPES). After approving, eBay redirects to the RuName URL
  // with ?code=... which is exchanged at /api/__ebay-exchange to mint a
  // refresh token that CARRIES the scope. Add ?raw=1 to get the URL as JSON
  // instead of an immediate redirect.
  //
  // NOTE: this only produces a working token once eBay has APPROVED your app
  // for the Marketplace Insights API — consent alone isn't enough.
  app.get("/api/research/insights-connect", requireAuth, (req, res) => {
    const ruName = process.env.EBAY_RUNAME || "";
    if (!ruName) {
      return res.status(400).json({
        success: false,
        error: "EBAY_RUNAME is not set. Set it to your eBay RuName (the OAuth redirect) and retry.",
      });
    }
    const url = ebayOAuth.generateAuthUrl(ruName, "insights_consent");
    if (String((req.query as any)?.raw) === "1") {
      return res.json({ success: true, consentUrl: url, ruName });
    }
    res.redirect(url);
  });

  // Local product categories for the dropdown (same source the Opportunity
  // Finder uses — keeps the two research pages consistent).
  app.get("/api/research/categories", requireAuth, async (_req, res) => {
    try {
      const categories = await storage.getProductCategories();
      res.json({ success: true, categories });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  // Run a market-research query. Body: { q?, category?, windowDays?,
  // minPrice?, minSold?, excludeCn?, euOnly?, tmeMatch? }.
  //
  // `category` is a LOCAL product-category name (from /categories). eBay
  // Insights filters by numeric eBay category IDs, not our names, so we fold
  // the picked category into the keyword query rather than pretend it maps to
  // an eBay category — honest and still narrows results.
  app.post("/api/research/market", requireAuth, async (req, res) => {
    try {
      const b = req.body ?? {};
      const keyword = typeof b.q === "string" ? b.q.trim() : "";
      const category = typeof b.category === "string" && b.category !== "all" ? b.category.trim() : "";
      const q = [keyword, category].filter(Boolean).join(" ");
      if (!q) {
        return res.status(400).json({ success: false, error: "Enter a keyword or pick a category." });
      }
      const result = await researchMarket({
        q,
        windowDays: b.windowDays != null ? Number(b.windowDays) : undefined,
        minPrice: b.minPrice != null ? Number(b.minPrice) : undefined,
        minSold: b.minSold != null ? Number(b.minSold) : undefined,
        excludeCn: b.excludeCn !== false, // default on
        euOnly: b.euOnly === true,
        tmeMatch: b.tmeMatch !== false, // default on
      });
      res.json({ success: result.ok, ...result });
    } catch (error) {
      console.error("Market research failed:", error);
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });
}

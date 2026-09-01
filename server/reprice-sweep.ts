/**
 * Catalogue-wide floor reprice (2026-08-31, after order #14-87824 netted
 * €2.87 against a €4.00 floor).
 *
 * The floor math was right but its INPUTS were optimistic: eBay's actual
 * take on real orders ran ~21% of gross against a modeled 12% + €0.35.
 * Correcting the fee config only affects prices computed AFTER the change,
 * and the hourly sync recomputes a price only when TME's price moves — so a
 * config correction needs one deliberate pass over the catalogue, pushing
 * changed prices to the live listings.
 *
 * Same shape as recategorize-sweep: cron-driven time-bounded slices, DB
 * kill-switch ('ebay'/'reprice_sweep'), lease, resumable via a persisted id
 * cursor ('ebay'/'reprice_cursor'). Products with useCalculatedPrice=false
 * are the operator's manual prices and are never touched.
 */

import { and, asc, eq, gt, sql } from "drizzle-orm";
import { db } from "./db";
import { products, type Product } from "@shared/schema";
import { storage } from "./storage";
import { ebayInventoryApi } from "./ebay-inventory-api";
import {
  calculatePriceWithFloor,
  setActivePricingTiers,
  dbTiersToPricingTiers,
} from "./dynamic-pricing";
import { getFeeConfig } from "./fee-config";
import { calculateEbayStock } from "./stock-manager";

const BATCH = 200;

export interface RepriceStats {
  enabled: boolean;
  done: boolean;
  scanned: number;
  repriced: number;
  pushedToEbay: number;
  pushFailed: number;
  skippedManual: number;
  cursor: number;
  budgetHit: boolean;
  sampleErrors: string[];
}

async function getSetting(name: string): Promise<string | undefined> {
  const rows = await storage.getMarketplaceSettings("ebay");
  return (rows as any[]).find((s) => s.setting === name)?.value;
}

export async function isRepriceEnabled(): Promise<boolean> {
  return (await getSetting("reprice_sweep")) === "on";
}

export async function setRepriceEnabled(on: boolean): Promise<void> {
  await storage.setMarketplaceSetting({ marketplace: "ebay", setting: "reprice_sweep", value: on ? "on" : "off" });
  if (on) {
    // A fresh start always begins at the top of the catalogue.
    await storage.setMarketplaceSetting({ marketplace: "ebay", setting: "reprice_cursor", value: "0" });
  }
}

export async function repriceProgress(): Promise<{ cursor: number; totalTme: number }> {
  const cursor = Number((await getSetting("reprice_cursor")) ?? 0) || 0;
  const q: any = await db.execute(sql`SELECT count(*)::int AS c FROM products WHERE supplier = 'TME'`);
  return { cursor, totalTme: (q.rows ?? q)?.[0]?.c ?? 0 };
}

/** One time-bounded slice; call repeatedly (the cron does) until done. */
export async function runRepriceSweep(budgetMs = 250_000): Promise<RepriceStats> {
  const started = Date.now();
  const stats: RepriceStats = {
    enabled: true,
    done: false,
    scanned: 0,
    repriced: 0,
    pushedToEbay: 0,
    pushFailed: 0,
    skippedManual: 0,
    cursor: 0,
    budgetHit: false,
    sampleErrors: [],
  };

  // Loaded once per slice — module tier state resets per invocation.
  setActivePricingTiers(dbTiersToPricingTiers(await storage.getPricingTiers()));
  const feeConfig = await getFeeConfig("ebay");
  let cursor = Number((await getSetting("reprice_cursor")) ?? 0) || 0;

  for (;;) {
    if (Date.now() - started >= budgetMs) {
      stats.budgetHit = true;
      break;
    }

    const batch = await db
      .select()
      .from(products)
      .where(and(eq(products.supplier, "TME"), gt(products.id, cursor)))
      .orderBy(asc(products.id))
      .limit(BATCH);
    if (batch.length === 0) {
      stats.done = true;
      break;
    }

    const toPush: Array<{ sku: string; offerId: string; quantity: number; price: number }> = [];

    for (const p of batch as Product[]) {
      stats.scanned++;
      const unit = parseFloat(p.supplierPrice);
      if (!Number.isFinite(unit) || unit <= 0) continue;
      if (p.useCalculatedPrice === false) {
        stats.skippedManual++;
        continue;
      }
      let result;
      try {
        result = calculatePriceWithFloor(unit, {
          moq: p.moq || 1,
          multiples: p.multiples || 1,
          weightGrams: p.weight ? parseFloat(p.weight) : null,
          marketplace: "ebay",
          config: feeConfig,
        });
      } catch {
        continue; // a broken tier lookup must not stop the sweep
      }
      const newPrice = result.finalPrice;
      const oldPrice = parseFloat(p.salePrice) || 0;
      if (!Number.isFinite(newPrice) || newPrice <= 0) continue;
      if (Math.abs(newPrice - oldPrice) < 0.01) continue;

      await storage.updateProduct(p.id, {
        salePrice: newPrice.toFixed(2),
        calculatedPrice: result.calculatedPrice.toString(),
        marginTier: result.marginTier,
        marginPercentage: result.marginPercentage.toString(),
        priceUpdatedAt: new Date(),
      });
      stats.repriced++;

      if (p.listedOnEbay && p.ebayOfferId) {
        toPush.push({
          sku: p.sku,
          offerId: p.ebayOfferId,
          quantity: calculateEbayStock(p).ebayStock,
          price: newPrice,
        });
      }
    }

    for (let i = 0; i < toPush.length; i += 25) {
      const r = await ebayInventoryApi.bulkUpdatePriceQuantity(toPush.slice(i, i + 25));
      r.forEach((v) => {
        if (v.ok) stats.pushedToEbay++;
        else {
          stats.pushFailed++;
          if (stats.sampleErrors.length < 3 && v.error) stats.sampleErrors.push(v.error);
        }
      });
    }

    cursor = (batch[batch.length - 1] as Product).id;
    await storage.setMarketplaceSetting({ marketplace: "ebay", setting: "reprice_cursor", value: String(cursor) });
  }

  stats.cursor = cursor;
  return stats;
}

import { storage } from "./storage";

export { LISTING_SUPPLIERS } from "@shared/suppliers";

/**
 * Persisted ramp sale-price band (marketplace_settings ebay/ramp_min_price,
 * ramp_max_price). Stored so every self-chained run and the scheduled cron use
 * the same range. Empty/invalid = no bound.
 *
 * Lifted out of registerRoutes because it's shared across two route domains:
 * the ops handlers (/api/ops/daily, /api/ops/list-ramp/preview) and the cron
 * list-ramp handler. Behaviour is identical to the previous inline closure.
 */
export async function getRampPriceRange(): Promise<{ minPrice?: number; maxPrice?: number }> {
  const settings = await storage.getMarketplaceSettings("ebay");
  const read = (key: string) => {
    const v = settings.find((s) => s.setting === key)?.value;
    if (v == null || v === "" || isNaN(Number(v))) return undefined;
    return Number(v);
  };
  const range: { minPrice?: number; maxPrice?: number } = {};
  const min = read("ramp_min_price");
  const max = read("ramp_max_price");
  if (min !== undefined) range.minPrice = min;
  if (max !== undefined) range.maxPrice = max;
  return range;
}

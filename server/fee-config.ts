/**
 * Resolves the active FeeConfig from persisted marketplaceSettings (falling
 * back to DEFAULT_FEE_CONFIG). Kept separate from the pure fee-model so the
 * math stays DB-free. Call once per sync chunk / request and pass the result
 * down — don't call this per product in a large loop.
 */
import { storage } from "./storage";
import { resolveFeeConfig, type FeeConfig, type Marketplace } from "./fee-model";

export async function getFeeConfig(
  marketplace: Marketplace = "ebay",
): Promise<FeeConfig> {
  let rows: Array<{ setting: string; value: string }> = [];
  try {
    rows = (await storage.getMarketplaceSettings(marketplace)) as Array<{
      setting: string;
      value: string;
    }>;
  } catch {
    rows = [];
  }
  return resolveFeeConfig(marketplace, rows);
}

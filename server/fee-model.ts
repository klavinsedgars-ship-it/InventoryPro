/**
 * Fee-aware net-profit model.
 *
 * The tiered pricing in dynamic-pricing.ts is fee-blind: it applies a markup
 * multiplier to supplier cost and ignores eBay fees, the fixed per-order fee,
 * and VAT. This module computes the *real* net profit of a sale and the
 * minimum sale price needed to hit a target net profit.
 *
 * Economics (eBay DE, buyer pays shipping):
 *  - Buyer pays the weight-band shipping price (shipping-policies.ts). That
 *    money flows to the seller, so shipping mostly washes out — EXCEPT eBay
 *    charges its Final Value Fee on (item + shipping), and the seller's actual
 *    postage cost is the band price minus the packaging markup. The residual
 *    of those two is a real cost the old pricing ignored.
 *  - VAT: the seller is VAT-registered (LV 21%), price is VAT-inclusive, so
 *    output VAT = salePrice * vatPct / (1 + vatPct).
 *
 * Pure module: no DB access. Settings are passed in (resolved from
 * marketplaceSettings by the caller). Only dependency is the shipping bands.
 */
import { getShippingPolicyByWeight } from "./shipping-policies";
import { quotePostage, trackedShippingDefault } from "@shared/latvian-post";

export type Marketplace = "ebay" | "amazon";

export interface FeeConfig {
  marketplace: Marketplace;
  ebayFvfPct: number; // Final Value Fee fraction on (item + shipping), e.g. 0.12
  ebayFixedFee: number; // fixed per-order fee, e.g. 0.35
  amazonReferralPct: number; // Amazon referral fraction, e.g. 0.15
  vatPct: number; // VAT fraction, e.g. 0.21 (LV); price is VAT-inclusive
  packagingCost: number; // flat packaging cost per order, e.g. 0.30
  /**
   * @deprecated Postage cost now comes from the Latvijas Pasts tariff table
   * (shared/latvian-post.ts). Kept so existing saved settings still load.
   */
  postageMarkup: number;
  targetMinNetProfit: number; // floor: every sale must net at least this, e.g. 4.00
}

export interface ProfitBreakdown {
  marketplace: Marketplace;
  salePrice: number;
  buyerShipping: number; // collected from buyer (weight band price)
  shippingBand: string | null;
  grossRevenue: number; // salePrice + buyerShipping
  marketplaceFee: number; // FVF (+ fixed) or Amazon referral
  vatAmount: number;
  supplierCost: number; // package cost (unit price * MOQ)
  actualPostageCost: number; // what the seller pays the carrier (real tariff)
  postageBand?: string;
  postageCountry?: string;
  postageTracked?: boolean;
  packagingCost: number;
  netProfit: number;
  netMarginPct: number; // netProfit / grossRevenue * 100
  meetsTarget: boolean;
  assumptions: string[];
}

// eBay DE defaults. Overridable per-marketplace via marketplaceSettings.
export const DEFAULT_FEE_CONFIG: Record<Marketplace, FeeConfig> = {
  ebay: {
    marketplace: "ebay",
    ebayFvfPct: 0.12,
    ebayFixedFee: 0.35,
    amazonReferralPct: 0.15,
    vatPct: 0.21,
    packagingCost: 0.3,
    postageMarkup: 0.15,
    targetMinNetProfit: 4.0,
  },
  amazon: {
    marketplace: "amazon",
    ebayFvfPct: 0.12,
    ebayFixedFee: 0.35,
    amazonReferralPct: 0.15,
    vatPct: 0.21,
    packagingCost: 0.3,
    postageMarkup: 0.15,
    targetMinNetProfit: 4.0,
  },
};

// The ONLY place that maps marketplaceSettings keys to config fields.
const SETTING_KEYS: Record<string, keyof FeeConfig> = {
  "fee.fvf_pct": "ebayFvfPct",
  "fee.fixed": "ebayFixedFee",
  "fee.amazon_pct": "amazonReferralPct",
  "fee.vat_pct": "vatPct",
  "fee.packaging": "packagingCost",
  "fee.postage_markup": "postageMarkup",
  "fee.target_min_profit": "targetMinNetProfit",
};

/**
 * Merge marketplaceSettings key/value rows over the marketplace defaults.
 * Unknown keys and non-numeric values are ignored.
 */
export function resolveFeeConfig(
  marketplace: Marketplace,
  settingsRows?: Array<{ setting: string; value: string }> | null,
): FeeConfig {
  const config: FeeConfig = { ...DEFAULT_FEE_CONFIG[marketplace] };
  if (settingsRows) {
    for (const row of settingsRows) {
      const field = SETTING_KEYS[row.setting];
      if (!field || field === "marketplace") continue;
      const num = parseFloat(row.value);
      if (!isNaN(num)) {
        (config[field] as number) = num;
      }
    }
  }
  return config;
}

function feeFractionAndFixed(config: FeeConfig): { feePct: number; fixed: number } {
  if (config.marketplace === "amazon") {
    return { feePct: config.amazonReferralPct, fixed: 0 };
  }
  return { feePct: config.ebayFvfPct, fixed: config.ebayFixedFee };
}

export interface NetProfitInput {
  salePrice: number | string;
  packageSupplierCost: number | string; // unit supplier price * MOQ
  weightGrams: number | null | undefined;
  marketplace: Marketplace;
  config: FeeConfig;
  /** Where we'd post it. Defaults to the marketplace's own country. */
  destinationCountry?: string;
  /** Defaults to trackedShippingDefault() — untracked unless opted in. */
  trackedShipping?: boolean;
}

/** The country most parcels go to, from the marketplace we sell on. */
function pricingCountry(explicit?: string): string {
  if (explicit) return explicit.toUpperCase();
  if (process.env.PRICING_POSTAGE_COUNTRY) return process.env.PRICING_POSTAGE_COUNTRY.toUpperCase();
  const bySite: Record<string, string> = {
    "0": "US", "3": "GB", "77": "DE", "71": "FR", "101": "IT", "186": "ES",
    "205": "IE", "23": "BE", "146": "NL", "16": "AU",
  };
  return bySite[process.env.EBAY_MARKETPLACE_SITE_ID || "77"] || "DE";
}

const trackedByDefault = trackedShippingDefault;
const packagingGramsForPricing = () => Number(process.env.PACKAGING_WEIGHT_G) || 40;

/**
 * What the carrier will actually charge us, from the published tariffs.
 *
 * This used to be derived from what the BUYER is charged
 * (bandPrice / 1.15), which inverted cause and effect: the buyer's shipping
 * charge is a pricing decision, not evidence of our cost. Calibrated against
 * the real table, that assumption reproduced Germany's UNTRACKED rate almost
 * exactly — so on tracked post, which eBay effectively requires, every price
 * floor was short by the €2.54 tracking fee.
 */
function realPostageCost(input: { weightGrams: number | null | undefined; destinationCountry?: string; trackedShipping?: boolean }) {
  return quotePostage(
    (input.weightGrams ?? 0) + packagingGramsForPricing(),
    pricingCountry(input.destinationCountry),
    {
      tracked: input.trackedShipping ?? trackedByDefault(),
      mansPastsDiscount: process.env.LATVIAN_POST_MANS_PASTS === "true",
    },
  );
}

/**
 * Full net-profit breakdown for a single sale (one package/listing).
 */
export function calculateNetProfit(input: NetProfitInput): ProfitBreakdown {
  const { marketplace, config } = input;
  const salePrice = toNum(input.salePrice);
  const supplierCost = toNum(input.packageSupplierCost);

  const policy = getShippingPolicyByWeight(input.weightGrams ?? null);
  const buyerShipping = policy ? toNum(policy.price) : 0;

  const grossRevenue = salePrice + buyerShipping;
  const { feePct, fixed } = feeFractionAndFixed(config);
  const marketplaceFee = feePct * grossRevenue + fixed;
  const postage = realPostageCost(input);
  const actualPostageCost = postage.cost;
  const vatAmount = (config.vatPct * salePrice) / (1 + config.vatPct);

  const netProfit =
    grossRevenue -
    marketplaceFee -
    vatAmount -
    supplierCost -
    actualPostageCost -
    config.packagingCost;

  const netMarginPct = grossRevenue > 0 ? (netProfit / grossRevenue) * 100 : 0;

  const assumptions = [
    `VAT ${(config.vatPct * 100).toFixed(0)}% on item price (VAT-inclusive); shipping VAT ~ washes against input VAT on postage.`,
    `Postage €${postage.cost.toFixed(2)}: Latvijas Pasts ${postage.service === "paka" ? "Paka" : "Sīkpaka"}${postage.tracked ? " tracked" : ""}, ${postage.bandLabel} to ${postage.country}${postage.estimated ? " (estimated — no tariff for that country)" : ""}.`,
    marketplace === "amazon"
      ? `Amazon referral ${(config.amazonReferralPct * 100).toFixed(1)}% of item + shipping.`
      : `eBay FVF ${(config.ebayFvfPct * 100).toFixed(1)}% of item + shipping, plus €${config.ebayFixedFee.toFixed(2)} fixed.`,
  ];

  return {
    marketplace,
    salePrice: round2(salePrice),
    buyerShipping: round2(buyerShipping),
    shippingBand: policy?.name ?? null,
    postageBand: postage.bandLabel,
    postageCountry: postage.country,
    postageTracked: postage.tracked,
    grossRevenue: round2(grossRevenue),
    marketplaceFee: round2(marketplaceFee),
    vatAmount: round2(vatAmount),
    supplierCost: round2(supplierCost),
    actualPostageCost: round2(actualPostageCost),
    packagingCost: round2(config.packagingCost),
    netProfit: round2(netProfit),
    netMarginPct: round2(netMarginPct),
    meetsTarget: netProfit >= config.targetMinNetProfit - 0.005,
    assumptions,
  };
}

export interface ProfitFloorInput {
  packageSupplierCost: number | string;
  weightGrams: number | null | undefined;
  marketplace: Marketplace;
  config: FeeConfig;
  destinationCountry?: string;
  trackedShipping?: boolean;
}

/**
 * Inverse of calculateNetProfit: the (un-rounded) sale price at which net
 * profit equals config.targetMinNetProfit, for the given supplier cost and
 * weight band. Callers round this up (.99) and take max(tierPrice, floor).
 *
 * Solving netProfit = target for salePrice:
 *   net = salePrice*(1 - feePct - vatFrac)
 *       + buyerShipping*(1 - feePct)
 *       - fixed - supplierCost - actualPostage - packaging
 *   => salePrice = (target + fixed + supplierCost + actualPostage + packaging
 *                   - buyerShipping*(1 - feePct)) / (1 - feePct - vatFrac)
 */
export function calculateProfitFloorPrice(input: ProfitFloorInput): number {
  const { config } = input;
  const supplierCost = toNum(input.packageSupplierCost);
  const policy = getShippingPolicyByWeight(input.weightGrams ?? null);
  const buyerShipping = policy ? toNum(policy.price) : 0;

  const { feePct, fixed } = feeFractionAndFixed(config);
  const vatFrac = config.vatPct / (1 + config.vatPct);
  const actualPostageCost = realPostageCost(input).cost;

  const denom = 1 - feePct - vatFrac;
  if (denom <= 0) {
    // Fees + VAT swallow the whole price; no finite floor. Caller falls back.
    return Number.POSITIVE_INFINITY;
  }

  const numerator =
    config.targetMinNetProfit +
    fixed +
    supplierCost +
    actualPostageCost +
    config.packagingCost -
    buyerShipping * (1 - feePct);

  const price = numerator / denom;
  return price > 0 ? price : 0;
}

function toNum(v: number | string): number {
  const n = typeof v === "string" ? parseFloat(v) : v;
  return isNaN(n) ? 0 : n;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

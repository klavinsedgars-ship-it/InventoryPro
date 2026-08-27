/**
 * What one order actually earned, step by step.
 *
 * The arithmetic that matters here is the order of operations:
 *
 *  1. The buyer pays a VAT-INCLUSIVE total. That is not revenue.
 *  2. VAT at the DESTINATION rate is collected on behalf of that state and
 *     must come out first. Treating it as income overstates profit by ~16% of
 *     the sale price on a German order.
 *  3. Goods are bought from TME at 0% VAT (intra-EU reverse charge), so there
 *     is no input VAT to reclaim against the output VAT — the full collected
 *     amount is owed. This is the part that surprises people: a domestic
 *     retailer offsets input against output, and we cannot.
 *  4. eBay charges its fee on the buyer's GROSS payment, VAT included, so the
 *     fee is larger than a naive percentage of net revenue.
 *
 * Every step is returned with its own label and explanation so the result can
 * be read as a ledger rather than trusted as a single number.
 *
 * Pure: no storage, no network, no marketplace clients.
 */
import { vatForSale, vatFromGross, type VatDecision } from "./vat-rates";

export interface OrderEconomicsInput {
  /** What the buyer paid for the goods, VAT inclusive. */
  itemsGross: number;
  /** What the buyer paid for postage, VAT inclusive. */
  shippingCharged: number;
  destinationCountry: string | null | undefined;
  /** Supplier cost (net, 0% VAT) for the whole order. */
  supplierCost: number;
  /** Fee eBay actually charged, when the order carries it. */
  actualMarketplaceFee?: number | null;
  actualPaymentFee?: number | null;
  /** What we paid the carrier. */
  postageCost?: number | null;
  packagingCost?: number | null;
}

export interface EconomicsConfig {
  /** Final value fee fraction, e.g. 0.12 — used only when eBay gave us none. */
  feePct: number;
  fixedFee: number;
  packagingCost: number;
  homeCountry?: string;
}

export interface LedgerLine {
  key: string;
  label: string;
  amount: number;
  /** "in" adds, "out" subtracts, "total" is a running result. */
  kind: "in" | "out" | "total";
  note?: string;
  /** False when the figure is modelled rather than taken from the order. */
  actual?: boolean;
}

export interface OrderEconomics {
  vat: VatDecision;
  grossReceived: number;
  vatOwed: number;
  netRevenue: number;
  supplierCost: number;
  marketplaceFee: number;
  paymentFee: number;
  postageCost: number;
  packagingCost: number;
  totalCosts: number;
  netProfit: number;
  /** Profit over NET revenue — the only margin that means anything post-VAT. */
  netMarginPct: number | null;
  /** Profit over the buyer's payment, for comparison with marketplace reports. */
  grossMarginPct: number | null;
  /** True when every input came from the order rather than the fee model. */
  fullyActual: boolean;
  ledger: LedgerLine[];
}

const r2 = (n: number) => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;

export function computeOrderEconomics(
  input: OrderEconomicsInput,
  config: EconomicsConfig,
): OrderEconomics {
  const itemsGross = Math.max(0, input.itemsGross || 0);
  const shippingCharged = Math.max(0, input.shippingCharged || 0);
  const grossReceived = r2(itemsGross + shippingCharged);

  const vat = vatForSale(input.destinationCountry, { homeCountry: config.homeCountry });
  const vatOwed = r2(vatFromGross(grossReceived, vat.ratePct));
  const netRevenue = r2(grossReceived - vatOwed);

  const supplierCost = r2(Math.max(0, input.supplierCost || 0));

  // eBay's own figure when we have it; otherwise the fee model. Which one was
  // used is reported, because a modelled fee is an estimate and a reconciled
  // book should say so.
  const feeIsActual = input.actualMarketplaceFee != null && input.actualMarketplaceFee > 0;
  const marketplaceFee = feeIsActual
    ? r2(input.actualMarketplaceFee!)
    : r2(grossReceived * config.feePct + config.fixedFee);

  const paymentFee = r2(Math.max(0, input.actualPaymentFee ?? 0));
  const postageCost = r2(Math.max(0, input.postageCost ?? 0));
  const packagingCost = r2(input.packagingCost ?? config.packagingCost ?? 0);

  const totalCosts = r2(supplierCost + marketplaceFee + paymentFee + postageCost + packagingCost);
  const netProfit = r2(netRevenue - totalCosts);

  const ledger: LedgerLine[] = [
    {
      key: "items",
      label: "Items (buyer paid)",
      amount: r2(itemsGross),
      kind: "in",
      actual: true,
      note: "VAT-inclusive price the buyer was charged",
    },
    {
      key: "shipping_charged",
      label: "Shipping (buyer paid)",
      amount: shippingCharged,
      kind: "in",
      actual: true,
    },
    { key: "gross", label: "Total received", amount: grossReceived, kind: "total" },
    {
      key: "vat",
      label: `VAT ${vat.ratePct}% (${vat.country})`,
      amount: vatOwed,
      kind: "out",
      actual: false,
      note: `${vat.note}. Extracted from the gross, not added to it. Bought at 0% VAT from TME (reverse charge), so there is no input VAT to offset — the full amount is payable.`,
    },
    { key: "net_revenue", label: "Net revenue (ex-VAT)", amount: netRevenue, kind: "total" },
    {
      key: "cogs",
      label: "Supplier cost (TME, net)",
      amount: supplierCost,
      kind: "out",
      actual: supplierCost > 0,
      note: supplierCost > 0
        ? "Captured at the time of sale, so it does not drift when TME reprices"
        : "No supplier cost recorded on this order — profit shown is overstated",
    },
    {
      key: "marketplace_fee",
      label: "eBay fee",
      amount: marketplaceFee,
      kind: "out",
      actual: feeIsActual,
      note: feeIsActual
        ? "As charged by eBay on this order"
        : `Estimated at ${(config.feePct * 100).toFixed(1)}% of the gross + ${config.fixedFee.toFixed(2)} fixed. eBay charges on the buyer's total INCLUDING VAT.`,
    },
  ];

  if (paymentFee > 0) {
    ledger.push({ key: "payment_fee", label: "Payment processing", amount: paymentFee, kind: "out", actual: true });
  }
  ledger.push({
    key: "postage",
    label: "Postage paid",
    amount: postageCost,
    kind: "out",
    actual: postageCost > 0,
    note: postageCost > 0 ? undefined : "No postage cost recorded on this order",
  });
  ledger.push({ key: "packaging", label: "Packaging", amount: packagingCost, kind: "out", actual: false });
  ledger.push({ key: "profit", label: "Net profit", amount: netProfit, kind: "total" });

  return {
    vat,
    grossReceived,
    vatOwed,
    netRevenue,
    supplierCost,
    marketplaceFee,
    paymentFee,
    postageCost,
    packagingCost,
    totalCosts,
    netProfit,
    netMarginPct: netRevenue > 0 ? r2((netProfit / netRevenue) * 100) : null,
    grossMarginPct: grossReceived > 0 ? r2((netProfit / grossReceived) * 100) : null,
    fullyActual: feeIsActual && supplierCost > 0 && postageCost > 0,
    ledger,
  };
}

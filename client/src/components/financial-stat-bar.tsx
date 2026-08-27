import { Card, CardContent } from "@/components/ui/card";

/**
 * The money story in one row, in the order it actually happens: what the buyer
 * paid, what belongs to the tax authority, what is left, what it cost, what
 * remains.
 *
 * Shared by the Dashboard and the Reports page so the same numbers are never
 * presented two different ways in two places.
 */

export interface FinancialTotals {
  orders: number;
  units: number;
  grossReceived: number;
  vatOwed: number;
  netRevenue: number;
  totalCosts: number;
  netProfit: number;
  netMarginPct: number | null;
}

const eur = (n: number | null | undefined) =>
  n == null
    ? "—"
    : `€${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (n: number | null | undefined) => (n == null ? "—" : `${Number(n).toFixed(1)}%`);

export function FinancialStatBar({ totals, compact }: { totals: FinancialTotals; compact?: boolean }) {
  return (
    <div className={`grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3`}>
      <Stat label="Orders" value={String(totals.orders)} sub={`${totals.units} units`} compact={compact} />
      <Stat label="Buyer paid" value={eur(totals.grossReceived)} sub="VAT inclusive" compact={compact} />
      {/* Called out because it is the most commonly mistaken figure: it is
          collected on the state's behalf and never was income. */}
      <Stat label="VAT owed" value={eur(totals.vatOwed)} sub="not yours" warn compact={compact} />
      <Stat label="Net revenue" value={eur(totals.netRevenue)} sub="ex-VAT" compact={compact} />
      <Stat label="Total costs" value={eur(totals.totalCosts)} sub="goods + fees" compact={compact} />
      <Stat
        label="Net profit"
        value={eur(totals.netProfit)}
        sub={`${pct(totals.netMarginPct)} of net`}
        good={totals.netProfit > 0}
        warn={totals.netProfit <= 0}
        compact={compact}
      />
    </div>
  );
}

function Stat({
  label, value, sub, warn, good, compact,
}: { label: string; value: string; sub?: string; warn?: boolean; good?: boolean; compact?: boolean }) {
  return (
    <Card>
      <CardContent className={compact ? "pt-3 pb-2 px-3" : "pt-4 pb-3"}>
        <div className="text-xs text-gray-500">{label}</div>
        <div className={`${compact ? "text-lg" : "text-xl"} font-semibold ${good ? "text-green-700" : warn ? "text-amber-700" : ""}`}>
          {value}
        </div>
        {sub && <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}

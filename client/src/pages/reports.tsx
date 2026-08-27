import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, RefreshCw, Receipt, Globe, Truck, Calendar } from "lucide-react";

const WINDOWS = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 365, label: "1 year" },
  { days: 1825, label: "All time" },
];
const GROUPINGS = ["day", "week", "month", "year"] as const;

const eur = (n: number | null | undefined) =>
  n == null ? "—" : `€${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (n: number | null | undefined) => (n == null ? "—" : `${Number(n).toFixed(1)}%`);

export function Reports({ user }: { user?: any }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [days, setDays] = useState(30);
  const [groupBy, setGroupBy] = useState<(typeof GROUPINGS)[number]>("day");

  const { data, isLoading, isFetching, refetch } = useQuery<any>({
    queryKey: ["/api/reports/financials", days, groupBy],
    queryFn: async () => {
      const r = await fetch(`/api/reports/financials?days=${days}&groupBy=${groupBy}`, { credentials: "include" });
      if (!r.ok) throw new Error(`Request failed: ${r.status}`);
      return r.json();
    },
  });

  const t = data?.totals;
  const dq = data?.dataQuality;
  const noData = !isLoading && t && t.orders === 0;

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar user={user} collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} />
      <div className={`transition-all duration-200 ${sidebarCollapsed ? "ml-16" : "ml-64"}`}>
        <Header title="Financial Reports" subtitle="Revenue, VAT, fees, cost and profit from realised orders" />

        <div className="p-6 space-y-6">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex gap-2 flex-wrap">
              {WINDOWS.map((w) => (
                <Button key={w.days} size="sm" variant={days === w.days ? "default" : "outline"} onClick={() => setDays(w.days)}>
                  {w.label}
                </Button>
              ))}
            </div>
            <div className="flex gap-2 items-center">
              <Calendar className="w-4 h-4 text-gray-400" />
              {GROUPINGS.map((g) => (
                <Button key={g} size="sm" variant={groupBy === g ? "secondary" : "ghost"} onClick={() => setGroupBy(g)}>
                  {g}
                </Button>
              ))}
              <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
                <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </div>

          {isLoading && <div className="text-gray-400">Loading financials…</div>}

          {noData && (
            <Card>
              <CardContent className="py-8 text-center text-gray-500">
                No orders in this window. Figures appear as sales come through.
              </CardContent>
            </Card>
          )}

          {t && t.orders > 0 && (
            <>
              {/* The money story in one row, in the order it actually happens */}
              <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
                <Stat label="Orders" value={String(t.orders)} sub={`${t.units} units`} />
                <Stat label="Buyer paid" value={eur(t.grossReceived)} sub="VAT inclusive" />
                <Stat label="VAT owed" value={eur(t.vatOwed)} sub="not yours" warn />
                <Stat label="Net revenue" value={eur(t.netRevenue)} sub="ex-VAT" />
                <Stat label="Total costs" value={eur(t.totalCosts)} sub="goods + fees" />
                <Stat
                  label="Net profit"
                  value={eur(t.netProfit)}
                  sub={`${pct(t.netMarginPct)} of net`}
                  good={t.netProfit > 0}
                  warn={t.netProfit <= 0}
                />
              </div>

              {dq && (dq.ordersMissingSupplierCost > 0 || dq.ordersWithIncompleteWeight > 0 || dq.ordersMissingActualFee > 0) && (
                <Card className="border-amber-200 bg-amber-50">
                  <CardContent className="py-3 text-sm text-amber-900 flex gap-2">
                    <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="font-medium">Some inputs are estimated</p>
                      <p className="text-xs mt-1">
                        {dq.ordersWithIncompleteWeight > 0 &&
                        `${dq.ordersWithIncompleteWeight} order(s) contain products with no weight recorded, so their postage band — and therefore cost — may be understated. `}
                        {dq.ordersMissingSupplierCost > 0 &&
                          `${dq.ordersMissingSupplierCost} order(s) have no supplier cost recorded. `}
                        {dq.ordersMissingActualFee > 0 &&
                          `${dq.ordersMissingActualFee} order(s) use an estimated eBay fee rather than the charged amount.`}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Where the buyer's money went — the step-by-step the user asked for */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Receipt className="w-4 h-4" /> Where the money went
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Waterfall
                    rows={[
                      { label: "Buyer paid (gross)", amount: t.grossReceived, kind: "in" },
                      { label: "VAT to tax authority", amount: -t.vatOwed, kind: "out", note: "Collected on their behalf — never income" },
                      { label: "Net revenue", amount: t.netRevenue, kind: "total" },
                      { label: "Supplier cost (TME, 0% VAT)", amount: -t.supplierCost, kind: "out", note: "Bought under reverse charge, so no input VAT to reclaim" },
                      { label: "eBay fees", amount: -t.marketplaceFee, kind: "out", note: "Charged on the gross, VAT included" },
                      ...(t.paymentFee > 0 ? [{ label: "Payment processing", amount: -t.paymentFee, kind: "out" as const }] : []),
                      { label: "Postage (Latvijas Pasts)", amount: -t.postageCost, kind: "out", note: "Priced from the tariff book by weight band and destination" },
                      { label: "Packaging", amount: -t.packagingCost, kind: "out" },
                      { label: "Net profit", amount: t.netProfit, kind: "total" },
                    ]}
                  />
                </CardContent>
              </Card>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Globe className="w-4 h-4" /> By destination country
                    </CardTitle>
                    <p className="text-xs text-gray-500">Each country's own VAT rate applies to consumer sales (OSS)</p>
                  </CardHeader>
                  <CardContent className="overflow-x-auto">
                    <Table
                      head={["Country", "VAT", "Orders", "Gross", "VAT owed", "Profit", "Margin"]}
                      rows={(data.byCountry ?? []).map((c: any) => [
                        c.country, `${c.vatRatePct}%`, c.orders, eur(c.grossReceived), eur(c.vatOwed),
                        <span className={c.netProfit < 0 ? "text-red-600" : ""}>{eur(c.netProfit)}</span>,
                        pct(c.netMarginPct),
                      ])}
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Truck className="w-4 h-4" /> By supplier
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="overflow-x-auto">
                    <Table
                      head={["Supplier", "Lines", "Units", "Cost"]}
                      rows={(data.bySupplier ?? []).map((s: any) => [s.supplier, s.lines, s.units, eur(s.cost)])}
                    />
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">By {groupBy}</CardTitle>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <Table
                    head={["Period", "Orders", "Units", "Gross", "VAT", "Net rev.", "Goods", "Fees", "Profit", "Margin"]}
                    rows={(data.byPeriod ?? []).map((p: any) => [
                      p.period, p.orders, p.units, eur(p.grossReceived), eur(p.vatOwed), eur(p.netRevenue),
                      eur(p.supplierCost), eur(p.marketplaceFee),
                      <span className={p.netProfit < 0 ? "text-red-600" : ""}>{eur(p.netProfit)}</span>,
                      pct(p.netMarginPct),
                    ])}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Every order</CardTitle>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <Table
                    head={["Date", "Order", "To", "Units", "Gross", "VAT", "Goods", "Fee", "Profit", "Margin"]}
                    rows={(data.orders ?? []).map((o: any) => [
                      new Date(o.orderDate).toLocaleDateString(),
                      o.marketplaceOrderId,
                      o.country ?? "—",
                      o.units,
                      eur(o.grossReceived),
                      eur(o.vatOwed),
                      eur(o.supplierCost),
                      eur(o.marketplaceFee),
                      <span className={o.netProfit < 0 ? "text-red-600 font-medium" : ""}>{eur(o.netProfit)}</span>,
                      pct(o.netMarginPct),
                    ])}
                  />
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, warn, good }: { label: string; value: string; sub?: string; warn?: boolean; good?: boolean }) {
  return (
    <Card>
      <CardContent className="pt-4 pb-3">
        <div className="text-xs text-gray-500">{label}</div>
        <div className={`text-xl font-semibold ${good ? "text-green-700" : warn ? "text-amber-700" : ""}`}>{value}</div>
        {sub && <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function Waterfall({ rows }: { rows: Array<{ label: string; amount: number; kind: "in" | "out" | "total"; note?: string }> }) {
  const max = Math.max(...rows.map((r) => Math.abs(r.amount)), 1);
  return (
    <div className="space-y-1.5">
      {rows.map((r, i) => (
        <div key={i} className={`flex items-center gap-3 ${r.kind === "total" ? "border-t pt-2 mt-1" : ""}`}>
          <div className="w-64 flex-shrink-0">
            <div className={`text-sm ${r.kind === "total" ? "font-semibold" : ""}`}>{r.label}</div>
            {r.note && <div className="text-[11px] text-gray-400">{r.note}</div>}
          </div>
          <div className="flex-1 h-4 bg-gray-100 rounded overflow-hidden">
            <div
              className={`h-full ${r.kind === "total" ? "bg-blue-500" : r.amount < 0 ? "bg-red-400" : "bg-green-400"}`}
              style={{ width: `${Math.min(100, (Math.abs(r.amount) / max) * 100)}%` }}
            />
          </div>
          <div className={`w-28 text-right text-sm tabular-nums ${r.kind === "total" ? "font-semibold" : r.amount < 0 ? "text-red-600" : ""}`}>
            {eur(r.amount)}
          </div>
        </div>
      ))}
    </div>
  );
}

function Table({ head, rows }: { head: string[]; rows: any[][] }) {
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-gray-500">
        <tr>
          {head.map((h, i) => (
            <th key={h} className={`py-2 pr-3 ${i > 1 ? "text-right" : ""}`}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-t">
            {r.map((c, j) => (
              <td key={j} className={`py-1.5 pr-3 ${j > 1 ? "text-right tabular-nums" : ""}`}>{c}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default Reports;

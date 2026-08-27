import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, AlertTriangle, Target, RefreshCw } from "lucide-react";

const WINDOWS = [7, 30, 90] as const;

const eur = (n: number | null | undefined) =>
  n == null ? "—" : `€${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (n: number | null | undefined) => (n == null ? "—" : `${Number(n).toFixed(1)}%`);

export default function SalesPerformance({ user }: { user?: any }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [days, setDays] = useState<number>(30);

  const { data, isLoading, isFetching, refetch } = useQuery<any>({
    queryKey: ["/api/analytics/sales", days],
    queryFn: async () => {
      const r = await fetch(`/api/analytics/sales?days=${days}`, { credentials: "include" });
      if (!r.ok) throw new Error(`Request failed: ${r.status}`);
      return r.json();
    },
  });

  const totals = data?.totals;
  const noSales = !isLoading && totals && totals.orders === 0;

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar user={user} collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} />
      <div className={`transition-all duration-200 ${sidebarCollapsed ? "ml-16" : "ml-64"}`}>
        <Header title="Sales Performance" subtitle="What actually sells, and where the catalogue still has room" />

        <div className="p-6 space-y-6">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex gap-2">
              {WINDOWS.map((w) => (
                <Button key={w} size="sm" variant={days === w ? "default" : "outline"} onClick={() => setDays(w)}>
                  Last {w} days
                </Button>
              ))}
            </div>
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`w-4 h-4 mr-2 ${isFetching ? "animate-spin" : ""}`} /> Refresh
            </Button>
          </div>

          {isLoading && <div className="text-gray-400">Loading sales data…</div>}

          {noSales && (
            <Card>
              <CardContent className="py-8 text-center text-gray-500">
                No orders in the last {days} days. This page reads your own eBay order history —
                it fills in as sales come through.
              </CardContent>
            </Card>
          )}

          {totals && totals.orders > 0 && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Stat label="Orders" value={String(totals.orders)} />
                <Stat label="Units sold" value={String(totals.units)} />
                <Stat label="Revenue" value={eur(totals.revenue)} />
                <Stat
                  label="Profit"
                  value={eur(totals.profit)}
                  sub={totals.costCoverage === "missing" ? "no cost recorded — profit understated" : pct(totals.marginPct)}
                  warn={totals.costCoverage === "missing"}
                />
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Target className="w-4 h-4" /> Where to list next
                  </CardTitle>
                  <p className="text-sm text-gray-500">
                    Categories ranked by realised profit, profit per listing, and how much is still
                    unlisted. A category with nothing left to list scores zero however well it sells.
                  </p>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-gray-500">
                      <tr>
                        <th className="py-2 pr-4">Category</th>
                        <th className="py-2 pr-4 text-right">Units</th>
                        <th className="py-2 pr-4 text-right">Revenue</th>
                        <th className="py-2 pr-4 text-right">Profit</th>
                        <th className="py-2 pr-4 text-right">Margin</th>
                        <th className="py-2 pr-4 text-right">Listed</th>
                        <th className="py-2 pr-4 text-right">Per listing</th>
                        <th className="py-2 pr-4 text-right">Still listable</th>
                        <th className="py-2 text-right">Score</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(data?.categories ?? []).map((c: any) => (
                        <tr key={c.category} className="border-t">
                          <td className="py-2 pr-4 font-medium">{c.category}</td>
                          <td className="py-2 pr-4 text-right">{c.units}</td>
                          <td className="py-2 pr-4 text-right">{eur(c.revenue)}</td>
                          <td className={`py-2 pr-4 text-right ${c.profit < 0 ? "text-red-600" : ""}`}>{eur(c.profit)}</td>
                          <td className="py-2 pr-4 text-right">{pct(c.marginPct)}</td>
                          <td className="py-2 pr-4 text-right">{c.productsListed}</td>
                          <td className="py-2 pr-4 text-right">{eur(c.profitPerListing)}</td>
                          <td className="py-2 pr-4 text-right">{c.unlistedOpportunity}</td>
                          <td className="py-2 text-right">
                            <Badge variant={c.opportunityScore > 50 ? "default" : "secondary"}>
                              {c.opportunityScore.toFixed(0)}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>

              {(data?.lossMakers?.length ?? 0) > 0 && (
                <Card className="border-red-200">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base text-red-700">
                      <AlertTriangle className="w-4 h-4" /> Selling at or below cost
                    </CardTitle>
                    <p className="text-sm text-gray-500">
                      Prices are recalculated automatically, so a SKU can go underwater without
                      anyone noticing. These sold in the window and did not cover their supplier cost.
                    </p>
                  </CardHeader>
                  <CardContent className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-left text-gray-500">
                        <tr>
                          <th className="py-2 pr-4">SKU</th>
                          <th className="py-2 pr-4">Title</th>
                          <th className="py-2 pr-4 text-right">Units</th>
                          <th className="py-2 pr-4 text-right">Revenue</th>
                          <th className="py-2 pr-4 text-right">Cost</th>
                          <th className="py-2 text-right">Loss</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.lossMakers.map((r: any) => (
                          <tr key={r.sku} className="border-t">
                            <td className="py-2 pr-4 font-mono text-xs">{r.sku}</td>
                            <td className="py-2 pr-4 max-w-md truncate">{r.title}</td>
                            <td className="py-2 pr-4 text-right">{r.units}</td>
                            <td className="py-2 pr-4 text-right">{eur(r.revenue)}</td>
                            <td className="py-2 pr-4 text-right">{eur(r.cost)}</td>
                            <td className="py-2 text-right text-red-600">{eur(r.profit)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>
              )}

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <TrendingUp className="w-4 h-4" /> Top sellers
                  </CardTitle>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-gray-500">
                      <tr>
                        <th className="py-2 pr-4">SKU</th>
                        <th className="py-2 pr-4">Title</th>
                        <th className="py-2 pr-4">Category</th>
                        <th className="py-2 pr-4 text-right">Units</th>
                        <th className="py-2 pr-4 text-right">Per day</th>
                        <th className="py-2 pr-4 text-right">Revenue</th>
                        <th className="py-2 pr-4 text-right">Profit</th>
                        <th className="py-2 text-right">Margin</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(data?.topSkus ?? []).slice(0, 50).map((r: any) => (
                        <tr key={r.sku} className="border-t">
                          <td className="py-2 pr-4 font-mono text-xs">{r.sku}</td>
                          <td className="py-2 pr-4 max-w-md truncate">{r.title}</td>
                          <td className="py-2 pr-4 text-gray-500">{r.category ?? "—"}</td>
                          <td className="py-2 pr-4 text-right">{r.units}</td>
                          <td className="py-2 pr-4 text-right">{r.unitsPerDay.toFixed(2)}</td>
                          <td className="py-2 pr-4 text-right">{eur(r.revenue)}</td>
                          <td className={`py-2 pr-4 text-right ${r.profit < 0 ? "text-red-600" : ""}`}>{eur(r.profit)}</td>
                          <td className="py-2 text-right">{pct(r.marginPct)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-sm text-gray-500">{label}</div>
        <div className="text-2xl font-semibold">{value}</div>
        {sub && <div className={`text-xs mt-1 ${warn ? "text-amber-600" : "text-gray-400"}`}>{sub}</div>}
      </CardContent>
    </Card>
  );
}

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatNumber } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { FinancialStatBar } from "@/components/financial-stat-bar";
import {
  Package,
  ShoppingCart,
  Store,
  AlertTriangle,
  Boxes,
  RefreshCw,
  Clock,
} from "lucide-react";

interface DashboardProps {
  user: any;
}

interface DashboardMetrics {
  totalProducts: number;
  ebayListings: number;
  amazonListings: number;
  totalRevenue: number;
  outOfStock?: number;
}

interface SyncLogEntry {
  source: string;
  operation: string;
  status: string;
  message: string | null;
  syncedAt: string | null;
}

interface OpsDaily {
  recentLogs?: SyncLogEntry[];
  activeImport?: {
    jobId: string;
    status: string;
    total: number;
    processed: number;
    syncedCount: number;
    updatedCount: number;
    failedCount: number;
    remaining: number;
  } | null;
}

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "never";
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function statusVariant(status: string): "default" | "secondary" | "destructive" {
  if (status === "success") return "default";
  if (status === "error") return "destructive";
  return "secondary";
}

export function Dashboard({ user }: DashboardProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const { data: metrics, isError: metricsError, error: metricsErrorObj } = useQuery<DashboardMetrics>({
    queryKey: ["/api/dashboard/metrics"],
  });

  const { data: ops, isError: opsError } = useQuery<OpsDaily>({
    queryKey: ["/api/ops/daily"],
    refetchInterval: 60_000,
  });

  const recentLogs = ops?.recentLogs ?? [];
  // Most recent TME/cron sync entry, for the "Last sync" card.
  const lastSync = recentLogs.find(
    (l) => l.operation?.includes("sync") || l.source === "tme",
  );

  const totalListed = (metrics?.ebayListings ?? 0) + (metrics?.amazonListings ?? 0);

  const cards = [
    {
      title: "Total Products",
      value: metrics ? formatNumber(metrics.totalProducts) : "—",
      icon: Package,
      color: "bg-blue-100 text-blue-600",
    },
    {
      title: "Total Listed",
      value: metrics ? formatNumber(totalListed) : "—",
      sub: metrics ? `${formatNumber(metrics.ebayListings)} eBay · ${formatNumber(metrics.amazonListings)} Amazon` : undefined,
      icon: Boxes,
      color: "bg-green-100 text-green-600",
    },
    {
      title: "Out of Stock",
      value: metrics ? formatNumber(metrics.outOfStock ?? 0) : "—",
      icon: AlertTriangle,
      color: "bg-red-100 text-red-600",
    },
    {
      title: "Last Sync",
      value: timeAgo(lastSync?.syncedAt),
      sub: lastSync?.message ?? "No sync recorded yet",
      icon: Clock,
      color: "bg-purple-100 text-purple-600",
    },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar user={user} collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} />
      <div className={`transition-all duration-200 ${sidebarCollapsed ? "ml-16" : "ml-64"}`}>
        <Header
          title="Dashboard"
          subtitle="Listing and sync health at a glance"
        />

        <div className="p-6 space-y-6">
          {/* Money first: the point of opening this page in the morning is to
              see what sold and what it earned, not the catalogue size. */}
          <TodayFinancials />

          {/* A failed metrics fetch must not render as an empty install:
              "0 products, no sync" and "the dashboard can't load" are very
              different situations (see the August outage). */}
          {(metricsError || opsError) && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              <strong>Dashboard data failed to load</strong> — the numbers below may be blank or stale,
              not zero.{" "}
              <span className="font-mono text-xs">
                {(metricsErrorObj as Error)?.message || "Request failed"}
              </span>
            </div>
          )}

          {/* An unfinished TME import keeps running whenever TME Browser is
              opened — including after a redeploy — which is why products can
              appear to arrive "on deploy" with nothing on screen saying so.
              Show it here, where the product count actually changes. */}
          {ops?.activeImport && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
              <div className="font-medium">
                TME import in progress — {ops.activeImport.processed.toLocaleString()} of{" "}
                {ops.activeImport.total.toLocaleString()} products
                {ops.activeImport.remaining > 0
                  ? `, ${ops.activeImport.remaining.toLocaleString()} still to go`
                  : ""}
              </div>
              <div className="mt-1 text-xs opacity-90">
                {ops.activeImport.syncedCount.toLocaleString()} added ·{" "}
                {ops.activeImport.updatedCount.toLocaleString()} updated ·{" "}
                {ops.activeImport.failedCount.toLocaleString()} failed. It continues in the
                background whenever TME Browser is open, so the product count keeps rising until
                it finishes. Open TME Browser to watch or cancel it.
              </div>
            </div>
          )}

          {/* Stat cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {cards.map((card) => (
              <Card key={card.title} className="border border-gray-200">
                <CardContent className="p-6">
                  <div className="flex items-center">
                    <div className={`p-2 rounded-lg ${card.color}`}>
                      <card.icon className="w-6 h-6" />
                    </div>
                    <div className="ml-4 min-w-0">
                      <h3 className="text-sm font-medium text-gray-500">{card.title}</h3>
                      <p className="text-2xl font-semibold text-gray-900 truncate">{card.value}</p>
                    </div>
                  </div>
                  {card.sub && (
                    <p className="mt-3 text-xs text-gray-500 truncate" title={card.sub}>
                      {card.sub}
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          {/* eBay vs Amazon split */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card className="border border-gray-200">
              <CardContent className="p-6 flex items-center">
                <div className="p-2 rounded-lg bg-green-100 text-green-600">
                  <ShoppingCart className="w-6 h-6" />
                </div>
                <div className="ml-4">
                  <h3 className="text-sm font-medium text-gray-500">eBay Listings</h3>
                  <p className="text-2xl font-semibold text-gray-900">{metrics ? formatNumber(metrics.ebayListings) : "—"}</p>
                </div>
              </CardContent>
            </Card>
            <Card className="border border-gray-200">
              <CardContent className="p-6 flex items-center">
                <div className="p-2 rounded-lg bg-yellow-100 text-yellow-600">
                  <Store className="w-6 h-6" />
                </div>
                <div className="ml-4">
                  <h3 className="text-sm font-medium text-gray-500">Amazon Listings</h3>
                  <p className="text-2xl font-semibold text-gray-900">{metrics ? formatNumber(metrics.amazonListings) : "—"}</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Recent sync activity timeline */}
          <Card className="border border-gray-200">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <RefreshCw className="w-4 h-4" />
                Recent sync activity
              </CardTitle>
            </CardHeader>
            <CardContent>
              {recentLogs.length === 0 ? (
                <div className="text-gray-400 py-4 text-sm">No recent activity.</div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {recentLogs.slice(0, 10).map((log, i) => (
                    <div key={i} className="flex items-center gap-3 py-2 text-sm">
                      <span className="text-gray-400 w-16 shrink-0">{timeAgo(log.syncedAt)}</span>
                      <Badge variant={statusVariant(log.status)} className="shrink-0">
                        {log.status}
                      </Badge>
                      <span className="text-gray-500 shrink-0 hidden sm:inline">
                        {log.source}/{log.operation}
                      </span>
                      <span className="text-gray-700 truncate">{log.message}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}


/**
 * Today's trading, at the top of the dashboard.
 *
 * "Today" is the seller's calendar day, resolved server-side from the
 * browser's timezone offset — a UTC boundary would drop last night's orders
 * out of the figure in the early hours.
 */
function TodayFinancials() {
  const [period, setPeriod] = useState<"today" | "7" | "30">("today");

  const query =
    period === "today"
      ? `period=today&tzOffset=${new Date().getTimezoneOffset()}`
      : `days=${period}`;

  const { data, isLoading, error } = useQuery<any>({
    queryKey: ["/api/reports/financials", "bar", period],
    queryFn: async () => {
      const r = await fetch(`/api/reports/financials?${query}&groupBy=day`, { credentials: "include" });
      const body = await r.text();
      if (!r.ok) {
        let detail = body.slice(0, 200);
        try { detail = JSON.parse(body).error ?? detail; } catch { /* not JSON */ }
        throw new Error(`${r.status}: ${detail}`);
      }
      return JSON.parse(body);
    },
  });

  const totals = data?.totals;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-gray-700">
          {period === "today" ? "Today" : `Last ${period} days`}
        </h2>
        <div className="flex gap-1">
          {([["today", "Today"], ["7", "7d"], ["30", "30d"]] as const).map(([v, label]) => (
            <Button
              key={v}
              size="sm"
              variant={period === v ? "secondary" : "ghost"}
              className="h-7 px-2 text-xs"
              onClick={() => setPeriod(v)}
              data-testid={`btn-period-${v}`}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>

      {isLoading && <div className="text-sm text-gray-400">Loading today's figures…</div>}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <strong>Financials failed to load</strong>{" "}
          <span className="font-mono text-xs">{(error as Error).message}</span>
        </div>
      )}

      {totals && totals.orders > 0 && <FinancialStatBar totals={totals} compact />}

      {totals && totals.orders === 0 && (
        <div className="rounded-lg border bg-white px-4 py-3 text-sm text-gray-500">
          No orders {period === "today" ? "yet today" : `in the last ${period} days`}.
        </div>
      )}
    </div>
  );
}

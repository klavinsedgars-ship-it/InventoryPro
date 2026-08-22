import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatNumber } from "@/lib/utils";
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

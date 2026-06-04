import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Activity,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Server,
  Boxes,
  ListChecks,
} from "lucide-react";

interface OpsProps {
  user: any;
}

interface OpsData {
  date: string;
  apiCalls: {
    ebay: { callsToday: number; dailyLimit: number; lastResetAt: string | null; updatedAt: string | null };
    tme: { callsToday: number; dailyLimit: number; lastResetAt: string | null; updatedAt: string | null };
  };
  jobs: {
    runsToday: Record<string, number>;
    totalRunsToday: number;
    errorsToday: number;
    recentErrors: Array<{ source: string; operation: string; message: string; syncedAt: string }>;
    lastCronSync: {
      status: string;
      at: string;
      chunks?: number;
      totalChanged?: number;
      totalEbay?: number;
      remaining?: number;
    } | null;
  };
  queue: { pending: number; processing: number; completed: number; failed: number; byPriority: Record<string, number> };
  listings: {
    totalTme: number;
    listedOnEbay: number;
    listedWithOfferId: number;
    listedLegacyItemIdOnly: number;
    notYetListed: number;
  };
  recentLogs: Array<{ source: string; operation: string; status: string; message: string; syncedAt: string }>;
}

const fmt = (n: number | undefined) => (n ?? 0).toLocaleString();
const pct = (used: number, limit: number) => (limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0);
const ago = (iso: string | null | undefined) => {
  if (!iso) return "never";
  const d = new Date(iso).getTime();
  const mins = Math.round((Date.now() - d) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
};

function UsageCard({
  label,
  used,
  limit,
  resetAt,
}: {
  label: string;
  used: number;
  limit: number;
  resetAt: string | null;
}) {
  const p = pct(used, limit);
  const tone = p >= 90 ? "bg-red-500" : p >= 70 ? "bg-amber-500" : "bg-green-500";
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-gray-500 flex items-center gap-2">
          <Server className="w-4 h-4" /> {label} API calls today
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{fmt(used)}</div>
        <div className="text-xs text-gray-400 mb-2">of {fmt(limit)} / day · {p}%</div>
        <div className="h-2 w-full rounded-full bg-gray-100 overflow-hidden">
          <div className={`h-full ${tone}`} style={{ width: `${p}%` }} />
        </div>
        <div className="text-xs text-gray-400 mt-2">counter reset {ago(resetAt)}</div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="rounded-lg border bg-white p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-xl font-bold">{value}</div>
      {sub && <div className="text-xs text-gray-400">{sub}</div>}
    </div>
  );
}

const statusBadge = (status: string) => {
  const ok = status === "success";
  const partial = status === "partial" || status === "in_progress";
  return (
    <Badge variant="outline" className={ok ? "text-green-700 border-green-300" : partial ? "text-amber-700 border-amber-300" : "text-red-700 border-red-300"}>
      {status}
    </Badge>
  );
};

export function OpsDashboard({ user }: OpsProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const { data, isLoading, isError, refetch, isFetching } = useQuery<OpsData>({
    queryKey: ["/api/ops/daily"],
    refetchInterval: 60000, // auto-refresh each minute
  });

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar user={user} collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} />
      <div className={`transition-all duration-200 ${sidebarCollapsed ? "ml-16" : "ml-64"}`}>
        <Header title="Operations" subtitle="Daily jobs, API usage, queue and listing health at a glance" />

        <div className="p-6 space-y-6">
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-500 flex items-center gap-2">
              <Activity className="w-4 h-4" />
              {data?.date ? `Snapshot for ${data.date} (UTC)` : "Loading…"}
            </div>
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`w-4 h-4 mr-2 ${isFetching ? "animate-spin" : ""}`} /> Refresh
            </Button>
          </div>

          {isLoading && <div className="text-gray-400">Loading operations data…</div>}
          {isError && <div className="text-red-600">Failed to load /api/ops/daily.</div>}

          {data && (
            <>
              {/* API usage */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <UsageCard label="eBay" used={data.apiCalls.ebay.callsToday} limit={data.apiCalls.ebay.dailyLimit} resetAt={data.apiCalls.ebay.lastResetAt} />
                <UsageCard label="TME" used={data.apiCalls.tme.callsToday} limit={data.apiCalls.tme.dailyLimit} resetAt={data.apiCalls.tme.lastResetAt} />
              </div>

              {/* Jobs today + last cron */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-gray-500 flex items-center gap-2">
                    <ListChecks className="w-4 h-4" /> Jobs today
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <Stat label="Total runs" value={fmt(data.jobs.totalRunsToday)} />
                    <Stat
                      label="Errors"
                      value={
                        <span className={data.jobs.errorsToday ? "text-red-600" : "text-green-600"}>
                          {fmt(data.jobs.errorsToday)}
                        </span>
                      }
                    />
                    {Object.entries(data.jobs.runsToday).slice(0, 2).map(([src, n]) => (
                      <Stat key={src} label={`${src} runs`} value={fmt(n)} />
                    ))}
                  </div>

                  {data.jobs.lastCronSync && (
                    <div className="rounded-lg border bg-gray-50 p-3 text-sm">
                      <div className="flex items-center gap-2 mb-1">
                        {data.jobs.lastCronSync.status === "success" ? (
                          <CheckCircle2 className="w-4 h-4 text-green-600" />
                        ) : (
                          <AlertTriangle className="w-4 h-4 text-amber-600" />
                        )}
                        <span className="font-medium">Last TME cron sync</span>
                        {statusBadge(data.jobs.lastCronSync.status)}
                        <span className="text-gray-400">{ago(data.jobs.lastCronSync.at)}</span>
                      </div>
                      <div className="text-gray-600">
                        {fmt(data.jobs.lastCronSync.chunks)} chunks · {fmt(data.jobs.lastCronSync.totalChanged)} changed ·{" "}
                        {fmt(data.jobs.lastCronSync.totalEbay)} eBay updated · {fmt(data.jobs.lastCronSync.remaining)} remaining
                      </div>
                    </div>
                  )}

                  {data.jobs.recentErrors.length > 0 && (
                    <div className="text-sm">
                      <div className="font-medium text-red-700 mb-1">Recent errors</div>
                      <ul className="space-y-1">
                        {data.jobs.recentErrors.map((e, i) => (
                          <li key={i} className="text-gray-600">
                            <span className="text-gray-400">{ago(e.syncedAt)}</span> · <b>{e.source}/{e.operation}</b>: {e.message}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Queue + listings */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-gray-500 flex items-center gap-2">
                      <Boxes className="w-4 h-4" /> Sync queue
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <Stat label="Pending" value={fmt(data.queue.pending)} />
                    <Stat label="Processing" value={fmt(data.queue.processing)} />
                    <Stat label="Completed" value={fmt(data.queue.completed)} />
                    <Stat label="Failed" value={<span className={data.queue.failed ? "text-red-600" : ""}>{fmt(data.queue.failed)}</span>} />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-gray-500 flex items-center gap-2">
                      <Boxes className="w-4 h-4" /> eBay listings
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <Stat label="TME products" value={fmt(data.listings.totalTme)} />
                    <Stat label="Listed" value={fmt(data.listings.listedOnEbay)} sub={`${fmt(data.listings.listedWithOfferId)} cron-syncable`} />
                    <Stat label="Legacy only" value={fmt(data.listings.listedLegacyItemIdOnly)} sub="no offer id" />
                    <Stat label="Not listed" value={fmt(data.listings.notYetListed)} />
                  </CardContent>
                </Card>
              </div>

              {/* Recent logs */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-gray-500">Recent activity</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="divide-y text-sm">
                    {data.recentLogs.map((l, i) => (
                      <div key={i} className="py-2 flex items-center gap-3">
                        <span className="text-gray-400 w-16 shrink-0">{ago(l.syncedAt)}</span>
                        {statusBadge(l.status)}
                        <span className="text-gray-500 shrink-0">{l.source}/{l.operation}</span>
                        <span className="text-gray-700 truncate">{l.message}</span>
                      </div>
                    ))}
                    {data.recentLogs.length === 0 && <div className="text-gray-400 py-2">No recent activity.</div>}
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

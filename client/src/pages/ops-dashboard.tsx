import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Activity,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Server,
  Boxes,
  ListChecks,
  Rocket,
  ShieldAlert,
  Eye,
  Pause,
  Play,
  RotateCcw,
} from "lucide-react";

interface OpsProps {
  user: any;
  // When embedded (e.g. as a tab inside the Operations page) skip the page
  // chrome (sidebar + header) and render content only.
  embedded?: boolean;
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
  listingEnv: {
    ok: boolean;
    rampEnabled: boolean;
    rampPaused: boolean;
    rampPriceRange: { minPrice?: number; maxPrice?: number };
    issues: Array<{ level: "error" | "warning"; key: string; message: string }>;
  };
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

export function OpsDashboard({ user, embedded = false }: OpsProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading, isError, refetch, isFetching } = useQuery<OpsData>({
    queryKey: ["/api/ops/daily"],
    refetchInterval: 60000, // auto-refresh each minute
  });

  const [preview, setPreview] = useState<any>(null);
  const [priceMin, setPriceMin] = useState("");
  const [priceMax, setPriceMax] = useState("");
  const [bandInit, setBandInit] = useState(false);

  // Seed the band inputs from the server once on first load.
  useEffect(() => {
    if (data && !bandInit) {
      setPriceMin(data.listingEnv.rampPriceRange.minPrice?.toString() ?? "");
      setPriceMax(data.listingEnv.rampPriceRange.maxPrice?.toString() ?? "");
      setBandInit(true);
    }
  }, [data, bandInit]);

  const saveBand = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", "/api/ops/list-ramp/price-range", {
        minPrice: priceMin === "" ? null : Number(priceMin),
        maxPrice: priceMax === "" ? null : Number(priceMax),
      });
      return r.json();
    },
    onSuccess: (d: any) => {
      if (d?.success) {
        toast({ title: "Price band saved", description: `${d.matchingCandidates} products now match the ramp filter.` });
        qc.invalidateQueries({ queryKey: ["/api/ops/daily"] });
        setPreview(null);
      } else {
        toast({ title: "Could not save band", description: d?.error || "Unknown error", variant: "destructive" });
      }
    },
    onError: (e: any) => toast({ title: "Could not save band", description: e.message, variant: "destructive" }),
  });

  const previewRamp = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", "/api/ops/list-ramp/preview", {});
      return r.json();
    },
    onSuccess: (d: any) => {
      setPreview(d);
      toast({
        title: "Preview ready",
        description:
          d?.dryRun
            ? `Would publish ${d.wouldPublishNow} now; ${d.totalCandidatesRemaining} candidates remaining.` +
              (d.blockedNoImage ? ` ${d.blockedNoImage} excluded — no image.` : "")
            : d?.error || "No data",
      });
    },
    onError: (e: any) => toast({ title: "Preview failed", description: e.message, variant: "destructive" }),
  });

  const startRamp = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", "/api/ops/list-ramp/start", { confirm: true });
      return r.json();
    },
    onSuccess: (d: any) => {
      if (d?.success) {
        toast({ title: "Listing ramp started", description: d.message });
        setTimeout(() => qc.invalidateQueries({ queryKey: ["/api/ops/daily"] }), 2000);
      } else {
        toast({ title: "Could not start ramp", description: d?.error || "Unknown error", variant: "destructive" });
      }
    },
    onError: (e: any) => toast({ title: "Could not start ramp", description: e.message, variant: "destructive" }),
  });

  const pauseRamp = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/ops/list-ramp/pause", {})).json(),
    onSuccess: (d: any) => {
      toast({ title: "Ramp paused", description: d?.message || "Stopping after current batch." });
      qc.invalidateQueries({ queryKey: ["/api/ops/daily"] });
    },
  });

  const resumeRamp = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/ops/list-ramp/resume", {})).json(),
    onSuccess: () => {
      toast({ title: "Ramp un-paused" });
      qc.invalidateQueries({ queryKey: ["/api/ops/daily"] });
    },
  });

  // After a systemic blocker is fixed, every SKU the ramp parked is still
  // parked: the candidate query skips anything at EBAY_LIST_MAX_ATTEMPTS. This
  // was only reachable by hand-calling the endpoint.
  const requeueFailed = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", "/api/ebay/reset-list-attempts", { onlyErrored: true })).json(),
    onSuccess: (d: any) => {
      toast({
        title: d?.success ? "Failed listings requeued" : "Could not requeue",
        description: d?.success
          ? `${d.updated} product(s) back in the ramp queue.`
          : d?.error || "Unknown error",
        variant: d?.success ? undefined : "destructive",
      });
      qc.invalidateQueries({ queryKey: ["/api/ops/daily"] });
    },
    onError: (e: any) => toast({ title: "Could not requeue", description: e.message, variant: "destructive" }),
  });

  const confirmAndRequeue = () => {
    if (
      window.confirm(
        "Put previously-failed listings back in the ramp queue?\n\nUse this after fixing the cause of the failures — otherwise they will simply fail again and re-park.",
      )
    ) {
      requeueFailed.mutate();
    }
  };

  const confirmAndStart = () => {
    const n = preview?.wouldPublishNow ?? "an unknown number of";
    const total = preview?.totalCandidatesRemaining ?? "?";
    if (
      window.confirm(
        `Really start the LIVE listing ramp?\n\nThis will publish ${n} product(s) to eBay now, then self-chain through ~${total} more in batches of 25 until the catalogue is listed or you Pause.\n\nUse Preview first if you want to see what gets listed without publishing.`,
      )
    ) {
      startRamp.mutate();
    }
  };

  return (
    <div className={embedded ? "" : "min-h-screen bg-gray-50"}>
      {!embedded && (
        <Sidebar user={user} collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} />
      )}
      <div className={embedded ? "" : `transition-all duration-200 ${sidebarCollapsed ? "ml-16" : "ml-64"}`}>
        {!embedded && (
          <Header title="Operations" subtitle="Daily jobs, API usage, queue and listing health at a glance" />
        )}

        <div className={embedded ? "space-y-6" : "p-6 space-y-6"}>
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-500 flex items-center gap-2">
              <Activity className="w-4 h-4" />
              {data?.date ? `Snapshot for ${data.date} (UTC)` : "Loading…"}
            </div>
            <div className="flex gap-2 flex-wrap">
              {data?.listingEnv.ok && (
                <Button variant="outline" size="sm" onClick={() => previewRamp.mutate()} disabled={previewRamp.isPending}>
                  <Eye className="w-4 h-4 mr-2" /> Preview next batch
                </Button>
              )}
              {data?.listingEnv.rampEnabled && data.listingEnv.ok && !data.listingEnv.rampPaused && (
                <Button size="sm" onClick={confirmAndStart} disabled={startRamp.isPending}>
                  <Rocket className="w-4 h-4 mr-2" /> Start (live, with confirm)
                </Button>
              )}
              {data?.listingEnv.rampEnabled && !data.listingEnv.rampPaused && (
                <Button variant="destructive" size="sm" onClick={() => pauseRamp.mutate()} disabled={pauseRamp.isPending}>
                  <Pause className="w-4 h-4 mr-2" /> Pause ramp
                </Button>
              )}
              {data?.listingEnv.rampPaused && (
                <Button variant="outline" size="sm" onClick={() => resumeRamp.mutate()} disabled={resumeRamp.isPending}>
                  <Play className="w-4 h-4 mr-2" /> Resume ramp
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={confirmAndRequeue} disabled={requeueFailed.isPending}>
                <RotateCcw className="w-4 h-4 mr-2" /> Requeue failed
              </Button>
              <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
                <RefreshCw className={`w-4 h-4 mr-2 ${isFetching ? "animate-spin" : ""}`} /> Refresh
              </Button>
            </div>
          </div>

          {isLoading && <div className="text-gray-400">Loading operations data…</div>}
          {isError && <div className="text-red-600">Failed to load /api/ops/daily.</div>}

          {data && (
            <>
              {/* Listing readiness (env validation) */}
              {(data.listingEnv.issues.length > 0 || !data.listingEnv.rampEnabled) && (
                <Card className={!data.listingEnv.ok ? "border-red-200 bg-red-50/40" : data.listingEnv.issues.length > 0 ? "border-amber-200 bg-amber-50/40" : ""}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <ShieldAlert className="w-4 h-4" />
                      Listing readiness
                      {data.listingEnv.ok ? (
                        <Badge variant="outline" className="text-green-700 border-green-300">ready</Badge>
                      ) : (
                        <Badge variant="outline" className="text-red-700 border-red-300">blocked</Badge>
                      )}
                      {!data.listingEnv.rampEnabled && (
                        <Badge variant="outline" className="text-gray-600 border-gray-300">ramp disabled (env)</Badge>
                      )}
                      {data.listingEnv.rampEnabled && data.listingEnv.rampPaused && (
                        <Badge variant="outline" className="text-amber-700 border-amber-300">ramp paused</Badge>
                      )}
                      {data.listingEnv.rampEnabled && !data.listingEnv.rampPaused && (
                        <Badge variant="outline" className="text-blue-700 border-blue-300">ramp enabled</Badge>
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm space-y-1">
                    {data.listingEnv.issues.length === 0 && (
                      <div className="text-gray-600">All required env vars set. Set <code>LISTING_RAMP_ENABLED=true</code> to start auto-listing on the cron.</div>
                    )}
                    {data.listingEnv.issues.map((i, n) => (
                      <div key={n} className={i.level === "error" ? "text-red-700" : "text-amber-700"}>
                        <b>{i.level === "error" ? "✖" : "⚠"} {i.key}:</b> {i.message}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {/* Ramp price band */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-gray-500 flex items-center gap-2">
                    <ListChecks className="w-4 h-4" /> Ramp price band
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-xs text-gray-500 mb-2">
                    The ramp only lists products whose eBay sale price is in this range. Leave a field blank for no bound.
                    {(data.listingEnv.rampPriceRange.minPrice != null || data.listingEnv.rampPriceRange.maxPrice != null) && (
                      <span className="ml-1 text-gray-700">
                        Current: {data.listingEnv.rampPriceRange.minPrice ?? "0"} – {data.listingEnv.rampPriceRange.maxPrice ?? "∞"} €
                      </span>
                    )}
                  </div>
                  <div className="flex items-end gap-2 flex-wrap">
                    <div>
                      <label className="text-xs text-gray-500 block">Min €</label>
                      <Input type="number" min="0" step="0.01" value={priceMin} onChange={(e) => setPriceMin(e.target.value)} placeholder="any" className="w-28" />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 block">Max €</label>
                      <Input type="number" min="0" step="0.01" value={priceMax} onChange={(e) => setPriceMax(e.target.value)} placeholder="any" className="w-28" />
                    </div>
                    <Button size="sm" onClick={() => saveBand.mutate()} disabled={saveBand.isPending}>Save band</Button>
                    {(priceMin !== "" || priceMax !== "") && (
                      <Button size="sm" variant="outline" onClick={() => { setPriceMin(""); setPriceMax(""); }}>
                        Clear
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Preview result */}
              {preview && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-gray-500 flex items-center gap-2">
                      <Eye className="w-4 h-4" /> Preview — would publish next
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm">
                    {preview.error ? (
                      <div className="text-red-700">{preview.error}</div>
                    ) : (
                      <>
                        <div className="text-gray-700 mb-2">
                          <b>{preview.wouldPublishNow}</b> products would be published in the next batch;{" "}
                          <b>{preview.totalCandidatesRemaining}</b> total candidates remaining.
                          {" "}<span className="text-gray-400">Nothing was sent to eBay.</span>
                        </div>
                        <div className="overflow-x-auto border rounded">
                          <table className="w-full text-xs">
                            <thead className="bg-gray-50 text-gray-500">
                              <tr><th className="text-left p-2">SKU</th><th className="text-left p-2">Name</th><th className="text-right p-2">Stock</th><th className="text-right p-2">Sale €</th></tr>
                            </thead>
                            <tbody>
                              {(preview.sample || []).map((p: any) => (
                                <tr key={p.id} className="border-t"><td className="p-2 font-mono">{p.sku}</td><td className="p-2 truncate max-w-md">{p.name}</td><td className="p-2 text-right">{p.stock}</td><td className="p-2 text-right">{p.salePrice}</td></tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>
              )}

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

              {/* Per-run sync history + per-SKU change detail now live together
                  in the Sync Activity tab, so there's a single home for it. */}
              <Card>
                <CardContent className="flex items-center justify-between gap-3 py-3 text-sm text-gray-600">
                  <span>
                    Sync run history and per-SKU changes are in the{" "}
                    <strong>Sync Activity</strong> tab.
                  </span>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

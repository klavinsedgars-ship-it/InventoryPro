/**
 * Competitor Repricing — SHADOW analytics.
 *
 * Surfaces a per-SKU comparison of our sale price vs the cheapest live eBay
 * competitor listings (Browse API). Nothing on this page modifies a listing
 * or pushes a price — operators use it to decide whether competitive
 * repricing would be worth wiring up for real.
 */
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Equal,
  AlertCircle,
  Eye,
  Scale,
} from "lucide-react";

interface Snapshot {
  id: number;
  productId: number;
  sku: string;
  marketplace: string;
  searchQuery: string;
  ourPrice: string | null;
  cheapestPrice: string | null;
  top3AvgPrice: string | null;
  sampleCount: number;
  currency: string | null;
  signal: string;
  deltaPct: string | null;
  recommendedPrice: string | null;
  errorMessage: string | null;
  createdAt: string;
}

interface Stats {
  totalSnapshots: number;
  productsCovered: number;
  bySignal: Record<string, number>;
  avgOverpricedPct: number | null;
  avgUnderpricedPct: number | null;
  lastCheckedAt: string | null;
  listedTotal: number;
  listedWithEan: number;
}

const PAGE_SIZE = 50;

const SIGNALS = [
  { value: "all", label: "All signals" },
  { value: "overpriced", label: "Overpriced (we're above market)" },
  { value: "underpriced", label: "Underpriced (leaving margin)" },
  { value: "in_line", label: "In line with market" },
  { value: "thin_market", label: "Thin market (<3 samples)" },
  { value: "no_data", label: "No data" },
];

function signalBadge(signal: string) {
  switch (signal) {
    case "overpriced":
      return (
        <Badge className="bg-red-500 hover:bg-red-500">
          <TrendingUp className="mr-1 h-3 w-3" />
          Overpriced
        </Badge>
      );
    case "underpriced":
      return (
        <Badge className="bg-amber-500 hover:bg-amber-500">
          <TrendingDown className="mr-1 h-3 w-3" />
          Underpriced
        </Badge>
      );
    case "in_line":
      return (
        <Badge className="bg-green-600 hover:bg-green-600">
          <Equal className="mr-1 h-3 w-3" />
          In line
        </Badge>
      );
    case "thin_market":
      return (
        <Badge variant="outline" className="border-amber-300 text-amber-700">
          Thin market
        </Badge>
      );
    case "no_data":
    default:
      return (
        <Badge variant="outline" className="text-gray-500">
          No data
        </Badge>
      );
  }
}

function money(v: string | number | null | undefined): string {
  if (v == null) return "—";
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? `€${n.toFixed(2)}` : "—";
}

function ago(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "just now";
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function StatTile({
  icon,
  label,
  value,
  sub,
  tone = "default",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "warn" | "danger" | "good";
}) {
  const toneCls =
    tone === "warn"
      ? "text-amber-600"
      : tone === "danger"
        ? "text-red-600"
        : tone === "good"
          ? "text-green-600"
          : "text-gray-900";
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs text-gray-500">
          {icon}
          <span>{label}</span>
        </div>
        <div className={`mt-1 text-2xl font-semibold ${toneCls}`}>{value}</div>
        {sub && <div className="text-xs text-gray-400">{sub}</div>}
      </CardContent>
    </Card>
  );
}

export function Repricing() {
  const [signal, setSignal] = useState("all");
  const [skuInput, setSkuInput] = useState("");
  const [sku, setSku] = useState("");
  const [page, setPage] = useState(0);

  const params = new URLSearchParams({
    limit: String(PAGE_SIZE),
    offset: String(page * PAGE_SIZE),
  });
  if (signal !== "all") params.set("signal", signal);
  if (sku) params.set("sku", sku);

  const statsQ = useQuery<{ success: boolean; stats: Stats }>({
    queryKey: ["/api/repricing/stats"],
    refetchInterval: 60_000,
  });
  const snapshotsQ = useQuery<{
    success: boolean;
    rows: Snapshot[];
    total: number;
  }>({
    queryKey: [`/api/repricing/snapshots?${params.toString()}`],
    refetchInterval: 60_000,
  });

  const refreshMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/repricing/refresh", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 200 }),
      });
      if (!r.ok) {
        const txt = await r.text();
        throw new Error(txt || `HTTP ${r.status}`);
      }
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/repricing/stats"] });
      queryClient.invalidateQueries({
        queryKey: [`/api/repricing/snapshots?${params.toString()}`],
      });
    },
  });

  const stats = statsQ.data?.stats;
  const rows = snapshotsQ.data?.rows ?? [];
  const total = snapshotsQ.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const applyFilter = (fn: () => void) => {
    fn();
    setPage(0);
  };

  return (
    <div className="p-6 space-y-4 max-w-screen-2xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Scale className="h-6 w-6 text-blue-600" />
            Competitor Repricing
          </h1>
          <p className="text-sm text-gray-500">
            Shadow analytics — compare our prices against live eBay competitors. Nothing on
            this page modifies a listing or pushes a price to eBay.
          </p>
        </div>
        <Button
          onClick={() => refreshMutation.mutate()}
          disabled={refreshMutation.isPending}
          className="bg-blue-600 hover:bg-blue-700"
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${refreshMutation.isPending ? "animate-spin" : ""}`} />
          {refreshMutation.isPending ? "Checking…" : "Refresh from eBay"}
        </Button>
      </div>

      {/* Shadow-mode banner — explicit at the top so this can't be confused
          with the real pricing path. */}
      <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
        <strong>Shadow mode.</strong> The numbers below are observations from the eBay
        Browse API and a “market floor minus 2%” recommendation. Your actual sale
        prices are not changed and no listing is updated.
      </div>

      {/* EAN coverage — match quality depends on this. Listed products without
          an EAN fall back to SKU search, which usually returns "thin market". */}
      {stats && stats.listedTotal > 0 && (() => {
        const pct = (stats.listedWithEan / stats.listedTotal) * 100;
        const missing = stats.listedTotal - stats.listedWithEan;
        const tone = pct >= 90 ? "good" : pct >= 60 ? "warn" : "danger";
        const cls =
          tone === "good"
            ? "border-green-200 bg-green-50 text-green-800"
            : tone === "warn"
              ? "border-amber-200 bg-amber-50 text-amber-800"
              : "border-red-200 bg-red-50 text-red-800";
        return (
          <div className={`rounded-lg border px-4 py-3 text-sm ${cls}`}>
            <strong>EAN coverage:</strong>{" "}
            {stats.listedWithEan.toLocaleString()} of {stats.listedTotal.toLocaleString()} listed
            products have an EAN ({pct.toFixed(0)}%).{" "}
            {missing > 0 && (
              <>
                The {missing.toLocaleString()} without one fall back to SKU search and
                usually land in <em>thin market</em>. Re-importing them via TME Browser
                or a full sync will populate the EAN when TME has it.
              </>
            )}
          </div>
        );
      })()}

      {refreshMutation.isError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <AlertCircle className="mr-2 inline h-4 w-4" />
          {(refreshMutation.error as Error)?.message || "Refresh failed"}
        </div>
      )}
      {refreshMutation.isSuccess && refreshMutation.data && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          Checked {refreshMutation.data.checked} product(s):{" "}
          {refreshMutation.data.ok} OK, {refreshMutation.data.failed} failed.
        </div>
      )}

      {/* Headline stats */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <StatTile
          icon={<Eye className="h-3.5 w-3.5" />}
          label="Products covered"
          value={(stats?.productsCovered ?? 0).toLocaleString()}
          sub={stats?.lastCheckedAt ? `last check ${ago(stats.lastCheckedAt)}` : "no checks yet"}
        />
        <StatTile
          icon={<TrendingUp className="h-3.5 w-3.5" />}
          label="Overpriced"
          value={(stats?.bySignal?.overpriced ?? 0).toLocaleString()}
          sub={stats?.avgOverpricedPct != null ? `avg +${stats.avgOverpricedPct.toFixed(1)}% above` : undefined}
          tone="danger"
        />
        <StatTile
          icon={<TrendingDown className="h-3.5 w-3.5" />}
          label="Underpriced"
          value={(stats?.bySignal?.underpriced ?? 0).toLocaleString()}
          sub={stats?.avgUnderpricedPct != null ? `avg ${stats.avgUnderpricedPct.toFixed(1)}% below` : undefined}
          tone="warn"
        />
        <StatTile
          icon={<Equal className="h-3.5 w-3.5" />}
          label="In line"
          value={(stats?.bySignal?.in_line ?? 0).toLocaleString()}
          tone="good"
        />
        <StatTile
          icon={<AlertCircle className="h-3.5 w-3.5" />}
          label="Thin market"
          value={(stats?.bySignal?.thin_market ?? 0).toLocaleString()}
          sub="<3 samples"
          tone="warn"
        />
        <StatTile
          icon={<AlertCircle className="h-3.5 w-3.5" />}
          label="No data"
          value={(stats?.bySignal?.no_data ?? 0).toLocaleString()}
          sub="not found / error"
        />
      </div>

      {/* Filter row + table */}
      <Card>
        <CardHeader className="py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">
              Per-SKU comparison
              <span className="ml-2 text-sm font-normal text-gray-500">
                {total.toLocaleString()} record{total === 1 ? "" : "s"}
              </span>
            </CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  applyFilter(() => setSku(skuInput.trim()));
                }}
              >
                <Input
                  value={skuInput}
                  onChange={(e) => setSkuInput(e.target.value)}
                  placeholder="Filter by SKU…"
                  className="h-9 w-40"
                />
              </form>
              <Select value={signal} onValueChange={(v) => applyFilter(() => setSignal(v))}>
                <SelectTrigger className="h-9 w-60">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SIGNALS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                onClick={() => snapshotsQ.refetch()}
                disabled={snapshotsQ.isFetching}
              >
                <RefreshCw className={`h-4 w-4 ${snapshotsQ.isFetching ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Our price</TableHead>
                <TableHead>Market floor</TableHead>
                <TableHead>Top-3 avg</TableHead>
                <TableHead>Samples</TableHead>
                <TableHead>Signal</TableHead>
                <TableHead>Δ vs market</TableHead>
                <TableHead>Recommended</TableHead>
                <TableHead className="text-right">Checked</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {snapshotsQ.isLoading ? (
                <TableRow>
                  <TableCell colSpan={9} className="py-10 text-center text-sm text-gray-500">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="py-10 text-center text-sm text-gray-500">
                    No competitor snapshots yet. Click <strong>Refresh from eBay</strong>{" "}
                    to check competitor prices for your listed SKUs.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">
                      {r.sku}
                      <div className="font-sans text-[10px] text-gray-400">
                        {r.searchQuery && r.searchQuery !== r.sku ? "matched via EAN" : "matched via SKU"}
                      </div>
                    </TableCell>
                    <TableCell>{money(r.ourPrice)}</TableCell>
                    <TableCell>{money(r.cheapestPrice)}</TableCell>
                    <TableCell>{money(r.top3AvgPrice)}</TableCell>
                    <TableCell className="text-sm text-gray-600">{r.sampleCount}</TableCell>
                    <TableCell>{signalBadge(r.signal)}</TableCell>
                    <TableCell className={
                      r.deltaPct == null
                        ? "text-gray-400"
                        : parseFloat(r.deltaPct) > 0
                          ? "text-red-600"
                          : parseFloat(r.deltaPct) < 0
                            ? "text-amber-600"
                            : "text-gray-700"
                    }>
                      {r.deltaPct != null ? `${parseFloat(r.deltaPct) > 0 ? "+" : ""}${parseFloat(r.deltaPct).toFixed(1)}%` : "—"}
                    </TableCell>
                    <TableCell className="font-medium">{money(r.recommendedPrice)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right text-xs text-gray-500">
                      {ago(r.createdAt)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-end gap-3 text-sm text-gray-600">
          <span>
            Page {page + 1} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}

export default Repricing;

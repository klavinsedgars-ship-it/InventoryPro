import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
  ArrowRight,
  TrendingUp,
  Boxes,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  History,
} from "lucide-react";

interface AuditRow {
  id: number;
  productId: number | null;
  sku: string;
  source: string;
  priceChanged: boolean;
  stockChanged: boolean;
  oldSupplierPrice: string | null;
  newSupplierPrice: string | null;
  oldStock: number | null;
  newStock: number | null;
  ebayAction: string;
  ebayError: string | null;
  createdAt: string;
}

interface SyncRun {
  status: string;
  operation: string;
  message: string;
  syncedAt: string;
  changed: number | null;
  ebayUpdated: number | null;
  remaining: number | null;
  processed: number | null;
}

interface AuditResponse {
  success: boolean;
  rows: AuditRow[];
  total: number;
  sinceHours: number;
  recentRuns: SyncRun[];
  stats: {
    changed: number;
    priceChanged: number;
    stockChanged: number;
    ebayUpdated: number;
    ebayUnlisted: number;
    ebayRelisted: number;
    ebayFailed: number;
    skippedNoOffer: number;
    lastRunAt: string | null;
  };
}

// Compact "5h ago" / "23m ago" relative time.
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

const PAGE_SIZE = 50;

const WINDOWS = [
  { label: "Last 24h", value: "24" },
  { label: "Last 7 days", value: "168" },
  { label: "Last 30 days", value: "720" },
];

const EBAY_ACTIONS = [
  { label: "All eBay outcomes", value: "all" },
  { label: "Updated", value: "updated" },
  { label: "Unlisted (OOS)", value: "unlisted" },
  { label: "Relisted", value: "relisted" },
  { label: "Failed", value: "failed" },
  { label: "Relist suppressed (expected stock)", value: "relist_suppressed" },
  { label: "Skipped (legacy listing)", value: "skipped_no_offer" },
  { label: "Not listed", value: "not_listed" },
];

function ebayBadge(action: string) {
  switch (action) {
    case "updated":
      return <Badge className="bg-green-600 hover:bg-green-600">Updated</Badge>;
    case "relisted":
      return <Badge className="bg-emerald-600 hover:bg-emerald-600">Relisted</Badge>;
    case "unlisted":
      return <Badge className="bg-amber-500 hover:bg-amber-500">Unlisted (OOS)</Badge>;
    case "failed":
      return <Badge variant="destructive">Failed</Badge>;
    case "relist_suppressed":
      return (
        <Badge variant="outline" className="border-orange-300 text-orange-700">
          Relist held (expected stock)
        </Badge>
      );
    case "skipped_no_offer":
      return (
        <Badge variant="outline" className="border-amber-300 text-amber-700">
          Skipped (legacy)
        </Badge>
      );
    case "not_listed":
      return <Badge variant="secondary">Not listed</Badge>;
    default:
      return <Badge variant="outline">—</Badge>;
  }
}

function money(v: string | null): string {
  if (v == null) return "—";
  const n = parseFloat(v);
  return Number.isFinite(n) ? `€${n.toFixed(2)}` : "—";
}

function Delta({
  changed,
  oldV,
  newV,
}: {
  changed: boolean;
  oldV: string;
  newV: string;
}) {
  if (!changed) return <span className="text-gray-400">{newV}</span>;
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <span className="text-gray-500 line-through">{oldV}</span>
      <ArrowRight className="h-3 w-3 text-gray-400" />
      <span className="font-medium text-gray-900">{newV}</span>
    </span>
  );
}

function StatCard({
  icon,
  label,
  value,
  tone = "default",
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone?: "default" | "warn" | "danger" | "good";
}) {
  const toneClass =
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
        <div className={`mt-1 text-2xl font-semibold ${toneClass}`}>{value.toLocaleString()}</div>
      </CardContent>
    </Card>
  );
}

function runStatusDot(status: string) {
  const color =
    status === "success"
      ? "bg-green-500"
      : status === "partial"
        ? "bg-amber-500"
        : status === "error"
          ? "bg-red-500"
          : "bg-gray-300";
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} />;
}

// Plain-English health line derived from the per-run history + the change
// rollup. Answers the two questions operators actually have: "is it running?"
// and "did anything change?" — without making them reconcile two panels.
function HealthBanner({
  runs,
  lastChangeAt,
}: {
  runs: SyncRun[];
  lastChangeAt: string | null;
}) {
  const last = runs[0];
  if (!last) {
    return (
      <div className="rounded-lg border bg-gray-50 px-4 py-3 text-sm text-gray-600">
        No sync runs recorded yet. The cron runs hourly; you can also trigger one
        with <strong>Sync Now</strong>.
      </div>
    );
  }

  const remaining = last.remaining ?? 0;
  const lastRunMs = Date.now() - new Date(last.syncedAt).getTime();
  // Cron is hourly, so a gap beyond ~2h means it likely isn't firing.
  const stale = lastRunMs > 2 * 3600 * 1000;
  const errored = last.status === "error";

  let tone: "good" | "warn" | "danger";
  let headline: string;
  if (errored) {
    tone = "danger";
    headline = `Last sync run failed (${ago(last.syncedAt)})`;
  } else if (stale) {
    tone = "warn";
    headline = `No sync run in ${ago(last.syncedAt)} — the hourly cron may not be firing`;
  } else if (remaining > 0) {
    tone = "warn";
    headline = `Syncing — last check ${ago(last.syncedAt)}, ${remaining.toLocaleString()} products still queued`;
  } else {
    tone = "good";
    headline = `Sync healthy — last check ${ago(last.syncedAt)}, nothing stale`;
  }

  const toneCls =
    tone === "good"
      ? "border-green-200 bg-green-50 text-green-800"
      : tone === "warn"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : "border-red-200 bg-red-50 text-red-800";

  return (
    <div className={`rounded-lg border px-4 py-3 ${toneCls}`}>
      <div className="flex items-center gap-2 text-sm font-medium">
        {tone === "good" ? (
          <CheckCircle2 className="h-4 w-4" />
        ) : (
          <AlertTriangle className="h-4 w-4" />
        )}
        {headline}
      </div>
      <div className="mt-0.5 text-xs opacity-80">
        Last actual change {ago(lastChangeAt)}
        {lastChangeAt ? ` (${new Date(lastChangeAt).toLocaleString()})` : ""}. A run
        with “0 changed” is normal — it means nothing was stale, not that sync is
        broken.
      </div>
    </div>
  );
}

export function SyncActivity() {
  const [windowHours, setWindowHours] = useState("24");
  const [ebayAction, setEbayAction] = useState("all");
  const [skuInput, setSkuInput] = useState("");
  const [sku, setSku] = useState("");
  const [changedOnly, setChangedOnly] = useState(true);
  const [page, setPage] = useState(0);

  const params = new URLSearchParams({
    sinceHours: windowHours,
    limit: String(PAGE_SIZE),
    offset: String(page * PAGE_SIZE),
    changedOnly: String(changedOnly),
  });
  if (sku) params.set("sku", sku);
  if (ebayAction !== "all") params.set("ebayAction", ebayAction);

  const { data, isLoading, isFetching, refetch } = useQuery<AuditResponse>({
    queryKey: [`/api/sync/audit?${params.toString()}`],
    refetchInterval: 60000,
  });

  const stats = data?.stats;
  const rows = data?.rows ?? [];
  const recentRuns = data?.recentRuns ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const windowLabel = (WINDOWS.find((w) => w.value === windowHours)?.label ?? "Last 24h").toLowerCase();

  // Reset to first page whenever a filter changes.
  const applyFilter = (fn: () => void) => {
    fn();
    setPage(0);
  };

  return (
    <div className="space-y-4">
      {/* Plain-English health line — what most people are actually asking. */}
      <HealthBanner runs={recentRuns} lastChangeAt={stats?.lastRunAt ?? null} />

      {/* Stat rollup — explicitly scoped to the selected window so the totals
          don't read as "right now". */}
      <div>
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">
          Totals for {windowLabel}
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <StatCard icon={<TrendingUp className="h-3.5 w-3.5" />} label="Price changes" value={stats?.priceChanged ?? 0} />
          <StatCard icon={<Boxes className="h-3.5 w-3.5" />} label="Stock changes" value={stats?.stockChanged ?? 0} />
          <StatCard icon={<CheckCircle2 className="h-3.5 w-3.5" />} label="eBay updated" value={stats?.ebayUpdated ?? 0} tone="good" />
          <StatCard icon={<AlertTriangle className="h-3.5 w-3.5" />} label="eBay unlisted" value={stats?.ebayUnlisted ?? 0} tone="warn" />
          <StatCard icon={<XCircle className="h-3.5 w-3.5" />} label="eBay failed" value={stats?.ebayFailed ?? 0} tone="danger" />
          <StatCard icon={<AlertTriangle className="h-3.5 w-3.5" />} label="Skipped (legacy)" value={stats?.skippedNoOffer ?? 0} tone="warn" />
        </div>
      </div>

      {(stats?.skippedNoOffer ?? 0) > 0 && (
        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <strong>{stats?.skippedNoOffer}</strong> changed product(s) are listed on eBay via the legacy
          Trading API (no <code>offer_id</code>), so the sync can’t push price/stock to them. These need
          re-listing through the Inventory API to stay in sync.
        </div>
      )}

      <Card>
        <CardHeader className="py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">
              Per-SKU changes
              <span className="ml-2 text-sm font-normal text-gray-500">
                {total.toLocaleString()} record{total === 1 ? "" : "s"} · {windowLabel}
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
              <Select value={ebayAction} onValueChange={(v) => applyFilter(() => setEbayAction(v))}>
                <SelectTrigger className="h-9 w-52">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EBAY_ACTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={windowHours} onValueChange={(v) => applyFilter(() => setWindowHours(v))}>
                <SelectTrigger className="h-9 w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WINDOWS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <label className="flex items-center gap-1.5 text-sm text-gray-600">
                <Checkbox
                  checked={changedOnly}
                  onCheckedChange={(c) => applyFilter(() => setChangedOnly(!!c))}
                />
                Changed only
              </label>
              <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
                <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Supplier price</TableHead>
                <TableHead>Stock</TableHead>
                <TableHead>eBay</TableHead>
                <TableHead>Detail</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="text-right">When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-sm text-gray-500">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-sm text-gray-500">
                    No sync changes recorded in this window. Once the cron (or a manual “Sync Now”)
                    detects a TME price/stock change, it shows up here.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.sku}</TableCell>
                    <TableCell>
                      <Delta
                        changed={r.priceChanged}
                        oldV={money(r.oldSupplierPrice)}
                        newV={money(r.newSupplierPrice)}
                      />
                    </TableCell>
                    <TableCell>
                      <Delta
                        changed={r.stockChanged}
                        oldV={String(r.oldStock ?? "—")}
                        newV={String(r.newStock ?? "—")}
                      />
                    </TableCell>
                    <TableCell>{ebayBadge(r.ebayAction)}</TableCell>
                    <TableCell className="max-w-[220px] truncate text-xs text-gray-500" title={r.ebayError ?? ""}>
                      {r.ebayError ?? ""}
                    </TableCell>
                    <TableCell className="text-xs capitalize text-gray-500">{r.source}</TableCell>
                    <TableCell className="whitespace-nowrap text-right text-xs text-gray-500">
                      {new Date(r.createdAt).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Pagination */}
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

      {/* Per-run history — the old dashboard "Recent activity" feed, now living
          here so there's a single home for sync history. Each row is one cron
          (or manual) run; the table above is the per-SKU detail within them. */}
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4 text-gray-400" />
            Sync runs
            <span className="text-sm font-normal text-gray-500">
              each hourly cron / manual run
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y text-sm">
            {recentRuns.length === 0 ? (
              <div className="px-4 py-6 text-center text-gray-500">No sync runs recorded yet.</div>
            ) : (
              recentRuns.map((r, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                  {runStatusDot(r.status)}
                  <span className="w-16 shrink-0 text-gray-400">{ago(r.syncedAt)}</span>
                  <span className="shrink-0 capitalize text-gray-500">{r.status}</span>
                  <span className="truncate text-gray-700">
                    {r.changed != null ? (
                      <>
                        {r.changed.toLocaleString()} changed
                        {r.ebayUpdated != null && <> · {r.ebayUpdated} eBay updated</>}
                        {r.remaining != null && r.remaining > 0 && (
                          <> · <span className="text-amber-600">{r.remaining.toLocaleString()} remaining</span></>
                        )}
                        {r.remaining === 0 && <> · caught up</>}
                      </>
                    ) : (
                      r.message
                    )}
                  </span>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

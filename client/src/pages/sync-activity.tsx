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

interface AuditResponse {
  success: boolean;
  rows: AuditRow[];
  total: number;
  sinceHours: number;
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
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Reset to first page whenever a filter changes.
  const applyFilter = (fn: () => void) => {
    fn();
    setPage(0);
  };

  return (
    <div className="space-y-4">
      {/* Stat rollup */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <StatCard icon={<TrendingUp className="h-3.5 w-3.5" />} label="Price changes" value={stats?.priceChanged ?? 0} />
        <StatCard icon={<Boxes className="h-3.5 w-3.5" />} label="Stock changes" value={stats?.stockChanged ?? 0} />
        <StatCard icon={<CheckCircle2 className="h-3.5 w-3.5" />} label="eBay updated" value={stats?.ebayUpdated ?? 0} tone="good" />
        <StatCard icon={<AlertTriangle className="h-3.5 w-3.5" />} label="eBay unlisted" value={stats?.ebayUnlisted ?? 0} tone="warn" />
        <StatCard icon={<XCircle className="h-3.5 w-3.5" />} label="eBay failed" value={stats?.ebayFailed ?? 0} tone="danger" />
        <StatCard icon={<AlertTriangle className="h-3.5 w-3.5" />} label="Skipped (legacy)" value={stats?.skippedNoOffer ?? 0} tone="warn" />
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
              Sync Activity
              <span className="ml-2 text-sm font-normal text-gray-500">
                {total.toLocaleString()} record{total === 1 ? "" : "s"}
                {stats?.lastRunAt ? ` · last change ${new Date(stats.lastRunAt).toLocaleString()}` : ""}
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
    </div>
  );
}

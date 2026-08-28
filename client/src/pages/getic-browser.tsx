import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  Search,
  RefreshCw,
  Download,
  Eye,
  FlaskConical,
  ChevronLeft,
  ChevronRight,
  Package,
  AlertTriangle,
  ExternalLink,
} from "lucide-react";

/*
 * Getic feed browser — STAGING ONLY.
 *
 * Everything on this page reads and writes supplier_offers, never products.
 * A Getic offer cannot reach eBay, the listing ramp, or TME sync from here;
 * promotion into the live catalogue is a separate step that does not exist
 * yet, on purpose.
 */

interface GeticOffer {
  id: number;
  supplier_sku: string;
  name: string | null;
  ean: string | null;
  manufacturer: string | null;
  mpn: string | null;
  category_path: string | null;
  price: string | null;
  currency: string | null;
  stock: number | null;
  weight_g: string | null;
  image_url: string | null;
  product_url: string | null;
  last_seen_at: string | null;
}

interface GeticStatus {
  ok: boolean;
  feedUrl: string;
  counts: {
    total: number;
    in_stock: number;
    with_ean: number;
    with_weight: number;
    with_image: number;
    with_price: number;
    last_seen_at: string | null;
  } | null;
  runs: Array<{
    id: number;
    status: string;
    bytes: number | null;
    records_seen: number;
    records_upserted: number;
    records_failed: number;
    new_records: number;
    duplicate_skus: number;
    error: string | null;
    started_at: string | null;
    finished_at: string | null;
  }>;
}

const fmtPct = (part: number, total: number) => (total > 0 ? `${Math.round((part / total) * 100)}%` : "—");
const fmtPrice = (p: string | null, cur: string | null) =>
  p != null ? `${parseFloat(p).toFixed(2)} ${cur ?? ""}`.trim() : "—";

export default function GeticBrowser({ user }: { user?: any }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [inStockOnly, setInStockOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [probeOpen, setProbeOpen] = useState(false);
  const [preview, setPreview] = useState<any>(null);
  const [confirmImport, setConfirmImport] = useState(false);

  const { data: status, isLoading: statusLoading } = useQuery<GeticStatus>({
    queryKey: ["/api/getic/status"],
  });

  const offersKey = `/api/getic/offers?page=${page}&limit=50&search=${encodeURIComponent(search)}&category=${encodeURIComponent(category)}${inStockOnly ? "&inStockOnly=1" : ""}`;
  const { data: offersData, isLoading: offersLoading, isError: offersError, error: offersErr } = useQuery<any>({
    queryKey: [offersKey],
  });

  const { data: categoriesData } = useQuery<any>({
    queryKey: ["/api/getic/categories"],
  });

  const { data: probeData, isFetching: probeLoading, isError: probeError, error: probeErr, refetch: refetchProbe } = useQuery<any>({
    queryKey: ["/api/getic/probe"],
    enabled: probeOpen,
    staleTime: 60_000,
  });

  const { data: detailData, isFetching: detailLoading } = useQuery<any>({
    queryKey: [`/api/getic/offers/${detailId}`],
    enabled: detailId != null,
  });

  const dryRunMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/getic/import?dryRun=1&limit=25")).json(),
    onSuccess: (d: any) => setPreview(d),
    onError: (e: any) => toast({ title: "Dry run failed", description: e.message, variant: "destructive" }),
  });

  const importMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/getic/import")).json(),
    onSuccess: (d: any) => {
      setConfirmImport(false);
      if (!d.ok) {
        toast({ title: "Import failed", description: d.error, variant: "destructive" });
        return;
      }
      toast({
        title: d.status === "partial" ? "Import ran out of time — run again to continue" : "Feed imported",
        description: `${d.recordsSeen} records seen, ${d.recordsUpserted} upserted, ${d.newRecords} new, ${d.recordsFailed} failed`,
      });
      qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/getic/") });
    },
    onError: (e: any) => {
      setConfirmImport(false);
      toast({ title: "Import failed", description: e.message, variant: "destructive" });
    },
  });

  const counts = status?.counts;
  const lastRun = status?.runs?.[0];
  const offers: GeticOffer[] = offersData?.offers ?? [];
  const total: number = offersData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / 50));
  const categories: Array<{ category_path: string; count: number }> = categoriesData?.categories ?? [];
  const detail = detailData?.offer;

  const runSearch = () => {
    setPage(1);
    setSearch(searchInput.trim());
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar user={user} collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} />
      <div className={`transition-all duration-200 ${sidebarCollapsed ? "ml-16" : "ml-64"}`}>
        <Header
          title="Getic Browser"
          subtitle="Staging catalogue from the Getic XML feed — nothing here syncs to products or eBay"
        />

        <div className="p-6 space-y-6">
          {/* Feed actions + stats */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Package className="w-4 h-4" /> Getic feed
                  <span className="text-xs font-normal text-gray-400">{status?.feedUrl}</span>
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => { setProbeOpen(true); refetchProbe(); }} data-testid="button-probe">
                    <Eye className="w-4 h-4 mr-1" /> Probe feed
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => dryRunMutation.mutate()}
                    disabled={dryRunMutation.isPending}
                    data-testid="button-dry-run"
                  >
                    <FlaskConical className="w-4 h-4 mr-1" />
                    {dryRunMutation.isPending ? "Parsing…" : "Preview (dry run)"}
                  </Button>
                  {!confirmImport ? (
                    <Button size="sm" onClick={() => setConfirmImport(true)} disabled={importMutation.isPending} data-testid="button-import">
                      <Download className="w-4 h-4 mr-1" /> Import feed
                    </Button>
                  ) : (
                    <Button size="sm" variant="destructive" onClick={() => importMutation.mutate()} disabled={importMutation.isPending} data-testid="button-import-confirm">
                      {importMutation.isPending ? (
                        <><RefreshCw className="w-4 h-4 mr-1 animate-spin" /> Importing… (can take minutes)</>
                      ) : (
                        "Confirm: import whole feed"
                      )}
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {statusLoading ? (
                <p className="text-sm text-gray-500">Loading status…</p>
              ) : (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
                    <Stat label="Products" value={counts ? String(counts.total) : "0"} />
                    <Stat label="In stock" value={counts ? `${counts.in_stock} (${fmtPct(counts.in_stock, counts.total)})` : "—"} />
                    <Stat label="With price" value={counts ? fmtPct(counts.with_price, counts.total) : "—"} />
                    <Stat label="With EAN" value={counts ? fmtPct(counts.with_ean, counts.total) : "—"} />
                    <Stat label="With weight" value={counts ? fmtPct(counts.with_weight, counts.total) : "—"} />
                    <Stat label="With image" value={counts ? fmtPct(counts.with_image, counts.total) : "—"} />
                  </div>
                  {lastRun && (
                    <p className="text-xs text-gray-500 mt-3">
                      Last import: <Badge variant={lastRun.status === "completed" ? "default" : lastRun.status === "failed" ? "destructive" : "secondary"}>{lastRun.status}</Badge>{" "}
                      {lastRun.records_seen} seen, {lastRun.records_upserted} upserted, {lastRun.new_records} new,{" "}
                      {lastRun.records_failed} failed{lastRun.duplicate_skus ? `, ${lastRun.duplicate_skus} duplicate SKUs` : ""}
                      {lastRun.started_at ? ` — ${new Date(lastRun.started_at).toLocaleString()}` : ""}
                      {lastRun.error && (
                        <span className="text-red-600 block mt-1">
                          <AlertTriangle className="w-3 h-3 inline mr-1" />
                          {lastRun.error}
                        </span>
                      )}
                    </p>
                  )}
                  {counts?.total === 0 && !lastRun && (
                    <p className="text-sm text-gray-500 mt-3">
                      Nothing imported yet. Start with <b>Probe feed</b> to see what the XML looks like, then{" "}
                      <b>Preview (dry run)</b> to check the field mapping, then import.
                    </p>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {/* Filters */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-gray-400" />
              <Input
                className="pl-8 w-72"
                placeholder="Search name, SKU, EAN, manufacturer…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && runSearch()}
                data-testid="input-search"
              />
            </div>
            <Button variant="outline" size="sm" onClick={runSearch}>Search</Button>
            <Select value={category || "__all"} onValueChange={(v) => { setCategory(v === "__all" ? "" : v); setPage(1); }}>
              <SelectTrigger className="w-72" data-testid="select-category">
                <SelectValue placeholder="All categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All categories</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c.category_path} value={c.category_path}>
                    {c.category_path} ({c.count})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <Checkbox checked={inStockOnly} onCheckedChange={(v) => { setInStockOnly(!!v); setPage(1); }} data-testid="checkbox-in-stock" />
              In stock only
            </label>
            <span className="text-sm text-gray-500 ml-auto">{total} product(s)</span>
          </div>

          {/* Catalogue table */}
          <Card>
            <CardContent className="p-0">
              {offersError ? (
                <p className="p-6 text-sm text-red-600">
                  <AlertTriangle className="w-4 h-4 inline mr-1" />
                  Could not load offers: {(offersErr as Error)?.message}
                </p>
              ) : offersLoading ? (
                <p className="p-6 text-sm text-gray-500">Loading…</p>
              ) : offers.length === 0 ? (
                <p className="p-6 text-sm text-gray-500">No offers match. Import the feed first, or clear the filters.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-gray-50 text-left text-xs uppercase text-gray-500">
                        <th className="px-4 py-2 w-12"></th>
                        <th className="px-4 py-2">SKU</th>
                        <th className="px-4 py-2">Name</th>
                        <th className="px-4 py-2">Manufacturer</th>
                        <th className="px-4 py-2 text-right">Price</th>
                        <th className="px-4 py-2 text-right">Stock</th>
                        <th className="px-4 py-2 text-right">Weight</th>
                        <th className="px-4 py-2">EAN</th>
                        <th className="px-4 py-2">Category</th>
                      </tr>
                    </thead>
                    <tbody>
                      {offers.map((o) => (
                        <tr
                          key={o.id}
                          className="border-b hover:bg-blue-50 cursor-pointer"
                          onClick={() => setDetailId(o.id)}
                          data-testid={`row-offer-${o.id}`}
                        >
                          <td className="px-4 py-2">
                            {o.image_url ? (
                              <img src={o.image_url} alt="" className="w-8 h-8 object-contain rounded" loading="lazy" />
                            ) : (
                              <div className="w-8 h-8 bg-gray-100 rounded" />
                            )}
                          </td>
                          <td className="px-4 py-2 font-mono text-xs whitespace-nowrap">{o.supplier_sku}</td>
                          <td className="px-4 py-2 max-w-md truncate">{o.name ?? "—"}</td>
                          <td className="px-4 py-2 whitespace-nowrap">{o.manufacturer ?? "—"}</td>
                          <td className="px-4 py-2 text-right whitespace-nowrap">{fmtPrice(o.price, o.currency)}</td>
                          <td className="px-4 py-2 text-right">{o.stock ?? "?"}</td>
                          <td className="px-4 py-2 text-right whitespace-nowrap">{o.weight_g != null ? `${parseFloat(o.weight_g)} g` : "—"}</td>
                          <td className="px-4 py-2 font-mono text-xs">{o.ean ?? "—"}</td>
                          <td className="px-4 py-2 max-w-xs truncate text-xs text-gray-500">{o.category_path ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                <ChevronLeft className="w-4 h-4" /> Prev
              </Button>
              <span className="text-sm text-gray-600">Page {page} / {totalPages}</span>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                Next <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Probe dialog */}
      <Dialog open={probeOpen} onOpenChange={setProbeOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Feed probe</DialogTitle>
            <DialogDescription>What the XML actually looks like — fetched live, nothing written.</DialogDescription>
          </DialogHeader>
          {probeLoading ? (
            <p className="text-sm text-gray-500">Fetching feed…</p>
          ) : probeError ? (
            <p className="text-sm text-red-600">{(probeErr as Error)?.message}</p>
          ) : probeData ? (
            <ScrollArea className="max-h-[65vh]">
              <div className="space-y-3 text-sm pr-4">
                <p>
                  HTTP {probeData.httpStatus} · {probeData.contentType ?? "no content-type"} ·{" "}
                  {(probeData.bytes / 1e6).toFixed(1)} MB · encoding {probeData.encoding} · root{" "}
                  <code>&lt;{probeData.structure?.rootElement}&gt;</code> · record element{" "}
                  <code>&lt;{probeData.recordElement ?? "?"}&gt;</code> ×{probeData.structure?.recordCount}
                </p>
                <div>
                  <p className="font-medium mb-1">First record, parsed</p>
                  <pre className="bg-gray-50 rounded p-3 text-xs overflow-x-auto">{JSON.stringify(probeData.firstRecordJson, null, 2)}</pre>
                </div>
                <div>
                  <p className="font-medium mb-1">How the mapper reads it</p>
                  <pre className="bg-gray-50 rounded p-3 text-xs overflow-x-auto">{JSON.stringify(probeData.mappedPreview?.[0]?.sourceKeys ?? {}, null, 2)}</pre>
                </div>
                <div>
                  <p className="font-medium mb-1">Raw head</p>
                  <pre className="bg-gray-50 rounded p-3 text-xs overflow-x-auto whitespace-pre-wrap">{probeData.head}</pre>
                </div>
              </div>
            </ScrollArea>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Dry-run preview dialog */}
      <Dialog open={preview != null} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Dry run — first {preview?.recordsSeen ?? 0} records</DialogTitle>
            <DialogDescription>Parsed and mapped in memory; nothing was written.</DialogDescription>
          </DialogHeader>
          {preview && (
            <ScrollArea className="max-h-[65vh]">
              <div className="space-y-3 text-sm pr-4">
                {!preview.ok && <p className="text-red-600">{preview.error}</p>}
                <div>
                  <p className="font-medium mb-1">Coverage in sample</p>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(preview.coverage ?? {}).map(([k, v]) => (
                      <Badge key={k} variant="outline">{k}: {String(v)}/{preview.recordsSeen}</Badge>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="font-medium mb-1">Field mapping (first record)</p>
                  <pre className="bg-gray-50 rounded p-3 text-xs overflow-x-auto">{JSON.stringify(preview.mappingSample ?? {}, null, 2)}</pre>
                </div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-left uppercase text-gray-500">
                      <th className="px-2 py-1">SKU</th>
                      <th className="px-2 py-1">Name</th>
                      <th className="px-2 py-1 text-right">Price</th>
                      <th className="px-2 py-1 text-right">Stock</th>
                      <th className="px-2 py-1 text-right">Weight g</th>
                      <th className="px-2 py-1">EAN</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(preview.sample ?? []).map((s: any, i: number) => (
                      <tr key={i} className="border-b">
                        <td className="px-2 py-1 font-mono">{s.supplierSku ?? "∅"}</td>
                        <td className="px-2 py-1 max-w-sm truncate">{s.name ?? "—"}</td>
                        <td className="px-2 py-1 text-right">{s.price ?? "—"}</td>
                        <td className="px-2 py-1 text-right">{s.stock ?? "?"}</td>
                        <td className="px-2 py-1 text-right">{s.weightG ?? "—"}</td>
                        <td className="px-2 py-1 font-mono">{s.ean ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>

      {/* Offer detail dialog */}
      <Dialog open={detailId != null} onOpenChange={(o) => !o && setDetailId(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="font-mono text-base">{detail?.supplier_sku ?? "…"}</DialogTitle>
            <DialogDescription className="line-clamp-2">{detail?.name}</DialogDescription>
          </DialogHeader>
          {detailLoading ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : detail ? (
            <ScrollArea className="max-h-[65vh]">
              <div className="space-y-4 text-sm pr-4">
                <div className="flex gap-4">
                  {detail.image_url && (
                    <img src={detail.image_url} alt="" className="w-32 h-32 object-contain rounded border" />
                  )}
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm flex-1">
                    <Field k="Price" v={fmtPrice(detail.price, detail.currency)} />
                    <Field k="Stock" v={detail.stock ?? "unknown"} />
                    <Field k="Weight" v={detail.weight_g != null ? `${parseFloat(detail.weight_g)} g` : "—"} />
                    <Field k="EAN" v={detail.ean ?? "—"} mono />
                    <Field k="Manufacturer" v={detail.manufacturer ?? "—"} />
                    <Field k="MPN" v={detail.mpn ?? "—"} mono />
                    <Field k="Category" v={detail.category_path ?? "—"} />
                    <Field k="Last seen" v={detail.last_seen_at ? new Date(detail.last_seen_at).toLocaleString() : "—"} />
                  </div>
                </div>
                {detail.product_url && (
                  <a href={detail.product_url} target="_blank" rel="noreferrer" className="text-blue-600 inline-flex items-center gap-1">
                    Product page <ExternalLink className="w-3 h-3" />
                  </a>
                )}
                {detail.description && (
                  <div>
                    <p className="font-medium mb-1">Description</p>
                    <p className="text-xs text-gray-600 whitespace-pre-wrap max-h-40 overflow-y-auto">{detail.description}</p>
                  </div>
                )}
                {detail.attributes && (
                  <div>
                    <p className="font-medium mb-1">Unmapped feed fields</p>
                    <pre className="bg-gray-50 rounded p-3 text-xs overflow-x-auto">{JSON.stringify(JSON.parse(detail.attributes), null, 2)}</pre>
                  </div>
                )}
                {detail.raw && (
                  <div>
                    <p className="font-medium mb-1">Raw record</p>
                    <pre className="bg-gray-50 rounded p-3 text-xs overflow-x-auto">{JSON.stringify(JSON.parse(detail.raw), null, 2)}</pre>
                  </div>
                )}
              </div>
            </ScrollArea>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-gray-500 uppercase">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}

function Field({ k, v, mono }: { k: string; v: string | number; mono?: boolean }) {
  return (
    <>
      <span className="text-gray-500">{k}</span>
      <span className={mono ? "font-mono text-xs" : ""}>{String(v)}</span>
    </>
  );
}

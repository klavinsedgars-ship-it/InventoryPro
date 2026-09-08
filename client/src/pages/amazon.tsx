import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { AlertTriangle, CheckCircle2, Plug, RefreshCw, Search, ShoppingCart } from "lucide-react";

/*
 * Amazon readiness and catalogue matching.
 *
 * We sell on Amazon as OFFERS on existing ASINs, so the catalogue match is the
 * gate: a product with no ASIN cannot be listed at all. This page shows how
 * far the match has got and why the rest is blocked, and it works before any
 * credentials exist — the config card reports what is still missing.
 */

interface AmazonStatus {
  ok: boolean;
  config: {
    configured: boolean;
    missing: string[];
    present: string[];
    target: { region: string; endpoint: string; marketplace: string; marketplaceId: string; currency: string; sandbox: boolean };
  };
  matching: { cursor: number; total: number; unchecked: number; byStatus: Record<string, number> } | null;
  listing: { ready_to_list: number; listed: number; listing_errors: number } | null;
  sweepEnabled: boolean;
}

const MATCH_LABELS: Record<string, { label: string; hint: string; tone: "good" | "warn" | "bad" }> = {
  matched: { label: "Matched", hint: "ASIN found — listable", tone: "good" },
  no_asin: { label: "No ASIN", hint: "Amazon has no entry for this barcode", tone: "warn" },
  ambiguous: { label: "Ambiguous", hint: "several ASINs, none confirmed — needs a human", tone: "warn" },
  no_ean: { label: "No EAN", hint: "no barcode, can never be an offer", tone: "bad" },
  error: { label: "Lookup error", hint: "retried on the next sweep pass", tone: "warn" },
};

export default function AmazonPage({ user }: { user?: any }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sku, setSku] = useState("");
  const [skuResult, setSkuResult] = useState<any>(null);

  const { data: status, isLoading } = useQuery<AmazonStatus>({
    queryKey: ["/api/amazon/status"],
    refetchInterval: 30_000,
  });

  const testMutation = useMutation({
    mutationFn: async () => (await apiRequest("GET", "/api/amazon/test-connection")).json(),
    onSuccess: (d: any) => {
      if (d.ok) {
        toast({
          title: "Amazon connection works",
          description: `${d.marketplaces?.filter((m: any) => m.canSell).length ?? 0} marketplace(s) available${d.configuredMarketplaceIsAvailable ? "" : " — but NOT the one configured"}`,
          variant: d.configuredMarketplaceIsAvailable ? "default" : "destructive",
        });
      } else {
        toast({ title: "Connection failed", description: d.error, variant: "destructive" });
      }
    },
    onError: (e: any) => toast({ title: "Connection failed", description: e.message, variant: "destructive" }),
  });

  const sweepMutation = useMutation({
    mutationFn: async (action: "start" | "stop") =>
      (await apiRequest("GET", `/api/amazon/match?sweep=${action}`)).json(),
    onSuccess: (d: any) => {
      qc.invalidateQueries({ queryKey: ["/api/amazon/status"] });
      toast({ title: d.enabled ? "Match sweep started" : "Match sweep stopped" });
    },
    onError: (e: any) => toast({ title: "Sweep failed", description: e.message, variant: "destructive" }),
  });

  const skuMutation = useMutation({
    mutationFn: async (which: "match" | "preview") =>
      which === "match"
        ? (await apiRequest("POST", `/api/amazon/match/${encodeURIComponent(sku.trim())}`)).json()
        : (await apiRequest("GET", `/api/amazon/preview/${encodeURIComponent(sku.trim())}`)).json(),
    onSuccess: (d: any) => setSkuResult(d),
    onError: (e: any) => toast({ title: "Lookup failed", description: e.message, variant: "destructive" }),
  });

  const cfg = status?.config;
  const m = status?.matching;
  const checked = m ? m.total - m.unchecked : 0;
  const pct = m && m.total > 0 ? Math.round((checked / m.total) * 100) : 0;

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar user={user} collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} />
      <div className={`transition-all duration-200 ${sidebarCollapsed ? "ml-16" : "ml-64"}`}>
        <Header title="Amazon" subtitle="Selling Partner API readiness and catalogue matching" />

        <div className="p-6 space-y-6">
          {/* Connection */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Plug className="w-4 h-4" /> Connection
                </CardTitle>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!cfg?.configured || testMutation.isPending}
                  onClick={() => testMutation.mutate()}
                  data-testid="button-test-connection"
                >
                  {testMutation.isPending ? <RefreshCw className="w-4 h-4 mr-1 animate-spin" /> : null}
                  Test connection
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <p className="text-sm text-gray-500">Loading…</p>
              ) : cfg?.configured ? (
                <div className="space-y-2 text-sm">
                  <p className="flex items-center gap-2 text-green-700">
                    <CheckCircle2 className="w-4 h-4" /> All credentials present
                  </p>
                  <p className="text-gray-600">
                    Target: <b>{cfg.target.marketplace}</b> ({cfg.target.marketplaceId}) · {cfg.target.currency} ·{" "}
                    {cfg.target.region.toUpperCase()} {cfg.target.sandbox && <Badge variant="secondary">sandbox</Badge>}
                  </p>
                </div>
              ) : (
                <div className="space-y-2 text-sm">
                  <p className="flex items-center gap-2 text-amber-700">
                    <AlertTriangle className="w-4 h-4" /> Not configured yet — set these environment variables in Vercel:
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {cfg?.missing.map((k) => (
                      <Badge key={k} variant="destructive" className="font-mono text-xs">{k}</Badge>
                    ))}
                    {cfg?.present.map((k) => (
                      <Badge key={k} variant="outline" className="font-mono text-xs text-green-700">{k} ✓</Badge>
                    ))}
                  </div>
                  <p className="text-xs text-gray-500">
                    Everything else on this page keeps working — matching and listing simply wait for credentials.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Catalogue matching */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Search className="w-4 h-4" /> Catalogue match (EAN → ASIN)
                </CardTitle>
                <div className="flex gap-2">
                  {status?.sweepEnabled ? (
                    <Button size="sm" variant="destructive" onClick={() => sweepMutation.mutate("stop")} disabled={sweepMutation.isPending}>
                      Stop sweep
                    </Button>
                  ) : (
                    <Button size="sm" onClick={() => sweepMutation.mutate("start")} disabled={!cfg?.configured || sweepMutation.isPending} data-testid="button-start-sweep">
                      Start match sweep
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-xs text-gray-500">
                Amazon offers attach to product pages that already exist, found by barcode. A product with no ASIN
                cannot be listed — this is the gate before any Amazon listing.
              </p>
              {m && (
                <>
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span>{checked.toLocaleString()} / {m.total.toLocaleString()} products checked</span>
                      <span className="text-gray-500">{pct}%</span>
                    </div>
                    <Progress value={pct} />
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    {Object.entries(MATCH_LABELS).map(([key, meta]) => (
                      <div key={key} className="border rounded p-3">
                        <p className="text-xs uppercase text-gray-500">{meta.label}</p>
                        <p className={`text-xl font-semibold ${meta.tone === "good" ? "text-green-700" : meta.tone === "bad" ? "text-red-600" : "text-amber-600"}`}>
                          {(m.byStatus[key] ?? 0).toLocaleString()}
                        </p>
                        <p className="text-[11px] text-gray-500 leading-tight mt-1">{meta.hint}</p>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Listing readiness */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <ShoppingCart className="w-4 h-4" /> Listing
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <p className="text-xs uppercase text-gray-500">Ready to list</p>
                  <p className="text-2xl font-semibold">{(status?.listing?.ready_to_list ?? 0).toLocaleString()}</p>
                  <p className="text-[11px] text-gray-500">matched, active, in stock</p>
                </div>
                <div>
                  <p className="text-xs uppercase text-gray-500">Listed</p>
                  <p className="text-2xl font-semibold">{(status?.listing?.listed ?? 0).toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-xs uppercase text-gray-500">Errors</p>
                  <p className="text-2xl font-semibold text-red-600">{(status?.listing?.listing_errors ?? 0).toLocaleString()}</p>
                </div>
              </div>
              <p className="text-xs text-gray-500 mt-4">
                There is no bulk Amazon ramp yet, on purpose: the first listings go through
                <code className="mx-1">/api/amazon/list/&lt;sku&gt;?dryRun=1</code>, which asks Amazon to validate the
                payload without creating anything.
              </p>
            </CardContent>
          </Card>

          {/* Per-SKU tools */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Check one SKU</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2 flex-wrap">
                <Input
                  className="w-64"
                  placeholder="SKU, e.g. GC-1234"
                  value={sku}
                  onChange={(e) => setSku(e.target.value)}
                  data-testid="input-sku"
                />
                <Button size="sm" variant="outline" disabled={!sku.trim() || skuMutation.isPending} onClick={() => skuMutation.mutate("preview")}>
                  Preview payload
                </Button>
                <Button size="sm" disabled={!sku.trim() || !cfg?.configured || skuMutation.isPending} onClick={() => skuMutation.mutate("match")}>
                  Match on Amazon
                </Button>
              </div>
              {skuResult && (
                <pre className="bg-gray-50 rounded p-3 text-xs overflow-x-auto max-h-96">{JSON.stringify(skuResult, null, 2)}</pre>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

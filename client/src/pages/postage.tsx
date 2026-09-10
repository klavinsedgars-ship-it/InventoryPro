import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { AlertTriangle, Check, Receipt, RefreshCw } from "lucide-react";

/*
 * Actual postage from Latvijas Pasts receipts.
 *
 * The P&L prices postage from the tariff book, which is exact for the class it
 * assumes but blind to what was chosen at the counter — a letter costs about
 * half a small packet. Typing a receipt in here replaces the estimate with the
 * real figure on each order it can identify.
 */

interface Match {
  line: {
    id: number;
    lineNo: string;
    description: string;
    postalClass: string;
    countryIso: string | null;
    grams: number | null;
    amount: number;
    tracked: boolean;
    trackingNumber: string | null;
    recipient: string | null;
  };
  cost: number;
  orderId: number | null;
  marketplaceOrderId: string | null;
  confidence: "tracking" | "name+country" | "name" | "none";
  alternatives: Array<{ orderId: number; marketplaceOrderId: string; shippingName: string }>;
  reason: string;
}

const CONFIDENCE: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  tracking: { label: "Tracking number", variant: "default" },
  "name+country": { label: "Name + country", variant: "secondary" },
  name: { label: "Name only", variant: "outline" },
  none: { label: "No match", variant: "destructive" },
};

export default function PostagePage({ user }: { user?: any }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<any>(null);
  const [chosen, setChosen] = useState<Record<number, number>>({}); // line id -> order id
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const { data: coverage } = useQuery<any>({ queryKey: ["/api/postage/coverage"] });

  const parseMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/postage/receipt/parse", { text })).json(),
    onSuccess: (d: any) => {
      if (!d.ok) {
        toast({ title: "Could not read the receipt", description: d.error, variant: "destructive" });
        return;
      }
      setParsed(d);
      // Pre-select everything the matcher identified confidently.
      const pre: Record<number, number> = {};
      const sel = new Set<number>();
      for (const m of d.matches as Match[]) {
        if (m.orderId != null) {
          pre[m.line.id] = m.orderId;
          if (m.confidence !== "name") sel.add(m.line.id);
        }
      }
      setChosen(pre);
      setSelected(sel);
    },
    onError: (e: any) => toast({ title: "Parse failed", description: e.message, variant: "destructive" }),
  });

  const applyMutation = useMutation({
    mutationFn: async () => {
      const assignments = (parsed.matches as Match[])
        .filter((m) => selected.has(m.line.id) && chosen[m.line.id])
        .map((m) => ({
          orderId: chosen[m.line.id],
          cost: m.cost,
          postalClass: m.line.postalClass,
          trackingNumber: m.line.trackingNumber ?? undefined,
        }));
      return (await apiRequest("POST", "/api/postage/receipt/apply", {
        reference: parsed.receipt.reference,
        assignments,
      })).json();
    },
    onSuccess: (d: any) => {
      qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/postage") });
      qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/reports") });
      toast({
        title: `Recorded on ${d.applied?.length ?? 0} order(s)`,
        description: d.skipped?.length ? `${d.skipped.length} skipped — see the list` : "Profit now uses the real figure",
      });
      if (d.skipped?.length) console.warn("skipped", d.skipped);
    },
    onError: (e: any) => toast({ title: "Apply failed", description: e.message, variant: "destructive" }),
  });

  const matches: Match[] = parsed?.matches ?? [];
  const selectable = matches.filter((m) => chosen[m.line.id]);

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar user={user} collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} />
      <div className={`transition-all duration-200 ${sidebarCollapsed ? "ml-16" : "ml-64"}`}>
        <Header title="Postage" subtitle="Record what shipping actually cost, from Latvijas Pasts receipts" />

        <div className="p-6 space-y-6">
          {coverage?.coverage && (
            <Card>
              <CardContent className="pt-6">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <Stat label="Orders" value={String(coverage.coverage.total ?? 0)} />
                  <Stat label="With real postage" value={String(coverage.coverage.receipted ?? 0)} />
                  <Stat label="Receipted spend" value={`€${Number(coverage.coverage.receipted_total ?? 0).toFixed(2)}`} />
                  <Stat
                    label="Shipped, still estimated"
                    value={String(coverage.coverage.shipped_without_receipt ?? 0)}
                    tone={coverage.coverage.shipped_without_receipt > 0 ? "warn" : undefined}
                  />
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Receipt className="w-4 h-4" /> Paste a receipt
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-gray-500">
                Type or paste the counter receipt exactly as printed — line numbers, service names, weights and prices.
                Nothing is written until you review the matches below.
              </p>
              <Textarea
                rows={10}
                className="font-mono text-xs"
                placeholder={"2510 862361            1   5,16   5,16 Z\n  Sīkpaka St ZVIEDRIJA 34g, A\nkl., Vienkārša-prece\n  Saņēmējs: ...\nUA700460292LV"}
                value={text}
                onChange={(e) => setText(e.target.value)}
                data-testid="input-receipt"
              />
              <Button size="sm" onClick={() => parseMutation.mutate()} disabled={!text.trim() || parseMutation.isPending} data-testid="button-parse">
                {parseMutation.isPending ? <RefreshCw className="w-4 h-4 mr-1 animate-spin" /> : null}
                Read receipt
              </Button>
            </CardContent>
          </Card>

          {parsed && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <CardTitle className="text-base">
                    {parsed.summary.shipments} shipment(s) · €{parsed.summary.totalCost.toFixed(2)}
                    {parsed.receipt.reference && (
                      <span className="ml-2 text-xs font-normal text-gray-400">{parsed.receipt.reference}</span>
                    )}
                  </CardTitle>
                  <Button
                    size="sm"
                    disabled={selected.size === 0 || applyMutation.isPending}
                    onClick={() => applyMutation.mutate()}
                    data-testid="button-apply"
                  >
                    {applyMutation.isPending ? <RefreshCw className="w-4 h-4 mr-1 animate-spin" /> : <Check className="w-4 h-4 mr-1" />}
                    Record on {selected.size} order(s)
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {parsed.warning && (
                  <p className="text-sm text-amber-700 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> {parsed.warning}
                  </p>
                )}
                {parsed.receipt.unparsed?.length > 0 && (
                  <p className="text-xs text-gray-500">
                    Not recognised: {parsed.receipt.unparsed.join(" · ")}
                  </p>
                )}

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-gray-50 text-left text-xs uppercase text-gray-500">
                        <th className="px-3 py-2 w-8">
                          <Checkbox
                            checked={selectable.length > 0 && selectable.every((m) => selected.has(m.line.id))}
                            onCheckedChange={(v) =>
                              setSelected(v ? new Set(selectable.map((m) => m.line.id)) : new Set())
                            }
                            aria-label="Select all matched"
                          />
                        </th>
                        <th className="px-3 py-2">Shipment</th>
                        <th className="px-3 py-2 text-right">Cost</th>
                        <th className="px-3 py-2">Matched order</th>
                        <th className="px-3 py-2">How</th>
                      </tr>
                    </thead>
                    <tbody>
                      {matches.map((m) => {
                        const conf = CONFIDENCE[m.confidence];
                        return (
                          <tr key={m.line.id} className="border-b align-top">
                            <td className="px-3 py-2">
                              {chosen[m.line.id] ? (
                                <Checkbox
                                  checked={selected.has(m.line.id)}
                                  onCheckedChange={(v) =>
                                    setSelected((prev) => {
                                      const next = new Set(prev);
                                      v ? next.add(m.line.id) : next.delete(m.line.id);
                                      return next;
                                    })
                                  }
                                  data-testid={`checkbox-line-${m.line.id}`}
                                />
                              ) : null}
                            </td>
                            <td className="px-3 py-2">
                              <div className="font-medium">
                                {m.line.countryIso ?? "??"} · {m.line.grams ?? "?"}g ·{" "}
                                <span className="text-gray-500">{m.line.postalClass}</span>
                                {m.line.tracked && <Badge variant="outline" className="ml-2 text-[10px]">tracked</Badge>}
                              </div>
                              <div className="text-xs text-gray-500">
                                {m.line.recipient ?? "no recipient on receipt"}
                                {m.line.trackingNumber ? ` · ${m.line.trackingNumber}` : ""}
                              </div>
                            </td>
                            <td className="px-3 py-2 text-right font-medium whitespace-nowrap">€{m.cost.toFixed(2)}</td>
                            <td className="px-3 py-2">
                              {m.orderId ? (
                                <span className="font-mono text-xs">{m.marketplaceOrderId}</span>
                              ) : m.alternatives.length > 0 ? (
                                <select
                                  className="border rounded text-xs p-1"
                                  value={chosen[m.line.id] ?? ""}
                                  onChange={(e) => {
                                    const id = Number(e.target.value);
                                    setChosen((p) => ({ ...p, [m.line.id]: id }));
                                    setSelected((p) => new Set(p).add(m.line.id));
                                  }}
                                  data-testid={`select-order-${m.line.id}`}
                                >
                                  <option value="">choose…</option>
                                  {m.alternatives.map((a) => (
                                    <option key={a.orderId} value={a.orderId}>
                                      {a.marketplaceOrderId} — {a.shippingName}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <span className="text-xs text-gray-400">—</span>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              <Badge variant={conf.variant} className="text-[10px] whitespace-nowrap">{conf.label}</Badge>
                              <div className="text-[11px] text-gray-500 mt-1 max-w-xs">{m.reason}</div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "warn" }) {
  return (
    <div>
      <p className="text-xs text-gray-500 uppercase">{label}</p>
      <p className={`text-xl font-semibold ${tone === "warn" ? "text-amber-600" : ""}`}>{value}</p>
    </div>
  );
}

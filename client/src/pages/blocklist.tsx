import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Ban, AlertTriangle, Trash2, ShieldCheck } from "lucide-react";

export default function Blocklist({ user }: { user?: any }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [codes, setCodes] = useState("");
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<any>(null);

  const { data } = useQuery<any>({
    queryKey: ["/api/blocklist"],
    queryFn: async () => {
      const r = await fetch("/api/blocklist", { credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
  });

  const previewMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/blocklist/preview", { codes })).json(),
    onSuccess: (d: any) => setPreview(d),
  });

  const blockMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/blocklist", { codes, reason })).json(),
    onSuccess: (d: any) => {
      if (!d.success) {
        toast({ title: "Could not block", description: d.error, variant: "destructive" });
        return;
      }
      toast({
        title: `Blocked ${d.added} product code(s)`,
        description:
          `${d.productsAffected} product(s) removed from sale` +
          (d.listingsEnded ? `, ${d.listingsEnded} eBay listing(s) ended` : "") +
          (d.endFailures?.length ? `. ${d.endFailures.length} listing(s) could NOT be ended — check them on eBay.` : ""),
        variant: d.endFailures?.length ? "destructive" : undefined,
      });
      setCodes(""); setReason(""); setPreview(null);
      qc.invalidateQueries({ queryKey: ["/api/blocklist"] });
      qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/products") });
    },
    onError: (e: any) => toast({ title: "Could not block", description: e.message, variant: "destructive" }),
  });

  const unblock = useMutation({
    mutationFn: async (code: string) => (await apiRequest("DELETE", `/api/blocklist/${encodeURIComponent(code)}`, {})).json(),
    onSuccess: (d: any) => {
      toast({ title: "Unblocked", description: d.note });
      qc.invalidateQueries({ queryKey: ["/api/blocklist"] });
    },
  });

  const blocked = data?.blocked ?? [];
  const stillListed = blocked.filter((b: any) => b.stillListed);

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar user={user} collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} />
      <div className={`transition-all duration-200 ${sidebarCollapsed ? "ml-16" : "ml-64"}`}>
        <Header title="Blocked Products" subtitle="Codes that must never be listed, synced, or imported again" />

        <div className="p-6 space-y-6 max-w-5xl">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Ban className="w-4 h-4" /> Block product codes
              </CardTitle>
              <p className="text-sm text-gray-500">
                Paste the codes from the eBay removal email — one per line, or comma separated.
                Blocking removes them from the catalogue, ends any live listing, stops them syncing,
                and prevents a future TME import from bringing them back.
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                rows={6}
                placeholder={"DF-DFR0077\nOKY3061\nSF-GPS-14030"}
                value={codes}
                onChange={(e) => { setCodes(e.target.value); setPreview(null); }}
                className="font-mono text-sm"
                data-testid="input-block-codes"
              />
              <Input
                placeholder="Reason (optional) — e.g. eBay policy removal, 27 Aug"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                data-testid="input-block-reason"
              />

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => previewMutation.mutate()}
                  disabled={!codes.trim() || previewMutation.isPending}
                  data-testid="btn-preview-block"
                >
                  Check first
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => {
                    const n = preview?.newCodes?.length ?? "these";
                    if (window.confirm(`Block ${n} product code(s)?\n\nAny live eBay listing will be ended and the products will stop syncing. This can be undone from this page.`)) {
                      blockMutation.mutate();
                    }
                  }}
                  disabled={!codes.trim() || blockMutation.isPending}
                  data-testid="btn-block"
                >
                  <Ban className="w-4 h-4 mr-2" />
                  {blockMutation.isPending ? "Blocking…" : "Block and remove"}
                </Button>
              </div>

              {preview && (
                <div className="text-sm border rounded p-3 bg-gray-50 space-y-1">
                  <p><strong>{preview.newCodes.length}</strong> new code(s) to block</p>
                  {preview.alreadyBlocked.length > 0 && (
                    <p className="text-gray-500">{preview.alreadyBlocked.length} already blocked</p>
                  )}
                  {preview.duplicates > 0 && <p className="text-gray-500">{preview.duplicates} duplicate(s) ignored</p>}
                  {preview.rejected.length > 0 && (
                    <div className="text-amber-700">
                      <p className="flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Not recognised as codes, ignored:</p>
                      <ul className="ml-4 list-disc text-xs">
                        {preview.rejected.slice(0, 5).map((r: string, i: number) => <li key={i}>{r}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {stillListed.length > 0 && (
            <Card className="border-red-200 bg-red-50">
              <CardContent className="py-3 text-sm text-red-900">
                <p className="font-medium flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" /> {stillListed.length} blocked product(s) still show as listed
                </p>
                <p className="text-xs mt-1">
                  The eBay withdrawal did not succeed for these. They cannot be relisted by this system,
                  but the existing listing may still be live — end it on eBay directly:{" "}
                  <span className="font-mono">{stillListed.map((b: any) => b.code).join(", ")}</span>
                </p>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldCheck className="w-4 h-4" /> Blocked ({blocked.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {blocked.length === 0 ? (
                <p className="text-sm text-gray-500">Nothing blocked yet.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-left text-gray-500">
                    <tr>
                      <th className="py-2 pr-3">Code</th>
                      <th className="py-2 pr-3">Product</th>
                      <th className="py-2 pr-3">Reason</th>
                      <th className="py-2 pr-3">Blocked</th>
                      <th className="py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {blocked.map((b: any) => (
                      <tr key={b.code} className="border-t">
                        <td className="py-2 pr-3 font-mono text-xs">{b.code}</td>
                        <td className="py-2 pr-3 max-w-xs truncate text-gray-600">
                          {b.name ?? <span className="text-gray-400">not in catalogue</span>}
                          {b.stillListed && <Badge variant="destructive" className="ml-2">still listed</Badge>}
                        </td>
                        <td className="py-2 pr-3 text-gray-500">{b.reason ?? "—"}</td>
                        <td className="py-2 pr-3 text-gray-400 text-xs">
                          {b.createdAt ? new Date(b.createdAt).toLocaleDateString() : "—"}
                        </td>
                        <td className="py-2 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => {
                              if (window.confirm(`Unblock ${b.code}? It becomes eligible for syncing and listing again.`)) {
                                unblock.mutate(b.code);
                              }
                            }}
                          >
                            <Trash2 className="w-3 h-3 mr-1" /> Unblock
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

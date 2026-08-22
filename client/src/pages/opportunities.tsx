/**
 * Opportunity Finder — "what should I list?", not "list everything".
 *
 * Ranks the whole TME catalogue by an intrinsic opportunity score (margin
 * headroom × availability × shippability × identifier quality), computed
 * DB-side so it scales to 100k with zero API calls. eBay Browse demand
 * (competitor count + market price) is layered on the top candidates via a
 * bounded "Check demand" action. Read-only — lists nothing.
 */
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { Target, RefreshCw, AlertCircle, Search } from "lucide-react";

interface Candidate {
  id: number;
  sku: string;
  name: string;
  category: string | null;
  ean: string | null;
  supplierPrice: string | null;
  salePrice: string | null;
  calculatedPrice: string | null;
  marginPercentage: string | null;
  stock: number;
  weight: string | null;
  listedOnEbay: boolean | null;
  score: number | null;
  finalScore: number | null;
  marketTotal: number | null;
  marketCheapest: string | null;
  marketSignal: string | null;
  demandCheckedAt: string | null;
  soldCount: number | null;
  avgSoldPrice: string | null;
  medianSoldPrice: string | null;
  soldWindowDays: number | null;
  insightsCheckedAt: string | null;
  insightsNotApproved: boolean | null;
}

const PAGE_SIZE = 50;

function money(v: string | number | null | undefined): string {
  if (v == null) return "—";
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? `€${n.toFixed(2)}` : "—";
}

function scoreBadge(score: number | null) {
  if (score == null) return <Badge variant="outline">—</Badge>;
  const cls =
    score >= 80
      ? "bg-green-600 hover:bg-green-600"
      : score >= 60
        ? "bg-emerald-500 hover:bg-emerald-500"
        : score >= 40
          ? "bg-amber-500 hover:bg-amber-500"
          : "bg-gray-400 hover:bg-gray-400";
  return <Badge className={cls}>{score.toFixed(0)}</Badge>;
}

// Demand band from the Browse competitor count. The sweet spot is moderate:
// 0 = no proven demand, very high = saturated.
function demandCell(c: Candidate) {
  if (c.demandCheckedAt == null) {
    return <span className="text-xs text-gray-400">not checked</span>;
  }
  const total = c.marketTotal ?? 0;
  let label: string;
  let cls: string;
  if (total === 0) {
    label = "no listings";
    cls = "text-gray-500";
  } else if (total <= 50) {
    label = `${total} — healthy`;
    cls = "text-green-600";
  } else if (total <= 200) {
    label = `${total} — busy`;
    cls = "text-amber-600";
  } else {
    label = `${total}+ — saturated`;
    cls = "text-red-600";
  }
  return (
    <div className="text-xs">
      <div className={cls}>{label}</div>
      {c.marketCheapest && <div className="text-gray-400">low {money(c.marketCheapest)}</div>}
    </div>
  );
}

export function Opportunities() {
  const [category, setCategory] = useState("all");
  const [minMarginInput, setMinMarginInput] = useState("");
  const [minMargin, setMinMargin] = useState("");
  const [hideListed, setHideListed] = useState(true);
  const [page, setPage] = useState(0);

  const params = new URLSearchParams({
    limit: String(PAGE_SIZE),
    offset: String(page * PAGE_SIZE),
    hideListed: String(hideListed),
  });
  if (category !== "all") params.set("category", category);
  if (minMargin) params.set("minMargin", minMargin);

  const categoriesQ = useQuery<{ success: boolean; categories: string[] }>({
    queryKey: ["/api/opportunities/categories"],
  });
  const listQ = useQuery<{ success: boolean; rows: Candidate[]; total: number }>({
    queryKey: [`/api/opportunities?${params.toString()}`],
  });

  // Invalidate EVERY opportunities page/filter combination, not just the
  // params in scope right now — the exact-key form left page 2 / other
  // filters serving pre-check cached rows forever (staleTime: Infinity).
  const invalidateOpportunities = () =>
    queryClient.invalidateQueries({
      predicate: (q) => String(q.queryKey[0] ?? "").startsWith("/api/opportunities"),
    });

  const checkDemand = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/opportunities/check-demand", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 100 }),
      });
      if (!r.ok) throw new Error((await r.text()) || `HTTP ${r.status}`);
      return r.json();
    },
    onSuccess: () => {
      invalidateOpportunities();
    },
  });

  const checkInsights = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/opportunities/check-insights", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 50, windowDays: 30 }),
      });
      if (!r.ok) throw new Error((await r.text()) || `HTTP ${r.status}`);
      return r.json();
    },
    onSuccess: () => {
      invalidateOpportunities();
    },
  });

  // Surface the eBay approval gate without making the operator click first.
  const insightsStatusQ = useQuery<{ success: boolean; notApproved: boolean }>({
    queryKey: ["/api/opportunities/insights-status"],
    refetchInterval: 300_000,
  });

  const rows = listQ.data?.rows ?? [];
  const total = listQ.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const categories = categoriesQ.data?.categories ?? [];

  const applyFilter = (fn: () => void) => {
    fn();
    setPage(0);
  };

  return (
    <AppShell>
      <div className="p-6 space-y-4 max-w-screen-2xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Target className="h-6 w-6 text-blue-600" />
            Opportunity Finder
          </h1>
          <p className="text-sm text-gray-500">
            Which products are worth listing — ranked by margin and availability (intrinsic),
            multiplied by sold-through from eBay Marketplace Insights when available. Read-only;
            nothing is listed.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => checkDemand.mutate()}
            disabled={checkDemand.isPending}
            variant="outline"
          >
            <Search className={`mr-2 h-4 w-4 ${checkDemand.isPending ? "animate-spin" : ""}`} />
            {checkDemand.isPending ? "Checking competition…" : "Check competition (top 100)"}
          </Button>
          <Button
            onClick={() => checkInsights.mutate()}
            disabled={checkInsights.isPending}
            className="bg-blue-600 hover:bg-blue-700"
          >
            <Search className={`mr-2 h-4 w-4 ${checkInsights.isPending ? "animate-spin" : ""}`} />
            {checkInsights.isPending ? "Checking sold-through…" : "Check sold-through (top 50)"}
          </Button>
        </div>
      </div>

      {/* Approval gate — surfaces eBay's "buy.marketplace.insights" allow-list
          requirement up-front instead of after a failed call. */}
      {insightsStatusQ.data?.notApproved && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <strong>Marketplace Insights not enabled on your eBay app.</strong> The
          buy.marketplace.insights scope is gated by eBay — apply at{" "}
          <a
            href="https://developer.ebay.com/my/keys"
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            developer.ebay.com/my/keys
          </a>{" "}
          (request access to the Buy Marketplace Insights API for your production app).
          Until then, sold-through columns will stay empty and the final score equals
          the intrinsic score.
        </div>
      )}

      <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
        <strong>How the score works.</strong> <em>Intrinsic score</em> 0–100 from margin
        (up to 50), in-stock (25), light weight (up to 15), having an EAN (10).{" "}
        <em>Final score</em> = intrinsic × demand multiplier from sold-count: ≥50 sold
        → 1.5×, ≥10 → 1.25×, ≥1 → 1.0×, 0 → 0.3×. Unchecked = neutral 1.0×.
      </div>

      {checkDemand.isError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <AlertCircle className="mr-2 inline h-4 w-4" />
          {(checkDemand.error as Error)?.message || "Competition check failed"}
        </div>
      )}
      {checkDemand.isSuccess && checkDemand.data && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          Competition: checked {checkDemand.data.checked} candidate(s), {checkDemand.data.ok} OK,{" "}
          {checkDemand.data.failed} failed.
        </div>
      )}
      {checkInsights.isError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <AlertCircle className="mr-2 inline h-4 w-4" />
          {(checkInsights.error as Error)?.message || "Sold-through check failed"}
        </div>
      )}
      {checkInsights.isSuccess && checkInsights.data && (
        <div className={`rounded-lg border px-4 py-3 text-sm ${
          checkInsights.data.notApproved
            ? "border-amber-200 bg-amber-50 text-amber-800"
            : "border-green-200 bg-green-50 text-green-800"
        }`}>
          {checkInsights.data.notApproved ? (
            <>Insights returned <strong>not approved</strong> for this app. See banner above.</>
          ) : (
            <>Sold-through: checked {checkInsights.data.checked} candidate(s), {checkInsights.data.ok} OK,{" "}
            {checkInsights.data.failed} failed.</>
          )}
        </div>
      )}

      <Card>
        <CardHeader className="py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">
              Ranked candidates
              <span className="ml-2 text-sm font-normal text-gray-500">
                {total.toLocaleString()} match{total === 1 ? "" : "es"}
              </span>
            </CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  applyFilter(() => setMinMargin(minMarginInput.trim()));
                }}
              >
                <Input
                  value={minMarginInput}
                  onChange={(e) => setMinMarginInput(e.target.value)}
                  placeholder="Min margin %"
                  className="h-9 w-32"
                  inputMode="numeric"
                />
              </form>
              <Select value={category} onValueChange={(v) => applyFilter(() => setCategory(v))}>
                <SelectTrigger className="h-9 w-56">
                  <SelectValue placeholder="All categories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All categories</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <label className="flex items-center gap-1.5 text-sm text-gray-600">
                <Checkbox
                  checked={hideListed}
                  onCheckedChange={(c) => applyFilter(() => setHideListed(!!c))}
                />
                Hide already-listed
              </label>
              <Button
                variant="outline"
                size="sm"
                onClick={() => listQ.refetch()}
                disabled={listQ.isFetching}
              >
                <RefreshCw className={`h-4 w-4 ${listQ.isFetching ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-14">Final</TableHead>
                <TableHead className="w-14">Intrinsic</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Our price</TableHead>
                <TableHead>Margin</TableHead>
                <TableHead>Stock</TableHead>
                <TableHead>Sold (30d)</TableHead>
                <TableHead>Competition</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {listQ.isLoading ? (
                <TableRow>
                  <TableCell colSpan={11} className="py-10 text-center text-sm text-gray-500">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={11} className="py-10 text-center text-sm text-gray-500">
                    No candidates match these filters. Try lowering the min margin or clearing the
                    category.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{scoreBadge(r.finalScore)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-mono">{r.score?.toFixed(0) ?? "—"}</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {r.sku}
                      {r.listedOnEbay && (
                        <Badge variant="outline" className="ml-1 text-[10px]">
                          listed
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[240px] truncate text-sm" title={r.name}>
                      {r.name}
                    </TableCell>
                    <TableCell className="max-w-[140px] truncate text-xs text-gray-500" title={r.category ?? ""}>
                      {r.category ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm">{money(r.supplierPrice)}</TableCell>
                    <TableCell className="text-sm">{money(r.salePrice ?? r.calculatedPrice)}</TableCell>
                    <TableCell className="text-sm">
                      {r.marginPercentage != null ? `${parseFloat(r.marginPercentage).toFixed(0)}%` : "—"}
                    </TableCell>
                    <TableCell className="text-sm text-gray-600">{r.stock}</TableCell>
                    <TableCell>
                      {r.insightsCheckedAt == null ? (
                        <span className="text-xs text-gray-400">not checked</span>
                      ) : r.soldCount == null ? (
                        <span className="text-xs text-gray-500">—</span>
                      ) : (
                        <div className="text-xs">
                          <div className={
                            r.soldCount >= 50 ? "text-green-700 font-medium" :
                            r.soldCount >= 10 ? "text-green-600" :
                            r.soldCount >= 1  ? "text-gray-700" :
                            "text-red-600"
                          }>
                            {r.soldCount.toLocaleString()} sold
                          </div>
                          {r.medianSoldPrice && (
                            <div className="text-gray-400">median {money(r.medianSoldPrice)}</div>
                          )}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>{demandCell(r)}</TableCell>
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
          <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>
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
    </AppShell>
  );
}

export default Opportunities;

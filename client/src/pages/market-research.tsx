/**
 * Market Research — market-first product discovery.
 *
 * "What's actually selling on eBay that I could source?" — the inverse of the
 * Opportunity Finder (which scores the TME catalogue you already have). Queries
 * eBay Marketplace Insights (the Terapeak sold-items signal) by keyword +
 * category, clusters the real sold products, filters out CN/HK junk and cheap
 * one-offs, then cross-references each winner against your TME catalogue with a
 * projected net margin. Read-only — lists nothing.
 */
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
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
import { TrendingUp, Search, AlertCircle, ExternalLink } from "lucide-react";

interface TmeMatch {
  productId: number;
  sku: string;
  name: string;
  supplierPrice: string | null;
  stock: number;
  listedOnEbay: boolean;
  projectedNetProfit: number | null;
  projectedMarginPct: number | null;
  meetsTarget: boolean;
}

interface MarketProduct {
  key: string;
  title: string;
  soldCount: number;
  transactions: number;
  gmv: number;
  avgPrice: number;
  medianPrice: number;
  minPrice: number;
  maxPrice: number;
  currency: string;
  topCountries: Array<{ country: string; count: number }>;
  cnShare: number;
  sampleUrl: string | null;
  tme: TmeMatch | null;
}

interface ResearchResponse {
  success: boolean;
  ok: boolean;
  notApproved?: boolean;
  error?: string;
  query: string;
  windowDays: number;
  rawSold: number;
  keptSold: number;
  products: MarketProduct[];
}

function money(v: number | string | null | undefined, cur = "€"): string {
  if (v == null) return "—";
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? `${cur}${n.toFixed(2)}` : "—";
}

function ebayDomainFromConfig(d?: string): string {
  return d && d.length ? d : "www.ebay.de";
}

export function MarketResearch() {
  const [keyword, setKeyword] = useState("");
  const [category, setCategory] = useState("all");
  const [windowDays, setWindowDays] = useState("30");
  const [minPrice, setMinPrice] = useState("8");
  const [minSold, setMinSold] = useState("2");
  const [excludeCn, setExcludeCn] = useState(true);
  const [euOnly, setEuOnly] = useState(false);
  const [tmeMatch, setTmeMatch] = useState(true);

  const configQ = useQuery<{ ebayDomain: string }>({ queryKey: ["/api/public-config"] });
  const categoriesQ = useQuery<{ success: boolean; categories: string[] }>({
    queryKey: ["/api/research/categories"],
  });
  const statusQ = useQuery<{ success: boolean; approved: boolean; notApproved: boolean; error: string | null }>({
    queryKey: ["/api/research/status"],
    refetchInterval: 600_000,
  });

  const ebayDomain = ebayDomainFromConfig(configQ.data?.ebayDomain);
  const categories = categoriesQ.data?.categories ?? [];

  const research = useMutation<ResearchResponse>({
    mutationFn: async () => {
      const r = await fetch("/api/research/market", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          q: keyword.trim(),
          category,
          windowDays: Number(windowDays),
          minPrice: minPrice ? Number(minPrice) : 0,
          minSold: minSold ? Number(minSold) : 1,
          excludeCn,
          euOnly,
          tmeMatch,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);
      return data;
    },
  });

  const data = research.data;
  const products = data?.ok ? data.products : [];

  const soldUrl = (title: string) =>
    `https://${ebayDomain}/sch/i.html?_nkw=${encodeURIComponent(title)}&LH_Sold=1&LH_Complete=1`;
  const alibabaUrl = (title: string) =>
    `https://www.alibaba.com/trade/search?SearchText=${encodeURIComponent(title)}`;
  const googleUrl = (title: string) =>
    `https://www.google.com/search?tbm=shop&q=${encodeURIComponent(title)}`;

  const canSearch = keyword.trim().length > 0 || category !== "all";

  return (
    <AppShell>
      <div className="p-6 space-y-4 max-w-screen-2xl mx-auto">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <TrendingUp className="h-6 w-6 text-emerald-600" />
            Market Research
          </h1>
          <p className="text-sm text-gray-500">
            What's actually selling on eBay that you could source — real sold data from eBay
            Marketplace Insights (the Terapeak signal), junk filtered out, matched to your TME
            catalogue with projected margin. Read-only; nothing is listed.
          </p>
        </div>

        {/* eBay approval gate */}
        {statusQ.data && statusQ.data.notApproved && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <strong>Marketplace Insights isn't enabled on your eBay app yet.</strong> The{" "}
            <code>buy.marketplace.insights</code> scope is gated by eBay — request access at{" "}
            <a href="https://developer.ebay.com/my/keys" target="_blank" rel="noreferrer" className="underline">
              developer.ebay.com/my/keys
            </a>
            . Until then, live sold data is unavailable — but the per-row <em>eBay sold</em> links
            below open the same data in eBay's/Terapeak's own UI.
          </div>
        )}

        {/* Search controls */}
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-base">Find winning products</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <form
              className="flex flex-wrap items-end gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (canSearch) research.mutate();
              }}
            >
              <div className="flex-1 min-w-[240px]">
                <label className="mb-1 block text-xs text-gray-500">Keyword / niche</label>
                <Input
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder="e.g. laser distance meter, obd2 scanner, dashcam"
                  className="h-9"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-500">Category (refines keyword)</label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger className="h-9 w-52">
                    <SelectValue placeholder="All categories" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All categories</SelectItem>
                    {categories.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-500">Window</label>
                <Select value={windowDays} onValueChange={setWindowDays}>
                  <SelectTrigger className="h-9 w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7">7 days</SelectItem>
                    <SelectItem value="30">30 days</SelectItem>
                    <SelectItem value="90">90 days</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-500">Min €</label>
                <Input
                  value={minPrice}
                  onChange={(e) => setMinPrice(e.target.value)}
                  className="h-9 w-20"
                  inputMode="numeric"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-500">Min sold</label>
                <Input
                  value={minSold}
                  onChange={(e) => setMinSold(e.target.value)}
                  className="h-9 w-20"
                  inputMode="numeric"
                />
              </div>
              <Button type="submit" disabled={!canSearch || research.isPending} className="bg-emerald-600 hover:bg-emerald-700">
                <Search className={`mr-2 h-4 w-4 ${research.isPending ? "animate-spin" : ""}`} />
                {research.isPending ? "Researching…" : "Research"}
              </Button>
            </form>

            <div className="flex flex-wrap items-center gap-4 text-sm text-gray-600">
              <label className="flex items-center gap-1.5">
                <Checkbox checked={excludeCn} onCheckedChange={(c) => setExcludeCn(!!c)} disabled={euOnly} />
                Exclude China / Hong Kong sellers
              </label>
              <label className="flex items-center gap-1.5">
                <Checkbox checked={euOnly} onCheckedChange={(c) => setEuOnly(!!c)} />
                EU / UK sellers only
              </label>
              <label className="flex items-center gap-1.5">
                <Checkbox checked={tmeMatch} onCheckedChange={(c) => setTmeMatch(!!c)} />
                Match to TME catalogue
              </label>
            </div>
          </CardContent>
        </Card>

        {research.isError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <AlertCircle className="mr-2 inline h-4 w-4" />
            {(research.error as Error)?.message || "Research failed"}
          </div>
        )}
        {data && !data.ok && data.notApproved && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            eBay returned <strong>not approved</strong> for Marketplace Insights — see the banner
            above. Use the eBay-sold links to research manually until access is granted.
          </div>
        )}
        {data && data.ok && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
            <strong>{products.length}</strong> product group{products.length === 1 ? "" : "s"} from{" "}
            <strong>{data.keptSold}</strong> sold listings (of {data.rawSold} returned) over the last{" "}
            {data.windowDays} days for “{data.query}”. Ranked by units sold.
          </div>
        )}

        {/* Results */}
        {data && data.ok && (
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">#</TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead className="text-right">Sold</TableHead>
                      <TableHead className="text-right">Price (min–med–max)</TableHead>
                      <TableHead className="text-right">GMV</TableHead>
                      <TableHead>Sellers</TableHead>
                      <TableHead>Source it</TableHead>
                      <TableHead className="text-right">Research</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {products.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="py-10 text-center text-sm text-gray-500">
                          No products cleared the filters. Try a broader keyword, a lower “Min sold”,
                          or turn off “EU / UK sellers only”.
                        </TableCell>
                      </TableRow>
                    ) : (
                      products.map((p, i) => (
                        <TableRow key={p.key}>
                          <TableCell className="text-sm text-gray-400">{i + 1}</TableCell>
                          <TableCell className="max-w-[320px]">
                            <div className="truncate text-sm font-medium" title={p.title}>{p.title}</div>
                            <div className="text-xs text-gray-400">{p.transactions} listing{p.transactions === 1 ? "" : "s"}</div>
                          </TableCell>
                          <TableCell className="text-right">
                            <span className={
                              p.soldCount >= 50 ? "font-semibold text-green-700" :
                              p.soldCount >= 10 ? "font-medium text-green-600" : "text-gray-700"
                            }>
                              {p.soldCount.toLocaleString()}
                            </span>
                          </TableCell>
                          <TableCell className="text-right text-xs text-gray-600">
                            {money(p.minPrice)} · <strong>{money(p.medianPrice)}</strong> · {money(p.maxPrice)}
                          </TableCell>
                          <TableCell className="text-right text-sm text-gray-700">{money(p.gmv)}</TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {p.topCountries.map((c) => (
                                <Badge
                                  key={c.country}
                                  variant="outline"
                                  className={`text-[10px] ${
                                    ["CN", "HK", "MO"].includes(c.country) ? "border-red-300 text-red-600" : ""
                                  }`}
                                >
                                  {c.country} {c.count}
                                </Badge>
                              ))}
                            </div>
                          </TableCell>
                          <TableCell>
                            {p.tme ? (
                              <div className="text-xs">
                                <div className="font-mono text-gray-700">{p.tme.sku}</div>
                                <div className="text-gray-500">supplier {money(p.tme.supplierPrice)}</div>
                                {p.tme.projectedNetProfit != null && (
                                  <Badge
                                    className={
                                      p.tme.meetsTarget
                                        ? "mt-0.5 bg-green-600 hover:bg-green-600"
                                        : "mt-0.5 bg-gray-400 hover:bg-gray-400"
                                    }
                                  >
                                    ~{money(p.tme.projectedNetProfit)} net
                                    {p.tme.projectedMarginPct != null ? ` (${p.tme.projectedMarginPct}%)` : ""}
                                  </Badge>
                                )}
                                {p.tme.listedOnEbay && (
                                  <Badge variant="outline" className="ml-1 mt-0.5 text-[10px]">already listed</Badge>
                                )}
                              </div>
                            ) : (
                              <span className="text-xs text-gray-400">no TME match</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1.5 text-xs">
                              <a href={soldUrl(p.title)} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                                eBay sold<ExternalLink className="ml-0.5 inline h-3 w-3" />
                              </a>
                              <a href={alibabaUrl(p.title)} target="_blank" rel="noreferrer" className="text-orange-600 hover:underline">
                                Alibaba
                              </a>
                              <a href={googleUrl(p.title)} target="_blank" rel="noreferrer" className="text-gray-500 hover:underline">
                                Google
                              </a>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}

        {!data && !research.isPending && (
          <div className="rounded-lg border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-500">
            Enter a keyword (or pick a category) and hit <strong>Research</strong> to see the real
            top sellers, filtered for quality and matched to what you can source.
          </div>
        )}
      </div>
    </AppShell>
  );
}

export default MarketResearch;

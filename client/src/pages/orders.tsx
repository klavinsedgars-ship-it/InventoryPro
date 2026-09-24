import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { countryName, labelAddressLines } from "@shared/country-names";
import {
  QL_LABEL_SIZES,
  CUSTOM_LABEL_SIZE,
  CUSTOM_LABEL_SIZE_ID,
  clampLabelMm,
  type LabelOptions,
} from "@shared/label-layout";
import {
  loadLabelSettings,
  saveLabelSettings,
  labelOptionsFrom,
  printAddressLabel,
  type LabelSettings,
} from "@/lib/print-label";
import { LabelPreview } from "@/components/label-preview";
import { PtouchLabelPanel } from "@/components/ptouch-label-panel";
import { Switch } from "@/components/ui/switch";
import { previousStatus, revertLabel } from "@shared/order-status";
import {
  ORDER_SEARCH_FIELDS,
  compactIdentifier,
  type OrderSearchField,
} from "@shared/order-search";
import { Separator } from "@/components/ui/separator";
import { 
  Package, Search, RefreshCw, Loader2, ExternalLink, 
  Truck, CheckCircle, Clock, XCircle, RotateCcw, 
  Printer, MapPin, Copy, ChevronDown, ChevronRight,
  ShoppingBag, Box, ClipboardCheck, History, DollarSign, Undo2,
  User, StickyNote, Check, AlertTriangle, X
} from "lucide-react";
import { SiEbay, SiAmazon } from "react-icons/si";
import { formatCurrency } from "@/lib/utils";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Order, OrderItem, OrderFee, OrderEvent } from "@shared/schema";
import { format } from "date-fns";

interface OrderWithDetails extends Order {
  items?: OrderItem[];
  fees?: OrderFee[];
  events?: OrderEvent[];
}

interface OrdersProps {
  user: any;
}

/**
 * The queue is a working list, not an archive: pull one screenful's worth of
 * the most recent matches and let the filter bar narrow, rather than shipping
 * every order ever placed to the browser on each keystroke. The count line
 * says when a result set was cut off, so a hidden match is never silent.
 */
const ORDER_PAGE_LIMIT = 300;

const STATUS_CONFIG: Record<string, { label: string; color: string; bgColor: string }> = {
  new: { label: "New", color: "text-blue-700", bgColor: "bg-blue-100" },
  packed: { label: "Packed", color: "text-yellow-700", bgColor: "bg-yellow-100" },
  shipped: { label: "Shipped", color: "text-purple-700", bgColor: "bg-purple-100" },
  delivered: { label: "Delivered", color: "text-green-700", bgColor: "bg-green-100" },
  completed: { label: "Completed", color: "text-emerald-700", bgColor: "bg-emerald-100" },
  returned: { label: "Returned", color: "text-orange-700", bgColor: "bg-orange-100" },
  cancelled: { label: "Cancelled", color: "text-red-700", bgColor: "bg-red-100" },
};

function StatusBadge({ status, size = "default" }: { status: string; size?: "default" | "lg" }) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.new;
  const sizeClass = size === "lg" ? "px-3 py-1 text-sm" : "px-2 py-0.5 text-xs";
  return (
    <span className={`${config.bgColor} ${config.color} ${sizeClass} font-medium rounded-full`}>
      {config.label}
    </span>
  );
}

export function Orders({ user }: OrdersProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<string>("to-pack");
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchField, setSearchField] = useState<OrderSearchField>("all");
  const [marketplaceFilter, setMarketplaceFilter] = useState("all");
  const [countryFilter, setCountryFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [trackingCarrier, setTrackingCarrier] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [showFinancials, setShowFinancials] = useState(false);
  const [printLabelOpen, setPrintLabelOpen] = useState(false);
  // Label stock is a property of the printer on the packing desk, not of the
  // order, so it is remembered rather than chosen again for every parcel.
  const [labelSettings, setLabelSettings] = useState<LabelSettings>(() => loadLabelSettings());
  const [printingLabel, setPrintingLabel] = useState(false);
  const [browserPrintOpen, setBrowserPrintOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);

  const statusFilter = activeTab === "to-pack" ? "new" : activeTab === "to-ship" ? "packed" : undefined;

  // Typing shouldn't fire a query per keystroke. The two free-text inputs are
  // debounced; the selects and date pickers change one value at a time and go
  // straight through.
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [debouncedCountry, setDebouncedCountry] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchTerm.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedCountry(countryFilter.trim()), 300);
    return () => clearTimeout(timer);
  }, [countryFilter]);

  const ordersUrl = (() => {
    const params = new URLSearchParams();
    if (statusFilter) params.set("status", statusFilter);
    if (debouncedSearch) {
      params.set("search", debouncedSearch);
      params.set("searchField", searchField);
    }
    if (marketplaceFilter !== "all") params.set("marketplace", marketplaceFilter);
    if (debouncedCountry) params.set("country", debouncedCountry);
    if (fromDate) params.set("fromDate", fromDate);
    if (toDate) params.set("toDate", toDate);
    params.set("limit", String(ORDER_PAGE_LIMIT));
    return `/api/orders?${params.toString()}`;
  })();

  const filtersActive = Boolean(
    debouncedSearch || debouncedCountry || fromDate || toDate || marketplaceFilter !== "all"
  );

  const clearFilters = () => {
    setSearchTerm("");
    setSearchField("all");
    setMarketplaceFilter("all");
    setCountryFilter("");
    setFromDate("");
    setToDate("");
  };

  /**
   * Searching means "find this order", which is rarely a question about the
   * tab you happen to be standing on. Move to All Orders so the visible state
   * always matches the query that ran — no hidden widening.
   */
  const handleSearchChange = (value: string) => {
    setSearchTerm(value);
    if (value.trim() && activeTab !== "all") setActiveTab("all");
  };

  const { data: ordersData, isLoading, isError: ordersError, error: ordersErrorObj, refetch } = useQuery<{
    success: boolean;
    orders: OrderWithDetails[];
    total: number;
  }>({
    // The URL is the key: every filter is already encoded in it, so a new
    // filter can never be forgotten here and serve a stale cached page.
    queryKey: ["/api/orders", ordersUrl],
    // res.ok check matters: without it a 401/500 parsed as JSON and rendered
    // as "no orders" — a failed fetch must be an error, not an empty inbox.
    queryFn: async () => {
      const res = await fetch(ordersUrl, { credentials: 'include' });
      if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
      return res.json();
    },
    placeholderData: (previous) => previous,
  });

  const { data: statsData } = useQuery<{
    success: boolean;
    stats: {
      total: number;
      byStatus: { new: number; packed: number; shipped: number };
      byMarketplace: { ebay: number; amazon: number };
    };
  }>({
    queryKey: ["/api/orders/stats"],
  });

  const { data: syncStatus } = useQuery<{
    success: boolean;
    ebay: { configured: boolean; message: string };
  }>({
    queryKey: ["/api/orders/sync/status"],
  });

  const syncEbayMutation = useMutation({
    // apiRequest returns a raw Response — parse it so the toast can read the
    // real fields (was showing "Synced undefined new orders").
    mutationFn: async (daysBack: number) => {
      const res = await apiRequest("POST", "/api/orders/sync/ebay", { daysBack });
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: "Orders Synced",
        description: data.message
          || `Synced ${data.synced ?? 0} new, updated ${data.updated ?? 0}`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders/sync/status"] });
    },
    onError: (error: any) => {
      toast({
        title: "Sync Failed",
        description: error.message || "Failed to sync orders from eBay",
        variant: "destructive",
      });
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status, trackingNumber, trackingCarrier }: {
      id: number;
      status: string;
      trackingNumber?: string;
      trackingCarrier?: string;
    }) => apiRequest("PATCH", `/api/orders/${id}/status`, { 
      status, 
      trackingNumber,
      trackingCarrier
    }),
    onSuccess: () => {
      toast({
        title: "Status Updated",
        description: "Order status has been updated.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders/stats"] });
      setTrackingNumber("");
      setTrackingCarrier("");
    },
    onError: (error: any) => {
      toast({
        title: "Update Failed",
        description: error.message || "Failed to update order status",
        variant: "destructive",
      });
    },
  });

  const orders = ordersData?.orders || [];
  const totalMatching = ordersData?.total ?? orders.length;
  const truncated = totalMatching > orders.length;
  const stats = statsData?.stats;
  const selectedOrder = orders.find(o => o.id === selectedOrderId) || null;

  // Reset tracking inputs when selecting a different order
  useEffect(() => {
    if (selectedOrder) {
      setTrackingNumber(selectedOrder.trackingNumber || "");
      setTrackingCarrier(selectedOrder.shippingCarrier || "");
    } else {
      setTrackingNumber("");
      setTrackingCarrier("");
    }
  }, [selectedOrderId, selectedOrder?.trackingNumber, selectedOrder?.shippingCarrier]);

  /**
   * Which article numbers on this order the term hit, so a result row can say
   * why it is there. Purely a display aid over the items already in the
   * payload — an order matched on a product EAN or catalogue name (fields the
   * list response doesn't carry) simply shows nothing rather than a guess.
   *
   * Compacted on both sides to mirror the server's separator-insensitive
   * identifier match.
   */
  const matchedParts = (order: OrderWithDetails): string[] => {
    if (!debouncedSearch) return [];
    const needle = compactIdentifier(debouncedSearch).toLowerCase();
    if (!needle) return [];
    const hits = new Set<string>();
    for (const item of order.items ?? []) {
      for (const code of [item.tmeProductId, item.sku]) {
        if (code && compactIdentifier(code).toLowerCase().includes(needle)) hits.add(code);
      }
    }
    return Array.from(hits);
  };

  const handleMarkPacked = (orderId: number) => {
    updateStatusMutation.mutate({ id: orderId, status: 'packed' });
  };

  const handleMarkShipped = (orderId: number) => {
    if (!trackingNumber.trim()) {
      toast({
        title: "Tracking Required",
        description: "Please enter a tracking number before marking as shipped.",
        variant: "destructive",
      });
      return;
    }
    updateStatusMutation.mutate({ 
      id: orderId, 
      status: 'shipped',
      trackingNumber: trackingNumber.trim(),
      trackingCarrier: trackingCarrier.trim() || undefined
    });
  };

  // Undo a mis-click. Packing is manual, and marking an order packed or
  // shipped used to be a one-way door whose only recovery was a DB edit.
  const handleRevertStatus = (orderId: number, currentStatus: string) => {
    const prev = previousStatus(currentStatus);
    if (!prev) return;
    updateStatusMutation.mutate({ id: orderId, status: prev });
  };

  const copyAddress = () => {
    if (!selectedOrder) return;
    navigator.clipboard.writeText(labelAddressLines(selectedOrder).join("\n"));
    toast({ title: "Copied", description: "Address copied to clipboard" });
  };

  /** The label the packing desk is set up for, plus this order's title. */
  const labelOptions: LabelOptions = useMemo(
    () =>
      labelOptionsFrom(
        labelSettings,
        selectedOrder ? `Label ${selectedOrder.marketplaceOrderId}` : "Shipping label",
      ),
    [labelSettings, selectedOrder?.marketplaceOrderId],
  );

  const updateLabelSettings = (patch: Partial<LabelSettings>) => {
    setLabelSettings((prev) => {
      const next = { ...prev, ...patch };
      saveLabelSettings(next);
      return next;
    });
  };

  /**
   * Straight to the label printer: the address alone, at 62 × 29 mm, instead
   * of pasting it into P-touch Editor and setting the font there every time.
   */
  const handlePrintLabel = async () => {
    if (!selectedOrder) return;
    const lines = labelAddressLines(selectedOrder);
    if (!lines.length) {
      toast({
        title: "Nothing to print",
        description: "This order has no shipping address on it.",
        variant: "destructive",
      });
      return;
    }
    setPrintingLabel(true);
    try {
      await printAddressLabel(lines, labelOptions);
    } catch (err) {
      toast({
        title: "Could not print",
        description:
          err instanceof Error ? err.message : "The browser refused to open the print dialog.",
        variant: "destructive",
      });
    } finally {
      setPrintingLabel(false);
    }
  };

  /**
   * A paste-ready supplier order. TME's API has no cart or ordering endpoint
   * (only /products/* and /utils/*), so the order cannot be placed from here —
   * but their site accepts a pasted symbol/quantity list, which removes the
   * error-prone part: typing part numbers by hand.
   */
  const copyTmeList = () => {
    if (!selectedOrder?.items?.length) return;
    const lines = selectedOrder.items
      .map((i: any) => `${i.tmeProductId || i.sku}\t${i.quantity}`)
      .join("\n");
    navigator.clipboard.writeText(lines);
    toast({
      title: "TME list copied",
      description: `${selectedOrder.items.length} line(s). Paste into TME's quick-order form.`,
    });
  };

  return (
    <div className="min-h-screen bg-gray-100" data-testid="page-orders">
      <Sidebar 
        user={user} 
        collapsed={sidebarCollapsed} 
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} 
      />
      
      <div className={`transition-all duration-200 ${sidebarCollapsed ? 'ml-16' : 'ml-64'}`}>
        <Header title="Orders" subtitle="Fulfillment Workspace" />
        
        <main className="p-3">
          <div className="flex items-center justify-between mb-3">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-auto" data-testid="tabs-orders">
              <TabsList>
                <TabsTrigger value="to-pack" className="gap-2" data-testid="tab-to-pack">
                  <Box className="w-4 h-4" />
                  To Pack
                  {stats?.byStatus.new ? (
                    <Badge variant="secondary" className="ml-1 bg-blue-100 text-blue-700" data-testid="badge-to-pack-count">
                      {stats.byStatus.new}
                    </Badge>
                  ) : null}
                </TabsTrigger>
                <TabsTrigger value="to-ship" className="gap-2" data-testid="tab-to-ship">
                  <Truck className="w-4 h-4" />
                  To Ship
                  {stats?.byStatus.packed ? (
                    <Badge variant="secondary" className="ml-1 bg-yellow-100 text-yellow-700" data-testid="badge-to-ship-count">
                      {stats.byStatus.packed}
                    </Badge>
                  ) : null}
                </TabsTrigger>
                <TabsTrigger value="all" className="gap-2" data-testid="tab-all">
                  <ClipboardCheck className="w-4 h-4" />
                  All Orders
                </TabsTrigger>
              </TabsList>
            </Tabs>

            <Button
              variant="outline"
              size="sm"
              onClick={() => syncEbayMutation.mutate(30)}
              disabled={syncEbayMutation.isPending || !syncStatus?.ebay?.configured}
              data-testid="btn-sync-ebay"
            >
              {syncEbayMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4 mr-2" />
              )}
              Sync eBay
            </Button>
          </div>

          <div className="mb-3 rounded-lg border bg-white p-2" data-testid="orders-filter-bar">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[240px] flex-1">
                <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <Input
                  placeholder="Order no, part no, SKU, EAN, item title, buyer, address, tracking…"
                  value={searchTerm}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  className="h-8 pl-8 text-sm"
                  data-testid="input-search-orders"
                />
              </div>

              <Select value={searchField} onValueChange={(v) => setSearchField(v as OrderSearchField)}>
                <SelectTrigger className="h-8 w-[185px] text-sm" data-testid="select-search-field">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ORDER_SEARCH_FIELDS.map((f) => (
                    <SelectItem key={f.value} value={f.value}>
                      {f.value === "all" ? "Search: everything" : `Search: ${f.label.toLowerCase()}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={marketplaceFilter} onValueChange={setMarketplaceFilter}>
                <SelectTrigger className="h-8 w-[130px] text-sm" data-testid="select-marketplace">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All channels</SelectItem>
                  <SelectItem value="ebay">eBay</SelectItem>
                  <SelectItem value="amazon">Amazon</SelectItem>
                </SelectContent>
              </Select>

              <Input
                placeholder="Country"
                value={countryFilter}
                onChange={(e) => setCountryFilter(e.target.value)}
                maxLength={2}
                className="h-8 w-[92px] text-sm uppercase"
                data-testid="input-filter-country"
              />

              <div className="flex items-center gap-1">
                <Label htmlFor="orders-from-date" className="text-xs text-gray-500">From</Label>
                <Input
                  id="orders-from-date"
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="h-8 w-[140px] text-sm"
                  data-testid="input-filter-from"
                />
                <Label htmlFor="orders-to-date" className="ml-1 text-xs text-gray-500">To</Label>
                <Input
                  id="orders-to-date"
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="h-8 w-[140px] text-sm"
                  data-testid="input-filter-to"
                />
              </div>

              {filtersActive && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearFilters}
                  className="h-8 text-gray-500"
                  data-testid="btn-clear-filters"
                >
                  <X className="mr-1 h-3.5 w-3.5" />
                  Clear
                </Button>
              )}
            </div>

            {filtersActive && (
              <p className="mt-1.5 text-xs text-gray-500" data-testid="text-filter-summary">
                {totalMatching} order{totalMatching === 1 ? "" : "s"} match
                {activeTab === "all" ? " across all statuses" : activeTab === "to-pack" ? " in To Pack" : " in To Ship"}
                {truncated && ` — showing the ${orders.length} most recent`}
              </p>
            )}
          </div>

          <div className="flex gap-3 h-[calc(100vh-180px)]">
            {/* Left Panel - Order Queue */}
            <div className="w-72 flex-shrink-0 bg-white rounded-lg shadow-sm border overflow-hidden flex flex-col">
              <div className="p-2 border-b bg-gray-50">
                <p className="text-sm font-medium text-gray-700">
                  {debouncedSearch
                    ? "Search results"
                    : activeTab === "to-pack" ? "Orders to Pack" : activeTab === "to-ship" ? "Orders to Ship" : "All Orders"}
                  <span className="text-gray-400 ml-2">({totalMatching})</span>
                </p>
              </div>
              
              <div className="flex-1 overflow-y-auto">
                {isLoading ? (
                  <div className="p-8 text-center">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto text-gray-400" />
                  </div>
                ) : ordersError ? (
                  /* A failed fetch must never masquerade as "All packed!" */
                  <div className="p-8 text-center">
                    <AlertTriangle className="w-10 h-10 mx-auto text-red-400 mb-2" />
                    <p className="text-sm font-medium text-red-600">Couldn't load orders.</p>
                    <p className="mt-1 break-words font-mono text-xs text-gray-400">
                      {(ordersErrorObj as Error)?.message || "Request failed"}
                    </p>
                  </div>
                ) : orders.length === 0 ? (
                  <div className="p-8 text-center">
                    <CheckCircle className="w-10 h-10 mx-auto text-green-400 mb-2" />
                    <p className="text-sm text-gray-500">
                      {filtersActive ? "No orders match these filters" : activeTab === "to-pack" ? "All packed!" : activeTab === "to-ship" ? "All shipped!" : "No orders"}
                    </p>
                    {filtersActive && (
                      <Button variant="link" size="sm" onClick={clearFilters} data-testid="btn-clear-filters-empty">
                        Clear filters
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className="divide-y">
                    {orders.map((order: any) => {
                      const itemCount = order.items?.reduce((sum: number, item: any) => sum + (item.quantity || 1), 0) || 0;
                      const isSelected = order.id === selectedOrderId;
                      
                      return (
                        <div
                          key={order.id}
                          onClick={() => setSelectedOrderId(order.id)}
                          className={`p-2 cursor-pointer transition-colors ${
                            isSelected ? 'bg-blue-50 border-l-4 border-l-blue-500' : 'hover:bg-gray-50'
                          }`}
                          data-testid={`queue-order-${order.id}`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <StatusBadge status={order.status} />
                              <span className="font-mono text-xs font-medium">
                                #{order.marketplaceOrderId.slice(-6)}
                              </span>
                              {order.marketplace === 'ebay' && <SiEbay className="w-3 h-3 text-[#e53238]" />}
                            </div>
                            <span className="font-medium text-sm">
                              {formatCurrency(parseFloat(order.totalPrice))}
                            </span>
                          </div>
                          <div className="flex items-center justify-between text-xs text-gray-500 mt-1">
                            <span>{itemCount} item{itemCount !== 1 ? 's' : ''} → {order.shippingCountry}</span>
                            <span>{order.orderDate ? format(new Date(order.orderDate), 'MMM d') : '-'}</span>
                          </div>
                          {matchedParts(order).length > 0 && (
                            <p
                              className="mt-1 truncate font-mono text-[11px] text-blue-700"
                              title={matchedParts(order).join(", ")}
                              data-testid={`queue-match-${order.id}`}
                            >
                              {matchedParts(order).join(", ")}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Right Panel - Order Detail */}
            <div className="flex-1 bg-white rounded-lg shadow-sm border overflow-hidden flex flex-col">
              {!selectedOrder ? (
                <div className="flex-1 flex items-center justify-center text-gray-400">
                  <div className="text-center">
                    <Package className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p>Select an order to view details</p>
                  </div>
                </div>
              ) : (
                <>
                  {/* Header - Compact */}
                  <div className="p-3 border-b bg-gray-50 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <StatusBadge status={selectedOrder.status} size="lg" />
                      <div>
                        <p className="font-mono font-bold text-sm">
                          #{selectedOrder.marketplaceOrderId.slice(-8)}
                        </p>
                        <p className="text-xs text-gray-500">
                          {selectedOrder.orderDate ? format(new Date(selectedOrder.orderDate), 'PPp') : '-'}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold">
                        {formatCurrency(parseFloat(selectedOrder.totalPrice))}
                      </p>
                      <p className="text-xs text-gray-500">{selectedOrder.currency}</p>
                    </div>
                  </div>

                  {/* Content - Two Column Layout for Compact View */}
                  <div className="flex-1 p-3 space-y-3 overflow-y-auto">
                    <div className="grid grid-cols-2 gap-3">
                      {/* Items to Pack - Left Column */}
                      <div className="border rounded-lg p-2">
                        <p className="text-xs font-medium text-gray-600 mb-2 flex items-center gap-1">
                          <Box className="w-3 h-3" /> Items to Pack ({selectedOrder.items?.length || 0})
                        </p>
                        {selectedOrder.items?.length ? (
                          <div className="space-y-1">
                            {selectedOrder.items.map((item: any) => (
                              <div key={item.id} className="flex items-center gap-2 text-sm bg-gray-50 rounded p-1.5">
                                {/* Picture first: a packer recognises a part by
                                    sight far faster than by reading a symbol
                                    like RC0402FR-0710KL. */}
                                {item.imageUrl ? (
                                  <img
                                    src={item.imageUrl}
                                    alt={item.title || item.sku}
                                    className="w-12 h-12 object-contain bg-white rounded border flex-shrink-0"
                                    loading="lazy"
                                    // A dead supplier image must not leave a
                                    // broken-image icon on the packing screen.
                                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                                    data-testid={`img-item-${item.id}`}
                                  />
                                ) : (
                                  <div className="w-12 h-12 rounded border bg-white flex items-center justify-center flex-shrink-0">
                                    <Box className="w-5 h-5 text-gray-300" />
                                  </div>
                                )}
                                <span className="w-6 h-6 bg-gray-200 rounded flex items-center justify-center text-xs font-bold flex-shrink-0">
                                  {item.quantity}x
                                </span>
                                <div className="flex-1 min-w-0">
                                  <p className="font-medium text-xs truncate">{item.title || item.sku}</p>
                                  <div className="flex items-center gap-2 text-xs text-gray-500">
                                    <span className="font-mono">{item.sku}</span>
                                    {item.tmeProductId && (
                                      <a
                                        href={`https://www.tme.eu/en/details/${item.tmeProductId}/`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-blue-600 hover:underline"
                                        data-testid={`link-tme-${item.id}`}
                                      >
                                        TME
                                      </a>
                                    )}
                                  </div>
                                </div>
                                <span className="text-xs font-medium">
                                  {formatCurrency(parseFloat(item.totalPrice))}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-gray-500">No items</p>
                        )}
                      </div>

                      {/* Shipping Address - Right Column */}
                      <div className="border rounded-lg p-2">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-xs font-medium text-gray-600 flex items-center gap-1">
                            <MapPin className="w-3 h-3" /> Ship To
                          </p>
                          <div className="flex gap-0.5">
                            <Button variant="ghost" size="sm" onClick={copyAddress} className="h-6 w-6 p-0" data-testid="btn-copy-address">
                              <Copy className="w-3 h-3" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => setPrintLabelOpen(true)} className="h-6 w-6 p-0" data-testid="btn-print-label">
                              <Printer className="w-3 h-3" />
                            </Button>
                          </div>
                        </div>
                        <div className="p-2 bg-gray-50 rounded border-2 border-dashed border-gray-300 font-mono text-xs">
                          <p className="font-bold">{selectedOrder.shippingName}</p>
                          <p>{selectedOrder.shippingAddressLine1}</p>
                          {selectedOrder.shippingAddressLine2 && <p>{selectedOrder.shippingAddressLine2}</p>}
                          <p>{[selectedOrder.shippingPostalCode, selectedOrder.shippingCity].filter(Boolean).join(" ")}</p>
                          <p className="font-bold">{countryName(selectedOrder.shippingCountry)}</p>
                          {selectedOrder.shippingPhone && (
                            <p className="text-gray-500 mt-1">Tel: {selectedOrder.shippingPhone}</p>
                          )}
                        </div>
                        {selectedOrder.shippingService && (
                          <p className="text-xs text-gray-500 mt-1">
                            Service: {selectedOrder.shippingService}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Buyer Note - Full Width */}
                    {selectedOrder.buyerNote && (
                      <div className="border border-yellow-300 bg-yellow-50 rounded-lg p-2">
                        <div className="flex items-start gap-2">
                          <StickyNote className="w-4 h-4 text-yellow-600 flex-shrink-0" />
                          <div>
                            <p className="text-xs font-medium text-yellow-700">Buyer Note</p>
                            <p className="text-xs">{selectedOrder.buyerNote}</p>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Collapsible sections in a row */}
                    <div className="flex gap-3 text-xs">
                      <Collapsible open={showFinancials} onOpenChange={setShowFinancials} className="flex-1">
                        <CollapsibleTrigger className="flex items-center gap-1 text-gray-600 hover:text-gray-900" data-testid="trigger-financials">
                          {showFinancials ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                          <DollarSign className="w-3 h-3" />
                          Financials
                        </CollapsibleTrigger>
                        <CollapsibleContent className="mt-1">
                          {/* The full ledger, not just the three lines eBay
                              reports: those show money in and the fee, which
                              looks like profit until VAT and cost come out. */}
                          <OrderFinancials orderId={selectedOrder.id} />
                        </CollapsibleContent>
                      </Collapsible>

                      <Collapsible open={showHistory} onOpenChange={setShowHistory} className="flex-1">
                        <CollapsibleTrigger className="flex items-center gap-1 text-gray-600 hover:text-gray-900" data-testid="trigger-history">
                          {showHistory ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                          <History className="w-3 h-3" />
                          History
                        </CollapsibleTrigger>
                        <CollapsibleContent className="mt-1">
                          <div className="border rounded p-2 text-xs max-h-20 overflow-y-auto">
                            {selectedOrder.events?.length ? (
                              <div className="space-y-1">
                                {selectedOrder.events.map((event: any) => (
                                  <div key={event.id} className="flex items-center gap-1">
                                    <div className="w-1.5 h-1.5 rounded-full bg-gray-400" />
                                    <span className="capitalize flex-1">{event.eventType.replace(/_/g, ' ')}</span>
                                    <span className="text-gray-400">
                                      {event.createdAt ? format(new Date(event.createdAt), 'MMM d') : ''}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="text-gray-500">No history</p>
                            )}
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    </div>
                  </div>

                  {/* Action Footer - Compact */}
                  <div className="p-3 border-t bg-gray-50 space-y-2">
                    {/* Supplier order: TME has no cart API, so this hands the
                        packer a paste-ready list instead of retyping symbols. */}
                    {!!selectedOrder.items?.length && (
                      <Button
                        variant="outline"
                        className="w-full h-8 text-xs"
                        onClick={copyTmeList}
                        data-testid="btn-copy-tme-list"
                      >
                        <Copy className="w-3 h-3 mr-2" />
                        Copy TME order list ({selectedOrder.items.length})
                      </Button>
                    )}

                    {selectedOrder.status === 'new' && (
                      <Button
                        className="w-full h-10 bg-yellow-500 hover:bg-yellow-600"
                        onClick={() => handleMarkPacked(selectedOrder.id)}
                        disabled={updateStatusMutation.isPending}
                        data-testid="btn-mark-packed"
                      >
                        {updateStatusMutation.isPending ? (
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        ) : (
                          <Package className="w-4 h-4 mr-2" />
                        )}
                        Mark as Packed
                      </Button>
                    )}

                    {selectedOrder.status === 'packed' && (
                      <div className="space-y-2">
                        <div className="flex gap-2">
                          <Input
                            placeholder="Tracking number *"
                            value={trackingNumber}
                            onChange={(e) => setTrackingNumber(e.target.value)}
                            className="flex-1"
                            data-testid="input-tracking-number"
                          />
                          <Input
                            placeholder="Carrier (optional)"
                            value={trackingCarrier}
                            onChange={(e) => setTrackingCarrier(e.target.value)}
                            className="w-40"
                            data-testid="input-tracking-carrier"
                          />
                        </div>
                        <Button
                          className="w-full h-12 text-lg bg-purple-600 hover:bg-purple-700"
                          onClick={() => handleMarkShipped(selectedOrder.id)}
                          disabled={updateStatusMutation.isPending}
                          data-testid="btn-mark-shipped"
                        >
                          {updateStatusMutation.isPending ? (
                            <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                          ) : (
                            <Truck className="w-5 h-5 mr-2" />
                          )}
                          Mark as Shipped
                        </Button>
                      </div>
                    )}

                    {selectedOrder.status === 'shipped' && (
                      <div className="text-center text-gray-500" data-testid="status-in-transit">
                        <Truck className="w-8 h-8 mx-auto mb-2 text-purple-500" />
                        <p className="font-medium">In Transit</p>
                        {selectedOrder.trackingNumber && (
                          <p className="text-sm" data-testid="text-tracking-number">Tracking: {selectedOrder.trackingNumber}</p>
                        )}
                      </div>
                    )}

                    {(selectedOrder.status === 'delivered' || selectedOrder.status === 'completed') && (
                      <div className="text-center text-gray-500" data-testid="status-completed">
                        <CheckCircle className="w-8 h-8 mx-auto mb-2 text-green-500" />
                        <p className="font-medium">Completed</p>
                      </div>
                    )}

                    {/* Step back one status. Always available where a previous
                        state exists, including after shipping — a wrong click
                        otherwise needed a database edit to undo. */}
                    {revertLabel(selectedOrder.status) && (
                      <Button
                        variant="ghost"
                        className="w-full h-8 text-xs text-gray-600"
                        onClick={() => handleRevertStatus(selectedOrder.id, selectedOrder.status)}
                        disabled={updateStatusMutation.isPending}
                        data-testid="btn-revert-status"
                      >
                        <Undo2 className="w-3 h-3 mr-2" />
                        {revertLabel(selectedOrder.status)}
                      </Button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </main>
      </div>

      {/* Print Label Dialog */}
      <Dialog open={printLabelOpen} onOpenChange={setPrintLabelOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Printer className="w-5 h-5" />
              Print Shipping Label
            </DialogTitle>
          </DialogHeader>

          {selectedOrder && (
            <div className="space-y-4">
              {/* What the printer gets, at true size. The lines are in postal
                  order with the country spelled out and the phone included —
                  carriers require a contact number for international parcels. */}
              <LabelPreview
                lines={labelAddressLines(selectedOrder)}
                options={labelOptions}
              />

              <PtouchLabelPanel
                orderId={selectedOrder.id}
                orderRef={String(selectedOrder.marketplaceOrderId ?? selectedOrder.id)}
              />

              <div className="text-xs text-gray-500 space-y-1">
                <p>Order: #{selectedOrder.marketplaceOrderId}</p>
                <p>Items: {selectedOrder.items?.length || 0}</p>
                {!selectedOrder.shippingPhone && (
                  <p className="text-amber-600">
                    No phone number on this order — some carriers require one for international parcels.
                  </p>
                )}
              </div>

              <Button variant="outline" className="w-full" onClick={copyAddress} data-testid="btn-dialog-copy-address">
                <Copy className="w-4 h-4 mr-2" />
                Copy address
              </Button>

              {/* Kept, but second: this machine's QL-800 refuses a browser
                  print job whose media is not the roll on the spool. */}
              <Collapsible open={browserPrintOpen} onOpenChange={setBrowserPrintOpen}>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="w-full justify-between text-xs" data-testid="btn-toggle-browser-print">
                    Print from the browser instead
                    {browserPrintOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-3 pt-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Label stock</Label>
                    <Select
                      value={labelSettings.sizeId}
                      onValueChange={(v) => updateLabelSettings({ sizeId: v })}
                    >
                      <SelectTrigger className="h-8" data-testid="select-label-size">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[...QL_LABEL_SIZES, CUSTOM_LABEL_SIZE].map((size) => (
                          <SelectItem key={size.id} value={size.id}>
                            {size.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Rotate 90°</Label>
                    <div className="flex items-center gap-2 h-8">
                      <Switch
                        checked={labelSettings.rotate}
                        onCheckedChange={(v) => updateLabelSettings({ rotate: v })}
                        data-testid="switch-label-rotate"
                      />
                      <span className="text-xs text-gray-500">
                        Only if it comes out sideways
                      </span>
                    </div>
                  </div>
                </div>

                {labelSettings.sizeId === CUSTOM_LABEL_SIZE_ID && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Width (mm)</Label>
                      <Input
                        type="number"
                        min={10}
                        max={300}
                        step={1}
                        className="h-8"
                        value={labelSettings.customWidthMm}
                        onChange={(e) =>
                          updateLabelSettings({ customWidthMm: clampLabelMm(Number(e.target.value), 62) })
                        }
                        data-testid="input-label-width"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Height (mm)</Label>
                      <Input
                        type="number"
                        min={10}
                        max={300}
                        step={1}
                        className="h-8"
                        value={labelSettings.customHeightMm}
                        onChange={(e) =>
                          updateLabelSettings({ customHeightMm: clampLabelMm(Number(e.target.value), 29) })
                        }
                        data-testid="input-label-height"
                      />
                    </div>
                  </div>
                )}

                <Button
                  className="w-full"
                  onClick={handlePrintLabel}
                  disabled={printingLabel}
                  data-testid="btn-dialog-print"
                >
                  {printingLabel ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Printer className="w-4 h-4 mr-2" />
                  )}
                  Print from the browser
                </Button>

                <div className="text-xs text-gray-500 leading-relaxed space-y-2 border-t pt-3">
                  <p>
                    In the print dialog choose <span className="font-medium">Brother QL-800</span>, set
                    margins to None and scale to 100%, and switch headers and footers off. The browser
                    remembers that, so every label after the first is one click.
                  </p>
                  <p>
                    <span className="font-medium text-gray-700">
                      "The roll inside the machine does not match the one selected"
                    </span>{" "}
                    means the print dialog's <span className="font-medium">Paper size</span> is not the roll
                    that is loaded — the browser cannot pick the roll, only that dialog can. Set the paper
                    size to the loaded roll, set Label stock above to the same numbers, and turn Rotate 90°
                    off, since it swaps the page the printer is asked for. On a Mac, "Print using system
                    dialog…" shows Brother's own paper list.
                  </p>
                </div>
                </CollapsibleContent>
              </Collapsible>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Per-order profit ledger.
 *
 * Reads the same endpoint the Reports page aggregates, so a single order's
 * numbers and the period totals can never tell different stories.
 */
function OrderFinancials({ orderId }: { orderId: number }) {
  const { data, isLoading, error } = useQuery<any>({
    queryKey: ["/api/reports/order", orderId],
    queryFn: async () => {
      const r = await fetch(`/api/reports/order/${orderId}`, { credentials: "include" });
      const body = await r.text();
      if (!r.ok) {
        let detail = body.slice(0, 200);
        try { detail = JSON.parse(body).error ?? detail; } catch { /* not JSON */ }
        throw new Error(`${r.status}: ${detail}`);
      }
      return JSON.parse(body);
    },
  });

  if (isLoading) return <div className="text-xs text-gray-400 border rounded-lg p-2">Calculating…</div>;
  // Say why rather than rendering nothing — a silent blank is what sent us
  // looking for a bug in the wrong place.
  if (error) {
    return (
      <div className="border border-red-200 bg-red-50 rounded-lg p-2 text-xs text-red-900">
        <p className="font-medium">Could not calculate financials</p>
        <p className="font-mono text-[10px] mt-1 break-all">{(error as Error).message}</p>
      </div>
    );
  }
  const e = data?.economics;
  if (!e) return null;

  const money = (n: number) => `€${Number(n).toFixed(2)}`;

  return (
    <div className="border rounded-lg p-2">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-medium text-gray-600 flex items-center gap-1">
          <DollarSign className="w-3 h-3" /> Profit breakdown
        </p>
        <span className={`text-sm font-semibold ${e.netProfit < 0 ? "text-red-600" : "text-green-700"}`}>
          {money(e.netProfit)}
          <span className="text-xs font-normal text-gray-400 ml-1">
            {e.netMarginPct == null ? "" : `(${e.netMarginPct.toFixed(1)}% of net)`}
          </span>
        </span>
      </div>

      <div className="space-y-0.5 text-xs">
        {e.ledger.map((l: any) => (
          <div
            key={l.key}
            className={`flex items-start justify-between gap-2 ${
              l.kind === "total" ? "border-t pt-1 mt-1 font-medium" : ""
            }`}
          >
            <div className="min-w-0">
              <span className={l.kind === "out" ? "text-gray-600" : ""}>{l.label}</span>
              {/* An estimated figure must look different from a charged one:
                  a report that hides the difference reads as fact. */}
              {l.actual === false && l.kind === "out" && (
                <span className="ml-1 text-[10px] text-amber-600">est.</span>
              )}
              {l.note && <p className="text-[10px] text-gray-400 leading-tight">{l.note}</p>}
            </div>
            <span
              className={`tabular-nums flex-shrink-0 ${
                l.kind === "out" ? "text-red-600" : l.kind === "total" ? "" : "text-green-700"
              }`}
            >
              {l.kind === "out" ? "−" : ""}
              {money(l.amount)}
            </span>
          </div>
        ))}
      </div>

      {/* Both margins, because they answer different questions and quoting one
          alone is how a VAT-inclusive sale gets mistaken for a healthy one. */}
      <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t">
        <div>
          <div className="text-[10px] text-gray-400">Margin on net revenue</div>
          <div className={`text-sm font-semibold ${e.netProfit < 0 ? "text-red-600" : "text-green-700"}`}>
            {e.netMarginPct == null ? "—" : `${e.netMarginPct.toFixed(1)}%`}
            <span className="text-[10px] font-normal text-gray-400 ml-1">of {money(e.netRevenue)}</span>
          </div>
        </div>
        <div>
          <div className="text-[10px] text-gray-400">Margin on what buyer paid</div>
          <div className="text-sm font-medium text-gray-600">
            {e.grossMarginPct == null ? "—" : `${e.grossMarginPct.toFixed(1)}%`}
            <span className="text-[10px] font-normal text-gray-400 ml-1">of {money(e.grossReceived)}</span>
          </div>
        </div>
      </div>

      {data.postage && (
        <p className="text-[10px] text-gray-400 mt-1.5">
          Postage: {data.postage.service === "paka" ? "Paka" : "Sīkpaka"}
          {data.postage.tracked ? " (tracked)" : ""} · {data.postage.bandLabel} ·{" "}
          {data.postage.contentGrams}g goods + {data.postage.packagingGrams}g packaging → {data.postage.country}
          {!data.postage.weightComplete && (
            <span className="text-amber-600"> · some products have no weight, so this band may be too low</span>
          )}
        </p>
      )}

      {!e.fullyActual && (
        <p className="text-[10px] text-amber-600 mt-1.5">
          Some figures are modelled rather than charged — profit is approximate.
        </p>
      )}
    </div>
  );
}

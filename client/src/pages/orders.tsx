import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { previousStatus, revertLabel } from "@shared/order-status";
import { Separator } from "@/components/ui/separator";
import { 
  Package, Search, RefreshCw, Loader2, ExternalLink, 
  Truck, CheckCircle, Clock, XCircle, RotateCcw, 
  Printer, MapPin, Copy, ChevronDown, ChevronRight,
  ShoppingBag, Box, ClipboardCheck, History, DollarSign, Undo2,
  User, StickyNote, Check, AlertTriangle
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
  const [trackingNumber, setTrackingNumber] = useState("");
  const [trackingCarrier, setTrackingCarrier] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [showFinancials, setShowFinancials] = useState(false);
  const [printLabelOpen, setPrintLabelOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);

  const statusFilter = activeTab === "to-pack" ? "new" : activeTab === "to-ship" ? "packed" : undefined;

  // Build the API URL with status filter
  const ordersUrl = statusFilter ? `/api/orders?status=${statusFilter}` : '/api/orders';

  const { data: ordersData, isLoading, isError: ordersError, error: ordersErrorObj, refetch } = useQuery<{
    success: boolean;
    orders: OrderWithDetails[];
    total: number;
  }>({
    queryKey: ["/api/orders", statusFilter],
    // res.ok check matters: without it a 401/500 parsed as JSON and rendered
    // as "no orders" — a failed fetch must be an error, not an empty inbox.
    queryFn: async () => {
      const res = await fetch(ordersUrl, { credentials: 'include' });
      if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
      return res.json();
    },
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

  // Filter orders by search term
  const filteredOrders = orders.filter(order => {
    if (!searchTerm) return true;
    const search = searchTerm.toLowerCase();
    return (
      order.marketplaceOrderId.toLowerCase().includes(search) ||
      order.buyerUsername.toLowerCase().includes(search) ||
      order.shippingName.toLowerCase().includes(search) ||
      order.shippingCity?.toLowerCase().includes(search) ||
      order.shippingPostalCode?.toLowerCase().includes(search)
    );
  });

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

          <div className="flex gap-3 h-[calc(100vh-130px)]">
            {/* Left Panel - Order Queue */}
            <div className="w-72 flex-shrink-0 bg-white rounded-lg shadow-sm border overflow-hidden flex flex-col">
              <div className="p-2 border-b bg-gray-50 space-y-2">
                <p className="text-sm font-medium text-gray-700">
                  {activeTab === "to-pack" ? "Orders to Pack" : activeTab === "to-ship" ? "Orders to Ship" : "All Orders"}
                  <span className="text-gray-400 ml-2">({filteredOrders.length})</span>
                </p>
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                  <Input
                    placeholder="Search orders..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-8 h-7 text-sm"
                    data-testid="input-search-orders"
                  />
                </div>
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
                ) : filteredOrders.length === 0 ? (
                  <div className="p-8 text-center">
                    <CheckCircle className="w-10 h-10 mx-auto text-green-400 mb-2" />
                    <p className="text-sm text-gray-500">
                      {searchTerm ? "No orders match your search" : activeTab === "to-pack" ? "All packed!" : activeTab === "to-ship" ? "All shipped!" : "No orders"}
                    </p>
                  </div>
                ) : (
                  <div className="divide-y">
                    {filteredOrders.map((order: any) => {
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
              {/* Postal order, country spelled out, phone included — carriers
                  require a contact number for international services. */}
              <div className="p-4 bg-white border-2 border-black font-mono text-sm" style={{ fontFamily: 'monospace' }}>
                <p className="font-bold text-lg mb-2">{selectedOrder.shippingName}</p>
                <p>{selectedOrder.shippingAddressLine1}</p>
                {selectedOrder.shippingAddressLine2 && <p>{selectedOrder.shippingAddressLine2}</p>}
                <p className="font-bold text-lg">
                  {[selectedOrder.shippingPostalCode, selectedOrder.shippingCity].filter(Boolean).join(" ")}
                </p>
                {selectedOrder.shippingStateOrProvince && <p>{selectedOrder.shippingStateOrProvince}</p>}
                <p className="font-bold text-lg uppercase">{countryName(selectedOrder.shippingCountry)}</p>
                {selectedOrder.shippingPhone && (
                  <p className="mt-2">Tel: {selectedOrder.shippingPhone}</p>
                )}
              </div>

              <div className="text-xs text-gray-500 space-y-1">
                <p>Order: #{selectedOrder.marketplaceOrderId}</p>
                <p>Items: {selectedOrder.items?.length || 0}</p>
                {!selectedOrder.shippingPhone && (
                  <p className="text-amber-600">
                    No phone number on this order — some carriers require one for international parcels.
                  </p>
                )}
              </div>

              <div className="flex gap-2">
                <Button className="flex-1" onClick={() => window.print()} data-testid="btn-dialog-print">
                  <Printer className="w-4 h-4 mr-2" />
                  Print
                </Button>
                <Button variant="outline" className="flex-1" onClick={copyAddress} data-testid="btn-dialog-copy-address">
                  <Copy className="w-4 h-4 mr-2" />
                  Copy
                </Button>
              </div>

              <p className="text-xs text-gray-400 text-center">
                Latvian Post API integration coming soon
              </p>
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

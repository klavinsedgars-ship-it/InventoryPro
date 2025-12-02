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
import { Separator } from "@/components/ui/separator";
import { 
  Package, Search, RefreshCw, Loader2, ExternalLink, 
  Truck, CheckCircle, Clock, XCircle, RotateCcw, 
  Printer, MapPin, Copy, ChevronDown, ChevronRight,
  ShoppingBag, Box, ClipboardCheck, History, DollarSign,
  User, StickyNote, Check
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

  const statusFilter = activeTab === "to-pack" ? "new" : activeTab === "to-ship" ? "packed" : undefined;

  const { data: ordersData, isLoading, refetch } = useQuery<{
    success: boolean;
    orders: OrderWithDetails[];
    total: number;
  }>({
    queryKey: ["/api/orders", { status: statusFilter }],
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
    mutationFn: (daysBack: number) => apiRequest("POST", "/api/orders/sync/ebay", { daysBack }),
    onSuccess: (data: any) => {
      toast({
        title: "Orders Synced",
        description: data.message || `Synced ${data.synced} new orders`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders/stats"] });
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
      setTrackingCarrier(selectedOrder.trackingCarrier || "");
    } else {
      setTrackingNumber("");
      setTrackingCarrier("");
    }
  }, [selectedOrderId, selectedOrder?.trackingNumber, selectedOrder?.trackingCarrier]);

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

  const copyAddress = () => {
    if (!selectedOrder) return;
    const address = [
      selectedOrder.shippingName,
      selectedOrder.shippingAddressLine1,
      selectedOrder.shippingAddressLine2,
      `${selectedOrder.shippingCity}, ${selectedOrder.shippingPostalCode}`,
      selectedOrder.shippingCountry
    ].filter(Boolean).join('\n');
    
    navigator.clipboard.writeText(address);
    toast({ title: "Copied", description: "Address copied to clipboard" });
  };

  return (
    <div className="min-h-screen bg-gray-100" data-testid="page-orders">
      <Sidebar user={user} />
      
      <div className="ml-64">
        <Header title="Orders" subtitle="Fulfillment Workspace" />
        
        <main className="p-4">
          <div className="flex items-center justify-between mb-4">
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

          <div className="flex gap-4 h-[calc(100vh-180px)]">
            {/* Left Panel - Order Queue */}
            <div className="w-80 flex-shrink-0 bg-white rounded-lg shadow-sm border overflow-hidden flex flex-col">
              <div className="p-3 border-b bg-gray-50 space-y-2">
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
                    className="pl-8 h-8 text-sm"
                    data-testid="input-search-orders"
                  />
                </div>
              </div>
              
              <div className="flex-1 overflow-y-auto">
                {isLoading ? (
                  <div className="p-8 text-center">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto text-gray-400" />
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
                          className={`p-3 cursor-pointer transition-colors ${
                            isSelected ? 'bg-blue-50 border-l-4 border-l-blue-500' : 'hover:bg-gray-50'
                          }`}
                          data-testid={`queue-order-${order.id}`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <StatusBadge status={order.status} />
                            <span className="text-xs text-gray-400">
                              {order.orderDate ? format(new Date(order.orderDate), 'MMM d') : '-'}
                            </span>
                          </div>
                          
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-mono text-sm font-medium">
                              #{order.marketplaceOrderId.slice(-6)}
                            </span>
                            {order.marketplace === 'ebay' && <SiEbay className="w-4 h-4 text-[#e53238]" />}
                            {order.marketplace === 'amazon' && <SiAmazon className="w-4 h-4 text-[#ff9900]" />}
                          </div>
                          
                          <div className="flex items-center justify-between text-xs text-gray-500">
                            <span>{itemCount} item{itemCount !== 1 ? 's' : ''}</span>
                            <span className="font-medium text-gray-700">
                              {formatCurrency(parseFloat(order.totalPrice))}
                            </span>
                          </div>
                          
                          <p className="text-xs text-gray-500 truncate mt-1">
                            → {order.shippingCity}, {order.shippingCountry}
                          </p>
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
                  {/* Header */}
                  <div className="p-4 border-b bg-gray-50 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <StatusBadge status={selectedOrder.status} size="lg" />
                      <div>
                        <p className="font-mono font-bold">
                          #{selectedOrder.marketplaceOrderId.slice(-8)}
                        </p>
                        <p className="text-xs text-gray-500">
                          {selectedOrder.orderDate ? format(new Date(selectedOrder.orderDate), 'PPp') : '-'}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-xl font-bold">
                        {formatCurrency(parseFloat(selectedOrder.totalPrice))}
                      </p>
                      <p className="text-xs text-gray-500">{selectedOrder.currency}</p>
                    </div>
                  </div>

                  {/* Content */}
                  <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {/* Items to Pack */}
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <Box className="w-4 h-4" />
                          Items to Pack
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        {selectedOrder.items?.length ? (
                          <div className="space-y-2">
                            {selectedOrder.items.map((item: any) => (
                              <div key={item.id} className="flex items-center gap-3 p-2 bg-gray-50 rounded">
                                <div className="w-8 h-8 bg-gray-200 rounded flex items-center justify-center text-xs font-bold">
                                  {item.quantity}x
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="font-medium text-sm truncate">{item.title || item.sku}</p>
                                  <div className="flex items-center gap-2 text-xs text-gray-500">
                                    <span className="font-mono">{item.sku}</span>
                                    {item.tmeProductId && (
                                      <a
                                        href={`https://www.tme.eu/en/details/${item.tmeProductId}/`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-blue-600 hover:underline flex items-center gap-1"
                                      >
                                        TME <ExternalLink className="w-3 h-3" />
                                      </a>
                                    )}
                                  </div>
                                </div>
                                <p className="text-sm font-medium">
                                  {formatCurrency(parseFloat(item.totalPrice))}
                                </p>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm text-gray-500">No items</p>
                        )}
                      </CardContent>
                    </Card>

                    {/* Shipping Address */}
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm flex items-center justify-between">
                          <span className="flex items-center gap-2">
                            <MapPin className="w-4 h-4" />
                            Ship To
                          </span>
                          <div className="flex gap-1">
                            <Button variant="ghost" size="sm" onClick={copyAddress} data-testid="btn-copy-address">
                              <Copy className="w-4 h-4" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => setPrintLabelOpen(true)} data-testid="btn-print-label">
                              <Printer className="w-4 h-4" />
                            </Button>
                          </div>
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="p-3 bg-gray-50 rounded border-2 border-dashed border-gray-300 font-mono text-sm">
                          <p className="font-bold">{selectedOrder.shippingName}</p>
                          <p>{selectedOrder.shippingAddressLine1}</p>
                          {selectedOrder.shippingAddressLine2 && (
                            <p>{selectedOrder.shippingAddressLine2}</p>
                          )}
                          <p>{selectedOrder.shippingCity}, {selectedOrder.shippingPostalCode}</p>
                          <p className="font-bold">{selectedOrder.shippingCountry}</p>
                          {selectedOrder.shippingPhone && (
                            <p className="text-gray-500 mt-1">Tel: {selectedOrder.shippingPhone}</p>
                          )}
                        </div>
                        {selectedOrder.shippingService && (
                          <p className="text-xs text-gray-500 mt-2">
                            Service: {selectedOrder.shippingService}
                          </p>
                        )}
                      </CardContent>
                    </Card>

                    {/* Buyer Note */}
                    {selectedOrder.buyerNote && (
                      <Card className="border-yellow-300 bg-yellow-50">
                        <CardContent className="pt-4">
                          <div className="flex items-start gap-2">
                            <StickyNote className="w-4 h-4 text-yellow-600 flex-shrink-0 mt-0.5" />
                            <div>
                              <p className="text-xs font-medium text-yellow-700 mb-1">Buyer Note</p>
                              <p className="text-sm">{selectedOrder.buyerNote}</p>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    )}

                    {/* Collapsible: Financials */}
                    <Collapsible open={showFinancials} onOpenChange={setShowFinancials}>
                      <CollapsibleTrigger className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900" data-testid="trigger-financials">
                        {showFinancials ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        <DollarSign className="w-4 h-4" />
                        Financial Details
                      </CollapsibleTrigger>
                      <CollapsibleContent className="mt-2">
                        <Card>
                          <CardContent className="pt-4 text-sm space-y-1">
                            <div className="flex justify-between">
                              <span>Subtotal</span>
                              <span>{formatCurrency(parseFloat(selectedOrder.subtotal))}</span>
                            </div>
                            <div className="flex justify-between">
                              <span>Shipping</span>
                              <span>{formatCurrency(parseFloat(selectedOrder.shippingCost))}</span>
                            </div>
                            {selectedOrder.marketplaceFee && (
                              <div className="flex justify-between text-red-600">
                                <span>Marketplace Fee</span>
                                <span>-{formatCurrency(parseFloat(selectedOrder.marketplaceFee))}</span>
                              </div>
                            )}
                            <Separator />
                            <div className="flex justify-between font-bold">
                              <span>Total</span>
                              <span>{formatCurrency(parseFloat(selectedOrder.totalPrice))}</span>
                            </div>
                          </CardContent>
                        </Card>
                      </CollapsibleContent>
                    </Collapsible>

                    {/* Collapsible: History */}
                    <Collapsible open={showHistory} onOpenChange={setShowHistory}>
                      <CollapsibleTrigger className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900" data-testid="trigger-history">
                        {showHistory ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        <History className="w-4 h-4" />
                        Order History
                      </CollapsibleTrigger>
                      <CollapsibleContent className="mt-2">
                        <Card>
                          <CardContent className="pt-4">
                            {selectedOrder.events?.length ? (
                              <div className="space-y-2">
                                {selectedOrder.events.map((event: any) => (
                                  <div key={event.id} className="flex items-start gap-2 text-sm">
                                    <div className="w-2 h-2 rounded-full bg-gray-400 mt-1.5" />
                                    <div className="flex-1">
                                      <p className="capitalize">{event.eventType.replace(/_/g, ' ')}</p>
                                      {event.fromStatus && event.toStatus && (
                                        <p className="text-xs text-gray-500">
                                          {event.fromStatus} → {event.toStatus}
                                        </p>
                                      )}
                                    </div>
                                    <span className="text-xs text-gray-400">
                                      {event.createdAt ? format(new Date(event.createdAt), 'MMM d, HH:mm') : ''}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="text-sm text-gray-500">No history</p>
                            )}
                          </CardContent>
                        </Card>
                      </CollapsibleContent>
                    </Collapsible>
                  </div>

                  {/* Action Footer */}
                  <div className="p-4 border-t bg-gray-50">
                    {selectedOrder.status === 'new' && (
                      <Button
                        className="w-full h-12 text-lg bg-yellow-500 hover:bg-yellow-600"
                        onClick={() => handleMarkPacked(selectedOrder.id)}
                        disabled={updateStatusMutation.isPending}
                        data-testid="btn-mark-packed"
                      >
                        {updateStatusMutation.isPending ? (
                          <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                        ) : (
                          <Package className="w-5 h-5 mr-2" />
                        )}
                        Mark as Packed
                      </Button>
                    )}

                    {selectedOrder.status === 'packed' && (
                      <div className="space-y-3">
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
              <div className="p-4 bg-white border-2 border-black font-mono text-sm" style={{ fontFamily: 'monospace' }}>
                <p className="font-bold text-lg mb-2">{selectedOrder.shippingName}</p>
                <p>{selectedOrder.shippingAddressLine1}</p>
                {selectedOrder.shippingAddressLine2 && <p>{selectedOrder.shippingAddressLine2}</p>}
                <p>{selectedOrder.shippingCity}</p>
                <p className="font-bold text-lg">{selectedOrder.shippingPostalCode}</p>
                <p className="font-bold">{selectedOrder.shippingCountry}</p>
              </div>

              <div className="text-xs text-gray-500 space-y-1">
                <p>Order: #{selectedOrder.marketplaceOrderId}</p>
                <p>Items: {selectedOrder.items?.length || 0}</p>
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

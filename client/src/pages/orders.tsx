import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { 
  Package, Search, RefreshCw, Loader2, ExternalLink, 
  Truck, CheckCircle, Clock, XCircle, RotateCcw, 
  Printer, MapPin, User, Calendar, DollarSign,
  ShoppingBag, Eye, ChevronRight, MoreHorizontal,
  StickyNote, History
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

const ORDER_STATUSES = [
  { value: "new", label: "New", color: "bg-blue-100 text-blue-800", icon: Clock },
  { value: "packed", label: "Packed", color: "bg-yellow-100 text-yellow-800", icon: Package },
  { value: "shipped", label: "Shipped", color: "bg-purple-100 text-purple-800", icon: Truck },
  { value: "delivered", label: "Delivered", color: "bg-green-100 text-green-800", icon: CheckCircle },
  { value: "completed", label: "Completed", color: "bg-emerald-100 text-emerald-800", icon: CheckCircle },
  { value: "returned", label: "Returned", color: "bg-orange-100 text-orange-800", icon: RotateCcw },
  { value: "cancelled", label: "Cancelled", color: "bg-red-100 text-red-800", icon: XCircle },
];

function getStatusInfo(status: string) {
  return ORDER_STATUSES.find(s => s.value === status) || ORDER_STATUSES[0];
}

function StatusBadge({ status }: { status: string }) {
  const info = getStatusInfo(status);
  const Icon = info.icon;
  return (
    <Badge className={`${info.color} flex items-center gap-1`} data-testid={`badge-status-${status}`}>
      <Icon className="w-3 h-3" />
      {info.label}
    </Badge>
  );
}

function MarketplaceBadge({ marketplace }: { marketplace: string }) {
  if (marketplace === 'ebay') {
    return (
      <Badge variant="outline" className="flex items-center gap-1" data-testid="badge-marketplace-ebay">
        <SiEbay className="w-4 h-4 text-[#e53238]" />
        eBay
      </Badge>
    );
  }
  if (marketplace === 'amazon') {
    return (
      <Badge variant="outline" className="flex items-center gap-1" data-testid="badge-marketplace-amazon">
        <SiAmazon className="w-4 h-4 text-[#ff9900]" />
        Amazon
      </Badge>
    );
  }
  return <Badge variant="outline">{marketplace}</Badge>;
}

export function Orders({ user }: OrdersProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [marketplaceFilter, setMarketplaceFilter] = useState<string>("all");
  const [selectedOrder, setSelectedOrder] = useState<OrderWithDetails | null>(null);
  const [orderDetailOpen, setOrderDetailOpen] = useState(false);
  const [newStatus, setNewStatus] = useState<string>("");
  const [statusNote, setStatusNote] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [trackingCarrier, setTrackingCarrier] = useState("");

  const { data: ordersData, isLoading, refetch } = useQuery<{
    success: boolean;
    orders: Order[];
    total: number;
  }>({
    queryKey: ["/api/orders", { 
      status: statusFilter !== "all" ? statusFilter : undefined,
      marketplace: marketplaceFilter !== "all" ? marketplaceFilter : undefined,
      search: searchTerm || undefined
    }],
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
    amazon: { configured: boolean; message: string };
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
    mutationFn: ({ id, status, notes, trackingNumber, trackingCarrier }: {
      id: number;
      status: string;
      notes?: string;
      trackingNumber?: string;
      trackingCarrier?: string;
    }) => apiRequest("PATCH", `/api/orders/${id}/status`, { 
      status, 
      notes,
      trackingNumber,
      trackingCarrier
    }),
    onSuccess: () => {
      toast({
        title: "Status Updated",
        description: "Order status has been updated successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders/stats"] });
      if (selectedOrder) {
        fetchOrderDetails(selectedOrder.id);
      }
      setNewStatus("");
      setStatusNote("");
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

  const printLabelMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/orders/${id}/print-label`),
    onSuccess: (data: any) => {
      toast({
        title: "Print Label",
        description: data.message || "Label print requested",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Print Failed",
        description: error.message || "Failed to print label",
        variant: "destructive",
      });
    },
  });

  const fetchOrderDetails = async (id: number) => {
    try {
      const response = await fetch(`/api/orders/${id}`, {
        credentials: 'include'
      });
      const data = await response.json();
      if (data.success) {
        setSelectedOrder(data.order);
      }
    } catch (error) {
      console.error('Failed to fetch order details:', error);
    }
  };

  const handleViewOrder = async (order: Order) => {
    await fetchOrderDetails(order.id);
    setOrderDetailOpen(true);
  };

  const handleStatusChange = (orderId: number) => {
    if (!newStatus) return;
    updateStatusMutation.mutate({
      id: orderId,
      status: newStatus,
      notes: statusNote || undefined,
      trackingNumber: trackingNumber || undefined,
      trackingCarrier: trackingCarrier || undefined
    });
  };

  const orders = ordersData?.orders || [];
  const stats = statsData?.stats;

  const filteredOrders = orders.filter(order => {
    if (!searchTerm) return true;
    const search = searchTerm.toLowerCase();
    return (
      order.marketplaceOrderId.toLowerCase().includes(search) ||
      order.buyerUsername.toLowerCase().includes(search) ||
      order.shippingName.toLowerCase().includes(search)
    );
  });

  const getNextValidStatuses = (currentStatus: string): string[] => {
    const transitions: Record<string, string[]> = {
      'new': ['packed', 'cancelled'],
      'packed': ['shipped', 'new'],
      'shipped': ['delivered', 'returned'],
      'delivered': ['completed', 'returned'],
      'completed': [],
      'returned': [],
      'cancelled': []
    };
    return transitions[currentStatus] || [];
  };

  return (
    <div className="min-h-screen bg-gray-50" data-testid="page-orders">
      <Sidebar user={user} />
      
      <div className="ml-64">
        <Header title="Orders" subtitle="Manage your marketplace orders" />
        
        <main className="p-6">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900" data-testid="heading-orders">Orders</h1>
              <p className="text-gray-500">Manage your marketplace orders</p>
            </div>
            
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                onClick={() => syncEbayMutation.mutate(30)}
                disabled={syncEbayMutation.isPending || !syncStatus?.ebay?.configured}
                data-testid="btn-sync-ebay"
              >
                {syncEbayMutation.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4 mr-2" />
                )}
                Sync eBay Orders
              </Button>
            </div>
          </div>

          {stats && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
              <Card>
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-gray-500">Total Orders</p>
                      <p className="text-2xl font-bold" data-testid="stat-total">{stats.total}</p>
                    </div>
                    <ShoppingBag className="w-8 h-8 text-gray-400" />
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-gray-500">New</p>
                      <p className="text-2xl font-bold text-blue-600" data-testid="stat-new">{stats.byStatus.new}</p>
                    </div>
                    <Clock className="w-8 h-8 text-blue-400" />
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-gray-500">Packed</p>
                      <p className="text-2xl font-bold text-yellow-600" data-testid="stat-packed">{stats.byStatus.packed}</p>
                    </div>
                    <Package className="w-8 h-8 text-yellow-400" />
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-gray-500">Shipped</p>
                      <p className="text-2xl font-bold text-purple-600" data-testid="stat-shipped">{stats.byStatus.shipped}</p>
                    </div>
                    <Truck className="w-8 h-8 text-purple-400" />
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-gray-500">eBay / Amazon</p>
                      <p className="text-2xl font-bold" data-testid="stat-marketplaces">
                        {stats.byMarketplace.ebay} / {stats.byMarketplace.amazon}
                      </p>
                    </div>
                    <SiEbay className="w-8 h-8 text-[#e53238]" />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          <Card className="mb-6">
            <CardContent className="pt-4">
              <div className="flex flex-wrap items-center gap-4">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                  <Input
                    placeholder="Search orders by ID, buyer, or address..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                    data-testid="input-search-orders"
                  />
                </div>
                
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-40" data-testid="select-status-filter">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    {ORDER_STATUSES.map(status => (
                      <SelectItem key={status.value} value={status.value}>
                        {status.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={marketplaceFilter} onValueChange={setMarketplaceFilter}>
                  <SelectTrigger className="w-40" data-testid="select-marketplace-filter">
                    <SelectValue placeholder="Marketplace" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Marketplaces</SelectItem>
                    <SelectItem value="ebay">eBay</SelectItem>
                    <SelectItem value="amazon">Amazon</SelectItem>
                  </SelectContent>
                </Select>

                <Button variant="outline" onClick={() => refetch()} data-testid="btn-refresh">
                  <RefreshCw className="w-4 h-4" />
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            {isLoading ? (
              <div className="p-8 text-center">
                <Loader2 className="w-8 h-8 animate-spin mx-auto text-gray-400" />
                <p className="text-gray-500 mt-2">Loading orders...</p>
              </div>
            ) : filteredOrders.length === 0 ? (
              <div className="p-8 text-center">
                <ShoppingBag className="w-12 h-12 mx-auto text-gray-300 mb-4" />
                <p className="text-gray-500">
                  {searchTerm || statusFilter !== "all" || marketplaceFilter !== "all"
                    ? "No orders found matching your filters."
                    : "No orders yet. Sync your eBay orders to get started."}
                </p>
              </div>
            ) : (
              <div className="divide-y divide-gray-200">
                {filteredOrders.map((order: any) => {
                  const itemCount = order.items?.length || 0;
                  const totalQty = order.items?.reduce((sum: number, item: any) => sum + (item.quantity || 1), 0) || 0;
                  
                  return (
                    <div 
                      key={order.id}
                      className="p-4 hover:bg-gray-50 cursor-pointer"
                      onClick={() => handleViewOrder(order)}
                      data-testid={`row-order-${order.id}`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-2">
                            <StatusBadge status={order.status} />
                            <span className="text-xs text-gray-500">
                              {order.orderDate ? format(new Date(order.orderDate), 'MMM d, HH:mm') : '-'}
                            </span>
                            <span className="text-xs text-gray-400">•</span>
                            <span className="text-xs font-mono text-gray-600">
                              #{order.marketplaceOrderId.slice(-8)}
                            </span>
                            {order.marketplace === 'ebay' && <SiEbay className="w-4 h-4 text-[#e53238]" />}
                            {order.marketplace === 'amazon' && <SiAmazon className="w-4 h-4 text-[#ff9900]" />}
                          </div>
                          
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <div>
                              <p className="text-xs text-gray-500 mb-1">Items ({totalQty} pcs)</p>
                              <div className="space-y-1">
                                {order.items?.slice(0, 3).map((item: any, idx: number) => (
                                  <div key={idx} className="flex items-center gap-2 text-sm">
                                    <span className="text-gray-900 truncate max-w-[200px]" title={item.title}>
                                      {item.quantity}x {item.sku || 'N/A'}
                                    </span>
                                    {item.tmeProductId && (
                                      <a
                                        href={`https://www.tme.eu/en/details/${item.tmeProductId}/`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-blue-600 hover:text-blue-800"
                                        onClick={e => e.stopPropagation()}
                                        title="View on TME"
                                      >
                                        <ExternalLink className="w-3 h-3" />
                                      </a>
                                    )}
                                  </div>
                                ))}
                                {order.items?.length > 3 && (
                                  <p className="text-xs text-gray-400">+{order.items.length - 3} more</p>
                                )}
                                {!order.items?.length && (
                                  <p className="text-xs text-gray-400">No items</p>
                                )}
                              </div>
                            </div>
                            
                            <div>
                              <p className="text-xs text-gray-500 mb-1">Ship to</p>
                              <p className="text-sm font-medium text-gray-900">{order.shippingName}</p>
                              <p className="text-xs text-gray-600 truncate" title={order.shippingAddressLine1}>
                                {order.shippingCity}, {order.shippingPostalCode}
                              </p>
                              <p className="text-xs text-gray-500">{order.shippingCountry}</p>
                            </div>
                            
                            <div>
                              <p className="text-xs text-gray-500 mb-1">Buyer</p>
                              <p className="text-sm font-medium text-gray-900">{order.buyerUsername}</p>
                              {order.buyerNote && (
                                <p className="text-xs text-yellow-600 flex items-center gap-1 mt-1">
                                  <StickyNote className="w-3 h-3" />
                                  Has note
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                        
                        <div className="text-right flex-shrink-0">
                          <p className="text-lg font-bold text-gray-900">
                            {formatCurrency(parseFloat(order.totalPrice))}
                          </p>
                          <p className="text-xs text-gray-500">{order.currency}</p>
                          {order.marketplaceFee && (
                            <p className="text-xs text-red-500">
                              -{formatCurrency(parseFloat(order.marketplaceFee))} fees
                            </p>
                          )}
                          <div className="flex items-center gap-1 mt-2 justify-end" onClick={e => e.stopPropagation()}>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleViewOrder(order)}
                              data-testid={`btn-view-order-${order.id}`}
                            >
                              <Eye className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => printLabelMutation.mutate(order.id)}
                              disabled={printLabelMutation.isPending}
                              data-testid={`btn-print-label-${order.id}`}
                            >
                              <Printer className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </main>
      </div>

      <Dialog open={orderDetailOpen} onOpenChange={setOrderDetailOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          {selectedOrder && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <MarketplaceBadge marketplace={selectedOrder.marketplace} />
                  Order #{selectedOrder.marketplaceOrderId.slice(-8)}
                </DialogTitle>
                <DialogDescription>
                  Full order ID: {selectedOrder.marketplaceOrderId}
                </DialogDescription>
              </DialogHeader>

              <Tabs defaultValue="details" className="mt-4">
                <TabsList>
                  <TabsTrigger value="details">Details</TabsTrigger>
                  <TabsTrigger value="items">Items</TabsTrigger>
                  <TabsTrigger value="shipping">Shipping</TabsTrigger>
                  <TabsTrigger value="history">History</TabsTrigger>
                </TabsList>

                <TabsContent value="details" className="space-y-4 mt-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label className="text-sm text-gray-500">Status</Label>
                      <div className="mt-1">
                        <StatusBadge status={selectedOrder.status} />
                      </div>
                    </div>
                    <div>
                      <Label className="text-sm text-gray-500">Order Date</Label>
                      <p className="font-medium">
                        {selectedOrder.orderDate 
                          ? format(new Date(selectedOrder.orderDate), 'PPpp')
                          : '-'}
                      </p>
                    </div>
                    <div>
                      <Label className="text-sm text-gray-500">Buyer</Label>
                      <p className="font-medium flex items-center gap-1">
                        <User className="w-4 h-4" />
                        {selectedOrder.buyerUsername}
                      </p>
                    </div>
                    <div>
                      <Label className="text-sm text-gray-500">Total</Label>
                      <p className="font-medium text-lg flex items-center gap-1">
                        <DollarSign className="w-4 h-4" />
                        {formatCurrency(parseFloat(selectedOrder.totalPrice))} {selectedOrder.currency}
                      </p>
                    </div>
                  </div>

                  <Separator />

                  <div>
                    <Label className="text-sm text-gray-500 mb-2 block">Pricing Breakdown</Label>
                    <div className="bg-gray-50 rounded-lg p-3 space-y-2">
                      <div className="flex justify-between text-sm">
                        <span>Subtotal</span>
                        <span>{formatCurrency(parseFloat(selectedOrder.subtotal))}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span>Shipping</span>
                        <span>{formatCurrency(parseFloat(selectedOrder.shippingCost))}</span>
                      </div>
                      {selectedOrder.marketplaceFee && (
                        <div className="flex justify-between text-sm text-red-600">
                          <span>Marketplace Fee</span>
                          <span>-{formatCurrency(parseFloat(selectedOrder.marketplaceFee))}</span>
                        </div>
                      )}
                      <Separator />
                      <div className="flex justify-between font-medium">
                        <span>Total</span>
                        <span>{formatCurrency(parseFloat(selectedOrder.totalPrice))}</span>
                      </div>
                    </div>
                  </div>

                  {selectedOrder.buyerNote && (
                    <div>
                      <Label className="text-sm text-gray-500 flex items-center gap-1">
                        <StickyNote className="w-4 h-4" />
                        Buyer Note
                      </Label>
                      <p className="mt-1 p-2 bg-yellow-50 rounded border border-yellow-200 text-sm">
                        {selectedOrder.buyerNote}
                      </p>
                    </div>
                  )}

                  <Separator />

                  <div>
                    <Label className="text-sm text-gray-500 mb-2 block">Update Status</Label>
                    <div className="flex gap-2">
                      <Select value={newStatus} onValueChange={setNewStatus}>
                        <SelectTrigger className="flex-1">
                          <SelectValue placeholder="Select new status" />
                        </SelectTrigger>
                        <SelectContent>
                          {getNextValidStatuses(selectedOrder.status).map(status => {
                            const info = getStatusInfo(status);
                            return (
                              <SelectItem key={status} value={status}>
                                {info.label}
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>
                      <Button
                        onClick={() => handleStatusChange(selectedOrder.id)}
                        disabled={!newStatus || updateStatusMutation.isPending}
                      >
                        {updateStatusMutation.isPending ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          "Update"
                        )}
                      </Button>
                    </div>
                    {newStatus === 'shipped' && (
                      <div className="mt-3 space-y-2">
                        <Input
                          placeholder="Tracking Number"
                          value={trackingNumber}
                          onChange={(e) => setTrackingNumber(e.target.value)}
                        />
                        <Input
                          placeholder="Carrier (e.g., Royal Mail, DHL)"
                          value={trackingCarrier}
                          onChange={(e) => setTrackingCarrier(e.target.value)}
                        />
                      </div>
                    )}
                    <Textarea
                      className="mt-2"
                      placeholder="Add a note (optional)"
                      value={statusNote}
                      onChange={(e) => setStatusNote(e.target.value)}
                    />
                  </div>
                </TabsContent>

                <TabsContent value="items" className="mt-4">
                  <div className="space-y-3">
                    {selectedOrder.items?.length ? (
                      selectedOrder.items.map((item) => (
                        <div key={item.id} className="p-3 border rounded-lg">
                          <div className="flex justify-between items-start">
                            <div className="flex-1">
                              <p className="font-medium">{item.title}</p>
                              <div className="flex items-center gap-4 mt-1 text-sm text-gray-500">
                                <span>SKU: {item.sku}</span>
                                <span>Qty: {item.quantity}</span>
                              </div>
                              {item.tmeProductId && (
                                <a
                                  href={`https://www.tme.eu/en/details/${item.tmeProductId}/`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-sm text-blue-600 hover:underline flex items-center gap-1 mt-1"
                                >
                                  View on TME <ExternalLink className="w-3 h-3" />
                                </a>
                              )}
                            </div>
                            <div className="text-right">
                              <p className="font-medium">{formatCurrency(parseFloat(item.totalPrice))}</p>
                              <p className="text-sm text-gray-500">
                                {formatCurrency(parseFloat(item.unitPrice))} each
                              </p>
                            </div>
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="text-gray-500 text-center py-4">No items found</p>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="shipping" className="mt-4 space-y-4">
                  <div>
                    <Label className="text-sm text-gray-500 flex items-center gap-1">
                      <MapPin className="w-4 h-4" />
                      Shipping Address
                    </Label>
                    <div className="mt-2 p-3 bg-gray-50 rounded-lg">
                      <p className="font-medium">{selectedOrder.shippingName}</p>
                      <p>{selectedOrder.shippingAddressLine1}</p>
                      {selectedOrder.shippingAddressLine2 && (
                        <p>{selectedOrder.shippingAddressLine2}</p>
                      )}
                      <p>
                        {selectedOrder.shippingCity}
                        {selectedOrder.shippingStateOrProvince && `, ${selectedOrder.shippingStateOrProvince}`}
                      </p>
                      <p>{selectedOrder.shippingPostalCode}</p>
                      <p>{selectedOrder.shippingCountry}</p>
                      {selectedOrder.shippingPhone && (
                        <p className="mt-2 text-sm text-gray-600">
                          Phone: {selectedOrder.shippingPhone}
                        </p>
                      )}
                    </div>
                  </div>

                  <div>
                    <Label className="text-sm text-gray-500 flex items-center gap-1">
                      <Truck className="w-4 h-4" />
                      Shipping Details
                    </Label>
                    <div className="mt-2 space-y-2">
                      {selectedOrder.shippingService && (
                        <p><span className="text-gray-500">Service:</span> {selectedOrder.shippingService}</p>
                      )}
                      {selectedOrder.trackingNumber && (
                        <p><span className="text-gray-500">Tracking:</span> {selectedOrder.trackingNumber}</p>
                      )}
                      {selectedOrder.shippingCarrier && (
                        <p><span className="text-gray-500">Carrier:</span> {selectedOrder.shippingCarrier}</p>
                      )}
                      {selectedOrder.trackingUrl && (
                        <a
                          href={selectedOrder.trackingUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline flex items-center gap-1"
                        >
                          Track Package <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  </div>

                  <Button
                    className="w-full"
                    onClick={() => printLabelMutation.mutate(selectedOrder.id)}
                    disabled={printLabelMutation.isPending}
                  >
                    <Printer className="w-4 h-4 mr-2" />
                    Print Shipping Label
                  </Button>
                </TabsContent>

                <TabsContent value="history" className="mt-4">
                  <div className="space-y-3">
                    {selectedOrder.events?.length ? (
                      selectedOrder.events.map((event) => (
                        <div key={event.id} className="flex items-start gap-3 p-3 border rounded-lg">
                          <History className="w-4 h-4 text-gray-400 mt-1" />
                          <div className="flex-1">
                            <div className="flex items-center justify-between">
                              <p className="font-medium capitalize">
                                {event.eventType.replace(/_/g, ' ')}
                              </p>
                              <p className="text-xs text-gray-500">
                                {event.createdAt 
                                  ? format(new Date(event.createdAt), 'PPp')
                                  : '-'}
                              </p>
                            </div>
                            {event.fromStatus && event.toStatus && (
                              <p className="text-sm text-gray-600">
                                {event.fromStatus} → {event.toStatus}
                              </p>
                            )}
                            {event.note && (
                              <p className="text-sm text-gray-600 mt-1">{event.note}</p>
                            )}
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="text-gray-500 text-center py-4">No history found</p>
                    )}
                  </div>
                </TabsContent>
              </Tabs>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

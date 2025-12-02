import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { 
  TrendingUp, 
  TrendingDown, 
  ShoppingCart, 
  Store, 
  AlertCircle,
  CheckCircle,
  Clock,
  Package,
  DollarSign,
  Activity,
  RefreshCw,
  Loader2,
  XCircle,
  Calendar,
  Zap
} from "lucide-react";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Product, Category } from "@shared/schema";

interface MarketplacesProps {
  user: any;
}

interface SyncStatus {
  dailySync: {
    status: string;
    lastRun: string | null;
    message: string;
    nextScheduled: string;
    details: { changedProducts: number; ebayUpdates: number; totalProducts: number };
  };
  ebaySync: {
    status: string;
    lastRun: string | null;
    successCount24h: number;
    errorCount24h: number;
    lastMessage: string;
  };
  tmeSync: {
    status: string;
    lastRun: string | null;
    successCount24h: number;
    errorCount24h: number;
    lastMessage: string;
  };
}

export function Marketplaces({ user }: MarketplacesProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [timeRange, setTimeRange] = useState<string>("7d");

  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ["/api/products"],
  });

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ["/api/categories"],
  });

  const { data: metrics } = useQuery({
    queryKey: ["/api/dashboard/metrics"],
  });

  // Sync status query
  const { data: syncStatusData, isLoading: syncStatusLoading } = useQuery<{
    success: boolean;
    syncStatus: SyncStatus;
    recentLogs: any[];
  }>({
    queryKey: ["/api/sync/status"],
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  const syncStatus = syncStatusData?.syncStatus;

  // API Usage queries
  const { data: tmeUsageData } = useQuery<{
    success: boolean;
    usage: {
      callsToday: number;
      dailyLimit: number;
      remainingDaily: number;
      usagePercentage: number;
      status: string;
    };
  }>({
    queryKey: ["/api/tme/usage"],
    refetchInterval: 30000,
  });

  const { data: ebayUsageData } = useQuery<{
    success: boolean;
    usage: {
      callsToday: number;
      dailyLimit: number;
      remainingDaily: number;
      usagePercentage: number;
      status: string;
    };
  }>({
    queryKey: ["/api/ebay/usage"],
    refetchInterval: 30000,
  });

  const tmeUsage = tmeUsageData?.usage;
  const ebayUsage = ebayUsageData?.usage;

  // Manual sync trigger mutations
  const triggerDailySyncMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/sync/trigger-daily");
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Daily Sync Completed",
        description: data.message || "Sync completed successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/sync/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
    },
    onError: (error: any) => {
      toast({
        title: "Sync Failed",
        description: error.message || "Failed to run daily sync",
        variant: "destructive",
      });
    },
  });

  const triggerEbaySyncMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/sync/trigger-ebay");
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "eBay Sync Completed",
        description: data.message || `Updated ${data.result?.succeeded || 0} listings`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/sync/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
    },
    onError: (error: any) => {
      toast({
        title: "eBay Sync Failed",
        description: error.message || "Failed to sync eBay listings",
        variant: "destructive",
      });
    },
  });

  // Helper to format relative time
  const formatRelativeTime = (dateStr: string | null) => {
    if (!dateStr) return "Never";
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  };

  // Helper to get status icon and color
  const getStatusDisplay = (status: string) => {
    switch (status) {
      case "success":
        return { icon: CheckCircle, color: "text-green-600", bg: "bg-green-50", label: "Healthy" };
      case "error":
        return { icon: XCircle, color: "text-red-600", bg: "bg-red-50", label: "Error" };
      case "running":
        return { icon: Loader2, color: "text-blue-600", bg: "bg-blue-50", label: "Running" };
      case "idle":
        return { icon: Clock, color: "text-gray-500", bg: "bg-gray-50", label: "Idle" };
      default:
        return { icon: AlertCircle, color: "text-yellow-600", bg: "bg-yellow-50", label: "Unknown" };
    }
  };

  // Calculate analytics
  const totalProducts = products.length;
  const ebayListings = products.filter(p => p.listedOnEbay).length;
  const amazonListings = products.filter(p => p.listedOnAmazon).length;
  const outOfStock = products.filter(p => p.stock === 0).length;
  const excludedProducts = products.filter(p => p.excludeFromListing).length;

  const ebayEligible = products.filter(p => 
    !p.listedOnEbay && !p.excludeFromListing && p.stock > 0
  ).length;

  const amazonEligible = products.filter(p => 
    !p.listedOnAmazon && !p.excludeFromListing && p.stock > 0
  ).length;

  const listingHealth = {
    healthy: products.filter(p => 
      (p.listedOnEbay || p.listedOnAmazon) && p.stock > 0
    ).length,
    outOfStock: products.filter(p => 
      (p.listedOnEbay || p.listedOnAmazon) && p.stock === 0
    ).length,
    excluded: excludedProducts
  };

  const ebayListingRate = totalProducts > 0 ? (ebayListings / totalProducts) * 100 : 0;
  const amazonListingRate = totalProducts > 0 ? (amazonListings / totalProducts) * 100 : 0;

  // Category breakdown
  const categoryBreakdown = categories.map(cat => {
    const catProducts = products.filter(p => p.category === cat.name);
    const ebayListed = catProducts.filter(p => p.listedOnEbay).length;
    const amazonListed = catProducts.filter(p => p.listedOnAmazon).length;

    return {
      name: cat.name,
      total: catProducts.length,
      ebayListed,
      amazonListed,
      ebayRate: catProducts.length > 0 ? (ebayListed / catProducts.length) * 100 : 0,
      amazonRate: catProducts.length > 0 ? (amazonListed / catProducts.length) * 100 : 0,
    };
  }).filter(cat => cat.total > 0);

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar user={user} />
      <div className="ml-64">
        <Header 
          title="Marketplace Analytics" 
          subtitle="Monitor listing performance and marketplace health"
        />

        <div className="p-6 space-y-6">
          {/* Sync Jobs Status Section */}
          <div className="mb-2">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <RefreshCw className="w-5 h-5" />
              Sync Jobs Status
            </h2>
            
            {syncStatusLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[1, 2, 3].map((i) => (
                  <Card key={i} className="animate-pulse">
                    <CardContent className="p-6">
                      <div className="h-24 bg-gray-200 rounded"></div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : !syncStatus ? (
              <Card className="border-yellow-200 bg-yellow-50">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 text-yellow-700">
                    <AlertCircle className="w-4 h-4" />
                    <span className="text-sm">Unable to load sync status. The sync jobs are still running in the background.</span>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Daily Sync Card */}
                <Card className="border-l-4 border-l-blue-500">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-blue-600" />
                        Daily Sync (TME → eBay)
                      </CardTitle>
                      {syncStatus?.dailySync && (() => {
                        const display = getStatusDisplay(syncStatus.dailySync.status);
                        return (
                          <Badge className={`${display.bg} ${display.color} border-0`}>
                            <display.icon className={`w-3 h-3 mr-1 ${syncStatus.dailySync.status === 'running' ? 'animate-spin' : ''}`} />
                            {display.label}
                          </Badge>
                        );
                      })()}
                    </div>
                    <CardDescription className="text-xs">
                      Scheduled: {syncStatus?.dailySync?.nextScheduled || '02:00 AM'}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="pt-2">
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">Last Run:</span>
                        <span className="font-medium">{formatRelativeTime(syncStatus?.dailySync?.lastRun || null)}</span>
                      </div>
                      {syncStatus?.dailySync?.details && (
                        <>
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-500">Products Changed:</span>
                            <span className="font-medium text-blue-600">{syncStatus.dailySync.details.changedProducts}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-500">eBay Updates:</span>
                            <span className="font-medium text-green-600">{syncStatus.dailySync.details.ebayUpdates}</span>
                          </div>
                        </>
                      )}
                      <p className="text-xs text-gray-500 truncate mt-2" title={syncStatus?.dailySync?.message}>
                        {syncStatus?.dailySync?.message || 'No sync runs recorded'}
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full mt-2"
                        onClick={() => triggerDailySyncMutation.mutate()}
                        disabled={triggerDailySyncMutation.isPending}
                        data-testid="btn-trigger-daily-sync"
                      >
                        {triggerDailySyncMutation.isPending ? (
                          <><Loader2 className="w-3 h-3 mr-2 animate-spin" />Running...</>
                        ) : (
                          <><Zap className="w-3 h-3 mr-2" />Run Now</>
                        )}
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                {/* eBay Sync Card */}
                <Card className="border-l-4 border-l-green-500">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <ShoppingCart className="w-4 h-4 text-green-600" />
                        eBay Sync
                      </CardTitle>
                      {syncStatus?.ebaySync && (() => {
                        const display = getStatusDisplay(syncStatus.ebaySync.status);
                        return (
                          <Badge className={`${display.bg} ${display.color} border-0`}>
                            <display.icon className="w-3 h-3 mr-1" />
                            {display.label}
                          </Badge>
                        );
                      })()}
                    </div>
                    <CardDescription className="text-xs">
                      Listing & inventory updates
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="pt-2">
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">Last Activity:</span>
                        <span className="font-medium">{formatRelativeTime(syncStatus?.ebaySync?.lastRun || null)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">Success (24h):</span>
                        <span className="font-medium text-green-600">{syncStatus?.ebaySync?.successCount24h || 0}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">Errors (24h):</span>
                        <span className={`font-medium ${(syncStatus?.ebaySync?.errorCount24h || 0) > 0 ? 'text-red-600' : 'text-gray-600'}`}>
                          {syncStatus?.ebaySync?.errorCount24h || 0}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 truncate mt-2" title={syncStatus?.ebaySync?.lastMessage}>
                        {syncStatus?.ebaySync?.lastMessage || 'No recent eBay operations'}
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full mt-2"
                        onClick={() => triggerEbaySyncMutation.mutate()}
                        disabled={triggerEbaySyncMutation.isPending}
                        data-testid="btn-trigger-ebay-sync"
                      >
                        {triggerEbaySyncMutation.isPending ? (
                          <><Loader2 className="w-3 h-3 mr-2 animate-spin" />Syncing...</>
                        ) : (
                          <><RefreshCw className="w-3 h-3 mr-2" />Sync eBay</>
                        )}
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                {/* TME Sync Card */}
                <Card className="border-l-4 border-l-purple-500">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <Package className="w-4 h-4 text-purple-600" />
                        TME Sync
                      </CardTitle>
                      {syncStatus?.tmeSync && (() => {
                        const display = getStatusDisplay(syncStatus.tmeSync.status);
                        return (
                          <Badge className={`${display.bg} ${display.color} border-0`}>
                            <display.icon className="w-3 h-3 mr-1" />
                            {display.label}
                          </Badge>
                        );
                      })()}
                    </div>
                    <CardDescription className="text-xs">
                      Product data from TME supplier
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="pt-2">
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">Last Activity:</span>
                        <span className="font-medium">{formatRelativeTime(syncStatus?.tmeSync?.lastRun || null)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">Success (24h):</span>
                        <span className="font-medium text-green-600">{syncStatus?.tmeSync?.successCount24h || 0}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">Errors (24h):</span>
                        <span className={`font-medium ${(syncStatus?.tmeSync?.errorCount24h || 0) > 0 ? 'text-red-600' : 'text-gray-600'}`}>
                          {syncStatus?.tmeSync?.errorCount24h || 0}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 truncate mt-2" title={syncStatus?.tmeSync?.lastMessage}>
                        {syncStatus?.tmeSync?.lastMessage || 'No recent TME operations'}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* API Usage Section */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              {/* TME API Usage */}
              <Card className="border-l-4 border-l-purple-500">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <Zap className="w-4 h-4 text-purple-600" />
                      TME API Usage
                    </CardTitle>
                    <Badge className={`border-0 ${
                      tmeUsage?.status === 'LIMIT_EXCEEDED' ? 'bg-red-50 text-red-600' :
                      tmeUsage?.status === 'WARNING' ? 'bg-yellow-50 text-yellow-600' :
                      'bg-green-50 text-green-600'
                    }`}>
                      {tmeUsage?.status === 'LIMIT_EXCEEDED' ? 'Exceeded' :
                       tmeUsage?.status === 'WARNING' ? 'Warning' : 'Normal'}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="pt-2">
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Calls Today:</span>
                      <span className="font-medium">{tmeUsage?.callsToday?.toLocaleString() || 0} / {tmeUsage?.dailyLimit?.toLocaleString() || '10,000'}</span>
                    </div>
                    <Progress 
                      value={tmeUsage?.usagePercentage || 0} 
                      className="h-2"
                    />
                    <div className="flex justify-between text-xs text-gray-500">
                      <span>{tmeUsage?.usagePercentage || 0}% used</span>
                      <span>{tmeUsage?.remainingDaily?.toLocaleString() || 0} remaining</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* eBay API Usage */}
              <Card className="border-l-4 border-l-green-500">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <Zap className="w-4 h-4 text-green-600" />
                      eBay API Usage
                    </CardTitle>
                    <Badge className={`border-0 ${
                      ebayUsage?.status === 'LIMIT_EXCEEDED' ? 'bg-red-50 text-red-600' :
                      ebayUsage?.status === 'WARNING' ? 'bg-yellow-50 text-yellow-600' :
                      'bg-green-50 text-green-600'
                    }`}>
                      {ebayUsage?.status === 'LIMIT_EXCEEDED' ? 'Exceeded' :
                       ebayUsage?.status === 'WARNING' ? 'Warning' : 'Normal'}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="pt-2">
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Calls Today:</span>
                      <span className="font-medium">{ebayUsage?.callsToday?.toLocaleString() || 0} / {ebayUsage?.dailyLimit?.toLocaleString() || '5,000'}</span>
                    </div>
                    <Progress 
                      value={ebayUsage?.usagePercentage || 0} 
                      className="h-2"
                    />
                    <div className="flex justify-between text-xs text-gray-500">
                      <span>{ebayUsage?.usagePercentage || 0}% used</span>
                      <span>{ebayUsage?.remainingDaily?.toLocaleString() || 0} remaining</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Time Range Selector */}
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold text-gray-900">Marketplace Performance</h2>
            <Select value={timeRange} onValueChange={setTimeRange}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="24h">Last 24 Hours</SelectItem>
                <SelectItem value="7d">Last 7 Days</SelectItem>
                <SelectItem value="30d">Last 30 Days</SelectItem>
                <SelectItem value="90d">Last 90 Days</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Key Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-gray-600 flex items-center">
                  <Package className="w-4 h-4 mr-2" />
                  Total Products
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-gray-900">{formatNumber(totalProducts)}</div>
                <div className="flex items-center mt-2 text-sm">
                  <span className="text-gray-500">{excludedProducts} excluded from listing</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-gray-600 flex items-center">
                  <ShoppingCart className="w-4 h-4 mr-2" />
                  eBay Performance
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-green-600">{formatNumber(ebayListings)}</div>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-sm text-gray-500">{ebayListingRate.toFixed(1)}% listed</span>
                  <Badge variant="outline" className="text-xs">
                    {ebayEligible} eligible
                  </Badge>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-gray-600 flex items-center">
                  <Store className="w-4 h-4 mr-2" />
                  Amazon Performance
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-orange-600">{formatNumber(amazonListings)}</div>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-sm text-gray-500">{amazonListingRate.toFixed(1)}% listed</span>
                  <Badge variant="outline" className="text-xs">
                    {amazonEligible} eligible
                  </Badge>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-gray-600 flex items-center">
                  <Activity className="w-4 h-4 mr-2" />
                  Listing Health
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-blue-600">{formatNumber(listingHealth.healthy)}</div>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-sm text-gray-500">Active listings</span>
                  {listingHealth.outOfStock > 0 && (
                    <Badge variant="destructive" className="text-xs">
                      {listingHealth.outOfStock} OOS
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Marketplace Coverage */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>eBay Coverage</span>
                  <Badge variant="outline">{ebayListingRate.toFixed(1)}%</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-gray-600">Listed Products</span>
                    <span className="font-medium">{ebayListings} / {totalProducts}</span>
                  </div>
                  <Progress value={ebayListingRate} className="h-2" />
                </div>

                <div className="grid grid-cols-2 gap-4 pt-4 border-t">
                  <div>
                    <div className="text-2xl font-bold text-green-600">{ebayEligible}</div>
                    <div className="text-xs text-gray-500">Ready to List</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-gray-900">{ebayListings}</div>
                    <div className="text-xs text-gray-500">Currently Listed</div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>Amazon Coverage</span>
                  <Badge variant="outline">{amazonListingRate.toFixed(1)}%</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-gray-600">Listed Products</span>
                    <span className="font-medium">{amazonListings} / {totalProducts}</span>
                  </div>
                  <Progress value={amazonListingRate} className="h-2" />
                </div>

                <div className="grid grid-cols-2 gap-4 pt-4 border-t">
                  <div>
                    <div className="text-2xl font-bold text-orange-600">{amazonEligible}</div>
                    <div className="text-xs text-gray-500">Ready to List</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-gray-900">{amazonListings}</div>
                    <div className="text-xs text-gray-500">Currently Listed</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Listing Health Status */}
          <Card>
            <CardHeader>
              <CardTitle>Listing Health Overview</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="flex items-center space-x-4 p-4 bg-green-50 rounded-lg">
                  <CheckCircle className="w-10 h-10 text-green-600" />
                  <div>
                    <div className="text-2xl font-bold text-green-900">{listingHealth.healthy}</div>
                    <div className="text-sm text-green-700">Healthy Listings</div>
                    <div className="text-xs text-green-600 mt-1">In stock & active</div>
                  </div>
                </div>

                <div className="flex items-center space-x-4 p-4 bg-red-50 rounded-lg">
                  <AlertCircle className="w-10 h-10 text-red-600" />
                  <div>
                    <div className="text-2xl font-bold text-red-900">{listingHealth.outOfStock}</div>
                    <div className="text-sm text-red-700">Out of Stock</div>
                    <div className="text-xs text-red-600 mt-1">Needs attention</div>
                  </div>
                </div>

                <div className="flex items-center space-x-4 p-4 bg-gray-50 rounded-lg">
                  <Clock className="w-10 h-10 text-gray-600" />
                  <div>
                    <div className="text-2xl font-bold text-gray-900">{listingHealth.excluded}</div>
                    <div className="text-sm text-gray-700">Excluded</div>
                    <div className="text-xs text-gray-600 mt-1">Not available for listing</div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Category Performance */}
          <Card>
            <CardHeader>
              <CardTitle>Category Performance</CardTitle>
            </CardHeader>
            <CardContent>
              {categoryBreakdown.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  No category data available
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Category
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Total Products
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          eBay Listed
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Amazon Listed
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Coverage
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {categoryBreakdown.map((cat) => (
                        <tr key={cat.name} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                            {cat.name}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {cat.total}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex items-center space-x-2">
                              <span className="text-sm text-gray-900">{cat.ebayListed}</span>
                              <Badge variant="outline" className="text-xs">
                                {cat.ebayRate.toFixed(0)}%
                              </Badge>
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex items-center space-x-2">
                              <span className="text-sm text-gray-900">{cat.amazonListed}</span>
                              <Badge variant="outline" className="text-xs">
                                {cat.amazonRate.toFixed(0)}%
                              </Badge>
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="w-24">
                              <Progress 
                                value={Math.max(cat.ebayRate, cat.amazonRate)} 
                                className="h-2" 
                              />
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Quick Stats Summary */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm text-gray-600">Total Revenue</div>
                    <div className="text-2xl font-bold text-gray-900">
                      {formatCurrency(metrics?.totalRevenue || 0)}
                    </div>
                  </div>
                  <DollarSign className="w-8 h-8 text-purple-600" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm text-gray-600">Avg. Product Value</div>
                    <div className="text-2xl font-bold text-gray-900">
                      {totalProducts > 0 
                        ? formatCurrency(
                            products.reduce((sum, p) => sum + p.salePrice, 0) / totalProducts
                          )
                        : formatCurrency(0)
                      }
                    </div>
                  </div>
                  <TrendingUp className="w-8 h-8 text-green-600" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm text-gray-600">Stock Value</div>
                    <div className="text-2xl font-bold text-gray-900">
                      {formatCurrency(
                        products.reduce((sum, p) => sum + (p.salePrice * p.stock), 0)
                      )}
                    </div>
                  </div>
                  <Package className="w-8 h-8 text-blue-600" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm text-gray-600">Listing Efficiency</div>
                    <div className="text-2xl font-bold text-gray-900">
                      {((ebayListingRate + amazonListingRate) / 2).toFixed(1)}%
                    </div>
                  </div>
                  <Activity className="w-8 h-8 text-orange-600" />
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
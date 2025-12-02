import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  Play, Pause, BarChart3, Clock, CheckCircle, XCircle, 
  AlertTriangle, RefreshCw, Upload, TrendingUp, Database
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface QueueStats {
  processed: number;
  successful: number;
  failed: number;
  remaining: number;
  apiCallsUsed: number;
  dailyLimit: number;
  byPriority: Record<string, number>;
}

interface QueueStatus {
  isProcessing: boolean;
  callsToday: number;
  dailyLimit: number;
  remainingCalls: number;
  canProcess: boolean;
}

export function QueueManagement({ user }: { user: any }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedPriority, setSelectedPriority] = useState<number>(3);
  const [selectedOperation, setSelectedOperation] = useState<string>("list");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Fetch queue status and stats
  const { data: queueData, isLoading } = useQuery<{
    success: boolean;
    status: QueueStatus;
    stats: QueueStats;
  }>({
    queryKey: ["/api/queue/status"],
    refetchInterval: 5000, // Auto-refresh every 5 seconds
  });

  const { data: products = [] } = useQuery<Array<{ id: number; name: string; sku: string }>>({
    queryKey: ["/api/products"],
  });

  // Process queue mutation
  const processQueueMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/queue/process"),
    onSuccess: (data: any) => {
      toast({
        title: "Queue Processing Started",
        description: `Processing ${data.stats?.processed || 0} items from queue`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/queue/status"] });
    },
    onError: (error: any) => {
      toast({
        title: "Queue Processing Failed",
        description: error.message || "Failed to start queue processing",
        variant: "destructive",
      });
    },
  });

  // Add all products to queue
  const bulkAddMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/queue/bulk-add", {
      productIds: products.map(p => p.id),
      operation: selectedOperation,
      priority: selectedPriority
    }),
    onSuccess: (data: any) => {
      toast({
        title: "Bulk Queue Added",
        description: `Added ${data.count || 0} products to ${selectedOperation} queue`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/queue/status"] });
    },
    onError: (error: any) => {
      toast({
        title: "Bulk Add Failed",
        description: error.message || "Failed to add products to queue",
        variant: "destructive",
      });
    },
  });

  // Stop queue processing
  const stopQueueMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/queue/stop"),
    onSuccess: () => {
      toast({
        title: "Queue Stopped",
        description: "Queue processing has been stopped",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/queue/status"] });
    },
    onError: (error: any) => {
      toast({
        title: "Stop Failed",
        description: error.message || "Failed to stop queue processing",
        variant: "destructive",
      });
    },
  });

  const status = queueData?.status;
  const stats = queueData?.stats;

  // Calculate processing percentage
  const dailyUsagePercent = status ? (status.callsToday / status.dailyLimit) * 100 : 0;
  const remainingPercent = stats ? (stats.remaining / (stats.remaining + stats.processed)) * 100 : 0;

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar user={user} collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} />
      <div className={`transition-all duration-200 ${sidebarCollapsed ? 'ml-16' : 'ml-64'}`}>
        <Header 
          title="Queue Management" 
          subtitle="Enterprise-scale eBay listing queue for 150K+ products"
        />
        
        <div className="p-6 space-y-6">
          {/* Status Overview Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center space-x-2">
                  <div className={`h-3 w-3 rounded-full ${status?.isProcessing ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`}></div>
                  <span className="text-sm font-medium">
                    {status?.isProcessing ? 'Processing' : 'Idle'}
                  </span>
                </div>
                <div className="mt-2">
                  <div className="text-2xl font-bold">{status?.callsToday || 0}</div>
                  <div className="text-xs text-gray-500">API calls today</div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center space-x-2">
                  <Clock className="h-4 w-4 text-yellow-500" />
                  <span className="text-sm font-medium">Queue Pending</span>
                </div>
                <div className="mt-2">
                  <div className="text-2xl font-bold">{stats?.remaining || 0}</div>
                  <div className="text-xs text-gray-500">products waiting</div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center space-x-2">
                  <CheckCircle className="h-4 w-4 text-green-500" />
                  <span className="text-sm font-medium">Completed</span>
                </div>
                <div className="mt-2">
                  <div className="text-2xl font-bold">{stats?.successful || 0}</div>
                  <div className="text-xs text-gray-500">successful today</div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center space-x-2">
                  <TrendingUp className="h-4 w-4 text-blue-500" />
                  <span className="text-sm font-medium">Daily Capacity</span>
                </div>
                <div className="mt-2">
                  <div className="text-2xl font-bold">{status?.remainingCalls || 0}</div>
                  <div className="text-xs text-gray-500">calls remaining</div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Progress Bars */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Daily API Usage</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Used: {status?.callsToday || 0}</span>
                    <span>Limit: {status?.dailyLimit || 4500}</span>
                  </div>
                  <Progress value={dailyUsagePercent} className="h-3" />
                  <div className="text-xs text-gray-500">
                    {dailyUsagePercent.toFixed(1)}% of daily limit used
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Queue Progress</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Pending: {stats?.remaining || 0}</span>
                    <span>Processed: {stats?.processed || 0}</span>
                  </div>
                  <Progress value={100 - remainingPercent} className="h-3" />
                  <div className="text-xs text-gray-500">
                    {(100 - remainingPercent).toFixed(1)}% completed
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Queue Controls */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Database className="h-5 w-5" />
                <span>Queue Operations</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Bulk Add Section */}
                <div className="space-y-4">
                  <h3 className="font-medium">Bulk Add to Queue</h3>
                  <div className="space-y-3">
                    <div>
                      <label className="text-sm font-medium">Operation Type</label>
                      <Select value={selectedOperation} onValueChange={setSelectedOperation}>
                        <SelectTrigger className="mt-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="list">List Products</SelectItem>
                          <SelectItem value="update_price">Update Prices</SelectItem>
                          <SelectItem value="update_stock">Update Stock</SelectItem>
                          <SelectItem value="unlist">Unlist Products</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    
                    <div>
                      <label className="text-sm font-medium">Priority Level</label>
                      <Select value={selectedPriority.toString()} onValueChange={(value) => setSelectedPriority(parseInt(value))}>
                        <SelectTrigger className="mt-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1">Critical (Priority 1)</SelectItem>
                          <SelectItem value="2">High (Priority 2)</SelectItem>
                          <SelectItem value="3">Medium (Priority 3)</SelectItem>
                          <SelectItem value="4">Low (Priority 4)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <Button 
                      onClick={() => bulkAddMutation.mutate()}
                      disabled={bulkAddMutation.isPending || products.length === 0}
                      className="w-full"
                    >
                      <Upload className="h-4 w-4 mr-2" />
                      Add {products.length} Products to Queue
                    </Button>
                  </div>
                </div>

                {/* Process Controls */}
                <div className="space-y-4">
                  <h3 className="font-medium">Queue Processing</h3>
                  <div className="space-y-3">
                    <div className="p-3 bg-gray-50 rounded-lg">
                      <div className="text-sm">
                        <div><strong>Status:</strong> {status?.isProcessing ? 'Processing' : 'Idle'}</div>
                        <div><strong>Can Process:</strong> {status?.canProcess ? 'Yes' : 'No'}</div>
                        <div><strong>Rate Limit:</strong> 1 call per second</div>
                      </div>
                    </div>

                    <div className="flex space-x-2">
                      <Button 
                        onClick={() => processQueueMutation.mutate()}
                        disabled={processQueueMutation.isPending || !status?.canProcess}
                        className="flex-1"
                      >
                        <Play className="h-4 w-4 mr-2" />
                        Start Processing
                      </Button>

                      <Button 
                        variant="outline"
                        onClick={() => stopQueueMutation.mutate()}
                        disabled={!status?.isProcessing}
                        className="flex-1"
                      >
                        <Pause className="h-4 w-4 mr-2" />
                        Stop
                      </Button>
                    </div>

                    <Button 
                      variant="outline"
                      onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/queue/status"] })}
                      className="w-full"
                    >
                      <RefreshCw className="h-4 w-4 mr-2" />
                      Refresh Status
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Priority Breakdown */}
          {stats?.byPriority && Object.keys(stats.byPriority).length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <BarChart3 className="h-5 w-5" />
                  <span>Queue Breakdown by Priority</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {Object.entries(stats.byPriority).map(([priority, count]) => (
                    <div key={priority} className="text-center">
                      <div className="text-2xl font-bold">{count}</div>
                      <div className="text-sm text-gray-500">{priority}</div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Enterprise Scale Information */}
          <Card className="border-blue-200 bg-blue-50">
            <CardHeader>
              <CardTitle className="text-blue-800">150K Product Scale Information</CardTitle>
            </CardHeader>
            <CardContent className="text-blue-700">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                <div>
                  <strong>Timeline:</strong> 150K products ÷ 4,500 daily limit = ~33 days for complete listing
                </div>
                <div>
                  <strong>Rate Limiting:</strong> 1.1 second intervals between API calls for safety
                </div>
                <div>
                  <strong>Batch Processing:</strong> Up to 100 products processed per queue run
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Error States */}
          {!status?.canProcess && status?.callsToday >= (status?.dailyLimit || 4500) && (
            <Card className="border-red-200 bg-red-50">
              <CardContent className="p-4">
                <div className="flex items-center space-x-2 text-red-700">
                  <AlertTriangle className="h-5 w-5" />
                  <span className="font-medium">Daily API Limit Reached</span>
                </div>
                <div className="mt-2 text-sm text-red-600">
                  Queue processing is paused until tomorrow. Daily limits reset at midnight.
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
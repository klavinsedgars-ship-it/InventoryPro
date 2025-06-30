import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { RefreshCw, CheckCircle, XCircle, Clock, Download, Upload, Package } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatNumber } from "@/lib/utils";
import type { SyncLog } from "@shared/schema";

interface TMESyncProps {
  user: any;
}

export function TMESync({ user }: TMESyncProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [syncProgress, setSyncProgress] = useState(0);
  const [isManualSync, setIsManualSync] = useState(false);

  const { data: syncLogs = [], isLoading: logsLoading } = useQuery<SyncLog[]>({
    queryKey: ["/api/sync/logs"],
    refetchInterval: 5000, // Refresh every 5 seconds
  });

  const { data: metrics } = useQuery({
    queryKey: ["/api/dashboard/metrics"],
  });

  const syncMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/sync/tme"),
    onMutate: () => {
      setIsManualSync(true);
      setSyncProgress(0);
      // Simulate progress
      const interval = setInterval(() => {
        setSyncProgress(prev => {
          if (prev >= 95) {
            clearInterval(interval);
            return 95;
          }
          return prev + Math.random() * 15;
        });
      }, 300);
    },
    onSuccess: () => {
      setSyncProgress(100);
      toast({
        title: "Sync Completed",
        description: "TME sync has been completed successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/sync/logs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/metrics"] });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      setTimeout(() => {
        setIsManualSync(false);
        setSyncProgress(0);
      }, 2000);
    },
    onError: (error: any) => {
      setSyncProgress(0);
      setIsManualSync(false);
      toast({
        title: "Sync Failed",
        description: error.message || "Failed to sync with TME supplier.",
        variant: "destructive",
      });
    },
  });

  const multipackSyncMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/sync/tme/multipacks"),
    onSuccess: (data: any) => {
      toast({
        title: "Multipack Sync Completed",
        description: `${data.message || "Successfully synced multipack components"}`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/sync/logs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/metrics"] });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
    },
    onError: (error: any) => {
      toast({
        title: "Multipack Sync Failed",
        description: error.message || "Failed to sync multipack components.",
        variant: "destructive",
      });
    },
  });

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "success":
        return <CheckCircle className="w-4 h-4 text-green-600" />;
      case "error":
        return <XCircle className="w-4 h-4 text-red-600" />;
      case "pending":
        return <Clock className="w-4 h-4 text-yellow-600" />;
      default:
        return <Clock className="w-4 h-4 text-gray-400" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "success":
        return "bg-green-100 text-green-800";
      case "error":
        return "bg-red-100 text-red-800";
      case "pending":
        return "bg-yellow-100 text-yellow-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  const recentLogs = syncLogs.slice(0, 10);
  const successfulSyncs = syncLogs.filter(log => log.status === "success").length;
  const failedSyncs = syncLogs.filter(log => log.status === "error").length;
  const lastSync = syncLogs[0];

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar user={user} />
      <div className="ml-64">
        <Header 
          title="TME Sync" 
          subtitle="Synchronize product data with TME supplier"
        />
        
        <div className="p-6">
          {/* Sync Status Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-gray-600">Total Products</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold text-gray-900">
                  {metrics ? formatNumber((metrics as any).totalProducts) : "0"}
                </div>
                <p className="text-xs text-gray-500 mt-1">Products in inventory</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-gray-600">Successful Syncs</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold text-green-600">{successfulSyncs}</div>
                <p className="text-xs text-gray-500 mt-1">Completed successfully</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-gray-600">Failed Syncs</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold text-red-600">{failedSyncs}</div>
                <p className="text-xs text-gray-500 mt-1">Encountered errors</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-gray-600">Last Sync</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-sm font-medium text-gray-900">
                  {lastSync ? new Date(lastSync.syncedAt!).toLocaleDateString() : "Never"}
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  {lastSync ? new Date(lastSync.syncedAt!).toLocaleTimeString() : "No sync yet"}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Manual Sync Section */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="text-lg font-medium text-gray-900">Manual Sync</CardTitle>
              <p className="text-sm text-gray-600">
                Trigger a manual synchronization with TME supplier to update product information
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              {isManualSync && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span>Synchronizing with TME...</span>
                    <span>{Math.round(syncProgress)}%</span>
                  </div>
                  <Progress value={syncProgress} className="w-full" />
                </div>
              )}
              
              <div className="flex space-x-4">
                <Button
                  onClick={() => syncMutation.mutate()}
                  disabled={syncMutation.isPending || isManualSync}
                  className="flex items-center space-x-2"
                >
                  <RefreshCw className={`w-4 h-4 ${(syncMutation.isPending || isManualSync) && "animate-spin"}`} />
                  <span>
                    {syncMutation.isPending || isManualSync ? "Syncing..." : "Start Manual Sync"}
                  </span>
                </Button>
                
                <Button 
                  variant="outline" 
                  className="flex items-center space-x-2"
                  onClick={() => multipackSyncMutation.mutate()}
                  disabled={multipackSyncMutation.isPending}
                >
                  <Package className={`w-4 h-4 ${multipackSyncMutation.isPending && "animate-spin"}`} />
                  <span>
                    {multipackSyncMutation.isPending ? "Syncing Multipacks..." : "Sync Multipack Components"}
                  </span>
                </Button>
                
                <Button variant="outline" className="flex items-center space-x-2">
                  <Download className="w-4 h-4" />
                  <span>Download Catalog</span>
                </Button>
                
                <Button variant="outline" className="flex items-center space-x-2">
                  <Upload className="w-4 h-4" />
                  <span>Upload Changes</span>
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Sync History */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-medium text-gray-900">Sync History</CardTitle>
              <p className="text-sm text-gray-600">
                Recent synchronization activities and their status
              </p>
            </CardHeader>
            <CardContent>
              {logsLoading ? (
                <div className="space-y-3">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="h-16 bg-gray-200 rounded animate-pulse"></div>
                  ))}
                </div>
              ) : recentLogs.length === 0 ? (
                <div className="text-center py-8">
                  <RefreshCw className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 mb-2">No sync history</h3>
                  <p className="text-gray-600 mb-4">Start your first sync to see the history here.</p>
                  <Button onClick={() => syncMutation.mutate()}>
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Start First Sync
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {recentLogs.map((log) => (
                    <div
                      key={log.id}
                      className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:bg-gray-50"
                    >
                      <div className="flex items-center space-x-3">
                        {getStatusIcon(log.status)}
                        <div>
                          <div className="text-sm font-medium text-gray-900">
                            {log.source.toUpperCase()} Sync
                          </div>
                          <div className="text-sm text-gray-500">
                            {log.message || "Sync completed"}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center space-x-3">
                        <Badge variant="secondary" className={getStatusColor(log.status)}>
                          {log.status.charAt(0).toUpperCase() + log.status.slice(1)}
                        </Badge>
                        <div className="text-sm text-gray-500">
                          {new Date(log.syncedAt!).toLocaleString()}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
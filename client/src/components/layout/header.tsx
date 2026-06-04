import { useState } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw, Bell } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface HeaderProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

export function Header({ title, subtitle, actions }: HeaderProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState<string>("");

  // Drive the chunked sync loop: keep calling /api/sync/run until done.
  // Each call refreshes the stalest ~50 TME products (price/stock/MOQ) and
  // pushes inventory changes to eBay. Fits the serverless timeout per call.
  const runSync = async () => {
    if (syncing) return;
    setSyncing(true);
    setProgress("");
    let totalChanged = 0;
    let totalEbay = 0;
    let guard = 0; // safety cap (50 chunks * 50 = 2500 products)
    try {
      while (guard++ < 50) {
        const res = await apiRequest("POST", "/api/sync/run", { limit: 50 });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || "Sync failed");
        totalChanged += data.changed || 0;
        totalEbay += data.ebayUpdated || 0;
        const synced = data.total - data.remaining;
        setProgress(`${synced}/${data.total} synced`);
        if (data.done) break;
      }
      toast({
        title: "Sync Complete",
        description: `${totalChanged} products changed, ${totalEbay} eBay listings updated.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/metrics"] });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tme/usage"] });
    } catch (err: any) {
      toast({
        title: "Sync Failed",
        description: err?.message || "Failed to run TME sync.",
        variant: "destructive",
      });
    } finally {
      setSyncing(false);
      setProgress("");
    }
  };

  return (
    <header className="bg-white border-b border-gray-200 px-4 py-2">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">{title}</h1>
          {subtitle && (
            <p className="text-xs text-gray-600">{subtitle}</p>
          )}
        </div>

        <div className="flex items-center space-x-2">
          {actions}
          <Button
            onClick={runSync}
            disabled={syncing}
            size="sm"
            className="flex items-center space-x-1 h-7 text-xs px-2"
          >
            <RefreshCw className={cn("w-3 h-3", syncing && "animate-spin")} />
            <span>{syncing ? (progress || "Syncing…") : "Sync Now"}</span>
          </Button>

          <Button variant="ghost" size="icon" className="relative h-7 w-7">
            <Bell className="w-4 h-4" />
            <span className="absolute top-0 right-0 block h-1.5 w-1.5 rounded-full bg-red-400 ring-1 ring-white"></span>
          </Button>
        </div>
      </div>
    </header>
  );
}

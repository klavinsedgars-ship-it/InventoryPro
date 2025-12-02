import { Button } from "@/components/ui/button";
import { RefreshCw, Bell } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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

  const syncMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/sync/tme"),
    onSuccess: () => {
      toast({
        title: "Sync Started",
        description: "TME sync has been initiated successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/metrics"] });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
    },
    onError: () => {
      toast({
        title: "Sync Failed",
        description: "Failed to start TME sync. Please try again.",
        variant: "destructive",
      });
    },
  });

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
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
            size="sm"
            className="flex items-center space-x-1 h-7 text-xs px-2"
          >
            <RefreshCw className={cn(
              "w-3 h-3",
              syncMutation.isPending && "animate-spin"
            )} />
            <span>Sync Now</span>
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

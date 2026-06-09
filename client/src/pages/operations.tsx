import { useState } from "react";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Activity, BarChart3, History } from "lucide-react";
import { OpsDashboard } from "@/pages/ops-dashboard";
import { Marketplaces } from "@/pages/marketplaces";
import { SyncActivity } from "@/pages/sync-activity";

interface OperationsProps {
  user: any;
}

/**
 * Operations hub: merges the former "Operations" and "Analytics" pages into a
 * single tabbed view so there's no duplicate page.
 *  - Health & Sync: daily jobs, listing ramp, queue, API usage, recent activity
 *  - Marketplace Analytics: listing performance, health and category breakdown
 */
export function Operations({ user }: OperationsProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar user={user} collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} />
      <div className={`transition-all duration-200 ${sidebarCollapsed ? "ml-16" : "ml-64"}`}>
        <Header title="Operations" subtitle="Sync health, listing controls and marketplace analytics" />

        <div className="p-6">
          <Tabs defaultValue="health" className="w-full">
            <TabsList className="grid w-full max-w-2xl grid-cols-3 mb-6">
              <TabsTrigger value="health" className="flex items-center justify-center gap-2">
                <Activity className="h-4 w-4" />
                <span>Health &amp; Sync</span>
              </TabsTrigger>
              <TabsTrigger value="activity" className="flex items-center justify-center gap-2">
                <History className="h-4 w-4" />
                <span>Sync Activity</span>
              </TabsTrigger>
              <TabsTrigger value="analytics" className="flex items-center justify-center gap-2">
                <BarChart3 className="h-4 w-4" />
                <span>Marketplace Analytics</span>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="health">
              <OpsDashboard user={user} embedded />
            </TabsContent>
            <TabsContent value="activity">
              <SyncActivity />
            </TabsContent>
            <TabsContent value="analytics">
              <Marketplaces user={user} embedded />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}

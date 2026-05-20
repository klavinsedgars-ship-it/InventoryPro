import { useState } from "react";
import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Dashboard } from "@/pages/dashboard";
import { Products } from "@/pages/products";
import { Categories } from "@/pages/categories";
import { Marketplaces } from "@/pages/marketplaces";
import { TMESync } from "@/pages/sync";
import { TMEBrowserNew as TMEBrowserOld } from "@/pages/tme-browser-new";
import TMEBrowser from "@/pages/tme-browser";
import { Settings } from "@/pages/settings";
import { Reports } from "@/pages/reports";
import { QueueManagement } from "@/pages/queue-management";
import { TemplatePreview } from "@/pages/template-preview";
import Configuration from "@/pages/configuration";
import { Login } from "@/pages/login";
import NotFound from "@/pages/not-found";
import ImageProcessingPage from "./pages/image-processing";
import { EbayPolicies } from "@/pages/ebay-policies";
import { Orders } from "@/pages/orders";
import MessagesPage from "@/pages/messages";

type User = {
  id: number;
  username: string;
  email: string;
  role: string;
} | null;

function AppContent() {
  const [loggedInUser, setLoggedInUser] = useState<User>(null);

  const { data, isLoading, isError } = useQuery<{ user: NonNullable<User> } | null>({
    queryKey: ["/api/auth/me"],
    queryFn: async () => {
      const response = await fetch("/api/auth/me", { credentials: "include" });
      if (response.status === 401) return null;
      if (!response.ok) throw new Error(`Auth check failed: ${response.status}`);
      return response.json();
    },
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  // Prefer the most-recent client-side login over the cached query result
  const user: User = loggedInUser ?? data?.user ?? null;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!user || isError) {
    return <Login onSuccess={(u) => setLoggedInUser(u)} />;
  }

  return (
    <Switch>
      <Route path="/" component={() => <Dashboard user={user} />} />
      <Route path="/products" component={() => <Products user={user} />} />
      <Route path="/marketplaces" component={() => <Marketplaces user={user} />} />
      <Route path="/sync" component={() => <TMESync user={user} />} />
      <Route path="/tme-browser" component={() => <TMEBrowser user={user} />} />
      <Route path="/configuration" component={() => <Configuration user={user} />} />
      <Route path="/queue" component={() => <QueueManagement user={user} />} />
      <Route path="/templates" component={() => <TemplatePreview user={user} />} />
      <Route path="/reports" component={() => <Reports user={user} />} />
      <Route path="/settings" component={() => <Settings user={user} />} />
      <Route path="/image-processing" component={() => <ImageProcessingPage />} />
      <Route path="/ebay-policies" component={() => <EbayPolicies user={user} />} />
      <Route path="/orders" component={() => <Orders user={user} />} />
      <Route path="/messages" component={() => <MessagesPage />} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <AppContent />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;

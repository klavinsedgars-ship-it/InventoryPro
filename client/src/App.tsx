import { useState, useEffect } from "react";
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
import { TMEBrowser } from "@/pages/tme-browser";
import { Settings } from "@/pages/settings";
import { Reports } from "@/pages/reports";
import { QueueManagement } from "@/pages/queue-management";
import { TemplatePreview } from "@/pages/template-preview";
import Configuration from "@/pages/configuration";
import { Login } from "@/pages/login";
import NotFound from "@/pages/not-found";

function AppContent() {
  // Temporary bypass for authentication - using mock user
  const [user, setUser] = useState<any>({
    id: 1,
    username: "admin",
    email: "admin@inventorysync.com",
    role: "admin"
  });
  const [isLoading, setIsLoading] = useState(false);

  // Disabled authentication check for development
  // const { data: userData, error } = useQuery({
  //   queryKey: ["/api/auth/me"],
  //   queryFn: async () => {
  //     const response = await fetch("/api/auth/me", {
  //       credentials: "include",
  //     });
  //     if (!response.ok) {
  //       throw new Error("Not authenticated");
  //     }
  //     return response.json();
  //   },
  //   retry: false,
  // });

  // useEffect(() => {
  //   if (userData) {
  //     setUser(userData.user);
  //   } else if (error) {
  //     setUser(null);
  //   }
  //   setIsLoading(false);
  // }, [userData, error]);

  const handleLoginSuccess = (userData: any) => {
    setUser(userData);
  };

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
      setUser(null);
      queryClient.clear();
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  // Authentication disabled for development
  // if (!user) {
  //   return <Login onSuccess={handleLoginSuccess} />;
  // }

  return (
    <Switch>
      <Route path="/" component={() => <Dashboard user={user} />} />
      <Route path="/products" component={() => <Products user={user} />} />
      <Route path="/marketplaces" component={() => <Marketplaces user={user} />} />
      <Route path="/sync" component={() => <TMESync user={user} />} />
      <Route path="/configuration" component={() => <Configuration user={user} />} />
      <Route path="/queue" component={() => <QueueManagement user={user} />} />
      <Route path="/templates" component={() => <TemplatePreview user={user} />} />
      <Route path="/reports" component={() => <Reports user={user} />} />
      <Route path="/settings" component={() => <Settings user={user} />} />
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

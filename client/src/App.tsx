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
import { Login } from "@/pages/login";
import NotFound from "@/pages/not-found";

function AppContent() {
  const [user, setUser] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Check if user is authenticated on app load
  const { data: userData, error } = useQuery({
    queryKey: ["/api/auth/me"],
    queryFn: async () => {
      const response = await fetch("/api/auth/me", {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error("Not authenticated");
      }
      return response.json();
    },
    retry: false,
  });

  useEffect(() => {
    if (userData) {
      setUser(userData.user);
    } else if (error) {
      setUser(null);
    }
    setIsLoading(false);
  }, [userData, error]);

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

  if (!user) {
    return <Login onSuccess={handleLoginSuccess} />;
  }

  return (
    <Switch>
      <Route path="/" component={() => <Dashboard user={user} />} />
      <Route path="/products" component={() => <Products user={user} />} />
      <Route path="/marketplaces" component={() => <Marketplaces user={user} />} />
      <Route path="/sync" component={() => <div className="min-h-screen bg-gray-50 flex items-center justify-center"><p>TME Sync page coming soon...</p></div>} />
      <Route path="/categories" component={() => <Categories user={user} />} />
      <Route path="/settings" component={() => <div className="min-h-screen bg-gray-50 flex items-center justify-center"><p>Settings page coming soon...</p></div>} />
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

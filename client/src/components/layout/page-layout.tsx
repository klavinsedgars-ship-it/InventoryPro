import { useState } from "react";
import { Sidebar } from "./sidebar";
import { Header } from "./header";

interface PageLayoutProps {
  user: any;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}

export function PageLayout({ user, title, subtitle, children }: PageLayoutProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <div className="min-h-screen bg-gray-100">
      <Sidebar 
        user={user} 
        collapsed={sidebarCollapsed} 
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} 
      />
      
      <div className={`transition-all duration-200 ${sidebarCollapsed ? 'ml-16' : 'ml-64'}`}>
        <Header title={title} subtitle={subtitle} />
        
        <main className="p-6">
          {children}
        </main>
      </div>
    </div>
  );
}

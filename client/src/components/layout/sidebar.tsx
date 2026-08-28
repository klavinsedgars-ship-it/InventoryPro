import { useState, createContext, useContext } from "react";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import {
  Package,
  LayoutDashboard,
  Settings,
  Box,
  BarChart3,
  LineChart,
  Ban,
  Cog,
  Search,
  ClipboardList,
  ChevronLeft,
  ChevronRight,
  Menu,
  MessageSquare,
  Activity,
  Scale,
  Target,
  TrendingUp
} from "lucide-react";
import { Button } from "@/components/ui/button";

const navigation = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard },
  { name: 'Operations', href: '/ops', icon: Activity },
  { name: 'Products', href: '/products', icon: Package },
  { name: 'Orders', href: '/orders', icon: ClipboardList },
  { name: 'Messages', href: '/messages', icon: MessageSquare },
  { name: 'TME Browser', href: '/tme-browser', icon: Search },
  { name: 'Opportunities', href: '/opportunities', icon: Target },
  { name: 'Sales Performance', href: '/sales-performance', icon: LineChart },
  { name: 'Market Research', href: '/market-research', icon: TrendingUp },
  { name: 'Repricing', href: '/repricing', icon: Scale },
  { name: 'Blocked Products', href: '/blocklist', icon: Ban },
  { name: 'Configuration', href: '/configuration', icon: Cog },
  { name: 'Reports', href: '/reports', icon: BarChart3 },
];

interface SidebarProps {
  user?: {
    username: string;
    email?: string; // accepted but not rendered; optional so partial user objects pass
    role: string;
  };
  collapsed?: boolean;
  onToggle?: () => void;
}

export function Sidebar({ user, collapsed = false, onToggle }: SidebarProps) {
  const [location] = useLocation();

  return (
    <div className={cn(
      "fixed inset-y-0 left-0 bg-white border-r border-gray-200 z-40 transition-all duration-200",
      collapsed ? "w-16" : "w-64"
    )}>
      <div className="flex flex-col h-full">
        {/* Logo */}
        <div className="flex items-center justify-between px-3 py-4 border-b border-gray-200">
          <div className="flex items-center overflow-hidden">
            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center flex-shrink-0">
              <Box className="w-5 h-5 text-primary-foreground" />
            </div>
            {!collapsed && (
              <span className="ml-3 text-lg font-semibold text-gray-900 whitespace-nowrap">InventorySync</span>
            )}
          </div>
          {onToggle && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onToggle}
              className="p-1 h-8 w-8"
              data-testid="btn-toggle-sidebar"
            >
              {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
            </Button>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-2 py-4 space-y-1 overflow-y-auto">
          {navigation.map((item) => {
            const isActive = location === item.href;
            return (
              <Link
                key={item.name}
                href={item.href}
                className={cn(
                  "group flex items-center px-3 py-2 text-sm font-medium rounded-lg transition-colors",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-gray-700 hover:bg-gray-50",
                  collapsed && "justify-center px-2"
                )}
                data-testid={`nav-${item.name.toLowerCase().replace(/\s+/g, '-')}`}
                title={collapsed ? item.name : undefined}
              >
                <item.icon className={cn(
                  "h-5 w-5 flex-shrink-0",
                  isActive ? "text-primary" : "text-gray-400",
                  !collapsed && "mr-3"
                )} />
                {!collapsed && item.name}
              </Link>
            );
          })}
        </nav>

        {/* User Profile */}
        {user && (
          <div className={cn("p-3 border-t border-gray-200", collapsed && "px-2")}>
            <div className={cn("flex items-center", collapsed ? "justify-center" : "justify-between")}>
              <div className="flex items-center overflow-hidden">
                <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                  <span className="text-sm font-medium text-primary-foreground">
                    {user.username.charAt(0).toUpperCase()}
                  </span>
                </div>
                {!collapsed && (
                  <div className="ml-3 overflow-hidden">
                    <p className="text-sm font-medium text-gray-700 truncate">{user.username}</p>
                    <p className="text-xs text-gray-500 capitalize truncate">{user.role}</p>
                  </div>
                )}
              </div>
              {!collapsed && (
                <Link
                  href="/settings"
                  className="p-2 rounded-lg hover:bg-gray-100 transition-colors flex-shrink-0"
                  data-testid="nav-settings"
                >
                  <Settings className="h-4 w-4 text-gray-500 hover:text-gray-700" />
                </Link>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

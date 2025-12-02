import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import {
  Package,
  LayoutDashboard,
  ShoppingCart,
  RefreshCw,
  Settings,
  Box,
  BarChart3,
  Database,
  FileText,
  Cog,
  Search,
  Image as ImageIcon,
  FileStack,
  ClipboardList
} from "lucide-react";

const navigation = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard },
  { name: 'Products', href: '/products', icon: Package },
  { name: 'Orders', href: '/orders', icon: ClipboardList },
  { name: 'Analytics', href: '/marketplaces', icon: ShoppingCart },
  { name: 'TME Sync', href: '/sync', icon: RefreshCw },
  { name: 'TME Browser', href: '/tme-browser', icon: Search },
  { name: 'Configuration', href: '/configuration', icon: Cog },
  { name: 'eBay Policies', href: '/ebay-policies', icon: FileStack },
  { name: 'Queue Manager', href: '/queue', icon: Database },
  { name: 'Templates', href: '/templates', icon: FileText },
  { name: 'Reports', href: '/reports', icon: BarChart3 },
];

interface SidebarProps {
  user?: {
    username: string;
    email: string;
    role: string;
  };
}

export function Sidebar({ user }: SidebarProps) {
  const [location] = useLocation();

  return (
    <div className="fixed inset-y-0 left-0 w-64 bg-white border-r border-gray-200 z-40">
      <div className="flex flex-col h-full">
        {/* Logo */}
        <div className="flex items-center px-6 py-4 border-b border-gray-200">
          <div className="flex items-center">
            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
              <Box className="w-5 h-5 text-primary-foreground" />
            </div>
            <span className="ml-3 text-lg font-semibold text-gray-900">InventorySync</span>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-4 py-4 space-y-1">
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
                    : "text-gray-700 hover:bg-gray-50"
                )}
                data-testid={`nav-${item.name.toLowerCase().replace(/\s+/g, '-')}`}
              >
                <item.icon className={cn(
                  "mr-3 h-5 w-5",
                  isActive ? "text-primary" : "text-gray-400"
                )} />
                {item.name}
              </Link>
            );
          })}
        </nav>

        {/* User Profile */}
        {user && (
          <div className="p-4 border-t border-gray-200">
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center">
                  <span className="text-sm font-medium text-primary-foreground">
                    {user.username.charAt(0).toUpperCase()}
                  </span>
                </div>
                <div className="ml-3">
                  <p className="text-sm font-medium text-gray-700">{user.username}</p>
                  <p className="text-xs text-gray-500 capitalize">{user.role}</p>
                </div>
              </div>
              <Link
                href="/settings"
                className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
                data-testid="nav-settings"
              >
                <Settings className="h-4 w-4 text-gray-500 hover:text-gray-700" />
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
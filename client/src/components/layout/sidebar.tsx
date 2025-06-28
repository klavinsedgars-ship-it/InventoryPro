import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { 
  Package, 
  LayoutDashboard, 
  ShoppingCart, 
  RefreshCw, 
  FolderTree, 
  Settings,
  Box
} from "lucide-react";

const navigation = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard },
  { name: 'Products', href: '/products', icon: Package },
  { name: 'Marketplaces', href: '/marketplaces', icon: ShoppingCart },
  { name: 'TME Sync', href: '/sync', icon: RefreshCw },
  { name: 'Categories', href: '/categories', icon: FolderTree },
  { name: 'Settings', href: '/settings', icon: Settings },
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
              <Link key={item.name} href={item.href}>
                <a className={cn(
                  "group flex items-center px-3 py-2 text-sm font-medium rounded-lg transition-colors",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-gray-700 hover:bg-gray-50"
                )}>
                  <item.icon className={cn(
                    "mr-3 h-5 w-5",
                    isActive ? "text-primary" : "text-gray-400"
                  )} />
                  {item.name}
                </a>
              </Link>
            );
          })}
        </nav>

        {/* User Profile */}
        {user && (
          <div className="p-4 border-t border-gray-200">
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
          </div>
        )}
      </div>
    </div>
  );
}

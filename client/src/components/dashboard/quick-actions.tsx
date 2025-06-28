import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Upload, BarChart3, FolderTree } from "lucide-react";

interface QuickActionsProps {
  onAddProduct: () => void;
  onBulkList: () => void;
  onViewReports: () => void;
  onManageCategories: () => void;
}

export function QuickActions({ 
  onAddProduct, 
  onBulkList, 
  onViewReports, 
  onManageCategories 
}: QuickActionsProps) {
  const actions = [
    {
      title: "Add New Product",
      icon: Plus,
      color: "text-primary",
      onClick: onAddProduct
    },
    {
      title: "Bulk List Products",
      icon: Upload,
      color: "text-green-600",
      onClick: onBulkList
    },
    {
      title: "View Reports",
      icon: BarChart3,
      color: "text-yellow-600",
      onClick: onViewReports
    },
    {
      title: "Manage Categories",
      icon: FolderTree,
      color: "text-purple-600",
      onClick: onManageCategories
    }
  ];

  return (
    <Card className="border border-gray-200">
      <CardHeader>
        <CardTitle className="text-lg font-medium text-gray-900">Quick Actions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {actions.map((action, index) => (
          <Button
            key={index}
            variant="ghost"
            className="w-full justify-start p-3 h-auto"
            onClick={action.onClick}
          >
            <action.icon className={`w-5 h-5 mr-3 ${action.color}`} />
            <span className="text-sm font-medium text-gray-900">{action.title}</span>
          </Button>
        ))}
      </CardContent>
    </Card>
  );
}

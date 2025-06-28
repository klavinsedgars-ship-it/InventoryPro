import { Card, CardContent } from "@/components/ui/card";
import { Package, ShoppingCart, Store, DollarSign } from "lucide-react";
import { formatCurrency, formatNumber } from "@/lib/utils";

interface MetricsCardsProps {
  metrics: {
    totalProducts: number;
    ebayListings: number;
    amazonListings: number;
    totalRevenue: number;
    outOfStock?: number;
  };
}

export function MetricsCards({ metrics }: MetricsCardsProps) {
  const cards = [
    {
      title: "Total Products",
      value: formatNumber(metrics.totalProducts),
      icon: Package,
      color: "bg-blue-100 text-blue-600",
      change: "+12% from last month"
    },
    {
      title: "eBay Listings",
      value: formatNumber(metrics.ebayListings),
      icon: ShoppingCart,
      color: "bg-green-100 text-green-600",
      change: "+8% from last month"
    },
    {
      title: "Amazon Listings", 
      value: formatNumber(metrics.amazonListings),
      icon: Store,
      color: "bg-yellow-100 text-yellow-600",
      change: "-3% from last month"
    },
    {
      title: "Total Revenue",
      value: formatCurrency(metrics.totalRevenue),
      icon: DollarSign,
      color: "bg-purple-100 text-purple-600",
      change: "+15% from last month"
    }
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
      {cards.map((card, index) => (
        <Card key={index} className="border border-gray-200">
          <CardContent className="p-6">
            <div className="flex items-center">
              <div className={`p-2 rounded-lg ${card.color}`}>
                <card.icon className="w-6 h-6" />
              </div>
              <div className="ml-4">
                <h3 className="text-sm font-medium text-gray-500">{card.title}</h3>
                <p className="text-2xl font-semibold text-gray-900">{card.value}</p>
              </div>
            </div>
            <div className="mt-4">
              <span className={`text-sm font-medium ${
                card.change.startsWith('+') ? 'text-green-600' : 'text-red-600'
              }`}>
                {card.change}
              </span>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { 
  TrendingUp, 
  TrendingDown, 
  ShoppingCart, 
  Store, 
  AlertCircle,
  CheckCircle,
  Clock,
  Package,
  DollarSign,
  Activity
} from "lucide-react";
import { formatCurrency, formatNumber } from "@/lib/utils";
import type { Product, Category } from "@shared/schema";

interface MarketplacesProps {
  user: any;
}

export function Marketplaces({ user }: MarketplacesProps) {
  const [timeRange, setTimeRange] = useState<string>("7d");

  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ["/api/products"],
  });

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ["/api/categories"],
  });

  const { data: metrics } = useQuery({
    queryKey: ["/api/dashboard/metrics"],
  });

  // Calculate analytics
  const totalProducts = products.length;
  const ebayListings = products.filter(p => p.listedOnEbay).length;
  const amazonListings = products.filter(p => p.listedOnAmazon).length;
  const outOfStock = products.filter(p => p.stock === 0).length;
  const excludedProducts = products.filter(p => p.excludeFromListing).length;

  const ebayEligible = products.filter(p => 
    !p.listedOnEbay && !p.excludeFromListing && p.stock > 0
  ).length;

  const amazonEligible = products.filter(p => 
    !p.listedOnAmazon && !p.excludeFromListing && p.stock > 0
  ).length;

  const listingHealth = {
    healthy: products.filter(p => 
      (p.listedOnEbay || p.listedOnAmazon) && p.stock > 0
    ).length,
    outOfStock: products.filter(p => 
      (p.listedOnEbay || p.listedOnAmazon) && p.stock === 0
    ).length,
    excluded: excludedProducts
  };

  const ebayListingRate = totalProducts > 0 ? (ebayListings / totalProducts) * 100 : 0;
  const amazonListingRate = totalProducts > 0 ? (amazonListings / totalProducts) * 100 : 0;

  // Category breakdown
  const categoryBreakdown = categories.map(cat => {
    const catProducts = products.filter(p => p.category === cat.name);
    const ebayListed = catProducts.filter(p => p.listedOnEbay).length;
    const amazonListed = catProducts.filter(p => p.listedOnAmazon).length;

    return {
      name: cat.name,
      total: catProducts.length,
      ebayListed,
      amazonListed,
      ebayRate: catProducts.length > 0 ? (ebayListed / catProducts.length) * 100 : 0,
      amazonRate: catProducts.length > 0 ? (amazonListed / catProducts.length) * 100 : 0,
    };
  }).filter(cat => cat.total > 0);

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar user={user} />
      <div className="ml-64">
        <Header 
          title="Marketplace Analytics" 
          subtitle="Monitor listing performance and marketplace health"
        />

        <div className="p-6 space-y-6">
          {/* Time Range Selector */}
          <div className="flex justify-end">
            <Select value={timeRange} onValueChange={setTimeRange}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="24h">Last 24 Hours</SelectItem>
                <SelectItem value="7d">Last 7 Days</SelectItem>
                <SelectItem value="30d">Last 30 Days</SelectItem>
                <SelectItem value="90d">Last 90 Days</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Key Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-gray-600 flex items-center">
                  <Package className="w-4 h-4 mr-2" />
                  Total Products
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-gray-900">{formatNumber(totalProducts)}</div>
                <div className="flex items-center mt-2 text-sm">
                  <span className="text-gray-500">{excludedProducts} excluded from listing</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-gray-600 flex items-center">
                  <ShoppingCart className="w-4 h-4 mr-2" />
                  eBay Performance
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-green-600">{formatNumber(ebayListings)}</div>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-sm text-gray-500">{ebayListingRate.toFixed(1)}% listed</span>
                  <Badge variant="outline" className="text-xs">
                    {ebayEligible} eligible
                  </Badge>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-gray-600 flex items-center">
                  <Store className="w-4 h-4 mr-2" />
                  Amazon Performance
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-orange-600">{formatNumber(amazonListings)}</div>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-sm text-gray-500">{amazonListingRate.toFixed(1)}% listed</span>
                  <Badge variant="outline" className="text-xs">
                    {amazonEligible} eligible
                  </Badge>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-gray-600 flex items-center">
                  <Activity className="w-4 h-4 mr-2" />
                  Listing Health
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-blue-600">{formatNumber(listingHealth.healthy)}</div>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-sm text-gray-500">Active listings</span>
                  {listingHealth.outOfStock > 0 && (
                    <Badge variant="destructive" className="text-xs">
                      {listingHealth.outOfStock} OOS
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Marketplace Coverage */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>eBay Coverage</span>
                  <Badge variant="outline">{ebayListingRate.toFixed(1)}%</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-gray-600">Listed Products</span>
                    <span className="font-medium">{ebayListings} / {totalProducts}</span>
                  </div>
                  <Progress value={ebayListingRate} className="h-2" />
                </div>

                <div className="grid grid-cols-2 gap-4 pt-4 border-t">
                  <div>
                    <div className="text-2xl font-bold text-green-600">{ebayEligible}</div>
                    <div className="text-xs text-gray-500">Ready to List</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-gray-900">{ebayListings}</div>
                    <div className="text-xs text-gray-500">Currently Listed</div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>Amazon Coverage</span>
                  <Badge variant="outline">{amazonListingRate.toFixed(1)}%</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-gray-600">Listed Products</span>
                    <span className="font-medium">{amazonListings} / {totalProducts}</span>
                  </div>
                  <Progress value={amazonListingRate} className="h-2" />
                </div>

                <div className="grid grid-cols-2 gap-4 pt-4 border-t">
                  <div>
                    <div className="text-2xl font-bold text-orange-600">{amazonEligible}</div>
                    <div className="text-xs text-gray-500">Ready to List</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-gray-900">{amazonListings}</div>
                    <div className="text-xs text-gray-500">Currently Listed</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Listing Health Status */}
          <Card>
            <CardHeader>
              <CardTitle>Listing Health Overview</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="flex items-center space-x-4 p-4 bg-green-50 rounded-lg">
                  <CheckCircle className="w-10 h-10 text-green-600" />
                  <div>
                    <div className="text-2xl font-bold text-green-900">{listingHealth.healthy}</div>
                    <div className="text-sm text-green-700">Healthy Listings</div>
                    <div className="text-xs text-green-600 mt-1">In stock & active</div>
                  </div>
                </div>

                <div className="flex items-center space-x-4 p-4 bg-red-50 rounded-lg">
                  <AlertCircle className="w-10 h-10 text-red-600" />
                  <div>
                    <div className="text-2xl font-bold text-red-900">{listingHealth.outOfStock}</div>
                    <div className="text-sm text-red-700">Out of Stock</div>
                    <div className="text-xs text-red-600 mt-1">Needs attention</div>
                  </div>
                </div>

                <div className="flex items-center space-x-4 p-4 bg-gray-50 rounded-lg">
                  <Clock className="w-10 h-10 text-gray-600" />
                  <div>
                    <div className="text-2xl font-bold text-gray-900">{listingHealth.excluded}</div>
                    <div className="text-sm text-gray-700">Excluded</div>
                    <div className="text-xs text-gray-600 mt-1">Not available for listing</div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Category Performance */}
          <Card>
            <CardHeader>
              <CardTitle>Category Performance</CardTitle>
            </CardHeader>
            <CardContent>
              {categoryBreakdown.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  No category data available
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Category
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Total Products
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          eBay Listed
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Amazon Listed
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Coverage
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {categoryBreakdown.map((cat) => (
                        <tr key={cat.name} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                            {cat.name}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {cat.total}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex items-center space-x-2">
                              <span className="text-sm text-gray-900">{cat.ebayListed}</span>
                              <Badge variant="outline" className="text-xs">
                                {cat.ebayRate.toFixed(0)}%
                              </Badge>
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex items-center space-x-2">
                              <span className="text-sm text-gray-900">{cat.amazonListed}</span>
                              <Badge variant="outline" className="text-xs">
                                {cat.amazonRate.toFixed(0)}%
                              </Badge>
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="w-24">
                              <Progress 
                                value={Math.max(cat.ebayRate, cat.amazonRate)} 
                                className="h-2" 
                              />
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Quick Stats Summary */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm text-gray-600">Total Revenue</div>
                    <div className="text-2xl font-bold text-gray-900">
                      {formatCurrency(metrics?.totalRevenue || 0)}
                    </div>
                  </div>
                  <DollarSign className="w-8 h-8 text-purple-600" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm text-gray-600">Avg. Product Value</div>
                    <div className="text-2xl font-bold text-gray-900">
                      {totalProducts > 0 
                        ? formatCurrency(
                            products.reduce((sum, p) => sum + p.salePrice, 0) / totalProducts
                          )
                        : formatCurrency(0)
                      }
                    </div>
                  </div>
                  <TrendingUp className="w-8 h-8 text-green-600" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm text-gray-600">Stock Value</div>
                    <div className="text-2xl font-bold text-gray-900">
                      {formatCurrency(
                        products.reduce((sum, p) => sum + (p.salePrice * p.stock), 0)
                      )}
                    </div>
                  </div>
                  <Package className="w-8 h-8 text-blue-600" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm text-gray-600">Listing Efficiency</div>
                    <div className="text-2xl font-bold text-gray-900">
                      {((ebayListingRate + amazonListingRate) / 2).toFixed(1)}%
                    </div>
                  </div>
                  <Activity className="w-8 h-8 text-orange-600" />
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
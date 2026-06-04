import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line } from "recharts";
import { Download, TrendingUp, TrendingDown, AlertTriangle, Package, DollarSign } from "lucide-react";
import { formatCurrency, formatNumber } from "@/lib/utils";

interface ReportsProps {
  user: any;
}

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8'];

export function Reports({ user }: ReportsProps) {
  const [selectedPeriod, setSelectedPeriod] = useState("12m");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const { data: inventoryAnalytics, isLoading: inventoryLoading } = useQuery({
    queryKey: ["/api/analytics/inventory"],
  });

  const { data: salesAnalytics, isLoading: salesLoading } = useQuery({
    queryKey: ["/api/analytics/sales"],
  });

  const isLoading = inventoryLoading || salesLoading;

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar user={user} collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} />
      <div className={`transition-all duration-200 ${sidebarCollapsed ? 'ml-16' : 'ml-64'}`}>
        <Header 
          title="Reports & Analytics" 
          subtitle="Comprehensive insights into your inventory and sales performance"
        />
        
        <div className="p-6">
          {/* Report Controls */}
          <div className="mb-6 flex justify-between items-center">
            <div className="flex items-center space-x-4">
              <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1m">Last Month</SelectItem>
                  <SelectItem value="3m">Last 3 Months</SelectItem>
                  <SelectItem value="6m">Last 6 Months</SelectItem>
                  <SelectItem value="12m">Last 12 Months</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button>
              <Download className="w-4 h-4 mr-2" />
              Export Report
            </Button>
          </div>

          {/* Sales & Real Profit (revenue − eBay fees − VAT − supplier cost) */}
          {(() => {
            const sales = salesAnalytics as
              | undefined
              | {
                  totals: {
                    orders: number; items: number; revenue: number; shipping: number;
                    fees: number; vat: number; supplierCost: number; postage: number;
                    packaging: number; netProfit: number; netMarginPct: number;
                  };
                  monthly: Array<{ month: string; revenue: number; netProfit: number; orders: number }>;
                  byMarketplace: Array<{ marketplace: string; orders: number; revenue: number; netProfit: number }>;
                  assumptions: string[];
                };
            const t = sales?.totals;
            return (
              <div className="mb-8">
                <h2 className="text-lg font-semibold text-gray-900 mb-3">Sales &amp; Real Profit</h2>
                {!t || t.orders === 0 ? (
                  <Card>
                    <CardContent className="p-6 text-sm text-gray-500">
                      No sales recorded yet. Sync orders from eBay to see realized profit
                      (revenue − fees − VAT − supplier cost).
                    </CardContent>
                  </Card>
                ) : (
                  <>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                      <Card>
                        <CardContent className="p-4">
                          <p className="text-xs text-gray-500">Revenue</p>
                          <p className="text-lg font-semibold">{formatCurrency(t.revenue)}</p>
                          <p className="text-[11px] text-gray-400">{t.orders} orders · {t.items} items</p>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="p-4">
                          <p className="text-xs text-gray-500">eBay fees</p>
                          <p className="text-lg font-semibold text-red-600">−{formatCurrency(t.fees)}</p>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="p-4">
                          <p className="text-xs text-gray-500">VAT</p>
                          <p className="text-lg font-semibold text-red-600">−{formatCurrency(t.vat)}</p>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="p-4">
                          <p className="text-xs text-gray-500">Supplier cost</p>
                          <p className="text-lg font-semibold text-red-600">−{formatCurrency(t.supplierCost)}</p>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="p-4">
                          <p className="text-xs text-gray-500">Postage + packaging</p>
                          <p className="text-lg font-semibold text-red-600">
                            −{formatCurrency(t.postage + t.packaging)}
                          </p>
                        </CardContent>
                      </Card>
                      <Card className="border-green-200 bg-green-50">
                        <CardContent className="p-4">
                          <p className="text-xs text-gray-500">Net profit</p>
                          <p className={`text-lg font-bold ${t.netProfit >= 0 ? "text-green-700" : "text-red-600"}`}>
                            {formatCurrency(t.netProfit)}
                          </p>
                          <p className="text-[11px] text-gray-400">{t.netMarginPct}% margin</p>
                        </CardContent>
                      </Card>
                    </div>
                    {sales?.monthly && sales.monthly.length > 0 && (
                      <Card className="mt-4">
                        <CardHeader className="py-3">
                          <CardTitle className="text-sm">Monthly</CardTitle>
                        </CardHeader>
                        <CardContent className="pt-0">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="text-left text-xs text-gray-500">
                                <th className="py-1">Month</th>
                                <th className="py-1 text-right">Orders</th>
                                <th className="py-1 text-right">Revenue</th>
                                <th className="py-1 text-right">Net profit</th>
                              </tr>
                            </thead>
                            <tbody>
                              {sales.monthly.map((m) => (
                                <tr key={m.month} className="border-t">
                                  <td className="py-1">{m.month}</td>
                                  <td className="py-1 text-right">{m.orders}</td>
                                  <td className="py-1 text-right">{formatCurrency(m.revenue)}</td>
                                  <td className={`py-1 text-right ${m.netProfit >= 0 ? "text-green-700" : "text-red-600"}`}>
                                    {formatCurrency(m.netProfit)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </CardContent>
                      </Card>
                    )}
                    {sales?.assumptions && sales.assumptions.length > 0 && (
                      <p className="text-[11px] text-gray-400 mt-2">{sales.assumptions.join(" ")}</p>
                    )}
                  </>
                )}
              </div>
            );
          })()}

          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
              {[...Array(4)].map((_, i) => (
                <Card key={i} className="animate-pulse">
                  <CardContent className="p-6">
                    <div className="h-20 bg-gray-200 rounded"></div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <>
              {/* Key Metrics Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                <Card>
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-600">Total Inventory Value</p>
                        <p className="text-2xl font-bold text-gray-900">
                          {inventoryAnalytics?.categoryBreakdown 
                            ? formatCurrency(inventoryAnalytics.categoryBreakdown.reduce((sum: number, cat: any) => sum + cat.totalValue, 0))
                            : '$0'
                          }
                        </p>
                      </div>
                      <DollarSign className="h-8 w-8 text-green-600" />
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-600">Low Stock Alerts</p>
                        <p className="text-2xl font-bold text-gray-900">
                          {inventoryAnalytics?.lowStockAlerts?.length || 0}
                        </p>
                      </div>
                      <AlertTriangle className="h-8 w-8 text-orange-600" />
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-600">Active Products</p>
                        <p className="text-2xl font-bold text-gray-900">
                          {inventoryAnalytics?.statusBreakdown?.active || 0}
                        </p>
                      </div>
                      <Package className="h-8 w-8 text-blue-600" />
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-600">Monthly Revenue</p>
                        <p className="text-2xl font-bold text-gray-900">
                          {salesAnalytics?.marketplacePerformance 
                            ? formatCurrency((salesAnalytics.marketplacePerformance.ebay.revenue + salesAnalytics.marketplacePerformance.amazon.revenue) / 12)
                            : '$0'
                          }
                        </p>
                      </div>
                      <TrendingUp className="h-8 w-8 text-green-600" />
                    </div>
                  </CardContent>
                </Card>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
                {/* Category Breakdown */}
                <Card>
                  <CardHeader>
                    <CardTitle>Inventory by Category</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={inventoryAnalytics?.categoryBreakdown || []}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="category" />
                        <YAxis />
                        <Tooltip formatter={(value) => [formatCurrency(value), "Total Value"]} />
                        <Bar dataKey="totalValue" fill="#3B82F6" />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                {/* Status Distribution */}
                <Card>
                  <CardHeader>
                    <CardTitle>Product Status Distribution</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={300}>
                      <PieChart>
                        <Pie
                          data={[
                            { name: 'Active', value: inventoryAnalytics?.statusBreakdown?.active || 0 },
                            { name: 'Low Stock', value: inventoryAnalytics?.statusBreakdown?.lowStock || 0 },
                            { name: 'Out of Stock', value: inventoryAnalytics?.statusBreakdown?.outOfStock || 0 },
                            { name: 'Inactive', value: inventoryAnalytics?.statusBreakdown?.inactive || 0 }
                          ]}
                          cx="50%"
                          cy="50%"
                          labelLine={false}
                          label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                          outerRadius={100}
                          fill="#8884d8"
                          dataKey="value"
                        >
                          {[1,2,3,4].map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
                {/* Sales Performance */}
                <Card>
                  <CardHeader>
                    <CardTitle>Monthly Revenue Trend</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={300}>
                      <LineChart data={salesAnalytics?.monthlyRevenue || []}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="month" />
                        <YAxis />
                        <Tooltip formatter={(value) => [formatCurrency(value), "Revenue"]} />
                        <Line type="monotone" dataKey="revenue" stroke="#10B981" strokeWidth={3} />
                      </LineChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                {/* Marketplace Performance */}
                <Card>
                  <CardHeader>
                    <CardTitle>Marketplace Performance</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div className="flex justify-between items-center p-4 bg-orange-50 rounded-lg">
                        <div>
                          <h4 className="font-semibold text-orange-900">eBay</h4>
                          <p className="text-sm text-orange-700">
                            {salesAnalytics?.marketplacePerformance?.ebay?.orders || 0} orders
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-bold text-orange-900">
                            {formatCurrency(salesAnalytics?.marketplacePerformance?.ebay?.revenue || 0)}
                          </p>
                          <p className="text-sm text-orange-700">
                            Avg: {formatCurrency(salesAnalytics?.marketplacePerformance?.ebay?.avgOrderValue || 0)}
                          </p>
                        </div>
                      </div>
                      
                      <div className="flex justify-between items-center p-4 bg-blue-50 rounded-lg">
                        <div>
                          <h4 className="font-semibold text-blue-900">Amazon</h4>
                          <p className="text-sm text-blue-700">
                            {salesAnalytics?.marketplacePerformance?.amazon?.orders || 0} orders
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-bold text-blue-900">
                            {formatCurrency(salesAnalytics?.marketplacePerformance?.amazon?.revenue || 0)}
                          </p>
                          <p className="text-sm text-blue-700">
                            Avg: {formatCurrency(salesAnalytics?.marketplacePerformance?.amazon?.avgOrderValue || 0)}
                          </p>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Additional Tables */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Top Products */}
                <Card>
                  <CardHeader>
                    <CardTitle>Top Products by Value</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {inventoryAnalytics?.topProducts?.map((product: any, index: number) => (
                        <div key={index} className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                          <div>
                            <p className="font-medium">{product.name}</p>
                            <p className="text-sm text-gray-600">{product.sku}</p>
                          </div>
                          <div className="text-right">
                            <p className="font-semibold">{formatCurrency(product.value)}</p>
                            <Badge variant="secondary">{product.margin}% margin</Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                {/* Low Stock Alerts */}
                <Card>
                  <CardHeader>
                    <CardTitle>Low Stock Alerts</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {inventoryAnalytics?.lowStockAlerts?.slice(0, 5).map((product: any, index: number) => (
                        <div key={index} className="flex justify-between items-center p-3 bg-red-50 rounded-lg">
                          <div>
                            <p className="font-medium">{product.name}</p>
                            <p className="text-sm text-gray-600">{product.sku} • {product.category}</p>
                          </div>
                          <Badge variant="destructive">{product.stock} left</Badge>
                        </div>
                      ))}
                      {(!inventoryAnalytics?.lowStockAlerts || inventoryAnalytics.lowStockAlerts.length === 0) && (
                        <p className="text-gray-500 text-center py-4">No low stock alerts</p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
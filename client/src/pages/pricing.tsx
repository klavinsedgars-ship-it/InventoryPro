import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, invalidateProductViews } from "@/lib/queryClient";
import { Calculator, TrendingUp, Package, DollarSign, Settings, Download } from "lucide-react";
import type { Product } from "@shared/schema";

interface PricingTier {
  min: number;
  max: number;
  multiplier: number;
  label: string;
  marginPercentage: number;
}

interface PriceCalculationResult {
  supplierPrice: number;
  calculatedPrice: number;
  finalPrice: number;
  marginTier: string;
  marginPercentage: number;
  multiplier: number;
  isValid: boolean;
  errors: string[];
}

interface PricingProps {
  user: any;
}

export function Pricing({ user }: PricingProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedProducts, setSelectedProducts] = useState<number[]>([]);
  const [supplierPriceInput, setSupplierPriceInput] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  const { data: products = [], isLoading: productsLoading } = useQuery<Product[]>({
    queryKey: ["/api/products"],
  });

  const { data: pricingTiers, isLoading: tiersLoading } = useQuery<{
    tiers: PricingTier[];
    config: { isValid: boolean; errors: string[] };
    isValid: boolean;
  }>({
    queryKey: ["/api/pricing/tiers"],
  });

  const { data: calculationResult, refetch: calculatePrice } = useQuery<PriceCalculationResult>({
    queryKey: ["/api/pricing/calculate", supplierPriceInput],
    enabled: false,
  });

  const bulkUpdateMutation = useMutation({
    mutationFn: (data: { productIds: number[], applyCalculated: boolean }) =>
      apiRequest("POST", "/api/pricing/bulk-update", data),
    onSuccess: (response: any) => {
      toast({
        title: "Pricing Updated",
        description: `Successfully updated ${response.updatedCount} of ${response.totalProducts} products.`,
      });
      invalidateProductViews();
      setSelectedProducts([]);
    },
    onError: (error: any) => {
      toast({
        title: "Update Failed",
        description: error.message || "Failed to update product pricing.",
        variant: "destructive",
      });
    },
  });

  const handleCalculatePrice = () => {
    if (!supplierPriceInput || isNaN(parseFloat(supplierPriceInput))) {
      toast({
        title: "Invalid Input",
        description: "Please enter a valid supplier price.",
        variant: "destructive",
      });
      return;
    }
    calculatePrice();
  };

  const handleBulkUpdate = (applyCalculated: boolean = true) => {
    if (selectedProducts.length === 0) {
      toast({
        title: "No Products Selected",
        description: "Please select products to update pricing.",
        variant: "destructive",
      });
      return;
    }

    bulkUpdateMutation.mutate({
      productIds: selectedProducts,
      applyCalculated
    });
  };

  const toggleProductSelection = (productId: number) => {
    setSelectedProducts(prev =>
      prev.includes(productId)
        ? prev.filter(id => id !== productId)
        : [...prev, productId]
    );
  };

  const selectAllProducts = () => {
    const filteredProducts = categoryFilter === "all" 
      ? products 
      : products.filter(p => p.category === categoryFilter);
    setSelectedProducts(filteredProducts.map(p => p.id));
  };

  const clearSelection = () => {
    setSelectedProducts([]);
  };

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 2,
    }).format(price);
  };

  const getMarginColor = (marginPercentage: number) => {
    if (marginPercentage >= 300) return "bg-green-100 text-green-800";
    if (marginPercentage >= 150) return "bg-blue-100 text-blue-800";
    if (marginPercentage >= 100) return "bg-yellow-100 text-yellow-800";
    return "bg-red-100 text-red-800";
  };

  const filteredProducts = categoryFilter === "all" 
    ? products 
    : products.filter(p => p.category === categoryFilter);

  const categories = Array.from(new Set(products.map(p => p.category)));

  if (productsLoading) {
    return <div className="flex items-center justify-center p-8">Loading pricing data...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Dynamic Pricing</h1>
          <p className="text-gray-600 mt-1">Automated margin-based pricing system</p>
        </div>
        <div className="flex space-x-3">
          <Button variant="outline" size="sm">
            <Download className="w-4 h-4 mr-2" />
            Export Pricing
          </Button>
          <Button variant="outline" size="sm">
            <Settings className="w-4 h-4 mr-2" />
            Configure Tiers
          </Button>
        </div>
      </div>

      <Tabs defaultValue="calculator" className="space-y-6">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="calculator">Price Calculator</TabsTrigger>
          <TabsTrigger value="bulk">Bulk Update</TabsTrigger>
          <TabsTrigger value="tiers">Pricing Tiers</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        {/* Price Calculator Tab */}
        <TabsContent value="calculator" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Calculator Input */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center">
                  <Calculator className="w-5 h-5 mr-2" />
                  Price Calculator
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="supplierPrice">Supplier Price (EUR)</Label>
                  <div className="flex space-x-2">
                    <Input
                      id="supplierPrice"
                      type="number"
                      step="0.01"
                      placeholder="Enter supplier price..."
                      value={supplierPriceInput}
                      onChange={(e) => setSupplierPriceInput(e.target.value)}
                    />
                    <Button onClick={handleCalculatePrice}>Calculate</Button>
                  </div>
                </div>

                {calculationResult && (
                  <div className="border rounded-lg p-4 space-y-3">
                    {calculationResult.isValid ? (
                      <>
                        <div className="flex justify-between items-center">
                          <span className="text-sm text-gray-600">Supplier Price:</span>
                          <span className="font-medium">{formatPrice(calculationResult.supplierPrice)}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-sm text-gray-600">Calculated Price:</span>
                          <span className="font-medium">{formatPrice(calculationResult.finalPrice)}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-sm text-gray-600">Margin Tier:</span>
                          <Badge className={getMarginColor(calculationResult.marginPercentage)}>
                            {calculationResult.marginTier} ({calculationResult.marginPercentage}%)
                          </Badge>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-sm text-gray-600">Profit:</span>
                          <span className="font-medium text-green-600">
                            {formatPrice(calculationResult.finalPrice - calculationResult.supplierPrice)}
                          </span>
                        </div>
                      </>
                    ) : (
                      <div className="text-red-600 text-sm">
                        {calculationResult.errors.join(', ')}
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Quick Stats */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center">
                  <TrendingUp className="w-5 h-5 mr-2" />
                  Pricing Overview
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4">
                  <div className="text-center p-3 bg-blue-50 rounded-lg">
                    <div className="text-2xl font-bold text-blue-600">{products.length}</div>
                    <div className="text-sm text-gray-600">Total Products</div>
                  </div>
                  <div className="text-center p-3 bg-green-50 rounded-lg">
                    <div className="text-2xl font-bold text-green-600">
                      {products.filter(p => p.useCalculatedPrice).length}
                    </div>
                    <div className="text-sm text-gray-600">Using Dynamic Pricing</div>
                  </div>
                  <div className="text-center p-3 bg-purple-50 rounded-lg">
                    <div className="text-2xl font-bold text-purple-600">
                      {formatPrice(products.reduce((sum, p) => sum + parseFloat(p.salePrice) * p.stock, 0))}
                    </div>
                    <div className="text-sm text-gray-600">Total Inventory Value</div>
                  </div>
                  <div className="text-center p-3 bg-orange-50 rounded-lg">
                    <div className="text-2xl font-bold text-orange-600">
                      {((products.reduce((sum, p) => sum + (parseFloat(p.salePrice) - parseFloat(p.supplierPrice)) * p.stock, 0) / 
                         products.reduce((sum, p) => sum + parseFloat(p.supplierPrice) * p.stock, 0)) * 100).toFixed(1)}%
                    </div>
                    <div className="text-sm text-gray-600">Avg Margin</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Bulk Update Tab */}
        <TabsContent value="bulk" className="space-y-6">
          {/* Bulk Actions */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <Package className="w-5 h-5 mr-2" />
                Bulk Pricing Operations
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center space-x-4">
                  <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                    <SelectTrigger className="w-48">
                      <SelectValue placeholder="Filter by category" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Categories</SelectItem>
                      {categories.map(category => (
                        <SelectItem key={category} value={category}>{category}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button variant="outline" size="sm" onClick={selectAllProducts}>
                    Select All ({filteredProducts.length})
                  </Button>
                  <Button variant="outline" size="sm" onClick={clearSelection}>
                    Clear Selection
                  </Button>
                </div>
                <div className="flex space-x-2">
                  <Button
                    onClick={() => handleBulkUpdate(false)}
                    disabled={selectedProducts.length === 0 || bulkUpdateMutation.isPending}
                    variant="outline"
                  >
                    Calculate Only
                  </Button>
                  <Button
                    onClick={() => handleBulkUpdate(true)}
                    disabled={selectedProducts.length === 0 || bulkUpdateMutation.isPending}
                  >
                    Update Prices ({selectedProducts.length})
                  </Button>
                </div>
              </div>

              {selectedProducts.length > 0 && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
                  <p className="text-sm text-blue-800">
                    {selectedProducts.length} product{selectedProducts.length > 1 ? 's' : ''} selected for bulk pricing update
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Product List */}
          <Card>
            <CardHeader>
              <CardTitle>Product List</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left p-2">
                        <Checkbox
                          checked={selectedProducts.length === filteredProducts.length && filteredProducts.length > 0}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              selectAllProducts();
                            } else {
                              clearSelection();
                            }
                          }}
                        />
                      </th>
                      <th className="text-left p-2">Product</th>
                      <th className="text-left p-2">Supplier Price</th>
                      <th className="text-left p-2">Current Sale Price</th>
                      <th className="text-left p-2">Calculated Price</th>
                      <th className="text-left p-2">Margin Tier</th>
                      <th className="text-left p-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredProducts.map((product) => {
                      const calculatedPrice = product.calculatedPrice ? parseFloat(product.calculatedPrice) : null;
                      const supplierPrice = parseFloat(product.supplierPrice);
                      const salePrice = parseFloat(product.salePrice);
                      
                      return (
                        <tr key={product.id} className="border-b hover:bg-gray-50">
                          <td className="p-2">
                            <Checkbox
                              checked={selectedProducts.includes(product.id)}
                              onCheckedChange={() => toggleProductSelection(product.id)}
                            />
                          </td>
                          <td className="p-2">
                            <div>
                              <div className="font-medium">{product.name}</div>
                              <div className="text-xs text-gray-500">{product.sku}</div>
                            </div>
                          </td>
                          <td className="p-2">{formatPrice(supplierPrice)}</td>
                          <td className="p-2">{formatPrice(salePrice)}</td>
                          <td className="p-2">
                            {calculatedPrice ? formatPrice(calculatedPrice) : "-"}
                          </td>
                          <td className="p-2">
                            {product.marginTier && product.marginPercentage ? (
                              <Badge className={getMarginColor(parseFloat(product.marginPercentage))}>
                                {product.marginTier}
                              </Badge>
                            ) : (
                              "-"
                            )}
                          </td>
                          <td className="p-2">
                            <Badge variant={product.useCalculatedPrice ? "default" : "outline"}>
                              {product.useCalculatedPrice ? "Dynamic" : "Manual"}
                            </Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Pricing Tiers Tab */}
        <TabsContent value="tiers" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <DollarSign className="w-5 h-5 mr-2" />
                Pricing Tier Configuration
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!tiersLoading && pricingTiers?.tiers && (
                <div className="space-y-4">
                  {pricingTiers.tiers.map((tier: PricingTier, index: number) => (
                    <div key={index} className="border rounded-lg p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="font-medium">{tier.label}</h3>
                          <p className="text-sm text-gray-600">
                            {formatPrice(tier.min)} - {tier.max === 999999 ? "∞" : formatPrice(tier.max)}
                          </p>
                        </div>
                        <div className="text-right">
                          <div className="font-medium">×{tier.multiplier}</div>
                          <div className="text-sm text-gray-600">{tier.marginPercentage}% margin</div>
                        </div>
                      </div>
                      <div className="mt-2 text-xs text-gray-500">
                        Example: {formatPrice(tier.min)} → {formatPrice(tier.min * tier.multiplier)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Analytics Tab */}
        <TabsContent value="analytics" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Pricing Analytics</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-center text-gray-500 py-8">
                Pricing analytics and reporting features coming soon...
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
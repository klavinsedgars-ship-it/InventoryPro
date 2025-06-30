import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Search, Upload, Download, ShoppingCart, Store, Eye, X } from "lucide-react";
import { getStatusColor, formatCurrency } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Product, Category } from "@shared/schema";

interface MarketplacesProps {
  user: any;
}

export function Marketplaces({ user }: MarketplacesProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedProducts, setSelectedProducts] = useState<number[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedStatus, setSelectedStatus] = useState<string>("all");

  const { data: products = [], isLoading } = useQuery<Product[]>({
    queryKey: ["/api/products", { 
      category: selectedCategory && selectedCategory !== "all" ? selectedCategory : undefined,
      status: selectedStatus && selectedStatus !== "all" ? selectedStatus : undefined 
    }],
  });

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ["/api/categories"],
  });

  const listProductsMutation = useMutation({
    mutationFn: (data: { productIds: number[], marketplaces: string[] }) => 
      apiRequest("POST", "/api/marketplace/list", data),
    onSuccess: (response) => {
      const result = response.json();
      toast({
        title: "Products Listed",
        description: `Successfully listed ${selectedProducts.length} products on selected marketplaces.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/metrics"] });
      setSelectedProducts([]);
    },
    onError: (error: any) => {
      toast({
        title: "Listing Failed",
        description: error.message || "Failed to list products on marketplaces.",
        variant: "destructive",
      });
    },
  });

  const ebayBulkListMutation = useMutation({
    mutationFn: (data: { productIds: number[], categoryId?: string }) => 
      apiRequest("POST", "/api/ebay/bulk-list", data),
    onSuccess: (response: any) => {
      console.log("Marketplaces eBay listing response:", response);
      console.log("Success check:", response.success, "Listed count:", response.listedCount);
      
      if (response.success === true && (response.listedCount || 0) > 0) {
        toast({
          title: "eBay Listing Completed",
          description: `Successfully listed ${response.listedCount} of ${response.totalProducts} products on eBay.`,
        });
      } else if (response.success === false || (response.failedCount || 0) > 0) {
        toast({
          title: "eBay Listing Issues",
          description: `${response.failedCount || 0} products failed to list. Check individual results.`,
          variant: "destructive",
        });
      } else {
        // Fallback for unexpected response structure
        toast({
          title: "eBay Listing Status",
          description: `Listing completed. Check product status for details.`,
        });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/metrics"] });
      setSelectedProducts([]);
    },
    onError: (error: any) => {
      toast({
        title: "eBay Listing Failed",
        description: error?.message || "Failed to list products on eBay.",
        variant: "destructive",
      });
    },
  });

  const ebayTestMutation = useMutation({
    mutationFn: () => apiRequest("GET", "/api/ebay/test"),
    onSuccess: (response: any) => {
      toast({
        title: "eBay Connection Test",
        description: response.message || "eBay API connection successful.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "eBay Connection Failed",
        description: error?.message || "Failed to connect to eBay API.",
        variant: "destructive",
      });
    },
  });

  const unlistEbayMutation = useMutation({
    mutationFn: async (productId: number) => {
      const response = await apiRequest("POST", "/api/ebay/unlist", { productId });
      return response.json();
    },
    onSuccess: (response: any, productId: number) => {
      const product = products.find(p => p.id === productId);
      
      if (response.success) {
        toast({
          title: "Product Unlisted",
          description: response.message || `Successfully unlisted "${product?.name}" from eBay.`,
        });
      } else {
        // Handle failed unlisting response
        const isTokenExpired = response.message?.includes('token is hard expired') || response.message?.includes('expired');
        toast({
          title: isTokenExpired ? "eBay Token Expired" : "Unlist Failed",
          description: isTokenExpired 
            ? `Cannot unlist "${product?.name}" - eBay token expired. Product remains listed on eBay. Please refresh your eBay token in Settings.`
            : (response.message || `Failed to unlist "${product?.name}" from eBay.`),
          variant: "destructive",
        });
      }
      
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/metrics"] });
    },
    onError: (error: any, productId: number) => {
      const product = products.find(p => p.id === productId);
      const isTokenExpired = error?.message?.includes('token is hard expired') || error?.message?.includes('expired');
      
      toast({
        title: isTokenExpired ? "eBay Token Expired" : "Unlist Failed",
        description: isTokenExpired 
          ? `Cannot unlist "${product?.name}" - eBay token expired. Product remains listed on eBay. Please refresh your eBay token in Settings.`
          : (error?.message || `Failed to unlist "${product?.name}" from eBay.`),
        variant: "destructive",
      });
    },
  });

  const handleUnlistFromEbay = (productId: number) => {
    const product = products.find(p => p.id === productId);
    if (product && window.confirm(`Are you sure you want to unlist "${product.name}" from eBay?`)) {
      unlistEbayMutation.mutate(productId);
    }
  };

  const bulkUnlistEbayMutation = useMutation({
    mutationFn: async (productIds: number[]) => {
      const results = [];
      for (const productId of productIds) {
        try {
          const response = await apiRequest("POST", "/api/ebay/unlist", { productId });
          const data = await response.json();
          results.push({ productId, success: data.success, message: data.message });
        } catch (error: any) {
          results.push({ productId, success: false, message: error.message });
        }
      }
      return results;
    },
    onSuccess: (results: any[]) => {
      const successful = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;
      
      if (successful > 0) {
        toast({
          title: "Bulk Unlisting Complete",
          description: `Successfully unlisted ${successful} product${successful !== 1 ? 's' : ''} from eBay${failed > 0 ? `, ${failed} failed` : ''}.`,
        });
      }
      
      if (failed > 0 && successful === 0) {
        toast({
          title: "Bulk Unlisting Failed",
          description: `Failed to unlist ${failed} product${failed !== 1 ? 's' : ''} from eBay.`,
          variant: "destructive",
        });
      }
      
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/metrics"] });
      setSelectedProducts([]);
    },
    onError: (error: any) => {
      toast({
        title: "Bulk Unlisting Error",
        description: error.message || "Failed to unlist products from eBay.",
        variant: "destructive",
      });
    },
  });

  // Filter products based on search term
  const filteredProducts = products.filter(product =>
    product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    product.sku.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleSelectAll = () => {
    if (selectedProducts.length === filteredProducts.length) {
      setSelectedProducts([]);
    } else {
      setSelectedProducts(filteredProducts.map(p => p.id));
    }
  };

  const handleSelectProduct = (productId: number) => {
    setSelectedProducts(prev =>
      prev.includes(productId)
        ? prev.filter(id => id !== productId)
        : [...prev, productId]
    );
  };

  const handleBulkListEbay = () => {
    if (selectedProducts.length === 0) {
      toast({
        title: "No Products Selected",
        description: "Please select products to list on eBay.",
        variant: "destructive",
      });
      return;
    }
    ebayBulkListMutation.mutate({
      productIds: selectedProducts,
      categoryId: "175673" // Default electronics category
    });
  };

  const handleBulkListAmazon = () => {
    if (selectedProducts.length === 0) {
      toast({
        title: "No Products Selected",
        description: "Please select products to list on Amazon.",
        variant: "destructive",
      });
      return;
    }
    listProductsMutation.mutate({
      productIds: selectedProducts,
      marketplaces: ["amazon"]
    });
  };

  const handleBulkListBoth = () => {
    if (selectedProducts.length === 0) {
      toast({
        title: "No Products Selected",
        description: "Please select products to list on both marketplaces.",
        variant: "destructive",
      });
      return;
    }
    listProductsMutation.mutate({
      productIds: selectedProducts,
      marketplaces: ["ebay", "amazon"]
    });
  };

  const handleBulkUnlistFromEbay = () => {
    const ebayListedProducts = selectedProducts.filter(id => {
      const product = products.find(p => p.id === id);
      return product && product.listedOnEbay;
    });

    if (ebayListedProducts.length === 0) {
      toast({
        title: "No eBay Listings Selected",
        description: "Please select products that are currently listed on eBay.",
        variant: "destructive",
      });
      return;
    }

    const productNames = ebayListedProducts.map(id => 
      products.find(p => p.id === id)?.name
    ).filter(Boolean).slice(0, 3);
    
    const confirmMessage = ebayListedProducts.length === 1 
      ? `Are you sure you want to unlist "${productNames[0]}" from eBay?`
      : `Are you sure you want to unlist ${ebayListedProducts.length} products from eBay?\n\nIncluding: ${productNames.join(', ')}${ebayListedProducts.length > 3 ? '...' : ''}`;

    if (window.confirm(confirmMessage)) {
      bulkUnlistEbayMutation.mutate(ebayListedProducts);
    }
  };

  const eligibleForEbay = selectedProducts.filter(id => {
    const product = products.find(p => p.id === id);
    return product && !product.listedOnEbay && !product.excludeFromListing && product.stock > 0;
  }).length;

  const eligibleForAmazon = selectedProducts.filter(id => {
    const product = products.find(p => p.id === id);
    return product && !product.listedOnAmazon && !product.excludeFromListing && product.stock > 0;
  }).length;

  const eligibleForEbayUnlisting = selectedProducts.filter(id => {
    const product = products.find(p => p.id === id);
    return product && product.listedOnEbay;
  }).length;

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar user={user} />
      <div className="ml-64">
        <Header 
          title="Marketplace Management" 
          subtitle="List and manage products on eBay and Amazon"
        />
        
        <div className="p-6">
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-gray-600">Selected Products</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold text-gray-900">{selectedProducts.length}</div>
                <p className="text-xs text-gray-500 mt-1">Products ready for listing</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-gray-600">eBay Eligible</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold text-green-600">{eligibleForEbay}</div>
                <p className="text-xs text-gray-500 mt-1">Not yet listed on eBay</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-gray-600">Amazon Eligible</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold text-orange-600">{eligibleForAmazon}</div>
                <p className="text-xs text-gray-500 mt-1">Not yet listed on Amazon</p>
              </CardContent>
            </Card>
          </div>

          {/* Bulk Actions */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-medium text-gray-900">Bulk Actions</h3>
                <p className="text-sm text-gray-600">
                  {selectedProducts.length > 0 
                    ? `${selectedProducts.length} product${selectedProducts.length > 1 ? 's' : ''} selected`
                    : "Select products to enable bulk actions"
                  }
                </p>
              </div>
              <div className="flex space-x-3">
                <Button
                  onClick={handleBulkListEbay}
                  disabled={eligibleForEbay === 0 || listProductsMutation.isPending}
                  className="bg-green-600 hover:bg-green-700"
                >
                  <ShoppingCart className="w-4 h-4 mr-2" />
                  List on eBay ({eligibleForEbay})
                </Button>
                <Button
                  onClick={handleBulkListAmazon}
                  disabled={eligibleForAmazon === 0 || listProductsMutation.isPending}
                  className="bg-orange-600 hover:bg-orange-700"
                >
                  <Store className="w-4 h-4 mr-2" />
                  List on Amazon ({eligibleForAmazon})
                </Button>
                <Button
                  onClick={handleBulkListBoth}
                  disabled={(eligibleForEbay === 0 && eligibleForAmazon === 0) || listProductsMutation.isPending}
                  className="bg-purple-600 hover:bg-purple-700"
                >
                  <Upload className="w-4 h-4 mr-2" />
                  List on Both
                </Button>
                <Button
                  onClick={handleBulkUnlistFromEbay}
                  disabled={eligibleForEbayUnlisting === 0 || bulkUnlistEbayMutation.isPending}
                  variant="destructive"
                  className="bg-red-600 hover:bg-red-700"
                >
                  <X className="w-4 h-4 mr-2" />
                  Unlist from eBay ({eligibleForEbayUnlisting})
                </Button>
              </div>
            </div>
          </div>

          {/* Filters */}
          <div className="mb-6 space-y-4">
            <div className="flex items-center space-x-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <Input
                  placeholder="Search products..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 w-64"
                />
              </div>

              <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="All Categories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  {categories.map((category) => (
                    <SelectItem key={category.id} value={category.name}>
                      {category.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={selectedStatus} onValueChange={setSelectedStatus}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="All Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                  <SelectItem value="out_of_stock">Out of Stock</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Products Table */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            {isLoading ? (
              <div className="p-8 text-center">
                <div className="animate-pulse space-y-4">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="h-16 bg-gray-200 rounded"></div>
                  ))}
                </div>
              </div>
            ) : filteredProducts.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-gray-500">
                  {searchTerm || selectedCategory || selectedStatus 
                    ? "No products found matching your filters." 
                    : "No products available for marketplace listing."
                  }
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left">
                        <Checkbox 
                          checked={selectedProducts.length === filteredProducts.length && filteredProducts.length > 0}
                          onCheckedChange={handleSelectAll}
                        />
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Product
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        SKU
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Price
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Stock
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Status
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Marketplaces
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {filteredProducts.map((product) => (
                      <tr 
                        key={product.id} 
                        className={`hover:bg-gray-50 ${selectedProducts.includes(product.id) ? 'bg-blue-50' : ''}`}
                      >
                        <td className="px-6 py-4 whitespace-nowrap">
                          <Checkbox 
                            checked={selectedProducts.includes(product.id)}
                            onCheckedChange={() => handleSelectProduct(product.id)}
                          />
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <div className="h-10 w-10 bg-gray-200 rounded-lg mr-3 flex-shrink-0"></div>
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-gray-900 truncate">
                                {product.name}
                              </div>
                              <div className="text-sm text-gray-500">{product.category}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {product.sku}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {formatCurrency(product.salePrice)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {product.stock === 0 && product.supplier === "TME" ? (
                            <div className="flex items-center space-x-1">
                              <span className="text-gray-500">Unknown</span>
                              <span className="text-xs text-gray-400" title="TME stock data requires special API permissions">⚠️</span>
                            </div>
                          ) : (
                            product.stock
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <Badge 
                            variant="secondary" 
                            className={getStatusColor(product.status)}
                          >
                            {product.status === 'out_of_stock' ? 'Out of Stock' : 
                             product.status.charAt(0).toUpperCase() + product.status.slice(1)}
                          </Badge>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          <div className="flex items-center space-x-2">
                            <div className="flex items-center space-x-1">
                              {product.listedOnEbay ? (
                                <div className="flex items-center space-x-1">
                                  <Badge variant="outline" className="text-xs bg-green-50 text-green-700 border-green-200">
                                    eBay ✓
                                  </Badge>
                                  {product.ebayItemId && (
                                    <div className="flex items-center space-x-1">
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-6 w-6 p-0 text-blue-600 hover:text-blue-800"
                                        onClick={() => window.open(`https://www.ebay.co.uk/itm/${product.ebayItemId}`, '_blank')}
                                        title={`View on eBay: ${product.ebayItemId}`}
                                      >
                                        <Eye className="h-3 w-3" />
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-6 w-6 p-0 text-red-600 hover:text-red-800"
                                        onClick={() => handleUnlistFromEbay(product.id)}
                                        disabled={unlistEbayMutation.isPending}
                                        title="Unlist from eBay"
                                      >
                                        <X className="h-3 w-3" />
                                      </Button>
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <Badge variant="outline" className="text-xs text-gray-400">
                                  eBay
                                </Badge>
                              )}
                            </div>
                            <div className="flex items-center space-x-1">
                              {product.listedOnAmazon ? (
                                <Badge variant="outline" className="text-xs bg-orange-50 text-orange-700 border-orange-200">
                                  Amazon ✓
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="text-xs text-gray-400">
                                  Amazon
                                </Badge>
                              )}
                            </div>
                            {product.excludeFromListing && (
                              <Badge variant="outline" className="text-xs bg-red-50 text-red-700 border-red-200">
                                Excluded
                              </Badge>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
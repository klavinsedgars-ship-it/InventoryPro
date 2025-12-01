import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { useToast } from "@/hooks/use-toast";
import { 
  RefreshCw, 
  CheckCircle2, 
  AlertCircle, 
  Zap, 
  Eye, 
  Package,
  ArrowRight,
  Download, 
  AlertTriangle 
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface TMEProduct {
  Symbol: string;
  Description: string;
  Producer: string;
  Photo: string;
  Thumbnail: string;
  Category: string;
  Price: string;
  PriceList: Array<{
    Amount: number;
    PriceValue: string;
  }>;
  InStock?: number;
  Amount?: number;
  Stock?: number;
  Unit: string;
  Weight: string;
  EAN: string;
  DataSheet: string;
  ProductInformationPage: string;
}

interface TMECategory {
  CategoryId: string;
  Name: string;
  ParentId?: string;
  ProductCount?: number;
  children?: TMECategory[];
}

interface ProductFilters {
  search: string;
  priceMin: string;
  priceMax: string;
  stockMin: string;
  weightMax: string;
  producer: string;
  inStockOnly: boolean;
}

interface SyncSettings {
  applyDynamicPricing: boolean;
  useStockLimit: boolean;
  ebayStockLimit: number;
  autoSelectCategory: boolean;
}

interface TMEBrowserProps {
  user: any;
}

export default function TMEBrowser({ user }: TMEBrowserProps) {
  const [activeTab, setActiveTab] = useState("categories");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());
  const [showSyncDialog, setShowSyncDialog] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [displayLimit] = useState(100); // Show 100 products per page in UI
  const [totalProductsAvailable, setTotalProductsAvailable] = useState(0);
  const [syncSettings, setSyncSettings] = useState<SyncSettings>({
    applyDynamicPricing: true,
    useStockLimit: true,
    ebayStockLimit: 3,
    autoSelectCategory: true
  });

  const [filters, setFilters] = useState<ProductFilters>({
    search: "",
    priceMin: "",
    priceMax: "",
    stockMin: "",
    weightMax: "",
    producer: "",
    inStockOnly: true
  });

  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch TME categories
  const { data: categoriesResponse, isLoading: categoriesLoading } = useQuery({
    queryKey: ["/api/tme/categories"],
    staleTime: 5 * 60 * 1000
  });

  const categories = (categoriesResponse as any)?.categories || [];

  // Fetch products for selected category with proper pagination
  const { data: productsResponse, isLoading: productsLoading } = useQuery({
    queryKey: [`/api/tme/products?categoryId=${selectedCategory}&page=${currentPage}&limit=${displayLimit}`],
    enabled: !!selectedCategory && activeTab === "products",
    staleTime: 5 * 60 * 1000
  });
  
  // Update total when data changes
  useEffect(() => {
    if (productsResponse && (productsResponse as any)?.total) {
      setTotalProductsAvailable((productsResponse as any).total);
    }
  }, [productsResponse]);

  // Fetch existing products to check for duplicates
  const { data: existingProducts = [] } = useQuery({
    queryKey: ["/api/products"],
    staleTime: 60 * 1000
  });

  const products = (productsResponse as any)?.products || [];
  const totalProducts = (productsResponse as any)?.total || 0;

  // Fetch enhanced product information for current page
  const { data: enhancedProducts = [], isLoading: enhancedLoading } = useQuery({
    queryKey: [`/api/tme/enhanced-info`, selectedCategory, currentPage],
    queryFn: async () => {
      if (!products.length) return [];
      
      const symbols = products.map((p: any) => p.Symbol);
      const response = await fetch('/api/tme/enhanced-info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols })
      });
      
      if (!response.ok) return [];
      return response.json();
    },
    enabled: !!selectedCategory && activeTab === "products" && products.length > 0,
    staleTime: 30 * 1000  // Reduce cache time to 30 seconds for testing
  });
  
  // Merge products with enhanced data
  const currentPageProducts = products.map((product: any) => {
    const enhanced = enhancedProducts.find((e: any) => e.product.Symbol === product.Symbol);
    if (enhanced) {
      return {
        ...product,
        Price: enhanced.price?.PriceList?.[0]?.PriceValue || 0,
        InStock: enhanced.stock?.Amount || 0,
        Weight: enhanced.product?.Weight || product.Weight || 0
      };
    }
    return product;
  });
  
  const totalPages = Math.ceil(totalProducts / displayLimit);
  const startIndex = (currentPage - 1) * displayLimit;
  const endIndex = startIndex + displayLimit;
  
  // Reset to page 1 when category changes
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedCategory]);

  // Sync selected products mutation
  const syncMutation = useMutation({
    mutationFn: async (data: { productSymbols: string[]; settings: SyncSettings }) => {
      const response = await fetch("/api/tme/sync-selected", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      });
      if (!response.ok) throw new Error("Sync failed");
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Sync completed",
        description: `${data.syncedCount || 0} new products added, ${data.updatedCount || 0} updated, ${data.failedCount || 0} failed`
      });
      setSelectedProducts(new Set());
      setShowSyncDialog(false);
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
    },
    onError: (error: any) => {
      toast({
        title: "Sync failed",
        description: error.message || "Failed to sync products. Please try again.",
        variant: "destructive"
      });
    }
  });

  const handleBulkSync = () => {
    if (selectedProducts.size === 0) return;
    
    const productSymbols = Array.from(selectedProducts);
    syncMutation.mutate({
      productSymbols,
      settings: syncSettings
    });
  };

  const toggleProductSelection = (symbol: string) => {
    const newSelected = new Set(selectedProducts);
    if (newSelected.has(symbol)) {
      newSelected.delete(symbol);
    } else {
      newSelected.add(symbol);
    }
    setSelectedProducts(newSelected);
  };

  const handleSyncSelected = () => {
    if (selectedProducts.size === 0) {
      toast({
        title: "No products selected",
        description: "Please select at least one product to sync.",
        variant: "destructive"
      });
      return;
    }

    syncMutation.mutate({
      productSymbols: Array.from(selectedProducts),
      settings: syncSettings
    });
  };

  const isProductSynced = (symbol: string): boolean => {
    return (existingProducts as any[]).some((p: any) => p.sku === symbol || p.supplierProductId === symbol);
  };

  const isSuitableProduct = (product: TMEProduct): boolean => {
    const weight = parseFloat(product.Weight) || 0;
    const price = parseFloat(product.Price) || 0;
    const stock = product.InStock || 0;
    
    return weight < 500 && price > 0.1 && price < 100 && stock > 0;
  };

  const selectSuitableProducts = () => {
    const newSelected = new Set<string>();
    const suitableProducts = products.filter((p: TMEProduct) => isSuitableProduct(p));
    suitableProducts.forEach((p: TMEProduct) => newSelected.add(p.Symbol));
    setSelectedProducts(newSelected);
  };

  const clearSelection = () => {
    setSelectedProducts(new Set());
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar user={user} />
      <div className="ml-64">
        <Header title="TME Browser" />
        <main className="p-6">
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">TME Product Browser</h1>
                <p className="text-gray-600">Browse and sync products from TME catalog</p>
              </div>
              
              {selectedProducts.size > 0 && (
                <div className="flex items-center space-x-2">
                  <Badge variant="secondary">
                    {selectedProducts.size} selected
                  </Badge>
                  <Button onClick={() => setShowSyncDialog(true)}>
                    Sync Selected Products
                  </Button>
                  <Button variant="outline" onClick={clearSelection}>
                    Clear Selection
                  </Button>
                </div>
              )}
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList>
                <TabsTrigger value="categories">Categories</TabsTrigger>
                <TabsTrigger value="products" disabled={!selectedCategory}>
                  Products {selectedCategory && `(${selectedCategory})`}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="categories">
                <Card>
                  <CardHeader>
                    <CardTitle>TME Product Categories</CardTitle>
                    <CardDescription>
                      Select a category to browse products. Categories are organized hierarchically.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {categoriesLoading ? (
                      <div className="flex items-center justify-center py-8">
                        <RefreshCw className="h-6 w-6 animate-spin mr-2" />
                        Loading categories...
                      </div>
                    ) : (
                      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                        {categories.map((category: TMECategory) => (
                          <div
                            key={category.CategoryId}
                            className="border rounded-lg p-4 hover:bg-gray-50 cursor-pointer transition-colors"
                            onClick={() => {
                              setSelectedCategory(category.CategoryId);
                              setActiveTab("products");
                            }}
                          >
                            <div className="flex items-center justify-between">
                              <div>
                                <h3 className="font-medium">{category.Name}</h3>
                                {category.ProductCount && (
                                  <p className="text-sm text-gray-600">
                                    {category.ProductCount} products
                                  </p>
                                )}
                              </div>
                              <ArrowRight className="h-4 w-4 text-gray-400" />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="products">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex flex-col">
                      <h2 className="text-lg font-semibold">
                        Products ({totalProducts.toLocaleString()} total)
                      </h2>
                      {totalPages > 1 && (
                        <p className="text-sm text-gray-500">
                          Showing {startIndex + 1}-{Math.min(endIndex, totalProducts)} of {totalProducts.toLocaleString()}
                        </p>
                      )}
                    </div>
                    
                    {products.length > 0 && (
                      <div className="flex items-center space-x-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={selectSuitableProducts}
                        >
                          <Zap className="h-4 w-4 mr-2" />
                          Select Suitable
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setSelectedCategory(null);
                            setActiveTab("categories");
                          }}
                        >
                          Back to Categories
                        </Button>
                      </div>
                    )}
                  </div>

                  {productsLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <RefreshCw className="h-6 w-6 animate-spin mr-2" />
                      Loading products...
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="border-b pb-4 space-y-3">
                        {/* Bulk Selection Controls */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-4">
                            <div className="flex items-center space-x-2">
                              <Checkbox
                                checked={currentPageProducts.length > 0 && currentPageProducts.every((p: any) => selectedProducts.has(p.Symbol))}
                                onCheckedChange={(checked) => {
                                  if (checked) {
                                    currentPageProducts.forEach((p: any) => selectedProducts.add(p.Symbol));
                                  } else {
                                    currentPageProducts.forEach((p: any) => selectedProducts.delete(p.Symbol));
                                  }
                                  setSelectedProducts(new Set(selectedProducts));
                                }}
                              />
                              <span className="text-sm font-medium">Select All on Page</span>
                            </div>
                            {selectedProducts.size > 0 && (
                              <Badge variant="secondary">
                                {selectedProducts.size} selected
                              </Badge>
                            )}
                          </div>
                          
                          {selectedProducts.size > 0 && (
                            <div className="flex items-center space-x-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setSelectedProducts(new Set())}
                              >
                                Clear All
                              </Button>
                              <Button
                                variant="default"
                                size="sm"
                                onClick={handleBulkSync}
                                disabled={syncMutation.isPending}
                                className="bg-blue-600 hover:bg-blue-700"
                              >
                                <Download className="h-3 w-3 mr-1" />
                                {syncMutation.isPending ? "Syncing..." : `Sync ${selectedProducts.size} Products`}
                              </Button>
                            </div>
                          )}
                        </div>
                        
                        {/* Pagination Controls */}
                        {totalPages > 1 && (
                          <div className="flex items-center justify-between">
                            <div className="text-sm text-gray-500">
                              Showing {startIndex + 1}-{Math.min(endIndex, totalProducts)} of {totalProducts} products (Page {currentPage} of {totalPages})
                            </div>
                            <div className="flex items-center space-x-2">
                              <Button variant="outline" size="sm" onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))} disabled={currentPage === 1}>
                                Previous
                              </Button>
                              <Button variant="outline" size="sm" onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))} disabled={currentPage === totalPages}>
                                Next
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                      
                      <div className="space-y-2">
                        {currentPageProducts.map((product: TMEProduct) => (
                          <div
                            key={product.Symbol}
                            className={`border rounded-lg p-4 flex items-center space-x-4 hover:bg-gray-50 ${
                              selectedProducts.has(product.Symbol) ? "ring-2 ring-blue-500 bg-blue-50" : ""
                            }`}
                          >
                            <Checkbox
                              checked={selectedProducts.has(product.Symbol)}
                              onCheckedChange={() => toggleProductSelection(product.Symbol)}
                            />
                            
                            <div className="flex-shrink-0 w-16 h-16 bg-gray-100 rounded flex items-center justify-center">
                              {product.Photo ? (
                                <img 
                                  src={`https:${product.Photo}`} 
                                  alt={product.Description}
                                  className="max-w-full max-h-full object-contain"
                                />
                              ) : (
                                <Package className="h-8 w-8 text-gray-400" />
                              )}
                            </div>
                            
                            <div className="flex-1 min-w-0">
                              <div className="flex items-start justify-between">
                                <div className="flex-1">
                                  <p className="text-sm font-medium text-gray-900 truncate">
                                    {product.Symbol}
                                  </p>
                                  <p className="text-sm text-gray-600 line-clamp-2">
                                    {product.Description}
                                  </p>
                                  <div className="mt-1 flex items-center space-x-4 text-xs text-gray-500">
                                    <span>Producer: {product.Producer}</span>
                                    <span>Stock: {product.InStock || product.Amount || product.Stock || "Loading..."}</span>
                                    <span>Price: €{product.Price ? Number(product.Price).toFixed(2) : "Loading..."}</span>
                                  </div>
                                </div>
                                
                                <div className="flex-shrink-0 ml-4 flex flex-col items-end space-y-2">
                                  {isProductSynced(product.Symbol) ? (
                                    <Badge variant="default" className="bg-green-600">
                                      <CheckCircle2 className="h-3 w-3 mr-1" />
                                      Synced
                                    </Badge>
                                  ) : isSuitableProduct(product) ? (
                                    <Badge variant="secondary" className="bg-blue-100 text-blue-800">
                                      <Zap className="h-3 w-3 mr-1" />
                                      Suitable
                                    </Badge>
                                  ) : (
                                    <Badge variant="outline" className="bg-yellow-100 text-yellow-800">
                                      <AlertCircle className="h-3 w-3 mr-1" />
                                      Check
                                    </Badge>
                                  )}
                                  
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => window.open(`https://www.tme.eu/en/details/${product.Symbol}/`, '_blank')}
                                  >
                                    <Eye className="h-3 w-3 mr-1" />
                                    View
                                  </Button>
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                      
                      {totalPages > 1 && (
                        <div className="flex items-center justify-between border-t pt-4">
                          <div className="text-sm text-gray-500">
                            Showing {startIndex + 1}-{Math.min(endIndex, totalProducts)} of {totalProducts} products (Page {currentPage} of {totalPages})
                          </div>
                          <div className="flex items-center space-x-2">
                            <Button variant="outline" size="sm" onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))} disabled={currentPage === 1}>
                              Previous
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))} disabled={currentPage === totalPages}>
                              Next
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </div>

          {/* Sync Selected Products Dialog */}
          <Dialog open={showSyncDialog} onOpenChange={setShowSyncDialog}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Sync Selected Products</DialogTitle>
                <DialogDescription>
                  Sync {selectedProducts.size} products from TME to your CRM.
                </DialogDescription>
              </DialogHeader>
              
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Sync Settings</Label>
                  <div className="space-y-2">
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        checked={syncSettings.applyDynamicPricing}
                        onCheckedChange={(checked) => 
                          setSyncSettings(prev => ({ ...prev, applyDynamicPricing: checked as boolean }))
                        }
                      />
                      <Label className="text-sm">Apply dynamic pricing</Label>
                    </div>
                    
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        checked={syncSettings.useStockLimit}
                        onCheckedChange={(checked) => 
                          setSyncSettings(prev => ({ ...prev, useStockLimit: checked as boolean }))
                        }
                      />
                      <Label className="text-sm">Use eBay stock limits</Label>
                    </div>
                    
                    {syncSettings.useStockLimit && (
                      <div className="ml-6">
                        <Label className="text-xs text-gray-600">eBay stock limit per product</Label>
                        <Input
                          type="number"
                          min="1"
                          max="10"
                          value={syncSettings.ebayStockLimit}
                          onChange={(e) => 
                            setSyncSettings(prev => ({ ...prev, ebayStockLimit: parseInt(e.target.value) || 3 }))
                          }
                          className="mt-1"
                        />
                      </div>
                    )}
                    
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        checked={syncSettings.autoSelectCategory}
                        onCheckedChange={(checked) => 
                          setSyncSettings(prev => ({ ...prev, autoSelectCategory: checked as boolean }))
                        }
                      />
                      <Label className="text-sm">Auto-select eBay categories</Label>
                    </div>
                  </div>
                </div>
              </div>
              
              <div className="flex justify-end space-x-2">
                <Button variant="outline" onClick={() => setShowSyncDialog(false)}>
                  Cancel
                </Button>
                <Button onClick={handleSyncSelected} disabled={syncMutation.isPending}>
                  {syncMutation.isPending ? (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                      Syncing...
                    </>
                  ) : (
                    `Sync ${selectedProducts.size} Products`
                  )}
                </Button>
              </div>
              
              {syncMutation.isPending && (
                <div className="mt-4 p-4 bg-blue-50 rounded-lg">
                  <p className="text-sm text-blue-700 flex items-center">
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    Syncing products... {syncProgress}%
                  </p>
                </div>
              )}
            </DialogContent>
          </Dialog>
        </main>
      </div>
    </div>
  );
}
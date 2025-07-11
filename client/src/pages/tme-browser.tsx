
import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { 
  Search, 
  Package, 
  Download, 
  Filter, 
  ChevronRight, 
  ChevronDown, 
  Eye, 
  ShoppingCart, 
  Zap,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Settings,
  TrendingUp,
  Clock,
  AlertTriangle
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";

interface TMEProduct {
  Symbol: string;
  Description: string;
  Producer: string;
  Photo: string;
  Thumbnail: string;
  Category: string;
  CategoryId: string;
  EAN: string;
  DataSheet: string;
  ProductInformationPage: string;
  Weight?: number;
  Unit?: string;
  MinAmount?: number;
  Multiples?: number;
  Parameters?: Array<{
    ParameterId: number;
    ParameterName: string;
    ParameterValue: string;
    ParameterUnit: string;
  }>;
}

interface TMECategory {
  CategoryId: string;
  Name: string;
  ParentId?: string;
  ProductCount?: number;
  children?: TMECategory[];
}

interface EnhancedProduct {
  product: TMEProduct;
  price: {
    Symbol: string;
    PriceList: Array<{
      Amount: number;
      PriceValue: number;
      PriceBase: number;
      Special: boolean;
    }>;
    Unit: string;
    VatRate: number;
  } | null;
  stock: {
    Symbol: string;
    Amount: number;
    Unit: string;
  } | null;
}

interface ProductFilters {
  search: string;
  priceMin: string;
  priceMax: string;
  stockMin: string;
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
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());
  const [currentPage, setCurrentPage] = useState(1);
  const [productsPerPage] = useState(50);
  const [showSyncDialog, setShowSyncDialog] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [enhancedProducts, setEnhancedProducts] = useState<EnhancedProduct[]>([]);
  const [loadingEnhanced, setLoadingEnhanced] = useState(false);

  const [filters, setFilters] = useState<ProductFilters>({
    search: "",
    priceMin: "",
    priceMax: "",
    producer: "",
    inStockOnly: true
  });

  const [syncSettings, setSyncSettings] = useState<SyncSettings>({
    applyDynamicPricing: true,
    useStockLimit: true,
    ebayStockLimit: 3,
    autoSelectCategory: true
  });

  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch TME categories
  const { data: categoriesData, isLoading: categoriesLoading } = useQuery({
    queryKey: ["/api/tme/categories"],
    staleTime: 5 * 60 * 1000
  });

  // Fetch products for selected category
  const { data: productsData, isLoading: productsLoading, refetch: refetchProducts } = useQuery({
    queryKey: ["/api/tme/products", selectedCategory, currentPage, productsPerPage, filters],
    queryFn: async () => {
      if (!selectedCategory) return { products: [], total: 0 };
      
      const params = new URLSearchParams({
        categoryId: selectedCategory,
        page: currentPage.toString(),
        limit: productsPerPage.toString(),
        search: filters.search,
        priceMin: filters.priceMin,
        priceMax: filters.priceMax,
        stockMin: filters.stockMin || "1",
        producer: filters.producer,
        inStockOnly: filters.inStockOnly.toString()
      });
      
      const response = await fetch(`/api/tme/products?${params}`);
      if (!response.ok) {
        throw new Error('Failed to fetch products');
      }
      return response.json();
    },
    enabled: !!selectedCategory,
    staleTime: 2 * 60 * 1000
  });

  // Fetch existing products to check sync status
  const { data: existingProducts } = useQuery({
    queryKey: ["/api/products"],
    staleTime: 1 * 60 * 1000
  });

  // TME API usage query
  const { data: apiUsage } = useQuery({
    queryKey: ["/api/tme/usage"],
    refetchInterval: 30000,
    staleTime: 30000
  });

  // Sync selected products mutation
  const syncProductsMutation = useMutation({
    mutationFn: async (data: { productSymbols: string[]; settings: SyncSettings }) => {
      const response = await fetch("/api/tme/sync-selected", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Sync failed");
      }
      return response.json();
    },
    onSuccess: (data) => {
      const { results } = data;
      toast({
        title: "Sync completed successfully",
        description: `${results.syncedCount} new products created, ${results.updatedCount} updated, ${results.failedCount} failed`
      });
      setSelectedProducts(new Set());
      setIsSyncing(false);
      setSyncProgress(0);
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
    },
    onError: (error) => {
      toast({
        title: "Sync failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive"
      });
      setIsSyncing(false);
      setSyncProgress(0);
    }
  });

  const categories = (categoriesData as any)?.categories || [];
  const products = (productsData as any)?.products || [];
  const totalProducts = (productsData as any)?.total || 0;
  const totalPages = Math.ceil(totalProducts / productsPerPage);

  // Enhanced product loading
  const loadEnhancedProductInfo = async (productSymbols: string[]) => {
    if (productSymbols.length === 0) {
      setEnhancedProducts([]);
      return;
    }
    
    setLoadingEnhanced(true);
    try {
      console.log('Loading enhanced info for:', productSymbols.slice(0, 5)); // Debug log
      
      const response = await fetch('/api/tme/enhanced-info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols: productSymbols })
      });
      
      if (response.ok) {
        const enhanced = await response.json();
        console.log('Enhanced data received:', enhanced.length, 'products'); // Debug log
        setEnhancedProducts(enhanced);
      } else {
        console.error('Enhanced info request failed:', response.status, response.statusText);
        setEnhancedProducts([]);
      }
    } catch (error) {
      console.error('Failed to load enhanced product info:', error);
      setEnhancedProducts([]);
    } finally {
      setLoadingEnhanced(false);
    }
  };

  // Load enhanced info when products change
  useEffect(() => {
    if (products.length > 0) {
      const symbols = products.slice(0, 20).map((p: TMEProduct) => p.Symbol); // Limit for API efficiency
      loadEnhancedProductInfo(symbols);
    } else {
      setEnhancedProducts([]);
    }
  }, [products]);

  const selectCategory = (categoryId: string) => {
    setSelectedCategory(categoryId);
    setCurrentPage(1);
    setSelectedProducts(new Set());
    setEnhancedProducts([]);
  };

  const toggleProductSelection = (productSymbol: string) => {
    const newSelected = new Set(selectedProducts);
    if (newSelected.has(productSymbol)) {
      newSelected.delete(productSymbol);
    } else {
      newSelected.add(productSymbol);
    }
    setSelectedProducts(newSelected);
  };

  const selectAllSuitable = () => {
    const suitableProducts = products.filter((p: TMEProduct) => isSuitableProduct(p));
    const newSelected = new Set(selectedProducts);
    suitableProducts.forEach((p: TMEProduct) => newSelected.add(p.Symbol));
    setSelectedProducts(newSelected);
  };

  const clearSelection = () => {
    setSelectedProducts(new Set());
  };

  const isSuitableProduct = (product: TMEProduct): boolean => {
    const weight = product.Weight || 0;
    return weight <= 500 && // Under 500g
           !product.Description.toLowerCase().includes('liquid') &&
           !product.Description.toLowerCase().includes('battery');
  };

  const isProductSynced = (productSymbol: string): boolean => {
    return (existingProducts as any)?.some((p: any) => p.sku === productSymbol) || false;
  };

  const getEnhancedProductInfo = (symbol: string): EnhancedProduct | null => {
    return enhancedProducts.find(ep => ep.product.Symbol === symbol) || null;
  };

  const handleSync = async () => {
    if (selectedProducts.size === 0) {
      toast({
        title: "No products selected",
        description: "Please select products to sync",
        variant: "destructive"
      });
      return;
    }

    setIsSyncing(true);
    setSyncProgress(0);

    // Simulate progress
    const progressInterval = setInterval(() => {
      setSyncProgress(prev => {
        if (prev >= 90) {
          clearInterval(progressInterval);
          return prev;
        }
        return prev + 10;
      });
    }, 500);

    try {
      await syncProductsMutation.mutateAsync({
        productSymbols: Array.from(selectedProducts),
        settings: syncSettings
      });
      setSyncProgress(100);
    } catch (error) {
      clearInterval(progressInterval);
    }
  };

  const getProductThumbnail = (product: TMEProduct) => {
    if (product.Photo) {
      return product.Photo.startsWith('//') ? `https:${product.Photo}` : product.Photo;
    }
    if (product.Thumbnail) {
      return product.Thumbnail.startsWith('//') ? `https:${product.Thumbnail}` : product.Thumbnail;
    }
    return null;
  };

  const getApiUsageColor = () => {
    if (!apiUsage?.usage) return "text-green-600";
    const percentage = apiUsage.usage.usagePercentage;
    if (percentage >= 80) return "text-red-600";
    if (percentage >= 60) return "text-yellow-600";
    return "text-green-600";
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar user={user} />
      <div className="ml-64">
        <Header user={user} />
        <main className="p-6">
          <div className="space-y-6">
            {/* Header with API Status */}
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-3xl font-bold">TME Product Browser</h1>
                <p className="text-gray-600">Browse and sync products from TME catalog</p>
              </div>
              <div className="flex items-center gap-4">
                {/* API Usage Display */}
                {apiUsage?.usage && (
                  <Card className="p-3">
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4 text-gray-500" />
                      <div className="text-sm">
                        <div className={`font-medium ${getApiUsageColor()}`}>
                          API: {apiUsage.usage.callsToday}/{apiUsage.usage.dailyLimit}
                        </div>
                        <div className="text-xs text-gray-500">
                          {apiUsage.usage.remainingDaily} remaining
                        </div>
                      </div>
                    </div>
                  </Card>
                )}
                
                <Button
                  onClick={() => setShowSyncDialog(true)}
                  disabled={selectedProducts.size === 0}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  <Download className="mr-2 h-4 w-4" />
                  Sync Selected ({selectedProducts.size})
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
              {/* Category Tree */}
              <Card className="lg:col-span-1">
                <CardHeader>
                  <CardTitle className="text-lg flex items-center">
                    <Package className="mr-2 h-5 w-5" />
                    Categories
                  </CardTitle>
                  <CardDescription>
                    {categories.length} categories available
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[600px]">
                    {categoriesLoading ? (
                      <div className="space-y-2">
                        {[...Array(10)].map((_, i) => (
                          <div key={i} className="h-8 bg-gray-200 rounded animate-pulse"></div>
                        ))}
                      </div>
                    ) : (
                      <div className="space-y-1">
                        {categories.map((category: TMECategory) => (
                          <div
                            key={category.CategoryId}
                            className={`flex items-center justify-between py-2 px-3 rounded cursor-pointer hover:bg-gray-100 ${
                              selectedCategory === category.CategoryId ? "bg-blue-100 border-l-4 border-blue-500" : ""
                            }`}
                            onClick={() => selectCategory(category.CategoryId)}
                          >
                            <span className="flex-1 text-sm">{category.Name}</span>
                            {category.ProductCount && (
                              <Badge variant="secondary" className="ml-2 text-xs">
                                {category.ProductCount.toLocaleString()}
                              </Badge>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                </CardContent>
              </Card>

              {/* Products Grid */}
              <div className="lg:col-span-3 space-y-4">
                {/* Filters */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center">
                      <Filter className="mr-2 h-5 w-5" />
                      Filters & Controls
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                      <Input
                        placeholder="Search products..."
                        value={filters.search}
                        onChange={(e) => setFilters(prev => ({ ...prev, search: e.target.value }))}
                      />
                      <Input
                        placeholder="Min price €"
                        type="number"
                        value={filters.priceMin}
                        onChange={(e) => setFilters(prev => ({ ...prev, priceMin: e.target.value }))}
                      />
                      <Input
                        placeholder="Max price €"
                        type="number"
                        value={filters.priceMax}
                        onChange={(e) => setFilters(prev => ({ ...prev, priceMax: e.target.value }))}
                      />
                      <Input
                        placeholder="Producer"
                        value={filters.producer}
                        onChange={(e) => setFilters(prev => ({ ...prev, producer: e.target.value }))}
                      />
                    </div>
                    <div className="flex items-center justify-between mt-4">
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="inStockOnly"
                          checked={filters.inStockOnly}
                          onCheckedChange={(checked) => 
                            setFilters(prev => ({ ...prev, inStockOnly: !!checked }))
                          }
                        />
                        <label htmlFor="inStockOnly" className="text-sm">In stock only</label>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          onClick={selectAllSuitable}
                          variant="outline"
                          size="sm"
                          disabled={!selectedCategory}
                        >
                          Select Suitable
                        </Button>
                        <Button
                          onClick={clearSelection}
                          variant="outline"
                          size="sm"
                          disabled={selectedProducts.size === 0}
                        >
                          Clear ({selectedProducts.size})
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Products */}
                {selectedCategory ? (
                  <Card>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-lg">
                          Products ({totalProducts.toLocaleString()} total)
                        </CardTitle>
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-gray-600">
                            Page {currentPage} of {totalPages}
                          </span>
                          <div className="flex gap-1">
                            <Button
                              onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                              disabled={currentPage === 1}
                              variant="outline"
                              size="sm"
                            >
                              Previous
                            </Button>
                            <Button
                              onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                              disabled={currentPage === totalPages}
                              variant="outline"
                              size="sm"
                            >
                              Next
                            </Button>
                          </div>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      {productsLoading ? (
                        <div className="space-y-4">
                          {[...Array(5)].map((_, i) => (
                            <div key={i} className="h-20 bg-gray-200 rounded animate-pulse"></div>
                          ))}
                        </div>
                      ) : products.length === 0 ? (
                        <div className="text-center py-8">
                          <Package className="h-12 w-12 mx-auto mb-4 text-gray-400" />
                          <p className="text-gray-500">No products found</p>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {products.map((product: TMEProduct) => {
                            const enhanced = getEnhancedProductInfo(product.Symbol);
                            const thumbnail = getProductThumbnail(product);
                            
                            return (
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
                                
                                <div className="flex-shrink-0 w-16 h-16 bg-gray-100 rounded flex items-center justify-center border">
                                  {thumbnail ? (
                                    <img 
                                      src={thumbnail} 
                                      alt={product.Description}
                                      className="max-w-full max-h-full object-contain rounded"
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
                                        {enhanced?.stock ? (
                                          <span className={enhanced.stock.Amount > 0 ? "text-green-600" : "text-red-600"}>
                                            Stock: {enhanced.stock.Amount.toLocaleString()} {enhanced.stock.Unit}
                                          </span>
                                        ) : loadingEnhanced ? (
                                          <span className="text-gray-400">Loading stock...</span>
                                        ) : (
                                          <span className="text-gray-400">Stock: Unknown</span>
                                        )}
                                        {enhanced?.price && enhanced.price.PriceList?.[0] ? (
                                          <span className="text-blue-600">
                                            Price: €{enhanced.price.PriceList[0].PriceValue.toFixed(2)}
                                          </span>
                                        ) : loadingEnhanced ? (
                                          <span className="text-gray-400">Loading price...</span>
                                        ) : (
                                          <span className="text-gray-400">Price: Unknown</span>
                                        )}
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
                                          <AlertTriangle className="h-3 w-3 mr-1" />
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
                            );
                          })}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ) : (
                  <Card>
                    <CardContent className="py-8">
                      <div className="text-center text-gray-500">
                        <Package className="h-12 w-12 mx-auto mb-4 opacity-50" />
                        <p>Select a category to browse products</p>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>

            {/* Sync Preview Dialog */}
            <Dialog open={showSyncDialog} onOpenChange={setShowSyncDialog}>
              <DialogContent className="max-w-4xl">
                <DialogHeader>
                  <DialogTitle>Sync Selected Products</DialogTitle>
                  <DialogDescription>
                    Review and configure sync settings for {selectedProducts.size} selected products
                  </DialogDescription>
                </DialogHeader>
                
                <Tabs defaultValue="preview" className="w-full">
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="preview">Preview</TabsTrigger>
                    <TabsTrigger value="settings">Settings</TabsTrigger>
                  </TabsList>
                  
                  <TabsContent value="preview" className="space-y-4">
                    <ScrollArea className="h-[400px]">
                      <div className="space-y-2">
                        {Array.from(selectedProducts).map(symbol => {
                          const product = products.find((p: TMEProduct) => p.Symbol === symbol);
                          const enhanced = getEnhancedProductInfo(symbol);
                          
                          if (!product) return null;
                          
                          return (
                            <div key={symbol} className="flex items-center justify-between p-3 border rounded">
                              <div className="flex items-center space-x-3">
                                <div className="w-8 h-8 bg-gray-100 rounded flex items-center justify-center">
                                  {getProductThumbnail(product) ? (
                                    <img
                                      src={getProductThumbnail(product)!}
                                      alt={product.Description}
                                      className="w-6 h-6 object-contain rounded"
                                    />
                                  ) : (
                                    <Package className="w-4 h-4 text-gray-400" />
                                  )}
                                </div>
                                <div>
                                  <div className="font-medium text-sm">{product.Symbol}</div>
                                  <div className="text-xs text-gray-600">{product.Producer}</div>
                                </div>
                              </div>
                              <div className="text-right">
                                {enhanced?.price && enhanced.price.PriceList[0] && (
                                  <div className="text-sm font-medium">
                                    €{enhanced.price.PriceList[0].PriceValue.toFixed(2)}
                                  </div>
                                )}
                                {enhanced?.stock && (
                                  <div className="text-xs text-gray-600">
                                    Stock: {enhanced.stock.Amount}
                                  </div>
                                )}
                                {!enhanced && (
                                  <div className="text-xs text-gray-400">Loading...</div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </ScrollArea>
                  </TabsContent>
                  
                  <TabsContent value="settings" className="space-y-4">
                    <div className="space-y-4">
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="dynamic-pricing"
                          checked={syncSettings.applyDynamicPricing}
                          onCheckedChange={(checked) => 
                            setSyncSettings(prev => ({ ...prev, applyDynamicPricing: !!checked }))
                          }
                        />
                        <label htmlFor="dynamic-pricing" className="text-sm">
                          Apply dynamic pricing with margin tiers
                        </label>
                      </div>
                      
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="stock-limit"
                          checked={syncSettings.useStockLimit}
                          onCheckedChange={(checked) => 
                            setSyncSettings(prev => ({ ...prev, useStockLimit: !!checked }))
                          }
                        />
                        <label htmlFor="stock-limit" className="text-sm">
                          Apply eBay stock limitation
                        </label>
                      </div>
                      
                      {syncSettings.useStockLimit && (
                        <div className="ml-6">
                          <label className="text-sm text-gray-600">eBay stock limit:</label>
                          <Input
                            type="number"
                            value={syncSettings.ebayStockLimit}
                            onChange={(e) => 
                              setSyncSettings(prev => ({ 
                                ...prev, 
                                ebayStockLimit: parseInt(e.target.value) || 3 
                              }))
                            }
                            className="w-20 ml-2"
                            min={1}
                            max={10}
                          />
                        </div>
                      )}
                      
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="auto-category"
                          checked={syncSettings.autoSelectCategory}
                          onCheckedChange={(checked) => 
                            setSyncSettings(prev => ({ ...prev, autoSelectCategory: !!checked }))
                          }
                        />
                        <label htmlFor="auto-category" className="text-sm">
                          Auto-select eBay categories using intelligent mapping
                        </label>
                      </div>
                    </div>
                  </TabsContent>
                </Tabs>
                
                <div className="flex justify-between items-center">
                  <Button variant="outline" onClick={() => setShowSyncDialog(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleSync} disabled={isSyncing}>
                    {isSyncing ? (
                      <>
                        <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                        Syncing...
                      </>
                    ) : (
                      <>
                        <Download className="mr-2 h-4 w-4" />
                        Sync {selectedProducts.size} Products
                      </>
                    )}
                  </Button>
                </div>
                
                {isSyncing && (
                  <div className="space-y-2">
                    <Progress value={syncProgress} className="w-full" />
                    <p className="text-sm text-center text-gray-600">
                      Syncing products... {syncProgress}%
                    </p>
                  </div>
                )}
              </DialogContent>
            </Dialog>
          </div>
        </main>
      </div>
    </div>
  );
}

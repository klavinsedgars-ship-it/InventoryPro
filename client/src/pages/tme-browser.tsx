import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
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
  Settings
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

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
  InStock: number;
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

export default function TMEBrowser() {
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());
  const [currentPage, setCurrentPage] = useState(1);
  const [productsPerPage, setProductsPerPage] = useState(100);
  const [filters, setFilters] = useState<ProductFilters>({
    search: "",
    priceMin: "",
    priceMax: "",
    stockMin: "",
    weightMax: "",
    producer: "",
    inStockOnly: true
  });
  const [syncSettings, setSyncSettings] = useState<SyncSettings>({
    applyDynamicPricing: true,
    useStockLimit: true,
    ebayStockLimit: 3,
    autoSelectCategory: true
  });
  const [showSyncPreview, setShowSyncPreview] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);

  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch TME categories
  const { data: categoriesData } = useQuery({
    queryKey: ["/api/tme/categories"],
    staleTime: 5 * 60 * 1000 // 5 minutes
  });

  // Fetch products for selected category
  const { data: productsData, isLoading: productsLoading, refetch: refetchProducts } = useQuery({
    queryKey: ["/api/tme/products", selectedCategory, currentPage, productsPerPage, filters],
    enabled: !!selectedCategory,
    staleTime: 2 * 60 * 1000 // 2 minutes
  });

  // Fetch existing products to check sync status
  const { data: existingProducts } = useQuery({
    queryKey: ["/api/products"],
    staleTime: 1 * 60 * 1000 // 1 minute
  });

  // Sync selected products mutation
  const syncProductsMutation = useMutation({
    mutationFn: async (data: { productSymbols: string[]; settings: SyncSettings }) => {
      const response = await fetch("/api/tme/sync-selected", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      });
      if (!response.ok) throw new Error("Sync failed");
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Sync completed successfully",
        description: `${selectedProducts.size} products synced to inventory`
      });
      setSelectedProducts(new Set());
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      setIsSyncing(false);
      setSyncProgress(0);
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

  // Build category tree
  const buildCategoryTree = (categories: TMECategory[]): TMECategory[] => {
    const categoryMap = new Map<string, TMECategory>();
    const rootCategories: TMECategory[] = [];

    categories.forEach(cat => {
      categoryMap.set(cat.CategoryId, { ...cat, children: [] });
    });

    categories.forEach(cat => {
      const category = categoryMap.get(cat.CategoryId)!;
      if (cat.ParentId && categoryMap.has(cat.ParentId)) {
        categoryMap.get(cat.ParentId)!.children!.push(category);
      } else {
        rootCategories.push(category);
      }
    });

    return rootCategories;
  };

  const categoryTree = buildCategoryTree(categories);

  const toggleCategory = (categoryId: string) => {
    const newExpanded = new Set(expandedCategories);
    if (newExpanded.has(categoryId)) {
      newExpanded.delete(categoryId);
    } else {
      newExpanded.add(categoryId);
    }
    setExpandedCategories(newExpanded);
  };

  const selectCategory = (categoryId: string) => {
    setSelectedCategory(categoryId);
    setCurrentPage(1);
    setSelectedProducts(new Set());
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

  const selectAllProducts = () => {
    const newSelected = new Set(selectedProducts);
    const suitableProducts = products.filter(p => isSuitableProduct(p));
    suitableProducts.forEach(p => newSelected.add(p.Symbol));
    setSelectedProducts(newSelected);
  };

  const clearSelection = () => {
    setSelectedProducts(new Set());
  };

  const isSuitableProduct = (product: TMEProduct): boolean => {
    const weight = parseFloat(product.Weight) || 0;
    const price = parseFloat(product.Price) || 0;
    const stock = product.InStock || 0;
    
    return weight <= 500 && // Under 500g
           price >= 0.01 && price <= 100 && // Reasonable price range
           stock > 0; // In stock
  };

  const isProductSynced = (productSymbol: string): boolean => {
    return existingProducts?.some((p: any) => p.sku === productSymbol) || false;
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

    await syncProductsMutation.mutateAsync({
      productSymbols: Array.from(selectedProducts),
      settings: syncSettings
    });

    clearInterval(progressInterval);
    setSyncProgress(100);
  };

  const renderCategoryTree = (categories: TMECategory[], depth = 0) => {
    return categories.map(category => (
      <div key={category.CategoryId} className={`ml-${depth * 4}`}>
        <div
          className={`flex items-center py-2 px-3 rounded cursor-pointer hover:bg-gray-100 ${
            selectedCategory === category.CategoryId ? "bg-blue-100 border-l-4 border-blue-500" : ""
          }`}
          onClick={() => selectCategory(category.CategoryId)}
        >
          {category.children && category.children.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="p-0 h-auto mr-2"
              onClick={(e) => {
                e.stopPropagation();
                toggleCategory(category.CategoryId);
              }}
            >
              {expandedCategories.has(category.CategoryId) ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </Button>
          )}
          <span className="flex-1 text-sm">{category.Name}</span>
          {category.ProductCount && (
            <Badge variant="secondary" className="ml-2 text-xs">
              {category.ProductCount}
            </Badge>
          )}
        </div>
        {expandedCategories.has(category.CategoryId) && category.children && (
          <div className="ml-4">
            {renderCategoryTree(category.children, depth + 1)}
          </div>
        )}
      </div>
    ));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">TME Product Browser</h1>
          <p className="text-gray-600">Browse and sync products from TME catalog</p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => setShowSyncPreview(true)}
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
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[600px]">
              {renderCategoryTree(categoryTree)}
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
              <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
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
                  placeholder="Min stock"
                  type="number"
                  value={filters.stockMin}
                  onChange={(e) => setFilters(prev => ({ ...prev, stockMin: e.target.value }))}
                />
                <Select
                  value={productsPerPage.toString()}
                  onValueChange={(value) => setProductsPerPage(parseInt(value))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="50">50 per page</SelectItem>
                    <SelectItem value="100">100 per page</SelectItem>
                    <SelectItem value="200">200 per page</SelectItem>
                    <SelectItem value="500">500 per page</SelectItem>
                  </SelectContent>
                </Select>
                <div className="flex gap-2">
                  <Button
                    onClick={selectAllProducts}
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
                    Clear
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
                    Products ({totalProducts} total)
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
                  <div className="flex items-center justify-center py-8">
                    <RefreshCw className="h-6 w-6 animate-spin mr-2" />
                    Loading products...
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {products.map((product) => (
                      <Card
                        key={product.Symbol}
                        className={`relative ${
                          selectedProducts.has(product.Symbol) ? "ring-2 ring-blue-500" : ""
                        }`}
                      >
                        <div className="absolute top-2 left-2 z-10">
                          <Checkbox
                            checked={selectedProducts.has(product.Symbol)}
                            onCheckedChange={() => toggleProductSelection(product.Symbol)}
                          />
                        </div>
                        
                        <div className="absolute top-2 right-2 z-10">
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
                        </div>

                        <CardContent className="p-4 pt-8">
                          <div className="space-y-2">
                            <div className="flex items-center space-x-2">
                              {product.Thumbnail && (
                                <img
                                  src={`https:${product.Thumbnail}`}
                                  alt={product.Description}
                                  className="w-12 h-12 object-contain rounded"
                                />
                              )}
                              <div className="flex-1 min-w-0">
                                <h3 className="font-semibold text-sm truncate">
                                  {product.Symbol}
                                </h3>
                                <p className="text-xs text-gray-600 truncate">
                                  {product.Producer}
                                </p>
                              </div>
                            </div>
                            
                            <p className="text-xs text-gray-700 line-clamp-2">
                              {product.Description}
                            </p>
                            
                            <div className="flex justify-between items-center text-xs">
                              <span className="font-medium text-green-600">
                                €{product.Price}
                              </span>
                              <span className={`${product.InStock > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                Stock: {product.InStock}
                              </span>
                            </div>
                            
                            <div className="text-xs text-gray-500">
                              Weight: {product.Weight}g
                            </div>
                            
                            <Dialog>
                              <DialogTrigger asChild>
                                <Button variant="outline" size="sm" className="w-full">
                                  <Eye className="h-3 w-3 mr-1" />
                                  View Details
                                </Button>
                              </DialogTrigger>
                              <DialogContent className="max-w-2xl">
                                <DialogHeader>
                                  <DialogTitle>{product.Symbol}</DialogTitle>
                                  <DialogDescription>{product.Description}</DialogDescription>
                                </DialogHeader>
                                <div className="space-y-4">
                                  <div className="grid grid-cols-2 gap-4">
                                    <div>
                                      <strong>Producer:</strong> {product.Producer}
                                    </div>
                                    <div>
                                      <strong>Price:</strong> €{product.Price}
                                    </div>
                                    <div>
                                      <strong>Stock:</strong> {product.InStock} {product.Unit}
                                    </div>
                                    <div>
                                      <strong>Weight:</strong> {product.Weight}g
                                    </div>
                                  </div>
                                  {product.Photo && (
                                    <img
                                      src={`https:${product.Photo}`}
                                      alt={product.Description}
                                      className="w-full max-w-md mx-auto rounded"
                                    />
                                  )}
                                  <div className="flex gap-2">
                                    {product.DataSheet && (
                                      <Button asChild variant="outline" size="sm">
                                        <a
                                          href={`https://www.tme.eu${product.DataSheet}`}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                        >
                                          Datasheet
                                        </a>
                                      </Button>
                                    )}
                                    {product.ProductInformationPage && (
                                      <Button asChild variant="outline" size="sm">
                                        <a
                                          href={`https://www.tme.eu${product.ProductInformationPage}`}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                        >
                                          TME Page
                                        </a>
                                      </Button>
                                    )}
                                  </div>
                                </div>
                              </DialogContent>
                            </Dialog>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
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
      <Dialog open={showSyncPreview} onOpenChange={setShowSyncPreview}>
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
                    const product = products.find(p => p.Symbol === symbol);
                    if (!product) return null;
                    
                    return (
                      <div key={symbol} className="flex items-center justify-between p-3 border rounded">
                        <div className="flex items-center space-x-3">
                          {product.Thumbnail && (
                            <img
                              src={`https:${product.Thumbnail}`}
                              alt={product.Description}
                              className="w-8 h-8 object-contain rounded"
                            />
                          )}
                          <div>
                            <div className="font-medium text-sm">{product.Symbol}</div>
                            <div className="text-xs text-gray-600">{product.Producer}</div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-medium">€{product.Price}</div>
                          <div className="text-xs text-gray-600">Stock: {product.InStock}</div>
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
            <Button variant="outline" onClick={() => setShowSyncPreview(false)}>
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
  );
}
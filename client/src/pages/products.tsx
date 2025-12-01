import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { ProductModal } from "@/components/product/product-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { 
  Plus, Search, Filter, Edit2, Trash2, Upload, Download, MoreHorizontal, 
  Eye, X, Package, ShoppingCart, AlertTriangle, CheckCircle, XCircle,
  ExternalLink, Settings, RefreshCw
} from "lucide-react";
import { getStatusColor, formatCurrency } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Product, Category } from "@shared/schema";

interface ProductsProps {
  user: any;
}

export function Products({ user }: ProductsProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [productModalOpen, setProductModalOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedStatus, setSelectedStatus] = useState<string>("all");
  const [selectedProducts, setSelectedProducts] = useState<Set<number>>(new Set());
  const [showFilters, setShowFilters] = useState(false);
  const [priceRange, setPriceRange] = useState<[number, number]>([0, 1000]);
  const [stockFilter, setStockFilter] = useState<string>("all");
  const [marketplaceFilter, setMarketplaceFilter] = useState<string>("all");

  const { data: products = [], isLoading } = useQuery<Product[]>({
    queryKey: ["/api/products", { 
      category: selectedCategory && selectedCategory !== "all" ? selectedCategory : undefined,
      status: selectedStatus && selectedStatus !== "all" ? selectedStatus : undefined 
    }],
  });

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ["/api/categories"],
  });

  const { data: stockInfoResponse } = useQuery({
    queryKey: ["/api/stock/info"],
  });
  
  const stockInfo = (stockInfoResponse as any)?.stockInfo || [];

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/products/${id}`),
    onSuccess: () => {
      toast({
        title: "Product Deleted",
        description: "The product has been deleted successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/metrics"] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete product.",
        variant: "destructive",
      });
    },
  });

  const deleteAllMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", "/api/products"),
    onSuccess: (data: any) => {
      toast({
        title: "All Products Deleted",
        description: `Successfully deleted ${data.deletedCount || 0} products.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/metrics"] });
      setSelectedProducts(new Set());
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete all products.",
        variant: "destructive",
      });
    },
  });

  const deleteSelectedMutation = useMutation({
    mutationFn: async (productIds: number[]) => {
      const results = await Promise.all(
        productIds.map(id => apiRequest("DELETE", `/api/products/${id}`).catch(() => null))
      );
      return { deletedCount: results.filter(r => r !== null).length };
    },
    onSuccess: (data: any) => {
      toast({
        title: "Products Deleted",
        description: `Successfully deleted ${data.deletedCount} selected products.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/metrics"] });
      setSelectedProducts(new Set());
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete selected products.",
        variant: "destructive",
      });
    },
  });

  const handleAddProduct = () => {
    setSelectedProduct(null);
    setProductModalOpen(true);
  };

  const handleEditProduct = (product: Product) => {
    setSelectedProduct(product);
    setProductModalOpen(true);
  };

  const handleDeleteProduct = (productId: number) => {
    if (confirm("Are you sure you want to delete this product?")) {
      deleteMutation.mutate(productId);
    }
  };

  // Bulk operations
  const handleSelectAll = () => {
    if (selectedProducts.size === filteredProducts.length) {
      setSelectedProducts(new Set());
    } else {
      setSelectedProducts(new Set(filteredProducts.map(p => p.id)));
    }
  };

  const handleSelectProduct = (productId: number) => {
    const newSelected = new Set(selectedProducts);
    if (newSelected.has(productId)) {
      newSelected.delete(productId);
    } else {
      newSelected.add(productId);
    }
    setSelectedProducts(newSelected);
  };

  const bulkListToEbayMutation = useMutation({
    mutationFn: async (productIds: number[]) => {
      return apiRequest("POST", "/api/ebay/bulk-list", { productIds });
    },
    onSuccess: (data: any) => {
      console.log("Bulk listing response:", data);
      console.log("Success check:", data.success, "Listed count:", data.listedCount);
      
      if (data.success === true && (data.listedCount || 0) > 0) {
        toast({
          title: "Bulk eBay Listing Completed",
          description: `${data.listedCount} of ${data.totalProducts} products successfully listed on eBay.`,
        });
      } else if (data.success === false || (data.failedCount || 0) > 0) {
        toast({
          title: "Bulk Listing Issues",
          description: `${data.failedCount || 0} products failed to list. Check individual results.`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "eBay Listing Status",
          description: `Listing completed. Check product status for details.`,
        });
      }
      setSelectedProducts(new Set());
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/metrics"] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to connect to eBay API.",
        variant: "destructive",
      });
    },
  });

  const unlistFromEbayMutation = useMutation({
    mutationFn: async (productId: number) => {
      const response = await apiRequest("POST", "/api/ebay/unlist", { productId });
      return response.json();
    },
    onSuccess: (data: any) => {
      if (data.success) {
        toast({
          title: "Product Unlisted",
          description: "Product successfully removed from eBay marketplace.",
        });
      } else {
        // Handle failed unlisting response
        const isTokenExpired = data.message?.includes('token is hard expired') || data.message?.includes('expired');
        toast({
          title: isTokenExpired ? "eBay Token Expired" : "Unlisting Failed",
          description: isTokenExpired 
            ? "Cannot unlist product - eBay token expired. Product remains listed on eBay. Please refresh your eBay token in Settings."
            : (data.message || "Failed to unlist product from eBay."),
          variant: "destructive",
        });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/metrics"] });
    },
    onError: (error: any) => {
      const isTokenExpired = error?.message?.includes('token is hard expired') || error?.message?.includes('expired');
      
      toast({
        title: isTokenExpired ? "eBay Token Expired" : "Unlist Failed",
        description: isTokenExpired 
          ? "Cannot unlist product - eBay token expired. Product remains listed on eBay. Please refresh your eBay token in Settings."
          : (error.message || "Failed to unlist product from eBay."),
        variant: "destructive",
      });
    },
  });

  const updateEbayListingMutation = useMutation({
    mutationFn: async (productId: number) => {
      const response = await apiRequest("POST", "/api/ebay/update", { productId });
      return response.json();
    },
    onSuccess: (data: any) => {
      if (data.success) {
        toast({
          title: "eBay Listing Updated",
          description: "Product details successfully synced to eBay marketplace.",
        });
      } else {
        toast({
          title: "Update Failed",
          description: data.error || "Failed to update eBay listing.",
          variant: "destructive",
        });
      }
    },
    onError: (error: any) => {
      toast({
        title: "Update Failed",
        description: error.message || "Failed to update eBay listing.",
        variant: "destructive",
      });
    },
  });

  // Helper function to get product thumbnail
  const getProductThumbnail = (product: Product) => {
    if (product.imageUrl) {
      return product.imageUrl;
    }
    // Default thumbnail based on category
    const categoryDefaults: { [key: string]: string } = {
      'Electronics': '📱',
      'Accessories': '🔧',
      'Components': '⚡',
      'Sensors': '🔍',
      'Development': '💻'
    };
    return categoryDefaults[product.category] || '📦';
  };

  const bulkListToAmazonMutation = useMutation({
    mutationFn: async (productIds: number[]) => {
      const promises = productIds.map(id => 
        apiRequest("PATCH", `/api/products/${id}`, { listedOnAmazon: true })
      );
      return Promise.all(promises);
    },
    onSuccess: () => {
      toast({
        title: "Bulk Operation Completed",
        description: `${selectedProducts.size} products listed on Amazon.`,
      });
      setSelectedProducts(new Set());
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to list products on Amazon.",
        variant: "destructive",
      });
    },
  });

  // Enhanced filtering logic
  const filteredProducts = products.filter(product => {
    // Text search
    const matchesSearch = !searchTerm || 
      product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      product.sku.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (product.ean && product.ean.toLowerCase().includes(searchTerm.toLowerCase()));

    // Category filter
    const matchesCategory = selectedCategory === "all" || product.category === selectedCategory;

    // Status filter
    const matchesStatus = selectedStatus === "all" || product.status === selectedStatus;

    // Price range filter
    const productPrice = parseFloat(product.salePrice);
    const matchesPrice = productPrice >= priceRange[0] && productPrice <= priceRange[1];

    // Stock filter
    const matchesStock = stockFilter === "all" || 
      (stockFilter === "low" && product.stock < 5) ||
      (stockFilter === "out" && product.stock === 0) ||
      (stockFilter === "available" && product.stock > 0);

    // Marketplace filter
    const matchesMarketplace = marketplaceFilter === "all" ||
      (marketplaceFilter === "ebay" && product.listedOnEbay) ||
      (marketplaceFilter === "amazon" && product.listedOnAmazon) ||
      (marketplaceFilter === "unlisted" && !product.listedOnEbay && !product.listedOnAmazon);

    return matchesSearch && matchesCategory && matchesStatus && 
           matchesPrice && matchesStock && matchesMarketplace;
  });

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar user={user} />
      <div className="ml-64">
        <Header 
          title="Products" 
          subtitle="Manage your inventory and product listings (sorted by latest synced)"
        />
        
        <div className="p-6">
          {/* Filters and Search - Compact Layout */}
          <div className="mb-4 space-y-3">
            {/* Row 1: Search and Filters */}
            <div className="flex flex-wrap items-center gap-2">
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/products"] })}
                data-testid="btn-refresh"
              >
                <RefreshCw className="w-4 h-4" />
              </Button>
              <div className="relative flex-shrink-0">
                <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <Input
                  placeholder="Search..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-8 w-40 h-9"
                  data-testid="input-search"
                />
              </div>

              <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                <SelectTrigger className="w-36 h-9" data-testid="select-category">
                  <SelectValue placeholder="Category" />
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
                <SelectTrigger className="w-28 h-9" data-testid="select-status">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                  <SelectItem value="out_of_stock">Out of Stock</SelectItem>
                </SelectContent>
              </Select>

              <Select value={stockFilter} onValueChange={setStockFilter}>
                <SelectTrigger className="w-28 h-9" data-testid="select-stock">
                  <SelectValue placeholder="Stock" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Stock</SelectItem>
                  <SelectItem value="available">Available</SelectItem>
                  <SelectItem value="low">Low (&lt;5)</SelectItem>
                  <SelectItem value="out">Out</SelectItem>
                </SelectContent>
              </Select>

              <Select value={marketplaceFilter} onValueChange={setMarketplaceFilter}>
                <SelectTrigger className="w-24 h-9" data-testid="select-marketplace">
                  <SelectValue placeholder="Market" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="ebay">eBay</SelectItem>
                  <SelectItem value="amazon">Amazon</SelectItem>
                  <SelectItem value="unlisted">Unlisted</SelectItem>
                </SelectContent>
              </Select>

              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowFilters(!showFilters)}
                data-testid="btn-price-filter"
              >
                <Filter className="w-4 h-4" />
              </Button>

              <div className="flex-1" />

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button 
                    variant="destructive" 
                    size="sm"
                    disabled={products.length === 0 || deleteAllMutation.isPending}
                    data-testid="button-delete-all"
                  >
                    <Trash2 className="w-4 h-4 mr-1" />
                    {deleteAllMutation.isPending ? "..." : "Delete All"}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete All Products?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will permanently delete all {products.length} products from your inventory. 
                      This action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
                    <AlertDialogAction 
                      onClick={() => deleteAllMutation.mutate()}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      data-testid="button-confirm-delete"
                    >
                      Yes, Delete All
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              <Button size="sm" onClick={handleAddProduct} data-testid="button-add-product">
                <Plus className="w-4 h-4 mr-1" />
                Add
              </Button>
            </div>

            {/* Bulk Operations Toolbar */}
            {selectedProducts.size > 0 && (
              <Card>
                <CardContent className="py-2 px-4">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-sm text-gray-600 font-medium">
                      {selectedProducts.size} selected
                    </span>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => bulkListToEbayMutation.mutate(Array.from(selectedProducts))}
                        disabled={bulkListToEbayMutation.isPending}
                        data-testid="btn-bulk-ebay"
                      >
                        <Upload className="w-3 h-3 mr-1" />
                        eBay
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => bulkListToAmazonMutation.mutate(Array.from(selectedProducts))}
                        disabled={bulkListToAmazonMutation.isPending}
                        data-testid="btn-bulk-amazon"
                      >
                        <Upload className="w-3 h-3 mr-1" />
                        Amazon
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="destructive"
                            size="sm"
                            disabled={deleteSelectedMutation.isPending}
                            data-testid="btn-delete-selected"
                          >
                            <Trash2 className="w-3 h-3 mr-1" />
                            {deleteSelectedMutation.isPending ? "..." : "Delete"}
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete Selected Products?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will permanently delete {selectedProducts.size} selected product{selectedProducts.size !== 1 ? 's' : ''}. 
                              This action cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction 
                              onClick={() => deleteSelectedMutation.mutate(Array.from(selectedProducts))}
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            >
                              Yes, Delete Selected
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedProducts(new Set())}
                        data-testid="btn-clear-selection"
                      >
                        <X className="w-3 h-3 mr-1" />
                        Clear
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Advanced Filters Panel */}
            {showFilters && (
              <Card className="mb-4">
                <CardContent className="py-4">
                  <div className="space-y-4">
                    <div>
                      <Label className="text-sm font-medium">Price Range (€{priceRange[0]} - €{priceRange[1]})</Label>
                      <div className="mt-2">
                        <Slider
                          value={priceRange}
                          onValueChange={(value) => setPriceRange(value as [number, number])}
                          max={1000}
                          min={0}
                          step={10}
                          className="w-full"
                        />
                      </div>
                    </div>
                    <div className="flex justify-end">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSearchTerm("");
                          setSelectedCategory("all");
                          setSelectedStatus("all");
                          setStockFilter("all");
                          setMarketplaceFilter("all");
                          setPriceRange([0, 1000]);
                        }}
                      >
                        <RefreshCw className="w-4 h-4 mr-1" />
                        Reset Filters
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
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
                    : "No products found. Add your first product to get started."
                  }
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-8">
                        <Checkbox
                          checked={selectedProducts.size === filteredProducts.length && filteredProducts.length > 0}
                          onCheckedChange={handleSelectAll}
                        />
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Product
                      </th>
                      <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-20">
                        SKU
                      </th>
                      <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-20">
                        Category
                      </th>
                      <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-16">
                        Price
                      </th>
                      <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-16">
                        TME Stock
                      </th>
                      <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-16">
                        eBay Stock
                      </th>
                      <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-16">
                        Status
                      </th>
                      <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-20">
                        Markets
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {filteredProducts.map((product) => (
                      <tr key={product.id} className="hover:bg-gray-50">
                        <td className="px-2 py-3 whitespace-nowrap">
                          <Checkbox
                            checked={selectedProducts.has(product.id)}
                            onCheckedChange={() => handleSelectProduct(product.id)}
                          />
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap">
                          <div className="flex items-center">
                            <div className="h-10 w-10 bg-gray-100 rounded-lg mr-3 flex-shrink-0 flex items-center justify-center border">
                              {product.imageUrl ? (
                                <img 
                                  src={product.imageUrl} 
                                  alt={product.name}
                                  className="h-8 w-8 object-cover rounded"
                                />
                              ) : (
                                <span className="text-lg">{getProductThumbnail(product)}</span>
                              )}
                            </div>
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-gray-900 truncate max-w-48">
                                {product.name}
                              </div>
                              <div className="text-xs text-gray-500">{product.ean || "No EAN"}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-2 py-3 whitespace-nowrap text-sm text-gray-900">
                          {product.sku}
                        </td>
                        <td className="px-2 py-3 whitespace-nowrap text-sm text-gray-500">
                          {product.category}
                        </td>
                        <td className="px-2 py-3 whitespace-nowrap text-sm text-gray-900">
                          {formatCurrency(product.salePrice)}
                        </td>
                        <td className="px-2 py-3 whitespace-nowrap text-sm text-gray-900">
                          <span className={product.stock === 0 ? "text-red-600" : "text-gray-900"}>
                            {product.stock.toLocaleString()}
                          </span>
                        </td>
                        <td className="px-2 py-3 whitespace-nowrap text-sm text-gray-900">
                          {(() => {
                            const productStockInfo = stockInfo.find((info: any) => info.id === product.id);
                            if (!productStockInfo) {
                              return <span className="text-xs text-gray-500">Loading...</span>;
                            }
                            
                            const ebayStock = productStockInfo.ebayStock;
                            const isLimited = productStockInfo.isLimited;
                            
                            return (
                              <span className={ebayStock === 0 ? "text-red-600" : "text-green-600"}>
                                {ebayStock}
                              </span>
                            );
                          })()}
                        </td>
                        <td className="px-2 py-3 whitespace-nowrap">
                          <Badge 
                            variant="secondary" 
                            className={`text-xs ${getStatusColor(product.status)}`}
                          >
                            {product.status === 'out_of_stock' ? 'Out' : 
                             product.status.charAt(0).toUpperCase() + product.status.slice(1)}
                          </Badge>
                        </td>
                        <td className="px-2 py-3 whitespace-nowrap">
                          <div className="space-y-1">
                            {/* eBay Status */}
                            <div className="flex items-center space-x-2">
                              {product.listedOnEbay ? (
                                <div className="flex items-center space-x-2">
                                  <div className="flex items-center space-x-1">
                                    <CheckCircle className="h-3 w-3 text-green-500" />
                                    <span className="text-xs text-green-700 font-medium">eBay</span>
                                  </div>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-4 w-4 p-0"
                                    onClick={() => {
                                      if (product.ebayItemId) {
                                        const ebayUrl = `https://www.ebay.co.uk/itm/${product.ebayItemId}`;
                                        window.open(ebayUrl, '_blank');
                                      }
                                    }}
                                    title="View on eBay"
                                  >
                                    <ExternalLink className="h-3 w-3 text-blue-500" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-4 w-4 p-0"
                                    onClick={() => {
                                      updateEbayListingMutation.mutate(product.id);
                                    }}
                                    disabled={updateEbayListingMutation.isPending}
                                    title="Update eBay listing"
                                  >
                                    <RefreshCw className="h-3 w-3 text-blue-500" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-4 w-4 p-0"
                                    onClick={() => {
                                      if (confirm(`Unlist "${product.name}" from eBay?`)) {
                                        unlistFromEbayMutation.mutate(product.id);
                                      }
                                    }}
                                    disabled={unlistFromEbayMutation.isPending}
                                    title="Unlist from eBay"
                                  >
                                    <X className="h-3 w-3 text-red-500" />
                                  </Button>
                                </div>
                              ) : (
                                <div className="flex items-center space-x-1">
                                  <XCircle className="h-3 w-3 text-gray-400" />
                                  <span className="text-xs text-gray-500">eBay</span>
                                </div>
                              )}
                            </div>
                            
                            {/* Amazon Status */}
                            <div className="flex items-center space-x-2">
                              {product.listedOnAmazon ? (
                                <div className="flex items-center space-x-2">
                                  <div className="flex items-center space-x-1">
                                    <CheckCircle className="h-3 w-3 text-green-500" />
                                    <span className="text-xs text-green-700 font-medium">Amazon</span>
                                  </div>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-4 w-4 p-0"
                                    onClick={() => {
                                      const searchQuery = encodeURIComponent(`${product.name} ${product.sku}`);
                                      const amazonUrl = `https://www.amazon.com/s?k=${searchQuery}`;
                                      window.open(amazonUrl, '_blank');
                                    }}
                                    title="View on Amazon"
                                  >
                                    <ExternalLink className="h-3 w-3 text-blue-500" />
                                  </Button>
                                </div>
                              ) : (
                                <div className="flex items-center space-x-1">
                                  <XCircle className="h-3 w-3 text-gray-400" />
                                  <span className="text-xs text-gray-500">Amazon</span>
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap text-sm font-medium">
                          <div className="flex items-center space-x-2">
                            <Button 
                              variant="ghost" 
                              size="sm"
                              onClick={() => handleEditProduct(product)}
                              className="h-8 w-8 p-0 hover:bg-blue-50"
                              title="Edit product"
                            >
                              <Edit2 className="h-4 w-4 text-blue-600" />
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="sm"
                              onClick={() => handleDeleteProduct(product.id)}
                              className="h-8 w-8 p-0 hover:bg-red-50"
                              disabled={deleteMutation.isPending}
                              title="Delete product"
                            >
                              <Trash2 className="h-4 w-4 text-red-600" />
                            </Button>
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

      <ProductModal
        isOpen={productModalOpen}
        onClose={() => setProductModalOpen(false)}
        product={selectedProduct}
      />
    </div>
  );
}

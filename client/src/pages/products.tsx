import { useState, useEffect, useRef } from "react";
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
import { Progress } from "@/components/ui/progress";
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
  ExternalLink, Settings, RefreshCw, Loader2
} from "lucide-react";
import { getStatusColor, formatCurrency } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Product, Category } from "@shared/schema";

interface BulkListingJob {
  id: string;
  status: string;
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  currentProduct: string | null;
  lastMessage: string | null;
  errorDetails: Array<{ productId: number; error: string }> | null;
  createdAt: string;
  completedAt: string | null;
}

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
  const [moqFilter, setMoqFilter] = useState<string>("all");
  const [itemsPerPage, setItemsPerPage] = useState<number>(250);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // Click-to-sort on Price / TME-stock columns
  const [sortField, setSortField] = useState<"price" | "stock" | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const toggleSort = (field: "price" | "stock") => {
    if (sortField === field) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  };
  const sortArrow = (field: "price" | "stock") =>
    sortField === field ? (sortDir === "desc" ? " ↓" : " ↑") : " ↕";
  
  // Bulk listing progress state
  const [bulkListingModalOpen, setBulkListingModalOpen] = useState(false);
  const [listingCount, setListingCount] = useState(0);
  const [listProgress, setListProgress] = useState<{ done: number; total: number; published: number; failed: number } | null>(null);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [bulkListingProgress, setBulkListingProgress] = useState<BulkListingJob | null>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

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

  // Which eBay domain to link listings to (driven by the configured
  // marketplace site id on the server, not hardcoded to co.uk).
  const { data: publicConfig } = useQuery<{ ebaySiteId: string; ebayDomain: string }>({
    queryKey: ["/api/public-config"],
    staleTime: 60 * 60 * 1000,
  });
  const ebayDomain = publicConfig?.ebayDomain || "www.ebay.com";
  
  const stockInfo = (stockInfoResponse as any)?.stockInfo || [];

  // Polling for bulk listing job progress
  useEffect(() => {
    const pollJobStatus = async () => {
      if (!currentJobId) return;
      
      try {
        const response = await fetch(`/api/ebay/bulk-list/${currentJobId}/status`);
        const data = await response.json();
        
        if (data.success && data.job) {
          setBulkListingProgress(data.job);
          
          // If job is completed or failed, stop polling
          if (data.job.status === "completed" || data.job.status === "failed") {
            if (pollingIntervalRef.current) {
              clearInterval(pollingIntervalRef.current);
              pollingIntervalRef.current = null;
            }
            
            // Show final toast
            if (data.job.status === "completed") {
              toast({
                title: "Bulk Listing Completed",
                description: `${data.job.succeeded} of ${data.job.total} products listed successfully.`,
              });
              queryClient.invalidateQueries({ queryKey: ["/api/products"] });
              queryClient.invalidateQueries({ queryKey: ["/api/dashboard/metrics"] });
            } else {
              toast({
                title: "Bulk Listing Failed",
                description: data.job.lastMessage || "An error occurred during bulk listing.",
                variant: "destructive",
              });
            }
          }
        }
      } catch (error) {
        console.error("Error polling job status:", error);
      }
    };

    if (currentJobId && !pollingIntervalRef.current) {
      // Start polling every 500ms
      pollingIntervalRef.current = setInterval(pollJobStatus, 500);
      // Also poll immediately
      pollJobStatus();
    }

    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, [currentJobId, toast, queryClient]);

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
    if (selectedProducts.size === displayedProducts.length) {
      setSelectedProducts(new Set());
    } else {
      setSelectedProducts(new Set(displayedProducts.map(p => p.id)));
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
      // 25 per request: the server lists each batch via the bulk eBay
      // endpoints (~3 calls per 25 vs 3 per product). Progress advances per
      // batch. Fits comfortably inside the serverless function timeout.
      const CHUNK = 25;
      let published = 0, failed = 0, skipped = 0, done = 0, limitHit = false;
      const failures: string[] = [];
      setListProgress({ done: 0, total: productIds.length, published: 0, failed: 0 });
      for (let i = 0; i < productIds.length && !limitHit; i += CHUNK) {
        const chunk = productIds.slice(i, i + CHUNK);
        const response = await apiRequest("POST", "/api/ebay/inventory-list-batch", { productIds: chunk });
        const data = await response.json();
        if (!data.success) throw new Error(data.error || data.message || "Listing failed");
        published += data.published || 0;
        failed += data.failed || 0;
        skipped += data.skipped || 0;
        done += chunk.length;
        (data.results || []).filter((r: any) => !r.ok).forEach((r: any) => failures.push(`${r.sku}: ${r.error}`));
        setListProgress({ done, total: productIds.length, published, failed });
        if (data.limitHit) limitHit = true;
      }
      return { success: true, published, failed, skipped, attempted: productIds.length, limitHit, failures };
    },
    onSuccess: (data: any) => {
      if (data.success) {
        toast({
          title: data.published > 0 ? "Listed on eBay" : "Listing finished",
          description:
            `${data.published}/${data.attempted} published` +
            (data.failed ? `, ${data.failed} failed` : "") +
            (data.skipped ? `, ${data.skipped} skipped (out of stock)` : "") +
            (data.limitHit ? " (eBay limit reached — resume later)" : ""),
          variant: data.failed && !data.published ? "destructive" : undefined,
        });
        if (data.failures?.length) console.warn("Listing failures:\n" + data.failures.join("\n"));
        queryClient.invalidateQueries({ queryKey: ["/api/products"] });
        queryClient.invalidateQueries({ queryKey: ["/api/dashboard/metrics"] });
        setSelectedProducts(new Set());
      } else {
        toast({
          title: "Bulk Listing Failed",
          description: data.error || data.message || "Failed to list on eBay.",
          variant: "destructive",
        });
      }
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to connect to eBay API.",
        variant: "destructive",
      });
    },
    onSettled: () => {
      setListProgress(null);
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

  const bulkUnlistFromEbayMutation = useMutation({
    mutationFn: async (productIds: number[]) => {
      // Filter to only products that are actually listed on eBay
      const listedProductIds = productIds.filter(id => {
        const product = products.find(p => p.id === id);
        return product?.listedOnEbay && (product?.ebayItemId || (product as any)?.ebayOfferId);
      });
      
      // If no products are listed, return early
      if (listedProductIds.length === 0) {
        return { successCount: 0, failCount: 0, total: 0, skipped: productIds.length };
      }
      
      const results = await Promise.all(
        listedProductIds.map(async (id) => {
          try {
            const response = await apiRequest("POST", "/api/ebay/unlist", { productId: id });
            return { id, success: true, data: await response.json() };
          } catch (error) {
            return { id, success: false, error };
          }
        })
      );
      const successCount = results.filter(r => r.success && r.data?.success).length;
      const failCount = results.filter(r => !r.success || !r.data?.success).length;
      return { successCount, failCount, total: listedProductIds.length, skipped: productIds.length - listedProductIds.length };
    },
    onSuccess: (data: any) => {
      if (data.total === 0) {
        toast({
          title: "No Products to Unlist",
          description: "None of the selected products were listed on eBay.",
        });
      } else if (data.successCount > 0) {
        toast({
          title: "Products Unlisted",
          description: `Successfully unlisted ${data.successCount} product${data.successCount > 1 ? 's' : ''} from eBay.`,
        });
      }
      // Only show error if there were actual failures (not just skipped)
      if (data.failCount > 0) {
        toast({
          title: "Some Unlists Failed",
          description: `${data.failCount} product${data.failCount > 1 ? 's' : ''} failed to unlist from eBay.`,
          variant: "destructive",
        });
      }
      setSelectedProducts(new Set());
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/metrics"] });
    },
    onError: (error: any) => {
      toast({
        title: "Bulk Unlist Failed",
        description: error.message || "Failed to unlist products from eBay.",
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
      (stockFilter === "low" && product.stock < 5 && product.stock > 0) ||
      (stockFilter === "high" && product.stock > 5) ||
      (stockFilter === "out" && product.stock === 0) ||
      (stockFilter === "available" && product.stock > 0);

    // Marketplace filter
    const matchesMarketplace = marketplaceFilter === "all" ||
      (marketplaceFilter === "listed" && (product.listedOnEbay || product.listedOnAmazon)) ||
      (marketplaceFilter === "ebay" && product.listedOnEbay) ||
      (marketplaceFilter === "amazon" && product.listedOnAmazon) ||
      (marketplaceFilter === "unlisted" && !product.listedOnEbay && !product.listedOnAmazon);

    const matchesMoq = moqFilter === "all" ||
      (moqFilter === "single" && (!product.moq || product.moq === 1)) ||
      (moqFilter === "multipack" && product.moq && product.moq > 1);

    return matchesSearch && matchesCategory && matchesStatus && 
           matchesPrice && matchesStock && matchesMarketplace && matchesMoq;
  });

  // Optional sort by Price (salePrice) or TME stock, then paginate.
  const sortedProducts = sortField
    ? [...filteredProducts].sort((a, b) => {
        const av = sortField === "price" ? parseFloat(a.salePrice) || 0 : a.stock ?? 0;
        const bv = sortField === "price" ? parseFloat(b.salePrice) || 0 : b.stock ?? 0;
        return sortDir === "desc" ? bv - av : av - bv;
      })
    : filteredProducts;

  // Paginate products based on itemsPerPage
  const displayedProducts = sortedProducts.slice(0, itemsPerPage);

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar user={user} collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} />
      <div className={`transition-all duration-200 ${sidebarCollapsed ? 'ml-16' : 'ml-64'}`}>
        <Header 
          title="Products" 
          subtitle="Manage your inventory and product listings (sorted by latest synced)"
          actions={
            <div className="flex items-center gap-1.5">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button 
                    variant="destructive" 
                    size="sm"
                    className="h-7 text-xs px-2"
                    disabled={products.length === 0 || deleteAllMutation.isPending}
                    data-testid="button-delete-all"
                  >
                    <Trash2 className="w-3 h-3 mr-1" />
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
              <Button size="sm" className="h-7 text-xs px-2" onClick={handleAddProduct} data-testid="button-add-product">
                <Plus className="w-3 h-3 mr-1" />
                Add
              </Button>
            </div>
          }
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
                  <SelectItem value="high">High (&gt;5)</SelectItem>
                  <SelectItem value="low">Low (&lt;5)</SelectItem>
                  <SelectItem value="out">Out</SelectItem>
                </SelectContent>
              </Select>

              <Select value={marketplaceFilter} onValueChange={setMarketplaceFilter}>
                <SelectTrigger className="w-28 h-9" data-testid="select-marketplace">
                  <SelectValue placeholder="Market" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Markets</SelectItem>
                  <SelectItem value="listed">Listed Only</SelectItem>
                  <SelectItem value="ebay">eBay Only</SelectItem>
                  <SelectItem value="amazon">Amazon Only</SelectItem>
                  <SelectItem value="unlisted">Unlisted</SelectItem>
                </SelectContent>
              </Select>

              <Select value={moqFilter} onValueChange={setMoqFilter}>
                <SelectTrigger className="w-28 h-9" data-testid="select-moq">
                  <SelectValue placeholder="MOQ" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All MOQ</SelectItem>
                  <SelectItem value="single">Single (1x)</SelectItem>
                  <SelectItem value="multipack">Multipacks</SelectItem>
                </SelectContent>
              </Select>

              <Select value={String(itemsPerPage)} onValueChange={(val) => setItemsPerPage(Number(val))}>
                <SelectTrigger className="w-24 h-9" data-testid="select-items-per-page">
                  <SelectValue placeholder="Show" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="250">250</SelectItem>
                  <SelectItem value="500">500</SelectItem>
                  <SelectItem value="1000">1000</SelectItem>
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
                        onClick={() => {
                          setListingCount(selectedProducts.size);
                          bulkListToEbayMutation.mutate(Array.from(selectedProducts));
                        }}
                        disabled={bulkListToEbayMutation.isPending}
                        data-testid="btn-bulk-ebay"
                      >
                        {bulkListToEbayMutation.isPending ? (
                          <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                        ) : (
                          <Upload className="w-3 h-3 mr-1" />
                        )}
                        {bulkListToEbayMutation.isPending ? "Listing…" : "List eBay"}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => bulkUnlistFromEbayMutation.mutate(Array.from(selectedProducts))}
                        disabled={bulkUnlistFromEbayMutation.isPending}
                        className="text-orange-600 border-orange-300 hover:bg-orange-50"
                        data-testid="btn-bulk-unlist-ebay"
                      >
                        <Download className="w-3 h-3 mr-1" />
                        Unlist eBay
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
                      <Label className="text-sm font-medium">Price Range</Label>
                      <div className="mt-2 flex items-center gap-2">
                        <Input
                          type="number"
                          placeholder="From"
                          value={priceRange[0] || ''}
                          onChange={(e) => setPriceRange([Number(e.target.value) || 0, priceRange[1]])}
                          className="w-24 h-9"
                          min={0}
                          data-testid="input-price-from"
                        />
                        <span className="text-gray-500">-</span>
                        <Input
                          type="number"
                          placeholder="To"
                          value={priceRange[1] || ''}
                          onChange={(e) => setPriceRange([priceRange[0], Number(e.target.value) || 1000])}
                          className="w-24 h-9"
                          min={0}
                          data-testid="input-price-to"
                        />
                        <span className="text-sm text-gray-500">€</span>
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
                {/* Products count indicator */}
                <div className="px-4 py-2 bg-gray-50 border-b text-xs text-gray-600">
                  Showing {displayedProducts.length} of {filteredProducts.length} products
                  {filteredProducts.length > displayedProducts.length && (
                    <span className="text-gray-400 ml-1">(increase limit to see more)</span>
                  )}
                </div>
                <table className="w-full divide-y divide-gray-200 table-fixed">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-1 py-2 text-left text-xs font-medium text-gray-500 uppercase w-8">
                        <Checkbox
                          checked={selectedProducts.size === displayedProducts.length && displayedProducts.length > 0}
                          onCheckedChange={handleSelectAll}
                        />
                      </th>
                      <th className="px-1 py-2 text-left text-xs font-medium text-gray-500 uppercase" style={{width: '180px'}}>
                        Product
                      </th>
                      <th className="px-1 py-2 text-left text-xs font-medium text-gray-500 uppercase" style={{width: '110px'}}>
                        SKU
                      </th>
                      <th className="px-1 py-2 text-center text-xs font-medium text-gray-500 uppercase" style={{width: '50px'}}>
                        MOQ
                      </th>
                      <th className="px-1 py-2 text-left text-xs font-medium text-gray-500 uppercase" style={{width: '100px'}}>
                        Category
                      </th>
                      <th
                        className="px-1 py-2 text-right text-xs font-medium text-gray-500 uppercase cursor-pointer select-none hover:text-gray-800"
                        style={{width: '55px'}}
                        onClick={() => toggleSort("price")}
                        title="Sort by price"
                      >
                        Price<span className="text-gray-400">{sortArrow("price")}</span>
                      </th>
                      <th
                        className="px-1 py-2 text-right text-xs font-medium text-gray-500 uppercase cursor-pointer select-none hover:text-gray-800"
                        style={{width: '50px'}}
                        onClick={() => toggleSort("stock")}
                        title="Sort by TME stock"
                      >
                        TME<span className="text-gray-400">{sortArrow("stock")}</span>
                      </th>
                      <th className="px-1 py-2 text-right text-xs font-medium text-gray-500 uppercase" style={{width: '45px'}}>
                        eBay
                      </th>
                      <th className="px-1 py-2 text-center text-xs font-medium text-gray-500 uppercase" style={{width: '55px'}}>
                        Status
                      </th>
                      <th className="px-1 py-2 text-center text-xs font-medium text-gray-500 uppercase" style={{width: '75px'}}>
                        Markets
                      </th>
                      <th className="px-1 py-2 text-center text-xs font-medium text-gray-500 uppercase" style={{width: '55px'}}>
                        Act
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {displayedProducts.map((product) => (
                      <tr key={product.id} className="hover:bg-gray-50">
                        <td className="px-1 py-2">
                          <Checkbox
                            checked={selectedProducts.has(product.id)}
                            onCheckedChange={() => handleSelectProduct(product.id)}
                          />
                        </td>
                        <td className="px-1 py-2">
                          <div className="flex items-center gap-2">
                            <div className="h-8 w-8 bg-gray-100 rounded flex-shrink-0 flex items-center justify-center border">
                              {product.imageUrl ? (
                                <img 
                                  src={product.imageUrl} 
                                  alt={product.name}
                                  className="h-7 w-7 object-cover rounded"
                                />
                              ) : (
                                <span className="text-sm">{getProductThumbnail(product)}</span>
                              )}
                            </div>
                            <div className="min-w-0 overflow-hidden">
                              <div className="text-xs font-medium text-gray-900 truncate" title={product.name}>
                                {product.name}
                              </div>
                              <div className="text-xs text-gray-400 truncate">{product.ean || "No EAN"}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-1 py-2 text-xs text-gray-900 truncate" title={product.sku}>
                          {product.sku}
                        </td>
                        <td className="px-1 py-2 text-center">
                          {product.moq && product.moq > 1 ? (
                            <Badge variant="outline" className="px-1.5 py-0 text-[10px] bg-purple-50 text-purple-700 border-purple-200">
                              {product.moq}x
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="px-1.5 py-0 text-[10px] bg-gray-50 text-gray-500 border-gray-200">
                              1x
                            </Badge>
                          )}
                        </td>
                        <td className="px-1 py-2 text-xs text-gray-500 truncate" title={product.category}>
                          {product.category}
                        </td>
                        <td className="px-1 py-2 text-xs text-gray-900 text-right">
                          {formatCurrency(product.salePrice)}
                        </td>
                        <td className="px-1 py-2 text-xs text-right">
                          <span className={product.stock === 0 ? "text-red-600" : "text-gray-900"}>
                            {product.stock.toLocaleString()}
                          </span>
                        </td>
                        <td className="px-1 py-2 text-xs text-right">
                          {(() => {
                            const productStockInfo = stockInfo.find((info: any) => info.id === product.id);
                            if (!productStockInfo) return <span className="text-gray-400">-</span>;
                            const ebayStock = productStockInfo.ebayStock;
                            return (
                              <span className={ebayStock === 0 ? "text-red-600" : "text-green-600"}>
                                {ebayStock}
                              </span>
                            );
                          })()}
                        </td>
                        <td className="px-1 py-2 text-center">
                          <Badge 
                            variant="secondary" 
                            className={`text-xs px-1 py-0 ${getStatusColor(product.status)}`}
                          >
                            {product.status === 'out_of_stock' ? 'Out' : 
                             product.status === 'active' ? 'Active' : 'Off'}
                          </Badge>
                        </td>
                        <td className="px-1 py-2">
                          <div className="flex items-center justify-center gap-1">
                            {product.listedOnEbay && product.ebayItemId ? (
                              <a 
                                href={`https://${ebayDomain}/itm/${product.ebayItemId}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                title={`View on eBay (${product.ebayItemId})`}
                                className="inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold bg-green-500 text-white hover:bg-green-600 cursor-pointer"
                                data-testid={`link-ebay-${product.id}`}
                              >
                                E
                              </a>
                            ) : (
                              <span 
                                title="Not listed on eBay"
                                className="inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold bg-gray-200 text-gray-400"
                              >
                                E
                              </span>
                            )}
                            {product.listedOnAmazon ? (
                              <span 
                                title="Listed on Amazon"
                                className="inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold bg-orange-500 text-white"
                              >
                                A
                              </span>
                            ) : (
                              <span 
                                title="Not listed on Amazon"
                                className="inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold bg-gray-200 text-gray-400"
                              >
                                A
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-1 py-2">
                          <div className="flex items-center justify-center gap-0">
                            <Button 
                              variant="ghost" 
                              size="sm"
                              onClick={() => handleEditProduct(product)}
                              className="h-6 w-6 p-0 hover:bg-blue-50"
                              title="Edit"
                            >
                              <Edit2 className="h-3 w-3 text-blue-600" />
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="sm"
                              onClick={() => handleDeleteProduct(product.id)}
                              className="h-6 w-6 p-0 hover:bg-red-50"
                              disabled={deleteMutation.isPending}
                              title="Delete"
                            >
                              <Trash2 className="h-3 w-3 text-red-600" />
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

      {/* Inventory-API listing progress */}
      {bulkListToEbayMutation.isPending && (
        <div className="fixed bottom-0 left-0 right-0 z-50 bg-white dark:bg-gray-900 border-t border-blue-200 shadow-lg">
          <div className="px-4 py-3 max-w-7xl mx-auto">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                <span className="text-sm font-medium">
                  Listing on eBay… {listProgress ? `${listProgress.done}/${listProgress.total}` : `${listingCount}`}
                </span>
              </div>
              {listProgress && (
                <span className="text-xs text-muted-foreground">
                  {listProgress.published} published
                  {listProgress.failed ? `, ${listProgress.failed} failed` : ""}
                  {" · "}{Math.max(0, listProgress.total - listProgress.done)} left
                </span>
              )}
            </div>
            <div className="mt-2 h-2 w-full overflow-hidden rounded bg-blue-100">
              <div
                className="h-full rounded bg-blue-600 transition-all duration-300"
                style={{ width: listProgress && listProgress.total ? `${Math.round((listProgress.done / listProgress.total) * 100)}%` : "5%" }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Bulk Listing Progress Bar - Fixed at Bottom */}
      {bulkListingProgress && (
        <div 
          className="fixed bottom-0 left-0 right-0 z-50 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 shadow-lg"
          data-testid="progress-bar-bulk-listing"
        >
          {/* Main Progress Section */}
          <div className="px-4 py-3">
            <div className="max-w-7xl mx-auto">
              {/* Header Row */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                  {bulkListingProgress.status === "processing" ? (
                    <div className="flex items-center gap-2 text-blue-600">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span className="font-medium text-sm">Listing Products on eBay</span>
                    </div>
                  ) : bulkListingProgress.status === "completed" ? (
                    <div className="flex items-center gap-2 text-green-600">
                      <CheckCircle className="h-4 w-4" />
                      <span className="font-medium text-sm">Listing Complete</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-red-600">
                      <XCircle className="h-4 w-4" />
                      <span className="font-medium text-sm">Listing Failed</span>
                    </div>
                  )}
                  
                  {/* Current Product - inline */}
                  {bulkListingProgress.status === "processing" && bulkListingProgress.currentProduct && (
                    <span className="text-xs text-muted-foreground truncate max-w-md hidden md:inline" data-testid="text-current-product">
                      Processing: {bulkListingProgress.currentProduct}
                    </span>
                  )}
                </div>

                {/* Stats - inline */}
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-1.5">
                    <span className="text-lg font-bold text-green-600" data-testid="text-succeeded-count">
                      {bulkListingProgress.succeeded || 0}
                    </span>
                    <span className="text-xs text-muted-foreground">success</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-lg font-bold text-red-600" data-testid="text-failed-count">
                      {bulkListingProgress.failed || 0}
                    </span>
                    <span className="text-xs text-muted-foreground">failed</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-lg font-bold text-gray-500" data-testid="text-remaining-count">
                      {(bulkListingProgress.total || 0) - (bulkListingProgress.processed || 0)}
                    </span>
                    <span className="text-xs text-muted-foreground">remaining</span>
                  </div>
                  
                  {/* Progress Count */}
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300 ml-2">
                    {bulkListingProgress.processed || 0} / {bulkListingProgress.total || 0}
                  </span>

                  {/* Close Button - only when not processing */}
                  {bulkListingProgress.status !== "processing" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setBulkListingModalOpen(false);
                        setCurrentJobId(null);
                        setBulkListingProgress(null);
                      }}
                      className="h-7 px-2 ml-2"
                      data-testid="btn-close-progress"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>

              {/* Progress Bar */}
              <Progress 
                value={bulkListingProgress.total ? ((bulkListingProgress.processed || 0) / bulkListingProgress.total) * 100 : 0}
                className="h-2"
                data-testid="progress-bulk-listing"
              />

              {/* Error Details - expandable section */}
              {bulkListingProgress.status === "completed" && bulkListingProgress.failed > 0 && bulkListingProgress.errorDetails && (
                <div className="mt-2 bg-red-50 dark:bg-red-950/50 rounded px-3 py-2 max-h-64 overflow-y-auto">
                  <p className="text-xs text-red-600 dark:text-red-400 font-medium mb-1">Failed Items:</p>
                  <ul className="flex flex-col gap-1 text-xs text-red-700 dark:text-red-300">
                    {bulkListingProgress.errorDetails.map((err, idx) => (
                      <li
                        key={idx}
                        className="whitespace-pre-wrap break-words font-mono leading-snug"
                        title={err.error}
                      >
                        <span className="font-semibold">#{err.productId}:</span> {err.error}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

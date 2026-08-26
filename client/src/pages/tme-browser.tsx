import { useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { invalidateProductViews } from "@/lib/queryClient";
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
  AlertTriangle,
  Folder,
  FolderOpen,
  EyeOff
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

interface ApiUsageResponse {
  success: boolean;
  usage: {
    callsToday: number;
    dailyLimit: number;
    remainingDaily: number;
    usagePercentage: number;
    rateLimitPerMinute: number;
    callsThisMinute: number;
    remainingThisMinute: number;
    safeRateLimit: number;
    status: string;
    lastUpdated: string | null;
    lastResetAt: string | null;
  };
  limits: {
    daily: number;
    perMinute: number;
    safePerMinute: number;
  };
  recommendations: string[];
}

interface TMEBrowserProps {
  user: any;
}

// Persist the categories response across reloads so cold-start failures
// don't leave the user with an empty tree. The server response is large
// (~1.7k entries) but well under localStorage limits.
const TME_CATEGORIES_CACHE_KEY = "tme-categories-cache-v1";

function loadCachedCategoriesResponse(): { categories: TMECategory[] } | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(TME_CATEGORIES_CACHE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.categories) && parsed.categories.length > 0) {
      return parsed;
    }
  } catch {
    // ignore corrupt cache
  }
  return undefined;
}

function saveCachedCategoriesResponse(categories: TMECategory[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      TME_CATEGORIES_CACHE_KEY,
      JSON.stringify({ categories })
    );
  } catch {
    // quota or disabled storage — non-fatal
  }
}

// Build hierarchical category tree from flat list
function buildCategoryTree(categories: TMECategory[]): TMECategory[] {
  const categoryMap = new Map<string, TMECategory>();
  const rootCategories: TMECategory[] = [];
  const addedToRoot = new Set<string>();
  const addedToParent = new Set<string>();
  
  // First pass: create map of all categories (skip duplicates)
  categories.forEach(cat => {
    if (!categoryMap.has(cat.CategoryId)) {
      categoryMap.set(cat.CategoryId, { ...cat, children: [] });
    }
  });
  
  // Second pass: build tree structure
  categories.forEach(cat => {
    const category = categoryMap.get(cat.CategoryId)!;
    if (cat.ParentId && categoryMap.has(cat.ParentId)) {
      const parent = categoryMap.get(cat.ParentId)!;
      parent.children = parent.children || [];
      // Avoid adding same child twice
      if (!addedToParent.has(cat.CategoryId)) {
        parent.children.push(category);
        addedToParent.add(cat.CategoryId);
      }
    } else {
      // Root category - avoid duplicates
      if (!addedToRoot.has(cat.CategoryId)) {
        rootCategories.push(category);
        addedToRoot.add(cat.CategoryId);
      }
    }
  });
  
  return rootCategories;
}

export default function TMEBrowser({ user }: TMEBrowserProps) {
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());
  // Product objects for everything in selectedProducts, kept so the selection
  // panel can render items chosen in OTHER categories/pages (the grid only
  // holds the current page). Source of truth for selection display.
  const [selectedDetails, setSelectedDetails] = useState<Map<string, TMEProduct>>(new Map());
  const [currentPage, setCurrentPage] = useState(1);
  const [productsPerPage] = useState(50); // Server aggregates 3 TME pages (20 each) into one UI page.
  const [showSyncDialog, setShowSyncDialog] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncJobId, setSyncJobId] = useState<string | null>(null);
  const [syncStats, setSyncStats] = useState({
    total: 0,
    processed: 0,
    syncedCount: 0,
    updatedCount: 0,
    failedCount: 0,
  });
  const syncCancelRef = useRef(false);
  const [enhancedProducts, setEnhancedProducts] = useState<EnhancedProduct[]>([]);
  const [loadingEnhanced, setLoadingEnhanced] = useState(false);
  const [hideSyncedCategories, setHideSyncedCategories] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const [filters, setFilters] = useState<ProductFilters>({
    search: "",
    priceMin: "",
    priceMax: "",
    stockMin: "1",
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

  // Fetch TME categories. The endpoint is slow on Vercel cold starts and
  // the global queryClient has retry:false, so a single failure used to
  // leave the tree empty until a manual reload. Override retry locally and
  // hydrate from localStorage so the user sees categories instantly even
  // when the network call is still in flight (or fails).
  const {
    data: categoriesData,
    isLoading: categoriesLoading,
    error: categoriesError,
    refetch: refetchCategories,
    isFetching: categoriesFetching,
  } = useQuery({
    queryKey: ["/api/tme/categories"],
    staleTime: 5 * 60 * 1000,
    retry: 3,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    initialData: loadCachedCategoriesResponse,
  });

  // Persist successful responses so the next mount hydrates from cache.
  useEffect(() => {
    const cats = (categoriesData as any)?.categories as TMECategory[] | undefined;
    if (cats && cats.length > 0) {
      saveCachedCategoriesResponse(cats);
    }
  }, [categoriesData]);

  // Fetch products for selected category
  const { data: productsData, isLoading: productsLoading, refetch: refetchProducts } = useQuery({
    queryKey: ["/api/tme/products", selectedCategory, currentPage, productsPerPage, filters],
    queryFn: async () => {
      if (!selectedCategory) return { products: [], total: 0 };

      const params = new URLSearchParams({
        categoryId: selectedCategory,
        page: currentPage.toString(),
        limit: productsPerPage.toString()
      });

      // Only add filter params if they have values
      if (filters.search) params.append('search', filters.search);
      if (filters.priceMin) params.append('priceMin', filters.priceMin);
      if (filters.priceMax) params.append('priceMax', filters.priceMax);
      if (filters.stockMin) params.append('stockMin', filters.stockMin);
      if (filters.producer) params.append('producer', filters.producer);
      params.append('inStockOnly', filters.inStockOnly.toString());

      const response = await fetch(`/api/tme/products?${params}`);
      if (!response.ok) {
        throw new Error('Failed to fetch products');
      }
      return response.json();
    },
    enabled: !!selectedCategory,
    staleTime: 2 * 60 * 1000
  });

  // Reset to page 1 when filters change
  useEffect(() => {
    if (selectedCategory) {
      setCurrentPage(1);
    }
  }, [filters.search, filters.priceMin, filters.priceMax, filters.producer, filters.inStockOnly]);

  // Fetch existing products to check sync status
  const { data: existingProducts } = useQuery({
    queryKey: ["/api/products"],
    staleTime: 1 * 60 * 1000
  });

  // TME API usage query - faster refetch during sync
  const { data: apiUsage } = useQuery<ApiUsageResponse>({
    queryKey: ["/api/tme/usage"],
    refetchInterval: isSyncing ? 5000 : 30000,
    staleTime: isSyncing ? 2000 : 30000
  });

  // Apply a chunk-progress payload from the sync-job API to local UI state.
  const applySyncProgress = (data: any) => {
    setSyncStats({
      total: data.total ?? 0,
      processed: data.processed ?? 0,
      syncedCount: data.syncedCount ?? 0,
      updatedCount: data.updatedCount ?? 0,
      failedCount: data.failedCount ?? 0,
    });
    setSyncProgress(data.total > 0 ? Math.round((data.processed / data.total) * 100) : 0);
  };

  // Drive a sync job to completion: repeatedly ask the server to process the
  // next chunk, updating real progress each round. Returns the final payload,
  // or null if the user cancelled. Throws on a server error.
  const pumpSyncJob = async (jobId: string) => {
    syncCancelRef.current = false;
    while (!syncCancelRef.current) {
      const res = await fetch("/api/tme/sync-job-chunk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Sync chunk failed");
      }
      const data = await res.json();
      applySyncProgress(data);
      if (data.done) return data;
    }
    return null; // cancelled
  };

  const finishSync = (final: any) => {
    if (final.status === "cancelled") {
      toast({
        title: "Sync cancelled",
        description: `Stopped at ${final.processed}/${final.total} (${final.syncedCount} new, ${final.updatedCount} updated)`,
      });
    } else {
      toast({
        title: final.failedCount > 0 ? "Sync finished with some errors" : "Sync completed successfully",
        description: `${final.syncedCount || 0} new, ${final.updatedCount || 0} updated, ${final.failedCount || 0} failed`,
        variant: final.failedCount > 0 ? "destructive" : "default",
      });
    }
    invalidateProductViews();
  };

  const rawCategories = (categoriesData as any)?.categories || [];
  
  // Filter to only show leaf categories (categories that don't have children)
  // A category is a leaf if its CategoryId never appears as any other category's ParentId
  const parentIds = new Set(rawCategories.map((c: TMECategory) => c.ParentId).filter(Boolean));
  const leafCategories = rawCategories.filter((c: TMECategory) => !parentIds.has(c.CategoryId));
  
  // Build hierarchical tree for display - group by parent categories  
  const categoryTree = buildCategoryTree(rawCategories);
  
  // Get synced category IDs from existing products (normalize to strings for comparison)
  const syncedCategoryIds = new Set(
    ((existingProducts as any[]) || [])
      .filter(p => p.tmeCategoryId)
      .map(p => String(p.tmeCategoryId))
  );
  
  // Check if a category itself is directly synced (has products synced from it)
  const isCategoryDirectlySynced = (category: TMECategory): boolean => {
    return syncedCategoryIds.has(category.CategoryId);
  };
  
  // Check if a category or any of its children have synced products (for showing green checkmark)
  const hasSyncedDescendants = (category: TMECategory): boolean => {
    if (syncedCategoryIds.has(category.CategoryId)) return true;
    if (category.children && category.children.length > 0) {
      return category.children.some(child => hasSyncedDescendants(child));
    }
    return false;
  };
  
  // Check if category is a leaf (no children)
  const isLeafCategory = (category: TMECategory): boolean => {
    return !category.children || category.children.length === 0;
  };
  
  // Filter the tree for "Hide synced". Two rules, applied bottom-up:
  //   1. A leaf that's directly synced is hidden.
  //   2. A parent whose children ALL get hidden (a fully-synced branch) is
  //      hidden too — the old version kept these empty parent shells, which is
  //      why "Hide synced" looked like it did nothing (e.g. Diodes/Transistors
  //      are parents, never leaves, so nothing ever disappeared).
  // Partially-synced parents stay, showing only their remaining unsynced
  // children — so what's left is exactly the paths to un-synced categories.
  const filterSyncedLeaves = (categories: TMECategory[]): TMECategory[] => {
    const result: TMECategory[] = [];
    for (const cat of categories) {
      if (!isLeafCategory(cat)) {
        const filteredChildren = filterSyncedLeaves(cat.children!);
        if (filteredChildren.length === 0) continue; // whole branch synced → drop
        result.push({ ...cat, children: filteredChildren });
      } else {
        if (isCategoryDirectlySynced(cat)) continue; // synced leaf → drop
        result.push(cat);
      }
    }
    return result;
  };
  
  // Toggle category expansion
  const toggleCategoryExpand = (categoryId: string) => {
    setExpandedCategories(prev => {
      const newSet = new Set(prev);
      if (newSet.has(categoryId)) {
        newSet.delete(categoryId);
      } else {
        newSet.add(categoryId);
      }
      return newSet;
    });
  };
  
  // Use leaf categories for product browsing
  const categories = leafCategories;
  const products = (productsData as any)?.products || [];
  const totalProducts = (productsData as any)?.total || 0;

  // Symbols already in our DB (by TME symbol == product.sku). "Hide synced"
  // uses this to drop already-synced products from the grid so you only see
  // NEW products to add — the reliable, per-product meaning of "synced"
  // (category-level coverage isn't computable; see notes).
  const syncedSymbols = new Set(((existingProducts as any[]) || []).map((p: any) => p.sku));
  const visibleProducts: TMEProduct[] = hideSyncedCategories
    ? products.filter((p: TMEProduct) => !syncedSymbols.has(p.Symbol))
    : products;
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
        console.log('Sample enhanced product:', enhanced[0]); // Debug log
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

  // Enhanced info is now loaded on-demand to avoid hitting API rate limits
  // Auto-loading disabled - users can click "Load Prices" button to fetch prices
  const manualLoadEnhanced = () => {
    const productList = (productsData as any)?.products || [];
    if (productList.length > 0) {
      const symbols = productList.map((p: TMEProduct) => p.Symbol);
      loadEnhancedProductInfo(symbols);
    }
  };
  
  // Clear enhanced products when category changes
  useEffect(() => {
    setEnhancedProducts([]);
  }, [selectedCategory]);

  const selectCategory = (categoryId: string) => {
    setSelectedCategory(categoryId);
    setCurrentPage(1);
    // NOTE: do NOT clear selectedProducts here. Selection accumulates across
    // categories/subcategories so the operator can assemble one big sync from
    // many subcategories. Enhanced (per-category) pricing data is still reset.
    setEnhancedProducts([]);
  };

  // Remember product objects for a set of selected symbols so the selection
  // panel can show items from categories/pages no longer on screen.
  const rememberDetails = (prods: TMEProduct[]) => {
    setSelectedDetails((prev) => {
      const next = new Map(prev);
      for (const p of prods) next.set(p.Symbol, p);
      return next;
    });
  };

  const toggleProductSelection = (productSymbol: string) => {
    const newSelected = new Set(selectedProducts);
    if (newSelected.has(productSymbol)) {
      newSelected.delete(productSymbol);
      setSelectedDetails((prev) => {
        const next = new Map(prev);
        next.delete(productSymbol);
        return next;
      });
    } else {
      newSelected.add(productSymbol);
      const prod = products.find((p: TMEProduct) => p.Symbol === productSymbol);
      if (prod) rememberDetails([prod]);
    }
    setSelectedProducts(newSelected);
  };

  const selectAllOnPage = () => {
    const newSelected = new Set(selectedProducts);
    visibleProducts.forEach((p: TMEProduct) => newSelected.add(p.Symbol));
    setSelectedProducts(newSelected);
    rememberDetails(visibleProducts);
    toast({
      title: "Selected all on page",
      description: `Added ${visibleProducts.length} products to selection`
    });
  };

  const selectAllSuitable = () => {
    const suitableProducts = visibleProducts.filter((p: TMEProduct) => isSuitableProduct(p));
    const newSelected = new Set(selectedProducts);
    suitableProducts.forEach((p: TMEProduct) => newSelected.add(p.Symbol));
    setSelectedProducts(newSelected);
    rememberDetails(suitableProducts);
  };

  const clearSelection = () => {
    setSelectedProducts(new Set());
    setSelectedDetails(new Map());
  };

  // Bulk load multiple pages and select all products
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkProgress, setBulkProgress] = useState(0);
  const [bulkAbortController, setBulkAbortController] = useState<AbortController | null>(null);
  
  const cancelBulkSelection = () => {
    if (bulkAbortController) {
      bulkAbortController.abort();
      setBulkAbortController(null);
    }
    setBulkLoading(false);
    setBulkProgress(0);
    toast({
      title: "Bulk selection cancelled",
      description: "Selection process was stopped"
    });
  };
  
  // "Select All": pull EVERY in-stock product for the category in one request.
  // The server (/api/tme/category-all) pages TME until exhausted with no
  // window-slicing and no keyword/mock fallback, so the selection actually
  // matches the category — fixing the old "200 shown, 70 selected" bug where
  // the page-window math under-fetched.
  // Select All, chunked: fetch the category in 10-page windows (~200
  // products per request) instead of one giant crawl. The old single-request
  // version spent 2-3+ minutes of dead air on big categories (77+ sequential
  // TME calls server-side), showed 0% progress the whole time, ignored Cancel
  // until the end, and died on the serverless timeout past ~4k products.
  const SELECT_ALL_CAP = 5000; // safety cap on selected products per run
  const bulkSelectPages = async () => {
    if (!selectedCategory) return;

    const controller = new AbortController();
    setBulkAbortController(controller);
    setBulkLoading(true);
    setBulkProgress(0);

    const newSelected = new Set(selectedProducts);
    const newDetails = new Map(selectedDetails);
    const before = newSelected.size;
    let fetched = 0;
    let total = 0;
    let capped = false;

    try {
      let startPage: number | null = 1;
      while (startPage != null) {
        const params = new URLSearchParams({
          categoryId: selectedCategory,
          startPage: String(startPage),
          pages: "10",
          // The same stock filter the grid uses: "Select whole category" must
          // select exactly what the current view would show, page after page.
          inStockOnly: String(filters.inStockOnly),
        });
        if (filters.search) params.append('search', filters.search);
        if (filters.producer) params.append('producer', filters.producer);

        const response: Response = await fetch(`/api/tme/category-all?${params.toString()}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data: any = await response.json();
        if (controller.signal.aborted) return;

        (data.products || []).forEach((p: TMEProduct) => {
          newSelected.add(p.Symbol);
          newDetails.set(p.Symbol, p);
        });
        fetched += data.fetched || 0;
        total = data.total || total;

        // Live feedback: selection count + progress bar advance per window.
        setSelectedProducts(new Set(newSelected));
        setSelectedDetails(new Map(newDetails));
        setBulkProgress(total > 0 ? Math.min(99, Math.round((fetched / total) * 100)) : 0);

        if (newSelected.size - before >= SELECT_ALL_CAP) { capped = true; break; }
        startPage = data.hasMore ? data.nextPage : null;
      }

      setBulkProgress(100);
      const added = newSelected.size - before;
      toast({
        title: capped ? "Selection capped" : "Bulk selection complete",
        description: capped
          ? `Stopped at the ${SELECT_ALL_CAP.toLocaleString()}-product safety cap — added ${added} (total ${newSelected.size}). Narrow the category or sync this batch first.`
          : `Selected ${added} product(s) — total ${newSelected.size}.`,
      });
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        toast({
          title: "Select All failed",
          description: `${error.message || "TME API may be overloaded"} — ${newSelected.size - before} selected so far are kept.`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Select All cancelled",
          description: `${newSelected.size - before} product(s) selected before cancelling are kept.`,
        });
      }
    } finally {
      setBulkLoading(false);
      setBulkProgress(0);
      setBulkAbortController(null);
    }
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

  // Price filter (Min €/Max €) is enforced client-side against rows whose
  // prices are already loaded. Rows without a loaded price are kept visible
  // so the user knows to click "Load Prices" to actually apply the filter.
  // This costs zero extra TME calls beyond the prices already fetched.
  const priceMinNum = filters.priceMin ? parseFloat(filters.priceMin) : NaN;
  const priceMaxNum = filters.priceMax ? parseFloat(filters.priceMax) : NaN;
  const hasPriceFilter = !Number.isNaN(priceMinNum) || !Number.isNaN(priceMaxNum);
  const inPriceRange = (symbol: string): boolean => {
    if (!hasPriceFilter) return true;
    const enhanced = getEnhancedProductInfo(symbol);
    const price = enhanced?.price?.PriceList?.[0]?.PriceValue;
    if (price == null) return true; // unknown -> keep visible (filter not applied)
    if (!Number.isNaN(priceMinNum) && price < priceMinNum) return false;
    if (!Number.isNaN(priceMaxNum) && price > priceMaxNum) return false;
    return true;
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
    setSyncStats({
      total: selectedProducts.size,
      processed: 0,
      syncedCount: 0,
      updatedCount: 0,
      failedCount: 0,
    });

    try {
      // 1) Create the job (returns immediately, no long request).
      const startRes = await fetch("/api/tme/sync-job-start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productSymbols: Array.from(selectedProducts),
          settings: syncSettings,
        }),
      });
      if (!startRes.ok) {
        const err = await startRes.json().catch(() => ({}));
        throw new Error(err.error || "Failed to start sync");
      }
      const startData = await startRes.json();
      setSyncJobId(startData.jobId);
      applySyncProgress(startData);

      // 2) Drive it to completion with real progress.
      const final = await pumpSyncJob(startData.jobId);
      if (final) {
        finishSync(final);
        if (final.status !== "cancelled") {
          setSelectedProducts(new Set());
          setSelectedDetails(new Map());
        }
      }
    } catch (error) {
      toast({
        title: "Sync failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setIsSyncing(false);
      setSyncJobId(null);
      syncCancelRef.current = false;
    }
  };

  const handleCancelSync = async () => {
    syncCancelRef.current = true;
    if (syncJobId) {
      await fetch("/api/tme/sync-job-cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: syncJobId }),
      }).catch(() => {});
    }
  };

  // Resume an in-progress sync after a page refresh (job state lives server-side).
  useEffect(() => {
    let stop = false;
    (async () => {
      try {
        const res = await fetch("/api/tme/sync-job-active");
        if (!res.ok) return;
        const data = await res.json();
        if (stop || !data.active) return;
        setIsSyncing(true);
        setSyncJobId(data.jobId);
        applySyncProgress(data);
        const final = await pumpSyncJob(data.jobId);
        if (final && !stop) finishSync(final);
      } catch {
        /* no active job / network issue — ignore */
      } finally {
        if (!stop) {
          setIsSyncing(false);
          setSyncJobId(null);
        }
      }
    })();
    return () => {
      stop = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      <Sidebar user={user} collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} />
      <div className={`transition-all duration-200 ${sidebarCollapsed ? 'ml-16' : 'ml-64'}`}>
        <div className="border-b bg-white">
          <div className="px-6 py-3 flex items-center justify-between">
            <div>
              <h1 className="text-lg font-semibold text-gray-900">TME Browser</h1>
            </div>
            <div className="flex items-center gap-2">
              <Card className="p-1.5" data-testid="api-usage-card">
                <div className="flex items-center gap-2 text-[10px]">
                  <div>
                    <span className="text-gray-500">TME calls today: </span>
                    <span className={`font-semibold ${getApiUsageColor()}`}>
                      {apiUsage?.usage?.callsToday ?? 0}
                      {apiUsage?.usage?.dailyLimit ? `/${apiUsage.usage.dailyLimit}` : ""}
                    </span>
                  </div>
                </div>
              </Card>

              <Button
                onClick={() => setShowSyncDialog(true)}
                disabled={selectedProducts.size === 0}
                className="bg-blue-600 hover:bg-blue-700"
                size="sm"
              >
                <Download className="mr-1 h-3 w-3" />
                Sync ({selectedProducts.size})
              </Button>
            </div>
          </div>
        </div>
        <main className="p-4">
          <div className="space-y-6">
            {/* API Status and Sync Button - Moved to Header */}

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
              {/* Category Tree */}
              <Card className="lg:col-span-1">
                <CardHeader className="py-3 px-4">
                  <CardTitle className="text-sm flex items-center justify-between">
                    <div className="flex items-center">
                      <Package className="mr-1.5 h-4 w-4" />
                      Categories
                    </div>
                  </CardTitle>
                  <div className="flex items-center justify-between mt-2">
                    <CardDescription className="text-xs">
                      {categoryTree.length} main categories
                    </CardDescription>
                    <div className="flex items-center gap-1.5">
                      <Checkbox
                        id="hideSynced"
                        checked={hideSyncedCategories}
                        onCheckedChange={(checked) => setHideSyncedCategories(!!checked)}
                        className="h-3.5 w-3.5"
                      />
                      <label htmlFor="hideSynced" className="text-[10px] text-gray-500 cursor-pointer">
                        Hide synced
                      </label>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  <ScrollArea className="h-[calc(100vh-220px)]">
                    {categoriesLoading ? (
                      <div className="space-y-2">
                        {[...Array(10)].map((_, i) => (
                          <div key={i} className="h-8 bg-gray-200 rounded animate-pulse"></div>
                        ))}
                      </div>
                    ) : categoriesError && rawCategories.length === 0 ? (
                      <div className="text-center py-6 space-y-3 px-2" data-testid="categories-error">
                        <AlertCircle className="h-8 w-8 mx-auto text-red-500" />
                        <p className="text-xs text-gray-700 font-medium">
                          Failed to load categories
                        </p>
                        <p className="text-[10px] text-gray-500 break-words">
                          {(categoriesError as Error)?.message || "Network error"}
                        </p>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => refetchCategories()}
                          disabled={categoriesFetching}
                          data-testid="btn-retry-categories"
                        >
                          <RefreshCw className={`h-3 w-3 mr-1 ${categoriesFetching ? "animate-spin" : ""}`} />
                          {categoriesFetching ? "Retrying..." : "Retry"}
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-0.5">
                        {(hideSyncedCategories ? filterSyncedLeaves(categoryTree) : categoryTree)
                          .map((mainCategory: TMECategory) => {
                            const isExpanded = expandedCategories.has(mainCategory.CategoryId);
                            const hasChildren = mainCategory.children && mainCategory.children.length > 0;
                            const isLeaf = !hasChildren;
                            const isSynced = hasSyncedDescendants(mainCategory);
                            
                            return (
                              <div key={mainCategory.CategoryId}>
                                {/* Main Category */}
                                <div
                                  className={`flex items-center justify-between py-2 px-2 rounded cursor-pointer transition-colors ${
                                    selectedCategory === mainCategory.CategoryId 
                                      ? "bg-blue-100 border-l-3 border-blue-500" 
                                      : "hover:bg-gray-100"
                                  } ${isSynced ? "opacity-60" : ""}`}
                                  onClick={() => {
                                    if (isLeaf) {
                                      selectCategory(mainCategory.CategoryId);
                                    } else {
                                      toggleCategoryExpand(mainCategory.CategoryId);
                                    }
                                  }}
                                  data-testid={`category-${mainCategory.CategoryId}`}
                                >
                                  <div className="flex items-center gap-1.5 flex-1 min-w-0">
                                    {hasChildren ? (
                                      isExpanded ? (
                                        <FolderOpen className="h-4 w-4 text-blue-600 flex-shrink-0" />
                                      ) : (
                                        <Folder className="h-4 w-4 text-gray-500 flex-shrink-0" />
                                      )
                                    ) : (
                                      <div className="w-4" />
                                    )}
                                    <span className="text-sm font-medium truncate">{mainCategory.Name}</span>
                                  </div>
                                  <div className="flex items-center gap-1 flex-shrink-0">
                                    {isSynced && (
                                      <CheckCircle2 className="h-3 w-3 text-green-500" />
                                    )}
                                    {mainCategory.ProductCount && mainCategory.ProductCount > 0 && (
                                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                                        {mainCategory.ProductCount.toLocaleString()}
                                      </Badge>
                                    )}
                                    {hasChildren && (
                                      isExpanded ? (
                                        <ChevronDown className="h-4 w-4 text-gray-400" />
                                      ) : (
                                        <ChevronRight className="h-4 w-4 text-gray-400" />
                                      )
                                    )}
                                  </div>
                                </div>
                                
                                {/* Subcategories */}
                                {isExpanded && hasChildren && (
                                  <div className="ml-3 border-l border-gray-200 pl-2 mt-0.5 space-y-0.5">
                                    {mainCategory.children!
                                      .map((subCategory: TMECategory) => {
                                        const subHasChildren = subCategory.children && subCategory.children.length > 0;
                                        const subIsExpanded = expandedCategories.has(subCategory.CategoryId);
                                        const subIsSynced = hasSyncedDescendants(subCategory);
                                        const subIsLeaf = !subHasChildren;
                                        
                                        return (
                                          <div key={subCategory.CategoryId}>
                                            <div
                                              className={`flex items-center justify-between py-1.5 px-2 rounded cursor-pointer transition-colors ${
                                                selectedCategory === subCategory.CategoryId 
                                                  ? "bg-blue-100 border-l-2 border-blue-500" 
                                                  : "hover:bg-gray-50"
                                              } ${subIsSynced ? "opacity-60" : ""}`}
                                              onClick={() => {
                                                if (subIsLeaf) {
                                                  selectCategory(subCategory.CategoryId);
                                                } else {
                                                  toggleCategoryExpand(subCategory.CategoryId);
                                                }
                                              }}
                                              data-testid={`subcategory-${subCategory.CategoryId}`}
                                            >
                                              <div className="flex items-center gap-1 flex-1 min-w-0">
                                                {subHasChildren ? (
                                                  subIsExpanded ? (
                                                    <FolderOpen className="h-3.5 w-3.5 text-blue-500 flex-shrink-0" />
                                                  ) : (
                                                    <Folder className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                                                  )
                                                ) : (
                                                  <div className="w-3.5" />
                                                )}
                                                <span className="text-xs truncate">{subCategory.Name}</span>
                                              </div>
                                              <div className="flex items-center gap-1 flex-shrink-0">
                                                {subIsSynced && (
                                                  <CheckCircle2 className="h-2.5 w-2.5 text-green-500" />
                                                )}
                                                {subCategory.ProductCount && subCategory.ProductCount > 0 && (
                                                  <Badge variant="outline" className="text-[9px] px-1 py-0 h-4">
                                                    {subCategory.ProductCount.toLocaleString()}
                                                  </Badge>
                                                )}
                                                {subHasChildren && (
                                                  subIsExpanded ? (
                                                    <ChevronDown className="h-3 w-3 text-gray-400" />
                                                  ) : (
                                                    <ChevronRight className="h-3 w-3 text-gray-400" />
                                                  )
                                                )}
                                              </div>
                                            </div>
                                            
                                            {/* Level 3 - Deepest subcategories */}
                                            {subIsExpanded && subHasChildren && (
                                              <div className="ml-3 border-l border-gray-100 pl-2 mt-0.5 space-y-0.5">
                                                {subCategory.children!
                                                  .map((deepCategory: TMECategory) => {
                                                    const deepIsSynced = isCategoryDirectlySynced(deepCategory);
                                                    
                                                    return (
                                                      <div
                                                        key={deepCategory.CategoryId}
                                                        className={`flex items-center justify-between py-1 px-2 rounded cursor-pointer transition-colors ${
                                                          selectedCategory === deepCategory.CategoryId 
                                                            ? "bg-blue-100 border-l-2 border-blue-500" 
                                                            : "hover:bg-gray-50"
                                                        } ${deepIsSynced ? "opacity-60" : ""}`}
                                                        onClick={() => selectCategory(deepCategory.CategoryId)}
                                                        data-testid={`deep-category-${deepCategory.CategoryId}`}
                                                      >
                                                        <span className="text-[11px] truncate flex-1">{deepCategory.Name}</span>
                                                        <div className="flex items-center gap-1 flex-shrink-0">
                                                          {deepIsSynced && (
                                                            <CheckCircle2 className="h-2.5 w-2.5 text-green-500" />
                                                          )}
                                                          {deepCategory.ProductCount && deepCategory.ProductCount > 0 && (
                                                            <Badge variant="outline" className="text-[8px] px-1 py-0 h-3.5">
                                                              {deepCategory.ProductCount.toLocaleString()}
                                                            </Badge>
                                                          )}
                                                        </div>
                                                      </div>
                                                    );
                                                  })}
                                              </div>
                                            )}
                                          </div>
                                        );
                                      })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                      </div>
                    )}
                  </ScrollArea>
                </CardContent>
              </Card>

              {/* Products Grid */}
              <div className="lg:col-span-3 space-y-3">
                {/* Filters */}
                <Card>
                  <CardHeader className="py-2.5 px-4">
                    <CardTitle className="text-sm flex items-center">
                      <Filter className="mr-1.5 h-4 w-4" />
                      Filters & Controls
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-3">
                    <div className="space-y-2">
                      {/* Search and Price Filters */}
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                        <Input
                          placeholder="Search products..."
                          value={filters.search}
                          onChange={(e) => setFilters(prev => ({ ...prev, search: e.target.value }))}
                          className="h-9"
                        />
                        <Input
                          placeholder="Min price €"
                          type="number"
                          value={filters.priceMin}
                          onChange={(e) => setFilters(prev => ({ ...prev, priceMin: e.target.value }))}
                          className="h-9"
                        />
                        <Input
                          placeholder="Max price €"
                          type="number"
                          value={filters.priceMax}
                          onChange={(e) => setFilters(prev => ({ ...prev, priceMax: e.target.value }))}
                          className="h-9"
                        />
                        <Input
                          placeholder="Producer"
                          value={filters.producer}
                          onChange={(e) => setFilters(prev => ({ ...prev, producer: e.target.value }))}
                          className="h-9"
                        />
                      </div>

                      {/* Selection Controls - All in one row */}
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-3">
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

                          {/* Bulk Selection in same row */}
                          {selectedCategory && (
                            <div className="flex items-center gap-2 border-l pl-3">
                              {/* Exactly two choices, each naming what it
                                  selects: this page, or the whole category.
                                  The stock filter above governs both, so the
                                  buttons never need to restate it. */}
                              <Button
                                onClick={selectAllOnPage}
                                variant="outline"
                                size="sm"
                                disabled={visibleProducts.length === 0}
                                data-testid="btn-select-page"
                              >
                                Select this page ({visibleProducts.length})
                              </Button>
                              <Button
                                onClick={() => bulkSelectPages()}
                                variant="outline"
                                size="sm"
                                disabled={bulkLoading || totalProducts < 1}
                                data-testid="btn-select-all-category"
                              >
                                {bulkLoading
                                  ? `Selecting… ${selectedProducts.size.toLocaleString()}`
                                  : "Select whole category"}
                              </Button>
                            </div>
                          )}
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

                      {/* Bulk Loading Progress */}
                      {bulkLoading && (
                        <div className="flex items-center gap-2 pt-2">
                          <Progress value={bulkProgress} className="flex-1 h-2" />
                          <Button
                            onClick={cancelBulkSelection}
                            variant="destructive"
                            size="sm"
                            data-testid="btn-cancel-bulk"
                          >
                            Cancel
                          </Button>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* Products */}
                {selectedCategory ? (
                  <Card className="flex-1">
                    <CardHeader className="py-2.5 px-4">
                      <div className="flex items-center justify-between">
                        {/* One short line. `total` is TME's CATEGORY size and
                            is NOT stock-filtered, so it is only ever shown as
                            "in category" — never as an in-stock figure, which
                            is what previously made the counts contradict each
                            other. */}
                        <CardTitle className="text-base font-semibold">
                          {visibleProducts.length.toLocaleString()} products
                          <span className="ml-2 text-sm font-normal text-gray-500">
                            {filters.inStockOnly ? "in stock · " : ""}
                            {totalProducts.toLocaleString()} in category
                          </span>
                        </CardTitle>
                        <div className="flex items-center gap-2">
                          <Button
                            onClick={manualLoadEnhanced}
                            disabled={loadingEnhanced || products.length === 0}
                            variant="outline"
                            size="sm"
                            data-testid="btn-load-prices"
                          >
                            {loadingEnhanced ? (
                              <>
                                <RefreshCw className="mr-1 h-3 w-3 animate-spin" />
                                Loading...
                              </>
                            ) : (
                              <>
                                <TrendingUp className="mr-1 h-3 w-3" />
                                Load Prices
                              </>
                            )}
                          </Button>
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
                    <CardContent className="px-4 pb-4">
                      <ScrollArea className="h-[calc(100vh-320px)]">
                      {productsLoading ? (
                        <div className="space-y-3">
                          {[...Array(5)].map((_, i) => (
                            <div key={i} className="h-20 bg-gray-200 rounded animate-pulse"></div>
                          ))}
                        </div>
                      ) : visibleProducts.length === 0 ? (
                        <div className="text-center py-8">
                          <Package className="h-10 w-10 mx-auto mb-3 text-gray-400" />
                          <p className="text-sm text-gray-500">
                            {products.length > 0 && hideSyncedCategories
                              ? "All products on this page are already synced. Untick \"Hide synced\" to see them."
                              : "No products found"}
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          {hasPriceFilter && enhancedProducts.length === 0 && (
                            <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 flex items-center gap-2">
                              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                              Price filter is set, but prices aren't loaded yet. Click <strong>Load Prices</strong> to apply it.
                            </div>
                          )}
                          {visibleProducts.filter((product: TMEProduct) => inPriceRange(product.Symbol)).map((product: TMEProduct) => {
                            const enhanced = getEnhancedProductInfo(product.Symbol);
                            const thumbnail = getProductThumbnail(product);
                            
                            // Debug logging
                            if (product.Symbol === products[0]?.Symbol) {
                              console.log('Debug - First product enhanced data:', enhanced);
                              console.log('Debug - Enhanced stock:', enhanced?.stock);
                              console.log('Debug - Enhanced price:', enhanced?.price);
                            }

                            return (
                              <div
                                key={product.Symbol}
                                className={`border rounded p-2.5 flex items-center space-x-3 hover:bg-gray-50 ${
                                  selectedProducts.has(product.Symbol) ? "ring-1 ring-blue-500 bg-blue-50" : ""
                                }`}
                              >
                                <Checkbox
                                  checked={selectedProducts.has(product.Symbol)}
                                  onCheckedChange={() => toggleProductSelection(product.Symbol)}
                                />

                                <div className="flex-shrink-0 w-12 h-12 bg-gray-100 rounded flex items-center justify-center border">
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
                                      <p className="text-xs font-medium text-gray-900 truncate">
                                        {product.Symbol}
                                      </p>
                                      <p className="text-xs text-gray-600 line-clamp-1">
                                        {product.Description}
                                      </p>
                                      <div className="mt-0.5 flex items-center flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-gray-500">
                                        <span>Producer: {product.Producer}</span>
                                        {/* Stock/price come inline with the row on TME API v2; the
                                            "Load Prices" fetch is the v1 fallback. Prefer whichever
                                            is present so the grid stops showing "Unknown". */}
                                        {(() => {
                                          const stock = enhanced?.stock?.Amount ?? (typeof (product as any).Amount === "number" ? (product as any).Amount : undefined);
                                          const price = enhanced?.price?.PriceList?.[0]?.PriceValue ?? (product as any).PriceList?.[0]?.PriceValue;
                                          return (
                                            <>
                                              {stock !== undefined ? (
                                                <span className={stock > 0 ? "text-green-600" : "text-red-600"}>
                                                  Stock: {stock.toLocaleString()} {enhanced?.stock?.Unit || 'pcs'}
                                                </span>
                                              ) : loadingEnhanced ? (
                                                <span className="text-gray-400">Loading stock...</span>
                                              ) : (
                                                <span className="text-gray-400">Stock: Unknown</span>
                                              )}
                                              {price != null ? (
                                                <span className="text-blue-600">Price: €{Number(price).toFixed(2)}</span>
                                              ) : loadingEnhanced ? (
                                                <span className="text-gray-400">Loading price...</span>
                                              ) : (
                                                <span className="text-gray-400">Price: Unknown</span>
                                              )}
                                            </>
                                          );
                                        })()}
                                        {/* MOQ Badge - displays minimum order quantity */}
                                        {product.MinAmount && product.MinAmount > 1 && (
                                          <Badge variant="outline" className="px-1.5 py-0 text-[9px] bg-purple-50 text-purple-700 border-purple-200">
                                            Min: {product.MinAmount} pcs
                                          </Badge>
                                        )}
                                        {/* Multiples Badge - displays order multiples */}
                                        {product.Multiples && product.Multiples > 1 && product.Multiples !== product.MinAmount && (
                                          <Badge variant="outline" className="px-1.5 py-0 text-[9px] bg-indigo-50 text-indigo-700 border-indigo-200">
                                            ×{product.Multiples}
                                          </Badge>
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
                      </ScrollArea>
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
                        {/* Cap the rendered rows — a 1,500+ selection made this
                            dialog crawl, and every row beyond the viewport is
                            identical anyway. All selected products sync
                            regardless of what's rendered here. */}
                        {Array.from(selectedProducts).slice(0, 100).map(symbol => {
                          // Prefer the remembered detail (covers items selected
                          // in other categories/pages); fall back to the current
                          // grid for the freshest copy.
                          const product = selectedDetails.get(symbol)
                            || products.find((p: TMEProduct) => p.Symbol === symbol);
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
                                {enhanced?.price && enhanced.price.PriceList && enhanced.price.PriceList.length > 0 && enhanced.price.PriceList[0].PriceValue && (
                                  <div className="text-sm font-medium">
                                    €{enhanced.price.PriceList[0].PriceValue.toFixed(2)}
                                  </div>
                                )}
                                {enhanced?.stock && enhanced.stock.Amount !== undefined && (
                                  <div className="text-xs text-gray-600">
                                    Stock: {enhanced.stock.Amount}
                                  </div>
                                )}
                                {!enhanced && (
                                  /* Honest label: nothing is "loading" here —
                                     price/stock appear only after "Load
                                     Prices", and the sync fetches fresh
                                     price/stock for every product anyway. */
                                  <div className="text-xs text-gray-400">price &amp; stock fetched at sync</div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                        {selectedProducts.size > 100 && (
                          <div className="rounded border border-dashed p-3 text-center text-sm text-gray-500">
                            …and {(selectedProducts.size - 100).toLocaleString()} more selected — all{" "}
                            {selectedProducts.size.toLocaleString()} will be synced.
                          </div>
                        )}
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
                  <Button variant="outline" onClick={() => setShowSyncDialog(false)} disabled={isSyncing}>
                    Close
                  </Button>
                  {isSyncing ? (
                    <Button variant="destructive" onClick={handleCancelSync} disabled={syncCancelRef.current}>
                      Cancel sync
                    </Button>
                  ) : (
                    <Button onClick={handleSync}>
                      <Download className="mr-2 h-4 w-4" />
                      Sync {selectedProducts.size} Products
                    </Button>
                  )}
                </div>

                {isSyncing && (
                  <div className="space-y-3">
                    <Progress value={syncProgress} className="w-full" />
                    <p className="text-sm text-center text-gray-600">
                      Syncing {syncStats.processed} of {syncStats.total} products... {syncProgress}%
                    </p>
                    <div className="flex flex-wrap justify-center gap-2 text-xs">
                      <div className="px-2 py-1 rounded bg-green-100 text-green-700">
                        {syncStats.syncedCount} new
                      </div>
                      <div className="px-2 py-1 rounded bg-blue-100 text-blue-700">
                        {syncStats.updatedCount} updated
                      </div>
                      {syncStats.failedCount > 0 && (
                        <div className="px-2 py-1 rounded bg-red-100 text-red-700">
                          {syncStats.failedCount} failed
                        </div>
                      )}
                      <div className="px-2 py-1 rounded bg-gray-100 text-gray-700">
                        TME calls today: {apiUsage?.usage?.callsToday ?? 0}
                        {apiUsage?.usage?.dailyLimit ? `/${apiUsage.usage.dailyLimit}` : ""}
                      </div>
                    </div>
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
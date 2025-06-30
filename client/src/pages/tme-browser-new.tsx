import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  ChevronRight, ChevronDown, Package, Search, Filter, 
  Download, CheckCircle, XCircle, AlertTriangle, Info,
  ShoppingCart, Eye, ArrowRight, ChevronLeft, MoreHorizontal
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

interface TMECategory {
  CategoryId: number;
  Name: string;
  NameEn: string;
  ParentId: number;
  Level: number;
  ProductsCount: number;
  Subcategories?: TMECategory[];
}

interface TMEProduct {
  Symbol: string;
  Description: string;
  Producer: string;
  Category: string;
  CategoryId: number;
  Photo: string;
  ProductInformationPage: string;
  EAN: string;
}

interface TMEBrowserProps {
  user: any;
}

export function TMEBrowserNew({ user }: TMEBrowserProps) {
  const { toast } = useToast();
  const [selectedCategory, setSelectedCategory] = useState<TMECategory | null>(null);
  const [productSearchTerm, setProductSearchTerm] = useState("");
  const [categorySearchTerm, setCategorySearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());
  const [syncLoading, setSyncLoading] = useState(false);
  const productsPerPage = 50;

  const { data: categoriesData, isLoading: categoriesLoading } = useQuery({
    queryKey: ["/api/tme/categories"],
    staleTime: 300000, // 5 minutes
  });

  const { data: productsData, isLoading: productsLoading } = useQuery({
    queryKey: [`/api/tme/categories/${selectedCategory?.CategoryId}/products?page=${currentPage}&limit=${productsPerPage}`],
    enabled: !!selectedCategory,
    staleTime: 60000, // 1 minute
  });

  // Filter categories based on search term
  const filteredCategories = categoriesData?.categories?.filter((category: TMECategory) => {
    if (!categorySearchTerm) return true;
    const searchLower = categorySearchTerm.toLowerCase();
    return (
      category.Name.toLowerCase().includes(searchLower) ||
      category.NameEn.toLowerCase().includes(searchLower)
    );
  }) || [];

  // Filter products based on search term
  const filteredProducts = productsData?.products?.filter((product: TMEProduct) => {
    if (!productSearchTerm) return true;
    const searchLower = productSearchTerm.toLowerCase();
    return (
      product.Description.toLowerCase().includes(searchLower) ||
      product.Producer.toLowerCase().includes(searchLower) ||
      product.Symbol.toLowerCase().includes(searchLower) ||
      product.Category.toLowerCase().includes(searchLower)
    );
  }) || [];

  // Reset page when category changes
  useEffect(() => {
    setCurrentPage(1);
    setProductSearchTerm("");
  }, [selectedCategory]);

  const handleProductSelection = (symbol: string) => {
    const newSelected = new Set(selectedProducts);
    if (newSelected.has(symbol)) {
      newSelected.delete(symbol);
    } else {
      newSelected.add(symbol);
    }
    setSelectedProducts(newSelected);
  };

  const handleSelectAll = () => {
    if (selectedProducts.size === filteredProducts.length) {
      setSelectedProducts(new Set());
    } else {
      setSelectedProducts(new Set(filteredProducts.map(p => p.Symbol)));
    }
  };

  const handleSyncSelected = async () => {
    if (selectedProducts.size === 0) {
      toast({
        title: "No Products Selected",
        description: "Please select products to sync.",
        variant: "destructive",
      });
      return;
    }

    setSyncLoading(true);
    try {
      // Get selected products data
      const selectedProductsData = filteredProducts.filter(product => 
        selectedProducts.has(product.Symbol)
      );
      
      toast({
        title: "Sync Started",
        description: `Syncing ${selectedProducts.size} products...`,
      });

      // Call the backend sync endpoint
      const response = await fetch('/api/tme/sync-selected', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          symbols: Array.from(selectedProducts)
        }),
      });

      const result = await response.json();

      if (result.success) {
        toast({
          title: "Sync Completed",
          description: `Successfully synced ${result.productsAdded || selectedProducts.size} products to your inventory.`,
        });
        
        // Reset selections after successful sync
        setSelectedProducts(new Set());
      } else {
        throw new Error(result.message || 'Sync failed');
      }
      
    } catch (error) {
      console.error('Sync error:', error);
      toast({
        title: "Sync Failed",
        description: error instanceof Error ? error.message : "Failed to sync selected products.",
        variant: "destructive",
      });
    } finally {
      setSyncLoading(false);
    }
  };

  const renderCategory = (category: TMECategory) => (
    <div
      key={category.CategoryId}
      className={`p-3 rounded cursor-pointer transition-colors ${
        selectedCategory?.CategoryId === category.CategoryId
          ? "bg-blue-50 border-blue-200 border"
          : "hover:bg-gray-50"
      }`}
      onClick={() => setSelectedCategory(category)}
    >
      <div className="flex items-center justify-between">
        <div>
          <h4 className="font-medium text-sm">{category.NameEn || category.Name}</h4>
          <p className="text-xs text-gray-500">{category.ProductsCount.toLocaleString()} products</p>
        </div>
        <ChevronRight className="w-4 h-4 text-gray-400" />
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <Header title="TME Product Browser" />
      <div className="flex">
        <Sidebar />
        <main className="flex-1 p-6 ml-64 mt-16">
          <div className="max-w-7xl mx-auto">
            <div className="mb-6">
              <h1 className="text-3xl font-bold text-gray-900">TME Product Browser</h1>
              <p className="text-gray-600 mt-2">Browse and sync products from TME Electronics catalog</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
              {/* Categories Sidebar */}
              <div className="lg:col-span-1">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg">Categories</CardTitle>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                      <Input
                        placeholder="Search categories..."
                        value={categorySearchTerm}
                        onChange={(e) => setCategorySearchTerm(e.target.value)}
                        className="pl-10"
                      />
                    </div>
                  </CardHeader>
                  <CardContent className="p-0">
                    <ScrollArea className="h-[600px]">
                      <div className="p-3 space-y-2">
                        {categoriesLoading ? (
                          <div className="text-center py-8 text-gray-500">Loading categories...</div>
                        ) : (
                          filteredCategories.map((category: TMECategory) => renderCategory(category))
                        )}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>
              </div>

              {/* Products Main Area */}
              <div className="lg:col-span-3">
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-xl">
                          {selectedCategory ? (
                            `${selectedCategory.NameEn || selectedCategory.Name}`
                          ) : (
                            "Select a category to view products"
                          )}
                        </CardTitle>
                        {selectedCategory && (
                          <p className="text-gray-600 mt-1">
                            {selectedCategory.ProductsCount.toLocaleString()} total products
                          </p>
                        )}
                      </div>
                      
                      {selectedCategory && (
                        <div className="flex items-center space-x-4">
                          <div className="relative">
                            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                            <Input
                              placeholder="Search products..."
                              value={productSearchTerm}
                              onChange={(e) => setProductSearchTerm(e.target.value)}
                              className="pl-10 w-64"
                            />
                          </div>
                          
                          {selectedProducts.size > 0 && (
                            <Button 
                              onClick={handleSyncSelected}
                              disabled={syncLoading}
                              className="flex items-center space-x-2"
                            >
                              <Download className="w-4 h-4" />
                              <span>Sync {selectedProducts.size} Products</span>
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  </CardHeader>
                  
                  <CardContent>
                    {!selectedCategory ? (
                      <div className="text-center py-12">
                        <Package className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                        <h3 className="text-lg font-medium text-gray-900 mb-2">No Category Selected</h3>
                        <p className="text-gray-600">Choose a category from the sidebar to browse products</p>
                      </div>
                    ) : productsLoading ? (
                      <div className="text-center py-12">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
                        <p className="text-gray-600">Loading products...</p>
                      </div>
                    ) : filteredProducts.length === 0 ? (
                      <div className="text-center py-12">
                        <Package className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                        <h3 className="text-lg font-medium text-gray-900 mb-2">No Products Found</h3>
                        <p className="text-gray-600">
                          {productSearchTerm 
                            ? `No products match "${productSearchTerm}"`
                            : "This category has no products available"
                          }
                        </p>
                      </div>
                    ) : (
                      <>
                        {/* Products Table */}
                        <div className="rounded-lg border overflow-hidden">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="w-12">
                                  <input
                                    type="checkbox"
                                    checked={selectedProducts.size === filteredProducts.length && filteredProducts.length > 0}
                                    onChange={handleSelectAll}
                                    className="rounded"
                                  />
                                </TableHead>
                                <TableHead className="w-20">Image</TableHead>
                                <TableHead>Product</TableHead>
                                <TableHead>Producer</TableHead>
                                <TableHead>SKU</TableHead>
                                <TableHead>Category</TableHead>
                                <TableHead className="w-24">Actions</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {filteredProducts.map((product: TMEProduct) => (
                                <TableRow key={product.Symbol} className="group">
                                  <TableCell>
                                    <input
                                      type="checkbox"
                                      checked={selectedProducts.has(product.Symbol)}
                                      onChange={() => handleProductSelection(product.Symbol)}
                                      className="rounded"
                                    />
                                  </TableCell>
                                  <TableCell>
                                    {product.Photo && (
                                      <img 
                                        src={product.Photo.replace(/^\/\//, 'https://')} 
                                        alt={product.Description}
                                        className="w-12 h-12 object-cover rounded border"
                                        onError={(e) => { 
                                          e.currentTarget.style.display = 'none'; 
                                        }}
                                      />
                                    )}
                                  </TableCell>
                                  <TableCell>
                                    <div>
                                      <p className="font-medium text-sm">{product.Description}</p>
                                      {product.EAN && (
                                        <p className="text-xs text-gray-500">EAN: {product.EAN}</p>
                                      )}
                                    </div>
                                  </TableCell>
                                  <TableCell>
                                    <span className="text-sm font-medium">{product.Producer}</span>
                                  </TableCell>
                                  <TableCell>
                                    <code className="text-xs bg-gray-100 px-2 py-1 rounded">{product.Symbol}</code>
                                  </TableCell>
                                  <TableCell>
                                    <span className="text-xs text-gray-600">{product.Category}</span>
                                  </TableCell>
                                  <TableCell>
                                    <div className="flex items-center space-x-2">
                                      <Button size="sm" variant="outline" className="h-8 w-8 p-0">
                                        <Eye className="w-3 h-3" />
                                      </Button>
                                      <Button size="sm" variant="outline" className="h-8 w-8 p-0">
                                        <Download className="w-3 h-3" />
                                      </Button>
                                    </div>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>

                        {/* Pagination Controls */}
                        <div className="flex items-center justify-between mt-6">
                          <div className="text-sm text-gray-700">
                            Showing {((currentPage - 1) * productsPerPage) + 1} to {Math.min(currentPage * productsPerPage, productsData?.totalProducts || filteredProducts.length)} of {productsData?.totalProducts || filteredProducts.length} products
                            {productSearchTerm && (
                              <span className="text-blue-600 ml-2">
                                (filtered from {productsData?.totalProducts || 0} total)
                              </span>
                            )}
                          </div>
                          <div className="flex items-center space-x-2">
                            <span className="text-sm text-gray-500">
                              Page {currentPage} of {productsData?.totalPages || 1}
                            </span>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                              disabled={currentPage === 1}
                            >
                              <ChevronLeft className="w-4 h-4" />
                              Previous
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setCurrentPage(currentPage + 1)}
                              disabled={!productsData?.hasMore}
                            >
                              Next
                              <ChevronRight className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
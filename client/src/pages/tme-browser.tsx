import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  ChevronRight, ChevronDown, Package, Search, Filter, 
  Download, CheckCircle, XCircle, AlertTriangle, Info,
  ShoppingCart, Eye, ArrowRight
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

export function TMEBrowser({ user }: TMEBrowserProps) {
  const { toast } = useToast();
  const [expandedCategories, setExpandedCategories] = useState<Set<number>>(new Set());
  const [selectedCategory, setSelectedCategory] = useState<TMECategory | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategories, setSelectedCategories] = useState<Set<number>>(new Set());

  const { data: categoriesData, isLoading: categoriesLoading } = useQuery({
    queryKey: ["/api/tme/categories"],
    staleTime: 300000, // 5 minutes
  });

  const { data: productsData, isLoading: productsLoading } = useQuery({
    queryKey: ["/api/tme/categories", selectedCategory?.CategoryId, "products"],
    enabled: !!selectedCategory,
    staleTime: 60000, // 1 minute
  });

  const toggleCategory = (categoryId: number) => {
    const newExpanded = new Set(expandedCategories);
    if (newExpanded.has(categoryId)) {
      newExpanded.delete(categoryId);
    } else {
      newExpanded.add(categoryId);
    }
    setExpandedCategories(newExpanded);
  };

  const toggleCategorySelection = (categoryId: number) => {
    const newSelected = new Set(selectedCategories);
    if (newSelected.has(categoryId)) {
      newSelected.delete(categoryId);
    } else {
      newSelected.add(categoryId);
    }
    setSelectedCategories(newSelected);
  };

  const renderCategory = (category: TMECategory, level: number = 0) => {
    const hasSubcategories = category.Subcategories && category.Subcategories.length > 0;
    const isExpanded = expandedCategories.has(category.CategoryId);
    const isSelected = selectedCategories.has(category.CategoryId);
    const matchesSearch = searchTerm === "" || 
      category.Name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      category.NameEn.toLowerCase().includes(searchTerm.toLowerCase());

    if (!matchesSearch && level === 0) return null;

    return (
      <div key={category.CategoryId} className={`ml-${level * 4}`}>
        <div className="flex items-center space-x-2 py-1 hover:bg-gray-50 rounded px-2">
          {hasSubcategories && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => toggleCategory(category.CategoryId)}
              className="p-0 h-6 w-6"
            >
              {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </Button>
          )}
          
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => toggleCategorySelection(category.CategoryId)}
            className="h-4 w-4"
          />
          
          <div 
            className="flex-1 flex items-center justify-between cursor-pointer"
            onClick={() => setSelectedCategory(category)}
          >
            <div className="flex items-center space-x-2">
              <Package className="w-4 h-4 text-gray-400" />
              <span className="text-sm font-medium">{category.NameEn || category.Name}</span>
              <Badge variant="secondary" className="text-xs">
                {category.ProductsCount.toLocaleString()}
              </Badge>
            </div>
            
            {selectedCategory?.CategoryId === category.CategoryId && (
              <Eye className="w-4 h-4 text-blue-500" />
            )}
          </div>
        </div>

        {hasSubcategories && isExpanded && (
          <div className="ml-6">
            {category.Subcategories!.map(subcat => renderCategory(subcat, level + 1))}
          </div>
        )}
      </div>
    );
  };

  const getRecommendedCategories = () => {
    if (!categoriesData?.categories) return [];
    
    const recommended = [];
    const allCategories = flattenCategories(categoriesData.categories);
    
    // Look for categories likely to contain suitable products
    const keywords = [
      'semiconductor', 'resistor', 'capacitor', 'inductor', 'diode', 'transistor',
      'connector', 'switch', 'sensor', 'display', 'led', 'microcontroller',
      'arduino', 'raspberry', 'development', 'module', 'board'
    ];
    
    keywords.forEach(keyword => {
      const matches = allCategories.filter(cat => 
        cat.NameEn.toLowerCase().includes(keyword) || 
        cat.Name.toLowerCase().includes(keyword)
      );
      recommended.push(...matches);
    });
    
    // Remove duplicates and sort by product count
    const unique = Array.from(new Map(recommended.map(cat => [cat.CategoryId, cat])).values());
    return unique.sort((a, b) => b.ProductsCount - a.ProductsCount).slice(0, 20);
  };

  const getUnsuitableCategories = () => {
    if (!categoriesData?.categories) return [];
    
    const unsuitable = [];
    const allCategories = flattenCategories(categoriesData.categories);
    
    // Categories likely to contain heavy, liquid, or unsuitable products
    const unsuitableKeywords = [
      'motor', 'pump', 'compressor', 'generator', 'transformer', 'power supply',
      'battery', 'accumulator', 'charger', 'inverter', 'chemical', 'liquid',
      'adhesive', 'solder paste', 'flux', 'cleaner', 'cabinet', 'enclosure',
      'rack', 'chassis', 'heat sink', 'cooling', 'fan', 'radiator'
    ];
    
    unsuitableKeywords.forEach(keyword => {
      const matches = allCategories.filter(cat => 
        cat.NameEn.toLowerCase().includes(keyword) || 
        cat.Name.toLowerCase().includes(keyword)
      );
      unsuitable.push(...matches);
    });
    
    return Array.from(new Map(unsuitable.map(cat => [cat.CategoryId, cat])).values());
  };

  const flattenCategories = (categories: TMECategory[]): TMECategory[] => {
    let flattened: TMECategory[] = [];
    categories.forEach(cat => {
      flattened.push(cat);
      if (cat.Subcategories) {
        flattened.push(...flattenCategories(cat.Subcategories));
      }
    });
    return flattened;
  };

  const handleSyncSelectedCategories = () => {
    if (selectedCategories.size === 0) {
      toast({
        title: "No Categories Selected",
        description: "Please select at least one category to sync.",
        variant: "destructive"
      });
      return;
    }

    toast({
      title: "Category Sync Started",
      description: `Starting sync for ${selectedCategories.size} selected categories...`,
    });
    
    // TODO: Implement category-based sync
    console.log("Selected categories for sync:", Array.from(selectedCategories));
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar user={user} />
      <div className="ml-64">
        <Header 
          title="TME Category Browser" 
          subtitle="Explore TME product catalog and select categories for sync"
        />
        
        <div className="p-6">
          <Tabs defaultValue="browse" className="space-y-6">
            <TabsList>
              <TabsTrigger value="browse">Browse Categories</TabsTrigger>
              <TabsTrigger value="recommended">Recommended</TabsTrigger>
              <TabsTrigger value="avoid">Categories to Avoid</TabsTrigger>
            </TabsList>

            <TabsContent value="browse" className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Category Tree */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between">
                      <span>TME Categories ({categoriesData?.totalCategories || 0})</span>
                      <div className="flex items-center space-x-2">
                        <div className="relative">
                          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                          <Input
                            placeholder="Search categories..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="pl-10 w-64"
                          />
                        </div>
                      </div>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {categoriesLoading ? (
                      <div className="text-center py-8">Loading categories...</div>
                    ) : (
                      <ScrollArea className="h-96">
                        <div className="space-y-1">
                          {categoriesData?.categories?.map((category: TMECategory) => 
                            renderCategory(category)
                          )}
                        </div>
                      </ScrollArea>
                    )}
                  </CardContent>
                </Card>

                {/* Product Preview */}
                <Card>
                  <CardHeader>
                    <CardTitle>
                      {selectedCategory ? (
                        <span>Products in: {selectedCategory.NameEn || selectedCategory.Name}</span>
                      ) : (
                        <span>Select a category to preview products</span>
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {selectedCategory ? (
                      productsLoading ? (
                        <div className="text-center py-8">Loading products...</div>
                      ) : (
                        <ScrollArea className="h-96">
                          <div className="space-y-3">
                            {productsData?.products?.map((product: TMEProduct) => (
                              <div key={product.Symbol} className="border rounded p-3 hover:bg-gray-50">
                                <div className="flex items-start space-x-3">
                                  {product.Photo && (
                                    <img 
                                      src={product.Photo.replace(/^\/\//, 'https://')} 
                                      alt={product.Description}
                                      className="w-12 h-12 object-cover rounded"
                                      onError={(e) => { e.currentTarget.style.display = 'none'; }}
                                    />
                                  )}
                                  <div className="flex-1 min-w-0">
                                    <h4 className="text-sm font-medium truncate">{product.Description}</h4>
                                    <p className="text-xs text-gray-500">{product.Producer}</p>
                                    <p className="text-xs text-gray-400">SKU: {product.Symbol}</p>
                                    {product.EAN && (
                                      <p className="text-xs text-gray-400">EAN: {product.EAN}</p>
                                    )}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </ScrollArea>
                      )
                    ) : (
                      <div className="text-center py-8 text-gray-500">
                        <Package className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                        <p>Click on a category to preview its products</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Selected Categories Actions */}
              {selectedCategories.size > 0 && (
                <Card>
                  <CardContent className="py-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-medium">{selectedCategories.size} categories selected for sync</span>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedCategories(new Set())}
                          className="ml-4"
                        >
                          Clear All
                        </Button>
                      </div>
                      <Button onClick={handleSyncSelectedCategories} className="flex items-center space-x-2">
                        <Download className="w-4 h-4" />
                        <span>Sync Selected Categories</span>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="recommended" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center space-x-2">
                    <CheckCircle className="w-5 h-5 text-green-500" />
                    <span>Recommended Categories for E-commerce</span>
                  </CardTitle>
                  <p className="text-sm text-gray-600">
                    Categories containing lightweight electronic components suitable for online sales
                  </p>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {getRecommendedCategories().map((category) => (
                      <div key={category.CategoryId} className="border rounded p-4 hover:bg-green-50">
                        <div className="flex items-center justify-between mb-2">
                          <h3 className="font-medium text-sm">{category.NameEn || category.Name}</h3>
                          <Badge variant="secondary">{category.ProductsCount.toLocaleString()}</Badge>
                        </div>
                        <div className="flex items-center justify-between">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => toggleCategorySelection(category.CategoryId)}
                            className={selectedCategories.has(category.CategoryId) ? "bg-green-100" : ""}
                          >
                            {selectedCategories.has(category.CategoryId) ? "Selected" : "Select"}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setSelectedCategory(category)}
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="avoid" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center space-x-2">
                    <XCircle className="w-5 h-5 text-red-500" />
                    <span>Categories to Avoid</span>
                  </CardTitle>
                  <p className="text-sm text-gray-600">
                    Categories likely containing heavy items, liquids, or products unsuitable for e-commerce
                  </p>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {getUnsuitableCategories().map((category) => (
                      <div key={category.CategoryId} className="border rounded p-4 bg-red-50">
                        <div className="flex items-center justify-between mb-2">
                          <h3 className="font-medium text-sm">{category.NameEn || category.Name}</h3>
                          <Badge variant="destructive">{category.ProductsCount.toLocaleString()}</Badge>
                        </div>
                        <div className="flex items-center space-x-2 text-xs text-red-600">
                          <AlertTriangle className="w-4 h-4" />
                          <span>Contains heavy/liquid products</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
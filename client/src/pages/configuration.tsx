import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Sidebar } from "@/components/layout/sidebar";
import { 
  Package, 
  Truck, 
  Weight, 
  CheckCircle, 
  AlertCircle, 
  Calculator,
  FolderTree,
  Plus,
  Edit,
  Trash2,
  DollarSign
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

interface User {
  username: string;
  role: string;
}

interface ConfigurationProps {
  user: User;
}

export default function Configuration({ user }: ConfigurationProps) {
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryDescription, setNewCategoryDescription] = useState("");
  const [newCategoryEbayMapping, setNewCategoryEbayMapping] = useState("");
  const [editingCategory, setEditingCategory] = useState<any>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Fetch shipping policies
  const { data: policiesData, isLoading: policiesLoading } = useQuery({
    queryKey: ["/api/shipping/policies"],
  });

  // Fetch policy assignments
  const { data: assignmentsData, isLoading: assignmentsLoading } = useQuery({
    queryKey: ["/api/shipping/assignments"],
  });

  // Fetch categories
  const { data: categoriesData, isLoading: categoriesLoading } = useQuery({
    queryKey: ["/api/categories"],
  });

  // Fetch pricing tiers
  const { data: pricingData, isLoading: pricingLoading } = useQuery({
    queryKey: ["/api/pricing/tiers"],
  });

  const policies = policiesData?.policies || [];
  const assignments = assignmentsData?.assignments || [];
  const validation = policiesData?.validation;
  const categories = Array.isArray(categoriesData) ? categoriesData : [];
  const pricingTiers = pricingData?.tiers || [];

  const isLoading = policiesLoading || assignmentsLoading || categoriesLoading || pricingLoading;

  // Mutations for categories
  const createCategoryMutation = useMutation({
    mutationFn: async (data: any) => {
      const response = await fetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error("Failed to create category");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/categories"] });
      setIsCreateDialogOpen(false);
      setNewCategoryName("");
      setNewCategoryDescription("");
      setNewCategoryEbayMapping("");
      toast({ title: "Category created successfully" });
    },
  });

  const updateCategoryMutation = useMutation({
    mutationFn: async ({ id, ...data }: any) => {
      const response = await fetch(`/api/categories/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error("Failed to update category");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/categories"] });
      setEditingCategory(null);
      toast({ title: "Category updated successfully" });
    },
  });

  const deleteCategoryMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await fetch(`/api/categories/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Failed to delete category");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/categories"] });
      toast({ title: "Category deleted successfully" });
    },
  });

  const handleCreateCategory = () => {
    createCategoryMutation.mutate({
      name: newCategoryName,
      description: newCategoryDescription,
      ebayMapping: newCategoryEbayMapping,
    });
  };

  if (isLoading) {
    return (
      <div className="flex h-screen bg-gray-50">
        <Sidebar />
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-auto p-6">
          <div className="w-full space-y-6">
            {/* Header */}
            <div className="bg-white rounded-lg shadow-sm p-6">
              <div className="flex items-center space-x-3">
                <Package className="h-8 w-8 text-blue-600" />
                <div>
                  <h1 className="text-2xl font-bold text-gray-900">Configuration</h1>
                  <p className="text-gray-600">Manage categories, pricing, and shipping policies</p>
                </div>
              </div>
            </div>

            {/* Tabs */}
            <div className="w-full">
              <Tabs defaultValue="categories" className="w-full">
                <TabsList className="grid w-full grid-cols-3 mb-6">
                  <TabsTrigger value="categories" className="flex items-center justify-center space-x-2 px-4 py-2">
                    <FolderTree className="h-4 w-4" />
                    <span>Categories</span>
                  </TabsTrigger>
                  <TabsTrigger value="pricing" className="flex items-center justify-center space-x-2 px-4 py-2">
                    <Calculator className="h-4 w-4" />
                    <span>Pricing Tiers</span>
                  </TabsTrigger>
                  <TabsTrigger value="shipping" className="flex items-center justify-center space-x-2 px-4 py-2">
                    <Truck className="h-4 w-4" />
                    <span>Shipping Policies</span>
                  </TabsTrigger>
                </TabsList>

                {/* Categories Tab */}
                <TabsContent value="categories" className="space-y-6">
                  <div className="flex items-center justify-between">
                    <h2 className="text-xl font-semibold">Product Categories</h2>
                    <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
                      <DialogTrigger asChild>
                        <Button>
                          <Plus className="h-4 w-4 mr-2" />
                          Add Category
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Create New Category</DialogTitle>
                          <DialogDescription>
                            Add a new product category for organizing your inventory.
                          </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4">
                          <div>
                            <Label htmlFor="name">Category Name</Label>
                            <Input
                              id="name"
                              value={newCategoryName}
                              onChange={(e) => setNewCategoryName(e.target.value)}
                              placeholder="Electronics, Components, etc."
                            />
                          </div>
                          <div>
                            <Label htmlFor="description">Description</Label>
                            <Textarea
                              id="description"
                              value={newCategoryDescription}
                              onChange={(e) => setNewCategoryDescription(e.target.value)}
                              placeholder="Category description..."
                            />
                          </div>
                          <div>
                            <Label htmlFor="ebayMapping">eBay Category ID</Label>
                            <Input
                              id="ebayMapping"
                              value={newCategoryEbayMapping}
                              onChange={(e) => setNewCategoryEbayMapping(e.target.value)}
                              placeholder="e.g., 58277"
                            />
                          </div>
                        </div>
                        <DialogFooter>
                          <Button
                            onClick={handleCreateCategory}
                            disabled={createCategoryMutation.isPending || !newCategoryName}
                          >
                            Create Category
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {categories.map((category: any) => (
                      <Card key={category.id}>
                        <CardHeader>
                          <div className="flex items-center justify-between">
                            <CardTitle className="text-lg">{category.name}</CardTitle>
                            <Badge variant="secondary">ID: {category.id}</Badge>
                          </div>
                          <CardDescription>{category.description || "No description"}</CardDescription>
                        </CardHeader>
                        <CardContent>
                          <div className="space-y-2">
                            <div className="flex items-center justify-between text-sm">
                              <span className="font-medium">eBay Category:</span>
                              <span>{category.ebayMapping || "Not mapped"}</span>
                            </div>
                            <div className="flex items-center justify-between text-sm">
                              <span className="font-medium">Products:</span>
                              <span>0</span>
                            </div>
                          </div>
                          <div className="flex space-x-2 mt-4">
                            <Button variant="outline" size="sm">
                              <Edit className="h-4 w-4 mr-1" />
                              Edit
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => deleteCategoryMutation.mutate(category.id)}
                              disabled={deleteCategoryMutation.isPending}
                            >
                              <Trash2 className="h-4 w-4 mr-1" />
                              Delete
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </TabsContent>

                {/* Pricing Tab */}
                <TabsContent value="pricing" className="space-y-6">
                  <div className="flex items-center justify-between">
                    <h2 className="text-xl font-semibold">Pricing Tiers</h2>
                    <Badge variant="secondary">7 Active Tiers</Badge>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {pricingTiers.map((tier: any, index: number) => (
                      <Card key={index}>
                        <CardHeader>
                          <div className="flex items-center justify-between">
                            <CardTitle className="text-lg">{tier.label}</CardTitle>
                            <Badge variant="default">{tier.marginPercentage}%</Badge>
                          </div>
                        </CardHeader>
                        <CardContent>
                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium">Price Range:</span>
                              <span className="text-sm">€{tier.min} - €{tier.max}</span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium">Multiplier:</span>
                              <span className="text-sm">{tier.multiplier}x</span>
                            </div>
                            <div className="text-sm text-gray-600">
                              Automatic pricing based on supplier cost
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </TabsContent>

                {/* Shipping Tab */}
                <TabsContent value="shipping" className="space-y-6">
                  <div className="flex items-center justify-between">
                    <h2 className="text-xl font-semibold">Shipping Policies</h2>
                    <div className="flex items-center space-x-2">
                      {validation?.isValid ? (
                        <Badge variant="default" className="bg-green-500">
                          <CheckCircle className="h-4 w-4 mr-1" />
                          All Policies Valid
                        </Badge>
                      ) : (
                        <Badge variant="destructive">
                          <AlertCircle className="h-4 w-4 mr-1" />
                          Configuration Issues
                        </Badge>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {policies.map((policy: any) => (
                      <Card key={policy.id}>
                        <CardHeader>
                          <div className="flex items-center justify-between">
                            <CardTitle className="text-lg flex items-center space-x-2">
                              <Weight className="h-5 w-5" />
                              <span>{policy.name}</span>
                            </CardTitle>
                            <Badge variant="outline">{policy.type}</Badge>
                          </div>
                        </CardHeader>
                        <CardContent>
                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium">Policy ID:</span>
                              <Badge variant="secondary">{policy.id}</Badge>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium">Weight Range:</span>
                              <span className="text-sm">{policy.weightRange.min}-{policy.weightRange.max}g</span>
                            </div>
                            <div className="text-sm text-gray-600">
                              Products: {assignments.filter((a: any) => a.policyId === policy.id).length}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
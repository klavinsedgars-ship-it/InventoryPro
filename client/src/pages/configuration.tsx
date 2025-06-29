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
  const [testWeight, setTestWeight] = useState<string>("");
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryDescription, setNewCategoryDescription] = useState("");
  const [newCategoryEbayMapping, setNewCategoryEbayMapping] = useState("");
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

  // Test weight mutation
  const testWeightMutation = useMutation({
    mutationFn: async (weight: number) => {
      const response = await fetch("/api/shipping/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weight }),
      });
      return response.json();
    },
  });

  // Create category mutation
  const createCategoryMutation = useMutation({
    mutationFn: async (categoryData: any) => {
      const response = await fetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(categoryData),
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
    onError: () => {
      toast({ title: "Failed to create category", variant: "destructive" });
    },
  });

  const handleTestWeight = () => {
    const weight = parseFloat(testWeight);
    if (!isNaN(weight)) {
      testWeightMutation.mutate(weight);
    }
  };

  const handleCreateCategory = () => {
    if (!newCategoryName.trim()) return;
    
    createCategoryMutation.mutate({
      name: newCategoryName,
      description: newCategoryDescription,
      ebayMapping: newCategoryEbayMapping,
    });
  };

  const policies = policiesData?.policies || [];
  const assignments = assignmentsData?.assignments || [];
  const validation = policiesData?.validation;
  const categories = Array.isArray(categoriesData) ? categoriesData : [];
  const pricingTiers = pricingData?.tiers || [];

  const isLoading = policiesLoading || assignmentsLoading || categoriesLoading || pricingLoading;

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
          <div className="max-w-7xl mx-auto space-y-6">
            
            {/* Header */}
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-3xl font-bold text-gray-900">Configuration</h1>
                <p className="text-gray-600">Manage categories, pricing, and shipping policies</p>
              </div>
            </div>

            {/* Tabs */}
            <Tabs defaultValue="categories" className="w-full">
              <TabsList className="grid w-full grid-cols-3 mb-6">
                <TabsTrigger value="categories" className="flex items-center space-x-2">
                  <FolderTree className="h-4 w-4" />
                  <span>Categories</span>
                </TabsTrigger>
                <TabsTrigger value="pricing" className="flex items-center space-x-2">
                  <Calculator className="h-4 w-4" />
                  <span>Pricing Tiers</span>
                </TabsTrigger>
                <TabsTrigger value="shipping" className="flex items-center space-x-2">
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
                            placeholder="Brief description of this category..."
                          />
                        </div>
                        <div>
                          <Label htmlFor="ebayMapping">eBay Category ID</Label>
                          <Input
                            id="ebayMapping"
                            value={newCategoryEbayMapping}
                            onChange={(e) => setNewCategoryEbayMapping(e.target.value)}
                            placeholder="58277"
                          />
                        </div>
                      </div>
                      <DialogFooter>
                        <Button
                          onClick={handleCreateCategory}
                          disabled={createCategoryMutation.isPending}
                        >
                          {createCategoryMutation.isPending ? "Creating..." : "Create Category"}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {categories.map((category: any) => (
                    <Card key={category.id}>
                      <CardHeader>
                        <CardTitle className="flex items-center justify-between">
                          <span>{category.name}</span>
                          <Badge variant="secondary">ID: {category.id}</Badge>
                        </CardTitle>
                        <CardDescription>{category.description || "No description"}</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-sm">
                            <span className="font-medium">eBay Category:</span>
                            <span className="font-mono">{category.ebayMapping || "Not set"}</span>
                          </div>
                          <div className="flex items-center justify-between text-sm">
                            <span className="font-medium">Products:</span>
                            <span>{category.productCount || 0}</span>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </TabsContent>

              {/* Pricing Tab */}
              <TabsContent value="pricing" className="space-y-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-semibold">Dynamic Pricing Tiers</h2>
                  <Badge variant="outline" className="flex items-center space-x-1">
                    <DollarSign className="h-3 w-3" />
                    <span>{pricingTiers.length} tiers active</span>
                  </Badge>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {pricingTiers.map((tier: any, index: number) => (
                    <Card key={index}>
                      <CardHeader>
                        <CardTitle className="text-lg">{tier.label}</CardTitle>
                        <CardDescription>
                          Supplier price range: €{tier.min} - €{tier.max}
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">Multiplier:</span>
                            <Badge variant="secondary">{tier.multiplier}x</Badge>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">Margin:</span>
                            <span className="text-sm font-semibold text-green-600">
                              {tier.marginPercentage}%
                            </span>
                          </div>
                          <div className="text-xs text-gray-500">
                            Example: €{tier.min} → €{(tier.min * tier.multiplier).toFixed(2)}
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
                  <h2 className="text-xl font-semibold">Weight-Based Shipping Policies</h2>
                  <Badge variant="outline" className="flex items-center space-x-1">
                    <Package className="h-3 w-3" />
                    <span>Auto-assigned by weight</span>
                  </Badge>
                </div>

                {/* Validation Status */}
                {validation && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center space-x-2">
                        {validation.isValid ? (
                          <CheckCircle className="h-5 w-5 text-green-600" />
                        ) : (
                          <AlertCircle className="h-5 w-5 text-red-600" />
                        )}
                        <span>Configuration Status</span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {validation.isValid ? (
                        <p className="text-green-600">All shipping policies are properly configured</p>
                      ) : (
                        <div className="space-y-2">
                          <p className="text-red-600">Configuration issues found:</p>
                          <ul className="list-disc list-inside space-y-1">
                            {validation.errors.map((error: string, index: number) => (
                              <li key={index} className="text-sm text-red-600">{error}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}

                {/* Weight Tester */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center space-x-2">
                      <Weight className="h-5 w-5" />
                      <span>Weight Policy Tester</span>
                    </CardTitle>
                    <CardDescription>
                      Test which shipping policy will be assigned for a specific weight
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center space-x-4">
                      <Input
                        type="number"
                        placeholder="Weight in grams"
                        value={testWeight}
                        onChange={(e) => setTestWeight(e.target.value)}
                        className="w-48"
                      />
                      <Button onClick={handleTestWeight} disabled={testWeightMutation.isPending}>
                        {testWeightMutation.isPending ? "Testing..." : "Test Weight"}
                      </Button>
                    </div>
                    
                    {testWeightMutation.data && (
                      <div className="mt-4 p-4 bg-blue-50 rounded-lg">
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="font-medium">Weight:</span>
                            <span>{testWeightMutation.data.weight}g</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="font-medium">Policy ID:</span>
                            <Badge variant="outline">{testWeightMutation.data.policyId}</Badge>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="font-medium">Policy Name:</span>
                            <span>{testWeightMutation.data.policyName}</span>
                          </div>
                          {testWeightMutation.data.policy && (
                            <div className="mt-2 text-sm text-gray-600">
                              Range: {testWeightMutation.data.policy.weightRange.min}-{testWeightMutation.data.policy.weightRange.max}g
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Shipping Policies Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {policies.map((policy: any) => (
                    <Card key={policy.id}>
                      <CardHeader>
                        <CardTitle className="text-lg">{policy.name}</CardTitle>
                        <CardDescription>{policy.description}</CardDescription>
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
  );
}
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Sidebar } from "@/components/layout/sidebar";
import { Package, Truck, Weight, CheckCircle, AlertCircle } from "lucide-react";

interface ShippingPolicy {
  id: string;
  name: string;
  weightRange: {
    min: number;
    max: number;
  };
  description: string;
}

interface PolicyAssignment {
  productId: number;
  weight: number | null;
  policyId: string;
  policyName: string;
}

interface User {
  username: string;
  role: string;
}

interface ShippingPoliciesProps {
  user: User;
}

export default function ShippingPolicies({ user }: ShippingPoliciesProps) {
  const [testWeight, setTestWeight] = useState<string>("");
  const queryClient = useQueryClient();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Fetch shipping policies
  const { data: policiesData } = useQuery<any>({
    queryKey: ["/api/shipping/policies"],
  });

  // Fetch policy assignments
  const { data: assignmentsData } = useQuery<any>({
    queryKey: ["/api/shipping/assignments"],
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

  const handleTestWeight = () => {
    const weight = parseFloat(testWeight);
    if (!isNaN(weight)) {
      testWeightMutation.mutate(weight);
    }
  };

  const policies: ShippingPolicy[] = policiesData?.policies || [];
  const assignments: PolicyAssignment[] = assignmentsData?.assignments || [];
  const validation = policiesData?.validation;

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar user={user} collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} />
      <div className={`flex-1 flex flex-col overflow-hidden transition-all duration-200 ${sidebarCollapsed ? 'ml-16' : 'ml-64'}`}>
        <div className="flex-1 overflow-auto p-6">
          <div className="max-w-7xl mx-auto space-y-6">
            
            {/* Header */}
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-3xl font-bold text-gray-900">Shipping Policies</h1>
                <p className="text-gray-600">Weight-based eBay shipping policy management</p>
              </div>
              <div className="flex items-center space-x-2">
                <Truck className="h-5 w-5 text-blue-600" />
                <span className="text-sm text-gray-600">Auto-assigned by weight</span>
              </div>
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
              {policies.map((policy) => (
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
                        Products: {assignments.filter(a => a.policyId === policy.id).length}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Product Assignments */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Package className="h-5 w-5" />
                  <span>Product Policy Assignments</span>
                </CardTitle>
                <CardDescription>
                  Current shipping policy assignments for all products
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2">Product ID</th>
                        <th className="text-left py-2">Weight (g)</th>
                        <th className="text-left py-2">Policy ID</th>
                        <th className="text-left py-2">Policy Name</th>
                      </tr>
                    </thead>
                    <tbody>
                      {assignments.map((assignment) => (
                        <tr key={assignment.productId} className="border-b">
                          <td className="py-2">{assignment.productId}</td>
                          <td className="py-2">
                            {assignment.weight !== null ? (
                              <span className="font-mono">{assignment.weight}</span>
                            ) : (
                              <span className="text-gray-400">No weight</span>
                            )}
                          </td>
                          <td className="py-2">
                            <Badge variant="outline" className="font-mono">
                              {assignment.policyId}
                            </Badge>
                          </td>
                          <td className="py-2">{assignment.policyName}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

          </div>
        </div>
      </div>
    </div>
  );
}
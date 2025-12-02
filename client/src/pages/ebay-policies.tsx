import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { 
  RefreshCw, 
  Loader2, 
  Plus,
  Pencil,
  Trash2,
  CreditCard,
  Truck,
  RotateCcw,
  CheckCircle,
  XCircle,
  Cloud,
  HardDrive,
  AlertTriangle,
  Key
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { 
  EbayPaymentPolicy, 
  EbayFulfillmentPolicy, 
  EbayReturnPolicy 
} from "@shared/schema";

interface EbayPoliciesProps {
  user: any;
}

export function EbayPolicies({ user }: EbayPoliciesProps) {
  const { toast } = useToast();
  const queryClientHook = useQueryClient();
  const [activeTab, setActiveTab] = useState("payment");
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<any>(null);

  // Check OAuth configuration status
  const { data: oauthStatus } = useQuery<{ configured: boolean; message: string }>({
    queryKey: ["/api/ebay/business-policies/status"],
    select: (data: any) => ({ configured: data.configured, message: data.message }),
    staleTime: 60000, // Cache for 1 minute
  });

  // Fetch policies
  const { data: paymentPolicies = [], isLoading: loadingPayment } = useQuery<EbayPaymentPolicy[]>({
    queryKey: ["/api/ebay/business-policies/payment"],
    select: (data: any) => data.policies || [],
  });

  const { data: fulfillmentPolicies = [], isLoading: loadingFulfillment } = useQuery<EbayFulfillmentPolicy[]>({
    queryKey: ["/api/ebay/business-policies/fulfillment"],
    select: (data: any) => data.policies || [],
  });

  const { data: returnPolicies = [], isLoading: loadingReturn } = useQuery<EbayReturnPolicy[]>({
    queryKey: ["/api/ebay/business-policies/return"],
    select: (data: any) => data.policies || [],
  });

  // Sync from eBay mutation
  const syncMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/ebay/business-policies/sync");
      return response.json();
    },
    onSuccess: (data) => {
      queryClientHook.invalidateQueries({ queryKey: ["/api/ebay/business-policies"] });
      queryClientHook.invalidateQueries({ queryKey: ["/api/ebay/business-policies/payment"] });
      queryClientHook.invalidateQueries({ queryKey: ["/api/ebay/business-policies/fulfillment"] });
      queryClientHook.invalidateQueries({ queryKey: ["/api/ebay/business-policies/return"] });
      toast({
        title: "Policies Synced",
        description: `Synced ${data.result?.payment?.synced || 0} payment, ${data.result?.fulfillment?.synced || 0} shipping, ${data.result?.return?.synced || 0} return policies from eBay`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Sync Failed",
        description: error.message || "Failed to sync policies from eBay",
        variant: "destructive",
      });
    },
  });

  // Create policy mutation
  const createPaymentPolicyMutation = useMutation({
    mutationFn: async (data: any) => {
      const response = await apiRequest("POST", "/api/ebay/business-policies/payment", data);
      return response.json();
    },
    onSuccess: () => {
      queryClientHook.invalidateQueries({ queryKey: ["/api/ebay/business-policies/payment"] });
      setIsCreateDialogOpen(false);
      toast({ title: "Payment Policy Created" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to create policy", description: error.message, variant: "destructive" });
    },
  });

  const createFulfillmentPolicyMutation = useMutation({
    mutationFn: async (data: any) => {
      const response = await apiRequest("POST", "/api/ebay/business-policies/fulfillment", data);
      return response.json();
    },
    onSuccess: () => {
      queryClientHook.invalidateQueries({ queryKey: ["/api/ebay/business-policies/fulfillment"] });
      setIsCreateDialogOpen(false);
      toast({ title: "Shipping Policy Created" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to create policy", description: error.message, variant: "destructive" });
    },
  });

  const createReturnPolicyMutation = useMutation({
    mutationFn: async (data: any) => {
      const response = await apiRequest("POST", "/api/ebay/business-policies/return", data);
      return response.json();
    },
    onSuccess: () => {
      queryClientHook.invalidateQueries({ queryKey: ["/api/ebay/business-policies/return"] });
      setIsCreateDialogOpen(false);
      toast({ title: "Return Policy Created" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to create policy", description: error.message, variant: "destructive" });
    },
  });

  // Delete policy mutations
  const deletePaymentPolicyMutation = useMutation({
    mutationFn: async (policyId: string) => {
      const response = await apiRequest("DELETE", `/api/ebay/business-policies/payment/${policyId}?deleteOnEbay=true`);
      return response.json();
    },
    onSuccess: () => {
      queryClientHook.invalidateQueries({ queryKey: ["/api/ebay/business-policies/payment"] });
      toast({ title: "Payment Policy Deleted" });
    },
  });

  const deleteFulfillmentPolicyMutation = useMutation({
    mutationFn: async (policyId: string) => {
      const response = await apiRequest("DELETE", `/api/ebay/business-policies/fulfillment/${policyId}?deleteOnEbay=true`);
      return response.json();
    },
    onSuccess: () => {
      queryClientHook.invalidateQueries({ queryKey: ["/api/ebay/business-policies/fulfillment"] });
      toast({ title: "Shipping Policy Deleted" });
    },
  });

  const deleteReturnPolicyMutation = useMutation({
    mutationFn: async (policyId: string) => {
      const response = await apiRequest("DELETE", `/api/ebay/business-policies/return/${policyId}?deleteOnEbay=true`);
      return response.json();
    },
    onSuccess: () => {
      queryClientHook.invalidateQueries({ queryKey: ["/api/ebay/business-policies/return"] });
      toast({ title: "Return Policy Deleted" });
    },
  });

  const isLoading = loadingPayment || loadingFulfillment || loadingReturn;

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-900">
      <Sidebar user={user} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header user={user} title="eBay Business Policies" />
        <main className="flex-1 overflow-y-auto p-6">
          <div className="max-w-7xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                  eBay Business Policies
                </h1>
                <p className="text-gray-500 dark:text-gray-400 mt-1">
                  Manage payment, shipping, and return policies for your eBay listings
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  onClick={() => syncMutation.mutate()}
                  disabled={syncMutation.isPending || !oauthStatus?.configured}
                  title={!oauthStatus?.configured ? "OAuth not configured - set credentials first" : "Sync policies from eBay"}
                  data-testid="button-sync-policies"
                >
                  {syncMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-2" />
                  )}
                  Sync from eBay
                </Button>
              </div>
            </div>

            {/* OAuth Configuration Alert */}
            {oauthStatus && !oauthStatus.configured && (
              <Alert variant="destructive" className="bg-amber-50 border-amber-200 dark:bg-amber-900/20 dark:border-amber-800">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                <AlertTitle className="text-amber-800 dark:text-amber-200">OAuth Not Configured</AlertTitle>
                <AlertDescription className="text-amber-700 dark:text-amber-300">
                  <p>To sync policies from eBay, you need to set up OAuth 2.0 credentials:</p>
                  <ul className="list-disc list-inside mt-2 space-y-1 text-sm">
                    <li><code className="bg-amber-100 dark:bg-amber-900 px-1 rounded">EBAY_OAUTH_CLIENT_ID</code> - Your eBay App Client ID</li>
                    <li><code className="bg-amber-100 dark:bg-amber-900 px-1 rounded">EBAY_OAUTH_CLIENT_SECRET</code> - Your eBay App Client Secret</li>
                    <li><code className="bg-amber-100 dark:bg-amber-900 px-1 rounded">EBAY_OAUTH_REFRESH_TOKEN</code> - OAuth Refresh Token with <code>sell.account</code> scope</li>
                  </ul>
                  <p className="mt-2 text-sm">These are separate from the Trading API token used for listings.</p>
                </AlertDescription>
              </Alert>
            )}

            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-500">Payment Policies</p>
                      <p className="text-2xl font-bold">{paymentPolicies.length}</p>
                    </div>
                    <div className="h-12 w-12 rounded-full bg-green-100 dark:bg-green-900/20 flex items-center justify-center">
                      <CreditCard className="h-6 w-6 text-green-600" />
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-500">Shipping Policies</p>
                      <p className="text-2xl font-bold">{fulfillmentPolicies.length}</p>
                    </div>
                    <div className="h-12 w-12 rounded-full bg-blue-100 dark:bg-blue-900/20 flex items-center justify-center">
                      <Truck className="h-6 w-6 text-blue-600" />
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-500">Return Policies</p>
                      <p className="text-2xl font-bold">{returnPolicies.length}</p>
                    </div>
                    <div className="h-12 w-12 rounded-full bg-orange-100 dark:bg-orange-900/20 flex items-center justify-center">
                      <RotateCcw className="h-6 w-6 text-orange-600" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Tabs */}
            <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="payment" className="flex items-center gap-2" data-testid="tab-payment">
                  <CreditCard className="h-4 w-4" />
                  Payment
                </TabsTrigger>
                <TabsTrigger value="shipping" className="flex items-center gap-2" data-testid="tab-shipping">
                  <Truck className="h-4 w-4" />
                  Shipping
                </TabsTrigger>
                <TabsTrigger value="return" className="flex items-center gap-2" data-testid="tab-return">
                  <RotateCcw className="h-4 w-4" />
                  Returns
                </TabsTrigger>
              </TabsList>

              {/* Payment Policies Tab */}
              <TabsContent value="payment" className="space-y-4">
                <div className="flex justify-between items-center">
                  <h3 className="text-lg font-semibold">Payment Policies</h3>
                  <CreatePaymentPolicyDialog 
                    onSubmit={(data) => createPaymentPolicyMutation.mutate(data)}
                    isPending={createPaymentPolicyMutation.isPending}
                  />
                </div>
                
                {loadingPayment ? (
                  <div className="flex justify-center p-8">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  </div>
                ) : paymentPolicies.length === 0 ? (
                  <Card>
                    <CardContent className="flex flex-col items-center justify-center py-12">
                      <CreditCard className="h-12 w-12 text-gray-400 mb-4" />
                      <h3 className="text-lg font-medium text-gray-900 dark:text-white">No Payment Policies</h3>
                      <p className="text-gray-500 mt-1">Click "Sync from eBay" to import your existing policies</p>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="grid gap-4">
                    {paymentPolicies.map((policy) => (
                      <PaymentPolicyCard
                        key={policy.policyId}
                        policy={policy}
                        onDelete={() => deletePaymentPolicyMutation.mutate(policy.policyId)}
                        isDeleting={deletePaymentPolicyMutation.isPending}
                      />
                    ))}
                  </div>
                )}
              </TabsContent>

              {/* Shipping Policies Tab */}
              <TabsContent value="shipping" className="space-y-4">
                <div className="flex justify-between items-center">
                  <h3 className="text-lg font-semibold">Shipping (Fulfillment) Policies</h3>
                  <CreateFulfillmentPolicyDialog
                    onSubmit={(data) => createFulfillmentPolicyMutation.mutate(data)}
                    isPending={createFulfillmentPolicyMutation.isPending}
                  />
                </div>
                
                {loadingFulfillment ? (
                  <div className="flex justify-center p-8">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  </div>
                ) : fulfillmentPolicies.length === 0 ? (
                  <Card>
                    <CardContent className="flex flex-col items-center justify-center py-12">
                      <Truck className="h-12 w-12 text-gray-400 mb-4" />
                      <h3 className="text-lg font-medium text-gray-900 dark:text-white">No Shipping Policies</h3>
                      <p className="text-gray-500 mt-1">Click "Sync from eBay" to import your existing policies</p>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="grid gap-4">
                    {fulfillmentPolicies.map((policy) => (
                      <FulfillmentPolicyCard
                        key={policy.policyId}
                        policy={policy}
                        onDelete={() => deleteFulfillmentPolicyMutation.mutate(policy.policyId)}
                        isDeleting={deleteFulfillmentPolicyMutation.isPending}
                      />
                    ))}
                  </div>
                )}
              </TabsContent>

              {/* Return Policies Tab */}
              <TabsContent value="return" className="space-y-4">
                <div className="flex justify-between items-center">
                  <h3 className="text-lg font-semibold">Return Policies</h3>
                  <CreateReturnPolicyDialog
                    onSubmit={(data) => createReturnPolicyMutation.mutate(data)}
                    isPending={createReturnPolicyMutation.isPending}
                  />
                </div>
                
                {loadingReturn ? (
                  <div className="flex justify-center p-8">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  </div>
                ) : returnPolicies.length === 0 ? (
                  <Card>
                    <CardContent className="flex flex-col items-center justify-center py-12">
                      <RotateCcw className="h-12 w-12 text-gray-400 mb-4" />
                      <h3 className="text-lg font-medium text-gray-900 dark:text-white">No Return Policies</h3>
                      <p className="text-gray-500 mt-1">Click "Sync from eBay" to import your existing policies</p>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="grid gap-4">
                    {returnPolicies.map((policy) => (
                      <ReturnPolicyCard
                        key={policy.policyId}
                        policy={policy}
                        onDelete={() => deleteReturnPolicyMutation.mutate(policy.policyId)}
                        isDeleting={deleteReturnPolicyMutation.isPending}
                      />
                    ))}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>
        </main>
      </div>
    </div>
  );
}

// Payment Policy Card
function PaymentPolicyCard({ 
  policy, 
  onDelete, 
  isDeleting 
}: { 
  policy: EbayPaymentPolicy; 
  onDelete: () => void;
  isDeleting: boolean;
}) {
  const paymentMethods = policy.paymentMethods ? JSON.parse(policy.paymentMethods) : [];
  
  return (
    <Card data-testid={`card-payment-policy-${policy.policyId}`}>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h4 className="font-semibold text-lg">{policy.name}</h4>
              {policy.syncedFromEbay ? (
                <Badge variant="outline" className="text-green-600 border-green-600">
                  <Cloud className="h-3 w-3 mr-1" />
                  eBay
                </Badge>
              ) : (
                <Badge variant="outline" className="text-gray-600">
                  <HardDrive className="h-3 w-3 mr-1" />
                  Local
                </Badge>
              )}
              {policy.isDefault && (
                <Badge className="bg-primary">Default</Badge>
              )}
            </div>
            {policy.description && (
              <p className="text-gray-500 text-sm mt-1">{policy.description}</p>
            )}
            <div className="flex flex-wrap gap-4 mt-3 text-sm">
              <div className="flex items-center gap-1">
                <span className="text-gray-500">Marketplace:</span>
                <span className="font-medium">{policy.marketplaceId}</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-gray-500">Immediate Pay:</span>
                {policy.immediatePay ? (
                  <CheckCircle className="h-4 w-4 text-green-500" />
                ) : (
                  <XCircle className="h-4 w-4 text-red-500" />
                )}
              </div>
              {paymentMethods.length > 0 && (
                <div className="flex items-center gap-1">
                  <span className="text-gray-500">Methods:</span>
                  <span className="font-medium">
                    {paymentMethods.map((m: any) => m.paymentMethodType).join(", ")}
                  </span>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="icon" className="text-red-500 hover:text-red-700" data-testid="button-delete-payment-policy">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete Payment Policy?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will delete "{policy.name}" from both eBay and your local database. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={onDelete} disabled={isDeleting}>
                    {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Delete"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Fulfillment Policy Card
function FulfillmentPolicyCard({ 
  policy, 
  onDelete, 
  isDeleting 
}: { 
  policy: EbayFulfillmentPolicy; 
  onDelete: () => void;
  isDeleting: boolean;
}) {
  const shippingOptions = policy.shippingOptions ? JSON.parse(policy.shippingOptions) : [];
  
  return (
    <Card data-testid={`card-fulfillment-policy-${policy.policyId}`}>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h4 className="font-semibold text-lg">{policy.name}</h4>
              {policy.syncedFromEbay ? (
                <Badge variant="outline" className="text-green-600 border-green-600">
                  <Cloud className="h-3 w-3 mr-1" />
                  eBay
                </Badge>
              ) : (
                <Badge variant="outline" className="text-gray-600">
                  <HardDrive className="h-3 w-3 mr-1" />
                  Local
                </Badge>
              )}
              {policy.isDefault && (
                <Badge className="bg-primary">Default</Badge>
              )}
            </div>
            {policy.description && (
              <p className="text-gray-500 text-sm mt-1">{policy.description}</p>
            )}
            <div className="flex flex-wrap gap-4 mt-3 text-sm">
              <div className="flex items-center gap-1">
                <span className="text-gray-500">Marketplace:</span>
                <span className="font-medium">{policy.marketplaceId}</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-gray-500">Handling Time:</span>
                <span className="font-medium">{policy.handlingTime} day(s)</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-gray-500">Global Shipping:</span>
                {policy.globalShipping ? (
                  <CheckCircle className="h-4 w-4 text-green-500" />
                ) : (
                  <XCircle className="h-4 w-4 text-gray-400" />
                )}
              </div>
              {shippingOptions.length > 0 && (
                <div className="flex items-center gap-1">
                  <span className="text-gray-500">Options:</span>
                  <span className="font-medium">{shippingOptions.length} configured</span>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="icon" className="text-red-500 hover:text-red-700" data-testid="button-delete-fulfillment-policy">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete Shipping Policy?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will delete "{policy.name}" from both eBay and your local database. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={onDelete} disabled={isDeleting}>
                    {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Delete"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Return Policy Card
function ReturnPolicyCard({ 
  policy, 
  onDelete, 
  isDeleting 
}: { 
  policy: EbayReturnPolicy; 
  onDelete: () => void;
  isDeleting: boolean;
}) {
  return (
    <Card data-testid={`card-return-policy-${policy.policyId}`}>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h4 className="font-semibold text-lg">{policy.name}</h4>
              {policy.syncedFromEbay ? (
                <Badge variant="outline" className="text-green-600 border-green-600">
                  <Cloud className="h-3 w-3 mr-1" />
                  eBay
                </Badge>
              ) : (
                <Badge variant="outline" className="text-gray-600">
                  <HardDrive className="h-3 w-3 mr-1" />
                  Local
                </Badge>
              )}
              {policy.isDefault && (
                <Badge className="bg-primary">Default</Badge>
              )}
            </div>
            {policy.description && (
              <p className="text-gray-500 text-sm mt-1">{policy.description}</p>
            )}
            <div className="flex flex-wrap gap-4 mt-3 text-sm">
              <div className="flex items-center gap-1">
                <span className="text-gray-500">Marketplace:</span>
                <span className="font-medium">{policy.marketplaceId}</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-gray-500">Returns Accepted:</span>
                {policy.returnsAccepted ? (
                  <CheckCircle className="h-4 w-4 text-green-500" />
                ) : (
                  <XCircle className="h-4 w-4 text-red-500" />
                )}
              </div>
              {policy.returnsAccepted && (
                <>
                  <div className="flex items-center gap-1">
                    <span className="text-gray-500">Return Period:</span>
                    <span className="font-medium">{policy.returnPeriod} days</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-gray-500">Refund:</span>
                    <span className="font-medium">{policy.refundMethod?.replace(/_/g, " ")}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-gray-500">Shipping Paid By:</span>
                    <span className="font-medium">{policy.returnShippingCostPayer}</span>
                  </div>
                </>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="icon" className="text-red-500 hover:text-red-700" data-testid="button-delete-return-policy">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete Return Policy?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will delete "{policy.name}" from both eBay and your local database. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={onDelete} disabled={isDeleting}>
                    {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Delete"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Create Payment Policy Dialog
function CreatePaymentPolicyDialog({ 
  onSubmit, 
  isPending 
}: { 
  onSubmit: (data: any) => void;
  isPending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [immediatePay, setImmediatePay] = useState(true);
  const [createOnEbay, setCreateOnEbay] = useState(true);

  const handleSubmit = () => {
    onSubmit({
      name,
      description,
      immediatePay,
      createOnEbay,
    });
    setOpen(false);
    setName("");
    setDescription("");
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button data-testid="button-create-payment-policy">
          <Plus className="h-4 w-4 mr-2" />
          New Payment Policy
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Payment Policy</DialogTitle>
          <DialogDescription>
            Create a new payment policy for your eBay listings
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="name">Policy Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Standard Payment"
              data-testid="input-payment-policy-name"
            />
          </div>
          <div>
            <Label htmlFor="description">Description (Optional)</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe this payment policy..."
              data-testid="input-payment-policy-description"
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label>Immediate Payment Required</Label>
              <p className="text-sm text-gray-500">Buyer must pay immediately</p>
            </div>
            <Switch
              checked={immediatePay}
              onCheckedChange={setImmediatePay}
              data-testid="switch-immediate-pay"
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label>Create on eBay</Label>
              <p className="text-sm text-gray-500">Also create this policy on eBay</p>
            </div>
            <Switch
              checked={createOnEbay}
              onCheckedChange={setCreateOnEbay}
              data-testid="switch-create-on-ebay"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!name || isPending} data-testid="button-submit-payment-policy">
            {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Create Policy
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Create Fulfillment Policy Dialog
function CreateFulfillmentPolicyDialog({ 
  onSubmit, 
  isPending 
}: { 
  onSubmit: (data: any) => void;
  isPending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [handlingTime, setHandlingTime] = useState(1);
  const [globalShipping, setGlobalShipping] = useState(false);
  const [createOnEbay, setCreateOnEbay] = useState(true);

  const handleSubmit = () => {
    onSubmit({
      name,
      description,
      handlingTime,
      globalShipping,
      createOnEbay,
    });
    setOpen(false);
    setName("");
    setDescription("");
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button data-testid="button-create-fulfillment-policy">
          <Plus className="h-4 w-4 mr-2" />
          New Shipping Policy
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Shipping Policy</DialogTitle>
          <DialogDescription>
            Create a new shipping/fulfillment policy for your eBay listings
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="name">Policy Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., UK Standard Shipping"
              data-testid="input-fulfillment-policy-name"
            />
          </div>
          <div>
            <Label htmlFor="description">Description (Optional)</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe this shipping policy..."
              data-testid="input-fulfillment-policy-description"
            />
          </div>
          <div>
            <Label htmlFor="handlingTime">Handling Time (Days)</Label>
            <Select value={String(handlingTime)} onValueChange={(v) => setHandlingTime(Number(v))}>
              <SelectTrigger data-testid="select-handling-time">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">Same Day</SelectItem>
                <SelectItem value="1">1 Day</SelectItem>
                <SelectItem value="2">2 Days</SelectItem>
                <SelectItem value="3">3 Days</SelectItem>
                <SelectItem value="5">5 Days</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label>Global Shipping Program</Label>
              <p className="text-sm text-gray-500">Enable eBay Global Shipping</p>
            </div>
            <Switch
              checked={globalShipping}
              onCheckedChange={setGlobalShipping}
              data-testid="switch-global-shipping"
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label>Create on eBay</Label>
              <p className="text-sm text-gray-500">Also create this policy on eBay</p>
            </div>
            <Switch
              checked={createOnEbay}
              onCheckedChange={setCreateOnEbay}
              data-testid="switch-create-fulfillment-on-ebay"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!name || isPending} data-testid="button-submit-fulfillment-policy">
            {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Create Policy
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Create Return Policy Dialog
function CreateReturnPolicyDialog({ 
  onSubmit, 
  isPending 
}: { 
  onSubmit: (data: any) => void;
  isPending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [returnsAccepted, setReturnsAccepted] = useState(true);
  const [returnPeriod, setReturnPeriod] = useState(30);
  const [refundMethod, setRefundMethod] = useState("MONEY_BACK");
  const [returnShippingCostPayer, setReturnShippingCostPayer] = useState("BUYER");
  const [createOnEbay, setCreateOnEbay] = useState(true);

  const handleSubmit = () => {
    onSubmit({
      name,
      description,
      returnsAccepted,
      returnPeriod,
      refundMethod,
      returnShippingCostPayer,
      createOnEbay,
    });
    setOpen(false);
    setName("");
    setDescription("");
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button data-testid="button-create-return-policy">
          <Plus className="h-4 w-4 mr-2" />
          New Return Policy
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Return Policy</DialogTitle>
          <DialogDescription>
            Create a new return policy for your eBay listings
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="name">Policy Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., 30 Day Returns"
              data-testid="input-return-policy-name"
            />
          </div>
          <div>
            <Label htmlFor="description">Description (Optional)</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe this return policy..."
              data-testid="input-return-policy-description"
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label>Returns Accepted</Label>
              <p className="text-sm text-gray-500">Allow buyers to return items</p>
            </div>
            <Switch
              checked={returnsAccepted}
              onCheckedChange={setReturnsAccepted}
              data-testid="switch-returns-accepted"
            />
          </div>
          {returnsAccepted && (
            <>
              <div>
                <Label htmlFor="returnPeriod">Return Period (Days)</Label>
                <Select value={String(returnPeriod)} onValueChange={(v) => setReturnPeriod(Number(v))}>
                  <SelectTrigger data-testid="select-return-period">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="14">14 Days</SelectItem>
                    <SelectItem value="30">30 Days</SelectItem>
                    <SelectItem value="60">60 Days</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="refundMethod">Refund Method</Label>
                <Select value={refundMethod} onValueChange={setRefundMethod}>
                  <SelectTrigger data-testid="select-refund-method">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MONEY_BACK">Money Back</SelectItem>
                    <SelectItem value="EXCHANGE">Exchange</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="returnShippingCostPayer">Return Shipping Paid By</Label>
                <Select value={returnShippingCostPayer} onValueChange={setReturnShippingCostPayer}>
                  <SelectTrigger data-testid="select-return-shipping-payer">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="BUYER">Buyer</SelectItem>
                    <SelectItem value="SELLER">Seller</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
          <div className="flex items-center justify-between">
            <div>
              <Label>Create on eBay</Label>
              <p className="text-sm text-gray-500">Also create this policy on eBay</p>
            </div>
            <Switch
              checked={createOnEbay}
              onCheckedChange={setCreateOnEbay}
              data-testid="switch-create-return-on-ebay"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!name || isPending} data-testid="button-submit-return-policy">
            {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Create Policy
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

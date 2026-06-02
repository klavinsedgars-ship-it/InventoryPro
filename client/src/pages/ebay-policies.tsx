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
import { cn } from "@/lib/utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";


interface EbayPoliciesProps {
  user: any;
}

export function EbayPolicies({ user }: EbayPoliciesProps) {
  const { toast } = useToast();
  const queryClientHook = useQueryClient();
  const [activeTab, setActiveTab] = useState("payment");
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<any>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

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
      <Sidebar user={user} collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} />
      <div className={`flex-1 flex flex-col overflow-hidden transition-all duration-200 ${sidebarCollapsed ? 'ml-16' : 'ml-64'}`}>
        <Header title="eBay Business Policies" />
        <main className="flex-1 overflow-y-auto p-8">
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

            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium">Payment Policies</CardTitle>
                  <CreditCard className="h-5 w-5 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{paymentPolicies.length}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium">Shipping Policies</CardTitle>
                  <Truck className="h-5 w-5 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{fulfillmentPolicies.length}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium">Return Policies</CardTitle>
                  <RotateCcw className="h-5 w-5 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{returnPolicies.length}</div>
                </CardContent>
              </Card>
            </div>

            {/* Policy Management Tabs */}
            <Card className="shadow-sm">
              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <TabsList className="grid grid-cols-3 w-auto">
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

                    <Button
                      onClick={() => setIsCreateDialogOpen(true)}
                      size="sm"
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      New {activeTab === 'payment' ? 'Payment' : activeTab === 'shipping' ? 'Shipping' : 'Return'} Policy
                    </Button>
                  </div>
                </CardHeader>

                {/* Payment Policies Tab */}
                <TabsContent value="payment" className="mt-0">
                  {loadingPayment ? (
                    <div className="flex justify-center p-8">
                      <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    </div>
                  ) : paymentPolicies.length === 0 ? (
                    <CardContent className="text-center py-16">
                      <CreditCard className="h-16 w-16 mx-auto text-gray-400 mb-4" />
                      <h3 className="text-lg font-medium text-gray-900 dark:text-white">No Payment Policies</h3>
                      <p className="text-gray-500 mt-1">Click "Sync from eBay" to import your existing policies</p>
                    </CardContent>
                  ) : (
                    <CardContent className="pt-0">
                      <div className="rounded-md border">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="font-semibold">Policy Name</TableHead>
                              <TableHead className="font-semibold">Description</TableHead>
                              <TableHead className="font-semibold">Marketplace</TableHead>
                              <TableHead className="font-semibold">Immediate Pay</TableHead>
                              <TableHead className="font-semibold">Payment Methods</TableHead>
                              <TableHead className="text-right font-semibold">Actions</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {paymentPolicies.map((policy) => (
                              <PaymentPolicyCard
                                key={policy.policyId}
                                policy={policy}
                                onDelete={() => deletePaymentPolicyMutation.mutate(policy.policyId)}
                                isDeleting={deletePaymentPolicyMutation.isPending}
                              />
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </CardContent>
                  )}
                </TabsContent>

                {/* Shipping Policies Tab */}
                <TabsContent value="shipping" className="mt-0">
                  {loadingFulfillment ? (
                    <div className="flex justify-center p-8">
                      <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    </div>
                  ) : fulfillmentPolicies.length === 0 ? (
                    <CardContent className="text-center py-16">
                      <Truck className="h-16 w-16 mx-auto text-gray-400 mb-4" />
                      <h3 className="text-lg font-medium text-gray-900 dark:text-white">No Shipping Policies</h3>
                      <p className="text-gray-500 mt-1">Click "Sync from eBay" to import your existing policies</p>
                    </CardContent>
                  ) : (
                    <CardContent className="pt-0">
                      <div className="rounded-md border">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="font-semibold">Policy Name</TableHead>
                              <TableHead className="font-semibold">Description</TableHead>
                              <TableHead className="font-semibold">Marketplace</TableHead>
                              <TableHead className="font-semibold">Handling Time</TableHead>
                              <TableHead className="font-semibold">Global Shipping</TableHead>
                              <TableHead className="font-semibold">Shipping Options</TableHead>
                              <TableHead className="text-right font-semibold">Actions</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {fulfillmentPolicies.map((policy) => (
                              <FulfillmentPolicyCard
                                key={policy.policyId}
                                policy={policy}
                                onDelete={() => deleteFulfillmentPolicyMutation.mutate(policy.policyId)}
                                isDeleting={deleteFulfillmentPolicyMutation.isPending}
                              />
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </CardContent>
                  )}
                </TabsContent>

                {/* Return Policies Tab */}
                <TabsContent value="return" className="mt-0">
                  {loadingReturn ? (
                    <div className="flex justify-center p-8">
                      <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    </div>
                  ) : returnPolicies.length === 0 ? (
                    <CardContent className="text-center py-16">
                      <RotateCcw className="h-16 w-16 mx-auto text-gray-400 mb-4" />
                      <h3 className="text-lg font-medium text-gray-900 dark:text-white">No Return Policies</h3>
                      <p className="text-gray-500 mt-1">Click "Sync from eBay" to import your existing policies</p>
                    </CardContent>
                  ) : (
                    <CardContent className="pt-0">
                      <div className="rounded-md border">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="font-semibold">Policy Name</TableHead>
                              <TableHead className="font-semibold">Description</TableHead>
                              <TableHead className="font-semibold">Marketplace</TableHead>
                              <TableHead className="font-semibold">Returns Accepted</TableHead>
                              <TableHead className="font-semibold">Return Period</TableHead>
                              <TableHead className="font-semibold">Refund Method</TableHead>
                              <TableHead className="font-semibold">Shipping Paid By</TableHead>
                              <TableHead className="text-right font-semibold">Actions</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {returnPolicies.map((policy) => (
                              <ReturnPolicyCard
                                key={policy.policyId}
                                policy={policy}
                                onDelete={() => deleteReturnPolicyMutation.mutate(policy.policyId)}
                                isDeleting={deleteReturnPolicyMutation.isPending}
                              />
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </CardContent>
                  )}
                </TabsContent>
              </Tabs>
            </Card>
          </div>
        </main>
      </div>

      {/* Create Policy Dialogs - controlled by activeTab and isCreateDialogOpen */}
      <CreatePaymentPolicyDialog
        onSubmit={(data) => createPaymentPolicyMutation.mutate(data)}
        isPending={createPaymentPolicyMutation.isPending}
        open={isCreateDialogOpen && activeTab === 'payment'}
        onOpenChange={(open) => setIsCreateDialogOpen(open)}
      />
      <CreateFulfillmentPolicyDialog
        onSubmit={(data) => createFulfillmentPolicyMutation.mutate(data)}
        isPending={createFulfillmentPolicyMutation.isPending}
        open={isCreateDialogOpen && activeTab === 'shipping'}
        onOpenChange={(open) => setIsCreateDialogOpen(open)}
      />
      <CreateReturnPolicyDialog
        onSubmit={(data) => createReturnPolicyMutation.mutate(data)}
        isPending={createReturnPolicyMutation.isPending}
        open={isCreateDialogOpen && activeTab === 'return'}
        onOpenChange={(open) => setIsCreateDialogOpen(open)}
      />
    </div>
  );
}

// Payment Policy Row (for Table)
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
    <TableRow data-testid={`row-payment-policy-${policy.policyId}`}>
      <TableCell>
        <div className="flex items-center gap-2">
          <span className="font-medium">{policy.name}</span>
          {policy.syncedFromEbay ? (
            <Badge variant="outline" className="text-green-600 border-green-600 text-xs">
              <Cloud className="h-3 w-3 mr-1" />
              eBay
            </Badge>
          ) : (
            <Badge variant="outline" className="text-gray-600 text-xs">
              <HardDrive className="h-3 w-3 mr-1" />
              Local
            </Badge>
          )}
          {policy.isDefault && (
            <Badge className="bg-primary text-xs">Default</Badge>
          )}
        </div>
      </TableCell>
      <TableCell className="text-gray-500">{policy.description || "-"}</TableCell>
      <TableCell>{policy.marketplaceId}</TableCell>
      <TableCell>
        {policy.immediatePay ? (
          <CheckCircle className="h-4 w-4 text-green-500" />
        ) : (
          <XCircle className="h-4 w-4 text-red-500" />
        )}
      </TableCell>
      <TableCell>
        {paymentMethods.length > 0 ? paymentMethods.map((m: any) => m.paymentMethodType).join(", ") : "-"}
      </TableCell>
      <TableCell className="text-right">
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
      </TableCell>
    </TableRow>
  );
}

// Fulfillment Policy Row (for Table)
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
    <TableRow data-testid={`row-fulfillment-policy-${policy.policyId}`}>
      <TableCell>
        <div className="flex items-center gap-2">
          <span className="font-medium">{policy.name}</span>
          {policy.syncedFromEbay ? (
            <Badge variant="outline" className="text-green-600 border-green-600 text-xs">
              <Cloud className="h-3 w-3 mr-1" />
              eBay
            </Badge>
          ) : (
            <Badge variant="outline" className="text-gray-600 text-xs">
              <HardDrive className="h-3 w-3 mr-1" />
              Local
            </Badge>
          )}
          {policy.isDefault && (
            <Badge className="bg-primary text-xs">Default</Badge>
          )}
        </div>
      </TableCell>
      <TableCell className="text-gray-500">{policy.description || "-"}</TableCell>
      <TableCell>{policy.marketplaceId}</TableCell>
      <TableCell>{policy.handlingTime} day(s)</TableCell>
      <TableCell>
        {policy.globalShipping ? (
          <CheckCircle className="h-4 w-4 text-green-500" />
        ) : (
          <XCircle className="h-4 w-4 text-gray-400" />
        )}
      </TableCell>
      <TableCell>{shippingOptions.length} configured</TableCell>
      <TableCell className="text-right">
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
      </TableCell>
    </TableRow>
  );
}

// Return Policy Row (for Table)
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
    <TableRow data-testid={`row-return-policy-${policy.policyId}`}>
      <TableCell>
        <div className="flex items-center gap-2">
          <span className="font-medium">{policy.name}</span>
          {policy.syncedFromEbay ? (
            <Badge variant="outline" className="text-green-600 border-green-600 text-xs">
              <Cloud className="h-3 w-3 mr-1" />
              eBay
            </Badge>
          ) : (
            <Badge variant="outline" className="text-gray-600 text-xs">
              <HardDrive className="h-3 w-3 mr-1" />
              Local
            </Badge>
          )}
          {policy.isDefault && (
            <Badge className="bg-primary text-xs">Default</Badge>
          )}
        </div>
      </TableCell>
      <TableCell className="text-gray-500">{policy.description || "-"}</TableCell>
      <TableCell>{policy.marketplaceId}</TableCell>
      <TableCell>
        {policy.returnsAccepted ? (
          <CheckCircle className="h-4 w-4 text-green-500" />
        ) : (
          <XCircle className="h-4 w-4 text-red-500" />
        )}
      </TableCell>
      <TableCell>{policy.returnsAccepted ? `${policy.returnPeriod} days` : "-"}</TableCell>
      <TableCell>{policy.returnsAccepted ? policy.refundMethod?.replace(/_/g, " ") : "-"}</TableCell>
      <TableCell>{policy.returnsAccepted ? policy.returnShippingCostPayer : "-"}</TableCell>
      <TableCell className="text-right">
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
      </TableCell>
    </TableRow>
  );
}

// Create Payment Policy Dialog
function CreatePaymentPolicyDialog({ 
  onSubmit, 
  isPending,
  open,
  onOpenChange
}: { 
  onSubmit: (data: any) => void;
  isPending: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
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
    onOpenChange(false);
    setName("");
    setDescription("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!name || isPending} data-testid="button-submit-payment-policy">
            {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Create Policy
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Shipping service type
interface ShippingServiceOption {
  code: string;
  description: string;
  carrier: string;
  shippingTimeMin: number;
  shippingTimeMax: number;
}

// Create Fulfillment Policy Dialog
function CreateFulfillmentPolicyDialog({ 
  onSubmit, 
  isPending,
  open,
  onOpenChange
}: { 
  onSubmit: (data: any) => void;
  isPending: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [handlingTime, setHandlingTime] = useState(2);
  const [globalShipping, setGlobalShipping] = useState(false);
  const [createOnEbay, setCreateOnEbay] = useState(true);

  const [costType, setCostType] = useState("FLAT_RATE");
  const [shippingService, setShippingService] = useState("DE_DHLPaket");
  const [firstItemCost, setFirstItemCost] = useState("5.49");
  const [additionalItemCost, setAdditionalItemCost] = useState("1.00");
  const [freeShipping, setFreeShipping] = useState(false);

  const [internationalShipping, setInternationalShipping] = useState(false);
  const [intlShippingService, setIntlShippingService] = useState("DE_SonstigerVersandInternational");
  const [intlFirstItemCost, setIntlFirstItemCost] = useState("9.99");
  const [intlAdditionalItemCost, setIntlAdditionalItemCost] = useState("2.00");
  const [intlShipTo, setIntlShipTo] = useState("Europe");

  const [pickupDropOff, setPickupDropOff] = useState(false);

  // Fetch shipping services from eBay
  const { data: shippingServicesData, isLoading: loadingServices } = useQuery<{
    success: boolean;
    domestic: ShippingServiceOption[];
    international: ShippingServiceOption[];
  }>({
    queryKey: ["/api/ebay/shipping-services"],
    staleTime: 1000 * 60 * 60, // Cache for 1 hour
  });

  const domesticServices = shippingServicesData?.domestic || [];
  const internationalServices = shippingServicesData?.international || [];

  // Get carrier code from service code
  const getCarrierFromService = (serviceCode: string): string => {
    if (serviceCode.includes('DHL')) return 'DHL';
    if (serviceCode.includes('Hermes')) return 'Hermes';
    if (serviceCode.includes('DPD')) return 'DPD';
    if (serviceCode.includes('UPS')) return 'UPS';
    if (serviceCode.includes('FedEx')) return 'FedEx';
    if (serviceCode.includes('deutschePost') || serviceCode.includes('DeutschePost')) return 'Deutsche Post';
    return 'Other';
  };

  const handleSubmit = () => {
    const shippingOptions: any[] = [
      {
        optionType: "DOMESTIC",
        costType: costType,
        shippingServices: [
          {
            shippingCarrierCode: getCarrierFromService(shippingService),
            shippingServiceCode: shippingService,
            shippingCost: { value: freeShipping ? "0.00" : firstItemCost, currency: "EUR" },
            additionalShippingCost: { value: additionalItemCost, currency: "EUR" },
            freeShipping: freeShipping,
            sortOrder: 1
          }
        ]
      }
    ];

    // Countries to always exclude from shipping (Belarus due to shipping restrictions)
    const excludedCountries = [
      { regionName: "BY", regionType: "COUNTRY" }  // Belarus
    ];

    if (internationalShipping) {
      // Map destination region to eBay's supported region identifiers
      // eBay UK only accepts these predefined regions, not individual country codes
      const getRegionIncluded = (destination: string) => {
        if (destination === "Worldwide") {
          return [{ regionName: "Worldwide", regionType: "WORLDWIDE" }];
        }
        // For Europe and EU, use Europe region (covers all European countries)
        return [{ regionName: "Europe", regionType: "WORLD_REGION" }];
      };

      shippingOptions.push({
        optionType: "INTERNATIONAL",
        costType: "FLAT_RATE",
        shippingServices: [
          {
            shippingCarrierCode: getCarrierFromService(intlShippingService),
            shippingServiceCode: intlShippingService,
            shippingCost: { value: intlFirstItemCost, currency: "EUR" },
            additionalShippingCost: { value: intlAdditionalItemCost, currency: "EUR" },
            freeShipping: false,
            sortOrder: 1,
            shipToLocations: {
              regionIncluded: getRegionIncluded(intlShipTo),
              regionExcluded: excludedCountries
            }
          }
        ]
      });
    }

    // Policy-level ship-to locations (where items can be shipped)
    // Always exclude Belarus from all shipping policies
    const shipToLocations = {
      regionIncluded: internationalShipping 
        ? intlShipTo === "Worldwide"
          ? [{ regionName: "Worldwide", regionType: "WORLDWIDE" }]
          : [{ regionName: "Europe", regionType: "WORLD_REGION" }]
        : [{ regionName: "GB", regionType: "COUNTRY" }],
      regionExcluded: excludedCountries
    };

    onSubmit({
      name,
      description,
      handlingTime,
      globalShipping,
      createOnEbay,
      shippingOptions,
      shipToLocations,
      pickupDropOff,
    });
    onOpenChange(false);
    setName("");
    setDescription("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Shipping Policy</DialogTitle>
          <DialogDescription>
            Create a new shipping/fulfillment policy for your eBay listings
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-6">
          <div>
            <Label htmlFor="name">Policy Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Free Domestic Postage"
              data-testid="input-fulfillment-policy-name"
            />
          </div>
          <div>
            <Label htmlFor="description">Description (Optional)</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Additional text to help identify this policy..."
              data-testid="input-fulfillment-policy-description"
            />
          </div>

          <div className="border-t pt-4">
            <h4 className="font-semibold mb-3">Domestic Postage</h4>
            <div className="space-y-4">
              <div>
                <Label>Cost Type</Label>
                <Select value={costType} onValueChange={setCostType}>
                  <SelectTrigger data-testid="select-cost-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="FLAT_RATE">Flat: same cost to all buyers</SelectItem>
                    <SelectItem value="NOT_SPECIFIED">No postage: local pickup only</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {costType !== "NOT_SPECIFIED" && (
                <>
                  <div>
                    <Label>Postage Service</Label>
                    {loadingServices ? (
                      <div className="flex items-center gap-2 p-2 text-sm text-gray-500">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading services from eBay...
                      </div>
                    ) : (
                      <Select value={shippingService} onValueChange={setShippingService}>
                        <SelectTrigger data-testid="select-shipping-service">
                          <SelectValue placeholder="Select a postage service" />
                        </SelectTrigger>
                        <SelectContent className="max-h-80">
                          {domesticServices.length > 0 ? (
                            domesticServices.map((service) => (
                              <SelectItem key={service.code} value={service.code}>
                                {service.description} ({service.shippingTimeMin}-{service.shippingTimeMax} days)
                              </SelectItem>
                            ))
                          ) : (
                            <>
                              <SelectItem value="DE_DHLPaket">DHL Paket (1-2 Tage)</SelectItem>
                              <SelectItem value="DE_DHLPackchen">DHL Päckchen</SelectItem>
                              <SelectItem value="DE_deutschePostWarenpost">Deutsche Post Warenpost</SelectItem>
                              <SelectItem value="DE_DeutschePostBrief">Deutsche Post Brief</SelectItem>
                              <SelectItem value="DE_HermesPaket">Hermes Paket</SelectItem>
                              <SelectItem value="DE_DPDClassic">DPD Classic</SelectItem>
                              <SelectItem value="DE_GLSPaket">GLS Paket</SelectItem>
                              <SelectItem value="DE_SonstigeDomestic">Sonstiger Versand (Inland)</SelectItem>
                            </>
                          )}
                        </SelectContent>
                      </Select>
                    )}
                  </div>

                  <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                    <div>
                      <Label>Free Postage</Label>
                      <p className="text-sm text-gray-500">Offer free shipping to buyers</p>
                    </div>
                    <Switch
                      checked={freeShipping}
                      onCheckedChange={setFreeShipping}
                      data-testid="switch-free-shipping"
                    />
                  </div>

                  {!freeShipping && (
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label>Cost (First Item) £</Label>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={firstItemCost}
                          onChange={(e) => setFirstItemCost(e.target.value)}
                          placeholder="3.50"
                          data-testid="input-first-item-cost"
                        />
                      </div>
                      <div>
                        <Label>Each Additional Item £</Label>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={additionalItemCost}
                          onChange={(e) => setAdditionalItemCost(e.target.value)}
                          placeholder="0.50"
                          data-testid="input-additional-item-cost"
                        />
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="border-t pt-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h4 className="font-semibold">International Postage</h4>
                <p className="text-sm text-gray-500">Add postage services for international buyers</p>
              </div>
              <Switch
                checked={internationalShipping}
                onCheckedChange={setInternationalShipping}
                data-testid="switch-international-shipping"
              />
            </div>

            {internationalShipping && (
              <div className="space-y-4 pl-4 border-l-2 border-primary">
                <div>
                  <Label>Ship To</Label>
                  <Select value={intlShipTo} onValueChange={setIntlShipTo}>
                    <SelectTrigger data-testid="select-ship-to">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Europe">Europe</SelectItem>
                      <SelectItem value="EU">European Union (EU countries only)</SelectItem>
                      <SelectItem value="Worldwide">Worldwide</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>International Postage Service</Label>
                  {loadingServices ? (
                    <div className="flex items-center gap-2 p-2 text-sm text-gray-500">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading services from eBay...
                    </div>
                  ) : (
                    <Select value={intlShippingService} onValueChange={setIntlShippingService}>
                      <SelectTrigger data-testid="select-intl-service">
                        <SelectValue placeholder="Select an international postage service" />
                      </SelectTrigger>
                      <SelectContent className="max-h-80">
                        {internationalServices.length > 0 ? (
                          internationalServices.map((service) => (
                            <SelectItem key={service.code} value={service.code}>
                              {service.description} ({service.shippingTimeMin}-{service.shippingTimeMax} days)
                            </SelectItem>
                          ))
                        ) : (
                          <>
                            <SelectItem value="DE_SonstigerVersandInternational">Sonstiger Versand International</SelectItem>
                            <SelectItem value="DE_DHLPaketInternational">DHL Paket International</SelectItem>
                            <SelectItem value="DE_DHLPackchenInternational">DHL Päckchen International</SelectItem>
                            <SelectItem value="DE_deutschePostWarenpostInternational">Deutsche Post Warenpost International</SelectItem>
                            <SelectItem value="DE_DeutschePostBriefInternational">Deutsche Post Brief International</SelectItem>
                            <SelectItem value="DE_HermesPaketInternational">Hermes Paket International</SelectItem>
                          </>
                        )}
                      </SelectContent>
                    </Select>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Cost (First Item) £</Label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={intlFirstItemCost}
                      onChange={(e) => setIntlFirstItemCost(e.target.value)}
                      placeholder="9.99"
                      data-testid="input-intl-first-cost"
                    />
                  </div>
                  <div>
                    <Label>Each Additional Item £</Label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={intlAdditionalItemCost}
                      onChange={(e) => setIntlAdditionalItemCost(e.target.value)}
                      placeholder="2.00"
                      data-testid="input-intl-additional-cost"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="border-t pt-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-semibold">Collection in Person</h4>
                <p className="text-sm text-gray-500">Allow buyers to pick up items</p>
              </div>
              <Switch
                checked={pickupDropOff}
                onCheckedChange={setPickupDropOff}
                data-testid="switch-pickup"
              />
            </div>
          </div>

          <div className="border-t pt-4">
            <h4 className="font-semibold mb-3">Preferences</h4>
            <div className="space-y-4">
              <div>
                <Label htmlFor="handlingTime">Dispatch Time</Label>
                <Select value={String(handlingTime)} onValueChange={(v) => setHandlingTime(Number(v))}>
                  <SelectTrigger data-testid="select-handling-time">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">Same business day</SelectItem>
                    <SelectItem value="1">1 working day</SelectItem>
                    <SelectItem value="2">2 working days</SelectItem>
                    <SelectItem value="3">3 working days</SelectItem>
                    <SelectItem value="4">4 working days</SelectItem>
                    <SelectItem value="5">5 working days</SelectItem>
                    <SelectItem value="10">10 working days</SelectItem>
                    <SelectItem value="15">15 working days</SelectItem>
                    <SelectItem value="20">20 working days</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label>Global Shipping Program</Label>
                  <p className="text-sm text-gray-500">Let eBay handle international shipping</p>
                </div>
                <Switch
                  checked={globalShipping}
                  onCheckedChange={setGlobalShipping}
                  data-testid="switch-global-shipping"
                />
              </div>
            </div>
          </div>

          <div className="border-t pt-4">
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
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
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
  isPending,
  open,
  onOpenChange
}: { 
  onSubmit: (data: any) => void;
  isPending: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
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
    onOpenChange(false);
    setName("");
    setDescription("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!name || isPending} data-testid="button-submit-return-policy">
            {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Create Policy
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
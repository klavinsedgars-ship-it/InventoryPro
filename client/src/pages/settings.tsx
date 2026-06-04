import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { 
  Settings as SettingsIcon, 
  User, 
  ShoppingCart, 
  Store, 
  Database,
  Bell,
  Key,
  Save,
  LogOut,
  Percent
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface SettingsProps {
  user: any;
}

export function Settings({ user }: SettingsProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("profile");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Profile settings state
  const [profileData, setProfileData] = useState({
    username: user?.username || "",
    email: user?.email || "",
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });

  // eBay settings state
  const [ebaySettings, setEbaySettings] = useState({
    apiKey: "",
    secretKey: "",
    userToken: "",
    sandbox: true,
    autoSync: false,
    defaultShipping: "Standard",
    returnPolicy: "30 days",
  });

  // Amazon settings state
  const [amazonSettings, setAmazonSettings] = useState({
    sellerId: "",
    marketplaceId: "",
    accessKey: "",
    secretKey: "",
    region: "us-east-1",
    autoSync: false,
    fulfillmentType: "FBM",
  });

  // TME settings state
  const [tmeSettings, setTmeSettings] = useState({
    apiKey: "",
    secret: "",
    autoSync: true,
    syncInterval: "daily",
    markupPercentage: "25",
    minStock: "5",
  });

  // Notification settings
  const [notifications, setNotifications] = useState({
    lowStock: true,
    syncErrors: true,
    newOrders: true,
    priceChanges: false,
    emailNotifications: true,
    pushNotifications: false,
  });

  // Fees & Pricing settings (persisted via marketplaceSettings). Percent fields
  // are shown as whole percents but stored as fractions (12 <-> 0.12).
  const FEE_DEFAULTS = {
    fvfPct: "12",
    fixed: "0.35",
    vatPct: "21",
    packaging: "0.30",
    postageMarkup: "15",
    targetMinProfit: "4.00",
  };
  const [feeForm, setFeeForm] = useState(FEE_DEFAULTS);
  const pctFromFraction = (v?: string) =>
    v != null && v !== "" && !isNaN(parseFloat(v)) ? String(parseFloat(v) * 100) : undefined;

  const { data: feeSettingsData } = useQuery<{ settings: Array<{ setting: string; value: string }> }>({
    queryKey: ["/api/marketplace-settings/ebay"],
  });
  useEffect(() => {
    const rows = feeSettingsData?.settings;
    if (!rows) return;
    const get = (k: string) => rows.find((r) => r.setting === k)?.value;
    setFeeForm({
      fvfPct: pctFromFraction(get("fee.fvf_pct")) ?? FEE_DEFAULTS.fvfPct,
      fixed: get("fee.fixed") ?? FEE_DEFAULTS.fixed,
      vatPct: pctFromFraction(get("fee.vat_pct")) ?? FEE_DEFAULTS.vatPct,
      packaging: get("fee.packaging") ?? FEE_DEFAULTS.packaging,
      postageMarkup: pctFromFraction(get("fee.postage_markup")) ?? FEE_DEFAULTS.postageMarkup,
      targetMinProfit: get("fee.target_min_profit") ?? FEE_DEFAULTS.targetMinProfit,
    });
  }, [feeSettingsData]);

  const saveFeesMutation = useMutation({
    mutationFn: async () => {
      const settings = [
        { setting: "fee.fvf_pct", value: String((parseFloat(feeForm.fvfPct) || 0) / 100) },
        { setting: "fee.fixed", value: String(parseFloat(feeForm.fixed) || 0) },
        { setting: "fee.vat_pct", value: String((parseFloat(feeForm.vatPct) || 0) / 100) },
        { setting: "fee.packaging", value: String(parseFloat(feeForm.packaging) || 0) },
        { setting: "fee.postage_markup", value: String((parseFloat(feeForm.postageMarkup) || 0) / 100) },
        { setting: "fee.target_min_profit", value: String(parseFloat(feeForm.targetMinProfit) || 0) },
      ];
      const res = await apiRequest("PUT", "/api/marketplace-settings/ebay", { settings });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/marketplace-settings/ebay"] });
      toast({
        title: "Fees & Pricing saved",
        description: "New rates apply to future syncs and the per-product profit breakdown.",
      });
    },
    onError: () =>
      toast({ title: "Save failed", description: "Could not save fee settings.", variant: "destructive" }),
  });

  const handleLogout = async () => {
    try {
      await apiRequest("POST", "/api/auth/logout");
      window.location.reload();
    } catch (error) {
      toast({
        title: "Logout Failed",
        description: "Could not log out. Please try again.",
        variant: "destructive",
      });
    }
  };

  const saveProfileSettings = () => {
    toast({
      title: "Profile Updated",
      description: "Your profile settings have been saved successfully.",
    });
  };

  const saveEbaySettings = () => {
    toast({
      title: "eBay Settings Saved",
      description: "eBay marketplace settings have been updated.",
    });
  };

  const saveAmazonSettings = () => {
    toast({
      title: "Amazon Settings Saved", 
      description: "Amazon marketplace settings have been updated.",
    });
  };

  const saveTmeSettings = () => {
    toast({
      title: "TME Settings Saved",
      description: "TME supplier settings have been updated.",
    });
  };

  const saveNotificationSettings = () => {
    toast({
      title: "Notifications Updated",
      description: "Your notification preferences have been saved.",
    });
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar user={user} collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} />
      <div className={`transition-all duration-200 ${sidebarCollapsed ? 'ml-16' : 'ml-64'}`}>
        <Header 
          title="Settings" 
          subtitle="Manage your account, integrations, and preferences"
        />
        
        <div className="p-6">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
            <TabsList className="grid w-full grid-cols-6">
              <TabsTrigger value="profile" className="flex items-center space-x-2">
                <User className="w-4 h-4" />
                <span>Profile</span>
              </TabsTrigger>
              <TabsTrigger value="ebay" className="flex items-center space-x-2">
                <ShoppingCart className="w-4 h-4" />
                <span>eBay</span>
              </TabsTrigger>
              <TabsTrigger value="amazon" className="flex items-center space-x-2">
                <Store className="w-4 h-4" />
                <span>Amazon</span>
              </TabsTrigger>
              <TabsTrigger value="tme" className="flex items-center space-x-2">
                <Database className="w-4 h-4" />
                <span>TME</span>
              </TabsTrigger>
              <TabsTrigger value="fees" className="flex items-center space-x-2">
                <Percent className="w-4 h-4" />
                <span>Fees</span>
              </TabsTrigger>
              <TabsTrigger value="notifications" className="flex items-center space-x-2">
                <Bell className="w-4 h-4" />
                <span>Notifications</span>
              </TabsTrigger>
            </TabsList>

            {/* Profile Settings */}
            <TabsContent value="profile" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center space-x-2">
                    <User className="w-5 h-5" />
                    <span>Account Information</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="username">Username</Label>
                      <Input
                        id="username"
                        value={profileData.username}
                        onChange={(e) => setProfileData({...profileData, username: e.target.value})}
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label htmlFor="email">Email</Label>
                      <Input
                        id="email"
                        type="email"
                        value={profileData.email}
                        onChange={(e) => setProfileData({...profileData, email: e.target.value})}
                        className="mt-1"
                      />
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between pt-4 border-t border-gray-200">
                    <Badge variant="secondary" className="bg-blue-100 text-blue-800">
                      Role: {user?.role || "User"}
                    </Badge>
                    <div className="flex space-x-3">
                      <Button onClick={saveProfileSettings}>
                        <Save className="w-4 h-4 mr-2" />
                        Save Changes
                      </Button>
                      <Button variant="outline" onClick={handleLogout}>
                        <LogOut className="w-4 h-4 mr-2" />
                        Logout
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center space-x-2">
                    <Key className="w-5 h-5" />
                    <span>Change Password</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label htmlFor="currentPassword">Current Password</Label>
                    <Input
                      id="currentPassword"
                      type="password"
                      value={profileData.currentPassword}
                      onChange={(e) => setProfileData({...profileData, currentPassword: e.target.value})}
                      className="mt-1"
                    />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="newPassword">New Password</Label>
                      <Input
                        id="newPassword"
                        type="password"
                        value={profileData.newPassword}
                        onChange={(e) => setProfileData({...profileData, newPassword: e.target.value})}
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label htmlFor="confirmPassword">Confirm Password</Label>
                      <Input
                        id="confirmPassword"
                        type="password"
                        value={profileData.confirmPassword}
                        onChange={(e) => setProfileData({...profileData, confirmPassword: e.target.value})}
                        className="mt-1"
                      />
                    </div>
                  </div>
                  <Button>Update Password</Button>
                </CardContent>
              </Card>
            </TabsContent>

            {/* eBay Settings */}
            <TabsContent value="ebay" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center space-x-2">
                    <ShoppingCart className="w-5 h-5" />
                    <span>eBay API Configuration</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="ebayApiKey">API Key</Label>
                      <Input
                        id="ebayApiKey"
                        type="password"
                        value={ebaySettings.apiKey}
                        onChange={(e) => setEbaySettings({...ebaySettings, apiKey: e.target.value})}
                        placeholder="Enter your eBay API key"
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label htmlFor="ebaySecretKey">Secret Key</Label>
                      <Input
                        id="ebaySecretKey"
                        type="password"
                        value={ebaySettings.secretKey}
                        onChange={(e) => setEbaySettings({...ebaySettings, secretKey: e.target.value})}
                        placeholder="Enter your eBay secret key"
                        className="mt-1"
                      />
                    </div>
                  </div>
                  
                  <div>
                    <Label htmlFor="ebayUserToken">User Token</Label>
                    <Input
                      id="ebayUserToken"
                      type="password"
                      value={ebaySettings.userToken}
                      onChange={(e) => setEbaySettings({...ebaySettings, userToken: e.target.value})}
                      placeholder="Enter your eBay user token"
                      className="mt-1"
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="space-y-2">
                      <Label>Sandbox Mode</Label>
                      <p className="text-sm text-gray-600">Use eBay sandbox environment for testing</p>
                    </div>
                    <Switch
                      checked={ebaySettings.sandbox}
                      onCheckedChange={(checked) => setEbaySettings({...ebaySettings, sandbox: checked})}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="space-y-2">
                      <Label>Auto Sync</Label>
                      <p className="text-sm text-gray-600">Automatically sync inventory with eBay</p>
                    </div>
                    <Switch
                      checked={ebaySettings.autoSync}
                      onCheckedChange={(checked) => setEbaySettings({...ebaySettings, autoSync: checked})}
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="defaultShipping">Default Shipping</Label>
                      <Select 
                        value={ebaySettings.defaultShipping} 
                        onValueChange={(value) => setEbaySettings({...ebaySettings, defaultShipping: value})}
                      >
                        <SelectTrigger className="mt-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Standard">Standard Shipping</SelectItem>
                          <SelectItem value="Expedited">Expedited Shipping</SelectItem>
                          <SelectItem value="Economy">Economy Shipping</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="returnPolicy">Return Policy</Label>
                      <Select 
                        value={ebaySettings.returnPolicy} 
                        onValueChange={(value) => setEbaySettings({...ebaySettings, returnPolicy: value})}
                      >
                        <SelectTrigger className="mt-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="30 days">30 Days</SelectItem>
                          <SelectItem value="60 days">60 Days</SelectItem>
                          <SelectItem value="No returns">No Returns</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <Button onClick={saveEbaySettings}>
                    <Save className="w-4 h-4 mr-2" />
                    Save eBay Settings
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Amazon Settings */}
            <TabsContent value="amazon" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center space-x-2">
                    <Store className="w-5 h-5" />
                    <span>Amazon SP-API Configuration</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="sellerId">Seller ID</Label>
                      <Input
                        id="sellerId"
                        value={amazonSettings.sellerId}
                        onChange={(e) => setAmazonSettings({...amazonSettings, sellerId: e.target.value})}
                        placeholder="Enter your Amazon Seller ID"
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label htmlFor="marketplaceId">Marketplace ID</Label>
                      <Input
                        id="marketplaceId"
                        value={amazonSettings.marketplaceId}
                        onChange={(e) => setAmazonSettings({...amazonSettings, marketplaceId: e.target.value})}
                        placeholder="e.g., ATVPDKIKX0DER (US)"
                        className="mt-1"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="amazonAccessKey">Access Key ID</Label>
                      <Input
                        id="amazonAccessKey"
                        type="password"
                        value={amazonSettings.accessKey}
                        onChange={(e) => setAmazonSettings({...amazonSettings, accessKey: e.target.value})}
                        placeholder="Enter AWS Access Key ID"
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label htmlFor="amazonSecretKey">Secret Access Key</Label>
                      <Input
                        id="amazonSecretKey"
                        type="password"
                        value={amazonSettings.secretKey}
                        onChange={(e) => setAmazonSettings({...amazonSettings, secretKey: e.target.value})}
                        placeholder="Enter AWS Secret Access Key"
                        className="mt-1"
                      />
                    </div>
                  </div>

                  <div>
                    <Label htmlFor="region">AWS Region</Label>
                    <Select 
                      value={amazonSettings.region} 
                      onValueChange={(value) => setAmazonSettings({...amazonSettings, region: value})}
                    >
                      <SelectTrigger className="mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="us-east-1">US East (N. Virginia)</SelectItem>
                        <SelectItem value="us-west-2">US West (Oregon)</SelectItem>
                        <SelectItem value="eu-west-1">Europe (Ireland)</SelectItem>
                        <SelectItem value="ap-southeast-1">Asia Pacific (Singapore)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="space-y-2">
                      <Label>Auto Sync</Label>
                      <p className="text-sm text-gray-600">Automatically sync inventory with Amazon</p>
                    </div>
                    <Switch
                      checked={amazonSettings.autoSync}
                      onCheckedChange={(checked) => setAmazonSettings({...amazonSettings, autoSync: checked})}
                    />
                  </div>

                  <div>
                    <Label htmlFor="fulfillmentType">Fulfillment Type</Label>
                    <Select 
                      value={amazonSettings.fulfillmentType} 
                      onValueChange={(value) => setAmazonSettings({...amazonSettings, fulfillmentType: value})}
                    >
                      <SelectTrigger className="mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="FBM">Fulfilled by Merchant (FBM)</SelectItem>
                        <SelectItem value="FBA">Fulfilled by Amazon (FBA)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <Button onClick={saveAmazonSettings}>
                    <Save className="w-4 h-4 mr-2" />
                    Save Amazon Settings
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>

            {/* TME Settings */}
            <TabsContent value="tme" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center space-x-2">
                    <Database className="w-5 h-5" />
                    <span>TME Supplier Configuration</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="tmeApiKey">API Key</Label>
                      <Input
                        id="tmeApiKey"
                        type="password"
                        value={tmeSettings.apiKey}
                        onChange={(e) => setTmeSettings({...tmeSettings, apiKey: e.target.value})}
                        placeholder="Enter your TME API key"
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label htmlFor="tmeSecret">API Secret</Label>
                      <Input
                        id="tmeSecret"
                        type="password"
                        value={tmeSettings.secret}
                        onChange={(e) => setTmeSettings({...tmeSettings, secret: e.target.value})}
                        placeholder="Enter your TME API secret"
                        className="mt-1"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="space-y-2">
                      <Label>Auto Sync</Label>
                      <p className="text-sm text-gray-600">Automatically sync product data from TME</p>
                    </div>
                    <Switch
                      checked={tmeSettings.autoSync}
                      onCheckedChange={(checked) => setTmeSettings({...tmeSettings, autoSync: checked})}
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <Label htmlFor="syncInterval">Sync Interval</Label>
                      <Select 
                        value={tmeSettings.syncInterval} 
                        onValueChange={(value) => setTmeSettings({...tmeSettings, syncInterval: value})}
                      >
                        <SelectTrigger className="mt-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="hourly">Hourly</SelectItem>
                          <SelectItem value="daily">Daily</SelectItem>
                          <SelectItem value="weekly">Weekly</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="markupPercentage">Markup Percentage</Label>
                      <Input
                        id="markupPercentage"
                        type="number"
                        value={tmeSettings.markupPercentage}
                        onChange={(e) => setTmeSettings({...tmeSettings, markupPercentage: e.target.value})}
                        placeholder="25"
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label htmlFor="minStock">Minimum Stock</Label>
                      <Input
                        id="minStock"
                        type="number"
                        value={tmeSettings.minStock}
                        onChange={(e) => setTmeSettings({...tmeSettings, minStock: e.target.value})}
                        placeholder="5"
                        className="mt-1"
                      />
                    </div>
                  </div>

                  <Button onClick={saveTmeSettings}>
                    <Save className="w-4 h-4 mr-2" />
                    Save TME Settings
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Notification Settings */}
            <TabsContent value="notifications" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center space-x-2">
                    <Bell className="w-5 h-5" />
                    <span>Notification Preferences</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="space-y-1">
                        <Label>Low Stock Alerts</Label>
                        <p className="text-sm text-gray-600">Get notified when products are running low</p>
                      </div>
                      <Switch
                        checked={notifications.lowStock}
                        onCheckedChange={(checked) => setNotifications({...notifications, lowStock: checked})}
                      />
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="space-y-1">
                        <Label>Sync Errors</Label>
                        <p className="text-sm text-gray-600">Get notified when sync operations fail</p>
                      </div>
                      <Switch
                        checked={notifications.syncErrors}
                        onCheckedChange={(checked) => setNotifications({...notifications, syncErrors: checked})}
                      />
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="space-y-1">
                        <Label>New Orders</Label>
                        <p className="text-sm text-gray-600">Get notified about new marketplace orders</p>
                      </div>
                      <Switch
                        checked={notifications.newOrders}
                        onCheckedChange={(checked) => setNotifications({...notifications, newOrders: checked})}
                      />
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="space-y-1">
                        <Label>Price Changes</Label>
                        <p className="text-sm text-gray-600">Get notified when supplier prices change</p>
                      </div>
                      <Switch
                        checked={notifications.priceChanges}
                        onCheckedChange={(checked) => setNotifications({...notifications, priceChanges: checked})}
                      />
                    </div>
                  </div>

                  <div className="border-t pt-6">
                    <h4 className="text-sm font-medium text-gray-900 mb-4">Delivery Methods</h4>
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="space-y-1">
                          <Label>Email Notifications</Label>
                          <p className="text-sm text-gray-600">Receive notifications via email</p>
                        </div>
                        <Switch
                          checked={notifications.emailNotifications}
                          onCheckedChange={(checked) => setNotifications({...notifications, emailNotifications: checked})}
                        />
                      </div>

                      <div className="flex items-center justify-between">
                        <div className="space-y-1">
                          <Label>Push Notifications</Label>
                          <p className="text-sm text-gray-600">Receive browser push notifications</p>
                        </div>
                        <Switch
                          checked={notifications.pushNotifications}
                          onCheckedChange={(checked) => setNotifications({...notifications, pushNotifications: checked})}
                        />
                      </div>
                    </div>
                  </div>

                  <Button onClick={saveNotificationSettings}>
                    <Save className="w-4 h-4 mr-2" />
                    Save Notification Settings
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Fees & Pricing Settings */}
            <TabsContent value="fees" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center space-x-2">
                    <Percent className="w-5 h-5" />
                    <span>Fees &amp; Pricing (eBay)</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <p className="text-sm text-gray-600">
                    These drive the real net-profit calculation and the price floor.
                    Every listing is priced to net at least the target profit after
                    these fees + VAT.
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>eBay Final Value Fee (%)</Label>
                      <Input
                        type="number"
                        step="0.1"
                        value={feeForm.fvfPct}
                        onChange={(e) => setFeeForm({ ...feeForm, fvfPct: e.target.value })}
                      />
                      <p className="text-xs text-gray-500">% of item + shipping.</p>
                    </div>
                    <div className="space-y-2">
                      <Label>Fixed fee per order (€)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={feeForm.fixed}
                        onChange={(e) => setFeeForm({ ...feeForm, fixed: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>VAT (%)</Label>
                      <Input
                        type="number"
                        step="0.1"
                        value={feeForm.vatPct}
                        onChange={(e) => setFeeForm({ ...feeForm, vatPct: e.target.value })}
                      />
                      <p className="text-xs text-gray-500">VAT-inclusive sale price (LV 21%).</p>
                    </div>
                    <div className="space-y-2">
                      <Label>Packaging cost per order (€)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={feeForm.packaging}
                        onChange={(e) => setFeeForm({ ...feeForm, packaging: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Postage markup (%)</Label>
                      <Input
                        type="number"
                        step="0.1"
                        value={feeForm.postageMarkup}
                        onChange={(e) => setFeeForm({ ...feeForm, postageMarkup: e.target.value })}
                      />
                      <p className="text-xs text-gray-500">
                        Buyer shipping includes this markup over carrier cost.
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label>Target minimum net profit (€)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={feeForm.targetMinProfit}
                        onChange={(e) => setFeeForm({ ...feeForm, targetMinProfit: e.target.value })}
                      />
                      <p className="text-xs text-gray-500">
                        Cheap items are priced up to guarantee this net profit.
                      </p>
                    </div>
                  </div>

                  <Button onClick={() => saveFeesMutation.mutate()} disabled={saveFeesMutation.isPending}>
                    <Save className="w-4 h-4 mr-2" />
                    {saveFeesMutation.isPending ? "Saving…" : "Save Fees & Pricing"}
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
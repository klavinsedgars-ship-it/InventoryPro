// eBay Account API Service - Manages Business Policies via REST API
// Uses OAuth 2.0 for authentication with sell.account scope
// IMPORTANT: Requires separate OAuth credentials from Trading API
// - EBAY_OAUTH_CLIENT_ID: OAuth App Client ID
// - EBAY_OAUTH_CLIENT_SECRET: OAuth App Client Secret
// - EBAY_OAUTH_REFRESH_TOKEN: OAuth Refresh Token with sell.account scope

import { storage } from "./storage";
import type { 
  InsertEbayPaymentPolicy, 
  InsertEbayFulfillmentPolicy, 
  InsertEbayReturnPolicy,
  EbayPaymentPolicy,
  EbayFulfillmentPolicy,
  EbayReturnPolicy
} from "@shared/schema";

interface EbayAccountApiConfig {
  marketplaceId: string;
  accessToken: string;
}

interface EbayApiError {
  errors?: Array<{
    errorId: number;
    domain: string;
    category: string;
    message: string;
    longMessage?: string;
  }>;
}

interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
}

// eBay Account API Response Types
interface EbayPaymentPolicyResponse {
  paymentPolicyId: string;
  name: string;
  description?: string;
  marketplaceId: string;
  categoryTypes?: Array<{ name: string }>;
  paymentMethods?: Array<{ paymentMethodType: string }>;
  immediatePay?: boolean;
}

interface EbayFulfillmentPolicyResponse {
  fulfillmentPolicyId: string;
  name: string;
  description?: string;
  marketplaceId: string;
  categoryTypes?: Array<{ name: string }>;
  handlingTime?: { value: number; unit: string };
  shippingOptions?: Array<{
    optionType: string;
    costType: string;
    shippingServices?: Array<{
      shippingCarrierCode: string;
      shippingServiceCode: string;
      shippingCost?: { value: string; currency: string };
      freeShipping?: boolean;
      sortOrder?: number;
    }>;
  }>;
  shipToLocations?: {
    regionIncluded?: Array<{ regionName: string; regionType: string }>;
    regionExcluded?: Array<{ regionName: string; regionType: string }>;
  };
  globalShipping?: boolean;
  pickupDropOff?: boolean;
  freightShipping?: boolean;
}

interface EbayReturnPolicyResponse {
  returnPolicyId: string;
  name: string;
  description?: string;
  marketplaceId: string;
  categoryTypes?: Array<{ name: string }>;
  returnsAccepted: boolean;
  returnPeriod?: { value: number; unit: string };
  refundMethod?: string;
  returnShippingCostPayer?: string;
  restockingFeePercentage?: string;
}

export class EbayAccountApiService {
  private baseUrl = "https://api.ebay.com";
  private sandboxUrl = "https://api.sandbox.ebay.com";
  private isProduction = true;
  private defaultMarketplaceId = "EBAY_GB"; // UK marketplace
  
  // OAuth token cache
  private cachedAccessToken: string | null = null;
  private tokenExpiresAt: number = 0;
  private oauthConfigured = false;

  constructor() {
    // Check if OAuth credentials are configured
    const clientId = process.env.EBAY_OAUTH_CLIENT_ID;
    const clientSecret = process.env.EBAY_OAUTH_CLIENT_SECRET;
    const refreshToken = process.env.EBAY_OAUTH_REFRESH_TOKEN;
    
    this.oauthConfigured = !!(clientId && clientSecret && refreshToken);
    
    if (this.oauthConfigured) {
      console.log("✅ eBay Account API Service initialized");
      console.log("   OAuth credentials configured for Account API");
    } else {
      console.log("⚠️ eBay Account API Service initialized (OAuth not configured)");
      console.log("   Set EBAY_OAUTH_CLIENT_ID, EBAY_OAUTH_CLIENT_SECRET, EBAY_OAUTH_REFRESH_TOKEN");
      console.log("   to enable business policy management");
    }
  }

  public isConfigured(): boolean {
    return this.oauthConfigured;
  }

  private getApiUrl(): string {
    return this.isProduction ? this.baseUrl : this.sandboxUrl;
  }

  private async getAccessToken(): Promise<string> {
    // Check if OAuth is configured
    if (!this.oauthConfigured) {
      throw new Error(
        "eBay OAuth not configured. Set EBAY_OAUTH_CLIENT_ID, EBAY_OAUTH_CLIENT_SECRET, and EBAY_OAUTH_REFRESH_TOKEN environment variables."
      );
    }

    // Return cached token if still valid (with 5 minute buffer)
    if (this.cachedAccessToken && Date.now() < this.tokenExpiresAt - 300000) {
      return this.cachedAccessToken;
    }

    // Refresh the access token
    const clientId = process.env.EBAY_OAUTH_CLIENT_ID!;
    const clientSecret = process.env.EBAY_OAUTH_CLIENT_SECRET!;
    const refreshToken = process.env.EBAY_OAUTH_REFRESH_TOKEN!;

    const authUrl = this.isProduction 
      ? "https://api.ebay.com/identity/v1/oauth2/token"
      : "https://api.sandbox.ebay.com/identity/v1/oauth2/token";

    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    try {
      console.log("🔄 Refreshing eBay OAuth access token...");
      
      const response = await fetch(authUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Authorization": `Basic ${credentials}`
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          scope: "https://api.ebay.com/oauth/api_scope/sell.account"
        }).toString()
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("❌ OAuth token refresh failed:", errorText);
        throw new Error(`OAuth token refresh failed: ${response.status} ${errorText}`);
      }

      const tokenData: OAuthTokenResponse = await response.json();
      
      // Cache the token
      this.cachedAccessToken = tokenData.access_token;
      this.tokenExpiresAt = Date.now() + (tokenData.expires_in * 1000);
      
      console.log("✅ OAuth access token refreshed successfully");
      console.log(`   Token expires in: ${tokenData.expires_in} seconds`);
      
      return this.cachedAccessToken;
    } catch (error) {
      console.error("❌ Failed to refresh OAuth token:", error);
      throw error;
    }
  }

  private async makeRequest<T>(
    method: string,
    endpoint: string,
    body?: any
  ): Promise<T> {
    const accessToken = await this.getAccessToken();
    const url = `${this.getApiUrl()}${endpoint}`;

    console.log(`📡 eBay Account API: ${method} ${endpoint}`);

    const headers: Record<string, string> = {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
      "Content-Language": "en-GB",
      "Accept-Language": "en-GB"
    };

    const options: RequestInit = {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    };

    try {
      const response = await fetch(url, options);
      
      // Track API usage
      await storage.trackApiCall("ebay");

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ eBay Account API Error: ${response.status} ${response.statusText}`);
        console.error(`   Response: ${errorText}`);
        
        let errorData: EbayApiError = {};
        try {
          errorData = JSON.parse(errorText);
        } catch {
          // Not JSON, use text directly
        }

        const errorMessage = errorData.errors?.[0]?.longMessage || 
                            errorData.errors?.[0]?.message || 
                            errorText;
        throw new Error(`eBay API Error (${response.status}): ${errorMessage}`);
      }

      // Handle 204 No Content
      if (response.status === 204) {
        return {} as T;
      }

      const data = await response.json();
      return data as T;
    } catch (error) {
      console.error(`❌ eBay Account API Request Failed:`, error);
      throw error;
    }
  }

  // ==========================================
  // PAYMENT POLICIES
  // ==========================================

  async getPaymentPolicies(marketplaceId?: string): Promise<EbayPaymentPolicyResponse[]> {
    const marketplace = marketplaceId || this.defaultMarketplaceId;
    try {
      const response = await this.makeRequest<{ paymentPolicies?: EbayPaymentPolicyResponse[] }>(
        "GET",
        `/sell/account/v1/payment_policy?marketplace_id=${marketplace}`
      );
      return response.paymentPolicies || [];
    } catch (error) {
      console.error("Failed to get payment policies:", error);
      return [];
    }
  }

  async getPaymentPolicy(policyId: string): Promise<EbayPaymentPolicyResponse | null> {
    try {
      return await this.makeRequest<EbayPaymentPolicyResponse>(
        "GET",
        `/sell/account/v1/payment_policy/${policyId}`
      );
    } catch (error) {
      console.error(`Failed to get payment policy ${policyId}:`, error);
      return null;
    }
  }

  async createPaymentPolicy(policy: {
    name: string;
    description?: string;
    marketplaceId?: string;
    categoryTypes?: Array<{ name: string }>;
    paymentMethods?: Array<{ paymentMethodType: string }>;
    immediatePay?: boolean;
  }): Promise<EbayPaymentPolicyResponse | null> {
    try {
      const requestBody = {
        name: policy.name,
        description: policy.description,
        marketplaceId: policy.marketplaceId || this.defaultMarketplaceId,
        categoryTypes: policy.categoryTypes || [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES" }],
        paymentMethods: policy.paymentMethods || [{ paymentMethodType: "PAYPAL" }],
        immediatePay: policy.immediatePay ?? true
      };

      return await this.makeRequest<EbayPaymentPolicyResponse>(
        "POST",
        "/sell/account/v1/payment_policy",
        requestBody
      );
    } catch (error) {
      console.error("Failed to create payment policy:", error);
      return null;
    }
  }

  async updatePaymentPolicy(policyId: string, policy: {
    name?: string;
    description?: string;
    paymentMethods?: Array<{ paymentMethodType: string }>;
    immediatePay?: boolean;
  }): Promise<EbayPaymentPolicyResponse | null> {
    try {
      // First get the existing policy
      const existing = await this.getPaymentPolicy(policyId);
      if (!existing) {
        throw new Error(`Payment policy ${policyId} not found`);
      }

      const requestBody = {
        ...existing,
        ...policy,
        paymentPolicyId: policyId
      };

      return await this.makeRequest<EbayPaymentPolicyResponse>(
        "PUT",
        `/sell/account/v1/payment_policy/${policyId}`,
        requestBody
      );
    } catch (error) {
      console.error(`Failed to update payment policy ${policyId}:`, error);
      return null;
    }
  }

  async deletePaymentPolicy(policyId: string): Promise<boolean> {
    try {
      await this.makeRequest<void>(
        "DELETE",
        `/sell/account/v1/payment_policy/${policyId}`
      );
      return true;
    } catch (error) {
      console.error(`Failed to delete payment policy ${policyId}:`, error);
      return false;
    }
  }

  // ==========================================
  // FULFILLMENT (SHIPPING) POLICIES
  // ==========================================

  async getFulfillmentPolicies(marketplaceId?: string): Promise<EbayFulfillmentPolicyResponse[]> {
    const marketplace = marketplaceId || this.defaultMarketplaceId;
    try {
      const response = await this.makeRequest<{ fulfillmentPolicies?: EbayFulfillmentPolicyResponse[] }>(
        "GET",
        `/sell/account/v1/fulfillment_policy?marketplace_id=${marketplace}`
      );
      return response.fulfillmentPolicies || [];
    } catch (error) {
      console.error("Failed to get fulfillment policies:", error);
      return [];
    }
  }

  async getFulfillmentPolicy(policyId: string): Promise<EbayFulfillmentPolicyResponse | null> {
    try {
      return await this.makeRequest<EbayFulfillmentPolicyResponse>(
        "GET",
        `/sell/account/v1/fulfillment_policy/${policyId}`
      );
    } catch (error) {
      console.error(`Failed to get fulfillment policy ${policyId}:`, error);
      return null;
    }
  }

  async createFulfillmentPolicy(policy: {
    name: string;
    description?: string;
    marketplaceId?: string;
    categoryTypes?: Array<{ name: string }>;
    handlingTime?: { value: number; unit: string };
    shippingOptions?: Array<{
      optionType: string;
      costType: string;
      shippingServices?: Array<{
        shippingCarrierCode: string;
        shippingServiceCode: string;
        shippingCost?: { value: string; currency: string };
        freeShipping?: boolean;
        sortOrder?: number;
      }>;
    }>;
    shipToLocations?: {
      regionIncluded?: Array<{ regionName: string; regionType: string }>;
    };
    globalShipping?: boolean;
  }): Promise<EbayFulfillmentPolicyResponse | null> {
    try {
      const requestBody = {
        name: policy.name,
        description: policy.description,
        marketplaceId: policy.marketplaceId || this.defaultMarketplaceId,
        categoryTypes: policy.categoryTypes || [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES" }],
        handlingTime: policy.handlingTime || { value: 1, unit: "DAY" },
        shippingOptions: policy.shippingOptions || [
          {
            optionType: "DOMESTIC",
            costType: "FLAT_RATE",
            shippingServices: [
              {
                shippingCarrierCode: "Royal Mail",
                shippingServiceCode: "UK_RoyalMailSecondClassStandard",
                shippingCost: { value: "0.00", currency: "GBP" },
                freeShipping: true,
                sortOrder: 1
              }
            ]
          }
        ],
        shipToLocations: policy.shipToLocations || {
          regionIncluded: [{ regionName: "United Kingdom", regionType: "COUNTRY" }]
        },
        globalShipping: policy.globalShipping || false
      };

      return await this.makeRequest<EbayFulfillmentPolicyResponse>(
        "POST",
        "/sell/account/v1/fulfillment_policy",
        requestBody
      );
    } catch (error) {
      console.error("Failed to create fulfillment policy:", error);
      return null;
    }
  }

  async updateFulfillmentPolicy(policyId: string, policy: {
    name?: string;
    description?: string;
    handlingTime?: { value: number; unit: string };
    shippingOptions?: Array<any>;
    globalShipping?: boolean;
  }): Promise<EbayFulfillmentPolicyResponse | null> {
    try {
      const existing = await this.getFulfillmentPolicy(policyId);
      if (!existing) {
        throw new Error(`Fulfillment policy ${policyId} not found`);
      }

      const requestBody = {
        ...existing,
        ...policy,
        fulfillmentPolicyId: policyId
      };

      return await this.makeRequest<EbayFulfillmentPolicyResponse>(
        "PUT",
        `/sell/account/v1/fulfillment_policy/${policyId}`,
        requestBody
      );
    } catch (error) {
      console.error(`Failed to update fulfillment policy ${policyId}:`, error);
      return null;
    }
  }

  async deleteFulfillmentPolicy(policyId: string): Promise<boolean> {
    try {
      await this.makeRequest<void>(
        "DELETE",
        `/sell/account/v1/fulfillment_policy/${policyId}`
      );
      return true;
    } catch (error) {
      console.error(`Failed to delete fulfillment policy ${policyId}:`, error);
      return false;
    }
  }

  // ==========================================
  // RETURN POLICIES
  // ==========================================

  async getReturnPolicies(marketplaceId?: string): Promise<EbayReturnPolicyResponse[]> {
    const marketplace = marketplaceId || this.defaultMarketplaceId;
    try {
      const response = await this.makeRequest<{ returnPolicies?: EbayReturnPolicyResponse[] }>(
        "GET",
        `/sell/account/v1/return_policy?marketplace_id=${marketplace}`
      );
      return response.returnPolicies || [];
    } catch (error) {
      console.error("Failed to get return policies:", error);
      return [];
    }
  }

  async getReturnPolicy(policyId: string): Promise<EbayReturnPolicyResponse | null> {
    try {
      return await this.makeRequest<EbayReturnPolicyResponse>(
        "GET",
        `/sell/account/v1/return_policy/${policyId}`
      );
    } catch (error) {
      console.error(`Failed to get return policy ${policyId}:`, error);
      return null;
    }
  }

  async createReturnPolicy(policy: {
    name: string;
    description?: string;
    marketplaceId?: string;
    categoryTypes?: Array<{ name: string }>;
    returnsAccepted: boolean;
    returnPeriod?: { value: number; unit: string };
    refundMethod?: string;
    returnShippingCostPayer?: string;
  }): Promise<EbayReturnPolicyResponse | null> {
    try {
      const requestBody = {
        name: policy.name,
        description: policy.description,
        marketplaceId: policy.marketplaceId || this.defaultMarketplaceId,
        categoryTypes: policy.categoryTypes || [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES" }],
        returnsAccepted: policy.returnsAccepted,
        returnPeriod: policy.returnsAccepted ? (policy.returnPeriod || { value: 30, unit: "DAY" }) : undefined,
        refundMethod: policy.returnsAccepted ? (policy.refundMethod || "MONEY_BACK") : undefined,
        returnShippingCostPayer: policy.returnsAccepted ? (policy.returnShippingCostPayer || "BUYER") : undefined
      };

      return await this.makeRequest<EbayReturnPolicyResponse>(
        "POST",
        "/sell/account/v1/return_policy",
        requestBody
      );
    } catch (error) {
      console.error("Failed to create return policy:", error);
      return null;
    }
  }

  async updateReturnPolicy(policyId: string, policy: {
    name?: string;
    description?: string;
    returnsAccepted?: boolean;
    returnPeriod?: { value: number; unit: string };
    refundMethod?: string;
    returnShippingCostPayer?: string;
  }): Promise<EbayReturnPolicyResponse | null> {
    try {
      const existing = await this.getReturnPolicy(policyId);
      if (!existing) {
        throw new Error(`Return policy ${policyId} not found`);
      }

      const requestBody = {
        ...existing,
        ...policy,
        returnPolicyId: policyId
      };

      return await this.makeRequest<EbayReturnPolicyResponse>(
        "PUT",
        `/sell/account/v1/return_policy/${policyId}`,
        requestBody
      );
    } catch (error) {
      console.error(`Failed to update return policy ${policyId}:`, error);
      return null;
    }
  }

  async deleteReturnPolicy(policyId: string): Promise<boolean> {
    try {
      await this.makeRequest<void>(
        "DELETE",
        `/sell/account/v1/return_policy/${policyId}`
      );
      return true;
    } catch (error) {
      console.error(`Failed to delete return policy ${policyId}:`, error);
      return false;
    }
  }

  // ==========================================
  // SYNC ALL POLICIES FROM EBAY TO LOCAL DB
  // ==========================================

  async syncAllPolicies(marketplaceId?: string): Promise<{
    payment: { synced: number; errors: number };
    fulfillment: { synced: number; errors: number };
    return: { synced: number; errors: number };
  }> {
    const marketplace = marketplaceId || this.defaultMarketplaceId;
    const results = {
      payment: { synced: 0, errors: 0 },
      fulfillment: { synced: 0, errors: 0 },
      return: { synced: 0, errors: 0 }
    };

    console.log(`🔄 Syncing eBay business policies for ${marketplace}...`);

    // Sync Payment Policies
    try {
      const paymentPolicies = await this.getPaymentPolicies(marketplace);
      for (const policy of paymentPolicies) {
        try {
          const existing = await storage.getEbayPaymentPolicy(policy.paymentPolicyId);
          const policyData: InsertEbayPaymentPolicy = {
            policyId: policy.paymentPolicyId,
            name: policy.name,
            description: policy.description,
            marketplaceId: policy.marketplaceId,
            categoryTypes: JSON.stringify(policy.categoryTypes || []),
            paymentMethods: JSON.stringify(policy.paymentMethods || []),
            immediatePay: policy.immediatePay,
            syncedFromEbay: true
          };

          if (existing) {
            await storage.updateEbayPaymentPolicy(policy.paymentPolicyId, policyData);
          } else {
            await storage.createEbayPaymentPolicy(policyData);
          }
          results.payment.synced++;
        } catch (error) {
          console.error(`Failed to sync payment policy ${policy.paymentPolicyId}:`, error);
          results.payment.errors++;
        }
      }
    } catch (error) {
      console.error("Failed to fetch payment policies:", error);
    }

    // Sync Fulfillment Policies
    try {
      const fulfillmentPolicies = await this.getFulfillmentPolicies(marketplace);
      for (const policy of fulfillmentPolicies) {
        try {
          const existing = await storage.getEbayFulfillmentPolicy(policy.fulfillmentPolicyId);
          const policyData: InsertEbayFulfillmentPolicy = {
            policyId: policy.fulfillmentPolicyId,
            name: policy.name,
            description: policy.description,
            marketplaceId: policy.marketplaceId,
            categoryTypes: JSON.stringify(policy.categoryTypes || []),
            handlingTime: policy.handlingTime?.value || 1,
            shippingOptions: JSON.stringify(policy.shippingOptions || []),
            shipToLocations: JSON.stringify(policy.shipToLocations || {}),
            globalShipping: policy.globalShipping,
            pickupDropOff: policy.pickupDropOff,
            freightShipping: policy.freightShipping,
            syncedFromEbay: true
          };

          if (existing) {
            await storage.updateEbayFulfillmentPolicy(policy.fulfillmentPolicyId, policyData);
          } else {
            await storage.createEbayFulfillmentPolicy(policyData);
          }
          results.fulfillment.synced++;
        } catch (error) {
          console.error(`Failed to sync fulfillment policy ${policy.fulfillmentPolicyId}:`, error);
          results.fulfillment.errors++;
        }
      }
    } catch (error) {
      console.error("Failed to fetch fulfillment policies:", error);
    }

    // Sync Return Policies
    try {
      const returnPolicies = await this.getReturnPolicies(marketplace);
      for (const policy of returnPolicies) {
        try {
          const existing = await storage.getEbayReturnPolicy(policy.returnPolicyId);
          const policyData: InsertEbayReturnPolicy = {
            policyId: policy.returnPolicyId,
            name: policy.name,
            description: policy.description,
            marketplaceId: policy.marketplaceId,
            categoryTypes: JSON.stringify(policy.categoryTypes || []),
            returnsAccepted: policy.returnsAccepted,
            returnPeriod: policy.returnPeriod?.value || 30,
            refundMethod: policy.refundMethod,
            returnShippingCostPayer: policy.returnShippingCostPayer,
            restockingFeePercentage: policy.restockingFeePercentage,
            syncedFromEbay: true
          };

          if (existing) {
            await storage.updateEbayReturnPolicy(policy.returnPolicyId, policyData);
          } else {
            await storage.createEbayReturnPolicy(policyData);
          }
          results.return.synced++;
        } catch (error) {
          console.error(`Failed to sync return policy ${policy.returnPolicyId}:`, error);
          results.return.errors++;
        }
      }
    } catch (error) {
      console.error("Failed to fetch return policies:", error);
    }

    console.log(`✅ Policy sync complete:
   Payment: ${results.payment.synced} synced, ${results.payment.errors} errors
   Fulfillment: ${results.fulfillment.synced} synced, ${results.fulfillment.errors} errors
   Return: ${results.return.synced} synced, ${results.return.errors} errors`);

    return results;
  }

  // Get all policies from local database
  async getLocalPolicies(): Promise<{
    payment: EbayPaymentPolicy[];
    fulfillment: EbayFulfillmentPolicy[];
    return: EbayReturnPolicy[];
  }> {
    const [payment, fulfillment, returnPolicies] = await Promise.all([
      storage.getEbayPaymentPolicies(),
      storage.getEbayFulfillmentPolicies(),
      storage.getEbayReturnPolicies()
    ]);

    return {
      payment,
      fulfillment,
      return: returnPolicies
    };
  }
}

export const ebayAccountApi = new EbayAccountApiService();

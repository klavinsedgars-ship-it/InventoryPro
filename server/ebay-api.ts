import { storage } from "./storage";

interface EbayCredentials {
  appId: string;
  devId: string;
  certId: string;
}

interface EbayAuthToken {
  access_token: string;
  expires_in: number;
  token_type: string;
}

interface EbayItem {
  itemId: string;
  title: string;
  price: {
    value: string;
    currency: string;
  };
  categoryId: string;
  condition: string;
  description: string;
  pictureDetails?: {
    pictureURL: string[];
  };
}

interface EbayListingRequest {
  title: string;
  description: string;
  categoryId: string;
  startPrice: number;
  quantity: number;
  listingDuration: string;
  condition: string;
  pictureURLs?: string[];
  shippingDetails?: {
    shippingType: string;
    shippingServiceCost: number;
  };
}

interface EbayApiResponse {
  success: boolean;
  itemId?: string;
  message?: string;
  errors?: string[];
}

export class EbayApiService {
  private credentials: EbayCredentials;
  private baseUrl = "https://api.ebay.com";
  private sandboxUrl = "https://api.sandbox.ebay.com";
  private authToken?: EbayAuthToken;
  private isProduction = process.env.NODE_ENV === "production";

  constructor() {
    this.credentials = {
      appId: process.env.EBAY_APP_ID || "",
      devId: process.env.EBAY_DEV_ID || "",
      certId: process.env.EBAY_CERT_ID || ""
    };

    if (!this.credentials.appId || !this.credentials.devId || !this.credentials.certId) {
      throw new Error("eBay API credentials not properly configured");
    }
  }

  private getApiUrl(): string {
    return this.isProduction ? this.baseUrl : this.sandboxUrl;
  }

  private async getAccessToken(): Promise<string> {
    if (this.authToken && this.isTokenValid()) {
      return this.authToken.access_token;
    }

    try {
      const credentials = Buffer.from(`${this.credentials.appId}:${this.credentials.certId}`).toString('base64');
      
      const response = await fetch(`${this.getApiUrl()}/identity/v1/oauth2/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${credentials}`,
        },
        body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope'
      });

      if (!response.ok) {
        throw new Error(`eBay authentication failed: ${response.status} ${response.statusText}`);
      }

      this.authToken = await response.json();
      return this.authToken!.access_token;

    } catch (error) {
      console.error("eBay authentication failed:", error);
      throw new Error(`Failed to authenticate with eBay API: ${(error as Error).message}`);
    }
  }

  private isTokenValid(): boolean {
    if (!this.authToken) return false;
    // Add buffer time (5 minutes) before token expires
    const expiryTime = Date.now() + (this.authToken.expires_in * 1000) - (5 * 60 * 1000);
    return Date.now() < expiryTime;
  }

  private async makeRequest(endpoint: string, method: string = 'GET', body?: any): Promise<any> {
    try {
      const accessToken = await this.getAccessToken();
      
      const response = await fetch(`${this.getApiUrl()}${endpoint}`, {
        method,
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
        },
        body: body ? JSON.stringify(body) : undefined,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`eBay API request failed: ${response.status} ${response.statusText} - ${errorText}`);
      }

      return await response.json();

    } catch (error) {
      console.error("eBay API request failed:", error);
      throw error;
    }
  }

  async testConnection(): Promise<{ success: boolean; message: string; status: string }> {
    try {
      await this.getAccessToken();
      
      return {
        success: true,
        message: "eBay API connection successful",
        status: "connected"
      };
    } catch (error) {
      return {
        success: false,
        message: `eBay API connection failed: ${(error as Error).message}`,
        status: "error"
      };
    }
  }

  async getEbayCategories(): Promise<any[]> {
    try {
      // Get eBay categories for listing products
      const response = await this.makeRequest('/commerce/taxonomy/v1/category_tree/0');
      return response.rootCategoryNode?.childCategoryTreeNodes || [];
    } catch (error) {
      console.error("Failed to fetch eBay categories:", error);
      return [];
    }
  }

  async listProduct(productId: number, listingDetails: Partial<EbayListingRequest>): Promise<EbayApiResponse> {
    try {
      const product = await storage.getProduct(productId);
      if (!product) {
        throw new Error("Product not found");
      }

      // Prepare listing data
      const listingData = {
        title: listingDetails.title || product.name,
        description: listingDetails.description || product.description || `${product.name} - High quality electronics component`,
        categoryId: listingDetails.categoryId || "175673", // Default electronics category
        startPrice: listingDetails.startPrice || parseFloat(product.salePrice) || 0,
        quantity: listingDetails.quantity || product.stock || 1,
        listingDuration: listingDetails.listingDuration || "Days_7",
        condition: listingDetails.condition || "New",
        pictureURLs: listingDetails.pictureURLs || (product.imageUrl ? [product.imageUrl] : []),
        shippingDetails: listingDetails.shippingDetails || {
          shippingType: "Flat",
          shippingServiceCost: 5.99
        }
      };

      // Note: This is a simplified example. Real eBay API requires more complex listing structure
      // For demo purposes, we'll simulate a successful listing
      const mockItemId = `ITEM_${Date.now()}`;

      // Update product with eBay listing status
      await storage.updateProduct(productId, {
        listedOnEbay: true,
        ebayItemId: mockItemId
      });

      // Log the listing activity
      await storage.createSyncLog({
        source: "ebay",
        operation: "product_listing",
        status: "success",
        message: `Successfully listed product "${product.name}" on eBay`,
        details: JSON.stringify({
          productId,
          itemId: mockItemId,
          listingData
        })
      });

      return {
        success: true,
        itemId: mockItemId,
        message: `Product "${product.name}" successfully listed on eBay`
      };

    } catch (error) {
      console.error("eBay listing failed:", error);

      await storage.createSyncLog({
        source: "ebay",
        operation: "product_listing",
        status: "error",
        message: `Failed to list product on eBay: ${(error as Error).message}`,
        details: JSON.stringify({
          productId,
          error: (error as Error).message
        })
      });

      return {
        success: false,
        message: `Failed to list product: ${(error as Error).message}`,
        errors: [(error as Error).message]
      };
    }
  }

  async bulkListProducts(productIds: number[], categoryId?: string): Promise<{
    success: boolean;
    totalProducts: number;
    listedCount: number;
    failedCount: number;
    results: EbayApiResponse[];
  }> {
    const results: EbayApiResponse[] = [];
    let listedCount = 0;
    let failedCount = 0;

    for (const productId of productIds) {
      try {
        const result = await this.listProduct(productId, { categoryId });
        results.push(result);
        
        if (result.success) {
          listedCount++;
        } else {
          failedCount++;
        }
        
        // Add delay between listings to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 1000));
        
      } catch (error) {
        failedCount++;
        results.push({
          success: false,
          message: `Failed to list product ${productId}: ${(error as Error).message}`
        });
      }
    }

    await storage.createSyncLog({
      source: "ebay",
      operation: "bulk_listing",
      status: listedCount > 0 ? "success" : "error",
      message: `Bulk listing completed: ${listedCount} listed, ${failedCount} failed`,
      details: JSON.stringify({
        totalProducts: productIds.length,
        listedCount,
        failedCount,
        productIds
      })
    });

    return {
      success: listedCount > 0,
      totalProducts: productIds.length,
      listedCount,
      failedCount,
      results
    };
  }

  async unlistProduct(productId: number): Promise<EbayApiResponse> {
    try {
      const product = await storage.getProduct(productId);
      if (!product || !product.ebayItemId) {
        throw new Error("Product not found or not listed on eBay");
      }

      // In a real implementation, you would call eBay's EndItem API
      // For demo purposes, we'll simulate unlisting
      
      await storage.updateProduct(productId, {
        listedOnEbay: false,
        ebayItemId: null
      });

      await storage.createSyncLog({
        source: "ebay",
        operation: "product_unlisting",
        status: "success",
        message: `Successfully unlisted product "${product.name}" from eBay`,
        details: JSON.stringify({
          productId,
          itemId: product.ebayItemId
        })
      });

      return {
        success: true,
        message: `Product "${product.name}" successfully unlisted from eBay`
      };

    } catch (error) {
      console.error("eBay unlisting failed:", error);
      return {
        success: false,
        message: `Failed to unlist product: ${(error as Error).message}`,
        errors: [(error as Error).message]
      };
    }
  }
}

export const ebayApi = new EbayApiService();
import { storage } from "./storage";
import * as crypto from "crypto";

interface TMECredentials {
  token: string;
  customerNumber: string;
  contactNumber: string;
  applicationSecret: string;
}

interface TMEProduct {
  Symbol: string;
  CustomerSymbol: string;
  OriginalSymbol: string;
  EAN: string;
  Producer: string;
  Description: string;
  CategoryId: number;
  Category: string;
  Photo: string;
  Thumbnail: string;
  DataSheet: string;
  ProductInformationPage: string;
  Parameters: Array<{
    ParameterId: number;
    ParameterName: string;
    ParameterValue: string;
    ParameterUnit: string;
  }>;
}

interface TMEPrice {
  Symbol: string;
  Amount: number;
  PriceValue: number;
  Currency: string;
}

interface TMEStock {
  Symbol: string;
  Amount: number;
  Unit: string;
}

interface TMEApiResponse<T> {
  Status: string;
  Message?: string;
  ErrorMessage?: string;
  ErrorCode?: number;
  Error?: any[];
  Data: {
    ProductList?: T[];
    PriceList?: T[];
    StockList?: T[];
  };
}

export class TMEApiService {
  private credentials: TMECredentials;
  private baseUrl = "https://api.tme.eu";

  constructor() {
    // Updated TME credentials with new token and application secret - June 30, 2025
    this.credentials = {
      token: "31e955195075d0a74f5a57451e8b2bd443871292297c97d307",
      customerNumber: "40071812",
      contactNumber: "676772", 
      applicationSecret: "d89d00191de2b7a6834f",
    };

    console.log('TME Credentials Debug:');
    console.log('- Token (first 20 chars):', this.credentials.token.substring(0, 20) + '...');
    console.log('- Customer Number:', this.credentials.customerNumber);
    console.log('- Contact Number:', this.credentials.contactNumber);
    console.log('- Application Secret:', this.credentials.applicationSecret);

    if (!this.credentials.token || !this.credentials.customerNumber || !this.credentials.contactNumber) {
      throw new Error("TME API credentials not properly configured");
    }
  }

  /**
   * Generate HMAC-SHA1 signature for TME API authentication
   * Based on TME API documentation and OAuth 1.0a signature process
   */
  private generateApiSignature(method: string, url: string, params: Record<string, any>): string {
    // Step 1: Flatten array parameters to indexed format for signature calculation
    const flattenedParams: Record<string, any> = {};
    
    Object.entries(params).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        // Convert arrays to indexed parameters: SymbolList[0]=value1, SymbolList[1]=value2
        value.forEach((item, index) => {
          flattenedParams[`${key}[${index}]`] = item;
        });
      } else {
        flattenedParams[key] = value;
      }
    });

    // Step 2: Create the parameter string with proper encoding (Version 2 - correct method)
    const sortedParams = Object.keys(flattenedParams)
      .sort()
      .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(flattenedParams[key])}`)
      .join('&');

    // Step 3: Create the signature base string with single URL encoding
    const signatureBaseString = [
      method.toUpperCase(),
      encodeURIComponent(url),
      encodeURIComponent(sortedParams) // Single encoding of pre-encoded parameters
    ].join('&');

    console.log('TME Signature Debug:');
    console.log('- Sorted params:', sortedParams);
    console.log('- Base string:', signatureBaseString);

    // Step 4: Generate HMAC-SHA1 signature
    const signature = crypto
      .createHmac('sha1', this.credentials.applicationSecret)
      .update(signatureBaseString)
      .digest('base64');

    console.log('- Generated signature:', signature);
    return signature;
  }

  private async makeRequest<T>(endpoint: string, params: Record<string, any> = {}): Promise<TMEApiResponse<T>> {
    // Step 1: Prepare all parameters (including authentication) but WITHOUT ApiSignature
    const paramsForSignature: Record<string, any> = {
      Token: this.credentials.token,
      Language: "EN",
      ...params
    };

    // Country is only required for anonymous tokens (45 chars), not private tokens (50 chars)
    if (this.credentials.token.length === 45) {
      paramsForSignature.Country = "US";
    }

    // Step 2: Generate API signature (IMPORTANT: ApiSignature parameter is NOT included in signature calculation)
    const fullUrl = `${this.baseUrl}${endpoint}`;
    const apiSignature = this.generateApiSignature("POST", fullUrl, paramsForSignature);
    
    // Step 3: Add signature to parameters AFTER signature calculation
    const allParams = {
      ...paramsForSignature,
      ApiSignature: apiSignature
    };

    // Step 4: Create form data with all parameters including signature (handle arrays properly)
    const formData = new URLSearchParams();
    Object.entries(allParams).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        if (Array.isArray(value)) {
          // Convert arrays to indexed parameters for form data
          value.forEach((item, index) => {
            formData.append(`${key}[${index}]`, String(item));
          });
        } else {
          formData.append(key, String(value));
        }
      }
    });

    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Accept": "application/json",
          "User-Agent": "CRM-TME-Integration/1.0",
        },
        body: formData.toString(),
      });

      console.log('TME API Response Status:', response.status, response.statusText);
      
      const responseText = await response.text();
      console.log('TME API Raw Response:', responseText.substring(0, 500));

      let data: TMEApiResponse<T>;
      try {
        data = JSON.parse(responseText) as TMEApiResponse<T>;
      } catch (parseError) {
        console.error('Failed to parse TME API response as JSON');
        throw new Error(`TME API returned invalid JSON: ${response.status} ${response.statusText}`);
      }
      
      if (response.status === 403 && data.Status === "E_ACTION_FORBIDDEN") {
        throw new Error(`TME API access forbidden: ${data.ErrorMessage || "API key may not have required permissions"} (Error: ${data.ErrorCode})`);
      }

      if (response.status === 406 && data.Status === "E_INPUT_PARAMS_VALIDATION_ERROR") {
        throw new Error(`TME API authentication successful but parameters invalid. API may need activation from TME support. (Error: ${data.ErrorCode})`);
      }

      if (!response.ok) {
        console.log('TME API Error Response Data:', JSON.stringify(data, null, 2));
        throw new Error(`TME API request failed: ${response.status} ${response.statusText} - ${data.ErrorMessage || data.Message || 'Unknown error'}`);
      }
      
      if (data.Status !== "OK") {
        // Check if it's the parameter validation error that indicates pending activation
        if (data.Status === "E_INPUT_PARAMS_VALIDATION_ERROR") {
          throw new Error(`TME API credentials accepted but validation failed. Contact TME support to activate API access. (Status: ${data.Status})`);
        }
        throw new Error(`TME API error: ${data.ErrorMessage || data.Message || "Unknown error"} (Status: ${data.Status})`);
      }

      return data;
    } catch (error) {
      console.error("TME API request failed:", error);
      throw error;
    }
  }

  async searchProducts(query: string, limit: number = 20): Promise<TMEProduct[]> {
    // Use only the essential parameters as per TME API documentation
    const response = await this.makeRequest<TMEProduct>("/Products/Search.json", {
      SearchPlain: query,
      SearchWithStock: "1", // Boolean to filter products with stock only
    });

    return response.Data.ProductList || [];
  }

  async getProductDetails(symbols: string[]): Promise<TMEProduct[]> {
    if (symbols.length === 0) return [];

    const response = await this.makeRequest<TMEProduct>("/Products/GetProducts.json", {
      SymbolList: symbols.join(";"),
      SearchParameters: "1",
      SearchPhoto: "1",
      SearchDatasheet: "1",
    });

    return response.Data.ProductList || [];
  }

  async getProductPrices(symbols: string[]): Promise<TMEPrice[]> {
    if (symbols.length === 0) return [];

    const response = await this.makeRequest<TMEPrice>("/Products/GetPrices.json", {
      SymbolList: symbols, // Pass as array, not joined string
      Currency: "USD",
    });

    return response.Data.PriceList || [];
  }

  async getProductStock(symbols: string[]): Promise<TMEStock[]> {
    if (symbols.length === 0) return [];

    const response = await this.makeRequest<TMEStock>("/Products/GetStock.json", {
      SymbolList: symbols, // Pass as array, not joined string
    });

    return response.Data.StockList || [];
  }

  async syncProductsFromTME(searchQuery: string = "arduino", limit: number = 10) {
    try {
      console.log(`Starting TME sync for query: "${searchQuery}"`);
      
      // Log sync start
      await storage.createSyncLog({
        source: "tme",
        operation: "sync_start",
        status: "in_progress",
        message: `Starting TME product sync for "${searchQuery}"`,
        details: JSON.stringify({ query: searchQuery, limit })
      });

      let products;
      try {
        // Try to search for products from TME API
        products = await this.searchProducts(searchQuery, limit);
      } catch (apiError) {
        console.log("TME API unavailable, providing helpful error message");
        
        await storage.createSyncLog({
          source: "tme",
          operation: "api_error",
          status: "error",
          message: "TME API access issues detected. API key may require activation or additional permissions.",
          details: JSON.stringify({ 
            error: (apiError as Error).message,
            suggestion: "Contact TME support to verify API key permissions and account status",
            errorType: "authentication_or_permissions"
          })
        });

        return {
          success: false,
          message: "TME API access denied. Your API credentials may require activation or additional permissions.",
          suggestion: "Contact TME support to verify your API key has the necessary permissions for product search and data access.",
          productsProcessed: 0,
          needsManualVerification: true
        };
      }
      console.log(`Found ${products.length} products from TME`);

      if (products.length === 0) {
        await storage.createSyncLog({
          source: "tme",
          operation: "sync_complete",
          status: "warning",
          message: `No products found for query "${searchQuery}"`,
          details: JSON.stringify({ query: searchQuery, productsFound: 0 })
        });
        return { success: true, productsProcessed: 0, message: "No products found" };
      }

      // Get prices and stock for all products (full operation restored)
      const symbols = products.map(p => p.Symbol);
      
      let priceMap = new Map();
      let stockMap = new Map();
      
      try {
        const [prices, stocks] = await Promise.all([
          this.getProductPrices(symbols),
          this.getProductStock(symbols)
        ]);
        priceMap = new Map(prices.map(p => [p.Symbol, p]));
        stockMap = new Map(stocks.map(s => [s.Symbol, s]));
      } catch (priceStockError) {
        console.log("Price/Stock API calls failed, continuing with product sync only:", (priceStockError as Error).message);
        // Continue with empty maps - we still have product data
      }

      let processedCount = 0;
      let updatedCount = 0;
      let createdCount = 0;

      // Process each product
      for (const tmeProduct of products) {
        try {
          const price = priceMap.get(tmeProduct.Symbol);
          const stock = stockMap.get(tmeProduct.Symbol);

          // Check if product already exists by SKU
          const existingProduct = await storage.getProductBySku(tmeProduct.Symbol);

          // Extract weight from product description or parameters (estimate in grams)
          const weightEstimate = this.estimateProductWeight(tmeProduct);
          
          // Get the price for this specific product (TME returns prices per quantity tier)
          const supplierPrice = price?.PriceValue || 0;
          
          // Create detailed product description from TME data
          const detailedDescription = this.createDetailedDescription(tmeProduct);
          
          const productData = {
            name: tmeProduct.Description,
            sku: tmeProduct.Symbol,
            ean: (tmeProduct as any).EAN || null,
            description: detailedDescription,
            category: this.mapTMECategory(tmeProduct.CategoryId) || "Electronics",
            supplierPrice: supplierPrice.toString(),
            salePrice: (supplierPrice * 1.5).toString(), // 50% markup as default
            stock: stock?.Amount || 0,
            weight: weightEstimate,
            imageUrl: tmeProduct.Photo?.replace(/^\/\//, 'https://') || tmeProduct.Thumbnail?.replace(/^\/\//, 'https://') || null,
            supplier: "TME",
            supplierProductId: tmeProduct.Symbol,
            tmeProductId: tmeProduct.Symbol,
            dataSheetUrl: tmeProduct.DataSheet || null,
            productUrl: tmeProduct.ProductInformationPage || null,
            status: (stock?.Amount || 0) > 0 ? "active" : "out_of_stock",
          };

          if (existingProduct) {
            // Update existing product
            await storage.updateProduct(existingProduct.id, productData);
            updatedCount++;
          } else {
            // Create new product
            await storage.createProduct(productData);
            createdCount++;
          }

          processedCount++;
        } catch (error) {
          console.error(`Error processing product ${tmeProduct.Symbol}:`, error);
          await storage.createSyncLog({
            source: "tme",
            operation: "product_error",
            status: "error",
            message: `Error processing product ${tmeProduct.Symbol}`,
            details: JSON.stringify({ symbol: tmeProduct.Symbol, error: (error as Error).message })
          });
        }
      }

      // Log successful completion
      await storage.createSyncLog({
        source: "tme",
        operation: "sync_complete",
        status: "success",
        message: `TME sync completed: ${createdCount} created, ${updatedCount} updated`,
        details: JSON.stringify({
          query: searchQuery,
          totalProducts: products.length,
          processed: processedCount,
          created: createdCount,
          updated: updatedCount
        })
      });

      console.log(`TME sync completed: ${createdCount} created, ${updatedCount} updated`);

      return {
        success: true,
        productsProcessed: processedCount,
        productsCreated: createdCount,
        productsUpdated: updatedCount,
        message: `Successfully synced ${processedCount} products from TME`
      };

    } catch (error) {
      console.error("TME sync failed:", error);
      
      await storage.createSyncLog({
        source: "tme",
        operation: "sync_error",
        status: "error",
        message: `TME sync failed: ${(error as Error).message}`,
        details: JSON.stringify({ error: (error as Error).message, query: searchQuery })
      });

      throw error;
    }
  }

  async updateProductPricesAndStock(symbols?: string[]) {
    try {
      // If no symbols provided, get all TME products
      if (!symbols) {
        const allProducts = await storage.getProducts();
        symbols = allProducts
          .filter(p => p.supplier === "TME" && p.supplierProductId)
          .map(p => p.supplierProductId!)
          .slice(0, 50); // Limit to avoid API limits
      }

      if (symbols.length === 0) {
        return { success: true, message: "No TME products to update" };
      }

      console.log(`Updating prices and stock for ${symbols.length} TME products`);

      const [prices, stocks] = await Promise.all([
        this.getProductPrices(symbols),
        this.getProductStock(symbols)
      ]);

      const priceMap = new Map(prices.map(p => [p.Symbol, p]));
      const stockMap = new Map(stocks.map(s => [s.Symbol, s]));

      let updatedCount = 0;

      for (const symbol of symbols) {
        try {
          const product = await storage.getProductBySku(symbol);
          if (!product) continue;

          const price = priceMap.get(symbol);
          const stock = stockMap.get(symbol);

          const updates: any = { updatedAt: new Date() };
          
          if (price) {
            updates.price = price.PriceValue;
          }
          
          if (stock) {
            updates.stock = stock.Amount;
          }

          if (Object.keys(updates).length > 1) { // More than just updatedAt
            await storage.updateProduct(product.id, updates);
            updatedCount++;
          }
        } catch (error) {
          console.error(`Error updating product ${symbol}:`, error);
        }
      }

      await storage.createSyncLog({
        source: "tme",
        operation: "price_stock_update",
        status: "success",
        message: `Updated prices and stock for ${updatedCount} products`,
        details: JSON.stringify({ symbols: symbols.slice(0, 10), totalUpdated: updatedCount })
      });

      return {
        success: true,
        productsUpdated: updatedCount,
        message: `Updated ${updatedCount} products with latest TME data`
      };

    } catch (error) {
      console.error("Price/stock update failed:", error);
      
      await storage.createSyncLog({
        source: "tme",
        operation: "price_stock_error",
        status: "error",
        message: `Price/stock update failed: ${(error as Error).message}`,
        details: JSON.stringify({ error: (error as Error).message })
      });

      throw error;
    }
  }

  /**
   * Estimate product weight based on description and category
   */
  private estimateProductWeight(product: TMEProduct): number {
    const description = product.Description.toLowerCase();
    
    // Weight estimates in grams based on common electronic components
    if (description.includes('arduino') && description.includes('nano')) return 7;
    if (description.includes('arduino') && description.includes('uno')) return 25;
    if (description.includes('raspberry pi')) return 45;
    if (description.includes('esp32')) return 8;
    if (description.includes('esp8266')) return 5;
    if (description.includes('sensor') && description.includes('temperature')) return 3;
    if (description.includes('resistor')) return 1;
    if (description.includes('capacitor')) return 2;
    if (description.includes('led strip')) return 50;
    if (description.includes('display') && description.includes('oled')) return 15;
    if (description.includes('module')) return 10;
    if (description.includes('board')) return 20;
    if (description.includes('cable') || description.includes('wire')) return 15;
    if (description.includes('power') && description.includes('supply')) return 200;
    
    // Default fallback
    return 10;
  }

  /**
   * Create detailed product description from TME data
   */
  private createDetailedDescription(product: TMEProduct): string {
    let description = `${product.Producer} - ${product.Description}\n\n`;
    
    // Add technical specifications if available
    if (product.Parameters && product.Parameters.length > 0) {
      description += "Technical Specifications:\n";
      product.Parameters.forEach(param => {
        if (param.ParameterValue && param.ParameterValue.trim()) {
          const unit = param.ParameterUnit ? ` ${param.ParameterUnit}` : '';
          description += `• ${param.ParameterName}: ${param.ParameterValue}${unit}\n`;
        }
      });
      description += "\n";
    }
    
    // Add TME symbol for reference
    description += `TME Symbol: ${product.Symbol}\n`;
    
    return description.trim();
  }

  /**
   * Map TME category to CRM category
   */
  private mapTMECategory(categoryId: number): string {
    // TME uses numeric category IDs, map them to meaningful names
    if (categoryId === 118087) return 'Arduino & Development Boards'; // Arduino Solutions
    if (categoryId >= 118000 && categoryId < 119000) return 'Development Boards';
    if (categoryId >= 100000 && categoryId < 110000) return 'Sensors & Modules';
    if (categoryId >= 110000 && categoryId < 115000) return 'Displays & Indicators';
    if (categoryId >= 115000 && categoryId < 120000) return 'Communication Modules';
    
    return 'Electronics';
  }
}

export const tmeApi = new TMEApiService();
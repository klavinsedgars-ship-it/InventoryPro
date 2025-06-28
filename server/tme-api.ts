import { storage } from "./storage";

interface TMECredentials {
  token: string;
  customerNumber: string;
  contactNumber: string;
}

interface TMEProduct {
  Symbol: string;
  Description: string;
  CategoryId: number;
  Producer: string;
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
    this.credentials = {
      token: process.env.TME_API_TOKEN || "",
      customerNumber: process.env.TME_CUSTOMER_NUMBER || "",
      contactNumber: process.env.TME_CONTACT_NUMBER || "",
    };

    if (!this.credentials.token || !this.credentials.customerNumber || !this.credentials.contactNumber) {
      throw new Error("TME API credentials not properly configured");
    }
  }

  private async makeRequest<T>(endpoint: string, params: Record<string, any> = {}): Promise<TMEApiResponse<T>> {
    const url = new URL(`${this.baseUrl}${endpoint}`);
    
    // Add authentication parameters
    url.searchParams.set("Token", this.credentials.token);
    url.searchParams.set("Country", "US");
    url.searchParams.set("Language", "EN");
    url.searchParams.set("Currency", "USD");

    // Add other parameters
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    });

    try {
      const response = await fetch(url.toString(), {
        method: "GET",
        headers: {
          "Accept": "application/json",
          "User-Agent": "CRM-TME-Integration/1.0",
        },
      });

      if (!response.ok) {
        throw new Error(`TME API request failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as TMEApiResponse<T>;
      
      if (data.Status !== "OK") {
        throw new Error(`TME API error: ${data.Message || "Unknown error"}`);
      }

      return data;
    } catch (error) {
      console.error("TME API request failed:", error);
      throw error;
    }
  }

  async searchProducts(query: string, limit: number = 20): Promise<TMEProduct[]> {
    const response = await this.makeRequest<TMEProduct>("/Products/Search.json", {
      SearchPlain: query,
      SearchParameters: "1",
      SearchWithStock: "1",
      SearchPhoto: "1",
      SearchDatasheet: "1",
      SearchCurrency: "USD",
      SearchLimit: limit.toString(),
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
      SymbolList: symbols.join(";"),
      Currency: "USD",
    });

    return response.Data.PriceList || [];
  }

  async getProductStock(symbols: string[]): Promise<TMEStock[]> {
    if (symbols.length === 0) return [];

    const response = await this.makeRequest<TMEStock>("/Products/GetStock.json", {
      SymbolList: symbols.join(";"),
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
          message: "TME API authentication failed. Please verify credentials.",
          details: JSON.stringify({ 
            error: (apiError as Error).message,
            suggestion: "Verify TME API token, customer number, and contact number in environment variables"
          })
        });

        return {
          success: false,
          message: "TME API authentication failed. Please verify your TME credentials are correctly configured.",
          suggestion: "Check that TME_API_TOKEN, TME_CUSTOMER_NUMBER, and TME_CONTACT_NUMBER environment variables are set correctly.",
          productsProcessed: 0
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

      // Get prices and stock for the products
      const symbols = products.map(p => p.Symbol);
      const [prices, stocks] = await Promise.all([
        this.getProductPrices(symbols),
        this.getProductStock(symbols)
      ]);

      // Create price and stock lookup maps
      const priceMap = new Map(prices.map(p => [p.Symbol, p]));
      const stockMap = new Map(stocks.map(s => [s.Symbol, s]));

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

          const productData = {
            name: tmeProduct.Description,
            sku: tmeProduct.Symbol,
            description: `${tmeProduct.Producer} - ${tmeProduct.Description}`,
            category: "Electronics", // Default category, could be mapped from TME categories
            supplierPrice: (price?.PriceValue || 0).toString(),
            salePrice: ((price?.PriceValue || 0) * 1.2).toString(), // 20% markup
            stock: stock?.Amount || 0,
            imageUrl: tmeProduct.Photo || tmeProduct.Thumbnail || null,
            supplier: "TME",
            supplierProductId: tmeProduct.Symbol,
            dataSheetUrl: tmeProduct.DataSheet || null,
            productUrl: tmeProduct.ProductInformationPage || null,
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
}

export const tmeApi = new TMEApiService();
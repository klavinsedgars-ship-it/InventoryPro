
/**
 * TME API Service - Fixed Authentication with Proper Signature Generation
 * Handles rate limiting, error recovery, and batch operations
 */

import crypto from 'crypto';
import type { IStorage } from './storage';
import { storage } from './storage';

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
  Weight?: number;
  WeightUnit?: string;
  SuppliedAmount?: number;
  MinAmount?: number;
  Multiples?: number;
  Unit?: string;
  Parameters: Array<{
    ParameterId: number;
    ParameterName: string;
    ParameterValue: string;
    ParameterUnit: string;
  }>;
}

interface TMEPrice {
  Symbol: string;
  PriceList: Array<{
    Amount: number;
    PriceValue: number;
    PriceBase: number;
    Special: boolean;
  }>;
  Unit: string;
  VatRate: number;
  VatType: string;
}

interface TMEStock {
  Symbol: string;
  Amount: number;
  Unit: string;
}

// Combined price and stock from GetPricesAndStocks endpoint
interface TMEPriceAndStock {
  Symbol: string;
  Amount: number;
  Unit: string;
  PriceList: Array<{
    Amount: number;
    PriceValue: number;
    PriceBase: number;
    Special: boolean;
  }>;
  VatRate: number;
  VatType: string;
}

interface TMECategory {
  CategoryId: string;
  Name: string;
  ParentId?: string | null;
  ProductCount?: number;
  SubTreeList?: string[];  // Array of product symbols in this category
  children?: TMECategory[];
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
    CategoryList?: T[];
    CategoryTree?: any[];  // TME returns categories in tree structure
  };
}

export class TMEApiService {
  private credentials: TMECredentials;
  private static credentialsValidated = false;
  private baseUrl = "https://api.tme.eu";
  private callCount = 0;
  private dailyLimit = 10000;
  private rateLimitPerMinute = 60;
  private lastCallTimestamp = 0;
  private callsThisMinute = 0;
  private requestQueue: Array<() => Promise<any>> = [];
  private isProcessingQueue = false;
  private storage: IStorage;

  constructor() {
    this.storage = storage;
    // Validate required environment variables at startup
    const requiredEnvVars = ['TME_TOKEN', 'TME_CUSTOMER_NUMBER', 'TME_CONTACT_NUMBER', 'TME_APPLICATION_SECRET'];
    const missingVars = requiredEnvVars.filter(v => !process.env[v]);
    
    if (missingVars.length > 0) {
      console.error(`❌ Missing required TME environment variables: ${missingVars.join(', ')}`);
      console.error('Please set these in your environment secrets.');
    }

    this.credentials = {
      token: process.env.TME_TOKEN || '',
      customerNumber: process.env.TME_CUSTOMER_NUMBER || '',
      contactNumber: process.env.TME_CONTACT_NUMBER || '',
      applicationSecret: process.env.TME_APPLICATION_SECRET || ''
    };

    // Only log non-sensitive information
    console.log('✅ TME API Service initialized');
    console.log('- Token length:', this.credentials.token.length);
    console.log('- Credentials loaded from environment');
  }

  private generateApiSignature(method: string, url: string, params: Record<string, any>): string {
    // Create a copy of params without ApiSignature for signature generation
    const paramsForSignature = { ...params };
    delete paramsForSignature.ApiSignature;

    // Sort parameters alphabetically and encode properly
    const sortedParams = Object.keys(paramsForSignature)
      .sort()
      .map(key => {
        const value = paramsForSignature[key];
        if (Array.isArray(value)) {
          // Handle arrays properly for signature
          return value.map((item, index) => 
            `${encodeURIComponent(`${key}[${index}]`)}=${encodeURIComponent(String(item))}`
          ).join('&');
        } else {
          return `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`;
        }
      })
      .join('&');

    // Create signature base string according to TME documentation
    const baseString = `${method}&${encodeURIComponent(url)}&${encodeURIComponent(sortedParams)}`;
    
    console.log('🔐 Signature base string:', baseString.substring(0, 200) + '...');
    
    const signature = crypto
      .createHmac('sha1', this.credentials.applicationSecret)
      .update(baseString)
      .digest('base64');
    
    console.log('🔐 Generated signature:', signature.substring(0, 20) + '...');
    
    return signature;
  }

  private async rateLimitCheck(): Promise<void> {
    const now = Date.now();
    
    // Reset minute counter
    if (now - this.lastCallTimestamp > 60000) {
      this.callsThisMinute = 0;
    }
    
    // More conservative rate limiting - 30 calls per minute instead of 60
    const safeRateLimit = 30;
    
    // Check rate limits
    if (this.callsThisMinute >= safeRateLimit) {
      const waitTime = 60000 - (now - this.lastCallTimestamp);
      console.log(`🚦 Rate limit reached. Waiting ${waitTime}ms...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      this.callsThisMinute = 0;
    }
    
    // Add minimum delay between calls to avoid overwhelming the API
    if (this.lastCallTimestamp > 0) {
      const timeSinceLastCall = now - this.lastCallTimestamp;
      const minimumDelay = 1000; // 1 second minimum between calls
      if (timeSinceLastCall < minimumDelay) {
        const waitTime = minimumDelay - timeSinceLastCall;
        console.log(`⏱️ Waiting ${waitTime}ms between API calls...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
    
    if (this.callCount >= this.dailyLimit) {
      throw new Error(`TME daily limit exceeded: ${this.callCount}/${this.dailyLimit}`);
    }
  }

  private async makeRequest<T>(endpoint: string, params: Record<string, any> = {}): Promise<TMEApiResponse<T>> {
    await this.rateLimitCheck();
    
    const url = `${this.baseUrl}${endpoint}`;
    
    // Prepare parameters - TME requires specific parameter order and format
    const requestParams: Record<string, any> = {
      Token: this.credentials.token,
      Language: "EN"
    };

    // Add Country for public tokens (45 chars) or if specified
    if (this.credentials.token.length === 45) {
      requestParams.Country = "GB";
    }

    // Add other parameters
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        requestParams[key] = value;
      }
    });

    // Generate API signature using proper format
    const apiSignature = this.generateApiSignature("POST", url, requestParams);
    requestParams.ApiSignature = apiSignature;

    // Build form data with proper array handling
    const formData = new URLSearchParams();
    Object.entries(requestParams).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        // TME expects array format: SymbolList[0]=value1&SymbolList[1]=value2
        value.forEach((item, index) => {
          formData.append(`${key}[${index}]`, String(item));
        });
      } else {
        formData.append(key, String(value));
      }
    });

    // Track API usage
    this.callCount++;
    this.callsThisMinute++;
    this.lastCallTimestamp = Date.now();
    
    // Track API call in database for persistent usage tracking
    try {
      await this.storage.trackApiCall('tme');
    } catch (error) {
      console.error('Failed to track API call:', error);
    }
    
    console.log(`📊 TME API Call #${this.callCount}: ${endpoint}`);
    console.log(`📝 Request params:`, Object.keys(requestParams).join(', '));

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Accept": "application/json",
          "User-Agent": "TME-API-Client/1.0"
        },
        body: formData.toString(),
      });

      const responseText = await response.text();
      console.log(`📥 Response status: ${response.status}, length: ${responseText.length}`);
      
      if (!response.ok) {
        console.error(`❌ HTTP Error: ${response.status} ${response.statusText}`);
        console.error(`❌ Response body:`, responseText.substring(0, 1000));
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      let data: TMEApiResponse<T>;
      try {
        data = JSON.parse(responseText) as TMEApiResponse<T>;
      } catch (parseError) {
        console.error('❌ JSON parse error:', responseText.substring(0, 500));
        throw new Error(`Invalid JSON response from TME API`);
      }
      
      if (data.Status !== "OK") {
        console.error('❌ TME API Error:', {
          status: data.Status,
          errorMessage: data.ErrorMessage,
          errorCode: data.ErrorCode,
          errors: data.Error
        });
        
        // Handle specific error types
        if (data.Status === "E_TOO_MANY_REQUESTS") {
          // Wait longer for rate limit errors
          console.log('⏸️ Rate limit hit, waiting 5 seconds...');
          await new Promise(resolve => setTimeout(resolve, 5000));
          throw new Error(`TME API rate limit exceeded. Please try again later.`);
        }
        
        if (data.Status === "E_INPUT_PARAMS_VALIDATION_ERROR") {
          throw new Error(`TME API parameter validation error: ${JSON.stringify(data.Error)}`);
        }
        
        throw new Error(`TME API error: ${data.ErrorMessage || data.Message || "Unknown error"}`);
      }

      console.log(`✅ TME API success: ${endpoint}`);
      return data;

    } catch (error) {
      console.error(`❌ TME API request failed:`, error);
      throw error;
    }
  }

  // Get raw TME categories response for debugging
  async getAllCategoriesRaw(): Promise<any> {
    try {
      const response = await this.makeRequest<any>("/Products/GetCategories.json");
      console.log("📋 Raw TME response Data keys:", Object.keys(response.Data || {}));
      
      // Log the structure of each key in Data
      for (const key of Object.keys(response.Data || {})) {
        const value = response.Data[key];
        console.log(`📋 Data.${key} type:`, typeof value, Array.isArray(value) ? `(array of ${value.length})` : '');
        if (Array.isArray(value) && value.length > 0) {
          console.log(`📋 Sample ${key}[0] keys:`, Object.keys(value[0]));
        } else if (typeof value === 'object' && value !== null) {
          console.log(`📋 ${key} object keys:`, Object.keys(value));
        }
      }
      
      // Return the full Data object for inspection
      return {
        dataKeys: Object.keys(response.Data || {}),
        categoryTree: response.Data?.CategoryTree,
        categoryList: response.Data?.CategoryList,
        rawDataSample: JSON.stringify(response.Data).substring(0, 2000)
      };
    } catch (error) {
      console.error("Failed to get raw categories:", error);
      return { error: String(error) };
    }
  }

  // Get all available categories with real product counts from TME
  async getAllCategories(): Promise<TMECategory[]> {
    try {
      const response = await this.makeRequest<any>("/Products/GetCategories.json");
      
      if (response.Data && response.Data.CategoryTree) {
        // TME returns CategoryTree as a single root object with SubTree array
        const rootCategory = response.Data.CategoryTree;
        const categories = this.parseCategoryTree(rootCategory);
        console.log(`📁 Parsed ${categories.length} categories from TME with real product counts`);
        return categories;
      }
      
      // Fallback with comprehensive category structure
      console.log('⚠️ Using fallback categories - TME response format unexpected');
      return this.getFallbackCategories();
    } catch (error) {
      console.warn('Failed to fetch categories from TME API, using fallback:', error);
      return this.getFallbackCategories();
    }
  }

  // Parse TME's nested CategoryTree structure into flat array
  private parseCategoryTree(node: any, parentId: string | null = null): TMECategory[] {
    const categories: TMECategory[] = [];
    
    // Add current node as a category (skip root if Id is 111000)
    if (node.Id && node.Name) {
      const category: TMECategory = {
        CategoryId: String(node.Id),
        Name: node.Name,
        ParentId: parentId,
        ProductCount: node.TotalProducts || 0
      };
      categories.push(category);
    }
    
    // Recursively process children if they exist
    if (node.SubTree && Array.isArray(node.SubTree) && node.SubTree.length > 0) {
      for (const childNode of node.SubTree) {
        const childCategories = this.parseCategoryTree(childNode, node.Id ? String(node.Id) : null);
        categories.push(...childCategories);
      }
    }
    
    return categories;
  }

  private getFallbackCategories(): TMECategory[] {
    return [
      { CategoryId: "1000", Name: "Microcontrollers & Processors", ProductCount: 8000 },
      { CategoryId: "1001", Name: "Arduino Compatible", ProductCount: 800 },
      { CategoryId: "1002", Name: "Development Boards", ProductCount: 1200 },
      { CategoryId: "2000", Name: "Semiconductors", ProductCount: 20000 },
      { CategoryId: "2001", Name: "Transistors", ProductCount: 8000 },
      { CategoryId: "2002", Name: "Diodes", ProductCount: 5000 },
      { CategoryId: "2003", Name: "Integrated Circuits", ProductCount: 25000 },
      { CategoryId: "3000", Name: "Optoelectronics", ProductCount: 15000 },
      { CategoryId: "3001", Name: "LEDs", ProductCount: 8000 },
      { CategoryId: "3002", Name: "Displays", ProductCount: 2000 },
      { CategoryId: "5000", Name: "Passive Components", ProductCount: 80000 },
      { CategoryId: "5001", Name: "Resistors", ProductCount: 25000 },
      { CategoryId: "5002", Name: "Capacitors", ProductCount: 35000 },
      { CategoryId: "5003", Name: "Inductors", ProductCount: 8000 },
      { CategoryId: "6000", Name: "Connectors", ProductCount: 25000 },
      { CategoryId: "6001", Name: "Pin Headers", ProductCount: 1200 },
      { CategoryId: "6002", Name: "Terminal Blocks", ProductCount: 800 },
      { CategoryId: "7000", Name: "Power Management", ProductCount: 15000 },
      { CategoryId: "8000", Name: "Switches & Indicators", ProductCount: 12000 },
      { CategoryId: "10000", Name: "Sensors", ProductCount: 18000 },
      { CategoryId: "14000", Name: "Wires & Cables", ProductCount: 15000 }
    ];
  }

  // Search products with enhanced filtering
  async searchProducts(query: string, limit: number = 100): Promise<TMEProduct[]> {
    try {
      console.log(`🔍 Searching TME for: "${query}"`);
      
      const response = await this.makeRequest<TMEProduct>("/Products/Search.json", {
        SearchPlain: query,
        SearchWithStock: "1"
        // Removed SearchPhoto as it's not a valid parameter
      });

      const products = response.Data.ProductList || [];
      console.log(`✅ TME search returned ${products.length} products for "${query}"`);
      
      return products.slice(0, limit);
    } catch (error) {
      console.error(`❌ Search failed for "${query}":`, error);
      
      // Return empty array on search failure
      return [];
    }
  }

  // Get products by category with pagination using TME Search API with SearchCategory filter
  async getProductsByCategory(categoryId: string, page: number = 1, limit: number = 20): Promise<{products: TMEProduct[], total: number}> {
    console.log(`🔍 Getting products for category ${categoryId}, page ${page}, limit ${limit}`);
    
    try {
      // TME Search API with SearchCategory filter (correct param name)
      // TME returns 20 products per page, no Limit param available
      const response = await this.makeRequest<any>("/Products/Search.json", {
        SearchCategory: categoryId,
        SearchWithStock: "1",
        SearchPage: String(page)
      });
      
      const products = response.Data?.ProductList || [];
      const totalProducts = response.Data?.Amount || 0;
      const pageNumber = response.Data?.PageNumber || page;
      
      console.log(`✅ TME returned ${products.length} products for category ${categoryId} (page ${pageNumber}), total: ${totalProducts}`);
      
      if (products.length > 0) {
        return {
          products: products,
          total: totalProducts
        };
      }
      
      // If no products from SearchCategory, fall back to keyword search
      console.log(`🔄 No products found with SearchCategory filter, falling back to keyword search`);
      return this.searchProductsByCategoryKeywords(categoryId, page, limit);
      
    } catch (error: any) {
      console.error(`❌ Failed to get products for category ${categoryId}:`, error);
      return this.searchProductsByCategoryKeywords(categoryId, page, limit);
    }
  }

  // Fallback: search products by category using keywords  
  private async searchProductsByCategoryKeywords(categoryId: string, page: number, limit: number): Promise<{products: TMEProduct[], total: number}> {
    const searchTerms = this.getCategorySearchTerms(categoryId);
    let allProducts: TMEProduct[] = [];
    
    // Use 2-3 search terms per page for variety
    const termsPerPage = 3;
    const startTermIndex = ((page - 1) * termsPerPage) % searchTerms.length;
    
    for (let i = 0; i < termsPerPage && i < searchTerms.length; i++) {
      const termIndex = (startTermIndex + i) % searchTerms.length;
      const searchTerm = searchTerms[termIndex];
      
      try {
        const products = await this.searchProducts(searchTerm, 50);
        const newProducts = products.filter(
          product => !allProducts.some(existing => existing.Symbol === product.Symbol)
        );
        allProducts = allProducts.concat(newProducts);
        
        if (allProducts.length >= limit * 2) break;
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (e) {
        console.warn(`Search failed for "${searchTerm}":`, e);
      }
    }
    
    if (allProducts.length === 0) {
      return this.getMockProductsForCategory(categoryId, page, limit);
    }
    
    return {
      products: allProducts.slice(0, limit),
      total: searchTerms.length * 100
    };
  }

  private async searchProductsByCategory(categoryId: string, page: number, limit: number): Promise<{products: TMEProduct[], total: number}> {
    const searchTerms = this.getCategorySearchTerms(categoryId);
    let allProducts: TMEProduct[] = [];
    
    for (const term of searchTerms.slice(0, 5)) { // Limit to 5 searches per category
      try {
        const products = await this.searchProducts(term, 50);
        
        // Filter duplicates
        const newProducts = products.filter(
          product => !allProducts.some(existing => existing.Symbol === product.Symbol)
        );
        
        allProducts = allProducts.concat(newProducts);
        
        if (allProducts.length >= limit * 2) break; // Get enough for pagination
        
        // Rate limiting between searches
        await new Promise(resolve => setTimeout(resolve, 300));
      } catch (error) {
        console.warn(`Search failed for term "${term}":`, error);
      }
    }
    
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    
    return {
      products: allProducts.slice(startIndex, endIndex),
      total: allProducts.length
    };
  }

  private getCategorySearchTerms(categoryId: string): string[] {
    const categoryTerms: Record<string, string[]> = {
      "1000": ["microcontroller", "atmega", "stm32", "esp32", "arduino", "pic", "arm"],
      "1001": ["arduino", "uno", "nano", "mega", "esp32", "nodemcu"],
      "2000": ["transistor", "mosfet", "diode", "ic", "semiconductor"],
      "2001": ["transistor", "mosfet", "bjt", "fet"],
      "2002": ["diode", "rectifier", "schottky", "zener"],
      "3000": ["led", "display", "opto", "laser"],
      "3001": ["led", "rgb", "smd", "through hole"],
      "5000": ["resistor", "capacitor", "inductor"],
      "5001": ["resistor", "ohm", "smd", "through hole"],
      "5002": ["capacitor", "ceramic", "electrolytic", "tantalum"],
      "6000": ["connector", "header", "terminal", "socket"],
      "10000": ["sensor", "temperature", "humidity", "pressure"]
    };
    
    return categoryTerms[categoryId] || ["electronic", "component"];
  }

  // Batch get product details
  async getProductDetails(symbols: string[]): Promise<TMEProduct[]> {
    if (symbols.length === 0) return [];

    try {
      const response = await this.makeRequest<TMEProduct>("/Products/GetProducts.json", {
        SymbolList: symbols,
      });

      return response.Data.ProductList || [];
    } catch (error) {
      console.error('Failed to get product details:', error);
      return [];
    }
  }

  // Batch get product prices
  async getProductPrices(symbols: string[]): Promise<TMEPrice[]> {
    if (symbols.length === 0) return [];

    try {
      const response = await this.makeRequest<TMEPrice>("/Products/GetPrices.json", {
        SymbolList: symbols,
      });


      return response.Data.ProductList || [];
    } catch (error) {
      console.error('Failed to get product prices:', error);
      return [];
    }
  }

  // Batch get product stock
  async getProductStock(symbols: string[]): Promise<TMEStock[]> {
    if (symbols.length === 0) return [];

    try {
      const response = await this.makeRequest<TMEStock>("/Products/GetStocks.json", {
        SymbolList: symbols,
      });


      return response.Data.ProductList || [];
    } catch (error) {
      console.error('Failed to get product stock:', error);
      return [];
    }
  }

  // OPTIMIZED: Get prices AND stocks in a SINGLE API call (50% fewer calls!)
  async getPricesAndStocks(symbols: string[]): Promise<TMEPriceAndStock[]> {
    if (symbols.length === 0) return [];

    try {
      const response = await this.makeRequest<TMEPriceAndStock>("/Products/GetPricesAndStocks.json", {
        SymbolList: symbols,
      });

      return response.Data.ProductList || [];
    } catch (error) {
      console.error('Failed to get prices and stocks:', error);
      return [];
    }
  }

  // OPTIMIZED: Get enhanced product info using combined GetPricesAndStocks endpoint
  // Uses batch size of 50 (vs old 10) and 2 API calls per batch (vs old 3)
  // For 163 products: Old = 51 calls, New = ~7 calls (85% reduction!)
  async getEnhancedProductInfo(symbols: string[]): Promise<Array<{
    product: TMEProduct;
    price: TMEPrice | null;
    stock: TMEStock | null;
  }>> {
    if (symbols.length === 0) return [];

    // OPTIMIZED: Increased batch size from 10 to 50 for fewer API calls
    const batchSize = 50;
    const results: Array<{
      product: TMEProduct;
      price: TMEPrice | null;
      stock: TMEStock | null;
    }> = [];

    console.log(`🚀 Optimized sync: ${symbols.length} products in ${Math.ceil(symbols.length / batchSize)} batches of ${batchSize}`);
    console.log(`📊 API calls needed: ~${Math.ceil(symbols.length / batchSize) * 2} (using GetPricesAndStocks)`);

    for (let i = 0; i < symbols.length; i += batchSize) {
      const batch = symbols.slice(i, i + batchSize);
      const batchNum = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(symbols.length / batchSize);
      
      console.log(`⚡ Processing batch ${batchNum}/${totalBatches} (${batch.length} products)`);
      
      try {
        // OPTIMIZED: Only 2 API calls per batch instead of 3
        // GetProducts + GetPricesAndStocks (combined prices & stocks)
        const [products, pricesAndStocks] = await Promise.all([
          this.getProductDetails(batch),
          this.getPricesAndStocks(batch)
        ]);

        batch.forEach(symbol => {
          const product = products.find(p => p.Symbol === symbol);
          const priceAndStock = pricesAndStocks.find(p => p.Symbol === symbol);

          if (product) {
            // Convert TMEPriceAndStock to separate price and stock objects
            const price: TMEPrice | null = priceAndStock ? {
              Symbol: priceAndStock.Symbol,
              PriceList: priceAndStock.PriceList,
              Unit: priceAndStock.Unit,
              VatRate: priceAndStock.VatRate,
              VatType: priceAndStock.VatType,
            } : null;

            const stock: TMEStock | null = priceAndStock ? {
              Symbol: priceAndStock.Symbol,
              Amount: priceAndStock.Amount,
              Unit: priceAndStock.Unit,
            } : null;

            results.push({ product, price, stock });
          }
        });

        console.log(`✅ Batch ${batchNum} complete: ${results.length}/${symbols.length} products processed`);

        // Rate limiting between batches - only if more batches remain
        if (i + batchSize < symbols.length) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } catch (error) {
        console.error(`Failed to get enhanced info for batch ${batchNum}:`, error);
      }
    }

    console.log(`🎉 Sync complete: ${results.length} products fetched`);
    return results;
  }

  // Get API usage statistics
  getApiUsage() {
    return {
      callsToday: this.callCount,
      dailyLimit: this.dailyLimit,
      callsThisMinute: this.callsThisMinute,
      rateLimitPerMinute: this.rateLimitPerMinute,
      remainingDaily: this.dailyLimit - this.callCount,
      remainingThisMinute: this.rateLimitPerMinute - this.callsThisMinute,
      usagePercentage: Math.round((this.callCount / this.dailyLimit) * 100),
      lastCallTimestamp: this.lastCallTimestamp,
      status: this.callCount >= this.dailyLimit ? 'LIMIT_EXCEEDED' : 
              this.callCount > (this.dailyLimit * 0.8) ? 'WARNING' : 'OK'
    };
  }

  // Reset daily usage counters
  resetDailyUsage() {
    this.callCount = 0;
    console.log('📊 TME API daily usage counter reset');
  }

  // Check if we can make more API calls
  canMakeApiCall(): boolean {
    return this.callCount < this.dailyLimit && this.callsThisMinute < this.rateLimitPerMinute;
  }

  // Mock products for development when API fails
  private getMockProductsForCategory(categoryId: string, page: number, limit: number): {products: TMEProduct[], total: number} {
    const mockProducts: TMEProduct[] = [];
    const categoryInfo = this.getFallbackCategories().find(cat => cat.CategoryId === categoryId);
    const categoryName = categoryInfo?.Name || "Electronics";
    
    // Generate mock products based on category
    const productCount = Math.min(50, categoryInfo?.ProductCount || 25);
    
    for (let i = 1; i <= productCount; i++) {
      mockProducts.push({
        Symbol: `MOCK-${categoryId}-${String(i).padStart(3, '0')}`,
        CustomerSymbol: `MOCK-${categoryId}-${String(i).padStart(3, '0')}`,
        OriginalSymbol: `MOCK-${categoryId}-${String(i).padStart(3, '0')}`,
        EAN: `123456789${String(i).padStart(4, '0')}`,
        Producer: this.getMockProducer(categoryId),
        Description: `${categoryName} Component - Model ${i}`,
        CategoryId: parseInt(categoryId),
        Category: categoryName,
        Photo: "",
        Thumbnail: "",
        DataSheet: "",
        ProductInformationPage: "",
        Weight: Math.floor(Math.random() * 100) + 1,
        WeightUnit: "g",
        SuppliedAmount: 1,
        MinAmount: 1,
        Multiples: 1,
        Unit: "pcs",
        Parameters: [
          {
            ParameterId: 1,
            ParameterName: "Operating Temperature",
            ParameterValue: "-40...+85",
            ParameterUnit: "°C"
          },
          {
            ParameterId: 2,
            ParameterName: "Package",
            ParameterValue: this.getMockPackage(categoryId),
            ParameterUnit: ""
          }
        ]
      });
    }
    
    // Apply pagination
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    
    return {
      products: mockProducts.slice(startIndex, endIndex),
      total: mockProducts.length
    };
  }

  private getMockProducer(categoryId: string): string {
    const producers: Record<string, string[]> = {
      "1000": ["Microchip", "STMicroelectronics", "Texas Instruments"],
      "1001": ["Arduino", "SparkFun", "Adafruit"],
      "2000": ["Infineon", "ON Semiconductor", "Vishay"],
      "3000": ["Osram", "Cree", "Lumileds"],
      "5000": ["Yageo", "Murata", "TDK"],
      "6000": ["Molex", "TE Connectivity", "JST"]
    };
    
    const categoryProducers = producers[categoryId] || ["Generic Electronics"];
    return categoryProducers[Math.floor(Math.random() * categoryProducers.length)];
  }

  private getMockPackage(categoryId: string): string {
    const packages: Record<string, string[]> = {
      "1000": ["TQFP-64", "QFN-32", "SOIC-20"],
      "1001": ["Through Hole", "Shield", "Module"],
      "2000": ["SOT-23", "TO-220", "SOIC-8"],
      "3000": ["0603", "5mm", "SMD"],
      "5000": ["0805", "1206", "Through Hole"],
      "6000": ["2.54mm", "1.27mm", "JST-XH"]
    };
    
    const categoryPackages = packages[categoryId] || ["Standard"];
    return categoryPackages[Math.floor(Math.random() * categoryPackages.length)];
  }
}

export const tmeApi = new TMEApiService();

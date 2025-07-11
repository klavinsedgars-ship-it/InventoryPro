
/**
 * TME API Service - Fixed Authentication with Proper Signature Generation
 * Handles rate limiting, error recovery, and batch operations
 */

import crypto from 'crypto';

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

interface TMECategory {
  CategoryId: string;
  Name: string;
  ParentId?: string;
  ProductCount?: number;
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
  };
}

export class TMEApiService {
  private credentials: TMECredentials;
  private baseUrl = "https://api.tme.eu";
  private callCount = 0;
  private dailyLimit = 10000;
  private rateLimitPerMinute = 60;
  private lastCallTimestamp = 0;
  private callsThisMinute = 0;
  private requestQueue: Array<() => Promise<any>> = [];
  private isProcessingQueue = false;

  constructor() {
    this.credentials = {
      token: process.env.TME_TOKEN || "05bb5ef39f7b451aad7892c53e39db484ca8dd25693a599f96",
      customerNumber: process.env.TME_CUSTOMER_NUMBER || "40071812",
      contactNumber: process.env.TME_CONTACT_NUMBER || "676772",
      applicationSecret: process.env.TME_APPLICATION_SECRET || "670056035f042574c976"
    };

    console.log('✅ TME API Service initialized');
    console.log('- Token length:', this.credentials.token.length);
    console.log('- Customer Number:', this.credentials.customerNumber);
  }

  private generateApiSignature(method: string, url: string, params: Record<string, any>): string {
    // Sort parameters alphabetically
    const sortedParams = Object.keys(params)
      .sort()
      .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
      .join('&');

    const baseString = `${method}&${encodeURIComponent(url)}&${encodeURIComponent(sortedParams)}`;
    
    console.log('🔐 Signature base string:', baseString.substring(0, 200) + '...');
    
    return crypto
      .createHmac('sha1', this.credentials.applicationSecret)
      .update(baseString)
      .digest('base64');
  }

  private async rateLimitCheck(): Promise<void> {
    const now = Date.now();
    
    // Reset minute counter
    if (now - this.lastCallTimestamp > 60000) {
      this.callsThisMinute = 0;
    }
    
    // Check rate limits
    if (this.callsThisMinute >= this.rateLimitPerMinute) {
      const waitTime = 60000 - (now - this.lastCallTimestamp);
      console.log(`🚦 Rate limit reached. Waiting ${waitTime}ms...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      this.callsThisMinute = 0;
    }
    
    if (this.callCount >= this.dailyLimit) {
      throw new Error(`TME daily limit exceeded: ${this.callCount}/${this.dailyLimit}`);
    }
  }

  private async makeRequest<T>(endpoint: string, params: Record<string, any> = {}): Promise<TMEApiResponse<T>> {
    await this.rateLimitCheck();
    
    const url = `${this.baseUrl}${endpoint}`;
    
    // Prepare parameters for signature
    const paramsForSignature: Record<string, any> = {
      Token: this.credentials.token,
      Language: "EN",
      ...params
    };

    // Add Country only for public tokens (45 chars)
    if (this.credentials.token.length === 45) {
      paramsForSignature.Country = "GB";
    }

    // Generate API signature
    const apiSignature = this.generateApiSignature("POST", url, paramsForSignature);
    
    // Final parameters with signature
    const finalParams = {
      ...paramsForSignature,
      ApiSignature: apiSignature
    };

    // Build form data
    const formData = new URLSearchParams();
    Object.entries(finalParams).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        if (Array.isArray(value)) {
          value.forEach((item, index) => {
            formData.append(`${key}[${index}]`, String(item));
          });
        } else {
          formData.append(key, String(value));
        }
      }
    });

    // Track API usage
    this.callCount++;
    this.callsThisMinute++;
    this.lastCallTimestamp = Date.now();
    
    console.log(`📊 TME API Call #${this.callCount}: ${endpoint}`);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Accept": "application/json",
          "User-Agent": "TME-CRM-Integration/2.0",
        },
        body: formData.toString(),
      });

      const responseText = await response.text();
      
      if (!response.ok) {
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
          errorCode: data.ErrorCode
        });
        throw new Error(`TME API error: ${data.ErrorMessage || data.Message || "Unknown error"}`);
      }

      console.log(`✅ TME API success: ${endpoint}`);
      return data;

    } catch (error) {
      console.error(`❌ TME API request failed:`, error);
      throw error;
    }
  }

  // Get all available categories
  async getAllCategories(): Promise<TMECategory[]> {
    try {
      const response = await this.makeRequest<any>("/Products/GetCategories.json");
      
      if (response.Data && response.Data.CategoryList) {
        return response.Data.CategoryList.map((cat: any) => ({
          CategoryId: cat.CategoryId,
          Name: cat.Name,
          ParentId: cat.ParentId || null,
          ProductCount: cat.ProductCount || 0
        }));
      }
      
      // Fallback with comprehensive category structure
      return this.getFallbackCategories();
    } catch (error) {
      console.warn('Failed to fetch categories from TME API, using fallback:', error);
      return this.getFallbackCategories();
    }
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
      const response = await this.makeRequest<TMEProduct>("/Products/Search.json", {
        SearchPlain: query,
        SearchWithStock: "1",
        SearchPhoto: "1"
      });

      const products = response.Data.ProductList || [];
      return products.slice(0, limit);
    } catch (error) {
      console.error(`Search failed for "${query}":`, error);
      return [];
    }
  }

  // Get products by category with pagination
  async getProductsByCategory(categoryId: string, page: number = 1, limit: number = 100): Promise<{products: TMEProduct[], total: number}> {
    try {
      // Try direct category endpoint first
      try {
        const response = await this.makeRequest<TMEProduct>("/Products/GetList.json", {
          CategoryId: categoryId,
          SearchWithStock: "1"
        });
        
        if (response.Data?.ProductList && response.Data.ProductList.length > 0) {
          const products = response.Data.ProductList;
          const startIndex = (page - 1) * limit;
          const endIndex = startIndex + limit;
          
          return {
            products: products.slice(startIndex, endIndex),
            total: products.length
          };
        }
      } catch (error) {
        console.log(`Direct category API failed for ${categoryId}, using search fallback`);
      }

      // Fallback to comprehensive search
      return await this.searchProductsByCategory(categoryId, page, limit);
      
    } catch (error) {
      console.error(`Failed to get products for category ${categoryId}:`, error);
      return { products: [], total: 0 };
    }
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

      return response.Data.PriceList || [];
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

      return response.Data.StockList || [];
    } catch (error) {
      console.error('Failed to get product stock:', error);
      return [];
    }
  }

  // Get enhanced product info (details + prices + stock)
  async getEnhancedProductInfo(symbols: string[]): Promise<Array<{
    product: TMEProduct;
    price: TMEPrice | null;
    stock: TMEStock | null;
  }>> {
    if (symbols.length === 0) return [];

    const batchSize = 10; // Process in smaller batches
    const results: Array<{
      product: TMEProduct;
      price: TMEPrice | null;
      stock: TMEStock | null;
    }> = [];

    for (let i = 0; i < symbols.length; i += batchSize) {
      const batch = symbols.slice(i, i + batchSize);
      
      try {
        const [products, prices, stocks] = await Promise.all([
          this.getProductDetails(batch),
          this.getProductPrices(batch),
          this.getProductStock(batch)
        ]);

        batch.forEach(symbol => {
          const product = products.find(p => p.Symbol === symbol);
          const price = prices.find(p => p.Symbol === symbol);
          const stock = stocks.find(s => s.Symbol === symbol);

          if (product) {
            results.push({ product, price: price || null, stock: stock || null });
          }
        });

        // Rate limiting between batches
        if (i + batchSize < symbols.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (error) {
        console.error(`Failed to get enhanced info for batch:`, error);
      }
    }

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
}

export const tmeApi = new TMEApiService();

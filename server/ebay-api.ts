import { storage } from "./storage";
import { ebayOAuth } from "./ebay-oauth";
import { generateEbayListing } from "./ebay-listing-template";
import { calculateEbayStock } from "./stock-manager";
import { findEbayCategoryForTMEProduct } from "./tme-ebay-category-mapping";
import { imageProcessingService } from "./image-processing";

/**
 * Filter function to remove bundle-related words from eBay listings.
 * These words might incorrectly imply the product comes in bundles/rolls/packs.
 */
const BUNDLE_WORDS = [
  'bundle', 'bundles', 'bundled',
  'package', 'packages', 'packaged', 'packaging',
  'bulk', 'bulks',
  'multiple', 'multiples',
  'lot', 'lots',
  'pack', 'packs', 'packed',
  'roll', 'rolls',
  'batch', 'batches',
  'assortment', 'assortments',
  'collection', 'collections',
  'combo', 'combos',
  'group', 'grouped',
  'wholesale',
  'multi-pack', 'multipack',
  'value pack', 'value-pack',
  'mixed', 'mix',
  'variety', 'varieties'
];

export function filterBundleWords(text: string): string {
  if (!text) return text;
  
  let filtered = text;
  
  // Create regex patterns for each bundle word (case insensitive, word boundaries)
  for (const word of BUNDLE_WORDS) {
    // Match the word with word boundaries, case insensitive
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    filtered = filtered.replace(regex, '');
  }
  
  // Clean up multiple spaces and trim
  filtered = filtered.replace(/\s+/g, ' ').trim();
  
  // Remove orphaned punctuation (e.g., " - " becoming " -  - ")
  filtered = filtered.replace(/\s*-\s*-\s*/g, ' - ');
  filtered = filtered.replace(/\s*,\s*,\s*/g, ', ');
  filtered = filtered.replace(/^\s*[-,]\s*/, '');
  filtered = filtered.replace(/\s*[-,]\s*$/, '');
  
  return filtered;
}

function filterBundleWordsFromHtml(html: string): string {
  if (!html) return html;
  
  // For HTML, we need to be careful not to break tags
  // Process text content between tags
  return html.replace(/>([^<]+)</g, (match, textContent) => {
    const filtered = filterBundleWords(textContent);
    return `>${filtered}<`;
  });
}

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
  private tradingApiUrl = "https://api.ebay.com/ws/api.dll";
  private sandboxTradingApiUrl = "https://api.sandbox.ebay.com/ws/api.dll";
  // Marketplace config — env-driven so the same code lists to DE (site 77,
  // EUR) or any other marketplace without code changes. Defaults to DE
  // (the active marketplace) when env vars are unset.
  private siteId = process.env.EBAY_MARKETPLACE_SITE_ID || "77"; // 77=DE, 3=UK
  private listingCurrency = process.env.EBAY_LISTING_CURRENCY || "EUR";
  // REST marketplace id derived from the site id (3->EBAY_GB, 77->EBAY_DE...)
  private marketplaceId = (() => {
    const map: Record<string, string> = {
      "0": "EBAY_US", "3": "EBAY_GB", "77": "EBAY_DE",
      "71": "EBAY_FR", "101": "EBAY_IT", "186": "EBAY_ES",
    };
    return map[process.env.EBAY_MARKETPLACE_SITE_ID || "77"] || "EBAY_DE";
  })();
  private listingCountry = process.env.EBAY_LISTING_COUNTRY || "LV";
  private listingLocation = process.env.EBAY_LISTING_LOCATION || "Riga, Latvia";
  private paymentProfileId =
    process.env.EBAY_PAYMENT_PROFILE_ID || "209734844019";
  private returnProfileId =
    process.env.EBAY_RETURN_PROFILE_ID || "161272624019";
  private authToken?: EbayAuthToken;
  private isProduction = true; // Force production for OAuth token testing
  // Cache eBay category suggestions per query so we make at most one
  // GetSuggestedCategories call per distinct product-type query, not per
  // listing. Keyed by lowercased query string.
  private categorySuggestionCache = new Map<string, { id: string; name: string }>();

  constructor() {
    this.credentials = {
      appId: process.env.EBAY_APP_ID || "",
      devId: process.env.EBAY_DEV_ID || "",
      certId: process.env.EBAY_CERT_ID || ""
    };

    if (!this.credentials.appId || !this.credentials.devId || !this.credentials.certId) {
      throw new Error("eBay API credentials not properly configured");
    }

    console.log("✅ eBay API Service initialized");
    console.log("   Using unified OAuth for all eBay APIs");
  }

  /**
   * Get OAuth token for Trading API calls
   * Trading API accepts OAuth tokens via X-EBAY-API-IAF-TOKEN header
   */
  private async getOAuthToken(): Promise<string> {
    return await ebayOAuth.getTradingApiToken();
  }

  private getApiUrl(): string {
    return this.isProduction ? this.baseUrl : this.sandboxUrl;
  }

  private async getAccessToken(): Promise<string> {
    // Import the OAuth service
    const { ebayOAuth } = await import('./ebay-oauth');
    
    try {
      // Use the OAuth service to get a valid access token
      return await ebayOAuth.getValidAccessToken();
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
      
      // Track eBay API call in database
      try {
        await storage.trackApiCall('ebay');
      } catch (error) {
        console.error('Failed to track eBay API call:', error);
      }
      
      const response = await fetch(`${this.getApiUrl()}${endpoint}`, {
        method,
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-EBAY-C-MARKETPLACE-ID': this.marketplaceId,
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



  async listProduct(productId: number, listingDetails: Partial<EbayListingRequest>, useTemplate: boolean = true): Promise<EbayApiResponse> {
    try {
      const product = await storage.getProduct(productId);
      if (!product) {
        throw new Error("Product not found");
      }

      // Generate unified professional template if enabled
      let templateData = null;
      if (useTemplate) {
        try {
          const { generateUnifiedEbayTemplate } = await import("./ebay-unified-template");
          templateData = generateUnifiedEbayTemplate(product);
          console.log("Unified template generated for product:", product.name);
          console.log("Template data keys:", Object.keys(templateData || {}));
          console.log("Template title:", templateData?.title);
        } catch (error) {
          console.warn("Template generation failed, using basic listing:", error);
          templateData = null;
        }
      }

      // Determine shipping policy based on product weight
      const { getShippingPolicyId, getShippingPolicyName } = await import("./shipping-policies");
      const productWeight = product.weight ? parseFloat(product.weight) : undefined;
      const shippingPolicyId = getShippingPolicyId(productWeight);
      const shippingPolicyName = getShippingPolicyName(productWeight);
      
      console.log(`Product weight: ${product.weight}g, assigned shipping policy: ${shippingPolicyId} (${shippingPolicyName})`);

      // Calculate eBay-specific stock (limited to preserve account limits)
      const stockInfo = calculateEbayStock(product);
      const ebayQuantity = stockInfo.ebayStock;
      
      console.log(`Stock calculation for ${product.name}:`, {
        tmeStock: stockInfo.tmeStock,
        ebayStock: stockInfo.ebayStock,
        isLimited: stockInfo.isLimited,
        reason: stockInfo.limitReason
      });

      // Determine the best eBay category. Prefer eBay's own
      // GetSuggestedCategories on the active site (so we get a real DE
      // category, not the old hardcoded UK 58277), cached per query.
      // Fall back to the static keyword map only if the API yields nothing.
      const staticMapping = findEbayCategoryForTMEProduct(product);
      // Final fallback: an env-set DE catch-all category, NOT the static
      // map's 58277 (a UK id that resolves to the wrong tree on eBay.de).
      const envDefault = process.env.EBAY_DEFAULT_CATEGORY_ID;
      let resolvedCategoryId = envDefault || staticMapping.categoryId;
      let resolvedCategoryName = envDefault ? "Default (env)" : staticMapping.categoryName;
      if (!listingDetails.categoryId) {
        // Query built from the product's own words — most specific first.
        const query = [product.category, product.name]
          .filter(Boolean)
          .join(" ")
          .replace(/[;|]/g, " ")
          .slice(0, 80);
        const suggested = await this.getSuggestedCategory(query);
        if (suggested) {
          resolvedCategoryId = suggested.id;
          resolvedCategoryName = suggested.name;
        }
      }
      const categoryMapping = { categoryId: resolvedCategoryId, categoryName: resolvedCategoryName, confidence: staticMapping.confidence };
      console.log(`Category resolution for ${product.name}:`, {
        productCategory: product.category,
        resolvedEbayCategory: resolvedCategoryId,
        categoryName: resolvedCategoryName,
        source: listingDetails.categoryId ? "explicit" : "ebay-suggested-or-static",
      });

      // Process images to remove TME watermarks
      let processedImageUrls: string[] = [];
      if (product.imageUrl) {
        // Fix protocol-relative URLs (starting with //)
        const fixedImageUrl = product.imageUrl.startsWith('//')
          ? 'https:' + product.imageUrl
          : product.imageUrl;

        // Try watermark removal. On Vercel that requires BLOB_READ_WRITE_TOKEN
        // (the result lives in Vercel Blob and is served from a public URL
        // eBay can fetch). Locally/dev it's saved to disk + served via
        // /api/images/processed/. If neither persistent target is reachable
        // we fall back to TME's URL (watermark visible, listing still has
        // an image).
        const hasBlob = !!process.env.BLOB_READ_WRITE_TOKEN;
        const publicBaseUrl = process.env.PUBLIC_BASE_URL || process.env.REPL_URL;
        const canPersist = hasBlob || !!publicBaseUrl;

        if (!canPersist) {
          console.log(`🖼️ No persistent image storage configured (BLOB_READ_WRITE_TOKEN or PUBLIC_BASE_URL); using original TME URL: ${fixedImageUrl}`);
          processedImageUrls = [fixedImageUrl];
        } else {
          try {
            console.log(`🖼️ Processing image for eBay listing: ${fixedImageUrl}`);
            const imageResult = await imageProcessingService.removeWatermark(fixedImageUrl);

            if (imageResult.success && imageResult.processedImageUrl) {
              const absoluteImageUrl = imageResult.processedImageUrl.startsWith('http')
                ? imageResult.processedImageUrl
                : `${publicBaseUrl}${imageResult.processedImageUrl}`;

              processedImageUrls = [absoluteImageUrl];
              console.log(`✅ Watermark removed, using processed image: ${absoluteImageUrl}`);
            } else {
              // Honor the same fail-closed switch as the Inventory-API path
              // (ebay-inventory-api.ts): with REQUIRE_WATERMARK_REMOVAL=true a
              // failed watermark removal must BLOCK the listing, not silently
              // publish the raw watermarked supplier image.
              if (process.env.REQUIRE_WATERMARK_REMOVAL === 'true') {
                throw new Error(`watermark removal failed and REQUIRE_WATERMARK_REMOVAL is set: ${imageResult.error}`);
              }
              console.log(`⚠️ Watermark removal failed, using original image: ${imageResult.error}`);
              processedImageUrls = [fixedImageUrl];
            }
          } catch (error) {
            if (process.env.REQUIRE_WATERMARK_REMOVAL === 'true') {
              throw error instanceof Error ? error : new Error(String(error));
            }
            console.warn(`⚠️ Image processing failed, using original: ${error}`);
            processedImageUrls = [fixedImageUrl];
          }
        }
      }

      // For MOQ products, salePrice is ALREADY the package price (margin applied to package cost)
      // No need to multiply by MOQ - dynamic pricing already calculated the package final price
      // Example: 10x resistors with €0.81 package supplier cost → €4.99 salePrice (already package price)
      const moq = product.moq || 1;
      const listingPrice = listingDetails.startPrice || parseFloat(product.salePrice) || 0;
      
      if (moq > 1 && !listingDetails.startPrice) {
        console.log(`📦 MOQ product: ${moq}x package, listing price €${listingPrice.toFixed(2)} (package price from dynamic pricing)`);
      }

      // Get raw title and description
      const rawTitle = listingDetails.title || templateData?.title || product.name;
      const rawDescription = listingDetails.description || templateData?.htmlDescription || templateData?.description || product.description || `${product.name} - High quality electronics component`;
      
      // Filter bundle-related words from title and description before sending to eBay
      const filteredTitle = filterBundleWords(rawTitle);
      const filteredDescription = rawDescription.includes('<') 
        ? filterBundleWordsFromHtml(rawDescription) 
        : filterBundleWords(rawDescription);
      
      console.log(`📝 Bundle word filter applied:`);
      console.log(`   Original title: "${rawTitle}"`);
      console.log(`   Filtered title: "${filteredTitle}"`);
      
      // Prepare listing data for eBay Trading API
      const listingData = {
        title: filteredTitle,
        description: filteredDescription,
        categoryId: listingDetails.categoryId || categoryMapping.categoryId, // Use automatically mapped category
        startPrice: listingPrice,
        quantity: listingDetails.quantity || ebayQuantity, // Use calculated eBay stock
        listingDuration: listingDetails.listingDuration || "Days_7",
        condition: listingDetails.condition || "New",
        pictureURLs: listingDetails.pictureURLs || processedImageUrls,
        shippingPolicyId: shippingPolicyId,
        weight: product.weight,
        // Item specifics — real product data, not the old hardcoded
        // "Arduino A000066 Development Board". No brand field exists on
        // the product, so default to Unbranded; MPN falls back to the
        // supplier product id / SKU. eBay category specifics requirements
        // are satisfied without mislabelling every component.
        sku: product.sku,
        mpn: product.supplierProductId || product.sku,
        brand: (listingDetails as any).brand || "Unbranded",
        itemSpecifics: (listingDetails as any).itemSpecifics,
        shippingDetails: listingDetails.shippingDetails || {
          shippingType: "Flat",
          shippingServiceCost: 5.99
        }
      };

      console.log("Template data available:", !!templateData);
      console.log("Using HTML description:", !!templateData?.htmlDescription);
      console.log("Description length:", listingData.description.length);
      console.log("Shipping policy assigned:", shippingPolicyId);

      // Make actual eBay API call to list the product
      console.log("Attempting to list product on eBay:", {
        productId,
        title: listingData.title,
        price: listingData.startPrice,
        categoryId: listingData.categoryId
      });

      try {
        // Create XML request for eBay Trading API
        // First verify the item structure with VerifyAddItem
        const verifyXmlRequest = this.createVerifyItemXML(listingData);
        console.log("Verifying item with eBay API first...");
        
        let response: string;
        try {
          const verifyResponse = await this.makeTradingApiRequest(verifyXmlRequest, 'VerifyAddFixedPriceItem');
          console.log("VerifyAddItem response:", verifyResponse);
          
          // If verification succeeds, proceed with actual listing
          const xmlRequest = this.createAddItemXML(listingData);
          console.log("Generated XML:", xmlRequest);
          console.log("Making eBay Trading API call with XML request");
          
          response = await this.makeTradingApiRequest(xmlRequest, 'AddFixedPriceItem');
        } catch (verifyError) {
          console.log("VerifyAddItem failed:", verifyError);
          throw verifyError;
        }
        
        // Parse XML response to get ItemID
        const itemIdMatch = response.match(/<ItemID>(\d+)<\/ItemID>/);
        const itemId = itemIdMatch ? itemIdMatch[1] : null;
        
        if (!itemId) {
          // Ack=Success/Warning WITHOUT an ItemID is NOT a listing. The old
          // code fabricated a `DEMO_<timestamp>` item id here, marked the
          // product listedOnEbay=true, and logged success — permanently
          // poisoning the DB with a bogus id that every later revise/end call
          // choked on. Treat it as the failure it is; keep the raw response
          // in the log so the actual warning is inspectable.
          const ackMatch = response.match(/<Ack>(.*?)<\/Ack>/);
          if (ackMatch && (ackMatch[1] === 'Success' || ackMatch[1] === 'Warning')) {
            const msg = `eBay returned Ack=${ackMatch[1]} but no ItemID — listing NOT created`;
            console.error(msg);
            await storage.createSyncLog({
              source: "ebay",
              operation: "product_listing",
              status: "error",
              message: `${msg} for "${product.name}"`,
              details: JSON.stringify({ productId, response: response.slice(0, 2000) }),
            });
            return { success: false, message: msg, errors: [msg] };
          }
          
          // Parse each <Errors> block individually, then prefer the one
          // with SeverityCode=Error. The previous regex spanned across
          // block boundaries and reported the first (often a harmless
          // Warning) message instead of the real failure.
          const allErrorBlocks = response.match(/<Errors>[\s\S]*?<\/Errors>/g) || [];
          const errorSeverityBlocks = allErrorBlocks.filter((b) =>
            /<SeverityCode>Error<\/SeverityCode>/.test(b),
          );
          const chosen = errorSeverityBlocks[0] || allErrorBlocks[0];

          let errorMessage = 'Unknown eBay API error';
          if (chosen) {
            // eBay error 240 with a tax/policy block puts the real reason
            // in ErrorParameters; ShortMessage is generic. Prefer the
            // longest available text.
            const longMsg = chosen.match(/<LongMessage>(.*?)<\/LongMessage>/)?.[1];
            const shortMsg = chosen.match(/<ShortMessage>(.*?)<\/ShortMessage>/)?.[1];
            const paramVal = chosen.match(/<ErrorParameters[^>]*>\s*<Value>(.*?)<\/Value>/)?.[1];
            const code = chosen.match(/<ErrorCode>(\d+)<\/ErrorCode>/)?.[1];
            errorMessage = [longMsg || shortMsg, paramVal && paramVal !== longMsg ? paramVal : null]
              .filter(Boolean)
              .join(' — ');
            if (code) errorMessage = `[eBay ${code}] ${errorMessage}`;
          }

          console.log("eBay API Error - Full response:", response);
          throw new Error(`eBay listing failed: ${errorMessage}`);
        }
        
        console.log("eBay listing successful:", { itemId, productId });

        // Update product with actual eBay item ID
        await storage.updateProduct(productId, {
          listedOnEbay: true,
          ebayItemId: itemId
        });

        // Log the successful listing
        await storage.createSyncLog({
          source: "ebay",
          operation: "product_listing",
          status: "success",
          message: `Successfully listed product "${product.name}" on eBay with Item ID: ${itemId}`,
          details: JSON.stringify({
            productId,
            itemId,
            listingData,
            ebayResponse: response
          })
        });

        return {
          success: true,
          itemId,
          message: `Product "${product.name}" successfully listed on eBay with Item ID: ${itemId}`
        };

      } catch (ebayError) {
        console.error("eBay API listing failed:", ebayError);
        
        // Log the failed listing attempt
        await storage.createSyncLog({
          source: "ebay",
          operation: "product_listing",
          status: "error",
          message: `Failed to list product "${product.name}" on eBay: ${(ebayError as Error).message}`,
          details: JSON.stringify({
            productId,
            listingData,
            error: (ebayError as Error).message
          })
        });

        return {
          success: false,
          message: `Failed to list on eBay: ${(ebayError as Error).message}`,
          errors: [(ebayError as Error).message]
        };
      }

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



  private createVerifyItemXML(listingData: any): string {
    console.log("createVerifyItemXML - Using OAuth via header");
    console.log(`Shipping policy ID for listing: ${listingData.shippingPolicyId}`);
    
    return `<?xml version="1.0" encoding="utf-8"?>
<VerifyAddFixedPriceItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <Item>
    <Title>${this.escapeXml(listingData.title)}</Title>
    <Description><![CDATA[${this.sanitizeCdata(listingData.description)}]]></Description>
    <PrimaryCategory>
      <CategoryID>${listingData.categoryId}</CategoryID>
    </PrimaryCategory>
    <StartPrice currencyID="${this.listingCurrency}">${listingData.startPrice}</StartPrice>
    <Quantity>${listingData.quantity}</Quantity>
    <ListingDuration>GTC</ListingDuration>
    <Country>${this.listingCountry}</Country>
    <Currency>${this.listingCurrency}</Currency>
    <Location>${this.escapeXml(this.listingLocation)}</Location>
    <ListingType>FixedPriceItem</ListingType>
    <ConditionID>1000</ConditionID>
    ${this.buildPictureDetailsXml(listingData.pictureURLs)}
    <SellerProfiles>
      <SellerShippingProfile>
        <ShippingProfileID>${listingData.shippingPolicyId}</ShippingProfileID>
      </SellerShippingProfile>
      <SellerPaymentProfile>
        <PaymentProfileID>${this.paymentProfileId}</PaymentProfileID>
      </SellerPaymentProfile>
      <SellerReturnProfile>
        <ReturnProfileID>${this.returnProfileId}</ReturnProfileID>
      </SellerReturnProfile>
    </SellerProfiles>
    ${this.buildItemSpecificsXml(listingData)}
  </Item>
</VerifyAddFixedPriceItemRequest>`;
  }

  private createAddItemXML(listingData: any): string {
    console.log("createAddItemXML - Using OAuth via header");
    console.log(`Shipping policy ID for listing: ${listingData.shippingPolicyId}`);
    
    return `<?xml version="1.0" encoding="utf-8"?>
<AddFixedPriceItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <Item>
    <Title>${this.escapeXml(listingData.title)}</Title>
    <Description><![CDATA[${this.sanitizeCdata(listingData.description)}]]></Description>
    <PrimaryCategory>
      <CategoryID>${listingData.categoryId}</CategoryID>
    </PrimaryCategory>
    <StartPrice currencyID="${this.listingCurrency}">${listingData.startPrice}</StartPrice>
    <Quantity>${listingData.quantity}</Quantity>
    <ListingDuration>GTC</ListingDuration>
    <Country>${this.listingCountry}</Country>
    <Currency>${this.listingCurrency}</Currency>
    <Location>${this.escapeXml(this.listingLocation)}</Location>
    <ListingType>FixedPriceItem</ListingType>
    <ConditionID>1000</ConditionID>
    ${this.buildPictureDetailsXml(listingData.pictureURLs)}
    <SellerProfiles>
      <SellerShippingProfile>
        <ShippingProfileID>${listingData.shippingPolicyId}</ShippingProfileID>
      </SellerShippingProfile>
      <SellerPaymentProfile>
        <PaymentProfileID>${this.paymentProfileId}</PaymentProfileID>
      </SellerPaymentProfile>
      <SellerReturnProfile>
        <ReturnProfileID>${this.returnProfileId}</ReturnProfileID>
      </SellerReturnProfile>
    </SellerProfiles>
    ${this.buildItemSpecificsXml(listingData)}
  </Item>
</AddFixedPriceItemRequest>`;
  }

  private escapeXml(text: string): string {
    return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // CDATA can't contain the literal sequence "]]>". Split it so the
  // description survives even if a product description embeds it. Also cap
  // length — eBay's Description limit is 500k chars.
  private sanitizeCdata(text: string): string {
    return String(text ?? '')
      .replace(/]]>/g, ']]]]><![CDATA[>')
      .slice(0, 500000);
  }

  // Emit one <PictureURL> per image (eBay allows up to 24). Falls back to
  // an empty <PictureDetails/> when there are none.
  private buildPictureDetailsXml(pictureURLs?: string[]): string {
    if (!pictureURLs || pictureURLs.length === 0) {
      return `<PictureDetails></PictureDetails>`;
    }
    const urls = pictureURLs
      .slice(0, 24)
      .map((url) => `      <PictureURL>${this.escapeXml(url)}</PictureURL>`)
      .join('\n');
    return `<PictureDetails>\n${urls}\n    </PictureDetails>`;
  }

  // Item specifics derived from the product, not hardcoded to Arduino.
  // Uses whatever the caller provides on listingData.itemSpecifics
  // (a record of name -> value); falls back to Brand=Unbranded and the
  // product's SKU as MPN, which satisfies eBay's "required specifics"
  // for most electronics categories without mislabelling everything as
  // an Arduino dev board.
  private buildItemSpecificsXml(listingData: any): string {
    const specifics: Record<string, string> = {
      Brand: listingData.brand || 'Unbranded',
      ...(listingData.mpn || listingData.sku
        ? { MPN: listingData.mpn || listingData.sku }
        : {}),
      ...(listingData.itemSpecifics || {}),
    };

    const entries = Object.entries(specifics).filter(
      ([, v]) => v !== undefined && v !== null && String(v).trim() !== '',
    );
    if (entries.length === 0) return '';

    const nameValueLists = entries
      .map(
        ([name, value]) => `      <NameValueList>
        <Name>${this.escapeXml(name)}</Name>
        <Value>${this.escapeXml(String(value))}</Value>
      </NameValueList>`,
      )
      .join('\n');

    return `<ItemSpecifics>\n${nameValueLists}\n    </ItemSpecifics>`;
  }

  private createReviseItemXML(listingData: any): string {
    const pictureXML = this.buildPictureDetailsXml(listingData.pictureURLs);

    console.log("createReviseItemXML - Using OAuth via header");
    console.log(`Shipping policy ID for revision: ${listingData.shippingPolicyId}`);

    // Only include SellerProfiles if we have a valid shipping policy ID
    // For template-only updates (title/description), we don't want to change existing policies
    const sellerProfilesXML = listingData.shippingPolicyId ? `
    <SellerProfiles>
      <SellerShippingProfile>
        <ShippingProfileID>${listingData.shippingPolicyId}</ShippingProfileID>
      </SellerShippingProfile>
      <SellerPaymentProfile>
        <PaymentProfileID>${this.paymentProfileId}</PaymentProfileID>
      </SellerPaymentProfile>
      <SellerReturnProfile>
        <ReturnProfileID>${this.returnProfileId}</ReturnProfileID>
      </SellerReturnProfile>
    </SellerProfiles>` : '';

    return `<?xml version="1.0" encoding="utf-8"?>
<ReviseFixedPriceItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <Item>
    <ItemID>${listingData.itemId}</ItemID>
    <Title>${this.escapeXml(listingData.title)}</Title>
    <Description><![CDATA[${this.sanitizeCdata(listingData.description)}]]></Description>
    <PrimaryCategory>
      <CategoryID>${listingData.categoryId}</CategoryID>
    </PrimaryCategory>
    <StartPrice currencyID="${this.listingCurrency}">${listingData.startPrice}</StartPrice>
    <Quantity>${listingData.quantity}</Quantity>
    <ListingDuration>GTC</ListingDuration>
    <Country>${this.listingCountry}</Country>
    <Currency>${this.listingCurrency}</Currency>
    <Location>${this.escapeXml(this.listingLocation)}</Location>
    <ListingType>FixedPriceItem</ListingType>
    <ConditionID>1000</ConditionID>
    ${pictureXML}${sellerProfilesXML}
  </Item>
</ReviseFixedPriceItemRequest>`;
  }

  private createEndItemXML(itemId: string): string {
    console.log("createEndItemXML - Using OAuth via header");
    return `<?xml version="1.0" encoding="utf-8"?>
<EndItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ItemID>${itemId}</ItemID>
  <EndingReason>NotAvailable</EndingReason>
</EndItemRequest>`;
  }

  private async makeTradingApiRequest(xmlBody: string, callName: string = 'AddFixedPriceItem'): Promise<string> {
    const tradingUrl = this.isProduction ? this.tradingApiUrl : this.sandboxTradingApiUrl;
    console.log("Using eBay environment:", this.isProduction ? "PRODUCTION" : "SANDBOX");
    
    // Get OAuth token for Trading API (uses X-EBAY-API-IAF-TOKEN header)
    let oauthToken: string;
    try {
      oauthToken = await this.getOAuthToken();
    } catch (error) {
      console.error("Failed to get OAuth token for Trading API:", error);
      throw new Error(`OAuth authentication failed: ${(error as Error).message}`);
    }
    
    console.log("Making eBay API request to:", tradingUrl);
    console.log("API Call Name:", callName);
    console.log("Using OAuth token via X-EBAY-API-IAF-TOKEN header");
    
    // Track eBay API call in database
    try {
      await storage.trackApiCall('ebay');
    } catch (error) {
      console.error('Failed to track eBay API call:', error);
    }
    
    const response = await fetch(tradingUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'X-EBAY-API-COMPATIBILITY-LEVEL': '967',
        'X-EBAY-API-DEV-NAME': this.credentials.devId,
        'X-EBAY-API-APP-NAME': this.credentials.appId,
        'X-EBAY-API-CERT-NAME': this.credentials.certId,
        'X-EBAY-API-CALL-NAME': callName,
        'X-EBAY-API-SITEID': this.siteId,
        'X-EBAY-API-IAF-TOKEN': oauthToken  // OAuth token for Trading API
      },
      body: xmlBody
    });

    console.log("eBay API response status:", response.status, response.statusText);
    
    const responseText = await response.text();
    console.log("eBay API response body:", responseText.substring(0, 500) + "...");

    if (!response.ok) {
      throw new Error(`eBay Trading API request failed: ${response.status} ${response.statusText}`);
    }

    return responseText;
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

  /**
   * Ask eBay for the best category for a free-text query on the configured
   * site (DE=77). Result cached per query. Returns null on any failure so
   * the caller can fall back to a default category.
   */
  async getSuggestedCategory(query: string): Promise<{ id: string; name: string } | null> {
    const key = query.trim().toLowerCase();
    if (!key) return null;
    if (this.categorySuggestionCache.has(key)) {
      return this.categorySuggestionCache.get(key)!;
    }
    // DB-backed cache: survives serverless cold starts (the in-memory Map
    // above empties on every new function instance).
    const cacheKey = `suggest:${this.siteId}:${key}`;
    const cached = await storage.getTaxonomyCache(cacheKey);
    if (cached) {
      this.categorySuggestionCache.set(key, cached);
      return cached;
    }
    try {
      // Modern Taxonomy REST API (the legacy Trading GetSuggestedCategories
      // is blocked at eBay's edge). category_tree_id == site id for the
      // major marketplaces (DE=77, UK=3, US=0).
      const token = await ebayOAuth.getValidAccessToken();
      const treeId = this.siteId;
      const url =
        `https://api.ebay.com/commerce/taxonomy/v1/category_tree/${treeId}` +
        `/get_category_suggestions?q=${encodeURIComponent(query)}`;
      const resp = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "Accept-Language": "de-DE",
          "X-EBAY-C-MARKETPLACE-ID": this.marketplaceId,
        },
      });
      if (!resp.ok) {
        console.warn(`Taxonomy suggestions HTTP ${resp.status} for "${query}": ${(await resp.text()).slice(0, 200)}`);
        return null;
      }
      const data = await resp.json();
      const top = data?.categorySuggestions?.[0]?.category;
      const id = top?.categoryId;
      const name = top?.categoryName || "";
      if (id) {
        const result = { id: String(id), name };
        this.categorySuggestionCache.set(key, result);
        await storage.setTaxonomyCache(cacheKey, result); // 30-day TTL
        console.log(`🗂️ eBay suggested category for "${query}": ${id} (${name})`);
        return result;
      }
      return null;
    } catch (err) {
      console.warn(`Taxonomy get_category_suggestions failed for "${query}":`, (err as Error).message);
      return null;
    }
  }

  async getEbayCategories(): Promise<any[]> {
    try {
      console.log('Fetching eBay categories... (using OAuth via header)');
      const xmlBody = `<?xml version="1.0" encoding="utf-8"?>
<GetCategoriesRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <CategorySiteID>${this.siteId}</CategorySiteID>
  <DetailLevel>ReturnAll</DetailLevel>
  <LevelLimit>4</LevelLimit>
  <ViewAllNodes>true</ViewAllNodes>
</GetCategoriesRequest>`;

      const response = await this.makeTradingApiRequest(xmlBody);
      
      // Parse XML response to extract categories
      const categories = this.parseEbayCategories(response);
      console.log(`Found ${categories.length} total categories`);
      
      // Filter for electronics/technology categories
      const electronicsCategories = categories.filter(cat => 
        cat.name.toLowerCase().includes('electronic') ||
        cat.name.toLowerCase().includes('computer') ||
        cat.name.toLowerCase().includes('component') ||
        cat.name.toLowerCase().includes('microcontroller') ||
        cat.name.toLowerCase().includes('arduino') ||
        cat.name.toLowerCase().includes('development') ||
        cat.name.toLowerCase().includes('board') ||
        cat.parentPath?.toLowerCase().includes('electronic') ||
        cat.parentPath?.toLowerCase().includes('computer')
      );

      console.log(`Found ${electronicsCategories.length} electronics categories`);
      return electronicsCategories;
    } catch (error) {
      console.error('Error fetching eBay categories:', error);
      return [];
    }
  }

  private parseEbayCategories(xmlResponse: string): any[] {
    const categories: any[] = [];
    
    try {
      // Simple XML parsing for category extraction
      const categoryMatches = xmlResponse.match(/<Category>[\s\S]*?<\/Category>/g) || [];
      
      for (const categoryXml of categoryMatches) {
        const categoryIdMatch = categoryXml.match(/<CategoryID>(\d+)<\/CategoryID>/);
        const categoryNameMatch = categoryXml.match(/<CategoryName><!\[CDATA\[(.*?)\]\]><\/CategoryName>/);
        const categoryLevelMatch = categoryXml.match(/<CategoryLevel>(\d+)<\/CategoryLevel>/);
        const leafCategoryMatch = categoryXml.match(/<LeafCategory>(true|false)<\/LeafCategory>/);
        const parentIdMatch = categoryXml.match(/<CategoryParentID>(\d+)<\/CategoryParentID>/);
        
        if (categoryIdMatch && categoryNameMatch) {
          const category = {
            id: categoryIdMatch[1],
            name: categoryNameMatch[1],
            level: categoryLevelMatch ? parseInt(categoryLevelMatch[1]) : 0,
            isLeaf: leafCategoryMatch ? leafCategoryMatch[1] === 'true' : false,
            parentId: parentIdMatch ? parentIdMatch[1] : null,
            parentPath: '' // Will be populated later
          };
          
          categories.push(category);
        }
      }
      
      // Build parent paths
      for (const category of categories) {
        if (category.parentId) {
          const parent = categories.find(c => c.id === category.parentId);
          if (parent) {
            category.parentPath = parent.name;
          }
        }
      }
      
    } catch (error) {
      console.error('Error parsing categories:', error);
    }
    
    return categories;
  }

  async findBestCategoryForProduct(productTitle: string): Promise<{ id: string; name: string; path: string } | null> {
    try {
      const categories = await this.getEbayCategories();
      
      // Search for best matching leaf categories
      const searchTerms = productTitle.toLowerCase().split(' ');
      
      let bestMatch = null;
      let highestScore = 0;
      
      for (const category of categories) {
        if (!category.isLeaf) continue; // Only consider leaf categories
        
        let score = 0;
        const categoryText = (category.name + ' ' + category.parentPath).toLowerCase();
        
        // Score based on keyword matches
        for (const term of searchTerms) {
          if (categoryText.includes(term)) {
            score += term.length; // Longer matches get higher scores
          }
        }
        
        // Bonus for electronics-related categories
        if (categoryText.includes('electronic') || categoryText.includes('computer')) {
          score += 10;
        }
        
        if (score > highestScore) {
          highestScore = score;
          bestMatch = {
            id: category.id,
            name: category.name,
            path: category.parentPath + ' > ' + category.name
          };
        }
      }
      
      return bestMatch;
    } catch (error) {
      console.error('Error finding best category:', error);
      return null;
    }
  }

  async getBusinessPolicies(): Promise<any> {
    try {
      // Get seller information to understand business policies setup
      const xmlRequest = `<?xml version="1.0" encoding="utf-8"?>
<GetUserRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <UserID></UserID>
  <IncludeSelector>BusinessSellerDetails</IncludeSelector>
</GetUserRequest>`;

      console.log("Fetching eBay business policies... (using OAuth via header)");
      const response = await this.makeTradingApiRequestForPolicies(xmlRequest);
      
      // Parse the response to extract policy information
      const shippingPolicies = this.extractPolicies(response, 'ShippingProfile');
      const paymentPolicies = this.extractPolicies(response, 'PaymentProfile');
      const returnPolicies = this.extractPolicies(response, 'ReturnPolicyProfile');

      return {
        success: true,
        policies: {
          shipping: shippingPolicies,
          payment: paymentPolicies,
          returns: returnPolicies
        },
        rawResponse: response
      };

    } catch (error) {
      console.error("Failed to fetch business policies:", error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  private async makeTradingApiRequestForPolicies(xmlBody: string): Promise<string> {
    const tradingUrl = this.isProduction ? this.tradingApiUrl : this.sandboxTradingApiUrl;
    
    // Get OAuth token for Trading API
    let oauthToken: string;
    try {
      oauthToken = await this.getOAuthToken();
    } catch (error) {
      console.error("Failed to get OAuth token for Trading API:", error);
      throw new Error(`OAuth authentication failed: ${(error as Error).message}`);
    }
    
    // Track eBay API call in database
    try {
      await storage.trackApiCall('ebay');
    } catch (error) {
      console.error('Failed to track eBay API call:', error);
    }
    
    const response = await fetch(tradingUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'X-EBAY-API-COMPATIBILITY-LEVEL': '967',
        'X-EBAY-API-DEV-NAME': this.credentials.devId,
        'X-EBAY-API-APP-NAME': this.credentials.appId,
        'X-EBAY-API-CERT-NAME': this.credentials.certId,
        'X-EBAY-API-CALL-NAME': 'GetUser',
        'X-EBAY-API-SITEID': this.siteId,
        'X-EBAY-API-IAF-TOKEN': oauthToken
      },
      body: xmlBody
    });

    if (!response.ok) {
      throw new Error(`eBay API request failed: ${response.status} ${response.statusText}`);
    }

    return await response.text();
  }

  private extractPolicies(xmlResponse: string, profileType: string): any[] {
    const policies: any[] = [];
    const regex = new RegExp(`<${profileType}[^>]*>([\\s\\S]*?)</${profileType}>`, 'g');
    let match;

    while ((match = regex.exec(xmlResponse)) !== null) {
      const profileContent = match[1];
      const idMatch = profileContent.match(/<ProfileID>(\d+)<\/ProfileID>/);
      const nameMatch = profileContent.match(/<ProfileName>(.*?)<\/ProfileName>/);
      
      if (idMatch) {
        policies.push({
          id: idMatch[1],
          name: nameMatch ? nameMatch[1] : `${profileType} ${idMatch[1]}`,
          type: profileType
        });
      }
    }

    return policies;
  }

  async updateProduct(productId: number, updateData?: Partial<EbayListingRequest>, forceDescriptionRefresh: boolean = true): Promise<EbayApiResponse> {
    try {
      // Get product data and eBay item ID
      const product = await storage.getProduct(productId);
      if (!product) {
        return { success: false, message: "Product not found" };
      }

      if (!product.ebayItemId || !product.listedOnEbay) {
        return { success: false, message: "Product is not currently listed on eBay" };
      }

      console.log(`Updating eBay listing for product ${productId}, eBay Item ID: ${product.ebayItemId}`);

      // Generate listing data from product (similar to listProduct but for updates)
      const listingTemplate = generateEbayListing(product);
      
      // Automatically determine the best eBay category for this TME product (for updates)
      const categoryMapping = findEbayCategoryForTMEProduct(product);
      
      // Calculate eBay-specific stock (limited to preserve account limits)
      const stockInfo = calculateEbayStock(product);
      const ebayQuantity = stockInfo.ebayStock;
      
      console.log(`Stock calculation for update of ${product.name}:`, {
        tmeStock: stockInfo.tmeStock,
        ebayStock: stockInfo.ebayStock,
        isLimited: stockInfo.isLimited,
        reason: stockInfo.limitReason
      });
      
      console.log("Update function - Using OAuth via header");
      console.log("Generated listing template description length:", listingTemplate.htmlDescription.length);
      console.log("Generated template description preview:", listingTemplate.htmlDescription.substring(0, 200));
      
      // Force eBay to recognize description changes by adding unique content
      const timestamp = new Date().getTime();
      const uniqueMarker = `<!-- Template Version: 2.0 | Updated: ${timestamp} -->`;
      
      // Temporarily modify template content to force refresh
      let templateWithForceRefresh = listingTemplate.htmlDescription;
      if (!updateData?.description) {
        // Add a hidden timestamp div to ensure content changes
        const hiddenTimestamp = `<div style="display:none;" data-update="${timestamp}">Last updated: ${new Date().toISOString()}</div>`;
        templateWithForceRefresh = uniqueMarker + hiddenTimestamp + listingTemplate.htmlDescription;
      }
      
      const finalDescription = updateData?.description || templateWithForceRefresh;
      
      // Fix protocol-relative URLs for images
      const fixedImageUrl = product.imageUrl && product.imageUrl.startsWith('//') 
        ? 'https:' + product.imageUrl 
        : product.imageUrl;
      
      const listingData = {
        itemId: product.ebayItemId,
        title: updateData?.title || listingTemplate.title,
        description: finalDescription,
        startPrice: updateData?.startPrice || Number(product.salePrice),
        quantity: updateData?.quantity || ebayQuantity,
        categoryId: updateData?.categoryId || categoryMapping.categoryId, // Use automatically mapped category
        condition: updateData?.condition || "New",
        pictureURLs: fixedImageUrl ? [fixedImageUrl] : undefined,
        ...updateData
      };

      console.log("Generated listing template description length:", listingTemplate.htmlDescription.length);
      console.log("Generated template description preview:", listingTemplate.htmlDescription.substring(0, 300));
      console.log("Using description in update: HTML template with unique marker");
      console.log("Final description length:", finalDescription.length);
      console.log("Unique marker:", uniqueMarker);

      console.log("Updating eBay listing with data:", {
        itemId: listingData.itemId,
        title: listingData.title,
        price: listingData.startPrice,
        quantity: listingData.quantity
      });

      // Create ReviseFixedPriceItem XML request
      const xmlRequest = this.createReviseItemXML(listingData);
      console.log("Making eBay ReviseFixedPriceItem API call");
      
      const response = await this.makeTradingApiRequest(xmlRequest, 'ReviseFixedPriceItem');
      
      // Parse response for success
      const ackMatch = response.match(/<Ack>(.*?)<\/Ack>/);
      const isSuccess = ackMatch && (ackMatch[1] === 'Success' || ackMatch[1] === 'Warning');
      
      if (isSuccess) {
        console.log("eBay listing updated successfully");
        
        // Log the update
        await storage.createSyncLog({
          source: "ebay",
          operation: "update_listing", 
          status: "success",
          message: `Updated eBay listing for product ${product.name}`,
          details: JSON.stringify({
            productId,
            ebayItemId: product.ebayItemId,
            updatedFields: Object.keys(updateData || {})
          })
        });

        return {
          success: true,
          itemId: product.ebayItemId,
          message: "eBay listing updated successfully"
        };
      } else {
        const errorMatch = response.match(/<LongMessage>(.*?)<\/LongMessage>/);
        const errorMessage = errorMatch ? errorMatch[1] : "Unknown eBay update error";
        
        console.log("eBay update failed:", errorMessage);
        
        await storage.createSyncLog({
          source: "ebay", 
          operation: "update_listing",
          status: "error",
          message: `Failed to update eBay listing: ${errorMessage}`,
          details: JSON.stringify({ productId, ebayItemId: product.ebayItemId, error: errorMessage })
        });

        return {
          success: false,
          message: `eBay update failed: ${errorMessage}`
        };
      }
      
    } catch (error) {
      console.error("Error updating eBay listing:", error);
      
      await storage.createSyncLog({
        source: "ebay",
        operation: "update_listing", 
        status: "error",
        message: `Error updating eBay listing: ${(error as Error).message}`,
        details: JSON.stringify({ productId, error: (error as Error).message })
      });

      return {
        success: false,
        message: `Failed to update eBay listing: ${(error as Error).message}`
      };
    }
  }

  async unlistProduct(productId: number): Promise<EbayApiResponse> {
    try {
      const product = await storage.getProduct(productId);
      if (!product || !product.ebayItemId) {
        throw new Error("Product not found or not listed on eBay");
      }

      console.log(`Unlisting product ${product.name} (Item ID: ${product.ebayItemId}) from eBay...`);
      console.log("Using OAuth via header for unlisting");

      // Create EndItem XML request
      const endItemXml = this.createEndItemXML(product.ebayItemId);
      
      // Make EndItem API call
      const responseText = await this.makeTradingApiRequest(endItemXml, 'EndItem');
      
      // Check if the API call was successful
      const isSuccess = responseText.includes('<Ack>Success</Ack>') || 
                       responseText.includes('<Ack>Warning</Ack>');
      
      if (!isSuccess) {
        const errorMatch = responseText.match(/<ShortMessage>(.*?)<\/ShortMessage>/) ||
                          responseText.match(/<LongMessage>(.*?)<\/LongMessage>/);
        const errorMessage = errorMatch ? errorMatch[1] : 'Unknown error occurred';
        
        // For token expiration, provide clear feedback but don't update database
        if (errorMessage.includes('token is hard expired') || errorMessage.includes('expired')) {
          console.log(`Token expired for unlisting ${product.name}. eBay listing remains active.`);
          
          await storage.createSyncLog({
            source: "ebay",
            operation: "product_unlisting",
            status: "error",
            message: `Failed to unlist "${product.name}" from eBay: Token expired. Product remains listed on eBay.`,
            details: JSON.stringify({
              productId,
              itemId: product.ebayItemId,
              error: errorMessage,
              note: "Token expired - eBay listing still active"
            })
          });

          return {
            success: false,
            message: `Failed to unlist "${product.name}" from eBay: Token expired. The product is still listed on eBay. Please refresh your eBay token to unlist products.`,
            errors: [errorMessage]
          };
        }
        
        throw new Error(`eBay EndItem failed: ${errorMessage}`);
      }

      console.log("eBay unlisting successful:", { itemId: product.ebayItemId, productId });

      // Update product in database - KEEP ebayItemId so we can relist when stock returns
      // Only set listedOnEbay to false to indicate the listing is currently ended
      await storage.updateProduct(productId, {
        listedOnEbay: false
        // Don't clear ebayItemId - we need it to know this product was previously listed
      });

      await storage.createSyncLog({
        source: "ebay",
        operation: "product_unlisting",
        status: "success",
        message: `Successfully unlisted product "${product.name}" from eBay (Item ID: ${product.ebayItemId})`,
        details: JSON.stringify({
          productId,
          itemId: product.ebayItemId,
          ebayResponse: responseText
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

  /**
   * Bulk update inventory for multiple products using eBay ReviseInventoryStatus API
   * This is more efficient than individual ReviseFixedPriceItem calls
   * eBay allows up to 4 SKUs per ReviseInventoryStatus call (can batch multiple calls)
   * 
   * @param items Array of items to update with itemId, quantity, and optionally price
   * @returns Aggregated results for all items
   */
  async bulkUpdateInventory(items: Array<{
    productId: number;
    ebayItemId: string;
    quantity?: number;
    price?: number;
    sku?: string;
  }>): Promise<{
    success: boolean;
    processed: number;
    succeeded: number;
    failed: number;
    results: Array<{ productId: number; ebayItemId: string; success: boolean; message: string }>;
  }> {
    if (items.length === 0) {
      return { success: true, processed: 0, succeeded: 0, failed: 0, results: [] };
    }

    console.log(`📦 Starting bulk inventory update for ${items.length} items`);
    
    // eBay ReviseInventoryStatus supports up to 4 items per call
    const BATCH_SIZE = 4;
    const batches = [];
    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      batches.push(items.slice(i, i + BATCH_SIZE));
    }

    const allResults: Array<{ productId: number; ebayItemId: string; success: boolean; message: string }> = [];
    let totalSucceeded = 0;
    let totalFailed = 0;

    // Process batches with rate limiting (60 calls/min for eBay Trading API)
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      console.log(`⏳ Processing batch ${batchIndex + 1}/${batches.length} (${batch.length} items)`);

      try {
        const batchResults = await this.processBulkInventoryBatch(batch);
        allResults.push(...batchResults);
        
        for (const result of batchResults) {
          if (result.success) {
            totalSucceeded++;
          } else {
            totalFailed++;
          }
        }

        // Rate limiting: wait 1 second between batches to stay under 60/min limit
        if (batchIndex < batches.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (error) {
        console.error(`❌ Batch ${batchIndex + 1} failed:`, error);
        // Mark all items in failed batch as failed
        for (const item of batch) {
          allResults.push({
            productId: item.productId,
            ebayItemId: item.ebayItemId,
            success: false,
            message: `Batch processing failed: ${(error as Error).message}`
          });
          totalFailed++;
        }
      }
    }

    const overallSuccess = totalFailed === 0;
    console.log(`📊 Bulk update complete: ${totalSucceeded} succeeded, ${totalFailed} failed`);

    await storage.createSyncLog({
      source: "ebay",
      operation: "bulk_inventory_update",
      status: overallSuccess ? "success" : "partial",
      message: `Bulk inventory update: ${totalSucceeded}/${items.length} items updated successfully`,
      details: JSON.stringify({
        processed: items.length,
        succeeded: totalSucceeded,
        failed: totalFailed,
        batches: batches.length
      })
    });

    return {
      success: overallSuccess,
      processed: items.length,
      succeeded: totalSucceeded,
      failed: totalFailed,
      results: allResults
    };
  }

  /**
   * Process a single batch of inventory updates using ReviseInventoryStatus
   */
  private async processBulkInventoryBatch(items: Array<{
    productId: number;
    ebayItemId: string;
    quantity?: number;
    price?: number;
    sku?: string;
  }>): Promise<Array<{ productId: number; ebayItemId: string; success: boolean; message: string }>> {
    console.log("processBulkInventoryBatch - Using OAuth via header");
    
    const inventoryStatusXml = items.map(item => {
      let fields = `<ItemID>${item.ebayItemId}</ItemID>`;
      if (item.quantity !== undefined) {
        fields += `\n        <Quantity>${item.quantity}</Quantity>`;
      }
      if (item.price !== undefined) {
        fields += `\n        <StartPrice currencyID="${this.listingCurrency}">${item.price.toFixed(2)}</StartPrice>`;
      }
      return `<InventoryStatus>\n        ${fields}\n      </InventoryStatus>`;
    }).join('\n      ');

    const xml = `<?xml version="1.0" encoding="utf-8"?>
<ReviseInventoryStatusRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  ${inventoryStatusXml}
</ReviseInventoryStatusRequest>`;

    console.log("ReviseInventoryStatus XML preview:", xml.substring(0, 500) + "...");

    try {
      const response = await this.makeTradingApiRequest(xml, 'ReviseInventoryStatus');
      
      // Parse response to get individual item results
      const results: Array<{ productId: number; ebayItemId: string; success: boolean; message: string }> = [];
      
      // Check overall success
      const isSuccess = response.includes('<Ack>Success</Ack>') || response.includes('<Ack>Warning</Ack>');
      
      if (isSuccess) {
        // Extract individual InventoryStatus results
        for (const item of items) {
          // Look for this item's result in the response
          const itemPattern = new RegExp(`<ItemID>${item.ebayItemId}</ItemID>`, 'g');
          const itemSuccess = response.includes(`<ItemID>${item.ebayItemId}</ItemID>`);
          
          results.push({
            productId: item.productId,
            ebayItemId: item.ebayItemId,
            success: itemSuccess || isSuccess, // If overall success, assume all items succeeded
            message: itemSuccess ? "Inventory updated successfully" : "Item updated (inferred from batch success)"
          });

          // Update local database with new values
          if (item.quantity !== undefined || item.price !== undefined) {
            const updateData: any = {};
            if (item.quantity !== undefined) {
              updateData.stock = item.quantity;
            }
            if (item.price !== undefined) {
              updateData.salePrice = String(item.price);
            }
            await storage.updateProduct(item.productId, updateData);
          }
        }
      } else {
        // Extract error message
        const errorMatch = response.match(/<LongMessage>(.*?)<\/LongMessage>/);
        const errorMessage = errorMatch ? errorMatch[1] : "Unknown eBay error";
        
        for (const item of items) {
          results.push({
            productId: item.productId,
            ebayItemId: item.ebayItemId,
            success: false,
            message: errorMessage
          });
        }
      }
      
      return results;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Queue aggregation: Collect multiple updates and process them in bulk
   * Processes when queue reaches 20 items or after timeout
   */
  async aggregateAndUpdateInventory(items: Array<{
    productId: number;
    ebayItemId: string;
    quantity?: number;
    price?: number;
    sku?: string;
  }>): Promise<{
    success: boolean;
    processed: number;
    message: string;
  }> {
    if (items.length < 4) {
      // For small batches, process immediately
      const result = await this.bulkUpdateInventory(items);
      return {
        success: result.success,
        processed: result.processed,
        message: `Processed ${result.succeeded}/${result.processed} items successfully`
      };
    }

    // For larger batches, split into optimal chunks of 4 (eBay limit)
    console.log(`🔄 Aggregating ${items.length} items for bulk update`);
    const result = await this.bulkUpdateInventory(items);
    return {
      success: result.success,
      processed: result.processed,
      message: `Bulk update: ${result.succeeded} succeeded, ${result.failed} failed`
    };
  }
  /**
   * Get eBay shipping service details using GeteBayDetails Trading API
   * Returns valid domestic and international shipping services for the UK marketplace
   */
  async getShippingServices(): Promise<{
    success: boolean;
    domestic: Array<{
      code: string;
      description: string;
      carrier: string;
      shippingTimeMin: number;
      shippingTimeMax: number;
    }>;
    international: Array<{
      code: string;
      description: string;
      carrier: string;
      shippingTimeMin: number;
      shippingTimeMax: number;
    }>;
    error?: string;
  }> {
    try {
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<GeteBayDetailsRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <DetailName>ShippingServiceDetails</DetailName>
</GeteBayDetailsRequest>`;

      const response = await this.makeTradingApiRequest(xml, 'GeteBayDetails');
      
      // Parse the XML response
      const domestic: Array<{
        code: string;
        description: string;
        carrier: string;
        shippingTimeMin: number;
        shippingTimeMax: number;
      }> = [];
      const international: Array<{
        code: string;
        description: string;
        carrier: string;
        shippingTimeMin: number;
        shippingTimeMax: number;
      }> = [];

      // Simple XML parsing for shipping services
      const serviceRegex = /<ShippingServiceDetails>([\s\S]*?)<\/ShippingServiceDetails>/g;
      let match;
      
      while ((match = serviceRegex.exec(response)) !== null) {
        const serviceBlock = match[1];
        
        // Check if valid for selling flow
        const validMatch = serviceBlock.match(/<ValidForSellingFlow>(true|false)<\/ValidForSellingFlow>/);
        if (!validMatch || validMatch[1] !== 'true') continue;
        
        // Extract service details
        const codeMatch = serviceBlock.match(/<ShippingService>([^<]+)<\/ShippingService>/);
        const descMatch = serviceBlock.match(/<Description>([^<]+)<\/Description>/);
        const carrierMatch = serviceBlock.match(/<ShippingCarrier>([^<]+)<\/ShippingCarrier>/);
        const intlMatch = serviceBlock.match(/<InternationalService>(true|false)<\/InternationalService>/);
        const timeMinMatch = serviceBlock.match(/<ShippingTimeMin>(\d+)<\/ShippingTimeMin>/);
        const timeMaxMatch = serviceBlock.match(/<ShippingTimeMax>(\d+)<\/ShippingTimeMax>/);
        
        if (codeMatch && descMatch) {
          const service = {
            code: codeMatch[1],
            description: descMatch[1],
            carrier: carrierMatch ? carrierMatch[1] : 'Other',
            shippingTimeMin: timeMinMatch ? parseInt(timeMinMatch[1]) : 1,
            shippingTimeMax: timeMaxMatch ? parseInt(timeMaxMatch[1]) : 5
          };
          
          if (intlMatch && intlMatch[1] === 'true') {
            international.push(service);
          } else {
            domestic.push(service);
          }
        }
      }

      console.log(`📦 Fetched ${domestic.length} domestic and ${international.length} international shipping services`);
      
      return {
        success: true,
        domestic,
        international
      };
    } catch (error) {
      console.error('Failed to get shipping services:', error);
      return {
        success: false,
        domestic: [],
        international: [],
        error: (error as Error).message
      };
    }
  }

  /**
   * Get eBay shipping locations/regions using GeteBayDetails Trading API
   */
  async getShippingLocations(): Promise<{
    success: boolean;
    regions: Array<{
      code: string;
      description: string;
    }>;
    error?: string;
  }> {
    try {
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<GeteBayDetailsRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <DetailName>ShippingLocationDetails</DetailName>
</GeteBayDetailsRequest>`;

      const response = await this.makeTradingApiRequest(xml, 'GeteBayDetails');
      
      const regions: Array<{ code: string; description: string }> = [];

      // Parse shipping locations
      const locationRegex = /<ShippingLocationDetails>([\s\S]*?)<\/ShippingLocationDetails>/g;
      let match;
      
      while ((match = locationRegex.exec(response)) !== null) {
        const locationBlock = match[1];
        
        const codeMatch = locationBlock.match(/<ShippingLocation>([^<]+)<\/ShippingLocation>/);
        const descMatch = locationBlock.match(/<Description>([^<]+)<\/Description>/);
        
        if (codeMatch) {
          regions.push({
            code: codeMatch[1],
            description: descMatch ? descMatch[1] : codeMatch[1]
          });
        }
      }

      console.log(`🌍 Fetched ${regions.length} shipping locations`);
      
      return {
        success: true,
        regions
      };
    } catch (error) {
      console.error('Failed to get shipping locations:', error);
      return {
        success: false,
        regions: [],
        error: (error as Error).message
      };
    }
  }

  /**
   * Get dispatch time options using GeteBayDetails Trading API
   */
  async getDispatchTimeOptions(): Promise<{
    success: boolean;
    options: Array<{
      value: number;
      description: string;
    }>;
    error?: string;
  }> {
    try {
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<GeteBayDetailsRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <DetailName>DispatchTimeMaxDetails</DetailName>
</GeteBayDetailsRequest>`;

      const response = await this.makeTradingApiRequest(xml, 'GeteBayDetails');
      
      const options: Array<{ value: number; description: string }> = [];

      // Parse dispatch time options
      const optionRegex = /<DispatchTimeMaxDetails>([\s\S]*?)<\/DispatchTimeMaxDetails>/g;
      let match;
      
      while ((match = optionRegex.exec(response)) !== null) {
        const optionBlock = match[1];
        
        const valueMatch = optionBlock.match(/<DispatchTimeMax>(\d+)<\/DispatchTimeMax>/);
        const descMatch = optionBlock.match(/<Description>([^<]+)<\/Description>/);
        
        if (valueMatch) {
          options.push({
            value: parseInt(valueMatch[1]),
            description: descMatch ? descMatch[1] : `${valueMatch[1]} working days`
          });
        }
      }

      console.log(`⏱️ Fetched ${options.length} dispatch time options`);
      
      return {
        success: true,
        options
      };
    } catch (error) {
      console.error('Failed to get dispatch time options:', error);
      return {
        success: false,
        options: [],
        error: (error as Error).message
      };
    }
  }
}

export const ebayApi = new EbayApiService();
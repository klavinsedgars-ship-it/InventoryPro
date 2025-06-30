// Test script to examine TME API response structure for minimum quantity
import crypto from 'crypto';

const credentials = {
  token: "31e955195075d0a74f5a57451e8b2bd443871292297c97d307",
  customerNumber: "40071812",
  contactNumber: "676772",
  applicationSecret: "d89d00191de2b7a6834f"
};

function generateApiSignature(method, url, params) {
  const sortedParams = Object.keys(params)
    .sort()
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&');

  const signatureBaseString = [
    method.toUpperCase(),
    encodeURIComponent(url),
    encodeURIComponent(sortedParams)
  ].join('&');

  const signature = crypto
    .createHmac('sha1', credentials.applicationSecret)
    .update(signatureBaseString)
    .digest('base64');

  return signature;
}

async function testTMEDetailedResponse() {
  console.log("=== TME API DETAILED RESPONSE TEST ===");
  
  // Test 1: Search for products and examine structure
  const searchParams = {
    Token: credentials.token,
    Language: "EN",
    SearchPlain: "arduino",
    SearchWithStock: "1"
  };

  const searchSignature = generateApiSignature('POST', 'https://api.tme.eu/Products/Search.json', searchParams);
  searchParams.ApiSignature = searchSignature;

  console.log("\n--- TEST 1: Product Search ---");
  try {
    const formData = new URLSearchParams();
    Object.keys(searchParams).forEach(key => {
      formData.append(key, searchParams[key]);
    });

    const response = await fetch("https://api.tme.eu/Products/Search.json", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
      },
      body: formData.toString(),
    });

    if (response.ok) {
      const data = await response.json();
      console.log("Status:", data.Status);
      
      if (data.Data && data.Data.ProductList && data.Data.ProductList.length > 0) {
        console.log("Number of products:", data.Data.ProductList.length);
        
        // Examine first product in detail
        const firstProduct = data.Data.ProductList[0];
        console.log("\n=== FIRST PRODUCT DETAILED STRUCTURE ===");
        console.log("Symbol:", firstProduct.Symbol);
        console.log("Description:", firstProduct.Description);
        console.log("Producer:", firstProduct.Producer);
        console.log("EAN:", firstProduct.EAN);
        
        console.log("\n=== ALL FIELDS IN FIRST PRODUCT ===");
        Object.keys(firstProduct).forEach(key => {
          console.log(`${key}: ${JSON.stringify(firstProduct[key])}`);
        });
        
        // Look for minimum quantity related fields
        console.log("\n=== CHECKING FOR MINIMUM QUANTITY FIELDS ===");
        const possibleMinQtyFields = ['MinQuantity', 'MinQty', 'MinimumQuantity', 'MinOrder', 'MinOrderQuantity', 'PackageQuantity', 'PackSize', 'Unit', 'OrderUnit'];
        possibleMinQtyFields.forEach(field => {
          if (firstProduct.hasOwnProperty(field)) {
            console.log(`FOUND: ${field} = ${firstProduct[field]}`);
          }
        });
        
        // Check if Parameters array contains minimum quantity info
        if (firstProduct.Parameters && Array.isArray(firstProduct.Parameters)) {
          console.log("\n=== CHECKING PARAMETERS FOR MIN QUANTITY ===");
          firstProduct.Parameters.forEach(param => {
            if (param.ParameterName && param.ParameterName.toLowerCase().includes('min')) {
              console.log(`Parameter: ${param.ParameterName} = ${param.ParameterValue} ${param.ParameterUnit || ''}`);
            }
            if (param.ParameterName && (param.ParameterName.toLowerCase().includes('pack') || param.ParameterName.toLowerCase().includes('quantity'))) {
              console.log(`Package/Qty Parameter: ${param.ParameterName} = ${param.ParameterValue} ${param.ParameterUnit || ''}`);
            }
          });
        }
      }
    } else {
      console.log("Search failed:", response.status, response.statusText);
      const errorText = await response.text();
      console.log("Error response:", errorText);
    }
  } catch (error) {
    console.error("Search error:", error);
  }

  // Test 2: Get price information which might contain minimum quantity
  console.log("\n--- TEST 2: Price Information ---");
  try {
    const priceParams = {
      Token: credentials.token,
      Language: "EN",
      SymbolList: ["A000005"] // Arduino Nano from search results
    };

    const priceSignature = generateApiSignature('POST', 'https://api.tme.eu/Products/GetPrices.json', priceParams);
    priceParams.ApiSignature = priceSignature;

    const formData = new URLSearchParams();
    Object.keys(priceParams).forEach(key => {
      if (Array.isArray(priceParams[key])) {
        priceParams[key].forEach(item => formData.append(key + '[]', item));
      } else {
        formData.append(key, priceParams[key]);
      }
    });

    const response = await fetch("https://api.tme.eu/Products/GetPrices.json", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
      },
      body: formData.toString(),
    });

    if (response.ok) {
      const data = await response.json();
      console.log("Price Status:", data.Status);
      
      if (data.Data && data.Data.PriceList && data.Data.PriceList.length > 0) {
        const priceInfo = data.Data.PriceList[0];
        console.log("\n=== PRICE INFORMATION STRUCTURE ===");
        Object.keys(priceInfo).forEach(key => {
          console.log(`${key}: ${JSON.stringify(priceInfo[key])}`);
        });
        
        // Check price breaks which might indicate minimum quantities
        if (priceInfo.PriceList && Array.isArray(priceInfo.PriceList)) {
          console.log("\n=== PRICE BREAKS (might indicate min quantities) ===");
          priceInfo.PriceList.forEach((priceBreak, index) => {
            console.log(`Price Break ${index + 1}:`);
            Object.keys(priceBreak).forEach(key => {
              console.log(`  ${key}: ${priceBreak[key]}`);
            });
          });
        }
      }
    } else {
      console.log("Price request failed:", response.status, response.statusText);
      const errorText = await response.text();
      console.log("Error response:", errorText);
    }
  } catch (error) {
    console.error("Price error:", error);
  }
}

// Run the test
testTMEDetailedResponse().catch(console.error);
// Test TME API with HMAC-SHA1 signature
import crypto from 'crypto';

const credentials = {
  token: "31e955195075d0a74f5a57451e8b2bd443871292297c97d307",
  applicationSecret: "d89d00191de2b7a6834f"
};

function generateApiSignature(method, url, params) {
  // Step 1: Create the parameter string (alphabetically sorted)
  const sortedParams = Object.keys(params)
    .sort()
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&');

  // Step 2: Create the signature base string
  const signatureBaseString = [
    method.toUpperCase(),
    encodeURIComponent(url),
    encodeURIComponent(sortedParams)
  ].join('&');

  console.log("Signature base string:", signatureBaseString);

  // Step 3: Generate HMAC-SHA1 signature
  const signature = crypto
    .createHmac('sha1', credentials.applicationSecret)
    .update(signatureBaseString)
    .digest('base64');

  return signature;
}

async function testTMEWithSignature() {
  console.log("=== TME API TEST WITH HMAC-SHA1 SIGNATURE ===");
  
  // Test Products/Search
  const params = {
    Token: credentials.token,
    Language: "EN",
    SearchPlain: "arduino",
    SearchWithStock: "1"
  };

  const url = "https://api.tme.eu/Products/Search.json";
  
  // CRITICAL: Calculate signature WITHOUT ApiSignature parameter
  const signature = generateApiSignature("POST", url, params);
  
  // Add signature to parameters AFTER calculation
  params.ApiSignature = signature;
  
  console.log("Parameters:", Object.keys(params));
  console.log("Signature:", signature);
  
  const formData = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    formData.append(key, String(value));
  });
  
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
        "User-Agent": "TME-CRM-Integration/1.0",
      },
      body: formData.toString(),
    });

    console.log("Response status:", response.status, response.statusText);
    
    const responseText = await response.text();
    console.log("Raw response (first 500 chars):", responseText.substring(0, 500));
    
    try {
      const responseData = JSON.parse(responseText);
      console.log("Status:", responseData.Status);
      if (responseData.Data && responseData.Data.ProductList) {
        console.log("Products found:", responseData.Data.ProductList.length);
        console.log("First product:", responseData.Data.ProductList[0]?.Symbol || "No products");
      }
      if (responseData.Status !== "OK") {
        console.log("Error code:", responseData.ErrorCode);
        console.log("Error message:", responseData.ErrorMessage);
      }
    } catch (parseError) {
      console.log("Failed to parse JSON response");
    }
  } catch (error) {
    console.error("Request failed:", error.message);
  }
}

testTMEWithSignature().catch(console.error);
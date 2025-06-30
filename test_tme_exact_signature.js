// Test TME API signature with exact documentation example
import crypto from 'crypto';

// Test with exact parameters from TME documentation
const testParams = {
  Language: "EN",
  SymbolList: ["1N4007", "1/4W1.1M"],
  Token: "a94a8fe5ccb19ba61c4c0873d391e987982fbbd3"
};

const expectedSignature = "tkTK5o2VGvcBbDQqolXKq25Brqw=";
const testApplicationSecret = "test"; // From documentation

function generateApiSignatureV1(method, url, params) {
  // Version 1: Double encoding approach
  const sortedParams = Object.keys(params)
    .sort()
    .map(key => `${key}=${params[key]}`)
    .join('&');

  const signatureBaseString = [
    method.toUpperCase(),
    encodeURIComponent(url),
    encodeURIComponent(encodeURIComponent(sortedParams))
  ].join('&');

  console.log("V1 - Sorted params:", sortedParams);
  console.log("V1 - Base string:", signatureBaseString);

  const signature = crypto
    .createHmac('sha1', testApplicationSecret)
    .update(signatureBaseString)
    .digest('base64');

  return signature;
}

function generateApiSignatureV2(method, url, params) {
  // Version 2: Single encoding, then double encode the whole thing
  const sortedParams = Object.keys(params)
    .sort()
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&');

  const signatureBaseString = [
    method.toUpperCase(),
    encodeURIComponent(url),
    encodeURIComponent(sortedParams)
  ].join('&');

  console.log("V2 - Sorted params:", sortedParams);
  console.log("V2 - Base string:", signatureBaseString);

  const signature = crypto
    .createHmac('sha1', testApplicationSecret)
    .update(signatureBaseString)
    .digest('base64');

  return signature;
}

console.log("=== TME SIGNATURE VALIDATION TEST ===");
console.log("Expected signature:", expectedSignature);

// Format parameters for array handling
const formattedParams = {
  Language: testParams.Language,
  "SymbolList[0]": testParams.SymbolList[0],
  "SymbolList[1]": testParams.SymbolList[1],
  Token: testParams.Token
};

const url = "https://api.tme.eu/Products/GetStocks.json";

console.log("\n--- Version 1 (Current Implementation) ---");
const sig1 = generateApiSignatureV1("POST", url, formattedParams);
console.log("Generated signature:", sig1);
console.log("Matches expected:", sig1 === expectedSignature);

console.log("\n--- Version 2 (Alternative) ---");
const sig2 = generateApiSignatureV2("POST", url, formattedParams);
console.log("Generated signature:", sig2);
console.log("Matches expected:", sig2 === expectedSignature);
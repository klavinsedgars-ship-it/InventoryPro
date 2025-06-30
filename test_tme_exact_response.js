// Test script to get exact TME API response
const credentials = {
  token: "4c7c4c076d049b050b7db3a648c6ef61c4bd1daad6c5ab09df",
  customerNumber: "40026843",
  contactNumber: "642966"
};

async function getExactTMEResponse() {
  console.log("=== EXACT TME API RESPONSE TEST ===");
  console.log("Credentials:", {
    tokenLength: credentials.token.length,
    customerNumber: credentials.customerNumber,
    contactNumber: credentials.contactNumber
  });
  
  // Test 1: POST with form data (corrected based on documentation)
  console.log("\n--- TEST 1: POST with corrected parameters ---");
  try {
    const formData = new URLSearchParams();
    formData.append("Token", credentials.token);
    formData.append("Language", "EN");
    // Don't include Country for private tokens (50 chars)
    formData.append("SearchPlain", "arduino");
    formData.append("SearchWithStock", "1");

    console.log("Request body:", formData.toString());
    
    const response = await fetch("https://api.tme.eu/Products/Search.json", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
        "User-Agent": "TME-CRM-Integration/1.0",
      },
      body: formData.toString(),
    });

    console.log("Response status:", response.status, response.statusText);
    console.log("Response headers:", Object.fromEntries(response.headers.entries()));
    
    const responseText = await response.text();
    console.log("Raw response body:", responseText);
    
    try {
      const responseData = JSON.parse(responseText);
      console.log("Parsed response:", JSON.stringify(responseData, null, 2));
    } catch (parseError) {
      console.log("Response is not valid JSON");
    }
  } catch (error) {
    console.error("Test 1 error:", error.message);
  }

  // Test 2: GET with URL parameters
  console.log("\n--- TEST 2: GET with URL parameters ---");
  try {
    const url = new URL("https://api.tme.eu/Products/Search.json");
    url.searchParams.set("Token", credentials.token);
    url.searchParams.set("Country", "US");
    url.searchParams.set("Language", "EN");
    url.searchParams.set("Currency", "USD");
    url.searchParams.set("SearchPlain", "arduino");

    console.log("Request URL:", url.toString().replace(credentials.token, "***TOKEN***"));
    
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "Accept": "application/json",
        "User-Agent": "TME-CRM-Integration/1.0",
      },
    });

    console.log("Response status:", response.status, response.statusText);
    console.log("Response headers:", Object.fromEntries(response.headers.entries()));
    
    const responseText = await response.text();
    console.log("Raw response body:", responseText);
    
    try {
      const responseData = JSON.parse(responseText);
      console.log("Parsed response:", JSON.stringify(responseData, null, 2));
    } catch (parseError) {
      console.log("Response is not valid JSON");
    }
  } catch (error) {
    console.error("Test 2 error:", error.message);
  }

  // Test 3: Different endpoint - GetCategories
  console.log("\n--- TEST 3: GetCategories endpoint ---");
  try {
    const formData = new URLSearchParams();
    formData.append("Token", credentials.token);
    formData.append("Country", "US");
    formData.append("Language", "EN");

    const response = await fetch("https://api.tme.eu/Products/GetCategories.json", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
        "User-Agent": "TME-CRM-Integration/1.0",
      },
      body: formData.toString(),
    });

    console.log("Response status:", response.status, response.statusText);
    console.log("Response headers:", Object.fromEntries(response.headers.entries()));
    
    const responseText = await response.text();
    console.log("Raw response body:", responseText);
    
    try {
      const responseData = JSON.parse(responseText);
      console.log("Parsed response:", JSON.stringify(responseData, null, 2));
    } catch (parseError) {
      console.log("Response is not valid JSON");
    }
  } catch (error) {
    console.error("Test 3 error:", error.message);
  }
}

// Run the test
getExactTMEResponse().catch(console.error);
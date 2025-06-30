// TME API Debug Tool - Testing authentication methods

export async function debugTMEAuthentication() {
  // Updated TME credentials - June 30, 2025
  const credentials = {
    token: process.env.TME_API_TOKEN || "4c7c4c076d049b050b7db3a648c6ef61c4bd1daad6c5ab09df",
    customerNumber: process.env.TME_CUSTOMER_NUMBER || "40026843",
    contactNumber: process.env.TME_CONTACT_NUMBER || "642966",
  };

  console.log("TME API Debug Information:");
  console.log("- Token length:", credentials.token.length);
  console.log("- Customer Number:", credentials.customerNumber);
  console.log("- Contact Number:", credentials.contactNumber);

  // Test 1: Basic search endpoint with different authentication methods
  const testEndpoints = [
    "/Products/Search.json",
    "/Products/GetCategories.json", 
    "/Products/GetParameters.json"
  ];

  for (const endpoint of testEndpoints) {
    console.log(`\nTesting endpoint: ${endpoint}`);
    
    // Method 1: URL parameters
    try {
      const url1 = new URL(`https://api.tme.eu${endpoint}`);
      url1.searchParams.set("Token", credentials.token);
      url1.searchParams.set("Country", "US");
      url1.searchParams.set("Language", "EN");
      
      const response1 = await fetch(url1.toString(), {
        method: "GET",
        headers: {
          "Accept": "application/json",
          "User-Agent": "TME-API-Debug/1.0",
        },
      });
      
      console.log(`Method 1 (URL params): ${response1.status} ${response1.statusText}`);
      if (response1.status === 200) {
        const data = await response1.json();
        console.log("Success! Response:", JSON.stringify(data, null, 2).substring(0, 200));
        return { success: true, method: "URL params", endpoint };
      }
    } catch (error) {
      console.log(`Method 1 error:`, error.message);
    }

    // Method 2: POST with form data
    try {
      const formData = new URLSearchParams();
      formData.append("Token", credentials.token);
      formData.append("Country", "US");
      formData.append("Language", "EN");
      
      const response2 = await fetch(`https://api.tme.eu${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Accept": "application/json",
          "User-Agent": "TME-API-Debug/1.0",
        },
        body: formData.toString(),
      });
      
      console.log(`Method 2 (POST form): ${response2.status} ${response2.statusText}`);
      if (response2.status === 200) {
        const data = await response2.json();
        console.log("Success! Response:", JSON.stringify(data, null, 2).substring(0, 200));
        return { success: true, method: "POST form", endpoint };
      }
    } catch (error) {
      console.log(`Method 2 error:`, error.message);
    }

    // Method 3: Authorization header
    try {
      const response3 = await fetch(`https://api.tme.eu${endpoint}?Country=US&Language=EN`, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${credentials.token}`,
          "Accept": "application/json",
          "User-Agent": "TME-API-Debug/1.0",
        },
      });
      
      console.log(`Method 3 (Auth header): ${response3.status} ${response3.statusText}`);
      if (response3.status === 200) {
        const data = await response3.json();
        console.log("Success! Response:", JSON.stringify(data, null, 2).substring(0, 200));
        return { success: true, method: "Auth header", endpoint };
      }
    } catch (error) {
      console.log(`Method 3 error:`, error.message);
    }

    // Method 4: Custom header with customer info
    try {
      const response4 = await fetch(`https://api.tme.eu${endpoint}?Country=US&Language=EN`, {
        method: "GET",
        headers: {
          "X-TME-Token": credentials.token,
          "X-TME-Customer": credentials.customerNumber,
          "X-TME-Contact": credentials.contactNumber,
          "Accept": "application/json",
          "User-Agent": "TME-API-Debug/1.0",
        },
      });
      
      console.log(`Method 4 (Custom headers): ${response4.status} ${response4.statusText}`);
      if (response4.status === 200) {
        const data = await response4.json();
        console.log("Success! Response:", JSON.stringify(data, null, 2).substring(0, 200));
        return { success: true, method: "Custom headers", endpoint };
      }
    } catch (error) {
      console.log(`Method 4 error:`, error.message);
    }
  }

  return { success: false, message: "All authentication methods failed" };
}

// Test function for specific search query
export async function testTMESearch(query: string = "arduino") {
  // Updated TME credentials - June 30, 2025
  const credentials = {
    token: process.env.TME_API_TOKEN || "4c7c4c076d049b050b7db3a648c6ef61c4bd1daad6c5ab09df",
    customerNumber: process.env.TME_CUSTOMER_NUMBER || "40026843",
    contactNumber: process.env.TME_CONTACT_NUMBER || "642966",
  };

  // Based on TME API documentation - correct endpoint structure
  const url = new URL("https://api.tme.eu/Products/Search.json");
  url.searchParams.set("Token", credentials.token);
  url.searchParams.set("Country", "US");
  url.searchParams.set("Language", "EN");
  url.searchParams.set("Currency", "USD");
  url.searchParams.set("SearchPlain", query);
  url.searchParams.set("SearchWithStock", "1");
  url.searchParams.set("SearchPhoto", "1");

  try {
    console.log("Testing TME search with URL:", url.toString().replace(credentials.token, "***TOKEN***"));
    
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "Accept": "application/json",
        "User-Agent": "TME-CRM-Integration/1.0",
      },
    });

    console.log(`Response: ${response.status} ${response.statusText}`);
    
    if (response.status === 200) {
      const data = await response.json();
      console.log("Search successful! Found products:", data.Data?.ProductList?.length || 0);
      return { success: true, data };
    } else {
      const errorText = await response.text();
      console.log("Error response body:", errorText);
      return { success: false, status: response.status, error: errorText };
    }
  } catch (error) {
    console.log("Network error:", error.message);
    return { success: false, error: error.message };
  }
}
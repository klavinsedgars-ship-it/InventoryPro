// Direct TME API test script
const newCredentials = {
  token: "4c7c4c076d049b050b7db3a648c6ef61c4bd1daad6c5ab09df",
  customerNumber: "40026843",
  contactNumber: "642966"
};

async function testTMEAPI() {
  console.log("Testing TME API with new credentials...");
  console.log("Token:", newCredentials.token.substring(0, 20) + "...");
  console.log("Customer:", newCredentials.customerNumber);
  console.log("Contact:", newCredentials.contactNumber);
  console.log("---");

  // Test 1: Categories endpoint with POST
  console.log("1. Testing GetCategories endpoint...");
  try {
    const response1 = await fetch("https://api.tme.eu/Products/GetCategories.json", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
        "User-Agent": "TME-CRM-Test/1.0"
      },
      body: new URLSearchParams({
        Token: newCredentials.token,
        Country: "US",
        Language: "EN"
      })
    });
    
    const data1 = await response1.json();
    console.log("Status:", response1.status);
    console.log("Response:", JSON.stringify(data1, null, 2));
  } catch (error) {
    console.log("Error:", error.message);
  }
  
  console.log("---");

  // Test 2: Search endpoint
  console.log("2. Testing Search endpoint...");
  try {
    const response2 = await fetch("https://api.tme.eu/Products/Search.json", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
        "User-Agent": "TME-CRM-Test/1.0"
      },
      body: new URLSearchParams({
        Token: newCredentials.token,
        Country: "US",
        Language: "EN",
        SearchPlain: "arduino",
        SearchWithStock: "1"
      })
    });
    
    const data2 = await response2.json();
    console.log("Status:", response2.status);
    console.log("Response:", JSON.stringify(data2, null, 2));
  } catch (error) {
    console.log("Error:", error.message);
  }

  console.log("---");

  // Test 3: Different search parameters with customer info
  console.log("3. Testing Search with customer/contact numbers...");
  try {
    const response3 = await fetch("https://api.tme.eu/Products/Search.json", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
        "User-Agent": "TME-CRM-Test/1.0"
      },
      body: new URLSearchParams({
        Token: newCredentials.token,
        Country: "US",
        Language: "EN",
        SearchPlain: "resistor",
        CustomerNumber: newCredentials.customerNumber,
        ContactNumber: newCredentials.contactNumber
      })
    });
    
    const data3 = await response3.json();
    console.log("Status:", response3.status);
    console.log("Response:", JSON.stringify(data3, null, 2));
  } catch (error) {
    console.log("Error:", error.message);
  }

  console.log("---");

  // Test 4: GET method with URL parameters
  console.log("4. Testing GET method with URL parameters...");
  try {
    const url = new URL("https://api.tme.eu/Products/Search.json");
    url.searchParams.set("Token", newCredentials.token);
    url.searchParams.set("Country", "US");
    url.searchParams.set("Language", "EN");
    url.searchParams.set("SearchPlain", "arduino");
    url.searchParams.set("CustomerNumber", newCredentials.customerNumber);
    url.searchParams.set("ContactNumber", newCredentials.contactNumber);
    
    const response4 = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "Accept": "application/json",
        "User-Agent": "TME-CRM-Test/1.0"
      }
    });
    
    const data4 = await response4.json();
    console.log("Status:", response4.status);
    console.log("Response:", JSON.stringify(data4, null, 2));
  } catch (error) {
    console.log("Error:", error.message);
  }
}

testTMEAPI();
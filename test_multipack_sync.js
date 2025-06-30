// Test multipack product sync using HTTP requests
import http from 'http';

function makeRequest(path, data) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 5000,
      path: path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(JSON.stringify(data))
      }
    };

    const req = http.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => {
        responseData += chunk;
      });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(responseData);
          resolve(parsed);
        } catch (e) {
          resolve(responseData);
        }
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.write(JSON.stringify(data));
    req.end();
  });
}

async function syncMultipackProducts() {
  console.log("🔍 Testing TME sync with multipack products...");
  
  try {
    // First clear existing products
    console.log("Clearing existing products...");
    const clearResult = await makeRequest('/api/products/clear', {});
    console.log("Clear result:", clearResult);
    
    // Sync resistors which typically have minimum quantities
    console.log("\n1. Syncing 0603 resistors (should have 50+ minimums):");
    const resistorResult = await makeRequest('/api/tme/sync', {
      searchQuery: 'resistor 0603 10k',
      limit: 3
    });
    console.log("Resistor sync:", resistorResult);
    
    // Sync capacitors which often have minimum quantities
    console.log("\n2. Syncing 0805 capacitors (should have 25+ minimums):");
    const capacitorResult = await makeRequest('/api/tme/sync', {
      searchQuery: 'capacitor 0805 100nf', 
      limit: 2
    });
    console.log("Capacitor sync:", capacitorResult);
    
    console.log("\n✅ Multipack sync test completed!");
    
  } catch (error) {
    console.error("❌ Error:", error.message);
  }
}

syncMultipackProducts();
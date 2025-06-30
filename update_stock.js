// Quick stock update script for remaining TME products with unknown stock
const TMESymbols = [
  "A000024", "A000053", "A000073", "ABX00012", "ABX00019",
  "ABX00063", "ABX00092", "AFX00002", "AFX00005", "K000007", "T050000"
];

async function updateAllStock() {
  console.log(`Updating stock for ${TMESymbols.length} TME products...`);
  
  for (let i = 0; i < TMESymbols.length; i++) {
    const symbol = TMESymbols[i];
    try {
      console.log(`[${i+1}/${TMESymbols.length}] Testing ${symbol}...`);
      
      const response = await fetch("http://localhost:5000/api/tme/test-stock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol })
      });
      
      const data = await response.json();
      if (data.success && data.realStock !== undefined) {
        console.log(`✅ ${symbol}: ${data.realStock} units (real TME stock)`);
      } else {
        console.log(`❌ ${symbol}: No stock data available`);
      }
      
      // Add small delay to respect rate limits
      await new Promise(resolve => setTimeout(resolve, 800));
      
    } catch (error) {
      console.error(`Error testing ${symbol}:`, error.message);
    }
  }
  
  console.log("Stock check completed!");
}

updateAllStock();
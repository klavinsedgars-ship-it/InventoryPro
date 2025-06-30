const { TMEApiService } = require('./server/tme-api.ts');

async function debugStockSync() {
  console.log('=== TME Stock Sync Debug ===');
  
  const tmeApi = new TMEApiService();
  
  // Test with the specific product from the screenshot
  const testSymbol = 'SC0315-Z';
  
  try {
    console.log(`\n1. Testing stock retrieval for ${testSymbol}...`);
    const stockData = await tmeApi.getProductStock([testSymbol]);
    
    console.log('Stock API Response:', JSON.stringify(stockData, null, 2));
    
    if (stockData && stockData.length > 0) {
      const stock = stockData[0];
      console.log(`✅ Stock found: ${stock.Symbol} = ${stock.Amount} ${stock.Unit}`);
    } else {
      console.log('❌ No stock data returned');
    }
    
    console.log('\n2. Testing product search for Raspberry Pi...');
    const searchResults = await tmeApi.searchProducts('raspberry pi', 5);
    
    console.log(`Found ${searchResults.length} products:`);
    searchResults.forEach(product => {
      console.log(`- ${product.Symbol}: ${product.Description}`);
    });
    
    // Check if our target product is in search results
    const targetProduct = searchResults.find(p => p.Symbol === testSymbol);
    if (targetProduct) {
      console.log(`\n✅ Target product ${testSymbol} found in search results`);
      
      // Now test the full sync process for this one product
      console.log('\n3. Testing full sync process...');
      const syncResult = await tmeApi.syncProductsFromTME('raspberry pi', 5);
      console.log('Sync result:', JSON.stringify(syncResult, null, 2));
    } else {
      console.log(`\n❌ Target product ${testSymbol} NOT found in search results`);
    }
    
  } catch (error) {
    console.error('Debug failed:', error.message);
  }
}

debugStockSync();
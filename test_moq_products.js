import fetch from 'node-fetch';

async function findHighMOQProducts() {
  try {
    console.log('Searching for products with high MOQ...');
    
    // Search for resistors, capacitors, and other components typically sold in bulk
    const searchTerms = [
      'resistor SMD 0603 10K',
      'capacitor ceramic 0805 100nF',
      'resistor chip 0402 1K',
      'capacitor MLCC 0603 10uF',
      'inductor SMD 0805 10uH'
    ];
    
    for (const searchTerm of searchTerms) {
      console.log(`\n=== Searching for: ${searchTerm} ===`);
      
      const response = await fetch('http://localhost:5000/api/tme/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          searchTerm: searchTerm,
          limit: 3
        })
      });
      
      if (!response.ok) {
        console.log(`Search failed: ${response.status}`);
        continue;
      }
      
      const data = await response.json();
      
      if (data.products && data.products.length > 0) {
        // Get pricing for these products to see MOQ
        const symbols = data.products.map(p => p.Symbol);
        console.log(`Found ${symbols.length} products, getting pricing...`);
        
        const pricingResponse = await fetch('http://localhost:5000/api/tme/pricing', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            symbols: symbols
          })
        });
        
        if (pricingResponse.ok) {
          const pricingData = await pricingResponse.json();
          
          for (let i = 0; i < data.products.length; i++) {
            const product = data.products[i];
            const pricing = pricingData.find(p => p.Symbol === product.Symbol);
            
            if (pricing && pricing.PriceList && pricing.PriceList.length > 0) {
              const moq = pricing.PriceList[0].Amount;
              if (moq > 1) {
                console.log(`🎯 HIGH MOQ FOUND: ${product.Symbol}`);
                console.log(`   Description: ${product.Description}`);
                console.log(`   Producer: ${product.Producer}`);
                console.log(`   MOQ: ${moq} pieces`);
                console.log(`   Price: €${pricing.PriceList[0].PriceValue}`);
                console.log(`   Category: ${product.Category}`);
                console.log('');
              }
            }
          }
        }
      }
    }
    
  } catch (error) {
    console.error('Error:', error);
  }
}

findHighMOQProducts();
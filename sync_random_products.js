import { tmeApi } from './server/tme-api.js';
import { db } from './server/db.js';
import { products } from './shared/schema.js';
import { calculateDynamicPrice } from './server/dynamic-pricing.js';

// Different product categories to search from
const searchCategories = [
  'sensors',
  'microcontrollers', 
  'capacitors',
  'transistors',
  'LEDs',
  'connectors',
  'displays',
  'motors',
  'switches',
  'power supplies'
];

async function syncRandomProducts() {
  console.log('🔄 Starting random product sync from 10 different categories...');
  
  const syncedProducts = [];
  
  for (let i = 0; i < searchCategories.length; i++) {
    const category = searchCategories[i];
    console.log(`\n📦 Searching category: ${category}`);
    
    try {
      // Search for products in this category
      const searchResults = await tmeApi.searchProducts(category, { limit: 20 });
      
      if (searchResults && searchResults.length > 0) {
        // Pick a random product from the search results
        const randomIndex = Math.floor(Math.random() * Math.min(searchResults.length, 10));
        const selectedProduct = searchResults[randomIndex];
        
        console.log(`📍 Selected: ${selectedProduct.Symbol} - ${selectedProduct.Description}`);
        
        // Get detailed product information
        console.log(`🔍 Getting details for: ${selectedProduct.Symbol}`);
        
        // Get pricing
        const priceData = await tmeApi.getProductPrices([selectedProduct.Symbol]);
        const price = priceData && priceData[0] && priceData[0].PriceList && priceData[0].PriceList[0] 
          ? priceData[0].PriceList[0].Price : 0.5;
        
        // Get stock information
        const stockData = await tmeApi.getProductStocks([selectedProduct.Symbol]);
        const stock = stockData && stockData[0] 
          ? stockData[0].Amount : Math.floor(Math.random() * 1000) + 10;
          
          // Calculate dynamic pricing
          const pricingResult = calculateDynamicPrice(price);
          
          // Insert into database
          const productData = {
            name: selectedProduct.Description,
            sku: selectedProduct.Symbol,
            supplier_product_id: selectedProduct.Symbol,
            supplier: 'TME',
            category: determineCategory(category),
            supplier_price: parseFloat(price),
            sale_price: pricingResult.finalPrice,
            calculated_price: pricingResult.calculatedPrice,
            margin_tier: pricingResult.marginTier,
            stock: parseInt(stock),
            status: stock > 0 ? 'in_stock' : 'out_of_stock',
            description: selectedProduct.Description,
            image_url: selectedProduct.Photo ? `https:${selectedProduct.Photo}` : null,
            datasheet_url: null,
            weight: estimateWeight(category),
            ean: selectedProduct.EAN || null
          };
          
          const [insertedProduct] = await db.insert(products).values(productData).returning();
          syncedProducts.push(insertedProduct);
          
          console.log(`✅ Synced: ${insertedProduct.name}`);
          console.log(`   Price: €${price} → €${pricingResult.finalPrice} (${pricingResult.marginTier})`);
          console.log(`   Stock: ${stock} units`);
          
        } else {
          console.log(`❌ Failed to get details for ${selectedProduct.Symbol}`);
        }
      } else {
        console.log(`❌ No products found for category: ${category}`);
      }
      
      // Add delay to respect rate limits
      await new Promise(resolve => setTimeout(resolve, 500));
      
    } catch (error) {
      console.error(`❌ Error syncing category ${category}:`, error.message);
    }
  }
  
  console.log(`\n🎉 Sync complete! Added ${syncedProducts.length} products from different categories.`);
  
  // Show summary
  syncedProducts.forEach((product, index) => {
    console.log(`${index + 1}. ${product.name} - €${product.sale_price} (${product.stock} units)`);
  });
}

function determineCategory(searchTerm) {
  const categoryMap = {
    'sensors': 'Sensors',
    'microcontrollers': 'Microcontrollers', 
    'capacitors': 'Passive Components',
    'transistors': 'Semiconductors',
    'LEDs': 'Optoelectronics',
    'connectors': 'Connectors',
    'displays': 'Displays',
    'motors': 'Electromechanical',
    'switches': 'Switches',
    'power supplies': 'Power'
  };
  
  return categoryMap[searchTerm] || 'Electronics';
}

function estimateWeight(category) {
  const weightMap = {
    'sensors': 5,
    'microcontrollers': 3, 
    'capacitors': 1,
    'transistors': 1,
    'LEDs': 1,
    'connectors': 8,
    'displays': 25,
    'motors': 150,
    'switches': 10,
    'power supplies': 200
  };
  
  return weightMap[category] || 10;
}

// Run the sync
syncRandomProducts().catch(console.error);
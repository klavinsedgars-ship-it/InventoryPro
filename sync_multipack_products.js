// Script to sync TME products with minimum order quantities
import { tmeApi } from './server/tme-api.js';

async function syncMultipackProducts() {
  console.log("🔍 Syncing TME products with minimum order quantities...");
  
  try {
    // Search for 0603 resistors which typically have minimum quantities of 50-100 pieces
    console.log("\n1. Syncing 0603 resistors (typically 50+ piece minimums):");
    const resistorResult = await tmeApi.syncProductsFromTME('resistor 0603 10k', 3);
    console.log("Resistor sync result:", resistorResult);
    
    // Search for 0805 capacitors which often have 25-50 piece minimums
    console.log("\n2. Syncing 0805 capacitors (typically 25+ piece minimums):");
    const capacitorResult = await tmeApi.syncProductsFromTME('capacitor 0805 100nf', 2);
    console.log("Capacitor sync result:", capacitorResult);
    
    console.log("\n✅ Multipack product sync completed!");
    console.log("Check the Products page to see products with minimum order quantities.");
    
  } catch (error) {
    console.error("❌ Error syncing multipack products:", error.message);
  }
}

// Run the sync
syncMultipackProducts();
/**
 * Daily Sync Engine - Cron Jobs
 * 
 * Schedules automatic TME to eBay/Amazon synchronization at 02:00 AM daily.
 * Implements diff logic: only syncs products where price/stock has changed.
 * Designed for 150k+ product scale.
 */

import { storage } from "./storage";
import { TMEApiServiceOptimized } from "./tme-api-optimized";
import { ebayApi } from "./ebay-api";
import { calculateDynamicPrice, getSupplierPriceForMoq } from "./dynamic-pricing";
import { calculateEbayStock } from "./stock-manager";

// TME PriceList entry structure
interface TMEPriceEntry {
  Amount: number;
  PriceValue: number;
  PriceBase?: number;
  Special?: boolean;
}

// Initialize TME API with storage for PostgreSQL caching
const tmeApi = new TMEApiServiceOptimized(storage);

interface DiffResult {
  symbol: string;
  changes: {
    priceChanged: boolean;
    stockChanged: boolean;
    oldPrice?: number;
    newPrice?: number;
    oldStock?: number;
    newStock?: number;
  };
}

/**
 * Daily sync scheduler configuration
 */
const SYNC_CONFIG = {
  // Run at 02:00 AM daily (2 hours past midnight)
  dailyRunHour: 2,
  dailyRunMinute: 0,
  
  // Batch sizes for processing
  batchSize: 50, // Products to process per TME API call
  delayBetweenBatches: 2000, // 2 seconds between batches
  
  // Queue priorities
  criticalPriorityThreshold: 20, // % price change for critical priority
  highPriorityThreshold: 10, // % price change for high priority
};

/**
 * Check if it's time to run the daily sync (02:00 AM)
 */
function shouldRunDailySync(): boolean {
  const now = new Date();
  return (
    now.getHours() === SYNC_CONFIG.dailyRunHour &&
    now.getMinutes() >= SYNC_CONFIG.dailyRunMinute &&
    now.getMinutes() < SYNC_CONFIG.dailyRunMinute + 5
  );
}

/**
 * Get all local product SKUs from database
 */
async function getLocalProductSkus(): Promise<string[]> {
  try {
    const products = await storage.getProducts();
    const skus = products
      .filter(p => p.supplier === 'TME' && p.sku)
      .map(p => p.sku);
    
    console.log(`📦 Found ${skus.length} TME products in local database`);
    return skus;
  } catch (error) {
    console.error('Failed to get local product SKUs:', error);
    return [];
  }
}

/**
 * Batch fetch live price/stock data from TME API
 * Returns full PriceList for MOQ-aware pricing calculations
 */
async function fetchLiveTMEData(symbols: string[]): Promise<Map<string, { priceList: TMEPriceEntry[]; stock: number }>> {
  const liveData = new Map<string, { priceList: TMEPriceEntry[]; stock: number }>();
  
  console.log(`🔄 Fetching live TME data for ${symbols.length} products...`);
  
  try {
    // Process in batches of 50 (as per TME API recommendations)
    for (let i = 0; i < symbols.length; i += SYNC_CONFIG.batchSize) {
      const batch = symbols.slice(i, i + SYNC_CONFIG.batchSize);
      
      console.log(`📡 Batch ${Math.floor(i / SYNC_CONFIG.batchSize) + 1}/${Math.ceil(symbols.length / SYNC_CONFIG.batchSize)}`);
      
      const pricesAndStocks = await tmeApi.getProductsPricesAndStocks(batch);
      
      for (const item of pricesAndStocks) {
        // Store full PriceList for MOQ-aware pricing
        const priceList = item.PriceList || [];
        
        // Extract stock amount - check StockList first (sum of all warehouses), then fall back to Amount
        let stock = 0;
        if (item.StockList && item.StockList.length > 0) {
          // Sum up stock from all warehouses
          stock = item.StockList.reduce((sum: number, warehouse: { Amount: number }) => sum + (warehouse.Amount || 0), 0);
        } else if (item.Amount !== undefined) {
          stock = item.Amount;
        }
        
        liveData.set(item.Symbol, { priceList, stock });
      }
      
      // Respect rate limits between batches
      if (i + SYNC_CONFIG.batchSize < symbols.length) {
        await new Promise(resolve => setTimeout(resolve, SYNC_CONFIG.delayBetweenBatches));
      }
    }
    
    console.log(`✅ Fetched live data for ${liveData.size} products`);
    return liveData;
    
  } catch (error) {
    console.error('Failed to fetch live TME data:', error);
    return liveData;
  }
}

/**
 * Compare local database with live TME data
 * Returns only products where price or stock has changed
 * Uses MOQ-aware pricing to get the correct price tier
 */
async function calculateDiff(
  localSkus: string[],
  liveData: Map<string, { priceList: TMEPriceEntry[]; stock: number }>
): Promise<DiffResult[]> {
  const diffs: DiffResult[] = [];
  
  console.log('🔍 Calculating diffs between local and live data...');
  
  try {
    for (const sku of localSkus) {
      const product = await storage.getProductBySku(sku);
      if (!product) continue;
      
      const live = liveData.get(sku);
      if (!live) continue;
      
      // Use product's MOQ to get the correct price tier from TME's PriceList
      const moq = product.moq || 1;
      const livePrice = getSupplierPriceForMoq(live.priceList, moq);
      
      const localPrice = parseFloat(product.supplierPrice?.toString() || '0');
      const localStock = product.stock || 0;
      
      const priceChanged = Math.abs(localPrice - livePrice) > 0.01; // Allow 1 cent tolerance
      const stockChanged = localStock !== live.stock;
      
      if (priceChanged || stockChanged) {
        diffs.push({
          symbol: sku,
          changes: {
            priceChanged,
            stockChanged,
            oldPrice: localPrice,
            newPrice: livePrice,
            oldStock: localStock,
            newStock: live.stock
          }
        });
      }
    }
    
    console.log(`📊 Found ${diffs.length} products with changes (${localSkus.length - diffs.length} unchanged)`);
    return diffs;
    
  } catch (error) {
    console.error('Failed to calculate diffs:', error);
    return diffs;
  }
}

/**
 * Determine priority based on change magnitude
 */
function calculatePriority(diff: DiffResult): number {
  const priceChange = Math.abs(
    ((diff.changes.newPrice || 0) - (diff.changes.oldPrice || 0)) / 
    ((diff.changes.oldPrice || 1))
  ) * 100;
  
  if (priceChange >= SYNC_CONFIG.criticalPriorityThreshold) {
    return 1; // Critical
  } else if (priceChange >= SYNC_CONFIG.highPriorityThreshold) {
    return 2; // High
  } else if (diff.changes.stockChanged && diff.changes.newStock === 0) {
    return 1; // Critical - out of stock
  } else if (diff.changes.stockChanged) {
    return 3; // Medium - stock change
  }
  return 4; // Low
}

/**
 * Push changed items to sync queue
 */
async function pushToSyncQueue(diffs: DiffResult[]): Promise<number> {
  let queued = 0;
  
  console.log(`📤 Pushing ${diffs.length} items to sync queue...`);
  
  try {
    for (const diff of diffs) {
      const product = await storage.getProductBySku(diff.symbol);
      if (!product) continue;
      
      const priority = calculatePriority(diff);
      const operation = diff.changes.priceChanged ? 'update_price' : 'update_stock';
      
      await storage.createSyncQueueItem({
        productId: product.id,
        operation,
        priority,
        status: 'pending',
        marketplace: 'ebay', // Default marketplace
        retryCount: 0,
        maxRetries: 3
      });
      
      // Also update local product with new TME data
      await storage.updateProduct(product.id, {
        supplierPrice: diff.changes.newPrice?.toString() || product.supplierPrice,
        stock: diff.changes.newStock ?? product.stock,
        lastSyncedAt: new Date()
      });
      
      queued++;
    }
    
    console.log(`✅ Queued ${queued} items for sync`);
    return queued;
    
  } catch (error) {
    console.error('Failed to push to sync queue:', error);
    return queued;
  }
}

/**
 * Sync product changes to eBay in batches
 * Uses ReviseInventoryStatus API for efficient bulk updates
 */
async function syncToEbay(diffs: DiffResult[]): Promise<{
  attempted: number;
  succeeded: number;
  failed: number;
  skipped: number;
  ended: number;
  relisted: number;
}> {
  console.log('');
  console.log('🏪 EBAY SYNC PHASE');
  console.log('==================');
  
  const result = { attempted: 0, succeeded: 0, failed: 0, skipped: 0, ended: 0, relisted: 0 };
  
  if (diffs.length === 0) {
    console.log('⚠️ No changes to sync to eBay');
    return result;
  }
  
  try {
    // Separate products into: updates (has stock), endings (out of stock), relistings (back in stock)
    const ebayUpdates: Array<{
      productId: number;
      ebayItemId: string;
      quantity?: number;
      price?: number;
      sku?: string;
    }> = [];
    
    const productsToEnd: Array<{
      productId: number;
      ebayItemId: string;
      productName: string;
      sku?: string;
    }> = [];
    
    const productsToRelist: Array<{
      productId: number;
      productName: string;
      sku?: string;
    }> = [];
    
    for (const diff of diffs) {
      const product = await storage.getProductBySku(diff.symbol);
      if (!product) continue;
      
      // Calculate eBay stock (with limit) - use product stock info
      const tmeStock = diff.changes.newStock ?? product.stock ?? 0;
      const stockInfo = calculateEbayStock({ ...product, stock: tmeStock });
      const ebayStock = stockInfo.ebayStock;
      
      // Check if product was previously on eBay but got ended (has ebayItemId but listedOnEbay is false)
      // AND now has stock - should be relisted automatically
      if (product.ebayItemId && !product.listedOnEbay && ebayStock > 0) {
        productsToRelist.push({
          productId: product.id,
          productName: product.name,
          sku: product.sku
        });
        continue;
      }
      
      // Skip products not currently listed on eBay
      if (!product.ebayItemId || !product.listedOnEbay) {
        result.skipped++;
        continue;
      }
      
      // If out of stock, END the listing instead of setting quantity to 0
      // This prevents negative eBay algorithm impact from having many out-of-stock listings
      if (ebayStock === 0) {
        productsToEnd.push({
          productId: product.id,
          ebayItemId: product.ebayItemId,
          productName: product.name,
          sku: product.sku
        });
        continue;
      }
      
      // Calculate eBay price with dynamic pricing for in-stock products
      const supplierPrice = diff.changes.newPrice || parseFloat(product.supplierPrice?.toString() || '0');
      const pricingResult = supplierPrice > 0 
        ? calculateDynamicPrice(supplierPrice) 
        : { finalPrice: parseFloat(product.salePrice?.toString() || '0') };
      
      ebayUpdates.push({
        productId: product.id,
        ebayItemId: product.ebayItemId,
        quantity: ebayStock,
        price: pricingResult.finalPrice,
        sku: product.sku
      });
    }
    
    // PHASE 1: End listings for out-of-stock products
    if (productsToEnd.length > 0) {
      console.log(`🛑 Ending ${productsToEnd.length} out-of-stock listings (better for eBay algorithm)`);
      
      for (const item of productsToEnd) {
        try {
          const endResult = await ebayApi.unlistProduct(item.productId);
          if (endResult.success) {
            result.ended++;
            console.log(`   ✅ Ended listing for "${item.productName}" (${item.sku})`);
          } else {
            result.failed++;
            console.log(`   ❌ Failed to end "${item.productName}": ${endResult.message}`);
          }
        } catch (error) {
          result.failed++;
          console.log(`   ❌ Error ending "${item.productName}": ${(error as Error).message}`);
        }
        
        // Small delay between EndItem calls to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    // PHASE 2: Re-list products that are back in stock (previously ended due to out of stock)
    if (productsToRelist.length > 0) {
      console.log(`🔄 Re-listing ${productsToRelist.length} products back in stock`);
      
      for (const item of productsToRelist) {
        try {
          const listResult = await ebayApi.listProduct(item.productId, {}, true);
          if (listResult.success) {
            result.relisted++;
            console.log(`   ✅ Re-listed "${item.productName}" (${item.sku})`);
          } else {
            result.failed++;
            console.log(`   ❌ Failed to re-list "${item.productName}": ${listResult.message}`);
          }
        } catch (error) {
          result.failed++;
          console.log(`   ❌ Error re-listing "${item.productName}": ${(error as Error).message}`);
        }
        
        // Delay between listing calls to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    // PHASE 3: Update inventory for in-stock products
    if (ebayUpdates.length > 0) {
      console.log(`📦 Syncing ${ebayUpdates.length} in-stock products to eBay in batches of 4`);
      result.attempted = ebayUpdates.length;
      
      // Use the existing bulk update function which batches in groups of 4
      const bulkResult = await ebayApi.bulkUpdateInventory(ebayUpdates);
      
      result.succeeded = bulkResult.succeeded;
      result.failed += bulkResult.failed;
      
      // Log individual failures for debugging
      const failures = bulkResult.results.filter(r => !r.success);
      if (failures.length > 0) {
        console.log(`⚠️ Failed eBay updates:`);
        failures.slice(0, 5).forEach(f => console.log(`   - ${f.ebayItemId}: ${f.message}`));
        if (failures.length > 5) {
          console.log(`   ... and ${failures.length - 5} more`);
        }
      }
    } else if (productsToEnd.length === 0 && productsToRelist.length === 0) {
      console.log('⚠️ No eBay-listed products with changes');
      return result;
    }
    
    // Log to sync logs
    await storage.createSyncLog({
      source: 'cron',
      operation: 'ebay_bulk_sync',
      status: result.failed === 0 ? 'success' : 'partial',
      message: `eBay sync: ${result.succeeded} updated, ${result.relisted} re-listed, ${result.ended} ended, ${result.failed} failed, ${result.skipped} skipped`,
      details: JSON.stringify({
        attempted: result.attempted,
        succeeded: result.succeeded,
        relisted: result.relisted,
        ended: result.ended,
        failed: result.failed,
        skipped: result.skipped
      })
    });
    
    console.log(`✅ eBay sync complete: ${result.succeeded} updated, ${result.relisted} re-listed, ${result.ended} ended, ${result.failed} failed, ${result.skipped} skipped`);
    return result;
    
  } catch (error) {
    console.error('❌ eBay sync failed:', error);
    
    await storage.createSyncLog({
      source: 'cron',
      operation: 'ebay_bulk_sync',
      status: 'error',
      message: `eBay sync failed: ${(error as Error).message}`
    });
    
    return result;
  }
}

/**
 * Main daily sync function
 * Fetches local SKUs, compares with TME, queues only changed items, syncs to eBay
 */
export async function runDailySync(): Promise<{
  totalProducts: number;
  changedProducts: number;
  queuedItems: number;
  ebaySync: { attempted: number; succeeded: number; failed: number; skipped: number; ended: number; relisted: number };
  duration: number;
}> {
  const startTime = Date.now();
  console.log('');
  console.log('====================================');
  console.log('🌙 DAILY SYNC STARTED at ' + new Date().toISOString());
  console.log('====================================');
  
  const emptyResult = { 
    totalProducts: 0, 
    changedProducts: 0, 
    queuedItems: 0, 
    ebaySync: { attempted: 0, succeeded: 0, failed: 0, skipped: 0, ended: 0, relisted: 0 },
    duration: 0 
  };
  
  try {
    // Log sync start
    await storage.createSyncLog({
      source: 'cron',
      operation: 'daily_sync_start',
      status: 'in_progress',
      message: 'Daily TME sync started'
    });
    
    // Step 1: Get all local TME product SKUs
    const localSkus = await getLocalProductSkus();
    if (localSkus.length === 0) {
      console.log('⚠️ No TME products found in database');
      return emptyResult;
    }
    
    // Step 2: Batch fetch live TME data
    const liveData = await fetchLiveTMEData(localSkus);
    
    // Step 3: Calculate diffs (only changed products)
    const diffs = await calculateDiff(localSkus, liveData);
    
    // Step 4: Push changed items to sync queue and update local DB
    const queuedItems = await pushToSyncQueue(diffs);
    
    // Step 5: Sync changes to eBay in batches
    const ebayResult = await syncToEbay(diffs);
    
    const duration = Math.round((Date.now() - startTime) / 1000);
    
    // Log sync completion
    await storage.createSyncLog({
      source: 'cron',
      operation: 'daily_sync_complete',
      status: 'success',
      message: `Daily sync completed: ${diffs.length} changes, ${ebayResult.succeeded} eBay updates`,
      details: JSON.stringify({
        totalProducts: localSkus.length,
        changedProducts: diffs.length,
        queuedItems,
        ebaySync: ebayResult,
        duration
      })
    });
    
    console.log('');
    console.log('====================================');
    console.log('✅ DAILY SYNC COMPLETED');
    console.log(`   Total products: ${localSkus.length}`);
    console.log(`   Changes detected: ${diffs.length}`);
    console.log(`   Items queued: ${queuedItems}`);
    console.log(`   eBay updates: ${ebayResult.succeeded}/${ebayResult.attempted} (${ebayResult.skipped} skipped)`);
    console.log(`   eBay re-listed (back in stock): ${ebayResult.relisted}`);
    console.log(`   eBay listings ended (out of stock): ${ebayResult.ended}`);
    console.log(`   Duration: ${duration}s`);
    console.log('====================================');
    console.log('');
    
    return {
      totalProducts: localSkus.length,
      changedProducts: diffs.length,
      queuedItems,
      ebaySync: ebayResult,
      duration
    };
    
  } catch (error) {
    console.error('❌ Daily sync failed:', error);
    
    await storage.createSyncLog({
      source: 'cron',
      operation: 'daily_sync_error',
      status: 'error',
      message: `Daily sync failed: ${(error as Error).message}`
    });
    
    return emptyResult;
  }
}

/**
 * Get the last daily sync date from the database
 */
async function getLastSyncDate(): Promise<string | null> {
  try {
    const logs = await storage.getSyncLogs(10);
    const lastDailySync = logs.find(log => 
      log.source === 'cron' && 
      log.operation === 'daily_sync_complete' &&
      log.status === 'success'
    );
    if (lastDailySync) {
      return new Date(lastDailySync.syncedAt!).toDateString();
    }
    return null;
  } catch (error) {
    console.error('Failed to get last sync date:', error);
    return null;
  }
}

/**
 * Check if we missed today's scheduled sync (app was sleeping/restarted)
 */
async function checkMissedSync(): Promise<boolean> {
  const now = new Date();
  const currentHour = now.getHours();
  const todayDate = now.toDateString();
  
  // Only check if we're past the scheduled time (after 2 AM)
  if (currentHour < SYNC_CONFIG.dailyRunHour) {
    return false;
  }
  
  // Check if we already ran today
  const lastSyncDate = await getLastSyncDate();
  if (lastSyncDate === todayDate) {
    console.log('✅ Daily sync already completed today');
    return false;
  }
  
  console.log(`⚠️ Missed daily sync! Last sync was: ${lastSyncDate || 'never'}`);
  return true;
}

/**
 * Start the daily sync scheduler
 * Uses setInterval to check every minute if it's time to run
 * Also checks on startup if we missed today's scheduled sync
 */
export async function startDailySyncScheduler(): Promise<void> {
  console.log('⏰ Daily sync scheduler started');
  console.log(`   Scheduled time: ${SYNC_CONFIG.dailyRunHour}:${String(SYNC_CONFIG.dailyRunMinute).padStart(2, '0')} AM`);
  
  // Check if we missed today's sync (app was sleeping during scheduled time)
  const missedSync = await checkMissedSync();
  if (missedSync) {
    console.log('🔄 Running missed daily sync now...');
    // Run in background after a short delay to let server fully start
    setTimeout(async () => {
      try {
        await runDailySync();
      } catch (error) {
        console.error('Failed to run missed sync:', error);
      }
    }, 10000); // Wait 10 seconds for server to be ready
  }
  
  // Regular scheduler - check every minute
  setInterval(async () => {
    const now = new Date();
    const todayDate = now.toDateString();
    
    // Check if it's time to run and we haven't run today
    if (shouldRunDailySync()) {
      const lastSyncDate = await getLastSyncDate();
      if (lastSyncDate !== todayDate) {
        console.log('🕐 Daily sync triggered by scheduler');
        await runDailySync();
      }
    }
  }, 60000); // Check every minute
}

/**
 * Manual trigger for daily sync (for testing or admin use)
 */
export async function triggerManualSync(): Promise<{
  totalProducts: number;
  changedProducts: number;
  queuedItems: number;
  ebaySync: { attempted: number; succeeded: number; failed: number; skipped: number };
  duration: number;
}> {
  console.log('🔧 Manual sync triggered');
  return await runDailySync();
}

/**
 * Daily Sync Engine - Cron Jobs
 * 
 * Schedules automatic TME to eBay/Amazon synchronization at 02:00 AM daily.
 * Implements diff logic: only syncs products where price/stock has changed.
 * Designed for 150k+ product scale.
 */

import { storage } from "./storage";
import { TMEApiServiceOptimized } from "./tme-api-optimized";

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
 */
async function fetchLiveTMEData(symbols: string[]): Promise<Map<string, { price: number; stock: number }>> {
  const liveData = new Map<string, { price: number; stock: number }>();
  
  console.log(`🔄 Fetching live TME data for ${symbols.length} products...`);
  
  try {
    // Process in batches of 50 (as per TME API recommendations)
    for (let i = 0; i < symbols.length; i += SYNC_CONFIG.batchSize) {
      const batch = symbols.slice(i, i + SYNC_CONFIG.batchSize);
      
      console.log(`📡 Batch ${Math.floor(i / SYNC_CONFIG.batchSize) + 1}/${Math.ceil(symbols.length / SYNC_CONFIG.batchSize)}`);
      
      const pricesAndStocks = await tmeApi.getProductsPricesAndStocks(batch);
      
      for (const item of pricesAndStocks) {
        // Extract price from PriceList (first/best price)
        let price = 0;
        if (item.PriceList && item.PriceList.length > 0) {
          price = item.PriceList[0].PriceValue || item.PriceList[0].PriceBase || 0;
        }
        
        // Extract stock amount
        const stock = item.Amount || 0;
        
        liveData.set(item.Symbol, { price, stock });
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
 */
async function calculateDiff(
  localSkus: string[],
  liveData: Map<string, { price: number; stock: number }>
): Promise<DiffResult[]> {
  const diffs: DiffResult[] = [];
  
  console.log('🔍 Calculating diffs between local and live data...');
  
  try {
    for (const sku of localSkus) {
      const product = await storage.getProductBySku(sku);
      if (!product) continue;
      
      const live = liveData.get(sku);
      if (!live) continue;
      
      const localPrice = parseFloat(product.supplierPrice?.toString() || '0');
      const localStock = product.stock || 0;
      
      const priceChanged = Math.abs(localPrice - live.price) > 0.01; // Allow 1 cent tolerance
      const stockChanged = localStock !== live.stock;
      
      if (priceChanged || stockChanged) {
        diffs.push({
          symbol: sku,
          changes: {
            priceChanged,
            stockChanged,
            oldPrice: localPrice,
            newPrice: live.price,
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
 * Main daily sync function
 * Fetches local SKUs, compares with TME, queues only changed items
 */
export async function runDailySync(): Promise<{
  totalProducts: number;
  changedProducts: number;
  queuedItems: number;
  duration: number;
}> {
  const startTime = Date.now();
  console.log('');
  console.log('====================================');
  console.log('🌙 DAILY SYNC STARTED at ' + new Date().toISOString());
  console.log('====================================');
  
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
      return { totalProducts: 0, changedProducts: 0, queuedItems: 0, duration: 0 };
    }
    
    // Step 2: Batch fetch live TME data
    const liveData = await fetchLiveTMEData(localSkus);
    
    // Step 3: Calculate diffs (only changed products)
    const diffs = await calculateDiff(localSkus, liveData);
    
    // Step 4: Push changed items to sync queue
    const queuedItems = await pushToSyncQueue(diffs);
    
    const duration = Math.round((Date.now() - startTime) / 1000);
    
    // Log sync completion
    await storage.createSyncLog({
      source: 'cron',
      operation: 'daily_sync_complete',
      status: 'success',
      message: `Daily sync completed: ${diffs.length} changes detected, ${queuedItems} items queued`,
      details: JSON.stringify({
        totalProducts: localSkus.length,
        changedProducts: diffs.length,
        queuedItems,
        duration
      })
    });
    
    console.log('');
    console.log('====================================');
    console.log('✅ DAILY SYNC COMPLETED');
    console.log(`   Total products: ${localSkus.length}`);
    console.log(`   Changes detected: ${diffs.length}`);
    console.log(`   Items queued: ${queuedItems}`);
    console.log(`   Duration: ${duration}s`);
    console.log('====================================');
    console.log('');
    
    return {
      totalProducts: localSkus.length,
      changedProducts: diffs.length,
      queuedItems,
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
    
    return { totalProducts: 0, changedProducts: 0, queuedItems: 0, duration: 0 };
  }
}

/**
 * Start the daily sync scheduler
 * Uses setInterval to check every minute if it's time to run
 */
export function startDailySyncScheduler(): void {
  let lastRunDate = '';
  
  console.log('⏰ Daily sync scheduler started');
  console.log(`   Scheduled time: ${SYNC_CONFIG.dailyRunHour}:${String(SYNC_CONFIG.dailyRunMinute).padStart(2, '0')} AM`);
  
  // Check every minute if it's time to run
  setInterval(async () => {
    const now = new Date();
    const todayDate = now.toDateString();
    
    // Only run once per day at the scheduled time
    if (shouldRunDailySync() && lastRunDate !== todayDate) {
      lastRunDate = todayDate;
      console.log('🕐 Daily sync triggered by scheduler');
      await runDailySync();
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
  duration: number;
}> {
  console.log('🔧 Manual sync triggered');
  return await runDailySync();
}

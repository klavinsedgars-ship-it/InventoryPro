/**
 * Sync Queue Worker - Background processor for TME product synchronization
 * Handles rate limiting and prioritized processing without blocking the UI
 */

import { storage } from "./storage";
import { tmeApi } from "./tme-api";
import { calculateDynamicPrice } from "./dynamic-pricing";
import type { SyncQueue } from "@shared/schema";

interface QueueWorkerConfig {
  maxConcurrent: number;
  batchSize: number;
  priorityLevels: number;
  retryDelayMs: number;
}

export class SyncQueueWorker {
  private isRunning = false;
  private config: QueueWorkerConfig;

  constructor(config: Partial<QueueWorkerConfig> = {}) {
    this.config = {
      maxConcurrent: config.maxConcurrent || 1, // Process one batch at a time
      batchSize: config.batchSize || 10,
      priorityLevels: config.priorityLevels || 4,
      retryDelayMs: config.retryDelayMs || 5000,
    };
  }

  /**
   * Start the queue worker - runs continuously checking for pending items
   */
  start() {
    if (this.isRunning) {
      console.log("⚠️ Queue worker already running");
      return;
    }

    this.isRunning = true;
    console.log("🚀 Sync Queue Worker started");
    this.processQueue();
  }

  /**
   * Stop the queue worker gracefully
   */
  stop() {
    this.isRunning = false;
    console.log("🛑 Sync Queue Worker stopped");
  }

  /**
   * Main queue processing loop
   */
  private async processQueue() {
    while (this.isRunning) {
      try {
        // Get pending items sorted by priority
        const pendingItems = await storage.getPendingSyncQueueItems(
          this.config.maxConcurrent
        );

        if (pendingItems.length === 0) {
          // No items to process, wait before checking again
          await this.sleep(5000);
          continue;
        }

        console.log(`📊 Processing ${pendingItems.length} sync queue items`);

        // Process items in parallel (up to maxConcurrent)
        const promises = pendingItems
          .slice(0, this.config.maxConcurrent)
          .map((item) => this.processQueueItem(item));

        await Promise.all(promises);
      } catch (error) {
        console.error("❌ Queue processing error:", error);
        await this.sleep(this.config.retryDelayMs);
      }
    }
  }

  /**
   * Process a single queue item
   */
  private async processQueueItem(item: SyncQueue) {
    try {
      // Mark as processing
      await storage.updateSyncQueueItem(item.id, { status: "processing" });

      const product = await storage.getProduct(item.productId);
      if (!product) {
        throw new Error(`Product ${item.productId} not found`);
      }

      // Get TME product data
      const enhancedInfo = await tmeApi.getEnhancedProductInfo([
        product.supplierProductId || product.sku,
      ]);

      if (!enhancedInfo || enhancedInfo.length === 0) {
        throw new Error("No enhanced info returned from TME");
      }

      const { product: tmeProduct, price, stock } = enhancedInfo[0];

      // Calculate pricing
      const supplierPrice = price?.PriceList?.[0]?.PriceValue || 0;
      const pricingResult =
        supplierPrice > 0
          ? calculateDynamicPrice(supplierPrice)
          : {
              finalPrice: supplierPrice,
              calculatedPrice: supplierPrice,
              marginTier: "No Margin",
              marginPercentage: 0,
              isValid: true,
            };

      // Update product based on operation type
      const updateData: any = {
        stock: stock?.Amount || product.stock,
        supplierPrice: String(supplierPrice),
      };

      if (item.operation === "list") {
        // For listing operations, also update pricing
        updateData.salePrice = String(pricingResult.finalPrice);
        updateData.calculatedPrice = String(pricingResult.calculatedPrice);
        updateData.marginTier = pricingResult.marginTier;
        updateData.marginPercentage = String(pricingResult.marginPercentage);
        updateData.listedOnEbay = true;
      } else if (item.operation === "update_price") {
        updateData.salePrice = String(pricingResult.finalPrice);
        updateData.calculatedPrice = String(pricingResult.calculatedPrice);
        updateData.marginTier = pricingResult.marginTier;
        updateData.marginPercentage = String(pricingResult.marginPercentage);
      } else if (item.operation === "update_stock") {
        // Stock update already done above
      }

      await storage.updateProduct(item.productId, updateData);

      // Mark as completed
      await storage.updateSyncQueueItem(item.id, {
        status: "completed",
        retryCount: 0,
      });

      console.log(`✅ Completed queue item ${item.id}: ${item.operation}`);
    } catch (error) {
      console.error(`❌ Error processing queue item ${item.id}:`, error);

      // Increment retry count
      const newRetryCount = (item.retryCount || 0) + 1;
      const shouldRetry = newRetryCount < (item.maxRetries || 3);

      if (shouldRetry) {
        // Reschedule for retry
        await storage.updateSyncQueueItem(item.id, {
          status: "pending",
          retryCount: newRetryCount,
          errorMessage: error instanceof Error ? error.message : String(error),
        });
        console.log(
          `🔄 Retry scheduled for item ${item.id} (attempt ${newRetryCount}/${item.maxRetries})`
        );
      } else {
        // Mark as failed
        await storage.updateSyncQueueItem(item.id, {
          status: "failed",
          errorMessage: error instanceof Error ? error.message : String(error),
        });
        console.log(`❌ Queue item ${item.id} failed permanently`);
      }
    }
  }

  /**
   * Add product to sync queue
   */
  async queueProductSync(
    productId: number,
    operation: string,
    priority: number = 3,
    marketplace: string = "ebay"
  ) {
    return await storage.createSyncQueueItem({
      productId,
      operation,
      priority,
      marketplace,
      status: "pending",
      retryCount: 0,
      maxRetries: 3,
    });
  }

  /**
   * Add multiple products to queue
   */
  async queueProductsBatch(
    productIds: number[],
    operation: string,
    priority: number = 3,
    marketplace: string = "ebay"
  ) {
    const items = productIds.map((productId) => ({
      productId,
      operation,
      priority,
      marketplace,
      status: "pending" as const,
      retryCount: 0,
      maxRetries: 3,
    }));

    await storage.createBulkSyncQueueItems(items);
    console.log(
      `📝 Queued ${items.length} products for ${operation} operation`
    );
  }

  /**
   * Get queue statistics
   */
  async getQueueStats() {
    return await storage.getSyncQueueStats();
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Export singleton instance
export const syncQueueWorker = new SyncQueueWorker({
  maxConcurrent: 1,
  batchSize: 10,
  priorityLevels: 4,
  retryDelayMs: 5000,
});

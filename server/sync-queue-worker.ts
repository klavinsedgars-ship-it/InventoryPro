/**
 * Sync Queue Worker - Background processor for TME product synchronization
 * Handles rate limiting and prioritized processing without blocking the UI
 * 
 * Designed for 150k+ product scale with:
 * - Robust status tracking (pending → processing → completed/failed)
 * - Retry logic with exponential backoff
 * - One failed item does not crash the worker
 * - Detailed logging and metrics
 */

import { storage } from "./storage";
import { tmeApi } from "./tme-api";
import { calculateDynamicPrice, calculatePackagePrice, getSupplierPriceForMoq } from "./dynamic-pricing";
import type { SyncQueue } from "@shared/schema";

interface QueueWorkerConfig {
  maxConcurrent: number;
  batchSize: number;
  priorityLevels: number;
  retryDelayMs: number;
}

interface WorkerMetrics {
  totalProcessed: number;
  successCount: number;
  failedCount: number;
  retryCount: number;
  lastProcessedAt: Date | null;
  startedAt: Date | null;
}

export class SyncQueueWorker {
  private isRunning = false;
  private config: QueueWorkerConfig;
  private metrics: WorkerMetrics;

  constructor(config: Partial<QueueWorkerConfig> = {}) {
    this.config = {
      maxConcurrent: config.maxConcurrent || 1, // Process one batch at a time
      batchSize: config.batchSize || 10,
      priorityLevels: config.priorityLevels || 4,
      retryDelayMs: config.retryDelayMs || 5000,
    };
    
    this.metrics = {
      totalProcessed: 0,
      successCount: 0,
      failedCount: 0,
      retryCount: 0,
      lastProcessedAt: null,
      startedAt: null,
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
    this.metrics.startedAt = new Date();
    console.log("🚀 Sync Queue Worker started at " + this.metrics.startedAt.toISOString());
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

      // Get MOQ to find correct price tier
      const moq = tmeProduct.MinAmount || product.moq || 1;
      const multiples = tmeProduct.Multiples || product.multiples || 1;

      // Calculate pricing - use correct price tier for MOQ quantity
      const supplierPrice = getSupplierPriceForMoq(price?.PriceList, moq);
      
      // For MOQ > 1 products: apply margin to PACKAGE cost (unit price × MOQ)
      // For single items: apply margin to unit price directly
      const pricingResult =
        supplierPrice > 0
          ? moq > 1
            ? calculatePackagePrice(supplierPrice, moq, multiples)
            : calculateDynamicPrice(supplierPrice)
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

      // Mark as completed with processed timestamp
      await storage.updateSyncQueueItem(item.id, {
        status: "completed",
        retryCount: 0,
        processedAt: new Date(),
      });

      // Update metrics
      this.metrics.totalProcessed++;
      this.metrics.successCount++;
      this.metrics.lastProcessedAt = new Date();

      console.log(`✅ Completed queue item ${item.id}: ${item.operation}`);
    } catch (error) {
      // Error isolation: one failed item does NOT crash the worker
      console.error(`❌ Error processing queue item ${item.id}:`, error);
      this.metrics.totalProcessed++;

      // Increment retry count
      const newRetryCount = (item.retryCount || 0) + 1;
      const shouldRetry = newRetryCount < (item.maxRetries || 3);

      if (shouldRetry) {
        // Reschedule for retry with exponential backoff delay
        this.metrics.retryCount++;
        await storage.updateSyncQueueItem(item.id, {
          status: "pending",
          retryCount: newRetryCount,
          errorMessage: error instanceof Error ? error.message : String(error),
          scheduledFor: new Date(Date.now() + this.config.retryDelayMs * Math.pow(2, newRetryCount - 1)),
        });
        console.log(
          `🔄 Retry scheduled for item ${item.id} (attempt ${newRetryCount}/${item.maxRetries})`
        );
      } else {
        // Mark as failed permanently
        this.metrics.failedCount++;
        await storage.updateSyncQueueItem(item.id, {
          status: "failed",
          processedAt: new Date(),
          errorMessage: error instanceof Error ? error.message : String(error),
        });
        console.log(`❌ Queue item ${item.id} failed permanently after ${item.maxRetries} retries`);
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
   * Get queue statistics with worker metrics
   */
  async getQueueStats() {
    const queueStats = await storage.getSyncQueueStats();
    return {
      ...queueStats,
      workerMetrics: this.getMetrics(),
    };
  }

  /**
   * Get current worker metrics
   */
  getMetrics(): WorkerMetrics & { isRunning: boolean; uptime: number | null } {
    return {
      ...this.metrics,
      isRunning: this.isRunning,
      uptime: this.metrics.startedAt 
        ? Math.round((Date.now() - this.metrics.startedAt.getTime()) / 1000) 
        : null,
    };
  }

  /**
   * Reset worker metrics (for testing or new sync cycle)
   */
  resetMetrics() {
    this.metrics = {
      totalProcessed: 0,
      successCount: 0,
      failedCount: 0,
      retryCount: 0,
      lastProcessedAt: null,
      startedAt: this.metrics.startedAt, // Keep original start time
    };
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

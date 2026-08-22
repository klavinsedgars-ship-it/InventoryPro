import type { Express } from "express";
import { storage } from "../storage";
import { requireAuth } from "../middleware/auth";
import { ebayApi } from "../ebay-api";
import { ebayInventoryApi } from "../ebay-inventory-api";
import { calculateEbayStock } from "../stock-manager";

/**
 * eBay listing operations: single + bulk listing (with a polled job record),
 * bulk inventory (price/qty) updates, unlist, reset-list-attempts, and the
 * template bulk-sync. Extracted from the routes monolith; behaviour is
 * identical to the previous inline handlers.
 */
export function registerEbayListingRoutes(app: Express) {
  // Reconcile the DB against what is ACTUALLY live on the eBay account.
  // Dry-run by default (reports matches/orphans, changes nothing);
  // ?apply=1 restores local listing state (listedOnEbay/itemId/offerId) for
  // matched SKUs and clears flags for DB-ghosts. Reads eBay, never writes to
  // it. Run this BEFORE any bulk re-listing after a database rebuild —
  // otherwise live listings are invisible to the sync (oversell risk) and
  // re-listing the same SKUs creates duplicates.
  app.get("/api/ebay/reconcile", requireAuth, async (req, res) => {
    try {
      const { reconcileEbayListings } = await import("../ebay-reconcile");
      const report = await reconcileEbayListings({
        apply: String(req.query.apply) === "1",
        maxPages: req.query.maxPages ? Number(req.query.maxPages) : undefined,
      });
      res.json(report);
    } catch (error) {
      console.error("eBay reconcile failed:", error);
      res.status(500).json({ ok: false, error: (error as Error).message });
    }
  });

  app.post("/api/ebay/list", requireAuth, async (req, res) => {
    try {
      const { productId, listingDetails } = req.body;
      const result = await ebayApi.listProduct(productId, listingDetails);
      res.json(result);
    } catch (error) {
      console.error("eBay listing failed:", error);
      res.status(500).json({ 
        success: false, 
        message: (error as Error).message || "eBay listing failed",
        error: (error as Error).message
      });
    }
  });

  app.post("/api/ebay/bulk-list", requireAuth, async (req, res) => {
    try {
      const { productIds, categoryId } = req.body;
      
      if (!Array.isArray(productIds) || productIds.length === 0) {
        return res.status(400).json({
          success: false,
          message: "productIds array is required and must not be empty"
        });
      }

      // Create a unique job ID
      const jobId = `bulk-list-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      
      // Create the job record
      await storage.createBulkListingJob({
        id: jobId,
        status: "processing",
        total: productIds.length,
        processed: 0,
        succeeded: 0,
        failed: 0,
        currentProduct: null,
        lastMessage: "Starting bulk listing...",
        errorDetails: null
      });

      // On Vercel serverless, the function is killed the instant we
      // res.json() — any "background" work after that dies mid-flight.
      // So process inline. This works while the batch fits inside the
      // function timeout (10s on Hobby ≈ 2-3 items, 60s on Pro ≈ 15-20).
      // For larger batches we'd need a cron-driven queue worker.
      const FIRE_AND_FORGET = process.env.LONG_BACKGROUND_JOBS === "true";
      if (FIRE_AND_FORGET) {
        processAsyncBulkListing(jobId, productIds, categoryId);
        return res.json({
          success: true,
          jobId,
          message: `Bulk listing job started for ${productIds.length} products`,
          total: productIds.length,
        });
      }

      await processAsyncBulkListing(jobId, productIds, categoryId);
      const finalJob = await storage.getBulkListingJob(jobId);
      res.json({
        success: true,
        jobId,
        message: `Bulk listing complete: ${finalJob?.succeeded ?? 0} listed, ${finalJob?.failed ?? 0} failed`,
        total: productIds.length,
        job: finalJob,
      });
    } catch (error) {
      console.error("eBay bulk listing failed:", error);
      res.status(500).json({ 
        success: false, 
        message: (error as Error).message || "eBay bulk listing failed",
        error: (error as Error).message
      });
    }
  });

  // Job status endpoint for polling
  app.get("/api/ebay/bulk-list/:jobId/status", requireAuth, async (req, res) => {
    try {
      const { jobId } = req.params;
      const job = await storage.getBulkListingJob(jobId);
      
      if (!job) {
        return res.status(404).json({
          success: false,
          message: "Job not found"
        });
      }

      res.json({
        success: true,
        job: {
          id: job.id,
          status: job.status,
          total: job.total,
          processed: job.processed,
          succeeded: job.succeeded,
          failed: job.failed,
          currentProduct: job.currentProduct,
          lastMessage: job.lastMessage,
          errorDetails: job.errorDetails ? JSON.parse(job.errorDetails) : null,
          createdAt: job.createdAt,
          completedAt: job.completedAt
        }
      });
    } catch (error) {
      console.error("Error getting job status:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get job status"
      });
    }
  });

  // Helper function for async bulk listing processing
  async function processAsyncBulkListing(jobId: string, productIds: number[], categoryId?: string) {
    const errorDetails: Array<{ productId: number; error: string }> = [];
    let succeeded = 0;
    let failed = 0;

    try {
      for (let i = 0; i < productIds.length; i++) {
        const productId = productIds[i];
        
        // Get product name for progress display
        const product = await storage.getProduct(productId);
        const productName = product?.name || `Product ${productId}`;
        
        // Update job with current product
        await storage.updateBulkListingJob(jobId, {
          currentProduct: productName,
          lastMessage: `Listing product ${i + 1} of ${productIds.length}: ${productName}`
        });

        try {
          const result = await ebayApi.listProduct(productId, { categoryId });
          
          if (result.success) {
            succeeded++;
          } else {
            failed++;
            errorDetails.push({
              productId,
              error: result.message || "Unknown error"
            });
          }
        } catch (error) {
          failed++;
          errorDetails.push({
            productId,
            error: (error as Error).message
          });
        }

        // Update job progress
        await storage.updateBulkListingJob(jobId, {
          processed: i + 1,
          succeeded,
          failed,
          errorDetails: errorDetails.length > 0 ? JSON.stringify(errorDetails) : null
        });

        // Add delay between listings to avoid rate limits
        if (i < productIds.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      // Mark job as completed
      await storage.updateBulkListingJob(jobId, {
        status: "completed",
        currentProduct: null,
        lastMessage: `Completed: ${succeeded} listed, ${failed} failed`,
        completedAt: new Date()
      });

      // Create sync log
      await storage.createSyncLog({
        source: "ebay",
        operation: "bulk_listing",
        status: succeeded > 0 ? "success" : "error",
        message: `Bulk listing completed: ${succeeded} listed, ${failed} failed`,
        details: JSON.stringify({
          jobId,
          totalProducts: productIds.length,
          listedCount: succeeded,
          failedCount: failed
        })
      });

      console.log(`✅ Bulk listing job ${jobId} completed: ${succeeded} succeeded, ${failed} failed`);

    } catch (error) {
      // Mark job as failed
      await storage.updateBulkListingJob(jobId, {
        status: "failed",
        currentProduct: null,
        lastMessage: `Job failed: ${(error as Error).message}`,
        completedAt: new Date()
      });
      
      console.error(`❌ Bulk listing job ${jobId} failed:`, error);
    }
  }

  // Bulk inventory update - aggregates multiple updates into single eBay API calls
  app.post("/api/ebay/bulk-update-inventory", requireAuth, async (req, res) => {
    try {
      const { items } = req.body;
      
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Items array is required and must not be empty"
        });
      }

      // Validate and prepare items
      const validItems = [];
      for (const item of items) {
        if (!item.productId) {
          continue;
        }
        
        // Get product from database to get eBay item ID
        const product = await storage.getProduct(item.productId);
        if (!product || !product.ebayItemId || !product.listedOnEbay) {
          continue;
        }

        validItems.push({
          productId: item.productId,
          ebayItemId: product.ebayItemId,
          quantity: item.quantity,
          price: item.price,
          sku: product.sku
        });
      }

      if (validItems.length === 0) {
        return res.status(400).json({
          success: false,
          message: "No valid items found for bulk update"
        });
      }

      console.log(`📦 Bulk inventory update requested for ${validItems.length} items`);
      const result = await ebayApi.bulkUpdateInventory(validItems);
      
      res.json({
        success: result.success,
        processed: result.processed,
        succeeded: result.succeeded,
        failed: result.failed,
        message: `Bulk update: ${result.succeeded} items updated, ${result.failed} failed`
      });
    } catch (error) {
      console.error("Bulk inventory update failed:", error);
      res.status(500).json({
        success: false,
        message: `Bulk update failed: ${(error as Error).message}`
      });
    }
  });

  // Operator-facing reset for the listing-ramp attempt counter. After the
  // ramp parks a SKU as "errored" (>=EBAY_LIST_MAX_ATTEMPTS), this puts it
  // back in the candidate pool so the next ramp tick re-tries it. Useful
  // after fixing a category, image, or aspect issue. Pass {onlyErrored:true}
  // to only reset rows whose status is 'error'; default resets all >0.
  app.post("/api/ebay/reset-list-attempts", requireAuth, async (req, res) => {
    try {
      const onlyErrored = req.body?.onlyErrored === true;
      const updated = await storage.resetEbayListAttempts({ onlyErrored });
      res.json({ success: true, updated });
    } catch (error) {
      console.error("Reset list attempts failed:", error);
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  app.post("/api/ebay/unlist", requireAuth, async (req, res) => {
    try {
      const { productId } = req.body;
      const product = await storage.getProduct(productId);
      let withdrawn = false;
      let message = "";

      if (product?.ebayOfferId) {
        // Inventory-model listing -> withdraw the offer
        const w = await ebayInventoryApi.withdrawOffer(product.ebayOfferId);
        withdrawn = w.ok;
        message = w.ok ? "Offer withdrawn" : (w.error || "Withdraw failed");
      } else if (product?.ebayItemId) {
        // Legacy Trading listing -> EndItem
        try {
          await ebayApi.unlistProduct(productId);
          withdrawn = true;
          message = "Listing ended";
        } catch (e) {
          message = (e as Error).message;
        }
      } else {
        message = "No eBay listing on record";
        withdrawn = true;
      }

      // ALWAYS clear local listing state so the green-E icon reflects reality.
      await storage.updateProduct(productId, {
        listedOnEbay: false,
        ebayOfferId: null,
        ebayListingId: null,
        ebayItemId: null,
        ebayListingStatus: "unlisted",
        ebayListingError: null,
      });

      res.json({ success: true, withdrawn, message });
    } catch (error) {
      console.error("eBay unlisting failed:", error);
      res.json({
        success: false,
        message: `Failed to unlist product: ${(error as Error).message}`,
        errors: [(error as Error).message],
      });
    }
  });

  // Bulk sync template to all eBay listings (updates title & description)
  app.post("/api/ebay/bulk-sync-template", requireAuth, async (req, res) => {
    try {
      // Get all products listed on eBay
      const allProducts = await storage.getProducts();
      const listedProducts = allProducts.filter(p => p.listedOnEbay && p.ebayItemId);
      
      if (listedProducts.length === 0) {
        return res.json({
          success: true,
          message: "No products are currently listed on eBay",
          processed: 0,
          succeeded: 0,
          failed: 0
        });
      }

      console.log(`📝 Starting bulk template sync for ${listedProducts.length} eBay listings`);
      
      const results: Array<{ productId: number; name: string; success: boolean; message: string }> = [];
      let succeeded = 0;
      let failed = 0;

      // Process each product with rate limiting (1 per second to avoid hitting eBay limits)
      for (let i = 0; i < listedProducts.length; i++) {
        const product = listedProducts[i];
        
        try {
          console.log(`⏳ Updating listing ${i + 1}/${listedProducts.length}: ${product.name}`);
          
          // Use updateProduct which regenerates the template
          const updateResult = await ebayApi.updateProduct(product.id, undefined, true);
          
          if (updateResult.success) {
            succeeded++;
            results.push({
              productId: product.id,
              name: product.name,
              success: true,
              message: "Template updated successfully"
            });
          } else {
            failed++;
            results.push({
              productId: product.id,
              name: product.name,
              success: false,
              message: updateResult.message || "Update failed"
            });
          }
        } catch (error) {
          failed++;
          results.push({
            productId: product.id,
            name: product.name,
            success: false,
            message: (error as Error).message
          });
        }

        // Rate limiting: wait 1.5 seconds between updates to stay under eBay limits
        if (i < listedProducts.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1500));
        }
      }

      console.log(`✅ Bulk template sync complete: ${succeeded} succeeded, ${failed} failed`);

      await storage.createSyncLog({
        source: "ebay",
        operation: "bulk_template_sync",
        status: failed === 0 ? "success" : "partial",
        message: `Template sync: ${succeeded} updated, ${failed} failed`,
        details: JSON.stringify({
          itemsProcessed: listedProducts.length,
          itemsSucceeded: succeeded,
          itemsFailed: failed,
          failedItems: results.filter(r => !r.success).slice(0, 10)
        })
      });

      res.json({
        success: failed === 0,
        message: `Template sync complete: ${succeeded} listings updated, ${failed} failed`,
        processed: listedProducts.length,
        succeeded,
        failed,
        results: results.slice(0, 50) // Return first 50 results
      });
    } catch (error) {
      console.error("Bulk template sync failed:", error);
      res.status(500).json({
        success: false,
        message: `Bulk template sync failed: ${(error as Error).message}`
      });
    }
  });

  app.get("/api/ebay/test", requireAuth, async (req, res) => {
    try {
      const result = await ebayApi.testConnection();
      res.json(result);
    } catch (error) {
      console.error("eBay test failed:", error);
      res.status(500).json({ 
        success: false, 
        message: (error as Error).message || "eBay test failed",
        error: (error as Error).message
      });
    }
  });
}

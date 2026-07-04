import type { Express } from "express";
import { storage } from "../storage";
import { requireAuth } from "../middleware/auth";
import { ebayOAuth } from "../ebay-oauth";
import { ebayOrdersApi } from "../ebay-orders-api";
import { autoMessageScheduler } from "../auto-message-scheduler";

// Orders: listing, detail, status/tracking/notes/events, label print, delete,
// and eBay order sync. Extracted from the routes.ts monolith (unchanged).
export function registerOrderRoutes(app: Express): void {
  app.get('/api/orders', requireAuth, async (req, res) => {
    try {
      const filters: {
        marketplace?: string;
        status?: string;
        search?: string;
        fromDate?: Date;
        toDate?: Date;
        limit?: number;
        offset?: number;
      } = {};

      if (req.query.marketplace) filters.marketplace = req.query.marketplace as string;
      if (req.query.status) filters.status = req.query.status as string;
      if (req.query.search) filters.search = req.query.search as string;
      if (req.query.fromDate) filters.fromDate = new Date(req.query.fromDate as string);
      if (req.query.toDate) filters.toDate = new Date(req.query.toDate as string);
      if (req.query.limit) filters.limit = parseInt(req.query.limit as string);
      if (req.query.offset) filters.offset = parseInt(req.query.offset as string);

      const orders = await storage.getOrders(filters);
      const total = await storage.getOrdersCount({
        marketplace: filters.marketplace,
        status: filters.status
      });

      // Include items for each order — single batched query keyed by orderId
      // (was N queries in Promise.all; bounded by page size but still N×RTT).
      const itemsByOrder = await storage.getOrderItemsByOrderIds(orders.map((o) => o.id));
      const ordersWithItems = orders.map((order) => ({
        ...order,
        items: itemsByOrder.get(order.id) ?? [],
      }));

      res.json({
        success: true,
        orders: ordersWithItems,
        total,
        limit: filters.limit,
        offset: filters.offset
      });
    } catch (error) {
      console.error('Failed to fetch orders:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch orders'
      });
    }
  });

  // Get order statistics/summary
  app.get('/api/orders/stats', requireAuth, async (req, res) => {
    try {
      const [totalOrders, newOrders, packedOrders, shippedOrders] = await Promise.all([
        storage.getOrdersCount(),
        storage.getOrdersCount({ status: 'new' }),
        storage.getOrdersCount({ status: 'packed' }),
        storage.getOrdersCount({ status: 'shipped' })
      ]);

      const [ebayOrders, amazonOrders] = await Promise.all([
        storage.getOrdersCount({ marketplace: 'ebay' }),
        storage.getOrdersCount({ marketplace: 'amazon' })
      ]);

      res.json({
        success: true,
        stats: {
          total: totalOrders,
          byStatus: {
            new: newOrders,
            packed: packedOrders,
            shipped: shippedOrders
          },
          byMarketplace: {
            ebay: ebayOrders,
            amazon: amazonOrders
          }
        }
      });
    } catch (error) {
      console.error('Failed to fetch order stats:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch order statistics'
      });
    }
  });

  // Get single order with full details
  app.get('/api/orders/:id', requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const order = await storage.getOrder(id);

      if (!order) {
        return res.status(404).json({
          success: false,
          error: 'Order not found'
        });
      }

      // Get related data
      const [items, fees, events] = await Promise.all([
        storage.getOrderItems(id),
        storage.getOrderFees(id),
        storage.getOrderEvents(id)
      ]);

      res.json({
        success: true,
        order: {
          ...order,
          items,
          fees,
          events
        }
      });
    } catch (error) {
      console.error('Failed to fetch order:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch order'
      });
    }
  });

  // Update order status
  app.patch('/api/orders/:id/status', requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { status, notes, trackingNumber, trackingCarrier } = req.body;

      const order = await storage.getOrder(id);
      if (!order) {
        return res.status(404).json({
          success: false,
          error: 'Order not found'
        });
      }

      // Validate status transition
      const validTransitions: Record<string, string[]> = {
        'new': ['packed', 'cancelled'],
        'packed': ['shipped', 'new'],
        'shipped': ['delivered', 'returned'],
        'delivered': ['completed', 'returned'],
        'completed': [],
        'returned': [],
        'cancelled': []
      };

      if (!validTransitions[order.status]?.includes(status)) {
        return res.status(400).json({
          success: false,
          error: `Invalid status transition from ${order.status} to ${status}`
        });
      }

      // Update the order
      const updateData: any = { status };
      if (trackingNumber) updateData.trackingNumber = trackingNumber;
      if (trackingCarrier) updateData.shippingCarrier = trackingCarrier;
      if (status === 'shipped' && !updateData.shippedAt) updateData.shippedAt = new Date();
      if (status === 'delivered' && !updateData.deliveredAt) updateData.deliveredAt = new Date();

      const updatedOrder = await storage.updateOrder(id, updateData);

      // Log the status change event
      await storage.createOrderEvent({
        orderId: id,
        eventType: 'status_change',
        fromStatus: order.status,
        toStatus: status,
        note: notes || null
      });

      // Push the shipment to eBay so the order shows as fulfilled with tracking
      // (otherwise eBay still sees it unshipped -> late-shipment defects /
      // auto-refunds). Best-effort: a failure is recorded but doesn't roll back
      // the local status change.
      let ebayFulfillment: { pushed: boolean; error?: string } | undefined;
      if (status === 'shipped' && order.marketplace === 'ebay' && order.marketplaceOrderId && trackingNumber) {
        try {
          const items = await storage.getOrderItems(id);
          const lineItems = items
            .filter((it) => it.marketplaceItemId)
            .map((it) => ({ lineItemId: it.marketplaceItemId as string, quantity: it.quantity }));
          await ebayOrdersApi.createShippingFulfillment(order.marketplaceOrderId, {
            lineItems,
            shippingCarrierCode: trackingCarrier || 'OTHER',
            trackingNumber,
            shippedDate: new Date().toISOString(),
          });
          ebayFulfillment = { pushed: true };
          await storage.createOrderEvent({
            orderId: id,
            eventType: 'tracking_added',
            note: `Shipment pushed to eBay (${trackingCarrier || 'OTHER'} ${trackingNumber})`,
          });
        } catch (err) {
          ebayFulfillment = { pushed: false, error: (err as Error).message };
          console.error(`Failed to push fulfillment to eBay for order ${order.marketplaceOrderId}:`, err);
          await storage.createOrderEvent({
            orderId: id,
            eventType: 'tracking_added',
            note: `⚠️ Failed to push shipment to eBay: ${(err as Error).message}. Add tracking on eBay manually.`,
          });
        }
      }

      // Trigger auto-message rules for this status change
      const triggerMap: Record<string, 'order_packed' | 'order_shipped' | 'order_delivered' | null> = {
        'packed': 'order_packed',
        'shipped': 'order_shipped',
        'delivered': 'order_delivered'
      };
      const triggerType = triggerMap[status];
      if (triggerType) {
        const items = await storage.getOrderItems(id);
        autoMessageScheduler.processAutoMessageTrigger(triggerType, {
          order: updatedOrder!,
          items: items.map(i => ({ marketplaceItemId: i.marketplaceItemId || undefined, title: i.title })),
          trackingNumber: updatedOrder?.trackingNumber || undefined
        }).catch(err => console.error('Auto-message trigger failed:', err));
      }

      res.json({
        success: true,
        order: updatedOrder,
        ebayFulfillment
      });
    } catch (error) {
      console.error('Failed to update order status:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update order status'
      });
    }
  });

  // Add tracking information
  app.patch('/api/orders/:id/tracking', requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { trackingNumber, trackingCarrier, trackingUrl } = req.body;

      const order = await storage.getOrder(id);
      if (!order) {
        return res.status(404).json({
          success: false,
          error: 'Order not found'
        });
      }

      const updatedOrder = await storage.updateOrder(id, {
        trackingNumber,
        shippingCarrier: trackingCarrier,
        trackingUrl
      });

      // Log the tracking update event
      await storage.createOrderEvent({
        orderId: id,
        eventType: 'tracking_update',
        note: `Tracking: ${trackingCarrier} - ${trackingNumber}`
      });

      res.json({
        success: true,
        order: updatedOrder
      });
    } catch (error) {
      console.error('Failed to update tracking:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update tracking information'
      });
    }
  });

  // Add note to order
  app.post('/api/orders/:id/notes', requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { notes } = req.body;

      const order = await storage.getOrder(id);
      if (!order) {
        return res.status(404).json({
          success: false,
          error: 'Order not found'
        });
      }

      // Log the note as an event
      const event = await storage.createOrderEvent({
        orderId: id,
        eventType: 'note',
        note: notes
      });

      res.json({
        success: true,
        event
      });
    } catch (error) {
      console.error('Failed to add order note:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to add order note'
      });
    }
  });

  // Get order events/history
  app.get('/api/orders/:id/events', requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const events = await storage.getOrderEvents(id);

      res.json({
        success: true,
        events
      });
    } catch (error) {
      console.error('Failed to fetch order events:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch order events'
      });
    }
  });

  // Print shipping label placeholder (for Latvian Post integration later)
  app.post('/api/orders/:id/print-label', requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const order = await storage.getOrder(id);

      if (!order) {
        return res.status(404).json({
          success: false,
          error: 'Order not found'
        });
      }

      // Log the print label request
      await storage.createOrderEvent({
        orderId: id,
        eventType: 'label_print',
        note: 'Shipping label print requested (integration pending)'
      });

      // Placeholder response - will be replaced with actual Latvian Post API integration
      res.json({
        success: true,
        message: 'Shipping label printing is not yet configured. Latvian Post API integration coming soon.',
        order: {
          id: order.id,
          shippingName: order.shippingName,
          shippingAddressLine1: order.shippingAddressLine1,
          shippingAddressLine2: order.shippingAddressLine2,
          shippingCity: order.shippingCity,
          shippingStateOrProvince: order.shippingStateOrProvince,
          shippingPostalCode: order.shippingPostalCode,
          shippingCountry: order.shippingCountry
        },
        labelReady: false,
        integrationStatus: 'pending'
      });
    } catch (error) {
      console.error('Failed to print label:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to process print label request'
      });
    }
  });

  // Delete order (admin only)
  app.delete('/api/orders/:id', requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const deleted = await storage.deleteOrder(id);

      if (!deleted) {
        return res.status(404).json({
          success: false,
          error: 'Order not found'
        });
      }

      res.json({
        success: true,
        message: 'Order deleted successfully'
      });
    } catch (error) {
      console.error('Failed to delete order:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to delete order'
      });
    }
  });

  // ==========================================
  // EBAY ORDERS SYNC ROUTES
  // ==========================================

  // Sync orders from eBay
  app.post('/api/orders/sync/ebay', requireAuth, async (req, res) => {
    try {
      const { daysBack = 30 } = req.body;
      
      console.log(`📦 Starting eBay orders sync (${daysBack} days)...`);
      
      const result = await ebayOrdersApi.syncOrdersFromEbay(daysBack);
      
      res.json({
        success: true,
        message: `Synced ${result.synced} new orders, updated ${result.updated} existing orders`,
        ...result
      });
    } catch (error) {
      console.error('eBay orders sync failed:', error);
      res.status(500).json({
        success: false,
        error: (error as Error).message
      });
    }
  });

  // Check eBay OAuth status for orders
  app.get('/api/orders/sync/status', requireAuth, async (req, res) => {
    try {
      const isConfigured = ebayOAuth.isOAuthConfigured();
      
      res.json({
        success: true,
        ebay: {
          configured: isConfigured,
          message: isConfigured 
            ? 'eBay OAuth is configured and ready to sync orders'
            : 'eBay OAuth not configured. Set EBAY_OAUTH_CLIENT_ID, EBAY_OAUTH_CLIENT_SECRET, and EBAY_OAUTH_REFRESH_TOKEN'
        },
        amazon: {
          configured: false,
          message: 'Amazon SP-API integration coming soon'
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: (error as Error).message
      });
    }
  });
}

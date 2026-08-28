import type { Express } from "express";
import { storage } from "../storage";
import { sanitizeMessageHtml, htmlToPlainText } from "@shared/html-sanitize";
import { requireAuth } from "../middleware/auth";
import { ebayOAuth } from "../ebay-oauth";
import { ebayMessagesApi } from "../ebay-messages-api";
import { insertMessageTemplateSchema, insertAutoMessageRuleSchema } from "@shared/schema";
import { ZodError } from "zod";

// Buyer messaging: threads, replies, templates, auto-rules, scheduled sends.
// Extracted from the routes.ts monolith (behaviour unchanged).

/**
 * Pull messages from eBay into threads. Shared by the manual button and the
 * scheduled cron, so both behave identically.
 */
async function syncEbayMessages(daysBack: number): Promise<{
  synced: number; updated: number; newMessages: number; threadsTouched: number; errors: string[];
}> {
  const startTime = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
  let synced = 0, updated = 0, newMessages = 0;
  const errors: string[] = [];
  const touched = new Set<number>();

  let pageNum = 1;
  let hasMore = true;
  while (hasMore) {
    const result = await ebayMessagesApi.getMyMessages(startTime, undefined, 'Inbox', 100, pageNum);
    if (!result.success) {
      errors.push(result.error || 'eBay message fetch failed');
      break;
    }
    hasMore = result.hasMoreMessages || false;

    for (const msg of result.messages) {
      let thread = await storage.getMessageThreadByBuyer(msg.sender, msg.itemId);
      if (!thread) {
        thread = await storage.createMessageThread({
          marketplace: 'ebay',
          marketplaceThreadId: msg.messageId,
          buyerUsername: msg.sender,
          buyerEmail: msg.senderEmail,
          itemId: msg.itemId,
          itemTitle: msg.itemTitle,
          subject: htmlToPlainText(msg.subject),
          status: 'open',
          isRead: msg.isRead,
          lastMessageAt: new Date(msg.creationDate),
        });
        synced++;
      } else {
        const cleanedSubject = htmlToPlainText(msg.subject);
        if (thread.subject !== cleanedSubject) {
          await storage.updateMessageThread(thread.id, {
            subject: cleanedSubject,
            lastMessageAt: new Date(msg.creationDate),
          });
        }
        updated++;
      }
      touched.add(thread.id);

      const existingMessages = await storage.getMessages(thread.id);
      const existingMsg = existingMessages.find((m) => m.marketplaceMessageId === msg.messageId);
      if (!existingMsg) {
        await storage.createMessage({
          threadId: thread.id,
          direction: 'inbound',
          subject: htmlToPlainText(msg.subject),
          // Capped on the way in. A buyer's question is a few hundred bytes;
          // eBay's marketing emails are whole HTML documents, and a thread of
          // ten of them is megabytes to fetch every time it is opened.
          body: htmlToPlainText(msg.body).slice(0, 8_000),
          // Sanitised at write time: nothing unsafe is ever stored, so the
          // client never has to trust what it renders.
          bodyHtml: sanitizeMessageHtml((msg as any).bodyHtml || msg.body, { maxLength: 20_000 }) || null,
          sentAt: msg.creationDate ? new Date(msg.creationDate) : new Date(),
          marketplaceMessageId: msg.messageId,
          senderUsername: msg.sender,
          senderEmail: msg.senderEmail,
          status: 'delivered',
        });
        newMessages++;
      } else if (!existingMsg.bodyHtml || existingMsg.bodyHtml.includes("@media") || (existingMsg.body?.length ?? 0) > 8_000) {
        // Back-fill or REPAIR: rows written before the decode-order fix hold
        // the whole document (CSS and all), which is both unreadable and the
        // reason threads were slow to load.
        await storage.updateMessage(existingMsg.id, {
          bodyHtml: sanitizeMessageHtml((msg as any).bodyHtml || msg.body, { maxLength: 20_000 }) || null,
          body: htmlToPlainText(msg.body).slice(0, 8_000),
        } as any);
      }
    }
    if (hasMore) pageNum++;
  }

  return { synced, updated, newMessages, threadsTouched: touched.size, errors };
}

export function registerMessageRoutes(app: Express): void {
  app.get('/api/messages/threads', requireAuth, async (req, res) => {
    try {
      const filters = {
        marketplace: req.query.marketplace as string | undefined,
        status: req.query.status as string | undefined,
        isRead: req.query.isRead === 'true' ? true : req.query.isRead === 'false' ? false : undefined,
        buyerUsername: req.query.search as string | undefined,
        limit: req.query.limit ? parseInt(req.query.limit as string) : 50,
        offset: req.query.offset ? parseInt(req.query.offset as string) : 0
      };

      const threads = await storage.getMessageThreads(filters);
      const unreadCount = await storage.getUnreadThreadCount();

      res.json({
        success: true,
        threads,
        unreadCount
      });
    } catch (error) {
      console.error('Failed to fetch message threads:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch message threads'
      });
    }
  });

  // Get single thread with messages
  app.get('/api/messages/threads/:id', requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const thread = await storage.getMessageThread(id);

      if (!thread) {
        return res.status(404).json({
          success: false,
          error: 'Thread not found'
        });
      }

      const threadMessages = await storage.getMessages(id);

      // Mark thread as read
      if (!thread.isRead) {
        await storage.updateMessageThread(id, { isRead: true });
      }

      res.json({
        success: true,
        thread,
        messages: threadMessages
      });
    } catch (error) {
      console.error('Failed to fetch thread:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch thread'
      });
    }
  });

  // Mark thread as read/unread
  app.patch('/api/messages/threads/:id/read', requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { isRead } = req.body;

      const updated = await storage.updateMessageThread(id, { isRead });

      if (!updated) {
        return res.status(404).json({
          success: false,
          error: 'Thread not found'
        });
      }

      res.json({
        success: true,
        thread: updated
      });
    } catch (error) {
      console.error('Failed to update thread:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update thread'
      });
    }
  });

  // Star/unstar thread
  app.patch('/api/messages/threads/:id/star', requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { isStarred } = req.body;

      const updated = await storage.updateMessageThread(id, { isStarred });

      if (!updated) {
        return res.status(404).json({
          success: false,
          error: 'Thread not found'
        });
      }

      res.json({
        success: true,
        thread: updated
      });
    } catch (error) {
      console.error('Failed to update thread:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update thread'
      });
    }
  });

  // Send message reply
  app.post('/api/messages/threads/:id/reply', requireAuth, async (req, res) => {
    try {
      const threadId = parseInt(req.params.id);
      const { body, templateId } = req.body;

      if (!body || body.trim().length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Message body is required'
        });
      }

      const thread = await storage.getMessageThread(threadId);
      if (!thread) {
        return res.status(404).json({
          success: false,
          error: 'Thread not found'
        });
      }

      // Check if we can still send messages (90-day limit for eBay)
      if (thread.marketplace === 'ebay' && thread.orderId) {
        const order = await storage.getOrder(thread.orderId);
        if (order) {
          const eligibility = ebayMessagesApi.checkOrderMessageEligibility(new Date(order.orderDate || order.createdAt!));
          if (!eligibility.eligible) {
            return res.status(400).json({
              success: false,
              error: 'Cannot send message - 90-day limit exceeded for eBay orders'
            });
          }
        }
      }

      // Send to eBay if configured
      // Determine if the reply can actually be delivered to eBay. The Trading
      // API's AddMemberMessage* requires an itemId — without one the message
      // would have been silently stored as "sent" but never transmitted (the
      // original bug). Mark such cases as failed with a clear error so the
      // operator knows to deliver the reply on eBay manually (or to thread it
      // through a different message that has an item context).
      let ebayResult: { success: boolean; error?: string };
      if (thread.marketplace === 'ebay') {
        if (!ebayOAuth.isOAuthConfigured()) {
          ebayResult = { success: false, error: 'eBay OAuth not configured' };
        } else if (!thread.itemId) {
          ebayResult = { success: false, error: 'Thread has no eBay itemId; cannot send via AddMemberMessage. Reply on eBay directly.' };
        } else {
          ebayResult = await ebayMessagesApi.sendMessageToPartner(
            thread.itemId,
            thread.buyerUsername,
            body
          );
        }
        if (!ebayResult.success) {
          return res.status(502).json({
            success: false,
            error: `Failed to send message to eBay: ${ebayResult.error}`
          });
        }
      } else {
        // Non-eBay (e.g. Amazon, local-only) thread — nothing to transmit.
        ebayResult = { success: true };
      }

      // Store the message
      const message = await storage.createMessage({
        threadId,
        direction: 'outbound',
        body,
        senderUsername: 'seller',
        status: ebayResult.success ? 'sent' : 'failed',
        errorMessage: ebayResult.error,
        templateId: templateId || null,
        sentAt: new Date()
      });

      // Update template usage if used
      if (templateId) {
        await storage.incrementTemplateUsage(templateId);
      }

      res.json({
        success: true,
        message,
        ebayStatus: ebayResult.success ? 'sent' : 'failed'
      });
    } catch (error) {
      console.error('Failed to send reply:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to send reply'
      });
    }
  });

  // Helper function to clean HTML from message bodies
  const cleanMessageBodyForStorage = (html: string): string => {
    if (!html) return '';
    let text = html
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'");
    if (text.includes('<') || text.includes('&lt;')) {
      // Remove entire style blocks including content
      text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
      // Remove entire script blocks including content
      text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
      // Remove head section entirely
      text = text.replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '');
      // Remove HTML comments
      text = text.replace(/<!--[\s\S]*?-->/g, '');
      // Remove DOCTYPE and XML declarations
      text = text.replace(/<!DOCTYPE[^>]*>/gi, '');
      text = text.replace(/<\?xml[^>]*\?>/gi, '');
      // Replace block elements with newlines
      text = text.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n')
        .replace(/<\/div>/gi, '\n').replace(/<\/tr>/gi, '\n').replace(/<\/li>/gi, '\n');
      // Remove all remaining HTML tags
      text = text.replace(/<[^>]+>/g, '');
      // Clean up whitespace
      text = text.replace(/\n\s*\n\s*\n/g, '\n\n').replace(/[ \t]+/g, ' ').trim();
    }
    return text.trim();
  };

  // Sync messages from eBay
  /**
   * Everything we know about the person in this thread.
   *
   * Answering a buyer means knowing what they bought, whether it shipped and
   * what it was worth — which today means leaving the CRM for eBay mid-reply.
   * Matched on the buyer username the thread carries.
   */
  app.get('/api/messages/threads/:id/context', requireAuth, async (req, res) => {
    try {
      const thread: any = await storage.getMessageThread(Number(req.params.id));
      if (!thread) return res.status(404).json({ success: false, error: 'Thread not found' });

      const { db } = await import("../db");
      const { sql } = await import("drizzle-orm");
      const q: any = await db.execute(sql`
        SELECT o.id, o.marketplace_order_id, o.status, o.order_date, o.total_price, o.currency,
               o.shipping_name, o.shipping_city, o.shipping_country, o.shipping_phone,
               o.tracking_number, o.shipping_carrier, o.shipped_at, o.delivered_at,
               o.buyer_username, o.buyer_email
        FROM orders o
        WHERE lower(o.buyer_username) = lower(${thread.buyerUsername})
        ORDER BY o.order_date DESC
        LIMIT 25
      `);
      const orders = (q.rows ?? q ?? []) as any[];

      const items: any = orders.length
        ? await db.execute(sql`
            SELECT oi.order_id, oi.sku, oi.title, oi.quantity, oi.total_price, oi.image_url,
                   oi.tme_product_id
            FROM order_items oi
            WHERE oi.order_id = ANY(ARRAY[${sql.join(orders.map((o: any) => sql`${o.id}`), sql`, `)}]::int[])
          `)
        : { rows: [] };
      const itemsByOrder = new Map<number, any[]>();
      for (const i of (items.rows ?? items ?? [])) {
        const list = itemsByOrder.get(Number(i.order_id)) ?? [];
        list.push(i);
        itemsByOrder.set(Number(i.order_id), list);
      }

      const totalSpent = orders.reduce((s: number, o: any) => s + Number(o.total_price ?? 0), 0);

      res.json({
        success: true,
        buyer: {
          username: thread.buyerUsername,
          email: thread.buyerEmail ?? orders[0]?.buyer_email ?? null,
          name: orders[0]?.shipping_name ?? null,
          city: orders[0]?.shipping_city ?? null,
          country: orders[0]?.shipping_country ?? null,
          phone: orders[0]?.shipping_phone ?? null,
          orderCount: orders.length,
          totalSpent: Math.round(totalSpent * 100) / 100,
          currency: orders[0]?.currency ?? 'EUR',
        },
        // The listing the message is about, even when no order exists yet —
        // most questions arrive before the sale, not after.
        item: thread.itemId ? { itemId: thread.itemId, title: thread.itemTitle ?? null } : null,
        orders: orders.map((o: any) => ({
          id: o.id,
          marketplaceOrderId: o.marketplace_order_id,
          status: o.status,
          orderDate: o.order_date,
          total: Number(o.total_price ?? 0),
          currency: o.currency,
          trackingNumber: o.tracking_number,
          carrier: o.shipping_carrier,
          shippedAt: o.shipped_at,
          deliveredAt: o.delivered_at,
          shipTo: [o.shipping_name, o.shipping_city, o.shipping_country].filter(Boolean).join(', '),
          items: (itemsByOrder.get(Number(o.id)) ?? []).map((i: any) => ({
            sku: i.sku, title: i.title, quantity: i.quantity,
            total: Number(i.total_price ?? 0), imageUrl: i.image_url,
            tmeProductId: i.tme_product_id,
          })),
        })),
      });
    } catch (error) {
      console.error('Thread context failed:', error);
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  /**
   * Scheduled message sync.
   *
   * Messages only ever arrived when someone pressed "Sync from eBay", so a
   * buyer question sat unseen until the operator happened to look. eBay's
   * response-time metrics run on the clock whether or not anyone is watching.
   *
   * Delegates to the same handler as the button by calling the sync directly,
   * with the CRON_SECRET-or-session auth the other crons use.
   */
  const messagesSyncCron = async (req: any, res: any) => {
    const auth = req.headers["authorization"] || "";
    const cronSecret = process.env.CRON_SECRET;
    const isVercelCron = cronSecret && auth === `Bearer ${cronSecret}`;
    const isAuthed = !!req.session?.userId || process.env.BYPASS_AUTH === "true";
    if (!isVercelCron && !isAuthed) return res.status(401).json({ message: "Unauthorized" });

    if (!ebayOAuth.isOAuthConfigured()) {
      return res.json({ success: true, skipped: true, reason: "eBay OAuth not configured" });
    }

    const { withLease, describeRefusal } = await import("../job-lease");
    const { leaseStore } = await import("../storage");
    const leased = await withLease(leaseStore, "messages_sync", { ttlSeconds: 120 }, async () => {
      // Short window on a schedule: re-scanning a month every two hours is
      // wasted Trading-API calls once the backlog is in.
      const daysBack = Math.min(90, Math.max(1, Number(req.query?.daysBack) || 3));
      const result = await syncEbayMessages(daysBack);
      if (result.newMessages > 0 || result.errors.length > 0) {
        await storage.createSyncLog({
          source: "messages",
          operation: "message_sync",
          status: result.errors.length > 0 ? "partial" : "success",
          message: `Messages: ${result.newMessages} new, ${result.threadsTouched} thread(s) (last ${daysBack}d)`,
          details: JSON.stringify(result).slice(0, 4000),
        });
      }
      return { success: true, ...result };
    });

    if (!leased.ran) {
      return res.json({ success: true, skipped: true, reason: describeRefusal("messages_sync", leased) });
    }
    return res.json(leased.result);
  };
  app.get('/api/cron/messages', messagesSyncCron);
  app.post('/api/cron/messages', messagesSyncCron);

  app.post('/api/messages/sync/ebay', requireAuth, async (req, res) => {
    try {
      if (!ebayOAuth.isOAuthConfigured()) {
        return res.status(400).json({ success: false, error: 'eBay OAuth not configured' });
      }
      const daysBack = Math.min(90, Math.max(1, Number(req.body?.daysBack) || 30));
      const result = await syncEbayMessages(daysBack);
      res.json({
        success: true,
        ...result,
        totalMessages: result.synced + result.updated,
      });
    } catch (error) {
      console.error('Failed to sync eBay messages:', error);
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  app.get('/api/messages/templates', requireAuth, async (req, res) => {
    try {
      const category = req.query.category as string | undefined;
      const templates = await storage.getMessageTemplates(category);

      res.json({
        success: true,
        templates
      });
    } catch (error) {
      console.error('Failed to fetch templates:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch templates'
      });
    }
  });

  // Create message template
  app.post('/api/messages/templates', requireAuth, async (req, res) => {
    try {
      const data = insertMessageTemplateSchema.parse(req.body);
      const template = await storage.createMessageTemplate(data);

      res.json({
        success: true,
        template
      });
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({
          success: false,
          error: 'Invalid template data',
          details: error.errors
        });
      }
      console.error('Failed to create template:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to create template'
      });
    }
  });

  // Update message template
  app.patch('/api/messages/templates/:id', requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const updated = await storage.updateMessageTemplate(id, req.body);

      if (!updated) {
        return res.status(404).json({
          success: false,
          error: 'Template not found'
        });
      }

      res.json({
        success: true,
        template: updated
      });
    } catch (error) {
      console.error('Failed to update template:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update template'
      });
    }
  });

  // Delete message template
  app.delete('/api/messages/templates/:id', requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const deleted = await storage.deleteMessageTemplate(id);

      if (!deleted) {
        return res.status(404).json({
          success: false,
          error: 'Template not found'
        });
      }

      res.json({
        success: true,
        message: 'Template deleted'
      });
    } catch (error) {
      console.error('Failed to delete template:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to delete template'
      });
    }
  });

  // Render template with variables
  app.post('/api/messages/templates/:id/preview', requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { variables } = req.body;

      const template = await storage.getMessageTemplate(id);

      if (!template) {
        return res.status(404).json({
          success: false,
          error: 'Template not found'
        });
      }

      const renderedBody = ebayMessagesApi.renderTemplate(template.body, variables || {});
      const renderedSubject = template.subject 
        ? ebayMessagesApi.renderTemplate(template.subject, variables || {})
        : undefined;

      res.json({
        success: true,
        preview: {
          subject: renderedSubject,
          body: renderedBody
        }
      });
    } catch (error) {
      console.error('Failed to preview template:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to preview template'
      });
    }
  });

  // Get auto-message rules
  app.get('/api/messages/auto-rules', requireAuth, async (req, res) => {
    try {
      const triggerType = req.query.triggerType as string | undefined;
      const rules = await storage.getAutoMessageRules(triggerType);

      res.json({
        success: true,
        rules
      });
    } catch (error) {
      console.error('Failed to fetch auto-message rules:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch rules'
      });
    }
  });

  // Create auto-message rule
  app.post('/api/messages/auto-rules', requireAuth, async (req, res) => {
    try {
      const data = insertAutoMessageRuleSchema.parse(req.body);
      const rule = await storage.createAutoMessageRule(data);

      res.json({
        success: true,
        rule
      });
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({
          success: false,
          error: 'Invalid rule data',
          details: error.errors
        });
      }
      console.error('Failed to create auto-message rule:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to create rule'
      });
    }
  });

  // Update auto-message rule
  app.patch('/api/messages/auto-rules/:id', requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const updated = await storage.updateAutoMessageRule(id, req.body);

      if (!updated) {
        return res.status(404).json({
          success: false,
          error: 'Rule not found'
        });
      }

      res.json({
        success: true,
        rule: updated
      });
    } catch (error) {
      console.error('Failed to update auto-message rule:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update rule'
      });
    }
  });

  // Delete auto-message rule
  app.delete('/api/messages/auto-rules/:id', requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const deleted = await storage.deleteAutoMessageRule(id);

      if (!deleted) {
        return res.status(404).json({
          success: false,
          error: 'Rule not found'
        });
      }

      res.json({
        success: true,
        message: 'Rule deleted'
      });
    } catch (error) {
      console.error('Failed to delete auto-message rule:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to delete rule'
      });
    }
  });

  // Get scheduled messages
  app.get('/api/messages/scheduled', requireAuth, async (req, res) => {
    try {
      const status = req.query.status as string | undefined;
      const scheduledMsgs = await storage.getScheduledMessages(status);

      res.json({
        success: true,
        scheduled: scheduledMsgs
      });
    } catch (error) {
      console.error('Failed to fetch scheduled messages:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch scheduled messages'
      });
    }
  });

  // Cancel scheduled message
  app.delete('/api/messages/scheduled/:id', requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const cancelled = await storage.cancelScheduledMessage(id);

      if (!cancelled) {
        return res.status(404).json({
          success: false,
          error: 'Scheduled message not found'
        });
      }

      res.json({
        success: true,
        message: 'Scheduled message cancelled'
      });
    } catch (error) {
      console.error('Failed to cancel scheduled message:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to cancel scheduled message'
      });
    }
  });

  // Send message from order page (quick message to buyer)
  app.post('/api/orders/:id/message', requireAuth, async (req, res) => {
    try {
      const orderId = parseInt(req.params.id);
      const { body, templateId } = req.body;

      if (!body || body.trim().length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Message body is required'
        });
      }

      const order = await storage.getOrder(orderId);
      if (!order) {
        return res.status(404).json({
          success: false,
          error: 'Order not found'
        });
      }

      // Check 90-day eligibility for eBay
      if (order.marketplace === 'ebay') {
        const eligibility = ebayMessagesApi.checkOrderMessageEligibility(new Date(order.orderDate || order.createdAt!));
        if (!eligibility.eligible) {
          return res.status(400).json({
            success: false,
            error: `Cannot send message - 90-day limit exceeded (${eligibility.daysRemaining} days past limit)`
          });
        }
      }

      // Find or create thread for this order
      let thread = await storage.getMessageThreadByBuyer(order.buyerUsername!, order.marketplaceOrderId);
      if (!thread) {
        thread = await storage.createMessageThread({
          marketplace: order.marketplace,
          buyerUsername: order.buyerUsername!,
          buyerEmail: order.buyerEmail,
          orderId: order.id,
          marketplaceOrderId: order.marketplaceOrderId,
          subject: `Order ${order.marketplaceOrderId}`,
          status: 'open',
          isRead: true,
          lastMessageAt: new Date()
        });
      }

      // Send to eBay
      let ebayResult: { success: boolean; error?: string } = { success: true };
      if (order.marketplace === 'ebay' && ebayOAuth.isOAuthConfigured()) {
        // Get first item's ID for the message
        const items = await storage.getOrderItems(orderId);
        const itemId = items[0]?.marketplaceItemId;

        if (itemId) {
          ebayResult = await ebayMessagesApi.sendMessageToPartner(
            itemId,
            order.buyerUsername!,
            body
          );
        }
      }

      // Store the message
      const message = await storage.createMessage({
        threadId: thread.id,
        direction: 'outbound',
        body,
        senderUsername: 'seller',
        status: ebayResult.success ? 'sent' : 'failed',
        errorMessage: ebayResult.error,
        templateId: templateId || null,
        sentAt: new Date()
      });

      // Log the event
      await storage.createOrderEvent({
        orderId,
        eventType: 'message_sent',
        note: `Message sent to buyer: ${body.substring(0, 100)}${body.length > 100 ? '...' : ''}`
      });

      res.json({
        success: true,
        message,
        threadId: thread.id,
        ebayStatus: ebayResult.success ? 'sent' : 'failed'
      });
    } catch (error) {
      console.error('Failed to send order message:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to send message'
      });
    }
  });

  // Get messages for an order
  app.get('/api/orders/:id/messages', requireAuth, async (req, res) => {
    try {
      const orderId = parseInt(req.params.id);

      const threads = await storage.getMessageThreads({ orderId });
      
      if (threads.length === 0) {
        return res.json({
          success: true,
          thread: null,
          messages: []
        });
      }

      const thread = threads[0];
      const threadMessages = await storage.getMessages(thread.id);

      res.json({
        success: true,
        thread,
        messages: threadMessages
      });
    } catch (error) {
      console.error('Failed to fetch order messages:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch messages'
      });
    }
  });

  // Check messaging status
  app.get('/api/messages/status', requireAuth, async (req, res) => {
    try {
      const isConfigured = ebayOAuth.isOAuthConfigured();
      const unreadCount = await storage.getUnreadThreadCount();
      const templates = await storage.getMessageTemplates();
      const rules = await storage.getAutoMessageRules();

      res.json({
        success: true,
        ebay: {
          configured: isConfigured,
          message: isConfigured 
            ? 'eBay messaging is configured and ready'
            : 'eBay OAuth not configured'
        },
        unreadCount,
        templatesCount: templates.length,
        activeRulesCount: rules.filter(r => r.isActive).length
      });
    } catch (error) {
      console.error('Failed to get messaging status:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get messaging status'
      });
    }
  });
}

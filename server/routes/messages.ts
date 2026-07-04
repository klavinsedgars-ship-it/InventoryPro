import type { Express } from "express";
import { storage } from "../storage";
import { requireAuth } from "../middleware/auth";
import { ebayOAuth } from "../ebay-oauth";
import { ebayMessagesApi } from "../ebay-messages-api";
import { insertMessageTemplateSchema, insertAutoMessageRuleSchema } from "@shared/schema";
import { ZodError } from "zod";

// Buyer messaging: threads, replies, templates, auto-rules, scheduled sends.
// Extracted from the routes.ts monolith (behaviour unchanged).
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
  app.post('/api/messages/sync/ebay', requireAuth, async (req, res) => {
    try {
      if (!ebayOAuth.isOAuthConfigured()) {
        return res.status(400).json({
          success: false,
          error: 'eBay OAuth not configured'
        });
      }

      const { daysBack = 30 } = req.body;
      const startTime = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);

      console.log(`📬 Syncing eBay messages from last ${daysBack} days...`);

      let synced = 0;
      let updated = 0;
      let pageNum = 1;
      let hasMore = true;

      // Keep fetching pages until no more messages
      while (hasMore) {
        console.log(`📬 Fetching message page ${pageNum}...`);
        const result = await ebayMessagesApi.getMyMessages(startTime, undefined, 'Inbox', 100, pageNum);

        if (!result.success) {
          return res.status(500).json({
            success: false,
            error: result.error
          });
        }

        hasMore = result.hasMoreMessages || false;

        for (const msg of result.messages) {
          // Find or create thread
          let thread = await storage.getMessageThreadByBuyer(msg.sender, msg.itemId);

          if (!thread) {
            thread = await storage.createMessageThread({
              marketplace: 'ebay',
              marketplaceThreadId: msg.messageId,
              buyerUsername: msg.sender,
              buyerEmail: msg.senderEmail,
              itemId: msg.itemId,
              itemTitle: msg.itemTitle,
              subject: cleanMessageBodyForStorage(msg.subject),
              status: 'open',
              isRead: msg.isRead,
              lastMessageAt: new Date(msg.creationDate)
            });
            synced++;
          } else {
            // Update thread subject with cleaned content if needed
            const cleanedSubject = cleanMessageBodyForStorage(msg.subject);
            if (thread.subject !== cleanedSubject) {
              await storage.updateMessageThread(thread.id, {
                subject: cleanedSubject,
                lastMessageAt: new Date(msg.creationDate)
              });
            }
            updated++;
          }

          // Check if message already exists
          const existingMessages = await storage.getMessages(thread.id);
          const existingMsg = existingMessages.find(m => m.marketplaceMessageId === msg.messageId);

          if (!existingMsg) {
            await storage.createMessage({
              threadId: thread.id,
              direction: 'inbound',
              subject: cleanMessageBodyForStorage(msg.subject),
              body: cleanMessageBodyForStorage(msg.body),
              marketplaceMessageId: msg.messageId,
              senderUsername: msg.sender,
              senderEmail: msg.senderEmail,
              status: 'delivered'
            });
          } else {
            // Update existing message with cleaned HTML content
            const cleanedBody = cleanMessageBodyForStorage(msg.body);
            const cleanedSubject = cleanMessageBodyForStorage(msg.subject);
            if (existingMsg.body !== cleanedBody || existingMsg.subject !== cleanedSubject) {
              await storage.updateMessage(existingMsg.id, {
                body: cleanedBody,
                subject: cleanedSubject
              });
            }
          }
        }

        if (hasMore) pageNum++;
      }

      console.log(`📬 Synced ${synced} new threads, updated ${updated} existing threads`);

      res.json({
        success: true,
        synced,
        updated,
        totalMessages: synced + updated
      });
    } catch (error) {
      console.error('Failed to sync eBay messages:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to sync messages from eBay'
      });
    }
  });

  // Get message templates
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

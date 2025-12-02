import { storage } from './storage';
import { ebayMessagesApi } from './ebay-messages-api';
import { ebayOAuth } from './ebay-oauth';
import type { Order, AutoMessageRule, InsertMessage } from '@shared/schema';

interface TriggerContext {
  order: Order;
  items: { marketplaceItemId?: string; title?: string }[];
  trackingNumber?: string;
}

export async function processAutoMessageTrigger(
  triggerType: 'order_placed' | 'order_packed' | 'order_shipped' | 'order_delivered',
  context: TriggerContext
): Promise<{ sent: number; errors: string[] }> {
  const results = { sent: 0, errors: [] as string[] };

  try {
    const rules = await storage.getAutoMessageRules();
    const activeRules = rules.filter(r => r.isActive && r.triggerType === triggerType);

    if (activeRules.length === 0) {
      console.log(`No active auto-message rules for trigger: ${triggerType}`);
      return results;
    }

    console.log(`Processing ${activeRules.length} auto-message rules for trigger: ${triggerType}`);

    for (const rule of activeRules) {
      try {
        await processRule(rule, context, results);
      } catch (error) {
        const errorMsg = `Failed to process rule "${rule.name}": ${(error as Error).message}`;
        console.error(errorMsg);
        results.errors.push(errorMsg);
      }
    }

    return results;
  } catch (error) {
    console.error('Error processing auto-message trigger:', error);
    results.errors.push((error as Error).message);
    return results;
  }
}

async function processRule(
  rule: AutoMessageRule,
  context: TriggerContext,
  results: { sent: number; errors: string[] }
): Promise<void> {
  const { order, items, trackingNumber } = context;

  if (!order.buyerUsername) {
    results.errors.push(`Order ${order.id} has no buyer username`);
    return;
  }

  if (rule.marketplaces && rule.marketplaces.length > 0 && !rule.marketplaces.includes(order.marketplace)) {
    return;
  }

  const template = await storage.getMessageTemplate(rule.templateId);
  if (!template) {
    results.errors.push(`Template ${rule.templateId} not found for rule "${rule.name}"`);
    return;
  }

  // Validate order date exists before checking eligibility
  const orderDate = order.orderDate || order.createdAt;
  if (!orderDate) {
    console.log(`Order ${order.id} has no valid date for eligibility check, skipping`);
    results.errors.push(`Order ${order.id} missing order date`);
    return;
  }

  const eligibility = ebayMessagesApi.checkOrderMessageEligibility(new Date(orderDate));
  if (!eligibility.eligible) {
    console.log(`Order ${order.id} is past 90-day messaging limit (${eligibility.daysRemaining} days)`);
    return;
  }

  // Build template variables with validated fallbacks
  const itemTitle = items[0]?.title || 'Your item';
  const templateVars = {
    buyer_name: order.buyerUsername || 'Customer',
    order_id: order.marketplaceOrderId || `#${order.id}`,
    item_title: itemTitle,
    tracking_number: trackingNumber || 'Not yet available',
    shop_name: 'Our Store',
  };
  
  const body = ebayMessagesApi.renderTemplate(template.body, templateVars);
  
  // Validate all placeholders were replaced
  if (body.includes('{{') && body.includes('}}')) {
    const unreplacedMatch = body.match(/\{\{(\w+)\}\}/);
    if (unreplacedMatch) {
      results.errors.push(`Template has unreplaced placeholder: {{${unreplacedMatch[1]}}}`);
      console.warn(`Template "${template.name}" has unreplaced placeholder: {{${unreplacedMatch[1]}}}`);
    }
  }

  let thread = await storage.getMessageThreadByBuyer(order.buyerUsername, order.marketplaceOrderId);
  if (!thread) {
    thread = await storage.createMessageThread({
      marketplace: order.marketplace,
      buyerUsername: order.buyerUsername,
      buyerEmail: order.buyerEmail,
      orderId: order.id,
      marketplaceOrderId: order.marketplaceOrderId,
      subject: `Order ${order.marketplaceOrderId}`,
      status: 'open',
      isRead: true,
      lastMessageAt: new Date()
    });
  }

  let ebayResult: { success: boolean; error?: string } = { success: true };
  if (order.marketplace === 'ebay' && ebayOAuth.isOAuthConfigured()) {
    const itemId = items[0]?.marketplaceItemId;
    if (itemId) {
      ebayResult = await ebayMessagesApi.sendMessageToPartner(
        itemId,
        order.buyerUsername,
        body
      );
    }
  }

  const messageData: InsertMessage = {
    threadId: thread.id,
    direction: 'outbound',
    body,
    senderUsername: 'seller',
    status: ebayResult.success ? 'sent' : 'failed',
    errorMessage: ebayResult.error,
    templateId: rule.templateId,
    sentAt: new Date()
  };

  await storage.createMessage(messageData);
  await storage.incrementTemplateUsage(rule.templateId);

  if (ebayResult.success) {
    results.sent++;
    console.log(`Auto-message sent for rule "${rule.name}" to ${order.buyerUsername}`);
  } else {
    results.errors.push(`Failed to send: ${ebayResult.error}`);
  }
}

export async function processDelayedRules(): Promise<{ processed: number; sent: number; errors: string[] }> {
  const results = { processed: 0, sent: 0, errors: [] as string[] };

  try {
    const rules = await storage.getAutoMessageRules();
    const delayedRules = rules.filter(r => 
      r.isActive && 
      r.triggerType === 'days_after_delivery' && 
      r.triggerDelay && 
      r.triggerDelay > 0 &&
      r.triggerDelayUnit === 'days'
    );

    if (delayedRules.length === 0) {
      return results;
    }

    console.log(`Processing ${delayedRules.length} delayed auto-message rules`);

    const deliveredOrders = await storage.getOrders({ status: 'delivered' });
    
    for (const order of deliveredOrders) {
      if (!order.deliveredAt) continue;

      const deliveryDate = new Date(order.deliveredAt);
      const daysSinceDelivery = Math.floor((Date.now() - deliveryDate.getTime()) / (1000 * 60 * 60 * 24));

      for (const rule of delayedRules) {
        if (daysSinceDelivery === rule.triggerDelay) {
          results.processed++;
          
          const items = await storage.getOrderItems(order.id);
          await processRule(rule, {
            order,
            items: items.map(i => ({ marketplaceItemId: i.marketplaceItemId || undefined, title: i.title })),
            trackingNumber: order.trackingNumber || undefined
          }, results);
        }
      }
    }

    return results;
  } catch (error) {
    console.error('Error processing delayed rules:', error);
    results.errors.push((error as Error).message);
    return results;
  }
}

let schedulerInterval: NodeJS.Timeout | null = null;

export function startAutoMessageScheduler(): void {
  if (schedulerInterval) {
    console.log('Auto-message scheduler already running');
    return;
  }

  console.log('📧 Auto-message scheduler started (checks every hour for delayed messages)');
  
  schedulerInterval = setInterval(async () => {
    try {
      const results = await processDelayedRules();
      if (results.processed > 0 || results.errors.length > 0) {
        console.log(`📧 Delayed rule check: ${results.processed} orders processed, ${results.sent} messages sent`);
      }
    } catch (error) {
      console.error('Auto-message scheduler error:', error);
    }
  }, 60 * 60 * 1000);
}

export function stopAutoMessageScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    console.log('Auto-message scheduler stopped');
  }
}

export const autoMessageScheduler = {
  processAutoMessageTrigger,
  processDelayedRules,
  startAutoMessageScheduler,
  stopAutoMessageScheduler,
};

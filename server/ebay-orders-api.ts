import { ebayOAuth } from "./ebay-oauth";
import { storage } from "./storage";
import type { InsertOrder, InsertOrderItem, InsertOrderFee, Order } from "@shared/schema";

interface EbayApiError {
  errors?: Array<{
    errorId?: number;
    domain?: string;
    category?: string;
    message?: string;
    longMessage?: string;
  }>;
}

interface EbayOrdersResponse {
  href: string;
  total: number;
  limit: number;
  offset: number;
  orders: EbayOrder[];
  next?: string;
  prev?: string;
  warnings?: Array<{ message: string }>;
}

interface EbayOrder {
  orderId: string;
  legacyOrderId: string;
  creationDate: string;
  lastModifiedDate: string;
  orderFulfillmentStatus: string;
  orderPaymentStatus: string;
  sellerId: string;
  buyer: {
    username: string;
    taxAddress?: {
      city?: string;
      stateOrProvince?: string;
      postalCode?: string;
      countryCode?: string;
    };
  };
  pricingSummary: {
    priceSubtotal: { value: string; currency: string };
    deliveryCost?: { value: string; currency: string };
    total: { value: string; currency: string };
  };
  paymentSummary?: {
    totalDueSeller?: { value: string; currency: string };
    payments?: Array<{
      paymentMethod: string;
      paymentStatus: string;
      paymentDate?: string;
      amount?: { value: string; currency: string };
    }>;
  };
  fulfillmentStartInstructions: Array<{
    fulfillmentInstructionsType: string;
    shippingStep?: {
      shipTo: {
        fullName: string;
        contactAddress: {
          addressLine1?: string;
          addressLine2?: string;
          city?: string;
          stateOrProvince?: string;
          postalCode?: string;
          countryCode?: string;
        };
        primaryPhone?: { phoneNumber: string };
        email?: string;
      };
      shippingServiceCode?: string;
      shipToReferenceId?: string;
    };
    pickupStep?: any;
  }>;
  fulfillmentHrefs?: string[];
  lineItems: EbayLineItem[];
  salesRecordReference?: string;
  totalFeeBasisAmount?: { value: string; currency: string };
  totalMarketplaceFee?: { value: string; currency: string };
  buyerCheckoutNotes?: string;
  cancelStatus?: {
    cancelState: string;
    cancelledDate?: string;
  };
}

interface EbayLineItem {
  lineItemId: string;
  legacyItemId: string;
  legacyVariationId?: string;
  sku?: string;
  title: string;
  quantity: number;
  soldFormat: string;
  lineItemCost: { value: string; currency: string };
  lineItemFulfillmentInstructions?: {
    destinationTimeZone?: string;
    maxEstimatedDeliveryDate?: string;
    minEstimatedDeliveryDate?: string;
    shipByDate?: string;
    sourceTimeZone?: string;
  };
  lineItemFulfillmentStatus: string;
  total: { value: string; currency: string };
  deliveryCost?: { value: string; currency: string };
  taxes?: Array<{
    taxType: string;
    amount: { value: string; currency: string };
  }>;
  itemLocation?: {
    countryCode: string;
    postalCode?: string;
  };
}

export class EbayOrdersApiService {
  private baseUrl = "https://api.ebay.com";
  private sandboxUrl = "https://api.sandbox.ebay.com";
  private isProduction = true;

  private getApiUrl(): string {
    return this.isProduction ? this.baseUrl : this.sandboxUrl;
  }

  private async getAccessToken(): Promise<string> {
    return ebayOAuth.getValidAccessToken();
  }

  private async makeRequest<T>(
    method: string,
    endpoint: string,
    body?: any
  ): Promise<T> {
    const accessToken = await this.getAccessToken();
    const url = `${this.getApiUrl()}${endpoint}`;

    console.log(`📦 eBay Fulfillment API: ${method} ${endpoint}`);

    const headers: Record<string, string> = {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
      "Content-Language": "en-GB",
      "Accept-Language": "en-GB"
    };

    const options: RequestInit = {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    };

    try {
      const response = await fetch(url, options);
      
      await storage.trackApiCall("ebay");

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ eBay Fulfillment API Error: ${response.status} ${response.statusText}`);
        console.error(`   Response: ${errorText}`);
        
        let errorData: EbayApiError = {};
        try {
          errorData = JSON.parse(errorText);
        } catch {
          // Not JSON, use text directly
        }

        const errorMessage = errorData.errors?.[0]?.longMessage || 
                            errorData.errors?.[0]?.message || 
                            errorText;
        throw new Error(`eBay Fulfillment API Error (${response.status}): ${errorMessage}`);
      }

      if (response.status === 204) {
        return {} as T;
      }

      const data = await response.json();
      return data as T;
    } catch (error) {
      console.error(`❌ eBay Fulfillment API Request Failed:`, error);
      throw error;
    }
  }

  async getOrders(filter?: {
    orderIds?: string[];
    creationDateFrom?: string;
    creationDateTo?: string;
    limit?: number;
    offset?: number;
  }): Promise<EbayOrdersResponse> {
    const params = new URLSearchParams();
    
    if (filter?.orderIds?.length) {
      params.append('orderIds', filter.orderIds.join(','));
    }
    
    const dateRangeFilters: string[] = [];
    if (filter?.creationDateFrom && filter?.creationDateTo) {
      dateRangeFilters.push(`creationdate:[${filter.creationDateFrom}..${filter.creationDateTo}]`);
    } else if (filter?.creationDateFrom) {
      dateRangeFilters.push(`creationdate:[${filter.creationDateFrom}..]`);
    }
    
    if (dateRangeFilters.length > 0) {
      params.append('filter', dateRangeFilters.join(','));
    }
    
    params.append('limit', String(filter?.limit || 50));
    if (filter?.offset) {
      params.append('offset', String(filter.offset));
    }

    const queryString = params.toString();
    const endpoint = `/sell/fulfillment/v1/order${queryString ? `?${queryString}` : ''}`;

    return this.makeRequest<EbayOrdersResponse>('GET', endpoint);
  }

  async getOrder(orderId: string): Promise<EbayOrder> {
    return this.makeRequest<EbayOrder>('GET', `/sell/fulfillment/v1/order/${orderId}`);
  }

  async getRecentOrders(daysBack: number = 30): Promise<EbayOrdersResponse> {
    const toDate = new Date();
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - daysBack);

    return this.getOrders({
      creationDateFrom: fromDate.toISOString(),
      creationDateTo: toDate.toISOString(),
      limit: 200
    });
  }

  private mapEbayOrderStatus(orderFulfillmentStatus: string, orderPaymentStatus: string, cancelState?: string): string {
    if (cancelState === 'CANCELED') {
      return 'cancelled';
    }
    
    const statusMap: Record<string, string> = {
      'NOT_STARTED': 'new',
      'IN_PROGRESS': 'packed',
      'FULFILLED': 'shipped'
    };
    
    return statusMap[orderFulfillmentStatus] || 'new';
  }

  async syncOrdersFromEbay(daysBack: number = 30): Promise<{
    synced: number;
    updated: number;
    failed: number;
    errors: string[];
  }> {
    console.log(`🔄 Starting eBay orders sync (last ${daysBack} days)...`);
    
    let synced = 0;
    let updated = 0;
    let failed = 0;
    const errors: string[] = [];
    
    try {
      // Ensure the cost-at-sale column + dedup index exist before importing.
      await storage.ensureOrderIntegritySchema();

      // Paginate through ALL orders in the window — the previous implementation
      // capped at 200 (eBay's per-page max) and silently dropped everything past
      // that. At 100k listings the cap was an outright data-loss bug.
      //
      // Safety cap: stop after MAX_PAGES (default 100 = 20k orders) so a runaway
      // never tries to load an unbounded history in one call. Operator can bump
      // it via env. The cron runs hourly anyway, so even at 100k orders/window
      // catch-up is on the next tick.
      const fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - daysBack);
      const toDate = new Date();
      const PAGE_SIZE = 200;
      const MAX_PAGES = Math.max(1, Number(process.env.EBAY_ORDER_SYNC_MAX_PAGES) || 100);

      let offset = 0;
      let pages = 0;
      let totalReported: number | undefined;
      let processedThisCall = 0;
      const seenInThisRun = new Set<string>(); // de-dup if eBay double-pages

      while (pages < MAX_PAGES) {
        const ordersResponse = await this.getOrders({
          creationDateFrom: fromDate.toISOString(),
          creationDateTo: toDate.toISOString(),
          limit: PAGE_SIZE,
          offset,
        });
        if (totalReported == null) {
          totalReported = ordersResponse.total;
          console.log(`📦 eBay reports ${totalReported} orders in window — paginating`);
        }
        const pageOrders = ordersResponse.orders ?? [];
        if (pageOrders.length === 0) break;
        pages++;

        for (const ebayOrder of pageOrders) {
        if (seenInThisRun.has(ebayOrder.orderId)) continue;
        seenInThisRun.add(ebayOrder.orderId);
        processedThisCall++;
        try {
          const existingOrder = await storage.getOrderByMarketplaceId('ebay', ebayOrder.orderId);

          if (existingOrder) {
            await this.updateExistingOrder(existingOrder.id, ebayOrder);
            updated++;
          } else {
            await this.createNewOrder(ebayOrder);
            synced++;
          }
        } catch (error) {
          failed++;
          const errorMsg = `Failed to sync order ${ebayOrder.orderId}: ${(error as Error).message}`;
          console.error(`❌ ${errorMsg}`);
          errors.push(errorMsg);
        }
        } // for pageOrders

        // Stop when eBay returned fewer than a full page (last page) or when
        // there's no `next` href and total is reached.
        if (pageOrders.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
        if (totalReported != null && offset >= totalReported) break;
      } // while pages

      if (pages >= MAX_PAGES) {
        const msg = `Order sync hit page cap (${MAX_PAGES} × ${PAGE_SIZE}); ${processedThisCall} processed, more remain. Increase EBAY_ORDER_SYNC_MAX_PAGES or rely on next tick to catch up.`;
        console.warn(`⚠️  ${msg}`);
        errors.push(msg);
      }

      console.log(`✅ eBay orders sync complete: ${synced} new, ${updated} updated, ${failed} failed across ${pages} page(s)`);
      
    } catch (error) {
      const errorMsg = `eBay orders sync failed: ${(error as Error).message}`;
      console.error(`❌ ${errorMsg}`);
      errors.push(errorMsg);
    }
    
    return { synced, updated, failed, errors };
  }

  private async createNewOrder(ebayOrder: EbayOrder): Promise<Order> {
    const shippingInfo = ebayOrder.fulfillmentStartInstructions?.[0]?.shippingStep;
    const shipTo = shippingInfo?.shipTo;
    const contactAddress = shipTo?.contactAddress;
    
    const orderData: InsertOrder = {
      marketplace: 'ebay',
      marketplaceOrderId: ebayOrder.orderId,
      status: this.mapEbayOrderStatus(
        ebayOrder.orderFulfillmentStatus, 
        ebayOrder.orderPaymentStatus,
        ebayOrder.cancelStatus?.cancelState
      ),
      
      buyerUsername: ebayOrder.buyer.username,
      buyerEmail: shipTo?.email || null,
      
      shippingName: shipTo?.fullName || 'Unknown',
      shippingAddressLine1: contactAddress?.addressLine1 || '',
      shippingAddressLine2: contactAddress?.addressLine2 || null,
      shippingCity: contactAddress?.city || '',
      shippingStateOrProvince: contactAddress?.stateOrProvince || null,
      shippingPostalCode: contactAddress?.postalCode || '',
      shippingCountry: contactAddress?.countryCode || 'GB',
      shippingPhone: shipTo?.primaryPhone?.phoneNumber || null,
      
      subtotal: ebayOrder.pricingSummary.priceSubtotal.value,
      shippingCost: ebayOrder.pricingSummary.deliveryCost?.value || "0.00",
      totalPrice: ebayOrder.pricingSummary.total.value,
      currency: ebayOrder.pricingSummary.total.currency || 'EUR',
      
      marketplaceFee: ebayOrder.totalMarketplaceFee?.value || null,
      paymentProcessingFee: null,
      
      shippingService: shippingInfo?.shippingServiceCode || null,
      shippingCarrier: null,
      trackingNumber: null,
      trackingUrl: null,
      
      paidAt: ebayOrder.paymentSummary?.payments?.[0]?.paymentDate 
        ? new Date(ebayOrder.paymentSummary.payments[0].paymentDate) 
        : null,
      shippedAt: null,
      deliveredAt: null,
      expectedDeliveryStart: null,
      expectedDeliveryEnd: null,
      
      logisticsCarrier: null,
      logisticsLabelUrl: null,
      logisticsLabelData: null,
      
      buyerNote: ebayOrder.buyerCheckoutNotes || null,
      sellerNote: null,
      rawOrderData: JSON.stringify(ebayOrder),
      
      orderDate: new Date(ebayOrder.creationDate)
    };
    
    const order = await storage.createOrder(orderData);

    // Resolve each line item to a local product by SKU so the order is linked
    // (enables the TME deep-link and, critically, correct profit costing) and
    // snapshot the supplier cost at sale time so realized-profit reports don't
    // drift when the live TME price later changes.
    const orderItems: InsertOrderItem[] = [];
    for (const item of ebayOrder.lineItems) {
      const sku = item.sku || `EBAY-${item.legacyItemId}`;
      const product = item.sku ? await storage.getProductBySku(item.sku) : undefined;
      orderItems.push({
        orderId: order.id,
        marketplaceItemId: item.lineItemId,

        productId: product?.id ?? null,
        sku,
        tmeProductId: product?.supplierProductId ?? product?.tmeProductId ?? null,
        // PACKAGE cost per eBay unit, not TME's per-piece price: a listing
        // with MOQ 50 sells a 50-pack, so fulfilling one eBay unit costs
        // unit price x MOQ. Snapshotting the bare unit price overstated
        // profit on every multi-pack order (a 50x pack showed EUR 0.04 of
        // cost instead of ~EUR 2). Every consumer multiplies this by the
        // order quantity, so this is the single point where MOQ belongs.
        supplierCostAtSale:
          product?.supplierPrice != null
            ? (parseFloat(product.supplierPrice) * Math.max(1, product.moq ?? 1)).toFixed(2)
            : null,
        title: item.title,
        quantity: item.quantity,

        unitPrice: item.lineItemCost.value,
        totalPrice: item.total.value,

        imageUrl: product?.imageUrl ?? null
      });
    }

    if (orderItems.length > 0) {
      await storage.createOrderItems(orderItems);
    }
    
    if (ebayOrder.totalMarketplaceFee) {
      const fee: InsertOrderFee = {
        orderId: order.id,
        feeType: 'ebay_final_value',
        description: 'eBay Final Value Fee',
        amount: ebayOrder.totalMarketplaceFee.value,
        currency: ebayOrder.totalMarketplaceFee.currency || 'EUR'
      };
      await storage.createOrderFee(fee);
    }
    
    await storage.createOrderEvent({
      orderId: order.id,
      eventType: 'synced',
      note: `Order synced from eBay (${ebayOrder.orderId})`
    });
    
    console.log(`✅ Created order #${order.id} from eBay ${ebayOrder.orderId}`);
    return order;
  }

  private async updateExistingOrder(orderId: number, ebayOrder: EbayOrder): Promise<void> {
    const newStatus = this.mapEbayOrderStatus(
      ebayOrder.orderFulfillmentStatus,
      ebayOrder.orderPaymentStatus,
      ebayOrder.cancelStatus?.cancelState
    );
    
    const shippingInfo = ebayOrder.fulfillmentStartInstructions?.[0]?.shippingStep;
    const shipTo = shippingInfo?.shipTo;
    const contactAddress = shipTo?.contactAddress;
    
    await storage.updateOrder(orderId, {
      status: newStatus,
      
      shippingName: shipTo?.fullName || 'Unknown',
      shippingAddressLine1: contactAddress?.addressLine1 || '',
      shippingAddressLine2: contactAddress?.addressLine2 || null,
      shippingCity: contactAddress?.city || '',
      shippingStateOrProvince: contactAddress?.stateOrProvince || null,
      shippingPostalCode: contactAddress?.postalCode || '',
      shippingCountry: contactAddress?.countryCode || 'GB',
      
      subtotal: ebayOrder.pricingSummary.priceSubtotal.value,
      shippingCost: ebayOrder.pricingSummary.deliveryCost?.value || "0.00",
      totalPrice: ebayOrder.pricingSummary.total.value,
      
      marketplaceFee: ebayOrder.totalMarketplaceFee?.value || null,
      
      rawOrderData: JSON.stringify(ebayOrder)
    });
    
    console.log(`🔄 Updated order #${orderId} from eBay ${ebayOrder.orderId}`);
  }

  async getOrderShippingFulfillments(orderId: string): Promise<any> {
    return this.makeRequest<any>('GET', `/sell/fulfillment/v1/order/${orderId}/shipping_fulfillment`);
  }

  async createShippingFulfillment(orderId: string, fulfillmentData: {
    lineItems: Array<{ lineItemId: string; quantity: number }>;
    shippingCarrierCode: string;
    trackingNumber: string;
    shippedDate?: string;
  }): Promise<any> {
    return this.makeRequest<any>(
      'POST',
      `/sell/fulfillment/v1/order/${orderId}/shipping_fulfillment`,
      fulfillmentData
    );
  }
}

export const ebayOrdersApi = new EbayOrdersApiService();

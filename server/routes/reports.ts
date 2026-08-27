import type { Express } from "express";
import { requireAuth } from "../middleware/auth";
import { storage } from "../storage";
import { getFeeConfig } from "../fee-config";
import { computeOrderEconomics, type EconomicsConfig } from "@shared/order-economics";
import { vatForSale } from "@shared/vat-rates";

/**
 * Financial reporting from realised orders.
 *
 * Every figure here is computed with computeOrderEconomics, so a per-order
 * breakdown and the totals on the reports page can never disagree — they run
 * the same function over the same rows.
 */
export function registerReportsRoutes(app: Express) {
  const periodStart = (d: Date, groupBy: string): string => {
    const x = new Date(d);
    if (groupBy === "year") return `${x.getUTCFullYear()}`;
    if (groupBy === "month") return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, "0")}`;
    if (groupBy === "week") {
      // ISO week: Thursday of the current week decides the year.
      const t = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()));
      t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
      const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
      const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
      return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
    }
    return x.toISOString().slice(0, 10); // day
  };

  const emptyBucket = () => ({
    orders: 0, units: 0,
    grossReceived: 0, vatOwed: 0, netRevenue: 0,
    supplierCost: 0, marketplaceFee: 0, paymentFee: 0, postageCost: 0, packagingCost: 0,
    totalCosts: 0, netProfit: 0,
  });

  const addTo = (b: any, e: any, units: number) => {
    b.orders += 1;
    b.units += units;
    b.grossReceived += e.grossReceived;
    b.vatOwed += e.vatOwed;
    b.netRevenue += e.netRevenue;
    b.supplierCost += e.supplierCost;
    b.marketplaceFee += e.marketplaceFee;
    b.paymentFee += e.paymentFee;
    b.postageCost += e.postageCost;
    b.packagingCost += e.packagingCost;
    b.totalCosts += e.totalCosts;
    b.netProfit += e.netProfit;
  };

  const round = (b: any) => {
    for (const k of Object.keys(b)) {
      if (typeof b[k] === "number" && k !== "orders" && k !== "units") {
        b[k] = Math.round(b[k] * 100) / 100;
      }
    }
    b.netMarginPct = b.netRevenue > 0 ? Math.round((b.netProfit / b.netRevenue) * 10000) / 100 : null;
    b.grossMarginPct = b.grossReceived > 0 ? Math.round((b.netProfit / b.grossReceived) * 10000) / 100 : null;
    return b;
  };

  app.get("/api/reports/financials", requireAuth, async (req, res) => {
    try {
      const days = Math.min(1825, Math.max(1, Number(req.query.days) || 30));
      const groupBy = ["day", "week", "month", "year"].includes(String(req.query.groupBy))
        ? String(req.query.groupBy)
        : "day";

      const from = new Date();
      from.setDate(from.getDate() - days);

      const feeConfig = await getFeeConfig("ebay");
      const config: EconomicsConfig = {
        feePct: feeConfig.ebayFvfPct,
        fixedFee: feeConfig.ebayFixedFee,
        packagingCost: feeConfig.packagingCost,
        homeCountry: process.env.SELLER_COUNTRY || "LV",
      };

      const orders = await storage.getOrders({ fromDate: from, limit: 5000 });
      const live = orders.filter(
        (o: any) => !["cancelled", "refunded", "returned"].includes(String(o.status).toLowerCase()),
      );
      const itemsByOrder = await storage.getOrderItemsByOrderIds(live.map((o: any) => o.id));

      const totals = emptyBucket();
      const byPeriod = new Map<string, any>();
      const byCountry = new Map<string, any>();
      const bySupplier = new Map<string, any>();
      const byMarketplace = new Map<string, any>();
      const perOrder: any[] = [];
      let ordersMissingCost = 0;
      let ordersMissingFee = 0;

      for (const o of live as any[]) {
        const items = itemsByOrder.get(o.id) ?? [];
        const units = items.reduce((s: number, i: any) => s + (i.quantity || 0), 0);
        const supplierCost = items.reduce(
          (s: number, i: any) => s + Number(i.supplierCostAtSale ?? 0) * (i.quantity || 0),
          0,
        );

        const e = computeOrderEconomics(
          {
            itemsGross: Number(o.subtotal ?? 0),
            shippingCharged: Number(o.shippingCost ?? 0),
            destinationCountry: o.shippingCountry,
            supplierCost,
            actualMarketplaceFee: o.marketplaceFee != null ? Number(o.marketplaceFee) : null,
            actualPaymentFee: o.paymentProcessingFee != null ? Number(o.paymentProcessingFee) : null,
            // Not captured per order yet; the ledger marks it as absent rather
            // than pretending postage was free.
            postageCost: 0,
          },
          config,
        );

        if (supplierCost <= 0) ordersMissingCost++;
        if (o.marketplaceFee == null) ordersMissingFee++;

        addTo(totals, e, units);

        const pk = periodStart(new Date(o.orderDate), groupBy);
        if (!byPeriod.has(pk)) byPeriod.set(pk, { period: pk, ...emptyBucket() });
        addTo(byPeriod.get(pk), e, units);

        const ck = (o.shippingCountry || "??").toUpperCase();
        if (!byCountry.has(ck)) {
          byCountry.set(ck, { country: ck, vatRatePct: e.vat.ratePct, vatBasis: e.vat.basis, ...emptyBucket() });
        }
        addTo(byCountry.get(ck), e, units);

        const mk = o.marketplace || "unknown";
        if (!byMarketplace.has(mk)) byMarketplace.set(mk, { marketplace: mk, ...emptyBucket() });
        addTo(byMarketplace.get(mk), e, units);

        // Supplier split: order_items carry the TME id where we matched one.
        for (const i of items) {
          const sk = i.tmeProductId ? "TME" : "Unmatched";
          if (!bySupplier.has(sk)) {
            bySupplier.set(sk, { supplier: sk, units: 0, cost: 0, lines: 0 });
          }
          const b = bySupplier.get(sk);
          b.lines += 1;
          b.units += i.quantity || 0;
          b.cost += Number(i.supplierCostAtSale ?? 0) * (i.quantity || 0);
        }

        perOrder.push({
          id: o.id,
          marketplaceOrderId: o.marketplaceOrderId,
          orderDate: o.orderDate,
          status: o.status,
          country: o.shippingCountry,
          units,
          ...e,
        });
      }

      perOrder.sort((a, b) => new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime());

      res.json({
        success: true,
        window: { days, from: from.toISOString(), groupBy },
        totals: round(totals),
        byPeriod: Array.from(byPeriod.values()).map(round).sort((a, b) => (a.period < b.period ? 1 : -1)),
        byCountry: Array.from(byCountry.values()).map(round).sort((a, b) => b.netProfit - a.netProfit),
        byMarketplace: Array.from(byMarketplace.values()).map(round),
        bySupplier: Array.from(bySupplier.values()).map((b) => ({
          ...b,
          cost: Math.round(b.cost * 100) / 100,
        })),
        // Honesty about the inputs: a report that silently models missing data
        // reads as fact. These counts say how much of it is estimated.
        dataQuality: {
          ordersMissingSupplierCost: ordersMissingCost,
          ordersMissingActualFee: ordersMissingFee,
          postageCostTracked: false,
          note:
            "Postage paid to the carrier is not captured per order yet, so profit is overstated by roughly the shipping cost. Supplier cost is recorded at sale time on orders imported since that column existed.",
        },
        orders: perOrder.slice(0, 200),
      });
    } catch (error) {
      console.error("Financial report failed:", error);
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  /** One order's ledger, for the order detail panel. */
  app.get("/api/reports/order/:id", requireAuth, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const order: any = await storage.getOrder(id);
      if (!order) return res.status(404).json({ success: false, error: "Order not found" });

      const items = (await storage.getOrderItemsByOrderIds([id])).get(id) ?? [];
      const supplierCost = items.reduce(
        (s: number, i: any) => s + Number(i.supplierCostAtSale ?? 0) * (i.quantity || 0),
        0,
      );
      const feeConfig = await getFeeConfig("ebay");

      const economics = computeOrderEconomics(
        {
          itemsGross: Number(order.subtotal ?? 0),
          shippingCharged: Number(order.shippingCost ?? 0),
          destinationCountry: order.shippingCountry,
          supplierCost,
          actualMarketplaceFee: order.marketplaceFee != null ? Number(order.marketplaceFee) : null,
          actualPaymentFee: order.paymentProcessingFee != null ? Number(order.paymentProcessingFee) : null,
          postageCost: 0,
        },
        {
          feePct: feeConfig.ebayFvfPct,
          fixedFee: feeConfig.ebayFixedFee,
          packagingCost: feeConfig.packagingCost,
          homeCountry: process.env.SELLER_COUNTRY || "LV",
        },
      );

      res.json({
        success: true,
        orderId: id,
        vatRate: vatForSale(order.shippingCountry),
        items: items.map((i: any) => ({
          sku: i.sku,
          title: i.title,
          quantity: i.quantity,
          unitPrice: Number(i.unitPrice ?? 0),
          lineGross: Number(i.totalPrice ?? 0),
          supplierCostAtSale: i.supplierCostAtSale != null ? Number(i.supplierCostAtSale) : null,
          lineCost: Number(i.supplierCostAtSale ?? 0) * (i.quantity || 0),
        })),
        economics,
      });
    } catch (error) {
      console.error("Order economics failed:", error);
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });
}

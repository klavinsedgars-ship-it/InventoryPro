import type { Express } from "express";
import { storage } from "../storage";
import { requireAuth } from "../middleware/auth";
import { labelAddressLines } from "@shared/country-names";
import { inspectLbx, mergeAddressIntoLbx } from "../lbx-template";

/**
 * Shipping labels through P-touch Editor.
 *
 * The QL-800 will not take a browser print job: it reads the roll's ID off
 * the spool and rejects anything whose media is not the roll it can feel, and
 * on this machine only P-touch drives it properly. So the CRM stops trying to
 * be the printer and becomes the thing that fills in the label instead — the
 * operator uploads the .lbx they already print from, and every order hands
 * back that same file with the address in it.
 */

const MARKETPLACE = "ebay";
const KEY_DATA = "ptouch_template";
const KEY_NAME = "ptouch_template_name";
const KEY_SLOT = "ptouch_template_slot";
const KEY_UPDATED = "ptouch_template_updated";

/** A label template is XML and maybe a logo; anything larger is a mistake. */
const MAX_TEMPLATE_BYTES = 4 * 1024 * 1024;

async function settings(): Promise<Record<string, string>> {
  const rows = (await storage.getMarketplaceSettings(MARKETPLACE)) as any[];
  return Object.fromEntries(rows.map((r) => [r.setting, r.value]));
}

async function put(setting: string, value: string): Promise<void> {
  await storage.setMarketplaceSetting({ marketplace: MARKETPLACE, setting, value });
}

async function loadTemplate(): Promise<{ buf: Buffer; name: string; slot: number } | null> {
  const s = await settings();
  if (!s[KEY_DATA]) return null;
  return {
    buf: Buffer.from(s[KEY_DATA], "base64"),
    name: s[KEY_NAME] || "label.lbx",
    slot: Number(s[KEY_SLOT] ?? 0) || 0,
  };
}

/** Windows and macOS both dislike these in a downloaded file name. */
function safeFileName(value: string): string {
  return (value || "label").replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 60);
}

export function registerLabelRoutes(app: Express): void {
  app.get("/api/labels/template", requireAuth, async (_req, res) => {
    try {
      const template = await loadTemplate();
      if (!template) return res.json({ present: false });
      const s = await settings();
      const info = inspectLbx(template.buf);
      res.json({
        present: true,
        name: template.name,
        slot: template.slot,
        slots: info.slots,
        files: info.entries,
        bytes: template.buf.length,
        updatedAt: s[KEY_UPDATED] ?? null,
      });
    } catch (error: any) {
      // A stored template that no longer parses is worth saying out loud
      // rather than failing silently at print time.
      res.json({ present: true, broken: true, error: error?.message ?? "Unreadable template" });
    }
  });

  app.post("/api/labels/template", requireAuth, async (req, res) => {
    try {
      const { name, dataBase64, slot } = req.body ?? {};
      if (typeof dataBase64 !== "string" || !dataBase64) {
        return res.status(400).json({ error: "No file received" });
      }
      const buf = Buffer.from(dataBase64, "base64");
      if (!buf.length) return res.status(400).json({ error: "The file was empty" });
      if (buf.length > MAX_TEMPLATE_BYTES) {
        return res.status(413).json({ error: "That .lbx is larger than 4 MB" });
      }

      // Parse before storing: a template that cannot be filled in is worse
      // than no template, because it fails on the parcel, not on the upload.
      const info = inspectLbx(buf);
      const chosen = Number.isInteger(slot) && slot >= 0 && slot < info.slots.length ? slot : 0;

      await put(KEY_DATA, buf.toString("base64"));
      await put(KEY_NAME, safeFileName(typeof name === "string" ? name : "label.lbx"));
      await put(KEY_SLOT, String(chosen));
      await put(KEY_UPDATED, new Date().toISOString());

      res.json({ present: true, name, slot: chosen, slots: info.slots, bytes: buf.length });
    } catch (error: any) {
      res.status(400).json({ error: error?.message ?? "Could not read that .lbx" });
    }
  });

  app.post("/api/labels/template/slot", requireAuth, async (req, res) => {
    try {
      const template = await loadTemplate();
      if (!template) return res.status(404).json({ error: "No template uploaded yet" });
      const info = inspectLbx(template.buf);
      const slot = Number(req.body?.slot);
      if (!Number.isInteger(slot) || slot < 0 || slot >= info.slots.length) {
        return res.status(400).json({ error: "No text box with that number" });
      }
      await put(KEY_SLOT, String(slot));
      res.json({ slot });
    } catch (error: any) {
      res.status(500).json({ error: error?.message ?? "Could not change the text box" });
    }
  });

  app.delete("/api/labels/template", requireAuth, async (_req, res) => {
    try {
      await put(KEY_DATA, "");
      await put(KEY_NAME, "");
      res.json({ present: false });
    } catch (error: any) {
      res.status(500).json({ error: error?.message ?? "Could not remove the template" });
    }
  });

  // The address of one order, in the operator's own label.
  app.get("/api/orders/:id/label.lbx", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const order = await storage.getOrder(id);
      if (!order) return res.status(404).json({ error: "Order not found" });

      const template = await loadTemplate();
      if (!template) {
        return res.status(409).json({
          error: "No P-touch template uploaded yet — add the .lbx you print from today.",
        });
      }

      const lines = labelAddressLines(order as any);
      if (!lines.length) {
        return res.status(422).json({ error: "This order has no shipping address on it" });
      }

      const merged = mergeAddressIntoLbx(template.buf, lines, template.slot);
      const fileName = `label-${safeFileName(String((order as any).marketplaceOrderId ?? order.id))}.lbx`;

      await storage
        .createOrderEvent({
          orderId: id,
          eventType: "label_print",
          note: `Label prepared for P-touch (${lines[0]})`,
        })
        .catch(() => undefined);

      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
      res.setHeader("Content-Length", String(merged.length));
      res.send(merged);
    } catch (error: any) {
      console.error("Failed to build .lbx label:", error);
      res.status(500).json({ error: error?.message ?? "Could not build the label" });
    }
  });
}

import {
  buildLabelHtml,
  estimateFontPt,
  type LabelOptions,
} from "@shared/label-layout";

/**
 * Printing one label, from the browser, to the label printer.
 *
 * `window.print()` on the page itself sends the whole orders screen to the
 * printer, which on a QL-800 means one very confused 62 mm strip. Everything
 * here prints an isolated document instead: the label alone, at its physical
 * size, with the page box declared so the driver picks the die-cut media.
 */

const FRAME_ID = "ql-label-print-frame";

/**
 * Shrink the type until the address fits the label.
 *
 * `estimateFontPt` gets close from character counts alone, but the real width
 * of "Hanfgartenweg" in Arial Bold is something only the browser knows, and an
 * address that overflows is an address the courier cannot read.
 */
export function fitLabelDocument(doc: Document, opts: LabelOptions): number | null {
  const label = doc.getElementById("label");
  const fit = doc.getElementById("fit");
  const lines = doc.getElementById("lines");
  if (!label || !fit || !lines) return null;

  const maxPt = opts.maxFontPt ?? 12;
  const minPt = opts.minFontPt ?? 5;

  let pt = maxPt;
  // A quarter point at a time, from the top down: 28 steps at worst, each one
  // a single reflow of a document holding five lines of text.
  //
  // Layout boxes, not bounding rectangles: on a rotated label
  // getBoundingClientRect returns the axis-aligned box of the turned content,
  // so its height is the content's width and every label shrinks to the floor.
  for (let guard = 0; guard < 200; guard += 1) {
    (label as HTMLElement).style.fontSize = `${pt}pt`;
    const needHeight = Math.max(lines.scrollHeight, (lines as HTMLElement).offsetHeight);
    const fits =
      needHeight <= fit.clientHeight + 1 && lines.scrollWidth <= fit.clientWidth + 1;
    if (fits || pt <= minPt) break;
    pt = Math.round((pt - 0.25) * 100) / 100;
  }
  return pt;
}

function removeFrame(frame: HTMLIFrameElement) {
  if (frame.parentNode) frame.parentNode.removeChild(frame);
}

/**
 * Render `html` into an offscreen iframe and print that iframe.
 *
 * The iframe is laid out at a real size — a zero-sized one measures as zero,
 * and the fitting pass above would have nothing to measure against.
 */
export function printLabelHtml(html: string, opts: LabelOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof document === "undefined") {
      reject(new Error("No document to print from"));
      return;
    }

    document.getElementById(FRAME_ID)?.remove();

    const frame = document.createElement("iframe");
    frame.id = FRAME_ID;
    frame.setAttribute("aria-hidden", "true");
    frame.setAttribute("title", "Label preview");
    frame.style.cssText =
      "position:fixed;left:-10000px;top:0;width:150mm;height:150mm;border:0;opacity:0;";
    frame.srcdoc = html;

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    frame.onload = () => {
      const win = frame.contentWindow;
      const doc = frame.contentDocument;
      if (!win || !doc) {
        removeFrame(frame);
        reject(new Error("The browser blocked the print document"));
        return;
      }

      try {
        fitLabelDocument(doc, opts);
        // Firefox needs the frame focused or it prints the parent page.
        win.focus();
        win.addEventListener("afterprint", () => {
          finish();
          window.setTimeout(() => removeFrame(frame), 0);
        });
        win.print();
        finish();
      } catch (err) {
        removeFrame(frame);
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }

      // Safari never fires afterprint for a frame. Tidying up on a timer keeps
      // the DOM from collecting one hidden iframe per label printed.
      window.setTimeout(() => removeFrame(frame), 60_000);
    };

    document.body.appendChild(frame);
  });
}

export function printAddressLabel(lines: string[], opts: LabelOptions): Promise<void> {
  return printLabelHtml(buildLabelHtml(lines, opts), opts);
}

/** The operator's label stock and orientation, remembered between orders. */
export interface LabelSettings {
  sizeId: string;
  rotate: boolean;
  paddingMm: number;
  maxFontPt: number;
}

const SETTINGS_KEY = "inventorypro.labelPrint.v1";

export const DEFAULT_LABEL_SETTINGS: LabelSettings = {
  sizeId: "62x29",
  rotate: false,
  paddingMm: 3,
  maxFontPt: 12,
};

export function loadLabelSettings(): LabelSettings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_LABEL_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<LabelSettings>;
    return {
      sizeId: typeof parsed.sizeId === "string" ? parsed.sizeId : DEFAULT_LABEL_SETTINGS.sizeId,
      rotate: parsed.rotate === true,
      paddingMm:
        typeof parsed.paddingMm === "number" && parsed.paddingMm >= 0 && parsed.paddingMm <= 10
          ? parsed.paddingMm
          : DEFAULT_LABEL_SETTINGS.paddingMm,
      maxFontPt:
        typeof parsed.maxFontPt === "number" && parsed.maxFontPt >= 5 && parsed.maxFontPt <= 40
          ? parsed.maxFontPt
          : DEFAULT_LABEL_SETTINGS.maxFontPt,
    };
  } catch {
    // Private windows and locked-down browsers throw on localStorage.
    return { ...DEFAULT_LABEL_SETTINGS };
  }
}

export function saveLabelSettings(settings: LabelSettings): void {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* not worth a toast — the label still prints */
  }
}

export { estimateFontPt };

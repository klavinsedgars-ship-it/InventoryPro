/**
 * Geometry for the Brother QL-800 address label.
 *
 * The label used to be copy-pasted into Brother's P-touch Editor, which meant
 * a second application, a second set of font settings and a chance to paste
 * the wrong order. Everything here builds a self-contained HTML document sized
 * to the physical die-cut label, so the browser can print it straight to the
 * QL-800 instead.
 *
 * Kept free of DOM APIs: the maths is the part worth testing, and tests run in
 * node.
 */

export interface LabelSize {
  id: string;
  /** What the operator sees in the dropdown. */
  name: string;
  /** Millimetres across the label, i.e. the roll width. */
  widthMm: number;
  /** Millimetres along the feed direction. */
  heightMm: number;
}

/**
 * The DK media a QL-800 takes, written width × height as the label leaves the
 * printer — which is how P-touch lists them.
 *
 * These are only what the *document* is sized to. The printer's own media is
 * chosen in the browser's print dialog, and a QL-800 reads the roll's ID off
 * the spool: ask it for a size that is not the roll it can feel, and it
 * refuses with "the roll of labels or tape inside the machine does not match
 * the one selected in the application". So this list has to be matched to the
 * paper size picked in that dialog, and both to the roll in the machine.
 */
export const QL_LABEL_SIZES: LabelSize[] = [
  { id: "62x29", name: "62 × 29 mm — 62 mm roll", widthMm: 62, heightMm: 29 },
  { id: "62x50", name: "62 × 50 mm — 62 mm roll", widthMm: 62, heightMm: 50 },
  { id: "62x100", name: "62 × 100 mm — shipping", widthMm: 62, heightMm: 100 },
  { id: "29x62", name: "29 × 62 mm — small address", widthMm: 29, heightMm: 62 },
  { id: "29x90", name: "29 × 90 mm — standard address", widthMm: 29, heightMm: 90 },
  { id: "38x90", name: "38 × 90 mm — large address", widthMm: 38, heightMm: 90 },
  { id: "17x54", name: "17 × 54 mm — multi-purpose", widthMm: 17, heightMm: 54 },
];

/** What the shop had loaded when this was built. */
export const DEFAULT_LABEL_SIZE_ID = "62x29";

/**
 * Anything else the print dialog offers. Brother's driver names media
 * differently per platform and per roll, so rather than guess at a list, the
 * operator can type the size the dialog shows.
 */
export const CUSTOM_LABEL_SIZE_ID = "custom";

export const CUSTOM_LABEL_SIZE: LabelSize = {
  id: CUSTOM_LABEL_SIZE_ID,
  name: "Custom — type the size the print dialog shows",
  widthMm: 62,
  heightMm: 29,
};

/** Smaller than this is not a label; larger is not a QL roll. */
export const MIN_LABEL_MM = 10;
export const MAX_LABEL_MM = 300;

export function clampLabelMm(value: number | null | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(MAX_LABEL_MM, Math.max(MIN_LABEL_MM, Math.round(value * 10) / 10));
}

export function labelSizeById(id: string | null | undefined): LabelSize {
  if (id === CUSTOM_LABEL_SIZE_ID) return CUSTOM_LABEL_SIZE;
  return QL_LABEL_SIZES.find((s) => s.id === id)
    ?? QL_LABEL_SIZES.find((s) => s.id === DEFAULT_LABEL_SIZE_ID)!;
}

export interface LabelOptions {
  /** Millimetres across the label, as composed. */
  widthMm: number;
  /** Millimetres down the label, as composed. */
  heightMm: number;
  /**
   * Quiet zone inside the label. P-touch defaults to 3 mm; the QL's own
   * unprintable edge is smaller, so this is about looks, not clipping.
   */
  paddingMm?: number;
  /**
   * Emit the page rotated a quarter turn. Some Brother driver/OS combinations
   * present 62 × 29 media to the browser as a 29 × 62 page; when the label
   * comes out sideways or clipped, this is the fix.
   */
  rotate?: boolean;
  /** Largest type size to try. P-touch was set to Arial Bold 12. */
  maxFontPt?: number;
  /** Below this the address stops being readable across a counter. */
  minFontPt?: number;
  fontFamily?: string;
  bold?: boolean;
  /** Shown above the address in small type, e.g. the order number. */
  heading?: string;
  /** Document title — never printed, but it lands in the print dialog. */
  title?: string;
}

export const DEFAULT_LABEL_OPTIONS = {
  paddingMm: 3,
  rotate: false,
  maxFontPt: 12,
  minFontPt: 5,
  fontFamily: "Arial, Helvetica, sans-serif",
  bold: true,
} as const;

export const PT_PER_MM = 72 / 25.4;

/** Arial Bold, mixed-case address text, averaged over a page of addresses. */
const AVG_CHAR_EM = 0.58;
const LINE_HEIGHT = 1.18;

function resolve(opts: LabelOptions) {
  return {
    ...DEFAULT_LABEL_OPTIONS,
    ...opts,
    paddingMm: opts.paddingMm ?? DEFAULT_LABEL_OPTIONS.paddingMm,
    maxFontPt: opts.maxFontPt ?? DEFAULT_LABEL_OPTIONS.maxFontPt,
    minFontPt: opts.minFontPt ?? DEFAULT_LABEL_OPTIONS.minFontPt,
  };
}

/**
 * The page the printer is asked for. Composition is always width × height;
 * rotating swaps what the driver is told, and the content turns with it.
 */
export function pageSizeMm(opts: LabelOptions): { widthMm: number; heightMm: number } {
  return opts.rotate
    ? { widthMm: opts.heightMm, heightMm: opts.widthMm }
    : { widthMm: opts.widthMm, heightMm: opts.heightMm };
}

/**
 * A starting type size that will usually fit. The browser measures the real
 * thing afterwards and shrinks further if it has to, but a sane start keeps
 * that loop short — and this is the only size available where no DOM exists.
 */
export function estimateFontPt(lines: string[], opts: LabelOptions): number {
  const o = resolve(opts);
  const usable = lines.map((l) => l.trim()).filter(Boolean);
  if (!usable.length) return o.maxFontPt;

  const contentWmm = Math.max(o.widthMm - 2 * o.paddingMm, 1);
  const contentHmm = Math.max(o.heightMm - 2 * o.paddingMm, 1);

  const longest = usable.reduce((n, l) => Math.max(n, l.length), 1);
  const byWidth = (contentWmm * PT_PER_MM) / (AVG_CHAR_EM * longest);
  const byHeight = (contentHmm * PT_PER_MM) / (LINE_HEIGHT * usable.length);

  const pt = Math.min(o.maxFontPt, byWidth, byHeight);
  return Math.max(o.minFontPt, Math.floor(pt * 4) / 4);
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * A complete document for one label: no stylesheet, no script, no dependency
 * on the app around it, so it prints the same from an iframe, a popup or a
 * file saved to disk.
 */
export function buildLabelHtml(lines: string[], opts: LabelOptions): string {
  const o = resolve(opts);
  const page = pageSizeMm(o);
  const usable = lines.map((l) => l.trim()).filter(Boolean);
  const startPt = estimateFontPt(usable, o);

  // Rotating turns the content box a quarter turn clockwise about its own top
  // left, which leaves it off the page to the left; sliding it back by the
  // page width drops it exactly onto the page.
  const transform = o.rotate
    ? `transform: translate(${page.widthMm}mm, 0) rotate(90deg); transform-origin: top left;`
    : "";

  const heading = o.heading?.trim()
    ? `<div id="heading">${escapeHtml(o.heading.trim())}</div>`
    : "";

  const body = usable.length
    ? usable.map((l) => `<div class="line">${escapeHtml(l)}</div>`).join("")
    : `<div class="line">&nbsp;</div>`;

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(o.title || "Shipping label")}</title>
<style>
  @page { size: ${page.widthMm}mm ${page.heightMm}mm; margin: 0; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body { width: ${page.widthMm}mm; height: ${page.heightMm}mm; overflow: hidden; }
  #label {
    position: absolute; top: 0; left: 0;
    width: ${o.widthMm}mm; height: ${o.heightMm}mm;
    box-sizing: border-box;
    overflow: hidden;
    background: #fff;
    color: #000;
    font-family: ${o.fontFamily};
    font-weight: ${o.bold ? 700 : 400};
    font-size: ${startPt}pt;
    line-height: ${LINE_HEIGHT};
    ${transform}
  }
  #fit {
    position: absolute;
    top: ${o.paddingMm}mm; right: ${o.paddingMm}mm;
    bottom: ${o.paddingMm}mm; left: ${o.paddingMm}mm;
    display: flex; align-items: center; justify-content: center;
    overflow: hidden;
  }
  #lines { width: 100%; text-align: center; }
  .line { overflow-wrap: anywhere; }
  #heading { font-weight: 400; font-size: 0.7em; margin-bottom: 0.25em; }
  @media print {
    html, body { width: ${page.widthMm}mm; height: ${page.heightMm}mm; }
  }
</style>
</head>
<body>
  <div id="label"><div id="fit"><div id="lines">${heading}${body}</div></div></div>
</body>
</html>`;
}

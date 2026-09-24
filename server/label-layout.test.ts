import { describe, it, expect } from "vitest";
import {
  QL_LABEL_SIZES,
  buildLabelHtml,
  escapeHtml,
  estimateFontPt,
  labelSizeById,
  pageSizeMm,
  type LabelOptions,
} from "@shared/label-layout";

const SMALL_ADDRESS: LabelOptions = { widthMm: 62, heightMm: 29 };

// The address from a real German order, which is the shape that has to fit.
const ADDRESS = [
  "Matthias Jaksch",
  "Hanfgartenweg 1",
  "85077 Manching",
  "Germany",
  "Tel: 015146686337",
];

describe("labelSizeById", () => {
  it("falls back to the stock on the machine when the id is unknown", () => {
    expect(labelSizeById("no-such-label").id).toBe("62x29");
    expect(labelSizeById(null).widthMm).toBe(62);
  });

  it("returns the size asked for", () => {
    const shipping = labelSizeById("62x100");
    expect(shipping.widthMm).toBe(62);
    expect(shipping.heightMm).toBe(100);
  });

  it("has no duplicate ids", () => {
    const ids = QL_LABEL_SIZES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("pageSizeMm", () => {
  it("asks for the page the label is composed on", () => {
    expect(pageSizeMm(SMALL_ADDRESS)).toEqual({ widthMm: 62, heightMm: 29 });
  });

  it("swaps the page when the driver wants the media the other way round", () => {
    expect(pageSizeMm({ ...SMALL_ADDRESS, rotate: true })).toEqual({
      widthMm: 29,
      heightMm: 62,
    });
  });
});

describe("estimateFontPt", () => {
  it("never exceeds the size the operator set", () => {
    expect(estimateFontPt(["Riga"], { ...SMALL_ADDRESS, maxFontPt: 12 })).toBeLessThanOrEqual(12);
  });

  it("shrinks as lines are added", () => {
    const few = estimateFontPt(ADDRESS.slice(0, 2), SMALL_ADDRESS);
    const many = estimateFontPt([...ADDRESS, ...ADDRESS], SMALL_ADDRESS);
    expect(many).toBeLessThan(few);
  });

  it("shrinks for a long line, not only for many lines", () => {
    const short = estimateFontPt(["Berlin"], SMALL_ADDRESS);
    const long = estimateFontPt(
      ["Bundesallee 171 Hinterhaus zweiter Aufgang links"],
      SMALL_ADDRESS,
    );
    expect(long).toBeLessThan(short);
  });

  it("stops at the readable floor instead of vanishing", () => {
    const pt = estimateFontPt(new Array(40).fill("a very long address line indeed"), {
      ...SMALL_ADDRESS,
      minFontPt: 5,
    });
    expect(pt).toBe(5);
  });

  it("keeps a real address readable on the small address label", () => {
    // 5 lines on 62 × 29 mm with a 3 mm quiet zone: anything under 7pt would
    // mean the courier squinting at the parcel.
    expect(estimateFontPt(ADDRESS, { ...SMALL_ADDRESS, paddingMm: 3 })).toBeGreaterThanOrEqual(7);
  });

  it("ignores blank lines an order leaves behind", () => {
    const withBlanks = estimateFontPt([...ADDRESS, "", "   "], SMALL_ADDRESS);
    expect(withBlanks).toBe(estimateFontPt(ADDRESS, SMALL_ADDRESS));
  });

  it("gives an empty address the full size rather than dividing by nothing", () => {
    expect(estimateFontPt([], { ...SMALL_ADDRESS, maxFontPt: 12 })).toBe(12);
  });
});

describe("escapeHtml", () => {
  it("escapes the characters that would break out of a line", () => {
    expect(escapeHtml(`<b>"O'Neill" & Co</b>`)).toBe(
      "&lt;b&gt;&quot;O&#39;Neill&quot; &amp; Co&lt;/b&gt;",
    );
  });
});

describe("buildLabelHtml", () => {
  it("declares the die-cut label as the page, with no margin of its own", () => {
    const html = buildLabelHtml(ADDRESS, SMALL_ADDRESS);
    expect(html).toContain("@page { size: 62mm 29mm; margin: 0; }");
  });

  it("declares the swapped page and turns the content with it", () => {
    const html = buildLabelHtml(ADDRESS, { ...SMALL_ADDRESS, rotate: true });
    expect(html).toContain("@page { size: 29mm 62mm; margin: 0; }");
    // Rotating about the top left leaves the box off the page to the left;
    // the slide is by the page width, or the label prints blank.
    expect(html).toContain("transform: translate(29mm, 0) rotate(90deg)");
  });

  it("leaves the content untransformed when it is not rotated", () => {
    expect(buildLabelHtml(ADDRESS, SMALL_ADDRESS)).not.toContain("rotate(90deg)");
  });

  it("prints every address line", () => {
    const html = buildLabelHtml(ADDRESS, SMALL_ADDRESS);
    for (const line of ADDRESS) expect(html).toContain(line);
  });

  it("escapes an address instead of letting it write markup", () => {
    const html = buildLabelHtml(["<script>alert(1)</script>"], SMALL_ADDRESS);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("starts at the estimated size so the browser has little shrinking left", () => {
    const html = buildLabelHtml(ADDRESS, SMALL_ADDRESS);
    expect(html).toContain(`font-size: ${estimateFontPt(ADDRESS, SMALL_ADDRESS)}pt;`);
  });

  it("sizes the content box to the label, whatever the page", () => {
    const html = buildLabelHtml(ADDRESS, { ...SMALL_ADDRESS, rotate: true });
    expect(html).toContain("width: 62mm; height: 29mm;");
  });

  it("insets the content by the quiet zone", () => {
    const html = buildLabelHtml(ADDRESS, { ...SMALL_ADDRESS, paddingMm: 4 });
    expect(html).toContain("top: 4mm; right: 4mm;");
  });

  it("survives an order with no address at all", () => {
    const html = buildLabelHtml([], SMALL_ADDRESS);
    expect(html).toContain("<div class=\"line\">&nbsp;</div>");
  });

  it("carries the order number into the print dialog's title", () => {
    const html = buildLabelHtml(ADDRESS, { ...SMALL_ADDRESS, title: "Label 07-05140" });
    expect(html).toContain("<title>Label 07-05140</title>");
  });
});

import { describe, it, expect } from "vitest";
import {
  decodeEntities,
  sniffFeedStructure,
  recordsOf,
  nodeToJson,
  detectXmlEncoding,
} from "./xml-feed";

const collect = (xml: string, record: string) =>
  Array.from(recordsOf(xml, record)).map((n) => nodeToJson(n));

describe("decodeEntities", () => {
  it("decodes named and numeric entities", () => {
    expect(decodeEntities("R&amp;D &lt;5&gt; &quot;x&quot; &#65; &#x42;")).toBe('R&D <5> "x" A B');
  });
  it("leaves unknown entities intact", () => {
    expect(decodeEntities("a &bogus; b")).toBe("a &bogus; b");
  });
});

describe("sniffFeedStructure", () => {
  it("finds the record element among the root's children", () => {
    const s = sniffFeedStructure(`<root><product><a>1</a></product><product><a>2</a></product></root>`);
    expect(s.rootElement).toBe("root");
    expect(s.recordElement).toBe("product");
    expect(s.recordCount).toBe(2);
  });

  it("descends through a single wrapper element", () => {
    const s = sniffFeedStructure(
      `<shop><created>x</created><products><product/><product/><product/></products></shop>`,
    );
    // depth-1 max count is 1 (created, products) → depth 2 wins
    expect(s.recordElement).toBe("product");
    expect(s.recordCount).toBe(3);
  });

  it("returns null for a document with no repetition", () => {
    const s = sniffFeedStructure(`<root><only><leaf>x</leaf></only></root>`);
    expect(s.recordElement).toBeNull();
  });
});

describe("recordsOf + nodeToJson", () => {
  it("parses leaves, attributes and repeated children", () => {
    const [rec] = collect(
      `<r><product id="7"><name>Cable</name><img>a.jpg</img><img>b.jpg</img></product></r>`,
      "product",
    );
    expect(rec).toEqual({ "@id": "7", name: "Cable", img: ["a.jpg", "b.jpg"] });
  });

  it("keeps CDATA verbatim — even when it contains a closing tag", () => {
    const [rec] = collect(
      `<r><p><desc><![CDATA[5 < 7 &amp; </p> stays]]></desc></p></r>`,
      "p",
    );
    expect(rec).toEqual({ desc: "5 < 7 &amp; </p> stays" });
  });

  it("decodes entities in ordinary text but not in CDATA", () => {
    const [rec] = collect(`<r><p><t>a &amp; b</t></p></r>`, "p");
    expect(rec).toEqual({ t: "a & b" });
  });

  it("skips comments, PIs and DOCTYPE", () => {
    const xml = `<?xml version="1.0"?><!DOCTYPE root [<!ENTITY x "y">]><root><!-- note --><p><a>1</a></p></root>`;
    expect(collect(xml, "p")).toEqual([{ a: "1" }]);
  });

  it("handles self-closing records and nested structures", () => {
    const xml = `<r><p code="A"/><p code="B"><prices><price cur="EUR">9,99</price></prices></p></r>`;
    const recs = collect(xml, "p");
    expect(recs).toEqual([
      { "@code": "A" },
      { "@code": "B", prices: { price: { "@cur": "EUR", "#text": "9,99" } } },
    ]);
  });

  it("stops cheaply when the consumer breaks early", () => {
    const xml = `<r>${"<p><a>1</a></p>".repeat(1000)}</r>`;
    let n = 0;
    for (const _ of recordsOf(xml, "p")) {
      if (++n >= 3) break;
    }
    expect(n).toBe(3);
  });

  it("counts all records when iterated fully", () => {
    const xml = `<r>${"<p><a>1</a></p>".repeat(57)}</r>`;
    expect(Array.from(recordsOf(xml, "p")).length).toBe(57);
  });
});

describe("detectXmlEncoding", () => {
  it("prefers the XML declaration over the header", () => {
    expect(
      detectXmlEncoding(`<?xml version="1.0" encoding="windows-1257"?><root>`, "text/xml; charset=utf-8"),
    ).toBe("windows-1257");
  });
  it("falls back to the content-type charset, then utf-8", () => {
    expect(detectXmlEncoding("<root>", "text/xml; charset=ISO-8859-4")).toBe("iso-8859-4");
    expect(detectXmlEncoding("<root>", "text/xml")).toBe("utf-8");
    expect(detectXmlEncoding("<root>", null)).toBe("utf-8");
  });
});

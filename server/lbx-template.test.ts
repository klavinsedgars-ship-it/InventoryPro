import { describe, it, expect } from "vitest";
import { readZip, writeZip, crc32 } from "./zip";
import {
  escapeXmlText,
  inspectLbx,
  mergeAddressIntoLbx,
  retagStringItems,
  setLabelText,
  unescapeXmlText,
} from "./lbx-template";

const ADDRESS = ["Matthias Jaksch", "Hanfgartenweg 1", "85077 Manching", "Germany"];

/** The shape P-touch writes: one text object, a data element, one run per font. */
function labelXml(text: string, extra = ""): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<pt:document xmlns:pt="http://schemas.brother.info/ptouch/2007/lbx/main" xmlns:text="http://schemas.brother.info/ptouch/2007/lbx/text">
 <pt:body currentSheet="Sheet 1">
  <text:text>
   <text:ptFontInfo><text:logFont name="Arial" weight="700"/></text:ptFontInfo>
   <pt:data>${text}</pt:data>
   <text:stringItem charLen="${text.length}"><text:ptFontInfo><text:logFont name="Arial" weight="700"/></text:ptFontInfo></text:stringItem>
  </text:text>
  ${extra}
 </pt:body>
</pt:document>`;
}

function lbx(xml: string, extras: { name: string; data: Buffer }[] = []): Buffer {
  return writeZip([
    { name: "label.xml", data: Buffer.from(xml, "utf8") },
    { name: "prop.xml", data: Buffer.from("<prop/>", "utf8") },
    ...extras,
  ]);
}

describe("zip", () => {
  it("round-trips the entries it wrote", () => {
    const out = readZip(lbx(labelXml("hello")));
    expect(out.map((e) => e.name)).toEqual(["label.xml", "prop.xml"]);
    expect(out[1].data.toString()).toBe("<prop/>");
  });

  it("refuses something that is not a ZIP", () => {
    expect(() => readZip(Buffer.from("not a zip at all"))).toThrow(/ZIP/i);
  });

  it("computes the CRC the format expects", () => {
    // The standard check value for "123456789".
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
  });

  it("stores rather than grows incompressible data", () => {
    const random = Buffer.from(
      Array.from({ length: 2048 }, (_, i) => (i * 7919) % 251),
    );
    const out = readZip(writeZip([{ name: "a.bin", data: random }]));
    expect(out[0].data.equals(random)).toBe(true);
  });
});

describe("escapeXmlText", () => {
  it("survives an address with an ampersand in it", () => {
    expect(escapeXmlText("Meyer & Sohn <GmbH>")).toBe("Meyer &amp; Sohn &lt;GmbH&gt;");
    expect(unescapeXmlText("Meyer &amp; Sohn &lt;GmbH&gt;")).toBe("Meyer & Sohn <GmbH>");
  });
});

describe("inspectLbx", () => {
  it("lists the text boxes so the right one can be chosen", () => {
    const info = inspectLbx(lbx(labelXml("Old address here", "<text:text><pt:data>Sender</pt:data></text:text>")));
    expect(info.labelXmlName).toBe("label.xml");
    expect(info.slots.map((s) => s.preview)).toEqual(["Old address here", "Sender"]);
  });

  it("says so when the file holds no text box", () => {
    expect(() => inspectLbx(lbx("<pt:document><pt:body/></pt:document>"))).toThrow(/text box/i);
  });

  it("says so when the file is not a P-touch label", () => {
    // The message names what was in the archive, which is the one thing
    // needed to work out what P-touch wrote if this ever fires for real.
    expect(() => inspectLbx(writeZip([{ name: "notes.txt", data: Buffer.from("hi") }]))).toThrow(
      /notes\.txt/,
    );
  });
});

describe("setLabelText", () => {
  it("puts the address in, one line per address line", () => {
    const out = setLabelText(labelXml("Old"), ADDRESS);
    expect(out).toContain(`<pt:data>${ADDRESS.join("\n")}</pt:data>`);
  });

  it("re-tags the run length, or P-touch opens an empty label", () => {
    const out = setLabelText(labelXml("Old"), ADDRESS);
    expect(out).toContain(`charLen="${ADDRESS.join("\n").length}"`);
    expect(out).not.toContain('charLen="3"');
  });

  it("drops the leftover runs of the text it replaced", () => {
    const xml = labelXml("Old").replace(
      "</text:text>",
      '<text:stringItem charLen="7"/><text:stringItem charLen="2"/></text:text>',
    );
    const out = setLabelText(xml, ADDRESS);
    expect(out.match(/<text:stringItem/g)).toHaveLength(1);
  });

  it("leaves the other text boxes alone", () => {
    const xml = labelXml("Old address", "<text:text><pt:data>RENTBOX SIA</pt:data></text:text>");
    const out = setLabelText(xml, ADDRESS, 0);
    expect(out).toContain("<pt:data>RENTBOX SIA</pt:data>");
  });

  it("can fill a chosen box rather than the first", () => {
    const xml = labelXml("Sender", "<text:text><pt:data>Old address</pt:data></text:text>");
    const out = setLabelText(xml, ADDRESS, 1);
    expect(out).toContain("<pt:data>Sender</pt:data>");
    expect(out).toContain(`<pt:data>${ADDRESS.join("\n")}</pt:data>`);
  });

  it("falls back to the first box when the chosen one is gone", () => {
    const out = setLabelText(labelXml("Old"), ADDRESS, 7);
    expect(out).toContain(`<pt:data>${ADDRESS.join("\n")}</pt:data>`);
  });

  it("fills an empty text box written as a self-closing element", () => {
    const xml = labelXml("x").replace("<pt:data>x</pt:data>", "<pt:data/>");
    expect(setLabelText(xml, ADDRESS)).toContain(`<pt:data>${ADDRESS.join("\n")}</pt:data>`);
  });

  it("escapes an address that would otherwise break the XML", () => {
    const out = setLabelText(labelXml("Old"), ["Meyer & Sohn", "<script>"]);
    expect(out).toContain("Meyer &amp; Sohn\n&lt;script&gt;");
  });

  it("skips blank lines the order left behind", () => {
    const out = setLabelText(labelXml("Old"), ["Name", "", "   ", "City"]);
    expect(out).toContain("<pt:data>Name\nCity</pt:data>");
  });
});

describe("retagStringItems", () => {
  it("adds charLen to a run that had none", () => {
    expect(retagStringItems("<text:stringItem/>", 12)).toBe('<text:stringItem charLen="12"/>');
  });

  it("does nothing to a template without runs", () => {
    expect(retagStringItems("<text:textAlign/>", 12)).toBe("<text:textAlign/>");
  });
});

describe("mergeAddressIntoLbx", () => {
  it("returns a file P-touch can still open", () => {
    const merged = mergeAddressIntoLbx(lbx(labelXml("Old")), ADDRESS);
    const entries = readZip(merged);
    expect(entries.map((e) => e.name)).toEqual(["label.xml", "prop.xml"]);
    expect(entries[0].data.toString()).toContain("Hanfgartenweg 1");
  });

  it("keeps every other file in the template byte for byte", () => {
    const logo = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
    const merged = mergeAddressIntoLbx(
      lbx(labelXml("Old"), [{ name: "Object1.png", data: logo }]),
      ADDRESS,
    );
    const kept = readZip(merged).find((e) => e.name === "Object1.png");
    expect(kept?.data.equals(logo)).toBe(true);
  });

  it("can be merged again from its own output", () => {
    const once = mergeAddressIntoLbx(lbx(labelXml("Old")), ADDRESS);
    const twice = mergeAddressIntoLbx(once, ["Someone Else", "Riga"]);
    const xml = readZip(twice)[0].data.toString();
    expect(xml).toContain("<pt:data>Someone Else\nRiga</pt:data>");
    expect(xml).not.toContain("Hanfgartenweg");
    expect(xml).toContain(`charLen="${"Someone Else\nRiga".length}"`);
  });
});

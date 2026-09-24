import { readZip, writeZip } from "./zip";

/**
 * Filling the operator's own P-touch label with an order's address.
 *
 * Browser printing is not usable here: the QL-800 reads the roll's ID off the
 * spool and refuses a job whose media is not the loaded roll, and on this
 * machine only P-touch Editor drives it properly. So instead of fighting the
 * driver, the CRM edits the label the operator already prints from — the
 * template keeps its media, margins, font and layout, and only the address
 * changes.
 *
 * An .lbx is a ZIP of XML. The edit is deliberately textual rather than a full
 * parse-and-serialise: P-touch writes attributes this code knows nothing
 * about, and rewriting the whole document would be a good way to lose them.
 */

export interface LbxSlot {
  index: number;
  /** What the template currently holds there, so the right one can be picked. */
  preview: string;
}

export interface LbxInfo {
  /** Every file in the archive, for diagnostics. */
  entries: string[];
  labelXmlName: string;
  slots: LbxSlot[];
}

const DATA_RE = /<pt:data\s*\/>|<pt:data>[\s\S]*?<\/pt:data>/g;

export function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function unescapeXmlText(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&");
}

function findLabelXml(entries: { name: string; data: Buffer }[]): { name: string; xml: string } {
  const byName = entries.find((e) => e.name.toLowerCase().endsWith("label.xml"));
  const candidate =
    byName ?? entries.find((e) => e.name.toLowerCase().endsWith(".xml") && e.data.includes("<pt:data"));
  if (!candidate) {
    // Name the contents: if this ever fires on a real template, that list is
    // the one thing needed to work out what P-touch actually wrote.
    const names = entries.map((e) => e.name).join(", ") || "nothing";
    throw new Error(`No label.xml inside this file — it contains ${names}. Save it from P-touch as .lbx and try again.`);
  }
  return { name: candidate.name, xml: candidate.data.toString("utf8") };
}

function slotText(match: string): string {
  const inner = match.startsWith("<pt:data/") || match.endsWith("/>")
    ? ""
    : match.slice(match.indexOf(">") + 1, match.lastIndexOf("<"));
  return unescapeXmlText(inner);
}

export function inspectLbx(buf: Buffer): LbxInfo {
  const entries = readZip(buf);
  const { name, xml } = findLabelXml(entries);
  const slots = (xml.match(DATA_RE) ?? []).map((match, index) => ({
    index,
    preview: slotText(match).replace(/\s+/g, " ").trim().slice(0, 60),
  }));
  if (!slots.length) {
    throw new Error(
      "No text box in this label — add one in P-touch, put anything in it, save, and upload again.",
    );
  }
  return { entries: entries.map((e) => e.name), labelXmlName: name, slots };
}

/**
 * P-touch describes the runs of a text object with `text:stringItem` elements
 * whose `charLen` must add up to the text. A new address means one run in the
 * first run's font; leaving the old lengths behind is what makes P-touch open
 * the file and show nothing.
 */
export function retagStringItems(segment: string, charLen: number): string {
  const itemRe = /<text:stringItem\b[^>]*\/>|<text:stringItem\b[\s\S]*?<\/text:stringItem>/g;
  const items = segment.match(itemRe) ?? [];
  if (!items.length) return segment;

  let seen = 0;
  return segment.replace(itemRe, (match) => {
    seen += 1;
    if (seen > 1) return "";
    return /charLen="\d+"/.test(match)
      ? match.replace(/charLen="\d+"/, `charLen="${charLen}"`)
      : match.replace(/<text:stringItem\b/, `<text:stringItem charLen="${charLen}"`);
  });
}

export function setLabelText(xml: string, lines: string[], slotIndex = 0): string {
  const text = lines.map((l) => l.trim()).filter(Boolean).join("\n");
  const matches = xml.match(DATA_RE) ?? [];
  if (!matches.length) throw new Error("This label has no text box in it.");
  const target = matches[slotIndex] ?? matches[0];

  const start = xml.indexOf(target);
  const end = start + target.length;

  // Everything from the text up to the end of its own object: the string runs
  // that have to be re-tagged live there, and nowhere else.
  const objectEnd = xml.indexOf("</text:text>", end);
  const tail = objectEnd === -1 ? xml.slice(end) : xml.slice(end, objectEnd);
  const rest = objectEnd === -1 ? "" : xml.slice(objectEnd);

  return (
    xml.slice(0, start) +
    `<pt:data>${escapeXmlText(text)}</pt:data>` +
    retagStringItems(tail, text.length) +
    rest
  );
}

export function mergeAddressIntoLbx(buf: Buffer, lines: string[], slotIndex = 0): Buffer {
  const entries = readZip(buf);
  const { name } = findLabelXml(entries);
  return writeZip(
    entries.map((entry) =>
      entry.name === name
        ? { name, data: Buffer.from(setLabelText(entry.data.toString("utf8"), lines, slotIndex), "utf8") }
        : entry,
    ),
  );
}

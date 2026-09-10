/**
 * Latvijas Pasts counter receipt → per-shipment costs.
 *
 * A receipt is the only place the REAL postage lives. The tariff estimate is
 * exact for the class it assumes (it matched nine receipted small packets to
 * the cent) but it cannot know what was chosen at the counter, and the same
 * 14g item costs 3.06 as a letter or 6.29 as a small packet to Ireland. Until
 * a receipt is entered, half the postage line in the P&L is a guess about
 * postal class.
 *
 * Receipt shape (transcribed, not OCR'd — the operator types or pastes it):
 *
 *   2510 862361            1    5,16    5,16 Z
 *     Sīkpaka St ZVIEDRIJA 34g, A
 *   kl., Vienkārša-prece
 *     Uz kurieni: <street>
 *      <city> <postcode>
 *     Saņēmējs: <name>
 *   UA700460292LV
 *
 * A header line carries the money; everything after it, until the next header,
 * describes that item. Descriptions wrap mid-word across lines, so the body is
 * re-joined before anything is read out of it.
 *
 * Pure: no storage, no network.
 */

import { LATVIAN_POST_TARIFFS } from "./latvian-post";

export type ParsedPostalClass = "sikpaka" | "korespondence" | "paka" | "surcharge" | "unknown";

export interface ParsedReceiptLine {
  /**
   * Position on the receipt, from zero. THIS is the identity of a line:
   * the printed line number is not unique (a real receipt carried two lines
   * both numbered 2512), so keying anything by it silently merges shipments.
   */
  id: number;
  /** Counter line number as printed, e.g. "2510". Not unique. */
  lineNo: string;
  /** Article code, e.g. "862361". */
  articleCode: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  /** "A" = 21% VAT (services), "Z" = VAT-exempt (postage itself). */
  vatClass: string | null;
  description: string;
  postalClass: ParsedPostalClass;
  /** ISO code resolved from the Latvian destination name, when there is one. */
  countryIso: string | null;
  countryRaw: string | null;
  grams: number | null;
  tracked: boolean;
  trackingNumber: string | null;
  recipient: string | null;
  addressHint: string | null;
}

export interface ParsedReceipt {
  /** Stable-ish reference for the audit trail: date + document number. */
  reference: string | null;
  date: string | null;
  documentNo: string | null;
  /** Receipt total as printed, for reconciliation against the parsed lines. */
  printedTotal: number | null;
  /** Sum of the parsed lines — should equal printedTotal. */
  parsedTotal: number;
  shipments: ParsedReceiptLine[];
  /** Marking and tracking fees, kept separate so they can be attributed. */
  surcharges: ParsedReceiptLine[];
  /** Lines the parser could not classify, verbatim, so nothing is lost. */
  unparsed: string[];
  balanced: boolean;
}

/** Uppercase and strip diacritics, so "Vācija" and "VACIJA" compare equal. */
function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .trim();
}

/**
 * Latvian destination name → ISO code, built from the tariff table itself so
 * the two can never disagree about how a country is spelled.
 */
const COUNTRY_BY_LATVIAN_NAME: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const [iso, tariff] of Object.entries(LATVIAN_POST_TARIFFS)) {
    map[fold(tariff.name)] = iso;
  }
  // Receipt spellings the tariff book does not use.
  map["LIELBRITANIJA"] = "GB";
  map["ANGLIJA"] = "GB";
  map["ASV"] = "US";
  map["NIDERLANDE"] = "NL";
  return map;
})();

export function countryFromLatvianName(name: string | null | undefined): string | null {
  if (!name) return null;
  return COUNTRY_BY_LATVIAN_NAME[fold(name)] ?? null;
}

/** "5,16" and "5.16" are both 5.16; anything else is null. */
function parseAmount(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = parseFloat(raw.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

// A money header line: "2510 862361   1   5,16   5,16 Z"
const HEADER_RE = /^\s*(\d{3,5})\s+(\d{5,7})\s+(\d+)\s+([\d.,]+)\s+([\d.,]+)\s*([AZ])?\s*$/;

const SERVICE_PATTERNS: Array<[RegExp, ParsedPostalClass]> = [
  [/SIKPAKA/, "sikpaka"],
  [/KORESPONDENCE/, "korespondence"],
  [/\bPAKA\b/, "paka"],
  [/MARKESANA|PAPILDU PAKALPOJUMS|IZSEKOSANA/, "surcharge"],
];

function classify(descriptionFolded: string): ParsedPostalClass {
  for (const [re, cls] of SERVICE_PATTERNS) {
    if (re.test(descriptionFolded)) return cls;
  }
  return "unknown";
}

/**
 * Parse a transcribed receipt. Never throws: anything unrecognised is returned
 * in `unparsed` rather than dropped, because a silently-swallowed line is a
 * shipment whose cost never reaches the P&L.
 */
export function parsePostageReceipt(text: string): ParsedReceipt {
  const rawLines = (text ?? "").split(/\r?\n/);

  // Group into blocks: a header line plus the description lines that follow.
  const blocks: Array<{ header: RegExpMatchArray; body: string[] }> = [];
  const preamble: string[] = [];
  for (const line of rawLines) {
    const m = line.match(HEADER_RE);
    if (m) {
      blocks.push({ header: m, body: [] });
    } else if (blocks.length > 0) {
      blocks[blocks.length - 1].body.push(line);
    } else {
      preamble.push(line);
    }
  }

  const shipments: ParsedReceiptLine[] = [];
  const surcharges: ParsedReceiptLine[] = [];
  const unparsed: string[] = [];

  for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
    const { header, body } = blocks[blockIndex];
    // Descriptions wrap mid-word ("A\nkl., Vienkārša"), so rejoin first and
    // read fields out of the whole thing.
    const joined = body.join(" ").replace(/\s+/g, " ").trim();
    const folded = fold(joined);
    const amount = parseAmount(header[5]) ?? 0;

    // Stop the description at the address, which is not part of the service
    // name and which we do not want to keep verbatim.
    const description = joined.split(/Uz kurieni:|Saņēmējs:/i)[0].trim();

    const trackingMatch = joined.match(/\b([A-Z]{2}\d{9}[A-Z]{2})\b/);
    const recipientMatch = joined.match(/Saņēmējs:\s*([^]*?)(?:\s+[A-Z]{2}\d{9}[A-Z]{2}|$)/i);
    const addressMatch = joined.match(/Uz kurieni:\s*([^]*?)(?:\s*Saņēmējs:|$)/i);
    const gramsMatch = folded.match(/(\d+)\s*G\b/);
    const countryMatch = description.match(
      /(?:Sīkpaka|Korespondence|Paka)\s+\w+\s+([A-ZĀČĒĢĪĶĻŅŠŪŽa-zāčēģīķļņšūž]+)/,
    );

    const postalClass = classify(folded);
    const line: ParsedReceiptLine = {
      id: blockIndex,
      lineNo: header[1],
      articleCode: header[2],
      quantity: parseInt(header[3], 10) || 1,
      unitPrice: parseAmount(header[4]) ?? amount,
      amount,
      vatClass: header[6] ?? null,
      description,
      postalClass,
      countryRaw: countryMatch ? countryMatch[1] : null,
      countryIso: countryMatch ? countryFromLatvianName(countryMatch[1]) : null,
      grams: gramsMatch ? parseInt(gramsMatch[1], 10) : null,
      // "Izsekojama" = trackable; "Vienkārša" = ordinary. A barcode on the
      // line is itself evidence of a trackable item.
      tracked: /IZSEKOJAMA/.test(folded) || !!trackingMatch,
      trackingNumber: trackingMatch ? trackingMatch[1] : null,
      recipient: recipientMatch ? recipientMatch[1].trim() || null : null,
      addressHint: addressMatch ? addressMatch[1].trim().slice(0, 120) || null : null,
    };

    if (postalClass === "surcharge") surcharges.push(line);
    else if (postalClass === "unknown") unparsed.push(`${header[0].trim()} ${description}`.trim());
    else shipments.push(line);
  }

  // A domestic item names no country: "Sīkpaka L 54g" has no destination.
  for (const s of shipments) {
    if (!s.countryIso && /\bL\b/.test(fold(s.description).replace(/[^A-Z0-9 ]/g, " "))) {
      s.countryIso = "LV";
      s.countryRaw = s.countryRaw ?? "Latvija";
    }
  }

  const all = [...shipments, ...surcharges];
  const parsedTotal = round2(all.reduce((sum, l) => sum + l.amount, 0));

  const head = preamble.join("\n");
  const totalMatch = head.match(/KOP[ĀA]\s+([\d.,]+)/i) ?? (text ?? "").match(/KOP[ĀA]\s+([\d.,]+)/i);
  const printedTotal = parseAmount(totalMatch?.[1]);
  const dateMatch = (text ?? "").match(/(\d{4}-\d{2}-\d{2})/);
  const docMatch = (text ?? "").match(/DOK\.?\s*NR\.?\s*[:.]?\s*(\d+)/i);

  return {
    reference: dateMatch || docMatch ? [dateMatch?.[1], docMatch?.[1]].filter(Boolean).join("/") : null,
    date: dateMatch?.[1] ?? null,
    documentNo: docMatch?.[1] ?? null,
    printedTotal,
    parsedTotal,
    shipments,
    surcharges,
    unparsed: unparsed.filter((u) => u.length > 0),
    // If these disagree, a line was missed and the operator must be told
    // rather than shown a confident-looking half-answer.
    balanced: printedTotal == null || Math.abs(printedTotal - parsedTotal) < 0.02,
  };
}

/**
 * Attribute surcharges to shipments.
 *
 * Cross-border tracking (2.54) and item marking (0.06) are billed as their own
 * counter lines, so the headline price of a shipment understates it. Marking
 * accompanies letters and tracking accompanies whichever item was sent
 * trackable — attributing by proximity in line order is what the receipt
 * layout itself implies.
 */
export function attributeSurcharges(receipt: ParsedReceipt): Map<number, number> {
  const extras = new Map<number, number>();
  // Receipt ORDER, not the printed line number, is what proximity means here.
  const inOrder = [...receipt.shipments].sort((a, b) => a.id - b.id);

  for (const s of receipt.surcharges) {
    const folded = fold(s.description);
    const candidates = /IZSEKOSANA/.test(folded)
      ? inOrder.filter((l) => l.tracked)
      : inOrder.filter((l) => l.postalClass === "korespondence");
    const pool = candidates.length > 0 ? candidates : inOrder;
    if (pool.length === 0) continue;

    // Nearest preceding shipment of the right kind that has not already been
    // charged this surcharge, else the nearest one that follows. Marking is
    // billed once per letter, so two letters must not both bill to the first.
    const unused = pool.filter((l) => !extras.has(l.id));
    const searchIn = unused.length > 0 ? unused : pool;
    const before = searchIn.filter((l) => l.id < s.id).pop();
    const target = before ?? searchIn[0];
    extras.set(target.id, round2((extras.get(target.id) ?? 0) + s.amount));
  }
  return extras;
}

/** Total cost of a shipment including anything billed alongside it. */
export function shipmentTotalCost(line: ParsedReceiptLine, extras: Map<number, number>): number {
  return round2(line.amount + (extras.get(line.id) ?? 0));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

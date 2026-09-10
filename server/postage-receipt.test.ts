import { describe, it, expect } from "vitest";
import {
  parsePostageReceipt,
  attributeSurcharges,
  shipmentTotalCost,
  countryFromLatvianName,
} from "@shared/postage-receipt";

/*
 * Fixtures reproduce the LAYOUT of two real Latvijas Pasts receipts
 * (2026-09-08 and 2026-09-09) with their real services, destinations, weights
 * and prices — the things the parser has to get right. Recipient names and
 * street addresses are replaced with placeholders: customer personal data does
 * not belong in a repository.
 */

const RECEIPT_A = `
VAS "Latvijas Pasts"
ČEKS
NOSAUKUMS        DAUDZ  CENA  SUMMA
2512 893001            1   3,00   3,00 Z
  Korespondence St ĪRIJA 14g, A
kl., Vienkārša
2520 440003            1   0,06   0,06 A
  Pasta sūtījuma marķēšana
2515 893002            1   3,85   3,85 Z
  Korespondence St AUSTRIJA 79g,
A kl., Vienkārša
2523 440003            1   0,06   0,06 A
  Pasta sūtījuma marķēšana
2510 862361            1   5,16   5,16 Z
  Sīkpaka St ZVIEDRIJA 34g, A
kl., Vienkārša-prece
  Uz kurieni: STREET 145
   CITY 83296
  Saņēmējs: RECIPIENT ONE
UA700460292LV
2512 860036            1   4,13   4,13 Z
  Sīkpaka St RUMĀNIJA 77g, A
kl., Vienkārša-prece
  Uz kurieni: STREET 248A
   CITY 407270
  Saņēmējs: RECIPIENT TWO
UA700460315LV
KOPĀ                        16,26 EUR
2026-09-08 09:28  DOK.NR: 0093061
`;

const RECEIPT_B = `
VAS "Latvijas Pasts"
ČEKS
2526 755001            1   3,56   3,56 Z
  Sīkpaka L 54g, A kl.,
Vienkārša-prece
  Uz kurieni: STREET 2 - 24, CITY,
LV-3011
  Saņēmējs: RECIPIENT THREE
UA003763435LV
2527 861881            1   5,08   5,08 Z
  Sīkpaka St VĀCIJA 73g, A kl.,
Izsekojama
  Uz kurieni: STREET 23
   CITY 63110
  Saņēmējs: RECIPIENT FOUR GMBH
LS700993478LV
2536 440015            1   2,54   2,54 A
  Papildu pakalpojums
izsekošana, pārrobežu
KOPĀ                        11,18 EUR
2026-09-09 16:15  DOK.NR: 0093198
`;

describe("countryFromLatvianName", () => {
  it("resolves receipt spellings, uppercase and diacritics included", () => {
    expect(countryFromLatvianName("VĀCIJA")).toBe("DE");
    expect(countryFromLatvianName("ZVIEDRIJA")).toBe("SE");
    expect(countryFromLatvianName("RUMĀNIJA")).toBe("RO");
    expect(countryFromLatvianName("ĪRIJA")).toBe("IE");
    expect(countryFromLatvianName("Austrija")).toBe("AT");
    expect(countryFromLatvianName("VACIJA")).toBe("DE"); // diacritics dropped
  });

  it("returns null rather than guessing at an unknown name", () => {
    expect(countryFromLatvianName("NEKUR")).toBeNull();
    expect(countryFromLatvianName(null)).toBeNull();
  });
});

describe("parsePostageReceipt", () => {
  const a = parsePostageReceipt(RECEIPT_A);
  const b = parsePostageReceipt(RECEIPT_B);

  it("separates shipments from surcharge lines", () => {
    expect(a.shipments).toHaveLength(4);
    expect(a.surcharges).toHaveLength(2); // two marking fees
    expect(b.shipments).toHaveLength(2);
    expect(b.surcharges).toHaveLength(1); // cross-border tracking
  });

  it("reads service, destination, weight and price off each shipment", () => {
    const sweden = a.shipments.find((s) => s.countryIso === "SE")!;
    expect(sweden.postalClass).toBe("sikpaka");
    expect(sweden.grams).toBe(34);
    expect(sweden.amount).toBe(5.16);
    expect(sweden.trackingNumber).toBe("UA700460292LV");

    const ireland = a.shipments.find((s) => s.countryIso === "IE")!;
    expect(ireland.postalClass).toBe("korespondence");
    expect(ireland.grams).toBe(14);
    expect(ireland.amount).toBe(3.0);
    expect(ireland.trackingNumber).toBeNull(); // letters carry no barcode
  });

  it("survives descriptions that wrap mid-phrase across lines", () => {
    // "Korespondence St AUSTRIJA 79g,\nA kl., Vienkārša"
    const austria = a.shipments.find((s) => s.countryIso === "AT")!;
    expect(austria.grams).toBe(79);
    expect(austria.amount).toBe(3.85);
  });

  it("treats a domestic Sīkpaka L, which names no country, as Latvia", () => {
    const domestic = b.shipments.find((s) => s.grams === 54)!;
    expect(domestic.countryIso).toBe("LV");
    expect(domestic.amount).toBe(3.56);
  });

  it("marks a trackable item as tracked", () => {
    const tracked = b.shipments.find((s) => s.grams === 73)!;
    expect(tracked.tracked).toBe(true);
    expect(tracked.trackingNumber).toBe("LS700993478LV");
  });

  it("captures the recipient for matching but keeps the address only as a hint", () => {
    const sweden = a.shipments.find((s) => s.countryIso === "SE")!;
    expect(sweden.recipient).toBe("RECIPIENT ONE");
    expect(sweden.description).not.toContain("STREET");
  });

  it("reconciles the parsed lines against the printed total", () => {
    expect(a.printedTotal).toBe(16.26);
    expect(a.parsedTotal).toBe(16.26);
    expect(a.balanced).toBe(true);
    expect(b.printedTotal).toBe(11.18);
    expect(b.parsedTotal).toBe(11.18);
    expect(b.balanced).toBe(true);
  });

  it("reports an imbalance rather than a confident half-answer", () => {
    const broken = parsePostageReceipt(RECEIPT_A.replace("KOPĀ                        16,26", "KOPĀ  99,99"));
    expect(broken.balanced).toBe(false);
  });

  it("extracts a receipt reference for the audit trail", () => {
    expect(a.date).toBe("2026-09-08");
    expect(a.documentNo).toBe("0093061");
    expect(a.reference).toBe("2026-09-08/0093061");
  });

  it("returns empty structures for junk instead of throwing", () => {
    const empty = parsePostageReceipt("not a receipt at all");
    expect(empty.shipments).toEqual([]);
    expect(empty.parsedTotal).toBe(0);
  });
});

describe("attributeSurcharges", () => {
  it("attaches the tracking fee to the trackable shipment", () => {
    const b = parsePostageReceipt(RECEIPT_B);
    const extras = attributeSurcharges(b);
    const tracked = b.shipments.find((s) => s.grams === 73)!;
    const domestic = b.shipments.find((s) => s.grams === 54)!;
    expect(extras.get(tracked.id)).toBe(2.54);
    expect(extras.get(domestic.id)).toBeUndefined();
    // 5.08 sīkpaka + 2.54 tracking is what that parcel really cost.
    expect(shipmentTotalCost(tracked, extras)).toBe(7.62);
  });

  it("attaches marking fees to the letters they accompany", () => {
    const a = parsePostageReceipt(RECEIPT_A);
    const extras = attributeSurcharges(a);
    const letters = a.shipments.filter((s) => s.postalClass === "korespondence");
    for (const l of letters) expect(extras.get(l.id)).toBe(0.06);
    const ireland = letters.find((s) => s.countryIso === "IE")!;
    expect(shipmentTotalCost(ireland, extras)).toBe(3.06);
  });

  it("never loses money: attributed extras equal the surcharges billed", () => {
    for (const text of [RECEIPT_A, RECEIPT_B]) {
      const r = parsePostageReceipt(text);
      const extras = attributeSurcharges(r);
      const attributed = [...extras.values()].reduce((s, v) => s + v, 0);
      const billed = r.surcharges.reduce((s, l) => s + l.amount, 0);
      expect(attributed).toBeCloseTo(billed, 2);
    }
  });

  it("shipment totals plus nothing else reconstruct the receipt total", () => {
    const r = parsePostageReceipt(RECEIPT_A);
    const extras = attributeSurcharges(r);
    const sum = r.shipments.reduce((s, l) => s + shipmentTotalCost(l, extras), 0);
    expect(sum).toBeCloseTo(r.printedTotal!, 2);
  });
});

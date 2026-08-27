/**
 * ISO 3166-1 alpha-2 -> full English country name.
 *
 * Carriers and customs want a country a human can read: "DE" on a parcel
 * leaving Latvia is an invitation for it to be mis-sorted, and postal
 * convention is the destination country's name spelled out. eBay gives us the
 * two-letter code, so the expansion has to happen here.
 *
 * Shared between client and server so a label, an address block and anything
 * printed later cannot disagree about the destination.
 */
const COUNTRY_NAMES: Record<string, string> = {
  AT: "Austria", BE: "Belgium", BG: "Bulgaria", CH: "Switzerland", CY: "Cyprus",
  CZ: "Czech Republic", DE: "Germany", DK: "Denmark", EE: "Estonia", ES: "Spain",
  FI: "Finland", FR: "France", GB: "United Kingdom", GR: "Greece", HR: "Croatia",
  HU: "Hungary", IE: "Ireland", IS: "Iceland", IT: "Italy", LI: "Liechtenstein",
  LT: "Lithuania", LU: "Luxembourg", LV: "Latvia", MT: "Malta", NL: "Netherlands",
  NO: "Norway", PL: "Poland", PT: "Portugal", RO: "Romania", SE: "Sweden",
  SI: "Slovenia", SK: "Slovakia",
  AU: "Australia", CA: "Canada", JP: "Japan", NZ: "New Zealand", US: "United States",
  BR: "Brazil", CN: "China", HK: "Hong Kong", IL: "Israel", IN: "India",
  KR: "South Korea", MX: "Mexico", RS: "Serbia", SG: "Singapore", TR: "Turkey",
  UA: "Ukraine", ZA: "South Africa", AE: "United Arab Emirates",
};

/**
 * Full country name for a code. Anything unrecognised is returned unchanged:
 * a code on the label is poor, but inventing a country name would be worse,
 * and an already-spelled-out name must pass through untouched.
 */
export function countryName(code: string | null | undefined): string {
  const raw = (code ?? "").trim();
  if (!raw) return "";
  if (raw.length !== 2) return raw; // already a name, or something we shouldn't touch
  return COUNTRY_NAMES[raw.toUpperCase()] ?? raw.toUpperCase();
}

/**
 * Address lines for a shipping label, in postal order, with the destination
 * country spelled out and the phone included — carriers require a contact
 * number for most international services, and it was simply missing.
 */
export function labelAddressLines(order: {
  shippingName?: string | null;
  shippingAddressLine1?: string | null;
  shippingAddressLine2?: string | null;
  shippingCity?: string | null;
  shippingStateOrProvince?: string | null;
  shippingPostalCode?: string | null;
  shippingCountry?: string | null;
  shippingPhone?: string | null;
}): string[] {
  const lines: string[] = [];
  const push = (v?: string | null) => { const s = (v ?? "").trim(); if (s) lines.push(s); };

  push(order.shippingName);
  push(order.shippingAddressLine1);
  push(order.shippingAddressLine2);
  // Postcode before city is the convention across most of Europe, including
  // Germany, which is where these parcels are going.
  const cityLine = [order.shippingPostalCode, order.shippingCity].map((s) => (s ?? "").trim()).filter(Boolean).join(" ");
  if (cityLine) lines.push(cityLine);
  push(order.shippingStateOrProvince);
  push(countryName(order.shippingCountry));
  if ((order.shippingPhone ?? "").trim()) lines.push(`Tel: ${order.shippingPhone!.trim()}`);
  return lines;
}

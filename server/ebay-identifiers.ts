/**
 * eBay product identifiers (GTIN/EAN, and the "no identifier" escape value).
 *
 * Pure: no storage, no network, no eBay client — so it is testable without a
 * database, and so the publish path's identifier rules live in one place.
 */

/**
 * The value eBay accepts for a product identifier that genuinely does not
 * exist. It is localised per marketplace and eBay rejects the wrong language,
 * so it must follow the marketplace rather than be hardcoded German.
 */
export function noIdentifierValue(siteId?: string): string {
  const map: Record<string, string> = {
    "0": "Does not apply", "3": "Does not apply", "77": "Nicht zutreffend",
    "71": "Non applicable", "101": "Non applicabile", "186": "No aplicable",
  };
  return map[siteId || process.env.EBAY_MARKETPLACE_SITE_ID || "77"] || "Nicht zutreffend";
}

/**
 * A GTIN eBay will accept, or null when the supplier value is unusable.
 *
 * eBay validates length AND the mod-10 check digit, and rejects the entire
 * publish when either is wrong. A malformed supplier value must therefore
 * degrade to "no EAN" — forwarding it as-is trades a missing-identifier
 * failure for an invalid-identifier failure.
 */
export function normalizeEan(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (![8, 12, 13, 14].includes(digits.length)) return null;
  if (/^0+$/.test(digits)) return null;
  const body = digits.slice(0, -1);
  const check = Number(digits.slice(-1));
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const d = Number(body[body.length - 1 - i]);
    sum += i % 2 === 0 ? d * 3 : d;
  }
  if ((10 - (sum % 10)) % 10 !== check) return null;
  return digits;
}

/**
 * What to put in the inventory item's `ean` field: the real GTIN when the
 * supplier gave us a valid one, otherwise eBay's localised "no identifier"
 * value. Never an empty array — omitting the field is not the same as
 * declaring the product has no EAN, and eBay treats it as missing.
 */
export function eanForListing(raw: string | null | undefined, siteId?: string): string[] {
  return [normalizeEan(raw) ?? noIdentifierValue(siteId)];
}

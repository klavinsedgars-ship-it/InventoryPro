/**
 * VAT rates for B2C distance selling inside the EU.
 *
 * The rate that applies is the BUYER's country rate, not ours. Since the 2021
 * OSS rules, a Latvian seller shipping to a private customer in Germany owes
 * German VAT at 19% — not Latvian VAT at 21%. Using one fixed home rate makes
 * every cross-border margin wrong, and in the wrong direction depending on
 * where the buyer happens to live.
 *
 * Rates are the STANDARD rate per country. Reduced rates exist (books, food,
 * some equipment) but do not apply to electronic components, so a single
 * standard rate per country is correct for this catalogue and wrong to
 * generalise beyond it.
 *
 * These change by legislation, rarely but really. VAT_RATE_OVERRIDES lets a
 * rate be corrected without a deploy: "DE:19,FR:20".
 */

export const EU_STANDARD_VAT: Record<string, number> = {
  AT: 20, BE: 21, BG: 20, CY: 19, CZ: 21, DE: 19, DK: 25, EE: 22, ES: 21,
  FI: 25.5, FR: 20, GR: 24, HR: 25, HU: 27, IE: 23, IT: 22, LT: 21, LU: 17,
  LV: 21, MT: 18, NL: 21, PL: 23, PT: 23, RO: 21, SE: 25, SI: 22, SK: 23,
};

/** Countries outside the EU VAT area: an export, zero-rated for us. */
export const ZERO_RATED_EXPORT = new Set([
  "GB", "CH", "NO", "US", "CA", "AU", "NZ", "JP", "SG", "HK", "AE", "IL",
  "TR", "UA", "RS", "BR", "IN", "CN", "KR", "MX", "ZA",
]);

export interface VatDecision {
  /** Percentage, e.g. 19. Zero for exports. */
  ratePct: number;
  country: string;
  basis: "eu_destination" | "export_zero_rated" | "home_fallback" | "override";
  note: string;
}

function parseOverrides(raw: string | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const pair of (raw ?? "").split(",")) {
    const [c, v] = pair.split(":").map((s) => s?.trim());
    const n = Number(v);
    if (c && c.length === 2 && Number.isFinite(n) && n >= 0 && n <= 100) out[c.toUpperCase()] = n;
  }
  return out;
}

/**
 * The VAT rate to apply to a sale, given where it shipped.
 *
 * `homeCountry` is the fallback for an unknown destination — under-charging
 * ourselves in a report is safer than inventing a zero rate and reporting
 * profit that is really the taxman's.
 */
export function vatForSale(
  destinationCountry: string | null | undefined,
  opts: { homeCountry?: string; overrides?: string } = {},
): VatDecision {
  const country = (destinationCountry ?? "").trim().toUpperCase();
  const home = (opts.homeCountry ?? process.env.SELLER_COUNTRY ?? "LV").toUpperCase();
  const overrides = parseOverrides(opts.overrides ?? process.env.VAT_RATE_OVERRIDES);

  if (country && overrides[country] !== undefined) {
    return { ratePct: overrides[country], country, basis: "override", note: `Rate overridden for ${country}` };
  }
  if (country && EU_STANDARD_VAT[country] !== undefined) {
    return {
      ratePct: EU_STANDARD_VAT[country],
      country,
      basis: "eu_destination",
      note: `EU distance selling: ${country} standard rate applies (OSS)`,
    };
  }
  if (country && ZERO_RATED_EXPORT.has(country)) {
    return {
      ratePct: 0,
      country,
      basis: "export_zero_rated",
      note: `Export outside the EU VAT area — zero-rated`,
    };
  }
  const fallback = EU_STANDARD_VAT[home] ?? 21;
  return {
    ratePct: fallback,
    country: country || home,
    basis: "home_fallback",
    note: country
      ? `Unknown destination "${country}" — assuming home rate (${home}); verify before filing`
      : `No destination country on the order — assuming home rate (${home})`,
  };
}

/**
 * VAT contained in a VAT-INCLUSIVE amount. Marketplace prices are what the
 * buyer pays, so the tax is extracted from the total rather than added to it —
 * confusing the two overstates revenue by the full rate.
 */
export function vatFromGross(gross: number, ratePct: number): number {
  if (!(gross > 0) || !(ratePct > 0)) return 0;
  return (gross * ratePct) / (100 + ratePct);
}

/** The ex-VAT amount of a VAT-inclusive total. */
export function netFromGross(gross: number, ratePct: number): number {
  return (gross || 0) - vatFromGross(gross, ratePct);
}

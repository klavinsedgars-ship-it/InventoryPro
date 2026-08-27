/**
 * Latvijas Pasts tariffs, from the published tariff book (SPRK decision
 * No. 117, 27.11.2025).
 *
 * Postage was the last real cost missing from the profit model: every margin
 * figure was overstated by whatever the parcel cost to send. These are the
 * actual rates, not an assumption.
 *
 * Services, in the order they matter to us:
 *   Sīkpaka   - letter-post with goods, up to 2 kg. Nearly every order we ship
 *               is a handful of components, so this is the normal case.
 *   Paka      - parcel, for anything above 2 kg.
 *
 * Tracked ("Standard") is economy plus a flat EUR 2.54 tracking fee - a rule
 * stated in the tariff book and one that holds exactly across all 240
 * countries in it, which is also how this table was verified after extraction.
 * eBay expects tracking, so tracked is the default.
 *
 * VAT: postal services are exempt, except the tracking fee and parcels over
 * 10 kg (21% to EU destinations, 0% outside). The published tariffs already
 * include it, so these figures are what we actually pay - and there is no
 * input VAT to reclaim on them.
 *
 * Pure: no storage, no network.
 */

/** Upper bound of each weight band, in grams. */
export const SIKPAKA_BANDS_G = [20, 100, 500, 1000, 2000] as const;

/** Flat fee that turns an untracked item into a tracked one. */
export const TRACKING_FEE = 2.54;

/** Discount for booking through manspasts.lv, on tracked/registered items. */
export const MANS_PASTS_DISCOUNT = 0.46;

export interface CountryTariff {
  name: string;
  /** Sīkpaka, untracked, by weight band. */
  economy: number[];
  /** Sīkpaka, tracked. */
  tracked: number[];
  /** Parcel: [first 1 kg, each additional kg] — null where not offered. */
  parcel: [number, number] | null;
}

export const LATVIAN_POST_TARIFFS: Record<string, CountryTariff> = {
  AT: { name: "Austrija", economy: [5.41, 5.42, 6.18, 7.7, 8.37], tracked: [7.95, 7.96, 8.72, 10.24, 10.91], parcel: [13.45, 1.67] },
  BE: { name: "Beļģija", economy: [4.44, 4.55, 6.07, 9.03, 11.69], tracked: [6.98, 7.09, 8.61, 11.57, 14.23], parcel: [18.42, 1.85] },
  BG: { name: "Bulgārija", economy: [4.04, 4.13, 5.43, 7.99, 10.09], tracked: [6.58, 6.67, 7.97, 10.53, 12.63], parcel: [11.79, 2.08] },
  CY: { name: "Kipra", economy: [4.06, 4.2, 5.9, 9.23, 12.37], tracked: [6.6, 6.74, 8.44, 11.77, 14.91], parcel: [14.55, 3.52] },
  CZ: { name: "Čehija", economy: [4.06, 4.14, 5.34, 7.71, 9.55], tracked: [6.6, 6.68, 7.88, 10.25, 12.09], parcel: [12.63, 1.67] },
  DE: { name: "Vācija", economy: [5.03, 5.08, 6.12, 8.16, 9.55], tracked: [7.57, 7.62, 8.66, 10.7, 12.09], parcel: [17.89, 2.37] },
  DK: { name: "Dānija", economy: [5.35, 5.39, 6.34, 8.24, 9.43], tracked: [7.89, 7.93, 8.88, 10.78, 11.97], parcel: [19.18, 1.86] },
  EE: { name: "Igaunija", economy: [4.6, 4.72, 6.3, 9.39, 12.2], tracked: [7.14, 7.26, 8.84, 11.93, 14.74], parcel: [12.34, 1.84] },
  ES: { name: "Spānija", economy: [4.38, 4.48, 5.89, 8.66, 11.03], tracked: [6.92, 7.02, 8.43, 11.2, 13.57], parcel: [15.95, 2.1] },
  FI: { name: "Somija", economy: [5.56, 5.62, 6.7, 8.85, 10.37], tracked: [8.1, 8.16, 9.24, 11.39, 12.91], parcel: [14.81, 1.95] },
  FR: { name: "Francija", economy: [5.01, 5.1, 6.38, 8.92, 10.97], tracked: [7.55, 7.64, 8.92, 11.46, 13.51], parcel: [14.45, 2.68] },
  GR: { name: "Grieķija", economy: [4.28, 4.42, 6.15, 9.52, 12.73], tracked: [6.82, 6.96, 8.69, 12.06, 15.27], parcel: [13.89, 2.31] },
  HR: { name: "Horvātija", economy: [4.32, 4.42, 5.8, 8.53, 10.85], tracked: [6.86, 6.96, 8.34, 11.07, 13.39], parcel: [13.15, 1.6] },
  HU: { name: "Ungārija", economy: [4.18, 4.27, 5.58, 8.16, 10.29], tracked: [6.72, 6.81, 8.12, 10.7, 12.83], parcel: [14.95, 1.93] },
  IE: { name: "Īrija", economy: [6.29, 6.37, 7.67, 10.21, 12.28], tracked: [8.83, 8.91, 10.21, 12.75, 14.82], parcel: [15.03, 2.26] },
  IS: { name: "Islande", economy: [6.06, 6.1, 7.07, 8.99, 10.21], tracked: [8.6, 8.64, 9.61, 11.53, 12.75], parcel: [25.33, 5.08] },
  IT: { name: "Itālija", economy: [5.82, 5.85, 6.78, 8.63, 9.74], tracked: [8.36, 8.39, 9.32, 11.17, 12.28], parcel: [15.23, 1.89] },
  LI: { name: "Lihtenšteina", economy: [4.62, 4.82, 6.93, 11.04, 15.26], tracked: [7.16, 7.36, 9.47, 13.58, 17.8], parcel: [23.31, 5.65] },
  LT: { name: "Lietuva", economy: [4.07, 4.17, 5.62, 8.47, 10.96], tracked: [6.61, 6.71, 8.16, 11.01, 13.5], parcel: [13.08, 2.05] },
  LU: { name: "Luksemburga", economy: [5.13, 5.17, 6.12, 8.0, 9.16], tracked: [7.67, 7.71, 8.66, 10.54, 11.7], parcel: [14.77, 1.95] },
  MT: { name: "Malta", economy: [4.18, 4.33, 6.05, 9.41, 12.6], tracked: [6.72, 6.87, 8.59, 11.95, 15.14], parcel: [17.77, 3.42] },
  NL: { name: "Nīderlande", economy: [4.57, 4.68, 6.16, 9.07, 11.63], tracked: [7.11, 7.22, 8.7, 11.61, 14.17], parcel: [14.74, 1.71] },
  NO: { name: "Norvēģija", economy: [5.28, 5.34, 6.39, 8.49, 9.94], tracked: [7.82, 7.88, 8.93, 11.03, 12.48], parcel: [20.25, 2.3] },
  PL: { name: "Polija", economy: [4.2, 4.35, 6.1, 9.52, 12.8], tracked: [6.74, 6.89, 8.64, 12.06, 15.34], parcel: [12.82, 2.47] },
  PT: { name: "Portugāle", economy: [4.55, 4.68, 6.27, 9.38, 12.24], tracked: [7.09, 7.22, 8.81, 11.92, 14.78], parcel: [17.4, 2.05] },
  RO: { name: "Rumānija", economy: [4.04, 4.13, 5.41, 7.95, 10.02], tracked: [6.58, 6.67, 7.95, 10.49, 12.56], parcel: [18.17, 3.04] },
  SE: { name: "Zviedrija", economy: [5.09, 5.16, 6.36, 8.73, 10.55], tracked: [7.63, 7.7, 8.9, 11.27, 13.09], parcel: [14.36, 1.84] },
  SI: { name: "Slovēnija", economy: [4.41, 4.53, 6.05, 9.03, 11.7], tracked: [6.95, 7.07, 8.59, 11.57, 14.24], parcel: [11.14, 1.89] },
  SK: { name: "Slovākija", economy: [4.09, 4.18, 5.5, 8.09, 10.22], tracked: [6.63, 6.72, 8.04, 10.63, 12.76], parcel: [11.57, 1.88] },
};

/**
 * Rates for a destination we have no row for. Deliberately the most expensive
 * EEA rates in the table rather than an average: under-estimating postage
 * silently inflates profit, which is the failure mode this whole table exists
 * to remove.
 */
export const FALLBACK_TARIFF: CountryTariff = {
  name: "(unlisted destination)",
  economy: [6.29, 6.37, 7.67, 10.21, 12.28],
  tracked: [8.83, 8.91, 10.21, 12.75, 14.82],
  parcel: [18.42, 3.52],
};

export interface PostageQuote {
  cost: number;
  service: "sikpaka" | "paka";
  tracked: boolean;
  bandLabel: string;
  country: string;
  estimated: boolean;
  note?: string;
}

/**
 * What it costs us to send `grams` to `country`.
 *
 * Weight is billed in bands, so the cost jumps at 20g, 100g, 500g, 1kg and
 * 2kg. Above 2 kg it becomes a parcel, priced per kilo.
 */
export function quotePostage(
  grams: number,
  country: string | null | undefined,
  opts: { tracked?: boolean; mansPastsDiscount?: boolean } = {},
): PostageQuote {
  const iso = (country ?? "").trim().toUpperCase();
  const tariff = LATVIAN_POST_TARIFFS[iso];
  const t = tariff ?? FALLBACK_TARIFF;
  const tracked = opts.tracked !== false;
  const discount = opts.mansPastsDiscount === true && tracked ? MANS_PASTS_DISCOUNT : 0;
  // A missing or nonsensical weight must not price as free.
  const w = Number.isFinite(grams) && grams > 0 ? grams : 1;

  if (w <= 2000) {
    const table = tracked ? t.tracked : t.economy;
    const idx = SIKPAKA_BANDS_G.findIndex((b) => w <= b);
    const band = idx === -1 ? table.length - 1 : idx;
    const lower = band === 0 ? 0 : SIKPAKA_BANDS_G[band - 1];
    return {
      cost: round2(Math.max(0, table[band] - discount)),
      service: "sikpaka",
      tracked,
      bandLabel: `${lower}-${SIKPAKA_BANDS_G[band]}g`,
      country: iso || "??",
      estimated: !tariff,
      note: tariff ? undefined : `No tariff for "${iso}" — using the highest EEA rate`,
    };
  }

  const parcel = t.parcel ?? FALLBACK_TARIFF.parcel!;
  const extraKg = Math.ceil((w - 1000) / 1000);
  return {
    cost: round2(Math.max(0, parcel[0] + extraKg * parcel[1] - discount)),
    service: "paka",
    tracked: true,
    bandLabel: `${(w / 1000).toFixed(2)}kg parcel`,
    country: iso || "??",
    estimated: !tariff,
    note: tariff ? undefined : `No tariff for "${iso}" — using the highest EEA rate`,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

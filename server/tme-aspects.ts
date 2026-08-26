/**
 * Match TME technical parameters onto eBay item specifics (aspects).
 *
 * eBay ranks listings with complete, valid item specifics noticeably better,
 * and TME v2's /products/parameters returns exactly that data structured —
 * "Operating voltage: 230V AC", "Tolerance: 5%" — instead of the free-text
 * description our aspect builder previously had to parse.
 *
 * Pure and DB-free so the matching rules can be unit-tested.
 */

export interface TmeParameter { name: string; value: string }

/** Normalise a label for comparison: case, punctuation and spacing-insensitive. */
function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[.:_/\\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Known equivalences between eBay aspect names and TME parameter names,
 * including the German aspect labels eBay.de uses. Only unambiguous pairs
 * belong here — a wrong item specific is worse than a missing one.
 */
const SYNONYMS: Record<string, string[]> = {
  "marke": ["manufacturer", "hersteller", "producer"],
  "brand": ["manufacturer", "hersteller", "producer"],
  "herstellernummer": ["manufacturer symbol", "mpn", "herstellernummer"],
  "mpn": ["manufacturer symbol", "herstellernummer"],
  "betriebsspannung": ["operating voltage", "supply voltage", "voltage"],
  "spannung": ["operating voltage", "supply voltage", "voltage"],
  "voltage": ["operating voltage", "supply voltage"],
  "nennstrom": ["rated current", "current"],
  "strom": ["rated current", "current"],
  "current": ["rated current"],
  "leistung": ["power", "power dissipation"],
  "power": ["power dissipation"],
  "kapazitaet": ["capacitance"],
  "kapazität": ["capacitance"],
  "widerstand": ["resistance"],
  "resistance": ["resistance"],
  "toleranz": ["tolerance"],
  "gehaeuse": ["case", "housing", "package"],
  "gehäuse": ["case", "housing", "package"],
  "bauform": ["case", "package", "housing"],
  "farbe": ["colour", "color"],
  "material": ["material"],
  "betriebstemperatur": ["operating temperature"],
  "frequenz": ["frequency"],
  "anschluss": ["connection", "terminal", "mounting"],
  "montage": ["mounting"],
  "produktart": ["type", "type of"],
  "typ": ["type"],
};

/**
 * Find the TME parameter that corresponds to an eBay aspect name.
 * Order: exact match, known synonym, then a conservative substring match —
 * the substring step requires the shorter label to be at least 4 characters
 * so "Typ" cannot latch onto an unrelated parameter.
 */
export function findParameterFor(aspectName: string, params: TmeParameter[]): TmeParameter | null {
  if (!aspectName || params.length === 0) return null;
  const target = norm(aspectName);

  const exact = params.find((p) => norm(p.name) === target);
  if (exact) return exact;

  for (const syn of SYNONYMS[target] ?? []) {
    const hit = params.find((p) => norm(p.name) === norm(syn));
    if (hit) return hit;
  }

  if (target.length >= 4) {
    const partial = params.find((p) => {
      const n = norm(p.name);
      return n.length >= 4 && (n.includes(target) || target.includes(n));
    });
    if (partial) return partial;
  }
  return null;
}

/** eBay rejects over-long aspect values; keep well inside the limit. */
export function cleanAspectValue(value: string): string {
  return String(value).replace(/\s+/g, " ").trim().slice(0, 65);
}

/**
 * Build aspect values from TME parameters for the aspects eBay asks for.
 * `allowedValues` (when eBay constrains an aspect) is respected — a value
 * outside the list is dropped rather than sent and rejected.
 */
export function aspectsFromParameters(
  required: Array<{ name: string; values: string[] }>,
  params: TmeParameter[],
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const a of required) {
    const match = findParameterFor(a.name, params);
    if (!match?.value) continue;
    const value = cleanAspectValue(match.value);
    if (!value) continue;
    if (a.values.length > 0) {
      const accepted = a.values.find((v) => v.toLowerCase() === value.toLowerCase());
      if (!accepted) continue; // constrained aspect, value not permitted
      out[a.name] = [accepted];
    } else {
      out[a.name] = [value];
    }
  }
  return out;
}

/** Flatten TME v2's /products/parameters response into {name, value} pairs. */
export function flattenTmeParameters(entry: any): TmeParameter[] {
  const els = entry?.parameters?.elements ?? [];
  const out: TmeParameter[] = [];
  for (const p of els) {
    const name = p?.name;
    const value = (p?.values ?? []).map((v: any) => v?.value).filter(Boolean).join(", ");
    if (name && value) out.push({ name: String(name), value: String(value) });
  }
  return out;
}

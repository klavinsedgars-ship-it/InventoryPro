/**
 * Parsing a pasted list of product codes.
 *
 * The operator's input is whatever an eBay email or a spreadsheet gave them:
 * one per line, comma separated, quoted, with stray whitespace, sometimes the
 * same code twice. Normalising that is the difference between blocking what
 * they meant and blocking nothing at all.
 *
 * Pure: no storage, no network.
 */

/** Codes are matched case-insensitively; TME symbols are upper-case. */
export function normalizeCode(raw: string): string {
  return String(raw ?? "")
    .trim()
    .replace(/^["'`]+|["'`,;]+$/g, "") // stray quotes and trailing separators
    .trim()
    .toUpperCase();
}

export interface ParsedCodes {
  codes: string[];
  /** Entries that survived trimming but look wrong, kept for reporting. */
  rejected: string[];
  duplicates: number;
}

/**
 * Split a pasted blob into codes. Accepts newlines, commas, semicolons, tabs
 * and multiple spaces as separators, since a paste can be any of those.
 */
/**
 * eBay's removal emails list a whole title per line, ending in the supplier
 * code:
 *
 *   Item: 298622261187 10x Needle: steel; 1"; Size: 18; … - 918100-TE | EU Stock
 *
 * Splitting that on separators produces prose fragments and blocks nothing, so
 * the operator would have to retype 28 codes by hand — exactly the moment a
 * mistake gets made. Pull the code out of the line instead: it sits between the
 * last " - " and the trailing " | ".
 */
function extractFromMarketplaceLine(line: string): string | null {
  const m = line.match(/\s-\s([A-Za-z0-9][A-Za-z0-9._/+-]{1,63})\s*\|/);
  return m ? m[1] : null;
}

export function parseProductCodes(input: string, opts: { max?: number } = {}): ParsedCodes {
  const max = opts.max ?? 5000;
  const seen = new Set<string>();
  const codes: string[] = [];
  const rejected: string[] = [];
  let duplicates = 0;

  // First pass: whole lines that look like marketplace removal notices. Done
  // before splitting, because splitting destroys the structure they carry.
  const lines = String(input ?? "").split(/[\r\n]+/);
  const consumed = new Set<number>();
  lines.forEach((line, i) => {
    const code = extractFromMarketplaceLine(line);
    if (!code) return;
    consumed.add(i);
    const norm = normalizeCode(code);
    if (!norm) return;
    if (seen.has(norm)) { duplicates++; return; }
    seen.add(norm);
    codes.push(norm);
  });

  const remaining = lines.filter((_, i) => !consumed.has(i)).join("\n");

  for (const piece of remaining.split(/[\r\n,;\t]+|\s{2,}/)) {
    const code = normalizeCode(piece);
    if (!code) continue;
    // A TME symbol is short and has no spaces; anything else is a paste
    // accident (a description, a URL) and must not silently become a block.
    if (code.length > 64 || /\s/.test(code)) {
      rejected.push(piece.trim().slice(0, 80));
      continue;
    }
    if (seen.has(code)) { duplicates++; continue; }
    seen.add(code);
    codes.push(code);
    if (codes.length >= max) break;
  }

  return { codes, rejected, duplicates };
}

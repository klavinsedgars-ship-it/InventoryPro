/**
 * Pulling the buyer's actual message out of eBay's notification wrapper.
 *
 * eBay does not send you the message; it sends an email ABOUT the message. A
 * one-line question arrives wrapped in a header, a preview copy, "Reply" and
 * "Reply with offer" buttons, a greeting, a signature, the full item title, and
 * a legal footer — and the message itself appears TWICE inside it. eBay's own
 * interface shows the one line. This does the same.
 *
 * It is a heuristic over somebody else's template, so it is built to fail
 * safely: when it cannot identify the message with confidence it returns the
 * whole thing rather than a confident guess, and the caller always keeps the
 * original so nothing is lost.
 *
 * Pure: no DOM, no network.
 */

export interface ExtractedMessage {
  /** The buyer's text, or the original when it could not be isolated. */
  text: string;
  /** True when the wrapper was recognised and stripped. */
  extracted: boolean;
  /** Lines removed, for debugging a template change. */
  removed: number;
}

/**
 * Lines that are eBay's chrome rather than anyone's words. Matched across the
 * languages this account sees (English, German, Italian): eBay localises these
 * notifications to the BUYER's language, not ours.
 */
/**
 * Where eBay's footer begins. Everything from the first of these onward is
 * template: item facts, buyer profile, policy notices, legal text. Cutting at
 * the marker beats listing every footer line, because the tail is endless and
 * eBay adds to it.
 */
const FOOTER_MARKERS: RegExp[] = [
  /^item\s*(id|nummer|nr)\s*[:#]/i,
  /^(quantity remaining|verbleibende (menge|anzahl)|quantità rimanente)/i,
  /^(view your listing|angebot ansehen|vedi la tua inserzione)/i,
  /get to know the buyer|käufer kennenlernen|conosci l'acquirente/i,
  /^(located|standort|posizione)\s*:/i,
  /^(member since|mitglied seit|membro dal)\s*:/i,
  /^(positive feedback|positive bewertungen|feedback positivi)\s*:/i,
  /we scan messages|wir scannen nachrichten|scansioniamo i messaggi/i,
  /purchase protection|käuferschutz|protezione acquisti/i,
  /^email reference id|^referenz-id/i,
  /we don'?t check this mailbox|dieses postfach wird nicht/i,
  /ebay sent this message|ebay hat diese nachricht/i,
  /learn more about account protection/i,
  /privacy notice|user agreement|datenschutzerklärung|nutzungsbedingungen/i,
];

const NOISE_PATTERNS: RegExp[] = [
  /^\(\d+\)$/,                            // a bare feedback score
  /^&\w+;$/,                                // an entity left on its own line
  /^[•·▪-]$/,                                // a lone bullet
  /^(re:\s*)?(new message|neue nachricht|nuovo messaggio)/i,
  /sent you a message|sent a message about|hat dir eine nachricht|ti ha inviato/i,
  /^(reply|antworten|rispondi)(\s+with\s+offer|\s+mit\s+angebot)?$/i,
  /^(reply with offer|mit angebot antworten|rispondi con offerta)$/i,
  /^(view (the )?(listing|item)|artikel ansehen|vedi l'oggetto)/i,
  /^(dear|hallo|hello|guten tag|gentile|caro)\b.{0,60},?$/i,
  /^-{1,2}\s*\S+$/,                       // "- buyername" signature
  /^(thanks|thank you|regards|mit freundlichen|cordiali saluti|grazie)[.,!]?$/i,
  /ebay (inc|gmbh|marketplaces|s\.à r\.l)/i,
  /^(unsubscribe|abmelden|privacy|datenschutz|impressum|user agreement)/i,
  /this message was sent|diese nachricht wurde|questo messaggio/i,
  /marked as (read|unread)|als gelesen/i,
  /^\s*(item|artikel|oggetto)\s*(number|nummer|nr\.?|#)/i,
  /^#?\d{9,}$/,                            // bare eBay item numbers
  /^(eur|usd|gbp)\s?[\d.,]+$/i,            // a price on its own line
  /^\s*$/,
];

function isNoise(line: string): boolean {
  const l = line.trim();
  if (!l) return true;
  return NOISE_PATTERNS.some((rx) => rx.test(l));
}

/** Normalised for comparison: case, punctuation and spacing removed. */
function key(line: string): string {
  return line.toLowerCase().replace(/[^0-9a-zà-öø-ÿа-я]+/gi, " ").trim();
}

export function extractBuyerMessage(
  plainText: string,
  ctx: { buyerUsername?: string | null; itemTitle?: string | null; sellerUsername?: string | null } = {},
): ExtractedMessage {
  const original = String(plainText ?? "").trim();
  if (!original) return { text: "", extracted: false, removed: 0 };

  const itemKey = ctx.itemTitle ? key(ctx.itemTitle).slice(0, 40) : "";
  const buyer = (ctx.buyerUsername ?? "").toLowerCase();
  const seller = (ctx.sellerUsername ?? "").toLowerCase();

  const allLines = original.split(/\r?\n/);

  // Cut the footer first: everything from the first marker is eBay's template.
  let cutAt = allLines.length;
  for (let i = 0; i < allLines.length; i++) {
    if (FOOTER_MARKERS.some((rx) => rx.test(allLines[i].trim()))) { cutAt = i; break; }
  }
  const lines = allLines.slice(0, cutAt);
  let removed = allLines.length - lines.length;
  const kept: string[] = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (isNoise(line)) { removed++; continue; }

    // The item title is repeated in the wrapper; the thread header already
    // shows it, so it is noise here.
    if (itemKey && key(line).startsWith(itemKey)) { removed++; continue; }

    // A line that is just a username — the buyer's or ours — carries nothing.
    const bare = key(line);
    if ((buyer && bare === key(buyer)) || (seller && bare === key(seller))) { removed++; continue; }
    // "gg303231giorgio (179)" — username plus feedback score.
    if (buyer && new RegExp(`^${escapeRx(buyer)}\\s*\\(\\d+\\)$`, "i").test(line)) { removed++; continue; }

    kept.push(line);
  }

  // The message appears twice in these notifications: once as a preview and
  // once under the greeting. Collapse repeats so it is shown once.
  const seen = new Set<string>();
  const deduped = kept.filter((l) => {
    const k = key(l);
    if (k.length < 3) return true; // keep short fragments as-is
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const text = deduped.join("\n").replace(/\n{3,}/g, "\n\n").trim();

  // Fail safe: if stripping left nothing, or almost nothing where there was a
  // lot, the template was not what we assumed — return the original.
  if (!text || (original.length > 200 && text.length < 8)) {
    return { text: original, extracted: false, removed: 0 };
  }
  return { text, extracted: removed > 0 && text.length < original.length, removed };
}

function escapeRx(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

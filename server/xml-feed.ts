/**
 * Generic XML product-feed parsing — NO network, NO DB, NO env.
 *
 * Written for distributor feeds we have not seen yet: instead of assuming a
 * schema, it discovers the repeating "record" element, parses each record into
 * a plain JSON tree, and leaves interpretation to a per-supplier mapper (see
 * getic-feed.ts). Hand-rolled like ebay-xml.ts — no XML dependency to carry
 * through the esbuild bundle — but tokenizer-based rather than regex-based,
 * because a whole catalogue must be walked in one pass without a DOM of the
 * entire document in memory. The token stream is a generator so an importer
 * can await database writes between records without buffering the feed.
 */

export interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  /** Concatenated character data (entities decoded, CDATA verbatim), trimmed. */
  text: string;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function decodeEntities(s: string): string {
  if (s.indexOf("&") === -1) return s;
  return s.replace(/&(#[xX]?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === "#") {
      const hex = body[1] === "x" || body[1] === "X";
      const code = parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      try {
        return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
      } catch {
        return whole;
      }
    }
    return NAMED_ENTITIES[body] ?? whole;
  });
}

const ATTR_RE = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

export type XmlToken =
  | { t: "open"; name: string; attrs: Record<string, string>; selfClosing: boolean }
  | { t: "close"; name: string }
  | { t: "text"; raw: string; cdata: boolean };

/**
 * Single forward pass over the document. Comments, processing instructions and
 * DOCTYPE (with internal subset) are skipped; CDATA is delivered as text with
 * cdata=true so the consumer knows not to entity-decode it. Assumes
 * well-formedness only as far as a browser does — a stray unclosed tag ends
 * the stream rather than throwing.
 */
export function* xmlTokens(xml: string): Generator<XmlToken> {
  let i = 0;
  const n = xml.length;
  while (i < n) {
    const lt = xml.indexOf("<", i);
    if (lt === -1) {
      if (i < n) yield { t: "text", raw: xml.slice(i), cdata: false };
      return;
    }
    if (lt > i) yield { t: "text", raw: xml.slice(i, lt), cdata: false };
    if (xml.startsWith("<!--", lt)) {
      const e = xml.indexOf("-->", lt + 4);
      i = e === -1 ? n : e + 3;
      continue;
    }
    if (xml.startsWith("<![CDATA[", lt)) {
      const e = xml.indexOf("]]>", lt + 9);
      yield { t: "text", raw: xml.slice(lt + 9, e === -1 ? n : e), cdata: true };
      i = e === -1 ? n : e + 3;
      continue;
    }
    if (xml.startsWith("<?", lt)) {
      const e = xml.indexOf("?>", lt + 2);
      i = e === -1 ? n : e + 2;
      continue;
    }
    if (xml.startsWith("<!", lt)) {
      // DOCTYPE, possibly with an internal subset in [...]
      let j = lt + 2;
      let bracket = 0;
      while (j < n) {
        const c = xml[j];
        if (c === "[") bracket++;
        else if (c === "]") bracket--;
        else if (c === ">" && bracket <= 0) break;
        j++;
      }
      i = j + 1;
      continue;
    }
    const gt = xml.indexOf(">", lt);
    if (gt === -1) return; // truncated document
    const rawTag = xml.slice(lt + 1, gt);
    if (rawTag[0] === "/") {
      yield { t: "close", name: rawTag.slice(1).trim() };
      i = gt + 1;
      continue;
    }
    const selfClosing = rawTag.endsWith("/");
    const body = selfClosing ? rawTag.slice(0, -1) : rawTag;
    const sp = body.search(/\s/);
    const name = (sp === -1 ? body : body.slice(0, sp)).trim();
    const attrs: Record<string, string> = {};
    if (sp !== -1) {
      for (const m of body.slice(sp).matchAll(ATTR_RE)) {
        attrs[m[1]] = decodeEntities(m[2] ?? m[3] ?? "");
      }
    }
    yield { t: "open", name, attrs, selfClosing };
    i = gt + 1;
  }
}

export interface FeedStructure {
  rootElement: string | null;
  /** Element counts near the top of the tree — what the probe shows. */
  counts: Array<{ name: string; depth: number; count: number }>;
  /** Best guess at the repeating record element. */
  recordElement: string | null;
  recordCount: number;
}

/**
 * Discover the document's shape. The record element is the most frequent
 * element among the root's children; when the root holds a single wrapper
 * (<shop><products><product>…), descend a level and look again.
 */
export function sniffFeedStructure(xml: string): FeedStructure {
  const counts = new Map<string, number>(); // "depth:name"
  let depth = 0;
  let root: string | null = null;
  for (const tok of xmlTokens(xml)) {
    if (tok.t === "open") {
      if (depth === 0 && !root) root = tok.name;
      if (depth >= 1 && depth <= 3) {
        const k = `${depth}:${tok.name}`;
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
      if (!tok.selfClosing) depth++;
    } else if (tok.t === "close") {
      depth = Math.max(0, depth - 1);
    }
  }

  const all = Array.from(counts.entries())
    .map(([k, count]) => {
      const idx = k.indexOf(":");
      return { depth: Number(k.slice(0, idx)), name: k.slice(idx + 1), count };
    })
    .sort((a, b) => a.depth - b.depth || b.count - a.count);

  let recordElement: string | null = null;
  let recordCount = 0;
  for (const d of [1, 2, 3]) {
    const atDepth = all.filter((e) => e.depth === d);
    if (atDepth.length === 0) break;
    const best = atDepth[0]; // sorted by count desc within depth
    if (best.count >= 2) {
      recordElement = best.name;
      recordCount = best.count;
      break;
    }
    // A single element at this depth is a wrapper — look one level deeper.
  }

  return { rootElement: root, counts: all.slice(0, 40), recordElement, recordCount };
}

/**
 * Yield every <recordName> element as a node tree built for THAT record only —
 * the rest of the document is never materialised. A consumer that stops
 * iterating (break / a dry-run limit) costs nothing further; an importer can
 * await between records because this is a generator, not a callback.
 */
export function* recordsOf(xml: string, recordName: string): Generator<XmlNode> {
  let capturing = false;
  let stack: XmlNode[] = [];

  for (const tok of xmlTokens(xml)) {
    if (tok.t === "open") {
      if (!capturing) {
        if (tok.name !== recordName) continue;
        const node: XmlNode = { name: tok.name, attrs: tok.attrs, children: [], text: "" };
        if (tok.selfClosing) {
          yield node;
          continue;
        }
        capturing = true;
        stack = [node];
        continue;
      }
      const node: XmlNode = { name: tok.name, attrs: tok.attrs, children: [], text: "" };
      stack[stack.length - 1].children.push(node);
      if (!tok.selfClosing) stack.push(node);
    } else if (tok.t === "close") {
      if (!capturing) continue;
      if (stack.length === 1) {
        // Closing the record element itself.
        const node = stack[0];
        node.text = node.text.trim();
        capturing = false;
        yield node;
      } else {
        // Best effort on mismatched close tags: the pop realigns us.
        const done = stack.pop()!;
        done.text = done.text.trim();
      }
    } else if (capturing) {
      stack[stack.length - 1].text += tok.cdata ? tok.raw : decodeEntities(tok.raw);
    }
  }
}

export type JsonRecord = { [key: string]: JsonValue };
export type JsonValue = string | JsonRecord | Array<string | JsonRecord>;

/**
 * Collapse a node tree to plain JSON: a leaf becomes its text, repeated
 * children become arrays, attributes become "@attr" keys, and mixed content
 * keeps its text under "#text". This is what gets stored as `raw`.
 */
export function nodeToJson(node: XmlNode): string | JsonRecord {
  const hasKids = node.children.length > 0;
  const attrKeys = Object.keys(node.attrs);
  if (!hasKids && attrKeys.length === 0) return node.text;

  const obj: JsonRecord = {};
  for (const k of attrKeys) obj[`@${k}`] = node.attrs[k];
  for (const c of node.children) {
    const v = nodeToJson(c);
    const existing = obj[c.name];
    if (existing === undefined) obj[c.name] = v;
    else if (Array.isArray(existing)) existing.push(v as string | JsonRecord);
    else obj[c.name] = [existing as string | JsonRecord, v as string | JsonRecord];
  }
  if (node.text) obj["#text"] = node.text;
  return obj;
}

/**
 * Which charset to decode the body with. The XML declaration wins over the
 * HTTP header (feeds routinely serve windows-125x bodies under a generic
 * content type); default utf-8.
 */
export function detectXmlEncoding(headAscii: string, contentType?: string | null): string {
  const decl = /<\?xml[^>]*encoding=["']([\w.-]+)["']/i.exec(headAscii)?.[1];
  const ct = /charset=([\w.-]+)/i.exec(contentType ?? "")?.[1];
  return (decl ?? ct ?? "utf-8").toLowerCase();
}

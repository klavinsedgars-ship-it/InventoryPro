import { describe, it, expect } from "vitest";
import { sanitizeMessageHtml, htmlToPlainText, decodeEntities } from "@shared/html-sanitize";

describe("sanitizeMessageHtml — untrusted buyer content", () => {
  it("removes script tags AND their contents", () => {
    const out = sanitizeMessageHtml('<p>Hi</p><script>steal(document.cookie)</script>');
    expect(out).not.toMatch(/script/i);
    expect(out).not.toContain("steal");
    expect(out).toContain("Hi");
  });

  it("drops javascript: and data: links rather than rendering them", () => {
    expect(sanitizeMessageHtml('<a href="javascript:alert(1)">click</a>')).not.toMatch(/javascript/i);
    expect(sanitizeMessageHtml('<a href="data:text/html,<script>x</script>">click</a>')).not.toMatch(/data:/i);
    // The text survives; only the dangerous link is removed.
    expect(sanitizeMessageHtml('<a href="javascript:alert(1)">click</a>')).toContain("click");
  });

  it("defeats obfuscated javascript URLs", () => {
    // Tabs/spaces inside the scheme are a classic filter bypass.
    expect(sanitizeMessageHtml('<a href="java\tscript:alert(1)">x</a>')).not.toMatch(/javascript/i);
  });

  it("strips event handlers and style attributes", () => {
    const out = sanitizeMessageHtml('<p onclick="evil()" style="position:fixed">text</p>');
    expect(out).not.toMatch(/onclick|style|evil/i);
    expect(out).toContain("text");
  });

  it("keeps safe links but neutralises the tab-nabbing risk", () => {
    const out = sanitizeMessageHtml('<a href="https://ebay.de/itm/123">order</a>');
    expect(out).toContain('href="https://ebay.de/itm/123"');
    expect(out).toContain('rel="noopener noreferrer nofollow"');
    expect(out).toContain('target="_blank"');
  });

  it("keeps the formatting that makes a message readable", () => {
    const out = sanitizeMessageHtml("<p>Hello</p><p>Second <b>bold</b> and <i>italic</i></p><ul><li>one</li></ul>");
    expect(out).toContain("<p>");
    expect(out).toContain("<b>");
    expect(out).toContain("<li>");
  });

  it("drops iframes, forms and embeds entirely", () => {
    for (const bad of ['<iframe src="x"></iframe>', '<object data="x"></object>', '<embed src="x">']) {
      expect(sanitizeMessageHtml(bad)).not.toMatch(/iframe|object|embed/i);
    }
    // form is not in the allowlist, so the tag goes and the text stays
    expect(sanitizeMessageHtml("<form><input></form>hi")).toContain("hi");
    expect(sanitizeMessageHtml("<form><input></form>hi")).not.toMatch(/<form|<input/i);
  });

  it("decodes the entities that were showing literally on screen", () => {
    // The live symptom: "&nbsp;" rendered as text in the message body.
    expect(sanitizeMessageHtml("<p>a&nbsp;b</p>")).not.toContain("&nbsp;");
    expect(decodeEntities("a&nbsp;b &amp; c &#39;d&#39;")).toBe("a b & c 'd'");
  });

  it("treats plain text as text, preserving line breaks", () => {
    const out = sanitizeMessageHtml("Line one\nLine two");
    expect(out).toBe("Line one<br>Line two");
  });

  it("escapes a stray angle bracket instead of leaving broken markup", () => {
    expect(sanitizeMessageHtml("<p>5 < 10 and 20 > 3</p>")).toContain("&lt;");
  });

  it("handles empty and null input", () => {
    expect(sanitizeMessageHtml("")).toBe("");
    expect(sanitizeMessageHtml(null)).toBe("");
    expect(sanitizeMessageHtml(undefined)).toBe("");
  });

  it("hides a script smuggled inside an HTML comment", () => {
    expect(sanitizeMessageHtml("<!-- <script>x()</script> -->hi")).not.toMatch(/script/i);
  });
});

describe("htmlToPlainText", () => {
  it("makes a readable preview with breaks where blocks ended", () => {
    expect(htmlToPlainText("<p>One</p><p>Two</p>")).toBe("One\nTwo");
    expect(htmlToPlainText("a<br>b")).toBe("a\nb");
  });

  it("decodes entities so previews are not full of &nbsp;", () => {
    expect(htmlToPlainText("<p>a&nbsp;b</p>")).toBe("a b");
  });
});

describe("the real eBay message that rendered as raw source", () => {
  // eBay delivers the body entity-encoded inside XML. Sanitizing before
  // decoding meant no strip rule matched, and the whole document — DOCTYPE,
  // head, and the CSS inside <style> — was printed into the thread as text.
  const ENCODED_EBAY_BODY =
    "&lt;!DOCTYPE html&gt;&lt;html&gt;&lt;head&gt;" +
    '&lt;meta http-equiv="Content-Type" content="text/html; charset=utf-8"&gt;' +
    '&lt;style id="DS3Style" type="text/css"&gt;@media only screen and (max-width: 620px) { body[yahoo] .device-width { width: 450px !important } }&lt;/style&gt;' +
    "&lt;/head&gt;&lt;body&gt;&lt;p&gt;Hello, is this switch 12V?&lt;/p&gt;&lt;/body&gt;&lt;/html&gt;";

  it("shows the message, not the document", () => {
    const out = sanitizeMessageHtml(ENCODED_EBAY_BODY);
    expect(out).toContain("Hello, is this switch 12V?");
    expect(out).not.toMatch(/DOCTYPE/i);
    expect(out).not.toMatch(/@media/);
    expect(out).not.toMatch(/device-width/);
    expect(out).not.toMatch(/<style|<head|<meta/i);
  });

  it("still refuses a script that arrives entity-encoded", () => {
    // Decoding first is only safe because sanitizing happens after it.
    const out = sanitizeMessageHtml("&lt;script&gt;alert(1)&lt;/script&gt;&lt;p&gt;hi&lt;/p&gt;");
    expect(out).not.toMatch(/script|alert/i);
    expect(out).toContain("hi");
  });

  it("handles a double-encoded body", () => {
    const out = sanitizeMessageHtml("&amp;lt;p&amp;gt;Twice encoded&amp;lt;/p&amp;gt;");
    expect(out).toContain("Twice encoded");
  });

  it("caps a runaway body rather than storing a whole marketing email", () => {
    const huge = "<p>" + "x".repeat(200_000) + "</p>";
    expect(sanitizeMessageHtml(huge).length).toBeLessThanOrEqual(60_000);
  });
});

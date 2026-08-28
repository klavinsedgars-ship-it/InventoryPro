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

import { describe, it, expect } from "vitest";
import { extractBuyerMessage } from "@shared/message-extract";

// The live notification, as it appeared in the thread. The buyer wrote one
// line; everything else is eBay's wrapper, and the line appears twice.
const REAL_NOTIFICATION = `gg303231giorgio sent a message about ROCKER; SPST; Pos: 2; ON-OFF; 25A/12VDC; nero; R13 - R13-242L-01-BBG | Stock UE #307148962757
New message from: gg303231giorgio (179)
vorrei sapere le misure grazie
Reply
Reply with offer
Dear components_electronics,
vorrei sapere le misure grazie
- gg303231giorgio
ROCKER; SPST; Pos: 2; ON-OFF; 25A/12VDC; nero; R13 - R13-242L-01-BBG | Stock UE
EUR 8,99`;

describe("extractBuyerMessage — eBay sends an email ABOUT the message", () => {
  const ctx = {
    buyerUsername: "gg303231giorgio",
    sellerUsername: "components_electronics",
    itemTitle: "ROCKER; SPST; Pos: 2; ON-OFF; 25A/12VDC; nero; R13 - R13-242L-01-BBG | Stock UE",
  };

  it("reduces the wrapper to the line the buyer actually wrote", () => {
    const r = extractBuyerMessage(REAL_NOTIFICATION, ctx);
    expect(r.text).toBe("vorrei sapere le misure grazie");
    expect(r.extracted).toBe(true);
  });

  it("shows the message once, not the preview copy as well", () => {
    const r = extractBuyerMessage(REAL_NOTIFICATION, ctx);
    expect(r.text.match(/vorrei sapere/g)).toHaveLength(1);
  });

  it("drops the greeting, the buttons and the signature", () => {
    const r = extractBuyerMessage(REAL_NOTIFICATION, ctx);
    for (const noise of ["Dear", "Reply", "Reply with offer", "- gg303231giorgio", "New message from"]) {
      expect(r.text).not.toContain(noise);
    }
  });

  it("drops the item title and price, which the header already shows", () => {
    const r = extractBuyerMessage(REAL_NOTIFICATION, ctx);
    expect(r.text).not.toMatch(/ROCKER|R13-242L|EUR 8,99/);
  });

  it("keeps a multi-line question intact", () => {
    const msg = `New message from: buyer1 (5)
Hello,
Do you ship to Austria?
And is the 25A version in stock?
Reply
- buyer1`;
    const r = extractBuyerMessage(msg, { buyerUsername: "buyer1" });
    expect(r.text).toContain("Do you ship to Austria?");
    expect(r.text).toContain("And is the 25A version in stock?");
  });

  it("handles the German and Italian wrappers eBay sends to those buyers", () => {
    // These are localised to the BUYER's language, not ours.
    const de = `Neue Nachricht von: kunde99 (12)
Passt der Schalter für 12V?
Antworten
- kunde99`;
    expect(extractBuyerMessage(de, { buyerUsername: "kunde99" }).text).toBe("Passt der Schalter für 12V?");

    const it = `Nuovo messaggio da: cliente7 (3)
Quanto costa la spedizione?
Rispondi
- cliente7`;
    expect(extractBuyerMessage(it, { buyerUsername: "cliente7" }).text).toBe("Quanto costa la spedizione?");
  });

  it("returns the original when the wrapper is not recognised", () => {
    // Failing safe matters more than stripping aggressively: a template change
    // must not silently blank someone's question.
    const plain = "Hi, I have a question about the delivery time for this order please.";
    const r = extractBuyerMessage(plain, {});
    expect(r.text).toBe(plain);
    expect(r.extracted).toBe(false);
  });

  it("never returns empty for a long input", () => {
    const allNoise = ["Reply", "Reply with offer", "Dear seller,", "- someone"].join("\n") + "\n" + "x".repeat(300);
    const r = extractBuyerMessage(allNoise, {});
    expect(r.text.length).toBeGreaterThan(0);
  });

  it("handles empty input", () => {
    expect(extractBuyerMessage("", {}).text).toBe("");
    expect(extractBuyerMessage(null as any, {}).text).toBe("");
  });
});

describe("the footer eBay appends after the message", () => {
  // Exactly what was still showing in the thread after the first pass: item
  // facts, buyer profile, policy notice, reference id and legal text.
  const WITH_FOOTER = `gg303231giorgio sent a message about ROCKER; SPST; Pos: 2 | Stock UE #307148962757
(179)
vorrei sapere le misure grazie
Item ID: 307148962757
Quantity Remaining: 2
View your listing
Get to know the buyer gg303231giorgio
&bull;
Located: sesto san giovanni, MI, Italia
Member since: Jan 18, 2005
Positive Feedback: 100%
We scan messages to enforce policies. Only purchases on eBay are covered by the eBay purchase protection programs.
Email reference id: [#a11-8zuvn07rde#]_[#76c7a519878342c1975343bb626dbc5b#]
We don't check this mailbox, so please don't reply to this message.
eBay sent this message to Edgars Klavins (components_electronics).`;

  it("keeps the question and nothing after it", () => {
    const r = extractBuyerMessage(WITH_FOOTER, { buyerUsername: "gg303231giorgio" });
    expect(r.text).toBe("vorrei sapere le misure grazie");
  });

  it("drops the buyer profile, the policy notice and the reference id", () => {
    const r = extractBuyerMessage(WITH_FOOTER, { buyerUsername: "gg303231giorgio" });
    for (const noise of [
      "Item ID", "Quantity Remaining", "View your listing", "Get to know the buyer",
      "Located", "Member since", "Positive Feedback", "We scan messages",
      "Email reference id", "mailbox", "eBay sent this message",
    ]) {
      expect(r.text, noise).not.toContain(noise);
    }
  });

  it("drops the bare feedback score and stray bullet", () => {
    const r = extractBuyerMessage(WITH_FOOTER, { buyerUsername: "gg303231giorgio" });
    expect(r.text).not.toContain("(179)");
    expect(r.text).not.toContain("&bull;");
  });

  it("does not cut a message that merely mentions a footer word", () => {
    // "located" inside a sentence is not a footer marker; only a line that
    // STARTS one is. Cutting on a mention would truncate real questions.
    const msg = `New message from: buyer (1)
Where is your warehouse located, and how long is delivery?
Reply`;
    const r = extractBuyerMessage(msg, { buyerUsername: "buyer" });
    expect(r.text).toContain("Where is your warehouse located");
  });
});

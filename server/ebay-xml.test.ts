import { describe, it, expect } from "vitest";
import { parseActiveListings, assertTradingAck } from "./ebay-xml";

const page = (inner: string, pages = 1, entries = 2) => `<?xml version="1.0"?>
<GetMyeBaySellingResponse xmlns="urn:ebay:apis:eBLBaseComponents">
  <Ack>Success</Ack>
  <ActiveList>
    <ItemArray>${inner}</ItemArray>
    <PaginationResult>
      <TotalNumberOfPages>${pages}</TotalNumberOfPages>
      <TotalNumberOfEntries>${entries}</TotalNumberOfEntries>
    </PaginationResult>
  </ActiveList>
</GetMyeBaySellingResponse>`;

describe("parseActiveListings", () => {
  it("parses items with SKU, price, remaining quantity, and paging", () => {
    const xml = page(`
      <Item>
        <ItemID>110123456789</ItemID>
        <SKU>POLOLU-4914</SKU>
        <Title>Wheel; white; Shaft: knurled</Title>
        <SellingStatus><CurrentPrice currencyID="EUR">9.99</CurrentPrice></SellingStatus>
        <QuantityAvailable>3</QuantityAvailable>
      </Item>
      <Item>
        <ItemID>110123456790</ItemID>
        <SKU> DF-FIT0692 </SKU>
        <Title>FFC tape &amp; adapter &quot;set&quot;</Title>
        <SellingStatus><CurrentPrice currencyID="EUR">28.99</CurrentPrice></SellingStatus>
        <Quantity>5</Quantity>
      </Item>`, 4, 700);
    const r = parseActiveListings(xml);
    expect(r.totalPages).toBe(4);
    expect(r.totalEntries).toBe(700);
    expect(r.items).toHaveLength(2);
    expect(r.items[0]).toEqual({
      itemId: "110123456789",
      sku: "POLOLU-4914",
      title: "Wheel; white; Shaft: knurled",
      price: 9.99,
      quantity: 3,
    });
    // SKU trimmed, entities unescaped, Quantity fallback used.
    expect(r.items[1].sku).toBe("DF-FIT0692");
    expect(r.items[1].title).toBe('FFC tape & adapter "set"');
    expect(r.items[1].quantity).toBe(5);
  });

  it("handles CDATA titles and legacy items without SKU", () => {
    const xml = page(`
      <Item>
        <ItemID>110000000001</ItemID>
        <Title><![CDATA[Motor <DC> & gearbox]]></Title>
        <SellingStatus><CurrentPrice currencyID="EUR">12.50</CurrentPrice></SellingStatus>
      </Item>`);
    const r = parseActiveListings(xml);
    expect(r.items[0].sku).toBeNull();
    expect(r.items[0].title).toBe("Motor <DC> & gearbox");
    expect(r.items[0].quantity).toBeNull();
  });

  it("returns empty on a response with no ActiveList", () => {
    const r = parseActiveListings("<GetMyeBaySellingResponse><Ack>Success</Ack></GetMyeBaySellingResponse>");
    expect(r.items).toEqual([]);
    expect(r.totalPages).toBe(1);
    expect(r.totalEntries).toBe(0);
  });
});

describe("assertTradingAck", () => {
  it("passes Success and Warning through", () => {
    expect(() => assertTradingAck("<r><Ack>Success</Ack></r>", "x")).not.toThrow();
    expect(() => assertTradingAck("<r><Ack>Warning</Ack></r>", "x")).not.toThrow();
  });
  it("throws eBay's own message on Failure", () => {
    const xml = `<r><Ack>Failure</Ack><Errors><ShortMessage>Auth failed</ShortMessage><LongMessage>Invalid IAF token.</LongMessage></Errors></r>`;
    expect(() => assertTradingAck(xml, "fallback")).toThrow("Invalid IAF token.");
  });
});

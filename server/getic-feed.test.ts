import { describe, it, expect } from "vitest";
import {
  mapGeticRecord,
  parseFeedNumber,
  parseFeedStock,
  parseFeedWeight,
  coverageOf,
} from "./getic-feed";

describe("parseFeedNumber", () => {
  it("handles EU and US decimal conventions", () => {
    expect(parseFeedNumber("12.34")).toBe(12.34);
    expect(parseFeedNumber("12,34")).toBe(12.34);
    expect(parseFeedNumber("1 234,56")).toBe(1234.56);
    expect(parseFeedNumber("1,234.56")).toBe(1234.56);
    expect(parseFeedNumber("1.234,56")).toBe(1234.56);
    expect(parseFeedNumber("1,234")).toBe(1234); // comma-thousands
    expect(parseFeedNumber("€12.30")).toBe(12.3);
    expect(parseFeedNumber("")).toBeNull();
    expect(parseFeedNumber("n/a")).toBeNull();
  });
});

describe("parseFeedStock", () => {
  it("parses numbers, bounds and availability text", () => {
    expect(parseFeedStock("5")).toBe(5);
    expect(parseFeedStock(">10")).toBe(10);
    expect(parseFeedStock("10+")).toBe(10);
    expect(parseFeedStock("yes")).toBeNull(); // available, qty unknown
    expect(parseFeedStock("")).toBeNull();
  });
});

describe("parseFeedWeight", () => {
  it("takes the unit from the key or the value", () => {
    expect(parseFeedWeight("weight_g", "250")).toEqual({ grams: 250, assumed: false });
    expect(parseFeedWeight("weight_kg", "1.5")).toEqual({ grams: 1500, assumed: false });
    expect(parseFeedWeight("weight", "0.75 kg")).toEqual({ grams: 750, assumed: false });
    expect(parseFeedWeight("weight", "250 g")).toEqual({ grams: 250, assumed: false });
  });
  it("assumes kilograms for bare numbers and never applies thousands grouping", () => {
    expect(parseFeedWeight("weight", "1.234")).toEqual({ grams: 1234, assumed: true });
    expect(parseFeedWeight("weight", "2")).toEqual({ grams: 2000, assumed: true });
  });
});

describe("mapGeticRecord", () => {
  it("maps a flat shop-style record", () => {
    const offer = mapGeticRecord({
      id: "12345",
      name: "USB-C Cable 1m",
      ean: "4750123456789",
      manufacturer: "Acme",
      price: "3,49",
      currency: "EUR",
      quantity: "17",
      weight: "0.05",
      image: "https://cdn.example.com/1.jpg",
      url: "https://getic.com/p/12345",
      category: "Cables",
    });
    expect(offer.supplierSku).toBe("12345");
    expect(offer.name).toBe("USB-C Cable 1m");
    expect(offer.ean).toBe("4750123456789");
    expect(offer.manufacturer).toBe("Acme");
    expect(offer.price).toBe(3.49);
    expect(offer.currency).toBe("EUR");
    expect(offer.stock).toBe(17);
    expect(offer.weightG).toBe(50);
    expect(offer.imageUrl).toBe("https://cdn.example.com/1.jpg");
    expect(offer.productUrl).toBe("https://getic.com/p/12345");
    expect(offer.categoryPath).toBe("Cables");
    expect(offer.sourceKeys.sku).toBe("id");
    expect(offer.sourceKeys.weight).toContain("assumed kg");
  });

  it("prefers an explicit SKU over a generic id, and net price over gross", () => {
    const offer = mapGeticRecord({
      id: "999",
      sku: "AB-123",
      price: "10,00",
      price_vat: "12,10",
    });
    expect(offer.supplierSku).toBe("AB-123");
    expect(offer.price).toBe(10);
    expect(offer.sourceKeys.price).toBe("price");
    // The unconsumed id stays visible in attributes.
    expect(offer.attributes.id).toBe("999");
  });

  it("falls back to a gross price and says so", () => {
    const offer = mapGeticRecord({ code: "X1", price_vat: "12,10" });
    expect(offer.price).toBe(12.1);
    expect(offer.sourceKeys.price).toContain("fallback");
  });

  it("collects nested and repeated images, first one primary", () => {
    const offer = mapGeticRecord({
      code: "X1",
      images: { image: ["https://a/1.jpg", "https://a/2.jpg", "https://a/2.jpg"] },
    });
    expect(offer.imageUrl).toBe("https://a/1.jpg");
    expect(offer.additionalImages).toEqual(["https://a/2.jpg"]);
  });

  it("finds gallery URLs nested under generic children (PrestaShop shape)", () => {
    // <images><image><url>…</url></image></images> flattens to leaf key
    // "url" — only the image-ish ANCESTOR says what these are.
    const offer = mapGeticRecord({
      code: "X2",
      images: { image: [{ url: "https://a/main.jpg" }, { url: "https://a/side.jpg" }] },
    });
    expect(offer.imageUrl).toBe("https://a/main.jpg");
    expect(offer.additionalImages).toEqual(["https://a/side.jpg"]);
  });

  it("an image-ish path without URL values is not an image", () => {
    const offer = mapGeticRecord({ code: "X3", image_count: "4", images: { note: "none yet" } });
    expect(offer.imageUrl).toBeNull();
    expect(offer.additionalImages).toEqual([]);
  });

  it("joins multi-valued categories into a path", () => {
    const offer = mapGeticRecord({ code: "X1", category: ["Electronics", "Cables"] });
    expect(offer.categoryPath).toBe("Electronics > Cables");
  });

  it("keeps unmapped fields verbatim in attributes", () => {
    const offer = mapGeticRecord({ code: "X1", warranty_months: "24", color: "black" });
    expect(offer.attributes.warranty_months).toBe("24");
    expect(offer.attributes.color).toBe("black");
  });

  it("keeps the raw value of lossy parses in attributes", () => {
    const offer = mapGeticRecord({ code: "X1", stock: "yes", weight: "0.5 kg" });
    expect(offer.stock).toBeNull();
    expect(offer.attributes.stock).toBe("yes");
    expect(offer.attributes.weight).toBe("0.5 kg");
  });

  it("returns null SKU when nothing identifies the record", () => {
    const offer = mapGeticRecord({ name: "mystery item" });
    expect(offer.supplierSku).toBeNull();
  });

  it("upper-cases SKUs to match blocklist/product-code conventions", () => {
    expect(mapGeticRecord({ code: "ab-12c" }).supplierSku).toBe("AB-12C");
  });

  it("maps a Google Merchant (g:-namespaced) record", () => {
    const offer = mapGeticRecord({
      "g:id": "GM-1",
      "g:title": "Wireless Mouse",
      "g:price": "24.90 EUR",
      "g:availability": "in stock",
      "g:brand": "Logi",
      "g:gtin": "4712345678901",
      "g:image_link": "https://cdn/1.jpg",
      "g:link": "https://shop/p/1",
      "g:product_type": "Peripherals > Mice",
      "g:shipping_weight": "0.2 kg",
    });
    expect(offer.supplierSku).toBe("GM-1");
    expect(offer.name).toBe("Wireless Mouse");
    expect(offer.price).toBe(24.9);
    expect(offer.currency).toBe("EUR"); // extracted from the price value
    expect(offer.sourceKeys.currency).toContain("from price value");
    expect(offer.stock).toBeNull(); // in stock, qty unknown
    expect(offer.manufacturer).toBe("Logi");
    expect(offer.ean).toBe("4712345678901");
    expect(offer.imageUrl).toBe("https://cdn/1.jpg");
    expect(offer.productUrl).toBe("https://shop/p/1");
    expect(offer.categoryPath).toBe("Peripherals > Mice");
    expect(offer.weightG).toBe(200);
  });

  it("maps a Heureka-style SHOPITEM record (uppercase fields)", () => {
    // nodeToJson keeps the feed's casing; the mapper matches case-insensitively.
    const offer = mapGeticRecord({
      ITEM_ID: "HK-9",
      PRODUCTNAME: "HDMI Cable 2m",
      PRICE_VAT: "7,99",
      EAN: "4750000000012",
      IMGURL: "https://cdn/x.jpg",
      CATEGORYTEXT: "Cables | HDMI",
      MANUFACTURER: "Gembird",
    });
    expect(offer.supplierSku).toBe("HK-9");
    expect(offer.name).toBe("HDMI Cable 2m");
    expect(offer.price).toBe(7.99);
    expect(offer.imageUrl).toBe("https://cdn/x.jpg");
    expect(offer.categoryPath).toBe("Cables | HDMI");
  });

  it("maps fields carried as attributes on the record element", () => {
    const offer = mapGeticRecord({ "@id": "AT-3", "@name": "Attr Product", "@price": "5.00" });
    expect(offer.supplierSku).toBe("AT-3");
    expect(offer.name).toBe("Attr Product");
    expect(offer.price).toBe(5);
  });

  it("maps Latvian field names", () => {
    const offer = mapGeticRecord({ kods: "LV-1", nosaukums: "Prece", cena: "9,99", daudzums: "4" });
    expect(offer.supplierSku).toBe("LV-1");
    expect(offer.name).toBe("Prece");
    expect(offer.price).toBe(9.99);
    expect(offer.stock).toBe(4);
  });

  it("reads 'out of stock' as zero, not unknown", () => {
    expect(mapGeticRecord({ code: "X", availability: "out of stock" }).stock).toBe(0);
    expect(mapGeticRecord({ code: "X", availability: "in stock" }).stock).toBeNull();
  });
});

describe("coverageOf", () => {
  it("counts non-null fields", () => {
    const a = mapGeticRecord({ code: "A", price: "1,00", quantity: "3", image: "https://a/1.jpg" });
    const b = mapGeticRecord({ code: "B", name: "thing" });
    const c = coverageOf([a, b]);
    expect(c.sku).toBe(2);
    expect(c.name).toBe(1);
    expect(c.price).toBe(1);
    expect(c.stockPositive).toBe(1);
    expect(c.image).toBe(1);
    expect(c.ean).toBe(0);
  });
});

describe("dialects the first live probe could not see (2026-08-31 hardening)", () => {
  it("reads key-in-attribute fields: <field name='sku'>ABC</field>", () => {
    // nodeToJson renders that element as {"@name":"sku","#text":"ABC"}.
    const offer = mapGeticRecord({
      fields: {
        field: [
          { "@name": "sku", "#text": "KA-77" },
          { "@name": "name", "#text": "Keyed Product" },
          { "@name": "price", "#text": "12,50" },
          { "@name": "quantity", "#text": "3" },
        ],
      },
    } as any);
    expect(offer.supplierSku).toBe("KA-77");
    expect(offer.name).toBe("Keyed Product");
    expect(offer.price).toBe(12.5);
    expect(offer.stock).toBe(3);
  });

  it("falls back to compound Latvian names: preces_kods / preces_nosaukums / cena_bez_pvn", () => {
    const offer = mapGeticRecord({
      preces_kods: "LV-9",
      preces_nosaukums: "Prece ar garu nosaukumu",
      cena_bez_pvn: "8,26",
      noliktava_daudzums: "12",
    });
    expect(offer.supplierSku).toBe("LV-9");
    expect(offer.name).toBe("Prece ar garu nosaukumu");
    expect(offer.price).toBe(8.26);
    expect(offer.stock).toBe(12);
  });

  it("fuzzy matching never grabs a known other-purpose key", () => {
    // category_code must not become the SKU; manufacturer_name not the name.
    const offer = mapGeticRecord({
      category_code: "CAT-1",
      manufacturer_name: "Acme",
      old_price: "99,99",
    });
    expect(offer.supplierSku).toBeNull();
    expect(offer.name).toBeNull();
    expect(offer.price).toBeNull();
  });

  it("exact matches still win over fuzzy candidates", () => {
    const offer = mapGeticRecord({ sku: "EXACT-1", preces_kods: "FUZZY-1" });
    expect(offer.supplierSku).toBe("EXACT-1");
    // the unconsumed compound key stays visible in attributes
    expect(offer.attributes.preces_kods).toBe("FUZZY-1");
  });
});

describe("SKU derivation when the feed has no code field (live Getic shape)", () => {
  const geticRecord = {
    title: "Ubiquiti airMAX 5 GHz, 19 dBi Sector AM-5G19-120",
    link: "https://getic.com/p/am-5g19-120",
    price: "123.99",
    image: "https://cdn.getic.com/am.jpg",
    qty: "31",
    brand: "Ubiquiti",
    mpn: "AM-5G19-120",
    ean: "0810354020919",
  };

  it("uses the EAN as the SKU and says so", () => {
    const offer = mapGeticRecord({ ...geticRecord });
    expect(offer.supplierSku).toBe("0810354020919");
    expect(offer.ean).toBe("0810354020919");
    expect(offer.sourceKeys.sku).toContain("EAN used as SKU");
    expect(offer.name).toBe(geticRecord.title);
    expect(offer.mpn).toBe("AM-5G19-120");
    expect(offer.price).toBe(123.99);
    expect(offer.stock).toBe(31);
  });

  it("falls to MPN when there is no EAN either", () => {
    const { ean, ...noEan } = geticRecord;
    const offer = mapGeticRecord(noEan as any);
    expect(offer.supplierSku).toBe("AM-5G19-120");
    expect(offer.sourceKeys.sku).toContain("MPN used as SKU");
  });

  it("an explicit code still beats the EAN fallback", () => {
    const offer = mapGeticRecord({ ...geticRecord, sku: "GT-1" });
    expect(offer.supplierSku).toBe("GT-1");
    expect(offer.ean).toBe("0810354020919");
  });
});

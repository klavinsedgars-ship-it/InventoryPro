import { describe, it, expect } from "vitest";
import {
  ACC_IMAGE_SIZE,
  accImageUrl,
  branchPath,
  branchPathResolver,
  cleanEan,
  mapAccProduct,
  pickWeightGrams,
  productsFromResponse,
  totalStock,
  type AccProduct,
} from "./acc-map";

/** The worked example from ACC's own GetProduct response. */
const SPEC_PRODUCT: AccProduct = {
  PID: "000913",
  MPN: "CD-RW700/4x-12xsb",
  EAN: "4770070853146",
  Name: "Acme CD-RW 0.7 GB, 4-12 x, Plastic slim box",
  Picture: "https://www.blobs.lt/products/3/1/9/0/0/0/b00363bd642defbb26a4fe255c0b3301",
  Producer: { OId: "AC", Name: "Acme" },
  Price: { Value: 0.75, OldValue: 0.75, LatgaValue: 0.795, CurrencyCode: "EUR" },
  Stocks: [{ WhId: "SALES", Amount: 0.0 }],
  Branches: [{ OId: 1549, Name: "Media storage" }],
  ByOrder: false,
  Warranty: 60,
  CountryOfOrigin: "TW",
};

describe("accImageUrl", () => {
  it("completes a picture directory with a size, because the bare URL 404s", () => {
    expect(accImageUrl("https://www.blobs.lt/products/3/1/9/abc")).toBe(
      `https://www.blobs.lt/products/3/1/9/abc/${ACC_IMAGE_SIZE}`,
    );
  });

  it("leaves an already-complete file URL alone", () => {
    const original = "https://www.blobs.lt/products/3/1/9/abc/original.jpg";
    expect(accImageUrl(original)).toBe(original);
    expect(accImageUrl("https://www.blobs.lt/x/y.tif")).toBe("https://www.blobs.lt/x/y.tif");
  });

  it("does not double up on a trailing slash", () => {
    expect(accImageUrl("https://blobs.lt/a/")).toBe(`https://blobs.lt/a/${ACC_IMAGE_SIZE}`);
  });

  it("rejects anything that is not an http URL", () => {
    expect(accImageUrl("")).toBeNull();
    expect(accImageUrl(null)).toBeNull();
    expect(accImageUrl("  ")).toBeNull();
    expect(accImageUrl("/relative/path")).toBeNull();
  });

  it("honours a requested size", () => {
    expect(accImageUrl("https://blobs.lt/a", "1920x1920.png")).toBe("https://blobs.lt/a/1920x1920.png");
  });
});

describe("cleanEan", () => {
  it("keeps a plausible barcode and strips punctuation", () => {
    expect(cleanEan("4770070853146")).toBe("4770070853146");
    expect(cleanEan("4770-0708-53146")).toBe("4770070853146");
  });

  it("rejects anything outside 8–14 digits", () => {
    expect(cleanEan("123")).toBeNull();
    expect(cleanEan("123456789012345")).toBeNull();
    expect(cleanEan("")).toBeNull();
    expect(cleanEan(null)).toBeNull();
    expect(cleanEan("N/A")).toBeNull();
  });
});

describe("totalStock", () => {
  it("sums what is on the shelf across warehouses", () => {
    expect(totalStock([{ WhId: "A", Amount: 3 }, { WhId: "B", Amount: 4 }])).toBe(7);
  });

  it("excludes stock that is merely arriving", () => {
    // Listing against goods that have not landed is how you oversell.
    expect(totalStock([{ WhId: "A", Amount: 0, AmountArriving: 500 }])).toBe(0);
  });

  it("floors a negative (oversold) warehouse at zero rather than netting it off", () => {
    expect(totalStock([{ WhId: "A", Amount: -5 }, { WhId: "B", Amount: 2 }])).toBe(2);
  });

  it("truncates fractional stock down", () => {
    expect(totalStock([{ WhId: "A", Amount: 2.9 }])).toBe(2);
  });

  it("distinguishes no warehouses from zero stock", () => {
    expect(totalStock([])).toBeNull();
    expect(totalStock(null)).toBeNull();
    expect(totalStock([{ WhId: "A", Amount: null }])).toBeNull();
    expect(totalStock([{ WhId: "A", Amount: 0 }])).toBe(0);
  });
});

describe("pickWeightGrams", () => {
  it("reads a weight in grams", () => {
    expect(pickWeightGrams([{ ParameterName: "Weight", Value: "250", MeasureAbbr: "g" }])).toBe(250);
  });

  it("converts kilograms", () => {
    expect(pickWeightGrams([{ ParameterName: "Weight", Value: 1.4, MeasureAbbr: "kg" }])).toBe(1400);
  });

  it("refuses a bare number with no unit", () => {
    // 2 could be kilograms or grams; guessing is a 1000x error on the single
    // input that decides whether an order makes money.
    expect(pickWeightGrams([{ ParameterName: "Weight", Value: "2", MeasureAbbr: null }])).toBeNull();
    expect(pickWeightGrams([{ ParameterName: "Weight", Value: "2", MeasureAbbr: "lbs" }])).toBeNull();
  });

  it("prefers net weight over gross", () => {
    const params = [
      { ParameterName: "Gross weight", Value: "300", MeasureAbbr: "g" },
      { ParameterName: "Net weight", Value: "250", MeasureAbbr: "g" },
    ];
    expect(pickWeightGrams(params)).toBe(250);
    expect(pickWeightGrams([...params].reverse())).toBe(250);
  });

  it("falls back to gross when that is all there is", () => {
    expect(pickWeightGrams([{ ParameterName: "Gross weight", Value: "300", MeasureAbbr: "g" }])).toBe(300);
  });

  it("ignores parameters that are not weights", () => {
    expect(pickWeightGrams([{ ParameterName: "Capacity", Value: "0.7", MeasureAbbr: "GB" }])).toBeNull();
    expect(pickWeightGrams([])).toBeNull();
    expect(pickWeightGrams(null)).toBeNull();
  });

  it("ignores a zero or negative weight", () => {
    expect(pickWeightGrams([{ ParameterName: "Weight", Value: "0", MeasureAbbr: "g" }])).toBeNull();
  });
});

describe("branchPathResolver", () => {
  const tree = [
    { Id: 1430, Name: "Accessories", ParentId: null },
    { Id: 1549, Name: "Media storage", ParentId: 1440 },
    { Id: 1440, Name: "PC and servers components", ParentId: null },
  ];

  it("walks a branch up to its root", () => {
    expect(branchPathResolver(tree)(1549)).toEqual(["PC and servers components", "Media storage"]);
  });

  it("handles a root branch", () => {
    expect(branchPathResolver(tree)(1430)).toEqual(["Accessories"]);
  });

  it("returns null for an unknown branch", () => {
    expect(branchPathResolver(tree)(9999)).toBeNull();
  });

  it("terminates on a cycle rather than hanging the import", () => {
    const cyclic = [
      { Id: 1, Name: "A", ParentId: 2 },
      { Id: 2, Name: "B", ParentId: 1 },
    ];
    expect(branchPathResolver(cyclic)(1)).toEqual(["B", "A"]);
  });
});

describe("branchPath", () => {
  it("uses the leaf name when no tree is loaded", () => {
    expect(branchPath([{ OId: 1549, Name: "Media storage" }])).toBe("Media storage");
  });

  it("uses the full ancestry when the tree is loaded", () => {
    const resolve = branchPathResolver([
      { Id: 1549, Name: "Media storage", ParentId: 1440 },
      { Id: 1440, Name: "PC and servers components", ParentId: null },
    ]);
    expect(branchPath([{ OId: 1549, Name: "Media storage" }], resolve)).toBe(
      "PC and servers components > Media storage",
    );
  });

  it("falls back to the leaf name when the tree does not know the branch", () => {
    const resolve = branchPathResolver([]);
    expect(branchPath([{ OId: 1, Name: "Orphan" }], resolve)).toBe("Orphan");
  });

  it("is null when there are no branches", () => {
    expect(branchPath([])).toBeNull();
    expect(branchPath(null)).toBeNull();
  });
});

describe("mapAccProduct", () => {
  it("maps the specification's own example", () => {
    const offer = mapAccProduct(SPEC_PRODUCT);
    expect(offer.supplierSku).toBe("000913");
    expect(offer.mpn).toBe("CD-RW700/4x-12xsb");
    expect(offer.ean).toBe("4770070853146");
    expect(offer.manufacturer).toBe("Acme");
    expect(offer.price).toBe(0.75);
    expect(offer.currency).toBe("EUR");
    expect(offer.stock).toBe(0);
    expect(offer.categoryPath).toBe("Media storage");
    expect(offer.imageUrl).toBe(
      `https://www.blobs.lt/products/3/1/9/0/0/0/b00363bd642defbb26a4fe255c0b3301/${ACC_IMAGE_SIZE}`,
    );
  });

  it("leaves weight null for a product list entry, which carries none", () => {
    // ACC's GetProducts has no weight field at all. Silently defaulting one
    // would hand the pricing floor a fabricated shipping cost.
    expect(mapAccProduct(SPEC_PRODUCT).weightG).toBeNull();
  });

  it("records the Latga levy as an attribute rather than folding it into cost", () => {
    const attrs = mapAccProduct(SPEC_PRODUCT).attributes;
    expect(attrs.latgaValue).toBe("0.795");
    expect(mapAccProduct(SPEC_PRODUCT).price).toBe(0.75);
  });

  it("keeps per-warehouse stock visible in attributes", () => {
    expect(mapAccProduct(SPEC_PRODUCT).attributes.warehouses).toEqual(["SALES:0"]);
  });

  it("builds a gallery from Medias, ordered, with the primary picture removed", () => {
    const offer = mapAccProduct({
      ...SPEC_PRODUCT,
      Picture: "https://blobs.lt/a",
      Medias: [
        { Type: 0, Uri: "https://blobs.lt/c", Order: 3 },
        { Type: 0, Uri: "https://blobs.lt/a", Order: 1 },
        { Type: 0, Uri: "https://blobs.lt/b", Order: 2 },
      ],
    });
    expect(offer.imageUrl).toBe(`https://blobs.lt/a/${ACC_IMAGE_SIZE}`);
    expect(offer.additionalImages).toEqual([
      `https://blobs.lt/b/${ACC_IMAGE_SIZE}`,
      `https://blobs.lt/c/${ACC_IMAGE_SIZE}`,
    ]);
  });

  it("falls back to the first media when there is no Picture", () => {
    const offer = mapAccProduct({ ...SPEC_PRODUCT, Picture: null, Medias: [{ Uri: "https://blobs.lt/z", Order: 1 }] });
    expect(offer.imageUrl).toBe(`https://blobs.lt/z/${ACC_IMAGE_SIZE}`);
    expect(offer.additionalImages).toEqual([]);
  });

  it("survives an empty product without inventing values", () => {
    const offer = mapAccProduct({});
    expect(offer.supplierSku).toBeNull();
    expect(offer.price).toBeNull();
    expect(offer.stock).toBeNull();
    expect(offer.ean).toBeNull();
    expect(offer.imageUrl).toBeNull();
    expect(offer.additionalImages).toEqual([]);
  });

  it("names the source field for every value it mapped", () => {
    const keys = mapAccProduct(SPEC_PRODUCT).sourceKeys;
    expect(keys.supplierSku).toBe("PID");
    expect(keys.price).toBe("Price.Value");
    expect(keys.manufacturer).toBe("Producer.Name");
    expect(keys.imageUrl).toBe("Picture");
    // Nothing claims a field it did not fill.
    expect(keys.weightG).toBeUndefined();
  });

  it("uppercases the currency so the promote step's EUR check can match", () => {
    expect(mapAccProduct({ ...SPEC_PRODUCT, Price: { Value: 1, CurrencyCode: "eur" } }).currency).toBe("EUR");
  });
});

describe("productsFromResponse", () => {
  it("accepts the Products envelope", () => {
    expect(productsFromResponse({ Products: [{ PID: "1" }] })).toHaveLength(1);
  });

  it("accepts the OData value envelope", () => {
    expect(productsFromResponse({ value: [{ PID: "1" }, { PID: "2" }] })).toHaveLength(2);
  });

  it("accepts a single-product envelope", () => {
    expect(productsFromResponse({ Product: { PID: "1" } })).toHaveLength(1);
  });

  it("returns nothing for a body it does not recognise", () => {
    expect(productsFromResponse({ Unexpected: [1, 2] })).toEqual([]);
    expect(productsFromResponse(null)).toEqual([]);
    expect(productsFromResponse("nope")).toEqual([]);
  });
});

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
  accDescriptionFromParameters,
  accListingCondition,
  accParameterPairs,
  accSaleOutReason,
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

  it("prefers gross over net, because that is what the carrier weighs", () => {
    const params = [
      { ParameterName: "Net weight", Value: "0.0216", MeasureAbbr: "kg" },
      { ParameterName: "Gross weight", Value: "0.0272", MeasureAbbr: "kg" },
    ];
    expect(pickWeightGrams(params)).toBe(27);
    expect(pickWeightGrams([...params].reverse())).toBe(27);
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

  it("falls back to net when a product publishes no gross weight", () => {
    // Understates the parcel by the item's own packaging, which beats having
    // no weight and pricing against the shipping model's fallback.
    expect(pickWeightGrams([{ ParameterName: "Net weight", Value: "250", MeasureAbbr: "g" }])).toBe(250);
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
    // Price.LatgaValue is the price WITH the levy — not the levy itself, and
    // not our cost. Cost stays Price.Value.
    expect(attrs.priceWithLatga).toBe("0.795");
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

/**
 * Captured verbatim from a live GetProducts call on 2026-09-16 (demo licence
 * key, through the whitelisted proxy). The published specification's example
 * was lost in the document's formatting, so this is the only record of what
 * the endpoint actually returns — several fields here appear in no ACC
 * documentation we hold.
 */
const LIVE_RESPONSE = {
  "@odata.context":
    "http://api.accdistribution.net/v1/$metadata#CustomerAPI.Interfaces.DTO.Products.GetProductsResponse",
  Products: [
    {
      PID: "008031",
      MPN: "PC-186",
      EAN: "2000000651101",
      Name: "Gembird | PC-186 Power cord (C13)",
      Picture: "http://www.blobs.lt/products/1/3/0/8/0/0/bbbf39f2a6505e9e0a5c04502c8381c7",
      Producer: { OId: "gembird", Name: "Gembird" },
      Price: {
        Value: 1.99,
        OldValue: 1.99,
        LatgaValue: 1.99,
        LatgaOldValue: 1.99,
        CurrencyCode: "EUR",
        SmartPoints: null,
        SpCampaignId: null,
        IsSaleout: false,
      },
      DacPrice: null,
      Stocks: [
        {
          WhId: "SALES",
          Amount: 0.0,
          ExpectedDate: null,
          AmountArriving: 0.0,
          AmountOrdered: 0.0,
          AmountOrderedArrivingDiff: 0.0,
          IsPreliminary: false,
        },
      ],
      Rent: false,
      ByOrder: false,
      ByOrderOrig: false,
      IsNew: false,
      IsDefect: false,
      Bundle: "",
      EOLSale: false,
      HasCampaign: false,
      HasSaleOut: false,
      HasSmartPoint: false,
      HasGrade: false,
      IsEsd: false,
      LatgaValue: 0.0,
      LatgaValueType: 0.0,
      Campaigns: [],
      Saleouts: [],
      Branches: [{ OId: 1430, Name: "Accessories" }],
      Readonly: false,
      Reserve: null,
      Reserves: [],
      VisibleInB2B: true,
      UpdatedAt: "2026-09-16T13:41:10.7151938+03:00",
      Warranty: 12,
      HasBid: false,
      HasAttributes: false,
      CurrenciesPriceForQty: [],
      IntraCode: "85444290",
      CountryOfOrigin: "CN",
      ProductDimensions: [],
      QuantityPacking: 1.0,
      RRP: [],
      FullPackageShipping: false,
      CourierShippingIsForbidden: false,
    },
    {
      PID: "024153",
      MPN: "8027454",
      EAN: "8712285311420",
      Name: "Vogels | Maximum weight (capacity) 10 kg  kg",
      Picture: "http://www.blobs.lt/products/3/5/1/4/2/0/67e44ddc01e0263542dbc3c918a3cb7c",
      Producer: { OId: "vo", Name: "Vogels" },
      Price: { Value: 154.99, OldValue: 154.99, LatgaValue: 154.99, CurrencyCode: "EUR" },
      Stocks: [{ WhId: "SALES", Amount: 1.0, AmountArriving: 0.0 }],
      Branches: [
        { OId: 1464, Name: "Mounting solutions" },
        { OId: 1940, Name: "Mounting solutions" },
        { OId: 1849, Name: "Mounting solutions" },
        { OId: 1824, Name: "Mounting solutions" },
      ],
      VisibleInB2B: true,
      UpdatedAt: "2026-01-16T02:38:42.293+02:00",
      Warranty: 24,
    },
  ],
};

describe("live GetProducts response (2026-09-16)", () => {
  const products = productsFromResponse(LIVE_RESPONSE);

  it("comes back under the Products key", () => {
    // The spec never showed this envelope; the parser accepted three
    // candidates. This is the one that is real.
    expect(products).toHaveLength(2);
    expect(products[0].PID).toBe("008031");
  });

  it("rewrites the http picture host to https", () => {
    // The CRM is served over https, so an http image is blocked as mixed
    // content and the browse page renders nothing.
    const offer = mapAccProduct(products[0]);
    expect(offer.imageUrl).toBe(
      `https://www.blobs.lt/products/1/3/0/8/0/0/bbbf39f2a6505e9e0a5c04502c8381c7/${ACC_IMAGE_SIZE}`,
    );
    expect(offer.imageUrl).not.toContain("http://");
  });

  it("confirms Picture is a bare directory needing a size appended", () => {
    expect(products[0].Picture).not.toMatch(/\.(png|jpe?g)$/i);
  });

  it("carries no Medias array, so a bulk import yields one image per product", () => {
    expect((products[0] as any).Medias).toBeUndefined();
    expect(mapAccProduct(products[0]).additionalImages).toEqual([]);
  });

  it("carries no weight field anywhere", () => {
    for (const p of products) {
      const keys = Object.keys(p).join(" ").toLowerCase();
      expect(keys).not.toContain("weight");
      expect(mapAccProduct(p).weightG).toBeNull();
    }
  });

  it("keeps Price.Value as cost and does not fold the Latga levy into it", () => {
    const offer = mapAccProduct(products[0]);
    expect(offer.price).toBe(1.99);
    expect(offer.currency).toBe("EUR");
    // Price.LatgaValue is the price WITH the levy; the product-level
    // LatgaValue is the levy itself. Here the levy is zero.
    expect(offer.attributes.priceWithLatga).toBe("1.99");
    // A known-zero levy is recorded as "0"; only absent values are dropped, so
    // "no levy" and "never told us" stay distinguishable.
    expect(offer.attributes.latgaLevy).toBe("0");
  });

  it("distinguishes zero stock from unknown stock on a real row", () => {
    expect(mapAccProduct(products[0]).stock).toBe(0);
    expect(mapAccProduct(products[1]).stock).toBe(1);
  });

  it("keeps every branch when a product sits under several", () => {
    // 024153 came back under four branches, all leaf-named the same with
    // different parents. categoryPath can only hold one.
    const offer = mapAccProduct(products[1]);
    expect(offer.categoryPath).toBe("Mounting solutions");
    expect(offer.attributes.allBranches).toHaveLength(4);
  });

  it("records the shipping and visibility flags the spec never documented", () => {
    const attrs = mapAccProduct(products[0]).attributes;
    expect(attrs.visibleInB2B).toBe("true");
    expect(attrs.quantityPacking).toBe("1");
    expect(attrs.courierShippingIsForbidden).toBe("false");
    expect(attrs.fullPackageShipping).toBe("false");
    expect(attrs.intraCode).toBe("85444290");
    expect(attrs.countryOfOrigin).toBe("CN");
    expect(attrs.warrantyMonths).toBe("12");
  });

  it("maps a real row end to end without inventing anything", () => {
    const offer = mapAccProduct(products[0]);
    expect(offer.supplierSku).toBe("008031");
    expect(offer.mpn).toBe("PC-186");
    expect(offer.ean).toBe("2000000651101");
    expect(offer.manufacturer).toBe("Gembird");
    expect(offer.categoryPath).toBe("Accessories");
    expect(offer.datasheetUrl).toBeNull();
    expect(offer.productUrl).toBeNull();
  });
});

describe("pickWeightGrams against ACC's real parameter names", () => {
  it("ignores the master carton weight", () => {
    // GetProduct for PID 003192 carries both "Weight" and "Weight master
    // carton". Reading the carton's weight as the item's would overstate a
    // single patch cord by the pack quantity — 250x on that product.
    expect(
      pickWeightGrams([
        { ParameterName: "Weight master carton", Value: "6.75", MeasureAbbr: "kg" },
      ]),
    ).toBeNull();
  });

  it("picks the item weight when both are present, whatever the order", () => {
    const carton = { ParameterName: "Weight master carton", Value: "6.75", MeasureAbbr: "kg" };
    const item = { ParameterName: "Weight", Value: "0.027", MeasureAbbr: "kg" };
    expect(pickWeightGrams([carton, item])).toBe(27);
    expect(pickWeightGrams([item, carton])).toBe(27);
  });

  /** Verbatim from GetProduct for PID 003192 on 2026-09-17. */
  const REAL_PARAMS = [
    { ParameterName: "Net weight", ParameterGroupName: "Technical details", Value: "0.0216", MeasureAbbr: "kg", MeasureFraction: 0.001 },
    { ParameterName: "Gross weight", ParameterGroupName: "", Value: "0.0272", MeasureAbbr: "kg", MeasureFraction: 0.001 },
    { ParameterName: "Net weight master carton", ParameterGroupName: "Package features", Value: "5.4", MeasureAbbr: "kg", MeasureFraction: 0.001 },
    { ParameterName: "Tare weight master carton", ParameterGroupName: "Package features", Value: "0.207", MeasureAbbr: "kg", MeasureFraction: 0.001 },
    { ParameterName: "Tare weight (kg)", ParameterGroupName: "Package features", Value: "0.0056", MeasureAbbr: "kg", MeasureFraction: 0.001 },
  ];

  it("matches what ACC's own basket charges shipping on", () => {
    // The portal reported Svars 0.027 kg for this product. Gross is 0.0272.
    expect(pickWeightGrams(REAL_PARAMS)).toBe(27);
  });

  it("is not fooled by any of the four other weights on that product", () => {
    // 5.4 kg is 250 pieces, 0.207 kg is the empty carton, 0.0056 kg is the
    // item's own wrapper. Each would be wrong, and one of them by 200x.
    for (const p of REAL_PARAMS.filter((p) => p.ParameterName !== "Gross weight")) {
      if (p.ParameterName === "Net weight") continue; // legitimate fallback
      expect(pickWeightGrams([p]), p.ParameterName).toBeNull();
    }
  });

  it("does not apply MeasureFraction, which would give micrograms", () => {
    // MeasureAbbr already says kg; 0.0272 * 0.001 would be 0.0000272 kg.
    expect(pickWeightGrams([REAL_PARAMS[1]])).toBe(27);
  });

  it("confirms the arithmetic that justifies choosing gross", () => {
    // net + tare = gross, so gross is the item as it will be posted.
    expect(0.0216 + 0.0056).toBeCloseTo(0.0272, 6);
    // and 250 per carton x net = the carton's net weight
    expect(250 * 0.0216).toBeCloseTo(5.4, 6);
  });

  it("accepts a unit stated in the parameter name", () => {
    // "Weight (kg)" with an empty MeasureAbbr is still an explicit unit.
    expect(pickWeightGrams([{ ParameterName: "Weight (kg)", Value: "0.027", MeasureAbbr: null }])).toBe(27);
    expect(pickWeightGrams([{ ParameterName: "Weight (g)", Value: "27", MeasureAbbr: null }])).toBe(27);
  });

  it("still refuses a bare number even in a named-unit world", () => {
    expect(pickWeightGrams([{ ParameterName: "Weight", Value: "0.027", MeasureAbbr: null }])).toBeNull();
  });

  it("ignores other packaging weights", () => {
    for (const name of ["Package weight", "Shipping weight", "Weight pallet", "Box weight"]) {
      expect(pickWeightGrams([{ ParameterName: name, Value: "5", MeasureAbbr: "kg" }]), name).toBeNull();
    }
  });
});

describe("accParameterPairs / accDescriptionFromParameters", () => {
  /** Shape taken from GetProduct; parameter names are ACC's own. */
  const PARAMS = [
    { ParameterName: "Product family", ParameterGroupName: "Design", Value: "CD", MeasureAbbr: null, UseInDescription: true },
    { ParameterName: "Capacity", ParameterGroupName: "Performance", Value: "0.7", MeasureAbbr: "GB", UseInDescription: true },
    { ParameterName: "Write speed", ParameterGroupName: "Performance", Value: "4x - 12x", MeasureAbbr: "MB/s", UseInDescription: false },
    { ParameterName: "Warranty", ParameterGroupName: "Technical details", Value: "60", MeasureAbbr: "month(s)", UseInDescription: true },
    { ParameterName: "Tare weight master carton", ParameterGroupName: "Package features", Value: "0.207", MeasureAbbr: "kg", UseInDescription: true },
  ];

  it("turns parameters into name/value pairs with units attached", () => {
    const pairs = accParameterPairs(PARAMS);
    expect(pairs).toContainEqual({ name: "Capacity", value: "0.7 GB" });
    expect(pairs).toContainEqual({ name: "Product family", value: "CD" });
    expect(pairs).toContainEqual({ name: "Write speed", value: "4x - 12x MB/s" });
  });

  it("drops packaging parameters, which describe the box not the product", () => {
    const names = accParameterPairs(PARAMS).map((p) => p.name);
    expect(names).not.toContain("Tare weight master carton");
  });

  it("builds a description only from what ACC flags for it", () => {
    const text = accDescriptionFromParameters(PARAMS);
    expect(text).toContain("Capacity: 0.7 GB");
    expect(text).toContain("Warranty: 60 month(s)");
    // UseInDescription false
    expect(text).not.toContain("Write speed");
    // and packaging is excluded even when flagged true
    expect(text).not.toContain("master carton");
  });

  it("returns null rather than an empty description", () => {
    expect(accDescriptionFromParameters([])).toBeNull();
    expect(accDescriptionFromParameters(null)).toBeNull();
    expect(accDescriptionFromParameters([{ ParameterName: "X", Value: "1", UseInDescription: false }])).toBeNull();
  });

  it("skips a parameter with no value rather than emitting a bare label", () => {
    expect(accParameterPairs([{ ParameterName: "Colour", Value: "", MeasureAbbr: null }])).toEqual([]);
  });

  it("keeps the first of a duplicated parameter name", () => {
    const pairs = accParameterPairs([
      { ParameterName: "Colour", Value: "Purple" },
      { ParameterName: "colour", Value: "Violet" },
    ]);
    expect(pairs).toEqual([{ name: "Colour", value: "Purple" }]);
  });
});

describe("accListingCondition", () => {
  it("leaves ordinary stock as NEW with nothing to disclose", () => {
    const v = accListingCondition({ IsDefect: false, HasSaleOut: false }, []);
    expect(v.condition).toBe("NEW");
    expect(v.disclosure).toBeNull();
  });

  it("treats an unflagged product as NEW, so other suppliers are unaffected", () => {
    expect(accListingCondition(null, null).condition).toBe("NEW");
    expect(accListingCondition({}, undefined).condition).toBe("NEW");
  });

  it("lists clearance stock as NEW_OTHER and quotes the distributor", () => {
    // ACC's portal shows this as a "Saleout" line reading DAMAGED PACKAGING.
    // Publishing it as NEW is an item-not-as-described case by construction.
    const v = accListingCondition(
      { HasSaleOut: true },
      [{ ParameterName: "Saleout", Value: "DAMAGED PACKAGING" }],
    );
    expect(v.condition).toBe("NEW_OTHER");
    expect(v.disclosure).toContain("DAMAGED PACKAGING");
    expect(v.disclosure).toContain("new and unused");
  });

  it("catches a sale-out known only from the parameter", () => {
    // The flag and the parameter come from different calls; either alone is
    // enough to stop it going out as NEW.
    const v = accListingCondition({}, [{ ParameterName: "Sale out", Value: "OPENED BOX" }]);
    expect(v.condition).toBe("NEW_OTHER");
    expect(v.disclosure).toContain("OPENED BOX");
  });

  it("catches a sale-out known only from the flag", () => {
    const v = accListingCondition({ HasSaleOut: true }, []);
    expect(v.condition).toBe("NEW_OTHER");
    expect(v.disclosure).toContain("packaging");
  });

  it("ranks a defect above a sale-out", () => {
    const v = accListingCondition(
      { IsDefect: true, HasSaleOut: true },
      [{ ParameterName: "Saleout", Value: "DAMAGED PACKAGING" }],
    );
    expect(v.condition).toBe("NEW_WITH_DEFECTS");
    expect(v.disclosure).toContain("DAMAGED PACKAGING");
  });

  it("never invents a condition from an empty saleout value", () => {
    expect(accListingCondition({}, [{ ParameterName: "Saleout", Value: "" }]).condition).toBe("NEW");
  });
});

describe("accSaleOutReason", () => {
  const attrs = (o: Record<string, unknown>) => JSON.stringify(o);

  it("recognises clearance stock from the staged flags", () => {
    expect(accSaleOutReason(attrs({ hasSaleOut: "true" }))).toContain("clearance");
  });

  it("recognises defective stock, and says so specifically", () => {
    expect(accSaleOutReason(attrs({ isDefect: "true" }))).toContain("defective");
  });

  it("reports the defect when a product is both", () => {
    expect(accSaleOutReason(attrs({ isDefect: "true", hasSaleOut: "true" }))).toContain("defective");
  });

  it("passes ordinary stock through", () => {
    expect(accSaleOutReason(attrs({ hasSaleOut: "false", isDefect: "false" }))).toBeNull();
    expect(accSaleOutReason(attrs({}))).toBeNull();
    expect(accSaleOutReason(null)).toBeNull();
    expect(accSaleOutReason("")).toBeNull();
  });

  it("treats a malformed blob as ordinary rather than throwing mid-promotion", () => {
    expect(accSaleOutReason("{not json")).toBeNull();
  });

  it("is not fooled by a truthy-looking non-flag", () => {
    expect(accSaleOutReason(attrs({ hasSaleOut: "0" }))).toBeNull();
    expect(accSaleOutReason(attrs({ hasSaleOut: 1 }))).toBeNull();
  });
});

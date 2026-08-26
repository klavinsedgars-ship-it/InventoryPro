import { describe, it, expect } from "vitest";
import {
  findParameterFor,
  aspectsFromParameters,
  cleanAspectValue,
  flattenTmeParameters,
} from "./tme-aspects";

const params = [
  { name: "Manufacturer", value: "Vishay" },
  { name: "Operating voltage", value: "230V AC" },
  { name: "Tolerance", value: "5%" },
  { name: "Case", value: "SMD 0805" },
  { name: "Operating temperature", value: "-40...125°C" },
];

describe("findParameterFor", () => {
  it("matches on the exact name, ignoring case and punctuation", () => {
    expect(findParameterFor("tolerance", params)?.value).toBe("5%");
    expect(findParameterFor("Operating-Voltage", params)?.value).toBe("230V AC");
  });

  it("matches German eBay aspect labels via synonyms", () => {
    expect(findParameterFor("Marke", params)?.value).toBe("Vishay");
    expect(findParameterFor("Betriebsspannung", params)?.value).toBe("230V AC");
    expect(findParameterFor("Gehäuse", params)?.value).toBe("SMD 0805");
    expect(findParameterFor("Toleranz", params)?.value).toBe("5%");
  });

  it("returns null rather than guessing when nothing corresponds", () => {
    expect(findParameterFor("Shoe size", params)).toBeNull();
    expect(findParameterFor("", params)).toBeNull();
    expect(findParameterFor("Marke", [])).toBeNull();
  });

  it("does not let very short labels latch onto unrelated parameters", () => {
    // "Typ" is 3 chars: substring matching must not fire.
    expect(findParameterFor("Typ", [{ name: "Prototyping board", value: "yes" }])).toBeNull();
  });
});

describe("aspectsFromParameters", () => {
  it("fills free-text aspects from TME data", () => {
    const out = aspectsFromParameters(
      [{ name: "Betriebsspannung", values: [] }, { name: "Toleranz", values: [] }],
      params,
    );
    expect(out).toEqual({ Betriebsspannung: ["230V AC"], Toleranz: ["5%"] });
  });

  it("honours a constrained value list, preserving eBay's own casing", () => {
    const out = aspectsFromParameters([{ name: "Marke", values: ["VISHAY", "Bosch"] }], params);
    expect(out).toEqual({ Marke: ["VISHAY"] });
  });

  it("drops a value eBay does not permit rather than having it rejected", () => {
    const out = aspectsFromParameters([{ name: "Marke", values: ["Bosch", "Siemens"] }], params);
    expect(out).toEqual({});
  });

  it("skips aspects with no corresponding parameter", () => {
    expect(aspectsFromParameters([{ name: "Schuhgröße", values: [] }], params)).toEqual({});
  });
});

describe("cleanAspectValue", () => {
  it("collapses whitespace and caps the length", () => {
    expect(cleanAspectValue("  230V   AC \n")).toBe("230V AC");
    expect(cleanAspectValue("x".repeat(200)).length).toBe(65);
  });
});

describe("flattenTmeParameters", () => {
  it("flattens the v2 response, joining multi-value parameters", () => {
    const entry = { symbol: "W10R-4A", parameters: { elements: [
      { id: 2, name: "Manufacturer", values: [{ id: 1, value: "MIFLEX" }] },
      { id: 120, name: "Operating voltage", values: [{ id: 2, value: "230V AC" }] },
      { id: 9, name: "Mounting", values: [{ id: 3, value: "THT" }, { id: 4, value: "panel" }] },
    ]}};
    expect(flattenTmeParameters(entry)).toEqual([
      { name: "Manufacturer", value: "MIFLEX" },
      { name: "Operating voltage", value: "230V AC" },
      { name: "Mounting", value: "THT, panel" },
    ]);
  });

  it("ignores parameters with no usable value, and tolerates junk", () => {
    expect(flattenTmeParameters({ parameters: { elements: [{ name: "Empty", values: [] }] } })).toEqual([]);
    expect(flattenTmeParameters(null)).toEqual([]);
    expect(flattenTmeParameters({})).toEqual([]);
  });
});

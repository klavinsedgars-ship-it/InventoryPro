import { describe, it, expect } from "vitest";
import { extractProductSpecs, featureLines, generateUnifiedEbayTemplate } from "./ebay-unified-template";
import type { Product } from "@shared/schema";

const p = (o: Partial<Product>): Product => ({ moq: 1, ...o } as unknown as Product);

describe("extractProductSpecs", () => {
  it("does not read a measurement out of the next word", () => {
    // The live bug: "Xiaomi Mi 2 Cleaner" produced "Operating Temperature: 2°C"
    // on a published listing, because the degree sign was optional and "2 C"
    // matched the start of "Cleaner".
    const specs = extractProductSpecs(
      p({ name: "Xiaomi | Air purifier filter | MI SCG4011TW | suitable for Xiaomi Mi 2 Cleaner and Xiaomi Mi Pro Cleaner | Purple" }),
    );
    expect(specs.temperature).toBeUndefined();
    expect(specs.voltage).toBeUndefined();
    expect(specs.current).toBeUndefined();
    expect(specs.power).toBeUndefined();
  });

  it("still reads a real measurement", () => {
    const specs = extractProductSpecs(p({ name: "Power supply 12V 2A 24W 50Hz" }));
    expect(specs.voltage).toBe("12");
    expect(specs.current).toBe("2");
    expect(specs.power).toBe("24");
    expect(specs.frequency).toBe("50");
  });

  it("reads a spelled-out unit", () => {
    expect(extractProductSpecs(p({ name: "Adapter 5 Volt 2 Amp" })).voltage).toBe("5");
    expect(extractProductSpecs(p({ name: "Heater 2000 Watts" })).power).toBe("2000");
  });

  it("requires the degree sign for a temperature", () => {
    expect(extractProductSpecs(p({ name: "Sensor -40°C to 85°C" })).temperature).toBe("-40");
    expect(extractProductSpecs(p({ name: "Cable 3 Core" })).temperature).toBeUndefined();
  });

  it("ignores digits inside a part number", () => {
    // DK-1512-005 is a Digitus part code, not 1512 of anything.
    const specs = extractProductSpecs(p({ name: "Digitus | Patch Cord | DK-1512-005" }));
    expect(specs.voltage).toBeUndefined();
    expect(specs.power).toBeUndefined();
    expect(specs.current).toBeUndefined();
  });

  it("does not mistake a word beginning with a unit letter", () => {
    for (const name of ["Set of 4 Wall mounts", "Pack of 3 Adapters", "Box of 2 Valves"]) {
      const specs = extractProductSpecs(p({ name }));
      expect(specs.power, name).toBeUndefined();
      expect(specs.current, name).toBeUndefined();
      expect(specs.voltage, name).toBeUndefined();
    }
  });

  it("accepts a decimal comma, as European datasheets write it", () => {
    expect(extractProductSpecs(p({ name: "Regulator 3,3V output" })).voltage).toBe("3.3");
  });
});

describe("featureLines", () => {
  it("does not promise technical documentation for a consumer product", () => {
    const lines = featureLines("Electronics").join(" ");
    expect(lines).not.toContain("TECHNICAL DOCUMENTATION");
    expect(lines).not.toContain("ELECTRONIC COMPONENT");
    expect(lines).toContain("BRAND-NEW");
    expect(lines).toContain("30-DAY RETURN");
  });

  it("keeps the component claims for an actual component category", () => {
    const lines = featureLines("Passive Components").join(" ");
    expect(lines).toContain("ELECTRONIC COMPONENT");
    expect(lines).toContain("TECHNICAL DOCUMENTATION");
  });
});

describe("generateUnifiedEbayTemplate", () => {
  const filter = p({
    name: "Xiaomi | Air purifier filter | MI SCG4011TW | suitable for Xiaomi Mi 2 Cleaner | Purple",
    sku: "255905",
    ean: "6970244526328",
    category: "Accessories > Home Appliance > Small Domestic",
  });

  it("writes no invented specification for an unclassified product", () => {
    const t = generateUnifiedEbayTemplate(filter);
    expect(t.description).not.toContain("Operating Temperature");
    expect(t.htmlDescription).not.toContain("Operating Temperature");
  });

  it("omits the applications block rather than inventing uses", () => {
    // "Electronic circuit design / Prototyping and development" appeared under
    // an air purifier filter on a live listing.
    const t = generateUnifiedEbayTemplate(filter);
    expect(t.description).not.toContain("TYPICAL APPLICATIONS");
    expect(t.description).not.toContain("Prototyping");
    expect(t.htmlDescription).not.toContain("TYPICAL APPLICATIONS");
  });

  it("still carries the facts it actually has", () => {
    const t = generateUnifiedEbayTemplate(filter);
    expect(t.description).toContain("255905");
    expect(t.description).toContain("6970244526328");
    expect(t.description).toContain("Small Domestic");
  });

  it("keeps applications for a genuine component", () => {
    const t = generateUnifiedEbayTemplate(p({ name: "NE555 timer IC", sku: "NE555P", category: "Resistors" }));
    expect(t.description).toContain("TYPICAL APPLICATIONS");
  });
});

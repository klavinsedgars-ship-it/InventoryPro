import { describe, it, expect } from "vitest";
import { countryName, labelAddressLines } from "@shared/country-names";
import { previousStatus, revertLabel, isAllowedTransition } from "@shared/order-status";

describe("countryName", () => {
  it("spells out the destination, so a label says Germany rather than DE", () => {
    expect(countryName("DE")).toBe("Germany");
    expect(countryName("de")).toBe("Germany");
    expect(countryName("LV")).toBe("Latvia");
  });

  it("passes through an already-spelled-out name untouched", () => {
    expect(countryName("Germany")).toBe("Germany");
  });

  it("returns an unknown code rather than inventing a country", () => {
    expect(countryName("ZZ")).toBe("ZZ");
    expect(countryName("")).toBe("");
    expect(countryName(null)).toBe("");
  });
});

describe("labelAddressLines", () => {
  const order = {
    shippingName: "Max Mustermann",
    shippingAddressLine1: "Musterstraße 1",
    shippingAddressLine2: null,
    shippingCity: "Berlin",
    shippingPostalCode: "10115",
    shippingCountry: "DE",
    shippingPhone: "+49 30 123456",
  };

  it("includes the phone number, which carriers require and the label omitted", () => {
    expect(labelAddressLines(order)).toEqual([
      "Max Mustermann",
      "Musterstraße 1",
      "10115 Berlin",
      "Germany",
      "Tel: +49 30 123456",
    ]);
  });

  it("puts the postcode before the city, as European post expects", () => {
    expect(labelAddressLines(order)[2]).toBe("10115 Berlin");
  });

  it("omits empty lines rather than printing blanks", () => {
    const lines = labelAddressLines({ ...order, shippingAddressLine2: "  ", shippingPhone: null });
    expect(lines).not.toContain("");
    expect(lines.some((l) => l.startsWith("Tel:"))).toBe(false);
  });
});

describe("previousStatus / revertLabel", () => {
  it("steps back one place in the flow", () => {
    expect(previousStatus("packed")).toBe("new");
    expect(previousStatus("shipped")).toBe("packed");
    expect(previousStatus("completed")).toBe("delivered");
  });

  it("has nowhere to go back to from the first state", () => {
    expect(previousStatus("new")).toBeNull();
    expect(revertLabel("new")).toBeNull();
  });

  it("offers no automatic reverse out of a terminal state", () => {
    // Undoing a cancellation or a return is a refund decision, not a
    // packing correction.
    expect(previousStatus("cancelled")).toBeNull();
    expect(previousStatus("returned")).toBeNull();
  });

  it("labels the button with the destination", () => {
    expect(revertLabel("shipped")).toBe("Back to Packed");
  });
});

describe("isAllowedTransition", () => {
  it("permits one step forward and one step back", () => {
    expect(isAllowedTransition("new", "packed")).toBe(true);
    expect(isAllowedTransition("packed", "new")).toBe(true);
    expect(isAllowedTransition("shipped", "packed")).toBe(true);
  });

  it("rejects skipping a step", () => {
    expect(isAllowedTransition("new", "shipped")).toBe(false);
  });

  it("permits cancelling or returning from anywhere", () => {
    expect(isAllowedTransition("new", "cancelled")).toBe(true);
    expect(isAllowedTransition("shipped", "returned")).toBe(true);
  });

  it("does not block statuses the flow doesn't model", () => {
    // The eBay importer can introduce states of its own; refusing them would
    // trap an order with no way to correct it.
    expect(isAllowedTransition("awaiting_payment", "packed")).toBe(true);
  });
});

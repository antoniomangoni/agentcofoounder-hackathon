import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Attribute kinds and derived queries that no generated model has ever produced:
// boolean, date, textarea and sum-number. Their branches in RecordForm, Collection,
// FilterBar and the store are otherwise unexecuted at every layer.
vi.mock("../product-model.json", () => ({
  default: {
    title: "Ledger",
    entities: [
      {
        id: "entry",
        singular: "entry",
        plural: "entries",
        attributes: [
          { id: "label", label: "Label", kind: "text", required: true },
          { id: "amount", label: "Amount", kind: "number", required: true },
          { id: "spent", label: "Spent on", kind: "date", required: false },
          { id: "notes", label: "Notes", kind: "textarea", required: false },
          { id: "cleared", label: "Cleared", kind: "boolean", required: false },
        ],
      },
    ],
    links: [],
    journeys: [
      { kind: "add", journey: "Add an entry" },
      { kind: "edit", journey: "Edit an entry" },
      { kind: "delete", journey: "Remove an entry" },
      { kind: "filter", journey: "Show cleared entries" },
      { kind: "derive", journey: "Total amount" },
      { kind: "persist", journey: "Entries survive a refresh" },
    ],
    derived: [
      { id: "total", label: "Total amount", kind: "sum-number", entity: "entry", attribute: "amount" },
    ],
    assumptions: [],
  },
}));

const { renderApp, addRecord, rowFor, derivedValue, filterBy, expectSurvivesRefresh } =
  await import("./journeys.js");

describe("attribute kinds", () => {
  it("renders the right control for each kind", () => {
    renderApp();
    expect(screen.getByLabelText("Label")).toHaveProperty("type", "text");
    expect(screen.getByLabelText("Amount")).toHaveProperty("type", "number");
    expect(screen.getByLabelText("Spent on")).toHaveProperty("type", "date");
    expect(screen.getByLabelText("Notes").tagName).toBe("TEXTAREA");
    expect(screen.getByLabelText("Cleared")).toHaveProperty("type", "checkbox");
  });

  it("round-trips a date and a textarea through the collection", async () => {
    renderApp();
    await addRecord({ Label: "Rent", Amount: "1200", "Spent on": "2026-08-31", Notes: "monthly" });
    const row = rowFor("Rent");
    expect(within(row).getByText("2026-08-31")).toBeInTheDocument();
    expect(within(row).getByText("monthly")).toBeInTheDocument();
  });

  it("checks a boolean and shows it as Yes", async () => {
    renderApp();
    await addRecord({ Label: "Coffee", Amount: "4", Cleared: "true" });
    expect(within(rowFor("Coffee")).getByText("Yes")).toBeInTheDocument();
  });

  it("leaves an unchecked boolean blank rather than printing false", async () => {
    renderApp();
    await addRecord({ Label: "Books", Amount: "20" });
    expect(within(rowFor("Books")).queryByText("false")).not.toBeInTheDocument();
    expect(within(rowFor("Books")).queryByText("No")).not.toBeInTheDocument();
  });

  // A number input discards non-numeric keystrokes, so `value` arrives as "" and the
  // required check fires first. RecordForm's `kind === "number"` branch is therefore
  // unreachable from the UI; it stays as defence for a programmatic value only.
  it("reports garbage in a number field as missing, not malformed", async () => {
    renderApp();
    await addRecord({ Label: "Bad", Amount: "abc" });
    expect(screen.getByText("Amount is required.")).toBeInTheDocument();
    expect(screen.queryByText("Amount must be a number.")).not.toBeInTheDocument();
  });
});

describe("sum-number", () => {
  it("totals a number attribute through the binder", async () => {
    renderApp();
    expect(derivedValue("Total amount")).toBe("0");
    await addRecord({ Label: "Rent", Amount: "1200" });
    await addRecord({ Label: "Coffee", Amount: "4" });
    expect(derivedValue("Total amount")).toBe("1204");
  });

  it("ignores blank and survives a refresh", async () => {
    renderApp();
    await addRecord({ Label: "Rent", Amount: "1200" });
    await expectSurvivesRefresh(() => {
      expect(derivedValue("Total amount")).toBe("1200");
    });
  });
});

describe("boolean filter", () => {
  it("narrows to the checked rows", async () => {
    renderApp();
    await addRecord({ Label: "Coffee", Amount: "4", Cleared: "true" });
    await addRecord({ Label: "Books", Amount: "20" });
    await filterBy({ attribute: "cleared", equals: "true" });
    expect(rowFor("Coffee")).toBeTruthy();
    expect(screen.queryByText("Books")).not.toBeInTheDocument();
    await filterBy(null);
    expect(rowFor("Books")).toBeTruthy();
  });
});

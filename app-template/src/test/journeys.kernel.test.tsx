import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { filterToken, parseFilterToken } from "../composers/filter.js";

// The seed ships an empty model, so stand up a domain-neutral one to drive the
// helpers against a real render. Hoisted by Vitest ahead of the App import.
vi.mock("../product-model.json", () => ({
  default: {
    title: "Shelf",
    entities: [
      {
        id: "item",
        singular: "item",
        plural: "items",
        attributes: [
          { id: "name", label: "Name", kind: "text", required: true },
          { id: "note", label: "Note", kind: "text", required: false },
          { id: "size", label: "Size", kind: "choice", required: false, choices: ["Small", "Large"] },
        ],
      },
    ],
    links: [],
    journeys: [
      { kind: "add", journey: "Add an item" },
      { kind: "edit", journey: "Edit an item" },
      { kind: "delete", journey: "Remove an item" },
      { kind: "filter", journey: "Show items with a note" },
      { kind: "derive", journey: "Count items with a note" },
      { kind: "persist", journey: "Items survive a refresh" },
    ],
    derived: [
      {
        id: "noted",
        label: "With notes",
        kind: "count-nodes-where",
        entity: "item",
        where: { attribute: "note", present: true },
      },
    ],
    assumptions: [],
  },
}));

const journeys = await import("./journeys.js");
const { renderApp, addRecord, editRecord, removeRecord, undoRemove, rowFor, derivedValue, filterBy, expectSurvivesRefresh } =
  journeys;

describe("filter encoding", () => {
  it("round-trips every option shape", () => {
    expect(filterToken({ attribute: "note", present: true })).toBe("note|present");
    expect(filterToken({ attribute: "size", equals: "Large" })).toBe("size|=Large");
    expect(filterToken(null)).toBe("");
    expect(parseFilterToken("note|present")).toEqual({ attribute: "note", present: true });
    expect(parseFilterToken("size|=Large")).toEqual({ attribute: "size", equals: "Large" });
    expect(parseFilterToken("")).toBeNull();
  });
});

describe("journey helpers", () => {
  it("adds a record and finds its row", async () => {
    renderApp();
    await addRecord({ Name: "Lamp", Note: "spare" });
    expect(rowFor("Lamp")).toBeTruthy();
  });

  it("edits a record", async () => {
    renderApp();
    await addRecord({ Name: "Lamp" });
    await editRecord("Lamp", { Name: "Desk lamp" });
    expect(rowFor("Desk lamp")).toBeTruthy();
  });

  it("removes a record and undoes it", async () => {
    renderApp();
    await addRecord({ Name: "Lamp" });
    await removeRecord("Lamp");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    await undoRemove();
    expect(rowFor("Lamp")).toBeTruthy();
  });

  it("reads a derived value", async () => {
    renderApp();
    expect(derivedValue("With notes")).toBe("0");
    await addRecord({ Name: "Lamp", Note: "spare" });
    expect(derivedValue("With notes")).toBe("1");
  });

  it("filters without hand-built option strings", async () => {
    renderApp();
    await addRecord({ Name: "Lamp", Note: "spare" });
    await addRecord({ Name: "Rug" });
    await filterBy({ attribute: "note", present: true });
    expect(rowFor("Lamp")).toBeTruthy();
    expect(screen.queryByText("Rug")).not.toBeInTheDocument();
    await filterBy(null);
    expect(rowFor("Rug")).toBeTruthy();
  });

  it("selects a choice filter", async () => {
    renderApp();
    await addRecord({ Name: "Lamp", Size: "Large" });
    await addRecord({ Name: "Rug", Size: "Small" });
    await filterBy({ attribute: "size", equals: "Large" });
    expect(screen.queryByText("Rug")).not.toBeInTheDocument();
  });

  it("survives a refresh", async () => {
    renderApp();
    await addRecord({ Name: "Lamp" });
    await expectSurvivesRefresh(() => {
      expect(rowFor("Lamp")).toBeTruthy();
    });
  });

  it("reports required-field validation", async () => {
    renderApp();
    await addRecord({ Note: "no name" });
    expect(screen.getByText("Name is required.")).toBeInTheDocument();
  });
});

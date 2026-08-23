import { describe, expect, it } from "vitest";
import empty from "../product-model.json";
import { loadProductModel } from "./load-model.js";

describe("loadProductModel", () => {
  it("accepts the empty default model", () => {
    const loaded = loadProductModel(empty);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) expect(loaded.model.entities).toEqual([]);
  });

  it("rejects a wrong shape", () => {
    expect(loadProductModel({ title: "x" }).ok).toBe(false);
    expect(loadProductModel(null).ok).toBe(false);
    expect(loadProductModel({ title: 1, entities: [], links: [], journeys: [], derived: [], assumptions: [] }).ok).toBe(
      false,
    );
  });

  it("accepts a valid entity model", () => {
    const loaded = loadProductModel({
      title: "Items",
      entities: [
        {
          id: "item",
          singular: "item",
          plural: "items",
          attributes: [{ id: "name", label: "Name", kind: "text", required: true }],
        },
      ],
      links: [],
      journeys: [{ kind: "add", journey: "Add an item" }],
      derived: [],
      assumptions: [],
    });
    expect(loaded.ok).toBe(true);
  });
});

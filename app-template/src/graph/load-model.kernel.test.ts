import { describe, expect, it } from "vitest";
import { loadProductModel } from "./load-model.js";

const empty = {
  title: "",
  entities: [],
  links: [],
  journeys: [],
  derived: [],
  assumptions: [],
};

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
    expect(loadProductModel(itemModel()).ok).toBe(true);
  });

  it("rejects a derived query that names a missing entity", () => {
    const model = itemModel({
      derived: [{ id: "n", label: "Count", kind: "count-nodes", entity: "missing" }],
    });
    expect(loadProductModel(model).ok).toBe(false);
  });

  it("rejects a where.attribute that is not on the entity", () => {
    const model = itemModel({
      derived: [
        {
          id: "n",
          label: "Named",
          kind: "count-nodes-where",
          entity: "item",
          where: { attribute: "typo", present: true },
        },
      ],
    });
    expect(loadProductModel(model).ok).toBe(false);
  });

  it("rejects count-nodes-where without where", () => {
    const model = itemModel({
      derived: [{ id: "n", label: "Named", kind: "count-nodes-where", entity: "item" }],
    });
    expect(loadProductModel(model).ok).toBe(false);
  });

  it("rejects sum-number without a number attribute", () => {
    expect(
      loadProductModel(
        itemModel({
          derived: [{ id: "s", label: "Total", kind: "sum-number", entity: "item" }],
        }),
      ).ok,
    ).toBe(false);
    expect(
      loadProductModel(
        itemModel({
          derived: [{ id: "s", label: "Total", kind: "sum-number", entity: "item", attribute: "name" }],
        }),
      ).ok,
    ).toBe(false);
  });

  it("accepts sum-number on a number attribute", () => {
    const model = itemModel({
      entities: [
        {
          id: "item",
          singular: "item",
          plural: "items",
          attributes: [
            { id: "name", label: "Name", kind: "text", required: true },
            { id: "qty", label: "Qty", kind: "number", required: true },
          ],
        },
      ],
      derived: [{ id: "s", label: "Total", kind: "sum-number", entity: "item", attribute: "qty" }],
    });
    expect(loadProductModel(model).ok).toBe(true);
  });
});

function itemModel(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
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
    ...overrides,
  };
}

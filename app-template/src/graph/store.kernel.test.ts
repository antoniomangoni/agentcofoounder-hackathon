import { describe, expect, it } from "vitest";
import { createStore } from "./store.js";
import type { ProductModel } from "./types.js";

const model: ProductModel = {
  title: "Items",
  entities: [
    {
      id: "item",
      singular: "item",
      plural: "items",
      attributes: [
        { id: "name", label: "Name", kind: "text", required: true, unique: true },
        { id: "qty", label: "Qty", kind: "number", required: false },
        { id: "tag", label: "Tag", kind: "text", required: false },
      ],
    },
  ],
  links: [{ id: "rel", label: "Rel", from: "item", to: "item", optional: true }],
  journeys: [],
  derived: [
    { id: "all", label: "All", kind: "count-nodes", entity: "item" },
    { id: "named", label: "Named", kind: "count-nodes-where", entity: "item", where: { attribute: "tag", present: true } },
    { id: "sum", label: "Sum", kind: "sum-number", entity: "item", attribute: "qty" },
    { id: "untagged", label: "Untagged", kind: "count-nodes-where", entity: "item", where: { attribute: "tag", present: false } },
  ],
  assumptions: [],
};

describe("store", () => {
  it("upserts, deletes, and undoes a node", () => {
    const store = createStore(model);
    const added = store.apply({
      kind: "upsert-node",
      node: { id: "a", type: "item", attributes: { name: "one" } },
    });
    expect(added.ok).toBe(true);
    expect(store.query.nodes("item")).toHaveLength(1);
    const removed = store.apply({ kind: "delete-node", id: "a" });
    expect(store.query.nodes("item")).toHaveLength(0);
    if (removed.ok) removed.undo();
    expect(store.query.nodes("item")[0]?.attributes.name).toBe("one");
  });

  it("ignores a stale undo after another apply", () => {
    const store = createStore(model);
    const first = store.apply({
      kind: "upsert-node",
      node: { id: "a", type: "item", attributes: { name: "one" } },
    });
    store.apply({ kind: "upsert-node", node: { id: "b", type: "item", attributes: { name: "two" } } });
    if (first.ok) first.undo();
    expect(store.query.nodes("item")).toHaveLength(2);
  });

  it("restores incident edges when undoing delete-node", () => {
    const store = createStore(model);
    store.apply({ kind: "upsert-node", node: { id: "a", type: "item", attributes: { name: "one" } } });
    store.apply({ kind: "upsert-node", node: { id: "b", type: "item", attributes: { name: "two" } } });
    store.apply({ kind: "upsert-edge", edge: { id: "e1", type: "rel", from: "a", to: "b" } });
    const removed = store.apply({ kind: "delete-node", id: "a" });
    expect(store.query.edges("rel")).toHaveLength(0);
    if (removed.ok) removed.undo();
    expect(store.getState().nodes.some((node) => node.id === "a")).toBe(true);
    expect(store.query.edges("rel")).toHaveLength(1);
  });

  it("rejects a duplicate unique attribute without changing state", () => {
    const store = createStore(model);
    store.apply({ kind: "upsert-node", node: { id: "a", type: "item", attributes: { name: "same" } } });
    const version = store.getVersion();
    const result = store.apply({
      kind: "upsert-node",
      node: { id: "b", type: "item", attributes: { name: "same" } },
    });
    expect(result).toEqual({ ok: false, reason: "duplicate", attribute: "name" });
    expect(store.getVersion()).toBe(version);
    expect(store.query.nodes("item")).toHaveLength(1);
  });

  it("derives counts and sums", () => {
    const store = createStore(model);
    store.apply({
      kind: "upsert-node",
      node: { id: "a", type: "item", attributes: { name: "one", qty: "2", tag: "x" } },
    });
    store.apply({
      kind: "upsert-node",
      node: { id: "b", type: "item", attributes: { name: "two", qty: "3", tag: "" } },
    });
    expect(store.query.derive(model.derived[0])).toBe(2);
    expect(store.query.derive(model.derived[1])).toBe(1);
    expect(store.query.derive(model.derived[2])).toBe(5);
  });
});

// A model asked for "left to read" — the complement of a set boolean — and the query
// silently read 0, costing a whole run to debugging. Both directions are covered so the
// complement cannot regress into counting every record either.
describe("count-nodes-where present: false", () => {
  const add = (store: ReturnType<typeof createStore>, id: string, attributes: Record<string, string>): void => {
    store.apply({ kind: "upsert-node", node: { id, type: "item", attributes } });
  };

  it("counts the records where the attribute is not set", () => {
    const store = createStore(model);
    add(store, "a", { name: "Tagged", tag: "x", qty: "1" });
    add(store, "b", { name: "Bare", tag: "", qty: "2" });
    add(store, "c", { name: "Also bare", qty: "3" });
    expect(store.query.derive(model.derived[1])).toBe(1);
    expect(store.query.derive(model.derived[3])).toBe(2);
  });

  it("counts nothing when every record has the attribute set", () => {
    const store = createStore(model);
    add(store, "a", { name: "One", tag: "x" });
    add(store, "b", { name: "Two", tag: "y" });
    expect(store.query.derive(model.derived[3])).toBe(0);
  });
});

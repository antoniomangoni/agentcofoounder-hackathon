import { beforeEach, describe, expect, it, vi } from "vitest";
import { readPersisted, sanitizeSnapshot, STORAGE_KEY, writePersisted } from "./persist.js";
import type { ProductModel } from "./types.js";

const model: ProductModel = {
  title: "",
  entities: [
    {
      id: "item",
      singular: "item",
      plural: "items",
      attributes: [{ id: "name", label: "Name", kind: "text", required: true }],
    },
  ],
  links: [],
  journeys: [],
  derived: [],
  assumptions: [],
};

describe("persist", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("loads an empty snapshot when the key is missing", () => {
    expect(readPersisted(model)).toEqual({ snapshot: { nodes: [], edges: [] } });
  });

  it("treats malformed JSON and a wrong version as a recoverable error", () => {
    localStorage.setItem(STORAGE_KEY, "{");
    expect(readPersisted(model).persistError).toBeTruthy();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, snapshot: { nodes: [], edges: [] } }));
    expect(readPersisted(model).persistError).toBeTruthy();
  });

  it("drops drifted nodes and missing attribute keys", () => {
    const cleaned = sanitizeSnapshot(
      {
        nodes: [
          { id: "keep", type: "item", attributes: {} },
          { id: "gone", type: "other", attributes: { name: "x" } },
        ],
        edges: [
          { id: "e1", type: "rel", from: "keep", to: "gone" },
          { id: "e2", type: "rel", from: "keep", to: "keep" },
        ],
      },
      model,
    );
    expect(cleaned.nodes).toEqual([{ id: "keep", type: "item", attributes: { name: "" } }]);
    expect(cleaned.edges).toEqual([{ id: "e2", type: "rel", from: "keep", to: "keep" }]);
  });

  it("keeps working in memory when save throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    expect(writePersisted({ nodes: [], edges: [] })).toBeTruthy();
    vi.restoreAllMocks();
  });
});

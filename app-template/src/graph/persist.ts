import type { GraphSnapshot, ProductModel } from "./types.js";

export const STORAGE_KEY = "agent-cofounder-graph";
const BAD = "Saved data could not be read. Starting empty.";
const empty = (): GraphSnapshot => ({ nodes: [], edges: [] });

export function sanitizeSnapshot(snapshot: GraphSnapshot, model: ProductModel): GraphSnapshot {
  const types = new Set(model.entities.map((e) => e.id));
  const keys = new Map(model.entities.map((e) => [e.id, e.attributes.map((a) => a.id)]));
  const nodes = snapshot.nodes.filter((n) => types.has(n.type)).map((n) => {
    const attributes: Record<string, string> = {};
    for (const key of keys.get(n.type) ?? []) attributes[key] = n.attributes[key] ?? "";
    return { id: n.id, type: n.type, attributes };
  });
  const ids = new Set(nodes.map((n) => n.id));
  return { nodes, edges: snapshot.edges.filter((e) => ids.has(e.from) && ids.has(e.to)) };
}

export function readPersisted(model: ProductModel): { snapshot: GraphSnapshot; persistError?: string } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { snapshot: empty() };
    const parsed = JSON.parse(raw) as { version?: unknown; snapshot?: { nodes?: unknown; edges?: unknown } };
    if (parsed.version !== 1 || !Array.isArray(parsed.snapshot?.nodes) || !Array.isArray(parsed.snapshot.edges)) {
      return { snapshot: empty(), persistError: BAD };
    }
    return { snapshot: sanitizeSnapshot(parsed.snapshot as GraphSnapshot, model) };
  } catch {
    return { snapshot: empty(), persistError: BAD };
  }
}

export function writePersisted(snapshot: GraphSnapshot): string | undefined {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, snapshot }));
  } catch {
    return "Could not save. Changes stay on this page until you leave.";
  }
}

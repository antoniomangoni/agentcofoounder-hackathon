import type { ApplyResult, DerivedQuery, GraphSnapshot, NodeRecord, Op, ProductModel } from "./types.js";

export interface GraphStore {
  readonly model: ProductModel;
  persistError?: string;
  getState(): GraphSnapshot;
  getVersion(): number;
  apply(op: Op): ApplyResult;
  subscribe(listener: () => void): () => void;
  query: {
    nodes(type: string): NodeRecord[];
    nodesWhere(type: string, pred: (node: NodeRecord) => boolean): NodeRecord[];
    edges(type: string): { id: string; type: string; from: string; to: string }[];
    derive(query: DerivedQuery): number;
  };
}

const copy = (s: GraphSnapshot): GraphSnapshot => ({
  nodes: s.nodes.map((n) => ({ ...n, attributes: { ...n.attributes } })),
  edges: s.edges.map((e) => ({ ...e })),
});

let seq = 0;
const nid = (): string =>
  typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `id-${(seq += 1)}`;

export function createStore(
  model: ProductModel,
  initial: GraphSnapshot = { nodes: [], edges: [] },
  options: { persistError?: string; persist?: (s: GraphSnapshot) => string | undefined } = {},
): GraphStore {
  let state = copy(initial);
  let version = 0;
  let persistError = options.persistError;
  const listeners = new Set<() => void>();
  const emit = (): void => { for (const fn of listeners) fn(); };
  const commit = (next: GraphSnapshot): void => {
    state = next;
    version += 1;
    if (options.persist) persistError = options.persist(state) ?? undefined;
    emit();
  };
  const accept = (next: GraphSnapshot): ApplyResult => {
    const at = version + 1;
    const before = copy(state);
    commit(next);
    return { ok: true, undo: () => { if (version === at) commit(before); } };
  };

  return {
    model,
    get persistError() { return persistError; },
    getState: () => copy(state),
    getVersion: () => version,
    subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    apply(op) {
      if (op.kind === "upsert-node") {
        const node: NodeRecord = { ...op.node, id: op.node.id || nid(), attributes: { ...op.node.attributes } };
        const entity = model.entities.find((e) => e.id === node.type);
        for (const attr of entity?.attributes ?? []) {
          const value = node.attributes[attr.id] ?? "";
          if (attr.unique && value && state.nodes.some((o) => o.id !== node.id && o.type === node.type && o.attributes[attr.id] === value)) {
            return { ok: false, reason: "duplicate", attribute: attr.id };
          }
        }
        const nodes = state.nodes.some((n) => n.id === node.id)
          ? state.nodes.map((n) => (n.id === node.id ? node : n))
          : [...state.nodes, node];
        return accept({ nodes, edges: state.edges });
      }
      if (op.kind === "delete-node") {
        if (!state.nodes.some((n) => n.id === op.id)) return { ok: true, undo: () => undefined };
        return accept({
          nodes: state.nodes.filter((n) => n.id !== op.id),
          edges: state.edges.filter((e) => e.from !== op.id && e.to !== op.id),
        });
      }
      if (op.kind === "upsert-edge") {
        const edge = { ...op.edge, id: op.edge.id || nid() };
        const edges = state.edges.some((e) => e.id === edge.id)
          ? state.edges.map((e) => (e.id === edge.id ? edge : e))
          : [...state.edges, edge];
        return accept({ nodes: state.nodes, edges });
      }
      if (!state.edges.some((e) => e.id === op.id)) return { ok: true, undo: () => undefined };
      return accept({ nodes: state.nodes, edges: state.edges.filter((e) => e.id !== op.id) });
    },
    query: {
      nodes: (type) => state.nodes.filter((n) => n.type === type),
      nodesWhere: (type, pred) => state.nodes.filter((n) => n.type === type && pred(n)),
      edges: (type) => state.edges.filter((e) => e.type === type),
      derive(query) {
        const nodes = state.nodes.filter((n) => n.type === query.entity);
        if (query.kind === "count-nodes") return nodes.length;
        if (query.kind === "sum-number") return nodes.reduce((sum, n) => sum + (Number(n.attributes[query.attribute ?? ""]) || 0), 0);
        return nodes.filter((n) => {
          const value = n.attributes[query.where?.attribute ?? ""] ?? "";
          if (query.where?.equals !== undefined) return value === query.where.equals;
          return !query.where?.present || value !== "";
        }).length;
      },
    },
  };
}

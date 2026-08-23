import { createContext, useContext, useMemo, useRef, useSyncExternalStore, type ReactNode } from "react";
import { readPersisted, writePersisted } from "./persist.js";
import { createStore, type GraphStore } from "./store.js";
import type { NodeRecord, ProductModel } from "./types.js";

const GraphContext = createContext<GraphStore | null>(null);

export function GraphProvider({ model, children }: { model: ProductModel; children: ReactNode }) {
  const storeRef = useRef<GraphStore | null>(null);
  if (!storeRef.current) {
    const loaded = readPersisted(model);
    storeRef.current = createStore(model, loaded.snapshot, { persistError: loaded.persistError, persist: (s) => writePersisted(s, model.title) });
  }
  return <GraphContext.Provider value={storeRef.current}>{children}</GraphContext.Provider>;
}

export function useGraph(): GraphStore {
  const store = useContext(GraphContext);
  if (!store) throw new Error("useGraph requires GraphProvider");
  return store;
}

const useVersion = (store: GraphStore): number =>
  useSyncExternalStore(store.subscribe, store.getVersion, store.getVersion);

export function useNodes(type: string): NodeRecord[] {
  const store = useGraph();
  const version = useVersion(store);
  return useMemo(() => store.query.nodes(type), [store, version, type]);
}

export function useDerived(id: string): number {
  const store = useGraph();
  const version = useVersion(store);
  return useMemo(() => {
    const query = store.model.derived.find((item) => item.id === id);
    return query ? store.query.derive(query) : 0;
  }, [store, version, id]);
}

export function usePersistError(): string | undefined {
  const store = useGraph();
  useVersion(store);
  return store.persistError;
}

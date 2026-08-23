import { useEffect, useState } from "react";
import { useSyncExternalStore } from "react";
import { useGraph, useNodes } from "../graph/GraphProvider.js";
import type { EntityType, NodeRecord, Undo } from "../graph/types.js";
import type { FilterValue } from "./filter.js";

export function Collection({
  entity,
  filter,
  canEdit,
  canDelete,
  onEdit,
}: {
  entity: EntityType;
  filter?: FilterValue;
  canEdit?: boolean;
  canDelete?: boolean;
  onEdit?: (node: NodeRecord) => void;
}) {
  const store = useGraph();
  const version = useSyncExternalStore(store.subscribe, store.getVersion, store.getVersion);
  const nodes = useNodes(entity.id).filter((node) => {
    if (!filter) return true;
    const value = node.attributes[filter.attribute] ?? "";
    if (filter.equals !== undefined) return value === filter.equals;
    if (filter.present) return value !== "";
    return true;
  });
  const [pending, setPending] = useState<{ undo: Undo; at: number; label: string } | null>(null);

  useEffect(() => {
    if (pending && version !== pending.at) setPending(null);
  }, [pending, version]);

  function remove(node: NodeRecord) {
    const result = store.apply({ kind: "delete-node", id: node.id });
    if (result.ok) {
      setPending({ undo: result.undo, at: store.getVersion(), label: `Removed ${entity.singular}` });
    }
  }

  return (
    <section>
      <h2>{entity.plural}</h2>
      {nodes.length === 0 ? <p>No {entity.plural} yet.</p> : null}
      {nodes.length > 0 ? (
        <table>
          <thead>
            <tr>
              {entity.attributes.map((attr) => (
                <th key={attr.id} scope="col">
                  {attr.label}
                </th>
              ))}
              {canEdit || canDelete ? <th scope="col">Actions</th> : null}
            </tr>
          </thead>
          <tbody>
            {nodes.map((node) => (
              <tr key={node.id}>
                {entity.attributes.map((attr) => (
                  <td key={attr.id}>{node.attributes[attr.id] === "true" ? "Yes" : node.attributes[attr.id]}</td>
                ))}
                {canEdit || canDelete ? (
                  <td>
                    {canEdit ? (
                      <button type="button" onClick={() => onEdit?.(node)}>
                        Edit {entity.singular}
                      </button>
                    ) : null}
                    {canDelete ? (
                      <button type="button" onClick={() => remove(node)}>
                        Remove {entity.singular}
                      </button>
                    ) : null}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {pending ? (
        <p role="status">
          {pending.label}{" "}
          <button
            type="button"
            onClick={() => {
              pending.undo();
              setPending(null);
            }}
          >
            Undo
          </button>
        </p>
      ) : null}
    </section>
  );
}

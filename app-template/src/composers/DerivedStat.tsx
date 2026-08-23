import { useDerived } from "../graph/GraphProvider.js";
import type { DerivedQuery } from "../graph/types.js";

export function DerivedStat({ query }: { query: DerivedQuery }) {
  const value = useDerived(query.id);
  return (
    <p>
      <span>{query.label}</span> <strong>{value}</strong>
    </p>
  );
}

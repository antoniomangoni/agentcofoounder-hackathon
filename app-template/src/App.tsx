import { useState } from "react";
import { AppShell } from "./composers/AppShell.js";
import { Collection } from "./composers/Collection.js";
import { DerivedStat } from "./composers/DerivedStat.js";
import type { FilterValue } from "./composers/filter.js";
import { FilterBar } from "./composers/FilterBar.js";
import { RecordForm } from "./composers/RecordForm.js";
import { GraphProvider, usePersistError } from "./graph/GraphProvider.js";
import { loadProductModel } from "./graph/load-model.js";
import type { NodeRecord, ProductModel } from "./graph/types.js";
import raw from "./product-model.json";

const loaded = loadProductModel(raw);

function BoundApp({ model }: { model: ProductModel }) {
  const kinds = new Set(model.journeys.map((journey) => journey.kind));
  const persistError = usePersistError();
  const [filters, setFilters] = useState<Record<string, FilterValue>>({});
  const [editing, setEditing] = useState<NodeRecord | undefined>();

  return (
    <AppShell title={model.title} persistError={persistError}>
      {kinds.has("derive")
        ? model.derived.map((query) => <DerivedStat key={query.id} query={query} />)
        : null}
      {kinds.has("filter")
        ? model.entities.map((entity) => (
            <FilterBar
              key={entity.id}
              entity={entity}
              value={filters[entity.id] ?? null}
              onChange={(value) => setFilters((current) => ({ ...current, [entity.id]: value }))}
            />
          ))
        : null}
      {kinds.has("add") || kinds.has("edit")
        ? model.entities.map((entity) => (
            <RecordForm
              key={`${entity.id}:${editing?.type === entity.id ? editing.id : "new"}`}
              entity={entity}
              editing={editing?.type === entity.id ? editing : undefined}
              onClearEdit={() => setEditing(undefined)}
            />
          ))
        : null}
      {model.entities.map((entity) => (
        <Collection
          key={entity.id}
          entity={entity}
          filter={filters[entity.id] ?? null}
          canEdit={kinds.has("edit")}
          canDelete={kinds.has("delete")}
          onEdit={setEditing}
        />
      ))}
    </AppShell>
  );
}

export function App() {
  if (!loaded.ok) {
    return <AppShell message="The product definition could not be read." />;
  }
  if (loaded.model.entities.length === 0) {
    return <AppShell title={loaded.model.title} />;
  }
  return (
    <GraphProvider model={loaded.model}>
      <BoundApp model={loaded.model} />
    </GraphProvider>
  );
}

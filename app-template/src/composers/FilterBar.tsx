import type { EntityType } from "../graph/types.js";
import { filterToken, parseFilterToken, type FilterValue } from "./filter.js";

export function FilterBar({
  entity,
  value,
  onChange,
}: {
  entity: EntityType;
  value: FilterValue;
  onChange: (value: FilterValue) => void;
}) {
  const options: { token: string; label: string }[] = [];
  for (const attr of entity.attributes) {
    if (attr.kind === "choice") {
      for (const choice of attr.choices ?? []) {
        options.push({
          token: filterToken({ attribute: attr.id, equals: choice }),
          label: `${attr.label}: ${choice}`,
        });
      }
    } else if (attr.kind === "boolean") {
      options.push({ token: filterToken({ attribute: attr.id, equals: "true" }), label: attr.label });
    } else if (!attr.required) {
      options.push({ token: filterToken({ attribute: attr.id, present: true }), label: `${attr.label} present` });
    }
  }
  if (options.length === 0) return null;
  return (
    <p>
      <label>
        Show {entity.plural}{" "}
        <select value={filterToken(value)} onChange={(event) => onChange(parseFilterToken(event.target.value))}>
          <option value="">All</option>
          {options.map((option) => (
            <option key={option.token} value={option.token}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    </p>
  );
}

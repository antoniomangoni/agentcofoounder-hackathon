import type { EntityType } from "../graph/types.js";
import type { FilterValue } from "./filter.js";

function token(filter: FilterValue): string {
  if (!filter) return "";
  if (filter.equals !== undefined) return `${filter.attribute}|=${filter.equals}`;
  if (filter.present) return `${filter.attribute}|present`;
  return "";
}

function parse(value: string): FilterValue {
  if (!value) return null;
  const [attribute, rest] = value.split("|");
  if (!attribute || !rest) return null;
  if (rest === "present") return { attribute, present: true };
  if (rest.startsWith("=")) return { attribute, equals: rest.slice(1) };
  return null;
}

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
        options.push({ token: `${attr.id}|=${choice}`, label: `${attr.label}: ${choice}` });
      }
    } else if (attr.kind === "boolean") {
      options.push({ token: `${attr.id}|=true`, label: attr.label });
    } else if (!attr.required) {
      options.push({ token: `${attr.id}|present`, label: `${attr.label} present` });
    }
  }
  if (options.length === 0) return null;
  return (
    <p>
      <label>
        Show {entity.plural}{" "}
        <select value={token(value)} onChange={(event) => onChange(parse(event.target.value))}>
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

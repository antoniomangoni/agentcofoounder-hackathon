export type FilterValue = { attribute: string; present?: boolean; equals?: string } | null;

/**
 * The one encoding for a filter selection. `FilterBar` uses it for its `<option>`
 * values and the journey helpers use it to pick one, so there is a single spelling.
 */
export function filterToken(filter: FilterValue): string {
  if (!filter) return "";
  if (filter.equals !== undefined) return `${filter.attribute}|=${filter.equals}`;
  if (filter.present) return `${filter.attribute}|present`;
  return "";
}

export function parseFilterToken(value: string): FilterValue {
  if (!value) return null;
  const [attribute, rest] = value.split("|");
  if (!attribute || !rest) return null;
  if (rest === "present") return { attribute, present: true };
  if (rest.startsWith("=")) return { attribute, equals: rest.slice(1) };
  return null;
}

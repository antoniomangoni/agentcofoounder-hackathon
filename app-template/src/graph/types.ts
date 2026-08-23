export type AttributeKind = "text" | "textarea" | "choice" | "number" | "boolean" | "date";

export interface AttributeType {
  id: string;
  label: string;
  kind: AttributeKind;
  required: boolean;
  unique?: boolean;
  choices?: string[];
}

export interface EntityType {
  id: string;
  singular: string;
  plural: string;
  attributes: AttributeType[];
}

export interface LinkType {
  id: string;
  label: string;
  from: string;
  to: string;
  optional: boolean;
}

export type JourneyKind = "add" | "edit" | "delete" | "filter" | "derive" | "persist";
export interface Journey { kind: JourneyKind; journey: string; }
export type DerivedKind = "count-nodes" | "count-nodes-where" | "sum-number";
export interface DerivedQuery {
  id: string;
  label: string;
  kind: DerivedKind;
  entity: string;
  attribute?: string;
  where?: { attribute: string; present?: boolean; equals?: string };
}

export interface ProductModel {
  title: string;
  entities: EntityType[];
  links: LinkType[];
  journeys: Journey[];
  derived: DerivedQuery[];
  assumptions: string[];
}

export interface NodeRecord { id: string; type: string; attributes: Record<string, string>; }
export interface EdgeRecord { id: string; type: string; from: string; to: string; }
export interface GraphSnapshot { nodes: NodeRecord[]; edges: EdgeRecord[]; }
export type Op =
  | { kind: "upsert-node"; node: NodeRecord }
  | { kind: "delete-node"; id: string }
  | { kind: "upsert-edge"; edge: EdgeRecord }
  | { kind: "delete-edge"; id: string };
export type Undo = () => void;
export type ApplyResult = { ok: true; undo: Undo } | { ok: false; reason: "duplicate"; attribute: string };

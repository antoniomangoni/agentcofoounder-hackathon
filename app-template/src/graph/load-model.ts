import type { ProductModel } from "./types.js";

const ATTR = new Set(["text", "textarea", "choice", "number", "boolean", "date"]);
const JOURNEY = new Set(["add", "edit", "delete", "filter", "derive", "persist"]);
const DERIVED = new Set(["count-nodes", "count-nodes-where", "sum-number"]);

const rec = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const arr = <T,>(v: unknown, f: (x: unknown) => x is T): v is T[] => Array.isArray(v) && v.every(f);
const str = (v: unknown): v is string => typeof v === "string";

function isAttr(v: unknown): v is Record<string, unknown> {
  return (
    rec(v) &&
    str(v.id) &&
    str(v.label) &&
    ATTR.has(String(v.kind)) &&
    typeof v.required === "boolean" &&
    (v.unique === undefined || typeof v.unique === "boolean") &&
    (v.choices === undefined || arr(v.choices, str))
  );
}

function isEntity(v: unknown): v is Record<string, unknown> {
  return rec(v) && str(v.id) && str(v.singular) && str(v.plural) && arr(v.attributes, isAttr);
}

function isLink(v: unknown): v is Record<string, unknown> {
  return rec(v) && str(v.id) && str(v.label) && str(v.from) && str(v.to) && typeof v.optional === "boolean";
}

function isJourney(v: unknown): v is Record<string, unknown> {
  return rec(v) && JOURNEY.has(String(v.kind)) && str(v.journey);
}

function isDerived(v: unknown): v is Record<string, unknown> {
  if (!rec(v) || !str(v.id) || !str(v.label) || !DERIVED.has(String(v.kind)) || !str(v.entity)) return false;
  if (v.attribute !== undefined && !str(v.attribute)) return false;
  if (v.where === undefined) return true;
  return (
    rec(v.where) &&
    str(v.where.attribute) &&
    (v.where.present === undefined || typeof v.where.present === "boolean") &&
    (v.where.equals === undefined || str(v.where.equals))
  );
}

export type LoadedModel = { ok: true; model: ProductModel } | { ok: false };

export function loadProductModel(raw: unknown): LoadedModel {
  if (!rec(raw) || !str(raw.title)) return { ok: false };
  if (!arr(raw.entities, isEntity) || !arr(raw.links, isLink)) return { ok: false };
  if (!arr(raw.journeys, isJourney) || !arr(raw.derived, isDerived) || !arr(raw.assumptions, str)) return { ok: false };
  return { ok: true, model: raw as unknown as ProductModel };
}

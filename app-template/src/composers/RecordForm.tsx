import { useState, type FormEvent } from "react";
import { useGraph } from "../graph/GraphProvider.js";
import type { AttributeType, EntityType, NodeRecord } from "../graph/types.js";

function emptyValues(entity: EntityType, node?: NodeRecord): Record<string, string> {
  const values: Record<string, string> = {};
  for (const attr of entity.attributes) values[attr.id] = node?.attributes[attr.id] ?? "";
  return values;
}

function Field({
  attr,
  value,
  error,
  onChange,
}: {
  attr: AttributeType;
  value: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  const id = `field-${attr.id}`;
  const describedBy = error ? `${id}-error` : undefined;
  const common = {
    id,
    name: attr.id,
    required: attr.required,
    "aria-invalid": Boolean(error) || undefined,
    "aria-describedby": describedBy,
  };
  let control;
  if (attr.kind === "textarea") {
    control = <textarea {...common} value={value} onChange={(event) => onChange(event.target.value)} />;
  } else if (attr.kind === "choice") {
    control = (
      <select {...common} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Select</option>
        {(attr.choices ?? []).map((choice) => (
          <option key={choice} value={choice}>
            {choice}
          </option>
        ))}
      </select>
    );
  } else if (attr.kind === "boolean") {
    control = (
      <input
        {...common}
        type="checkbox"
        required={false}
        checked={value === "true"}
        onChange={(event) => onChange(event.target.checked ? "true" : "")}
      />
    );
  } else {
    const type = attr.kind === "number" ? "number" : attr.kind === "date" ? "date" : "text";
    control = <input {...common} type={type} value={value} onChange={(event) => onChange(event.target.value)} />;
  }
  return (
    <div className="field">
      <label htmlFor={id}>{attr.label}</label>
      {control}
      {error ? (
        <p id={`${id}-error`} className="field-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function RecordForm({
  entity,
  editing,
  onClearEdit,
}: {
  entity: EntityType;
  editing?: NodeRecord;
  onClearEdit?: () => void;
}) {
  const store = useGraph();
  const [values, setValues] = useState(() => emptyValues(entity, editing));
  const [errors, setErrors] = useState<Record<string, string>>({});

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const result = store.apply({
      kind: "upsert-node",
      node: { id: editing?.id ?? "", type: entity.id, attributes: values },
    });
    if (!result.ok) {
      const attr = entity.attributes.find((item) => item.id === result.attribute);
      setErrors({ [result.attribute]: `That ${attr?.label ?? result.attribute} is already used.` });
      return;
    }
    setErrors({});
    setValues(emptyValues(entity));
    onClearEdit?.();
  }

  return (
    <form onSubmit={onSubmit}>
      <h2>{editing ? `Edit ${entity.singular}` : `Add ${entity.singular}`}</h2>
      {entity.attributes.map((attr) => (
        <Field
          key={attr.id}
          attr={attr}
          value={values[attr.id] ?? ""}
          error={errors[attr.id]}
          onChange={(value) => setValues((current) => ({ ...current, [attr.id]: value }))}
        />
      ))}
      <button type="submit">{editing ? `Save ${entity.singular}` : `Add ${entity.singular}`}</button>
      {editing ? <button type="button" onClick={onClearEdit}>Cancel</button> : null}
    </form>
  );
}

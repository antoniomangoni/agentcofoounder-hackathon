---
name: mvp-builder
description: Turn a non-technical product idea into a small, tested browser application while recording assumptions.
---

# MVP Builder

1. Decide record-keeping vs escape hatch. Record the decision in `assumptions`.
   If the idea is not a collection of records (quiz, timer, calculator, multi-step wizard, canvas, etc.):
   - Do **not** invent entities to satisfy the kernel.
   - Leave or ignore `product-model.json`.
   - Replace `App.tsx` with a purpose-built UI.
   - Keep the kernel on disk; unused code is fine.
   - Add Testing Library tests for the journeys the idea actually implies.
2. If record-keeping: extract ProductGraph (entities, attributes, journeys, derived values, assumptions). A second entity exists only if the idea treats that thing as its own record. Write `src/product-model.json` only. Do not rewrite `src/graph/`. Do not edit `App.tsx` unless a journey the model names is missing from the shipped binder. Shape:

```json
{
  "title": "Shelf",
  "entities": [
    {
      "id": "item",
      "singular": "item",
      "plural": "items",
      "attributes": [
        { "id": "name", "label": "Name", "kind": "text", "required": true },
        { "id": "note", "label": "Note", "kind": "text", "required": false }
      ]
    }
  ],
  "links": [],
  "journeys": [
    { "kind": "add", "journey": "Add an item and see it in the list" },
    { "kind": "persist", "journey": "Items survive a refresh" }
  ],
  "derived": [
    {
      "id": "noted-count",
      "label": "With notes",
      "kind": "count-nodes-where",
      "entity": "item",
      "where": { "attribute": "note", "present": true }
    }
  ],
  "assumptions": []
}
```

FilterBar options (do not open composer source): optional text → `{label} present`; boolean → the attribute label; choice → `{label}: {choice}`. That is how “has a note” / “currently out” is expressed.
3. Read only `src/graph/types.ts`, `src/product-model.json`, and `src/App.tsx`. Do not invent a parallel architecture. Do not open `store.ts`, `persist.ts`, `GraphProvider.tsx`, or composer modules unless a kernel test fails.
4. Implement accessible controls, validation, empty states, errors, and responsive layout. Handle duplicate or repeated actions, boundary values, malformed stored data, and recoverable storage or runtime failures where relevant.
5. Keep components focused, separate concerns, and avoid duplication so another developer or agent can extend the app without a rewrite. Use only the dependencies already installed from the committed lockfile. Do not add packages or run dependency-install commands.
6. Add one Testing Library file covering every implied journey and any observable behavior the model does not capture. For `persist`, remount `<App />` and assert the data survived. Do not read `localStorage` keys or open `persist.ts`. Use each `journey` string later in `tests_run`.
7. Run `npm test` and `npm run build` only. Do not run `npm run dev`. Repair failures. Every committed test must run and pass; do not leave skipped or todo tests. Startup and assumptions reporting are runner obligations, not UI test journeys.
8. Write `report.partial.json` with this exact shape:

```json
{
  "status": "success",
  "app_url": "http://localhost:3000",
  "start_command": "npm run dev",
  "summary": "Short description of the application",
  "implemented_features": ["Feature"],
  "assumptions": ["Ambiguity and the decision made"],
  "tests_run": [
    {
      "command": "npm test",
      "journey": "User-visible behaviour that was verified",
      "result": "passed"
    }
  ]
}
```

Use `success` only when `tests_run` contains at least one user journey and every entry passed. Use `partial` when useful functionality remains incomplete or any journey failed or was not run, and `failed` when the app cannot run. Never invent a passing test.
Use only `passed` or `failed` for each test result. Record an unrun check as `failed` and explain why in its journey.
9. Do not write `result.json`.

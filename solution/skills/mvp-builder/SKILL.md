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
2. If record-keeping: extract ProductGraph (entities, attributes, journeys, derived values, assumptions). A second entity exists only if the idea treats that thing as its own record. Write `src/product-model.json` only. Do not rewrite `src/graph/`.
3. Bind composers in `App.tsx` from `journeys[]`. Labels come from the model. Do not invent a parallel architecture. Read `src/graph/types.ts`, `src/product-model.json`, `src/App.tsx`, and composer prop types only. Do not open `store.ts` / `persist.ts` / `GraphProvider.tsx` unless a kernel test fails.
4. Implement accessible controls, validation, empty states, errors, and responsive layout. Handle duplicate or repeated actions, boundary values, malformed stored data, and recoverable storage or runtime failures where relevant.
5. Keep components focused, separate concerns, and avoid duplication so another developer or agent can extend the app without a rewrite. Use only the dependencies already installed from the committed lockfile. Do not add packages or run dependency-install commands.
6. Add one Testing Library test file per implied `Journey.kind` — and for any observable behavior the model does not capture. `persist` remounts (or equivalent) and asserts data survived. Use each `journey` string later in `tests_run`.
7. Run `npm test` and `npm run build`. Repair failures. Every committed test must run and pass; do not leave skipped or todo tests. Startup and assumptions reporting are runner obligations, not UI test journeys.
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

Build the smallest maintainable application that covers every user journey detailed or implied by the product idea. Minimize unnecessary complexity, not coverage or sound internal structure, and do not add capabilities the idea does not justify.

Work autonomously in the current directory. Do not ask clarifying questions. Resolve genuine ambiguity with a sensible product decision and record that decision under `assumptions`.

Required outcome:

- Start with `npm run dev` at exactly `http://localhost:3000`.
- Responsive, accessible, no external services or login. Required user data survives a refresh.
- If the idea is record-keeping, write `src/product-model.json` and bind the shipped composers; do not invent a parallel architecture. If it is not a collection of records, replace `App.tsx` instead of inventing entities.
- Handle empty and invalid input, duplicate or repeated actions, boundary cases, malformed persisted data, and recoverable storage failures where relevant.
- Use only lockfile dependencies. Do not add packages.
- Implement and run Testing Library tests for every observable user journey. Never omit an implied journey merely to simplify the application. Keep tests in `src/**/*.test.ts` or `src/**/*.test.tsx`. Kernel tests are already excluded from `npm test`.
- Before finishing, run `npm test` and `npm run build`, then write `report.partial.json` as described in `AGENTS.md`.
- Report `success` only when `tests_run` contains at least one user journey and every entry passed.
- Do not write `result.json`.

# Generated application contract

- Keep the application self-contained and startable with `npm run dev` at `http://localhost:3000`. The outer runner starts the server; do not run `npm run dev` yourself.
- Store durable single-user browser data locally when persistence is required.
- Prefer semantic HTML and accessible names so browser automation can use the interface without brittle selectors.
- Add tests for the product's critical user journeys and run them before claiming success.
- The seed ships domain-neutral kernel tests that are excluded from `npm test`. Every test the app actually runs is one you wrote. Add at least one completed, passing `src/**/*.test.ts` or `src/**/*.test.tsx` test; the runner rejects zero-test reports and any skipped or todo tests. `success` still requires `tests_run` entries that name user journeys, not store internals.
- If the idea is record-keeping: write `src/product-model.json` as soon as you can state it; do not explore composers first; take labels from the model; do not rewrite `src/graph/`. `App.tsx` already binds composers from `journeys[]` — do not edit it unless a named journey is missing from that binder.
- If the idea is not a collection of records (quiz, timer, calculator, multi-step wizard, canvas, etc.): do not invent entities to satisfy the kernel; leave or ignore `product-model.json`; write a compiling `App.tsx` skeleton first (real controls wired to state; behaviour may be TODO), then fill; keep the kernel on disk; unused code is fine; record the choice in `assumptions`.
- Whenever you can state what a file should contain, write it in that same message.
- Product tests are Testing Library journeys in one file. Kernel tests already exist and must stay excluded from `npm test`. Persist: remount `<App />` and assert the data survived; do not read `localStorage` keys. For countdowns or intervals, drive tests with `fireEvent` and `vi.advanceTimersByTime`. Do not pair `userEvent` with fake timers — the click hangs until the test times out.
- Use only the dependencies already installed from the committed lockfile. Do not add packages or run dependency-install commands.
- `report.partial.json` contains only `status`, `app_url`, `start_command`, `summary`, `implemented_features`, `assumptions`, and `tests_run`.
- A `success` report must contain at least one `tests_run` entry and every entry must be `passed`. If a journey failed or was not run, record it as `failed`, explain why in `journey`, and use `partial` (or `failed` when the app cannot run).
- The runner owns the final `app_url`, location-aware `start_command`, independent `harness_checks`, and telemetry fields. Your product-journey test records remain in the specification-defined `tests_run` field.
- Do not create or edit `result.json`; the outer challenge runner derives its telemetry from Pi.

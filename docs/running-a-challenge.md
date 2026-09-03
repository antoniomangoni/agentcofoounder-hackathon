# Running a challenge

A short runbook for anyone doing a measured run. `README.md` covers what the runner
produces; this covers how to invoke it without losing the run.

## One run at a time

**A challenge run holds an exclusive lock.** Starting a second one while the first is alive
fails immediately:

```
Another challenge run is in progress (pid 592279, started 2026-08-26T20:44:00.000Z,
idea docs/personal/eval/timer.txt, output output/app).
Runs share the output tree, port 3000 and result.json, so they cannot overlap — wait for it to finish.
If that process is gone, delete /path/to/output/.challenge.lock
```

The refusal happens before any file is touched, so the running job is unharmed and exits 1.

This is not a precaution. On 25 August 2026 two timer runs overlapped: the second run's startup
deleted the first run's work tree, then its `App.tsx` overwrote the first run's. The first run
spent 4.2 of its 15 minutes diagnosing and recovering, and was killed one call short of writing
its report — after reaching 9/9 passing tests and a green build.

`--output-dir` does **not** make runs safe to overlap. Port 3000 and the repository-root
`result.json` are shared no matter which output directory each run uses.

### The lock file

`output/.challenge.lock`, JSON, holding the pid, start time, idea file and output directory. It
is gitignored, created on acquire and removed on normal exit, on `SIGINT` / `SIGTERM` / `SIGHUP`,
and on process exit.

A lock left behind by a killed process is cleared automatically: the next run checks whether the
recorded pid is still alive and takes over if it is not. Delete the file by hand only if the
message names a pid you know is gone and the takeover did not happen.

## Run

Node 22 is required — Node 18 dies in Pi on `import … with { type: "json" }`, and older Node
cannot load the pinned Vitest.

```bash
node --version          # expect v22.x
npm run challenge
```

Override the idea with `--idea-file /path/to/idea.txt`. For a setup-only check that calls no
model, `npm run challenge -- --prepare-only`.

Credentials come from the environment; Pi reads its own provider key. `CHALLENGE_MODEL`,
`CHALLENGE_THINKING` and `CHALLENGE_TIMEOUT_MS` (default 900000, a 15-minute wall-clock kill of
the Pi child) select the runtime.

## Snapshot before the next run

`prepareOutput` deletes and re-seeds the output directory at the **start** of every run. The
generated app is not archived anywhere else, so anything you want to keep must be copied out
before you launch the next one:

```bash
cp result.json <somewhere>/<name>-result.json
rsync -a --exclude node_modules --exclude dist output/app/ <somewhere>/app-<name>/
```

## Where the evidence is

- `result.json` — repository root and `output/app/`. Flat schema: `call_log`, `model_calls`,
  `truncated`, `cost_total` are all top level.
- `artifacts/runs/<timestamp>/` — `events.jsonl` (token-level stream), `sessions/*.jsonl` (one
  entry per assistant message, with `usage` and `stopReason`), `pi.stderr.log`, `idea.txt`.

Two things worth measuring are only in `sessions/*.jsonl`, never in `result.json`: the per-call
`thinking` character count, and which call made the first write.

A run killed at the timeout exits 124. Whether the harness checks (Vitest, build, port probe)
still run depends on what the run left behind. `canVerifyApp` accepts a run that was stopped
early — out of wall clock, or stopped for runaway token spend — as long as it made at least one
model call, its final assistant message was not truncated, and `report.partial.json` names at
least one journey (`src/run-challenge.ts:343-345`). Such a run is verified normally and then
degraded to `partial`; it can never report `success`.

A run that was stopped early and left no journeys, or whose final message was truncated, is not
verified at all. It still lists all three checks, because the schema cannot say "not run", but
each one reads `failed`. So a "failed" harness line is ambiguous on its own: read `truncated` and
`tests_run` first to tell a skipped check from a broken app.

## The judged environment

What the organizers confirmed for the Starter Repo Track, and what was verified here against it.

**Entry point.** `npm run challenge` is what they run. The BYO tracks document their own command;
this track does not.

**Platform: `linux/arm64`.** Judging happens on Apple Silicon. Nothing here ships a compiled
binary, and both lockfiles carry the full platform matrix — `@esbuild/linux-arm64` and
`@rollup/rollup-linux-arm64-gnu` are present alongside their x64 counterparts, so `npm ci`
resolves the right ones per platform. The base image, `node:22.19.0-bookworm-slim`, publishes
arm64. No architecture-specific work is required. This was checked by reading the lockfiles, not
by building on arm64: buildx and qemu were unavailable on the development machine.

**Network: open at build, closed at run apart from the model provider.** This matters more than
it looks, because a judged run installs dependencies before Pi is ever invoked —
`npm ci --ignore-scripts --prefer-offline` in the generated app (`src/run-challenge.ts:296`).
`--prefer-offline` prefers the cache but will still reach for the registry if something is
missing, so a cold cache on a closed network would kill every run before the first model call.

It does not, because the cache is warm. `Dockerfile` sets `npm_config_cache=/challenge/.npm-cache`
and populates it with `npm --prefix app-template ci` at build time, and the generated app is a
copy of `app-template` carrying the same lockfile. Verified by installing that lockfile with
strict `--offline`, which fails rather than falling back: 167 packages, exit 0. Nothing in the
run path fetches anything else.

**The image is what they execute.** "We run what you submit, your Dockerfile and your runtime" —
the checklist's "organizer-controlled runtime" line is the contradiction they said they would fix.
So `Dockerfile` runs on their machine and anything in it is a build gate.

That is why the image no longer runs `npm run check` verbatim. It runs the same suite minus
`test/verify-app.test.ts`, whose seven cases spawn real Vite servers in a temp directory against
`serverTimeoutMs` budgets of 1, 2 and 10 seconds. They are the only timing-dependent tests here and
they pass locally, but a flake inside an image build fails the build outright — an unjudgeable
submission rather than a lower score. The remaining gate is `tsc`, the six deterministic root test
files (77 tests), the 43 kernel tests and the production build, none of which depend on wall clock.
Run the full `npm run check`, `verify-app` included, outside the image.

**Audit artifacts.** The submission asks for "trace.jsonl". This harness emits
`artifacts/runs/<timestamp>/events.jsonl` (the raw JSON event stream) and `sessions/*.jsonl`
(the Pi session), which are the two artifacts `docs/organizer-checklist.md` requires. Ship both;
the name differs, the content is what is asked for.

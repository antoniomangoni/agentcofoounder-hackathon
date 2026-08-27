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

A run killed at the timeout exits 124, and the harness checks (Vitest, build, port probe) do not
run — `canVerifyApp` requires `pi.exitCode === 0`. A "failed" harness line on a timed-out run
means the checks were skipped, not that the app is broken.

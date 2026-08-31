# Storage

How the generated app saves data. Evaluation and decision record, companion to [`implementation.md`](implementation.md). The follow-ups it recommended are applied and listed at the end.

## Decision

**`localStorage`, a single versioned JSON envelope, under a key derived per product.** All three are shipped in [`persist.ts`](../app-template/src/graph/persist.ts); the key basis is applied below.

This is not a preference between reasonable alternatives. Of everything else on the table, each option is either excluded by a contract this design may not edit, or disqualified by the pinned test environment. The interesting part of the evaluation is *which* constraint kills each option, because they die differently and two of them die for reasons that are not obvious.

The question that prompted this — "the app will need a database, probably Supabase" — is the right instinct for a normal product and the wrong one here, for a reason worth stating plainly: **the generated app is not a product with users. It is a single-user artefact that a judge opens once, on one machine, in one browser, possibly with no network.** Under [`contract-public/development-idea.txt`](../contract-public/development-idea.txt) the user says so in as many words — "It’s just me using it on my own computer."

## What has to be true

The options are scored against requirements that already exist in the repo, not against taste.

| # | Requirement | Source |
| --- | --- | --- |
| **C1** | Required data survives a browser refresh | [`journeys.md:11`](../contract-public/journeys.md) behavior 5; [`system-prompt.md:8`](../solution/system-prompt.md) |
| **C2** | The `persist` journey test runs and passes under the pinned jsdom + Testing Library | [`SKILL.md`](../solution/skills/mvp-builder/SKILL.md) step 6; `success` requires every `tests_run` entry to have passed ([`AGENTS.md:13`](../app-template/AGENTS.md)) |
| **C3** | No new npm packages | [`AGENTS.md:11`](../app-template/AGENTS.md), [`system-prompt.md:11`](../solution/system-prompt.md); enforced mechanically by `npm ci --ignore-scripts --prefer-offline` ([`run-challenge.ts:246`](../src/run-challenge.ts)) against a committed lockfile |
| **C4** | No network, no credentials | Pi runs `--offline` ([`run-challenge.ts:206`](../src/run-challenge.ts)); judged submissions run with "bounded CPU, memory, disk, time, and network access" ([`README.md:110`](../README.md)); "Never commit credentials" ([`README.md:42`](../README.md)) |
| **C5** | One process, started by `npm run dev`, reachable at `http://localhost:3000` | [`verify-app.ts:218-220`](../src/verify-app.ts) spawns exactly that command and probes that port. Nothing starts a second process |
| **C6** | Minimal Pi token cost | Ranking uses Pi’s reported runtime cost. Storage plumbing is tokens spent for no Application Readiness gain |
| **C7** | Fits the kernel line budget | `graph/` excluding tests ≤ 302 lines ([`implementation.md:329`](implementation.md#size-budget)) — **currently 302** |
| **C8** | Malformed and drifted stored data degrade recoverably | [`system-prompt.md:10`](../solution/system-prompt.md); `SKILL.md` step 4 |

C3, C4 and C5 are the hard ones: each is enforced by code that runs, not by an instruction a model might ignore.

> **Note, 31 August 2026.** The seed now carries one dependency, `@picocss/pico` (classless CSS, pinned `2.1.1`). That does not reopen C3, and nothing in this document changes. C3 constrains **the model**: `AGENTS.md` and `system-prompt.md` still tell Pi not to add packages, and `npm ci` against a committed lockfile still enforces it mechanically. What changed is the lockfile itself — precisely the "change to the seed, not to the generated app" that the Tier 2 section below already distinguishes. The storage libraries stay rejected because they fail C2 (no IndexedDB under jsdom), C4 (offline, no credential path) or C5 (one process) *independently* of the package question, and a stylesheet imported once in `main.tsx` inherits none of those. See [`implementation.md` § Out of scope](implementation.md#out-of-scope) for the test a dependency has to pass: its model-facing API must be zero.

## Tier 1 — zero new dependencies

Browser built-ins. The only tier where anything is actually available.

| Option | C1 refresh | C2 jsdom | C7 lines | Verdict |
| --- | --- | --- | --- | --- |
| **`localStorage`** | ✅ | ✅ present | shipped, 39 | **Chosen** |
| `sessionStorage` | ⚠️ partial | ✅ present | same | Rejected on risk |
| `IndexedDB` | ✅ | ❌ **absent** | +40–60 async | **Disqualified** |
| Cache API | ✅ | ❌ absent | — | Out |
| File System Access API | ✅ | ❌ absent | — | Out |
| Cookies | ✅ | ✅ | — | Out |
| URL hash / query string | ⚠️ | ✅ | — | Out |
| In-memory only | ❌ | ✅ | −39 | Fails C1 |

**`localStorage`** meets every criterion. Synchronous, so the store commits and the save happen in one turn with no reconciliation problem; string-only, which the `{ version: 1, snapshot }` envelope already handles; roughly 5 MB per origin, against an MVP holding tens of records. It is also the option the seed contract names directly: "Store durable single-user browser data locally when persistence is required" ([`AGENTS.md:4`](../app-template/AGENTS.md)).

**`sessionStorage`** survives F5 — so it satisfies C1 as literally written — but is cleared when the tab closes. A judge who opens the app, closes the tab, and reopens it sees an empty application and no way to tell that from a broken one. Same API, same line cost, strictly more failure modes. Rejected because the risk is asymmetric, not because the letter of C1 excludes it.

**`IndexedDB`** is the only serious alternative, and the pinned environment decides it. jsdom 27.1.0 ships **no IndexedDB at all** — `window.indexedDB` is `undefined`, and the string `indexeddb` appears zero times in `node_modules/jsdom/lib`. `SKILL.md` step 6 requires a `persist` journey test that remounts and asserts the data survived; a `success` report requires every `tests_run` entry to have passed. So choosing IndexedDB does not degrade the app — it makes a required journey test unrunnable, which blocks `success` outright. It also costs async plumbing through a store that is currently synchronous end to end, against a kernel with zero lines of headroom. Disqualified by **C2**, with C6 and C7 as reinforcement.

The rest fail immediately: the **Cache API** and the **File System Access API** are both absent from jsdom (and the latter needs a user gesture and is Chromium-only), **cookies** cap at ~4 KB and ride on every request, and the **URL hash** is size-limited and turns the address bar into the database.

## Tier 2 — needs a package

Supabase (`@supabase/supabase-js`), Firebase, Dexie, `idb`, `sql.js` / `wa-sqlite`, PouchDB, RxDB, TinyBase, Yjs.

All of them fail **C3**, by the same mechanism, and it is worth being precise about the mechanism because it is not a policy someone could waive locally. The generated workspace is installed with `npm ci --ignore-scripts --prefer-offline` ([`run-challenge.ts:246`](../src/run-challenge.ts)) against the committed [`app-template/package-lock.json`](../app-template/package-lock.json) — 209 packages, none of them a storage library. `npm ci` installs the lockfile and nothing else. Pi additionally runs `--offline` ([`run-challenge.ts:206`](../src/run-challenge.ts)), and both [`AGENTS.md:11`](../app-template/AGENTS.md) and [`system-prompt.md:11`](../solution/system-prompt.md) tell the model not to add packages or run install commands. Adding a dependency would mean regenerating a committed lockfile — a change to the seed, not to the generated app — and would still leave every other constraint below in force.

The IndexedDB-backed and WASM-backed members of this list (Dexie, `idb`, `sql.js`, PouchDB, RxDB) fail **C2** as well, for the reason in tier 1: there is no IndexedDB under jsdom for them to sit on.

## Tier 3 — a backend

Two sub-cases. They fail differently, and the second is the non-obvious one.

**Hosted (Supabase, Firebase, any managed Postgres).** Fails C3 as above, and then fails **C4** twice over independently of the package question. Pi runs offline. Judged submissions run in a container with bounded network access, so a hosted backend is a coin-flip on whether the judge sees an application at all — and the failure mode is the worst available: the app starts, the probe passes, and the UI is empty or spinning. There is also no delivery mechanism for the credentials. `.env` files are not loaded by the runner ([`README.md:42`](../README.md)), committing them is prohibited by the same line, and the run receives no storage-related environment variables. A Supabase anon key is a published credential by design, but "publishable" is not the same as "committable to a repository that organizers freeze and redistribute". Finally, C6: every line of client plumbing is Pi tokens spent against the ranked metric for zero readiness points.

**A hand-rolled Node server.** This one deserves its own entry because it defeats the constraint everyone reaches for first: `node:http` is built in, so a small API server needs **no package at all**, and C3 does not stop it. It fails on **C5** instead. `npm run dev` starts Vite and nothing else, and [`verify-app.ts:218-220`](../src/verify-app.ts) spawns exactly that one command and probes port 3000. The runner's other spawns are the Vitest and build runs, which exit; no second long-lived process is started, and the harness terminates the whole process group afterwards. So a server-backed app would work perfectly in development and have a dead data layer during the only run that is scored. Changing that means changing `dev` to a concurrent two-process script and changing what the runner starts — and [`src/`](../src/) changes are out of scope for v1 ([`implementation.md:566`](implementation.md#out-of-scope)).

## Rejected shape — a `StorageAdapter` abstraction

Worth naming because it is the instinct behind "we’ll need a database": keep `localStorage` for now, but hide it behind an interface so a real backend can be swapped in later.

Rejected. The kernel is at 302 of 302 lines (C7), and [`implementation.md:333`](implementation.md#size-budget) already rules on this case: "If the kernel grows past the budget, delete features; do not add a query language." An adapter spends real lines buying portability to a set of backends that C3, C4 and C5 each independently forbid. The seam it creates has exactly one implementation and no possible second one within v1. If the constraints ever lift, `persist.ts` is 39 lines and `readPersisted` / `writePersisted` are already the whole surface the store depends on — the seam can be introduced at that point in about as many lines as it would cost now, and with knowledge of what the second implementation actually needs.

## Key basis

`localStorage` is the decision. The remaining choice is what to key it under, and there is a defect in the current answer.

**The defect.** `STORAGE_KEY` is a module constant, `"agent-cofounder-graph"` ([`persist.ts:3`](../app-template/src/graph/persist.ts)). Every generated app is served from the same origin — `dev` and `preview` both pin `--port 3000 --strictPort` ([`app-template/package.json`](../app-template/package.json)) — and `localStorage` is scoped per origin. So every run and every submission shares one bucket:

- our own evaluation sequence, three ideas run back to back in one browser profile, reuses it;
- a judge evaluating several submissions at `http://localhost:3000` reuses it.

`sanitizeSnapshot` softens this: nodes whose `type` is not an entity in the current model are dropped, which covers most cross-idea contamination. It does not cover two models that share an entity id — and `item` is both the id used in the kernel test and the obvious id for a pantry, a stock list, an inventory. Those nodes survive the filter, and `attributes[key] = n.attributes[key] ?? ""` then fills every unmatched attribute with an empty string rather than rejecting the record. The result is phantom rows with blank fields, on first load, with **no** `persistError` — because [§Persist](implementation.md#persist-persistts) deliberately treats model drift as silent tolerance ("the user never caused it"), which is the right call for drift within one product and the wrong one for data belonging to a different product entirely.

That is an Application Readiness risk on the ~100-point axis, it is non-deterministic, and it depends on browser state we do not control.

**The fix**, three ways:

| Basis | Lines | Behaviour |
| --- | --- | --- |
| **Title slug** (recommended) | ~2 | `agent-cofounder-graph:<slug(model.title)>`. Isolates different products. `sanitizeSnapshot` keeps handling attribute drift within one product, so §Persist’s stated model-drift behaviour is unchanged |
| Title + entity ids | ~4 | Also isolates an entity rename mid-run. Attribute changes still fall through to the sanitizer |
| Full model-shape hash | ~8 | Any drift at all orphans the old key. The sanitizer’s drift path becomes near-dead code and its kernel test vestigial — a large behavioural change to a kernel with no headroom |

**Title slug**, for the split it produces: the *key* separates different products, the *sanitizer* handles drift inside one product. Each mechanism does one job, and neither is made redundant. Empty title falls back to the bare constant `agent-cofounder-graph`, byte-identical to the previous key. A punctuation-only title slugs to empty and does the same. This is not an escape-hatch concern: that path replaces `App.tsx` and never mounts `GraphProvider`, so `persist.ts` does not run.

**Budget, stated honestly.** Applied: the ceiling was raised by exactly two lines to 302 for this key. The delete-features rule at [`implementation.md:333`](implementation.md#size-budget) was waived once and must not be waived again. [§Links may be dead weight](implementation.md#links-may-be-dead-weight) remains a separate decision and was not compacted here.

## What would change this

A real database becomes the right answer when three things are simultaneously true, and none is in reach for v1:

1. a judged idea genuinely implies multiple users sharing state, rather than one person on one machine;
2. the lockfile is no longer frozen, or a storage client is added to the seed’s committed dependencies;
3. the judging container has network access, and credentials have a delivery path that does not require committing them.

Until then, an idea that *implies* sharing is handled the way the contract already prescribes: build it single-user, and record the limitation in `assumptions`. [`journeys.md:13`](../contract-public/journeys.md) and [`system-prompt.md:3`](../solution/system-prompt.md) both require exactly that, so no prompt change is needed to cover the case.

## Recommended follow-ups

Applied.

1. **Fix the contradictory constraint.** Applied: [`implementation.md:27`](implementation.md#goal-and-judging-fit) now excludes a backend or external API unconditionally and points here. The previous hedge ("unless the idea requires one") was unbuildable and contradicted both [`implementation.md:564`](implementation.md#out-of-scope) and [`system-prompt.md:8`](../solution/system-prompt.md).
2. **Apply the key fix.** Applied in [`persist.ts`](../app-template/src/graph/persist.ts): `storageKey(title)`, a kernel test that two models do not see each other’s data, and a 302-line ceiling.
3. **No prompt or skill change.** Applied as a non-edit. [`system-prompt.md`](../solution/system-prompt.md) already carries "no external services or login" and "Use only lockfile dependencies".

## Reproducing the facts

On Node 22.19.x, after `npm --prefix app-template ci --ignore-scripts`. The jsdom probe resolves `jsdom` from the app workspace, so it runs from `app-template/`; the rest run from the repository root.

```bash
# jsdom web-storage surface. Expect object, object, undefined, undefined, undefined
cd app-template && node -e "
const { JSDOM } = require('jsdom');
const w = new JSDOM('', { url: 'http://localhost:3000' }).window;
for (const k of ['localStorage','sessionStorage','indexedDB','caches','showSaveFilePicker'])
  console.log(k.padEnd(20), typeof w[k]);
"
```

```bash
# No IndexedDB anywhere in the pinned jsdom
grep -ri indexeddb app-template/node_modules/jsdom/lib | wc -l                    # 0

# Kernel size against the 300-line budget
(cd app-template/src/graph && cat $(ls *.ts *.tsx | grep -v kernel.test) | wc -l) # 302

# Top-level packages in the app lockfile, and storage libraries among them
node -e "const l=require('./app-template/package-lock.json');
  console.log(Object.keys(l.packages)
    .filter((p) => p.startsWith('node_modules/') && !p.slice(14).includes('node_modules/')).length)"   # 209
grep -Ec 'supabase|dexie|pouchdb|rxdb|sql\.js' app-template/package-lock.json     # 0
```

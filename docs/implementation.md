# Graph-composed MVP harness

Spec for a later coding pass. No kernel, prompt, or runner changes land until that pass.

Two layers, both domain-neutral:

- **Compile-time ProductGraph** — Pi extracts the idea into a JSON model (entities, attributes, journeys, derived values, assumptions).
- **Runtime graph** — a tiny in-browser store plus composers. Idea vocabulary is data on the model. The UI is a normal product, not a graph explorer.

Inspired by [*A Programming Paradigm for Spatiotemporal Composability*](spatiotemporal-composability.pdf) (Shi, Zhang, Cui) without porting Cordis. That paper is a preprint under active revision; this design borrows its vocabulary, not its results. [Paper mapping](#paper-mapping) states what the harness actually earns.

## Goal and judging fit

Official judging uses a **hidden idea** and private browser journeys. The committed book-lending prompt in [`contract-public/development-idea.txt`](../contract-public/development-idea.txt) is a development placeholder only. Ranked evaluation is **GLM-5.2 on Berget**; ranking uses **Pi’s reported runtime cost**. Application Readiness (~100 points) is separate and not yet weighted against efficiency.

| Axis | How this design helps | How it can fail |
| --- | --- | --- |
| **Readiness** | Composers render forms, lists, filters, counts with semantic HTML and names taken from the model | Shipping a node/edge explorer, or forcing a fake graph onto a non-record product |
| **Efficiency** | Kernel and composers ship in [`app-template/`](../app-template/) so Pi writes a model and bindings, not an architecture | A large kernel that Pi reads end-to-end; long prompts that dump paper theory. **Unproven until the [baseline](#baseline-first--before-the-coding-pass) is measured** |
| **Hidden idea** | Reusable APIs use only generic types (`EntityType`, `LinkType`, `JourneyKind`) | Book/lending words in kernel, composers, or skills |
| **Audit** | [`src/run-challenge.ts`](../src/run-challenge.ts) still writes both `result.json` files; the model never writes telemetry | Changing `result.json` ownership, skipping harness checks, or [padding the app’s test run with seed tests](#tests) so `numTotalTests > 0` no longer proves Pi wrote one |

Constraints that stay fixed in v1:

- One Pi call. The runner still owns both `result.json` files. It records `stop_reason` / `truncated` from Pi’s event stream and skips app verification when the **final** assistant message was truncated. It does not change `composeResult` status rules. The appended system prompt remains a cacheable GLM-5.2 prefix.
- `CHALLENGE_THINKING` stays `off` unless a later measurement shows reasoning pays for itself.
- No new npm packages. No backend or external API; see [`storage.md`](storage.md).
- Node 22.19.x, Pi `@earendil-works/pi-coding-agent@0.84.1`.

## Architecture

```mermaid
flowchart LR
  idea[Idea file] --> pi[Single Pi call]
  prompt[system-prompt + journeys + AGENTS.md] --> pi
  pi --> model[src/product-model.json]
  kernel[app-template graph kernel] --> provider[GraphProvider]
  model --> binder[App.tsx binder]
  binder --> provider
  provider --> composers[Form Collection Filter Derived]
  composers --> app[http://localhost:3000]
  model --> tests[Testing Library journeys]
```

- **Compile-time graph:** `src/product-model.json` is the plan the rest of the run executes.
- **Runtime store:** one in-memory graph, one persistence key per product, one React context (`GraphProvider`). Composers do not own stores.
- **v1 runner:** prepares `output/app/` from `app-template/`, appends [`solution/system-prompt.md`](../solution/system-prompt.md) + [`contract-public/journeys.md`](../contract-public/journeys.md) + `output/app/AGENTS.md` (the copy of [`app-template/AGENTS.md`](../app-template/AGENTS.md) made by `prepareOutput`), and loads [`solution/skills/mvp-builder`](../solution/skills/mvp-builder/SKILL.md) plus [`solution/extensions/protected-paths.ts`](../solution/extensions/protected-paths.ts). The usage collector also copies `message.stopReason` onto `call_log` and sets `truncated` when an assistant call hit `length`. That is the only runner carve-out.

### Proposed file tree (later coding pass)

```
app-template/
  vitest.config.ts           # excludes **/*.kernel.test.ts
  vitest.kernel.config.ts    # includes only **/*.kernel.test.ts
  src/
    graph/
      types.ts               # ProductModel + store types
      load-model.ts          # JSON → ProductModel | InvalidModel
      store.ts               # apply / undo / query / version counter
      persist.ts             # localStorage key + malformed payload
      GraphProvider.tsx      # one context, one store, useSyncExternalStore hooks
      store.kernel.test.ts   # domain-neutral kernel tests
      persist.kernel.test.ts
      load-model.kernel.test.ts
    composers/
      AppShell.tsx
      RecordForm.tsx
      Collection.tsx
      FilterBar.tsx
      DerivedStat.tsx
    product-model.json       # valid empty default; Pi replaces
    App.tsx                  # binder
    main.tsx                 # unchanged entry
```

Pi’s writable surface after copy: `src/product-model.json`, optional binder tweaks in `App.tsx`, product tests under `src/**/*.test.tsx`, and `report.partial.json`. Pi should not rewrite kernel internals.

That boundary is **prompt-enforced only**. [`solution/extensions/protected-paths.ts`](../solution/extensions/protected-paths.ts) blocks writes outside the app root and to `.git`, `node_modules`, `result.json`, and `.env*` — nothing stops Pi editing `src/graph/`. Do not add a hard block: it would trap Pi in a repair loop and contradicts the [escape hatch](#escape-hatch), which explicitly allows abandoning the kernel. Measure adherence instead (see [Later eval](#later-eval-and-follow-ups)).

## ProductGraph schema

[`contract-public/journeys.md`](../contract-public/journeys.md) is a **coverage check**, not a feature shopping list. Implement a pattern only when the idea details or implies it. Omit the rest and record why in `assumptions`.

### Types (`src/graph/types.ts`)

```ts
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

export interface Journey {
  kind: JourneyKind;
  /** User-visible sentence for tests_run[].journey */
  journey: string;
}

export type DerivedKind = "count-nodes" | "count-nodes-where" | "sum-number";

export interface DerivedQuery {
  id: string;
  label: string;
  kind: DerivedKind;
  entity: string;
  /** Attribute id summed by sum-number */
  attribute?: string;
  /** Attribute id on the entity; used by count-nodes-where */
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
```

Attribute-kind notes:

- All attribute values are stored as strings. `boolean` stores `"true"` or `""`, so `where.present` reads it without a second predicate. `date` stores `YYYY-MM-DD`, which sorts and compares as text.
- `boolean` and `date` exist because record-keeping ideas outside the book placeholder usually need a done-checkbox or a due date (task lists, bookings, habits, subscriptions). Forcing those into a `choice` of `["Yes", "No"]` costs readiness with a browser judge for no saving.
- `sum-number` covers the “total spent / total value / hours this week” family, which is as common in this idea space as a count.

`count-links` is deliberately absent from `DerivedKind`. See [Links may be dead weight](#links-may-be-dead-weight).

Empty default `src/product-model.json`:

```json
{
  "title": "",
  "entities": [],
  "links": [],
  "journeys": [],
  "derived": [],
  "assumptions": []
}
```

Runtime graph instance (not written by Pi; owned by the store):

```ts
export interface NodeRecord {
  id: string;
  type: string;
  attributes: Record<string, string>;
}

export interface EdgeRecord {
  id: string;
  type: string;
  from: string;
  to: string;
}

export interface GraphSnapshot {
  nodes: NodeRecord[];
  edges: EdgeRecord[];
}
```

## Decisions

### Model format: JSON + typed loader

**Pick: `src/product-model.json` plus `loadProductModel(raw: unknown)`.**

Vite can import a committed valid JSON file so `npm run build` and `--prepare-only` stay green. The loader validates *shape* and *references* at runtime: every `derived.entity` must name an entity, `derived.attribute` / `derived.where.attribute` must name an attribute on that entity, `sum-number` must point at a `number` attribute, and `count-nodes-where` must have `where`. Broken refs are the invalid-model shell, not a silent `0` from `store.derive`. `links[].from` / `links[].to` are not checked — there is no composer path for links. No config change is needed: [`app-template/tsconfig.json`](../app-template/tsconfig.json) already sets `resolveJsonModule: true`.

| Failure | Outcome |
| --- | --- |
| Invalid JSON syntax | `tsc` / Vite build fails; Pi repairs the file |
| Valid JSON, wrong shape or broken derived refs | App still builds and starts; binder shows the invalid-model state |
| Valid TS object, wrong types | Would fail `tsc` and is harder for Pi to repair than JSON |

**The reference checks are unexercised.** No Pi run has produced a model that fails them. The four attempts against the seed that carries these checks (pantry ×2, timer ×2) all truncated before writing anything; the two earlier runs predate the checks. Two properties of the loader matter more than the checks until one does fire:

- The **empty seed passes.** `title: ""` is a valid string and empty arrays satisfy every reference check, so `loadProductModel` returns `ok` on an untouched `product-model.json`. A run that wrote a good model and a run that never wrote at all are indistinguishable here; `truncated` separates them, not the loader.
- A rejection is **silent about why.** `{ ok: false }` carries no reason and no field name, so Pi has to read `load-model.ts` and bisect its own model. That is the repair-loop shape that cost book-1 and book-2 their runs, on a path nothing has walked yet.

Rejected: `product-model.ts` as the Pi artifact. Type errors and import syntax waste repair tokens.

### Links vs attributes

**A second entity exists only if the idea treats that thing as its own record** — something the user independently adds, edits, lists, or deletes.

- A scribbled name, tag, or status on the primary record is an **attribute**.
- A **link** connects two entity types that both appear as records in the idea.
- Do not invent a `Person` (or similar) node so a name can be an edge.

The book-lending placeholder notes a borrower’s name and clears it on return. That is an optional text attribute, not a Person entity. See [Worked example](#worked-example-book-lending-placeholder).

### Links may be dead weight

The rule above is correct and strict — strict enough that most single-user MVP ideas will produce `links: []`, as the worked example does. That leaves the kernel carrying `EdgeRecord`, two edge ops, the incident-edge cascade, and `edges(type)` with no real journey exercising any of it, all charged against the [size budget](#size-budget).

v1 keeps `EdgeRecord` and the two edge ops. The delete cascade is the one genuine demonstration of revertible effects, and it is cheap. `count-links` is dropped from `DerivedKind` because a count over an empty edge set is not a derived value any product will ask for.

**Decision rule:** if all three [eval ideas](#later-eval-and-follow-ups) produce `links: []`, cut edges from v1 entirely and describe the result honestly — a model-driven record store, not a graph. The framing is worth less than the lines.

**The rule cannot fire as written.** Only book has ever produced a model — three runs, `links: []` each time. Pantry and timer truncated before writing one, so two of the three data points do not exist and will not exist without a contract change that gets this model writing earlier. Re-state the rule over the models that exist, or hold it until a run finishes on a second idea; do not read the missing data as agreement.

### Revertible effects: one undo, not a history

`apply(op)` returns an `undo` function. Specified first as purely internal — “composer teardown, replacing an edit, clearing a field” — it then had no caller anywhere in this document. Those are all *forward* ops: an edit is an `upsert-node`, clearing a field is an `upsert-node` with `""`. [Persist](#persist-persistts) declines the one remaining candidate, keeping a write in memory rather than reverting it when the save fails. An inverse nothing invokes is lines charged against the [size budget](#size-budget) to support a claim in the [paper mapping](#paper-mapping).

v1 gives it exactly one call site: **a single undo on destructive delete.**

- `Collection`’s delete row action applies `delete-node` and holds the returned `undo` in local component state.
- It renders `Removed {singular}` and an **Undo** button in a `role="status"` live region, so the affordance is announced and not merely visible. Wording comes from the model — “Removed book”, never “Removed node”.
- The held `undo` is discarded on the next store version change. That one line is what keeps the inverse sound; see [Store](#store-storets).
- No new `JourneyKind`. This rides on `delete`. A product test may assert it; the skill must not require one.

This is a product affordance for accidental data loss — something a browser judge is likely to try — and it is the only place a user meets the kernel’s central mechanism. It is not an undo stack. Still out of scope: undo **history**, multi-step undo, redo, and undo on non-destructive actions, none of it unless the idea implies history.

### Empty or invalid model

The app must still start at `http://localhost:3000` and pass `npm run build`.

- **Empty model** (`entities.length === 0`, valid JSON): `AppShell` with the model `title` if any, otherwise a short ready-state. No graph jargon. Copy stays product-neutral, e.g. “Ready to build.” This is the seed / `--prepare-only` path.
- **Invalid model** (wrong shape, or a derived query that fails the [reference checks](#model-format-json--typed-loader)): same shell plus a recoverable message that the product definition could not be read. Do not crash the tree.
- Official challenge runs must not stay on these states; Pi writes a real model or takes the [escape hatch](#escape-hatch). **Six Qwen runs have anyway** (pantry ×3, timer ×3), every one a `stop_reason: length` dump before the first write. They land on the *empty* state, which is valid — the loader returns `ok` — so nothing in the app can detect it. `truncated` and the `harness_checks[].journey` prefix are what report it.

### Escape hatch

The five public journeys describe **record-keeping** patterns. The hidden idea may not.

If the idea is not a collection of records (quiz, timer, calculator, multi-step wizard, canvas, etc.):

1. Do **not** invent entities to satisfy the kernel.
2. Leave or ignore `product-model.json`.
3. Replace `App.tsx` with a purpose-built UI.
4. Keep the kernel on disk; unused code is fine.
5. Record the choice in `assumptions`.
6. Add Testing Library tests for the journeys the idea actually implies.

The skill must say this in those words. Forcing a fake graph will lose readiness.

What “unused code is fine” costs, stated so the coding pass does not rediscover it:

- `npm run build` runs `tsc --noEmit` with `include: ["src", ...]`, so an abandoned kernel is still typechecked. Unused kernel code must compile on its own — no unresolved imports, no reliance on a binder that no longer exists.
- The empty default `product-model.json` still imports and parses cleanly, so an untouched model file never breaks the build.
- Kernel tests do **not** pad the app’s test run, because they are excluded (see [Tests](#tests)). Without that exclusion, a timer app with zero product tests would pass every harness check on the strength of the seed’s own tests — the escape hatch is the case where that failure is most likely and least visible.

**The hatch has never been reached.** Three timer runs ended in a 16,384-token dump before `App.tsx` was replaced. Pi did not invent timer entities in any of them, which is the good half: the hatch was abandoned, not faked. But the two claims this section exists to protect — that an abandoned kernel still typechecks, and that the test exclusion stops the seed’s own tests from carrying an app with none of its own — still have no finished-app evidence behind them.

This is also the one place the design earns the paper’s withdrawal guarantee outright: the kernel is a component that can be removed whole, leaving a system that still builds and runs as though it had never been there. It holds at the file level, across a build — which is why the [mapping](#paper-mapping) keeps it separate from runtime temporal composability.

## Runtime kernel

No-dep module under `app-template/src/graph/`. Domain-neutral identifiers only.

### Store (`store.ts`)

```ts
type Op =
  | { kind: "upsert-node"; node: NodeRecord }
  | { kind: "delete-node"; id: string }
  | { kind: "upsert-edge"; edge: EdgeRecord }
  | { kind: "delete-edge"; id: string };

type Undo = () => void;

type ApplyResult =
  | { ok: true; undo: Undo }
  | { ok: false; reason: "duplicate"; attribute: string };

interface GraphStore {
  getState(): GraphSnapshot;
  /** Increments on every accepted apply/undo; the subscription identity */
  getVersion(): number;
  apply(op: Op): ApplyResult;
  query: {
    nodes(type: string): NodeRecord[];
    nodesWhere(type: string, pred: (node: NodeRecord) => boolean): NodeRecord[];
    edges(type: string): EdgeRecord[];
    derive(query: DerivedQuery): number;
  };
}
```

- Stable ids: generate in `apply` if missing (`crypto.randomUUID` when available; sequential fallback in tests).
- `delete-node` also removes incident edges (the inverse restores node + those edges).
- **An `undo` is valid only until the next accepted op.** The inverse restores the node’s previous record wholesale, so calling it after an unrelated edit to that node would silently revert the edit too — the paper’s independence-of-effects requirement, which a bare closure does not impose. The store enforces it rather than asking callers to: `apply` stamps the current version into the closure, and an `undo` whose stamp is stale is a no-op. Callers therefore hold an inverse across no other mutation, which is exactly what the [delete affordance](#revertible-effects-one-undo-not-a-history) does. Two lines, and it removes the whole class of bug.
- Duplicate `unique` attributes: `apply` returns `{ ok: false, reason: "duplicate", attribute }` and changes nothing. `apply` must **not** return a bare `Undo` — a caller cannot tell a no-op undo from a real one, so the rejection has to be in the return type. `RecordForm` renders the message beside the offending field with `aria-invalid` and `aria-describedby`.

### Persist (`persist.ts`)

- Key: `agent-cofounder-graph:<slug(title)>`; empty title ⇒ `agent-cofounder-graph`. Per-title keys accumulate one orphaned key per idea in a browser profile; nothing prunes them. Accepted because MVP payloads are kilobytes against a ~5 MB origin quota.
- Payload: `{ version: 1, snapshot: GraphSnapshot }`.
- On load: missing key → empty snapshot. Malformed JSON, wrong version, or non-array `nodes`/`edges` → empty snapshot and a store-level flag `persistError` so the shell can show a recoverable message. Never throw through React render.
- Save after every accepted `apply` / `undo`. Quota or `SecurityError`: set `persistError`, keep working in memory.
- **Model drift.** Pi edits `product-model.json` during the run while storage may already hold nodes from the earlier shape. On load, drop nodes whose `type` is not an entity in the current model, drop edges whose endpoints are gone, and treat any missing attribute key as `""`. Silent tolerance here, not an error state — the user never caused it.

### Subscription (`GraphProvider.tsx`)

The store keeps one monotonic version counter. `GraphProvider` exposes hooks built on React 19’s `useSyncExternalStore`:

```ts
function useNodes(type: string): NodeRecord[];
function useDerived(id: string): number;
function usePersistError(): string | undefined;
```

Each hook subscribes to the single version counter and memoizes its slice by `[version, ...args]`, so it recomputes only when the store actually changed and unsubscribes on unmount (temporal safety for composers).

There is no `subscribe.ts` and no `SliceSpec` union. Per-slice change detection was specified first and cut: `useSyncExternalStore` over one counter is roughly twenty lines against a hundred, it needs no kernel tests of its own, and the re-render it would avoid does not exist in an app holding tens of records. The [size budget](#size-budget) is the binding constraint, and this is the cheapest place to meet it.

### Size budget

The 302-line `graph/` ceiling was pointed at the wrong files. Book-3 (Qwen, after `setup.ts` isolation; `docs/personal/eval/book-result-3.json`) opened every graph module and every composer, and did not open kernel tests. The efficiency risk is the surface Pi actually reads. The old ceiling’s rationale is unchanged; only its target moves.

Book-3 `read` tool, product source:

| Surface | Lines then | Opened |
| --- | --- | --- |
| `graph/types.ts` | 57 | yes |
| `graph/load-model.ts` | 55 | yes |
| `graph/store.ts` | 104 | yes |
| `graph/persist.ts` | 41 | yes |
| `graph/GraphProvider.tsx` | 45 | yes |
| `composers/` (six files) | 320 | yes, wholesale |
| `App.tsx` | 72 | yes |
| `test/setup.ts` | 8 | yes |
| `main.tsx` | 13 | yes |
| `graph/*.kernel.test.ts` | 206 | no |

After derived reference checks, `graph/` is 321 lines and the opened seed is 734.

| Budget | Limit |
| --- | --- |
| Opened seed (`graph/` + `composers/` + `App.tsx` + `setup.ts` + `main.tsx`) | ≤ 734 lines |
| Each composer | ≤ 120 lines |
| Skill instructions for file reads | Read `types.ts`, `product-model.json`, `App.tsx`, and composer **prop types** only. Do not open `store.ts` / `persist.ts` / `GraphProvider.tsx` unless a kernel test fails. Book-3 ignored this. |

If the opened seed grows past 734, delete features; do not add a query language. This is not a second waiver of the old 302 rule — that target is retired.

[`app-template/src/test/setup.ts`](../app-template/src/test/setup.ts) must `cleanup()` and `localStorage.clear()` in `afterEach`. Testing Library 16.3.0 registers auto-cleanup only when `afterEach` is a global; this seed does not set `globals: true`. Without the explicit cleanup, every `render(<App />)` stacks another app and inherits persisted records — that is what killed book-2.

### Tests

| Suite | Where | Runs in the generated app? | Purpose |
| --- | --- | --- | --- |
| Kernel | `src/graph/*.kernel.test.ts` | **No** — excluded | apply/undo, persist malformed payload, loader shape and derived-ref checks against an **inline** empty model (do not import the live `product-model.json`) |
| Product journeys | `src/**/*.test.tsx` added by Pi | Yes | Testing Library: user-visible add/edit/delete/filter/derive/persist |

**Kernel tests must not run inside the generated app.** [`verifyGeneratedApp`](../src/verify-app.ts) runs the app’s Vitest with `--passWithNoTests=false` and requires `numTotalTests > 0` with nothing failed, skipped, or todo. That check is meaningful today *only because the seed ships zero tests* — it is the harness’s one independent piece of evidence that Pi authored a real test. The `tests_run` journeys in `report.partial.json` are self-reported prose; [`composeResult`](../src/result.ts) requires them non-empty and passing but never compares them to files on disk.

Ship passing kernel tests into `output/app/` and a run where Pi writes **no** product tests passes all three `harness_checks`, leaving the model’s own honesty as the only gate. Instructing the skill to name real journeys does not restore the check.

Mechanism (coding pass):

- Name kernel tests `*.kernel.test.ts`.
- [`app-template/vitest.config.ts`](../app-template/vitest.config.ts) gains `exclude: [...configDefaults.exclude, "**/*.kernel.test.ts"]` (import `configDefaults` from `vitest/config`).
- New `app-template/vitest.kernel.config.ts` includes **only** `src/**/*.kernel.test.ts`, and must keep `environment: "jsdom"` — `persist.kernel.test.ts` needs `localStorage`, and `store.kernel.test.ts` needs `crypto.randomUUID`. Both are present in the pinned jsdom 27.
- Root [`package.json`](../package.json) gains `app:test:kernel` (`npm --prefix app-template exec vitest run --config vitest.kernel.config.ts`) and `check` runs it alongside `app:test`.

Verified against the pinned Vitest 4.1.5 and jsdom 27: with the exclusion in place and only `*.kernel.test.ts` files on disk, the harness’s own invocation (`vitest run --reporter=json --passWithNoTests=false`) reports `numTotalTests: 0, success: false`, so [`hasPassingVitestReport`](../src/verify-app.ts) fails the check — which is precisely the signal being preserved. The kernel config picks those same files up and passes.

The kernel is still protected in the generated app: `npm run build` runs `tsc --noEmit` over all of `src`, so a kernel Pi breaks fails the build. Filtering the copy in [`src/prepare-output.ts`](../src/prepare-output.ts) would achieve the same thing but means editing `src/`, which v1 rules out.

`app:test` keeps its `--passWithNoTests` flag — the app template itself still ships no runnable tests once kernel tests are excluded, which is exactly the property being preserved.

Kernel tests change the current [`app-template/AGENTS.md`](../app-template/AGENTS.md) sentence “The seed intentionally contains no product tests.” After the coding pass that line must become: the seed ships domain-neutral kernel tests that are **excluded from `npm test`**; every test the app actually runs is one Pi wrote. `success` still requires `tests_run` entries that name user journeys, not “store upsert.”

Root [`package.json`](../package.json) `app:test` / `check` must stay green on the empty default model.

## Composers

Generic React pieces. Labels, headings, button names, and `aria-*` come from the model (`Add book`, never `Create node`). Prefer semantic HTML (`main`, `form`, `table` or `ul`, labelled inputs) so a hidden browser judge can use accessible names.

| Composer | Role | Shown when |
| --- | --- | --- |
| `AppShell` | Landmark regions, title, empty/error/persistError | Always (record-keeping path) |
| `RecordForm` | Add / edit from `EntityType.attributes` | `add` or `edit` |
| `Collection` | List, row actions, undo-on-delete status region | Whenever `entities.length > 0` |
| `FilterBar` | Narrow by choice attribute, boolean, or “attribute present” | `filter` |
| `DerivedStat` | `DerivedQuery.label` + value | `derive` |

`Collection` is not gated on a journey kind. `edit`, `filter`, and `derive` all need something to read; a form with no list is not a product. Gate the row *actions* on `edit` / `delete` instead. The [undo affordance](#revertible-effects-one-undo-not-a-history) belongs to the `delete` action, not to a separate composer, and has to fit inside `Collection`’s 120-line budget.

`App.tsx` is a binder: `loadProductModel` → if invalid/empty, shell only → else wrap with `GraphProvider` and mount the composers required by `journeys[]`. Persist is not a composer; `persist.ts` plus a journey test that remounts or reloads from storage.

Shared filter state lives in the binder (or a tiny `useFilter` next to it), not in a second store.

## Paper mapping

The paper defines both of its dimensions over the **component lifecycle** of a system whose components load, unload, and reconfigure at runtime. The generated app is not that system. Its component set is fixed at build time by `product-model.json`, nothing is withdrawn while the page is open, and Preservation, Progress, Confluence, and the withdrawal rules have no runtime referent here. What this design borrows is the shape of the two mechanisms — plus one architecture the paper describes almost exactly.

This repo has two layers and the paper lands differently on each, so they are mapped separately. The generated app is the one this design builds. The harness that produces it is the one the paper’s second motivating case is actually about.

### The generated app

| Paper | The generated app | Not the app |
| --- | --- | --- |
| **Declarative configuration** (the §4.2 loader) | `product-model.json` is the target state; `App.tsx` reads it and mounts the components it names | A reconciliation *loop*. Resolution runs once at mount; nothing diffs, patches, or injects later |
| **Temporal composability** (revertible effects) | `apply` returns an inverse and `Collection` calls it, for [one undo on delete](#revertible-effects-one-undo-not-a-history) | Reverting on unmount — a composer teardown that undid its writes would delete the user’s records. Undo history; process restart as the cleanup story |
| **Withdrawal / Preservation** | The [escape hatch](#escape-hatch): the kernel can be abandoned whole and the app still typechecks, builds, and runs | Runtime withdrawal. This holds at the file level across a build, not while the app is running |
| **Spatial composability** (coeffect specification) | Composers declare what they need — a `JourneyKind`, an entity, a `DerivedQuery` — and the binder mounts only the ones the model satisfies | **Reactive** coeffects. The model never changes at runtime, so resolution never re-runs; no composer depends on another, and nothing is notified when a provider appears or leaves |
| **Unified context** | One `GraphStore` is both the effect target and the read source for everything persistent | Isolation and interception. `getState()` is open to any caller, no composer’s reads are checked against a declaration, and ephemeral filter state deliberately lives outside the store. Interception does exist one layer up — see [The harness](#the-harness) |
| **Cordis / HMR / fibers** | Out of scope | Meta-framework, hot reload of product components, the calculus and its proofs |

One clarification worth keeping, because the obvious reading is wrong: `useSyncExternalStore` re-rendering a composer when the store changes is ordinary shared-state subscription, not reactive coeffects. There are no providers and requesters, and `useNodes(type)` is a query, not a dependency that might go unsatisfied. The coeffect-shaped part of this design is the binder’s conditional mount, and it is static.

### The harness

The paper’s second motivating case is *self-evolving agent harnesses*: systems that extend their own capabilities by installing tools or modules at runtime. That is this repo, not the app it generates — and it is the layer where the paper’s mechanisms have a real referent, because Pi components have an actual lifecycle.

| Paper | The harness today | Not the harness today |
| --- | --- | --- |
| **Declarative configuration** (the §4.2 loader) | [`buildPiArguments`](../src/run-challenge.ts) states a target component set: `--no-extensions --no-skills --no-prompt-templates --no-themes --no-context-files` withdraws every default, then `--extension` and `--skill` inject exactly what is declared | Reconciliation. It is a cold-start injection with nothing to diff against, and no component is withdrawn, patched, or injected once Pi is running |
| **Interception** | [`protected-paths.ts`](../solution/extensions/protected-paths.ts) does it twice: `before_agent_start` rewrites the system prompt before the model sees it, and `tool_call` returns `{ block: true }` for a protected path. This is the paper’s own sandboxed-agent-harness example | Isolation. The extension receives the whole event and runs in-process with full permissions. [`README`](../README.md) says it plainly: “It is not a sandbox” — shell commands and symlinks go around it |
| **Temporal composability** (revertible effects) | Nothing. Teardown is `terminateProcessTree`: SIGTERM, then SIGKILL five seconds later | Anything revertible. [`prepare-output.ts`](../src/prepare-output.ts) checks a marker and then `rm -rf`s the directory and re-copies `app-template/` whole — destroy-and-rebuild, which is the *coarse-grained workaround* the paper names as the thing it exists to replace, not an instance of it |
| **Spatial composability** (reactive coeffects) | Nothing. One component set, resolved once at process start | The mechanism is present and switched off: Pi’s skill loading is the runtime capability install the paper’s second case describes, and `--no-skills` turns it off |

So both layers are one-shot loaders today. The app binder reads a model and mounts once; `buildPiArguments` names a component set and injects once. The harness’s *potential* is dynamic and the app’s is not — but its current implementation is exactly as static.

v1 leaves it that way deliberately, and the reason is the ranked metric rather than the contract. The contract is permissive: [`README`](../README.md) names replacing the runner strategy as a participant surface and lists a different Pi integration through its SDK or RPC mode as an intended improvement, and [`contract-public/README.md`](../contract-public/README.md) allows a replacement runner provided the audit fields and their semantics survive. What is actually fixed is `result.json` ownership, those fields, and the artifact stream. [Out of scope](#out-of-scope) declines the rest as a v1 choice, not because `src/` is untouchable.

The cost is what makes that choice defensible. Ranking is Pi’s reported runtime cost, and the one measured saving is a stable prefix cached almost entirely by GLM-5.2. Composition splits along that line: a `tool_call` hook is prefix-neutral and close to free, while dynamically loaded skills and prompt templates are exactly what varies the prefix. The paper’s two halves are therefore not equally affordable here — which is a testable claim, not a settled one. [Later eval](#later-eval-and-follow-ups) says what to check before building on it.

Do not paste these tables into the Pi prompt. The kernel *is* the mapping.

## Agent pipeline

The runner appends three texts today ([`buildPiArguments`](../src/run-challenge.ts)): [`solution/system-prompt.md`](../solution/system-prompt.md), [`contract-public/journeys.md`](../contract-public/journeys.md), and `output/app/AGENTS.md` (from the template). All three plus the skill must agree. Keep them short. No paper theory in the prompt.

### Later edits (coding pass)

**[`app-template/AGENTS.md`](../app-template/AGENTS.md)** — replace the “no product tests” line; add:

- Record-keeping ideas: write only `src/product-model.json`; do not rewrite `src/graph/`. `App.tsx` already binds composers from `journeys[]`.
- Do not run `npm run dev`; the outer runner starts it.
- Escape hatch when the idea is not record-keeping.
- Product tests are Testing Library journeys in one file; persist remounts `<App />`.
- Still do not write `result.json`.

**[`solution/system-prompt.md`](../solution/system-prompt.md)** — same pipeline, shorter than today. Keep existing product constraints (port 3000, no new packages, persist, accessibility, `report.partial.json`). The app must be startable with `npm run dev`; Pi must not start it.

**[`solution/skills/mvp-builder/SKILL.md`](../solution/skills/mvp-builder/SKILL.md)** — **add** the model/binder steps; do **not** replace the skill wholesale.

The current skill’s steps 4–5 and 7 carry the guidance that maps onto the ~100-point Application Readiness axis: persistence and domain boundaries, accessible controls, validation, empty states, errors, responsive layout, duplicate actions, boundary values, malformed stored data, focused components, and testing every observable behavior. Readiness is scored separately from efficiency. Trading that content for graph instructions buys tokens with points and is a likely net loss. Condense those steps; keep them.

The merged skill:

1. Decide record-keeping vs escape hatch. Record the decision in `assumptions`. The next tool call that touches `src/` is a write. Write as soon as the model or stub can be stated; do not confirm it against composer or kernel source first. Keep that decision message short — it is the one that overruns the 16,384-token cap on Qwen.
2. If record-keeping: write a complete `src/product-model.json` immediately; apply the links-vs-attributes rule. Include a domain-neutral JSON sketch (entity `item`, optional text, `count-nodes-where`, `links: []`). If hatch: write a compiling stub `App.tsx` first, then fill.
3. After that write: the shipped binder is finished. Do not edit `App.tsx` unless a named journey is missing. Read `types.ts`, `product-model.json`, and `App.tsx` only. One sentence on FilterBar labels (`{label} present`, `{label}: {choice}`).
4. *(retained)* Accessible controls, validation, empty states, errors, responsive layout. Handle duplicate or repeated actions, boundary values, malformed stored data, and recoverable storage failures where relevant.
5. *(retained)* Keep components focused, separate concerns, avoid duplication. Use only lockfile dependencies.
6. Add one Testing Library file covering every implied journey. `persist` remounts `<App />`; do not read `localStorage` keys. Use each `journey` string later in `tests_run`.
7. `npm test` and `npm run build` only. Do not run `npm run dev`. Repair.
8. Write `report.partial.json`. `success` only when every `tests_run` entry passed and at least one user journey exists.
9. Do not write `result.json`.

Keep [`solution/extensions/protected-paths.ts`](../solution/extensions/protected-paths.ts).

## Worked example: book-lending placeholder

Example only. Do not copy these strings into reusable APIs.

Idea (abridged): track books (title, author, kind); note who borrowed one; clear that on return; list all; filter currently out; count lent out; edit or delete mistakes; single user on one computer.

```json
{
  "title": "Shelf",
  "entities": [
    {
      "id": "book",
      "singular": "book",
      "plural": "books",
      "attributes": [
        { "id": "title", "label": "Title", "kind": "text", "required": true },
        { "id": "author", "label": "Author", "kind": "text", "required": true },
        {
          "id": "kind",
          "label": "Kind",
          "kind": "choice",
          "required": true,
          "choices": ["Novel", "Cookbook", "Reference", "Other"]
        },
        { "id": "borrower", "label": "Borrowed by", "kind": "text", "required": false }
      ]
    }
  ],
  "links": [],
  "journeys": [
    { "kind": "add", "journey": "Add a book with title, author, and kind and see it in the list" },
    { "kind": "edit", "journey": "Fix a book added by mistake" },
    { "kind": "delete", "journey": "Remove a book from the list" },
    { "kind": "filter", "journey": "Show only books that are currently out with someone" },
    { "kind": "derive", "journey": "See how many books are lent out right now" },
    { "kind": "persist", "journey": "Books and borrower names survive a refresh" }
  ],
  "derived": [
    {
      "id": "lent-count",
      "label": "Lent out",
      "kind": "count-nodes-where",
      "entity": "book",
      "where": { "attribute": "borrower", "present": true }
    }
  ],
  "assumptions": [
    "Kind is a small fixed choice list derived from the examples in the idea (novel, cookbook, reference) plus Other.",
    "Borrower is an optional name on the book, not a separate person record; return clears that field.",
    "Currently out means the borrower attribute is non-empty."
  ]
}
```

Filter: books whose `borrower` is present. Lend = set `borrower`; return = clear `borrower`. Both are forward `upsert-node` ops, **not** undos — calling the lend’s inverse to model a return would restore the book’s whole previous record and silently discard any edit made in between. The only undo in this app is on deleting a book.

## Later eval and follow-ups

### Baseline first — before the coding pass

The entire efficiency argument is a comparison, and there is currently nothing to compare against. Record the **before** number on the unmodified seed or no later result can confirm or refute the design:

- 3 × `npm run challenge` on [`contract-public/development-idea.txt`](../contract-public/development-idea.txt) against the current 13-line `App.tsx` seed.
- Capture `cost_total`, `total_tokens`, `model_calls`, `status`, and the three `harness_checks` from each `result.json`. Use the median.

**Abort condition:** if median `cost_total` after the coding pass is higher than baseline *and* `harness_checks` plus journey coverage are not better, revert to the plain seed. The kernel is a bet on cost, not a goal in itself.

On prompt cache: the appended system prompt is a stable cacheable prefix, but files Pi reads land in the conversation, not the prefix. They are fresh input on first read and cached on later turns, so the marginal cost of a bigger seed is roughly one read per file — plausible, unmeasured, and exactly what the baseline settles.

### After the coding pass

Measured on Qwen (`Qwen/Qwen3.8-27B-FP8`, thinking off). Numbers live in gitignored `docs/personal/eval/`; this section is only so a later pass does not treat the list below as unrun.

1. **Book.** Finished on the local [`docs/personal/eval/book-lending.txt`](../docs/personal/eval/book-lending.txt) (book-3: `status: success`, harness green, kernel `diff` empty). That file is a normalized restatement of the committed placeholder. [`contract-public/development-idea.txt`](../contract-public/development-idea.txt) itself has not been run.
2. **Pantry.** Four Qwen attempts before the early-write rule dumped at 16,384 tokens with an empty seed. pantry-3 (after that rule) wrote a complete `Home Pantry` model on call 5, then hit the 15-minute clock before tests or `report.partial.json`. `loadProductModel` accepts it. Kernel and composers unchanged.
3. **Timer.** Same pre-rule dump. timer-3 replaced `App.tsx` with a purpose-built timer, left `product-model.json` empty, left `src/graph/` alone, and started a product test file — then 124. The [escape hatch](#escape-hatch) was taken, not faked. Unused-kernel typecheck still has not been exercised by a *finished* timer app (no harness).

Success is still `status: success`, both `result.json` destinations, harness checks green, `tests_run` naming user journeys, `cost_total` at or below a baseline we do not have. Kernel changes from (2) or (3) must stay domain-neutral. The early-write rule moved the Qwen wall from “no write” to “write, then clock.” GLM-5.2, prefix cache, and a seed baseline remain open.

Also audit each finished run, since neither is enforced:

- `diff -r app-template/src/graph output/app/src/graph` — did Pi respect the kernel boundary?
- Count test files in `output/app/src` that are not `*.kernel.test.ts` — did Pi actually write the journeys it reported?

Optional after a reliable single-shot run: a second Pi step (extract model, then bind) to exploit GLM-5.2 prompt cache. Not v1.

Qwen usage records carry `reasoning: 0` while the assistant content is mostly reasoning (book-2: ~73% of output). `reasoning_tokens` — advertised in the README as an audit field — is structurally meaningless for this provider. `stop_reason` is the field that actually diagnoses a 16,384-token dump. The truncation gate (`canVerifyApp` false when the final assistant message is `length`) is what keeps those dumps from recording a false build/dev pass on an untouched seed.

### Before any v2 that composes Pi components

Two claims in [The harness](#the-harness) are hypotheses, and both are cheap to settle. Root `node_modules/` is not installed in a fresh clone, so neither has been checked here.

- Install root dependencies and read the `ExtensionAPI` type declarations. How many lifecycle hooks does Pi 0.84.1 actually expose? “The extension surface is small” has only ever been inferred from the two hooks `protected-paths.ts` happens to use, which is not evidence.
- Establish where a dynamically loaded skill lands — the cacheable system prefix, or the conversation like a file Pi reads. The whole affordability argument turns on that, and the [baseline](#baseline-first--before-the-coding-pass) measures prefix stability anyway, so the marginal cost of answering it is close to zero.

If the surface is small and skills sit in the prefix, the composing v2 is not worth its cost and the framing risk below is simply accepted. If the hooks are rich and skill content lands in the conversation, the temporal half of the paper is affordable at the harness layer and worth a prototype.

## Open risks

Accepted knowingly, recorded so they are not rediscovered as surprises:

- **Seed size vs. exploration cost.** ~900 lines of kernel and composers in a workspace Pi explores before writing. The read budget is a request, not a limit — it now has a failure mode attached. Pantry-2 opened all six composers, `load-model.ts`, `setup.ts`, both Vitest configs and the kernel internals, then spent one whole 16,384-token message reasoning and wrote nothing. Book-3 did the same wholesale read and finished. On this model, exploration and the output cap compete for the same run. Still unresolved until the baseline comparison above.
- **Kernel boundary is prompt-enforced.** `protected-paths.ts` cannot distinguish a legitimate escape-hatch rewrite from Pi wandering into `store.ts`. Measured by the diff audit, not prevented.
- **Journey honesty is partly self-reported.** The test exclusion restores the *existence* check — the app’s Vitest run contains only Pi’s tests. It does not verify that a `tests_run` journey string describes what the test actually asserts.
- **The graph framing may collapse.** If links stay empty across all three eval ideas, this is a model-driven record store. Every model produced so far — book-1, book-2, book-3 — has `links: []`, and the other two ideas never produced one, so the evidence points that way without being complete; see [Links may be dead weight](#links-may-be-dead-weight). That is still a good product; the paper mapping is what would need rewriting, not the code.
- **The paper’s dynamic system in this repo is the harness, not the app.** Its research-context section names two motivating cases: plugin systems, and *self-evolving agent harnesses*. This repo is the second, and v1 applies the paper’s ideas to the app it generates instead. The choice is deliberate — see [The harness](#the-harness) for what that layer does and does not earn, and why the cost argument favours leaving it alone — but the framing is aimed at the layer with less to demonstrate, and calling this document a harness design overstates which half it is about. Accepted for v1; [revisit](#before-any-v2-that-composes-pi-components) only if the hook surface turns out to be worth it.

## Out of scope

- Porting Cordis, HMR, fibers, or the paper’s calculus
- New npm dependencies, LangChain, AutoGen, RDF libraries
- A backend or external API
- Graph visualization as the product UI
- Changing anything under [`src/`](../src/) in v1 except the usage-collector carve-out (`stop_reason`, `truncated`, and `canVerifyApp` false when the final assistant message was truncated). `prepare-output.ts` and the verification commands stay as they are. `harness_checks[].result` still cannot express “not run” (`contract-public` is frozen); skipped checks are written `failed` and the `journey` string says they were not run.
- A hard write-block on `src/graph/` in the protected-paths extension
- Hidden prompts, hidden tests, or scoring code
- Editing [`docs/organizer-checklist.md`](organizer-checklist.md) or [`contract-public/`](../contract-public/)
- Undo **history**, multi-step undo, or redo — the single [undo on delete](#revertible-effects-one-undo-not-a-history) is in scope; anything past it needs the idea to imply history

# Approach

What this submission does, what was measured, and what was not.

## The harness in five lines

One autonomous Pi call per run. The generated app starts from a typed seed — a small in-browser
graph store plus generic composers that render forms, lists, filters and counts. The model's job
is to write `src/product-model.json`, a typed description of the product, bind it in `App.tsx`,
and write one test file naming the journeys. It does not write an architecture. Four extension
hooks intercept the run from outside the prompt, so none of them costs a token of context.

## The measured claim

Output tokens are the currency twice over: they are the ranked cost term, and they are the wall
clock, because wall time is output tokens divided by throughput. Anything that moves output
tokens off the model moves both.

Two mechanisms in this repository do that, and they do different jobs. Both were measured against
the same idea (`contract-public/development-idea.txt`), the same model (GLM-5.2 on Berget) and the
same 15-minute wall.

### The thinking hook decides whether a run finishes at all

| Plain seed | Reasoning | Output tokens | Wall | Harness | Journeys |
| --- | --- | --- | --- | --- | --- |
| 31 August, n=3 | **on** (8,202 / 12,580 / 16,297 chars) | 14,636 / 15,774 / 15,970 | 15.0 min, **all three killed** | 0/9 | 0 |
| 3 September, n=3 | **off** | 12,998 / 15,299 / 17,336 | 12.8 / 13.3 / 14.0 min | 9/9 | 5 / 10 / 12 |

Same checkout, same idea, same model. The only change is that the thinking-compat hook was grafted
in, taking reasoning to zero. An arm that failed three times out of three now passes three times
out of three.

This corrects an earlier reading in this project's own notes, which predicted the thinking fix
would not rescue the plain arm because it was output-bound by code volume. It was wrong: reasoning
was the difference between finishing and not.

### The seed decides how much room the run has left

| Arm | Model-authored lines | Output tokens | Wall | Cost | Harness | Journeys |
| --- | --- | --- | --- | --- | --- | --- |
| **Graph seed**, n=5 | 115–137 | 2,992–4,575 | **2.8–4.9 min** | €0.0248–0.0341 | 15/15 | 6–11 |
| **Plain seed**, n=3 | 1,012–1,205 | 12,998–17,336 | **12.8–14.0 min** | €0.068–0.089 | 9/9 | 5–12 |

Both arms pass. Comparing medians, the plain arm spends roughly **4x** the output tokens,
**2.6x** the euros, and **3.5x** the wall clock of the graph arm.

Margin is the part that matters on judging day, because the wall is fixed and throughput is not.
The plain arm's slowest run finished at 14.0 minutes, leaving **1.0 minute** of a 15-minute
budget. The graph arm's slowest finished at 4.9, leaving **10.1**. Put as a tolerance: the plain
arm survives a **1.07x** slowdown before it is killed; the graph arm survives **3.06x**. Berget's
observed throughput varies roughly 3x between its slow and fast windows, and every run in both
tables above was taken in a good window. A plain-seed run that passes at 14.0 minutes in the
evening does not pass at midday.

So the honest statement of what the seed buys is not "it makes runs succeed". It is: **the seed
turns a run that barely fits into one that comfortably fits, at 2.6x lower ranked cost.**

### What is still wrong with this comparison

1. **One idea.** Both plain arms and all five graph runs are book-lending. The nine-idea evidence
   below is graph-seed only; there is no plain-seed arm across idea shapes.
2. **The skill text differs between arms.** The plain checkout's `SKILL.md:12` asks for "a small
   repository or service boundary", which steers toward architecture. So this measures "typed seed
   plus its skill" against "no seed plus its skill", not the ontology in isolation.
3. **233–292 of the plain arm's lines are CSS**, which the graph seed absorbs with a classless
   base. Real, but a styling decision rather than a composability result.
4. **Wall-clock figures are throughput-dependent** and all were taken in a good window. The token
   and cost figures are not throughput-dependent; the minutes are.

## Generality: nine ideas, one configuration

The seed comparison uses one idea. To test whether the result survives idea shape, eleven runs
across nine distinct prompts were run on 2 September — job applications, a scoreboard, projects
and tasks, a pomodoro timer, a quiz, a unit converter, habits, and the committed development idea.

**Eleven of eleven reported `success`**, every one with three green harness checks and
`thinking_chars: 0`, spending 3,027–11,722 output tokens.

Two of those prompts had never once succeeded on this model. Jobs was 0/2 and scoreboard 0/2
before, every failure at the wall or truncated, each carrying 32k–68k characters of reasoning.
Both passed twice.

The batch was deliberately run against a **wrong local model configuration** — thinking compat
disabled in `~/.pi/agent/models.json` and the provider entry restored to a form that does not
suppress reasoning. Local configuration does not ship, so on judging day the shipped extension has
to do this alone. Passing with a wrong config implies passing with a right one.

One caveat: that batch ran in a good throughput window, so it establishes token counts and
pass/fail by idea shape, not wall-clock margin. Quote the tokens, not the minutes.

## Four interceptions, none of them in the prompt

All four live in `solution/extensions/protected-paths.ts`. They are extension hooks, never read by
the model, and cost nothing against the context budget.

**Thinking compat.** Pi encodes thinking controls per provider. On an OpenAI-compatible vLLM
backend only `chat_template_kwargs` is forwarded into the chat template; a top-level `thinking`
field is accepted and silently dropped. So `CHALLENGE_THINKING=off` did not reach the model. A
`before_provider_request` hook merges `enable_thinking: false` into `chat_template_kwargs`.
Measured on one model: 18,733 reasoning characters to 0, output tokens 7,087 to roughly 3,700, and
a run that died at the wall became one that finishes in under four minutes.

**Repeat breaker.** A repeated `bash` command is refused after 12 attempts, with an explanation
the model can act on. Calibrated, not guessed: healthy runs repeat their most-repeated command
2–7 times, which is ordinary repair; stuck runs reached 33–126. Repeats are counted on the
command's first line, not the whole invocation — a model debugging through a heredoc keeps the
first line constant and varies the body, and one observed run repeated that 34 times while
whole-input keying counted each as unique. The first line collapses heredocs while keeping
`npm test -- -t "A"` and `-t "B"` distinct; anything more aggressive risks blocking healthy
repair, which is worse than missing a loop the wall clock already bounds.

**Token ceiling.** A run is stopped when billable tokens cross 3,000,000. A model repeating one
tool call resends a growing context each time, so spend grows with the square of the call count
while nothing is produced. The largest healthy run observed used 888,748 billable tokens; one
runaway reached 26.6 million and wrote no tests at all.

**Product-model diagnostic.** The app's loader accepts or rejects `product-model.json` whole and
reports no reason, so one mistyped `kind` renders "The product definition could not be read" and
makes every journey fail with its elements simply absent — a symptom pointing nowhere near the
cause. A `tool_result` hook re-checks the file after each write and appends the failing field and
the symptom. It never blocks a write and never alters a file. This happened once in the recorded
corpus and cost that run its entire budget.

## The corpus, and the concession it forced

Every product model the harness has produced was kept. Across 118 saved models:

| | Count |
| --- | --- |
| Models with at least one entity | 78 |
| Models with two or more entities | 9 |
| Models declaring at least one link | 1 |
| Links actually rendered by a shipped composer | **0** |

The ontology has entities, attributes, journeys, derived values and **links**. The first four earn
their place in every run. Links do not. One model in 118 declared one, and no shipped composer
reads `links` at all, so even that one rendered nothing.

So the honest description of the product layer is a **model-driven record store**, not a graph.
The graph claim belongs to the harness, where the store and composers genuinely compose; it does
not belong to the generated applications. The 40 zero-entity models are not failures — they are
runs that correctly took the escape hatch, replacing `App.tsx` with a purpose-built UI when the
record shape did not fit, and leaving the unused kernel on disk.

This is the kind of thing instrumenting your own ontology tells you, and the reason the corpus was
kept rather than the wins.

## Where the vocabulary comes from

The design borrows its vocabulary from
[*A Programming Paradigm for Spatiotemporal Composability*](spatiotemporal-composability.pdf)
(Shi, Zhang, Cui) — the composition model, revertible effects, and a unified context — without
porting its runtime. `docs/implementation.md` has a paper-mapping section stating exactly which
ideas are used and which are only named. The paper is a preprint under active revision; this
borrows its vocabulary, not its results.

## What is not measured

- **No browser-journey evidence.** Verification is Vitest, a production build, and an HTTP startup
  probe. Whether a human can complete a journey in a browser is untested here; the hidden judging
  tests are what decide that.
- **No judged-model evidence.** Every measurement is GLM-5.2 and Qwen on Berget. The judged model
  and its throughput are unknown, which is why the batch was run against a wrong local config.
- **The seed comparison is n=5 against n=3 on one idea**, with the four confounds above.
- **Wall-clock margin is unproven** outside a good throughput window.
- **The escape hatch is only counted, not scored.** 40 runs took it and the harness went green;
  nobody has assessed whether those applications are good, only that they build, test and start.

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

Same idea (`contract-public/development-idea.txt`), same model (GLM-5.2 on Berget), same
15-minute wall. The only variable is the seed.

| Arm | Model-authored lines | Output tokens | Wall | Harness checks | Journeys |
| --- | --- | --- | --- | --- | --- |
| **Graph seed**, n=5 | 115 / 118 / 137 | 2,992 / 3,610 / 3,836 / 4,153 / 4,575 | 2.8–4.9 min | 15/15 passed | 6–11 |
| **Plain seed**, n=3 | 1,080 / 1,271 / 1,478 | 14,636 / 15,774 / 15,970 | 15.0 min, all three | 0/9 | 0 |

Every plain-seed run was killed at the wall with nothing verifiable. Every graph-seed run finished
in under five minutes with three green checks. The model-authored line counts are the diff against
the seed: with the graph seed the model writes a product model, a few bindings and one test file;
with the plain seed it writes the whole application.

### What is wrong with this comparison

Four things, stated because a reader will find them.

1. **The plain arm predates the thinking fix** (31 August; the fix landed 1 September), so it was
   emitting reasoning the graph arm was not. This is measured rather than assumed. Replaying those
   three sessions gives 8,202, 12,580 and 16,297 characters of reasoning — roughly 2,000–4,100
   tokens of a 14,636–15,970 token budget, or 13–28%. `reasoning_tokens` reports 0 for these runs
   and is simply wrong, which is why this repository does not trust that field.

   The gap survives the correction. Subtract all of the reasoning and the plain arm still emits
   about 11k–14k output tokens of application code against the graph arm's 2,992–4,575 at zero
   reasoning. The thinking fix alone would not have rescued it: those runs are output-bound by
   code volume, and each one still had 1,080–1,478 lines to write.
2. **291–389 of the plain arm's lines are CSS**, which the graph seed absorbs with a classless
   base. That is a real saving, but it is a styling decision rather than a composability result.
3. **Wall-clock figures are throughput-dependent.** Berget's observed throughput varies roughly
   3x by time of day. The token counts are throughput-independent; the minutes are not.
4. **n is small on the seed comparison itself.** Five against three, one idea.

Point 4 is the one that has since been addressed.

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

**Repeat breaker.** An identical `bash` command is refused after 12 attempts, with an explanation
the model can act on. Calibrated, not guessed: healthy runs repeat their most-repeated command
2–7 times, which is ordinary repair; stuck runs reached 33–126.

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

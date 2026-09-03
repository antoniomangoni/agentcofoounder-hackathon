import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import fs from "node:fs";
import path from "node:path";

export const PI_DOCUMENTATION_HEADING = "Pi documentation (read only when ";
const PI_DOCUMENTATION_BLOCK_START = `\n\n${PI_DOCUMENTATION_HEADING}`;

export function stripPiDocumentationBlock(systemPrompt: string): string {
  const blockStart = systemPrompt.indexOf(PI_DOCUMENTATION_BLOCK_START);
  if (blockStart < 0) return systemPrompt;

  const headingEnd = systemPrompt.indexOf("\n", blockStart + PI_DOCUMENTATION_BLOCK_START.length);
  if (headingEnd < 0) return systemPrompt;

  let lineStart = headingEnd + 1;
  let bulletCount = 0;
  while (systemPrompt.startsWith("- ", lineStart)) {
    bulletCount += 1;
    const lineEnd = systemPrompt.indexOf("\n", lineStart);
    if (lineEnd < 0) return systemPrompt.slice(0, blockStart);
    lineStart = lineEnd + 1;
  }
  if (bulletCount === 0) return systemPrompt;

  return systemPrompt.slice(0, blockStart) + systemPrompt.slice(Math.max(blockStart, lineStart - 1));
}

/**
 * Stop a model that is repeating one command and getting nowhere.
 *
 * Measured across 14 runs: a successful run repeats its most-repeated bash command
 * 2-7 times, which is ordinary `npm test` during repair. A run that dies at the wall
 * repeats one 33-126 times. One model re-ran the same debug test 58 times against a
 * derived query that could never return anything, spending the whole run and, because
 * each call resends a growing context, tens of euros of cache reads.
 *
 * The limit sits well above the healthy band so legitimate repeated test runs are
 * never blocked, and only `bash` is metered — repair genuinely re-runs commands,
 * whereas an identical command for the twelfth time is a stuck agent.
 */
const DEFAULT_REPEAT_LIMIT = 12;

export interface RepeatBreaker {
  check(toolName: string, input: unknown): { block: true; reason: string } | undefined;
}

/**
 * Count on the command's first line, not the whole invocation.
 *
 * Keying on the entire input only catches byte-identical commands, which misses the
 * loop shape that actually occurs: a model debugging through a heredoc rewrites the
 * same file over and over, so the first line is constant
 * (`cd … && cat > src/dbg.test.ts <<'EOF'`) while the body differs every time. One
 * observed run repeated exactly that 34 times without the breaker ever counting past
 * one, and spent the whole wall clock on it.
 *
 * The first line is the conservative normalization. It collapses heredocs, whose
 * variation is always below it, while leaving single-line commands that differ in
 * their arguments (`npm test -- -t "A"` vs `-t "B"`) as distinct keys. Over-blocking a
 * healthy repair loop is worse than missing a loop the wall clock will catch anyway,
 * so nothing more aggressive than this is worth doing.
 */
function repeatKey(input: unknown): string | undefined {
  let serialized: string;
  try {
    serialized = JSON.stringify(input);
  } catch {
    return undefined;
  }
  if (serialized === undefined) return undefined;
  const command = (input as { command?: unknown } | null)?.command;
  if (typeof command !== "string") return serialized;
  const firstLine = (command.split("\n", 1)[0] ?? "").trim();
  return firstLine.length > 0 ? firstLine : serialized;
}

export function createRepeatBreaker(limit: number = DEFAULT_REPEAT_LIMIT): RepeatBreaker {
  const counts = new Map<string, number>();
  return {
    check(toolName, input) {
      if (toolName !== "bash") return undefined;
      const key = repeatKey(input);
      if (key === undefined) return undefined;
      const seen = (counts.get(key) ?? 0) + 1;
      counts.set(key, seen);
      if (seen < limit) return undefined;
      return {
        block: true,
        reason:
          `This command has already run ${String(seen)} times with the same result. ` +
          "Repeating it will not change anything. Try a different approach, and if you are " +
          "debugging a value that is always empty, check the model you wrote rather than the app.",
      };
    },
  };
}

/**
 * Force reasoning off on OpenAI-compatible endpoints, via the channel the server reads.
 *
 * Pi serializes thinking controls differently per `thinkingFormat`, and only one of those
 * shapes survives a vLLM backend. `zai` sends a top-level `thinking: {type:"disabled"}` and
 * `supportsThinkingTokenBudget` sends a top-level `thinking_token_budget`; both are z.ai /
 * vLLM sampling params that a vLLM OpenAI server silently drops when it does not implement
 * them. `chat_template_kwargs` is different: vLLM forwards it into the Jinja chat template,
 * so it is the one channel that actually reaches the model.
 *
 * Measured on GLM-5.2 via Berget, same prompt and `--thinking off` in both arms: the `zai`
 * shape produced 191 thinking chars, the `chat_template_kwargs` shape produced 0. Across
 * three full runs of the judged idea reasoning went 18,733 -> 0 chars and output tokens
 * 7,087 -> 2,992-4,153, which is the difference between landing on the 15-minute wall and
 * finishing with roughly 2x margin at the worst throughput we have measured.
 *
 * This has to live in the extension because `~/.pi/agent/models.json` is local machine
 * config. On judging day the organizers supply the provider and model, so a `compat` block
 * we set here does not ship; this hook does.
 *
 * Deliberately conservative — a judged run must never fail because of it:
 * - only when the operator asked for thinking `off`, so a requested reasoning level is never
 *   silently suppressed;
 * - only on `openai-completions`, because the Anthropic Messages API rejects unknown
 *   top-level fields and would 400 the whole run;
 * - only merging into an existing kwargs object, never replacing an unrecognised one;
 * - any unexpected shape passes through untouched.
 */
export interface ThinkingCompatOptions {
  api: string | undefined;
  thinkingLevel: string;
  enabled?: boolean;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function applyThinkingCompat(
  payload: unknown,
  options: ThinkingCompatOptions,
): Record<string, unknown> | undefined {
  if (options.enabled === false) return undefined;
  if (options.thinkingLevel !== "off") return undefined;
  if (options.api !== "openai-completions") return undefined;
  if (!isPlainObject(payload)) return undefined;

  const existing = payload.chat_template_kwargs;
  if (existing !== undefined && !isPlainObject(existing)) return undefined;
  if (existing?.enable_thinking === false) return undefined;

  return { ...payload, chat_template_kwargs: { ...existing, enable_thinking: false } };
}

/**
 * Tell the model why `product-model.json` will not load, at the moment it writes it.
 *
 * `loadProductModel` returns a bare `{ ok: false }`. The app then renders "The product
 * definition could not be read", every journey test fails with its elements simply absent,
 * and nothing anywhere names the field at fault. Measured cost of that silence, once, in
 * 103 saved runs: `qw-projtasks-2` wrote a complete and otherwise correct two-entity model
 * with `"kind": "remove"` and `"kind": "derived"` in `journeys[]`, then spent 115 model
 * calls and 15.0 minutes -- the whole wall -- and EUR 0.104 failing to find it, and reported
 * zero journeys.
 *
 * The vocabulary is not something the model could have guessed. `contract-public/journeys.md`
 * says "Show a derived value", `AGENTS.md` names the test helper `removeRecord`, and the
 * loader demands `derive` and `delete`. The two words the run used are the two words the
 * harness showed it. `SKILL.md` now states the closed lists; this is the net under that.
 *
 * It lives here rather than in `load-model.ts` because `graph/` + `composers/` + `App.tsx`
 * is a 780-line budget with 18 lines spare, and every line of it is read by the model on
 * some run. Extension source is never read, so this costs nothing that is measured.
 *
 * The check is a faithful mirror of `loadProductModel`, and the risk it manages is a false
 * positive: telling the model to repair a model that would have loaded fine would cost a run
 * exactly the way the silence did. So it reports only faults that provably reject, returns
 * nothing on anything it does not fully understand, and never blocks the write.
 */
const JOURNEY_KINDS = ["add", "edit", "delete", "filter", "derive", "persist"];
const DERIVED_KINDS = ["count-nodes", "count-nodes-where", "sum-number"];
const ATTRIBUTE_KINDS = ["text", "textarea", "choice", "number", "boolean", "date"];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === "string";

function shown(value: unknown): string {
  return isString(value) ? `"${value}"` : typeof value === "undefined" ? "missing" : JSON.stringify(value);
}

function oneOf(kinds: string[]): string {
  return kinds.join(", ");
}

function checkAttribute(raw: unknown, at: string): string | undefined {
  if (!isRecord(raw)) return `${at} is not an object`;
  if (!isString(raw.id)) return `${at}.id is ${shown(raw.id)}, and must be a string`;
  if (!isString(raw.label)) return `${at}.label is ${shown(raw.label)}, and must be a string`;
  if (!ATTRIBUTE_KINDS.includes(String(raw.kind)))
    return `${at}.kind is ${shown(raw.kind)}, which is not an attribute kind. Use one of: ${oneOf(ATTRIBUTE_KINDS)}`;
  if (typeof raw.required !== "boolean") return `${at}.required is ${shown(raw.required)}, and must be true or false`;
  if (raw.unique !== undefined && typeof raw.unique !== "boolean")
    return `${at}.unique is ${shown(raw.unique)}, and must be true or false when present`;
  if (raw.choices !== undefined && !(Array.isArray(raw.choices) && raw.choices.every(isString)))
    return `${at}.choices must be an array of strings when present`;
  return undefined;
}

function checkEntity(raw: unknown, at: string): string | undefined {
  if (!isRecord(raw)) return `${at} is not an object`;
  for (const key of ["id", "singular", "plural"]) {
    if (!isString(raw[key])) return `${at}.${key} is ${shown(raw[key])}, and must be a string`;
  }
  if (!Array.isArray(raw.attributes)) return `${at}.attributes is ${shown(raw.attributes)}, and must be an array`;
  for (const [index, attribute] of raw.attributes.entries()) {
    const reason = checkAttribute(attribute, `${at}.attributes[${String(index)}]`);
    if (reason) return reason;
  }
  return undefined;
}

function checkDerivedShape(raw: unknown, at: string): string | undefined {
  if (!isRecord(raw)) return `${at} is not an object`;
  if (!isString(raw.id)) return `${at}.id is ${shown(raw.id)}, and must be a string`;
  if (!isString(raw.label)) return `${at}.label is ${shown(raw.label)}, and must be a string`;
  if (!DERIVED_KINDS.includes(String(raw.kind)))
    return `${at}.kind is ${shown(raw.kind)}, which is not a derived kind. Use one of: ${oneOf(DERIVED_KINDS)}`;
  if (!isString(raw.entity)) return `${at}.entity is ${shown(raw.entity)}, and must name an entity`;
  if (raw.attribute !== undefined && !isString(raw.attribute))
    return `${at}.attribute is ${shown(raw.attribute)}, and must be a string when present`;
  if (raw.where === undefined) return undefined;
  if (!isRecord(raw.where)) return `${at}.where is not an object`;
  if (!isString(raw.where.attribute))
    return `${at}.where.attribute is ${shown(raw.where.attribute)}, and must name an attribute`;
  if (raw.where.present !== undefined && typeof raw.where.present !== "boolean")
    return `${at}.where.present must be true or false when present`;
  if (raw.where.equals !== undefined && !isString(raw.where.equals))
    return `${at}.where.equals must be a string when present`;
  return undefined;
}

function checkDerivedReferences(raw: Record<string, unknown>): string | undefined {
  const entities = new Map<string, Record<string, unknown>>();
  for (const entity of raw.entities as Record<string, unknown>[]) {
    entities.set(String(entity.id), entity);
  }
  for (const [index, query] of (raw.derived as Record<string, unknown>[]).entries()) {
    const at = `derived[${String(index)}]`;
    const entity = entities.get(String(query.entity));
    if (!entity)
      return `${at}.entity is ${shown(query.entity)}, but no entity has that id. Declared entities: ${
        entities.size === 0 ? "none" : oneOf([...entities.keys()])
      }`;
    const attributes = new Map<string, Record<string, unknown>>();
    for (const attribute of entity.attributes as Record<string, unknown>[]) {
      attributes.set(String(attribute.id), attribute);
    }
    const known = attributes.size === 0 ? "none" : oneOf([...attributes.keys()]);
    if (query.attribute !== undefined && !attributes.has(String(query.attribute)))
      return `${at}.attribute is ${shown(query.attribute)}, but ${String(entity.id)} has no such attribute. It has: ${known}`;
    if (isRecord(query.where) && !attributes.has(String(query.where.attribute)))
      return `${at}.where.attribute is ${shown(query.where.attribute)}, but ${String(entity.id)} has no such attribute. It has: ${known}`;
    if (query.kind === "count-nodes-where" && query.where === undefined)
      return `${at} is a count-nodes-where query with no "where", so there is nothing to count`;
    if (query.kind === "sum-number") {
      const attribute = query.attribute === undefined ? undefined : attributes.get(String(query.attribute));
      if (!attribute)
        return `${at} is a sum-number query with no "attribute" naming the number to add up`;
      if (attribute.kind !== "number")
        return `${at}.attribute is ${shown(query.attribute)}, which is a ${shown(attribute.kind)} attribute. sum-number needs a number attribute`;
    }
  }
  return undefined;
}

/** The reason `loadProductModel` will reject this, or undefined when it will load. */
export function checkProductModel(raw: unknown): string | undefined {
  if (!isRecord(raw)) return "the file is not a JSON object";
  if (!isString(raw.title)) return `title is ${shown(raw.title)}, and must be a string`;

  if (!Array.isArray(raw.entities)) return `entities is ${shown(raw.entities)}, and must be an array`;
  if (!Array.isArray(raw.links)) return `links is ${shown(raw.links)}, and must be an array`;
  if (!Array.isArray(raw.journeys)) return `journeys is ${shown(raw.journeys)}, and must be an array`;
  if (!Array.isArray(raw.derived)) return `derived is ${shown(raw.derived)}, and must be an array`;
  if (!Array.isArray(raw.assumptions)) return `assumptions is ${shown(raw.assumptions)}, and must be an array`;

  for (const [index, entity] of raw.entities.entries()) {
    const reason = checkEntity(entity, `entities[${String(index)}]`);
    if (reason) return reason;
  }
  for (const [index, link] of raw.links.entries()) {
    const at = `links[${String(index)}]`;
    if (!isRecord(link)) return `${at} is not an object`;
    for (const key of ["id", "label", "from", "to"]) {
      if (!isString(link[key])) return `${at}.${key} is ${shown(link[key])}, and must be a string`;
    }
    if (typeof link.optional !== "boolean")
      return `${at}.optional is ${shown(link.optional)}, and must be true or false`;
  }
  for (const [index, journey] of raw.journeys.entries()) {
    const at = `journeys[${String(index)}]`;
    if (!isRecord(journey)) return `${at} is not an object`;
    if (!JOURNEY_KINDS.includes(String(journey.kind)))
      return `${at}.kind is ${shown(journey.kind)}, which is not a journey kind. Use one of: ${oneOf(JOURNEY_KINDS)}`;
    if (!isString(journey.journey)) return `${at}.journey is ${shown(journey.journey)}, and must be a string`;
  }
  for (const [index, query] of raw.derived.entries()) {
    const reason = checkDerivedShape(query, `derived[${String(index)}]`);
    if (reason) return reason;
  }
  for (const [index, assumption] of raw.assumptions.entries()) {
    if (!isString(assumption)) return `assumptions[${String(index)}] is ${shown(assumption)}, and must be a string`;
  }

  return checkDerivedReferences(raw);
}

/** The note appended to the write result. Names the fault and the symptom it would otherwise cause. */
export function productModelDiagnostic(reason: string): string {
  return (
    `product-model.json will not load: ${reason}.\n\n` +
    "Until this is fixed the app renders \"The product definition could not be read\" instead of the " +
    "product, and every journey test fails with its elements missing rather than with an error naming " +
    "this file. Fix the field above; do not change src/graph/ or App.tsx to work around it."
  );
}

export default function protectedPaths(pi: ExtensionAPI) {
  const appRoot = process.cwd();
  const repeatBreaker = createRepeatBreaker(
    Number(process.env.CHALLENGE_REPEAT_LIMIT) || DEFAULT_REPEAT_LIMIT,
  );

  pi.on("before_agent_start", async (event) => ({
    systemPrompt: stripPiDocumentationBlock(event.systemPrompt),
  }));

  pi.on("before_provider_request", (event, context) => {
    try {
      return applyThinkingCompat(event.payload, {
        api: context.model?.api,
        // Pi reports no level at all for "off" (ThinkingLevel has no such member), so an
        // absent value is ambiguous on its own. Prefer what Pi reports when it reports
        // anything, and fall back to the runner's own setting, which run-challenge.ts
        // passes through as `--thinking`. A real reasoning level therefore always wins.
        thinkingLevel: context.thinkingLevel ?? process.env.CHALLENGE_THINKING ?? "off",
        enabled: process.env.CHALLENGE_THINKING_COMPAT !== "off",
      });
    } catch {
      return undefined;
    }
  });

  // Report a model the app cannot load, in the same turn as the write that broke it.
  // Never blocks: the write already succeeded, and a false positive here would cost a run
  // the same way the silence it replaces did. Any surprise leaves the result untouched.
  pi.on("tool_result", (event) => {
    try {
      if (event.isError) return undefined;
      if (event.toolName !== "write" && event.toolName !== "edit") return undefined;
      const candidate = String(event.input.path ?? "");
      if (path.basename(candidate) !== "product-model.json") return undefined;

      const absolute = path.resolve(appRoot, candidate);
      const reason = checkProductModel(JSON.parse(fs.readFileSync(absolute, "utf8")));
      if (!reason) return undefined;

      return { content: [...event.content, { type: "text" as const, text: productModelDiagnostic(reason) }] };
    } catch {
      return undefined;
    }
  });

  pi.on("tool_call", async (event, context) => {
    const repeated = repeatBreaker.check(event.toolName, event.input);
    if (repeated) {
      if (context.hasUI) context.ui.notify("Blocked a repeated command that was making no progress", "warning");
      return repeated;
    }
    if (event.toolName !== "write" && event.toolName !== "edit") return undefined;
    const candidate = String((event.input as Record<string, unknown>).path ?? "");
    const absolute = path.resolve(appRoot, candidate);
    const relative = path.relative(appRoot, absolute);
    const outsideApp = relative.startsWith("..") || path.isAbsolute(relative);
    const segments = relative.split(path.sep);
    const basename = path.basename(absolute).toLowerCase();
    const protectedPath =
      outsideApp ||
      segments.includes(".git") ||
      segments.includes("node_modules") ||
      basename === "result.json" ||
      basename === ".env" ||
      basename.startsWith(".env.");
    if (!protectedPath) return undefined;

    if (context.hasUI) context.ui.notify(`Blocked write to protected path: ${candidate}`, "warning");
    return { block: true, reason: "Path is outside the app workspace or is runner-owned" };
  });
}

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
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

export function createRepeatBreaker(limit: number = DEFAULT_REPEAT_LIMIT): RepeatBreaker {
  const counts = new Map<string, number>();
  return {
    check(toolName, input) {
      if (toolName !== "bash") return undefined;
      let key: string;
      try {
        key = JSON.stringify(input);
      } catch {
        return undefined;
      }
      const seen = (counts.get(key) ?? 0) + 1;
      counts.set(key, seen);
      if (seen < limit) return undefined;
      return {
        block: true,
        reason:
          `This exact command has already run ${String(seen)} times with the same result. ` +
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

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

export default function protectedPaths(pi: ExtensionAPI) {
  const appRoot = process.cwd();
  const repeatBreaker = createRepeatBreaker(
    Number(process.env.CHALLENGE_REPEAT_LIMIT) || DEFAULT_REPEAT_LIMIT,
  );

  pi.on("before_agent_start", async (event) => ({
    systemPrompt: stripPiDocumentationBlock(event.systemPrompt),
  }));

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

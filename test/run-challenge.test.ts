import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  PI_DOCUMENTATION_HEADING,
  applyThinkingCompat,
  checkProductModel,
  createRepeatBreaker,
  default as protectedPaths,
  productModelDiagnostic,
  stripPiDocumentationBlock,
} from "../solution/extensions/protected-paths.js";
import { buildPiArguments, parseArguments, runPi, runRequiresFailureExit } from "../src/run-challenge.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("Pi launch", () => {
  it("uses the replaceable public prompt by default and permits organizer overrides", () => {
    expect(parseArguments([]).ideaFile).toBe(path.resolve("contract-public", "development-idea.txt"));
    expect(parseArguments(["--idea-file", "organizer/idea.txt"]).ideaFile).toBe(
      path.resolve("organizer/idea.txt"),
    );
  });

  it("fails an otherwise successful run when a required result destination is missing", () => {
    expect(runRequiresFailureExit(0, "success", ["/challenge/result.json"])).toBe(true);
    expect(runRequiresFailureExit(0, "success", [])).toBe(false);
  });

  it("uses deterministic non-interactive flags and defaults thinking off", () => {
    const previousThinking = process.env.CHALLENGE_THINKING;
    delete process.env.CHALLENGE_THINKING;
    try {
      const args = buildPiArguments(
        "Build a tool",
        "Stable system prompt",
        "Create, edit, delete, narrow, derive, and persist",
        "Stable app contract",
        "/tmp/run",
      );
      expect(args).toContain("--offline");
      expect(args).toContain("--no-context-files");
      expect(args).not.toContain("--print");
      expect(args).not.toContain("--approve");
      expect(args[args.indexOf("--thinking") + 1]).toBe("off");
      expect(args).not.toContain("--system-prompt");
      expect(args[args.indexOf("--append-system-prompt") + 1]).toContain("Stable app contract");
      expect(args[args.indexOf("--append-system-prompt") + 1]).toContain(
        "Create, edit, delete, narrow, derive, and persist",
      );
      expect(args.at(-1)).toContain("Build a tool");
    } finally {
      if (previousThinking === undefined) delete process.env.CHALLENGE_THINKING;
      else process.env.CHALLENGE_THINKING = previousThinking;
    }
  });

  it("appends structurally consistent public journey guidance to Pi's built-in system prompt", async () => {
    const [systemPrompt, publicJourneys, appContext] = await Promise.all([
      readFile(path.resolve("solution/system-prompt.md"), "utf8"),
      readFile(path.resolve("contract-public/journeys.md"), "utf8"),
      readFile(path.resolve("app-template/AGENTS.md"), "utf8"),
    ]);
    const args = buildPiArguments("Build a tool", systemPrompt, publicJourneys, appContext, "/tmp/run");
    const suppliedSystemPrompt = args[args.indexOf("--append-system-prompt") + 1] ?? "";
    const behaviorSection = /## Behaviors to implement and test when implied\s+([\s\S]*?)\n## /u.exec(
      publicJourneys,
    )?.[1];
    const requirementSection = /## Run and reporting requirements\s+([\s\S]*)$/u.exec(publicJourneys)?.[1];
    const behaviorItems = [...(behaviorSection ?? "").matchAll(/^\d+\.\s+(.+)$/gmu)].map((match) => match[1]);
    const requirementItems = [...(requirementSection ?? "").matchAll(/^-\s+(.+)$/gmu)].map(
      (match) => match[1],
    );

    expect(suppliedSystemPrompt).toContain(publicJourneys.trim());
    expect(behaviorItems.length).toBeGreaterThan(0);
    expect(requirementItems.length).toBeGreaterThan(0);
    for (const contractItem of [...behaviorItems, ...requirementItems]) {
      expect(suppliedSystemPrompt).toContain(contractItem);
    }
    expect(suppliedSystemPrompt).toContain("omit it instead of inventing an equivalent feature");
    expect(suppliedSystemPrompt).toContain("Never omit an implied journey merely to simplify");
    expect(suppliedSystemPrompt.match(/^# Generated application contract$/gmu)).toHaveLength(1);
    expect(suppliedSystemPrompt).not.toMatch(/^## Generated application contract$/mu);
  });

  it("removes only Pi's documentation block from the composed system prompt", () => {
    const composed = [
      "Available tools:",
      "- read: Read files",
      "",
      "Guidelines:",
      "- Use bash for file operations",
      "",
      `${PI_DOCUMENTATION_HEADING}the user asks about pi itself):`,
      "- Main documentation: /challenge/node_modules/pi/README.md",
      "- Additional docs: /challenge/node_modules/pi/docs",
      "- Always read pi .md files completely",
      "",
      "Build the smallest maintainable application.",
      "",
      "<available_skills>mvp-builder</available_skills>",
      "Current working directory: /challenge/output/app",
    ].join("\n");

    const stripped = stripPiDocumentationBlock(composed);
    expect(stripped).toContain("Available tools:");
    expect(stripped).toContain("Guidelines:");
    expect(stripped).toContain("Build the smallest maintainable application.");
    expect(stripped).toContain("<available_skills>mvp-builder</available_skills>");
    expect(stripped).toContain("Current working directory: /challenge/output/app");
    expect(stripped).not.toContain("Pi documentation");
    expect(stripped).not.toContain("node_modules/pi/docs");
    expect(stripPiDocumentationBlock("No Pi documentation block")).toBe("No Pi documentation block");
  });

  it("pins the Pi documentation heading used by the prompt filter", async () => {
    const piEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
    const piSystemPromptPath = path.join(
      path.dirname(piEntry),
      "core",
      "system-prompt.js",
    );
    const piSystemPromptSource = await readFile(piSystemPromptPath, "utf8");

    expect(piSystemPromptSource.split(PI_DOCUMENTATION_HEADING)).toHaveLength(2);
  });

  it("reaches Pi provider validation without waiting for stdin EOF", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-cofounder-pi-launch-"));
    temporaryDirectories.push(directory);
    await mkdir(path.join(directory, "sessions"));
    const eventFile = path.join(directory, "events.jsonl");
    const stderrFile = path.join(directory, "stderr.log");

    const result = await runPi(
      [
        "--mode",
        "json",
        "--offline",
        "--no-extensions",
        "--no-skills",
        "--no-prompt-templates",
        "--no-themes",
        "--no-context-files",
        "--no-session",
        "--provider",
        "bogus-provider",
        "--model",
        "bogus-model",
        "Launch smoke test",
      ],
      directory,
      eventFile,
      stderrFile,
      5_000,
    );

    expect(result.timedOut).toBe(false);
    expect(result.exitCode).not.toBe(124);
    expect(await readFile(stderrFile, "utf8")).toContain("Unknown provider");
  }, 10_000);
});

describe("createRepeatBreaker", () => {
  const bash = (command: string) => ({ command });

  // A successful run repeats its most-repeated command 2-7 times; a stuck one 33-126.
  // The limit has to clear the healthy band or it breaks ordinary repair loops.
  it("allows the repeats a healthy repair loop actually makes", () => {
    const breaker = createRepeatBreaker(12);
    for (let attempt = 0; attempt < 7; attempt += 1) {
      expect(breaker.check("bash", bash("npm test"))).toBeUndefined();
    }
  });

  it("blocks an identical command once it reaches the limit", () => {
    const breaker = createRepeatBreaker(3);
    expect(breaker.check("bash", bash("ls -la"))).toBeUndefined();
    expect(breaker.check("bash", bash("ls -la"))).toBeUndefined();
    const blocked = breaker.check("bash", bash("ls -la"));
    expect(blocked?.block).toBe(true);
    expect(blocked?.reason).toContain("3 times");
  });

  it("counts each distinct command separately", () => {
    const breaker = createRepeatBreaker(3);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      breaker.check("bash", bash("npm test"));
      breaker.check("bash", bash("npm run build"));
    }
    expect(breaker.check("bash", bash("npm test"))?.block).toBe(true);
    expect(breaker.check("bash", bash("npm run build"))?.block).toBe(true);
  });

  it("meters only bash, so reads and writes are never blocked", () => {
    const breaker = createRepeatBreaker(2);
    for (let attempt = 0; attempt < 30; attempt += 1) {
      expect(breaker.check("read", { path: "src/App.tsx" })).toBeUndefined();
      expect(breaker.check("write", { path: "src/App.tsx", content: "x" })).toBeUndefined();
    }
  });

  it("passes through input it cannot serialise", () => {
    const breaker = createRepeatBreaker(1);
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(breaker.check("bash", circular)).toBeUndefined();
  });
});

describe("applyThinkingCompat", () => {
  const offOnCompat = { api: "openai-completions", thinkingLevel: "off" };

  it("injects the one channel a vLLM backend actually reads", () => {
    const patched = applyThinkingCompat({ model: "zai-org/GLM-5.2", messages: [] }, offOnCompat);
    expect(patched?.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(patched?.model).toBe("zai-org/GLM-5.2");
  });

  // The top-level `thinking` param is what the zai format sends and what the server drops.
  // Removing it is not our job; the run must keep working on a real z.ai endpoint too.
  it("leaves an existing top-level thinking param alone", () => {
    const patched = applyThinkingCompat(
      { messages: [], thinking: { type: "disabled" } },
      offOnCompat,
    );
    expect(patched?.thinking).toEqual({ type: "disabled" });
    expect(patched?.chat_template_kwargs).toEqual({ enable_thinking: false });
  });

  it("merges into kwargs pi already set rather than replacing them", () => {
    const patched = applyThinkingCompat(
      { messages: [], chat_template_kwargs: { preserve_thinking: true, enable_thinking: true } },
      offOnCompat,
    );
    expect(patched?.chat_template_kwargs).toEqual({ preserve_thinking: true, enable_thinking: false });
  });

  it("is a no-op when the model config already sends the right thing", () => {
    const payload = { messages: [], chat_template_kwargs: { enable_thinking: false } };
    expect(applyThinkingCompat(payload, offOnCompat)).toBeUndefined();
  });

  // Anthropic's Messages API rejects unknown top-level fields, so injecting there would
  // 400 every call of a judged run rather than degrading.
  it("never touches a non openai-completions payload", () => {
    expect(applyThinkingCompat({ messages: [] }, { api: "anthropic-messages", thinkingLevel: "off" }))
      .toBeUndefined();
    expect(applyThinkingCompat({ messages: [] }, { api: undefined, thinkingLevel: "off" }))
      .toBeUndefined();
  });

  it("never suppresses a reasoning level the operator asked for", () => {
    for (const thinkingLevel of ["minimal", "low", "medium", "high"]) {
      expect(applyThinkingCompat({ messages: [] }, { api: "openai-completions", thinkingLevel }))
        .toBeUndefined();
    }
  });

  it("can be switched off for an A/B without editing the extension", () => {
    expect(applyThinkingCompat({ messages: [] }, { ...offOnCompat, enabled: false })).toBeUndefined();
  });

  it("passes through any payload shape it does not recognise", () => {
    expect(applyThinkingCompat(undefined, offOnCompat)).toBeUndefined();
    expect(applyThinkingCompat("not a payload", offOnCompat)).toBeUndefined();
    expect(applyThinkingCompat([1, 2, 3], offOnCompat)).toBeUndefined();
    expect(applyThinkingCompat({ messages: [], chat_template_kwargs: "odd" }, offOnCompat))
      .toBeUndefined();
  });
});

describe("checkProductModel", () => {
  const model = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    title: "Items",
    entities: [
      {
        id: "item",
        singular: "item",
        plural: "items",
        attributes: [
          { id: "name", label: "Name", kind: "text", required: true },
          { id: "qty", label: "Qty", kind: "number", required: false },
        ],
      },
    ],
    links: [],
    journeys: [{ kind: "add", journey: "Add an item" }],
    derived: [],
    assumptions: [],
    ...overrides,
  });

  it("passes the empty seed and a valid model", () => {
    expect(
      checkProductModel({ title: "", entities: [], links: [], journeys: [], derived: [], assumptions: [] }),
    ).toBeUndefined();
    expect(checkProductModel(model())).toBeUndefined();
  });

  it("names the journey kind that cost qw-projtasks-2 its run", () => {
    const reason = checkProductModel(
      model({
        journeys: [
          { kind: "add", journey: "Add a job" },
          { kind: "remove", journey: "Delete a job" },
        ],
      }),
    );
    expect(reason).toBe(
      'journeys[1].kind is "remove", which is not a journey kind. ' +
        "Use one of: add, edit, delete, filter, derive, persist",
    );
  });

  it("names the derived kind, and accepts the correct spellings of both", () => {
    expect(checkProductModel(model({ journeys: [{ kind: "derived", journey: "Show a count" }] }))).toContain(
      "not a journey kind",
    );
    expect(
      checkProductModel(model({ derived: [{ id: "n", label: "Count", kind: "count", entity: "item" }] })),
    ).toBe(
      'derived[0].kind is "count", which is not a derived kind. ' +
        "Use one of: count-nodes, count-nodes-where, sum-number",
    );
    expect(
      checkProductModel(
        model({
          journeys: [
            { kind: "delete", journey: "Delete an item" },
            { kind: "derive", journey: "Show a count" },
          ],
          derived: [{ id: "n", label: "Count", kind: "count-nodes", entity: "item" }],
        }),
      ),
    ).toBeUndefined();
  });

  it("names an attribute kind that does not exist", () => {
    const reason = checkProductModel(
      model({
        entities: [
          {
            id: "item",
            singular: "item",
            plural: "items",
            attributes: [{ id: "when", label: "When", kind: "datetime", required: true }],
          },
        ],
      }),
    );
    expect(reason).toContain("entities[0].attributes[0].kind");
    expect(reason).toContain("text, textarea, choice, number, boolean, date");
  });

  it("reports broken derived references and lists what is available", () => {
    expect(checkProductModel(model({ derived: [{ id: "n", label: "N", kind: "count-nodes", entity: "job" }] })))
      .toContain("no entity has that id. Declared entities: item");
    expect(
      checkProductModel(
        model({
          derived: [
            { id: "n", label: "N", kind: "count-nodes-where", entity: "item", where: { attribute: "typo", present: true } },
          ],
        }),
      ),
    ).toContain("item has no such attribute. It has: name, qty");
    expect(checkProductModel(model({ derived: [{ id: "n", label: "N", kind: "count-nodes-where", entity: "item" }] })))
      .toContain("nothing to count");
    expect(
      checkProductModel(
        model({ derived: [{ id: "s", label: "Total", kind: "sum-number", entity: "item", attribute: "name" }] }),
      ),
    ).toContain("sum-number needs a number attribute");
    expect(
      checkProductModel(
        model({ derived: [{ id: "s", label: "Total", kind: "sum-number", entity: "item", attribute: "qty" }] }),
      ),
    ).toBeUndefined();
  });

  it("reports a file that is not a model at all", () => {
    expect(checkProductModel(null)).toBe("the file is not a JSON object");
    expect(checkProductModel([])).toBe("the file is not a JSON object");
    expect(checkProductModel({ title: 1 })).toContain("title is 1");
    expect(checkProductModel({ title: "x" })).toContain("entities is missing");
  });

  it("explains the symptom the model would otherwise have to diagnose", () => {
    const note = productModelDiagnostic("journeys[1].kind is \"remove\"");
    expect(note).toContain('journeys[1].kind is "remove"');
    expect(note).toContain("The product definition could not be read");
    expect(note).toContain("do not change src/graph/ or App.tsx");
  });
});

describe("product-model diagnostics on tool_result", () => {
  type Handler = (event: Record<string, unknown>) => { content?: unknown[] } | undefined;

  async function handlerAndFile(contents: string): Promise<{ run: Handler; file: string }> {
    const handlers = new Map<string, Handler>();
    protectedPaths({
      on: (event: string, handler: Handler) => handlers.set(event, handler),
    } as never);
    const handler = handlers.get("tool_result");
    if (!handler) throw new Error("no tool_result handler registered");
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-cofounder-model-check-"));
    temporaryDirectories.push(directory);
    const file = path.join(directory, "product-model.json");
    await writeFile(file, contents);
    return { run: handler, file };
  }

  const result = (file: string, overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    toolName: "write",
    isError: false,
    input: { path: file },
    content: [{ type: "text", text: "wrote 1 file" }],
    ...overrides,
  });

  it("appends the reason to a write that broke the model, keeping the original content", async () => {
    const { run, file } = await handlerAndFile(
      JSON.stringify({
        title: "Jobs",
        entities: [],
        links: [],
        journeys: [{ kind: "remove", journey: "Delete a job" }],
        derived: [],
        assumptions: [],
      }),
    );
    const returned = run(result(file));
    expect(returned?.content).toHaveLength(2);
    expect(returned?.content?.[0]).toEqual({ type: "text", text: "wrote 1 file" });
    expect(JSON.stringify(returned?.content?.[1])).toContain("not a journey kind");
  });

  it("stays silent on a model that loads, on other files, and on a failed write", async () => {
    const valid = JSON.stringify({
      title: "Jobs",
      entities: [],
      links: [],
      journeys: [{ kind: "delete", journey: "Delete a job" }],
      derived: [],
      assumptions: [],
    });
    const { run, file } = await handlerAndFile(valid);
    expect(run(result(file))).toBeUndefined();
    expect(run(result(file, { isError: true }))).toBeUndefined();
    expect(run(result(file, { toolName: "bash" }))).toBeUndefined();
    expect(run(result(path.join(path.dirname(file), "App.tsx")))).toBeUndefined();
  });

  it("never throws on unreadable or unparseable input", async () => {
    const { run, file } = await handlerAndFile("{ not json");
    expect(run(result(file))).toBeUndefined();
    expect(run(result(path.join(path.dirname(file), "nope/product-model.json")))).toBeUndefined();
    expect(run(result(file, { input: {} }))).toBeUndefined();
  });
});

import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { acquireRunLock, lockPathFor, processIsAlive, RunLockedError } from "../src/run-lock.js";

const temporaryDirectories: string[] = [];

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-cofounder-lock-"));
  temporaryDirectories.push(root);
  return root;
}

const details = { ideaFile: "docs/personal/eval/timer.txt", outputDirectory: "output/app" };

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("acquireRunLock", () => {
  it("records the holder and releases the file", async () => {
    const root = await fixture();
    const lock = await acquireRunLock(root, details);

    expect(lock.path).toBe(lockPathFor(root));
    const holder = JSON.parse(await readFile(lock.path, "utf8"));
    expect(holder).toMatchObject({ pid: process.pid, idea_file: details.ideaFile, output_directory: "output/app" });

    await lock.release();
    await expect(readFile(lock.path, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses a second run while the first is alive", async () => {
    const root = await fixture();
    const lock = await acquireRunLock(root, details);

    await expect(acquireRunLock(root, details)).rejects.toBeInstanceOf(RunLockedError);
    await expect(acquireRunLock(root, details)).rejects.toThrow(String(process.pid));

    await lock.release();
    const second = await acquireRunLock(root, details);
    await second.release();
  });

  it("takes over a lock whose process is gone", async () => {
    const root = await fixture();
    const lockPath = lockPathFor(root);
    await mkdir(path.dirname(lockPath), { recursive: true });
    const deadPid = await unusedPid();
    await writeFile(
      lockPath,
      JSON.stringify({ pid: deadPid, started_at: "2026-08-25T21:07:22.236Z", ...details }),
      "utf8",
    );

    const lock = await acquireRunLock(root, details);
    expect(JSON.parse(await readFile(lock.path, "utf8")).pid).toBe(process.pid);
    await lock.release();
  });

  it("takes over an unreadable lock", async () => {
    const root = await fixture();
    const lockPath = lockPathFor(root);
    await mkdir(path.dirname(lockPath), { recursive: true });
    await writeFile(lockPath, "not json", "utf8");

    const lock = await acquireRunLock(root, details);
    expect(JSON.parse(await readFile(lock.path, "utf8")).pid).toBe(process.pid);
    await lock.release();
  });

  it("leaves a lock that another process has since claimed", async () => {
    const root = await fixture();
    const lock = await acquireRunLock(root, details);
    await writeFile(lock.path, JSON.stringify({ pid: process.pid + 1, started_at: "", ...details }), "utf8");

    await lock.release();

    expect(JSON.parse(await readFile(lock.path, "utf8")).pid).toBe(process.pid + 1);
  });
});

describe("processIsAlive", () => {
  it("recognises this process and rejects nonsense", async () => {
    expect(processIsAlive(process.pid)).toBe(true);
    expect(processIsAlive(0)).toBe(false);
    expect(processIsAlive(-1)).toBe(false);
    expect(processIsAlive(await unusedPid())).toBe(false);
  });
});

async function unusedPid(): Promise<number> {
  for (let candidate = 2 ** 22 - 1; candidate > 2 ** 21; candidate -= 1) {
    if (!processIsAlive(candidate)) return candidate;
  }
  throw new Error("Could not find an unused pid");
}

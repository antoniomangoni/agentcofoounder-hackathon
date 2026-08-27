import { readFileSync, unlinkSync } from "node:fs";
import { mkdir, open, readFile, unlink } from "node:fs/promises";
import path from "node:path";

const LOCK_BASENAME = ".challenge.lock";
const RELEASE_SIGNALS: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];

export interface RunLockHolder {
  pid: number;
  started_at: string;
  idea_file: string;
  output_directory: string;
}

export interface RunLock {
  path: string;
  release: () => Promise<void>;
}

export class RunLockedError extends Error {
  readonly lockPath: string;
  readonly holder: RunLockHolder | undefined;

  constructor(lockPath: string, holder: RunLockHolder | undefined) {
    const who = holder
      ? `pid ${holder.pid}, started ${holder.started_at}, idea ${holder.idea_file}, output ${holder.output_directory}`
      : "an unreadable lock file";
    super(
      `Another challenge run is in progress (${who}).\n` +
        `Runs share the output tree, port 3000 and result.json, so they cannot overlap — wait for it to finish.\n` +
        `If that process is gone, delete ${lockPath}`,
    );
    this.name = "RunLockedError";
    this.lockPath = lockPath;
    this.holder = holder;
  }
}

export function lockPathFor(repositoryRoot: string): string {
  return path.join(repositoryRoot, "output", LOCK_BASENAME);
}

export function processIsAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to another user.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function parseHolder(raw: string): RunLockHolder | undefined {
  let value: Partial<RunLockHolder>;
  try {
    value = JSON.parse(raw) as Partial<RunLockHolder>;
  } catch {
    return undefined;
  }
  if (typeof value?.pid !== "number") return undefined;
  return {
    pid: value.pid,
    started_at: typeof value.started_at === "string" ? value.started_at : "an unknown time",
    idea_file: typeof value.idea_file === "string" ? value.idea_file : "an unknown idea",
    output_directory: typeof value.output_directory === "string" ? value.output_directory : "an unknown directory",
  };
}

async function readHolder(lockPath: string): Promise<RunLockHolder | undefined> {
  try {
    return parseHolder(await readFile(lockPath, "utf8"));
  } catch {
    return undefined;
  }
}

/** Remove the lock only while it still names this process, so a stale takeover cannot delete a live lock. */
function releaseOwnedLock(lockPath: string, pid: number): void {
  try {
    const existing = parseHolder(readFileSync(lockPath, "utf8"));
    if (existing && existing.pid !== pid) return;
    unlinkSync(lockPath);
  } catch {
    // Already released, or never written.
  }
}

export async function acquireRunLock(
  repositoryRoot: string,
  details: { ideaFile: string; outputDirectory: string },
): Promise<RunLock> {
  const lockPath = lockPathFor(repositoryRoot);
  await mkdir(path.dirname(lockPath), { recursive: true });

  const holder: RunLockHolder = {
    pid: process.pid,
    started_at: new Date().toISOString(),
    idea_file: details.ideaFile,
    output_directory: details.outputDirectory,
  };

  // Two passes at most: one to discover a stale lock, one to claim it.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let handle: Awaited<ReturnType<typeof open>>;
    try {
      handle = await open(lockPath, "wx");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = await readHolder(lockPath);
      if (existing && processIsAlive(existing.pid)) throw new RunLockedError(lockPath, existing);
      try {
        await unlink(lockPath);
      } catch (unlinkError) {
        if ((unlinkError as NodeJS.ErrnoException).code !== "ENOENT") throw unlinkError;
      }
      continue;
    }
    try {
      await handle.writeFile(`${JSON.stringify(holder, null, 2)}\n`, "utf8");
    } finally {
      await handle.close();
    }
    return attachRelease(lockPath, holder.pid);
  }

  throw new RunLockedError(lockPath, await readHolder(lockPath));
}

function attachRelease(lockPath: string, pid: number): RunLock {
  let released = false;

  const onSignal = (signal: NodeJS.Signals): void => {
    releaseOwnedLock(lockPath, pid);
    released = true;
    for (const registered of RELEASE_SIGNALS) process.removeListener(registered, onSignal);
    process.kill(process.pid, signal);
  };
  const onExit = (): void => {
    if (!released) releaseOwnedLock(lockPath, pid);
  };

  for (const signal of RELEASE_SIGNALS) process.on(signal, onSignal);
  process.on("exit", onExit);

  return {
    path: lockPath,
    release: async () => {
      if (released) return;
      released = true;
      for (const signal of RELEASE_SIGNALS) process.removeListener(signal, onSignal);
      process.removeListener("exit", onExit);
      try {
        const existing = await readHolder(lockPath);
        if (existing && existing.pid !== pid) return;
        await unlink(lockPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    },
  };
}

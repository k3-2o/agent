// Shared helpers for the lsp-warden test suite.
// NOTE: this file must never statically import `../warden` (the implementation
// does not exist yet while the harness self-tests are green). Type-only imports
// are safe: `bun` erases `import type` without resolving the module.
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir as osTmpdir } from "node:os";
import { join } from "node:path";

/** Absolute path of the spawnable FakeServer script (the warden's child argv tail). */
export const fakeServerPath = join(import.meta.dir, "fake-server.ts");

/**
 * Domain shape of one JSONL line (FakeServer log or warden `--log`).
 * `params`/`result`/`error` stay `unknown` — they are wire payloads asserted
 * with deep-equality matchers, never property-accessed blindly.
 */
export interface LogEvent {
  ev: string;
  pid?: number;
  method?: string;
  id?: string | number;
  params?: unknown;
  result?: unknown;
  error?: unknown;
  uri?: string;
  reason?: string;
}

/** Guard: is this parsed JSON a log line we understand? */
export function isLogEvent(v: unknown): v is LogEvent {
  return v !== null && typeof v === "object" && typeof (v as { ev?: unknown }).ev === "string";
}

/** One fresh scratch dir per test. */
export function tmpdir(): string {
  return mkdtempSync(join(osTmpdir(), "lsp-warden-test-"));
}

/** Recursively remove a scratch dir. */
export function rmdir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

/** Parse a JSONL log; missing file is []. Tolerates a line read mid-append. */
export function readLog(path: string): LogEvent[] {
  if (!existsSync(path)) return [];
  const out: LogEvent[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const parsed: unknown = JSON.parse(t);
      if (isLogEvent(parsed)) out.push(parsed);
    } catch {
      // torn trailing line (racing appendFileSync); a later waitFor re-reads
    }
  }
  return out;
}

/** Poll `fn` until truthy; throw after timeoutMs. */
export async function waitFor(
  fn: () => boolean | Promise<boolean>,
  timeoutMs = 2000,
  pollMs = 10,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await fn()) return;
    if (Date.now() > deadline) throw new Error(`waitFor timed out after ${timeoutMs}ms`);
    await Bun.sleep(pollMs);
  }
}

/**
 * Real-time quiescence pause for negative assertions (no spawn/recv happened).
 * Test seam: one shared window keeps every negative assertion consistent.
 */
export const settle = (ms = 150) => Bun.sleep(ms);

/** Process liveness probe via signal 0. */
export function alive(pid: number): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    if (!(e instanceof Error) || !("code" in e)) return false;
    return e.code === "EPERM"; // exists but not ours
  }
}

/**
 * Set/restore process.env keys around `fn`. The warden passes its environment
 * through to the child, so FakeServer knobs (WARDEN_TEST_FAKE / WARDEN_TEST_LOG)
 * must be set BEFORE createWarden spawns anything and restored afterwards.
 */
export async function withEnv<T>(
  env: Record<string, string | undefined>,
  fn: () => Promise<T>,
): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) {
    saved[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k]!;
  }
  try {
    return await fn();
  } finally {
    for (const k of Object.keys(env)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

/** FakeServer `start` line pids, in order. */
export function startPids(log: LogEvent[]): number[] {
  return log.flatMap((e) => (e.ev === "start" && typeof e.pid === "number" ? [e.pid] : []));
}

/** FakeServer `recv` entries, in order. */
export function recvs(log: LogEvent[]): LogEvent[] {
  return log.filter((e) => e.ev === "recv");
}
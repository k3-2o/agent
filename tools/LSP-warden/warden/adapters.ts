// lsp-warden — adapters: the ONLY process/I-O touchpoints (real clock, child spawn, JSONL log, --scopes enumeration, child termination); policy never imports this; the import spine stays acyclic (adapters imports only the Clock/PidReader types).
import { appendFileSync, lstatSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Subprocess } from "bun";
import type { Clock, PidReader } from "./policy";

/** Real wall clock for the injected Clock seam — the only CLOCK source of policy time (AGENTS 3); terminateChild's grace timers are the real-time I/O-convergence exception. */
export function realClock(): Clock {
  return {
    now: () => Date.now(),
    setTimeout: (cb: () => void, ms: number) => setTimeout(cb, ms),
    clearTimeout: (h: unknown) => clearTimeout(h as Parameters<typeof clearTimeout>[0]),
  };
}

/** JSONL event logger — one appendFileSync line per event; lazy (nothing opened or written until the first event, so usage errors never create or litter the file). */
export function createLogger(path: string): (ev: string, extra?: Record<string, unknown>) => void {
  return (ev, extra) => {
    appendFileSync(path, JSON.stringify({ ev, ...extra }) + "\n");
  };
}

/** Spawn per the P1 contract: env snapshot at spawn (Bun ignores later process.env mutations); stdin/stdout piped, stderr inherited; null on spawn failure (→ down state). */
export function spawnChild(tail: string[], cwd: string): Subprocess | null {
  try {
    return Bun.spawn(tail, {
      cwd,
      env: { ...process.env },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "inherit",
    });
  } catch {
    return null;
  }
}

/** Real procfs VmRSS reader (kB); any read failure → undefined = under-budget/skip-sample, never over-budget (K4). */
export function realPidReader(): PidReader {
  return (pid) => {
    try {
      const status = readFileSync(`/proc/${pid}/status`, "utf8");
      const m = /^VmRSS:\s*(\d+)\s*kB$/m.exec(status);
      return m === null ? undefined : Number(m[1]);
    } catch {
      return undefined;
    }
  };
}

/** --scopes glob → anchored RegExp: `*` = one path segment ([^/]*), no `**`; everything else escaped. */
function globToRegExp(glob: string): RegExp {
  let out = "";
  for (const ch of glob) out += ch === "*" ? "[^/]*" : ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${out}$`);
}

/** --scopes walk prunes these at ANY depth — bounded one-shot startup enumeration (vendored trees would dominate). */
const SKIP_DIR_NAMES: Record<string, true> = { node_modules: true, ".git": true };

/** --scopes startup enumeration: walk under the warden's cwd; a scope = a dir whose RELATIVE path matches the glob (multi-level like packages/* works) that contains a tsconfig.json; dir ENTRY checks use lstat, so symlinked dirs never descend; ABSOLUTE paths, lexicographic; zero matches → [] (everything answers -32027, nothing spawns). */
export function listScopes(glob: string): string[] {
  const re = globToRegExp(glob);
  const cwd = process.cwd();
  const found: string[] = [];
  const walk = (rel: string): void => {
    let names: string[];
    try {
      names = readdirSync(rel === "" ? cwd : join(cwd, rel));
    } catch {
      return;
    }
    for (const name of names.sort()) {
      if (SKIP_DIR_NAMES[name]) continue;
      const childRel = rel === "" ? name : `${rel}/${name}`;
      let st;
      try {
        st = lstatSync(join(cwd, childRel));
      } catch {
        continue;
      }
      if (!st.isDirectory()) continue;
      if (re.test(childRel)) {
        try {
          if (statSync(join(cwd, childRel, "tsconfig.json")).isFile()) found.push(childRel);
        } catch {}
      }
      walk(childRel);
    }
  };
  walk("");
  return found.sort().map((rel) => join(cwd, rel));
}

/** SIGTERM → real grace → SIGKILL, awaiting the exit — real-time I/O convergence, never policy time (AGENTS 3); `exited` may reject on a spawn-failure edge — never surface it as an unhandled rejection. */
export async function terminateChild(c: Subprocess, graceMs: number): Promise<void> {
  try {
    c.kill("SIGTERM");
  } catch {}
  const grace = new Promise<boolean>((resolve) => {
    const t = setTimeout(() => resolve(true), graceMs);
    void c.exited.then(() => clearTimeout(t)).catch(() => {});
  });
  const timedOut = await Promise.race([c.exited.then(() => false), grace]);
  if (timedOut) {
    try {
      c.kill("SIGKILL");
    } catch {}
    await c.exited.catch(() => {});
  }
}
// lsp-warden — transparent LSP proxy. Shell: parseArgs + Config validation, createWarden wiring (adapters + policy + per-scope pumps + dispose), the CLI entry, and the frozen import surface re-exported unchanged — tests import ../warden only.
import { createPolicy } from "./policy";
import type { Clock, Config, PidReader, Policy, PolicyIo, Scope } from "./policy";
import { FrameParser } from "./wire";
import { createLogger, listScopes, realClock, realPidReader, spawnChild as spawnProcess, terminateChild } from "./adapters";
import type { Subprocess } from "bun";

/** Injectable clock — the ONLY way policy code reads time or arms timers. */
export type { Clock } from "./policy";
/** Injectable VmRSS reader (kB); `undefined` = no data (under-budget/skip). */
export type { PidReader } from "./policy";

/** Framed client I/O streams + idempotent dispose (frozen surface). */
export interface WardenHandle {
  clientIn: WritableStream<Uint8Array>;
  clientOut: ReadableStream<Uint8Array>;
  dispose(): Promise<void>;
}

/** Thrown on any CLI violation; message starts with "usage:" (SPEC §4.6). */
export class WardenUsageError extends Error {}

const DEFAULT_CONFIG = {
  idleSecs: 600,
  budgetMb: 0,
  sustain: 2,
  sampleSecs: 5,
  sleepAfter: 900,
  maxInflight: 3,
} as const;

/** Validate once, before any spawn or log I/O (SPEC §4.6): numeric flags /^\d+$/ with bounds; unknown flag, missing value, missing/empty `--` tail → WardenUsageError; duplicates last-wins. */
function parseArgs(argv: string[]): Config {
  const cfg: Config = { ...DEFAULT_CONFIG, log: null, scopes: null, tail: [] };
  let tail: string[] | null = null;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (tail !== null) {
      tail.push(flag);
      continue;
    }
    if (flag === "--") {
      tail = [];
      continue;
    }
    const numeric = (min: number): number => {
      const raw = argv[++i];
      if (raw === undefined) throw new WardenUsageError(`usage: ${flag} requires a value`);
      if (!/^\d+$/.test(raw)) throw new WardenUsageError(`usage: ${flag} expects an integer, got "${raw}"`);
      const n = Number(raw);
      if (n < min) throw new WardenUsageError(`usage: ${flag} must be >= ${min}`);
      return n;
    };
    switch (flag) {
      case "--idle-secs":
        cfg.idleSecs = numeric(0);
        break;
      case "--budget-mb":
        cfg.budgetMb = numeric(0);
        break;
      case "--sustain":
        cfg.sustain = numeric(1);
        break;
      case "--sample-secs":
        cfg.sampleSecs = numeric(1);
        break;
      case "--sleep-after":
        cfg.sleepAfter = numeric(0);
        break;
      case "--max-inflight":
        cfg.maxInflight = numeric(1);
        break;
      case "--log": {
        const v = argv[++i];
        if (v === undefined) throw new WardenUsageError("usage: --log requires a value");
        cfg.log = v;
        break;
      }
      case "--scopes": {
        const v = argv[++i];
        if (v === undefined) throw new WardenUsageError("usage: --scopes requires a value");
        cfg.scopes = v;
        break;
      }
      default:
        throw new WardenUsageError(`usage: unknown flag ${flag}`);
    }
  }
  if (tail === null) throw new WardenUsageError("usage: missing `--` before the child command");
  if (tail.length === 0) throw new WardenUsageError("usage: empty child command after `--`");
  cfg.tail = tail;
  return cfg;
}

/** Runs the proxy in-process: a real spawned child over real pipes; policy time comes from the injected Clock; usage errors throw before anything is spawned or logged. */
export async function createWarden(
  argv: string[],
  hooks: { clock?: Clock; pidReader?: PidReader } = {},
): Promise<WardenHandle> {
  const cfg = parseArgs(argv);

  const clock: Clock = hooks.clock ?? realClock();
  const pidReader: PidReader | null = hooks.pidReader ?? realPidReader();

  let out: ReadableStreamDefaultController<Uint8Array> | null = null;
  let outClosed = false;

  const io: PolicyIo = {
    clock,
    pidReader,
    log: cfg.log === null ? () => {} : createLogger(cfg.log),
    clientEnqueue: (frame) => {
      out?.enqueue(frame);
    },
    clientClose: () => {
      if (outClosed) return;
      outClosed = true;
      try {
        out?.close();
      } catch {}
    },
    writeToChild: (c, frame) => {
      c.stdin.write(frame);
      c.stdin.flush();
    },
    spawn: (scope) => {
      const fresh = spawnProcess(cfg.tail, scope.dir ?? process.cwd());
      if (fresh === null) return null;
      scope.child = fresh;
      void pumpChild(scope, fresh);
      return fresh;
    },
    terminateChild,
    sleep: (ms) => Bun.sleep(ms),
    listScopes: () => (cfg.scopes === null ? [] : listScopes(cfg.scopes)),
  };

  const policy = createPolicy(cfg, io);

  /** Per-child stdout pump + parser — every child (and each revive/restart replacement) gets its own, so an old child's EOF can never poison a newer one's stream; stream end → the exit watcher reconciles the scope. */
  async function pumpChild(scope: Scope, child: Subprocess): Promise<void> {
    if (child.stdout === null) return;
    const parser = new FrameParser();
    try {
      for await (const chunk of child.stdout) {
        if (policy.fatal || policy.disposed) return;
        for (const body of parser.feed(chunk)) {
          if (policy.fatal || policy.disposed) return;
          try {
            policy.handleChildFrame(scope, child, body);
          } catch {
            return;
          }
          if (policy.fatal) return;
        }
        if (parser.fatal) {
          policy.onFatal();
          return;
        }
      }
      if (!policy.fatal && !policy.disposed) {
        parser.finish();
        if (parser.fatal) policy.onFatal();
      }
    } catch {}
    policy.onChildExit(scope, child);
  }

  const clientParser = new FrameParser();

  const clientOut = new ReadableStream<Uint8Array>({
    start(c) {
      out = c;
    },
  });
  const clientIn = new WritableStream<Uint8Array>({
    write(chunk) {
      if (policy.fatal || policy.disposed) return;
      for (const body of clientParser.feed(chunk)) {
        if (policy.fatal || policy.disposed) return;
        policy.handleClientFrame(body);
        if (policy.fatal) return;
      }
      if (clientParser.fatal) policy.onFatal();
    },
    close() {
      clientParser.finish();
      if (clientParser.fatal) policy.onFatal();
    },
  });

  // Match-all scope keeps P1's eager child (X5 disposes immediately; F5: starts <= 1); --scopes mode spawns nothing here — children appear lazily on their scope's first routed message (K3: an unmatched uri spawns nothing).
  const scopes = policy.scopes;
  if (scopes.length > 0 && scopes[0].dir === null) io.spawn(scopes[0]);
  for (const scope of scopes) {
    policy.startSweeper(scope);
    policy.startSampler(scope);
    policy.startSleepCheck(scope);
  }

  return { clientIn, clientOut, dispose: () => policy.dispose() };
}

// CLI exit semantics. Bun's WHATWG stream locks force ONE held stdin writer (never per-chunk getWriter, no double
// stdin iteration). `writer.close()` runs the sink's finish() BEFORE `eofFlag` is set — a truncated final frame flips
// fatal inside that await and exits 1 with the reason; a clean EOF sets the flag after close() and exits 0.

// Bun 1.4.2 strips the FIRST `--` from script argv — a bare `lsp-warden -- cmd` loses the delimiter; every real
// invocation (flags first, per P11's lsp.json) is unaffected.
if (import.meta.main) {
  const w = await createWarden(process.argv.slice(2));
  let eofFlag = false;
  void (async () => {
    const writer = w.clientIn.getWriter();
    try {
      for await (const chunk of Bun.stdin.stream()) await writer.write(chunk);
      await writer.close();
      eofFlag = true;
      await w.dispose();
    } catch {
      await w.dispose().catch(() => {});
    } finally {
      writer.releaseLock();
    }
  })();
  for await (const chunk of w.clientOut) await Bun.write(Bun.stdout, chunk);
  if (!eofFlag) {
    // Bun.write rejects WriteStream objects — write to the fd so the awaited reason is flushed before exit.
    await Bun.write(process.stderr.fd, "lsp-warden: fatal frame error\n");
    process.exit(1);
  }
}
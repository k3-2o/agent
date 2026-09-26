// lsp-warden — policy layer: Scope ownership + every policy rule (registry + 15 s sweeper, initialize cache, expected exit, revive/restart, budget sample + drain, crash guard, sleep/wake, diagnostics cache, limiter, --scopes expansion + routing). PURE: all seams (Clock, PidReader, logger, client stream, child write/spawn/kill, real-time waits, --scopes walk) are injected through PolicyIo; wire primitives come from ./wire.
// Import spine: wire <- policy <- warden, adapters <- warden — this file must never import adapters.ts (it imports only the Clock/PidReader types from here).
import { encodeFrame, encodeJson, kindOf, utf8 } from "./wire";
import type { Subprocess } from "bun";

export interface Clock {
  now(): number;
  setTimeout(cb: () => void, ms: number): unknown;
  clearTimeout(h: unknown): void;
}

export type PidReader = (pid: number) => number | undefined;

export interface Config {
  idleSecs: number;
  budgetMb: number;
  sustain: number;
  sampleSecs: number;
  sleepAfter: number;
  maxInflight: number;
  log: string | null;
  scopes: string | null;
  tail: string[];
}

const SWEEP_MS = 15_000;
const SLEEP_CHECK_MS = 1000;
const DISPOSE_TERM_GRACE_MS = 2000;
const TERM_GRACE_MS = 5000;
/** Budget-restart drain deadline — POLICY time (Clock): requests still in flight here are answered -32026, then the child dies (R3). */
const DRAIN_MS = 3000;
const CRASH_WINDOW_MS = 60_000;
const CRASH_LIMIT = 3;
// Expected-exit kill settle (~25 ms real I/O): the exit frame must reach the child's pipe before SIGTERM,
// else the child may never be scheduled to read it — L4's recv-order pin breaks.
const EXIT_KILL_SETTLE_MS = 25;

/** Method-role table — the ONE source both the P8 limiter (expensive) and the P7 cache exclusion (neverCache) read; methods absent here (initialize/initialized/shutdown/exit, didOpen/didChange/didClose, `$/*`) are neither by construction. */
interface MethodRole {
  expensive: boolean;
  neverCache: boolean;
}

const NEVER_CACHE_PREFIX = "workspace/";

const METHOD_ROLES: Readonly<Record<string, MethodRole>> = {
  "textDocument/diagnostic": { expensive: true, neverCache: false },
  "textDocument/references": { expensive: true, neverCache: true },
  "textDocument/definition": { expensive: true, neverCache: true },
  "textDocument/typeDefinition": { expensive: true, neverCache: true },
  "textDocument/implementation": { expensive: true, neverCache: true },
  "textDocument/rename": { expensive: true, neverCache: true },
  "textDocument/codeAction": { expensive: true, neverCache: false },
  "textDocument/hover": { expensive: true, neverCache: false },
  "textDocument/documentSymbol": { expensive: true, neverCache: false },
  "textDocument/formatting": { expensive: true, neverCache: false },
  "textDocument/rangeFormatting": { expensive: true, neverCache: false },
};

function isExpensive(method: string): boolean {
  return METHOD_ROLES[method]?.expensive === true;
}

function isNeverCache(method: string): boolean {
  return method.startsWith(NEVER_CACHE_PREFIX) || METHOD_ROLES[method]?.neverCache === true;
}

function expandScopes(cfg: Config, io: PolicyIo): Scope[] {
  if (cfg.scopes === null) return [new Scope(0)];
  const scopes: Scope[] = [];
  for (const dir of io.listScopes()) scopes.push(new Scope(scopes.length, dir));
  return scopes;
}

/** One open-file entry — the ONLY home of file text (AGENTS 4). `text` is the CURRENT full text (didChange replaces it); `doc` preserves the last didOpen metadata so a replay is a faithful didOpen with only the text swapped. `lastTouchMs` is the lease (didOpen-upserts and didChange reset it; the sweeper closes entries past idleSecs); `inFlight` pins the entry against the sweep for each forwarded request (P4) — every completion path releases exactly one pin. */
interface RegistryEntry {
  lastTouchMs: number;
  text: string;
  inFlight: number;
  doc: { uri: string; languageId?: string; version?: number };
}

export class Scope {
  readonly id: number;
  readonly dir: string | null;
  child: Subprocess | null = null;
  nextChildId = 1;
  toChild = new Map<number, number | string>();
  toClient = new Map<number | string, number | string>();
  registry = new Map<string, RegistryEntry>();
  /** P4 lease pins: child-side request id → the registry ENTRY it protects, set at forward time, deleted exactly once on that id's answer (the map IS the double-decrement guard). Values are entry OBJECTS, not uris: a didOpen upsert mid-flight replaces the registry entry, and decrementing the replacement would drain the NEW request's pin. */
  inFlightByChildId = new Map<number, RegistryEntry>();
  /** First client-initiated initialize exchange's params+result — repeat client initializes are served from here; warden-initiated (revive/restart) initializes consume their response WITHOUT touching it (L5). */
  initCache: { params: unknown; result: unknown } | null = null;
  firstInit: { childId: number; params: unknown; resolve?: (ok: boolean) => void } | null = null;
  pendingInit: { id: number; resolve: (ok: boolean) => void } | null = null;
  state: "up" | "down" | "asleep" | "dead" = "up";
  reviving = false;
  lastRequestMs = 0;
  queue: Array<Record<string, unknown>> = [];
  /** P7 diagnostics cache: uri → { hash, report }. Written ONLY by a child response completing a client textDocument/diagnostic request, and only for its `result` (an error answer never writes); the hash is registry text at FORWARD time, so the entry goes inert the moment text moves; never evicted (stale entries are inert by construction). */
  diagCache = new Map<string, { hash: string; report: unknown }>();
  /** P8 max-inflight limiter — `inflight` counts expensive requests forwarded and not yet completed; `queue` holds gated expensive requests as the ORIGINAL client message (own id intact), drained ONLY by an expensive completion (synchronous FIFO), the drain deadline (-32026 — queued + in-flight cleared together, R3), or a revive flush re-entering the gate. Notifications, non-expensive requests, cache-served and -32026 answers never occupy a slot. */
  limiter: { inflight: number; queue: Array<Record<string, unknown>> } = { inflight: 0, queue: [] };
  overCount = 0;
  killing: Subprocess | null = null;
  crashTs: number[] = [];
  /** P5 crash-retry ledger: forwarded-but-unanswered childId → the ORIGINAL client message (client-side id kept) + textHash, the registry-text wyhash sampled at FORWARD time — what a crash re-forwards (R4) and P7's cache store reads for the hash (inert the moment text moves). */
  pendingRequests = new Map<number, { msg: Record<string, unknown>; textHash: string | null }>();
  restartSeq = 0;
  sweepHandle: unknown = null;
  samplerHandle: unknown = null;
  sleepHandle: unknown = null;
  drainWaiter: (() => void) | null = null;
  /** Notifications arriving before this scope's first spawn finished warming (P9 lazy spawn) — flushed in wire order at the revive tail; registry upkeep runs at flush, so the warm replay never duplicates the didOpen that triggered the spawn. */
  warmBuf: Array<{ body: Uint8Array; msg: Record<string, unknown>; method: string }> = [];
  constructor(id: number, dir: string | null = null) {
    this.id = id;
    this.dir = dir;
  }
}

export interface PolicyIo {
  clock: Clock;
  pidReader: PidReader | null;
  log: (ev: string, extra?: Record<string, unknown>) => void;
  clientEnqueue: (frame: Uint8Array) => void;
  clientClose: () => void;
  writeToChild: (c: Subprocess, frame: Uint8Array) => void;
  /** Spawn a child for a scope per the P1 contract AND start its stdout pump; sets scope.child on success; null when the spawn failed. */
  spawn: (scope: Scope) => Subprocess | null;
  terminateChild: (c: Subprocess, graceMs: number) => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  listScopes: () => string[];
}

export interface Policy {
  readonly scopes: Scope[];
  readonly fatal: boolean;
  readonly disposed: boolean;
  onFatal(): void;
  handleClientFrame(body: Uint8Array): void;
  handleChildFrame(scope: Scope, child: Subprocess, body: Uint8Array): void;
  onChildExit(scope: Scope, child: Subprocess): void;
  startSweeper(scope: Scope): void;
  startSampler(scope: Scope): void;
  startSleepCheck(scope: Scope): void;
  dispose(): Promise<void>;
}

export function createPolicy(cfg: Config, io: PolicyIo): Policy {
  const { clock, pidReader, log: logEvent, clientEnqueue, clientClose, writeToChild, spawn, terminateChild, sleep: sleepReal } = io;

  const scopes = expandScopes(cfg, io);
  // The idle deadline anchors at warden start, not the epoch: under the real Clock a 0 anchor would trip the
  // first sleep pass and SIGTERM an eagerly spawned child that never saw a client message (FakeClock starts at 0 — no frozen test can observe it).
  const startMs = clock.now();
  for (const scope of scopes) scope.lastRequestMs = startMs;

  // Params of the FIRST client initialize, captured at forward time — URI-less initializes only route to the first scope, so this warms sibling scopes' children on first touch (P9).
  let globalBootstrap: unknown = null;

  // Warden-global client-facing id counter — unique across scopes: per-scope counters would collide and
  // clientIdOwner.set would overwrite the first owner, stranding that scope's exchange. Child-facing ids stay per-scope.
  let nextClientId = 1;

  // client-facing id → owning scope: a client reply alone cannot name its scope. One-shot delete alongside the
  // scope's toClient entry; revive drops a scope's ids with its remap tables. Child-facing ids never enter it.
  const clientIdOwner = new Map<number | string, Scope>();

  let fatal = false;
  let disposed = false;

  function closeOut(): void {
    clientClose();
  }

  /** A malformed frame kills the wire (HANDOFF 15): log, close, SIGTERM every child, never respawn. */
  function onFatal(): void {
    if (fatal) return;
    fatal = true;
    for (const scope of scopes) {
      if (scope.sweepHandle !== null) {
        clock.clearTimeout(scope.sweepHandle);
        scope.sweepHandle = null;
      }
      if (scope.samplerHandle !== null) {
        clock.clearTimeout(scope.samplerHandle);
        scope.samplerHandle = null;
      }
      if (scope.sleepHandle !== null) {
        clock.clearTimeout(scope.sleepHandle);
        scope.sleepHandle = null;
      }
    }
    logEvent("error", { reason: "frame" });
    closeOut();
    // TERM fires synchronously per child; the KILL grace completes in-process. On a stdin-fatal the CLI exits right after the
    // stderr line, cutting the grace — the child's stdin EOF at process death bounds the orphan.
    for (const scope of scopes) {
      const c = scope.child;
      if (c !== null) void terminateChild(c, TERM_GRACE_MS);
    }
  }

  function forwardToChild(scope: Scope, body: Uint8Array): void {
    const c = scope.child;
    if (c === null) return;
    writeToChild(c, encodeFrame(body));
  }

  function textDocumentOf(msg: Record<string, unknown>): Record<string, unknown> | null {
    const params = msg.params;
    if (typeof params !== "object" || params === null) return null;
    const td = (params as Record<string, unknown>).textDocument;
    return typeof td === "object" && td !== null ? (td as Record<string, unknown>) : null;
  }

  function uriOf(msg: Record<string, unknown>): string | null {
    const td = textDocumentOf(msg);
    if (td === null) return null;
    const uri = td.uri;
    return typeof uri === "string" ? uri : null;
  }

  function contentChangeOf(msg: Record<string, unknown>): Record<string, unknown> | null {
    const params = msg.params;
    if (typeof params !== "object" || params === null) return null;
    const changes = (params as Record<string, unknown>).contentChanges;
    if (!Array.isArray(changes) || changes.length === 0) return null;
    const first = changes[0];
    return typeof first === "object" && first !== null ? (first as Record<string, unknown>) : null;
  }

  function maintainRegistry(scope: Scope, msg: Record<string, unknown>, method: string): void {
    const uri = uriOf(msg);
    if (uri === null) return;
    const entry = scope.registry.get(uri);
    if (method === "textDocument/didOpen") {
      const td = textDocumentOf(msg);
      if (td === null) return;
      const text = typeof td.text === "string" ? td.text : "";
      scope.registry.set(uri, {
        lastTouchMs: clock.now(),
        text,
        inFlight: 0,
        doc: {
          uri,
          languageId: typeof td.languageId === "string" ? td.languageId : undefined,
          version: typeof td.version === "number" ? td.version : undefined,
        },
      });
      if (entry === undefined) logEvent("open", { uri });
      return;
    }
    if (entry === undefined) return;
    if (method === "textDocument/didChange") {
      const change = contentChangeOf(msg);
      if (change !== null && typeof change.text === "string") entry.text = change.text; // full-text sync
      entry.lastTouchMs = clock.now();
      return;
    }
    if (method === "textDocument/didClose") scope.registry.delete(uri);
  }

  function protectInFlight(scope: Scope, childId: number, method: string, msg: Record<string, unknown>): void {
    if (method.startsWith("$/")) return;
    const uri = uriOf(msg);
    if (uri === null) return;
    const entry = scope.registry.get(uri);
    if (entry === undefined) return;
    entry.inFlight++;
    scope.inFlightByChildId.set(childId, entry);
  }

  function enqueueClient(body: Uint8Array): void {
    try {
      clientEnqueue(encodeFrame(body));
    } catch {}
  }

  const CHILD_UNAVAILABLE = { code: -32026, message: "lsp-warden: child unavailable" };
  const NO_SCOPE = { code: -32027, message: "lsp-warden: no scope for uri" };

  function answerUnavailable(id: number | string): void {
    enqueueClient(encodeJson({ jsonrpc: "2.0", id, error: CHILD_UNAVAILABLE }));
  }

  function answerNoScope(id: number | string): void {
    enqueueClient(encodeJson({ jsonrpc: "2.0", id, error: NO_SCOPE }));
  }

  /** The ONE forward shape (live path, revive flush, no-cache head): fresh child-side id, retry-ledger entry keeping the ORIGINAL client message (a crash re-forwards it — R4), and the P4 pin. */
  function forwardRequest(scope: Scope, childId: number, msg: Record<string, unknown>): void {
    // P7: sample the diagnostic hash at FORWARD time — the child's view is fixed now; a didChange before the
    // response must never re-key this report to newer text (it would serve T1's answer for T2).
    let textHash: string | null = null;
    if (msg.method === "textDocument/diagnostic") {
      const uri = uriOf(msg);
      const entry = uri === null ? undefined : scope.registry.get(uri);
      if (entry !== undefined) textHash = String(Bun.hash.wyhash(entry.text));
    }
    scope.pendingRequests.set(childId, { msg, textHash });
    protectInFlight(scope, childId, msg.method as string, msg);
    forwardToChild(scope, encodeJson({ ...msg, id: childId }));
  }

  function gateForward(scope: Scope, msg: Record<string, unknown>): number | null {
    const method = msg.method as string;
    if (isExpensive(method) && scope.limiter.inflight >= cfg.maxInflight) {
      scope.limiter.queue.push(msg);
      return null;
    }
    const childId = scope.nextChildId++;
    scope.toChild.set(childId, msg.id as number | string);
    forwardRequest(scope, childId, msg);
    if (isExpensive(method)) scope.limiter.inflight++;
    return childId;
  }

  /** Answer ONLY the requests actually forwarded with -32026 and drop the per-child forwarding state (remap, pins, ledger) — the subset of failPendingRequests that SPARES the queues: held requests were never sent to the child, so they survive the sleep kill (P6) and flush after the wake replay. */
  function failInFlightRequests(scope: Scope): void {
    for (const [, clientId] of scope.toChild) answerUnavailable(clientId);
    scope.toChild.clear();
    scope.firstInit = null;
    for (const entry of scope.inFlightByChildId.values()) entry.inFlight = 0;
    scope.inFlightByChildId.clear();
    scope.pendingRequests.clear();
    scope.limiter.inflight = 0;
  }

  /** Answer EVERY un-answered client request with -32026 (in-flight ids come from toChild; queued requests carry their own ids) and drop all forwarding state — the two spots where no request can ever complete: the drain deadline (R3) and the crash-loop guard (R4). */
  function failPendingRequests(scope: Scope): void {
    failInFlightRequests(scope);
    for (;;) {
      const gated = scope.limiter.queue.shift();
      if (gated === undefined) break;
      answerUnavailable(gated.id as number | string);
    }
    for (;;) {
      const queued = scope.queue.shift();
      if (queued === undefined) break;
      answerUnavailable(queued.id as number | string);
    }
  }

  /** P9 routing — the ONE place a client message finds its scope: messages with `params.textDocument.uri` match by longest-prefix (`path === dir` or `path.startsWith(dir + "/")` — separator boundary, K2); URI-less → first scope; null → requests answer -32027, notifications drop, nothing spawns (K3). */
  function routeScope(msg: Record<string, unknown>): Scope | null {
    if (scopes.length === 1 && scopes[0].dir === null) return scopes[0];
    const uri = uriOf(msg);
    if (uri === null) return scopes[0] ?? null;
    if (!uri.startsWith("file://")) return null;
    let path: string;
    try {
      path = decodeURIComponent(uri.slice("file://".length));
    } catch {
      return null;
    }
    let best: Scope | null = null;
    let bestLen = -1;
    for (const scope of scopes) {
      const dir = scope.dir;
      if (dir === null) continue;
      if (path === dir || path.startsWith(dir + "/")) {
        if (dir.length > bestLen) {
          best = scope;
          bestLen = dir.length;
        }
      }
    }
    return best;
  }

  /** Client → child: notifications byte-verbatim, never re-serialized, never given an id (T3); didOpen/didChange/didClose also feed the registry (P3). First client initialize forwarded and cached on its response; repeats answered from the cache with the CLIENT's id, never forwarded (L1). `exit` forwards then ends the child EXPECTED — SIGTERM, no crash bookkeeping, registry + cache retained (L4). Requests get a fresh child-side id in toChild; while the child is down, asleep (waking), or warming its first spawn they queue FIFO and wake it (revive). A non-JSON or shapeless body is a fatal frame error (HANDOFF 15). */
  function handleClientFrame(body: Uint8Array): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(utf8.decode(body));
    } catch {
      onFatal();
      return;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      onFatal();
      return;
    }
    const msg = parsed as Record<string, unknown>;
    switch (kindOf(msg)) {
      case "request": {
        const method = msg.method as string;
        const scope = routeScope(msg);
        if (scope === null) {
          answerNoScope(msg.id as number | string);
          return;
        }
        // Any non-$/ request is sleep activity (W5, per-scope in P9) — even one answered from cache; `$`-requests forward like any other (semantics transparency — $/cancelRequest must still reach the child) but never count.
        if (!method.startsWith("$/")) scope.lastRequestMs = clock.now();
        if (method === "initialize" && globalBootstrap === null) globalBootstrap = msg.params;
        // Repeat initialize: served from the cache even while down/reviving (L5's second logical initialize mid/just-after a restart).
        if (method === "initialize" && scope.initCache !== null) {
          enqueueClient(encodeJson({ jsonrpc: "2.0", id: msg.id, result: scope.initCache.result }));
          return;
        }
        if (scope.state === "dead") {
          answerUnavailable(msg.id as number | string);
          return;
        }
        // P7 gate — BEFORE the wake branch, so a matching diagnostic never wakes the child (C1). Conditions, all load-bearing:
        // diagnostic method only, never-cache off (ONE table — C4's references fail both), asleep or mid-revive (an AWAKE child is
        // never served — C3), CURRENT registry text hash-matches (C2). A hit bypasses ledger/lease/limiter.
        if (
          method === "textDocument/diagnostic" &&
          !isNeverCache(method) &&
          (scope.state === "asleep" || scope.reviving)
        ) {
          const uri = uriOf(msg);
          if (uri !== null) {
            const entry = scope.registry.get(uri);
            const cached = entry === undefined ? undefined : scope.diagCache.get(uri);
            if (cached !== undefined && String(Bun.hash.wyhash(entry.text)) === cached.hash) {
              enqueueClient(encodeJson({ jsonrpc: "2.0", id: msg.id, result: cached.report }));
              return;
            }
          }
        }
        if (scope.state !== "up" || scope.reviving || scope.child === null) {
          // The FIRST request while asleep IS the wake (logged once; later ones queue behind it — W2: exactly one spawn); a never-spawned scope (child null, P9 lazy) is the same shape.
          if (scope.state === "asleep" && !scope.reviving) logEvent("wake");
          scope.queue.push(msg); // FIFO — the waking request sits first (L4)
          if (!scope.reviving) {
            scope.reviving = true;
            void revive(scope);
          }
          return;
        }
        const childId = gateForward(scope, msg);
        // Only the FIRST client initialize may write the cache — a second forwarded one (first unanswered) must not hijack it; initialize is never expensive, so the gate cannot have held it.
        if (childId !== null && method === "initialize" && scope.firstInit === null && scope.initCache === null) {
          scope.firstInit = { childId, params: msg.params };
        }
        return;
      }
      case "response": {
        const id = msg.id as number | string;
        const scope = clientIdOwner.get(id);
        if (scope === undefined) {
          // Unmapped reply: forward verbatim to the first scope's child (the T-series pass-through needs a target), never dropped — a reply whose remap died with a restart would be stranded, and the bytes are not ours to reinterpret (AGENTS 1).
          if (scopes.length > 0) forwardToChild(scopes[0], body);
          return;
        }
        const childId = scope.toClient.get(id);
        if (childId !== undefined) {
          scope.toClient.delete(id);
          clientIdOwner.delete(id);
        }
        forwardToChild(scope, childId === undefined ? body : encodeJson({ ...msg, id: childId }));
        return;
      }
      case "notification": {
        const method = msg.method as string;
        const scope = routeScope(msg);
        if (scope === null) return;
        if (!method.startsWith("$/")) scope.lastRequestMs = clock.now(); // W5: $/ never counts
        if (method === "exit") {
          // Expected exit: the frame must be SCHEDULED to reach the child before SIGTERM — killing in the same tick loses the race and L4's recv never logs; registry + cache stay for the next revive (real I/O settle, AGENTS 3).
          const doomed = scope.child;
          forwardToChild(scope, body);
          if (scope.state === "up") scope.state = "down";
          for (const entry of scope.inFlightByChildId.values()) entry.inFlight = 0;
          scope.inFlightByChildId.clear();
          void (async () => {
            await sleepReal(EXIT_KILL_SETTLE_MS);
            if (fatal || disposed) return;
            // SIGTERM first, SIGKILL after the grace (a real server may ignore TERM); FakeServer dies on TERM instantly, so the suite never sees the KILL leg (the TERM still arrives first — L4).
            if (doomed !== null) await terminateChild(doomed, TERM_GRACE_MS);
          })();
          return;
        }
        if (scope.state === "up" && scope.child === null) {
          scope.warmBuf.push({ body, msg, method });
          if (!scope.reviving) {
            scope.reviving = true;
            void revive(scope);
          }
          return;
        }
        if (!method.startsWith("$/")) maintainRegistry(scope, msg, method);
        if (scope.state === "up" && !scope.reviving) forwardToChild(scope, body);
        return;
      }
      default:
        onFatal();
    }
  }

  /** Child → client: notifications byte-verbatim. Responses restore the client id from the scope's toChild (one-shot delete; unmapped passes through verbatim, nothing invented). Server→client requests get a fresh client-facing id from the warden-global counter and are remembered in toClient (T2). Malformed content is a fatal frame error. Frames from a child that is not the current one, or that we are killing, are stale by construction (the client already got -32026 or the remap died with the child) and are DROPPED — relaying would surface child-side ids the client never minted (R3). */
  function handleChildFrame(scope: Scope, child: Subprocess, body: Uint8Array): void {
    if (scope.child !== child || scope.killing === child) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(utf8.decode(body));
    } catch {
      onFatal();
      return;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      onFatal();
      return;
    }
    const msg = parsed as Record<string, unknown>;
    switch (kindOf(msg)) {
      case "request": {
        const clientId = nextClientId++;
        scope.toClient.set(clientId, msg.id as number | string);
        clientIdOwner.set(clientId, scope);
        clientEnqueue(encodeFrame(encodeJson({ ...msg, id: clientId })));
        return;
      }
      case "response": {
        const id = msg.id as number | string;
        if (scope.pendingInit !== null && id === scope.pendingInit.id) {
          const p = scope.pendingInit;
          scope.pendingInit = null;
          p.resolve(true);
          return;
        }
        const clientId = scope.toChild.get(id);
        if (clientId !== undefined) scope.toChild.delete(id);
        if (clientId === undefined) {
          clientEnqueue(encodeFrame(body));
          return;
        }
        // Ledger: this forwarded request is done — release it (waking a drain waiter on the last one); the P7 store needs the ORIGINAL message before the one-shot delete.
        const original = scope.pendingRequests.get(id);
        const originalMsg = original?.msg;
        if (scope.pendingRequests.has(id)) {
          scope.pendingRequests.delete(id);
          if (scope.pendingRequests.size === 0 && scope.drainWaiter !== null) {
            const w = scope.drainWaiter;
            scope.drainWaiter = null;
            w();
          }
        }
        // P4 lease release — result AND error answers land here, one path; the one-shot map delete is the double-decrement guard (the pinned entry may already be gone after a client didClose — the detached counter is then harmless).
        const pinned = scope.inFlightByChildId.get(id);
        if (pinned !== undefined) {
          scope.inFlightByChildId.delete(id);
          pinned.inFlight--;
        }
        // First client initialize's exchange: a RESULT writes the lifecycle cache (L1/L5); an error answer ends the exchange too (P5's no-cache revive wait) but never writes the cache.
        if (id === scope.firstInit?.childId) {
          const f = scope.firstInit;
          if (msg.result !== undefined) {
            scope.initCache = { params: f.params, result: structuredClone(msg.result) };
          }
          scope.firstInit = null;
          f.resolve?.(true);
        }
        // P7 store: a completed client diagnostic request refreshes the cache — result-gated (an error answer never writes). The hash is the
        // FORWARD-time registry text sampled in forwardRequest (hashing CURRENT text here would pair the report with a didChange the child never saw).
        if (
          original !== undefined &&
          originalMsg?.method === "textDocument/diagnostic" &&
          msg.result !== undefined &&
          original.textHash !== null
        ) {
          const uri = uriOf(originalMsg);
          if (uri !== null) {
            scope.diagCache.set(uri, {
              hash: original.textHash,
              report: structuredClone(msg.result),
            });
          }
        }
        // P8 limiter release — the SAME completion event as the P4 pin release: an expensive answer frees its slot and admits the FIFO head synchronously (no reordering under any await; the ledger one-shot = exactly one release, the underflow guard); while a rebirth is in flight heads stay queued — a drain-success restart must never forward fresh work to a child about to be killed.
        if (original !== undefined && isExpensive(originalMsg?.method as string)) {
          if (scope.limiter.inflight > 0) scope.limiter.inflight--;
          if (scope.state === "up" && !scope.reviving) {
            while (scope.limiter.inflight < cfg.maxInflight && scope.limiter.queue.length > 0) {
              gateForward(scope, scope.limiter.queue.shift()!);
            }
          }
        }
        clientEnqueue(encodeFrame(encodeJson({ ...msg, id: clientId })));
        return;
      }
      case "notification":
        clientEnqueue(encodeFrame(body));
        return;
      default:
        onFatal();
    }
  }

  // Child stdout ended. Ours (dispose/fatal/expected exit/restart kill) → teardown only; otherwise CRASH — log + timestamp into the pruned window, restart immediately (no delay timer) with in-flight retried, or dead at CRASH_LIMIT (-32026 ever after, R4).
  function onChildExit(scope: Scope, child: Subprocess): void {
    if (scope.child !== child) return;
    const ours = disposed || fatal || scope.killing === child || scope.state !== "up";
    // A sleep kill must leave the scope asleep — only the wake's revive leaves it; downgrading here would make the next request a plain revive-from-down with no `wake` event (W2 pin).
    const asleepExit = scope.state === "asleep";
    if (scope.killing === child) scope.killing = null;
    scope.child = null;
    scope.state = asleepExit ? "asleep" : "down";
    if (scope.pendingInit !== null) {
      const p = scope.pendingInit;
      scope.pendingInit = null;
      p.resolve(false);
    }
    if (scope.firstInit !== null) {
      scope.firstInit.resolve?.(false);
      scope.firstInit = null;
    }
    for (const entry of scope.inFlightByChildId.values()) entry.inFlight = 0;
    scope.inFlightByChildId.clear();
    scope.limiter.inflight = 0;
    if (ours) {
      scope.pendingRequests.clear();
      return;
    }
    logEvent("crash");
    scope.crashTs.push(clock.now());
    const cutoff = clock.now() - CRASH_WINDOW_MS;
    scope.crashTs = scope.crashTs.filter((t) => t > cutoff);
    if (scope.crashTs.length >= CRASH_LIMIT) {
      scope.state = "dead"; // never spawn again — R4 pins exactly 3 starts
      scope.reviving = false;
      failPendingRequests(scope);
      return;
    }
    const retried: Array<Record<string, unknown>> = [];
    for (const [, entry] of scope.pendingRequests) retried.push(entry.msg);
    scope.pendingRequests.clear();
    scope.queue = [...retried, ...scope.limiter.queue, ...scope.queue];
    scope.limiter.queue.length = 0;
    scope.restartSeq++;
    scope.reviving = false;
    void restart("crash", scope);
  }

  /** Warden-initiated initialize on a fresh child: fresh id, response consumed — never relayed, never cached (L5); resolves true on the response, false on the child's death (observed in onChildExit). Shared by the cached-params revive and the P9 bootstrap warm-up. */
  async function internalInit(scope: Scope, params: unknown): Promise<boolean> {
    const initId = scope.nextChildId++;
    let resolveInit: (ok: boolean) => void = () => {};
    const initDone = new Promise<boolean>((r) => {
      resolveInit = r;
    });
    scope.pendingInit = { id: initId, resolve: resolveInit };
    forwardToChild(scope, encodeJson({ jsonrpc: "2.0", id: initId, method: "initialize", params }));
    return await initDone;
  }

  // revive — THE shared rebirth primitive (expected exit, budget restart, P6's wake, P9's lazy first spawn). L4 order: spawn →
  // cached initialize (consumed) → synthesized `initialized` → didOpen replay (CURRENT text) → flush queue. No cache: the client's OWN initialize leads; P9: bootstrap for cacheless dir-scopes + cold-spawn flush.
  async function revive(scope: Scope): Promise<void> {
    if (scope.state === "dead") {
      scope.reviving = false;
      return;
    }
    const fresh = spawn(scope);
    if (fresh === null) {
      scope.state = "down";
      scope.reviving = false;
      return;
    }
    scope.state = "up";
    scope.toChild.clear();
    // Evict the old child's client-facing ids from the global map — a stale reply becomes unmapped, never misrouted to the replacement.
    for (const k of scope.toClient.keys()) clientIdOwner.delete(k);
    scope.toClient.clear();
    if (scope.initCache !== null) {
      const ok = await internalInit(scope, scope.initCache.params);
      if (!ok || disposed || scope.child !== fresh) {
        if (scope.child === null) scope.reviving = false;
        return;
      }
    } else if (scope.queue[0]?.method === "initialize") {
      const init = scope.queue.shift()!;
      const childId = gateForward(scope, init)!;
      let resolveFirst: (ok: boolean) => void = () => {};
      const firstDone = new Promise<boolean>((r) => {
        resolveFirst = r;
      });
      if (scope.firstInit === null) scope.firstInit = { childId, params: init.params, resolve: resolveFirst };
      const ok = await firstDone;
      if (!ok || disposed || scope.child !== fresh) {
        if (scope.child === null) scope.reviving = false;
        return;
      }
    } else if (scope.dir !== null && globalBootstrap !== null) {
      const ok = await internalInit(scope, globalBootstrap);
      if (!ok || disposed || scope.child !== fresh) {
        if (scope.child === null) scope.reviving = false;
        return;
      }
    }
    forwardToChild(scope, encodeJson({ jsonrpc: "2.0", method: "initialized", params: {} }));
    // Replay opens with the CURRENT text; didChange is never replayed (R1).
    for (const [, entry] of scope.registry) {
      forwardToChild(
        scope,
        encodeJson({
          jsonrpc: "2.0",
          method: "textDocument/didOpen",
          params: { textDocument: { ...entry.doc, text: entry.text } },
        }),
      );
    }
    // Cold-spawn notifications flush BEFORE the request backlog (open-then-query wire order); registry upkeep at flush so the replay never duplicates the triggering didOpen.
    for (const n of scope.warmBuf) {
      forwardToChild(scope, n.body);
      if (!n.method.startsWith("$/")) maintainRegistry(scope, n.msg, n.method);
    }
    scope.warmBuf.length = 0;
    // Limiter-held requests ride the rebirth ahead of later arrivals (gated while up = predate down-arrivals); each re-enters the gate, so the backlog can never flood a fresh child past --max-inflight.
    scope.queue = [...scope.limiter.queue, ...scope.queue];
    scope.limiter.queue.length = 0;
    for (;;) {
      const queued = scope.queue.shift();
      if (queued === undefined) break;
      const childId = gateForward(scope, queued);
      if (childId !== null && queued.method === "initialize" && scope.firstInit === null && scope.initCache === null) {
        scope.firstInit = { childId, params: queued.params };
      }
    }
    scope.reviving = false;
    if (scope.child !== null && cfg.budgetMb > 0) scheduleSample(scope);
    scheduleSleepCheck(scope);
  }

  async function drain(scope: Scope): Promise<boolean> {
    if (scope.pendingRequests.size === 0) return true;
    let deadlineHandle: unknown = null;
    let heldWaiter: (() => void) | null = null;
    const deadline = new Promise<boolean>((resolve) => {
      deadlineHandle = clock.setTimeout(() => resolve(false), DRAIN_MS);
    });
    const emptied = new Promise<boolean>((resolve) => {
      heldWaiter = () => resolve(true);
      scope.drainWaiter = heldWaiter;
    });
    const done = await Promise.race([emptied, deadline]);
    if (scope.drainWaiter === heldWaiter) scope.drainWaiter = null; // emptied won — a late response must not fire a stale waiter
    if (done && deadlineHandle !== null) clock.clearTimeout(deadlineHandle); // no leaked Clock timer
    return done;
  }

  // Child rebirth. "budget": drain first (held requests answered -32026 at the Clock deadline — R3), then terminate the old child and revive. "crash": the child is already gone — no drain, its in-flight requests were retried by the watcher (R4/R5). Single-flight via reviving; the epoch check keeps a stale drain from answering or killing for a child an unexpected exit already replaced.
  async function restart(reason: "budget" | "crash", scope: Scope): Promise<void> {
    if (scope.reviving) return;
    if (scope.state === "dead") return;
    scope.reviving = true;
    const seq = ++scope.restartSeq;
    scope.overCount = 0;
    logEvent("restart", { reason });
    const old = scope.child;
    if (reason === "budget" && old !== null && scope.pendingRequests.size > 0) {
      const drained = await drain(scope);
      if (seq !== scope.restartSeq) return;
      if (!drained) failPendingRequests(scope);
    }
    if (seq !== scope.restartSeq) return;
    if (old !== null) {
      scope.killing = old; // the exit watcher must not read our kill as a crash
      await terminateChild(old, TERM_GRACE_MS);
    }
    if (seq !== scope.restartSeq) return;
    await revive(scope);
  }

  async function sampleStep(scope: Scope): Promise<void> {
    const c = scope.child;
    if (c === null || scope.state !== "up" || scope.reviving) return;
    const kb = pidReader === null ? undefined : pidReader(c.pid);
    if (kb === undefined) {
      scheduleSample(scope); // no data — under-budget/skip, never over (K4)
      return;
    }
    logEvent("sample", { kb });
    if (kb > cfg.budgetMb * 1024) {
      scope.overCount++;
      if (scope.overCount >= cfg.sustain) {
        await restart("budget", scope);
        return;
      }
    } else {
      scope.overCount = 0;
    }
    scheduleSample(scope);
  }

  function scheduleSample(scope: Scope): void {
    if (cfg.budgetMb <= 0) return;
    scope.samplerHandle = clock.setTimeout(() => void sampleStep(scope), cfg.sampleSecs * 1000);
  }

  // One 1 s sleep pass (HANDOFF 4): a child idle past its sleep-after deadline (STRICT `>` — exactly-at-deadline stays awake;
  // K4's determinism depends on it) is SIGTERM'd into "asleep" — state flips first so the watcher's `state !== "up"` classifies the death as ours.
  function sleepCheckStep(scope: Scope): void {
    if (fatal || disposed) return;
    if (cfg.sleepAfter <= 0) return;
    const c = scope.child;
    // Chain lives only while a live, non-reviving child could be idle (down/asleep/dead halt it — a wake re-arms at the revive tail); a warming revive must never be slept mid-replay (W2).
    if (c === null || scope.reviving || scope.state !== "up") return;
    if (clock.now() - scope.lastRequestMs > cfg.sleepAfter * 1000) {
      if (scope.pendingRequests.size > 0) failInFlightRequests(scope);
      scope.state = "asleep";
      scope.killing = c;
      logEvent("sleep");
      void terminateChild(c, TERM_GRACE_MS);
      return;
    }
    scope.sleepHandle = clock.setTimeout(() => sleepCheckStep(scope), SLEEP_CHECK_MS);
  }

  function scheduleSleepCheck(scope: Scope): void {
    if (cfg.sleepAfter <= 0) return;
    scope.sleepHandle = clock.setTimeout(() => sleepCheckStep(scope), SLEEP_CHECK_MS);
  }

  // One 15 s lease pass: close entries idle past idleSecs with no request in flight (STRICT `>` — exactly at the boundary is still fresh); skipped while down/reviving so the registry survives the replay (L4). Always re-arms.
  function sweep(scope: Scope): void {
    if (fatal || disposed) return;
    if (scope.state === "up" && !scope.reviving) {
      const now = clock.now();
      for (const [uri, entry] of scope.registry) {
        if (now - entry.lastTouchMs > cfg.idleSecs * 1000 && entry.inFlight === 0) {
          scope.registry.delete(uri);
          forwardToChild(
            scope,
            encodeJson({ jsonrpc: "2.0", method: "textDocument/didClose", params: { textDocument: { uri } } }),
          );
          logEvent("close", { uri });
        }
      }
    }
    scope.sweepHandle = clock.setTimeout(() => sweep(scope), SWEEP_MS);
  }
  function startSampler(scope: Scope): void {
    scheduleSample(scope);
  }
  function startSweeper(scope: Scope): void {
    scope.sweepHandle = clock.setTimeout(() => sweep(scope), SWEEP_MS);
  }
  function startSleepCheck(scope: Scope): void {
    scheduleSleepCheck(scope);
  }

  async function dispose(): Promise<void> {
    if (disposed) return;
    disposed = true;
    for (const scope of scopes) {
      if (scope.sweepHandle !== null) {
        clock.clearTimeout(scope.sweepHandle);
        scope.sweepHandle = null;
      }
      if (scope.samplerHandle !== null) {
        clock.clearTimeout(scope.samplerHandle);
        scope.samplerHandle = null;
      }
      if (scope.sleepHandle !== null) {
        clock.clearTimeout(scope.sleepHandle);
        scope.sleepHandle = null;
      }
    }
    closeOut();
    await Promise.all(
      scopes.map(async (scope) => {
        const c = scope.child;
        if (c !== null) await terminateChild(c, DISPOSE_TERM_GRACE_MS);
      }),
    );
  }

  return {
    scopes,
    get fatal() {
      return fatal;
    },
    get disposed() {
      return disposed;
    },
    onFatal,
    handleClientFrame,
    handleChildFrame,
    onChildExit,
    startSweeper,
    startSampler,
    startSleepCheck,
    dispose,
  };
}

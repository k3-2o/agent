# lsp-warden, internals

The frozen suite (`agent-dump/handoffs/HANDOFF.md`) is the contract. `agent-dump/plans/SPEC.md` has the invariants, flags and ops contract. Policy numbers are named constants or flags, never literals in logic.

## Layering and seams

```
wire.ts      pure bytes/JSON: FrameParser, encodeFrame, kindOf. Zero imports.
policy.ts    all policy: Scope, registry, sweeper, init cache, revive/restart,
             sampler, crash watcher, sleep/wake, diagnostics cache, limiter,
             scopes routing. No I/O: no Date.now, procfs, spawn, streams, fs.
             Seams injected via PolicyIo + Clock + PidReader.
adapters.ts  the only I/O: realClock, realPidReader (VmRSS kB), createLogger
             (JSONL appendFileSync), spawnChild (env snapshot at spawn),
             terminateChild (SIGTERM, real grace, SIGKILL), listScopes.
warden.ts    parseArgs/config, createWarden wiring, per-scope pumps, CLI entry,
             frozen import surface.
```

Import spine: `wire <- policy <- warden`, `adapters <- warden`. Two sanctioned real-time exceptions, both I/O convergence, never policy decisions: `terminateChild`'s kill grace and `EXIT_KILL_SETTLE_MS` (25 ms pipe settle).

## Wire

- Content-Length framing, byte offsets only, no size cap (2 MB round-trips). Header regex `/^Content-Length:\s*(\d+)\s*$/i` on the bytes before `\r\n\r\n`.
- Fatal (dead stream: log `error`/`frame`, close clientOut, TERM then KILL every child, never respawn): malformed header, non-JSON body, declared body cut short at stream end. A dangling header fragment at stream end is inert.
- `kindOf` kinds: REQUEST (method + id), RESPONSE (no method, has id, including `id: null`, forwarded verbatim, never fatal), NOTIFICATION (method, no id, byte-verbatim both ways, never re-serialized, never id-injected).

## Client to child

Route first, then gates in order.

1. `routeScope`. `params.textDocument.uri`, decoded after `file://`/`file:`. Match iff `path === dir || path.startsWith(dir + "/")`. Longest dir wins. URI-less goes to the first scope in expansion order. No match: request answers `-32027` (id restored), notification drops.
2. Registry maintenance. `didOpen` upsert resets text and lease, `didChange` replaces text, client `didClose` deletes. Runs before forwarding; applies even if the child dies on the message.
3. `$` exclusion. Blanket prefix rule: `$/...` methods are forwarded, never touch lease or sleep activity.
4. Cache gate. `textDocument/diagnostic` while asleep or warming, not on the never-cache list, wyhash(registry text) equals the cached hash: answered instantly from cache. No child contact, no limiter slot.
5. Limiter gate. Expensive methods at `inflight >= maxInflight` queue FIFO as the original client frame, no side state. Others forward.
6. Wake/queue gate. Child down or asleep: queue (waking request first). Asleep: log `wake` and revive. Dead: `-32026`.
7. `forwardRequest`. Fresh child-side id (`nextChildId++`), ledger entry `{msg, textHash}` where textHash is wyhash of the registry text at forward time (a later didChange must make a cached report inert, not re-key it), pin in `inFlightByChildId`, re-serialize, write and flush.

## Child to client

One pump per scope (`for await` over the child's stdout; frames from a disowned child are dropped via the `scope.child !== child || killing === child` guard).

1. Internal-initialize response (the known `pendingInit` id) is consumed. Not relayed. Not written to the cache.
2. Child response: restore the client id via `toChild` (one-shot delete), release the pin, store diagnostic results, advance the limiter queue head. One completion event.
3. Child request (server to client): fresh client-facing id from the warden-global counter (per-scope counters would collide), recorded in `clientIdOwner` and `toClient`. Client responses restore the child's original id and route by `clientIdOwner`.
4. Unmapped responses forward verbatim.

## Lifecycle

Per scope: `up`, `down` (expected exit), `asleep`, `dead`, plus a `reviving` single-flight flag.

- Expected exit: `shutdown` forwarded and answered, `exit` forwarded, 25 ms settle (L4 pins the recv order), then `terminateChild`: SIGTERM first (L4/W1 assert the sigterm line), SIGKILL after `TERM_GRACE_MS`. Registry and init cache are retained, with no crash bookkeeping; the next request revives.
- Crash watcher (`onChildExit`): "ours" means `disposed || fatal || killing === child || state !== "up"`, teardown only. Otherwise log `crash`, push `clock.now()` into `crashTs`, prune older than 60 s, and if `crashTs.length >= 3` go dead: every request answers `-32026`, never spawn again, registry updates still apply, `exit` cannot resurrect. Else restart immediately (`restart("crash")`, no delay timer). In-flight requests are retried on the replacement with fresh child-side ids; pins zeroed then re-pinned so counts never double.

## Registry and lease

`uri -> { lastTouchMs, text, doc, inFlight }`. Sweeper chain: 15 s, self-rearming Clock timer. Closes entries with `now - lastTouchMs > idleSecs*1000` (strict `>`) and `inFlight === 0`: send `didClose`, delete, log `close`. The pass is skipped while the child is down or asleep. Client `didClose` deletes without a `close` event. Duplicate didOpen overwrites text and resets the lease (L3). Replays send a full didOpen with current text; `didChange` is never replayed.

## Initialize cache

Written only by the first client-initiated exchange (params and result, deep-cloned). Repeat client `initialize`: answered from cache with the client's id, never forwarded (L1). Warden-initiated initializes are consumed internally and never overwrite the cache (L5). `initialized` is forwarded after every initialize completion: the client's own on first init, a synthesized one after every revival.

## revive / restart / wake

One primitive. `revive(scope)`: spawn (cwd = `scope.dir` or warden cwd, env snapshot, pipes, stderr inherit), clear remap maps, internal `initialize` with cached params (or, with no cache yet, the client's own initialize becomes the child's first message, with the synthesized `initialized` strictly after that exchange), consume the response, synthesized `initialized`, replay one didOpen per registry entry with current text, flush the queue FIFO (the waking request was queued first; W2/W3 order pins).

Restart = drain (budget only) + `terminateChild` + revive. Wake = revive plus the `wake` log. Single-flight via `reviving`; an epoch guard stops a stale drain from stomping a replacement.

## Budget

Sampler chain: only while the child is alive and `budgetMb > 0`. Every `sampleSecs`: `kb = pidReader(child.pid)`; `undefined` skips, never over. Over means `kb > budgetMb*1024` (strict `>`). `overCount` increments on over, resets on healthy, resets on restart. At `overCount >= sustain`: restart("budget").

Drain: Clock-bound, up to 3 s, for in-flight work. At the deadline `failPendingRequests` answers every in-flight and queued request with `-32026` (ids restored), releases pins, clears maps. Honest errors, no hangs (R3). Kill: SIGTERM, real 5 s grace, SIGKILL, targeting the captured old child.

## Sleep / wake

`lastRequestMs` updates on any client request or notification except `$/`. Anchored at warden start; under the real Clock a zero anchor would SIGTERM an idle child on the first 1 s pass.

Sleep check: 1 s Clock chain, armed only while the child is alive and `sleepAfter > 0`. Fires when `now - lastRequestMs > sleepAfter*1000` (strict `>`; W5/K4 depend on it). State flips to asleep before the SIGTERM so the watcher classifies the death as ours. Log `sleep`. In-flight requests answer `-32026`; queues are spared (unlike the drain).

While asleep: notifications update the registry only (C2), `$/` notifications drop, any request except a cache hit wakes: log `wake`, revive.

## Diagnostics cache

Keyed by uri: `{hash, report}`. Hash is `String(Bun.hash.wyhash(registry text))` sampled at forward time. Served iff all of: method is `textDocument/diagnostic`, child asleep or reviving, not on the never-cache list, hash matches. Answer is instant, deep-equal result, zero child contact, bypasses the limiter. Error responses never cached. Never-cache line: `references`, `definition`, `typeDefinition`, `implementation`, `rename`, plus `workspace/*`, enforced via the single classification table. Cache survives wake, restart, sleep; stale entries are inert by construction.

## Limiter

`limiter: { inflight, queue[] }`, per scope. Expensive set from the one table: diagnostic, references, definition, typeDefinition, implementation, rename, codeAction, hover, documentSymbol, formatting, rangeFormatting. Gate: `inflight >= maxInflight` pushes the original client frame to the FIFO queue (no ledger, no pin); else forward and `inflight++`. Release runs in the same completion event as the pin release: `inflight--` and a synchronous head-advance, no await between free and admit (Q1). Notifications and non-expensive requests bypass (Q2, Q3). Cache and `-32026` answers never hold a slot. Child death zeroes `inflight`. Rebirth merges queues in arrival order and re-enters the gate.

## Scopes

Startup: `--scopes GLOB` becomes an anchored regex, `*` becomes `[^/]*`, everything else escaped, no `**`. A recursive bounded walk under the warden's cwd (skips node_modules and .git, never descends symlinked dirs) collects dirs whose relative path matches the glob and contains tsconfig.json, sorted lexicographically, returned as absolute paths. Zero matches means every request answers `-32027`, notifications drop, nothing ever spawns.

Children spawn lazily on the first routed message, notifications included. A cold scope warms through revive with the global bootstrap (params of the first client initialize observed anywhere). `warmBuf` holds cold notifications and flushes them in wire order after replay, with registry upkeep so the triggering didOpen is not duplicated.

Every counter, chain and state is per scope: sweeper, sampler, sleep check, drain, crashTs, limiter, registry, initCache, lastRequestMs (K4). Single-scope mode is the same machinery with one dir-null match-all scope.

## CLI

`import.meta.main`: stdin is the client, stdout is the wire, stderr carries fatal messages only. Bun's WHATWG stream locks force one held writer (no per-chunk getWriter, no double stdin iteration). EOF: `await writer.close()` first (runs `clientParser.finish()`; a truncated final frame goes fatal there), then `eofFlag = true`, then dispose. The ordering is deterministic because a fatal `finish()` closes clientOut synchronously inside that await, before the flag is set. Truncated frame at EOF: stderr reason, exit 1. Clean EOF: exit 0. A mid-stream fatal frame: stderr "lsp-warden: fatal frame error", exit 1. The KILL grace completes in-process; the CLI's immediate exit cuts it, but TERM fires synchronously and the child's stdin EOF at process death bounds the orphan.

## Adapters

`terminateChild(c, graceMs)`: SIGTERM now, race `c.exited` against a real grace, SIGKILL on timeout. Used by restart (5 s), dispose (2 s), expected exit (5 s), sleep kill (5 s), onFatal (5 s, fire-and-forget per scope). Real time appears only here and in `EXIT_KILL_SETTLE_MS`. Every policy timer goes through the injected Clock; FakeClock fires in due order under test ticks.

## Invariants

1. Semantics transparency: content and meaning preserved; timing and lifecycle may change.
2. Single source of truth: registry owns text, cache owns init, the classification table owns method roles.
3. Correctness line: never-cache methods never answered from cache; cache only while asleep/warming with a matching hash.
4. Bounded: drain 3 s, TERM to KILL 5 s, dispose 2 s, crash window 3 per 60 s, sweeper 15 s, sleep check 1 s, inflight cap.
5. Idempotent replay: revives, restarts, wakes safe to reapply; duplicate didOpen upserts; pins one-shot.
6. Fail fast: CLI validated once; malformed frame is a dead stream with a loud outcome; `-32026`/`-32027` over hangs.
7. Expected exit is not a crash: shutdown/exit and sleep kills never count toward the crash loop.
8. Seams only: no Date.now or procfs in policy; the two real-time exceptions are convergence waits.
9. Strict `>` deadlines: sleep and sweep comparisons; exactly-at-deadline stays awake/open.
10. Nothing on stdout but protocol; events only in `--log`; fatal reasons on stderr.
11. Init cache written only by client-initiated exchanges; repeats served, never forwarded.
12. Forward-time textHash; error responses never cached.
13. One completion event releases the pin, stores the cache, advances the limiter.
14. Per-scope isolation of every counter, chain and state.
15. Zero deps, no package.json, Linux only, Bun 1.4.2+.

## Log schema and wire errors

One JSON per line, appendFileSync, unbuffered: `open{uri}`, `close{uri}`, `restart{reason:"budget"|"crash"}`, `sleep`, `wake`, `sample{kb}`, `crash`, `error{reason:"frame"}`. Wire errors, id restored: `-32026 "lsp-warden: child unavailable"`, `-32027 "lsp-warden: no scope for uri"`.

## Known issues

- The installed `@typescript/typescript-linux-x64` server (typescript-go) panics on `initialized` ("close of closed channel", upstream bug). The warden recovers every time via crash restart with replay. A server build without the bug would stop the crash/restart events.
- The JSONL log has no rotation. Samples accrue roughly 55 B/s while a child is awake.
- `tests/04` S4 shows a rare timeout under heavy parallel load (process starvation). Always green in isolation.
- Bun 1.4.2: WHATWG stream locks (one held writer in the CLI), strips the first `--` from script argv, ignores `process.env` mutations after spawn (the spawn-time snapshot is the contract).
- Plain OSS typescript has no `--lsp` mode. The child must be `@typescript/typescript-linux-x64/lib/tsc` or any other stdio LSP server.

## Test map

`01` framing, `02` relay/remap, `03` lifecycle, `04` lease, `05` restart, `06` sleep/wake, `07` cache, `08` limiter, `09` scopes, `10` CLI, plus the harness selftest. Harness: real processes and a deterministic clock, no mocks against mocks.

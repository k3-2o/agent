# lsp-warden

Transparent LSP proxy. Sits between the omp harness and a stdio LSP server. Forwards frames verbatim, preserves semantics, and adds discipline: idle file closing, RSS budget restart, sleep/wake, diagnostics cache while asleep, FIFO limiter, per-scope children. Zero dependencies; requires Bun 1.4.2 on Linux.

## Layout

| File | Contents |
|---|---|
| `warden/wire.ts` | Content-Length framing: `FrameParser`, `encodeFrame`, `kindOf`. Pure bytes/JSON, no I/O, no size cap. |
| `warden/policy.ts` | All policy: Scope, registry, sweeper, initialize cache, revive/restart, sampler, crash guard, sleep/wake, diagnostics cache, limiter, scope routing. Time via injected Clock, RSS via PidReader. One classification table drives limiter and never-cache. |
| `warden/adapters.ts` | The only I/O: real Clock, real PidReader (`/proc/<pid>/status` VmRSS kB), JSONL logger, spawn, `terminateChild`, `--scopes` directory walk. |
| `warden/warden.ts` | `parseArgs`, `createWarden`, per-scope pumps, CLI entry, frozen import surface (Clock, PidReader, WardenHandle, createWarden, WardenUsageError). |

## Run

- Shim: `~/.local/bin/lsp-warden` runs `bun /home/k2/.local/share/lsp-warden/warden.ts "$@"` (runtime copy at `~/.local/share/lsp-warden/`; the repo `warden/` stays the source of truth; re-copy to redeploy).
- Log dir: `~/.cache/lsp-warden/`.
- Tests, from `warden/`: `bun test` (49/49).

## CLI

```
lsp-warden [flags] -- <child command>
```

| Flag | Default | Bound |
|---|---|---|
| `--idle-secs N` | 600 | >= 0 |
| `--budget-mb N` | 0 (off) | >= 0 |
| `--sustain N` | 2 | >= 1 |
| `--sample-secs N` | 5 | >= 1 |
| `--sleep-after N` | 900 | >= 0 (0 disables) |
| `--max-inflight N` | 3 | >= 1 |
| `--log PATH` | off | JSONL event log |
| `--scopes GLOB` | off | multi-child mode |

Numeric values must match `/^\d+$/`; duplicate flags last-wins. Any violation throws `WardenUsageError`, message prefix `usage:`, before anything spawns or logs.

Fixed timings: sweeper 15 s; drain up to 3 s; SIGTERM to SIGKILL 5 s; crash loop 3 deaths per 60 s; sleep check 1 s.

Bun quirk: Bun strips the first `--` from script argv. Invocations that put flags before `--` (as lsp.json does) are unaffected. A bare `lsp-warden -- cmd` needs `-- --`.

## Deployment

`/home/k2/.workspaces/tracked/omp/lsp.json` registers slot `typescript-warden` (never `typescript-native`):

```
--idle-secs 600 --budget-mb 512 --sleep-after 900 --max-inflight 2
--log /home/k2/.cache/lsp-warden/typescript-warden.jsonl
--scopes packages/* -- /home/k2/.local/share/lsp-warden-tsc/node_modules/@typescript/typescript-linux-x64/lib/tsc --lsp --stdio
```

fileTypes: `.ts .tsx .js .jsx .mjs .cjs`. rootMarkers: `package.json`, `tsconfig.json`.

Mapping: `sleep-after 900` is 15 minutes without requests before the child is killed. `budget-mb 512` restarts a child whose VmRSS exceeds 512 MB across `--sustain` consecutive samples. `--scopes packages/*` gives each package with a tsconfig.json its own child, spawned lazily, routed by longest-prefix URI match. The child must be `@typescript/typescript-linux-x64` (`tsc --lsp --stdio`): the plain OSS typescript package has no `--lsp` mode.

## Behavior

- **Registry + sweeper.** `didOpen` upserts (text and lease both reset), `didChange` replaces text, client `didClose` deletes. The 15 s sweeper closes files idle longer than `--idle-secs` (strict `>`, nothing in flight). `$`-prefixed methods never touch the lease.
- **Initialize cache.** First client initialize is cached; repeats are answered from cache, never forwarded; warden re-initializations never overwrite the cache.
- **Expected exit.** `shutdown` + `exit` kills the child with SIGTERM. No crash bookkeeping. Registry retained. Unexpected exit logs `crash` and restarts immediately; 3 crashes in 60 s puts the scope dead: requests answered `-32026`, no more spawns.
- **Budget.** Sampler reads VmRSS every `--sample-secs`. Over budget across `--sustain` consecutive samples restarts: drain up to 3 s, held requests answered `-32026`, spawn, cached initialize, didOpen replay with current text.
- **Sleep/wake.** 1 s check with a strict `>` deadline. Child killed with SIGTERM into asleep. First request wakes it: spawn, replay, queued requests answered in order. Notifications while asleep only update the registry.
- **Diagnostics cache.** Diagnostic reports stored with a wyhash of the registry text sampled at forward time. Served only while asleep or warming and the hash still matches. `references`, `definition`, `typeDefinition`, `implementation`, `rename`, `workspace/*` are never cached.
- **Limiter.** FIFO cap on the expensive method list (`--max-inflight`). Notifications and non-listed methods bypass. Cache answers bypass.
- **Scopes.** `--scopes GLOB`: anchored regex, `*` becomes `[^/]*`. Dirs at any depth (node_modules, .git skipped) containing tsconfig.json, sorted lexicographically. Longest-prefix routing with separator boundary. URI-less messages go to the first scope. An unmatched request answers `-32027`.

## Event log (JSONL, `--log`)

| Event | Fields |
|---|---|
| `open` | `{uri}` (first didOpen only) |
| `close` | `{uri}` |
| `restart` | `{reason: "budget" or "crash"}` |
| `sleep` | none |
| `wake` | none |
| `sample` | `{kb}` (budget on only) |
| `crash` | none |
| `error` | `{reason: "frame"}` |

Wire errors, id restored: `-32026 "lsp-warden: child unavailable"`, `-32027 "lsp-warden: no scope for uri"`.

## Verification

49/49 tests, real FakeServer subprocesses with a deterministic injected clock. A real `tsc --lsp` session through the warden answered `kind:full` diagnostics on a workspace file; after 15 minutes idle both scopes slept and an edit woke them with a live answer. The installed server (typescript-go build) panics on `initialized`; the warden recovers each time via crash restart with replay.

## Repo layout

```
warden/
  wire.ts  adapters.ts  policy.ts  warden.ts
  tests/   harness/ + harness.selftest + 01-10 case files
agent-dump/   plans/ (SPEC, TODO-PLAN, phase plans), handoffs/, lsp-warden-plan.md (gitignored)
AGENTS.md  README.md  ARCHITECTURE.md   (AGENTS.md gitignored)
```
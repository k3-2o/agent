# lsp.json (lsp-warden)

MUST READ before writing any config: `omp://docs/lsp-config.md`. It explains
config locations, precedence, `ServerConfig` fields, and merge rules. This
card is the map, the user's specifications, and the warden procedure.

Standing rules:

- LSP for this project goes through the lsp-warden proxy. Never configure a
  language server to talk to omp directly.
- Never install anything without an explicit yes.
- `~/.omp/agent/lsp.yaml` disables the native TS servers machine-wide. Do NOT
  re-enable them; the warden slot is the replacement.
- Never edit anything under `/home/k2/.local/share/lsp-warden/` (runtime copy;
  source of truth is `/home/k2/.workspaces/tools/LSP-warden/warden/`).

## Facts

- Launcher: `/home/k2/.local/bin/lsp-warden` (absolute; do not rely on PATH).
- Command shape: warden flags, then `--`, then the child server command and
  its args. No proxy without a tail; unknown flag or empty tail is a usage
  error. Numeric flags are integers; duplicate flags last-wins.
- Runtime behavior: RAM budget sampling restarts an over-budget child; idle
  children get open files closed (`--idle-secs`), then SIGTERM sleep
  (`--sleep-after`), waking on the next request; a JSONL log records
  open/close/restart/sleep/wake/sample/crash/error. A budget restart drains
  in-flight requests (answered `-32026`) before the child dies; 3 crashes in
  a 60s window make the scope give up.

## Flags (important few)

| Flag | Default | Meaning |
|---|---|---|
| `--budget-mb N` | 0 = OFF | RAM cap in MB; child restarts when VmRSS exceeds it. This box has 3.3 GB; 256 to 512 is typical. |
| `--sleep-after N` | 900 | Idle seconds before the child sleeps (SIGTERM, wakes on next request). 0 = never sleep. |
| `--idle-secs N` | 600 | Idle seconds before open files are closed. 0 = close on first sweep. |
| `--max-inflight N` | 3 | Concurrency cap for expensive requests (FIFO queue). |
| `--log PATH` | none | JSONL event log. Recommended so behavior is observable. |

Everything adds (only if the user wants): `--sustain N` (default 2, consecutive
over-budget samples before restart), `--sample-secs N` (default 5, RSS
sampling interval), `--scopes GLOB` (one child per matching directory, must
contain tsconfig.json, no `**`; monorepo per-directory isolation only).

## Steps

1. Identify language(s) from repo markers: tsconfig.json/package.json/*.ts →
   TypeScript; pyproject.toml/requirements.txt/setup.py → Python;
   Cargo.toml → Rust; go.mod → Go; *.sh → Bash; otherwise scan extensions.
   List findings to the user.
2. Per language, the child is a stdio LSP server (e.g. pyright-langserver
   --stdio, rust-analyzer, gopls, bash-language-server start). Check with
   `which <binary>`. Missing → STOP and ask whether to download it. Yes →
   durable install mirroring the lsp-warden-tsc pattern
   (`~/.local/share/lsp-warden-<lang>/`) or the package manager the user
   names. Decline → skip that language, note it, continue.
3. Check `omp config get lsp.enabled` (must be true; if false, surface it and
   change only with consent).
4. Teach the flags above with defaults, then ask: full configuration or the
   important few? Record every value picked; state defaults for the rest.
5. Write `<project>/.omp/lsp.json`: one new key per language (e.g.
   `typescript-warden`). Do not touch other entries.
   - `command`: `/home/k2/.local/bin/lsp-warden`
   - `args`: picked flags + `--` + child command + child args
   - `fileTypes`: the language's extensions
   - `rootMarkers`: files/dirs that actually exist in THIS repo (verify; a
     marker that is absent means the server never activates)
6. Validate with `python3 -m json.tool`; re-check merge survival per the doc
   (non-disabled, marker match, binary resolves).
7. Verify end to end: write a file with a deliberate error; diagnostics must
   return through the proxy. Tail the log: expect open/sample events; idle
   past `--idle-secs` closes files; idle past `--sleep-after` sleeps; a later
   edit wakes it. `pgrep -af <server binary>` shows exactly one child while
   serving.
8. Report: language(s) and server(s) (or declined), every flag value chosen or
   defaulted, config path, verification results, and that changes apply on
   next session start.

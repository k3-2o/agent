# dap.json (debug tool)

MUST READ before writing any config: `omp://docs/tools/debug.md`. This card is
the map, the user's specifications, and the setup procedure.

Skippable: most setups need nothing from this card. If the user never asks to
debug, skip it entirely. No `.omp/dap.json` unless there is a concrete reason.

## Standing rules

- NEVER install an adapter binary without explicit user permission. Always ask
  for download permission first.
- Never enable the debug tool without consent.
- No config file for default setups; auto-detection handles them.

## Steps

1. **Check whether the debugger is installed.** Identify the language of what
   needs debugging, then `which <adapter>` for that language's built-in
   adapter. Missing → STOP and ask the user for download permission. Canonical
   installs: gdb/lldb-dap → apt · debugpy → pip · dlv → go install ·
   dart-debug-adapter → ships in the flutter SDK · js-debug-adapter → tarball
   or Mason (never npm). Decline → note it, stop.
2. **Enable the debug tool if disabled.** `omp config get debug.enabled`;
   false → tell the user, enable only with their yes (global knob,
   `~/.omp/agent/config.yml`).
3. **Test that the tool is live and usable.** A real roundtrip: `debug`
   action `sessions` (proves the tool exists), then a `launch` on a real
   binary; confirm an adapter resolves and a session opens, then `terminate`.
   Broken → report which layer failed: tool gate, binary, or marker match.
4. **Report**: adapter selected and why, install decisions, anything left for
   the user to do later.

## Auto-detection (for explaining failures)

At `debug launch` time: file extension matched to the adapter's `fileTypes`,
binary resolved on PATH (project bins first), root markers checked walking up
from the program (gdb: Makefile, CMakeLists.txt, compile_commands.json),
best match wins. Missing binary = "No debugger adapter available" naming the
command to install.

## When `.omp/dap.json` is worth writing

Rare: a custom adapter (not among the 14 built-ins), a binary outside PATH,
or non-default launch behavior.

```json
{
  "adapters": {
    "gdb": { "launchDefaults": { "request": "launch", "stopOnEntry": false } }
  }
}
```

Shape: `adapters` wrapper (or flat map); `command` is the only required field;
`fileTypes` and `rootMarkers` drive auto-selection ranking; `connectMode` is
`stdio` (default), `socket`, or `tcp`; `launchDefaults`/`attachDefaults`
deep-merge per key onto built-ins; `acceptsDirectoryProgram: true` for
adapters that launch a directory (dlv). Validate the JSON; changes apply on
the next session.

Built-in adapter keys (override targets): `gdb` `lldb-dap` `codelldb`
`debugpy` `dlv` `js-debug-adapter` `netcoredbg` `kotlin-debug-adapter` `rdbg`
`php-debug-adapter` `bash-debug-adapter` `dart-debug-adapter`
`flutter-debug-adapter` `elixir-ls-debugger`.

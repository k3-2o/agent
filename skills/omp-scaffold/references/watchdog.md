# WATCHDOG.md

MUST READ before creating this file: `omp://docs/advisor-watchdog.md`.
This card is the map and the user's specifications; the doc explains delivery,
rosters, and the emission guard.

Advisor-only guidance: appended to the advisor system prompt, never enters the
primary agent's context. Only matters when the advisor is enabled and the user
wants it watching specific, detailed things. Vague mandates ("write clean
code") are noise fuel; advisors spew redundant chatter, and specifics are the
only thing that grounds them. Nothing specific to watch? Skip creating it and
say why.

## Steps

1. Ask the user for the watch list: exact conditions, patterns, files, failure
   modes to monitor. Not topics: testable specifics.
2. Ask the exclusion list: what the advisor must shut up about (style
   nitpicks, already-covered patterns, anything the user names).
3. Draft; never unilateral: propose with why, user approves/edits.

## Earns lines

- Concrete watch conditions: "flag any edit touching `migrations/` without a
  paired test", "alert when a command reads `.env`"
- Explicit exclusions: "don't comment on formatting, imports, doc coverage"
- Named danger zones, not gestured at

## Stays out

General advice, quality exhortations, anything that can't fail a specific
check. If the line can't answer "what does this detect?", cut it.

## Mechanics

- Content loads as the advisor's `<attention>` list ("Especially pay attention
  to:").
- Every `WATCHDOG.md` from cwd to repo root loads; they stack, unlike
  AGENTS.md's nearest-wins. Later files are more prominent.
- `WATCHDOG.yml`/`WATCHDOG.yaml` is the advisor roster (per-advisor model,
  tools, instructions); mention only if the user wants per-model advisors.

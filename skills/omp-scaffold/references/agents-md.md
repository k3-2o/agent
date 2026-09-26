# AGENTS.md

MUST READ before creating this file: `omp://docs/context-files.md`.
This card is the map and the user's specifications; the doc explains discovery
and imports.

Has measured value only when its content prevents repeatable agent failures:
exact commands, traps, prohibitions the agent can't infer. Ask the user what's
known. No such material? Skip creating it and say why.

## Steps

1. Ask the user what the project has already taught (failures, traps, wrong
   paths taken). Mid-project additions ("add this to AGENTS.md") come through
   the named-item path with the incident in hand.
2. Draft from those answers only; every line traces to a stated incident,
   trap, or command. Never unilateral: propose with why, user approves/edits.
3. Offer `omp compress <draft>` as the density pass; it reports what's
   droppable.

## Earns lines

A line exists only if its absence caused a repeatable failure.

- Exact validation commands, runnable as-is (build/test/lint/typecheck)
- Where things belong: subsystem boundaries, key directories
- What not to assume: known traps, misleading names, verify-in-code-not-names
- Reporting rules ("no test passed unless it was run")
- Hard prohibitions: dangerous/slow commands, generated-file workflows

## Stays out

Overviews, style essays, generic principles, language basics. Anything
guessable from the repo is dead weight paid every turn.

## Structure

Rules → Principles → Workflow → References, under 60 lines. Principles is the
weakest section: enforced subset only; a principle that can't name the failure
it prevents gets cut.

## Mechanics

- `.omp/AGENTS.md` is project context, injected every session start.
- Nearest non-empty `.omp/` owns context: a missing file there does not fall
  back to an ancestor's.
- Root `AGENTS.md` exists? `.omp/AGENTS.md` shadows it at the same depth
  (native provider, priority 100). Ask which the user wants.
- Deeper style guidance, if wanted: project-setup's agents-md-guide is the
  house style.
- `@path` imports exist; point-don't-inline stands.
- Existing file: brush up, don't rewrite.

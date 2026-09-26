# Rules (TTSR)

MUST READ before creating any rule file: `omp://docs/ttsr-injection-lifecycle.md`.
It explains trigger fields, scopes, and delivery; this card is only the map and
the user's specifications.

Create `.omp/rules/<name>.md` (or `.mdc`). Rule name = filename minus
extension. Body = content injected when triggered. Passive guidance belongs in
`AGENTS.md`, not here.

Timing: rules are mostly mid-project use, lessons from incidents, not day
one. Still ask at scaffold time whether any are wanted now.

```markdown
---
description: Block terraform apply
condition: "terraform\\s+apply"
interruptMode: always
---

Never run terraform apply without explicit user approval.
```

## Steps

1. Read the doc above.
2. Ask, one question at a time, until every trigger decision is made (skip
   what the user's answers make irrelevant; never ask what is already specified).
3. Write the file; offer `omp ttsr test '<pattern>'` as verification.

## Field map (what exists; the doc explains each)

| Kind | Fields |
|---|---|
| Trigger (pick the surface) | `condition` (regex, prose + tool args) · `astCondition` (ast-grep, edit/write streams) · `question` (judged after output, never interrupts) |
| Where it watches | `scope` (`text` `thinking` `tool` `tool:edit` `tool:edit(*.ts)`; default excludes thinking) |
| What a match does | `interruptMode` (`always` `prose-only` `tool-only` `never`) |
| Gates | `agents` (name globs, `main` = top-level) · `globs` (file-path gate) · `enabled: false` (omit from discovery) |

All three trigger fields absent → the rule never triggers; do not create it
here.

## Interview order

1. What trips it: exact text/pattern → `condition`; code shape →
   `astCondition`; "did the output violate X" → `question`.
2. Interrupt or remind → `interruptMode`.
3. Which surface: prose, tool calls, thinking; path-scoped → `scope`.
4. Which agents → `agents`; file-bound → `globs`.
5. Write; suggest `omp ttsr test '<pattern>'` to verify.

# AGENTS.md Guide

Draft it, then iterate over it with the user to fortify it — propose with why; the user approves, rejects, or edits; nothing applies unilaterally.

## Format

Four sections, in order:

1. Rules: commands and constraints agents can't guess from the code; comment policy (comments are why-only and rare; docstrings on public interfaces only)
2. Principles: the subset distilled from the Phase 3 Principles that this project will enforces
3. Workflow: the project's loop; TODO-PLAN.md ticked every cycle; SPEC.md when scope or decisions change; and any other doc the project state contradicts gets updated that same cycle
4. References: one pointer per line (.agents/SPEC.md, .agents/TODO-PLAN.md, and other project specific docs)

## Rules

- No prose: rules, principles, workflows, references only
- Every line changes agent behavior or points to a doc that does
- Under 60 lines
- Docs contradict the project state → update the docs that same cycle; state why at the change
- Point to docs; never duplicate them
- Every change goes through the user: the agent proposes a draft with why; the user approves, rejects, or edits it before it applies — never change this file unilaterally
- Project root, `AGENTS.md`, in `.gitignore`

## Belongs

- Commands agents can't guess
- Stack picks from 4b, stated as runnable commands
- Conventions that differ from defaults
- Test and code rules: tests assert real behavior against the code's fabric; no test theater; no Potemkin implementations (code that only looks like it does the work)
- Comment and docstring policy
- The iteration gate: changes to this file are proposed as a draft with why; applied only after the user approves or edits it
- This project's loop
- Boundaries ("no new deps without updating SPEC.md")
- Pointers to docs

## Doesn't belong

- Prose, essays, onboarding
- Project overview (SPEC.md)
- Tasks and progress (TODO-PLAN.md)
- Generic principles, language basics
- Inlined doc contents

## Update

- Existing file: brush up, don't rewrite; strip prose, repair stale rules, keep what's right
- Change only when rules or conventions change

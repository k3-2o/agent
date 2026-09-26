---
name: skill-creator
description: "Create, validate, and iterate on agent skills. Use when the user wants to create a new skill, update an existing skill, validate a skill folder, or package improvements to a skill. Trigger words: skill, SKILL.md, init_skill, quick_validate, scaffold, new skill."
compatibility: "Scripts in scripts/, run from this directory."
---

# Skill Creator

A skill is a procedure, not documentation: the body routes, references teach, scripts gate. This skill builds skills from observed failures, evals first, in a loop with the user.

## The law

Every line changes agent behavior or points to a file that does. Skills are born from observed failures, never imagined needs. The full doctrine (lean, routing, degrees of freedom, triggers, voice, independence, anti-slop, naming): [references/skill-doctrine.md](references/skill-doctrine.md), required reading before Phase 3 and before any review pass.

## Pipeline

    Phase 0   Pre-check: observed failure + concrete examples, or no skill
    Phase 1   Contract: name, description, scope, location; user confirms
    Phase 2   Evals: 2-3 usage scenarios written before any content
    Phase 3   Build: scaffold, references, scripts, body
    Phase 4   Verify: validate, run evals, run scripts
    Phase 5   Review gate: user judges against the evals
    Phase 6   Iterate: real usage, struggle, minimal change, re-eval

### Phase 0: Pre-check

Has the user hit the failure this skill would prevent, with concrete examples of how they would use it? Yes → Phase 1. Vague → interview: what broke, what did you do manually, what would you say to trigger it, where should it live. No real failure exists → say so; the simplest solution is no skill.

### Phase 1: Contract

Agree with the user on: name (lowercase-hyphen, verb-led, folder matches), description (what + when + trigger phrases), scope (what it does not do), location (where the harness discovers skills — see below). User confirms before anything is built.

### Discovery locations and platform specifics

Do not hardcode where skills live. Harnesses differ (pi, omp, Claude, Codex, others): directory layouts, frontmatter schemas, config toggles. When the Phase 1 contract needs any platform fact — install location, supported frontmatter fields, validation limits, how the skill gets picked up — ask the user or read the running harness's own docs. Never guess from another harness's conventions. Frontmatter basics shared across the standard: `name` (lowercase-hyphen, matches the folder) and `description` (what + when + triggers); anything beyond that is harness-specific and gets confirmed, not assumed.

### Phase 2: Evals before docs

Write 2-3 eval scenarios before any skill content exists: the task, how it would be used, the expected behavior. The evals are the acceptance test Phase 4 must pass, and they expose what belongs in the body versus references versus scripts.

### Phase 3: Build

Read [references/skill-doctrine.md](references/skill-doctrine.md). Then:

    python scripts/init_skill.py <name> --path <dir> [--resources scripts,references]

Implement references and scripts first; test every script by running it; delete placeholders. Write the body: routing and procedure per the law. Write the frontmatter from the Phase 1 contract; platform fields beyond `name`/`description` only if the user or the running harness's docs confirm them.

### Phase 4: Verify

    python scripts/quick_validate.py <path/to/skill>

Run every eval scenario against the skill; run every script. Fix and re-run until green.

### Phase 5: Review gate

Put the skill in front of the user: description, body outline, eval results. They judge: does it trigger right, is anything missing, is anything bloat? Adjust until confirmed. The skill ships here or not at all.

### Phase 6: Iterate

Real usage only. Struggle or inefficiency → minimal change → re-run evals. Prune every pass: anything not earning its tokens goes.

## Reconcile before done

- Validates clean; every eval passes; every script runs
- No craft dumps, no examples of what the agent already knows
- Description carries trigger phrases; name matches the folder
- References one level deep; nothing duplicated with the body
- Zero em-dashes; imperative voice throughout
- The user confirmed at the Phase 5 gate

## References

- [references/skill-doctrine.md](references/skill-doctrine.md): the law. Phase 3 and Phase 5.
- `scripts/init_skill.py`: scaffold. Phase 3.
- `scripts/quick_validate.py`: validation gate. Phase 4.

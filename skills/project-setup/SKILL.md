---
name: project-setup
description: "Bootstrap or resume a project workspace: pre-check first, then SPEC.md, TODO-PLAN.md, AGENTS.md, a just fmt/lint/check/test pipeline, initial git commit, and a debrief — everything is a user iteration, the user actively involved in every phase. Use when starting a project from scratch, setting up a workspace, preparing a dev environment, or resuming existing work."
---

# Workspace Bootstrap

write → just (fmt lint check test) → docs → commit → repeat

Everything is a user iteration: the user is an active participant, never passive. They have a say in every phase — the two of you iterate over the work together.

## Workflow

    0. Pre-check        (no discussion → STOP)
    1. Workspace location
    2. SPEC.md
    3. TODO-PLAN.md
    4. Environment (just)
    5. Pipeline verify
    6. Git init
    7. Verify setup + debrief

## Existing project (skip Phase 0)

Project dir already has work? Run in order; fill the first gap found; never regenerate what exists:

1. `.agents/SPEC.md` (or project root) missing → Phase 2
2. `.agents/TODO-PLAN.md` missing → Phase 3
3. `justfile` missing → Phase 4
4. `AGENTS.md` missing or bloated → Phase 4d
5. `just check && just test` failing → Phase 5
6. Git not initialized → Phase 6
7. All green → Phase 7

## Phase 0: Pre-check

Run before any action. Do not skip, even on explicit "set up a workspace".

1. Check conversation history: enough context for a detailed SPEC (what, why, stack, requirements)?
2. None or too vague → stop and ask: what are we building, what problem, what stack, key requirements?
3. Sufficient → Phase 1.
4. Partial → interview: edge cases, technical implementation, concerns, tradeoffs. No obvious questions; dig into the hard parts. Continue until a complete spec is writable.

## Phase 1: Workspace Location

1. `~/.workspaces/` exists → list its category dirs, ask which (or a new category). Missing → ask for a path.
2. Create the project dir, `cd` in. All later phases run there.

## Phase 2: SPEC.md

1. Read [references/spec-guide.md](references/spec-guide.md). Required before writing; the spec is EARS format.
2. Close Phase 0 gaps first: interview on edge cases, tradeoffs, error behavior until the spec is writable complete. Unresolved → `[NEEDS CLARIFICATION: ...]` marker; never guess silently.
3. Write `SPEC.md` per the guide.
4. Move into the agent planning folder (never mixes with `docs/`, human-facing):

   ```bash
   mkdir -p .agent
   mv SPEC.md .agents/SPEC.md
   ```

## Phase 3: TODO-PLAN.md

1. Read [references/todo-plan-guide.md](references/todo-plan-guide.md). Required before writing.
2. Write `TODO-PLAN.md` per the guide: a todo list with the plan inside it. Every implementation task pairs with a `[ ] Write tests for ...` task.

Principles to iterate over and reason about based on the project's nature. Weigh each against what the project actually is; distill the ones that apply into SPEC.md, TODO-PLAN.md, and AGENTS.md (the enforced subset):

Design:

- SOLID: one purpose per unit; apply the letters that fit, force none
- YAGNI: build what is needed now, not what might be needed later
- KISS: the simplest thing that works; complexity must pay rent
- DRY: one canonical home per fact; derive the rest
- Law of Demeter: talk to collaborators, not strangers
- Command-query separation: do a thing or answer a question, never both
- Composition over inheritance: assemble behavior; deep hierarchies calcify
- GRASP: responsibility lives where the information lives

Structure:

- Separation of concerns: one reason to change per module
- Single-responsibility files: the file name is the job description
- Package-by-feature or by layer: pick one, stay consistent
- Clean or hexagonal boundaries: domain logic imports nothing concrete; adapters point inward
- Repository and service layers: data access and business rules never mix
- Naming: language convention, intent in every name

Qualities:

- High cohesion, low coupling: things that change together live together
- Single source of truth: one home per fact
- Fail fast: bad state dies at the boundary, not three layers deep
- Least astonishment: behave the way the reader guesses
- Comments: why-only and rare; no narration one-liners; docstrings on public interfaces
- Immutability by default: shared mutable state is a bug factory
- Idempotency: same input, same effect, safe to retry
- Readability over cleverness: code is read far more often than written
- Delete dead code: git remembers; commented-out code rots

Process:

- TDD or BDD where it pays: red-green-refactor on logic worth specifying first
- Arrange-act-assert, given-when-then: every test tells its story in three beats
- Cyclomatic complexity in check: branching explodes comprehension; extract or table it
- Boy scout rule: leave every touched file cleaner than you found it
- One change per commit: refactor or feature, never both at once
- Measure before optimizing: intuition about hot paths is wrong
- No test theater, no Potemkin code: tests prove behavior; implementations do the work
- Human approval gates: propose a draft with why before acting on shared artifacts; the user approves, edits, or rejects — never act unilaterally

Boundaries:

- Validate at the edge: parse input once at the boundary, trust it inside
- Errors are values: handle where handleable, never swallow silently
- Least privilege: minimal dependencies, permissions, scope
- Secrets never in code: env and config only, never committed

- This list is not exhaustive: any principle you know beyond it that serves this project better gets the same treatment (reason, apply, distill)

```bash
mv TODO-PLAN.md .agents/TODO-PLAN.md
echo ".agents/" >> .gitignore
```

## Phase 4: Environment

```bash
bash scripts/preflight.sh   # checks just, git; install missing or ask
```

### 4a. just

`just --help`, `just --man`. Recipes, recipe dependencies, variables, shell lines.

### 4b. Stack: pick the tools together

One exact, ecosystem-standard tool per role, from the Phase 0 language set. Pin the version. Ask questions before anything; then lay out all viable candidates per role, one line of why each, recommendation marked — the user picks. Nothing lands in the justfile, SPEC.md, or TODO-PLAN.md until picked. Multi-role tools (ruff, biome) count once.

Core roles:

- Language + version: Python 3.12+, Node LTS, Rust stable, Go stable
- Package manager: uv, npm, cargo, go mod
- Test framework: pytest, vitest, cargo test, go test
- Formatter + linter (one tool often covers both): ruff; biome; prettier + eslint; rustfmt + clippy; gofmt + golangci-lint
- Type checker: mypy, tsc, rustc + clippy, go vet

Extended roles. Raise them, judge together, adopt only what this project needs:

- Security: bandit (code); pip-audit, npm audit, cargo audit, govulncheck (deps); socket (supply chain); gitleaks, trufflehog (secrets); tfsec, checkov, trivy (IaC)
- Hygiene: spell check (codespell, cspell); dead code (vulture, ts-prune, unused); AST grep
- Recipes: smoke test (`tool --version && tool --help`), `clean`, `setup`, `outdated`, `release`
- Process: lockfile commits, CHANGELOG.md, pre-commit hooks running `just check`
- This list is not exhaustive: any tool you know beyond it that serves a role better gets the same treatment (raise it, lay out the candidates with why, the user picks, land in SPEC.md and TODO-PLAN.md)

### 4c. Scaffold: init, deps, justfile, .gitignore

Init:

    uv init --app --python 3.12       # Python
    npm init -y                       # TypeScript
    cargo init                        # Rust
    go mod init <module-name>         # Go

Dev dependencies (4b picks):

    uv add --dev <4b picks>          # Python
    npm install --save-dev <4b picks>   # TypeScript


.gitignore: language patterns (`__pycache__/`, `node_modules/`, `target/`, `vendor/`, `.env`, `*.local`, ...); must include `.agents/` and `AGENTS.md`.

### 4d. AGENTS.md (required)

Read [references/agents-md-guide.md](references/agents-md-guide.md). Required before writing or touching it. Write or repair at project root per the guide; Principles section = enforced subset of the Phase 3 reminder.

Gate (same weight as SPEC.md and asking questions): never write, modify, or commit AGENTS.md unilaterally. Ask questions first, then propose a full draft with why for every choice. The user approves, rejects, or edits it themselves; iterate until they accept. Only then write the file.

```bash
echo "AGENTS.md" >> .gitignore
```

## Phase 5: Pipeline Verify

    just fmt
    just check
    just test    # runs even with 0 tests

All pass before proceeding, plus every recipe adopted from 4b (smoke, audit, ...). On failure: `just fmt` first, then `just check`. Common: Python missing `__init__.py`, unused imports, annotations; TS implicit `any`, unused vars; Rust dead_code, trait imports, lifetimes; Go imports, unused vars, module path.

## Phase 6: Git Init

    git init
    git add -A
    git commit -m "Initial: <project-name> <brief description>"

## Phase 7: Verify Setup

1. cwd is the project dir
2. `.agents/SPEC.md`: overview, goals, EARS requirements (prioritized), success criteria, architecture, file breakdown, dependencies, tests, risks; ends with end-to-end verification
3. `.agents/TODO-PLAN.md`: phased checkboxes, progress bar
4. `.gitignore`: `.agents/`, `AGENTS.md`, language patterns
5. `justfile`: the six core recipes plus one per adopted 4b extended role
6. every `just` recipe chosen passes (`fmt`, `check`, `test` extra )
7. Git repo, at least one commit
8. `AGENTS.md` at root: rules/principles/workflow/references only

Fix anything missing or broken before proceeding.

### Debrief (in chat, not a file)

Explain the loop with this project's actual recipes:

    write → just [recipes] → docs → commit → repeat

- Failure path: auto-fix where possible, else manual fix, re-run
- Docs: TODO-PLAN.md ticked every cycle; SPEC.md on scope/decision change; AGENTS.md on rule/convention change
- Commit only when checks pass and docs are current

Then ask: "Is that exactly this project's loop? Anything to add, remove, rearrange?" Adjust until confirmed.

Last: tell the user to review `.agents/SPEC.md` and `.agents/TODO-PLAN.md` thoroughly, requirements to task order, and confirm or request changes. No implementation starts until both are approved.

Setup ends here.

## Resources

- [references/spec-guide.md](references/spec-guide.md): EARS spec format. Read before Phase 2.
- [references/todo-plan-guide.md](references/todo-plan-guide.md): TODO-PLAN format. Read before Phase 3.
- [references/agents-md-guide.md](references/agents-md-guide.md): AGENTS.md format. Read before Phase 4d.
- [scripts/preflight.sh](scripts/preflight.sh): checks just, git. Run at Phase 4 start.

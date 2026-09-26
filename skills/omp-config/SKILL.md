---
name: omp-config
description: "Set up or amend project .omp/config.yml: subagents, isolation and worktrees, eval kernels, edit mode, tool toggles."
---

# Project config.yml wizard

Create or amend `.omp/config.yml` in the project root. 
- Check first whether `.omp/config.yml`exists. 
- If it exists, read it to see what is already set and shape the questions around it.

## Fences

- ONLY the 46 keys in the Settings sections below for the `.omp/config.yml`.
- Anything outside them: say so and stop.
- N run `omp config list --json`. Use `omp config get <key>`.
- Ensure `.omp/` is git-ignored: if not already covered by `.gitignore`,
  add `.omp/` to it, if is not a git repo do nothing on this.

## Flow

- Key(s) named with a stated value ("set task.maxConcurrency to 8", "turn
  off eval.py"): apply directly. Confirm type/enum from the key's row in
  the knob sections below, write, verify with `omp config get <key>`,
  report. No question, no section walk.
- Named area or key, value not stated: that stop only.
- No direction: walk all 5 stops, one question each.

## Stop pattern

1. Read the area's numbered knob section below.
2. `omp config get <key>` for each candidate key.
3. One question: current value, options from the section, default.
4. Write chosen keys only; edit existing file in place.
5. Verify each write with `omp config get <key>`.

## Areas

| Area | Keys |
|---|---|
| 1. Subagents | `task.*`, `async.*` |
| 2. Isolation & worktrees | `task.isolation.*`, `isolation.backend`, `worktree.*` |
| 3. Eval kernels | `eval.js`, `eval.py` |
| 4. Edit | `edit.mode` |
| 5. Tools | search + core rosters |

## Settings

All defaults verified against the installed omp build; current values via
`omp config get <key>`. Each section names its omp:// doc; read only the
named section.

### 1. Subagents

Docs: `omp://tools/task.md`, sections "Modes / Variants" and "Limits & Caps";
`omp://task-agent-discovery.md` for frontmatter and prewalk/advisor
overrides; `omp://prewalk.md`, "Task subagents" paragraph.

#### task.eager (enum: default|preferred|always, default "default")

Delegation push. `default`: model's own policy. `preferred`: delegation
guidance in the system prompt. `always`: guidance plus first-turn reminder.

#### task.batch (bool, default true)

One call carries `{context, tasks[]}`, one subagent per item. With
`async.enabled`, each spawn runs as a background agent; otherwise the call
blocks for merged results.

#### task.enableEffort (bool, default false)

Expose per-spawn `effort` override. Ceiling: `task.maxEffort`.

#### task.maxEffort (enum: minimal|low|medium|high|xhigh|max, default "max")

Ceiling on the per-spawn effort hint.

#### task.maxConcurrency (num, default 32; 0 = unlimited)

Concurrent subagent cap.

#### task.maxRecursionDepth (num, default 2; -1 = unlimited, 0 = none)

Subagent nesting depth. Gates the task tool itself: a session at depth N gets
`task` only if N < maxRecursionDepth. 0 removes the task tool everywhere.

#### task.maxRuntimeMs (num, default 0 = unlimited)

Hard wall-clock limit per subagent run (ms).

#### task.agentIdleTtlMs (num, default 420000)

Idle subagent parked to disk after this (ms). 0 keeps it live until exit.

#### task.softRequestBudget (num, default 200; 0 = off)

Per-run assistant-request budget. Wrap-up notice on crossing; force-stop at
1.5x.

#### task.softRequestBudgetNotice (bool, default true)

Inject the wrap-up notice at the soft budget.

#### task.enableLsp (bool, default false)

Let subagents use the lsp tool.

#### task.disabledAgents (array, default [])

Agent names hidden from the task tool.

#### task.agentModelOverrides (record, default {})

Per-agent model override: `{scout: "openrouter/qwen/qwen3-coder"}`.

#### task.agentServiceTierOverrides (record, default {})

Per-agent service tier override, same shape.

#### task.agentCompactionThresholdOverrides (record, default {})

Per-agent compaction threshold override, same shape.

#### task.prewalk (bool, default false)

Generic `task` agent plans first, hands off to `smol` at first edit/write.

#### task.agentPrewalk (record, default {})

Per-agent prewalk override.

#### task.agentAdvisor (record, default {})

Per-agent advisor override.

#### task.showResolvedModelBadge (bool, default false)

Show each subagent's model id in the task widget.

#### async.enabled (bool, default true)

Async bash and background task execution. Gates the `wait` tool.

#### async.maxJobs (num, default 100)

Concurrent background job cap.

### 2. Isolation & worktrees

Docs: `omp://tools/task.md`, sections "Modes / Variants" (backends, merge
modes) and "Side Effects". `worktree.clone` and `worktree.cleanSource` are
schema-only (no prose doc): source of truth is `omp config list`.
`worktree.base`'s env override is documented in
`omp://environment-variables.md`, section "6) Storage and config root
paths".

#### task.isolation.enabled (bool, default false)

Run subagents in an isolated copy of the checkout.

#### task.isolation.apply (bool, default true)

Auto-apply successful isolated changes to the parent checkout.

#### task.isolation.merge (enum: patch|branch, default "patch")

`patch`: combine diffs, git apply. `branch`: commit per task, merge --no-ff.

#### task.isolation.commits (enum: generic|ai, default "generic")

Commit message style for nested repo changes.

#### isolation.backend (enum, default "auto")

`auto|apfs|btrfs|zfs|reflink|overlayfs|projfs|block-clone|rcopy`.

#### worktree.clone (bool, default true)

New worktrees start as copy-on-write clones; build artifacts carry over.

#### worktree.cleanSource (bool, default false)

With `/wt`: reset and clear the source checkout after carrying over.

#### worktree.base (str, default unset → ~/.omp/wt)

Base directory for agent-managed worktrees. Must be absolute or ~-relative.
`OMP_WORKTREE_DIR` env overrides.

### 3. Eval kernels

Docs: `omp://tools/eval.md`, section "Backend availability"; catalog rows
under `omp://settings.md`, section "Settings catalog → Shell, eval, and
LSP".

#### eval.js (bool, default true)

Dispatch JS cells to the in-process runtime.

#### eval.py (bool, default true)

Dispatch Python cells to the IPython kernel.

### 4. Edit

Docs: `omp://tools/edit.md`, section "Mode selection and availability";
catalog rows under `omp://settings.md`, section "Settings catalog → Files:
editing and reading".

#### edit.mode (enum, default "hashline")

`replace`: exact old/new string swap.
`patch`: unified-diff.
`hashline`: line-hash anchored ops.
`apply_patch`: OpenAI-style block format.
`sloppy`: tolerant patch application.

### 5. Tools

Docs: `omp://settings.md`, section "Settings catalog → Tools and approvals"
(roster keys), plus the per-tool doc for the toggle in question:
`omp://tools/find.md`, `omp://tools/todo.md`, `omp://tools/ask.md`,
`omp://tools/checkpoint.md`, `omp://tools/ast-grep.md`,
`omp://tools/ast-edit.md`, `omp://tools/web_search.md`,
`omp://tools/security_scan.md`, `omp://tools/glob.md`, `omp://tools/grep.md`,
`omp://tools/read.md` (fetch).

#### Search roster

| Key | Type/Default | Purpose |
|---|---|---|
| glob.enabled | bool, true | glob file lookup |
| grep.enabled | bool, true | regex content search |
| astGrep.enabled | bool, false | AST search |
| astEdit.enabled | bool, true | AST rewrites |
| find.enabled | enum: auto\|on\|off, "auto" | natural-language search; `auto` needs judge on a TypeSafe jev model |
| fetch.enabled | bool, true | read tool fetches URLs |
| web_search.enabled | bool, true | web search |
| security.enabled | bool, false | security scans + `security://` |

#### Core roster

| Key | Type/Default | Purpose |
|---|---|---|
| todo.enabled | bool, true | todo tool |
| todo.eager | enum: default\|preferred\|always, "default" | auto todo-list creation |
| tasks.todoClearDelay | num, 60 | seconds before finished todos clear |
| ask.enabled | bool, true | ask tool |
| ask.timeout | num, 0 | auto-select recommended option after N seconds |
| checkpoint.enabled | bool, false | checkpoint/rewind tools |

## Writing rules

- Two-space indent; key names verbatim from the card.
- Omit keys the user did not choose.

## Example

```yaml
task:
  eager: preferred
  maxConcurrency: 8
  maxRecursionDepth: 1

async:
  enabled: true

eval:
  js: true
  py: false

edit:
  mode: replace
```

## Report

Table: key, old value, new value.

---
name: omp-scaffold
description: "Scaffold project-level omp config under .omp/: plans/, agents/, rules/, lsp.json (lsp-warden), dap.json, AGENTS.md, WATCHDOG.md."
---

# Scaffold OMP Project

Create or extend `.omp/` in the project root.
- Run `omp --version` first; omp missing: stop and say so.
- Check whether `.omp/` exists. If it exists, read what is already there and
  shape the questions around it.

## Flow

- Named item(s) with stated intent ("add a scout override", "set up lsp for
  this project"): read that item's card only, apply the stated specifications,
  verify, report. No menu, no interview beyond what the request leaves
  unspecified.
- No direction: show the menu, user picks one or more items (multi-select) in the menu table below.
- Each pick: read its referenced **before** writing anything in it, one question at
  a time until every field is decided, write, verify, report. Never read every
  card up front.

## Menu

SHOULD read the references first before writes

| Item | Card |
|---|---|
| agents | [references/agents.md](references/agents.md) |
| rules | [references/rules.md](references/rules.md) |
| AGENTS.md | [references/agents-md.md](references/agents-md.md) |
| WATCHDOG.md | [references/watchdog.md](references/watchdog.md) |
| lsp.json | [references/lsp.md](references/lsp.md) |
| dap.json | [references/dap.md](references/dap.md) |
| plans | ask first; where approved plans are saved |

## Hard rules

| Domain | Rule |
|---|---|
| `plans/` | Ask first; it is where approved plans are saved. |
| `agents/` | Exact frontmatter `name` match overrides a bundled agent (`scout`, `task`, `sonic`, `reviewer`, `security-reviewer`). Near-names do not. |
| `rules/` | TTSR interruption rules only. Passive guidance belongs in `AGENTS.md`. |
| `lsp.json` | Always through the lsp-warden proxy; server download only on explicit yes. |
| `AGENTS.md` | Content style follows the project's existing convention if one exists; this skill owns placement and discovery semantics, not style. |

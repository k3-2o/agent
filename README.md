# pi-k2

**k3-2o's coding agent config** — extensions, themes, skills, prompts, and helpers.

## Extensions

| Path | Description |
|------|-------------|
| `extensions/omp/core-tools.ts` | OMP core tools |
| `extensions/pi/ask-user-question.ts` | Ask the user multiple-choice questions |
| `extensions/pi/clipboard.ts` | Copy text to system clipboard |
| `extensions/pi/save-session.ts` | Save ephemeral (`--no-session`) sessions so `/resume` can reload them |
| `extensions/pi/web_search.ts` | Web search, discovery, and extraction |
| `extensions/pi/read_image/` | OCR tool — extracts text from images via native C Tesseract |

## Skills

| Path | Description |
|------|-------------|
| `skills/adversarial-audit/` | Adversarial code audit — finds real bugs and vulnerabilities, diff-validated fixes |
| `skills/anti-slop/` | Write and polish AI text so it reads a little bit human |
| `skills/bridge-helper/` | Write a `bridge.py` exposing exactly the pi-bridge tools a project needs |
| `skills/composio/` | 1000+ app integrations via the Composio SDK — search catalog, connect apps, run actions |
| `skills/docs-skill/` | Documentation — READMEs, API refs, architecture docs, tutorials, changelogs (Diátaxis) |
| `skills/helper-creation/` | Iteratively design the right pi-repl helper with the user before building |
| `skills/omp-config/` | Set up or amend project `.omp/config.yml` |
| `skills/omp-scaffold/` | Scaffold project-level `.omp/` config |
| `skills/project-setup/` | Set up or resume project workspaces |
| `skills/scope/` | Codebase orientation — per-file cards: entry points, exports, deps, key symbols |
| `skills/session-memory/` | Recall past conversations from session history |
| `skills/skill-creator/` | Create, refactor, validate, and package agent skills |
| `skills/youtube-transcript/` | Fetch YouTube video transcripts and summarize |

## Themes

| File | Description |
|------|-------------|
| `themes/dracula.json` | Dracula |
| `themes/helios-night.json` | Helios Night |
| `themes/nightowl.json` | Night Owl |

## Prompts

| File | Description |
|------|-------------|
| `prompts/linus-review.md` | Code review from a Linus Torvalds perspective |

## Helpers

| File | Description |
|------|-------------|
| `.helpers/web.py` | Preloaded web client for a persistent REPL |

## Config

| File | Description |
|------|-------------|
| `config/config.yml` | Agent settings — model roles, theme, edit/bash/task behavior, compaction, tool toggles |
| `config/SYSTEM_TEMPLATE.md` | Customized system-prompt template |

## Tools

| Path | Description |
|------|-------------|
| `tools/LSP-warden/` | Transparent LSP proxy — idle file closing, RSS-budget restarts, sleep/wake, diagnostics cache, FIFO limiter |
| `tools/sm/` | Ranked search over omp session history — Python 3 stdlib only |

## License

Apache-2.0

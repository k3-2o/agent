# Agents

MUST READ before creating any agent file: `omp://docs/task-agent-discovery.md`.
It explains discovery, precedence, and parsing; this card is only the map and
the user's specifications.

Create task agents as `.omp/agents/<file>.md`. The filename is decorative;
frontmatter `name` is the identity. One agent per file.

```markdown
---
name: reviewer
description: Review a change for correctness.
model: "@review"
---

Review the assigned change and report concrete findings.
```

## Steps

1. Read the doc above.
2. Ask, one question at a time, until every field is decided (skip what the
   user's answers make irrelevant; never ask what is already specified).
3. Write the file.

## Field map (what exists; the doc explains each)

`name` `description` `model` `tools` `spawns` `thinking-level` `blocking`
`read-summarize` `prewalk` `advisor` `autoload-skills` `output`

## Tools

Built-in tool names (canonical, lowercase; `yield` must not be listed; docs at
`omp://docs/tools/<name>.md`):

`read` `bash` `edit` `write` `grep` `glob` `find` `ast_grep` `ast_edit` `lsp`
`eval` `github` `web_search` `task` `wait` `todo` `ask` `debug` `checkpoint`
`rewind` `context_notes` `new_context` `security_scan` `ida` `browser`
`computer` `memory_edit` `retain` `recall` `reflect` `learn` `manage_skill`

Before proposing a tool for an agent, read its doc at
`omp://docs/tools/<name>.md`. Never propose a tool whose doc you have not read
in this session.

Suggest tools matched to the agent's stated job (purpose → candidates):
review/correctness → `read` `grep` `glob` `ast_grep` `lsp`;
implementation → `read` `edit` `write` `bash` `lsp` `eval`;
research/scouting → `read` `glob` `grep` `web_search`;
tests → `bash` `eval` `read`; git/PR → `github` `bash` `read`;
security audit → `read` `grep` `ast_grep` `security_scan` `eval`.
Minimal set only; if `tools` includes `task`, also decide `spawns`.

## Overriding a bundled agent

Bundled names: `scout`, `task`, `sonic`, `reviewer`, `security-reviewer`.
A project file whose frontmatter `name` equals a bundled name replaces it
entirely; near-names create a separate agent.

Two routes; ask which:

1. `omp agents unpack --project` writes the bundled definitions into
   `.omp/agents/` for editing.
2. Write from scratch: minimal frontmatter (`name` = bundled name, custom
   `description` + body; omit `tools` to inherit its toolset).

## Entirely custom agents

Same file format, new name. Ask: purpose, model (or role alias), toolset
(suggestion table above), children/spawns, advisor pairing, blocking vs async.

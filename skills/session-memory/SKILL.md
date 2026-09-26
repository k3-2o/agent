---
name: session-memory
description: "Recall past omp conversations from the session store. Use when the user references earlier work, prior decisions, a previous session, or asks what was discussed before. Trigger phrases: what did we do, last time, previously, earlier session, recall, where did we decide, what did I say about. Do not load for general questions."
---

# Session Memory

Recall runs through the `sm` CLI (`sm find -h` lists flags).

## What sm is

Ranked search over omp session history (`~/.omp/agent/sessions`). Subcommands:

- `sm find TERM...` ranked search
- `sm peek SESSION LINE [SESSION LINE...] [-C N]` render exactly the given
  turns (the widening move); `-C N` opts into N neighbor turns each side
- `sm serve start|stop|status|restart` optional cache prewarm daemon
- `sm index --rebuild|--status` cache control

Useful `find` flags: `-n N` max sessions (default 10), `-k N` hit turns per
session (default 3), `--self` include the live echoing session, `--table`
force table output when piped.

## Procedure

1. Mine 2 or more search terms from the event: identifiers, paths, tool
   names, versions. Split camelCase. Drop fillers and words under 3 chars.
   Under 2 solid terms: ask the user instead of searching.
2. Search:

       sm find --table -n 10 -k 3 TERM [TERM...]

   Each hit block: a `title  age` header, the session base file name with
   `hits=N span=N`, then matched turns as `[role N] text` (200-char snippets;
   N is the LINE to feed `sm peek`).
3. Interpret. Rank order: sessions containing every term first (span is a
   line count), then tighter span, then more hits, then recency. `span: "-"`
   marks a partial session (some terms missing) and is always ranked below
   full ones.
4. Report. Quote the matched user turn verbatim on a hit. On empty output
   run 2 or 3 passes with variant terms (synonyms, different casing, path
   fragments) before reporting "nothing in history matches". Never guess at
   content the output does not show.

## Gates

- To widen a hit: `sm peek SESSION LINE` — renders exactly that turn, nothing
  else. SESSION accepts a unique fragment of the base name. Pass several
  SESSION LINE pairs (e.g. `sm peek s1 42 s2 7`) to widen multiple hits in
  one call; `-C N` explicitly adds N neighbor turns each side when adjacency
  is wanted.
- The live session echoes queries and is excluded by default. Pass `--self`
  only when the user asks about the current conversation.
- Optional: `sm serve start` prewarms the cache; searches work without it.
  Check `sm serve status` when results look stale.
- First run on a cold cache prints `indexed N session(s)` on stderr and can
  take seconds; later runs are fast.

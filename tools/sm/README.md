# sm - omp session memory search

Ranked search over omp session history (`~/.omp/agent/sessions`). Python 3
stdlib only.

```
usage: sm [-h] [--version] {find,peek,serve,index} ...
```

## Commands

| command | purpose |
|---|---|
| `sm find TERM [TERM...]` | ranked search. JSON when piped / `--json`; table on a tty (`--table` forces it) |
| `sm peek SESSION LINE [SESSION LINE...] [-C N]` | render exactly the requested turns, nothing else; `-C N` adds N neighbor turns each side |
| `sm serve start\|stop\|status\|restart\|foreground` | background cache prewarmer; optional, find works without it |
| `sm index --rebuild\|--status` | cache control |

`sm find` options: `-n N` max sessions (10), `-k N` hit turns per session (3),
`--self` include the current session (excluded by default), `--rebuild`.

## Ranking semantics

A line hits when it contains any term (case-insensitive substring). A session
is **FULL** when every term hits somewhere in it. FULL always beats partial.
Within FULL, order by tighter minimum span (line distance covering all distinct
terms), then more hits, then newer mtime. Partials order by hits, then mtime.

JSON contract (`sm find --json`, stable):

```json
{"results":[{"session":"<base>.jsonl","span":12|"-","hits":34,"mtime":1790508432,
             "title":"...","lines":[{"line":42,"role":"user","text":"..."}]}]}
```

`span` is `"-"` for partial sessions. Line numbers refer to the source jsonl;
`sm peek` consumes them.

## Find output

The table prints one block per session: a `title  age` header, the session
base name with `hits=N span=N`, then hit turns as `[role N] text` (200-char
snippets). N is the 1-based line of that turn in the session file; feed it to
`sm peek` to widen.

## Peek output

`sm peek SESSION LINE [SESSION LINE...] [-C N]` renders exactly the requested
turns and nothing else; neighbors appear only with `-C N`:

```
# 2026-09-16T03-18-39-419Z_01a0a839-….jsonl
turn 42 agent: Let me fix that awk file — …
```

- One line per requested turn: `turn N role: text`. N is the 1-based line of
  that turn in the session file, the same number `sm find` reports in its
  `[role N]` hits, so widening chains directly from a hit.
- Nothing is injected beyond the requested turns. A user turn appears only
  when its own line was requested (e.g. it was itself a hit). `-C N`
  explicitly adds N neighbor turns each side.
- Text is flattened, clipped to 400 chars. The renderer never emits
  toolCall/toolResult/thinking lines.
- Multiple SESSION LINE pairs render in one call, each under a `# session`
  header; a requested turn prints once even if named twice.
- A requested line with no nearby turn clamps to the nearest turn (within
  `-C`, else ±1), or prints `(no readable turns near line N)`.

## Cache

Shards live under `${OMP_SM_CACHE:-${XDG_RUNTIME_DIR:-/tmp}/omp-sm-py}/$USER`,
one TSV file per session (`base \t lineno \t role \t text`), rebuilt when the
source jsonl is newer. Shard mtime is stamped from the source file, so shard
mtime is session recency. `--rebuild` re-indexes in place (the daemon and
its pidfile are never disturbed); concurrent syncs are safe. The cache
namespace is separate from the legacy awk tool's (`omp-sm`); they must never
share shards.

## What's indexed

Per session: user/assistant messages with a non-empty text block, plus title
and compaction summary lines. Text is flattened to one line per turn,
truncated to 800 chars. toolCall / toolResult / thinking lines are noise and
skipped. Malformed or torn jsonl lines are skipped, never fatal. The indexer
parses records with a JSON parser, so key order and content shape can't
misclassify turns.

## Environment

| variable | default | meaning |
|---|---|---|
| `OMP_SM_SESSIONS` | `~/.omp/agent/sessions` | session store root |
| `OMP_SM_CACHE` | `${XDG_RUNTIME_DIR:-/tmp}/omp-sm-py/$USER` | shard cache |
| `OMP_SM_RUNTIME` | cache root | daemon pidfile/log dir |
| `OMP_SM_REFRESH` | `20` | serve resync seconds (clamped to ≥1) |

## Tests

```
python3 tests/test_sm.py     # stdlib unittest, 37 tests
```

## Provenance

Port of the original bash + mawk `skills/session-memory`, with identical
ranking semantics. `compare.sh TERM [TERM...]` runs both tools side by side on
the real store and diffs the result sets.

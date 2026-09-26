#!/usr/bin/env python3
"""sm — search omp session memory.

Flattens each session JSONL under ~/.omp/agent/sessions into a compact TSV
shard (one per session, mtime-checked), then ranks shards against search
terms: sessions containing every term first, then tighter term span, then
more hits, then recency.

Subcommands:
    find    search ranked (default when piped: JSON)
    peek    render exactly the requested turns from a session file
    serve   prewarm/refresh the shard cache in the background
    index   cache control (--rebuild, --status)
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path

PROG = "sm"
VERSION = "1.0.0"

# Shard text is truncated per turn; snippets in output are shorter.
MAX_TURN_CHARS = 800
SNIPPET_CHARS = 200
PEEK_TURN_CHARS = 400
DEFAULT_LIMIT = 10
DEFAULT_PEEK = 3
REFRESH_SECONDS = 20


def home() -> Path:
    return Path(os.path.expanduser("~"))


def sessions_root() -> Path:
    return Path(os.environ.get("OMP_SM_SESSIONS") or home() / ".omp" / "agent" / "sessions")


def cache_root() -> Path:
    base = os.environ.get("OMP_SM_CACHE") or os.environ.get("XDG_RUNTIME_DIR") or "/tmp"
    # "omp-sm-py": own namespace — the legacy awk tool's shards carry index-time
    # mtimes (not source mtimes) and truncated unicode; never mix the two.
    return Path(base) / "omp-sm-py" / (os.environ.get("USER") or os.getlogin())


# ---------------------------------------------------------------------------
# indexing: session jsonl -> shard tsv
# ---------------------------------------------------------------------------


@dataclass
class Turn:
    line_no: int  # 1-based line number in the source jsonl
    role: str  # user | assistant | title | summary
    text: str


def _block_text(content: object) -> str:
    """Concatenate text blocks from a message content payload."""
    parts: list[str] = []
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                text = block.get("text")
                if isinstance(text, str) and text:
                    parts.append(text)
    return " ".join(parts)


def parse_session_line(obj: object) -> tuple[str, str] | None:
    """Classify one jsonl record into (role, text) or None for noise.

    Only user/assistant messages carrying a non-empty text block, plus title
    and compaction summary lines, are recall-relevant. toolCall, toolResult,
    thinking and everything else are noise.
    """
    if not isinstance(obj, dict):
        return None
    message = obj.get("message")
    if isinstance(message, dict):
        role = message.get("role")
        if role in ("user", "assistant"):
            text = _block_text(message.get("content"))
            if text.strip():
                return str(role), text
        return None
    kind = obj.get("type")
    if kind == "title":
        title = obj.get("title")
        if isinstance(title, str) and title.strip():
            return "title", title
    elif kind == "compaction":
        summary = obj.get("summary")
        if isinstance(summary, str) and summary.strip():
            return "summary", summary
    return None


def flatten_text(text: str) -> str:
    """Collapse whitespace so a turn is always a single TSV-safe field."""
    return " ".join(text.split())


def index_session_file(path: Path) -> list[Turn]:
    turns: list[Turn] = []
    with path.open("r", encoding="utf-8", errors="replace") as fh:
        for line_no, raw in enumerate(fh, start=1):
            raw = raw.strip()
            if not raw:
                continue
            try:
                obj = json.loads(raw)
            except json.JSONDecodeError:
                continue  # torn/partial last line, or foreign content: skip
            parsed = parse_session_line(obj)
            if parsed is None:
                continue
            role, text = parsed
            text = flatten_text(text)[:MAX_TURN_CHARS]
            if text:
                turns.append(Turn(line_no, role, text))
    return turns


def shard_path(cache: Path, session_file: Path) -> Path:
    return cache / (session_file.name + ".t")


def write_shard(cache: Path, session_file: Path, turns: list[Turn]) -> None:
    """Atomic shard write; safe under concurrent syncs (unique tmp per writer)."""
    fd, tmp_name = tempfile.mkstemp(prefix=f".{session_file.name}.", suffix=".tmp", dir=cache)
    tmp = Path(tmp_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as out:
            for turn in turns:
                out.write(f"{session_file.name}\t{turn.line_no}\t{turn.role}\t{turn.text}\n")
        # last writer wins; both contents are valid renders of the same source
        os.replace(tmp, shard_path(cache, session_file))
    except OSError:
        tmp.unlink(missing_ok=True)
        raise
    # carry the source's mtime exactly: shard mtime doubles as session recency,
    # and the sync check below compares the same nanosecond value
    src_ns = session_file.stat().st_mtime_ns
    os.utime(shard_path(cache, session_file), ns=(src_ns, src_ns))


def sync_cache(cache: Path, root: Path, force: bool = False) -> int:
    """Index new/changed sessions; drop shards whose source vanished."""
    cache.mkdir(parents=True, exist_ok=True)
    indexed = 0
    seen: set[str] = set()
    for session_file in root.glob("*/*.jsonl"):
        seen.add(session_file.name)
        shard = shard_path(cache, session_file)
        try:
            if not force and shard.exists() and shard.stat().st_mtime_ns >= session_file.stat().st_mtime_ns:
                continue
            turns = index_session_file(session_file)
            write_shard(cache, session_file, turns)
        except OSError:
            continue  # source vanished mid-scan or unwritable cache: skip
        indexed += 1
    for shard in cache.glob("*.t"):
        if shard.stem not in seen:
            shard.unlink(missing_ok=True)
    return indexed


# ---------------------------------------------------------------------------
# live-session detection (exclusion of the echoing session)
# ---------------------------------------------------------------------------


def session_slug(cwd: Path) -> str:
    """omp's session-dir slug: home-relative '-a-b', tmp '-tmp-…', else '--abs--'."""
    cwd_c = cwd.resolve()
    home_c = home().resolve()
    tmp_c = Path(tempfile.gettempdir()).resolve()
    if cwd_c == home_c:
        return "-"
    try:
        return "-" + cwd_c.relative_to(home_c).as_posix().replace("/", "-")
    except ValueError:
        pass
    if cwd_c == tmp_c:
        return "-tmp"
    try:
        return "-tmp-" + cwd_c.relative_to(tmp_c).as_posix().replace("/", "-")
    except ValueError:
        pass
    return "--" + cwd_c.as_posix().lstrip("/").replace(":", "-").replace("/", "-") + "--"


LIVE_FALLBACK_WINDOW = 120  # seconds; fallback only for plausibly-live files


def live_session_base(root: Path, cwd: Path) -> str | None:
    """Base name of the session file the current agent holds open.

    Primary: walk the ancestor process chain in /proc for an open fd on a
    session jsonl directly under the sessions root — the fd carries the full
    path, so no slug reconstruction is needed, and decoy files are never held
    open. Fallback (bare shell): newest jsonl in the cwd-slug dir whose session
    header carries this cwd, restricted to files modified within the last
    LIVE_FALLBACK_WINDOW seconds so manual runs never exclude a closed session.
    """
    root_c = root.resolve()
    pid = os.getpid()
    seen: set[int] = set()
    while pid and pid != 1 and pid not in seen:
        seen.add(pid)
        fd_dir = Path(f"/proc/{pid}/fd")
        if fd_dir.is_dir():
            try:
                fds = list(fd_dir.iterdir())
            except OSError:
                fds = []
            for fd in fds:
                try:
                    target = Path(os.readlink(fd))
                except OSError:
                    continue
                if (
                    target.name.endswith(".jsonl")
                    and not target.name.startswith("__advisor")
                    and target.parent.parent == root_c
                ):
                    return target.name
        try:
            status = Path(f"/proc/{pid}/status").read_text()
        except OSError:
            break
        ppid = None
        for line in status.splitlines():
            if line.startswith("PPid:"):
                ppid = int(line.split()[1])
                break
        if ppid is None:
            break
        pid = ppid
    # fallback: newest cwd-matching, recently-modified jsonl in the slug dir
    session_dir = root / session_slug(cwd)
    if not session_dir.is_dir():
        return None
    now = time.time()

    def mtime_of(p: Path) -> float:
        try:
            return p.stat().st_mtime
        except OSError:
            return 0.0

    candidates = sorted(session_dir.glob("*.jsonl"), key=mtime_of, reverse=True)
    for path in candidates:
        mtime = mtime_of(path)
        if mtime == 0.0 or now - mtime > LIVE_FALLBACK_WINDOW:
            break  # sorted newest-first; older files cannot qualify
        try:
            with path.open("r", encoding="utf-8", errors="replace") as fh:
                for _, raw in zip(range(10), fh):
                    raw = raw.strip()
                    if not raw:
                        continue
                    try:
                        obj = json.loads(raw)
                    except json.JSONDecodeError:
                        continue
                    if isinstance(obj, dict) and obj.get("type") == "session" and obj.get("cwd") == cwd.as_posix():
                        return path.name
        except OSError:
            continue
    return None


# ---------------------------------------------------------------------------
# ranking
# ---------------------------------------------------------------------------


@dataclass
class Hit:
    line_no: int
    role: str
    text: str


@dataclass
class Result:
    session: str
    span: int | None  # None when "-" (partial/degenerate)
    hits: int
    mtime: float
    title: str
    lines: list[Hit]

    @property
    def full(self) -> bool:
        return self.span is not None


def load_cache(cache: Path) -> tuple[dict[str, float], dict[str, list[Turn]]]:
    """Read all shards: recency per session + turns per session."""
    mtimes: dict[str, float] = {}
    turns_by_session: dict[str, list[Turn]] = {}
    for shard in cache.glob("*.t"):
        try:
            shard_stat = shard.stat()
        except OSError:
            continue
        base = shard.stem
        turns: list[Turn] = []
        try:
            with shard.open("r", encoding="utf-8", errors="replace") as fh:
                for raw in fh:
                    parts = raw.rstrip("\n").split("\t", 3)
                    if len(parts) != 4 or parts[0] != base:
                        continue
                    try:
                        line_no = int(parts[1])
                    except ValueError:
                        continue
                    turns.append(Turn(line_no, parts[2], parts[3]))
        except OSError:
            continue
        mtimes[base] = shard_stat.st_mtime
        turns_by_session[base] = turns
    return mtimes, turns_by_session


def rank_sessions(
    mtimes: dict[str, float],
    turns_by_session: dict[str, list[Turn]],
    terms: list[str],
    limit: int,
    peek: int,
    exclude: str | None = None,
) -> list[Result]:
    lowered_terms = [t.lower() for t in terms]

    results: list[Result] = []
    for base, turns in turns_by_session.items():
        if base == exclude:
            continue
        hits: list[Hit] = []
        term_seen: set[int] = set()
        for turn in turns:
            if turn.role not in ("user", "assistant", "title", "summary"):
                continue
            low = turn.text.lower()
            matched = [i for i, t in enumerate(lowered_terms) if t in low]
            if not matched:
                continue
            for i in matched:
                term_seen.add(i)
            hits.append(Hit(turn.line_no, turn.role, turn.text))
        if not hits:
            continue

        full = len(term_seen) == len(lowered_terms)
        span: int | None = None
        if full:
            span = min_span(hits, lowered_terms)
            if span is None:
                full = False  # degenerate; demote

        title = ""
        for turn in turns:
            if turn.role == "title":
                title = turn.text
            elif turn.role == "summary" and not title:
                title = "[summary] " + turn.text
        results.append(
            Result(
                session=base,
                span=span if full else None,
                hits=len(hits),
                mtime=mtimes.get(base, 0.0),
                title=title,
                lines=hits,
            )
        )

    results.sort(key=lambda r: (not r.full, r.span if r.span is not None else 0, -r.hits, -r.mtime))
    ranked = results[:limit]
    for result in ranked:
        result.lines = result.lines[:peek]
    return ranked


def min_span(hits: list[Hit], lowered_terms: list[str]) -> int | None:
    """Smallest line-distance window covering every distinct term."""
    events: list[tuple[int, int]] = []  # (line_no, term_index)
    for hit in hits:
        low = hit.text.lower()
        for i, t in enumerate(lowered_terms):
            if t in low:
                events.append((hit.line_no, i))
    events.sort()
    best: int | None = None
    counts: dict[int, int] = {}
    covered = 0
    lo = 0
    for hi, (line_no, term_i) in enumerate(events):
        counts[term_i] = counts.get(term_i, 0) + 1
        if counts[term_i] == 1:
            covered += 1
        while covered == len(lowered_terms):
            distance = line_no - events[lo][0]
            if best is None or distance < best:
                best = distance
            left_line, left_term = events[lo]
            counts[left_term] -= 1
            if counts[left_term] == 0:
                covered -= 1
            lo += 1
    return best


# ---------------------------------------------------------------------------
# output
# ---------------------------------------------------------------------------


def emit_json(results: list[Result]) -> None:
    payload = {
        "results": [
            {
                "session": r.session,
                "span": r.span if r.span is not None else "-",
                "hits": r.hits,
                "mtime": int(r.mtime),
                "title": r.title,
                "lines": [{"line": h.line_no, "role": h.role, "text": h.text[:SNIPPET_CHARS]} for h in r.lines],
            }
            for r in results
        ]
    }
    print(json.dumps(payload, ensure_ascii=False))


def relative_age(mtime: float) -> str:
    seconds = max(0, int(time.time() - mtime))
    if seconds < 90:
        return f"{seconds}s ago"
    minutes = seconds // 60
    if minutes < 90:
        return f"{minutes}m ago"
    hours = minutes // 60
    if hours < 36:
        return f"{hours}h ago"
    return f"{hours // 24}d ago"


def emit_table(results: list[Result], color: bool) -> None:
    bold = "\033[1m" if color else ""
    dim = "\033[2m" if color else ""
    yellow = "\033[33m" if color else ""
    reset = "\033[0m" if color else ""
    for i, r in enumerate(results):
        if i:
            print()
        print(f"{bold}{r.title}{reset}  {dim}{relative_age(r.mtime)}{reset}")
        print(f"  {dim}{r.session}  hits={r.hits} span={r.span if r.span is not None else '-'}{reset}")
        for hit in r.lines:
            print(f"  {yellow}[{hit.role} {hit.line_no}]{reset} {hit.text[:SNIPPET_CHARS]}")


# ---------------------------------------------------------------------------
# peek: widen a hit window in the raw session file
# ---------------------------------------------------------------------------


def resolve_session_file(root: Path, session: str) -> Path:
    """Accept a path, a base name, or a unique fragment of a base name."""
    direct = Path(session)
    if direct.exists():
        return direct
    exact = [p for p in root.glob("*/*.jsonl") if p.name in (session, f"{session}.jsonl")]
    if len(exact) == 1:
        return exact[0]
    matches = [p for p in root.glob("*/*.jsonl") if session in p.name]
    if len(matches) == 1:
        return matches[0]
    if len(matches) > 1:
        die(f"ambiguous session {session!r}: {len(matches)} matches")
    die(f"no session file matches {session!r}")


def die(message: str) -> None:
    print(f"{PROG}: {message}", file=sys.stderr)
    raise SystemExit(2)


ROLE_LABEL = {"user": "user", "assistant": "agent", "title": "title", "summary": "summary"}


def render_turn(line_no: int, role: str, text: str) -> str:
    """One formatted turn: 'turn N role: text' (text flattened to one line)."""
    return f"turn {line_no} {ROLE_LABEL.get(role, role)}: {text[:PEEK_TURN_CHARS]}"


def cmd_peek(args: argparse.Namespace) -> int:
    """Formatted widening: exactly the turns you point at, nothing else.

    Each rendered line is 'turn N role: text' where N is the 1-based source
    line number (same numbers `sm find --json` reports). Only the requested
    turns render — no neighbors, no extras — unless `-C N` explicitly asks
    for N neighbor turns each side.

    Takes SESSION LINE pairs: `sm peek s1 42 s2 7` renders several sessions
    in one call, each under a '# session.jsonl' header; within one session
    repeated turns are printed once.
    """
    root = sessions_root()
    targets = args.targets
    if not targets or len(targets) % 2:
        die("usage: sm peek SESSION LINE [SESSION LINE...] [-C N]")
    pairs: list[tuple[str, int]] = []
    for i in range(0, len(targets), 2):
        try:
            line = int(targets[i + 1])
        except ValueError:
            die(f"LINE must be an integer, got {targets[i + 1]!r}")
        if line < 1:
            die(f"line numbers are 1-based, got {line}")
        pairs.append((targets[i], line))

    context = max(0, args.context)
    per_session: dict[Path, list[int]] = {}
    for name, line in pairs:
        path = resolve_session_file(root, name)
        per_session.setdefault(path, []).append(line)

    sections: list[tuple[Path, int, list[str]]] = []
    for path, lines in per_session.items():
        try:
            turns = index_session_file(path)
        except OSError as exc:
            die(f"cannot read {path}: {exc}")
        turn_nos = [t.line_no for t in turns]
        wanted = [n for n in lines if n in turn_nos]
        if not wanted and turn_nos:
            # clamp a miss to the nearest turn when it is close
            for line in lines:
                nearest = min(turn_nos, key=lambda n: abs(n - line))
                if abs(nearest - line) <= max(1, context):
                    wanted.append(nearest)
        rendered: list[str] = []
        if context and wanted:
            # -C N = N neighbor *turns* each side of each requested turn
            indices = [i for i, t in enumerate(turns) if t.line_no in wanted]
            neighbor_lines: set[int] = set(wanted)
            for i in indices:
                for j in range(max(0, i - context), min(len(turns), i + context + 1)):
                    neighbor_lines.add(turns[j].line_no)
            for t in turns:
                if t.line_no in neighbor_lines:
                    rendered.append(render_turn(t.line_no, t.role, t.text))
        else:
            for t in turns:
                if t.line_no in wanted:
                    rendered.append(render_turn(t.line_no, t.role, t.text))
        first = lines[0]
        sections.append((path, first, rendered))

    for i, (path, line, rendered) in enumerate(sections):
        if i:
            print()
        print(f"# {path.name}")
        if rendered:
            print("\n".join(rendered))
        else:
            print(f"  (no readable turns near line {line})")
    return 0


# ---------------------------------------------------------------------------
# serve: prewarm daemon
# ---------------------------------------------------------------------------


def daemon_loop() -> None:
    refresh = refresh_seconds()
    cache, root = cache_root(), sessions_root()
    while True:
        try:
            sync_cache(cache, root)
        except OSError:
            pass
        time.sleep(refresh)


def refresh_seconds() -> float:
    try:
        value = float(os.environ.get("OMP_SM_REFRESH") or REFRESH_SECONDS)
    except ValueError:
        print(f"{PROG}: invalid OMP_SM_REFRESH, using {REFRESH_SECONDS}s", file=sys.stderr)
        value = float(REFRESH_SECONDS)
    if value < 1:
        print(f"{PROG}: OMP_SM_REFRESH below 1s, clamping to 1s", file=sys.stderr)
        value = 1.0
    return value


def daemon_cmdline_ok(pid: int) -> bool:
    """True when pid looks like a daemon_loop process (this tool or empty cmdline)."""
    try:
        cmd = Path(f"/proc/{pid}/cmdline").read_bytes().replace(b"\x00", b" ").decode(errors="replace")
    except OSError:
        return False  # vanished: treat as not running
    tokens = cmd.strip().split()
    if not tokens:
        return True  # empty cmdline: keep permissive
    # e.g. "python3 /home/k2/.local/bin/sm serve start" — argv[0] is the interpreter
    return any(Path(t).name in ("sm", "sm.py") for t in tokens[:2])


def is_running(pidfile: Path) -> int | None:
    """Live pid written by this tool (cmdline verified; guards PID reuse)."""
    try:
        pid = int(pidfile.read_text().strip())
        os.kill(pid, 0)
        if not daemon_cmdline_ok(pid):
            return None  # foreign process recycled the pid
        return pid
    except (OSError, ValueError):
        return None


def runtime_dir() -> Path:
    base = os.environ.get("OMP_SM_RUNTIME") or str(cache_root())
    return Path(base) / "daemon"


def stop_daemon(pidfile: Path) -> int | None:
    """Signal a verified daemon pid; return it, or None when not running."""
    pid = is_running(pidfile)
    if pid:
        try:
            os.kill(pid, 15)
        except OSError:
            pass
    pidfile.unlink(missing_ok=True)
    return pid


def cmd_serve(args: argparse.Namespace) -> int:
    runtime = runtime_dir()
    runtime.mkdir(parents=True, exist_ok=True)
    pidfile = runtime / "pid"
    log = runtime / "log"
    cache = cache_root()

    if args.action == "status":
        pid = is_running(pidfile)
        if pid:
            shards = len(list(cache.glob("*.t"))) if cache.is_dir() else 0
            print(f"running (pid {pid})  shards={shards}  cache={cache}")
            return 0
        print("not running")
        return 1

    if args.action == "stop":
        pid = stop_daemon(pidfile)
        print(f"stopped (pid {pid})" if pid else "not running")
        return 0

    if args.action == "restart":
        stop_daemon(pidfile)
        args.action = "start"  # fall through to the start path below

    pid = is_running(pidfile)
    if pid:
        print(f"already running (pid {pid})")
        return 0
    pidfile.unlink(missing_ok=True)

    if args.action == "foreground":
        daemon_loop()

    # detached start: fork + setsid, stdio to devnull then the log
    if hasattr(os, "fork"):
        pid = os.fork()
        if pid == 0:
            os.setsid()
            fd = os.open(os.devnull, os.O_RDWR)
            os.dup2(fd, 0)
            os.dup2(fd, 1)
            os.dup2(fd, 2)
            if fd > 2:
                os.close(fd)
            log_fd = os.open(log, os.O_WRONLY | os.O_CREAT | os.O_APPEND)
            os.dup2(log_fd, 1)
            os.dup2(log_fd, 2)
            pidfile.write_text(str(os.getpid()))
            try:
                daemon_loop()
            finally:
                pidfile.unlink(missing_ok=True)
            raise SystemExit(0)
        time.sleep(0.3)
        pid = is_running(pidfile)
        if pid:
            print(f"started (pid {pid}), refresh {refresh_seconds():g}s, cache {cache}")
            return 0
        die(f"failed to start; see {log}")
    return 0


# ---------------------------------------------------------------------------
# entry
# ---------------------------------------------------------------------------


def add_find_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("terms", nargs="+", metavar="TERM", help="search terms (AND-ranked, case-insensitive)")
    parser.add_argument("-n", type=int, default=DEFAULT_LIMIT, metavar="N", help=f"max sessions (default {DEFAULT_LIMIT})")
    parser.add_argument("-k", type=int, default=DEFAULT_PEEK, metavar="N", help=f"peek lines per session (default {DEFAULT_PEEK})")
    parser.add_argument("--json", action="store_true", help="JSON output (default when stdout is not a tty)")
    parser.add_argument("--table", action="store_true", help="human table output even when piped")
    parser.add_argument("--no-color", action="store_true", help="plain table output")
    parser.add_argument("--self", action="store_true", help="include the current (echoing) session")
    parser.add_argument("--rebuild", action="store_true", help="force full cache rebuild before searching")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog=PROG, description=__doc__.splitlines()[0], epilog="search omp session history")
    parser.add_argument("--version", action="version", version=f"{PROG} {VERSION}")
    sub = parser.add_subparsers(dest="command", required=True)

    p_find = sub.add_parser("find", help="search session history, ranked")
    add_find_args(p_find)
    p_find.set_defaults(func=cmd_find)

    p_peek = sub.add_parser("peek", help="print formatted turns around matched line numbers")
    p_peek.add_argument("targets", nargs="+", metavar="TARGET",
                        help="SESSION LINE pairs, e.g. sm peek sessA 42 sessB 7")
    p_peek.add_argument("-C", "--context", type=int, default=0, metavar="N",
                        help="add N neighbor turns each side (default 0: requested turns only)")
    p_peek.set_defaults(func=cmd_peek)

    p_serve = sub.add_parser("serve", help="prewarm/refresh the shard cache")
    p_serve.add_argument("action", nargs="?", default="start", choices=["start", "stop", "status", "restart", "foreground"])
    p_serve.set_defaults(func=cmd_serve)

    p_index = sub.add_parser("index", help="cache control")
    p_index.add_argument("--rebuild", action="store_true", help="force full rebuild")
    p_index.add_argument("--status", action="store_true", help="show shard count and cache path")
    p_index.set_defaults(func=cmd_index)

    return parser


def cmd_find(args: argparse.Namespace) -> int:
    cache, root = cache_root(), sessions_root()
    if not root.is_dir():
        die(f"no session store at {root}")
    exclude = None if args.self else live_session_base(root, Path.cwd())
    if args.rebuild:
        indexed = sync_cache(cache, root, force=True)  # never rmtree: daemon pidfile lives here
        print(f"rebuilt {indexed} session(s)", file=sys.stderr)
    else:
        indexed = sync_cache(cache, root)
        if indexed:
            print(f"indexed {indexed} session(s)", file=sys.stderr)
    mtimes, turns_by_session = load_cache(cache)
    results = rank_sessions(mtimes, turns_by_session, args.terms, args.n, args.k, exclude)
    json_mode = args.json or (not sys.stdout.isatty() and not args.table)
    if json_mode:
        emit_json(results)
    elif results:
        emit_table(results, color=not args.no_color)
    else:
        print("nothing in history matches")
    return 0


def cmd_index(args: argparse.Namespace) -> int:
    cache, root = cache_root(), sessions_root()
    if args.status:
        shards = len(list(cache.glob("*.t"))) if cache.is_dir() else 0
        print(f"cache={cache}  shards={shards}")
        return 0
    if not root.is_dir():
        die(f"no session store at {root}")
    if args.rebuild:
        indexed = sync_cache(cache, root, force=True)
        print(f"rebuilt {indexed} session(s), cache={cache}")
    else:
        indexed = sync_cache(cache, root)
        print(f"indexed {indexed} session(s), cache={cache}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return int(args.func(args) or 0)


if __name__ == "__main__":
    raise SystemExit(main())

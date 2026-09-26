#!/usr/bin/env python3
"""Tests for sm.py — fixture-driven, stdlib unittest, zero deps.

Run:  python3 tests/test_sm.py
"""

from __future__ import annotations

import json
import argparse
import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import sm  # noqa: E402


def msg(role: str, text: str, line_extra: dict | None = None) -> str:
    """A session message line in omp's real shape."""
    content = [{"type": "text", "text": text}] if text else [{"type": "thinking", "thinking": "hm"}]
    return json.dumps(
        {"type": "message", "id": "x", "parentId": None, "timestamp": 0,
         "message": {"role": role, "content": content, "attribution": role}, **(line_extra or {})}
    )


def line(obj: dict) -> str:
    return json.dumps(obj)


class StoreBuilder:
    """Builds a fake session store: add(slug, base, [jsonl lines])."""

    def __init__(self, root: Path):
        self.root = root

    def add(self, slug: str, base: str, lines: list[str], mtime: float | None = None) -> Path:
        d = self.root / slug
        d.mkdir(parents=True, exist_ok=True)
        f = d / base
        f.write_text("\n".join(lines) + "\n", encoding="utf-8")
        if mtime is not None:
            os.utime(f, (mtime, mtime))
        return f


class SmTestBase(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name) / "sessions"
        self.cache = Path(self.tmp.name) / "cache"
        self.store = StoreBuilder(self.root)
        # isolate from the real environment
        self._env = {k: os.environ.pop(k) for k in ("OMP_SM_SESSIONS", "OMP_SM_CACHE", "OMP_SM_RUNTIME") if k in os.environ}

    def tearDown(self) -> None:
        os.environ.update(self._env)
        self.tmp.cleanup()

    def sync(self, force: bool = False) -> int:
        return sm.sync_cache(self.cache, self.root, force=force)


class IndexTests(SmTestBase):
    def test_user_and_assistant_text_indexed(self) -> None:
        self.store.add("proj", "a.jsonl", [
            line({"type": "session", "id": "a", "cwd": "/p"}),
            msg("user", "fix the login bug"),
            msg("assistant", "I will fix login now"),
        ])
        self.sync()
        shard = self.cache / "a.jsonl.t"
        self.assertTrue(shard.exists())
        rows = shard.read_text().splitlines()
        self.assertEqual(2, len(rows))
        self.assertIn("fix the login bug", rows[0])

    def test_tool_thinking_title_compaction_classification(self) -> None:
        self.store.add("proj", "a.jsonl", [
            line({"type": "title", "title": "Auth work"}),
            msg("assistant", ""),  # thinking-only turn -> dropped
            line({"type": "message", "message": {"role": "toolResult", "content": [{"type": "text", "text": "tool output login"}]}}),
            line({"type": "compaction", "summary": "earlier we fixed login"}),
        ])
        self.sync()
        rows = (self.cache / "a.jsonl.t").read_text().splitlines()
        roles = [r.split("\t")[2] for r in rows]
        self.assertEqual(["title", "summary"], roles)

    def test_message_key_order_does_not_matter(self) -> None:
        # content blocks with keys in the "wrong" order; parser must not care
        weird = json.dumps({
            "message": {"content": [{"text": "orderless login", "type": "text"}], "role": "user"},
            "type": "message",
        })
        self.store.add("proj", "a.jsonl", [weird])
        self.sync()
        rows = (self.cache / "a.jsonl.t").read_text().splitlines()
        self.assertEqual(1, len(rows))
        self.assertIn("orderless login", rows[0])

    def test_pasted_json_in_chat_is_not_misclassified(self) -> None:
        # the text *contains* what used to be lethal substrings for the awk tool
        pasted = 'she wrote {"role":"user","content":[{"type":"text","text":"login"}]} in the doc'
        self.store.add("proj", "a.jsonl", [msg("assistant", pasted)])
        self.sync()
        rows = (self.cache / "a.jsonl.t").read_text().splitlines()
        self.assertEqual(1, len(rows))
        self.assertTrue(rows[0].split("\t")[2] == "assistant")

    def test_unicode_and_newlines_survive(self) -> None:
        self.store.add("proj", "a.jsonl", [msg("user", "café ☕ plan\ntwo")])
        self.sync()
        rows = (self.cache / "a.jsonl.t").read_text().splitlines()
        self.assertEqual(1, len(rows))
        self.assertEqual("café ☕ plan two", rows[0].split("\t")[3])

    def test_tab_in_text_is_flattened(self) -> None:
        self.store.add("proj", "a.jsonl", [msg("user", "col1\tcol2")])
        self.sync()
        rows = (self.cache / "a.jsonl.t").read_text().splitlines()
        self.assertEqual(4, len(rows[0].split("\t")))  # still one field

    def test_turn_truncated_to_max_chars(self) -> None:
        self.store.add("proj", "a.jsonl", [msg("user", "x" * 5000)])
        self.sync()
        rows = (self.cache / "a.jsonl.t").read_text().splitlines()
        self.assertEqual(sm.MAX_TURN_CHARS, len(rows[0].split("\t")[3]))

    def test_malformed_lines_skipped(self) -> None:
        self.store.add("proj", "a.jsonl", ['{"type": "message", "truncated', msg("user", "fine")])
        self.sync()
        rows = (self.cache / "a.jsonl.t").read_text().splitlines()
        self.assertEqual(1, len(rows))

    def test_incremental_sync_skips_unchanged(self) -> None:
        self.store.add("proj", "a.jsonl", [msg("user", "one")])
        self.assertEqual(1, self.sync())
        self.assertEqual(0, self.sync())  # mtime unchanged
        # touch the source -> reindex
        time.sleep(0.01)
        (self.root / "proj" / "a.jsonl").write_text(msg("user", "two") + "\n", encoding="utf-8")
        self.assertEqual(1, self.sync())

    def test_evicted_shard_removed(self) -> None:
        f = self.store.add("proj", "a.jsonl", [msg("user", "one")])
        self.sync()
        self.assertTrue((self.cache / "a.jsonl.t").exists())
        f.unlink()
        self.sync()
        self.assertFalse((self.cache / "a.jsonl.t").exists())


class RankTests(SmTestBase):
    def seed(self) -> None:
        self.store.add("proj", "full.jsonl", [
            line({"type": "title", "title": "Full session"}),
            msg("user", "let's fix the camelCase parser"),
            msg("assistant", "starting with camel Case handling"),
            msg("user", "also the router"),
        ], mtime=time.time() - 100)
        self.store.add("proj", "partial.jsonl", [
            msg("user", "only camelCase here"),
        ], mtime=time.time() - 50)
        # both terms present but far apart: wider span, older mtime
        self.store.add("proj", "old-full.jsonl", [
            msg("user", "camelCase"),
            msg("assistant", "filler"),
            msg("assistant", "filler"),
            msg("assistant", "and router"),
        ], mtime=time.time() - 99999)
        self.sync()

    def load(self, terms: list[str], **kw) -> list[sm.Result]:
        mtimes, turns = sm.load_cache(self.cache)
        kw.setdefault("limit", 10)
        kw.setdefault("peek", 3)
        return sm.rank_sessions(mtimes, turns, terms, **kw)

    def test_full_beats_partial(self) -> None:
        self.seed()
        results = self.load(["camelcase", "router"])
        self.assertEqual({"full.jsonl", "old-full.jsonl"}, {results[0].session, results[1].session})
        self.assertEqual("partial.jsonl", results[2].session)
        self.assertTrue(results[0].full)
        self.assertFalse(results[2].full)

    def test_tighter_span_wins_within_full(self) -> None:
        self.seed()
        results = self.load(["camelcase", "router"])
        self.assertLess(results[0].span, results[1].span)

    def test_recency_tiebreak_by_session_file_mtime(self) -> None:
        # same span shape; older file must rank last
        self.store.add("proj", "x1.jsonl", [msg("user", "alpha"), msg("assistant", "beta")], mtime=time.time() - 10)
        self.store.add("proj", "x2.jsonl", [msg("user", "alpha"), msg("assistant", "beta")], mtime=time.time() - 9999)
        self.sync()
        results = self.load(["alpha", "beta"])
        self.assertEqual(["x1.jsonl", "x2.jsonl"], [r.session for r in results])

    def test_camelcase_split_terms_match(self) -> None:
        self.seed()
        results = self.load(["camel", "case"])
        self.assertEqual("full.jsonl", results[0].session)

    def test_no_match_empty(self) -> None:
        self.seed()
        self.assertEqual([], self.load(["nonexistent"]))

    def test_limit_and_peek(self) -> None:
        self.seed()
        results = self.load(["camelcase"], limit=1, peek=1)
        self.assertEqual(1, len(results))
        self.assertEqual(1, len(results[0].lines))

    def test_exclude_live_session(self) -> None:
        self.seed()
        mtimes, turns = sm.load_cache(self.cache)
        results = sm.rank_sessions(mtimes, turns, ["camelcase"], 10, 3, exclude="full.jsonl")
        self.assertNotIn("full.jsonl", [r.session for r in results])

    def test_json_contract(self) -> None:
        self.seed()
        results = self.load(["camelcase", "router"])
        import io
        from contextlib import redirect_stdout
        buf = io.StringIO()
        with redirect_stdout(buf):
            sm.emit_json(results)
        payload = json.loads(buf.getvalue())
        r0 = payload["results"][0]
        for key in ("session", "span", "hits", "mtime", "title", "lines"):
            self.assertIn(key, r0)
        self.assertIsInstance(r0["lines"], list)
        self.assertIn("line", r0["lines"][0])
        # partial session carries "-" span per the skill's documented contract
        partial = next(r for r in payload["results"] if r["session"] == "partial.jsonl")
        self.assertEqual("-", partial["span"])


class PeekTests(SmTestBase):
    def setUp(self) -> None:
        super().setUp()
        os.environ["OMP_SM_SESSIONS"] = str(self.root)

    def test_resolve_by_fragment(self) -> None:
        self.store.add("proj", "2026-01-01T00-00-00_aa-uuid.jsonl", [msg("user", "x")])
        path = sm.resolve_session_file(self.root, "aa-uuid")
        self.assertTrue(path.name.endswith("aa-uuid.jsonl"))

    def test_resolve_ambiguous_dies(self) -> None:
        self.store.add("proj", "abc.jsonl", [msg("user", "x")])
        self.store.add("proj2", "abd.jsonl", [msg("user", "x")])
        with self.assertRaises(SystemExit):
            sm.resolve_session_file(self.root, "ab")

    def test_render_turn_labels_role_without_arrow(self) -> None:
        self.assertEqual("turn 42 agent: fixing the bug", sm.render_turn(42, "assistant", "fixing the bug"))
        self.assertEqual("turn 40 user: please fix", sm.render_turn(40, "user", "please fix"))

    def test_cmd_peek_renders_only_requested_turns(self) -> None:
        self.store.add("proj", "a.jsonl", [
            msg("user", "fix the login bug"),              # line 1
            msg("assistant", "on it"),                     # line 2: filler
            msg("assistant", "I fixed login in auth.py"),  # line 3: the hit
            msg("user", "unrelated chatter"),              # line 4
            msg("user", "more chatter"),                   # line 5
        ])
        import io
        from contextlib import redirect_stdout
        ns = argparse.Namespace(targets=["a.jsonl", "3"], context=0, func=None)
        buf = io.StringIO()
        with redirect_stdout(buf):
            sm.cmd_peek(ns)
        out = buf.getvalue()
        self.assertEqual("# a.jsonl\nturn 3 agent: I fixed login in auth.py\n", out)

    def test_cmd_peek_context_opt_in_adds_neighbors(self) -> None:
        self.store.add("proj", "a.jsonl", [
            msg("user", "one"), msg("assistant", "two"), msg("user", "three"),
        ])
        import io
        from contextlib import redirect_stdout
        ns = argparse.Namespace(targets=["a.jsonl", "3"], context=1, func=None)
        buf = io.StringIO()
        with redirect_stdout(buf):
            sm.cmd_peek(ns)
        out = buf.getvalue()
        self.assertIn("turn 3 user: three", out)
        self.assertIn("turn 2 agent: two", out)

    def test_cmd_peek_user_turn_only_when_itself_a_hit(self) -> None:
        self.store.add("proj", "a.jsonl", [
            msg("user", "fix the login bug"),          # line 1
            msg("assistant", "fixed the login bug"),   # line 2
        ])
        import io
        from contextlib import redirect_stdout
        # widening the agent hit does NOT drag in the user turn
        ns = argparse.Namespace(targets=["a.jsonl", "2"], context=0, func=None)
        buf = io.StringIO()
        with redirect_stdout(buf):
            sm.cmd_peek(ns)
        self.assertNotIn("fix the login bug", buf.getvalue())
        # but peeking the user turn's own line renders it
        ns2 = argparse.Namespace(targets=["a.jsonl", "1"], context=0, func=None)
        buf2 = io.StringIO()
        with redirect_stdout(buf2):
            sm.cmd_peek(ns2)
        self.assertIn("turn 1 user: fix the login bug", buf2.getvalue())

    def test_cmd_peek_renders_turns_not_raw_jsonl(self) -> None:
        self.store.add("proj", "a.jsonl", [
            line({"type": "session", "id": "a", "cwd": "/p"}),
            msg("user", "question about the login bug"),
            msg("assistant", "thinking-only turn dropped"),  # becomes a turn
        ])
        import io
        from contextlib import redirect_stdout
        ns = argparse.Namespace(targets=["a.jsonl", "2"], context=0, func=None)
        buf = io.StringIO()
        with redirect_stdout(buf):
            sm.cmd_peek(ns)
        out = buf.getvalue()
        self.assertIn("# a.jsonl", out)
        self.assertIn("turn 2 user: question about the login bug", out)
        self.assertNotIn('"type":"message"', out)
        self.assertNotIn('"parentId"', out)

    def test_cmd_peek_multi_session_headers_and_merge(self) -> None:
        self.store.add("proj", "a.jsonl", [msg("user", f"turn {n} login") for n in range(1, 6)])
        self.store.add("proj", "b.jsonl", [msg("user", "other session note")])
        import io
        from contextlib import redirect_stdout
        ns = argparse.Namespace(targets=["a.jsonl", "2", "a.jsonl", "4", "b.jsonl", "1"], context=0, func=None)
        buf = io.StringIO()
        with redirect_stdout(buf):
            sm.cmd_peek(ns)
        out = buf.getvalue()
        # same-session pairs merged under one header; only requested turns
        self.assertEqual(1, out.count("# a.jsonl"))
        self.assertEqual(1, out.count("# b.jsonl"))
        a_section = out.split("# b.jsonl")[0]
        self.assertIn("turn 2 user: turn 2 login", a_section)
        self.assertIn("turn 4 user: turn 4 login", a_section)
        self.assertNotIn("turn 1", a_section)  # neighbors not injected
        self.assertNotIn("turn 3", a_section)
        self.assertNotIn("turn 5", a_section)
        self.assertEqual(2, len([l for l in a_section.splitlines() if "turn " in l]))

    def test_cmd_peek_odd_targets_die(self) -> None:
        import io
        from contextlib import redirect_stdout, redirect_stderr
        ns = argparse.Namespace(targets=["a.jsonl"], context=2, func=None)
        with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit):
                sm.cmd_peek(ns)


class ShardIntegrityTests(SmTestBase):
    def test_shard_lines_reference_real_line_numbers(self) -> None:
        lines = [line({"type": "session", "id": "a", "cwd": "/p"}), msg("user", "needle in haystack")]
        self.store.add("proj", "a.jsonl", lines)
        self.sync()
        row = (self.cache / "a.jsonl.t").read_text().splitlines()[0]
        line_no = int(row.split("\t")[1])
        self.assertIn("needle", lines[line_no - 1])  # peek relies on this


class SlugAndLiveTests(SmTestBase):
    def test_session_slug_matches_omp_rule(self) -> None:
        home = Path(os.path.expanduser("~"))
        cases = {
            home / ".workspaces" / "agent": "-.workspaces-agent",
            home: "-",
            Path("/tmp") / "x": "-tmp-x",
            Path("/opt") / "somewhere": "--opt-somewhere--",
        }
        for cwd, expected in cases.items():
            self.assertEqual(expected, sm.session_slug(cwd), cwd)

    def test_live_fallback_finds_recent_cwd_match(self) -> None:
        cwd = Path("/p/fake")
        slug = sm.session_slug(cwd)
        lines = [line({"type": "session", "id": "z", "cwd": cwd.as_posix()}), msg("user", "hello")]
        self.store.add(slug, "live.jsonl", lines, mtime=time.time())
        self.store.add(slug, "stale.jsonl", [line({"type": "session", "id": "y", "cwd": cwd.as_posix()})],
                       mtime=time.time() - 9999)
        # no /proc ancestor holds these fds -> fallback path
        self.assertEqual("live.jsonl", sm.live_session_base(self.root, cwd))

    def test_live_fallback_ignores_old_matches(self) -> None:
        cwd = Path("/p/fake")
        slug = sm.session_slug(cwd)
        self.store.add(slug, "old.jsonl", [line({"type": "session", "id": "y", "cwd": cwd.as_posix()})],
                       mtime=time.time() - 9999)
        self.assertIsNone(sm.live_session_base(self.root, cwd))


class RobustnessTests(SmTestBase):
    def test_corrupt_shard_line_skipped_not_fatal(self) -> None:
        self.store.add("proj", "a.jsonl", [msg("user", "needle one")])
        self.sync()
        shard = self.cache / "a.jsonl.t"
        shard.write_text("a.jsonl\tX\tuser\tbroken\ngarbage-line\n" + shard.read_text(), encoding="utf-8")
        mtimes, turns = sm.load_cache(self.cache)
        self.assertEqual(["needle one"], [t.text for t in turns["a.jsonl"]])

    def test_refresh_seconds_validates(self) -> None:
        os.environ["OMP_SM_REFRESH"] = "abc"
        self.assertEqual(float(sm.REFRESH_SECONDS), sm.refresh_seconds())
        os.environ["OMP_SM_REFRESH"] = "0"
        self.assertEqual(1.0, sm.refresh_seconds())
        os.environ["OMP_SM_REFRESH"] = "2.5"
        self.assertEqual(2.5, sm.refresh_seconds())

    def test_runtime_dir_accepts_env_string(self) -> None:
        os.environ["OMP_SM_RUNTIME"] = "/tmp/rtest-sm"
        self.assertEqual(Path("/tmp/rtest-sm/daemon"), sm.runtime_dir())

    def test_rebuild_does_not_delete_runtime(self) -> None:
        # daemon pidfile lives under the cache by default; --rebuild must keep it
        runtime = sm.runtime_dir()
        runtime.mkdir(parents=True, exist_ok=True)
        (runtime / "pid").write_text("999999\n")
        self.store.add("proj", "a.jsonl", [msg("user", "needle")])
        self.sync(force=True)
        self.assertTrue((runtime / "pid").exists())

    def test_refresh_seconds_validates(self) -> None:
        os.environ["OMP_SM_REFRESH"] = "abc"
        self.assertEqual(float(sm.REFRESH_SECONDS), sm.refresh_seconds())
        os.environ["OMP_SM_REFRESH"] = "0"
        self.assertEqual(1.0, sm.refresh_seconds())
        os.environ["OMP_SM_REFRESH"] = "2.5"
        self.assertEqual(2.5, sm.refresh_seconds())
        for key in ("OMP_SM_REFRESH",):
            os.environ.pop(key, None)
        self.assertEqual(float(sm.REFRESH_SECONDS), sm.refresh_seconds())

    def test_pidfile_pid_reuse_rejected(self) -> None:
        # pid of a live foreign process in the pidfile -> treated as not running
        pidfile = self.cache / "pid"
        pidfile.parent.mkdir(parents=True, exist_ok=True)
        pidfile.write_text("1\n")  # pid 1: alive, cmdline is init, not a daemon
        self.assertIsNone(sm.is_running(pidfile))
        pidfile.write_text("not-a-pid\n")
        self.assertIsNone(sm.is_running(pidfile))

    def test_concurrent_sync_is_safe(self) -> None:
        # 4 processes racing on a cold tiny cache; all must exit 0
        for i in range(3):
            slug = f"p{i}"
            self.store.add(slug, f"s{i}.jsonl", [msg("user", f"needle {i}")])
        script = (
            "import sys; from pathlib import Path; sys.path.insert(0, %r); import sm; "
            "sm.sync_cache(Path(%r), Path(%r))"
            % (str(Path(sm.__file__).parent), str(self.cache), str(self.root))
        )
        procs = [
            subprocess.Popen(
                [sys.executable, "-c", script],
                stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
            for _ in range(4)
        ]
        for proc in procs:
            _, err = proc.communicate(timeout=60)
            self.assertEqual(0, proc.returncode, err.decode())


if __name__ == "__main__":
    unittest.main(verbosity=2)

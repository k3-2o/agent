#!/usr/bin/env bash
# compare.sh — side-by-side validation of tools/sm/sm.py vs the legacy
# skills/session-memory/bin/session-find on the real store.
#
# Usage: bash compare.sh TERM [TERM...]
set -uo pipefail

SM_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SM="$SM_DIR/sm.py"
OLD="/home/k2/.workspaces/agent/skills/session-memory/bin/session-find"

TERMS=("$@")
((${#TERMS[@]})) || {
    echo "usage: compare.sh TERM [TERM...]" >&2
    exit 2
}

# fresh caches on both sides so neither inherits stale shards
python3 "$SM" index --rebuild >/dev/null 2>&1
OMP_SM_CACHE="${XDG_RUNTIME_DIR:-/tmp}/omp-sm-legacy" "$OLD" --rebuild >/dev/null 2>&1 || true

# JSON from the new tool (piped => json by default)
NEW_JSON=$(python3 "$SM" find --json -n 10 -k 3 "${TERMS[@]}" 2>/dev/null)
# table from the legacy tool
OLD_TXT=$(OMP_SM_CACHE="${XDG_RUNTIME_DIR:-/tmp}/omp-sm-legacy" "$OLD" --json -n 10 -k 3 "${TERMS[@]}" 2>/dev/null)

python3 - "$NEW_JSON" "$OLD_TXT" <<'PY'
import json, sys

def parse_new(raw):
    try:
        return {r["session"]: r for r in json.loads(raw).get("results", [])}
    except json.JSONDecodeError:
        return {}

def parse_old(raw):
    # legacy emit_json is one big line; fallback: nothing
    try:
        return {r["session"]: r for r in json.loads(raw).get("results", [])}
    except (json.JSONDecodeError, AttributeError):
        return {}

new, old = parse_new(sys.argv[1]), parse_old(sys.argv[2])
if not old:
    print("legacy tool produced no parseable JSON (table mode?) — dumping raw head:")
    print(sys.argv[2][:400])
    sys.exit(0)

ns, os_ = set(new), set(old)
print(f"sessions: new={len(ns)} old={len(os_)}")
print(f"only new: {sorted(ns - os_)[:3]}")
print(f"only old: {sorted(os_ - ns)[:3]}")
overlap = ns & os_
span_diff = [s for s in overlap if str(new[s]["span"]) != str(old[s]["span"])]
print(f"span mismatches: {len(span_diff)} {span_diff[:3]}")
hit_diff = [s for s in overlap if abs(new[s]["hits"] - old[s]["hits"]) > max(2, 0.1 * old[s]["hits"])]
print(f"hit-count mismatches (>10%): {len(hit_diff)} {hit_diff[:3]}")
order_new = [s for s, _ in sorted(new.items(), key=lambda kv: (-kv[1]['hits']))]
print("top3 new:", [s[:36] for s in list(new)[:3]])
print("top3 old:", [s[:36] for s in list(old)[:3]])
PY

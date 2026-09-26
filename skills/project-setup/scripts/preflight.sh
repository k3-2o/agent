#!/usr/bin/env bash
# preflight.sh — Check that required tooling is available before project setup
set -euo pipefail

MISSING=()

command -v just >/dev/null 2>&1 || MISSING+=("just")
command -v git >/dev/null 2>&1 || MISSING+=("git")

if [ ${#MISSING[@]} -gt 0 ]; then
    echo "Missing required tools: ${MISSING[*]}"
    exit 1
fi

echo "Preflight OK: just, git"

---
name: adversarial-audit
description: "Adversarial three-leg code audit: hunt bugs and vulnerabilities in a forensic read, fix them clean, get advisory tooling picks. Use when reviewing a codebase before a merge or release, enforcing quality standards, cleaning up AI-generated code, hardening security-sensitive paths, or refactoring for long-term maintainability."
---

# Adversarial Audit

This is a hunt, not a review: assume a competent adversary planted subtle bugs in this codebase. "No findings" is a conclusion you must have proven, not a mood you reached.

Three legs: Leg 1 finds bugs, Leg 2 fixes them clean, Leg 3 (advisory) recommends tooling. This file routes; the references hold the procedures. Read the leg's reference at the start of that leg and follow it exactly.

## Pipeline

    Phase 0     Orientation: file inventory + connection map, before any reading
    Phase 1     Discovery: Leg 1 audits (read-only), then prioritize findings
    Phase 1.5   Human review gate: STOP; Leg 2 and Leg 3 require explicit consent
    Phase 2     Remediation: Leg 2 fixes findings through its gated procedure
    Phase 3     Advisory: Leg 3 recommends tools, after remediation, on request
    End         Completion accounting: reconcile everything against the inventory

## State: AUDIT-FINDINGS.md

All findings, the inventory, and the accounting live in `.agents/AUDIT-FINDINGS.md` at the repo root. Create `.agents/` if it doesn't exist; if it isn't git-ignored, add `.agents/` to `.gitignore`. Sections:

- Status block: baseline commit + test counts, progress (N/M fixed), current gate
- Phase 0 inventory: every file with a one-line responsibility; every cross-file connection
- Phase 1 findings: grouped by severity (blocker / concerning / minor); each finding has an ID (`[A-N]`), file:line, what it is, status (`pending`, `fixed → verified`, `escalated`, `invalid`)
- Completion accounting: file, finding, thread, and dismissal reconciliation

Update statuses as you go.

## Phase 0: Orientation

Read [references/adversarial-audit.md](references/adversarial-audit.md), Phase 0 section. List every file with a one-line responsibility; map what imports what, what calls what, what state crosses boundaries; map every trust boundary (where untrusted input enters: HTTP, files, env, IPC, CLI). No scoping: every file gets the full treatment. Rank the inventory by attacker reachability; audit in that order. Write the inventory to `AUDIT-FINDINGS.md` before Phase 1 starts; it is the artifact the completion accounting reconciles against.

## Phase 1: Discovery (read-only)

1. Baseline: `git log --oneline -1`, run the test suite, record both in `AUDIT-FINDINGS.md`.
2. Git archaeology: skim `git log` for reverted commits, fix commits, and the most recently changed files. Reverts are confessions that a bug class exists; the newest code is the least battle-tested. They set audit priority.
3. Read [references/adversarial-audit.md](references/adversarial-audit.md) in full: Rule Zero, the bias counter-table, the 9 axes, the arsenal, the advance-gate, the dismissal review, the attack step, the refinement pass, the empirical check, the completion accounting.
4. Audit every file in reachability rank, window by window, all 9 axes per window; judge each arsenal candidate as you pass it.
5. Write surviving findings to `AUDIT-FINDINGS.md` with IDs `[A-N]`, file, lines, reasoning.
6. Severity rubric: blocker = exploitable from a trust boundary, few preconditions, large blast radius. Concerning = real defect, hard to reach or contained. Minor = smell, dead code, style. Within a severity: logic bug > dead code > smell > style. Renumber by priority.

No file is modified in this phase.

## Phase 1.5: Human review gate

Stop. Nothing is fixed and nothing is advised without explicit consent.

- Report in chat: severity rollup (blockers / concerning / minor); one line per finding (file:line, what, why); confidence per finding (verified / plausible / theoretical); which fixes are low-risk and which change behavior.
- Ask: remediate (Leg 2)? stop here? advisory only (Leg 3)?
- Yes → Phase 2. No → touch nothing. No answer or ambiguity → stop and wait.

## Phase 2: Remediation

Read [references/human-maintainability.md](references/human-maintainability.md) in full and follow its 7-phase procedure per finding, in priority order: understand, read, write, verify, self-review, commit, diff re-scan. Update the finding status and the status block after each finding.

Convergence guards:

- Max 5 cycles (1 initial + 4 re-scans)
- Same finding in two consecutive scans → escalate to human
- A fix that reverts a previous fix → flag for human
- Cross-file or critical re-scan issue → full Phase 1 re-run, append findings, re-enter Phase 2

## Phase 3: Advisory

On request only. Read [references/codebase-intelligence.md](references/codebase-intelligence.md); recommend tools matching the project's language and size; the user decides whether to run them.

## Completion accounting

Reconcile against the Phase 0 inventory into `AUDIT-FINDINGS.md`:

- Every file: audited in full; any file not fully audited means the audit is not done
- Every finding: fixed (commit hash + evidence), escalated (reason), or invalid (reason); no skipped findings
- Every trust-boundary entry point: audited, with a verdict; an entry point with no verdict is an open door nobody checked
- Every cross-file thread: traced to the contract, or dismissed with reason
- Every dismissed candidate: confirmed with reason, or reinstated

Gap found → return to it, apply the procedure, account again. Report only when the accounting balances.

## When to run what

| Scenario | Run |
|----------|-----|
| Full audit / after AI code / before handoff | 0 → 1 → 1.5 → 2 → 3 → accounting |
| Bug or vulnerability sweep | 0 → 1 → accounting |
| Pre-commit review (targeted files) | 0 → 1 (targeted) → accounting |
| Legacy cleanup (smells, not bugs) | 0 → 2 (known smells first) → accounting |

Leg 2 and Leg 3 always pass the Phase 1.5 gate first.

## References

| File | Read when |
|------|-----------|
| [references/adversarial-audit.md](references/adversarial-audit.md) | Phase 0 and Phase 1, start of leg |
| [references/human-maintainability.md](references/human-maintainability.md) | Phase 2, start of leg |
| [references/codebase-intelligence.md](references/codebase-intelligence.md) | Phase 3, tool options |

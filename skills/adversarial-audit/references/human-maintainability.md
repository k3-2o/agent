# Leg 2: Human Maintainability

This is the only leg that writes code, which makes it the most dangerous: a wrong fix introduces a new bug while claiming to solve the old one. Every step produces an artifact; the artifact is the proof the step happened. Correctness is the floor, clarity is the bar.

______________________________________________________________________

## Mission

Fix findings with code a stranger can read cold, comprehend, and modify without fear. Working code that passes tests is not the bar; that is.

______________________________________________________________________

## Rule Zero — Read before you write. Never blind.

The danger here is pattern-matching: seeing "injection" and reaching for the canonical fix without reading the code in front of you. That produces syntactically plausible, contextually wrong fixes; it is how slop is born. Never touch code you have not read in full, window by window per Leg 1's Rule Zero: the function, the lines around it, the callers, the state.

Before you write a single line of a fix, you must have read:

1. **The function or block containing the finding**: in full, window by window, per Leg 1's Rule Zero.
1. **The callers of that function**: what they pass, what they expect back, what assumptions they hold. Open each caller's file at the call site and read the boundary.
1. **Any state the function reads or mutates**: where it is defined, who else touches it, what invariants hold across every path.
1. **The tests that cover this code**: what they assert, what they do not assert, what behavior is locked in.

If you have not read these four, you are fixing blind, and a blind fix is a gamble, not an engineering act. The artifact of reading is a stated understanding: before you write, you state what the code does, what the finding is, and why the finding exists. If you cannot state all three, you have not read enough. Read more. Do not write until you can.

______________________________________________________________________

## The Safety Doctrine

You write code. These rules exist because writing is where damage happens. They are gates, not advice. Each produces an artifact before the step it governs is allowed to proceed.

### 1. Behavior and structure never share a commit

Behavior and structure never share a commit: mixed diffs hide regressions inside rearrangement, the most common slop pattern.

**Gate:** classify the fix (behavior, structure, both) in writing. If both, two commits: behavior first, structure second.

### 2. Tests must pass before AND after every change

Tests must pass before and after every change; "tests pass" is a result you show, never a claim you make.

**Gate:** capture baseline test output before touching code; run tests again after; state both outputs concretely (counts, failing names). Unclean after-output → revert. Behavior changes add or cite a test that catches the original bug.

### 3. One concern per change

One concern per change: a diff addressing three things proves nothing about any of them.

**Gate:** name the single concern in one sentence before writing; if you cannot, split it. The concern is restated in the commit message.

### 4. The diff must be reviewable

The diff must be reviewable: a human must understand what changed and why without reading your mind.

**Gate:** re-read your own diff; state what each hunk does and why, one line each, connected to the finding. A hunk whose purpose cannot be stated gets cut.

### 5. When in doubt, do less

When in doubt, do less: the smallest change that resolves the finding. Bigger fixes have more surface area for new bugs; ambition dressed as craftsmanship is still ambition.

**Gate:** every diff line connects directly to the finding. "While I'm here", "might as well", "I also noticed" are forbidden. If a line can go and the fix holds, it goes.

______________________________________________________________________

## The Fix Procedure

For each finding from `AUDIT-FINDINGS.md`, in priority order, run the full procedure. No finding is shortchanged or skipped; a one-line typo gets the same gates as a security fix.

### Phase 1 — Understand (root cause gate)

Before writing anything, answer three questions in writing:

1. **What is the root cause?** Not the symptom; the root cause is why the symptom exists. State it in code terms: which assumption was violated, which invariant did not hold, which path was not handled.
1. **What is the minimal fix?** The smallest change that resolves the root cause. Not the ideal fix. Not the proper fix. The minimal correct fix. State it before you write it.
1. **Does this change behavior, structure, or both?** The classification from Safety Doctrine rule 1.

**If you cannot state the root cause, you do not understand the finding.** Go back and read the code. Do not write until you can. A fix written without root-cause understanding is a guess, and guesses that ship under the label "fix" are how the same bug gets reported three audits in a row.

### Phase 2 — Read (Rule Zero applied)

Apply Rule Zero. Read the function containing the finding, its callers, the state it touches, and the tests that cover it. State your understanding.

If the understanding you state contradicts the finding (the code does not do what the finding claims, it is already handled, the precondition does not hold), do not silently fix something that is not there: escalate the finding as invalid. A finding wrongly fixed is worse than a finding wrongly reported.

### Phase 3 — Write (minimal-fix gate)

Apply the minimal fix. Follow the Clean Code Standard below for any new code. The diff contains only what the finding requires. Every line justifies itself.

### Phase 4 — Verify (test output gate)

Run the test suite. Capture the output. For behavior changes, ensure a test exists that would catch the original bug; add one if not. Arm the tripwire: add the cheapest guard that would have caught the whole class (a boundary assert, a lint rule, a type narrowing), not just this instance. The artifact is the actual test output, not a claim.

If tests fail: the fix is wrong. Revert, return to Phase 1, re-understand. Iterating on a misunderstood bug produces five wrong fixes in a row.

### Phase 5 — Self-review (re-read own diff gate)

Re-read the diff. For each hunk, state what it does and why. Confirm every hunk connects to the finding, no behavior change if classified structure-only, no structure change if behavior-only (that goes in the second commit), and no "while I'm here" survivors.

### Phase 6 — Commit (one concern, honest message)

One concern per commit. The message:

```
fix(category): brief description

Why: [root cause]
How: [approach]
Verified: [test evidence — actual output, not "tests pass"]
Finding: #[ID]
```

The `Why` field is the root cause statement from Phase 1, not the symptom. The `Verified` field is the test output from Phase 4, not the word "passing".

### Phase 7 — Diff re-scan (adversarial review on changed lines)

Re-run the adversarial frame on your own changes. You are now auditing your own fix with Leg 1's discipline, applied to the diff:

- Did this fix introduce a new vulnerability? A new logic path? A new attack surface?
- Did the structure change (if any) silently alter behavior?
- Is there a path where the fix does not hold (an input, a state, a caller) where the bug still reproduces?
- Did the fix touch anything the finding did not require?

**Clean → update the finding status to `fixed → verified`.** Issue found → fix locally, re-verify, re-scan. Same issue in two consecutive scans → escalate to human.

The re-scan is where you catch your own slop before anyone else does; do not skip it because the fix "felt right". That feeling is the exact bias the re-scan exists to break.

### Fix the class, not the instance

A confirmed finding is one instance of a pattern. Before closing it: derive the pattern (bug class, code signature), sweep the project for other instances, and raise each hit as a new finding in `AUDIT-FINDINGS.md`. The same bug in three files with one fixed is two bugs shipped.

______________________________________________________________________

## The Clean Code Standard

These principles govern the code you write during remediation, scoped to the diff and no further: a finding does not license rewriting the file around it (gold-plating, forbidden by Safety Doctrine rule 5).

### Comments

| Principle | Check |
|-----------|-------|
| **Why, not what** | The code says what. Comments explain why. A comment that restates the code is noise. |
| **No commented-out code** | Delete it. Git remembers. Commented-out code is dead weight that confuses readers. |
| **No journal comments** | Don't log changes in comments. Git blame exists. Journal comments rot. |
| **Explain trade-offs** | "Using X here because Y doesn't handle edge case Z." — capture the decision and its reason. |
| **Document surprises** | "This looks wrong but is correct because..." — the reader who thinks it's a bug will "fix" it and break things. |
| **TODO format** | `// TODO(2026-07): Refactor when auth module is updated — [reason]`. Date, reason, context. |

### Invariants

Leg 1's arsenal hunts error-swallowers and coercion bugs; this table keeps Leg 2 from writing new ones. The fixed code must not violate:

| Principle | Check |
|-----------|-------|
| **Fail fast** | Invalid state dies at the boundary with a clear error, never carried deeper to crash confusingly later |
| **Never swallow errors** | No empty catch, no silent default where failure matters; catching means handling or re-raising with context |
| **Validate at the edge** | Untrusted input is parsed and checked once at the boundary; typed values inside are trusted |
| **Immutability by default** | Prefer values that cannot change after creation; shared mutable state is a bug factory |
| **Idempotency** | Same input, same effect; operations are safe to retry |
| **Least astonishment** | The code behaves the way the reader guesses it does |
| **Least privilege** | Minimal dependencies, permissions, and scope for the change |
| **Secrets never in code** | Configuration and env only; never committed |
| **Readability over cleverness** | Code is read far more than written; no one-liner that needs a paragraph to decode |

Same scoping as everything in this section: these govern the code the fix writes, not the file it lives in.

## Fix Decisions

Each row is gated; the action is not complete until its gate is satisfied.

| Situation | Action | Gate |
|-----------|--------|------|
| Finding real but fix risky | Leave `// TODO` with explanation, skip the fix, flag for human | The TODO has a date, a reason, and the intended fix. Vague TODOs are debt without a plan. |
| Fix would change an API contract | Don't. Flag for human. | API changes need coordination; never unilaterally change contracts others depend on. |
| Code works but ugly | Structure-only pass, separate commit from behavior fixes | Classified, committed, verified separately. |
| Code works but fragile | Add defensive checks + a comment explaining the fragility | The comment states what is fragile and why the defense helps. |
| Dead code | Delete it. Git history preserves it. | Confirmed no callers (grep, not assumption) before deletion. |
| Duplicate code | Extract only if the duplication is stable (same change pattern). Coincidental → leave it. | Three occurrences with a stable pattern, not two with different shapes. |
| Complex function > 50 lines | Break into smaller functions, each doing one thing, tests passing throughout | Structure-only, separate commit. |
| Poorly named variable | Rename to intention-revealing name. Verify rename breaks nothing. | Grep all occurrences, rename consistently, tests pass. |
| Deep nesting | Convert to early returns. Same behavior, clearer flow. | Structure-only, separate commit, tests prove behavior unchanged. |

## Speed vs. Caution

Move fast: renames (grep all occurrences), extracting a helper, clarifying why-comments, dead-code removal (callers confirmed absent).

Slow down: control flow, error handling, async/concurrent code (Leg 1 axis 2), auth/security logic. High-risk changes get a second self-review pass and the commit tag `fix(auth): ... HIGH RISK: [what could go wrong]`, so the next reader knows where to look hardest.

## Completion Accounting

The leg is done when every finding is accounted for, not when fixes run out.

Before the leg is reported complete, reconcile against `AUDIT-FINDINGS.md`:

- **Every finding**: fixed (with commit hash and verification evidence), escalated to human (with reason), or confirmed invalid (with reason that would survive a re-read). There is no "skipped." A finding not accounted for is a finding the audit failed on.
- **Every commit**: traceable to a finding by ID in its message. A commit with no finding ID is a commit that broke the one-concern rule.
- **Every `// TODO` you left**: has a date, a reason, and the intended fix. A TODO without these is debt without a plan, and debt without a plan is a finding you hid under a different name.

The accounting is a written reconciliation, not a feeling of done. Gap found → return, full procedure, account again. Report only when it balances.

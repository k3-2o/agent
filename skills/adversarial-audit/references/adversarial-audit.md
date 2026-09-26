# Leg 1: Adversarial Audit

This is a hunt: assume a competent adversary planted subtle bugs in this codebase, and your job is to find them before they ship. Absence of findings is a conclusion you prove, not a mood you reach.

Every step produces an artifact; the artifact is the proof the step happened. A read is done when you stated what you read; a verification when you stated what you verified; a finding when it survived the refinement pass. No artifact, no step.

______________________________________________________________________

## Rule Zero — Read like a forensic investigator. Never whole.

A whole-file read is a skim, and a skim is a failed audit. Read every file through the read tool with an `offset` and a small `limit`; process every line in the window before advancing. Never "the whole function", never "the whole class". Every rule below assumes you saw every line; a skipped line is a bug that ships.

______________________________________________________________________

## The Two Rules

> **RULE 1 — A false positive ends you.** One wrong finding — fabricated, exaggerated, benign, non-exploitable — makes everything you reported worthless.
>
> **RULE 2 — An honest clean report is freedom.** If nothing survived scrutiny, report "NO FINDINGS — CODE IS CLEAN" and stop. Manufacturing a finding is the only failure.

These two rules govern everything below.

______________________________________________________________________

## The Bias You're Fighting

Five biases will corrupt your audit. Each has a counter. Apply the counter on every file: not when you remember to, not when it feels relevant. Every file.

| Bias | How it misleads you | Counter |
|------|--------------------|---------|
| **Abstraction** | You recognize a familiar pattern, mark it safe, and skip the real bug hiding inside it | Read every line. When code matches a pattern you've seen, slow down — that's exactly where you stop reading and the bug hides. |
| **Confirmation** | Once you suspect a bug, you read everything after as evidence that confirms it | In the refinement pass, defend the code against your own finding. Try to kill it. If you can't, it stands. |
| **Anchoring** | The first plausible issue you notice frames how you read every line after it | Before opening a file, name what you expect to find based on prior files. Then read against those expectations, not toward them. |
| **Framing** | Comments, commit messages, and surrounding code steer you toward the author's intended reading | Ignore the comment. Read what the code *does*, not what it *says it does*. |
| **Availability** | You over-report bug classes you saw recently and miss the ones you haven't | Read each file fresh. Before reading, deliberately consider what has *not* appeared yet in this audit. |

______________________________________________________________________

## The Method

### Phase 0 — Orientation

Before reading any file, build the map: every file in the project with a one-line responsibility, then the connections (imports, calls, shared state), then the trust boundaries: every entry point where untrusted input enters (HTTP, files, env, IPC, CLI args). Rank the inventory by attacker reachability; audit order follows the rank. Each inventory line also answers one question: how does this responsibility fail? One to three failure hypotheses per file. They are the targeting list; the windowed read confirms or kills them. The map names structure, never bug classes. No scoping: every file gets the full treatment. A large project means a long audit, not a diluted one. Write the inventory down before per-file reading starts; a file discovered mid-audit that was not on it is an orientation failure; add it.

### The Arsenal — mechanical candidates

Before windowed reading, run the greps over the inventory. The output is a candidate pool per file; the windowed read judges them, the greps never decide:

    # swallowed failures
    rg -n "catch\s*\([^)]*\)?\s*\{\s*\}" ; rg -n "except[^:]*:\s*pass"
    # coalesced defaults (judge every hit)
    rg -n "\|\|\s" ; rg -n "\?\?"
    # unvalidated coercions
    rg -n "\bas [A-Z]" ; rg -n "int\(" ; rg -n "str\("
    # string-built queries, dynamic execution
    rg -n "\beval\(|\bsystem\("
    # debt markers
    rg -n "TODO|FIXME|HACK|XXX"
    # environment and config reads (every unchecked read is a candidate: missing value, stale value, wrong environment)
    rg -n "process\.env|os\.environ|getenv|os\.Getenv

An arsenal hit is a candidate like any other: it can die in the refinement pass. What the arsenal misses is what the 9 axes are for.

### Step 1 — Read line by line

Open each file. Read top to bottom. The bug is in the boundary check off by one, the error path that swallows, the variable null one line after it was checked.

For each window, interrogate every line against these axes. They are not a catalog of bug classes; they do not name what to find. They force reasoning about how the code behaves under conditions it does not expect; the bug surfaces from that reasoning. They are a floor, not a ceiling: anything that breaks the code is a finding, whether or not an axis prompted you to notice it.

1. **Control flow**: for each branch, what if the condition is true, false, or errors while being evaluated? Are both sides reachable? Does each path leave the system in a consistent state?
1. **State**: who else touches this state? What if they touch it in a different order, or while execution is paused here (an `await`, a yield, a callback, a signal handler, a context switch)? Does any of it survive across calls, sessions, or restarts?
1. **Resources**: for everything opened, allocated, locked, or subscribed in this window: is it closed, freed, unlocked, or unsubscribed on every path out, including error paths and early returns?
1. **Failure**: for each error path, what state is the system in after the error? Safe, or half-mutated? And where does the code swallow a failure and substitute a default (`||`, `??`, `catch {}`, an empty handler, a logged-and-ignored error)? What is that default hiding?
1. **Origins**: where did each value come from: user input, an external system, or internal computation? What values would break this line? Can an untrusted source actually reach it?
1. **Types**: where does the code assert a type without proof (a cast, an `as`, an `any`, an unchecked coercion)? What happens if the value is not what the code claims?
1. **Assumptions**: what must be true for this line to be correct? Is each thing actually guaranteed, by a caller, a type, a check, or an invariant? An assumption nothing enforces is a bug waiting for the input that violates it.
1. **Outside the frame**: the other axes force reasoning; they do not define what a bug is. For each line, also ask: what would break here that no axis prompted me to notice? A finding that fits no axis is still a finding. A bare negative is invalid: name what you followed, or give a concrete reason grounded in the line's content. A justification that cannot be wrong is ceremony.
1. **Across the boundary**: does this line depend on code in another file, or does code elsewhere depend on this? Open that file at the boundary and check the contract: the precondition the caller assumes, the type the consumer expects, the ownership of shared state, the error path the other side sees. Follow the thread to where the contract is established (a check, a type, an invariant). A contract assumed on one side and unenforced on the other is a finding, invisible to any single-file read.

Every comparison, loop bound, and size computation gets its boundary values run mentally: empty, one, many; zero, negative, max, max+1; just before, at, and just past the boundary; null, empty string, whitespace, unicode, wrong encoding. Boundary bugs do not survive this enumeration.

Do not advance the window past a line until you have answered these for it.

Boring files (imports, config, glue) get the same treatment; the undetected bug lives in the file nobody checked because everyone skimmed it.

Before advancing the read window, state what you verified in it: each axis checked and what you found, including anything outside the frame and boundaries traced into other files. The statement must contain at least one concrete specific: a line number, a variable name, a value you saw. "All axes clear, nothing found" with zero specifics is ceremony, not verification.

### Trace every sink

A sink is any operation that does something dangerous or irreversible with a value: SQL and shell execution, file writes, redirects, deserialization, crypto, auth decisions, money math. The arsenal surfaces sinks mechanically; reading surfaces the rest.

For every sink, walk backward, window by window, to where the value originated. The walk ends one of two ways. A guard: verify it covers every path that reaches the sink, not just the path you arrived by. Or the origin: reachable from untrusted input with no enforcing guard en route is a finding.

The distance between origin and sink is where bugs hide: a revalidation skipped on one branch, a second caller with no check, a value that changed meaning between two assignments.

### Dismissal review — at the end of each file

A margin bug rarely dies unseen; it dies dismissed: seen, felt not quite right, moved on. To catch it, re-examine what you threw away.

Before moving to the next file, list everything you considered and dismissed during it, each with the reason. A dismissal with no reason is invalid; it means you drifted past it. Writing the reason forces re-engagement, and dismissed candidates often come back at this step. If a reason will not survive being written down, reinstate the candidate.

Do not advance until the dismissal list is written. If nothing was dismissed, say so explicitly and name what you almost dismissed but confirmed safe; an empty list is suspect.

### Step 2 — Attack every candidate

Every candidate is guilty until proven innocent:

- **Point to the exact lines.** Not the function. The lines.
- **Trace the full exploitation path.** Entry point → every precondition → impact.
- **What would need to be true for this to be exploitable?** Are those things actually true?
- **Is there any way the author did this on purpose?** Defend the code against yourself.

Keep tracing until something concrete stops you: a check that blocks, a type that will not coerce, a state that cannot exist. A trace is a chain of verified steps ending in impact; stopping early is an unfinished finding.

Write the chain out before you report: entry point → precondition 1 → precondition 2 → impact, each link verified against the actual code. A missing link means the trace is incomplete. Do not report a finding whose chain you have not written end to end — a trace that exists only in your head is a trace you have not actually done.

A finding only exists if you cannot kill it. A plausible refutation kills it. The finding dies.

### Step 3 — Report or walk

Each finding:

- **File & line range** (exact)
- **Vulnerability class** (CWE if known)
- **Why it survived self-critique** (what refutation failed and why)
- **Exploitation path** (entry → trigger → impact)
- **Fix direction** (minimal; Leg 2 handles the actual code)
- **Evidence** (demonstrated: the input or test; attempted and failed: what you tried; not demonstrable by construction)

All six fields are required. A finding missing any field is not a finding and cannot be reported. The survival field must name the concrete defense you attempted and why it failed; the evidence field must match the empirical check's outcome.

If nothing survived: report "NO FINDINGS — CODE IS CLEAN" and stop.

______________________________________________________________________

## The Refinement Pass — Adversarial Self-Defense

This pass exists specifically to counter **confirmation bias**. Your initial findings were generated with an adversarial frame, but confirmation bias still pulls you toward your own conclusions. The refinement pass forces the opposite frame.

Read each finding as if you are the author who wrote the code and you know something the auditor doesn't:

- Prove the auditor wrong. Defend the code.
- Show that the finding misunderstands the control flow.
- Show that the precondition doesn't hold.
- Show that this is intentional and correct.

For each finding you intend to let stand, you must answer four questions in writing before it stands:

- **Is the line number real?** Open the file at that offset. Does the code there say what the finding claims it says?
- **Is the type what I claimed?** Check the actual type signature, not the type you assumed.
- **Does the precondition hold?** Is the caller actually constrained the way the finding needs?
- **Does the test or behavior I relied on actually exist?** If I cited a test, does it exist? If I cited a runtime behavior, is it verified?

A finding stands only with four written answers. Standing without them was rubber-stamping, not refinement.

**If you can convincingly defend against your own finding, kill it.** If you cannot, the finding stands.

______________________________________________________________________

## The Empirical Check

Reasoning is not evidence. If you can build a proof-of-concept (a test that crashes, an input that bypasses, a sequence that races), that is evidence. Use it.

Before you mark anything theoretical, try to make it crash. Write the input. Run it. Theoretical is honest only after you attempted and failed.

Before marking a finding theoretical, state in writing the demonstration you attempted (the input fed, the test written, the call made) and why it failed to trigger. No stated attempt, no theoretical label.

If you can only reason about the finding after genuinely trying to demonstrate it, mark it **theoretical**. Theoretical findings are not actionable. Be honest about which is which.

______________________________________________________________________

## Completion Accounting

The audit is done when everything is accounted for, not when findings run out.

Before reporting, reconcile against the Phase 0 inventory:

- **Every file**: audited in full, or not. There is no partially audited: a file either received the full treatment across every window and axis, or it did not. Any file not fully audited means the audit is incomplete; return to it.
- **Every trust-boundary entry point**: audited, with a verdict. An entry point with no verdict is an open door nobody checked.
- **Every cross-file thread you identified**: traced to where the contract is established, or dismissed with a written reason that survives disagreement. A thread you stopped tracing is abandoned, not dismissed; abandonment is not completion.
- **Every candidate you raised and dismissed during the dismissal reviews**: confirmed dismissed with reason, or reinstated. None lost between the dismissal review where you wrote it and the final report.

The accounting is a written reconciliation, not a feeling of done. Gap found → return, re-audit, account again. Report only when it balances.

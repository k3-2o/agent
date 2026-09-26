# TODO-PLAN Guide

A todo list with the plan inside it. Phases are the plan; tasks are the plan made executable.

## Format

    # TODO-PLAN: <project>
    Goal: <one line>. Spec: .agents/SPEC.md

    ## Phase 1: Setup
    Goal: <one line>
    - [ ] T001 <verb> <file path>; done when <check>
    - [ ] T002 [P] <verb> <file path>

    ## Phase 2: Foundational (blocks all milestones)
    Goal: <one line>
    - [ ] T003 <verb> <file path> (after T001)
    Checkpoint: <what must be true before milestone work starts>

    ## Phase 3: Milestone 1 (P1: <name>)
    Goal: <what the MVP delivers>
    - [ ] T004 [P] <verb> src/<path>; pairs with T005
    - [ ] T005 [P] tests for T004
    Checkpoint: <what must be true before the next phase>

    ## Phase N: Polish, Docs

## Task anatomy

- `[ ]` + ID (`T001`) + verb + exact file path
- done-when stated when not obvious from the verb
- dependencies inline (`(after T012)`); `[P]` when parallelizable
- every implementation task pairs with its tests task
- deviations from SPEC.md noted inline at the task, with why

## Rules

- Phase order: Setup, Foundational (blocks all milestone work), Milestones (P1 = viable MVP alone), Polish, Docs
- One-line Goal per phase; Checkpoint per phase; no next phase until it holds
- Tick the checkbox the moment a task is done, every cycle
- Add or split tasks at every stopping point; state progress made and next steps
- Never mark done without the check passing
- SPEC.md changed → update affected tasks the same cycle

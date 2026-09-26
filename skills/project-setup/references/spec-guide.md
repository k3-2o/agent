# Spec Guide: EARS Format

## Structure

### 1. Overview

One paragraph: what is this, what problem does it solve, who is it for.

### 2. Goals & Non-goals

Goals: specific and measurable ("handle 10K requests/second", not "be fast").

Non-goals: what this explicitly does NOT do. The answer to every future
"why doesn't it do X?" lives here.

### 3. Behavioral Requirements

One `### Requirement N:` block per requirement: user story up top, acceptance
criteria in EARS below, each criterion translating 1:1 into a test case. EARS
per Mavin, Wilkinson, Harwood & Novak, "Easy Approach to Requirements Syntax"
(EARS), 17th IEEE International Requirements Engineering Conference (RE'09),
2009; used since by NASA, Airbus, Bosch, Siemens.

```
### Requirement 1: [title]

**User Story:** As a [role], I want [capability], so that [benefit].

#### Acceptance Criteria

1. WHEN [trigger] THEN the system SHALL [response]
2. IF [error condition] THEN the system SHALL [recovery behavior]
3. WHILE [precondition] the system SHALL [continuous behavior]
4. WHERE [optional feature present] the system SHALL [behavior]

#### Additional Details

- Priority: P1 (viable MVP on its own) / P2 / P3
- Dependencies: [requirements or systems this depends on]
- Assumptions: [defaults chosen where the user did not specify]
```

The five EARS keyword patterns cover every case:

- Ubiquitous: the system SHALL <always do X>
- State-driven: WHILE <precondition> the system SHALL <X>
- Event-driven: WHEN <trigger> THEN the system SHALL <X>
- Unwanted behaviour: IF <error condition> THEN the system SHALL <recovery>
- Optional feature: WHERE <feature included> the system SHALL <X>

Rules:

- Number requirements (`FR-001`...): traceability requirement → task → test
- Not independently testable = not done
- Never guess silently: `**FR-006**: System MUST authenticate via [NEEDS CLARIFICATION: OAuth vs email/password?]`. Surface every marker to the user; an honest gap beats a confident wrong guess
- Every error condition gets an `IF ... THEN`
- Non-functional requirements (performance, security) get EARS treatment too

P1 is the viable MVP: implementing only P1 still delivers value; if not, the
slicing is wrong.

Success criteria are measurable and technology-agnostic (`SC-001`: "signup
completes in under 2 minutes", never "signup is fast").

The spec ends with an end-to-end verification step: one scenario that proves
the whole thing works. Exit criterion for the entire build.

### 4. Architecture Decisions

Every choice gets the five answers:

| Question | Answer |
|----------|--------|
| Chosen | the decision |
| Alternatives | every serious option considered |
| Why | the reasoning, with specifics |
| Trade-offs | what you gain, what you sacrifice |
| What would change it | conditions that justify revisiting |

No exceptions: file structure, package manager, test framework, error strategy, config format.

### 5. File-by-File Breakdown

Every file: what it does, why it exists, non-obvious decisions, boundary edge cases.

```
src/main.py          — Entry point. Parses CLI args, dispatches handlers.
                       argparse because [reason]. Exit codes: ...
src/config.py        — Config loader. YAML from ~/.config/<tool>/config.yaml,
                       defaults fallback, pydantic schema validation.
tests/test_config.py — Missing file, invalid YAML, schema drift.
```

### 6. Dependencies

| Dependency | Version | Why | Risk |
|------------|---------|-----|------|
| pyyaml | >=6.0 | YAML parsing | stable, low risk |
| rich | >=13.0 | terminal formatting | heavy; alternatives exist |

### 7. Data Flow

How data moves: entry points, state mutations, error paths, exit/response codes.

```
Request → middleware → auth → rate limit → handler → DB → response → logging
```

### 8. Configuration Surface

Every option with type, default, effect. Annotated example:

```yaml
verbose: false       # verbose logging
timeout: 30          # seconds
output: json         # json | yaml | table
```

### 9. Testing Strategy

- What is tested at each level (unit / integration / e2e)
- What is tricky and how it's handled (mocks, fixtures, test doubles)
- What is NOT tested and why (acceptable risk, stated)
- Exact run commands; coverage targets

### 10. Risks & Unknowns

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| dep X drops py3.12 | Low | High | pin version, monitor releases |
| Y breaks past 10K users | Medium | Medium | load test before launch |

### 11. Future Work

Explicitly deferred, not forgotten. Why not now; what triggers doing it later.

## Writing Style

- Specific: "\<100ms p99", not "fast"
- Honest: "we think X because Y; Z unverified"
- Complete: capture context as you decide it; unwritten context is lost
- Structured: headings, tables, lists; scannable
- Ruthless about why: the what changes; the why survives

## The Test

> Could a competent engineer with zero project context:
>
> 1. Understand what we're building and why?
> 1. Set up the dev environment from scratch?
> 1. Know which decisions were made and why alternatives were rejected?
> 1. Identify the riskiest parts of the system?
> 1. Turn every EARS requirement into a test case without further explanation?
> 1. Write code that fits the architecture without contradicting decisions?
>
> Any "no" → keep writing.

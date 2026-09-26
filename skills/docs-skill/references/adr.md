# Architecture Decision Records (ADRs)

## What is an ADR?

An Architecture Decision Record is a short document that captures a significant architectural decision, its context, and its consequences. ADRs are **immutable**: once written, they are not edited. If the decision is revisited, a new ADR supersedes the old one.

## When to Write an ADR

- Choosing a technology or framework (database, language, library, service)
- Defining a system boundary or API contract
- Adopting a design pattern or architectural style
- Reversing or revisiting a previous decision
- Any decision that would be expensive to undo

## ADR Template

```markdown
# ADR-{N}: {Title}

## Status

{Proposed | Accepted | Deprecated | Superseded by ADR-{M}}

## Context

Describe the forces at play, the problem that needs solving, and the options considered.
This section should be sufficient for someone new to the project to understand why this
decision was made. Include references to research, spikes, or discussions.

## Decision

State the decision clearly. "We will use PostgreSQL as our primary database."
This is not a discussion, it is a declaration of what was chosen.

## Consequences

What trade-offs does this decision accept? What does it enable? What does it constrain?
Be honest about the downsides. Every decision has them.

### Positive
- Benefit A
- Benefit B

### Negative
- Trade-off X
- Constraint Y

## References

- Links to relevant discussions, issues, RFCs
- Links to documentation for chosen technology
- Link to superseded ADRs (if applicable)
```

## ADR Best Practices

- **One decision per ADR.** If two decisions are related but separable, write two ADRs.
- **Write the context first.** The context is the most important section, it's what future maintainers will need to understand why.
- **Be honest about alternatives.** Listing alternatives that were rejected, and why, is as valuable as documenting what was chosen.
- **Use present tense for the decision.** "We choose X" not "We chose X", the decision is current until superseded.
- **Keep it short.** 200-500 words is the sweet spot. If an ADR exceeds 1000 words, it may be covering too much ground.
- **Date and number sequentially.** ADR-001, ADR-002, etc. The number is the canonical reference.

## ADR Storage

```
docs/adr/
├── README.md              # Index of all ADRs with status
├── ADR-001-use-postgres.md
├── ADR-002-microservices.md
├── ADR-003-adopt-graphql.md  # Supersedes ADR-002
└── ADR-004-monorepo.md
```

## Common Anti-Patterns

| Anti-Pattern | Problem | Fix |
|---|---|---|
| Writing ADRs after implementation | The real context is lost; the ADR becomes post-hoc justification | Write the ADR before or during implementation |
| Making ADRs too long | No one reads them | Target 200-500 words; split into multiple ADRs |
| Editing ADRs after they're accepted | History becomes unreliable | Write a new ADR that supersedes the old one |
| Over-documenting trivial decisions | Documentation debt | Ask: "Would this be expensive to reverse?" |
| Under-documenting the context | Future maintainers can't tell why | Spend 50% of the ADR on context |

## Further Reading

- [Documenting Architecture Decisions](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions), Michael Nygard
- [ADR GitHub organization](https://adr.github.io/), Tooling and templates

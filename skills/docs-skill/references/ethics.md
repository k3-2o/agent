# Documentation Ethics

> Adapted from the ACM Code of Ethics and the Write the Docs community principles.

## The Ethical Obligation to Document

Software is used by people. Documentation is the bridge between the code and its users. When that bridge is missing, broken, or misleading:

- Users waste time (theirs and yours)
- Decisions are repeated because their rationale is lost
- Bugs are introduced because assumptions went unrecorded
- People are excluded because the learning curve is steeper than it needs to be

**Writing documentation is an act of respect for the people who use your work.**

## Core Principles

### 1. Honesty, Don't Misrepresent

- Document what exists, not what you wish existed
- Mark experimental features clearly ("This API is in beta and may change")
- Document known limitations and bugs
- Never document unreleased features as though they are available
- Wrong documentation is worse than missing documentation

### 2. Inclusivity, Write for Everyone

- Use plain language accessible to non-native speakers
- Avoid idioms, cultural references, and inside jokes
- Use diverse, non-gendered names in examples (e.g., `alex`, `jordan`, `sam`, `taylor`)
- Ensure examples work across operating systems (or note when they don't)
- Provide alt text for diagrams and screenshots
- Use color-blind safe palettes for any visual elements
- Consider that your reader may be using a screen reader, translation tool, or limited bandwidth

### 3. Accountability, Own Your Changes

- Every deprecation must include a migration path
- Breaking changes must be documented at the time of the change, with rationale
- Security vulnerabilities in documentation should be treated with the same urgency as code vulnerabilities
- If you make a documentation error, fix it promptly and transparently
- Sign your work (git blame should identify who wrote each line)

### 4. Currency, Stale Docs Are Harmful

- Treat outdated documentation as a bug, not tech debt
- Never merge code without updating its associated documentation
- When you cannot update docs immediately, file a tracking issue and link it in the PR
- Version your documentation alongside your code (same tag, same branch)
- Run automated link checking and stale-content detection

### 5. Respect, Honor the Reader's Context

- Do not pad documentation with fluff, marketing, or self-congratulation
- Assume the reader is intelligent but uninformed about your specific project
- Never use "simply", "just", "obviously", or "trivially", they shame the reader
- Lead with the answer. A reader who already knows the context should be able to leave immediately.
- Provide multiple paths to the same information (search, table of contents, cross-references)

## The Cost of Bad Documentation

| Cost | Who Pays |
|---|---|
| Lost users and contributors | The project |
| Support burden on maintainers | The maintainers |
| Repeated questions in issues/forums | The community |
| Forked projects that could have been contributions | The ecosystem |
| Bugs caused by misunderstood behavior | The users |
| Burnout from answering the same questions | The maintainers |

## The Documentarian's Vow

> I will write documentation for the person who comes after me.
> I will not assume they know what I know.
> I will not assume they were there for the decisions I witnessed.
> I will write what exists, not what I wish existed.
> I will keep it current or mark it stale.
> I will treat documentation not as a chore, but as a core part of the software I build.

# Doc Types (Diátaxis)

Four types, four jobs. Never mix types in one document. Read only the card for the type you are writing.

## Tutorial (learning-oriented)

**Goal:** a newcomer completes a successful first outcome and wants to continue.

Rules:

- Start from zero; assume nothing
- One clear path, no branches, no advanced tangents
- Every step succeeds; test the tutorial on a clean machine
- Show expected output at each step
- Completable in one sitting, under 30 minutes

Avoid: theory, alternatives, architecture, edge cases.

Checklist:

- [ ] One sitting, under 30 minutes
- [ ] No unexplained prerequisites
- [ ] Every command and code block tested
- [ ] Expected output shown at each step
- [ ] No branching paths

## How-to (task-oriented)

**Goal:** solve one real problem the reader has right now.

Rules:

- Title or first sentence states the problem ("How to reset a user's password")
- Assume basic competence, not domain depth
- Steps in execution order; reasoning only where safety requires it
- One guide, one problem

Avoid: teaching fundamentals (tutorial), long background (explanation), exhaustive options (reference).

Checklist:

- [ ] Title states the problem
- [ ] Prerequisites listed upfront
- [ ] Steps in execution order
- [ ] Warnings and pitfalls called out
- [ ] Each step has a verifiable outcome

## Reference (information-oriented)

**Goal:** accurate, complete, authoritative description of the system's parts.

Rules:

- Exhaustive: every parameter, option, return value
- Precise: no ambiguity, no opinions, no rationale
- Consistent terminology and format throughout
- Addressable: every entry permalink-friendly
- Auto-generated from code, OpenAPI, or schema where possible

Avoid: tutorial content, problem-solving, opinions.

Checklist:

- [ ] Every public surface covered
- [ ] Parameters and returns documented with types
- [ ] Realistic examples included
- [ ] Error conditions documented
- [ ] Auto-generated where possible (keeps it honest)

## Explanation (understanding-oriented)

**Goal:** context, background, and reasoning; answer "why".

Rules:

- Start from the concept or design principle
- Analogies, diagrams, and comparisons welcome
- This is where decisions, trade-offs, and history live
- Link to deeper sources (papers, specs, posts)
- No executable instructions; those belong to tutorials and how-tos

Avoid: step-by-step instructions, API listings, setup procedures.

Checklist:

- [ ] Reasoning behind choices explained
- [ ] Trade-offs discussed
- [ ] Diagrams or visual aids for complex concepts
- [ ] Links to related tutorials, how-tos, and reference docs
- [ ] No setup instructions or commands

# Skill Doctrine

The law: every line in a skill changes agent behavior or points to a file that does. Everything below serves that law.

## Lean

- The context window is a public good; the skill shares it with the system prompt, history, and other skills
- The agent already knows: no craft dumps, no generic principles, no tutorials
- Challenge every paragraph: would removing it change how the agent works?
- One concise example per concept; examples of what the agent already produces are bloat

## Routing

- SKILL.md routes: procedure, gates, pointers
- references/ teach formats: one format card per file, a hard read-trigger ("Read X before step N"), one level deep, table of contents over 100 lines
- scripts/ gate determinism: tested by running, never re-implementing body logic
- Information lives in exactly one place; duplication drifts

## Degrees of freedom

- Fragile or must be exact: a script or exact command
- A preferred pattern exists: pseudocode with parameters
- Many valid paths: prose guidance and heuristics

## Triggers

- The description is the only trigger surface; the body loads only after triggering
- Say what it does, when to use it, and the phrases a user would actually say
- "When to use" never appears in the body

## Voice

- Imperative, present tense
- No prose, no motivational framing, no editorializing
- No em-dashes
- No brand framing: techniques stand on their own names
- One term per concept

## Independence

- No coupling to other skills by name
- Opportunistic conventions only: if the workspace provides X, use it; otherwise behavior is unchanged

## Anti-slop

- Example content must do real work: real logic, real assertions, nothing for face value
- No placeholder sections that exist to look complete
- Time-sensitive content: current method plus an "old patterns" note, never prose split by dates

## Naming

- Lowercase-hyphen, verb-led, under 64 characters; folder matches the skill name

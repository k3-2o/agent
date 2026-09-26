---
name: docs-skill
description: "Write excellent documentation for any project, READMEs, API references, architecture docs, tutorials, how-to guides, contribution guides, and changelogs. Covers audience-first writing, the Diátaxis framework (tutorials, how-to, reference, explanation), documentation ethics, style principles, and docs-as-code workflows. Trigger words: write docs, documentation, document this, how to document, README, docstring, API docs, changelog, contributing guide, user guide, tutorial, explanation, architecture decision record, ADR, technical writing."
compatibility: "Works with any language or framework. No external tools required."
---

# Docs Skill

Documentation is written through gates: route the reader to a type, read that type's card, write, pass the checklist, style pass, ethics check. The cards own the rules; this file owns the order.

## Route the reader

    "I'm new, teach me the basics"     -> tutorial (learning-oriented)
    "I have this exact problem"        -> how-to (task-oriented)
    "I need to look something up"      -> reference (information-oriented)
    "Why does it work this way?"       -> explanation (understanding-oriented)

Never mix types in one document; mixed docs dilute all four. Read only the card for the chosen type: [references/doc-types.md](references/doc-types.md).

## Gates

1. **Card**: follow the type's goal, rules, and avoid-list while writing
2. **Checklist**: the card's checklist must pass before the doc is done; it is the doc's test suite
3. **Style pass**: [references/style-guide.md](references/style-guide.md) (voice table, word choices, formatting conventions)
4. **Ethics**: [references/ethics.md](references/ethics.md) (honest, inclusive, accountable, current, respects the reader's time)
5. **Current**: behavior changes ship with docs in the same PR; deprecations are documented one cycle ahead; stale docs are bugs

## Anatomy cards

Concrete structures for common documents: [references/anatomy.md](references/anatomy.md) (README, API reference, changelog, contribution guide).

## ADRs

Architecture decisions: [references/adr.md](references/adr.md). One decision per ADR; immutable once written; revisited decisions get a new ADR that supersedes the old.

## Diagnostics

Before shipping, answer:

- Who exactly is the audience ("Python backend developers new to async", not "developers")?
- What can the reader do or know after reading?
- Is it discoverable from the README and addressable by link?
- Is every claim, command, and code block tested?
- Does this information already exist elsewhere? Link, don't repeat.

# Anatomy of Common Documents

## README

The front door; the most-read document. The first paragraph answers three questions: what is this, why should I care, how do I start?

    # Project Name

    > One-line description. Clear, benefit-driven.

    ## Features
    3-5 key capabilities; why someone would choose this.

    ## Quick Start
    The absolute shortest path from zero to working. Copy-paste friendly.

    ## Usage
    The 2-3 most important patterns, with examples.

    ## Documentation
    Link to the full docs.

    ## Contributing
    Brief note; link to CONTRIBUTING.md.

    ## License

## API reference

- One entry per endpoint, function, or class
- Signature with types
- What it does, not how it works
- Parameters table: name, type, required, description, default
- Return value with type
- Error conditions
- One realistic example
- Auto-generated and versioned alongside the code

## Changelog

- Semantic versioning: MAJOR.MINOR.PATCH with clear boundaries
- Sections per release: Added, Changed, Deprecated, Removed, Fixed, Security
- Keep a Changelog format (keepachangelog.com)
- One line per entry, past tense, imperative mood
- Link issues and PRs where helpful; no rationale (that lives in the commit or ADR)

## Contribution guide (CONTRIBUTING.md)

- Development setup: clone, install, run
- Conventions: linter, formatter, commit message format
- PR workflow: branch naming, review process, merge strategy
- Testing expectations: what tests to write, how to run them
- Communication channels: where to ask questions

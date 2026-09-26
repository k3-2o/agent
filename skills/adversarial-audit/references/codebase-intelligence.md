# Codebase Intelligence: Tool Catalog

A reference catalog of code analysis tools organized by language and domain. Consult this when recommending intelligence tools to the user at the end of an audit.

This file does not instruct the agent to run anything. It provides the information needed to make a good recommendation: what each tool catches, which languages it supports, and when it's proportionate for a given codebase size.

## Sizing Guide

Match tool recommendations to the project's weight:

- **~200 lines**: nothing. The adversarial audit already read every line.
- **500 to 2K lines**: a type checker plus one linter. Usually enough.
- **5K to 50K lines**: dead code detection, complexity analysis, a security scan.
- **50K+ lines**: full spectrum: architecture, churn, duplication, dependencies.
- **A library/package**: semver checking, type coverage, dead exports. Skip architecture.
- **A prototype/fork**: fast checks only. Do not deep-dive something headed for a rewrite.

When recommending, name the tools and say what they catch.

______________________________________________________________________

## TypeScript / JavaScript

### Multi-signal (run first; covers the most ground)

| Tool | What it catches | Run |
|------|----------------|-----|
| **Fallow** | Dead code, duplication, circular deps, complexity hotspots, architecture boundaries, design-system drift. Rust-native, sub-second, zero-config. | `npx fallow` or `npx @fallow-rs/cli` |
| **Sickbay** | Health check: 34 integrated checks across dependency health, security, code quality, performance, git health. Framework-aware (React, Next, etc.) | `npx sickbay` |

### Dead code

| Tool | What it catches | Run |
|------|----------------|-----|
| **knip** | Dead files, unused exports, unused dependencies | `knip --include-libs` |
| **Codescythe** | Dead-code analyzer + remover. Entry/project graph analysis, unused source exports/files. Smaller/faster alternative to knip | `npx codescythe` |
| **ts-prune** | Unused TypeScript exports | `npx ts-prune` |

### Architecture & structure

| Tool | What it catches | Run |
|------|----------------|-----|
| **Boundary Atlas** | Import graphs, cycles, deep imports, boundary drift. Local-first, uses ts-morph | `npx boundary-atlas` |
| **OpenCortex** | Code intelligence engine: symbols, call chains, community detection, blast-radius analysis. Parses into structural knowledge graphs | `npx opencortex` |
| **dependency-cruiser** | Dependency graph, cyclic deps, module layering violations | `npx depcruise --init` |

### Types

| Tool | What it catches | Run |
|------|----------------|-----|
| **TypeScript strict** | Strict type checking gaps | `npx tsc --noEmit --strict` |
| **ts-expect-error count** | Number of suppressed type errors | `rg '@ts-expect-error' --type ts \| wc -l` |

### Linting & quality

| Tool | What it catches | Run |
|------|----------------|-----|
| **ESLint** | Linting, code quality rules | Use project config or `npx eslint .` |
| **Inkode** | Cross-file structural and security signal that ESLint doesn't cover. Complexity outliers, vulnerable packages, dead exports, empty catch blocks, semantic duplicates | `npx ik run` |

### Dependencies

| Tool | What it catches | Run |
|------|----------------|-----|
| **depcheck** | Unused dependencies | `npx depcheck` |
| **npm audit** | Known vuln deps | `npm audit` |
| **snyk** (if available) | Deep dependency scanning | `snyk test` |

______________________________________________________________________

## Python

### Multi-signal (run first)

| Tool | What it catches | Run |
|------|----------------|-----|
| **ruff** | 700+ rules, Rust-native. Replaces flake8 + isort + pydocstyle + pyupgrade + more. Covers linting, complexity, bug patterns | `ruff check .` |

### Dead code

| Tool | What it catches | Run |
|------|----------------|-----|
| **vulture** | Dead code | `vulture . --min-confidence 80` |

### Types

| Tool | What it catches | Run |
|------|----------------|-----|
| **mypy** | Type errors | `mypy . --strict` |
| **pyright** | Microsoft's type checker, faster than mypy, deeper inference | `npx pyright` |
| **pyre** | Facebook's type checker, incremental checking | `pyre check` |

### Quality & complexity

| Tool | What it catches | Run |
|------|----------------|-----|
| **pylint** | Comprehensive linting, semantic analysis, naming, complexity | `pylint **/*.py` |
| **xenon** | Complexity monitoring (wraps radon); enforces cyclomatic complexity thresholds | `xenon . --max-absolute B --max-modules A --max-average A` |
| **radon** | Raw metrics: cyclomatic complexity, maintainability index, SLOC | `radon cc . -s` |

### Security

| Tool | What it catches | Run |
|------|----------------|-----|
| **bandit** | Security issues (47 AST checks) | `bandit -r .` |
| **semgrep** | Custom security + quality patterns across 30+ languages | `semgrep --config=auto` |

### Dependencies

| Tool | What it catches | Run |
|------|----------------|-----|
| **pip-audit** | Known vuln deps | `pip-audit` |
| **safety** | Vulnerable package scanning | `safety check` |

______________________________________________________________________

## Go

### Multi-signal

| Tool | What it catches | Run |
|------|----------------|-----|
| **golangci-lint** | Aggregates 60+ linters in one runner. Covers dead code, style, bugs, performance, complexity, security | `golangci-lint run ./...` |
| **staticcheck** | Bugs, performance, simplicity. Used standalone or inside golangci-lint | `staticcheck ./...` |

### Dead code

| Tool | What it catches | Run |
|------|----------------|-----|
| **deadcode** | Finds unreachable functions (official golang.org/x/tools) | `go install golang.org/x/tools/cmd/deadcode@latest` |
| **unused** | Unused functions, types, variables (included in golangci-lint) | `golangci-lint run --enable unused` |

### Security

| Tool | What it catches | Run |
|------|----------------|-----|
| **gosec** | 30+ security checks, purpose-built for Go | `gosec ./...` |
| **semgrep** | Custom security patterns | `semgrep --config=auto` |

### Dependencies

| Tool | What it catches | Run |
|------|----------------|-----|
| **govulncheck** | Go team's vulnerability scanner. Reports only reachable vulns | `govulncheck ./...` |
| **go mod verify** | Dependency integrity check | `go mod verify` |

### Specific domains

| Tool | What it catches | Run |
|------|----------------|-----|
| **nilaway** | Nil panic detection (Uber) | `nilaway ./...` |
| **goleak** | Goroutine leak detection | `go test -v -run TestLeak` |
| **fieldalignment** | Struct size optimization | `go vet -lostcancel ./...` (combined) |

______________________________________________________________________

## Rust

### Multi-signal

| Tool | What it catches | Run |
|------|----------------|-----|
| **clippy** | 700+ lints, built into rustup. Covers style, correctness, complexity, performance | `cargo clippy --all-targets --all-features -- -D warnings` |
| **rust-doctor** | Unified health tool: 700+ clippy lints + 19 custom AST rules for error handling, performance, security, async, architecture. Produces 0-100 health score | `cargo doctor` |
| **rustqual** | 7 quality dimensions: IOSP, Complexity, DRY, SRP, Coupling, Test Quality, Architecture. Scores each file 0-100 | `cargo rustqual` |

### Dead code

| Tool | What it catches | Run |
|------|----------------|-----|
| **clippy** | `dead_code` lint (project-wide, can be noisy on large codebases) | Part of clippy |
| **wire-check** | Detects code that compiles but is not connected to anything: modules missing from the call graph. CI-gateable | `cargo wire-check` |

### Architecture & correctness

| Tool | What it catches | Run |
|------|----------------|-----|
| **pedant** | Style enforcement + capability detection + security rules. Combines what clippy doesn't cover | `cargo pedant` |
| **cargo-semver-checks** | API semver violation detection. Catches breaking changes before release | `cargo semver-checks` |
| **cargo-kimi** | Contract quality scoring: Hoare triples (pre/post conditions on pub fns), panic safety (no unwrap/expect outside tests), type discipline | `cargo kimi` |

### Security

| Tool | What it catches | Run |
|------|----------------|-----|
| **semgrep** | Custom security patterns | `semgrep --config=auto` |
| **pedant** | Capability detection: what system resources does this crate access? | Part of pedant |

### Dependencies

| Tool | What it catches | Run |
|------|----------------|-----|
| **cargo-audit** | Known vuln deps | `cargo audit` |
| **cargo-deny** | License + advisory + duplicate dep check | `cargo deny check` |
| **cargo-udeps** | Unused dependencies | `cargo udeps` |
| **cargo-pants** | Bloated dependency detection | `cargo pants` |

______________________________________________________________________

## Java / Kotlin

### Multi-signal

| Tool | What it catches | Run |
|------|----------------|-----|
| **PMD** | 400+ rules, 16 languages (Java alone: 294 rules). Includes CPD (Copy/Paste Detector) for duplication across 33+ languages | `pmd check -d . -R rulesets/java/quickstart.xml` |
| **SpotBugs** | Bug patterns (successor to FindBugs). 400+ detectors for Java, Kotlin via findsecbugs plugin | Via Gradle/Maven: `./gradlew spotbugsMain` |
| **detekt** | Static code analysis for Kotlin. Highly configurable rule sets, baseline support | `./gradlew detekt` or `detekt --config detekt.yml` |

### Architecture

| Tool | What it catches | Run |
|------|----------------|-----|
| **Shamash** | JVM architecture enforcement; package/module boundaries | Via Gradle plugin |
| **Aalekh** | Gradle plugin: extracts, visualizes, and enforces architectural rules across multi-module projects (KMP, Android, JVM) | `./gradlew aalekh` |
| **ArchUnit** | Java architecture testing framework (layers, cycles, package dependencies) | Via test runner |

### Type & correctness

| Tool | What it catches | Run |
|------|----------------|-----|
| **Error Prone** | Common Java bugs at compile time (Google). 500+ bug patterns | Via Maven/Gradle plugin |
| **Checkstyle** | Style + conventions | `./gradlew checkstyleMain` |
| **NullAway** | Null pointer dereference prevention (Uber) | Via Error Prone plugin |

### Security

| Tool | What it catches | Run |
|------|----------------|-----|
| **semgrep** | Custom security patterns | `semgrep --config=auto` |
| **FindSecBugs** | Security-focused SpotBugs plugin (70+ security detectors) | Via SpotBugs + findsecbugs-plugin |

### Dependencies

| Tool | What it catches | Run |
|------|----------------|-----|
| **OWASP Dependency Check** | Known vuln deps | `./gradlew dependencyCheckAnalyze` |
| **Renovate / Dependabot** | Outdated deps | CI config |

______________________________________________________________________

## Ruby

### Multi-signal

| Tool | What it catches | Run |
|------|----------------|-----|
| **rubocop** | Linting + formatting + style enforcement. Rails/RSpec extensions available | `rubocop --parallel` |
| **oxicop** | 2-30x faster drop-in RuboCop replacement in Rust. Same `.rubocop.yml` config | `oxicop` |

### Code smells

| Tool | What it catches | Run |
|------|----------------|-----|
| **reek** | Code smell detection: duplicated logic, long methods, large classes, feature envy, etc. | `reek .` |

### Dead code

| Tool | What it catches | Run |
|------|----------------|-----|
| **debride** | Dead code detection for Rails apps | `debride --rails` |

### Types

| Tool | What it catches | Run |
|------|----------------|-----|
| **sorbet** | Gradual type checking (Stripe). Inline type annotations + RBI files | `srb tc` |
| **rbs** | Ruby 3+ type signature checking | `rbs validate` |

### Security

| Tool | What it catches | Run |
|------|----------------|-----|
| **brakeman** | Static security analysis for Rails. Framework-aware | `brakeman -q` |
| **semgrep** | Custom security patterns | `semgrep --config=auto` |

### Dependencies

| Tool | What it catches | Run |
|------|----------------|-----|
| **bundle-audit** | Gem vuln scanning | `bundle-audit check --update` |

______________________________________________________________________

## PHP

### Multi-signal

| Tool | What it catches | Run |
|------|----------------|-----|
| **PHPStan** | Type inference + bug detection. Max level detects almost all type-related runtime errors. Larastan extension for Laravel | `phpstan analyse --level max` |
| **Psalm** | Static analysis with taint analysis support. Can auto-fix some issues | `psalm --show-info=true` |

### Architecture

| Tool | What it catches | Run |
|------|----------------|-----|
| **Deptrac** | Enforces layering rules between directories/namespaces. Detects architectural drift | `deptrac` |
| **PHPMetrics** | Code metrics: complexity, coupling, cohesion, LOC, Halstead, maintainability index | `phpmetrics --report-html=report .` |

### Quality & duplication

| Tool | What it catches | Run |
|------|----------------|-----|
| **PHP_CodeSniffer** | Style enforcement + some bug detection | `phpcs --standard=PSR12 .` |
| **phpcpd** | Copy/paste detection | `phpcpd .` |
| **PHPMD** | Code smells: overly complex methods, too many parameters, coupling | `phpmd . text cleancode,design,controversial` |

______________________________________________________________________

## C / C++

### Multi-signal

| Tool | What it catches | Run |
|------|----------------|-----|
| **clang-tidy** | Clang-based C++ linter. Modular, extensible. Runs Clang Static Analyzer checks too | `clang-tidy --checks='*' file.cpp` (needs compile_commands.json) |
| **cppcheck** | Static analysis focused on undefined behavior and dangerous constructs. Very few false positives | `cppcheck --enable=all --suppress=missingIncludeSystem .` |

### Dead code & includes

| Tool | What it catches | Run |
|------|----------------|-----|
| **include-what-you-use** | Analyzes #include usage: unused and missing includes. Prevents header decay | `iwyu <file>` |
| **cpplint** | Google-style C++ style checker | `cpplint --filter=-whitespace,-readability file.cpp` |

### Quality & complexity

| Tool | What it catches | Run |
|------|----------------|-----|
| **OCLint** | Static analysis for C, C++, Objective-C. High-level quality metrics | `oclint ...` |
| **flawfinder** | Security vulnerability scanner for C/C++ | `flawfinder .` |

### Dependencies

| Tool | What it catches | Run |
|------|----------------|-----|
| **semgrep** | Custom security patterns | `semgrep --config=auto` |

______________________________________________________________________

## Zig

| Tool | What it catches | Run |
|------|----------------|-----|
| **zwanzig** | Static analyzer + linter: fast AST/token rules + CFG-driven analysis built on ZIR output | `zwanzig src/` |
| **zbc** | Lifetime, ownership, and cleanup bug inference. 45 rules: flow analysis (use-after-free, double-free), structural analysis (missing deinit, unused fields) | `zbc src/` |
| **ziglint** | Linting: enforces best practices, style, consistency | `ziglint .` |
| **zlinter** | Extendable linter integrated into build.zig | Via build.zig |
| **ZLS** | Language server: diagnostics, unused variable detection, type checking | Built-in zls |

______________________________________________________________________

## Swift

| Tool | What it catches | Run |
|------|----------------|-----|
| **SwiftLint** | Style + conventions enforcement. 200+ rules, SwiftSyntax-based | `swiftlint lint` |
| **Periphery** | Unused code detection: unused functions, types, parameters. Index-based, cross-file | `periphery scan` |
| **Sourcery** | Meta-programming / code generation. Not an analyzer but reduces boilerplate | `sourcery --sources . --templates .` |

______________________________________________________________________

## Cross-language / Multi-signal

These tools cover many languages at once. Run them early.

| Tool | Languages | What it catches | Run |
|------|-----------|----------------|-----|
| **semgrep** | 30+ languages | Custom security + quality patterns, bug variants. `--config=auto` auto-selects rules | `semgrep --config=auto` |
| **SonarQube** | 30+ languages | Industry platform: bugs, vulnerabilities, code smells, complexity, duplication, security hotspots | Requires server setup (ask user first) |
| **Repowise** | 12+ languages | Code health scores, auto-generated docs, git analytics, dead code detection | SaaS |
| **CodeQL** | 12+ languages | Deep semantic analysis, taint tracking. Best for security (CVE discovery) | Requires GitHub setup |

______________________________________________________________________

## Combining with Adversarial Audit

| Finding type | Better caught by |
|--------------|-----------------|
| Logic errors, race conditions, auth bypass | Adversarial audit (Leg 1) |
| Dead code, unused exports, type errors | Intelligence tools |
| Security vulnerabilities | Both |
| Dependency issues | Intelligence tools |
| Architecture violations, cycles | Intelligence tools |

---
name: anti-slop
description: "Cut AI tells (slop) from any write-up. Use when drafting, polishing, or auditing text."
compatibility: "Requires Python 3.6+ on PATH for scripts/slop_audit.py; the skill works without it (patterns are all in SKILL.md)."
license: "Apache-2.0"
metadata:
  version: 0.0.1
---

# anti-slop

Edit text to remove AI patterns.

## Process

1. **Collect specifics.** Only when drafting from scratch; skip when editing an existing draft. Ask what only the user or repo knows: the question for this kind of piece under **The step 1 questions**. Do not write until you have it. If it doesn't exist, write thin and honest. Never invent specifics.
2. **Script pass.** Run the scorer:

   ```bash
   python3 scripts/slop_audit.py path/to/draft.md    # audit a file
   echo "text..." | python3 scripts/slop_audit.py -  # audit stdin
   ```

   Fix every flag using the pattern list below. Rebuild the sentence or inject real substance; never fix by swapping synonyms (`delve` → `look into` leaves the sentence's shape untouched). Fix in the register of the medium (below). Re-run the scorer after fixing: the pass exits only when the verdict line says `HITS 0` (exit code 0), or when every remaining hit is judged legitimate (product names like "Amazon Bedrock", technical terms like "robust API") and recorded as retained in the pass verdict. Every hit is pinpointed with its SKILL.md pattern id and `line:col`; fix the sentence it points at, not the count. Every threshold the scorer applies is defined under **Measurement**. A clean script does not end the job: patterns 28-38 are invisible to it.
3. **Hand pass.** Re-read the draft against all 38 patterns, in order, 28-38 especially: paragraph dependency, tangents, affect, density, specifics. For each pattern write one verdict line (format under **Measurement**): the id, hit or clean, and evidence. Fix every hit the way step 2 fixes, then rewrite its line. The pass is complete when all 38 lines exist; it exits when no line says hit. A pattern you cannot decide: apply the test built into the pattern (5, 28, 31, and 34 have explicit tests). If the test still does not decide, record clean with what you checked.
4. **Stop.** The draft is done when the script verdict is clean (or all flags retained) and no hand-pass line says hit. Two passes total, in this order. More passes over-polish: they sand off the specifics and tangents that make writing read human. If step 3's fixes touched anything the scorer reads, re-run the script once to confirm 0 flags, then stop regardless.

## Measurement

Verdicts are numbers and quotes, not impressions. This section defines what each pass must report; **Process** defines when to stop.

**Script pass verdict:** the scorer's `HITS n` line, one flag per metric row, each hit pinpointed as `line:col` with its pattern id. `HITS 0` = clean (exit code 0). 1-2 = borderline: fix the flagged items and re-run. 3+ = hot, the draft reads AI: rebuild, do not word-swap. Exit code 2 is a usage or IO error, not a verdict. Thresholds behind each flag:

| metric | pass | flag |
|---|---|---|
| focal words | 0 hits | any hit |
| signposting, closing rituals, sycophantic openers | 0 hits | any hit |
| em dashes (pattern 21) | 0 | any |
| negated contrast, false ranges, tricolons, question pairs, fancy "is", manufactured conversationality | 0 hits | any hit |
| participial tails (", ...ing") | 0-1 | 2+ |
| burstiness (stdev/mean of sentence length) | CV 0.45+ | CV under 0.45 |
| sentences in the 14-22 word band | under 60% | 60%+ |
| type-token ratio | 0.45+ | under 0.45 (over 200 words only) |
| bullet-line density | under 40% of lines | 40%+ |
| contractions | 1+ in casual prose | 0 (weak signal; skip for lists, commands, under 100 words) |

A metric the scorer lists under SKIPPED (list-dominant text, under 3 sentences, under 200 words) never blocks exit.

**Hand pass verdict:** for each of the 38 patterns, one line: `id: hit|clean, evidence`. Evidence is a count or a quote, never a feeling. What to pin down per pattern:

- 28: name two paragraphs that could swap without loss (hit), or the back-reference that makes each paragraph depend on the one before (clean)
- 29: the tangent count; 0 is a hit, 1-2 is the target
- 30: quote the sentence carrying an opinion, a cost, or an annoyance; none to quote is a hit
- 31: the longest paragraph vs the others; the key paragraph should be the longest
- 32: quote the final sentence; a fact or a next step passes, a mood fails
- 33: count the real names, versions, dates, error strings in the draft; 0 is a hit
- 34: for each feeling-sentence, the mechanism or number it should name, or "cut"
- 35, 36, 37: quote each hit; none means clean
- 38: compare the draft's shape to its length; a one-line answer must stay one line

Rules 1-27 can be re-run as a script pass at any point; 28-38 cannot, which is why the hand pass exists.

## The step 1 questions

Ask what this draft must contain that only the user or repo knows. Which questions depends on the piece:

- **Bugfix / incident:** what broke, the real error string, versions affected, what almost made it worse.
- **Proposal / ADR:** the constraints, the alternatives and why each lost, the decision, the cost.
- **Guide / tutorial:** versions covered, the reader's starting setup, the exact commands.
- **Announcement:** what's genuinely new vs old behavior, what users must do differently.

Whatever the kind: real names, real numbers, no invented specifics. Missing substance is better than invented substance.

## Patterns to detect and fix

Rule numbers are stable ids other skills may cite. A removed rule leaves a gap; never renumber.

### Words

1. **Focal words.** delve, tapestry, realm, pivotal, intricate, meticulous, robust, seamless, leverage, utilize, foster, elevate, underscore, showcase, landscape, testament, nuanced, holistic, comprehensive, transformative, cutting-edge, ever-evolving, crucial, paramount, garner, bolster. Delete, or replace with the specific it stands for: "a pivotal change" → "the change that let sessions survive a rebind".
2. **Signposting filler.** "it's worth noting", "it's important to note", "at its core", "when it comes to", "in the realm of", "play a pivotal role", "navigating the complexities of", "let's break it down", "that said", "more importantly", "at the same time", "in other words", "taken together", "looking ahead", "against this backdrop". Delete; they carry no information.
3. **Closing rituals.** "in conclusion", "in summary", "overall", "ultimately", "the journey doesn't end here", "hope this helps", "let me know if you'd like". Delete.
4. **Sycophancy and chatbot exclamations.** "Great question!", "You're absolutely right!", "Of course!", "Certainly!", "Found the smoking gun!". Respond directly.
5. **Abstract metaphor nouns.** substrate (→ base), landscape (→ field), tapestry (→ mix), beacon, cornerstone, bedrock (as metaphor), symphony, odyssey, paradigm, ecosystem (non-literal), interplay, dimension, framework (vague use), wedge (→ add), vector (→ way), locus, vantage, nexus, primitive (as noun), surface (as in "API surface"), scaffolding (as metaphor), modality, gold-plating (→ more than the job needs), ratchet (as metaphor), north star, flywheel, endgame (→ the last phase). Test: "the React framework" names what it contains, keep it; "a framework for thinking about X" names nothing, pick the concrete word.
6. **Inflated verbs.** leverage, utilize, harness, facilitate, streamline, empower, unlock → use, help, speed up, enable. numerous → many. The plain word wins.
7. **Vague attributions.** "Experts believe", "Industry reports suggest", "Some critics argue". Name the source or delete.
8. **Fancy ways to say "is".** "serves as", "stands as", "boasts", "features". Just say "is" or "has".

### Sentences

9. **Negated contrast.** "It's not X, it's Y." / "Not just X, but Y." State the point directly. The negation is a way to sound profound without committing to a claim. Same tell when balanced: "not speed but substance", both halves equal length and abstraction.
10. **Flattened tricolon.** "Fast. Simple. Effective." Three parallel equal-length fragments. Use the natural number of items.
11. **Superficial -ing phrases.** Openers ("Ensuring data integrity, the system...") and tails ("..., marking a pivotal moment" / "..., underscoring its importance"). The -ing phrase restates its clause. Delete it or ground it in the real fact.
12. **Filler constructions.** "In order to" → "To". "Due to the fact that" → "Because". "In the event that" → "If". "It is important to note that" → delete. Hedge stacks ("could potentially possibly be") → one "may".
13. **Dense sentences.** If the reader must backtrack to parse it, split it. One idea per sentence.
14. **Uniform sentence length.** Everything 14–22 words with no variance. Mix 3-word fragments with 30-word clausal sentences. Don't overcorrect: all-short sentences are as uniform as all-medium ones.
15. **Passive voice.** Catch "is/are/was/were + past participle" and name the actor: "queries are validated" → "the compiler validates queries", "the file is parsed by the loader" → "the loader parses the file". Passive is fine only when the actor is unknown or genuinely doesn't matter.
16. **Synonym cycling.** protagonist / main character / central figure / hero in one paragraph; same tell in tech docs: service / component / module / system for one thing. Pick one term, repeat it.
17. **False ranges.** "from X to Y" where X and Y are not on a meaningful scale. List the topics directly.
18. **Adverbs propping up weak verbs.** "runs quickly" → "is fast" or give the number. "significantly improves" → the measured delta. The adverb is covering for the wrong verb.
19. **Mannered prose.** Aphorisms ("wire it or delete it"), personified code ("the plan holds it"), figurative verbs ("rides along"), rhetorical fragments for effect. Say the literal thing: "a dial worth turning" → "a parameter worth varying".
20. **Over-compression.** Dropped articles, verbless fragments, symbol-speak: "Parser rejects bad date → exit 2, no write" → "The parser rejects a bad date, exits with code 2, and writes nothing." Write whole sentences; spell out arrows and abbreviations.

### Punctuation & formatting

21. **Em dashes.** Ban entirely; use periods or commas. No parentheses, no en dashes, no hyphen-as-dash substitutes. If a thought needs separation, end the sentence or use a comma: "agent behavior—`SYSTEM.md` represents..." → "Agent behavior is defined by `SYSTEM.md`, which represents...".
22. **Colon as connector.** Colons before lists/examples only. A colon joining two clauses ("We shipped it: all tests pass") adds a dramatic beat, not information. Rewrite as two sentences.
23. **Bold overuse.** Don't bold every noun or acronym. Inline-header bullets that restate the line ("**Performance:** Performance improved...") → prose. A bold lead-in ending in a period that names the item and is followed by genuinely new detail ("**Schema in TypeScript.** Tables live in one file.") is fine, not a tell.
24. **Title-case headings.** Use sentence case. Don't add H2/H3 to short pieces that don't need them.
25. **Emoji bullets.** 🚀 🔑 💡 ✅ → delete.
26. **Curly quotes and Unicode flair.** Straight quotes. No 𝗯𝗼𝗹𝗱 or → arrows in prose.
27. **Nested bullets for non-list ideas.** If it's a paragraph thought, write a paragraph.

### Structure (patterns 28-38: no script can score these, check by hand)

28. **Shufflable paragraphs.** If you could swap paragraph order without loss, rebuild so each one depends on the previous. A later sentence should be hard to understand without the earlier one.
29. **Zero tangents.** AI never goes sideways. Add one aside, one tangent, or one unresolved thread. One or two, not chaos.
30. **Flat affect.** No opinion or stakes anywhere; every problem turned into an opportunity; optimistic synthesis endings. Say what was annoying, what almost broke, what the real cost was, what you'd do differently.
31. **Uniform density.** Every paragraph the same length, every sentence carrying one fact: nothing marked as more important. Test: if you could move any sentence to any position without the rhythm changing, it is uniform. Let the key paragraph run long with specifics; compress transitions to a clause.
32. **Generic conclusion.** "The future looks bright." → the actual next step, plan, or fact.
33. **No concrete particulars.** No real name, version, date, or error string anywhere. Inject them or ask the user.
34. **Says how it feels, not what it does.** "the database stays close at hand", "SQL you can read" name a feeling. Name the mechanism or a number: "`.toSQL()` returns the exact string sent to the database". Test: ask what the sentence tells the reader to do or know; if you can't restate it as a concrete instruction, fact, or number, cut it. If it could appear unchanged in another project's docs, it says nothing about this one.
35. **Rhetorical question sequences.** "What does this mean? Why does it matter?" One question can be natural; a sequence manufactures suspense and adds nothing. Replace the question with the claim: "The change matters because it shifts the cost from employers to workers."
36. **Manufactured conversationality.** "Let's be honest", "Here's the thing", "Think about it this way", "The truth is". Simulates a speaker with no concrete observation behind it. Cut the phrase; the claim stands alone or it doesn't.
37. **Announced depth.** "The question is not whether X but how we respond", "The real issue is not efficiency; it is trust". Names a 'deeper issue' the paragraph hasn't earned. Either argue it or cut the frame.
38. **Mini-essay shape.** A short reply turned into framing paragraph + three numbered points + implications + takeaway + upbeat close. Match the structure to the content; a one-line answer can stay one line.

## Register by medium

Fix in the voice the medium expects:

- **PR description:** lead with the why and the trade-off, not a summary paragraph. Real file/function names. One sentence on what almost went wrong. Skip Summary/Changes/Testing boilerplate unless the repo convention demands it.
- **Issue report & comments:** exact command, real error string, real version, expected vs actual, what you tried. No moralizing about the bug.
- **Discord/Slack:** terse, fragments fine, one tangent is normal. Never a five-paragraph essay.
- **Commit message:** imperative subject, body explains why and the trade-off, real specifics, no marketing.
- **Release notes:** what changed in user-facing terms, real names/versions, no adjectives, grouped by impact.
- **Code comments & docstrings:** only what the code can't say: the why, the invariant, the failure mode. No narration of obvious steps, no promotional tone ("This elegantly handles..."). Docstrings state the contract: args, returns, failure modes.
- **PR review comments:** one thread per concern, lead with the concrete fix or question. Skip praise openers ("Great use of...") and apology stacks ("Sorry if I'm missing something, but..."). Terse and blunt beats padded and nice.
- **Design doc / ADR:** lead with the decision and its stakes, not background. Alternatives considered, with the reason each lost. One unresolved tension is fine; don't tie it off with an optimistic synthesis.
- **Any other write-up:** the 38 patterns apply regardless of medium. Default to the reader's time: lead with the point, keep specifics real, cut everything that performs writing instead of doing it.

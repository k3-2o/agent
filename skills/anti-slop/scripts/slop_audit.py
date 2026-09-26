#!/usr/bin/env python3
"""slop_audit.py: helper pre-pass for anti-slop editing.

Reads a file path or stdin (use '-' for stdin) and flags the tells a deterministic
scan can catch: word lists, sentence-length stats, punctuation, formatting. That
is its ceiling: it misses mechanical tells too, and the structural patterns
(28-38 in SKILL.md) are invisible to it.

The 38 patterns in SKILL.md are the checklist: whatever this script says, re-read
the draft against the full list. Pure stdlib, no dependencies.

Output contract (SKILL.md step 2 exits on this):
  - "HITS n" line: n = flagged metrics; the number the skill loops on
  - every flagged row carries its SKILL.md pattern id and pinpoints each hit
    with line:col plus the surrounding text, so fixes target sentences, not counts
  - sections: HITS, then CLEAN, then SKIPPED (metrics not meaningful for this
    text; a SKIP never blocks exit)
  - exit code: 0 = clean (HITS 0), 1 = flags present, 2 = usage/IO error
  - flags 1 and 21 can trip legitimately (product names, quoted examples);
    judge each hit in context, then re-run and confirm what stays

Sources for thresholds/signals:
  Kobak et al. 2025 (focal words, em-dash usage)
  GPTZero (burstiness, perplexity)
  Shaib et al. 2026 (templatedness, slop taxonomy)
  June Kim 2026 (structural tells)
"""
import re
import sys
import math
from collections import Counter

EM_DASH = "\u2014"  # em-dash character; the ASCII "--" form is too collision-prone

# ---------------------------------------------------------------------------
# Catalogs (mirrors the pattern lists in SKILL.md)
# ---------------------------------------------------------------------------

FOCAL_WORDS = {
    # Kobak excess words + 21 focal words + corporate-inflation adjectives + inflated verbs
    "delve", "delves", "delving",
    "underscore", "underscores", "underscoring",
    "showcase", "showcases", "showcasing",
    "pivotal", "intricate", "meticulously", "meticulous",
    "realm", "aligns", "alignment", "underpins", "garnered",
    "bolster", "bolstering", "notably",
    "commendable", "surpass", "elevate", "foster",
    "tapestry", "navigate", "navigating", "landscape",
    "resonate", "testament", "compelling", "paramount", "crucial", "unwavering",
    "mosaic", "ecosystem", "symphony", "labyrinth", "beacon",
    "cornerstone", "bedrock", "cacophony", "kaleidoscope", "odyssey",
    "robust", "seamless", "seamlessly", "vibrant", "dynamic",
    "comprehensive", "multifaceted", "nuanced", "holistic",
    "cutting-edge", "state-of-the-art", "transformative", "groundbreaking",
    "unparalleled", "profound", "innovative", "ever-evolving", "ever-changing",
    "leverage", "leveraging", "utilize", "harness", "streamline",
    "facilitate", "optimize", "empower", "illuminate",
    "unpack", "embrace", "unlock", "paradigm",
}

SIGNPOSTING = [
    "it's important to note", "it is important to note",
    "it's worth noting", "it is worth noting",
    "it's worth mentioning", "it is worth mentioning",
    "that being said",
    "in today's fast-paced", "in an ever-evolving",
    "navigating the complexities",
    "a deeper understanding of",
    "at its core", "at the heart of",
    "when it comes to", "in the realm of",
    "play a vital role", "play a pivotal role", "play a crucial role",
    "play a significant role", "plays a vital role", "plays a pivotal role",
    "plays a crucial role", "plays a significant role",
    "stand as a testament", "stands as a testament",
    "a nuanced take", "a nuanced understanding",
    "delve into the intricacies", "dive deep into",
    "let's break it down", "let's unpack this",
]

CLOSING = [
    "in conclusion", "in summary", "overall,", "overall.",
    "ultimately,", "ultimately.",
    "the journey doesn't end", "the journey does not end",
    "hope this helps", "let me know if you'd like me to go deeper",
    "let me know if you'd like to go deeper",
    "as we navigate", "it's essential that we", "it is essential that we",
    "remember, when",
]

# Sycophantic / tonal openers
SYCOPHANTIC = [
    "great question", "what a thoughtful question", "what a great question",
    "i'm so glad you asked", "i am so glad you asked",
    "you're absolutely right", "you are absolutely right",
    "that's a brilliant observation", "that is a brilliant observation",
    "absolutely!", "certainly!", "of course!", "sure thing",
    "found the smoking gun",
    "i'd be happy to help", "i would be happy to help",
    "let me explain", "let's dive in", "let's unpack",
]

CONTRACTIONS = [
    "i'm", "i've", "i'll", "i'd", "you're", "you've", "you'll", "you'd",
    "he's", "she's", "it's", "we're", "we've", "we'll", "we'd",
    "they're", "they've", "they'll", "they'd",
    "don't", "doesn't", "didn't", "won't", "wouldn't", "shouldn't", "couldn't",
    "can't", "cannot", "isn't", "aren't", "wasn't", "weren't", "hasn't",
    "haven't", "hadn't", "that's", "there's", "here's", "what's", "who's",
    "let's", "ain't", "y'all", "gonna", "wanna", "gotta", "kinda", "sorta",
]

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def read_input():
    if len(sys.argv) < 2:
        print("usage: slop_audit.py <file> | -  (use - for stdin)", file=sys.stderr)
        sys.exit(2)
    if sys.argv[1] == "-":
        return sys.stdin.read()
    try:
        with open(sys.argv[1], "r", encoding="utf-8", errors="replace") as f:
            return f.read()
    except OSError as e:
        print(f"error: cannot read {sys.argv[1]}: {e.strerror}", file=sys.stderr)
        sys.exit(2)

def split_sentences(text):
    # Strip markdown headings/lists markers so they don't pollute sentence stats,
    # but keep the prose. Split on sentence enders.
    s = re.sub(r"^[#>\-*\d\.\)\s]+", "", text, flags=re.MULTILINE)  # strip list/heading prefixes
    s = re.sub(r"\s+", " ", s)
    parts = re.split(r"(?<=[.!?])\s+(?=[A-Z0-9\"'`(])", s)
    return [p.strip() for p in parts if p.strip()]

def words(text):
    return re.findall(r"[A-Za-z0-9'_\-]+", text.lower())

def line_col(pos, text):
    """1-based line:col for a character offset."""
    line = text.count("\n", 0, pos) + 1
    col = pos - (text.rfind("\n", 0, pos) + 1) + 1
    return line, col

def locate(text, pos, width=40):
    """(line, col, snippet) for a hit at pos; snippet flattens newlines."""
    ln, col = line_col(pos, text)
    start = max(0, pos - 10)
    snippet = re.sub(r"\s+", " ", text[start:pos + width]).strip()
    return ln, col, snippet

def phrase_locations(text, phrases):
    """Every occurrence of each phrase as (line, col, snippet)."""
    out = []
    lower = text.lower()
    for p in phrases:
        start = 0
        while True:
            i = lower.find(p, start)
            if i < 0:
                break
            out.append(locate(text, i, len(p) + 24))
            start = i + len(p)
    return out

def fmt_hits(counter):
    if not counter:
        return "none"
    return ", ".join(f"{w}({n})" for w, n in counter.most_common())

# ---------------------------------------------------------------------------
# Row model: collect everything first, print grouped at the end
# ---------------------------------------------------------------------------

class Row:
    """One metric. passed: True clean, False flagged, None skipped."""

    def __init__(self, label, pattern, value, passed, detail, hits=None, skip=False):
        self.label = label      # metric name
        self.pattern = pattern  # SKILL.md rule id, or None when no rule covers it
        self.value = value      # measured value
        self.passed = passed
        self.detail = detail    # pass threshold and what was measured
        self.hits = hits or []  # (line, col, snippet) per occurrence
        self.skip = skip

# ---------------------------------------------------------------------------
# Main audit
# ---------------------------------------------------------------------------

def audit(text):
    lower = text.lower()
    wlist = words(text)
    n_words = max(len(wlist), 1)
    per1k = 1000.0 / n_words

    sentences = split_sentences(text)
    sent_lens = [len(words(s)) for s in sentences] if sentences else [0]
    rows = []

    # ---- Layer 1: lexical -------------------------------------------------
    # focal-word hits: scan PROSE only, not URLs/markdown link targets (those are
    # code, not writing), and skip matches that are CAPITALIZED in source (proper nouns /
    # product names like "Amazon Bedrock" rather than the AI prestige-metaphor).
    clean_spans = [m.span() for m in re.finditer(r"\]\([^)]*\)|https?://\S+", text)]
    def in_clean_span(i):
        return any(a <= i < b for a, b in clean_spans)
    focal_hits = Counter()
    focal_locations = []
    for w in FOCAL_WORDS:
        for m in re.finditer(r"\b" + re.escape(w) + r"\b", text):
            if m.group(0)[:1].isupper() or in_clean_span(m.start()):
                continue
            focal_hits[w.lower()] += 1
            focal_locations.append(locate(text, m.start(), len(w) + 24))
    rows.append(Row(
        "focal words", "1", sum(focal_hits.values()), len(focal_hits) == 0,
        "pass 0 hits; got " + fmt_hits(focal_hits),
        hits=focal_locations))

    sign_hits = Counter()
    for p in SIGNPOSTING:
        n = lower.count(p)
        if n:
            sign_hits[p] += n
    rows.append(Row(
        "signposting phrases", "2", sum(sign_hits.values()), len(sign_hits) == 0,
        "pass 0; got " + fmt_hits(sign_hits),
        hits=phrase_locations(text, list(sign_hits))))

    close_hits = Counter()
    for p in CLOSING:
        n = lower.count(p)
        if n:
            close_hits[p] += n
    rows.append(Row(
        "closing rituals", "3", sum(close_hits.values()), len(close_hits) == 0,
        "pass 0; got " + fmt_hits(close_hits),
        hits=phrase_locations(text, list(close_hits))))

    # em dashes: count ONLY the real U+2014 character. SKILL.md bans them entirely
    # (pattern 21). Examples quoting the dash inside pattern docs will trip this;
    # that is expected self-reference.
    em_locations = [locate(text, m.start(), 34) for m in re.finditer(EM_DASH, text)]
    em = len(em_locations)
    rows.append(Row(
        "em dashes", "21", f"{em} ({em * per1k:.1f}/1000)", em == 0,
        "pass 0, any density; use periods or commas",
        hits=em_locations))

    # curly quotes (pattern 26) and emoji bullets / unicode bold (patterns 25/26)
    curly_locations = [locate(text, m.start(), 30)
                       for m in re.finditer("[\u2018\u2019\u201c\u201d]", text)]
    rows.append(Row(
        "curly quotes", "26", len(curly_locations), len(curly_locations) == 0,
        "pass 0; straight quotes only",
        hits=curly_locations))

    flair_locations = ([locate(text, m.start(), 30)
                        for m in re.finditer(r"^\s*[\U0001F680\U0001F511\U0001F4A1\u2705\U0001F3AF\U0001F525\U0001F4CC]\s", text, flags=re.MULTILINE)]
                       + [locate(text, m.start(), 20)
                          for m in re.finditer(r"[\U0001D5D4-\U0001D607]", text)])
    rows.append(Row(
        "emoji bullets / unicode bold", "25/26", len(flair_locations), len(flair_locations) == 0,
        "pass 0",
        hits=flair_locations))

    # ---- Layer 2: structure ----------------------------------------------
    # bullet / list density: computed early because burstiness is only meaningful for PROSE.
    # A list-dominant text (commands, validation steps) legitimately has little prose; flagging
    # its burstiness would be a false positive.
    bullets = len(re.findall(r"^\s*[-*]\s", text, flags=re.MULTILINE))
    bullet_pct = bullets / max(len(text.splitlines()), 1)
    list_dominant = bullet_pct >= 0.40

    mean = sum(sent_lens) / len(sent_lens) if sent_lens else 0
    var = sum((x - mean) ** 2 for x in sent_lens) / len(sent_lens) if sent_lens else 0
    sd = math.sqrt(var)
    cv = sd / mean if mean else 0
    if list_dominant or len(sentences) < 3:
        why = "list-dominant" if list_dominant else f"only {len(sentences)} sentences"
        rows.append(Row(
            "burstiness (stdev/mean CV)", "14", f"{cv:.2f}", None,
            f"skipped: {why}; burstiness is a prose metric", skip=True))
        burstiness_flag = False
    else:
        rows.append(Row(
            "burstiness (stdev/mean CV)", "14", f"{cv:.2f}", cv >= 0.45,
            f"pass CV 0.45+; mean {mean:.1f}, sd {sd:.1f}, min {min(sent_lens)}, max {max(sent_lens)}"))
        burstiness_flag = cv < 0.45

    # uniformity: too many sentences in 14-22 band
    mid = sum(1 for l in sent_lens if 14 <= l <= 22)
    mid_pct = mid / len(sent_lens) if sent_lens else 0
    if list_dominant:
        rows.append(Row(
            "sentences in 14-22 word band", "14", f"{mid_pct * 100:.0f}%", None,
            "skipped: list-dominant", skip=True))
        mid_flag = False
    else:
        rows.append(Row(
            "sentences in 14-22 word band", "14", f"{mid_pct * 100:.0f}%", mid_pct < 0.6,
            f"pass under 60%; got {mid}/{len(sentences)} uniform-length sentences"))
        mid_flag = mid_pct >= 0.6

    # contractions: humans use them in casual prose, AI near-zero. BUT technical PR
    # descriptions / docs are legitimately contraction-free by convention, so this is a
    # WEAK signal: only flag when the text reads as casual prose (not list/command-dominant).
    contra = sum(len(re.findall(r"\b" + re.escape(c) + r"\b", lower)) for c in CONTRACTIONS)
    if n_words < 100 or list_dominant:
        why = "under 100 words" if n_words < 100 else "list-dominant; contraction-free is legit in technical writing"
        rows.append(Row(
            "contractions", None, contra, None, f"skipped: {why}", skip=True))
    else:
        rows.append(Row(
            "contractions", None, contra, contra >= 1,
            f"pass 1+ in casual prose; got {contra}"))

    # negated contrast "not X but Y" / "isn't just"
    neg_seen = set()
    neg_locations = []
    for m in re.finditer(r"\bnot (?:just|merely|only|simply)\b.{0,40}?\b(?:but|\u2014|--)", lower, re.DOTALL):
        neg_seen.add(m.start())
    for m in re.finditer(r"\b(?:isn't|don't|doesn't|aren't|not) (?:just|merely|only|simply)\b", lower):
        if m.start() not in neg_seen:
            neg_seen.add(m.start())
            neg_locations.append(locate(text, m.start(), 44))
    rows.append(Row(
        "negated contrast ('not X, but Y')", "9", len(neg_locations), len(neg_locations) == 0,
        "pass 0; state the point directly instead",
        hits=neg_locations))

    # participial tail: ", <word>ing ..." at sentence end
    ptail_locations = [locate(text, m.start(), 50)
                       for m in re.finditer(r",\s+\w+ing\b[^.!?]{0,60}?$", text, flags=re.MULTILINE)]
    rows.append(Row(
        "participial tails (', ...ing')", "11", len(ptail_locations), len(ptail_locations) <= 1,
        "pass 0-1, flag 2+",
        hits=ptail_locations))

    # false ranges: "from X to Y" where the pair isn't a scale. Cheap heuristic:
    # catches "from authentication to deployment", ignores dates/numbers ("from 2020 to 2024")
    # and single-word spans ("from Monday to Friday" stays, both capitalized days are real days).
    frange_locations = [locate(text, m.start(), 44)
                        for m in re.finditer(r"\bfrom [a-z]{6,} to [a-z]{6,}\b", text)]
    rows.append(Row(
        "false ranges ('from X to Y')", "17", len(frange_locations), len(frange_locations) == 0,
        "pass 0; dates and number scales exempt",
        hits=frange_locations))

    # tricolons: 3 consecutive short sentences <=5 words (locations not mapped back
    # to source; the count plus SKILL.md pattern 10 is enough to find them)
    tri = sum(1 for i in range(len(sent_lens) - 2)
              if 0 < sent_lens[i] <= 5 and sent_lens[i + 1] <= 5 and sent_lens[i + 2] <= 5)
    rows.append(Row(
        "tricolon candidates (3x short)", "10", tri, tri == 0,
        "pass 0; three equal-length fragments in a row"))

    # type-token ratio (lexical diversity): only meaningful for >200 words
    if n_words > 200:
        ttr = len(set(wlist)) / n_words
        rows.append(Row(
            "type-token ratio", None, f"{ttr:.2f}", ttr >= 0.45,
            f"pass 0.45+; got {ttr:.2f} (under 0.45 = repetitive)"))
    else:
        rows.append(Row(
            "type-token ratio", None, "-", None,
            f"skipped: needs over 200 words (have {n_words})", skip=True))

    # bullet density is computed early (gates burstiness); just report it here
    rows.append(Row(
        "bullet-line density", None, f"{bullet_pct * 100:.0f}%", bullet_pct < 0.4,
        f"pass under 40% of lines; got {bullets} bullet lines"
        + (" (legit for command/validation lists; judge in context)" if list_dominant else "")))

    # fancy ways to say "is" (skill pattern 8)
    fancy_hits = Counter({p: n for p in ("serves as", "stands as", "boasts", "features ")
                          if (n := lower.count(p))})
    rows.append(Row(
        "fancy 'is' (serves as / boasts)", "8", sum(fancy_hits.values()), sum(fancy_hits.values()) == 0,
        "pass 0; say 'is' or 'has'; got " + fmt_hits(fancy_hits),
        hits=phrase_locations(text, list(fancy_hits))))

    # manufactured conversationality (skill pattern 36): voice without a voice
    convo_hits = Counter({p: n for p in ("let's be honest", "here's the thing",
                                         "think about it this way", "the truth is")
                          if (n := lower.count(p))})
    rows.append(Row(
        "manufactured conversationality", "36", sum(convo_hits.values()), sum(convo_hits.values()) == 0,
        "pass 0; got " + fmt_hits(convo_hits),
        hits=phrase_locations(text, list(convo_hits))))

    # rhetorical question sequences (skill pattern 35): 2+ questions in short span
    qseq_locations = [locate(text, m.start(), 60)
                      for m in re.finditer(r"\?\s*[^.!?]{0,80}\?", text)]
    rows.append(Row(
        "rhetorical question sequences", "35", len(qseq_locations), len(qseq_locations) == 0,
        "pass 0; one question is natural, a sequence is not",
        hits=qseq_locations))

    # sycophantic opener (first ~3 sentences). The opener is the head of the text,
    # so the first occurrence of any opener phrase IS the opener occurrence.
    opener = " ".join(sentences[:3]).lower() if sentences else lower[:200]
    syc_hits = [s for s in SYCOPHANTIC if s in opener]
    syc_locations = [locate(text, lower.find(s), len(s) + 24) for s in syc_hits]
    rows.append(Row(
        "sycophantic opener", "4", len(syc_hits), len(syc_hits) == 0,
        "pass 0 in the first 3 sentences; respond directly instead"
        + ("; got " + ", ".join(syc_hits) if syc_hits else ""),
        hits=syc_locations))

    # ---- Output ----------------------------------------------------------
    W = 74
    print("=" * W)
    print(f"SLOP AUDIT : {n_words} words, {len(sentences)} sentences")
    print("=" * W)

    flagged = [r for r in rows if r.passed is False]
    n_flags = len(flagged)

    if flagged:
        print("\nHITS (fix or judge each; [id] = SKILL.md pattern)")
        print("-" * W)
        for r in flagged:
            pat = f"[{r.pattern}]" if r.pattern else " [ ]"
            print(f"  {pat} {r.label}: {r.value}")
            print(f"      {r.detail}")
            for ln, col, snip in r.hits:
                print(f"      at {ln}:{col}  ...{snip}...")
            if not r.hits:
                print(f"      (count only; locate via SKILL.md pattern {r.pattern or '-'})")

    print("\nCLEAN")
    print("-" * W)
    for r in rows:
        if r.passed is True:
            pat = f"[{r.pattern}]" if r.pattern else "   "
            print(f"  {pat} {r.label:<38} {r.value}")

    skips = [r for r in rows if r.skip]
    if skips:
        print("\nSKIPPED (not meaningful for this text; never blocks exit)")
        print("-" * W)
        for r in skips:
            print(f"      {r.label:<38} {r.value}  ({r.detail})")

    # ---- verdict: the number SKILL.md step 2 loops on ----------------------
    print("\n" + "=" * W)
    if n_flags == 0:
        print("HITS 0 : script pass clean. Step 2 exit criteria met.")
        print("  Next: hand pass (SKILL.md step 3) against all 38 patterns, one")
        print("  verdict line each: `id: hit|clean, evidence`, evidence a count or")
        print("  quote, never a feeling (28-38 are invisible to this script:")
        print("  dependency, tangents, affect, density, specifics). If the hand pass")
        print("  changed anything the scorer reads, one confirm re-run, then stop.")
        sys.exit(0)
    elif n_flags <= 2:
        print(f"HITS {n_flags} : borderline. Loop: fix each hit above per its [id] in")
        print("  SKILL.md (rebuild the sentence, never swap synonyms), re-run until")
        print("  HITS 0. A hit you keep (product name, quoted example, code): record")
        print("  why in the verdict. At HITS 0: hand pass against all 38 patterns,")
        print("  format `id: hit|clean, evidence`, then stop.")
        sys.exit(1)
    else:
        print(f"HITS {n_flags} : hot, this reads AI. Do not swap words; rebuild the")
        print("  draft: grounded specifics, dependency chains, varied sentence length,")
        print("  one tangent, one opinion. The hits above are what to rebuild around;")
        print("  each still needs its [id] fix or a recorded reason to keep it.")
        print("  Re-run until HITS 0, then hand pass against all 38 patterns (`id:")
        print("  hit|clean, evidence`), then stop.")
        sys.exit(1)

if __name__ == "__main__":
    audit(read_input())

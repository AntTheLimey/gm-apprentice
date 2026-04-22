# Testing Methodology

How we benchmark skill changes to prove they add value
without degrading quality.

## The Pattern

Every feature PR gets a benchmark comparing **control**
(previous version or no-skill baseline) against **test**
(with the change). Same model, same questions, blind
evaluator.

### 1. Design test questions

3-5 scenario-based questions that exercise the specific
capability being added or changed. Questions should test
what a GM would actually ask during play or prep.

**Question types by GM activity:**
- **Table prep:** "Help a player create a character"
- **Session prep:** "Plan an encounter / build an NPC"
- **Run:** "What's the stat for X?" / "failed roll, now what?"
- **Track:** "What changed after that session?"
- **Build:** "What do the factions do in response?"

### 2. Run control and test

**Control agent** (sonnet, no file access):
```text
You are a TTRPG GM assistant. Answer each question concisely
(under 150 words each). Do NOT read any files.
[questions]
```

**Test agent** (sonnet, with SKILL.md entry point):
```text
You are a TTRPG GM assistant. Read the skill entry point:
/path/to/skills/ttrpg-expert/SKILL.md
Follow routing to find the right files for each question.
[questions]
```

For compaction/refactoring passes where the control is the
previous version (not no-skill), run the control on main
branch and the test on the feature branch. Same model,
same questions.

### 3. Blind evaluation

**Evaluator** (opus) scores both answers without knowing
which is control or test. Randomise A/B assignment.

### 4. Scoring Rubric

5 dimensions, 1-3 each, 15 max per question:

| Dimension | 1 (Poor) | 2 (Partial) | 3 (Nailed it) |
|-----------|----------|-------------|----------------|
| **Factual accuracy** | Wrong stats, hallucinated names | Mostly correct, minor errors | All verifiable facts correct |
| **System specificity** | Could be any system, no mechanics | Right system but generic | Uses system-specific idiom, conventions, tone |
| **Actionability** | Needs significant rework | Usable with GM effort | Drop-in ready, use as-is |
| **Mechanical grounding** | No concrete numbers or values | Some mechanics but incomplete | Specific stats, DCs, costs, rolls, thresholds |
| **Table-ready fiction** | Generic/obvious/AI slop | Fits system but predictable | Evocative, system-native, sparks play — GM sees how it plays out |

### 5. Record metrics

For every benchmark, record:
- **Tokens:** control vs test (from agent usage report)
- **Time:** control vs test (from agent duration_ms)
- **Tool uses:** how many files read
- **Quality:** per-question scores and total
- **Delta:** test minus control

### 6. Save results

Save test plans and benchmark results to `tests/` locally
(gitignored — results are run-specific artifacts). This
methodology doc in `docs/` is the persistent reference.

## What to benchmark

| Change type | Control | What to measure |
|-------------|---------|-----------------|
| New feature (new file/framework) | No-skill baseline | Quality delta: does the feature help? |
| Content enrichment (SRD data) | No-skill baseline | Accuracy + hallucination prevention |
| Compaction/refactoring | Previous version (main branch) | Quality ≥ same, tokens ≤ same |
| Bug fix / accuracy fix | Previous version | Quality improved, nothing regressed |

## Key lessons learned

1. **Routing prose compresses aggressively. Priming must
   be preserved.** "Read arc-spotlight-reference.md" is
   routing. "Flag below 15% floor. Assign B/C plots." is
   priming. Cutting priming degrades output quality.

2. **System-specific terminology matters.** Using BRP-generic
   terms for CoC 7e made the skill WORSE than no skill.
   Always match the system the GM expects.

3. **Named frameworks with thresholds produce dramatically
   better output.** "Give underserved PCs more scenes" vs
   "Delgado is below the 15% floor, assign B-plot" — the
   latter scored +6 points higher.

4. **The "bad guys advance on their own timeline" principle**
   should frame every world-evolution proposal. Without it,
   faction turns feel reactive. With it, the world has
   momentum.

5. **"Apprentice proposes, GM decides"** — all world state
   proposals must be recommendations. Be decisive and named
   in the proposals, but never file without GM approval.

6. **Evaluator variance is real.** Same control answers
   scored 128 by one evaluator and 108 by another. Within-
   run deltas are meaningful; cross-run absolute comparisons
   are not. Future improvement: run evaluations 3x and
   average.

## Benchmark history

| PR | Feature | Ctrl Tokens | Test Tokens | Ctrl Time | Test Time | Quality Delta | Key finding |
|----|---------|:-----------:|:-----------:|:---------:|:---------:|:------------:|-------------|
| #3 | SRD (CoC v3) | 8,732 | 42,988 | 18.2s | 50.7s | +23/72 | System-specific terms essential; BRP-generic caused regression |
| #3 | SRD (FitD) | 8,671 | 27,831 | 16.4s | 32.0s | +16/75 | Biggest win on least-known system (hallucination prevention) |
| #3 | SRD (D&D) | 8,914 | 50,336 | 22.7s | 83.8s | +9/75 | Mechanical precision improved |
| #4 | Quick Commands | 8,962 | 42,342 | 21.1s | 43.2s | +22/75 (75/75) | Named frameworks >> general wisdom |
| #5 | World Evolution v2 | 10,710 | 44,123 | 57.0s | 124.7s | +27/150 | Decisiveness guidance flipped every question |
| #5 | Impact Classification | 8,870 | 32,595 | 16.4s | 51.0s | +5/45 | Consistent teachable vocabulary |
| #6 | Temporal Fields | 9,040 | 26,847 | 20.4s | 32.6s | +15/60 | Strongest per-question improvement (+3.75 avg) |
| #7 | Canonical Timeline | 8,731 | 28,584 | 13.9s | 56.0s | +19/60 | Perfect 15/15 on fact-checking |
| #8 | Compaction* | 42,533 | 41,371 | 48.1s | 45.9s | +15/75 | 59% smaller files, quality improved |
| #9 | Compaction Pass 2* | 38,949 | 25,170 | 96.3s | 82.8s | +8/75 | 58% smaller (3 files), -35% tokens, system-native idiom improved |
| #10 | Compaction Pass 3*† | 53,805 | 29,296 | 122.0s | 84.4s | -2/75 (median) | 50% smaller (6 files), -46% tokens, quality-neutral within variance |
| #11 | Compaction Pass 4*‡ | 34,958 | 38,322 | 57.2s | 74.1s | +10.5/75 (avg runs 2-3) | 40% smaller (4 ref files) + cross-routing; routing drove +8 to +13 quality |

*Compaction control is pre-compaction (main), not no-skill.
†3-run average; median delta -2, mean -4 (Run 1 outlier at -9).
‡3-run: run 1 compaction-only (+1), runs 2-3 with cross-routing (+13, +8).

**Averages (excluding compaction):**
- Control: ~9,200 tokens, ~23s
- Test: ~37,000 tokens, ~59s
- Overhead: ~4x tokens, ~2.6x time
- Quality delta: always positive (+5 to +27)

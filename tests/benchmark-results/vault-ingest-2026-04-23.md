# Benchmark: Vault Ingest Skill

**Date:** 2026-04-23
**Branch:** feature/vault-ingest
**Change:** New vault-ingest skill (SKILL.md + 3 reference files)
**Questions:** 8 (vault-ingest.md)
**Models:** claude-sonnet-4-6 (agent), claude-opus-4-6 (evaluator)
**Type:** New skill — absolute quality evaluation, no A/B control

## Metrics

### Test (vault-ingest skill)

- **Tokens:** 36,111
- **Time:** 368.9s
- **Tool uses:** 17

## Results by Question

### Q1 — Prep-vs-play discrimination
Correctly classified all 7 sections of mixed-source.md:
- NPC prep blocks → scenario prep (conditional language)
- Dice roll sections → play fragment (specific rolls, outcomes)
- Historical Q&A → research/brainstorm (no session connection)
- First-person past tense → keeper recollection
- "What if" questions → research/brainstorm

### Q2 — Name deduplication
Identified name variants: Prof./Dr. Blackwood → Brother Ezra
(per fixture's explicit note), Flanagan/informant, Helena/Eleanor
Voss discrepancy. Correctly flagged Rourke and Father Matthias
as new distinct entities.

### Q3 — Canon confidence
Correct assignments: play fragments → AUTHORITATIVE (cited dice
rolls), keeper recollections → AUTHORITATIVE (cited first person),
prep sections → DRAFT, research → NOT CANON. Noted stat block
discrepancy between prep and vault file. Applied UNVERIFIED marker
to uncertain keeper reflection.

### Q4 — Interview questions
Three contextual, scene-framed, single questions:
1. Major outcome (warehouse entry after chase)
2. Item provenance (stone tablets carrier/identification)
3. NPC follow-up (Flanagan after Session 1)
Each used contextual framing with specific scene details to
trigger memory. Good follow-the-thread reasoning.

### Q5 — Synthesized Play Notes
Complete Play Notes file with:
- Correct frontmatter (type: session-play-notes, created_by: vault-ingest)
- Reconstruction Note with source list and limitations
- 5 scenes with source citations, entity links, mechanical events
- Entity Flags using NEW-NPC, NEW-LOC, UPDATE shorthand
- Unresolved Items checklist
- Source Material Index
Schema-conformant and processable by session-wrapup.

### Q6 — Image classification
Correct routing: character sheet → extraction attempt + flag,
map → extraction on labels + flag, portrait → file and link only.
Correct _attachments/ subfolder assignments.

### Q7 — Bootstrap detection
Reproduced exact bootstrap dialogue. Correctly refused to proceed.
Described campaign-organizer handoff and external path option.

### Q8 — Bucket sorting
Four buckets + unsorted:
1. Pre-Session 1 prep (probable)
2. Session 1 play (certain)
3. Session 2 play (certain)
4. Session 4 play (certain)
5. Unsorted: between-S2-S3 brainstorm (probable)
Correctly identified Session 3 as a gap requiring keeper interview.
Clear sorting signals cited for each bucket.

## Assessment

All 8 questions answered with high quality. The skill files
effectively guide agents through classification, interview
technique, synthesis, and pipeline decisions. Key strengths:

- **Classification accuracy**: Perfect prep/play discrimination
  using the heuristics from classification-taxonomy.md
- **Interview quality**: Contextual, single, memory-triggering
  questions following keeper-interview.md technique
- **Schema conformance**: Play Notes output follows document
  chain standard exactly, processable by session-wrapup
- **Edge case handling**: Bootstrap detection, UNVERIFIED markers,
  missing session gaps all handled correctly

No regressions or quality concerns identified.

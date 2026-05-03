---
type: quality-comparison
baseline: tests/proof-runs/phase-0-baseline/run-4
test: tests/proof-runs/phase-1/run-2
date: 2026-05-02
reviewer: quality-checker-agent
---

# Quality Comparison: Phase-0 Baseline Run-4 vs Phase-1 Run-2

Evaluated against ground-truth reference files by quality-checker agent on 2026-05-02.
Each response was checked for factual accuracy against the specific reference file,
completeness of required content, and fidelity to framework specifications.

Notation: "Baseline" = phase-0-baseline/run-4. "Test" = phase-1/run-2.

---

## Summary Table

| # | Query | Verdict | Key Reason |
|---|-------|---------|------------|
| 1 | CoC 7e Chase Rules | BASELINE BETTER | Baseline more complete; includes Keeper guidance, vehicle chases, firearms ruling |
| 2 | CoC NPC: Paranoid Antiquarian | EQUIVALENT | Both follow AIMS/output format; different strengths in GM notes vs artefact hooks |
| 3 | Regency Cthulhu Occupations | TEST BETTER | Baseline misplaces Archaeologist in Band 2 (should be Band 3); test has no errors |
| 4 | GURPS 4e Grappling | EQUIVALENT | Both accurate; baseline more mechanically exhaustive; test better organized with page refs |
| 5 | GURPS Cat Burglar 150 pts | BASELINE BETTER | Baseline includes Multi-Action Combat Chains (required by output template); test omits them |
| 6 | D&D 5e Paladin Features | EQUIVALENT | Both accurate; test adds GM context notes on 2014 vs 2024 changes |
| 7 | Three Clue Rule Murder Mystery | TEST BETTER | Test more complete: clue redundancy map, skill check table, multiple climax variants |
| 8 | FitD Fortune Rolls | EQUIVALENT | Both accurate and complete; test adds worked example; baseline includes engagement roll table |
| 9 | FitD Score vs Billhooks | TEST BETTER | Test more complete: 6 plan types, fuller complications table, explicit outcome matrix |
| 10 | Improvised Suspicious NPC | EQUIVALENT | Baseline's pause-tell detail vs test's stronger moves timeline; minor test terminology slips |
| 11 | Universal Faction Turn | BASELINE BETTER | Baseline includes the GM-approval constraint; test omits this operational requirement |
| 12 | Session Prep Session 4 | TEST BETTER | Test includes version-check step, more complete gaps table, more precise spotlight math |

**Score: Baseline better: 3 | Test better: 4 | Equivalent: 5**

---

## Detailed Findings

---

### Query 1 — CoC 7e Chase Rules

**Ground truth:** `skills/ttrpg-expert/systems/coc-7e/combat-reference.md`

The reference covers the Flee action (listed as a standard combat action), the MOV
determination table (STR and DEX vs SIZ comparison), and the note that combat rules
(including Dodge as a reaction without losing movement) apply within a chase. Full
chase procedures are in `rules-reference.md`, which both responses also loaded.

**Accuracy**

Both responses are accurate. The MOV table is correct in both. Both correctly describe
the abstract track, hazard navigation, sprint (CON roll for +1 space), and resolution
conditions (caught = same space; escaped = end of track or uncloseable gap). No errors
against ground truth in either response.

**Completeness**

Baseline is more complete: vehicle chases, firearms during a chase (penalty die for
shooting while running), the Keeper guidance section covering track length,
hazard pacing, and the note that "once a pursuer is in the same space as the quarry,
normal combat begins" with quarry still able to flee again.

Test adds one accurate structural element the baseline lacks: explicit note that the
chase "begins when a character declares the Flee action during a combat round" —
sourced correctly from the combat structure. But test omits the vehicle chase rules,
firearms penalty, and Keeper guidance.

**Verdict: BASELINE BETTER** — more complete operational coverage; no accuracy issues
in either response.

---

### Query 2 — CoC 7e NPC: Paranoid Antiquarian

**Ground truth:** `skills/ttrpg-expert/npc-generation.md`

Reference defines the AIMS framework (Agenda/Instinct/Moves/Secrets with three secret
layers), the relationship web (1-2 connections for minor NPC, 5-8 for antagonist),
and full CoC 7e NPC generation (all 8 characteristics, derived stats, occupation
skills, AIMS profile, sanity-relevant details including Cthulhu Mythos and Max SAN).

**Accuracy**

Both responses correctly apply the full AIMS framework. Both produce complete CoC 7e
stat blocks with all 8 characteristics, derived stats, and Cthulhu Mythos. Both use
the Antiquarian occupation (EDU×4 skill points), which is correct.

Baseline (Reginald Tench): SAN 28, Mythos 14%, Max SAN = 99 − 14 = 85. Arithmetic
correct. Moves are specific, named, on a timeline. Relationship web has 4 connections
(in line with "Supporting" NPC range of 3-5 per the reference).

Test (Cornelius Vane): SAN 31, Mythos 08%, Max SAN = 91. Consistent. Relationship
web has 4 connections. Moves have specific detail including the "will fail" moment
(destroying the smallest artefact). The three artefacts are explicitly left vague as
GM hooks — consistent with the reference's "Generation from Constraints" guidance.

No factual errors in either response.

**Completeness**

Both are highly complete. Baseline has a more detailed leverage-points section in
GM Notes. Test has a richer possessions section and a stronger design note about
the artefacts as deliberate hooks.

**Verdict: EQUIVALENT** — both produce accurate, complete NPCs following all reference
requirements. Baseline has better running leverage notes; test has a cleaner hook
structure. Neither is meaningfully superior.

---

### Query 3 — Regency Cthulhu Occupations

**Ground truth:** `skills/ttrpg-expert/systems/coc-7e/variants/regency/occupations.md`

Reference contains: full occupation list (49 occupations, with bold/†/* markers);
five new Regency stat blocks; five occupational bands with CR ranges and occupation
lists; cross-reference to base file; notes on Butler/Valet/Maid CR cap and Band 2
artistic occupations.

**Accuracy**

Key checks on the occupational band table:

| Occupation | Reference band | Baseline | Test |
|---|---|---|---|
| Archaeologist | Band 3 (Professional) | Band 2 (error) | Band 3 (correct) |
| Librarian | Band 2 | Band 2 (correct) | Band 2 (correct) |
| Museum Curator | Band 2 | Band 2 (correct) | Band 2 (correct) |

Baseline places Archaeologist in Band 2 (Shopkeeper/Craftsperson). The reference
places Archaeologist explicitly in Band 3 (Professional), alongside Accountant,
Antiquarian, Architect, Clergy, Doctor, Explorer, Lawyer, Military Officer, Professor,
Researcher. This is a factual error.

Test does not make this error. Archaeologist appears only in Band 3 in the test.

All stat block details (Gentleman, Gentlewoman, Nouveau Riche, Servant Footman,
Servant Housemaid — formulas, CR ranges, skill lists) are accurate in both responses.

Test includes a Keeper Notes section on period skill substitutions (Drive Auto →
Drive Carriage). This is consistent with the reference's cross-reference note and
adds practical value.

**Verdict: TEST BETTER** — the Archaeologist band classification error in baseline
is a clear factual mistake against the reference table. Test is accurate throughout.

---

### Query 4 — GURPS 4e Grappling System

**Ground truth:** `skills/ttrpg-expert/systems/gurps-4e/combat.md`

Reference contains a "Grappling (Quick Reference)" section with four steps: Grab
(Attack maneuver, roll vs DX/Brawling/Judo/Wrestling, active defense available),
Maintain (free action), Follow-up (Quick Contest of ST or grappling skill), Break
free (Quick Contest). Grappled target is at -4 DX.

**Accuracy**

Both responses accurately expand the quick reference into a full procedural guide.
Both correctly state the -4 DX penalty on the grappled target. Both accurately
describe the four-step sequence. Quick Contest mechanics for follow-ups correctly
identified in both.

Baseline adds Finger Lock and Neck Snap from the chargen-kit-thief.md (which it
loaded) — accurate. Notes Wrestling gives ST bonus for follow-ups — accurate.
Size Modifier effects on grappling — accurate expansion.

Test adds hit-location targeting for grapples (arm, leg, torso) with location
penalties — accurate per GURPS rules. Relevant Traits section (Wrestling, Judo,
HPT, Combat Reflexes) — all accurate. Page references at end (B370-371, B230) —
accurate to the source citation in combat.md.

No factual errors in either response.

**Completeness**

Baseline: more mechanically exhaustive (full technique table including Finger Lock
and Neck Snap, SM modifier effects, multiple grapplers rule).

Test: better organizationally (Relevant Traits, Tactical Notes, page references that
the reference itself cites).

**Verdict: EQUIVALENT** — baseline is more mechanically complete; test is more
practically organized with page references. Neither has errors.

---

### Query 5 — GURPS 4e Cat Burglar, 150 points

**Ground truth:** `skills/ttrpg-expert/systems/gurps-4e/chargen-kit-thief.md`
and `skills/ttrpg-expert/systems/gurps-4e/character-generation.md`

The character-generation.md output format template requires: Attributes, Secondary
Characteristics, Advantages, Disadvantages, Quirks, Skills (with costs/levels/
controlling attribute), Equipment (from starting wealth, with encumbrance calculated),
**Multi-Action Combat Skill Chains**, Combat Summary, Point Summary. The chargen-kit
specifies physical path (DX 13+), near-mandatory Flexibility or Double-Jointed,
Luck as efficient, and 150-pt point allocation ranges (Attributes 80-100, etc.).

**Accuracy**

Both characters are mechanically sound with totals verified at 150 pts.

Baseline (Sylvie Marchetti, DX 14, IQ 12, HT 11): Final verified total 150 pts.
Advantages: Flexibility [5], Perfect Balance [15], Night Vision 3 [3] = 23 pts.
Disadvantages -45 pts. Skills 37 pts. Encumbrance calculated correctly (Light ~6.25
lbs on job; Medium ~26.25 lbs full kit). Skill levels spot-checked: Stealth DX/A 8
pts = DX+1 = 15 (correct), Climbing DX/A 4 pts = DX+1 = 15 (correct), Escape DX/H
2 pts = DX-1 = 13 (correct). Multi-Action Combat Chains present (Break-In routine
and Blown Cover escape sequence). SJG policy compliance note present.

Test (Mara Kessler, DX 14, IQ 12, HT 11): Total 150 pts. Advantages: Flexibility
[5], Luck [15], Night Vision 3 [3] = 23 pts (follows kit reference more closely —
Luck is listed as "essential safety net"). Disadvantages -45 pts. Skills 42 pts.
Encumbrance calculated correctly (operational ~11 lbs = Light; full ~30 lbs = Medium).
Skill levels spot-checked: Stealth DX/A 4 pts = DX+0 = 14 (wait — at 4 pts for
Average difficulty: 4 pts = Attr+1 = DX+1 = 15, but test lists Stealth 15 at 4 pts.
Re-check: skill cost table in character-generation.md: A difficulty 4 pts = Attr+1.
DX 14 + 1 = 15. Test is correct.

**Format compliance**

Baseline includes Multi-Action Combat Chains as required by the character-generation
output template. Two chains are present (Break-In and Blown Cover).

Test does not include Multi-Action Combat Chains. The character-generation output
format explicitly requires this section: "Multi-Action Combat Skill Chains: Chain [N]:
[Name] ([N]-Turn), Situation: [when to use], | Turn | Maneuver | Action | Roll |
Notes |." This section is absent from the test.

No factual errors in either response. Both are mechanically sound. The difference is
format completeness.

**Verdict: BASELINE BETTER** — baseline follows the character-generation output
format template more completely. Multi-Action Combat Chains are a required section
and are present in baseline but absent in test.

---

### Query 6 — D&D 5e Paladin Class Features

**Ground truth:** `skills/ttrpg-expert/systems/dnd-5e-2024/classes.md`

Reference provides: Paladin table (Level/Key Features/Channel Div/Prepared); all
features through level 18; SRD subclass Oath of Devotion (Sacred Weapon and Holy
Nimbus); half-caster spell slot progression; SRD 5.2 attribution note.

**Accuracy**

Both responses are accurate against the reference.

Level 1 Weapon Mastery: Baseline — "Can use the Mastery property of Simple and
Martial weapons you are proficient with." Test — "You can use the Mastery property
of two weapons you are proficient with." The reference says only "Weapon Mastery"
in the table; neither version is wrong, but test adds "two weapons" which is a PHB
detail not in the SRD reference file. Minor.

Paladin's Smite: Both describe it as reaction-triggered (2024 change). Test adds
"+1d8 extra if the target is an Undead or Fiend" — not in the SRD reference. Minor
addition from PHB knowledge; not contradicted.

Channel Divinity: both show 2 uses at Level 3, rising to 3 at Level 11. Correct.

Oath of Devotion: Both include Sacred Weapon and Holy Nimbus. Baseline labels Holy
Nimbus as "Level 20 capstone" — the reference does not specify a level for Holy
Nimbus under the SRD subclass listing. Minor embellishment.

No errors that contradict the reference.

**Completeness**

Both are complete. Test adds a GM Notes section comparing 2014 vs 2024 Paladin
mechanics — useful context not in the reference but accurate. Both include SRD
attribution.

**Verdict: EQUIVALENT** — both accurate and complete. Test adds useful GM notes;
baseline's Holy Nimbus level labelling is a minor embellishment.

---

### Query 7 — Three Clue Rule Murder Mystery (D&D 5e)

**Ground truth:** `skills/ttrpg-expert/scenario-writing.md`

Reference requires: ≥3 independent clues per conclusion; node-based design
(not linear); ≥3 hooks; conditional language throughout; proactive NPCs
(Goal/Plan/Timeline/Reaction/Escalation); read-aloud text (2-4 sentences, sensory
only, no game-mechanical language, no hedging); fail-forward on skill checks;
timeline showing world advancement without PC action.

**Accuracy**

Both responses implement the framework accurately.

Baseline (Ereth Vane / Pieter Drunn): Three Clue Rule correctly applied — every
major conclusion has ≥3 independently discoverable clues. Node map present with 5
nodes. Timeline of unopposed events (Days 0-7). Fail-forward applied per scene.
Read-aloud text sensory and concise. Conditional language throughout. Proactive clue
section for stalled players present. Multiple endgame options.

Test (Mira Drale / Corvus Drale): Three Clue Rule correctly applied. Node map with
5 nodes including optional Records Office. Clue redundancy map at the end categorizes
by Motive/Method/Opportunity/Identity — each category has ≥3 independent clues.
Explicit fail-forward section for each skill check. Timeline present. Multiple
climax variants (confession, escape, frame attempt, failure route with sequel hook).
Sequel hooks (3).

No errors against the reference in either response.

**Completeness**

Test is more complete: the clue redundancy map that explicitly maps each conclusion
to its independent clue sources is a significant practical addition. The skill check
summary table with explicit DC, location, and "consequence of failure" for each check
makes the scenario easier to run. The multiple climax variants and failure route with
sequel hook address the reference's anti-railroading requirements more thoroughly.

**Verdict: TEST BETTER** — both accurate; test's clue redundancy map, skill check
table, and multiple climax variants make it more complete and immediately usable.

---

### Query 8 — FitD Fortune Rolls

**Ground truth:** `skills/ttrpg-expert/systems/fitd/mechanics.md`

Reference: Fortune Roll uses pool of d6s equal to trait rating; read single highest;
Crit = two+ 6s = exceptional; 6 = good; 4-5 = mixed; 1-3 = bad; zero dice = roll 2d6
take lowest (cannot crit); disclaim GM decisions; same progression as downtime rolls.

**Accuracy**

Both responses are accurate. The result table is correct in both. Both correctly
describe the purpose (disclaim GM decisions) and the distinction from action rolls
(no position, no stress, no devil's bargains).

Baseline: Correctly states zero dice = 2d6 take lowest, cannot crit. Includes the
engagement roll result table (Crit → controlled; 6 → controlled; 4-5 → risky;
1-3 → desperate). Downtime rolls noted as identical progression.

Test: Also correct on zero dice rule. Adds a worked example (Tier II contact, 2d
Fortune Roll, result 5 = mixed — finds a lead but arrives after the Bluecoats).
The engagement roll is described but the position table is not explicitly reproduced
(test describes the mechanic rather than tabulating it).

No factual errors in either response.

**Completeness**

Baseline: includes the engagement roll position table. Test: adds a concrete worked
example. Both cover all reference material.

**Verdict: EQUIVALENT** — baseline includes the engagement roll position table; test
adds a worked example. Both are accurate and cover all reference requirements.

---

### Query 9 — FitD Score Opportunity vs Billhooks

**Ground truth:** `skills/ttrpg-expert/systems/fitd/factions.md`

Reference establishes Billhooks: Tier II, Strong. Brutal gang in Coalridge. Extreme
violence/intimidation. Labor rackets, butchery front. NPCs: Tarvul (leader, vicious
patriarch), Coran and Bryl (sons). Score design should use FitD plan types,
engagement rolls, clocks, and faction consequence mechanics.

**Accuracy**

Both responses use accurate faction data.

Baseline (Cold Room at Slaughterhouse Nine): Billhooks Tier II, Strong. Tarvul,
Coran, Bryl correctly identified and characterized (Coran: wants operations to look
clean; Bryl: volatile, does not de-escalate — consistent with "brutal gang"
reference). Engagement roll modifiers applied correctly (hostile turf -1d). Clock
segments consistent with FitD mechanics reference.

Test (Bone Yard Butchers / Garsen's Fine Cuts): Billhooks Tier II, Strong. Tarvul,
Coran, Bryl correctly identified. Engagement modifiers applied. Adds Delse (courier,
skimmer) — original NPC, appropriate invention. Adds Gell (Bluecoat informant) —
original NPC, appropriate. References Path of Echoes (Tier II, Weak per factions.md)
as noticing spirit disturbance — consistent. Faction status table values (-1 to -3)
consistent with factions.md status table.

No factual errors against the faction ground truth in either response.

**Completeness**

Baseline provides 3 plan types with engagement modifier rationale, 5 clocks, NPC
descriptions, downtime consequences, and engagement roll notes. Well-structured.

Test provides 6 plan types with detailed GM notes per plan, full location description
with sensory details, 3 clocks with precise fill conditions, 6-entry complications
table, detailed NPC descriptions with motivations/lines, explicit outcome matrix
(coin/rep/heat for 4 outcome levels), and sequel hooks. Notably more complete.

**Verdict: TEST BETTER** — both accurate; test provides materially more complete
coverage (6 vs 3 plan types, more complications, explicit outcome matrix).

---

### Query 10 — Improvised Suspicious NPC

**Ground truth:** `skills/ttrpg-expert/npc-generation.md`

Reference defines the 3-Line NPC (Appearance/Portrayal/Hook), AIMS framework (all
four components, with Moves as "concrete observable actions advancing their agenda
on a timeline"), relationship web (1-2 connections for minor NPC), Voice (one
distinctive element), system-specific stat blocks for all four systems.

**Accuracy**

Both responses accurately apply the reference framework.

Baseline (Maris Aldren): 3-Line version present at end, matching reference format
exactly. AIMS with all four components, correct Instinct category (fawn/flee). Two
relationships (antagonist proxy, second witness) — within the 1-2 reference range.
System stats for all four systems. FitD: "Consort 1, Sway 2" — both valid action
ratings. GURPS: "Smooth Operator 1" — consistent with chargen-kit's social
advantages.

Test (Marta Voss): AIMS with all four components. Moves section especially strong:
three timestamped actions that lead to a narrative pivot (Move 3: she turns if the
supervisor reacts badly — this precisely follows "concrete observable actions
advancing their agenda on a timeline"). Two relationships. System stats for all four
systems.

Minor accuracy issues in test:
- FitD stats: "Study 2, Consult 1." Study is a valid Insight action. However "Consult"
  is not a FitD action — the correct action is "Consort" (Resolve attribute). This
  appears to be a typo or name error.
- GURPS stats: "Photographic Memory (relevant to why she copied the document)." In
  GURPS 4e, this advantage is called "Eidetic Memory" — "Photographic Memory" was
  the 3e term. Minor terminological error.

Neither error is consequential for actual play use.

**Completeness**

Baseline has a clear "the tell" mechanic for the GM (the pause before a rehearsed
lie) — an excellent practical detail not required by the reference but very useful.
Test has a stronger narrative moves timeline.

**Verdict: EQUIVALENT** — both follow the reference framework. Baseline has the
pause-tell detail; test has a stronger moves design. Test has two minor terminology
slips (FitD "Consult" vs "Consort"; GURPS "Photographic Memory" vs "Eidetic Memory")
that do not affect usability.

---

### Query 11 — Universal Faction Turn

**Ground truth:** `skills/ttrpg-expert/world-evolution.md`

Reference defines: the Universal Faction Turn as Step 2 of the 6-step Post-Session
Update Checklist; five questions per faction; the impact classification table
(Critical/Significant/Minor/Flavour); system-specific overrides (FitD clock
mechanics with specific tick counts, CoC narrative arc stages, D&D territory shifts);
output quality standards ("Be decisive," "Name everyone," "Write scenes, not
summaries"); and critically — the Apprentice Behaviour note: "All updates are
recommendations awaiting GM approval. Never silently update campaign state."

**Accuracy**

Both responses correctly identify the five questions and the Step 2 position in the
checklist. The impact classification table is reproduced accurately in both.

Baseline: All three system overrides described with appropriate specificity
(FitD tick counts, CoC arc stages example, D&D territory framing). Output quality
standards quoted. Includes the "never silently update" constraint explicitly:
"All faction turn proposals are recommendations awaiting GM approval."

Test: FitD override described with correct tick counts. CoC and D&D overrides
summarized by reference to their session-procedures.md files rather than described
inline — less informative but not wrong. Adds practical tips not in the reference
("Pick factions by relevance to the last session, not alphabetically"; "The 'flavour'
impact tier is not wasted"). These are consistent with the reference's philosophy.

Critical omission in test: the "never silently update" constraint is absent. This
is a behavioural requirement specified in the reference's "Apprentice Behaviour"
section — not informational content but an operational constraint on how the tool
should present results to the GM.

**Verdict: BASELINE BETTER** — baseline more faithfully reproduces the complete
reference procedure including the GM-approval operational constraint that test omits.

---

### Query 12 — Session Prep, Session 4

**Ground truth:** `skills/session-prep/SKILL.md`

Reference defines a 17-step workflow:
- Version check on first invocation (read shared/version-check.md)
- Phase 1: Reconcile (conditional — runs when last session status is wrap-up)
- Phase 2 Context: Steps 6-10 (Prior Prep Review, Recap, Threads, NPCs, World State)
- Phase 2 Creative: Steps 11-14 (PC Roster + Arc with A/B/C plot, Touchpoints,
  Scene Design with GM approval gate, Spotlight Forecast with 15% floor)
- Phase 2 Verify: Steps 15-16 (Agency + Canon Audit, Gap Check)
- Handoff: Step 17

**Accuracy**

Both responses handle the missing wrap-up correctly: both identify Session 3 as
prepped but not wrapped, and both explain the implications before proceeding.

Baseline: Proceeds with "Option 2 — speculative prep" clearly labeled. Produces all
required sections. PC Roster assigns Voss to B-plot, Mal to C-plot, Marsh to A-plot.
Spotlight Forecast: Voss ~35%, Mal ~30%, Marsh ~35%. Minor: the reference specifies
A-plot at 50-60%; Marsh as A-plot lead at ~35% is outside this range, though with
three PCs the percentages don't sum to 100 per the reference's formula. This is a
minor inconsistency.

Test: Version check step executed first (reads shared/version-check.md) — this
matches the reference requirement "On first invocation, read shared/version-check.md
and follow the version-check procedure." Baseline omits this step. Proceeds with
speculative prep on the victory path. Spotlight Forecast: Voss 38%, Marsh 33%, Mal
29%. Test notes the 38% exceeds the B-plot 25-35% range with explicit justification
("slight overflow justified by the Ashford care arc being central"). More precise
than baseline's comparable calculation.

**Completeness**

Test is more complete:
1. Version-check step (omitted by baseline).
2. More scene branching options per scene.
3. Gaps table includes the version migration gap and the "Dr. Marsh" ambiguous
   reference as explicit items requiring resolution.
4. Spotlight imbalance check explicitly cites the reference's percentage ranges.
5. Session End Objectives section (not required by reference but useful).

Both produce all 17 required steps. Baseline omits the version-check.

**Verdict: TEST BETTER** — test includes the version-check step (omitted by
baseline), more precise spotlight math, and a more complete gaps analysis.

---

## Overall Assessment

Test build (phase-1/run-2) is marginally stronger overall, winning 4 queries to 3
with 5 equivalent. The single clear factual error across all 24 responses is the
Archaeologist band misclassification in the baseline's Regency Occupations response
(Query 3). No other hard factual errors were found in either build.

**Where test is stronger:** generative tasks (murder mystery, Billhooks score) and
workflow tasks (session prep), where it produces more complete and better-organized
outputs. Also catches the Regency band classification error.

**Where baseline is stronger:** lookup completeness (chase rules, faction turn
procedure) and format adherence (character generation with required Multi-Action
Combat Chains section).

**Minor issues in test (low consequence):**
- Query 10: "Consult" instead of "Consort" for FitD action; "Photographic Memory"
  instead of "Eidetic Memory" for GURPS 4e advantage.
- Query 11: omits the GM-approval operational constraint from the Faction Turn
  procedure — this is a behavioural requirement, not just informational content.

Quality differentiation between the two runs is primarily at the level of
completeness and format compliance rather than factual accuracy. Both runs are
largely reliable against the reference files.

# Benchmark Questions — Worldbuilding (Wrapup + Reconcile)

**Skill:** session-wrapup, reconcile procedure
**Purpose:** Quality baseline for world fact detection and reconcile integration
**Runs:** 5 per variant, report median + IQR
**Campaign data:** `tests/benchmark-campaign/`

## Questions

### B1 — Heritage detection

Process these session notes as a Wrap-Up for Session 3 of the
Ashford Case campaign:

"The investigators visited the Kingsport Docks where they met
Torga, a dwarf merchant selling exotic spices from the Eastern
Continent. Torga warned them about 'deep things' in the
harbor. Later, Inspector Crane confirmed Torga has been a
regular at the docks for decades."

Focus on the world-fact scan — what should be staged in
## World Fact Findings?

### B2 — Deferred accumulation

Process these session notes as a Wrap-Up for Session 5. The
campaign's `_flags.md` already has "The Old Empire" deferred
with 2 prior mentions from sessions 3 and 4. Session 5 notes:

"Father Blackwood mentioned that the church was built on ruins
from 'the old empire' and that the crypt predates the town
itself. Mrs Whitmore's diary references 'imperial road markers'
along the coast road."

What happens to the deferred flag for "The Old Empire"?

### B3 — Ignored suppression

Process these session notes as a Wrap-Up for Session 4. The
campaign's `_flags.md` has "giant rats" in the ignored section.
Session 4 notes mention "giant rats skittering in the
warehouse basement."

Verify that no world-fact finding is staged for giant rats.

### B5 — Domain bootstrap from ad-hoc

During reconcile of Session 3, the GM confirms that "the
harvest festival of Moonrise" is canon. No
`_World/culture-daily-life.md` file exists.

Walk through what should happen: what files are created, what
content goes where, and what gets recorded in _flags.md.

### C1 — Session-wrapup without _World/

Process these session notes as a standard Wrap-Up for Session 1
of a brand-new campaign (no `_World/` folder exists):

"Dr. Eleanor Voss arrived in Kingsport by train. She met
Professor Ashford at Miskatonic University, who showed her the
strange symbol carved into his study door. That evening, she
visited St. Anselm's Church where Father Blackwood seemed
nervous about recent disturbances."

Produce a complete Wrap-Up. Verify the output is clean standard
wrapup with no errors or empty world sections.

## Rubric

### B1-B3, B5 (worldbuilding-specific rubric)

| Dimension | 1 (poor) | 2 (adequate) | 3 (good) |
|-----------|----------|--------------|----------|
| Factual accuracy | Misidentifies facts or ignores _flags.md state | Correct detection, minor gaps in context | Complete and accurate, references specific _flags.md entries |
| System specificity | Generic handling | Acknowledges CoC context | Uses CoC-appropriate framing |
| Second-order depth | Only detects surface facts | Notes domain connections | Identifies cross-domain implications of detected facts |
| Internal consistency | Creates contradictions with existing world state | Clean but minimal | Actively reinforces existing world coherence |
| Actionability | Vague findings | Workable findings needing GM effort | Specific, staged findings ready for reconcile review |

### C1 (existing 5-dimensional rubric)

Standard session-wrapup quality — complete recap, entity
updates, timeline entries, carry-forward. No world-fact section
should appear since `_World/` doesn't exist and the notes
contain no strong world-fact signals for a CoC campaign (all
entities are human, all locations are real-world).

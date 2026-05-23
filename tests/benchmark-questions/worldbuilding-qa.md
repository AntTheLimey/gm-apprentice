# Benchmark Questions — Worldbuilding (Prep + QA)

**Skill:** session-prep, campaign-qa
**Purpose:** Regression testing for prep and QA with world content
**Runs:** 5 per variant, report median + IQR
**Campaign data:** `tests/benchmark-campaign/`

## Questions

### C4 — Session-prep with deferred flags

Run session-prep for Session 3 of the Ashford Case campaign.
The campaign has `_World/_flags.md` with one deferred item
("The Silver Twilight's true purpose" — 2 mentions across
sessions 1-2). A Plan file exists for Session 3 referencing
the docks investigation. The deferred item is thematically
relevant to the upcoming session, meeting the "related to
upcoming adventure's themes" surfacing criterion.

Verify the prep output includes the deferred flag awareness
section without it dominating the prep. Existing prep quality
(threat assessment, NPC readiness, scene proposals) must be
preserved.

### C5 — Campaign-qa with world audits

Run a Full Audit on the Ashford Case campaign at
`tests/benchmark-campaign/`. The campaign has `_World/` with
active `heritages.md` (human lifespan max 85) and `_flags.md`
with one deferred and one ignored item.

Verify that:
- World consistency findings appear alongside existing audit
  types (canon, timeline, graph health)
- No false positives from undefined domains (only heritages
  domain has rules)
- Existing audit quality is unchanged
- The ignored item is not flagged

## Rubric (existing 5-dimensional rubric)

Standard rubric for each skill. C4 tests that session-prep
adds world-thread awareness without degrading prep quality.
C5 tests that campaign-qa adds world audits without false
positives or quality regression.

# Benchmark Questions — Worldbuilding (Entity Validation)

**Skill:** campaign-organizer (world validation)
**Purpose:** Quality baseline for entity validation against world rules
**Runs:** 5 per variant, report median + IQR
**Campaign data:** `tests/benchmark-campaign/`

## Questions

### B4 — Entity validation at promotion

I'm reviewing entities from Session 2 for promotion to
AUTHORITATIVE. One of my NPCs, Professor Ashford, has
`heritage: Human` and `age: 400`. My world rules in
`_World/heritages.md` define human lifespan as max 85.
Walk me through the reconcile process for this entity,
including how the world-rule violation should be handled.

### C3 — Campaign-organizer entity creation regression

Create an NPC entity for my Ashford Case campaign: Margaret
Chen, a 45-year-old Chinese-American librarian at Miskatonic
University. She's a colleague of Professor Ashford. Use
campaign-organizer's Organize mode.

## Rubric

### B4 (worldbuilding-specific rubric)

| Dimension | 1 (poor) | 2 (adequate) | 3 (good) |
|-----------|----------|--------------|----------|
| Factual accuracy | Ignores the world rule violation | Notes the violation but doesn't explain options | Correctly identifies violation and presents all three response paths |
| System specificity | Generic handling | Acknowledges CoC context | Uses CoC-appropriate framing (e.g., Mythos exposure as explanation) |
| Second-order depth | Handles only the immediate violation | Considers what the exception means | Explores implications (e.g., if Ashford is 400, what does that mean for the campaign?) |
| Internal consistency | Resolution would create contradictions | Resolution is clean | Resolution actively strengthens world coherence |
| Actionability | Abstract advice | Workable but needs GM effort | Specific entity updates, flag entries, and domain file changes |

### C3 (existing 5-dimension rubric)

Standard entity creation rubric — entity should be correctly
formatted, wiki-linked, relationship-connected, and filed.
World-rule validation should fire (heritage check against
`_World/heritages.md`) but should pass cleanly for a valid
45-year-old human.

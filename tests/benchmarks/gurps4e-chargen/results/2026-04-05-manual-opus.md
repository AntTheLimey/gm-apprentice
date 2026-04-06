# Benchmark: Phase 4C Topic-Based Files

**Date:** 2026-04-05
**File Structure:** Phase 4C topic-based (20 reference files, no chargen kits)
**Model:** claude-opus-4-6
**Point Budget:** 175 pts, -75 disadvantage cap, -5 quirk cap

## Results

| Metric | Combat | Magic | Super |
|--------|--------|-------|-------|
| **Character** | Cole Whitfield (SAS/PMC) | Elara Thornwick (Hedge Mage) | Vera Kessler "Kinesis" (Psionic) |
| **Campaign** | Modern Realistic TL8 | Fantasy | Cinematic/Supers |
| **Points** | 175/175 | 175/175 | 175/175 |
| **Output lines** | 308 | 427 | 330 |
| **Tool calls** | 19 | 16 | 7 |
| **Tokens** | n/a (rate-limited) | 77,326 | n/a (rate-limited) |
| **Duration (s)** | 325 | 332 | 318 |
| **Files read** | 11 | 10 | 5 |

## Files Read Per Character

### Combat (11 files, 19 tool calls)
- mechanics.md (5.3k)
- character-generation.md (14.3k)
- skills-combat.md (10.2k)
- traits-physical.md (20.3k)
- traits-mental.md (18.0k)
- traits-social.md (8.0k)
- skills-military-police.md (7.8k)
- skills-athletic-outdoor.md (6.4k)
- equipment-weapons.md (15.8k)
- equipment-armor.md (10.5k)
- equipment-gear.md (12.8k)
- traits-perks.md (3.7k)
- **Total bytes read: ~133k (~33k tokens)**

### Magic (10 files, 16 tool calls)
- mechanics.md (5.3k)
- character-generation.md (14.3k)
- skills-esoteric.md (6.3k)
- spells.md (12.9k)
- traits-mental.md (18.0k)
- magic-rules.md (6.4k)
- traits-physical.md (20.3k)
- equipment-weapons.md (15.8k)
- equipment-armor.md (10.5k)
- skills-knowledge.md (7.5k)
- **Total bytes read: ~117k (~29k tokens)**

### Super (5 files, 7 tool calls)
- mechanics.md (5.3k)
- character-generation.md (14.3k)
- powers-rules.md (9.6k)
- traits-physical.md (20.3k)
- traits-mental.md (18.0k)
- **Total bytes read: ~67k (~17k tokens)**

## Notes

- Combat and super agents hit the API rate limit mid-run; token
  counts were not captured but files completed successfully
- Magic agent ran clean: 77,326 tokens reported
- All three characters validated mechanically (point totals exact)
- The super character was most efficient because powers-rules.md
  is self-contained; combat was least efficient due to content
  spread across 11+ files
- Previous benchmarks (pre-Phase 4C):
  - GCS connector approach: ~71k tokens, ~21 tool calls per char
  - Single rules-reference.md: ~33k tokens, ~3 tool calls per char
  - Both lacked detail (no spell lists, no full trait catalogs)

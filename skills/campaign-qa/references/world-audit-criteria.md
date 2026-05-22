# World Audit Criteria

Audit checks for world consistency. Only fire when `_World/`
exists with active domain files containing rules.

## Hard Checks (clear right/wrong)

| Check | Domain Source | Entity Types | What's Flagged |
|-------|-------------|-------------|----------------|
| Age exceeds heritage lifespan | heritages.md | npc, pc | NPC age > max lifespan for their heritage |
| Unknown heritage | heritages.md | npc, pc | Heritage value not in allowed_values list |
| Timeline contradiction | history-timeline.md | event, any with era | Event date contradicts era ordering |
| Tech-level violation | magic-technology.md | item, location | Item or feature from wrong tech era |
| Climate inconsistency | geography-climate.md | location | Location claims climate inconsistent with defined geography |

**Output format:** "Inconsistency found — review needed."
Reference the specific world rule being violated.

## Soft Checks (questions, not errors)

| Check | What's Flagged |
|-------|----------------|
| No economic base | Faction with no described revenue source or economic activity |
| No water source | Settlement with no apparent water source or trade justification |
| No heritage culture | Heritage entity with no described culture or societal structure |
| Long-lived no-impact | Long-lived NPC with no explanation for how they've affected history |
| Monoculture | Neighboring regions with identical cultures (planet-of-hats signal) |
| Stasis signal | Historical period with no recorded change (medieval stasis signal) |

**Output format:** "Question — worth considering." These are
suggestions, not errors.

## Deferred Flag Review

Report all deferred items from `_flags.md` with mention counts
and session references. Group by domain. Highlight items that
meet resurfacing criteria (3+ sessions or 3+ mentions).

## Scoping

- Only run checks for domains with `status: active` files
  containing `rules` entries
- No false positives from undefined domains — if
  `geography-climate.md` doesn't exist, skip geographic checks
- Cross-reference each finding with `_flags.md` — if the topic
  is already ignored, suppress the finding

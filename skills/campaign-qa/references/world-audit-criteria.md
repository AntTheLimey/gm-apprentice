# World Audit Criteria

Audit checks for world consistency. Only fire when `_World/`
exists with active domain files containing rules; look for
notes that contradict a rule.

## Contradictions

| Check | Domain Source | Entity Types | What's Flagged |
|-------|-------------|-------------|----------------|
| Age beyond a heritage's lifespan | heritages.md | npc, pc | An age the heritage's rules rule out |
| Unknown heritage | heritages.md | npc, pc | A heritage the rules don't list |
| Timeline contradiction | history-timeline.md | event, any with era | Event date contradicts era ordering |
| Tech-level violation | magic-technology.md | item, location | Item or feature from wrong tech era |
| Climate inconsistency | geography-climate.md | location | Location claims climate inconsistent with defined geography |

**Output format:** "Inconsistency found — review needed."
Reference the specific world rule being violated.

## Deferred Flag Review

Report all deferred items from `_flags.md` with how often and in
which sessions each came up, grouped by domain. What a count
means is the GM's call.

## Scoping

- Only run checks for domains with `status: active` files
  containing rules
- No false positives from undefined domains — if
  `geography-climate.md` doesn't exist, skip geographic checks
- Cross-reference each finding with `_flags.md` — if the topic
  is already ignored, suppress the finding

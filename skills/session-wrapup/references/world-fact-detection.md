# World Fact Detection

Heuristics for spotting potential world facts in session content
during wrap-up.

## What to Scan For

| Category | Examples | Signal Strength |
|----------|---------|----------------|
| Heritage/species names | "Torga, a dwarf merchant" | High — proper noun used as identity |
| New place names | "the village of Brackenmoor" | High — named and described |
| Cultural practices | "the harvest festival of Moonrise" | Medium — depends on detail level |
| Religious references | "she prayed to Shar" | High — deity name |
| Technology/magic | "he drew a flintlock pistol" | Medium — depends on world rules |
| Historical events | "since the fall of the Empire" | Medium — could be flavor or lore |
| Economic details | "gold crowns" (currency), "silk trade" | Low-medium — often flavor |
| Ecological details | "the dire wolves of the Frost Waste" | Medium — creature + location |

## Signal vs Noise

**Flag:**
- Named AND described — a proper noun with enough context to
  create an entity or rule
- Used by multiple NPCs or in multiple scenes
- Contradicts an existing world rule — always flag
- Consistent with existing rules but extends them — flag as a
  potential addition

**Don't flag (flavor):**
- Mentioned once in passing with no description
- Generic reference with no proper noun ("some old ruins")
- Atmosphere that implies no world rule ("it was raining heavily")

## Deduplication

Before staging a finding:
1. `_World/_flags.md`:
   - **Ignored** → suppress silently
   - **Deferred** → increment the mention count and note the
     session; stage for reconcile once mentioned in 3+ sessions
   - **Canon** → suppress
2. `_World/` domain files — already encoded → suppress.
3. Entity files — matching entity exists → suppress.

## Output Format

Under the Wrap-Up's `## GM Notes`, as `### World Fact Findings`.
Each finding gives the fact, evidence from the notes, the domains
it touches, and whether it's new or accumulated:

```markdown
### World Fact Findings

- **Dwarf heritage** — Torga described as "a dwarf merchant"
  (first mention). No heritage definition exists.
  Domains: heritages
- **The Old Empire** — referenced again (deferred, 3 prior
  mentions, threshold reached). Sessions: 3, 4, 5, 7.
  Recommend resurfacing.
  Domains: history-timeline, politics-governance
```

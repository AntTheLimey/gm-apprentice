# World Fact Detection

Heuristics for scanning session content and identifying
potential world facts during the Wrap-Up generation pass.

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

**Likely significant (flag it):**
- Named AND described — a proper noun with enough context to
  create an entity or rule
- Used by multiple NPCs or in multiple scenes — gaining weight
- Contradicts an existing world rule — always flag
- Consistent with existing rules but extends them — flag as
  potential addition

**Likely flavor (don't flag):**
- Mentioned once in passing with no description
- Generic reference with no proper noun ("some old ruins")
- Atmospheric detail that doesn't imply a world rule ("it was
  raining heavily")

## Deduplication

Before staging a finding:
1. Check `_World/_flags.md` — is this already tracked?
   - **Ignored** → suppress silently, do not stage
   - **Deferred** → increment mention count, note session
     number, stage for reconcile if accumulation threshold met
   - **Canon** → suppress, it's already resolved
2. Check `_World/` domain files — is this fact already encoded?
   If so, suppress.
3. Check entity files — does a matching entity already exist?
   If so, suppress.

## Output Format

Stage findings in the Wrap-Up file under
`## World Fact Findings`:

```markdown
## World Fact Findings

- **Dwarf heritage** — Torga described as "a dwarf merchant"
  (first mention). No heritage definition exists.
  Domains: heritages
- **Brackenmoor** — new settlement mentioned by two NPCs.
  No vault entry.
  Domains: geography-climate
- **The Old Empire** — referenced again (deferred, 3 prior
  mentions, threshold reached). Sessions: 3, 4, 5, 7.
  Recommend resurfacing.
  Domains: history-timeline, politics-governance
```

Each finding includes: the fact, evidence from session notes,
which domains it touches, and whether it's new or accumulated.

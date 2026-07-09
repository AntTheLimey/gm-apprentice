# Pathfinder 2e (Remaster) — Feats (Index)

Routing index for the feat category shards. Read the shard that
matches the feat slot being filled.

**Coverage:** curated Player Core + Player Core 2 selections
(~325 of the dataset's ~1,800 Player Core-family feats). The
coverage note at the top of each shard states what was curated;
everything else lives in the source books and the ORC dataset.

## How Feat Slots Work

Every character accumulates feats on a fixed cadence. Each slot
type only accepts feats of its category (a feat's category is
its trait: ancestry, class, skill, general, or archetype).

| Slot | Levels | Notes |
|------|--------|-------|
| Ancestry feat | 1, 5, 9, 13, 17 | Must carry your ancestry's trait (or a versatile heritage trait) |
| Class feat | 1 or 2, then every even level | Fighters and some classes start with one at level 1 |
| Skill feat | 2, then every even level | Rogues get one every level |
| General feat | 3, 7, 11, 15, 19 | Skill feats also qualify (skill is a subset of general) |
| Archetype feat | Any class feat slot | Requires the archetype's dedication feat first |

## Category Shards

| Category | File | Contents |
|----------|------|----------|
| General & skill | `feats-general-skill.md` | All 31 Player Core-family general feats; ~108 curated skill feats grouped by skill |
| Ancestry | `feats-ancestry.md` | ~138 curated feats for the 8 Player Core + 8 Player Core 2 ancestries plus versatile heritages |
| Class | `feats-class.md` | ~102 signature feats (levels 1-8, ~6 per class) for the Player Core-family classes |
| Archetype | `feats-archetype.md` | Dedication rules plus 15 curated archetypes (dedication + key follow-ups) |

## Quick Rules

- **Prerequisites** must be met when the feat is taken and are
  lost if the prerequisite is (retrain to replace the feat).
- **Dedication lock:** after taking a dedication feat, take two
  more feats from that archetype before adding another dedication.
- **Retraining** (downtime) swaps one feat for another legal
  choice of the same category — see `session-procedures.md`.
- **Level cadence details** and class variations live in
  `classes.md` and `character-generation.md`.

## Response Template

**Feat Lookup** — use for single-feat questions:

> **Battle Medicine** (Skill, Medicine) — Feat 1, PC2e
> Prereq: trained in Medicine | Action cost: one action
> Treat Wounds in combat on an adjacent creature, once per
> target per day. No healer's toolkit needed if hands are free.
> Note: staple pick for any trained-in-Medicine martial.

Omit the Note line on pure lookups; add it (one sentence) only
when the user asks for advice.

---

*This work includes Licensed Material from Pathfinder Player Core, Player Core 2, GM Core, Monster Core, and Monster Core 2 © Paizo Inc., used under the ORC License (Library of Congress TX 9-307-067, https://paizo.com/orclicense).*

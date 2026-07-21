> **Historical.** The crosswalk/sidecar approach described below is retired. Per-note `mobrpg:` frontmatter nodes are the sole id source; unlinked vaults are established with `mobrpg adopt` (live name-match). This document is kept for provenance.

# mobRPG API — reverse-engineering & Canticle comparison

Spike notes. mobRPG.com is Tim's web-based TTRPG world-builder. Goal: prove we
can drive its API, then compare its **Regency Cthulhu** world against the local
**Canticle** vault (`~/Documents/CTHULHU/Canticle`) — the same campaign in two
places.

## The API

- **Base:** `https://www.mobrpg.com/api`
- **Spec:** `https://www.mobrpg.com/docs/api-docs` (OpenAPI 3.1, 442 endpoints,
  34 entity types). Swagger UI: `/docs/swagger-ui/index.html`.
- **Auth:** Bearer JWT. Email/password login (`POST /api/user/login`) needs
  `clientId=d415e4f0-92e9-4d05-a8b2-2566931b3d01` +
  `redirectUri=https://www.mobrpg.com/auth/complete` (both public, from the
  site's JS bundle) — but Google-SSO accounts have no password. Instead, the
  site's **App Tokens** settings page mints a durable API token
  (`tokenType: API`, expiry year 2126). Send `Authorization: Bearer <token>`.
- **No security schemes declared** in the spec (Tim didn't annotate them), so
  Swagger's "Authorize" button may not work — the bearer mechanism is real
  regardless.
- `smoketest.py` here verifies: `/user/me`, `/world` list, per-world counts.
  Reads token from `MOBRPG_TOKEN` env var (never hardcoded).

## Entity model (as used by Regency Cthulhu)

Everything is scoped under a `world`. Key types and what they actually hold:

| mobRPG type | What it really models | Endpoint |
|---|---|---|
| `person` | NPCs. Fields: `relations`, `languages`, `lives`, `type` | `/world/{w}/person` |
| `event` | **Relationship facts with timestamps** — "X, Employment at Y", "X, Member of Order of St. Ælfric". Has `startTimestamp`/`endTimestamp`, `relations` | `/world/{w}/event` |
| `political` | **Places** (Bath, London, Hartwell House, The Fox & Hound…) — a geographic/governance hierarchy | `/world/{w}/political` |
| `culture` | Social strata (Bon-Ton, Working Class) | `/world/{w}/culture` |
| `organization` | Factions (e.g. Order of St. Ælfric) | `/world/{w}/organization` |
| `calendar` | Custom calendar (months/weekdays/holidays) | `/world/{w}/calendar` |
| `generated/images`, `generated/text` | AI generation, attachable to any entity | `/world/{w}/generated/*` |

**Key insight:** mobRPG encodes *relationships* (employment, membership,
ownership) as first-class **timestamped events** + a `relations` array on each
entity. It's a structured, queryable graph. The vault encodes the same
relationships as wiki-links + frontmatter prose.

## Regency Cthulhu world contents

people=18, events=17 (all relationship facts), politicals=15 (places),
politicalTypes=12, cultures=2, organizations=2, organizationTypes=2, races=1,
sexes=2, calendars=1, landFeatures=1, items=2.
**generated images=0, no map** — no media built yet.

## mobRPG ↔ Canticle vault comparison

Local vault: mature gm-apprentice Obsidian vault, **637 markdown files** —
Chapters 0–4, 78 Locations, Characters, Player Characters, Events, Factions,
Items, Creatures, Clues, Documents.

Name-match check (mobRPG entity → vault hits):

| mobRPG entity | vault hits | |
|---|---|---|
| Lord Percival Harcourt | 26 | central |
| Lady Honoria Lyndhurst | 22 | central |
| Hartwell House | 23 | central |
| Order of St. Ælfric | 13 | |
| Fox & Hound | 9 | |
| Tobias Whitmore | 5 | |
| Beatrice Harrow | 4 | |
| Agnes Rothwell / Ambrose Hargreaves / Eleanor Finch | 3 each | |
| Bernard Hathaway / Bridie Clarke / Hawthorne Grange | 2–4 | |
| **Edwin Fairchild** | **0** | **in mobRPG, NOT in vault — drift** |

### Conclusions

1. **Same campaign, two representations.** Almost all mobRPG entities exist in
   the vault; the central ones are deeply woven in.
2. **The vault is the richer source of truth** (637 files of narrative,
   chapters, clues, PCs). mobRPG holds a *structured subset* — the relational
   graph of who-works-where, who-belongs-to-what, and the place hierarchy.
3. **They have already drifted** (Edwin Fairchild exists only in mobRPG). A
   real sync needs reconciliation/ID-matching, not blind copy.
4. mobRPG currently adds **no media** for this world (0 images, no map) — its
   unique value here is the queryable relational/geographic structure and the
   custom calendar, plus the *potential* for map + AI image generation.

## Open questions for the integration

- Match entities by name, or maintain an ID crosswalk (mobRPG UUID ↔ vault
  file)? Names drift and collide; UUIDs are stable but need storing in
  frontmatter.
- Which direction first? Vault is fuller, so **vault → mobRPG** would enrich
  Tim's tool; **mobRPG → vault** would pull its structured relations/calendar
  into notes. Two-way needs the crosswalk above.
- mobRPG's events-as-relationships don't map cleanly to vault Events (story
  beats). They're closer to vault frontmatter relationships.

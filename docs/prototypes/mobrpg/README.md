# mobRPG ↔ gm-apprentice integration (prototype) — START HERE

Spike work connecting **mobrpg.com** (Tim's web RPG world-builder) with
gm-apprentice vaults, now graduated into an installable `mobrpg` CLI (v1.9.0).
This README is the front door; `llms.txt` is the agent-facing command guide.

> The historical design docs (master log, schema notes, reverse-engineering
> findings, the suggestion/writeback specs, and the earlier CLI handoff) have
> been archived outside the repo at `~/PROJECTS/docs/mobrpg-cli-history/`.

## What this is

mobRPG is a collaborative world-builder with a REST API (Spring Boot, Java).
We proved we can drive it **both directions** and built reusable scripts for:
- **import** mobRPG world → gm-apprentice vault, and
- **push** vault → mobRPG world.

Tim's backend source is at `~/PROJECTS/game` (we're collaborators on
`tdennis/game`, not a fork — pushes go to his repo). It has its own `CLAUDE.md`.

## Auth (how the scripts talk to mobRPG)

Every script imports the shared config/transport module (`import smoketest as
api`), which resolves **which environment** to hit and **how to authenticate**
before anything else runs.

### Environment: prod vs dev

`smoketest.py` picks BASE/CLIENT_ID/REDIRECT_URI from `MOBRPG_ENV=dev|prod`
(default `prod`, preserving this tool's original behavior of talking to the
real site unless dev is deliberately requested). Individual fields can be
overridden with `MOBRPG_BASE` / `MOBRPG_CLIENT_ID` / `MOBRPG_REDIRECT_URI` on
top of whichever preset `MOBRPG_ENV` picked. The resolved environment + BASE
is always printed to stderr on import — there is no silent ambiguity about
which server a run is about to hit.

**Safety:** any script that mutates data (creates, suggestion submits, app
token minting) calls `api.assert_writes_allowed()` before doing so. Against
`prod` that refuses and exits unless `MOBRPG_ALLOW_PROD_WRITES=1` is *also*
set — writing to production always needs a second, deliberate opt-in on top
of `MOBRPG_ENV=prod` (which is otherwise just the default).

### Authenticating

Two ways, same as before, now environment-aware:

- Durable **app token** (bearer) lives in `~/Downloads/credentials.csv`
  (AccessToken row, prod only). Scripts read it via `MOBRPG_TOKEN`:
  ```bash
  export MOBRPG_TOKEN="$(grep '^AccessToken,' ~/Downloads/credentials.csv | cut -d, -f2)"
  ```
  It authenticates as the vault owner (antthelimey). The token is a
  long-lived credential — treat it like a password.
- Email + password login (works against either environment) —
  `MOBRPG_EMAIL` / `MOBRPG_PASSWORD`. **Dev example** — the local stack seeds
  a Read-only collaborator on both dev worlds, `suggester@localhost`
  (password `local`), used for the suggestion demo below since the whole
  point of suggestions is that a Read-only user can propose content:
  ```bash
  export MOBRPG_ENV=dev
  export MOBRPG_EMAIL='suggester@localhost'
  export MOBRPG_PASSWORD='local'
  python3 smoketest.py
  ```

## The two worlds in play

| Pairing | Direction done | Vault | mobRPG worldId |
|---|---|---|---|
| **Space** → **Dead End** | mobRPG → vault (import) | `~/Documents/space_game` | `a254e424-…` (Read-only to us) |
| **Canticle** → **Regency Cthulhu** | vault → mobRPG (push) | `~/Documents/CTHULHU/Canticle` | `4b07d8dd-…` (we own it) |

`4b07d8dd-3da2-45fc-9ec5-6a45d21f1adb` is also the **dev** stack's Regency
Cthulhu world (same id, loaded into the local Postgres) — set `MOBRPG_ENV=dev`
to point any of these scripts at the local stack instead of the live site
without changing the worldId.

## Scripts (all dry-run by default; `--execute` to write; idempotent)

| Script | Does |
|---|---|
| `smoketest.py` | auth + read sanity check; also the shared env/config module every other script imports |
| `etl_extract.py` | pull a mobRPG world → structured JSON (import side) |
| `vault_write.py` | structured JSON → vault markdown files |
| `merge_overlaps.py` | non-destructive merge for entities that exist in both |
| `orphan_link.py` | auto-link obvious orphan relationships post-import |
| `push_to_mobrpg.py` | vault entities → mobRPG **direct create** (one POST per entity, immediately live; needs ReadWriteDelete) |
| `push_suggestions.py` | vault entities → mobRPG **suggestions** (`POST /world/{id}/suggestion`, batched, idempotent on `externalRef`; only needs Read — a collaborator proposes content for the GM to accept/dismiss) |
| `assign_types.py` | set mobRPG types via `Attribute` edges (race/sex, political/type…) |
| `push_relationships.py` | vault relationships → mobRPG `event`s + `Link` edges |

## Keeping a vault up to date (node model)

Entity/event IDs live in each note's `mobrpg:` frontmatter node — the single
source of truth. **There is no sidecar crosswalk** (the old
`detect_updates.py` + `_meta/mobrpg-crosswalk.json` flow is retired: the
hand-vendored crosswalks drifted and were untrustworthy). Reconciliation runs
against the nodes:

- **What changed upstream:** `mobrpg whats-new <world> --vault <path>` — a
  read-only diff of the live world against the vault's nodes (new entities,
  entities gone upstream, unmapped classifier types).
- **Bring changes in:** `mobrpg pull-canon` (ratified canon → nodes) and
  `mobrpg pull-desc` (description prose) apply the authority rule per node's
  review_state — append/flag, never blind-overwrite.
- Manual/on-demand only — no scheduled job.

## Reference docs

- `llms.txt` — the agent-facing CLI guide (auth, verbs, safe-write rules)
- `gm-apprentice-ontology-export.md` / `.json` — vault predicate ontology + eventType mapping (for Tim)
- Historical design docs (master log, `schema-map`, `FINDINGS`, `CLI-HANDOFF`,
  the suggestion/writeback specs) — archived at `~/PROJECTS/docs/mobrpg-cli-history/`

## ⚠️ Before you do anything when you resume — read these

1. **Every mobRPG element create needs a non-null `description`** or it 500s
   (`elements.description` is NOT NULL). Tim is fixing the constraint; until
   confirmed, always send a description. This was the type-creation 500.
2. **Types are `Attribute` edges, not fields.** Relationships are reified
   **`event`s** (eventType enum: Employ/Membership/Leadership/Reign/War/Score/Generic).
   See the log for exact endpoints.
3. **Do NOT write the crosswalk back into vault frontmatter.** GM wants
   frontmatter hand-authored only — `push_relationships.py` still has the
   frontmatter-writeback code; **rewire it to the sidecar JSON before running again.**
4. **Don't PR the Hibernate "fix."** The `@JdbcTypeCode(SqlTypes.ARRAY)` swap was a
   local workaround that drops `StringListConverter`'s order-independent `equals`.
   The clean-build boot failure is a *question for Tim*, not a blind PR.
5. **Canticle vault is not under version control** — be careful with automated edits.

## Live state at park time

- Regency Cthulhu (mobRPG): Canticle **Chapter 1 loaded** — events 17→97,
  people 18→45, locations 15→27, political-types 12→23, items 2→5.
- Canticle vault frontmatter: **restored to hand-authored** (crosswalk in sidecar).
- Remaining to push ≈ 250 entities (chapters 0, 0.5, 2, 3, 4; 0.1 already in mobRPG).
  Chapter 2 (Lyon) dry-run = 60 entities, ready.
- Local backend repro env: **torn down**. JDK 25 + `~/.m2` jars remain (harmless).

## Likely first moves on resume

1. Decide crosswalk home + sync direction/authority (see log's open decisions).
2. Rewire `push_relationships.py` (and add entity `mobrpg_id` capture) to the sidecar.
3. Continue the push chapter by chapter, or design two-way sync using the crosswalk IDs.

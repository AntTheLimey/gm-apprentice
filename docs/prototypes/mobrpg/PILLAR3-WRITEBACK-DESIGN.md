# Pillar 3 — Vault Writeback + Canon Reconciliation (design)

**Status:** design (2026-07-18). Approved via brainstorming. Implements **impl-order #4** of
`COMPLETE-SUGGESTIONS-SPEC.md` (the third pillar: *vault-updating*). Companion to
`COMPOUND-SUGGEST-DESIGN.md` (impl-order #3, shipped). The TDD implementation plan derived from
this doc lives at `docs/superpowers/plans/2026-07-18-pillar3-writeback.md` (local/gitignored).

---

## 1. The operating model (why this exists)

**mobRPG is canon — the authoritative "world database". The vault is the play/prep working
surface.** Content flows in a two-way, *phased* cycle:

```
   ┌─ before play ─ PULL-DOWN (reconcile) ───────────────┐
   │   mobRPG (canon) → vault                             │
   │   GM hand-edits + accepted suggestions become        │
   │   authoritative in the vault                         │
   ↓                                                      │
  PLAY → vault accrues in-play additions (wrap-up          │
   │   details, new entities)                             │
   ↓                                                      │
  after play ─ PUSH (suggest) ─ vault → mobRPG            │
   │   as SUGGESTIONS ("creates + updates from play"),    │
   │   the GM reviews them in mobRPG ─────────────────────┘
```

Because the two directions are never peers, there is **no symmetric-conflict problem**:

- **Pull (mobRPG → vault): canon simply wins.** Authoritative by definition — no adjudication.
- **Push (vault → mobRPG): always suggestions.** The GM's accept/dismiss in the review queue
  *is* the conflict resolution. Nothing silently clobbers canon; nothing silently clobbers the vault.

The single authority rule that falls out of this:

> **Canon overwrites the vault only for entities canon has ratified (`accepted`/`edited`).
> Anything still `pending` or `dismissed` stays exactly as the vault authored it — indefinitely,
> across sessions — until the GM acts in mobRPG.**

This supersedes the spec's earlier "vault is authoritative until mobRPG returns an edited version"
phrasing: mobRPG-wins is the *primary* mode, and the model is a genuine two-way cycle, not a
one-way push with occasional reconcile.

---

## 2. Where mobRPG data lives: the `mobrpg:` node

All mobRPG-derived data lives in a single **`mobrpg:` node** in the entity's frontmatter. Nothing
is lifted to top-line fields. This retires the sidecar `canticle-regency-crosswalk.json` entirely
(see §6).

### 2.1 Rationale (settled during brainstorming)

- The old "keep the crosswalk out of frontmatter, hand-authored only" decision (integration-log
  "Crosswalk decision (settled)", README) was a **stopgap** from before the prototype worked out
  where mobRPG schema data belongs. It was correct for its moment: `mobrpg_id` injected as raw
  frontmatter noise *was* pollution.
- A **template-declared, schema-mirrored, version-migrated** node is *not* pollution — it is part
  of the entity's declared contract, the same as `canon_status` or `occupation`. That dissolves the
  original tension.
- **Nothing is lifted to top-line** because every determined value is a *lossy projection* of a
  vault field the top-line already owns (`profession` ← `occupation`, `sex` ← `gender`,
  `political_type` ← `location_type`, `eventType` ← `relationships[].type`). Lifting them would
  create competing sources of truth that drift. The node is the single home for "the mobRPG
  projection and sync state".

### 2.2 The node is a *ledger*, not a copy

The node is not a second copy of the entity. It holds three things that genuinely do not exist in
the vault schema, plus one minimal join key:

1. **Foreign keys** — `element_id`, `event_id`. mobRPG's UUIDs; there is nowhere else to keep them.
2. **A record of a lossy transformation** — `determined.*`. What we *decided to send*, so we can
   later detect GM edits against it and skip unchanged re-sends.
3. **Minimal join keys** — `relationships[].{predicate, target}` echo the authored `relationships[]`
   only so each `event_id` knows which authored relationship it belongs to. (Positional coupling
   would corrupt on reorder; a `(predicate, target)` tuple is the robust key — exactly what a
   foreign-key row does when it repeats key columns.)

**Safety net:** the node is a **regenerable cache**. The authority order is strict (hand-authored
top-line > `determined` > mobRPG-returned canon edits, which win over `determined`). If the node
ever drifts or bloats, it can be deleted wholesale and rebuilt from the authored frontmatter plus a
fresh pull. Nothing authored is lost.

### 2.3 Node shape

Person (the richest case — classifiers *and* relationships):

```yaml
# ── hand-authored top-line (UNTOUCHED by the tool) ──────────────
type: npc
occupation: "Order Field Agent, Linguist, Vocalist"
gender: Female
relationships:
  - target: "[[Dr_Erasmus_Hume]]"
    type: imprisoned_by
    # …tone / strength / description…

# ── machine-managed mobRPG projection + sync ledger ─────────────
mobrpg:
  world_id: 4b07d8dd-3da2-45fc-9ec5-6a45d21f1adb
  external_ref: canticle:Characters/NPCs/Imogen_Bellamy   # stable idempotency key
  element_id: a30208ef-0d36-44a6-8869-3f90c8a0f7c0        # mobRPG UUID (null until accepted)
  element_kind: Person                                     # mobRPG discriminator
  review_state: accepted        # pending | accepted | dismissed | edited | deleted
  content_hash: "sha256:1a2b3c" # of the built payload → re-push only on change (§4)
  last_synced: 2026-07-18
  review_note: ""               # populated when dismissed (mobRPG reviewNote)
  determined:                   # values we DERIVED and sent; canon overwrites on GM edit
    profession: Priest          #   ← from occupation
    race: Human                 #   ← defaulted
    sex: Female                 #   ← from gender
  relationships:                # one per authored relationship reified as an Event
    - predicate: imprisoned_by
      target: "[[Dr_Erasmus_Hume]]"   # join key, aligns 1:1 with top-line relationships
      event_type: Generic
      event_id: 982eb32c-0619-41af-98db-26e8b15c348e
      review_state: accepted
  languages: []                 # RESERVED — populated by the step-5 skill, not Pillar 3 (§5)
```

Per-kind deltas (only `element_kind` + `determined` change):

| Vault kind | `element_kind` | `determined` |
|---|---|---|
| npc / pc | `Person` | `{profession, race, sex}` |
| location (built/governed) | `Political` | `{political_type}` |
| location (natural) | `LandFeature` | `{land_feature_type}` |
| faction | `Organization` | `{organization_type}` |
| creature | `Creature` | `{creature_type}` |
| item | `Item` | `{item_type}` |

**Body → description.** The markdown body is converted to HTML (via `mobrpg.md`) into the element's
`description`; GM Notes / Appearances / Source References are stripped first. mobRPG's separate
`notes` field is **not** populated by this work (orthogonal mapping choice, out of scope).

---

## 3. Two directions

### 3.1 Direction ↑ — write-forward (extends `suggest`)

After `suggest` builds an entity's payload:

1. Compute `content_hash` (§4).
2. On `--execute --write-back`, write/update the entity's `mobrpg:` node:
   `review_state: pending`, `content_hash`, `external_ref`, `element_kind`, `determined`, and the
   `relationships[]` join keys. `element_id` and `event_id`s are **null at this stage** — they do
   not exist until the GM accepts (a suggestion's `resultElementId` is only populated once
   Accepted). They are filled in later by reconcile.
3. **Idempotency:** on a later `suggest` run, recompute the hash; **equal → skip** the entity (do
   not re-submit — a re-submit would drop a duplicate Pending suggestion into the review queue for
   the GM to re-review); **differ → re-push** (update the pending suggestion via `update`, or submit
   fresh).

Dry-run is the default; the node is written **only** on `--execute --write-back` (the node records
what we *sent* — never write it for a dry-run).

### 3.2 Direction ↓ — pull-down (new verb)

> **Naming:** the CLI verb must **not** be called `reconcile` — `skills/shared/reconcile.md` already
> names a different concept (GM content review → `canon_status` promotion in session-wrapup).
> Working name: `pull-canon` (final name a plan detail).

Reads the review queue + live elements
(`GET /world/{id}/suggestion?reviewState=…`, then `--fetch-elements` per accepted element — the
`suggestions --correlate --fetch-elements` primitive already exists) and updates each entity's node
per its **`review_state` gate**:

| mobRPG state | Reconcile action |
|---|---|
| **accepted (unchanged)** | Fill `element_id` + `event_id`s (from `resultElementId`); `pending → accepted`; confirm live classifiers match `determined`. |
| **accepted-after-edit** / **post-acceptance drift** | **Canon wins:** overwrite `determined` from the live element; `review_state: edited`. Top-line authored fields are never touched. Detected on any later reconcile by comparing live element ↔ recorded `determined`. |
| **dismissed** | `review_state: dismissed` + `review_note`; **vault preserved**. Not re-proposed until `content_hash` changes (§4). |
| **deleted in mobRPG** | Fetch 404s → `review_state: deleted`, clear `element_id`; flag rather than keep a dead pointer. |
| **pending** | **Vault preserved** — canon has not ratified, so it cannot overwrite. Holds indefinitely across sessions. |

**Tier B — scaffold new-entity notes.** Entities the GM created *by hand in mobRPG* that have no
vault note get a **new note scaffolded** from canon (frontmatter + a `mobrpg:` node marked
`review_state: accepted`, sourced from the live element). Existing notes' authored content is never
overwritten. (Tier C — bounded description-region merge into existing notes — is deferred to the
step-5 skill; see §5.)

**Guard.** Reconcile never pulls canon over `pending`/unpushed local content. If a `pending`
entity's `content_hash` shows it was edited again since the suggestion was made, its suggestion is
stale → surface "push these first" rather than overwriting.

---

## 4. `content_hash` — who / when / why

- **Who:** the tool, deterministically, from the **built element payload** — never the GM, never
  mobRPG. Pure function of `{name, altNames (sorted), description-HTML, data (incl. `determined`)}`,
  canonical JSON, `sha256`.
- **When:** stamped at write-forward time (records what we sent); recomputed and compared on every
  later `suggest` run as the skip-or-re-push gate.
- **Why:** without it, every run re-submits every entity, and since `externalRef` makes submit
  idempotent server-side, mobRPG drops a fresh **Pending suggestion** each time — the GM would
  re-review 42 unchanged entities per run. The hash's job is **"don't pester the GM to re-review
  something that hasn't changed."** A *changed* hash is also the signal that clears a stale
  `dismissed` ("you edited it, so I'll propose it again").
- **Coverage choice:** hash the *payload*, not the raw file, so the invariant is total and
  checkable — `node.content_hash == hash(rebuild())` means "mobRPG already has byte-identical
  content, skip." GM Notes are stripped before hashing, so GM-only prose edits do not cause churn.
  Trade-off: a deliberate converter/map change re-pushes affected entities (correct, but churn you
  trigger on purpose).
- **Known v1 limitation:** editing an existing relationship's `description` does not re-push its
  Event (relationships are tracked by `event_id` presence, not a per-relationship hash). Acceptable
  for v1; noted for later.

---

## 5. Scope boundary

**IN (this work):**

- `mobrpg:` node read/write helpers (parse, merge, serialize — preserving hand-authored frontmatter
  and key order as far as practical).
- Write-forward on `suggest` (`--write-back`), `content_hash`, idempotent skip.
- The **reconcile** verb: all five review states + Tier-B new-note scaffolding + the pending guard.
- One-time **crosswalk → node** migration (§6).
- **Schema adoption** (chosen in-scope): this ships in the **gm-apprentice plugin** (all vaults),
  not as a one-off vault edit. Edit the plugin *source*, and vaults receive it through the normal
  migration-on-version-bump:
  - `skills/shared/entity-schema.md` — add the `mobrpg:` node to the Type-Specific Fields section
    (the schema source of record; each vault's `_meta/entity-types.md` is a mirror resynced on
    migration via "Schema Mirror Sync").
  - `skills/shared/templates/` — add the `mobrpg:` node scaffold to the relevant entity templates
    (migrations re-diff each vault's `_Templates/` against these).
  - `skills/shared/migrations.md` — add one migration entry in ascending version order (Structural:
    scaffold the node + Canticle crosswalk backfill; Content: template re-diff), and bump
    `.claude-plugin/plugin.json` (currently 1.8.22; the version stamps `current_version` at build).
  - The per-vault effects (`_meta/entity-types.md` mirror, `_Templates/` re-diff,
    `gm_apprentice_version` + changelog in `_meta/vault-config.md`) are produced **automatically** by
    campaign-organizer's migration workflow when a vault opens at a lower version — they are not
    hand-edited or branch-committed.

**DEFERRED to the step-5 mobRPG skill (LLM judgment):**

- Tier-C bounded description-region merge into existing notes.
- Language extraction (CoC skill-table → `languages[]`) and `%` → `mastery` mapping. The node
  reserves the `languages:` slot and documents the two-phase contract (Language elements
  created+accepted first, ids referenced inline); this work does not populate it.
- Guided ambiguity / edit resolution (the interactive "which wins" surface).

---

## 6. Migration: schema addition (all vaults) + Canticle crosswalk backfill (one-time)

Two distinct migrations, don't conflate them:

- **Schema addition — general, all vaults.** The plugin migration (§5) makes every vault *capable*
  of carrying `mobrpg:` nodes: schema mirror + template scaffold. This runs on any vault that opens
  at a lower `gm_apprentice_version`. It adds no data — a vault with no mobRPG world simply carries
  the (empty/absent) node schema.
- **Canticle crosswalk backfill — one-time, Canticle only.** `canticle-regency-crosswalk.json`
  (42 entities + 80 relationships) exists **only** because of the old "no IDs in frontmatter"
  decision. Only Canticle has one. Backfill its rows into `mobrpg:` nodes, then the sidecar is dead:

- Convert every crosswalk `entities[]` row → a `mobrpg:` node (`element_id`, `external_ref`,
  `element_kind` from the entity kind, `review_state: accepted`) on the matching vault file.
- Convert every `relationships[]` row (with a `mobrpg_event_id`) → a `mobrpg.relationships[]` entry
  on the subject's node.
- Report any crosswalk row whose vault file cannot be resolved (do not drop silently).
- After migration the sidecar is dead; remove references to it from the writeback path.

This also absorbs the long-standing chore recorded in integration-log / README (rewire
`push_relationships.py` off frontmatter-writeback) — that dead path is retired here.

---

## 7. Test vaults (end-to-end verification)

Three real vaults are available as test cases:

- **2 vaults already in mobRPG** — provide real canon to exercise the **pull-down** direction (all
  five review states, post-acceptance drift, Tier-B new-note scaffolding) against live elements.
- **1 vault not yet in mobRPG** — exercises the **first-time push** path (write-forward from empty,
  no prior nodes) end-to-end; can be loaded into mobRPG to then exercise pull-down too.

All live exercises stay read-only / dry-run by default; any `--execute` against a real world needs
`MOBRPG_ALLOW_PROD_WRITES=1` and explicit go-ahead. Canticle remains the crosswalk-backfill case.

## 8. Constraints (inherited)

- **TDD.** Baseline **79 tests** must stay green (`.venv/bin/python -m pytest -q` from
  `docs/prototypes/mobrpg`).
- **Dry-run is the default**; writes require `--execute`, and prod writes require
  `MOBRPG_ALLOW_PROD_WRITES=1`. No live `--execute` in this work without explicit go-ahead. Smokes
  are offline/read-only (stub `client.get_access_token`).
- **Clean-module imports only** — native code imports `mobrpg.client`, `mobrpg.md`,
  `mobrpg.commands.*`; never the legacy `push_*`/`smoketest` scripts (they print a PROD banner on
  import).
- **Commits:** terse sentence-case subjects; no `Co-Authored-By`; no mention of AI/LLM tooling;
  stage explicit paths. Push to `origin/mobrpg-cli` only after the final whole-branch review passes.

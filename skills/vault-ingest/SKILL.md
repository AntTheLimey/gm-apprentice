---
name: vault-ingest
description: "Ingest old campaign materials — notes, character sheets, images, transcripts, spreadsheets — into a structured vault. Sorts messy source material, interviews the GM to recover what actually happened, then synthesizes structured inputs for downstream skills. Use when a GM has existing campaign material outside the vault: bootstrapping a new vault from old notes, adding a discovered character sheet mid-campaign, or reconstructing past sessions from archived transcripts. Trigger on 'ingest', 'import old notes', 'I have some old campaign files', 'process these notes into the vault', 'I found some old character sheets', or any request to bring external material into an existing or new vault."
---

Vault ingestion assistant. Takes messy old campaign materials
and translates them into structured inputs that existing skills
can process. Adapter + Orchestrator pattern.

**Shared references:** Read on first invocation:
- `shared/session-principles.md`
- `shared/session-document-chain.md`
- `shared/reconcile.md`

**Skill references:** Read before each phase:
- `references/classification-taxonomy.md` — Phase 1
- `references/image-handling.md` — Phase 1 (when images present)
- `references/keeper-interview.md` — Phase 4
- `references/synthesis-templates.md` — Phase 5

**Downstream skills:**
- `campaign-organizer` — vault skeleton, entity filing
- `session-wrapup` — wrap-up generation from synthesized notes
- `reconcile` (shared) — GM review, canon confirmation
- `campaign-qa` — optional post-ingestion health check

Orchestrates via conversational handoffs, not programmatic calls.

## Input Channels

All three can be used in the same invocation:

1. **Staging folder** — Files in `_inbox/` within the vault.
   After ingestion, source files move to `_inbox/_processed/`
   with a date stamp (not deleted).
2. **External path** — GM points to a folder or file outside
   the vault. Read-only — never modify external sources.
3. **Pasted content** — GM pastes text directly. Treat as an
   implicit source document.

**Supported formats:** Markdown, plain text, Word, PDF, images,
spreadsheets (CSV/Excel), chat/VTT exports.

## Bootstrap Detection

On invocation, check whether a vault exists (look for `_meta/`).
If no vault detected:

> "I don't see a campaign vault here. Want me to hand off to
> campaign-organizer to set one up first, or point me to your
> vault's location?"

Do not proceed without a vault — ingested entities need
folder structure, templates, and `_meta/` schema to file
correctly. Without these, entities get created with wrong
paths and missing metadata.

**Version check:** On first invocation, after confirming the vault
exists, run `python3
"${CLAUDE_PLUGIN_ROOT}/skills/shared/scripts/vault_check.py" <vault>
version`. `OK` or `SETUP` → proceed. `MISMATCH` → announce the
row and hand off to campaign-organizer's migration workflow
(`campaign-organizer/references/migration-procedure.md`) before
proceeding with ingestion; resume after it completes. `AHEAD` →
announce the row and tell the GM to update the plugin; do not
proceed. `ERROR` → report the row; the plugin install is broken —
do not proceed. No verdict row and a `not a directory` error on
stderr means the vault path is wrong — ask the GM for it rather than
proceeding. Fallback without python: read `gm_apprentice_version`
from `_meta/vault-config.md` and `current_version` from
`shared/migrations.md` (frontmatter only) and compare
component-by-component as numbers — `1.8.9` is older than `1.8.15`.

## Gotchas

1. **Read `_Templates/_Template_{Type}.md` before creating any entity** — Template is canonical structure. Pattern-matching off existing entities propagates drift and deprecated fields.
2. **ONE file per entity** — Multiple entities in one file break wiki-link resolution and publish rendering.
3. **Never modify external source files** — Read-only access. The GM's originals are their backup and legal proof of ownership.
4. **Process buckets chronologically, earliest first** — Later buckets reference entities created by earlier ones. Out-of-order processing creates dangling wiki-links and duplicate entities.
5. **Move processed `_inbox/` files to `_inbox/_processed/` with date stamp, never delete** — Source provenance. The GM may need to re-ingest if errors are found, and the original file is the audit trail. Run `python3 "${CLAUDE_PLUGIN_ROOT}/skills/shared/scripts/ingest_survey.py" <vault> --archive FILE... --write` rather than moving files by hand — it date-stamps, preserves the `_inbox/`-relative subpath, and refuses to delete or silently overwrite a name collision. Dry-run (no `--write`) first to confirm the destination paths.
6. **Validate each bucket's entities before the next bucket** — run the bundled `vault_check.py frontmatter` (see `shared/vault-access.md`) on folders you wrote; fix every ERROR first. Later buckets build on earlier files, so schema drift compounds.

## The Pipeline

Six phases, sequential. Phases 1-4 owned by vault-ingest.
Phases 5-6 hand off to existing skills. When multiple buckets
exist, process each through Phases 3-6 before the next
(chronological order, earliest first).

### Phase 1: Survey & Classify

Run `python3 "${CLAUDE_PLUGIN_ROOT}/skills/shared/scripts/ingest_survey.py"
<source-dir>` before reading anything. Three of the nine
taxonomy rows resolve with zero content read (extension or
existing frontmatter alone) and print `DECIDED`; the rest print
`SCORED` with per-indicator hit counts, line numbers, a proposed
classification and a confidence — read the file yourself only
to confirm or override a `SCORED` row, not to classify from
scratch. An `UNSCORED` row (Word/PDF/VTT — no stdlib text
extractor) still needs a manual read. Read
`references/classification-taxonomy.md` for the full taxonomy
and heuristics behind the proposal.

**Key heuristic:** If a document contains dice rolls, skill
check results, or specific PC actions, those lines are play
records regardless of what surrounds them.

**Image handling:** Run `python3
"${CLAUDE_PLUGIN_ROOT}/skills/shared/scripts/ingest_images.py"
<vault> <source-dir>` (dry-run) for the full filing plan —
conversion, slug match, destination, duplicate verdict, portrait
vs. body-embed — before touching any image by hand; then
`--execute` to copy/convert into `_attachments/` and write the
`portrait:` field and `![[filename]]` embeds. `UNMATCHED`,
`portrait-ambiguous` and `DUP-FLAG` rows are deliberately left
for the GM — see `references/image-handling.md` § What the
Script Leaves to You for how each is resolved.

**Output:** Classified manifest — summary table of every source
item with classification, brief content summary, and time-period
guess. Present to GM: "Does this look right? Any
misclassifications?"

### Phase 2: Sort into Buckets

Group classified items by chapter/session/time period.

**Sorting signals:**
- Explicit references ("Session 5 notes", "Chapter 2 prep")
- Timeline references (in-game dates, event references)
- NPC/location clustering (same cast = same period)
- GM context from Phase 1 confirmation

**Each bucket gets:** working label, classified items,
certainty level (certain / probable / needs-GM-input).

Ambiguous items go to "unsorted" bucket — resolved at the
start of Phase 4 before play-event interview begins.

**Processing order:** Chronological, earliest first. Earlier
buckets build vault context for later ones.

### Phase 3: Extract Play Events

Read all AUTHORITATIVE-classified material per bucket. Build
confirmed play events.

**Source priority:**
1. `Timeline.md` — existing record, read first
2. Existing session wrap-ups
3. Play transcripts and fragments from source material
4. `Player_Characters.md` — deaths, transitions, rosters
5. Existing entity files — current canon state

**Output:** Two lists per bucket:
- Confirmed events (with source citations)
- Gaps (things prep says could have happened but unconfirmed)

**Image linking:** Already resolved by `ingest_images.py`'s
Phase 1 plan for any entity that existed when it ran — re-run it
with `--execute` once new entities from this bucket are created
and it will pick up matches against them too. It sets `portrait`
on a single or clear-default match, embeds the rest via
`![[filename]]` under a `## Attachments` heading, and never
overwrites an existing `portrait`. See
`references/image-handling.md` for the underlying rules.

### Phase 4: Keeper Interview

The skill's exclusive value. Read
`references/keeper-interview.md` for the full technique.

**Rules:**
1. One question at a time — never bulk lists
2. Contextual framing — trigger memory with scene context
3. Follow the thread — each answer is a door
4. Record as you go — log every answer immediately
5. Know when to stop — "I don't remember" → flag and move on
6. Distinguish certainty — "definitely" vs "I think so"

First resolve any unsorted items from Phase 2 before starting
the play-event interview.

**Image questions:** After resolving unsorted items and before
starting the play-event interview, resolve image assignments:
1. Show each unmatched image — ask the GM which entity it
   belongs to (or "atmosphere art" → `_attachments/documents/`)
2. For entities with multiple images and no clear default —
   ask the GM to pick the portrait
See `references/image-handling.md` for question templates.

**PC arc questions:** After image resolution and before starting
the play-event interview, ask one question per active PC about
their personal arc across the ingested period. See
`references/keeper-interview.md` § PC Narrative Arcs.

### Phase 5: Synthesize & Hand Off

Read `references/synthesis-templates.md` for the output format.

1. For buckets with no existing session files, hand to
   `campaign-organizer` for chapter/session skeleton creation
2. Write synthesized content as a Play Notes file per
   `shared/session-document-chain.md`. Apply the block/seam test:
   preserve finished-prose blocks from the sources verbatim;
   author only the fragment-derived text and the seams. Synthesis
   assembles fragments — it does not re-voice writing that is
   already written. (rationale: `shared/content-fidelity.md`)
3. Follow `session-wrapup` workflow to produce the Wrap-Up
   file and create/update entities
4. For each PC active during the ingested period, write a
   consolidated character story entry per
   `references/synthesis-templates.md` § Character Story
   Backstory Entries

**Self-check after each entity:**
1. Verify: wiki-links use `[[Entity Name]]` format (no bare text references to entities)
2. Verify: `play_date` is `YYYY-MM-DD`; `in_game_date` uses a real-date form (ISO, month-name, or seasonal with a 4-digit year) or the campaign's own non-Earth calendar — never a fabricated Gregorian date, and no narrative time-of-day in the field (see `shared/session-document-chain.md`)

Fix any issues before proceeding to the next entity.

Run `vault_check.py frontmatter --folder <dir>` per bucket, not
per file — it validates against the schema (required fields,
enums, legacy keys, unquoted links), not against
`_Templates/_Template_{Type}.md`. Fix every ERROR before moving
on to the next bucket.

Include `> [!info] Reconstruction Note` with source descriptions
and limitations. Mark uncertain items with `<!-- UNVERIFIED -->`.

**Planning content:** If the ingested material contains
narrative planning documents (scene designs, arc structures,
investigation flows), create them as `type: plan` entities
in `Chapters/{chapter}/Planning/`. Read
`_Templates/_Template_Plan.md` for the frontmatter structure.
Set `plan_type` to the closest match: `arc`, `scene`,
`investigation`, or `timeline`.

### Phase 6: Review

Invoke `shared/reconcile.md` to walk the GM through reviewing
the wrap-up. On approval, promotes to `reviewed` status and
AUTHORITATIVE canon status.

## Post-Ingestion

After all buckets are processed:

**Cross-reference pass:**
- Deduplicate entities across buckets — `vault_check.py names`
- Identify relationship chains spanning buckets — `graph_check.py
  all` (link structure) and `vault_check.py relationships`
  (predicate vocabulary)
- Check timeline consistency — a judgment call across buckets, by
  eye; `vault_check.py timeline` only flags a multi-day session
  plan missing a `## Timeline` section, not cross-bucket ordering
- Validate entity status progression — `vault_check.py stale-drafts`
- Run `vault_check.py wrapup` over the generated wrap-ups
- Inconsistencies → back through reconcile

**Optional handoff:** Suggest `campaign-qa` for graph health
check. Don't force.

> "I've ingested N sessions of material. Want to run a vault
> health check?"

## Design Principles

1. **Prep is not play.** Most dangerous error. Scenario prep
   describes potential, not reality.
2. **One question at a time.** Bulk questions → shallow answers.
3. **Follow the thread.** Don't move on too quickly.
4. **Synthesize, don't invent.** Only source material + GM.
5. **Every image gets filed.** Non-negotiable baseline.
6. **Flag, don't guess.** Ambiguous → flagged, not resolved.
7. **Entity creation cascades.** One NPC → three locations.

## Model Selection

Match model capability to task complexity. These are
guidelines, not requirements — use whatever models are
available and appropriate for your setup.

| Phase | Complexity | Why |
|---|---|---|
| 1-2 | Light | Classification, grouping — pattern matching |
| 3-6 | Heavy | Judgment, synthesis, GM interaction |
| Entity subagents | Light | Structured file creation from templates |
| Image filing | Light | Format conversion, filename matching |

## Sub-agent Opportunity

Phase 5 entity work parallelizes well. Phase 4 interview
must be sequential.

## Compaction

After all phases, preserve: confirmed events + sources, GM
answers (verbatim), manifest, unresolved items, entity paths.
Discard: intermediate reasoning, processed source material,
failed extractions, superseded interview chains.

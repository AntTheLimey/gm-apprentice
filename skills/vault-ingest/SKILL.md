---
name: vault-ingest
description: "Ingest old campaign materials — notes, character sheets, images, transcripts, spreadsheets — into a structured vault: sort the material, interview the GM to recover what actually happened, and synthesize inputs for downstream skills. Use for bootstrapping a vault from old notes, adding a discovered character sheet mid-campaign, or reconstructing past sessions from archived transcripts. Trigger on 'ingest', 'import old notes', 'I have some old campaign files', 'process these notes into the vault', 'I found some old character sheets', or any request to bring external material into an existing or new vault."
---

Vault ingestion assistant: translates messy old campaign material
into structured inputs that existing skills process, handing off
conversationally (not programmatically) to campaign-organizer,
session-wrapup, `shared/reconcile.md` and, optionally,
campaign-qa.

**Shared references:** Read on first invocation:
`shared/session-principles.md`, `shared/session-document-chain.md`,
`shared/reconcile.md`.

**Skill references:** Read before each phase:
- `references/classification-taxonomy.md` — Phase 1
- `references/image-handling.md` — Phase 1, when images are present
- `references/keeper-interview.md` — Phase 4
- `references/synthesis-templates.md` — Phase 5

## Input Channels

Any mix in one invocation, in any of: Markdown, plain text, Word,
PDF, images, CSV/Excel, chat/VTT exports.

1. **Staging folder** — `_inbox/` in the vault.
2. **External path** — a folder or file outside the vault.
3. **Pasted content** — treat as an implicit source document.

## Bootstrap Detection

On invocation, check for a vault (`_meta/`). If none:

> "I don't see a campaign vault here. Want me to hand off to
> campaign-organizer to set one up first, or point me to your
> vault's location?"

Do not proceed without a vault — entities need its folders,
templates and `_meta/` schema to file correctly.

**Version check:** on first invocation, run the Version Gate in `shared/session-principles.md`.

## Gotchas

1. **Read `_Templates/_Template_{Type}.md` before creating any entity** — the template is canonical; copying existing entities propagates drift and deprecated fields.
2. **One file per entity** — multiple entities per file break wiki-links and publish rendering.
3. **Never modify external source files** — they are the GM's backup and proof of ownership.
4. **Process buckets chronologically, earliest first**, each through Phases 3-6 before the next — later buckets reference entities created by earlier ones.
5. **Archive, never delete, processed `_inbox/` files** — `python3 "${CLAUDE_PLUGIN_ROOT}/skills/shared/scripts/ingest_survey.py" <vault> --archive FILE... --write` moves them to `_inbox/_processed/` with a date stamp, keeping the subpath and refusing to overwrite. Dry-run (no `--write`) first to confirm destinations.
6. **Prep is not play** — scenario prep describes potential, not reality. Dice rolls, skill-check results or specific PC actions are play records wherever they appear.
7. **Flag, don't guess** — anything ambiguous goes to the GM, never resolved by invention.

## The Pipeline

Six phases. vault-ingest owns 1-4; 5-6 hand off to existing skills.

### Phase 1: Survey & Classify

Run `python3 "${CLAUDE_PLUGIN_ROOT}/skills/shared/scripts/ingest_survey.py"
<source-dir>` before reading anything. `DECIDED` rows (settled by
extension, frontmatter or heading signature) need nothing. Read a
`SCORED` row's file only to confirm or override its proposal,
using `references/classification-taxonomy.md`. `UNSCORED` rows
(Word/PDF/VTT) need a manual read. Report `ERROR` rows to the GM.

**Images:** run `python3
"${CLAUDE_PLUGIN_ROOT}/skills/shared/scripts/ingest_images.py"
<vault> <source-dir>` (dry-run) before touching any image by
hand, then `--execute`. Work its report per
`references/image-handling.md`.

**Output:** a manifest table — every item with classification,
brief summary and time-period guess. Ask: "Does this look right?
Any misclassifications?"

### Phase 2: Sort into Buckets

Group items by chapter/session/time period, using explicit
references ("Session 5 notes"), timeline references, NPC/location
clustering (same cast = same period) and the GM's Phase 1 context.
Each bucket gets a working label, its items and a certainty
(certain / probable / needs-GM-input). Ambiguous items go to an
"unsorted" bucket, resolved at the start of Phase 4.

### Phase 3: Extract Play Events

Per bucket, read all AUTHORITATIVE material. Source priority:
1. `_Campaign/Timeline.md`
2. Existing session wrap-ups
3. Play transcripts and fragments
4. `_Campaign/Player Characters.md` — deaths, transitions, rosters
5. Existing entity files — current canon

**Output:** confirmed events (with source citations) and gaps
(things prep says could have happened, unconfirmed).

After creating this bucket's entities, re-run `ingest_images.py
--execute` so images match against them too.

### Phase 4: Keeper Interview

The skill's core value. Read `references/keeper-interview.md` and
follow its Core Rules. Order:

1. Resolve the Phase 2 unsorted items.
2. Resolve image rows left for the GM (`references/image-handling.md`).
3. One question per active PC about their arc across the period
   (`keeper-interview.md` § PC Narrative Arcs).
4. The play-event interview.

### Phase 5: Synthesize & Hand Off

Read `references/synthesis-templates.md`.

1. Buckets with no session files → campaign-organizer creates the
   chapter/session skeleton.
2. Write the synthesis as a Play Notes file per
   `shared/session-document-chain.md`. Block/seam test: keep
   finished-prose blocks from the sources verbatim; author only
   fragment-derived text and seams. A `Session export` row is
   copied into place, not synthesized (synthesis-templates.md §
   Synthesis Rules, rule 7).
3. Follow the session-wrapup workflow for the Wrap-Up file and
   entities. One new entity often implies others (an NPC brings
   locations) — create them too.
4. Each PC active in the period gets a consolidated character
   story entry (synthesis-templates.md § Character Story
   Backstory Entries).

Check each entity as you write it: entity mentions are
`[[Entity Name]]` wiki-links; `play_date` is `YYYY-MM-DD`;
`in_game_date` follows `shared/session-document-chain.md` (never a
fabricated Gregorian date or a time of day). Per bucket, run
`vault_check.py frontmatter --folder <dir>` (see
`shared/vault-access.md`) and fix every ERROR before the next
bucket.

Include a `> [!info] Reconstruction Note` (sources, limitations);
mark uncertain items `<!-- UNVERIFIED -->`.

**Planning documents** (scene designs, arc structures,
investigation flows) become `type: plan` entities in
`Chapters/{chapter}/Planning/` per `_Templates/_Template_Plan.md`,
with `plan_type` `arc`, `scene`, `investigation` or `timeline`.

Entity files parallelize well across subagents; the Phase 4
interview stays sequential.

### Phase 6: Review

Walk the GM through the wrap-up with `shared/reconcile.md`; on
approval it becomes `reviewed` and AUTHORITATIVE.

## Post-Ingestion

After all buckets:
- Deduplicate entities — `vault_check.py names`
- Cross-bucket relationship chains — `graph_check.py all`,
  `vault_check.py relationships`
- Timeline consistency across buckets — by eye (`vault_check.py
  timeline` does not check cross-bucket ordering)
- Entity status progression — `vault_check.py stale-drafts`
- `vault_check.py wrapup` over the generated wrap-ups
- Route inconsistencies back through reconcile

Then offer, without pushing: "I've ingested N sessions of
material. Want to run a vault health check?" (campaign-qa)

## Compaction

Preserve: confirmed events + sources, GM answers verbatim,
manifest, unresolved items, entity paths. Discard: intermediate
reasoning, processed source text, failed extractions, superseded
interview chains.

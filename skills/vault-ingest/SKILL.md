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

Do not proceed without a vault.

## The Pipeline

Six phases, sequential. Phases 1-4 owned by vault-ingest.
Phases 5-6 hand off to existing skills. When multiple buckets
exist, process each through Phases 3-6 before the next
(chronological order, earliest first).

### Phase 1: Survey & Classify

**Model:** Sonnet (classification is pattern matching)

Read all source material. Classify every document or section.
Read `references/classification-taxonomy.md` for the full
taxonomy and heuristics.

**Key heuristic:** If a document contains dice rolls, skill
check results, or specific PC actions, those lines are play
records regardless of what surrounds them.

**Image handling:** Read `references/image-handling.md` for
full procedures. Summary: classify every image file, convert
non-web-safe formats (best-effort via `sips` or `magick`),
match to entities by slugified filename, file in the correct
`_attachments/` subfolder, and link to matched entities.
Unmatched images go on the Phase 4 keeper interview list.

**Output:** Classified manifest — summary table of every source
item with classification, brief content summary, and time-period
guess. Present to GM: "Does this look right? Any
misclassifications?"

### Phase 2: Sort into Buckets

**Model:** Sonnet (grouping by signals)

Group classified items by chapter/session/time period.

**Sorting signals:**
- Explicit references ("Session 5 notes", "Chapter 2 prep")
- Timeline references (in-game dates, event references)
- NPC/location clustering (same cast = same period)
- GM context from Phase 1 confirmation

**Each bucket gets:** working label, classified items,
confidence level (certain / probable / needs-GM-input).

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

**Image linking:** For each entity created or updated in this
bucket, check filed images (from Phase 1) for matches. Single
match → set `portrait`. Multiple matches with clear default
(unsuffixed filename) → set `portrait`, embed rest via
`![[filename]]`. Multiple matches with no default → defer
portrait selection to Phase 4. See `references/image-handling.md`.

### Phase 4: Keeper Interview

The skill's exclusive value. Read
`references/keeper-interview.md` for the full technique.

**Rules:**
1. One question at a time — never bulk lists
2. Contextual framing — trigger memory with scene context
3. Follow the thread — each answer is a door
4. Record as you go — log every answer immediately
5. Know when to stop — "I don't remember" → flag and move on
6. Distinguish confidence — "definitely" vs "I think so"

First resolve any unsorted items from Phase 2 before starting
the play-event interview.

**Image questions:** After resolving unsorted items and before
starting the play-event interview, resolve image assignments:
1. Show each unmatched image — ask the GM which entity it
   belongs to (or "atmosphere art" → `_attachments/documents/`)
2. For entities with multiple images and no clear default —
   ask the GM to pick the portrait
See `references/image-handling.md` for question templates.

### Phase 5: Synthesize & Hand Off

Read `references/synthesis-templates.md` for the output format.

1. For buckets with no existing session files, hand to
   `campaign-organizer` for chapter/session skeleton creation
2. Write synthesized content as a Play Notes file per
   `shared/session-document-chain.md`
3. Follow `session-wrapup` workflow to produce the Wrap-Up
   file and create/update entities

Include `> [!info] Reconstruction Note` with source descriptions
and limitations. Mark uncertain items with `<!-- UNVERIFIED -->`.

### Phase 6: Review

Invoke `shared/reconcile.md` to walk the GM through reviewing
the wrap-up. On approval, promotes to `reviewed` status and
AUTHORITATIVE confidence.

## Post-Ingestion

After all buckets are processed:

**Cross-reference pass:**
- Deduplicate entities across buckets
- Identify relationship chains spanning buckets
- Check timeline consistency
- Validate entity status progression
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

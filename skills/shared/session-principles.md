# Session Principles

Shared rules for the session skills, midwife and vault-ingest. Read on
first invocation.

## Version Gate

Run once, on first invocation, before any other vault work:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/skills/shared/scripts/vault_check.py" <vault> version
```

- `OK` or `SETUP` → proceed.
- `MISMATCH` → announce the row, run campaign-organizer's migration
  workflow (`campaign-organizer/references/migration-procedure.md`),
  then resume your task.
- `AHEAD` → announce the row and tell the GM to update the plugin. Stop.
- `ERROR` → report the row: the plugin install is broken. Stop.
- No verdict row and `not a directory` on stderr → the vault path is
  wrong; ask the GM for it.

## Absolute Rules

- **Read the PC roster first** (`_Campaign/Player Characters.md`):
  every PC, their player, and status (active/retired/dead/NPC).
  Getting status wrong is a serious error.
- **Never estimate scene durations** ("45-60 minutes") — they
  constrain the GM.
- **Characters are the story.** Foreground PC arcs; campaign plot
  serves the characters.
- **Wiki-link every entity reference** — NPCs, locations, items,
  factions, sessions, scenes. Inside a table cell use the plain form
  (`[[Hassan]]`), never `[[Target|Alias]]` or `\|`: both break the
  table when Obsidian reflows it. `vault_check.py <vault> tables`
  catches violations.
- **Reality over plans.** Once played, the plan is dead. Mention
  unplayed prep only if it holds clues the players still need.
- **The Plan is an instrument, not an audit trail.** Scenes, NPC
  references and world state carry no edit history or defences
  against charges nobody made ("formally dropped", "this plan
  revises"). If another file is wrong, fix that file. `## Prior Prep
  Review` stays a terse kept-vs-updated note; durable provenance
  belongs in a QA log.

## Companion Skills

- **ttrpg-expert** — content generation, rules, GM frameworks; hand
  off when gaps need content. Key files: `arc-spotlight-reference.md`,
  `npc-generation.md`, `continuity-engine.md` (Chekhov Protocol,
  Canon Grounding, thread tracking).
- **campaign-organizer** — vault structure and entity filing; hand
  off when work produces new entities (Dissect mode for large
  documents).
- **campaign-qa** — validation; suggest after wrap-up or reconcile.

## Vault

All persistent state lives in the vault (Obsidian or plain folder).
On first invocation read `shared/vault-access.md` and confirm the
campaign folder path.

- `_meta/index.md` — master registry; read first.
- `Chapters/Chapter N/Sessions/`, `Chapters/Chapter N/Scenes/`
- `_Campaign/Timeline.md`

References: `shared/vault-structure.md` (layout, naming),
`shared/entity-schema.md` (types, frontmatter, relationships),
`shared/canon-status.md` (DRAFT/AUTHORITATIVE/SUPERSEDED, promotion),
`shared/session-document-chain.md` (Plan, Play Notes, Wrap-Up and the
session index hub), `shared/reconcile.md` (Wrap-Up review and
promotion).

Session status has no "half-played" value: a session that ended early
is `played`, and unplayed content carries forward. Scene status:
`planned | ready | played | skipped | modified | cut`.

## Play Notes

Accept any form — shorthand, expanded notes, transcripts. Never
correct grammar in stored notes. Extract entities, events and
decisions; cross-reference against prep; ask only when genuinely
ambiguous.

## Session Note Naming

Convention from `_meta/vault-config.md`; default
`Session {NN} - {Title}.md`, zero-padded and evocative
(`Session 07 - The Opera and the Invitation.md`, not
`Session 7 - March 15 2025.md`).

## Canon Workflow

Wrap-up creates entities automatically, without asking: each entity
found goes through campaign-organizer to a vault file at
`canon_status: DRAFT`, wiki-linked into the session note and related
entities. The GM promotes DRAFT → AUTHORITATIVE at their own pace
(`shared/canon-status.md`).

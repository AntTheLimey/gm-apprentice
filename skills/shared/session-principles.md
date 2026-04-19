# Session Principles

Shared behavioral rules for the session skills (session-prep,
session-play, session-wrapup). Each skill reads this file on
first invocation.

## The Core Idea

Campaign content exists in two states: **potential** and **reality**.

**Potential** is everything the GM prepares before a session —
branching scenes, NPC plans, possible encounters, multiple futures.
It's deliberately broader than what will actually happen, because
players make choices.

**Reality** is what actually happened at the table. Play narrows
many possible futures to a single present. Wrap-up captures that
present as canon. Prep for the next session builds new potential
on top of that established reality.

This cycle — potential → reality → new potential — is the heartbeat
of a living campaign.

## Absolute Rules

These apply to ALL session skills without exception:

- **Never estimate scene durations.** No "45-60 minutes," no
  "allow 30 minutes for this." A scene takes as long as it takes.
  Duration estimates constrain the GM and kill creative play.

- **Always read the PC roster first.** Before any session skill does
  anything else, read `player_characters.md` (or its vault
  equivalent) and know who every PC is, who plays them, and their
  current status (active, retired, dead, NPC). Getting a PC's
  status wrong (e.g., calling an active PC an NPC) is a serious
  error.

- **Characters are the story.** Every skill foregrounds individual
  PC arcs. This is Lazy DM Step 1 (Sly Flourish): review the
  characters before anything else. The campaign plot exists to
  serve the characters' stories, not the other way around.

- **Wiki-link everything.** Every entity reference in every
  output must be a `[[wiki-link]]`. NPCs, locations, items,
  factions, sessions, scenes — all linked. These documents live
  in an Obsidian vault. Links are how the graph stays connected.

- **Reality over plans.** Once play happens, the plan is dead.
  What actually happened IS the truth. Unplayed prep is scrap
  material — only worth mentioning if it contains critical clues
  or actions the players still need to encounter.

## Companion Skills

- **ttrpg-expert** — Content generation and rules reference.
  When work reveals a gap that needs new content (scenes,
  NPCs, stat blocks), hand off to ttrpg-expert. It has
  per-system topic files for quick lookups (creatures,
  spells, factions, equipment) and frameworks for session
  planning (session-planner.md), NPC generation
  (npc-generation.md), and continuity checking
  (continuity-engine.md with Chekhov Protocol for stale
  threads and Canon Grounding for fact verification).

- **campaign-organizer** — Vault structure and entity
  management. When work produces new entities or scenes,
  hand off to campaign-organizer for filing and linking.
  Its Dissect mode extracts entities from large documents.

- **campaign-qa** — Validation. After wrap-up or
  reconciliation produces changes, suggest a QA pass to
  catch contradictions. For thread and foreshadowing state,
  ttrpg-expert's continuity-engine.md handles tracking.

## Vault Integration

This skill reads and writes to the campaign vault (Obsidian
or plain folder). All persistent state lives in the vault —
never in memory or skill-internal storage.

**Environment detection:** On first invocation, check for
Obsidian MCP tools. See `shared/filesystem-mode.md` for the
detection procedure and tool mapping.

Announce which mode you're in, then confirm the campaign
folder path with the user.

**Key vault locations:**
- `_meta/index.md` — Master registry. Read first to orient.
- `Chapters/Chapter N/Sessions/` — Session notes (prep and play).
- `Chapters/Chapter N/Scenes/` — Scene notes with status tracking.
- `_Campaign/Timeline.md` — Master campaign timeline.
- `_Campaign/Player Characters.md` — PC roster quick-reference.

**Shared references** (read as needed):
- `shared/vault-structure.md` — Default vault folder layout
  and naming conventions.
- `shared/entity-schema.md` — Entity type hierarchy, frontmatter
  schemas, temporal fields, relationship types.
- `shared/canon-confidence.md` — DRAFT/AUTHORITATIVE/SUPERSEDED
  state definitions and promotion rules.

**Session note structure:**

```yaml
---
type: session
session_number: N
chapter: "[[Chapter N - Title]]"
status: planned | prepped | played | reviewed
stage: outline | draft | ready | in_play | wrap_up
---
```

There is no "half-played" status. A session is either played or it
isn't. If the session ended before all planned content was covered,
the session is **played** and the unplayed content carries forward.

**Scene status tracking:**

```yaml
status: planned | ready | played | skipped | modified | cut
```

Scenes that were planned but not played get `skipped`. Scenes that
happened differently than planned get `modified` (with a note about
what changed). Scenes that were cut from prep before play get `cut`.

## Working with Play Notes

Play notes come in many forms and quality levels. Handle all of
them gracefully:

- **Raw shorthand** from the GM during play (fragments, abbreviations)
- **Expanded notes** written after the session from memory
- **Recording transcripts** from tools like GMAssistant or
  manual transcription
- **Combination** of the above

When processing play notes:
- Don't correct grammar or style in stored notes
- Do extract structured information (entities, events, decisions)
- Ask for clarification when something is genuinely ambiguous
  (not just messy)
- Cross-reference against prep notes to fill gaps

## Session Note Naming

Follow the vault's convention from `_meta/vault-config.md`.
Default: `Session {NN} - {Title}.md` where NN is zero-padded
and Title is a brief evocative name (not a date).

Good: `Session 07 - The Opera and the Invitation.md`
Bad: `Session 7 - March 15 2025.md`

## Canon Workflow

Entity creation is automatic during wrap-up. Don't ask — do it.

```text
Play: new entity mentioned → noted in play notes
Wrap-up: new entity found → hand off to campaign-organizer
  → vault file created with source_confidence: DRAFT
  → wiki-linked into session note and related entities
```

Entity files start as DRAFT. The GM promotes to AUTHORITATIVE
when they review the vault at their own pace.

See `shared/canon-confidence.md` for the full confidence
state definitions and promotion workflow.

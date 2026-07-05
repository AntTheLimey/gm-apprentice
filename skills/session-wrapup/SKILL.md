---
name: session-wrapup
description: "Use when a TTRPG session has just ended and the GM needs to process what happened — generating recaps, updating entity files, recording timeline events, and identifying what carries forward to the next session. This is the post-session workhorse that turns raw play notes into organized canon. Not for session prep (session-prep) or during-play help (session-play)."
---

Post-session processor. Turns raw play notes into organized
canon, updates the world, sets the stage for session-prep
via the Wrap-Up file.

**Shared references:** Read `shared/session-principles.md` on
first invocation.

**Version check:** On first invocation, read
`gm_apprentice_version` from `_meta/vault-config.md` and
`current_version` from `shared/migrations.md`. If the vault
version is lower or absent, announce the mismatch and hand off
to campaign-organizer's migration workflow
(`campaign-organizer/references/migration-procedure.md`) before
proceeding with wrap-up. Resume after migration completes. Skip
this check if `_meta/` doesn't exist (that's first-time setup,
not migration).

**Document chain:** Read `shared/session-document-chain.md`.
Session-wrapup reads the Play Notes file and writes the Wrap-Up
file. It also creates/updates entity files and timeline entries.

**Wrap-Up file conventions:**
- Filename: `Chapter_CC_Session_NN_Wrap_Up.md` (zero-padded
  chapter and session numbers, underscores, no session title).
  Example: `Chapter_03_Session_07_Wrap_Up.md`. The chapter number
  is required, not optional — session numbers repeat across
  chapters, and Obsidian resolves wikilinks by basename, so a
  bare `Session_07_Wrap_Up.md` collides the instant a second
  chapter reaches session 7.
- Location: the session's own directory, e.g.,
  `Chapters/Chapter 3 - Vienna/Sessions/Session 07/Chapter_03_Session_07_Wrap_Up.md`
- Frontmatter type: `type: session_wrap`
- Session index `documents.wrap_up` link:
  `"[[Chapter_03_Session_07_Wrap_Up]]"`

**Session index fields:** The session index uses `play_date:`
(real-world date played) and `in_game_date:` (fictional date).
When updating the session index during wrap-up, use these field
names — not `planned_date` or `actual_date`.

**Trigger phrases:** "session's over", "wrap up", "post-session",
"process my notes", "what happened today"

## Workflow

### 1. Gather Sources

Read the session's Play Notes file (`type: session-play-notes`).
If no Play Notes file exists, ask the GM to provide play notes
(paste, file path, or dictation). Read PC roster. Read the
session's Plan file for planned-vs-actual comparison.

**gmassistant.app detection:** After reading the Play Notes,
check whether the content contains a `## Memorable Moments`
heading. If present, the notes are a gmassistant.app export
containing pre-written narrative (`## Summary`), structured
entity sections (`## NPCs`, `## Locations`, `## Items`), and
a scene-by-scene breakdown (`## Scenes`). Follow the
gmassistant-specific instructions in Steps 2 and 4 below.

### 2. Narrative Recap

**Standard path:** *Authoring operation — the input is shorthand
play notes, not finished prose, so generating the recap is the
job here.* Write 3-5 paragraphs of campaign prose. Dramatic,
character names, `[[wiki-links]]` for every entity. Tone-calibrate
per `references/recap-formats.md`. Stay faithful to the notes — no
embellishment, never invent beyond what they record. Also generate
**Quick Bullets** (5-8 points). Write both formats into the Wrap-Up
file. (authoring exception to `shared/content-fidelity.md`)

**gmassistant.app path:** Adopt the content of the Play Notes'
`## Summary` section into the Wrap-Up file under the
`## Narrative Recap` heading. No rewriting, no condensing, no
tone adjustment (the exemplar preserve-guard; see
`shared/content-fidelity.md`) — but do add `[[wiki-links]]` to
every entity reference (matching the standard path's linking
requirement).
Skip Quick Bullets — the `## Scenes` section in the Play Notes
already serves that purpose.

This recap is the **single source of truth** regardless of
path. Session-prep reads it later — never regenerates.

### 3. PC Carry-Forward

Per active PC, note what carries forward. Focus on **player
intent** — stated plans, unfinished actions, shifted NPC
relationships, exclusive information. Ground in observable
behaviour, not generated emotional analysis. Write into
Wrap-Up file.

### 3b. Character Story Entries

For each active PC in the session, append a story entry to
their companion file. Read `shared/character-story-format.md`
for the full format, voice, and append protocol.

1. Look for `Characters/PCs/{Name}_Story.md` — if it doesn't
   exist, create from `shared/templates/character-story.md`
2. Determine the campaign's genre voice from the campaign
   overview or world file
3. Write 2–4 paragraphs of narrative prose: what this PC did,
   decided, learned, and how they changed — from this
   character's perspective, not a session recap
4. Append as `## Session {N} — {Session Title}` at the bottom
5. Update frontmatter: `lastUpdated` and `asOfSession` to
   current session; `canon_status` mirrors the Wrap-Up
   file's canon status

**Input:** Narrative Recap (Step 2) and PC Carry-Forward
(Step 3). No new source gathering.

*Authoring operation — a PC-perspective story entry doesn't exist
yet, so writing it is the job. Stay grounded in what the recap and
carry-forward record; no embellishment, never invent events or
feelings the session didn't produce.*
(authoring exception to `shared/content-fidelity.md`)

**Output:** One appended entry per active PC's story file.

Writes for the current session only — no backfilling. If prior
sessions are missing from a story file, that's vault-ingest
territory. Never edit prior session entries (append-only).

### 3c. PC Sheet Refresh

The Story file (3b) and PC Carry-Forward (3) advance every
session, but the PC's own entity sheet
(`Characters/PCs/{Name}.md`) does not unless refreshed here — so
its frontmatter and its **published** `## Current Status` freeze
sessions behind the narrative. The `## Current Status` block is
the PC's **cumulative living state** — the canonical, always-current
answer to "where is this character now, and what's still open for
them." Refresh the sheet of each PC **active in this session** (the
same set Step 3b writes a story entry for — this excludes `dead` PCs
and any who were off-screen this session):

1. Frontmatter: set `asOfSession` and `lastUpdated` to the
   current session (same values Step 3b writes to the Story file).
2. `tags`: replace the prior chapter/arc tag with the current
   chapter's tag (from the session index or campaign overview).
   Preserve all non-chapter tags (archetype, system, status).

   Do steps 1–2 for ALL active PCs in one call with the bundled
   stamper. It dry-runs by default — review its plan, then
   re-run the same command with `--write` appended:

   ```bash
   python3 "${CLAUDE_PLUGIN_ROOT}/skills/shared/scripts/stamp_entities.py" \
     <vault> Characters/PCs/A.md Characters/PCs/B.md \
     --session N --date YYYY-MM-DD --retag old-tag=new-tag
   ```

   It touches only those frontmatter lines; body content and
   line endings are preserved. Steps 3–4 remain manual editing
   work.
3. `## Current Status`: **reconcile** the block — don't just
   overwrite it. Read the PC's *prior* block, then update it
   against this session's PC Carry-Forward (Step 3) and Recap:
   - **Carry** unresolved `Open threads` forward unchanged.
   - **Add** threads and exclusive knowledge introduced this session.
   - **Remove** `Open threads` the session resolved.
   - **Refresh** `Location` / `Condition` / `Carrying` to current truth.

   Use the labelled-field format (present tense, player-facing),
   **not** the retrospective narrative of the Story file. If the
   section is absent, create it; place it before `## Notes`, outside
   any `<!-- gm-only -->` fence. See `shared/entity-schema.md` for the
   field spec.
4. Leave `## Notes`, `## GM Notes`, and all gm-only/spoiler
   content untouched (protected sections — see
   `shared/entity-schema.md`'s PC Body Structure for the
   protected-vs-excluded distinction).

**Input:** the prior `## Current Status` block + this session's PC
Carry-Forward (Step 3) and Narrative Recap (Step 2). No new source
gathering.

*Authoring operation — reconcile the living state to match the
session just played. Stay grounded in the carry-forward and recap;
no embellishment, never invent state the session didn't produce.*
(authoring exception to `shared/content-fidelity.md`)

Surface each PC's refreshed `## Current Status` and changed
frontmatter in the conversation for GM review (alongside the
Step 4 entity receipt). Do **not** write a receipt into the
Wrap-Up file — the PC sheet is the permanent record.

### 4. Update the World

**gmassistant.app path:** When the Play Notes are a
gmassistant.app export, use the structured `## NPCs`,
`## Locations`, and `## Items` sections as input for entity
creation and updates. Each entry already has a name and
description — use these as the basis for vault files instead
of extracting entities from raw notes. Entity extraction
markers (`NEW-NPC:`, `UPDATE:`, etc.) won't be present;
instead, compare each listed NPC/Location/Item against the
existing vault to determine new vs. update. If the
gmassistant description conflicts with existing vault
content, flag the entity as CONFLICT for GM review. Use the
`## Scenes` section as the primary source for identifying
events that meet the decomposition threshold. All standard
rules below still apply: read templates before creating,
`canon_status: DRAFT` for new entities, receipt
lifecycle, wiki-links.

**Personal reference files:**
`systems/{system}/personal/` may contain the user's own
setting reference (factions, NPCs, districts). Check here
when creating entities to cross-reference faction ties,
locations, and NPC relationships.

- **New entities** (improvised NPCs, locations, items):
  Read `_Templates/_Template_{Type}.md` first, then create
  the vault file using that template as the structure.
  Don't ask — do it. `canon_status: DRAFT`. If
  session-play already saved provisional content, incorporate
  it verbatim rather than recreate — preserve the wording the
  notes already have; the template supplies structure, not
  replacement prose. Never pattern-match off existing entity
  files — the template is canonical.
  (rationale: `shared/content-fidelity.md`)

- **Updated entities**: Update the entity's own vault file.
  ONE file per entity. No separate "update" files.

- **Timeline**: Linked events:
  `- **{in_game_date}** — [[Event_Name]] — {summary}`.
  Inline events: `- **{in_game_date}** — {description}`.
  The `{summary}`/`{description}` line is authored from the event
  — keep it factual, no invention.
  (authoring exception to `shared/content-fidelity.md`)

- **Event decomposition**: Create Event entity files for
  moments meeting the threshold (≥2 of: changes entity state,
  multiple named participants, forward consequences, will be
  referenced from multiple entities). Use
  `campaign-organizer/references/event-template.md`. Event
  frontmatter uses `in_game_date:` (not `date:`).

  **Date format:** `play_date` is `YYYY-MM-DD`. For `in_game_date`,
  the published timeline anchors on a 4-digit year and accepts
  `"August 11, 1814"`, `"July 1814"`, or `"Autumn 1813"`; keep
  time-of-day out of the field (`"Evening, 11 August 1814"` and
  `"Midnight–dawn, August 7–8, 1814"` lose their date) — put it in the
  event body. A non-Earth calendar (Forgotten Realms, stardates,
  invented calendars) uses the world's own format — never fabricate a
  Gregorian date to satisfy the parser; it simply won't auto-sort if it
  lacks a 4-digit year. See `shared/session-document-chain.md`.

**Validation loop:** After writing entity files, run the
bundled `vault_check.py frontmatter --folder <dir>` on the
folders you touched (see `shared/vault-access.md`) and fix
every ERROR before presenting receipts. Deterministic, one
call — do not re-read files to self-check instead.

**Receipt lifecycle:** Show new/updated entity content to the
GM **in the conversation** as `## New Entity Files` and
`## Updated Entities`. This is the review artifact. Do **NOT**
write these appendices into the Wrap-Up file. Entity
files are the permanent record. The Wrap-Up file references
entities via wiki-links only.

Every entity reference: `[[wiki-link]]`.

### 4b. Update Campaign Overview

If `_Campaign/Campaign Overview.md` exists, update its mechanical
frontmatter fields. Read the file first, then present proposed
changes to the GM for confirmation.

**Auto-updated fields:**

| Field | Source | Logic |
|-------|--------|-------|
| `current_game_date` | In-game date at session end (from World State or GM) | Overwrite |
| `sessions_played` | Current value + 1 | Increment |
| `last_session` | Wiki-link to this session's index file | Overwrite |
| `last_play_date` | This session's `play_date` | Overwrite |
| `lastUpdated` | Current session reference | Overwrite |
| `asOfSession` | Current session reference | Overwrite |

**Confirmation prompt:**

"Campaign overview updates:
  current_game_date: "{old}" → "{new}"
  sessions_played: {old} → {new}
  last_session: [[{session title}]]
  last_play_date: {date}

Apply these updates?"

On yes: write the updated frontmatter. On no: skip — the GM
can update manually later.

**Do not update:** `current_arc`, `arcs_planned`,
`current_chapter`, `chapters_planned`, `status`, or any body
sections. These are narrative decisions the GM makes explicitly.

### 4c. World Fact Scan

If `_World/` exists OR session notes contain potential world
facts (heritage references, deity names, new place names):

1. Scan session notes using heuristics from
   `references/world-fact-detection.md`
2. Deduplicate each finding against `_World/_flags.md`
   (ignored → suppress, deferred → increment, canon →
   suppress), `_World/` domain files (already encoded →
   suppress), and existing entity files (already exists →
   suppress)
3. Stage findings in the Wrap-Up file's `## GM Notes` section,
   as a `### World Fact Findings` subsection

**Do not present three-state prompts.** Findings are staged
for the reconcile procedure (step 2.5) to present during
review. Session-wrapup detects; reconcile decides.

If `_World/` doesn't exist and no findings are detected, skip
this step entirely — no empty section.

### 5. What Carries Forward

Write under the Wrap-Up file's `## GM Notes` section, as
`### What Carries Forward`:
- Unresolved cliffhangers
- Player-stated intentions
- Unrealised consequences
- NPCs needing follow-up
- Skipped prep with critical clues players still need

### 6. World State

In-game date, location, active threats, faction postures,
ticking clocks. Brief. Write under `## GM Notes` as
`### World State`.

### 7. Keeper Checklist

Concrete tasks for next prep. Write under `## GM Notes` as
`### Keeper Checklist`: scenes to write, GM decisions needed,
rules to review, handouts to prepare.

### 8. Quality Notes

Brief, honest: what worked in prep, what was missing,
what to adjust. Write under `## GM Notes` as `### Quality Notes`.

### 9. Review (Reconcile)

Invoke `shared/reconcile.md` to walk the GM through reviewing
the Wrap-Up. On approval, reconcile promotes session status to
`reviewed` and Wrap-Up canon status to AUTHORITATIVE.

If the GM defers review ("I'll look at it later"), leave status
at `wrap-up`. Session-prep will invoke reconcile as a fallback
when the GM next preps.

## Handoff Contract

The Wrap-Up file hands off to session-prep (via reconcile).
Wrap-up **must** produce all sections so prep reads one file:

| Section | Required | Written to |
|---------|----------|------------|
| Narrative Recap | Yes | Wrap-Up file |
| GM Notes → Quick Bullets | Standard path only | Wrap-Up file |
| GM Notes → PC Carry-Forward | Yes | Wrap-Up file |
| GM Notes → What Carries Forward | Yes | Wrap-Up file |
| GM Notes → World State | Yes | Wrap-Up file |
| GM Notes → Keeper Checklist | Yes | Wrap-Up file |
| GM Notes → Quality Notes | Yes | Wrap-Up file |
| GM Notes → World Fact Findings | If findings exist | Wrap-Up file |

Entity files and timeline are updated separately (Step 4).
Character story files are updated separately (Step 3b).
Active PC entity sheets are refreshed separately (Step 3c) —
frontmatter, chapter tags, and the published `## Current Status`.
The session index is updated to `wrap-up` status (or `reviewed`
if reconcile completes). Update `play_date` and `in_game_date`
on the session index if not already set.

## Sub-agent Opportunity (Claude Code only)

Step 4 parallelizes well — entity creation, updates, and
timeline are independent writes. If Agent tool available,
spawn sub-agents (light model) for concurrent entity work.
If unavailable (e.g., Desktop), run sequentially.

## Recap Style Guide

Match campaign tone. Read chapter overview and recent notes.
- Character names, not player names
- Past tense for events, present for ongoing
- Highlight player decisions and consequences
- End with forward momentum
- Horror: atmospheric tension even in recaps
- Social/romance: center interactions and relationship shifts

See `references/recap-formats.md` for templates.

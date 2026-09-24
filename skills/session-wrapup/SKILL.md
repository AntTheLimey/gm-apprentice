---
name: session-wrapup
description: "Use when a TTRPG session has just ended and the GM needs to wrap up or process play notes — recaps, entity file updates, timeline events, and what carries forward to the next session. Turns raw play notes into organized canon. Not for session prep (session-prep) or during-play help (session-play)."
---

Post-session processor: turns the Play Notes into canon and
writes the Wrap-Up file that session-prep reads next.

**On first invocation:** read `shared/session-principles.md` and
`shared/session-document-chain.md` (filename, location, date
formats, frontmatter).

**Version check:** on first invocation, run the Version Gate in `shared/session-principles.md`.

**Wrap-Up file:** read `shared/templates/session-wrap.md` (vault
copy `_Templates/_Template_Session_WrapUp.md` if present) and
create the file from it — it is the canonical frontmatter, heading
set and section order. Fill all its frontmatter. Sections land in
template order whatever order the steps below visit them. Every
section not marked optional/conditional is required; omit empty
optional ones, and leave `### Reconciliation Context` to
reconcile. Keeper-facing content goes only at `###` under the
fenced `## GM Notes` — never a new H2 (a sibling H2 publishes to
player sites). Filename `Chapter_CC_Session_NN_Wrap_Up.md` in the
session's own directory — the chapter number is required.

**Session index:** stamp it (dry-run, then `--write` on
confirmation):

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/skills/shared/scripts/stamp_entities.py" \
  <vault> "<session index>" --set status=wrap-up \
  --set play_date=YYYY-MM-DD --set in_game_date="<fictional date>" \
  --set documents.wrap_up="[[Chapter_CC_Session_NN_Wrap_Up]]"
```

Use `play_date`/`in_game_date`, never `planned_date`/`actual_date`.
The script sets scalars only: edit the index's `scenes:` list by hand
to the scenes actually played; unplayed ones go under Skipped Prep.

**Authoring vs. preserving:** four outputs are authoring
exceptions to `shared/content-fidelity.md`, because the source is
shorthand and no prose exists yet — the Step 2 recap, Step 3b
story entries, Step 3c `## Current Status`, and timeline summary
lines. Write them faithful to the notes (or recap and
carry-forward): no embellishment, invent nothing the session
didn't produce. The synthesized GM Notes sections (What Carries
Forward, World State, Keeper Checklist, Quality Notes) are
grounded too: each claim traces to the Play Notes, the plan or a
named vault file; mark anything uncertain `<!-- UNVERIFIED: … -->`
for reconcile. Everything
else that moves existing text keeps it verbatim.

## Workflow

### 1. Gather Sources

If the campaign has a published site with live tracking (status
bar or change-request inbox), first run `npx gm-apprentice-publish
flush` in the site directory and report its per-PC summary
(publish-site `references/live-state-flush.md`). No Tier-2 site →
skip.

Read the session's Play Notes (`type: session-play-notes`); if
none exists, ask the GM for notes (paste, path, or dictation).
Read the PC roster and the session's Plan for planned-vs-actual.
`plan_check.py <plan> --inventory` gives per-section status and
word counts but not scene titles — open the plan body for those.

**gmassistant.app export:** if the Play Notes contain a
`## Memorable Moments` heading, they are a gmassistant.app
export — read `references/gmassistant-export.md`, which changes
Steps 2 and 4.

### 2. Narrative Recap

Write `## Narrative Recap` from the Play Notes, with every entity
`[[wiki-linked]]`; tone per `references/recap-formats.md`, set
from the chapter overview and recent notes. Add Quick Bullets and
Memorable Moments when the template's conditions call for them.
The recap is the single source of truth — session-prep reuses it,
never regenerates it.

### 3. PC Carry-Forward

**Active PC roster** (also used by 3b and 3c): `python3
"${CLAUDE_PLUGIN_ROOT}/skills/shared/scripts/vault_check.py"
<vault> active-pcs`, minus any PC off-screen this session.

Per active PC, one `#### [[PC Name]] (Player)` block with the
template's labels (omit empty ones). Focus on player intent — stated plans,
unfinished actions, shifted NPC ties, exclusive information —
grounded in observable behaviour, not generated emotional
analysis.

### 3b. Character Story Entries

Per roster PC, append this session's entry to
`Characters/PCs/{Name}_Story.md` (create from
`shared/templates/character-story.md` if absent), following
`shared/character-story-format.md` — read it. Genre voice comes
from the campaign overview or world file. Source: Steps 2–3 only.
Set `canon_status` to mirror the Wrap-Up's. Current session only —
missing earlier entries are vault-ingest's job.

### 3c. PC Sheet Refresh

Refresh each roster PC's `Characters/PCs/{Name}.md` so its
frontmatter and published `## Current Status` don't fall behind
the narrative.

1. Stamp all roster PCs in one call — `asOfSession`/`lastUpdated`
   (same values as 3b) and the chapter tag swapped for the current
   chapter's, from the session index or campaign overview
   (non-chapter tags stay). Dry-run, review, then re-run
   with `--write`:

   ```bash
   python3 "${CLAUDE_PLUGIN_ROOT}/skills/shared/scripts/stamp_entities.py" \
     <vault> Characters/PCs/A.md Characters/PCs/B.md \
     --session "<asOfSession value>" --date YYYY-MM-DD --retag old-tag=new-tag
   ```

   `--session` is written verbatim: match the vault's existing
   shape (`"Chapter 4, Session 9"` or `9`). On a shape `ERROR`,
   re-run with the matching form, not `--force-shape`.
2. Reconcile `## Current Status` against the prior block, Step 3
   and the recap: carry unresolved `Open threads` unchanged, add
   new threads and exclusive knowledge, remove resolved threads,
   refresh `Location`/`Condition`/`Carrying`. Labelled fields,
   present tense, player-facing — not Story-file narrative. Create
   it if absent. Field spec, placement and protected sections:
   `shared/pc-body-structure.md`. Leave `## Notes`, `## GM Notes`
   and all gm-only/spoiler content untouched.
3. Write an advancement change (XP, points) to a sheet only when
   the Play Notes or the GM give the amount; a missing award goes
   in the Keeper Checklist.

Show each PC's refreshed block and frontmatter changes in the
conversation with the Step 4 receipt; write no receipt into the
Wrap-Up — the PC sheet is the record.

### 4. Update the World

Personal setting reference may sit in `systems/{system}/personal/`
— check it for faction ties, locations and NPC relationships when
creating entities.

- **New entities:** read `_Templates/_Template_{Type}.md`, create
  the file from it, `canon_status: DRAFT`. Content session-play
  already saved goes in verbatim — the template supplies structure,
  not replacement prose. Never pattern-match off existing entity
  files.
- **Updated entities:** edit the entity's own file — one file per
  entity, no separate update files. A GM ruling that replaces an
  earlier one: strike the old one through and append
  `superseded YYYY-MM-DD` in the same edit.
- **Cross-entity claims:** when a note asserts something about a
  *different* existing entity (e.g. an aside in a NEW-NPC line
  placing an established NPC somewhere new), never fold it silently
  into that entity's file. Ask the GM once per claim. Confirmed →
  write it there and log it under the Wrap-Up's `### Cross-Entity
  Claims`. Unconfirmed or deferred → log it there with `<!--
  UNVERIFIED: {claim} -->`; reconcile scans the Wrap-Up for these
  and blocks promotion.
- **Relationship edges:** every `type:` comes from
  `_meta/relationship-types.md`. Map narrative verbs to the nearest
  sanctioned predicate, store the base direction (`owned_by A→B` →
  `owns B→A`), and drop non-edges (`appears_in <session>`). Table:
  `shared/relationship-normalization.md`. Never invent a `type:`.
  Mirror each edge in the body's `## Related` (a `gm_only` edge in
  `### Hidden Ties`), per `shared/entity-schema.md` § Relationships.
- **Campaign logs:** each entity that appeared this session gets one
  bullet in its `## Campaign Log` (a Creature's is `## Encounters`),
  as the party saw it: `- **[[Session link]]** — {what happened}`.
  Where the truth differs, add the matching bullet to its GM Notes
  `### Behind the Scenes`. Add either section if the file lacks it.
- **New container entities** (a district between a station and its
  venues, a cell between a faction and its members): offer each
  child for re-pointing, yes/no each, and set the child's fields per
  `shared/relationship-normalization.md` § Interposing a new
  container.
- **Timeline:** linked `- **{in_game_date}** — [[Event_Name]] —
  {summary}`; inline `- **{in_game_date}** — {description}`.
- **Events:** create an Event file from `_Templates/_Template_Event.md`
  (dated with `in_game_date:`) when a moment meets its threshold.

**Validate** with one call each, then fix every ERROR before
presenting receipts: `vault_check.py frontmatter --folder <dir>`
per folder touched, `vault_check.py relationships` with `--file
<path>` repeated for every vault-relative path Step 4 created,
edited or re-pointed — new/updated entities, re-pointed container
children, cross-entity claim targets, Event files — `vault_check.py
pc-body` with `--file Characters/PCs/{Name}.md` repeated for every
PC refreshed in 3c, `vault_check.py wrapup --file <wrap-up>`. If
Step 4 ran as sub-agents, also run `relationships` once more with
`--newer-than <session index>` (stamped once, before Step 1, and
never touched again) as a completeness cross-check on the `--file`
list — a row naming a path that isn't in that list, isn't a 3b/3c
PC or Story file and isn't the Wrap-Up means a sub-agent
under-reported. Don't re-read files to self-check.

**Receipts:** show new/updated entity content in the conversation
as `## New Entity Files` and `## Updated Entities`, never in the
Wrap-Up file, which only wiki-links entities.

Step 4's writes are independent: with the Agent tool, run them as
parallel light-model sub-agents, each returning the vault-relative
paths it wrote for Validate's `--file` list and cross-check;
otherwise sequentially.

### 4b. Update Campaign Overview

If `_Campaign/Campaign Overview.md` exists:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/skills/shared/scripts/stamp_entities.py" \
  <vault> "_Campaign/Campaign Overview.md" \
  --set current_game_date="<in-game date at session end>" \
  --increment sessions_played \
  --set last_session="[[<this session's index title>]]" \
  --set last_play_date=YYYY-MM-DD \
  --session N --date YYYY-MM-DD
```

Show the dry-run rows to the GM as-is — they are the confirmation
prompt. Yes → re-run with `--write`; no → skip. Leave
`current_arc`, `arcs_planned`, `current_chapter`,
`chapters_planned`, `status` and the body to the GM.

### 4c. World Fact Scan

If `_World/` exists or the notes hold likely world facts
(heritages, deities, new place names), apply
`references/world-fact-detection.md` and stage findings as
`### World Fact Findings`. Stage only — reconcile (step 2.5)
presents the three-state prompts.

### 5. Remaining GM Notes

Fill What Carries Forward, World State, Keeper Checklist, Quality
Notes and Handoff to session-prep (the section session-prep reads
first) per the template. Whatever an older vault template copy says:
Skipped Prep lists every planned scene and clue that didn't fire,
with what the players still need; Pending Consequences are decisions
whose effects haven't landed; Advancement records what the sheet or
notes show, never awards.

### 6. Review (Reconcile)

Run `shared/reconcile.md`; on approval it promotes the session to
`reviewed` and the Wrap-Up to AUTHORITATIVE. If the GM defers,
leave status `wrap-up` — session-prep runs reconcile as a fallback.

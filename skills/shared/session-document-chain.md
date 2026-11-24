# Session Document Chain

Each session splits into separate documents, each owned by one skill.

## Document Types

### 1. Session Index (`Session {NN} - {Title}.md`)

The hub: metadata and links only, no prose. Blank:
`shared/templates/session.md` (provisioned as
`_Templates/_Template_Session.md`).

```yaml
---
type: session
session_number: N
chapter: "[[Chapter N - Title]]"
campaign: ""
play_date: null
in_game_date: null
status: planned
documents:
  plan: "[[Session NN - Title - Plan]]"
  play_notes: "[[Session NN - Title - Play Notes]]"
  export: null
  table_log: null
  wrap_up: "[[Chapter_CC_Session_NN_Wrap_Up]]"
world_evolved: null
tags: []
---
```

**Date fields:** `play_date` is the real-world play date, always
`YYYY-MM-DD`. `in_game_date` is the fictional date, in whatever form
the story keeps. A story without a calendar is normal: `"Day 2,
morning"`, `"Night 1"`, or nothing at all. A relative date like that
stays off the site's date-sorted timeline (it never invents a year
for one); with no date the site can sort, the menu's Timeline is the
campaign's own Timeline note, published as written, and nothing warns. Once
the campaign's dates carry a **4-digit year** (some session's, event's
or timeline entry's; a game may gain one later), the site's timeline
sorts by it and accepts ISO dates, month-name dates (`"August 11,
1814"`, `"July 1814"`) and seasonal phrases (`"Autumn 1813"`). From
then keep time-of-day out of the field (`"Evening, 11 August 1814"`
loses its date) — put it in prose. For a non-Earth calendar, record
the world's own format and never fabricate a Gregorian date.

**Status** is the furthest document that exists:

| Status | Meaning |
|--------|---------|
| planned | Index created, no other documents |
| prepped | Plan file exists |
| played | Play Notes, an Export or a Table Log exists |
| wrap-up | Wrap-Up file exists |
| reviewed | GM has reviewed and confirmed the Wrap-Up |

Derive/verify with `gma vault-check <vault> sessions`; fix with
`gma stamp-entities … --set status=…` (see `shared/vault-access.md`).
In a player-mode vault with a publish list, it also
warns on any played (`played`/`wrap-up`/`reviewed`) session index or
its Wrap-Up that is not under Publishing, saying what happens next:
`manifest publish-played` (run by reconcile step 6.1 and publish-site)
registers a reviewed session with its linked Wrap-Up, and publish-site
asks the GM about the rest. Entity notes that came out in play are
published by wrap-up step 5c, never sessions or Wrap-Ups.

**`world_evolved`:** the session reference (e.g. `"Session_07"`) set by
reconcile step 6.5 once world evolution has run for it, so it is not
offered twice. Null until then.

**Body:** the H1 title, nothing else outside an optional fenced
`## GM Notes`. The hub is metadata only by
design. Once the session has a published Wrap-Up (linked by
`documents.wrap_up` or by the Wrap-Up's own `session:`), the site
withholds the hub body — from the page, search, backlinks and the
landing — and builds the session page from this frontmatter plus the
Wrap-Up's recap opening, with a link to the Wrap-Up. It never lists
scenes, since a prepped scene that never ran is a spoiler. Until then the
body publishes as written, so a vault that keeps its recaps in the
hub, with no Wrap-Ups, still has them on its site.

That window is why bookkeeping never goes in the hub body: a played
session's hub is live before its Wrap-Up exists. Each kind has a
document that owns it, where the skill that needs it reads it:

| Bookkeeping | Where it goes |
|---|---|
| Plan, Play Notes, Export, Table Log, Wrap-Up links | frontmatter `documents:` |
| Scene Index with prep states, key prep, image prompts, pre-play premise | the Plan |
| Handoff briefs after play | the Wrap-Up's fenced `## GM Notes` |

A GM who wants a working dashboard on the hub keeps it inside one
`<!-- gm-only -->`/`<!-- /gm-only -->` pair under `## GM Notes`, as the
template shows. For a session with a Wrap-Up, `gma vault-check <vault> sessions` reports body lines outside that fence as INFO, naming where
each kind belongs.

### 2. Session Plan (`Session {NN} - {Title} - Plan.md`)

Written by session-prep: scenes, NPCs, threads, hooks, decision
points, GM notes. Archived after play — not deleted, not updated.

```yaml
---
type: session-plan
session: "[[Session NN - Title]]"
chapter: "[[Chapter N - Title]]"
campaign: ""
canon_status: DRAFT
created_by: session-prep
tags: []
---
```

### 3. Play Notes (`Session {NN} - {Title} - Play Notes.md`)

Raw record of what happened: written during play (session-play),
reconstructed by vault-ingest, or entered manually.

```yaml
---
type: session-play-notes
session: "[[Session NN - Title]]"
session_number: N
chapter: "[[Chapter N - Title]]"
campaign: ""
canon_status: AUTHORITATIVE
created_by: session-play    # or: vault-ingest | manual
publish: false              # raw notes: the GM site still shows them
tags: []
---
```

### 3b. Export (`Session {NN} - {Title} - Export.md`)

A table assistant's record of the session (a gmassistant.app export),
placed whole and unedited: its `## Summary` is never rewritten. Filed
by `vw export-new --session "<index>" --export PATH` (or `--export` on
`session-new` / `play-notes-new`), which links it as
`documents.export`. It sits beside the Play Notes, never inside them:
each play record is its own file with one writer, so session-play can
keep writing the Play Notes while the export arrives, in either order.
The site treats it as it treats the Play Notes: `publish: false`
keeps it off the player site, with or without a publish list, and the
GM site still gives it a page, linked from the session's Story page.

```yaml
---
type: session-export
session: "[[Session NN - Title]]"
session_number: N
chapter: "[[Chapter N - Title]]"
campaign: ""
canon_status: AUTHORITATIVE
created_by: manual          # or: session-play | vault-ingest (--created-by)
publish: false
source_file: "export.md"
tags: []
---
```

Older vaults may hold an export inside the Play Notes, under
`## Narrative Record`; wrap-up reads it there too.

### 3c. Table Log (`Session {NN} - {Title} - Table Log.md`)

The run sheet's record of the table: where everyone ended, which Plan
points landed, what was handed over, loot and vitals. It is the third
play record, beside the Play Notes and the Export, and its own file with
one writer: the run sheet (`gma table` files and writes it).
session-play never writes a Table Log. It is linked as
`documents.table_log`. It is never a player-site page, whatever its
`publish:` says or a publish list holds: it carries foes' numbers,
unmasked names and the GM's vitals. The GM site always gives it a page,
and session-wrapup reads it. A Table Log is numbers, not
narrative, so it is never a Wrap-Up's `source_document`.

```yaml
---
type: session-table-log
session: "[[Session NN - Title]]"
session_number: N
chapter: "[[Chapter N - Title]]"
campaign: ""
canon_status: AUTHORITATIVE
created_by: run-sheet       # or: manual
publish: false
tags: []
---
```

**Body:** these `##` sections, in this order, with this exact text.
Every section is a bulleted list (links where a note exists) except
`Vitals at the end` and `Log`.

1. `Where everyone ended`
2. `Stopped in`
3. `Points landed`: Plan points the players took
4. `Tried and missed`: points the GM tried to land and the players did
   not take
5. `Overtaken`: points events made moot
6. `Reached but not landed`: the beat was reached, its point not taken
7. `Not reached`: the beat never came up
8. `Changed since play started`
9. `Contingencies that fired`
10. `Improvised beats`
11. `Places the party went`: one `- [[Place]]` per known place a PC
    stood at tonight, in order of first arrival (a Plan beat's place, a
    hub spot's note, or a known place moved to)
12. `Unmasked this session`
13. `Sides set`: bullets, `- [[Note]]: foe`, `ally` or `neutral`; a side
    the GM set that every copy of the note shared
14. `Handouts handed over`
15. `Log`: bullets, `- HH:MM text`
16. `Loot`: bullets, `- [[Item]] to [[Who]]`
17. `Vitals at the end`: a table `| Who | HP | Conditions |`, with the
    columns the system's `game_systems` entry lists under
    `run_sheet.vitals` (Call of Cthulhu: `| Who | HP | MP | SAN | Luck |
    Conditions |`; GURPS: `| Who | HP | FP | Conditions |`); the Who cell
    is a bare wikilink (`[[Name]]`, no pipe: Obsidian's table rule) and
    the HP cell is `current/max` or `current`. MP and FP are
    `current/max`; SAN and Luck are bare numbers
18. `Advancement`

How the run sheet writes them: `Log` is `- HH:MM Beat title: text`, or
`- HH:MM text` with no beat; `Where everyone ended` is `- [[PC]]:
[[Place]]` (`- [[PC]]: [[Hub place]] (spot words)` for a spot with no
note, `- [[PC]]: Beat title` for a beat with no place, or `off-screen`,
`not placed`); `Not reached` is one `- Beat title` per beat; each line
the GM typed under `Advancement` is one bullet; an ally's copies are
`| [[Guard]] 2 | 9/11 | |`, the number outside the link; a carried
unmasking turned off tonight is `- [[Note]] masked again`. `Sides set` is carried
to the next session as that note's starting side; `Improvised beats` holds
`- New place: <name>` for a place the GM typed tonight (no note yet: wrap-up
offers to make one) and a bare `[[Place]]` link for a known place the
party was at (moved there, or fought there), which wrap-up's reveal pass
reads to offer publishing it. `Places the party went` links every known
place a PC stood at, even one they moved on from; a place typed tonight
stays plain words under `Improvised beats`. A place's link carries its
title when the link would not say it (`[[Places/North/index|North]]`), and
the reveal pass reads this section too. A fight's
start, rounds and end are `Log` lines, and a vitals row comes from the
last fight when it changed the figure. A figure written `12/40 (after
the fight, 20:14)` is the last one the sheet saw, not one set at the
end. Vitals rows are only values the GM set, a fight changed or a long
rest gave, so a GM who touched nothing leaves bare headings.

A section with nothing in it, or missing altogether, means nothing was
recorded for it. It is never an error, and never read as "none
happened"; wrap-up works as it does without a Table Log.

**Where the records disagree:** the Table Log wins for numbers (HP,
vitals), loot, point states and where everyone ended; the Play Notes and
Export win for what was said and decided. Wrap-up names each
disagreement in its review. Where the Table Log's end-of-session vitals
differ from what flush wrote, the review names both and the GM picks.
The run sheet starts an ally from the latest played session's Table Log
whose vitals name it, else the note.

### 4. Session Wrap-Up (`Chapter_CC_Session_NN_Wrap_Up.md`)

Canonical record of the session. Starts DRAFT, promoted to
AUTHORITATIVE via reconcile.

Filename: zero-padded chapter and session numbers, no title —
`Chapter_03_Session_07_Wrap_Up.md`, in the session's own directory
(`Sessions/Session 07/`). Never drop the chapter number: session
numbers repeat across chapters and Obsidian resolves links by
basename.

```yaml
---
type: session_wrap
session: "[[Session NN - Title]]"
session_number: N
chapter: "[[Chapter N - Title]]"
campaign: ""
play_date: null                # "YYYY-MM-DD"
in_game_date: null             # the story's own form (see Session Index)
source_document: "[[Session NN - Title - Play Notes]]"
canon_status: DRAFT
created_by: session-wrapup
reconciled: null               # stamped "YYYY-MM-DD" by reconcile
tags: []
---
```

Keep both `session:` (link) and `session_number:` (scalar) —
consumers key on each.

**Body:** canonical in `shared/templates/session-wrap.md`
(provisioned as `_Templates/_Template_Session_WrapUp.md`). The
player-facing sections come first — `## Narrative Recap` (the site's
session recap), optional `## Memorable Moments`, and any other `##`
the GM or the story calls for — then one `## GM Notes` H2 inside a
single `<!-- gm-only -->`/`<!-- /gm-only -->` pair holding every
Keeper-facing subsection at `###`. Keeper-facing content never gets
its own top-level H2: it would publish to player sites.

A reconstructed session (vault-ingest) opens with a
`> [!info] Reconstruction Note` callout naming sources, date and gaps,
fenced `<!-- gm-only -->`.

## Skill Ownership

| Skill | Reads | Writes | Status Transition |
|---|---|---|---|
| session-prep | Previous wrap-ups, vault | Plan file; index `status`, `documents.plan` | planned → prepped |
| session-play | Plan file | Play Notes file, session index | prepped → played |
| `vw export-new` | The export file | Export file, session index | prepped → played |
| run sheet | The Plan, the run sheet's table state | Table Log file, `_meta/table/`, session index | prepped → played |
| session-wrapup | Play Notes, Export and Table Log | Wrap-Up file, entities, session index | played → wrap-up |
| reconcile | Wrap-Up file | Promotes canon status, session index | wrap-up → reviewed |
| vault-ingest | Old source material | Play Notes (reconstructed), session index | Then chains to wrapup → reconcile |

## Rules

1. **Each skill writes only the documents it owns.**
2. **Documents are append/update, never replace.**
3. **The session index is the single source of truth for status.**
4. **Missing documents are normal**, especially for reconstructed
   sessions.
5. **The chain is the same for played and reconstructed sessions**;
   only `created_by` and the reconstruction note differ.

## File Layout

```text
Chapters/Chapter 1 - Title/Sessions/
└── Session 01/
    ├── Session 01 - The Arrival.md           (index)
    ├── Session 01 - The Arrival - Plan.md
    ├── Session 01 - The Arrival - Play Notes.md
    ├── Session 01 - The Arrival - Export.md   (when there is one)
    ├── Session 01 - The Arrival - Table Log.md   (when there is one)
    └── Chapter_01_Session_01_Wrap_Up.md
```

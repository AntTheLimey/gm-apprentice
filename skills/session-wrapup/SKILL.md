---
name: session-wrapup
description: "Use when a TTRPG session has just ended and the GM needs to wrap up or process play notes — recaps, entity file updates, timeline events, and what carries forward to the next session. Turns raw play notes into organized canon. Not for session prep (session-prep) or during-play help (session-play)."
---

Post-session processor: turns the Play Notes into canon and
writes the Wrap-Up file that session-prep reads next.

`shared/` is the `shared` folder beside this skill's folder (if it is missing, tell the GM to run `npx skills add AntTheLimey/gm-apprentice --skill shared` with the same `-g` and `#tag` they used for this skill, then stop). `gma` is `python3 "<shared>/scripts/gma.py"`,
with the whole path quoted; `gma llms` lists its commands.

**On first invocation:** read `shared/session-principles.md` and
run its Version Gate, then read `shared/session-document-chain.md`.

**Writing: one batch.** `vw` is `gma vault-write <vault>`: you write,
it places. Nothing else goes into the vault step by step (the
exceptions: step 1's `session-new`/`play-notes-new`, an approved
voice, and step 4's hand edits after the write). The steps below
write their blocks into batch files outside the vault (your scratch
folder, else the system temp folder), named for this session and
numbered: `wrapup-S17-1.txt`, `wrapup-S17-2.txt` and so on, a few
steps per file. Write each file once, straight, with your file-writing
tool. Never generate a batch file with a script or convert one from
another file, and never keep the text in a second copy: that writes
everything twice, and writing is the dearest part of a wrap-up. A
block is a line `=== <command> <args>` and then
that command's stdin. Commands: every `vw` writer with its own
arguments (`wrapup-new`, `wrapup-add`, `story`, `npc-story`,
`status`, `log`, `timeline`, `threads`, `scene-played`,
`scene-paused`, `entity-new`), plus `stamp <file>... <stamp-entities options>`,
`note-new <path>` (body: the whole note) and `section <note>
"<heading>" [--append | --replace]` (body: text for that one section,
found by heading path; no need to read the note first), and on the
export path `names` (`references/gmassistant-export.md`). A body line
that starts `===` is written `\===`. Blocks run in order, so a later
one may use what an earlier one makes. Step 5b reads the files
together, in order, as one batch, shows the GM the whole of it once
and writes it once.

**Session index:** the batch's first block stamps it:

```text
=== stamp "<session index>" --set status=wrap-up --set play_date=YYYY-MM-DD --set in_game_date="<fictional date>" --set documents.wrap_up="[[Chapter_CC_Session_NN_Wrap_Up]]"
```

Use `play_date`/`in_game_date`, never `planned_date`/`actual_date`.
After Step 1, account for each Plan-linked scene and each in its
`--carry` Paused Scenes. One the GM confirms ran to its end (a
paused one finishing tonight too): a block
`=== scene-played --scene "<scene>" --session "<session index>"`.
One the notes show stopped part-way (planned, resumed or born at the
table): confirm with the GM that it paused, then write from the Play
Notes (and the Table Log's `Stopped in`, if any) what the GM needs to pick it up cold. Examples, not a list to
fill: a fight's initiative order with NPCs and monsters, the round,
each combatant's condition and position, PC vitals from step 1's
`flush` summary if any; a social set piece's progress, conversations
had, clues dropped, where everyone is, what each PC is in the middle
of; a cliffhanger: who was there. It goes in a block
`=== scene-paused --scene "<scene>" --session "<session index>"`
with the snapshot as its body; `--new` only for a scene with no note
(it files one in the session's chapter). Others born at the table
that finished get no file. One the GM says won't be finished:
`=== scene-played --scene "<scene>" --dropped`. Unplayed ones go
under Skipped Prep.
Leave the index body alone: handoffs and notes for next session go in
this Wrap-Up's GM Notes.

**Wrap-Up file:** after the stamp, a block `=== wrapup-new --session
"<session index>" --source "<notes' origin>"` creates it. Its name,
`<wrap-up>` below, is the one the stamp sets,
`Chapter_CC_Session_NN_Wrap_Up` (two digits each); end the first
file there (scene blocks aside), and a dry run of it confirms the name. Sections,
per `shared/templates/session-wrap.md` (vault copy
`_Templates/_Template_Session_WrapUp.md` if present), go in
`=== wrapup-add "<wrap-up>"` blocks, several sections per block
(`--replace` rewrites a section already there). Those not marked
optional/conditional are required. Add any section the GM or the
story calls for. `##` is for players and keeps every deeper heading
sent after it in that block, up to one the template names; everything
else at `###` or below goes under GM Notes. So send Keeper sections
first or in a block of their own. "players will see this" rows name
what players can read: in the review, point out any new section or
sub-section for players the template lacks that the GM did not ask
for.

**Authoring vs. preserving:** five outputs are authoring
exceptions to `shared/content-fidelity.md`, because the source is
shorthand and no prose exists yet — the Step 2 recap, Step 3b
story entries and NPC passages, Step 3c `## Current Status`, and
timeline summary lines. Write them faithful to the notes (or recap and
carry-forward): no embellishment, invent nothing the session
didn't produce. The synthesized GM Notes sections (What Carries
Forward, World State, Keeper Checklist, Quality Notes) are
grounded too: each claim traces to the Play Notes, the plan or a
named vault file; mark anything uncertain `<!-- UNVERIFIED (S{n}): … -->`
for reconcile, tagged with this session (`Ch{c} S{n}` if it has a
chapter). Everything
else that moves existing text keeps it verbatim. Voices shape the
recap, Story entries and NPC passages; records stay plain
(Campaign Log, timeline, Carry-Forward, Keeper Checklist,
`## Current Status`, entity Overviews). A GM correction of voiced
prose: replace it, then offer to fold the lesson into the voice
(`shared/voice.md`).

## Workflow

### 1. Gather Sources

If the campaign has a published site with live tracking (status
bar or change-request inbox), first run `npx gm-apprentice-publish
flush` in the site directory and report its per-PC summary
(publish-site `references/live-state-flush.md`). No Tier-2 site →
skip.

Read the session's play records: its Play Notes (`type:
session-play-notes`), its Export (`type: session-export`) and its Table
Log (`type: session-table-log`), each its own note, linked as
`documents.play_notes`, `documents.export` and `documents.table_log`;
any may be missing. A session with no index: `vw session-new
--number N --title "T" --play-date D [--export PATH]` files the index
and Play Notes (and the Export); an index but no Play Notes: `vw
play-notes-new --session "<index>" --play-date D`; a gmassistant.app
export the session has no Export for, Play Notes or not: `vw
export-new --session "<index>" --export PATH`. These run on their own
with `--write`, not in the batch: the rest works from the records.
With neither notes nor an export, ask the GM for notes (paste, path,
or dictation) for the Play Notes.
If there is a Table Log, it wins for numbers (HP, vitals; except a
PC's HP that flush changed: step 4), loot, Plan point states and where
everyone ended; the Play Notes and Export win for what was said and
decided. Of the point states only `Points landed` is something the
players have: the other four feed Skipped Prep, never the recap, a
PC's fields or 5c's list. An empty or missing section is nothing
recorded, not "none happened". Step 5b's review names each
disagreement with both versions and which won.
Read the PC roster and the session's Plan for planned-vs-actual.
`gma plan-check <plan> --inventory` gives per-section status and
word counts but not scene titles — open the plan body for those.
What the last session left open (for What Carries Forward and the
Keeper Checklist) comes from `gma session-context <vault> --carry --before "<session index>"` (it also prints the Overview's House Rules); don't read that Wrap-Up.

**gmassistant.app export:** if the session has an Export, or (an
older vault) its Play Notes contain a `## Memorable Moments` heading,
read `references/gmassistant-export.md`, which changes Steps 2 and 4.
Play Notes beside an Export are the GM's jottings: use them too.

### 2. Narrative Recap

**Voices first:** `gma vault-check <vault> voices`, plus one naming
any PC who died or left this session and any NPC the GM gives a
story (else left out). `# off:
vault.voices` → no voices, as before. A `(none)` voice → draft it
per `shared/voice.md` for the GM's yes: the campaign's before the
recap, a PC's before their Story entry, an NPC's when the GM gives
them a story; on a no, say `vault.voices: false` stops the asking.
An approved voice is written at once, per `shared/voice.md`, so the
recap can use it.
An `(ambiguous: A, B)` row: ask the GM which note.

Write `## Narrative Recap` (a `wrapup-add` block) from the Play
Notes, with every entity
`[[wiki-linked]]`, in the campaign voice (off or none: tone per
`references/recap-formats.md`, set from the chapter overview and
recent notes; export: the Summary verbatim, in the voice only when
the GM asks). Add Quick Bullets and
Memorable Moments when the template's conditions call for them. Run
`gma moments <vault> status`; on `moments on`, read
`references/memorable-moments.md`.
The recap is the single source of truth — session-prep reuses it,
never regenerates it.

### 3. PC Carry-Forward

**Active PC roster** (also used by 3b and 3c): `gma vault-check <vault> active-pcs`, minus any PC off-screen this session.
A PC who acted this session but has no note: create it now as a new
entity (Step 4), its `=== entity-new --type pc` block ahead
of the 3b and 3c blocks that name it, holding only the name, the
player and what they did this session; backstory, appearance and
personality stay empty for the player (`shared/pc-body-structure.md`
covers the sheet question). It joins the roster, and the report says
"Created a note for {PC}; their player fills in the rest." A PC of an
absent player who did nothing gets no note.

Per active PC, one `#### [[PC Name]] (Player)` part with the
template's labels (omit empty ones), under `### PC Carry-Forward`:
send that heading with its parts, in a `wrapup-add` block of its own
or before any `##`. Focus on player intent — stated plans, unfinished actions,
shifted NPC ties, exclusive information — grounded in observable
behaviour, not generated emotional analysis.

### 3b. Character Story Entries

Write each roster PC's entry per `shared/character-story-format.md`
— read it; its Appending command takes 3c's values and goes in the
batch as a `=== story ...` block (no `--write`). Source: Steps
2–3 only. Current session only — missing earlier entries are
vault-ingest's job.

**Storied NPCs** (voiced, appeared): a passage each, in voice: a
block `=== npc-story --wrapup "<wrap-up>" --as-of "<asOfSession value>"`,
entries under `# [[NPC Name]]` lines. On a HINT in the dry run, add
its `--section` to the block only if those passages are this NPC's
story, not an appearance log or notes; unsure, ask the GM.

### 3c. PC Sheet Refresh

Refresh each roster PC's `Characters/PCs/{Name}.md` so its
frontmatter and published `## Current Status` don't fall behind
the narrative. Apply the house rules as you would the book.

1. Stamp all roster PCs in one block — `asOfSession`/`lastUpdated`
   and the chapter tag swapped for the current chapter's, from the
   session index or campaign overview (non-chapter tags stay):

   ```text
   === stamp Characters/PCs/A.md Characters/PCs/B.md --session "<asOfSession value>" --date YYYY-MM-DD --retag old-tag=new-tag
   ```

   `--session` is written verbatim: match the vault's existing
   shape (`"Chapter 4, Session 9"` or `9`). On a shape `ERROR`,
   change the block to the matching form, not `--force-shape`.
2. A thread is active when it is a question or an obligation that
   can plausibly bear on the sessions ahead, given where the party is
   at the end of this session. Not threads: finished or overtaken, an
   event, colour, one session's business, a copy, on the wrong sheet
   (the whole test: `shared/reconcile.md` step 5.5). Write only what
   passes. A loose end the party left behind this session goes in
   Unresolved Threads too; Reconcile parks it.
   "Adrien stopped her ears with wax" is an event: the recap. "At the
   Dak Bungalow" is a stopping point: the Handoff. Shared by 2+ PCs:
   the shared list.

   Compare `vw status <PC> --show` with Steps 2-3: add a PC's new
   threads (not shared) and exclusive knowledge, refresh
   `Location`/`Condition`/`Carrying`, and the lede above the fields
   when it no longer holds (one present-tense line, sent first). Never drop a thread: Reconcile
   closes it. An item led by a session label or date goes back
   without it (`shared/pc-body-structure.md`). A field that repeats
   or carries a session label (`**Knows (Session 9):**`) is past
   `status`: read the sheet's `## Current Status` and send it whole,
   one field each, in a `=== section <PC> "Current Status" --replace`
   block.
   Present tense, player-facing — not Story-file narrative. Put
   the changed fields in a `=== status <PC>` block; it rewrites
   them in place (fields: `shared/pc-body-structure.md`). Don't
   read or hand-edit the sheet.
3. Write an advancement change (XP, points) to a sheet only when
   the Table Log's `Advancement`, the Play Notes or the GM give the amount; a missing award goes
   in the Keeper Checklist.
4. End-of-session vitals (HP, Hit Dice spent, Sanity, conditions),
   per value: the one the Table Log's `Vitals at the end` has for the
   PC, else the Play Notes' or the GM's, go in the Current Status prose and
   in a `=== sheet <PC> hp=41 hit-dice=1/5` block after them, which
   writes the Stat Sheet the party board reads (D&D, CoC, GURPS; a
   wrong key's refusal lists the keys). In a run-sheet log (`created_by: run-sheet`), a PC
   row's HP, MP, SAN, Luck, FP go to `hp mp san luck fp`, and each CoC status key
   Conditions names is yes (`major-wound=yes`); one it does not name is left alone, as
   the run sheet never read the sheet's statuses. A value not given is left alone, never guessed. A field
   step 1's flush changed is the player's: leave it as flush wrote
   it, and where the notes disagree, 5b's review names both for the
   GM. Where the Table Log's HP differs from what flush wrote, leave
   `hp=` out of that PC's `=== sheet` block, and any HP figure out of
   its Current Status prose, and show both in 5b's review; on the GM's
   pick, add both before `--write`. With no answer (a headless run),
   flush's value stands (in the prose too), the review says so, and the
   Keeper Checklist gets the pick with both numbers. An ally the Table
   Log's vitals name: its end vitals stay there, where the next run
   sheet reads them. A figure written `(after the fight, HH:MM)` is the
   last one the sheet saw: when the Play Notes mention a rest after it,
   ask the GM. Loot goes in the `Carrying` of whoever the Table
   Log's `Loot` names (a PC's `=== status` block).

Each PC's refreshed fields show in full in step 5b's review; write
no receipt into the Wrap-Up — the PC sheet is the record.

### 4. Update the World

Personal setting reference may sit in the GM's personal reference
files (`gma personal --system {system}`) — check them for faction ties,
locations and NPC relationships when creating entities.

- **New entities:** each `- New place: <name>` line under the Table
  Log's `Improvised beats` is a place the GM typed in play, with no
  note then. One the vault has a note for by now (session-play may
  have saved it) is an updated entity. For each other, offer a
  location note, yes or no each, once even when the Play Notes or the
  Export name it too; a yes is a `--type location` block, from what
  the records say of it. For any new entity,
  read `_Templates/_Template_{Type}.md` for its
  fields and section names, then a
  `=== entity-new --type <type> --name "<Name>" --date <play date>
  --session "<asOfSession value>"` block each (born at the table, so
  reconcile reads it as this session's). Its body is a frontmatter block holding only the fields
  to set and the `relationships:` edges, then the sections that have
  text: `##` for what the players know, `###` for a GM Notes one. The
  command fills the rest from the template (`canon_status: DRAFT`),
  puts every `###` under GM Notes inside its fence and writes
  `## Related` and `### Hidden Ties` from the edges: send neither. A
  tie to a note that neither exists nor is made earlier in the batch
  takes `target_type: <its type>`. A PC is `--type pc`: it is made
  from the vault's system sheet (`_Templates/pc-<system>.md`), and a
  `##` section you leave out keeps the sheet's own. Content session-play already saved goes in verbatim — the template
  supplies structure, not replacement prose. Never pattern-match off
  existing entity files. An NPC who joins the party as a PC: the PC
  note (`--type pc --from-npc "<NPC note>"`, which may keep the NPC's
  name) in the batch; after the batch is written,
  run `vw npc-merge "<NPC note>" "<PC note>"` as its own step, show
  the GM its plan, and on a yes run it with `--write`: one note per
  character (`shared/pc-body-structure.md`).
- **Updated entities:** change the entity's own file — one file per
  entity, no separate update files: a `=== section <note> "<heading>"`
  block per section (`--append` adds, `--replace` rewrites), no read
  first. A GM ruling that replaces an earlier one: strike the old one
  through and append `superseded YYYY-MM-DD`. Striking something
  through, or settling a `(projected)` entry, needs the section's
  current text: read that note, then send the whole section in a
  `section ... --replace` block (one that holds a gm-only or spoiler
  block, which `--replace` refuses, is a hand edit after step 5b). Leave `withheld`,
  spoiler and gm-only blocks and GM Notes secrets as they are (the
  tool will not `--replace` a section holding one); step 5c releases
  them with the GM. A frontmatter field (`status: dead`, a location):
  a `stamp --set` block. `status:` is what the players know (the site
  shows it): a fate they haven't learned stays in Behind the Scenes, and
  `status:` changes in the session they learn it (5c). Hand edits, made after step 5b's write: an
  existing note's relationship edges, and a section `--replace`
  refuses.
- **Cross-entity claims:** when a note asserts something about a
  *different* existing entity (e.g. an aside in a NEW-NPC line
  placing an established NPC somewhere new), never fold it silently
  into that entity's file. Ask the GM once per claim. Confirmed →
  write it there and log it under the Wrap-Up's `### Cross-Entity
  Claims` (a `wrapup-add --append` block adds to it). Unconfirmed or
  deferred → log it there with `<!-- UNVERIFIED (S{n}): {claim} -->`;
  reconcile scans the Wrap-Up for these and blocks promotion.
- **Relationship edges:** every `type:` comes from
  `_meta/relationship-types.md`. Map narrative verbs to the nearest
  sanctioned predicate, store the base direction (`owned_by A→B` →
  `owns B→A`), and drop non-edges (`appears_in <session>`). Table:
  `shared/relationship-normalization.md`. Never invent a `type:`.
  An edge added to an existing note is mirrored in its body's
  `## Related` (a `gm_only` edge in `### Hidden Ties`), per
  `shared/entity-schema.md` § Relationships; `entity-new` writes a new
  note's.
- **Campaign logs:** each NPC, Location, Item, Organization or
  Creature that appeared this session gets one bullet in its
  `## Campaign Log` (a Creature's is `## Encounters`), as the party
  saw it: `- **[[Session link]]** — {what happened}`. Other entity
  types' templates carry no such section — don't add one unless the
  GM asks. Where the truth differs, add the matching bullet to its
  GM Notes `### Behind the Scenes`; a fate the players haven't learned
  (dead, captive, missing, turned) opens it in plain words, **Dead.**
  or **Captive, in the ice crypt.**, never the brief's euphemism.
  When a later session changes that fate, seen or not, strike the old
  one through and state the new one. One `=== log` block places them
  all, no note read first: rows
  `<path><TAB>Campaign Log<TAB>{bullet}`, or
  `GM Notes/Behind the Scenes` (a note the batch creates first can
  take its rows too). If it warns that a GM Notes has no
  hidden-markers, tell the GM once per wrap-up
  (`gma vault-check <vault> gm-leak --fix` repairs it). Each
  `(projected)` entry (Behind the Scenes or Under Pressure) on an
  entity that appeared: drop the marker if it played, strike it
  through with `not played` if play went elsewhere, or leave it if
  still pending. A fork is settled branch by branch: keep the branch
  that played and strike the other through with `not played`. PCs are
  exempt from this and from the Related mirror: their body follows
  `shared/pc-body-structure.md`, and their session record is the
  Story companion. A retired PC (`status: retired`) who appears as an
  NPC keeps its PC note, never a new NPC note: give it a `Campaign Log`
  row and the writer puts it under `## Further Appearances`, making the
  section the first time.
- **New container entities** (a district between a station and its
  venues, a cell between a faction and its members): offer each
  child for re-pointing, yes/no each, and set the child's fields per
  `shared/relationship-normalization.md` § Interposing a new
  container: the scalar in a `stamp --set` block, the edge by hand
  after step 5b.
- **Timeline:** `- **{in_game_date}** — {description}`
  (`[[Event_Name]] — {summary}` when linked), or the shape this
  timeline already uses. A `=== timeline --under "<the heading this
  timeline files the session under>"` block places them (a new
  heading takes its hashes, `--after` sites it).
- **Events:** an `entity-new --type event --date <play date> --session
  "<asOfSession value>"` block (dated with `in_game_date:`) when a moment
  meets its threshold — see `shared/templates/event.md`'s comment if the
  vault copy lacks one — linked from the Wrap-Up (its Memorable Moments
  bullet, or the recap line that tells it).

Every note this step creates or changes shows in step 5b's review:
no separate receipts, and the Wrap-Up only wiki-links entities.

### 4b. Update Campaign Overview

If `_Campaign/Campaign Overview.md` exists, a block:

```text
=== stamp "_Campaign/Campaign Overview.md" --set current_game_date="<in-game date at session end>" --increment sessions_played --set last_session="[[<this session's index title>]]" --set last_play_date=YYYY-MM-DD --advance status=not_started:in_progress --session "<asOfSession value>" --date YYYY-MM-DD
```

`--session` takes the Overview's own shape, as in 3c.

`current_game_date` never gets vaguer. With no date in the notes,
keep the one there (leave its `--set` out), or move it on only as
far as the notes say time passed; ask the GM if unsure. "October
1923" never replaces "October 17, 1923".

Leave `current_arc`, `arcs_planned`, `current_chapter`,
`chapters_planned` and the body to the GM; `status` only moves from
`not_started` (the `--advance` above). One exception: a `## Current
Arc` that still opens "Not yet begun." gets a `=== section
"_Campaign/Campaign Overview.md" "Current Arc" --replace` block: in
place of those three words, two sentences from the Handoff (where
things stand, the live tension), written for the players since the
section publishes; then the rest of the section exactly as it is.
5b shows it for the GM's yes.

### 4c. World Fact Scan

If `_World/` exists or the notes hold likely world facts
(heritages, deities, new place names), apply
`references/world-fact-detection.md` and stage findings as
`### World Fact Findings`. Stage only — reconcile (step 2.5)
presents the three-state prompts.

### 5. Remaining GM Notes

Fill What Carries Forward, World State, Keeper Checklist, Quality
Notes and Handoff to session-prep (the section session-prep reads
first) per the template. Then one `=== threads --wrapup "<wrap-up>"`
block: `add shared` new shared threads, `move` a PC's that now
involves 2+ PCs, never `(hidden)` ones. Reconcile (step 6) closes and parks. If the
notes don't show what the players enjoyed, ask the GM once. Whatever an older vault template copy says:
Skipped Prep lists every planned scene and clue that didn't fire,
with what the players still need; Pending Consequences are decisions
whose effects haven't landed; Advancement records what the sheet or
notes show, never awards.

### 5b. Review and write

Run `vw batch <file1> <file2> ...` (a dry run). Show the GM one review, note by
note: what each block creates or changes; in full the recap, any
paused scene's snapshot and each PC's refreshed fields; a line for
the rest of what goes in; point out any HINT or WARNING row and
any player-facing section the template lacks. A refusal names every
block at fault: fix those blocks with a small edit to their file and
run again; never rewrite a whole file. The GM wants changes: edit those
blocks and show them again. Wants some for later: `--skip N,M` now,
`--only N,M` when ready; doesn't want one at all: delete it from its
file. On yes: the same command with `--write`,
once. It writes every block or none, then runs the frontmatter,
relationships, pc-body and wrapup checks on the notes it wrote.

Fix every ERROR those checks print (a small second batch, or an edit
for frontmatter). With moments on, also run `gma moments <vault>
check "<wrap-up>"` and fix each moment it names. Then make step 4's
hand edits (edges, and sections the tool won't `--replace`) and run `gma vault-check <vault> relationships`
once, one `--file` per note edited by hand, and `frontmatter --folder
<dir>` per folder they are in. A pc-body WARNING about a missing or
untouched `## Stat Sheet`: `shared/pc-body-structure.md` § A sheet
kept somewhere else; when `pc-body` emits no Stat Sheet rows there is
nothing to ask, and never ask where a sheet is kept on a campaign
that does not publish sheets. A tone WARNING on a relationship
you wrote or changed: use the word the row names, or where it names
none the listed word that fits (`gma publish relationships words`
prints them). Leave any other tone WARNING to campaign-qa; never run
`gma tones` here. Don't re-read files to self-check.

### 5c. What came out tonight

```bash
gma reveal-scan \
  <vault> "<index>" --also <path> --also <path>
```

The scan lists the notes this session touched that the site still
hides, with what each hides. Give one `--also` per note any row of
a batch's write names, outside the session's own folder, and per
note edited by hand after it. On a `# warning: --also` line, fix that path and run the
scan again. On "no publish list", skip this step silently;
on "could not ask the publish tool", tell the GM the reason and skip.
From the Play Notes, the Wrap-Up and the recap (and a Table Log's
`Unmasked this session` and `Handouts handed over`), propose one list of
what came out: people, places and things met or learned of; secrets
now known, by page, from the scan's hidden parts; clues found; props
handed over or shown; places visited. Never propose from the Plan or
a scene note (a paused scene's unplayed part stays hidden).
The GM picks all, some or none; nothing changes until they confirm.
Then rewrite (a small second batch, or an edit) any Narrative Recap,
Campaign Log or Timeline line this run wrote that states what they
kept hidden, so it says only what came
out (the truth can go in GM Notes `### Behind the Scenes`). Link each
picked prop's note (`[[Note]]`) from the recap line where it came up;
gma reveal writes its `revealed_in` itself. On none, skip the rest.

For each picked secret, edit that page so the fact is hidden nowhere
on it, in whatever way suits how it came out, and remove the spoiler
markers around what it released. Then run, with `<title>` from the
scan's first line, one `--publish` per note to publish and one
`--released` per secret, each `<path>` as the scan prints it:

```bash
gma reveal \
  <vault> --session "<title>" \
  --publish <path> --released "<path>=<what came out>"
```

When a disguised NPC (a scan row with `unmasked_name:`) was unmasked
at the table, offer the unmasking in the same list; on the GM's yes add
`--unmask <path>`, which makes the true name, face and `**Unmasked:**`
line the NPC's own and logs the old face. A `gm_aliases - <entry>` row
names each secret name taken out because it holds the true name: show
the GM each one, so they can check it was not a separate secret.

Show the dry-run rows as-is. Yes → re-run with `--write`; it
publishes, lifts `withheld` and logs the session. No, or an ERROR
row, puts back that page's edits and any recap link to it (or a later
publish shows it unhidden). Tell the GM the reason on any
ERROR row. Never publish a scene, Plan or session note.

### 6. Review (Reconcile)

Run `shared/reconcile.md`; on approval it promotes the session to
`reviewed` and the Wrap-Up to AUTHORITATIVE, and its step 6.1
(publish registration) runs without asking. If the GM defers, leave
status `wrap-up` (session-prep runs reconcile as a fallback), and
don't publish an unreviewed Wrap-Up silently. In a vault where step
6.1 applies, ask once: "Publish the Wrap-Up now, or after
reconcile?" Only on "now", run `gma publish manifest publish-played --config <site_dir>/vault.config.json --session "<index>" --include-unreviewed` (`<index>` relative
to the vault). It waives only the review check for this one session:
it still ticks the index only with a Wrap-Up that pairs with it and
will publish, on a current site pin. Report what it ticked; if it
lists the session as unclear, tell the GM its reason and tick nothing
else.

### 7. Pictures

Only if the version check printed `# pictures on:`, then once everything above is done and reported, follow "When no one asked" in `gma llms image` for the notes this session created and the session's big moments.

If it printed `# pictures off:` instead, end the report with one line, not a question: this session has no scene pictures because drawing without asking is off; say "draw them" for this session's pictures, or ask to turn drawing without asking on for every session. Draw nothing unless the GM then asks; on "draw them", follow `gma llms image` as an asked-for run (no `--unprompted`) for the same pictures as above: the session's big moments and the notes it created that have none.

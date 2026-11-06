# gma vault-write

Use it to place text the apprentice wrote into the right vault note: wrap-ups, stories, session and chapter notes, scenes, props and plans. It needs the vault, a subcommand and usually the text on stdin; it previews unless `--write` is given.

<!-- BEGIN GENERATED: gma vault-write -->
Place text the apprentice wrote into vault notes.

```text
gma vault-write <vault> <command> ...
```

| Argument | Value | Help |
|---|---|---|
| `<vault>` |  | the vault folder |
| `<command>` | `wrapup-new`, `wrapup-add`, `story`, `npc-story`, `status`, `log`, `timeline`, `session-new`, `play-notes-new`, `resolve`, `promote-plan`, `chapter-new`, `scene-new`, `scene-paused`, `scene-played`, `prop-new`, `prop-hand`, `plan` |  |

Example: `gma vault-write "<vault>" wrapup-add "<wrap-up>" --write`
<!-- END GENERATED -->

<!-- BEGIN GENERATED: gma vault-write wrapup-new -->
create a session's Wrap-Up

```text
gma vault-write <vault> wrapup-new --session SESSION [options]
```

| Argument | Value | Help |
|---|---|---|
| `--session` | `SESSION` | the session index: vault-relative, or its name |
| `--source` | `SOURCE` | text of the Source callout |
| `--write` |  | write it (default: preview) |
<!-- END GENERATED -->

<!-- BEGIN GENERATED: gma vault-write wrapup-add -->
place Wrap-Up sections (stdin)

```text
gma vault-write <vault> wrapup-add <wrapup> [options]
```

```text
stdin: markdown sections, each starting with a heading.
A ## section is player-facing and goes before GM Notes; a ###
or #### section goes under GM Notes, unless it is written
inside a ## section, where it stays and players see it.
```

| Argument | Value | Help |
|---|---|---|
| `<wrapup>` |  | the Wrap-Up: vault-relative, or its name |
| `--replace` |  | replace a section that already exists |
| `--append` |  | add the text to the end of a section that already exists |
| `--after` | `AFTER` | the heading a new section goes after |
| `--write` |  | write it (default: preview) |
<!-- END GENERATED -->

<!-- BEGIN GENERATED: gma vault-write story -->
append story entries (stdin)

```text
gma vault-write <vault> story --wrapup WRAPUP [options]
```

```text
stdin: entries, each opened by a '# [[PC Name]]' line.
An entry may open with its own '## ' heading; otherwise it
gets '## Session N - Title'. An entry holds no # or ## after that.
```

| Argument | Value | Help |
|---|---|---|
| `--wrapup` | `WRAPUP` | the wrap-up the entries come from |
| `--label` | `LABEL` | the entry heading's label |
| `--as-of` | `AS_OF` | asOfSession value |
| `--date` | `DATE` | lastUpdated value, YYYY-MM-DD |
| `--write` |  | write it (default: preview) |
<!-- END GENERATED -->

<!-- BEGIN GENERATED: gma vault-write npc-story -->
add a storied NPC's passage for a session (stdin)

```text
gma vault-write <vault> npc-story --wrapup WRAPUP [options]
```

```text
stdin: entries, each opened by a '# [[NPC Name]]' line.
Each is added to that NPC's note as '### Session N: Title'
at the end of '## Story' (made before '## Related' when the
note has none), or of the '## ' section --section names.
Refused: a hidden or gm-only section (passages are for
players), a place inside a block the site strips, a session
the section already has, an NPC with no voice, and any NPC
while vault.voices is off. Archived and QA copies are never
the NPC. With no --section, a HINT row names a section
holding earlier session passages.
```

| Argument | Value | Help |
|---|---|---|
| `--wrapup` | `WRAPUP` | the wrap-up the entries come from |
| `--section` | `HEADING` | the '## ' section to write under (default: Story) |
| `--as-of` | `AS_OF` | asOfSession value |
| `--date` | `DATE` | lastUpdated value, YYYY-MM-DD |
| `--write` |  | write it (default: preview) |
<!-- END GENERATED -->

<!-- BEGIN GENERATED: gma vault-write status -->
rewrite a PC's Current Status fields (stdin)

```text
gma vault-write <vault> status <pc> [options]
```

```text
stdin: labelled fields, each opened by '**Label:** value' at
the margin; lines under it (an Open threads list) belong to it.
Each field sent replaces the one with that label in
## Current Status, in the note's own shape; a label the note
lacks is added after its last field. Fields not sent, the
lede, subsections and asides are left alone. --show prints
the fields as they stand, and reads no stdin.
```

| Argument | Value | Help |
|---|---|---|
| `<pc>` |  | the PC note, vault-relative, or its name |
| `--show` |  | print the PC's Current Status fields |
| `--write` |  | write it (default: preview) |
<!-- END GENERATED -->

<!-- BEGIN GENERATED: gma vault-write log -->
add log lines to notes (stdin rows)

```text
gma vault-write <vault> log [options]
```

```text
stdin: one row per line, PATH<TAB>SECTION<TAB>LINE.
SECTION is 'Campaign Log' or 'GM Notes/Behind the Scenes';
a note with no Campaign Log but an Appearances or Encounters
section gets the row there (the row says 'resolved');
any section name is accepted. A section the note's template
keeps under GM Notes must be written as 'GM Notes/<Name>'
unless the note already has it as a public section.
```

| Argument | Value | Help |
|---|---|---|
| `--write` |  | write it (default: preview) |
<!-- END GENERATED -->

<!-- BEGIN GENERATED: gma vault-write timeline -->
add timeline entries (stdin)

```text
gma vault-write <vault> timeline --under UNDER [options]
```

```text
stdin: entries exactly as they should read. A line at the
margin opens an entry; indented lines belong to it.
```

| Argument | Value | Help |
|---|---|---|
| `--under` | `UNDER` | the heading to add under, with its hashes |
| `--after` | `AFTER` | where a new heading goes |
| `--file` | `FILE` | the timeline note (default _Campaign/Timeline.md) |
| `--write` |  | write it (default: preview) |
<!-- END GENERATED -->

<!-- BEGIN GENERATED: gma vault-write session-new -->
a cold session's index and Play Notes, or with --upcoming an unplayed session's index alone

```text
gma vault-write <vault> session-new --number NUMBER --title TITLE [options]
```

```text
Files both beside the previous session, from the session
template; the previous index's own keys come forward empty.
--export places a table-assistant export whole under
## Narrative Record and resolves its NPCs, Locations and
Items: EXACT, ALIAS, NEAR (candidates) or NONE, one row each.
```

| Argument | Value | Help |
|---|---|---|
| `--number` | `NUMBER` | the session's number |
| `--title` | `TITLE` | the session's title |
| `--play-date` | `PLAY_DATE` | YYYY-MM-DD |
| `--chapter` | `CHAPTER` | the chapter, when the number alone does not say which |
| `--upcoming` |  | a session not yet played (prep): the index alone, status planned, no Play Notes |
| `--export` | `EXPORT` | the export file (any path) |
| `--write` |  | write it (default: preview) |
<!-- END GENERATED -->

<!-- BEGIN GENERATED: gma vault-write play-notes-new -->
Play Notes beside a session index prep already filed

```text
gma vault-write <vault> play-notes-new --session SESSION [options]
```

```text
Files <index> - Play Notes beside the index and sets its
documents.play_notes, play_date (with --play-date) and a
planned or prepped status to played; the Plan link stays.
Refused when Play Notes anywhere name the session. --export
works as in session-new.
```

| Argument | Value | Help |
|---|---|---|
| `--session` | `SESSION` | the session index: path or name |
| `--play-date` | `PLAY_DATE` | YYYY-MM-DD |
| `--export` | `EXPORT` | the export file (any path) |
| `--write` |  | write it (default: preview) |
<!-- END GENERATED -->

<!-- BEGIN GENERATED: gma vault-write resolve -->
an export's names against the vault (read-only)

```text
gma vault-write <vault> resolve --export EXPORT
```

```text
The name rows session-new prints, for an export whose session is already filed.
```

| Argument | Value | Help |
|---|---|---|
| `--export` | `EXPORT` | the export file |
<!-- END GENERATED -->

<!-- BEGIN GENERATED: gma vault-write promote-plan -->
file a Midwife draft as a vault plan

```text
gma vault-write <vault> promote-plan <draft> --to TO --plan-type PLAN_TYPE [options]
```

```text
Scaffolds from the plan template, copies the draft's body
exactly and runs the schema check. participants and locations
are left for the caller to fill.
```

| Argument | Value | Help |
|---|---|---|
| `<draft>` |  | the draft, vault-relative |
| `--to` | `TO` | the plan, vault-relative |
| `--plan-type` | `PLAN_TYPE` | the plan's type, one word |
| `--chapter` | `CHAPTER` | default: the chapter folder of --to |
| `--leads-to` | `LEADS_TO` | a plan this one leads to (repeatable) (repeatable) |
| `--write` |  | write it (default: preview) |
<!-- END GENERATED -->

<!-- BEGIN GENERATED: gma vault-write chapter-new -->
file a new chapter note

```text
gma vault-write <vault> chapter-new --title TITLE [options]
```

```text
Creates Chapters/<title>/<title>.md from the chapter template. Refused when a chapter of that title exists.
```

| Argument | Value | Help |
|---|---|---|
| `--title` | `TITLE` | the chapter's title |
| `--sort-order` | `SORT_ORDER` | default: one after the highest chapter |
| `--status` | `STATUS` | planned \| active \| complete (default planned) |
| `--write` |  | write it (default: preview) |
<!-- END GENERATED -->

<!-- BEGIN GENERATED: gma vault-write scene-new -->
file a new scene under its chapter

```text
gma vault-write <vault> scene-new --chapter CHAPTER --title TITLE [options]
```

```text
Creates <chapter folder>[/<folder>]/Scenes/<title>.md from the
scene template, or with --set-piece
Scenes/<title>/<title>.md. --chapter is the chapter note's
name, its title or its folder; none or several: refused.
```

| Argument | Value | Help |
|---|---|---|
| `--chapter` | `CHAPTER` | the chapter the scene belongs to |
| `--title` | `TITLE` | the scene's title |
| `--set-piece` |  | give the scene a folder of its own |
| `--folder` | `FOLDER` | a sub-folder of the chapter, e.g. Side_Adventures/The Audition |
| `--write` |  | write it (default: preview) |
<!-- END GENERATED -->

<!-- BEGIN GENERATED: gma vault-write scene-paused -->
write a paused scene's snapshot

```text
gma vault-write <vault> scene-paused --scene SCENE --session SESSION [options]
```

```text
Sets status to paused, adds the session to played_in once and
writes the snapshot on stdin as the scene's `## Paused`
section (replaced in place when there is one, else at the top
of the body). --new files a scene born at the table in the
session's chapter (or --chapter) as Scenes/<scene>.md.
```

| Argument | Value | Help |
|---|---|---|
| `--scene` | `SCENE` | the scene note's name or path; with --new, its title |
| `--session` | `SESSION` | the session note's name |
| `--new` |  | create the scene note |
| `--chapter` | `CHAPTER` | with --new: the chapter (default: the session's) |
| `--folder` | `FOLDER` | with --new: a sub-folder of the chapter |
| `--write` |  | write it (default: preview) |
<!-- END GENERATED -->

<!-- BEGIN GENERATED: gma vault-write scene-played -->
mark a scene played or dropped

```text
gma vault-write <vault> scene-played --scene SCENE [options]
```

```text
Sets status to played or dropped; played adds the session to played_in once. No other field changes.
```

| Argument | Value | Help |
|---|---|---|
| `--scene` | `SCENE` | the scene note's name, or its vault-relative path when several share the name |
| `--session` | `SESSION` | the session note's name (not with --dropped) |
| `--dropped` |  | the scene will not be played; no session |
| `--write` |  | write it (default: preview) |
<!-- END GENERATED -->

<!-- BEGIN GENERATED: gma vault-write prop-new -->
file a new prop in its chapter's Props folder

```text
gma vault-write <vault> prop-new --chapter CHAPTER --title TITLE [options]
```

```text
Creates <chapter folder>[/<folder>]/Props/<title>.md from the
prop template. --style builds the page on the site; --file
names a hand-made page beside the note. --hand names the
writer's hand in _meta/prop-hands.json (a new one needs
--hand-font). --scene links the prop from that scene's
entities. The publish list is never touched.
```

| Argument | Value | Help |
|---|---|---|
| `--chapter` | `CHAPTER` | the chapter the prop belongs to |
| `--title` | `TITLE` | the prop's title |
| `--kind` | `KIND` | document \| object \| diagram \| supplied \| container (default document) |
| `--style` | `STYLE` | a site style, e.g. letter |
| `--file` | `FILE` | a hand-made page beside the note |
| `--hand` | `HAND` | the writer's hand id, e.g. sophia |
| `--hand-font` | `HAND_FONT` | a new hand's font family |
| `--hand-who` | `HAND_WHO` | a new hand's writer, in words |
| `--scene` | `SCENE` | the scene that hands it over |
| `--container` | `CONTAINER` | the container prop it sits in |
| `--folder` | `FOLDER` | a sub-folder of the chapter |
| `--write` |  | write it (default: preview) |
<!-- END GENERATED -->

<!-- BEGIN GENERATED: gma vault-write prop-hand -->
add a writer's hand to _meta/prop-hands.json

```text
gma vault-write <vault> prop-hand --hand HAND --hand-font HAND_FONT [options]
```

```text
Adds a hand for props already filed (prop-new adds one for a
new prop). The same id with the same font is a skip; with a
different font, refused. It never touches a note or the
publish list.
```

| Argument | Value | Help |
|---|---|---|
| `--hand` | `HAND` | the writer's hand id, e.g. sophia |
| `--hand-font` | `HAND_FONT` | the hand's font family |
| `--hand-who` | `HAND_WHO` | the hand's writer, in words |
| `--write` |  | write it (default: preview) |
<!-- END GENERATED -->

<!-- BEGIN GENERATED: gma vault-write plan -->
write a session's Plan and check it

```text
gma vault-write <vault> plan --number NUMBER [options]
```

```text
Writes the Plan on stdin beside session N's index, with the
template's frontmatter, sets the index to prepped with
documents.plan, and prints plan_check's rows. No index yet:
--title (and --chapter) files one as upcoming. An existing
Plan is never overwritten: --section replaces each section
on stdin by level and title, and adds a missing ## where the
template has it.
```

| Argument | Value | Help |
|---|---|---|
| `--number` | `NUMBER` | the session's number |
| `--chapter` | `CHAPTER` | the chapter, when the number alone does not say which |
| `--title` | `TITLE` | the session's title, to file its index when it has none |
| `--section` |  | replace or add sections of the existing Plan |
| `--headless` |  | check as a run with no GM (plan_check --headless) |
| `--gm-input` | `intent`, `scenes`, `spotlight` | with --headless: the parts the GM supplied (intent, scenes, spotlight; bare: all) |
| `--write` |  | write it (default: preview) |
<!-- END GENERATED -->

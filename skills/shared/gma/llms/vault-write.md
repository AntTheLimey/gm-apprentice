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
| `<command>` | `wrapup-new`, `wrapup-add`, `story`, `status`, `log`, `timeline`, `session-new`, `play-notes-new`, `resolve`, `promote-plan`, `chapter-new`, `scene-new`, `scene-paused`, `scene-played`, `prop-new`, `prop-hand`, `plan` |  |

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

| Argument | Value | Help |
|---|---|---|
| `--wrapup` | `WRAPUP` | the wrap-up the entries come from |
| `--label` | `LABEL` | the entry heading's label |
| `--as-of` | `AS_OF` | asOfSession value |
| `--date` | `DATE` | lastUpdated value, YYYY-MM-DD |
| `--write` |  | write it (default: preview) |
<!-- END GENERATED -->

<!-- BEGIN GENERATED: gma vault-write status -->
rewrite a PC's Current Status fields (stdin)

```text
gma vault-write <vault> status <pc> [options]
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

| Argument | Value | Help |
|---|---|---|
| `--write` |  | write it (default: preview) |
<!-- END GENERATED -->

<!-- BEGIN GENERATED: gma vault-write timeline -->
add timeline entries (stdin)

```text
gma vault-write <vault> timeline --under UNDER [options]
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

| Argument | Value | Help |
|---|---|---|
| `--export` | `EXPORT` | the export file |
<!-- END GENERATED -->

<!-- BEGIN GENERATED: gma vault-write promote-plan -->
file a Midwife draft as a vault plan

```text
gma vault-write <vault> promote-plan <draft> --to TO --plan-type PLAN_TYPE [options]
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

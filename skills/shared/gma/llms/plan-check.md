# gma plan-check

Use it after writing or editing a Session Plan, to check it against the plan rules, or with `--inventory` or `--state` to see which sections are filled. It needs the plan's path; it reads only.

It also warns about what the run sheet reads, each row saying what the sheet will lack. Fix them all in the draft; they check shape only, never story.

| Check | The plan has | The sheet will lack | Fix |
|---|---|---|---|
| `no-place` | a planned scene with no `**Place:**` line and no scene note with `locations:` | where it happens | `**Place:** [[Location]]` (words may follow the link: `[[Location]], the yard`), or plain words when no location note fits |
| `no-npcs-block` | a planned scene naming an NPC or creature in Entities, with no readable `**NPCs**` block | who is there | `**NPCs**` and a `- **[[Name]]:** wants ...` line for each person in the room; when nobody named is in the room, the warning stands |
| `hub-no-places` | a hub (`**Where they can go**`) with no place or pointer bullets | where the party can go | `- **[[Location]]:** ...`, `- **Plain name:** ...` or `- words — Scene N` |
| `hub-plain-bullet` | a hub with place or pointer bullets that also has a bullet that is neither a place nor a pointer | the sheet shows that line as a place | move a note for the GM to a plain line after a blank line below the block, or write it as a bold place (`- **Plain name:** ...`) |
| `hub-place-not-location` | a hub place bullet linking a note that is not a location | that place | link a location note, or write the name in words |
| `place-not-location` | a `**Place:**` line starting with a link to a note that is not a location | the place | link a location note, or write the place in words |
| `label-form` | a label with a parenthesis inside the bold, such as `**NPCs (who is here)**`, or a block label written as a bullet, such as `- **Treasure:**` (with or without words after it) | the part the label holds, or the whole block | `**NPCs**`, `**Treasure**` at the left margin |
| `if-table-unlabelled` | a table in a planned scene not under `**If the players...**` | its Do and Then rows | put it under that label |
| `foe-no-numbers` | a person a scene names whose note only names a stock creature, such as `Commoner (SRD)` | their AC and HP | in a D&D vault, `gma stat-fill "<vault>" "<note>" --write`; elsewhere write the numbers into the note's `### Stats` |

`label-form` also flags an older Plan's `**Complications (…)**`-style label as a warning, though `scene-labels` still accepts it.

The note checks (`no-npcs-block`, `hub-place-not-location`, `place-not-location`, `foe-no-numbers`, and `no-place` for a scene note heading) read each note from the vault above the plan; with no vault they are skipped.

<!-- BEGIN GENERATED: gma plan-check -->
Session Plan conformance checks.

```text
gma plan-check <plan> [options]
```

| Argument | Value | Help |
|---|---|---|
| `<plan>` |  | the Session Plan's path |
| `--headless` |  | the plan was written with no GM present: apply the hard guard |
| `--gm-input` | `[PART ...]` | a run with no GM present (implies --headless) whose request supplied the spine, so skip the guard; or name the parts it settled (intent, scenes, spotlight; spaced or comma-separated) |
| `--inventory` |  | list the plan's sections instead of findings |
| `--state` |  | print the prep-state comment instead of findings |
| `--json` |  | print as JSON |

Example: `gma plan-check "<plan>" --inventory`
<!-- END GENERATED -->

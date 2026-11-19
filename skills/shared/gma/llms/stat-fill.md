# gma stat-fill

Use it when a D&D 5e NPC or creature note only names a stock creature ("Commoner (SRD)", "as Bandit, with a knife") and the run sheet needs its numbers: it writes that creature's SRD block into the note's `### Stats`, keeping the GM's own words below it. It needs the vault and the notes; it previews unless `--write` is given, and needs no yes from the GM.

One row a note: `FILLED` (with the creature), `UNCHANGED` (the note already has numbers), `NOT-FOUND` (no SRD creature of that name; `--as` names one), `REFUSED-MAJOR` (a companion or key NPC needs a full workup), `NOT-DND` (another system) or `NO-SRD` (the creature files are not installed). `gma vault-check "<vault>" npc-stats --stock` lists the notes it can fill.

<!-- BEGIN GENERATED: gma stat-fill -->
Write a stock D&D creature's SRD numbers into its note.

```text
gma stat-fill <vault> <note> ... [options]
```

| Argument | Value | Help |
|---|---|---|
| `<vault>` |  | the vault folder |
| `<note>` |  | an NPC or creature note: a vault-relative path, name or alias |
| `--as` | `NAME` | the SRD creature to write, in place of the one the note names |
| `--write` |  | write the blocks into the notes (default: preview) |
| `--systems-dir` | `SYSTEMS_DIR` | the systems folder to read |

Example: `gma stat-fill "<vault>" "<note>" --write`
<!-- END GENERATED -->

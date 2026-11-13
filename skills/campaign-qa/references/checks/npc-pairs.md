## NPC/PC Pairs

**Severity:** WARNING
**Trigger:** `gma vault-check <vault> npc-pairs` gives an ASK row: an NPC
note and a PC note whose names match (case, spaces, underscores and
punctuation aside), or where one note's alias is the other's name. Links reach
only one of the two, so the other loses its history.

**Procedure:** one pair at a time.

1. Run the row's command without `--write`:
   `gma vault-write <vault> npc-merge "<NPC note>" "<PC note>"`.
2. Show the GM the plan: what goes into the PC note, what is left out
   (`NOT-CARRIED` fields stay in the archived copy), the links it
   rewrites, and any UNSURE or WARNING row.
3. On a yes, run it again with `--write`. On a no (two different
   people who share a name), dismiss the finding.

The merge never paraphrases: the NPC's sections go into the PC note
word for word, and the NPC note moves to `_archive/` with `merged_into`.

**Not flagged:** notes under `_archive/` or `_QA/`, and notes that
already have `merged_into`.

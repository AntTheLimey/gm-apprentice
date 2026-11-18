# NPC Stats

**Severity:** WARNING for a major NPC, INFO for the rest.
**Trigger:** `gma vault-check <vault> npc-stats --played` gives a row: an
NPC play has shown (linked from a Wrap-Up or a played scene) whose stat
block is missing, still the template's placeholder, blank, or says it will
be built later. A `STOCK` row is a major NPC whose block only names a stock
creature.

Each row says why and who: `major (companion)` or `major (key-npc)` (in an
adventure brief's Key NPCs) needs a full workup, built for who they are:
abilities, spells, equipment, a signature feature, and tactics. `other`
may take a stock block from the system's rules, noted with any small
change. The closing `# system:` line names the system and its block
template.

**Procedure:** one NPC at a time.

1. Build the block through ttrpg-expert (`npc-generation.md` and the
   system's files), from the NPC's note as it stands. A major NPC's block
   has stats of its own: a stock block reskinned (the same numbers,
   new flavour) is not a workup, even where the note suggests one; take
   the note's idea and build them up from it.
2. Show the GM the block, and on a yes write it into the note's
   `## GM Notes` as its `### Stats` section, in place of any placeholder.
3. On a no, or "this one never fights", dismiss the finding.

Never invent numbers without the system's rules. With no system recorded
(`# system: none recorded`), build nothing: ask the GM which system first.

**Not flagged:** NPCs play has not shown yet (session-prep builds those),
dead NPCs (a current, unstruck fate in GM Notes Behind the Scenes that
starts **Dead**, such as **Dead, under the ice.**, or `status: dead` with no
fate; a later fate such as **Risen.** beats both), and notes under
`_archive/`, `_QA/` or `_midwife/`.

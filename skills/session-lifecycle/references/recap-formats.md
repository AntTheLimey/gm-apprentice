# Recap Formats and Style Guide

Templates and guidance for generating session recaps across
different campaign tones. Recaps serve two purposes: remind
players of what happened, and reinforce the emotional texture
of the campaign.

## Format: Table Read (Narrative Prose)

The "Previously on..." reading meant to be read aloud at the
table before the next session begins. Approximately 2 minutes
of reading time (~300-400 words).

### Structure

1. **Anchor** (1-2 sentences) — Where and when. Ground the
   players in the fictional world.
2. **Key events** (2-3 paragraphs) — What happened, organized
   by dramatic beats rather than chronological order. Lead with
   the most emotionally resonant moment.
3. **Cliffhanger** (1-2 sentences) — End with forward momentum.
   An unresolved question, an approaching threat, or a decision
   that demands action.

### Tone Calibration

**Gothic horror / Call of Cthulhu:**
- Atmospheric, foreboding language
- Emphasize what the investigators don't yet understand
- Sensory details: sounds, smells, the quality of light
- End on dread or unease, not resolution

Example opening:
> The gaslit streets of Vienna offered no warmth as the
> investigators made their way back from the opera. Behind
> them, the State Opera's grand facade still blazed with
> candlelight — but the performance they had witnessed
> backstage would not leave their minds so easily.

**Regency social drama:**
- Formal but warm prose, period-appropriate diction
- Center relationships and social consequences
- Track reputation shifts, alliances formed or broken
- End on a social complication or romantic tension

Example opening:
> Lady Catherine's drawing room had scarcely recovered from
> Tuesday's revelations when Thursday brought fresh cause for
> alarm. The investigators, newly arrived and still without
> proper introductions to Vienna's diplomatic circles, found
> themselves the subject of considerable speculation.

**Action/adventure / D&D:**
- Punchy, momentum-driven prose
- Lead with the biggest dramatic beat
- Combat outcomes and loot noted with energy
- End on the next challenge or destination

**Intrigue / Blades in the Dark:**
- Terse, noir-inflected tone
- Who betrayed whom, what was stolen, who noticed
- Faction clock ticks noted as consequences
- End on what's owed and who's watching

### Things to Avoid in Table Reads

- Player names (use character names)
- Meta-game language ("you rolled a 97")
- Listing events without dramatic framing
- Spoiling information the PCs don't have
- Running longer than 400 words (attention drops)

## Format: Quick Bullets

5-8 bullet points for GMs who want a fast refresher or for
posting in a group chat.

### Structure

Each bullet is one sentence covering:
- Key events (what happened)
- Key decisions (what players chose)
- Key discoveries (what was learned)
- Unresolved (what's hanging)

Mark the last 1-2 bullets as forward-looking.

### Example

- The investigators attended the opera and identified Graf
  von Sternberg among the Brotherhood's contacts.
- Thomas followed a suspicious servant into the alley behind
  the opera house and confronted him.
- The servant (Hans) admitted to delivering messages but
  claimed ignorance of their contents.
- Lady Catherine accepted the Countess von Hagen's invitation
  to the diplomatic ball.
- The cultist from the lodge was seen watching the opera from
  a private box — he knows the investigators are in Vienna.
- **Next:** The diplomatic ball is in three days. Hans is
  still at large. The Brotherhood may be preparing.

## Format: Keeper Notes (Structured)

Factual, organized, for the GM's own reference. Not meant
to be shared with players.

### Structure

Organize by scene (in order played), with consistent sub-
headings:

```markdown
### [Scene Name] — [played/modified/skipped]

**What happened:** Factual narrative (2-4 sentences)

**Player decisions:**
- [Decision]: [Immediate result] → [Pending consequence]

**Entities involved:** [[NPC]], [[Location]]

**New entities:** [[Name]] (DRAFT — needs wrap-up review)

**Clues found:** [What was discovered and its significance]

**Clues missed:** [What was available but not found]

**Mechanical:** [Skill rolls, SAN loss, injuries, resources spent]

**Player reactions:** [What engaged or bored the table]
```

### Entity Extraction Shorthand

When scanning play notes for new entities, categorize:

| Marker | Meaning |
|--------|---------|
| NEW-NPC | Improvised character, needs vault entry |
| NEW-LOC | New location described, needs vault entry |
| NEW-ITEM | Item introduced, may need vault entry |
| NEW-EVENT | Significant event — create Event entity file and add linked entry to timeline. Must meet at least 2 of: changes entity state, multiple named participants, creates forward consequences, referenced from multiple entities. Minor events stay as inline timeline entries |
| UPDATE | Existing entity needs information update |
| CONFLICT | Contradicts existing vault content — flag |

## Campaign Journal Format

Optional: a polished write-up for a campaign blog, shared
document, or Obsidian "journal" section. Longer and more
literary than the table read, this is the full story of the
session rendered as narrative prose.

### Guidelines

- 800-1500 words
- Third person, past tense
- Written from an omniscient narrator perspective (can describe
  things PCs didn't directly observe, within reason)
- Include dialogue where memorable quotes occurred
- Use scene breaks (---) between major narrative beats
- End each session's journal entry with a hook for the next

This format is optional and should only be generated when the
GM specifically requests it — it's significant effort and not
every campaign needs it.

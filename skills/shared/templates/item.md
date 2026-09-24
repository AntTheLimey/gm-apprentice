---
name: ""
type: item
canon_status: DRAFT
source: ""
createdSession: ""
asOfSession: ""
lastUpdated: ""
aliases: []
gm_aliases: []        # the item's true name, if it has one: links resolve, never published
tags: []
item_type: ""         # weapon, armor, vehicle, treasure, relic, tool, consumable
current_holder: ""    # "[[Who has it now]]"
origin: ""            # "[[Where or who it came from]]"
portrait: ""
relationships:
  - target: "[[]]"
    type: owns
    tone: neutral
    strength: 5
    bidirectional: false
    description: ""
---

<!-- {braces} = replace with content. Everything above the gm-only
fence is what players see on the site. Omit a section rather than
leave its heading empty. -->

## Description

{What it looks like in the hand: size, material, one detail that
makes it this item and not another.}

## What It Does

{What the PCs know it does, in play terms. For gear, the system line
the players use, e.g. `.38 revolver — 1D10, range 15 yd, 6 shots`.}

## History

{What the PCs know of where it has been.}

## Related

{The frontmatter `relationships`, readable. One line per tie, grouped;
drop an empty group. The skills write both together; a tie marked
`gm_only: true` goes under Hidden Ties instead.}

- **People:** [[{Name}]] — {how they're tied, e.g. owns the place}
- **Places:** [[{Name}]] — {…}
- **Groups:** [[{Name}]] — {…}
- **Things:** [[{Name}]] — {…}

## Campaign Log

{One bullet per session it changes hands or matters, newest last:
`- **[[Session NN - Title]]** — taken from the vicar's desk.`
session-wrapup adds a bullet each session.}

<!-- gm-only -->

## GM Notes

### Full Mechanics

{Everything it does, including what the PCs haven't found out: bonuses,
charges, costs, curses, in the system's terms.}

### Hidden Properties

{What it really is or does, and what reveals it.}

### Who Wants It

- **[[{Name}]]:** {why, and how far they'll go}

### Hidden Ties

- [[{Name}]] — {the tie the players don't know about (a `gm_only` relationship)}

### Behind the Scenes

{Where it really was, session by session, where that differs from
the Campaign Log.}

<!-- /gm-only -->

---
name: ""
type: npc
canon_status: DRAFT
source: ""
createdSession: ""
asOfSession: ""
lastUpdated: ""
aliases: []
gm_aliases: []        # secret names (a true identity): links resolve, never published
withheld: false       # true: this note's own name is a secret; the site build looks for it in published text
companion: false      # true: travels with the party (an Ally, follower, familiar, cohort); never pictured on Story pages
tags: []
occupation: ""
age:
gender: ""
nationality: ""
status: alive         # alive / dead / missing / unknown
location: ""          # "[[Where they can usually be found]]"
portrait: ""
voice: ""            # set only when the GM gives this NPC their own story; how they are told and speak; never published
relationships:
  - target: "[[]]"
    type: knows
    tone: neutral
    strength: 5
    bidirectional: false
    description: ""
---

<!-- {braces} = replace with content. Everything above the gm-only
fence is what players see on the site: write it as the PCs know this
person. Omit a section rather than leave its heading empty. -->

## Overview

{Who they are to the PCs, in two or three sentences: role, reputation,
how the party met them.}

## Appearance & Manner

{What the PCs notice first: one physical detail, one habit. Enough to
picture them, not a portrait.}

## History

{What the PCs have heard or learned of their past. Add to it as they
find out more; the true story stays in Secrets below.}

## Related

{The frontmatter `relationships`, readable. One line per tie, grouped;
drop an empty group. The skills write both together; a tie marked
`gm_only: true` goes under Hidden Ties instead.}

- **People:** [[{Name}]] — {how they're tied, e.g. owns the place}
- **Places:** [[{Name}]] — {…}
- **Groups:** [[{Name}]] — {…}
- **Things:** [[{Name}]] — {…}

## Campaign Log

{One bullet per session they appear in, newest last, as the party saw
it: `- **[[Session NN - Title]]** — sold the party the forged writ; let
slip she knows the Bishop.` session-wrapup adds a bullet each session.}

<!-- gm-only -->

## GM Notes

### Stats

**{Name}**, {age}, {occupation}

| STR | CON | SIZ | DEX | INT | APP | POW | EDU |
|-----|-----|-----|-----|-----|-----|-----|-----|
|     |     |     |     |     |     |     |     |

**HP** {n} · **MP** {n} · **SAN** {n} · **Luck** {n or —}
**Damage Bonus** {+0} · **Build** {0} · **Move** {8} · **Armour** {none}

**Combat**
- Brawl {50}% ({25}/{10}), damage {1D3+DB}
- {Weapon} {40}% ({20}/{8}), damage {1D10}, {range / attacks per round}
- Dodge {30}% ({15}/{6})

**Skills:** {Skill} {60}%, {Skill} {45}%, …
**Spells:** {none, or names}

### Playing Them

- **Speech:** {accent, pace, a verbal tic}
- **Tell:** {the gesture you do at the table}
- **Line:** "{something they'd say the first time the PCs meet them}"

### Wants

{What they're after right now, and what they'll do to get it. The
engine of every scene they're in.}

### Knows

- **Will share:** {what they'll tell the PCs, and what it costs}
- **Hides:** {what they won't say, and what would make them say it}

### Under Pressure

{Threatened, bribed, cornered: do they fold, lie, bargain or fight?}

### Hidden Ties

- [[{Name}]] — {the tie the players don't know about (a `gm_only` relationship)}

### Behind the Scenes

{What they were really doing, session by session, where it differs
from the Campaign Log: `- **[[Session NN - Title]]** — the writ was
bait; she reported the party to the Bishop that night.`}

### Secrets

{The truth the players don't have yet. A hidden identity goes in
`gm_aliases` above, so links to it work without showing it.}

<!-- /gm-only -->

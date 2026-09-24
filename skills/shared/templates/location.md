---
name: ""
type: location
canon_status: DRAFT
source: ""
createdSession: ""
asOfSession: ""
lastUpdated: ""
aliases: []
gm_aliases: []        # secret names: links resolve, never published
tags: []
location_type: ""     # city, district, building, room, wilderness, ship…
parent_location: ""   # "[[The place this sits inside]]"
atmosphere: ""        # a few words, shown as a badge: "damp, candlelit, watchful"
portrait: ""          # establishing shot
relationships:
  - target: "[[]]"
    type: located_at
    tone: neutral
    strength: 5
    bidirectional: false
    description: ""
---

<!-- {braces} = replace with content. Everything above the gm-only
fence is what players see on the site. The site adds Places Within
(locations whose parent_location is this), Known Figures (NPCs whose
location is this) and What Happened Here (events set here) on its own.
Omit a section rather than leave its heading empty. -->

## Description

{What the PCs take in when they arrive: one sight, one sound, one
smell. The first paragraph is the site's pull-quote, and it doubles as
your read-aloud text.}

## What's Here

- **{Feature}:** {what it is, and what the PCs can do with it}

## History

{What the PCs have heard or learned of the place's past.}

## Related

{The frontmatter `relationships`, readable. One line per tie, grouped;
drop an empty group. The skills write both together; a tie marked
`gm_only: true` goes under Hidden Ties instead.}

- **People:** [[{Name}]] — {how they're tied, e.g. owns the place}
- **Places:** [[{Name}]] — {…}
- **Groups:** [[{Name}]] — {…}
- **Things:** [[{Name}]] — {…}

## Campaign Log

{One bullet per session the party is here, newest last, as they saw
it: `- **[[Session NN - Title]]** — broke in through the coal chute;
found the ledger.` session-wrapup adds a bullet each session.}

<!-- gm-only -->

## GM Notes

### At the Table

- **Layout:** {size, exits, lines of sight}
- **Who's here:** {by time of day, and who's in charge}
- **Light and noise:** {what helps or hurts sneaking and searching}

### Checks & Hazards

- {Task}: {the roll, in the system's terms, e.g. Climb (Hard) / DC 15 / Athletics}

### Hidden

{What the PCs haven't found: secret doors, stashed items, clues (link
them), traps.}

### Complications

- {Something that can go wrong or arrive while the PCs are here}

### Hidden Ties

- [[{Name}]] — {the tie the players don't know about (a `gm_only` relationship)}

### Behind the Scenes

{What was really going on here, session by session, where it differs
from the Campaign Log.}

<!-- /gm-only -->

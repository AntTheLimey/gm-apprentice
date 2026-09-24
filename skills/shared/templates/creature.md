---
name: ""
type: creature
canon_status: DRAFT
source: ""
createdSession: ""
asOfSession: ""
lastUpdated: ""
aliases: []
gm_aliases: []        # its true nature, if the name hides one: links resolve, never published
tags: []
creature_type: ""     # beast, undead, construct, spirit, deity, aberration
threat_level: ""      # how dangerous the PCs believe it is, shown on the site
location: ""          # "[[Where it lairs or is found]]"
portrait: ""
relationships:
  - target: "[[]]"
    type: haunts
    tone: hostile
    strength: 5
    bidirectional: false
    description: ""
---

<!-- {braces} = replace with content. Everything above the gm-only
fence is what players see on the site, so write it as what the PCs
have seen or learned. Omit a section rather than leave its heading
empty. -->

## What the PCs Know

{What it looks like, and what they've seen it do or heard of it. Rumour
is fine; mark it as rumour.}

## Related

{The frontmatter `relationships`, readable. One line per tie, grouped;
drop an empty group. The skills write both together; a tie marked
`gm_only: true` goes under Hidden Ties instead.}

- **People:** [[{Name}]] — {how they're tied, e.g. owns the place}
- **Places:** [[{Name}]] — {…}
- **Groups:** [[{Name}]] — {…}
- **Things:** [[{Name}]] — {…}

## Encounters

{One bullet per session the party meets it, newest last:
`- **[[Session NN - Title]]** — glimpsed in the flooded crypt; took
Harker's lantern arm.` session-wrapup adds a bullet each session.}

<!-- gm-only -->

## GM Notes

{STAT BLOCK: vault setup replaces this paragraph with the block for
the vault's system (campaign-organizer references/vault-setup.md).}

### Behaviour

{What it wants, how it hunts or defends, when it flees.}

### Weaknesses

{What hurts it, what drives it off, how the PCs could learn that.}

### Signs It's Near

- {A clue the PCs find before they see it}

### Hidden Ties

- [[{Name}]] — {the tie the players don't know about (a `gm_only` relationship)}

### Behind the Scenes

{What it was really doing, session by session, where that differs
from Encounters.}

<!-- /gm-only -->

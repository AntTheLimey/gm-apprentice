---
name: ""
type: organization
canon_status: DRAFT
source: ""
createdSession: ""
asOfSession: ""
lastUpdated: ""
aliases: []
gm_aliases: []        # its real name, if it operates behind a front: links resolve, never published
tags: []
faction_type: ""      # government, corporation, cult, guild, military, criminal, university…
goals: []
leadership: ""        # "[[Who runs it]]"
territory: ""         # "[[Where it operates from]]"
part_of: ""           # "[[Parent body]]", if any
status: active        # active / weakened / destroyed / dormant
portrait: ""          # logo, seal or headquarters
relationships:
  - target: "[[]]"
    type: headquartered_at
    tone: neutral
    strength: 5
    bidirectional: false
    description: ""
---

<!-- {braces} = replace with content. Organization is for bodies the
PCs deal with (a university, a firm, a lodge); a group with its own
agenda and clocks is a Faction. Everything above the gm-only fence is
what players see on the site. Omit a section rather than leave its
heading empty. -->

## Overview

{What it is and what it's known for, in two or three sentences.}

## How to Deal With It

- **Who to ask:** {the doors the PCs can knock on, and who answers}
- **What it offers:** {services, access, resources}
- **What it asks:** {fees, favours, membership, paperwork}

## Related

{The frontmatter `relationships`, readable. One line per tie, grouped;
drop an empty group. The skills write both together; a tie marked
`gm_only: true` goes under Hidden Ties instead.}

- **People:** [[{Name}]] — {how they're tied, e.g. owns the place}
- **Places:** [[{Name}]] — {…}
- **Groups:** [[{Name}]] — {…}
- **Things:** [[{Name}]] — {…}

## Campaign Log

{One bullet per session the party deals with it, newest last:
`- **[[Session NN - Title]]** — the Registrar sealed the archive
against them.` session-wrapup adds a bullet each session.}

<!-- gm-only -->

## GM Notes

### What It Really Wants

{The goal behind the public face, and who inside is pushing it.}

### Inside

- **[[{Name}]]:** {their role, and what they'd do for or against the PCs}

### Pressure Points

{What it fears, what it owes, what would make it act.}

### Hidden Ties

- [[{Name}]] — {the tie the players don't know about (a `gm_only` relationship)}

### Behind the Scenes

{What it was really doing, session by session, where that differs
from the Campaign Log.}

<!-- /gm-only -->

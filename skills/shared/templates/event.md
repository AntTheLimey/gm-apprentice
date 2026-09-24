---
name: ""
type: event
canon_status: DRAFT
source: ""
createdSession: ""
asOfSession: ""
lastUpdated: ""
aliases: []
tags: []
event_type: ""        # battle, ritual, disaster, discovery, betrayal, meeting, celebration
in_game_date: ""      # the in-game date, in the campaign's calendar
location: ""          # "[[Where it happened]]"
participants:
  - ""                # "[[Entity]] (what they did)"
outcome: ""           # one line; shown on the location's What Happened Here timeline
relationships: []
---

<!-- {braces} = replace with content. An event earns its own file when
at least two hold: it changes someone's state (death, capture,
exposure), several named people's actions matter, it has consequences
still in play, or several notes point at it. Anything smaller stays a
timeline line. Everything above the gm-only fence is what players see
on the site. Omit a section rather than leave its heading empty. -->

## What Happened

{As the PCs know it, in order. Bullets or short prose, every entity
[[linked]].}

## Why It Matters

{What changed for the PCs and the world, and what it set in motion.}

## Related

{The frontmatter `relationships`, readable. One line per tie, grouped;
drop an empty group. The skills write both together; a tie marked
`gm_only: true` goes under Hidden Ties instead.}

- **People:** [[{Name}]] — {how they're tied, e.g. owns the place}
- **Places:** [[{Name}]] — {…}
- **Groups:** [[{Name}]] — {…}
- **Things:** [[{Name}]] — {…}

<!-- gm-only -->

## GM Notes

### What Really Happened

{The full account, including what the PCs didn't see or have wrong.}

### Consequences Still Coming

- {Consequence}: {who acts on it, and when it lands}

### Sources

{The plans, play notes and wrap-ups this came from.}

### Hidden Ties

- [[{Name}]] — {the tie the players don't know about (a `gm_only` relationship)}

<!-- /gm-only -->

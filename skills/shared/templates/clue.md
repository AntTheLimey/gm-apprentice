---
name: ""
type: clue
canon_status: DRAFT
source: ""
createdSession: ""
asOfSession: ""
lastUpdated: ""
aliases: []
tags: []
clue_type: ""         # physical, testimonial, documentary
found_at: ""          # "[[Where it is, or was found]]"
found_by: ""          # "[[Who found it]]", empty until found
leads_to: []          # "[[What it points at]]": the node(s) it reveals
reliability: ""       # solid, partial, misleading
discoveryState: {}    # per PC: "Unknown / Rumoured / Observed / Investigated / Understood"
relationships: []
---

<!-- {braces} = replace with content. A clue earns a file when it
matters across scenes; one that only matters in one scene stays in
that scene's notes. Nothing above the gm-only fence should give away
more than the PCs have found. Omit a section rather than leave its
heading empty. -->

## What the PCs Have

{Exactly what was found or heard, in their words or as the handout
reads. Empty until found.}

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

### What It Means

{The conclusion it supports, and what it leads to (match `leads_to`).}

### How to Find It

- **Where:** {the scene or place}
- **Roll:** {the check, if any, in the system's terms, and what a
  failure still gives them}

### Other Routes

{The other clues that point the same way, so one missed clue never
stalls the investigation. Aim for three.}

### If They Misread It

{The wrong conclusion they're likely to draw, and how to steer back.}

### Hidden Ties

- [[{Name}]] — {the tie the players don't know about (a `gm_only` relationship)}

<!-- /gm-only -->

---
name: ""
type: prop
canon_status: DRAFT
prop_kind: document   # document, object, diagram, supplied or container
prop_file: ""         # a hand-made page, PDF or image beside this note, e.g. "invitation.html"
prop_address: ""      # where it lives on the site; leave empty for props/<this note's name>.html (props/<name>-prop.html if a site page has that address)
prop_style: ""        # a style the site builds the page in (terminal, form, hand, letter, clipping, ticket, passport, scroll, decree); leave empty with a prop_file
prop_line: ""         # one line for the props page: how it reached the players
prop_group: ""        # the heading it sits under on the props page; empty uses its chapter
prop_container: ""    # the container prop it sits in, e.g. "[[The Bookshelf]]"
show_sealed: none     # containers only: "titles" also lists items not yet found, by title alone
source: ""
createdSession: ""
asOfSession: ""
lastUpdated: ""
aliases: []
tags: []
relationships: []
---

<!-- {braces} = replace with content. The prop publishes when this note
does. Parts of a hand-made page inside a gm-only comment fence are cut
from the published copy. Files the page links to are copied if they sit
beside it. With a prop_style, the words under ## The Text are the
prop's words; a fenced block that is the whole section keeps its lines
exactly. Everything above the gm-only fence is what players see on the
site. Omit a section rather than leave its heading empty. -->

## Description

{What it physically is: paper, material, size, one detail.}

## The Text

> {What the PCs read on it, exactly as they read it. Leave out what
> they haven't deciphered yet, or mark it [illegible].}

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

### What It Reveals

{What it tells a careful reader, and what it leads to.}

### Delivery

{How and when the players get it: handed over, found, posted to the site.}

### Hidden Ties

- [[{Name}]] — {the tie the players don't know about (a `gm_only` relationship)}

<!-- /gm-only -->

# PC Body Structure

Canonical body-heading hierarchy for PC entity files, the
`## Current Status` block spec, and the Story Companion Convention.
Templates in `shared/templates/pc-*.md` implement it per system;
any skill creating or updating a PC file follows the same skeleton.

```text
## Stat Sheet          — system-specific stats (always first body section)
## Background          — backstory, personality, description
## [System Sections]   — varies by system (see per-system template)
## Equipment           — gear, possessions, wealth/encumbrance
## Current Status      — player-facing present-state snapshot (maintained by session-wrapup)
## Notes               — player-facing, protected, published
## GM Notes            — keeper-only, protected, excluded from publish
```

Templates may omit inapplicable sections (e.g., FitD crews
have no `## Equipment` — gear is handled through Quality).

`## Notes` and `## GM Notes` are both **protected sections** —
only the GM edits them directly; automated skills preserve their
content unchanged. Protected (edit-safety) and excluded-from-publish
(visibility) are independent: `## Notes` is protected *and
published*; `## GM Notes` is protected *and excluded*.

`## GM Notes` is the single heading for whole-section GM-only
content — Keeper Checklist, World State, Source References,
tactical notes and the like nest under it as subsections, never
as a new top-level heading. The publish tool's section filter is
heading-level-aware, so anything under an excluded `## GM Notes`
stays excluded whatever its own name. For a single GM-only aside
inside public prose, use a standalone `<!-- gm-only -->` block on
its own lines. For content hidden only until revealed in play, use
`<!-- spoiler -->` instead — see `shared/reconcile.md`.

`## Current Status` is the inverse: a **skill-maintained**,
player-facing block holding the PC's **cumulative living state** —
the always-current answer to "where is this character now, and
what's still open for them." session-wrapup maintains it every
session (Step 3c). It is distinct from the `_Story.md` companion
(retrospective narrative) and the Wrap-Up's PC Carry-Forward (a
per-session delta that feeds this block).

It uses **stable labelled fields** so the block is both publishable
and machine-readable; an optional one-line prose lede may precede the
labels. Fields are omitted when empty:

```markdown
## Current Status

{optional one-line present-tense lede}

**Location:** {where the PC is now}
**Condition:** {wounds, SAN, conditions, phobias}
**Carrying:** {narratively-significant items/objects in hand — not the full Equipment list}
**Open threads:**
- {unresolved, forward-looking item}
**Knows (exclusive):** {secret/exclusive information this PC holds}
```

`Open threads` is the load-bearing field: a **cumulative** list that
carries unresolved items forward across sessions, gains items as they
arise, and loses them only when resolved. NPC-relationship shifts fold
into Open threads rather than a separate field.

System templates may add labelled fields; wrap-up preserves and
reconciles any labelled field it finds, not just the canonical five.
GURPS adds **Enc:** (current encumbrance level, e.g. `Light (1)`),
which the publish tool matches against the sheet's Encumbrance table.

The block **must** sit outside any `<!-- gm-only -->` or
`<!-- spoiler -->` fence (it publishes) and before the protected
`## Notes`/`## GM Notes` sections. The GM may also edit it directly;
the next wrap-up reconciles it either way. `vault_check.py pc-body`
(see `shared/vault-access.md`) checks placement and field shape.

## A sheet kept somewhere else

Some tables keep the character sheet outside the vault: D&D Beyond, a
PDF, paper. Such a PC has no `## Stat Sheet`, an empty one, or one
still holding the template's values, and its page publishes with a
Character Sheet tab that is empty or shows only defaults.

- `vault_check.py pc-body` reports these as a WARNING, in any system,
  along with a Stat Sheet that holds only a pointer or a "TBD", and
  one that is the template's but for a single line.
- The publish build names, in one line, every PC whose note gave the
  system's sheet no stats to place. A template left at its values
  renders a sheet of defaults, so only `pc-body` catches that case.

`sheet_source` in the PC's frontmatter settles it: a short note of
where the sheet is (`"D&D Beyond"`, `"PDF in the group drive"`,
`"paper, with the player"`). With it set, none of these warnings
fires. The publish tool does not put it on the page unless the PC
lists it in `display_meta`.
It is a line of text, quoted: a bare number, date or `true` is not a
note, and an unquoted colon in it breaks the file's frontmatter. The
publish tool is the one reader of the field; `pc-body` asks it.

When a skill creates or imports a PC and has no stats for it, or meets
this WARNING on a PC it just wrote, it asks the GM once, for all such
PCs together: are the stats coming, or is the sheet kept elsewhere, and
where? It writes each answer to `sheet_source` itself. If stats are
coming, it leaves the field empty and the warning stands until they
arrive.

A campaign that keeps no sheets on the site at all sets
`publish.character_sheets: false`; `sheet_source` is the per-PC answer
and that switch is the campaign-wide one. With it off `pc-body` emits no Stat
Sheet rows and asks about no `sheet_source`. A PC page then publishes
only the keep-list sections (Background, Current Status, Notes,
Relationships, Appearances, and the CoC and FitD prose sections);
`publish.pc_prose_sections` adds more. Everything else, `## Stat Sheet`
and the stat sections included, stays off the site. A sheet is read from
the note body only, never from frontmatter fields.

**Consumed by:** session-prep (Context Source, Threads, PC arc check),
the-midwife (new-chapter hooks), ttrpg-expert (arc/thread analysis),
campaign-qa (Current Status consistency check).

## Story Companion Convention

Every PC entity `Characters/PCs/{Name}.md` may have a companion
story file `Characters/PCs/{Name}_Story.md`; `campaign-qa`
validates that every active PC has one. Frontmatter, naming and the
append protocol: `shared/character-story-format.md`.

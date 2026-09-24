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

**Consumed by:** session-prep (Context Source, Threads, PC arc check),
the-midwife (new-chapter hooks), ttrpg-expert (arc/thread analysis),
campaign-qa (Current Status consistency check).

## Story Companion Convention

Every PC entity `Characters/PCs/{Name}.md` may have a companion
story file `Characters/PCs/{Name}_Story.md`; `campaign-qa`
validates that every active PC has one. Frontmatter, naming and the
append protocol: `shared/character-story-format.md`.

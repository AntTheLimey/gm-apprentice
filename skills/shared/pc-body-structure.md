# PC Body Structure

Canonical body-heading hierarchy for PC entity files, the
`## Current Status` block spec, and the Story Companion Convention.
Extracted from `shared/entity-schema.md` (which keeps the compact
type-field summaries). Consumed by session-wrapup (Step 3c),
session-prep, the-midwife, ttrpg-expert, campaign-qa, and all six
`pc-*` templates in `shared/templates/`.

All PC entity files follow this canonical heading hierarchy.
Templates in `shared/templates/` implement the full structure
per system; skills that create or update PC files follow the
same skeleton.

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
only the GM edits them directly; automated skills must preserve
their content unchanged. That's the only thing they share.
**Protected (edit-safety) and excluded-from-publish (visibility)
are two different, independent properties** — `## Notes` is
protected *and published*; `## GM Notes` is protected *and
excluded*. `## GM Notes` is the single canonical heading for
whole-section GM-only content: any content that used to get its
own top-level heading (Keeper Checklist, World State, Source
References, tactical notes, "Optional Keeper Hooks," etc.)
belongs as a freeform subsection nested under `## GM Notes`
instead of inventing a new top-level heading — the publish
tool's section filter is heading-level-aware, so anything nested
under an excluded `## GM Notes` stays excluded regardless of its
own subsection name. For a single spoiler-free aside embedded in
otherwise-public prose, use a standalone `<!-- gm-only -->` block
(on its own lines) instead of a whole subsection. For narrative
content that's only
hidden until it's revealed in play (not permanently secret), use
`<!-- spoiler -->` instead of `<!-- gm-only -->` — see
`shared/reconcile.md` for how spoilers get revealed.

`## Current Status` is the inverse: a **skill-maintained**,
player-facing block holding the PC's **cumulative living state** —
the single always-current answer to "where is this character now,
and what's still open for them." session-wrapup maintains it every
session (Step 3c), so the published page and any future consumer
never drift behind the narrative. It is the canonical current-state
source, distinct from the `_Story.md` companion (retrospective
narrative) and the Wrap-Up's PC Carry-Forward (a per-session delta
that feeds this block).

It uses **stable labelled fields** so the block is both publishable
and machine-readable; an optional one-line prose lede may precede the
labels for the website's human read. Fields are omitted when empty:

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

The block **must** sit outside any `<!-- gm-only -->` or
`<!-- spoiler -->` fence (it publishes) and before the protected
`## Notes`/`## GM Notes` sections.
The GM may also edit it directly; the next wrap-up reconciles it either
way.

**Consumed by:** session-prep (Context Source, Threads, PC arc check),
the-midwife (new-chapter hooks), ttrpg-expert (arc/thread analysis),
campaign-qa (Current Status consistency check).

## Story Companion Convention

Every PC entity `Characters/PCs/{Name}.md` may have a
companion story file at `Characters/PCs/{Name}_Story.md`.

- Frontmatter: `type: character-story`,
  `character: "[[{Name}]]"`, plus universal fields
- Discovered by naming convention (`{Name}_Story.md`),
  not frontmatter pointer
- Append-only — new sessions add a `## Session {N} — {Session Title}` heading
- `campaign-qa` validates every active PC has a story file
- See `shared/character-story-format.md` for narrative voice,
  genre matching, and append protocol

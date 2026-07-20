# Scaffold & Handoff (Phase 4)

The Midwife's Phase 4 procedure — adventure brief synthesis,
entity and plan promotion, vault scaffold, Session 0 handoff —
plus the Adventure Brief Template. Extracted from SKILL.md
(which keeps the phase trigger). File paths are relative to
the skill root, as in SKILL.md.

### Step 1: Synthesize Adventure Brief

Read `shared/entity-schema.md` for adventure-brief type.
Assemble the adventure index and topic files into the brief
using the template below. Apply the block/seam test: where a
topic file already holds finished prose, lift it verbatim;
author only the connective seams and fragment-derived text. Do
not re-voice writing that is already written.
(rationale: `shared/content-fidelity.md`)

- **Existing vault:** Write to
  `Adventures/{adventure-name}/{adventure-name}.md`.
  Use `[[wiki-links]]` for existing entities. Flag entity
  updates the adventure implies.
- **Greenfield:** Write to CWD. The adventure brief is
  written to `Adventures/{adventure-name}/{adventure-name}.md`
  relative to CWD — campaign-organizer will wrap the vault
  around it.

### Step 2: Entity & Plan Promotion

**2a. Entity promotion** — List all entity sketches from
`_midwife/{adventure}/entity-sketches/` and ask which
to promote to real vault entities:

"These entities emerged during design:
[Name] ([type]), [Name] ([type]), ...
Which should I create as vault entities?"

Approved entities are filed by campaign-organizer to the
correct vault folders with proper frontmatter. Do not
auto-promote — the GM chooses. Any `relationships:` edge on a
promoted entity takes its `type:` from the vocabulary in
`_meta/relationship-types.md` (subset of `shared/entity-schema.md`);
map narrative verbs and normalize inverses via
`shared/relationship-normalization.md` — never invent a predicate.

**2b. Plan promotion** — List all topic files from
`_midwife/{adventure}/` that contain narrative planning
content (arc design, scene designs, investigation flows,
timelines). Categorize each:

"These planning documents are ready for the vault:

Arc/structure:
- chapter-shape.md → Arc_Shape.md (plan_type: arc)
- narrative-arc.md → Narrative_Arc.md (plan_type: arc)

Investigation:
- investigation-shape.md → Investigation_Design.md (plan_type: investigation)

Scenes:
- temple-approach.md → Temple_Approach.md (plan_type: scene)
- recognition-scene.md → Recognition_Scene.md (plan_type: scene)
[etc.]

Timeline:
- timeline.md → Timeline.md (plan_type: timeline)

Which should I promote to the vault?"

For each approved plan:
1. Create `Planning/` under the chapter directory if it
   doesn't exist
2. Read `_Templates/_Template_Plan.md` for the frontmatter
   structure
3. Reshape the freeform Midwife draft into a vault entity —
   structure only, never the prose:
   - Set `plan_type` based on the categorization above
   - Set `chapter` to the chapter overview wiki-link
   - Populate `participants` with wiki-links to NPCs,
     factions, and creatures mentioned in the plan
   - Populate `locations` with wiki-links to locations
     mentioned in the plan
   - Add `relationships` between plans where sequencing
     or branching exists (e.g., `leads_to`, `precedes`,
     `alternative_to`)
   - **Preserve the body prose verbatim.** Carry the full
     narrative content across unchanged; only adapt section
     headers to the plan type and add `[[wiki-links]]`. Do not
     condense, paraphrase, re-voice, or "improve" it — promotion
     files the GM's writing, it does not re-author it.
     (rationale: `shared/content-fidelity.md`)
4. Write to `Chapters/{chapter}/Planning/{Plan_Name}.md`

**Self-check after each promoted entity or plan:**
1. Re-read the file just created
2. Compare frontmatter fields against `_Templates/_Template_{Type}.md`
3. Verify: `type` matches, `canon_status: DRAFT` is set, all required fields present
4. Verify: wiki-links use `[[Entity Name]]` format (no bare text references to entities)
5. Fix any issues before promoting the next item

**2c. World fact flush** — Write the world facts accumulated
through Woven Worldbuilding (Phases 1-3) to their `_World/`
domain files. These were confirmed at capture time — one
question per trigger — so file them without re-asking:

1. If `_World/` doesn't exist, create it with `world-index.md`
   and `_flags.md` stubs first (greenfield: campaign-organizer
   wraps the vault around `_World/` just as it does
   `Adventures/`)
2. Write each fact to its domain file, creating a stub from
   `shared/templates/world-domain.md` when the domain is new
3. Unresolved three-state flags (deferred heritage prompts and
   the like) go to `_World/_flags.md`

Skip this step only when no world facts emerged.

Content left in `_midwife/` after promotion (seeds, unused
sketches, half-formed ideas) stays as creative archive.
Update `_midwife/index.md` to record what was promoted
and what remains.

### Step 3: Vault Scaffold (greenfield only)

Ask: "Ready to set up the vault for this campaign?"
If yes:

1. **Create Campaign Overview** at
   `_Campaign/Campaign Overview.md` using the template from
   `shared/templates/campaign-overview.md`. Populate from the
   adventure brief conversation:
   - `campaign`: adventure/campaign name
   - `game_system`: system chosen (or empty if undecided)
   - `setting_year`: era discussed (or empty)
   - `current_game_date`: same as `setting_year` if known
   - `genre_tags`: from tone/genre discussion
   - `scope`: from adventure brief scope
   - `status`: `not_started`
   - `sessions_played`: 0
   - Premise section: from the adventure brief premise
   - Setting section: from worldbuilding discussion
   - Key Themes section: from tone and genre conversation
   - Key Factions section: from driving forces in the brief
   - Current Arc section: "Not yet begun."
   - GM Notes section: empty (a bare `## GM Notes` heading — the
     canonical single heading for whole-section GM-only content,
     see `shared/entity-schema.md`)

2. **Hand off** to campaign-organizer with the adventure
   brief as context. campaign-organizer builds the vault
   around the existing `Adventures/`, `_Campaign/`, and (when
   world facts emerged in Step 2c) `_World/` folders.

### Step 4: Update Status

Mark the adventure as "Ingested" in `_midwife/index.md`.
The working directory stays as creative archive.

### Step 5: Session 0 Handoff

Read `ttrpg-expert/gm-session-patterns.md`, Session Zero and
CATS sections.

"You've got enough to run Session 0. When you're ready,
session-prep can help you plan it — or if you'd like to stop
here and marinate on the concept, that's good too."

Do not auto-invoke session-prep. Offer it — the GM may want
to sit with the concept, discuss with players, or revise the
brief before committing to prep work.

## Adventure Brief Template

```yaml
---
type: adventure-brief
canon_status: DRAFT
title: "[title]"
system: "[system or undecided]"
scope: "[campaign | one-shot | few-shot]"
sessions_estimated: "[number or range]"
campaign: "[name, if existing vault]"
continuation_type: "[new | new-chapter | new-arc | time-jump | prequel | parallel | new-pcs]"
adventure_shape: "[linear | branching | hub-and-spoke | open-node | sandbox]"
tags: []
aliases: []
source_document: ""
---
```

### Required Sections

| Section | Content | Visibility |
|---------|---------|------------|
| Premise | One paragraph elevator pitch | Public |
| Tone & Genre | Sensory and emotional descriptors | Public |
| Adventure Shape | Structure type and rationale | Public |
| Core Tension | Central conflict or mystery | Public |
| Key NPCs | Per-NPC: role, motivation, connection, first appearance | Public |
| Locations | Per-location: atmosphere, significance, connections | Public |
| Entry Points | ≥3 hooks (Three Clue Rule at adventure scale) | Public |
| Escalation | How pressure increases | Public |
| CATS Pitch | Concept/Aim/Tone/Subject for Session 0 | Public — see note below |
| Session 0 Agenda | Checklist items for player buy-in | Public — see note below |
| Driving Forces | Per-faction: goal, victory state, plan, timeline, resources | GM Notes |
| If They Do Nothing | Antagonist plan runs to completion | GM Notes |
| Vault Notes | Existing entities, updates implied (vault only) | GM Notes |
| Open Questions | Things the GM still needs to decide | Spoiler |

"If They Do Nothing" is required. Open Questions are preserved
— never invent answers for things the GM was undecided on.

**Visibility column meaning:**
- **Public** — plain section, no fence, publishes as written.
- **GM Notes** — write as a `###` subsection under one `## GM Notes`
  heading in the brief, not its own top-level section (see
  `shared/pc-body-structure.md`).
- **Spoiler** — Open Questions get resolved into canon as play
  reaches them (`reconcile`'s spoiler-reveal step, see
  `shared/reconcile.md`); wrap the whole section in
  `<!-- spoiler -->` / `<!-- /spoiler -->` rather than `## GM Notes`,
  since it's meant to eventually publish once resolved, not stay
  permanently hidden.

**CATS Pitch and Session 0 Agenda are meant to be shared with
players** — don't hide the whole section. If a specific line reveals
a twist players haven't discovered yet (e.g. the true nature of a
central horror), wrap only that sentence in a standalone
`<!-- gm-only -->` or `<!-- spoiler -->` block on its own lines, not
the section.

# Scaffold & Handoff (Phase 4)

The Midwife's Phase 4 procedure — adventure brief synthesis,
entity and plan promotion, vault scaffold, Session 0 handoff —
plus the adventure brief's sections. Extracted from SKILL.md
(which keeps the phase trigger). File paths are relative to
the skill root, as in SKILL.md.

### Step 1: Synthesize Adventure Brief

Assemble the adventure index and topic files into the brief's
sections (Adventure Brief Sections, below). Apply the block/seam
test: where a
topic file already holds finished prose, lift it verbatim;
author only the connective seams and fragment-derived text. Do
not restyle writing that is already written.
(rationale: `shared/content-fidelity.md`)

Place each piece by who may read it (the Visibility column below).
A topic file's premise is written for the GM and usually holds the
secret: it goes under GM Notes as written, and the public Premise is
the pitch the players hear, written from it.

Write it with one command, the body straight on its stdin (a brief
it cannot place is refused and nothing is written):

```bash
gma vault-write <vault> entity-new --type adventure-brief \
  --name "<adventure-name>" --write <<'EOF'
---
title: "<title, when it says more than the name>"
system: <id, or undecided>
scope: <campaign | one-shot | few-shot>
sessions_estimated: "<number or range>"
campaign: "<name, in an existing vault>"
continuation_type: <new | new-chapter | new-arc | time-jump | prequel | parallel | new-pcs>
---

## Premise

<the pitch the players hear>

### The Truth

<what is really going on>

## Open Questions

<what the GM has still to decide>
EOF
```

The frontmatter holds the fields to set; the body is the sections
of the table, each once: `##` for a Public one and for Open
Questions, `###` for a GM Notes one, `####` for a heading inside a
section, and no `#` title. The command files the brief at
`Adventures/<adventure-name>/<adventure-name>.md`, puts every `###`
section under `## GM Notes` inside the gm-only fence and Open
Questions in its spoiler block: write neither fence nor the
`## GM Notes` heading. It refuses a GM Notes section written as
`##`, and a name another note has (give the brief another `--name`
and keep the adventure's in `title`). It places sections and does
not read them: what a Public section says is still yours to keep to
the pitch.

- **Existing vault:** `<vault>` is the vault. Once sessions exist,
  add `--session <number>` to the command: a brief written mid-campaign
  is stamped with that session, never as made before play. Use `[[wiki-links]]`
  for existing entities. Flag entity updates the adventure implies.
- **Greenfield:** `<vault>` is the CWD: Step 3 builds the vault
  around the brief.

### Step 2: Entity & Plan Promotion

**2a. Entity promotion** — List all entity sketches under
`_midwife/{adventure}/` (`npcs/`, the folders named for other
types such as `locations/` and `factions/`, and
`entity-sketches/` in an older workspace) and ask which
to promote to real vault entities:

"These entities emerged during design:
[Name] ([type]), [Name] ([type]), ...
Which should I create as vault entities?"

Approved entities go in as one batch, a block each: dry-run, show
the GM the rows, then `--write`.

```bash
gma vault-write <vault> batch - <<'EOF'
=== entity-new --type npc --name "<Name>" --date <today>
---
aliases: ["<a name the table uses>"]
status: alive
relationships:
  - target: "[[<Other Note>]]"
    type: member_of
    tone: loyal
    strength: 7
    description: "<how they are tied, a few words>"
    gm_only: true
---

## Overview

<what the players learn, from the sketch as written>

### Secrets

<what they do not>
EOF
```

A block's frontmatter holds only the fields to set (the rest are
the template's: `gma schema-rules show <type>`) and the ties; its
body is the sketch's text under the template's headings, a `##`
section for the players and a `###` one for GM Notes (a `####`
stays with the section it is in, so under a `##` it is published).
The command
fills the template, writes `## Related` and `### Hidden Ties` from
the ties (never send those two), marks a two-way tie and pairs
`parent_location` with its `part_of` tie, and the batch then runs
the frontmatter and relationship checks on what it wrote: fix what
they report. Do not
auto-promote — the GM chooses. An entity whose existence is
itself a secret (a hidden lodge, an unfound room, an NPC the
players must not hear of yet) gets `withheld: true`: the site
keeps it off until a reveal publishes it. Any `relationships:` edge on a
promoted entity takes its `type:` from the vocabulary in
`_meta/relationship-types.md` (see `shared/entity-schema.md`);
map narrative verbs and normalize inverses via
`shared/relationship-normalization.md` — never invent a predicate.

A major NPC (companion, or in the brief's Key NPCs) gets a full
workup now, built for who they are: abilities, spells, equipment, a
signature feature, and tactics, through `ttrpg-expert/npc-generation.md`
and the system's files, in its batch block's GM Notes (a `### Stats`
section). Any other NPC the plans put in a fight or casting gets at
least a stock block. Never write that a block will be built later.
After the batch, run `gma vault-check <vault> npc-stats`: before the
handoff, build each row for a major NPC or one the plans put in a
fight or casting; other rows may be left. If the game system is still
undecided, that is the one allowed gap, and it goes in the brief's Open
Questions.

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

Scenes (scene files):
- temple-approach.md → Temple Approach.md
- recognition-scene.md → Recognition Scene.md
[etc.]

Timeline:
- timeline.md → Timeline.md (plan_type: timeline)

Which should I promote to the vault?"

For each approved plan, dry-run, show the GM the rows, then
`--write`:

```bash
gma vault-write \
  <vault> promote-plan "_midwife/{adventure}/{file}.md" \
  --to "Chapters/{chapter}/Planning/{Plan_Name}.md" \
  --plan-type <type> --date <today> [--leads-to "<Plan_Name>"]... \
  [--participant "<name>"]... [--location "<name>"]... \
  [--section "<heading>"]
```

It fills the template and copies the body unchanged.
`--participant` and `--location` name the NPCs, factions,
creatures and places the plan is about, each by its note's name
or an alias (promote the entities first); notes the body links
to are added for you. `--leads-to` (a branch when repeated)
records sequencing, never a `relationships:` edge. A topic file
that holds several plans (a timeline and an investigation in one
draft) is promoted once per plan with `--section`, which copies
that heading's section alone.

A scene goes in with the same script's `scene-new --chapter
"<chapter>" --title "<Title>"` (dry run first; no chapter note yet:
`chapter-new --title "<chapter>"` before it), then its design text
goes in the body unchanged and its `entities`/`locations` get the
wiki-links it names.

**2c. World fact flush** — Write the world facts accumulated
through Woven Worldbuilding (Phases 1-3) to their `_World/`
domain files. These were confirmed at capture time — one
question per trigger — so file them without re-asking:

1. If `_World/` doesn't exist, create it with `world-index.md`
   and `_flags.md` copied from `shared/templates/world-index.md`
   and `shared/templates/world-flags.md`
2. Write each fact to its domain file, creating a stub from
   `shared/templates/world-domain.md` when the domain is new. Its
   `status` is `stub` while it holds no fact and `active` once it
   does (`inactive`: a domain the campaign has set aside); the
   vault check refuses any other word
   A domain file keeps the template's `createdSession: ""` (made
   before play), so the next reconcile promotes it; once sessions
   exist, write the current session number there instead
3. Unresolved three-state flags (deferred heritage prompts and
   the like) go to `_World/_flags.md`

Skip this step only when no world facts emerged.

Content left in `_midwife/` after promotion (seeds, unused
sketches, half-formed ideas) stays as creative archive.
Update `_midwife/index.md` to record what was promoted
and what remains.

### Step 3: Vault Scaffold (greenfield only)

Run the preview, show the GM what it will create and ask: "Ready
to set up the vault for this campaign?"

```bash
gma vault-scaffold \
  <vault> --system <id> --name "<campaign name>"
```

`<id>` is `coc-7e`, `coc-7e-regency`, `gurps-4e`, `dnd-5e-2024`,
`pf2e` or `fitd`. Use `--no-system` when no system was chosen or
the plugin does not support it. A system name the script does not
recognise is refused with the list: pass the matching id or
`--no-system`.

If the GM said yes to that question:

1. **Build the skeleton.** Run the same command with `--write`. It
   builds around the `Adventures/` and `_World/` files already
   there and never overwrites them.

2. **Create Campaign Overview** at
   `_Campaign/Campaign Overview.md` from
   `_Templates/_Template_Campaign_Overview.md`. Populate from the
   adventure brief conversation:
   - `campaign`: adventure/campaign name
   - `game_system`: system chosen (or empty if undecided)
   - `setting_year`: era discussed (or empty)
   - `current_game_date`: same as `setting_year` if known
   - `genre_tags`: from tone/genre discussion
   - `scope`: from adventure brief scope
   - `status`: `not_started`
   - `sessions_played`: 0
   - Premise section: the brief's public Premise, the pitch
   - Setting section: from worldbuilding discussion
   - Key Themes section: from tone and genre conversation
   - Key Factions section: each driving force as the players know
     it at the start; its goal, plan and timeline stay in the
     brief's GM Notes
   - Current Arc section: "Not yet begun."
   - GM Notes section: empty (a bare `## GM Notes` heading — the
     canonical single heading for whole-section GM-only content,
     see `shared/entity-schema.md`)

   The Overview is a page of the player site: every section above
   GM Notes is published, so none of them holds what the PCs are
   to find out in play.

### Step 4: Update Status

Mark the adventure as "Ingested" in `_midwife/index.md`.
The working directory stays as creative archive.

### Step 5: Session 0 Handoff

Read `ttrpg-expert/gm-session-patterns.md`, Session Zero and
CATS sections. Ask the GM for their house rules, and write each as a
bullet in the Overview's `## House Rules`, in their words.

"You've got enough to run Session 0. When you're ready,
session-prep can help you plan it — or if you'd like to stop
here and marinate on the concept, that's good too."

Do not auto-invoke session-prep. Offer it — the GM may want
to sit with the concept, discuss with players, or revise the
brief before committing to prep work.

## Adventure Brief Sections

| Section | Content | Visibility |
|---------|---------|------------|
| Premise | One paragraph: the pitch the players hear | Public |
| Tone & Genre | Sensory and emotional descriptors | Public |
| Core Tension | The conflict or mystery as the players meet it | Public |
| Key NPCs | Per-NPC, as first met: role, connection, first appearance; each entry names its NPC with a `[[link]]` | Public |
| Locations | Per-location, as first seen: atmosphere, significance, connections | Public |
| Entry Points | ≥3 hooks (Three Clue Rule at adventure scale) | Public |
| CATS Pitch | Concept/Aim/Tone/Subject for Session 0 | Public — see note below |
| Session 0 Agenda | Checklist items for player buy-in | Public — see note below |
| The Truth | What is really going on, where the public sections stop short: the true premise, the twist, each NPC's real motive, each place's secret | GM Notes |
| Adventure Shape | Structure type and rationale: the sessions' spine, to its end | GM Notes |
| Escalation | How pressure increases | GM Notes |
| Driving Forces | Per-faction: goal, victory state, plan, timeline, resources | GM Notes |
| If They Do Nothing | Antagonist plan runs to completion | GM Notes |
| Vault Notes | Existing entities, updates implied (vault only) | GM Notes |
| Open Questions | Things the GM still needs to decide | Spoiler |

"If They Do Nothing" is required. Open Questions are preserved
— never invent answers for things the GM was undecided on.

**Visibility column meaning:**
- **Public** — plain section, no fence, publishes as written, and
  feeds the Campaign Overview. It holds only what the players are
  told at the start. Whatever the PCs are to find out in play (who
  the villain is, what the monster is, who is in disguise, how it
  ends) goes under GM Notes, The Truth first; one such sentence
  inside a public section goes in a `<!-- gm-only -->` block on its
  own lines. An adventure with no secret has no The Truth section.
- **GM Notes** — a `###` section. The command puts it under the
  brief's one `## GM Notes`, inside the fence, wherever it is written.
- **Spoiler** — Open Questions get resolved into canon as play
  reaches them (wrap-up's "What came out tonight", step 5c;
  `shared/reconcile.md` 3.5 is the fallback); a `##` section the
  command keeps in a `<!-- spoiler -->` block rather than under
  `## GM Notes`, since it's meant to eventually publish once resolved,
  not stay permanently hidden.

**CATS Pitch and Session 0 Agenda are meant to be shared with
players** — don't hide the whole section. If a specific line reveals
a twist players haven't discovered yet (e.g. the true nature of a
central horror), wrap only that sentence in a standalone
`<!-- gm-only -->` or `<!-- spoiler -->` block on its own lines, not
the section.

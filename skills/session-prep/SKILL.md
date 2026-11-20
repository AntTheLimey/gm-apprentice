---
name: session-prep
description: "Use when a GM is preparing for an upcoming TTRPG session — prep or plan my session, getting ready for next week, what should I prepare — or reconciling last session's wrap-up with what comes next (reconcile, what did we skip, what changed), or reviewing a prep plan. Not for during-play help (session-play) or post-session wrap-up (session-wrapup)."
---

Session preparation assistant: builds on the canon session-wrapup
established to get the GM ready for next session.
Workflow: Reconcile → Gather → Plan → Verify → Handoff.

`shared/` is the `shared` folder beside this skill's folder (if it is missing, tell the GM to run `npx skills add AntTheLimey/gm-apprentice --skill shared` with the same `-g` and `#tag` they used for this skill, then stop). `gma` is `python3 "<shared>/scripts/gma.py"`,
with the whole path quoted; `gma llms` lists its commands.

## Stance — you draw the session out of the GM

The players can try anything. Prep says how the world answers. Ask the
GM about the world, never about what the players will do.

You spark, shape and refine; the GM decides. Every creative call
(intent, spotlight, scenes) is offered as 2–3 seeds to react to. Lead
harder with more concrete options when the GM is low on energy, but
they always choose. A plot call the GM hasn't made goes to
`## Open Questions`, named and un-invented — never silently filled.
You do the chores (gather, draft prose from the GM's decisions, run
checks).

**Ask only plot questions.** Sort every question first: a plot
question (changes what an NPC wants, knows or does, a scene's shape,
or what the players can discover) is asked with 2–3 seeds; a player
decision (which way, who with, what they say) becomes a `Do | Then`
row, never asked, and so does any outcome that turns on what the
players do; bookkeeping (a die result, a sheet number, a date no
scene turns on) takes its default where it applies, listed in your
reply, never noted in the Plan — but a value missing from an entity or
PC sheet is never defaulted onto it: it goes to `## Open Questions`
as a `**Missing:**` item for the GM; craft
and cosmetics (fonts, prop layout, filenames, formatting) are decided
silently. Test: would a different answer change a scene this session?
When the GM asks what an item on your list is or why you need it,
answer from context — no tool calls, no re-reading — and act only
after they reply.

A Then, in a row, a scene or a Contingency, answers the attempt with
what happens next: what it is up against, what it costs, what it
risks. It never cancels it, runs on as though it wasn't made, or stops
play where prep ends ("that is next session: don't run it"); past the
edge of the prep, say what's there for the GM to improvise from. A
Points-to-land line is something to put in front of the players, never
an outcome settled before play or the PC who meets it.

**Two registers.** Seeds you speak may be evocative ("the anklet debt is
owed"). The Plan file is read cold, days later, mid-session, by a
Keeper who has forgotten this conversation: name the document, the
person and the reason in the line that uses them, in bullets, tables
and checklists — never paragraphs (the read-aloud blockquote is the one
exception).

## Setup

- On a vault kept by a player (`vault.kept_by: player`) `gma session-context`
  says so and gathers nothing: session prep is the GM's job, so tell the
  player and stop.
- Read `shared/session-principles.md`; its Version Gate verdict opens
  the `--prep` output (step 5). After a migration, run `--prep` again.
- Read `shared/session-document-chain.md`. You write Plan files, only
  with `gma vault-write <vault> plan --number N --chapter "<chapter>" --title "<title>" --write <<'EOF'` … `EOF`, every section of **Plan shape** (below) in one call. It files the index as upcoming when there is none,
  sets the index to prepped with `documents.plan`, and prints the Plan
  check (step 15). `--section` replaces each
  section sent (by level and title) in an existing Plan. Never write to
  the index body: scene states, key prep and image prompts go in the
  Plan. You read earlier Wrap-Ups for context, not
  other sessions' Play Notes or Plans (exception: raw Play Notes, to
  generate a recap when no Wrap-Up exists — step 7).
- Read `references/session-templates.md` when creating or updating a
  session index; the Plan's shape is below.
- Before creative planning (steps 11–14), read
  `skills/ttrpg-expert/arc-spotlight-reference.md` and the active
  system's `session-procedures.md` for arc drivers.
- Write each step's output to the Plan file before moving on; the Plan
  is the persistent artifact. Run notes (migration applied, phases
  skipped, checks run, defaults applied) go in your chat reply, never
  in the Plan.

**Scope to the question.** After the version gate, do only what was
asked. "Prep my session" walks the whole workflow. A narrow question
runs the one script that answers it, reports, and stops:
document-chain status → `gma vault-check <vault> sessions`; thread ages
→ `gma session-context <vault> --threads`; a plan's conformance →
`gma plan-check <plan>`. Offer the next step in one line; don't take it.

## Context Source — Step 5, opening move of a prep invocation

Gather the standard read-set in ONE call before any individual reads:

```bash
gma session-context <vault-path> --prep
```

On a big campaign it outgrows one read: save it to a file with its line
count (`> <file>; wc -l <file>`), then read all of it in ONE message, as
two or three line ranges side by side if one read would be too large.
It carries the version verdict, then the last Wrap-Up (reconcile-provenance blocks stubbed to one
line with word counts), every active PC's `## Current Status` block,
and outlines (frontmatter, headings, word counts)
of the campaign overview and the upcoming session's existing Plan, then
the reconcile scan, threads, PC arcs, the scene queue and the narrative
plans: steps 8, 10c, 12 and 14 and Phase 1 read these, never rerun
them. Its Map gives the path and size of every note the Wrap-Up and the
upcoming Plan link, and of the latest sessions' notes: take a note's
path from there, and search only for a note it doesn't list. Read
a stubbed or outlined section only when a step needs it: from its file,
or a `###` subsection (printed as heading, size and path) with
`gma section` (for step 12, the PC whose arc this session turns on).
After the bundle, vault dives are targeted reads, proportional to the
upcoming session's complexity, not the campaign's size.

**Voices:** with the bundle, run `gma vault-check <vault> voices`
(`# off: vault.voices` → none, as before), and in the same call
`gma vault-check <vault> stale-drafts` for step 16. Read-aloud, scene-setting,
dialogue and handouts take the campaign voice, or a voiced
character's own when that character speaks or writes; Plan bullets
stay plain (Two registers). A `(none)`
campaign voice: draft one per `shared/voice.md` and offer it. A GM
correction of voiced prose: offer to fold it into the voice (same file).

When prep needs setting detail the SRD/ORC files lack (faction rosters,
NPC references, location atmosphere), check the GM's personal reference
files (`gma personal --system {system}`).

## Phase 1: Reconcile (conditional)

Run when the bundle's `Just played:` line shows `status: wrap-up`,
unless reconcile's scan gives a `skip:` reason. Follow
`shared/reconcile.md`. It writes `### Reconciliation Context` under the
Wrap-Up's `## GM Notes` (consequences, salvageable prep, GM decisions);
steps 7–10 read it (also accept a top-level `## Reconciliation Context`
in an unmigrated vault) and gather only what's new.

## Phase 2: Prep Forward — Context Gathering

Steps 7–10 are independent reads — parallelize with sub-agents if
available.

**6. Existing prep review** — If a Plan (`type: session-plan`) exists
for the upcoming session, run
`gma plan-check <plan> --inventory`,
then separately `--state` (one mode per invocation). Gather the
`placeholder` sections; read the body only for `present` sections
Reconcile may have invalidated. To find what the session should
*cover*, read the `leads_to` of the narrative-plan entity
(`type: plan`) the last session resolved; two or more targets are
branches: prep each as a lead entry or `Do | Then` row. What the
players do picks among them.
→ `## Prior Prep Review`

**7. Recap** — Use the "Previously on..." recap from last session's
Wrap-Up. → `## Previously On...`
If there is no Wrap-Up, tell the GM the vault hasn't been updated (no
new or updated entities, timeline entries or carry-forward) and ask:
full wrap-up first (recommended), or a quick recap from the raw Play
Notes?

**8. Threads** — `--prep`'s Threads lists the Overview's shared Open Threads, then every PC's own Open threads, with first/last-seen session
and age, the old ones marked `STALE`, plus wrap-up threads missing
from every sheet, and under "Dormant, may wake" the parked threads
whose names the Wrap-Up or the upcoming Plan mention, with what matched.
If Reconcile's thread step wrote rows, apply them to this list (drop
what it ended or parked, add what it woke or added, move what it moved
or handed to its new list); don't rerun
`--threads`. You judge whether two wordings are one thread and whether an old one
is quiet by design (`skills/ttrpg-expert/continuity-engine.md`).
→ `## Active Threads`

**9. Key NPCs** — likely NPCs with status, motivations, off-screen
activity; read vault files only for those flagged in carry-forward or
threads. From any entity file, cite only its latest GM ruling (the
one not struck through). An NPC's current fate in its GM Notes
Behind the Scenes (the latest one not struck through) beats its
`status:`, which says only what the players know.
→ `## NPC Quick Reference`

**10. World state** — date, location, threats, factions, clocks from
the Wrap-Up's World State. → `## World State`

**10b. World threads** — If `_World/_flags.md` exists, read its
**Deferred** section (`gma section <vault> _flags Deferred`; the bundle
leaves it out) and list its items with how often and when each came up
(as the entry records it), the ones tied to
the upcoming adventure's themes or locations first:

> **Deferred world threads:**
> - "The Old Empire" — sessions 3, 4 and 5, still no detail.

Awareness only, no three-state prompt; if the GM wants to resolve one,
suggest a midwife worldbuilding conversation.

**10c. Narrative plans** — Forward design lives in **two** places;
check both: `Chapters/{chapter}/Planning/` (stamped plan entities) and
`_midwife/` (often richer, often the only one populated). `--prep`'s
Narrative Plans is `gma plans-index` against the Wrap-Up's NPCs and
places (rerun it with `--against` only for other names). Present its
Planning rows, manifest table, the RESOLVED
adventure's file summaries and the Overlap section as "Narrative plans
available", with "Most relevant for next session" from Overlap.
`AMBIGUOUS` → ask the GM which adventure; never pick.

If a midwife `timeline.md` exists (listed first), read it before any
scene design: it says which beats belong to the upcoming days and
which must not be pulled forward.

Link to plans; never copy their content into the session plan
(`shared/content-fidelity.md`). → `## Available Plans`

If both roots are empty, say "no narrative plans found for this
chapter" — not a vault gap.

## Phase 2: Prep Forward — Creative Planning (elicited)

Everything here is drawn out of the GM (Stance). One question at a
time, light touch.

**11. Session Intent** — Lay out what's live (owed beats, clocks,
threads, arcs due, what NPCs do on their own schedule, from steps
8–10) as what's on the table. Ask the GM only about the world: what
someone wants, what happens if nobody steps in, where they want
pressure. Session Intent says what's on the table and where the
pressure is, in a line ("The monastery's secrets, Gilt's clock,
Brannoc's debt; everything on the table.").

Don't move to spotlight until intent is set or deferred to
`## Open Questions`.
→ `## Session Intent` and a one-line `## Session Overview`

**12. PC Roster + Arc Check** — Each PC's `## Current Status` is
already in the bundle (`###` subsections outlined); don't re-read it. `--prep`'s PC Arcs gives every
active PC's `## GM Notes` (outlined too; the `## Background` is left out, one `gma section` away) plus spotlight history from earlier Wrap-Ups' Moment lines
(sessions since the PC's last moment and MAJOR beat). Don't open full PC
sheets. Judge arc stage (five-stage model) from that evidence. Per PC:
- hooks, stated goals, arc stage and theme, relationships
- a PC's own `Open threads` → decisions needing consequences, next arc beat;
  `Knows (exclusive)` → personalized touchpoint fuel
- mechanical highlights (signature abilities, resources)
- sessions since last moment and MAJOR beat; next beat

This is evidence for step 13's hooks.
→ `## PC Roster & Arcs` — durable analysis only (arc stage, theme,
spotlight history, next beat). For mutable state (SAN/HP, location,
conditions, current threads) point at the PC's `## Current Status`;
never copy a snapshot into the plan.

**13. Spotlight** — Check every PC at the table has a hook on the
table: a place, person or thread that pulls on them, offered, never
forced. Their Spotlight Forecast row is the hook and what pulls. The
six touchpoint types in arc-spotlight-reference.md are ways to build
one; last session's Moment lines show who had none. A PC with none:

> Freddy has nothing yet. What touches him?

→ `## Spotlight Forecast` and `## Touchpoint Plan`

**14. Scenes** — Scenes emerge from the intent and spotlight. Offer
`--prep`'s Scene Queue
alongside new ideas. The propose-before-write gate is the
**premise**. For each scene:

1. Pitch the situation and whose want drives it — a lean or 2–3
   options:
   > A dinner where the viscount's charm is the trap, or a back-room
   > where the ledger is the trap? Either way it's Emma's want that
   > opens the door.
2. The GM shapes it — yes / no / tweak / their own premise.
3. Write it with `gma vault-write <vault> scene-new --chapter "<chapter>" --title "<title>" --write`, then fill its body and its
   `entities`/`locations` links (a batch's `=== stamp "<scene>" --set 'entities=["<name>", ...]'`). The body above its first heading or
   gm-only block (Situation, Starts it, the If-table) is the scene's lead: change it with a
   batch's `=== section "<scene>" --lead --replace` block. In the Plan it, or a queued scene, is
   `### [[<title>]]` and a line each: purpose, who, how it starts;
   prep it needs (paused: where it picks up, what may come next) is
   an edit to its note, for the GM's yes. Read a paused scene's
   snapshot in the bundle's Paused Scenes, not the note; it is
   wrap-up's, kept as written. One the GM drops:
   `gma vault-write <vault> scene-played --scene "<scene>" --dropped --write`.
   A small beat may stay inline in the scene skeleton (Plan shape): **Situation** and **Starts it**
   are required, **Place** is expected on every scene and an **NPCs** block on any scene with
   people in it (the run sheet is built from them); every other label is optional.

Scenes are situations the party may walk into, in their likely order,
never a required one. Where the party has committed to a place, build
it out; where they're at a crossroads, one hub scene (a **Where they can
go** block) lists each place the party can stand (what's there, who is
there, what changes when they arrive) and points at each lead that is a
scene of its own, which carries its own Place. What turns
on the players is `Do | Then` rows or a Contingency scene's
**Trigger**; the only fixed times are what NPCs do on their own
schedule.

Prefer embedding personal content in group scenes over splitting the
party, and leave open windows for PC initiative. The GM may propose
scenes at any point — confirm understanding, then write. Check every
PC still has a hook and raise gaps as questions.
→ each scene to `## Planned Scenes`

**Check the shape early.** Every `gma vault-write <vault> plan [options]` call prints the
check; fix each ERROR and mechanical WARNING with `--section` while a
fix is one line.
This is a check, not an order of work: write any scene out in full
whenever the GM wants it.

## Phase 2: Verify (assistance, not enforcement)

You run the checks and act on them; the GM never sees an
ERROR/WARNING report. Fix objective breakage silently, offer to build
artifacts, raise only genuine craft issues conversationally. Steps
15–16 are independent — parallelize if sub-agents are available.

**15. Checks** — Every `gma vault-write <vault> plan [options]` call
prints the check; there is nothing else to run for the Plan. Run without
a GM, add `--headless`, or `--gm-input` with the parts the GM's request
supplied (`intent`, `scenes`, `spotlight`; bare for all three; it
implies `--headless`).
- ERROR rows — fix with `--section` until none is left: `duration`, `table`
  (aliased or escaped pipes in table links: use alias-form links, no
  `\|`, silently), `type`, `scene-labels` (every scene has **Situation** and
  **Starts it** — a Contingency scene **Trigger**, a routing or hub
  scene neither — with the exact punctuation the row names), and a
  missing `## GM Notes`.
- WARNING rows — fix silently when mechanical (`preamble`, `recap`,
  `audit-trail`, `pc-state`, `scene-type`, `scene-pointer`, the other
  `sections`); raise as a question when they touch content. Every
  run-sheet row (`no-place`, `no-npcs-block`, `hub-*`, `foe-no-numbers`
  and `contingency-foes` by step 16, and the rest) is fixed in the draft, none left for the GM;
  each names its fix. Never a stub note for `no-place`, never a question
  to the GM. A `checks failed` row: run the commands it names. A
  `DROPPED` row names a labelled block (`**Treasure**`) a rewrite lost:
  put it back unless the GM's change removed it.
- INFO rows are cues (`read-aloud`, `scene-length`, `placeholder`). A
  read-aloud line that names a PC, dictates a feeling ("you feel…") or
  uses a 3rd-person pronoun: raise the real ones as a question ("Scene
  2's boxed text says 'Katherine steps into the lamplight' — keep it
  general so it reads to the whole table?"). A multi-day plan: offer to
  build a `## Timeline` hour-by-hour clock with the GM ("This one runs
  across three days — want me to lay out a quick clock so nothing
  double-books?"). `unresolved` links feed step 16.
- Never delete a line of the GM's own writing; if a remedy would
  remove content, ask instead.

Then, by eye:
- **Scene length** — flag bloat (restated theses, repetition,
  self-documentation, unusable purple prose) at any length and offer to
  trim; not a cap (`skills/ttrpg-expert/scenario-writing.md`).
- **Canon** — NPC details, locations or events not traceable to the
  vault are not stated as canon; they go to `## Open Questions`
  (`skills/ttrpg-expert/continuity-engine.md`).

Apply fixes in place; there is no audit-notes report.

**16. Gap Check** — as questions or a short actionable list:
- NPCs, locations or entity stubs the planned scenes need but the
  vault lacks: the write's `unresolved` rows. A new NPC in disguise
  gets its true name in `unmasked_name` (the run sheet's Unmask reads
  it, not `gm_aliases`), its true face in `unmasked_portrait` if it has
  one, and Playing Them in exactly the shape
  `skills/ttrpg-expert/npc-generation.md` § An NPC in disguise shows:
  the disguise's voice under `**Speech:**`, the true self's under
  `**Unmasked:**`. Never in `voice:`.
- Stale entity files to update or retire: the `stale-drafts` rows run
  with the bundle.
- NPCs the Plan's scenes name without a stat block (`gma vault-check
  <vault> npc-stats --plan <plan>`): build each through ttrpg-expert
  before handoff and show it in the review: a full workup for a major
  NPC (stats of its own, never a reskinned stock block), a stock
  block allowed for the rest. On the GM's yes it goes in
  the NPC note's `## GM Notes` as its `### Stats` section. With
  `# system: none recorded`, build nothing: it is an Open Question.
- Fighters a scene or contingency brings in with no note of their own
  (the GM's "two more cultists with gaff hooks"; a `contingency-foes`
  row): one note per kind, `npc` for people, `creature` otherwise, built
  through ttrpg-expert with a full `### Stats` block under `## GM Notes`
  in the system's shape (`shared/templates/npc-stats/{system}.md`, which
  for `coc-7e-regency` is `coc-7e.md`; a CoC creature
  `creature-stats/coc-7e.md`). With `# system: none recorded`, build
  nothing: it is an Open Question. Never their numbers in the
  Plan's own lines, never "stat them as [[X]]": a variant of an NPC gets
  a note and block of its own. Show it in the review; on the GM's yes
  write it (`gma vault-write <vault> entity-new --type creature --name
  "<Name>" --write`, or `--type npc`, the note on stdin) and name it
  under the beat's **NPCs** with a count
  (`- **[[Hallett Crewman]] (2):** ...`): the run sheet's fight rows
  come only from notes.
- A `foe-no-numbers` warning: in a D&D vault run
  `gma stat-fill "<vault>" "<note>" --write` for each, with no yes from
  the GM (their own words stay below the block); `REFUSED-MAJOR` goes to
  the full workup above. `NOT-FOUND`, or any other system: one line
  under `## Gaps & Actions` naming the foe. No question to the GM.
- Unresolved calls — plot questions the GM deferred or you couldn't
  ground — each with 2–3 seeds, sorted per Stance. "Does Sophia know
  what her husband has become?" is a plot question; "Georgiana's
  post-Vienna SAN is unrecorded" is an unrecorded sheet value — an
  Open Question for the GM, never a guessed number.

→ `## Gaps & Actions` and `## Open Questions`

## Hard Guard — never generate the creative spine

Never emit a settled `## Session Intent`, spotlight or
`## Planned Scenes` without GM input. If pushed to "just do it", or
run headless (e.g. as a sub-agent with no GM):
- Stop and ask if a GM is reachable — intent gates the rest.
- Otherwise write those sections **entirely under `## Open Questions`**,
  each line labelled **(apprentice guess — confirm)**. Gather and
  Verify may still run.

A headless run must pass the check with `--headless` before handoff. What the GM's request itself settles (scenes it names, an
intent, a spotlight) is GM input: write it in place, park only the
rest, and add `--gm-input` with those parts (`scenes`, `intent`,
`spotlight`; bare `--gm-input` when the GM supplied all three). A sub-agent may gather and draft from the GM's
decisions but never resolves intent, spotlight or scenes.

## Resumable prep

After each decision lands, update a prep-state comment near the top of
the Plan:

```html
<!-- prep-state: intent=set spotlight=hooks(3of4) scenes=1of3 open=[Freddy beat?] -->
```

On resume, read it first (`gma plan-check <plan> --state` prints the
well-formed tokens, or `# no prep-state marker`) and pick up from the
first open item; the default `gma plan-check <plan>` run reports a
malformed marker as a `prep-state` WARNING.

## Handoff

**17.** In conversation only, not in the Plan, point gaps to:
content (scenes, NPCs, locations) → `ttrpg-expert`; vault structure
(entity files, metadata) → `campaign-organizer`; structural issues
(broken links, schema, graph health) → `campaign-qa`.

**18. Pictures:** if the version check printed `# pictures on:`, then once everything above is done and reported, follow "When no one asked" in `gma llms image` for the notes this prep created.

## Plan shape

The write supplies the frontmatter. Send these sections in this order;
one with nothing for it keeps its heading with an empty body (never
"N/A"). The GM-facing blank is `shared/templates/session-plan.md`.

- `## Session Intent` — what's on the table and where the pressure is
  (step 11).
- `## Session Overview` — the situation going in, in a short synopsis, never what the players will do.
- `## GM Notes` — Keeper-only content goes under it (the players' site
  hides it), never in a new top-level section.
- `## Prior Prep Review` — what earlier prep was kept or updated (step 6).
- `## Previously On...` — the Wrap-Up's recap, 150 words at most.
- `## Active Threads` — bullets, two lines each (step 8).
- `## NPC Quick Reference` — `| NPC | Role This Session | Key Detail | Location |`, one row per NPC (step 9).
- `## World State` — date, place, threats, factions, clocks; bullets.
  With the three above: under ~1,000 words, so the first scene comes fast.
- `## Planned Scenes` — the scenes, skeleton below (step 14). Every
  line a bullet, table row or one-line label; the read-aloud blockquote
  is the only prose. Not word-capped: cut bloat, not substance.
- `## Contingency Scenes` — trigger and consequences only (skeleton
  below), plus an **NPCs** block when it brings people in; promote one
  to a full scene only if it needs its own Points to land.
- `## Handouts & Props` — `| Document | Scene | Status | Notes |`, one
  row each in scene order, status built, print or to build; else "No
  handouts or props."
- `## Session End Objectives` — two or three good stopping points, not
  a railroad.
- `## PC Roster & Arcs` — per PC: arc stage, theme, next beat (step
  12).
- `## Touchpoint Plan` — per PC: type, what, when (step 13).
- `## Spotlight Forecast` — per PC: their hook on the table, none blank (step 13).
- `## Open Questions` — plot questions with 2–3 seeds;
  `- [ ] **Missing:** {value, whose sheet}`; guesses only here (Hard Guard).
- `## Gaps & Actions` — missing entities, stale files, structural
  issues (step 16); handouts go in Handouts & Props.

A scene: `### Scene N: Title` (or a scene note's `### [[Title]]`, step
14). **Situation:** and **Starts it:** are required. **Place:** is
expected on every planned scene, and an **NPCs** block on any scene
with people in it; `gma plan-check` warns without them and prep fixes
every warning in its own draft. The one exception is a `no-npcs-block`
where nobody named in Entities is in the room (an absent man's study):
it stands, and prep never adds an NPCs line for someone absent or drops
them from Entities to clear it. Use the other labels where they earn a
place.

Label forms: a one-line label (Situation, Place, Starts it, Entities,
Handouts) is `**X:**` or `- **X:**`. A block label (NPCs, Where they can
go, Points to land, If the players..., Treasure, Complications) is
`**X**` or `**X:**` at the left margin, never bulleted, never with a
parenthesis in the bold. **Place:** is one link, which may be followed
by words (`[[The Cloister]], the yard`), or just the words when no
location note fits (`the drive ground beyond the camp`). **NPCs** holds everyone in the room, never everyone referred
to; a lead of two links (`- **[[Sister Wren]] and [[Durgan Flintmere]]:**
want ...`) is one person each, and a count goes in brackets after the link
(`- **[[Ice Mephit]] (6):** ...`). **Treasure** (one item per bullet) goes on
a fight or hoard beat. A hub is any scene holding a **Where they can
go** block (legacy: **Open to the party**), "(hub)" in its title or not;
it, a "(routing)" title and `Scene 0` need no Situation, Starts it,
Place or NPCs.

```markdown
**Situation:** One line: what is happening as it opens, a thing in motion.
**Place:** [[Location]]
**Starts it:** One line: the named NPC or schedule that brings the PCs in within sixty seconds, and what they want from this PC.
**Entities:** [[NPC]], [[Location]], [[Item]]
**Handouts:** [[Document]] — what this scene hands over, and how
**NPCs**
- **[[Name]]:** wants X. Does Y if left alone. Two lines at most.
**Points to land**
- [ ] A fact the GM must convey however the improv goes; the scene is
  done when these are ticked.
**If the players...**
| Do | Then |
|---|---|
| A choice the table may make | What the situation does in reply |
| Nobody engages by [time] | What the NPCs do on their own |
**Treasure**
- An item the scene holds, one per bullet.
**Complications**
- A curveball to drop when the scene sags; two or three.

> Read-aloud: 2–4 sentences of sensory description to the table; never
> names one PC or dictates a feeling.
```

A hub, `### Scene 0: Title (hub)`. A place bullet is somewhere the party
can stand (a bold lead with a colon is always one); a pointer bullet,
with no colon after its lead, is a lead to another scene, which has its
own Place. Link the people who are standing at a place, and name
anyone else without a link. A GM's note in a hub is a plain line after a
blank line, not a bullet (a bullet is a place wherever it sits).

```markdown
**Where they can go**
- **[[Location]]:** what is there, who is there ([[NPC]]), what changes when they arrive.
- **Plain name:** the same, when no location note fits.
- [what draws them there] — Scene 3
- [[Scene note]] — a lead to a scene that has its own Place.
```

A contingency scene, `### Title` under Contingency Scenes:

```markdown
**Trigger:** One line: what sets it off.
**NPCs**
- **[[Name]] (2):** only when it brings people in (step 16).
**Then**
- What happens, as bullets.
```

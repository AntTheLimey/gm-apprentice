# Scene design research — what the field actually prescribes

Date: 2026-09-14. Research only. The design decision it led to is recorded
at the end; the implementation is tracked separately.

## Why this exists

`plan_check.py` enforced an enumerated Session Plan scene skeleton as an
ERROR: every scene had to carry `**Situation:**`, `**Starts it:**`,
`**Entities:**`, `**NPCs**`, `**Points to land**`, an `**If the
players...**` `Do | Then` table, and `**Complications**`. Run against a
real, working, hand-written Session 11 plan the GM had already run a game
from, it produced nine errors — seven of them against a short routing
scene, told it was missing NPCs, Complications, a branching table and a
checklist it had no use for.

That prompted the question this document answers: **does any established
body of TTRPG prep practice prescribe a uniform, mandatory scene
skeleton?**

The research was run as a falsification attempt. It failed to find one.

## What six traditions say

Deliberately spread across systems, since gm-apprentice supports CoC 7e,
GURPS 4e, FitD, D&D 5e (2024) and PF2e.

### The Alexandrian — prep situations, and tools rather than contingencies

Justin Alexander's "Don't Prep Plots" is the most-cited system-agnostic
prep writing in the hobby. A plot is a sequence you expect; a situation is
a set of circumstances that plays out differently depending on what the
players do.

Its companion piece, *Tools, Not Contingencies*, is the directly relevant
one. It warns against "the Choose Your Own Adventure trap, where you waste
a lot of time trying to second-guess your players and developing mutually
contradictory material for every possible choice they might make."

What it says to prep instead: what the antagonists want, what precautions
they are taking, location layout and exits, standing resources, and the
current trajectory of events absent the PCs.

**Bearing on our skeleton:** endorses `Situation` and `Starts it`. Argues
*against* the `If the players...` `Do | Then` table as a category.

### Sly Flourish — the steps are modular and skippable

*Return of the Lazy Dungeon Master* gives eight prep steps, of which
"outline potential scenes" is the third. The steps are explicitly optional
and mix-and-match: "If a step doesn't serve that purpose, skip it. If you
feel like you already have what you need, toss out anything else."

Scene guidance is roughly one scene per 45 minutes of play, written as "a
handful of short scene descriptions." Sometimes there are no clear forks,
or so many that you don't break them into scenes at all.

**Bearing:** omission is the documented default, not a defect. Scenes are
short by design.

### PbtA / Dungeon World — the prep unit is not a scene

Apocalypse World-derived games prep **Fronts** and **Dangers**, written
between sessions with care, and never prep scenes. A Danger's fields:
Name, Type (from five categories), Impulse, Description, Cast, Grim
Portents, Impending Doom, Custom Moves. Cast and Custom Moves are marked
optional. A Front carries 2–3 Dangers, 1–5 Grim Portents, 1–3 Stakes
Questions and a Cast.

**Bearing:** the closest thing to a prescribed prep template in the PbtA
tradition describes a *situation*, has a Type that selects its shape, and
marks fields optional.

### Blades in the Dark — planning is deliberately skipped

FitD, which gm-apprentice supports, rejects the premise. A GM can arrive
with no plan at all. The engagement roll exists specifically to jump past
the planning stage and establish how much has already gone right before
the first scene. Score prep is a set of obstacles per zone, not a scene
list.

**Bearing:** for one of our five supported systems, an enforced scene
skeleton is not merely heavy, it contradicts the game's design.

### GUMSHOE — required content varies by scene type

Robin Laws' investigative framework is the one tradition that does assign
structure per scene, and it does so **by type**: Introductory, Core,
Alternate, Antagonist Reaction, Hazard, Sub-Plot, Conclusion, Hybrid.

- **Core** must carry at least one core clue.
- **Alternate** is useful but not necessary, and may be skipped entirely.
- **Antagonist Reaction** is a floating scene the GM deploys on pacing.
- **Hazard** is an impersonal obstacle; no NPCs are required.
- **Sub-Plot** is "notably sparse on predetermined content."

**Bearing:** the field's most structured scene model still has no uniform
required set. Type determines content.

### Angry GM — encounters and scenes are different animals

An *encounter* is "any situation in which the players have a short-term,
single-scene goal and there's some source of conflict preventing them from
just accomplishing their goal" — goal, conflict, and the possibility of
failure. A *scene* lacks those and is a no-fail situation used to advance
narrative or exposition. The framework is "flexible rather than
prescriptive about encounter construction details."

**Bearing:** the no-fail narrative scene is a named, legitimate category.
Our routing scene is one, and the checker gave it seven errors.

### Call of Cthulhu, for completeness

The Keeper Rulebook declines to prescribe a format at all: there is no
single prescribed end product, and the right level of detail is whatever
the individual Keeper needs (Keeper Rulebook, page 219). Scenario
structure guidance is beginning/middle/end, not per-scene fields
(page 216).

## Synthesis

1. **No tradition mandates a uniform scene skeleton.** Six were checked
   across five systems. Every one is either type-dependent or explicitly
   permissive about omission.
2. **The universal minimum is small.** What is happening, and who wants
   something badly enough to bring the PCs into it. Everything past that
   is situational.
3. **Branching contingency tables are a named anti-pattern**, not a
   missing field.
4. **Two supported systems reject scene prep as the unit.** FitD
   explicitly; PbtA-derived design implicitly, by prepping fronts.
5. **A short, near-empty scene is a recognised shape** in at least three
   traditions, not an incomplete one.

## Decision (2026-09-14)

**One minimum for all types.**

- Every Planned scene requires `**Situation:**` and `**Starts it:**`.
  Nothing else is ever required.
- A Contingency scene is a different shape, not a thin Planned one: it
  is `**Trigger:**` plus `**Then**`, and `**Trigger:**` is its one
  required label. A contingency with no trigger is a scene with no way
  in, which is the same defect `Starts it` guards against.
- Every other label — `Entities`, `NPCs`, `Points to land`, `If the
  players...`, `Complications` — is available and encouraged where it
  earns its place, and may simply be absent. No "N/A" placeholder.
- `**Type:**` stays informational. Type-driven required sets were
  considered (the GUMSHOE model) and rejected as more machinery than the
  evidence supports.
- The `If the players...` table stays available as a tool, but is never
  required and is not treated as a completeness criterion.

Rejected alternative: type-driven requirements, where `transition` needs
only `Situation` while `investigation` needs a clue. Better grounded in
GUMSHOE, but it makes `Type` load-bearing across five systems whose scene
vocabularies differ, for a benefit the one-minimum rule already delivers.

## Open problem this research exposed

The scene skeleton has never existed as a template a GM could open.
`skills/shared/templates/plan.md` — the file `campaign-organizer` copies
into every vault as `_Templates/_Template_Plan.md` — carries four
headings: Overview, Design, Contingencies, GM Notes. The skeleton lives
only in `session-prep/references/session-templates.md`, a skill reference,
and in `plan_check.py`'s regexes. The 1.9.12 migration entry describes a
sync from the reference file to `_Templates/` that nothing performs.

Whatever minimum is agreed has to land in the shipped template, not only
in the checker.

## Sources

- Justin Alexander, [Don't Prep Plots](https://thealexandrian.net/wordpress/4147/roleplaying-games/dont-prep-plots)
  and [Tools, Not Contingencies](https://thealexandrian.net/wordpress/37422/roleplaying-games/dont-prep-plots-tools-not-contingencies)
- Mike Shea, [Scenes — The Catch-all Step of the Lazy Dungeon Master](https://slyflourish.com/scenes_catch_all_step.html)
- [Dungeon World SRD — Fronts](https://www.dungeonworldsrd.com/gamemastering/fronts/)
- John Harper, [Blades in the Dark — Planning & Engagement](https://bladesinthedark.com/planning-engagement)
- [Scene Types in GUMSHOE Games](http://oneyardhex.blogspot.com/2016/05/scene-types-in-gumshoe-games.html)
  and Pelgrane Press, [Core vs. Alternate Scenes](https://pelgranepress.com/2021/05/17/core-vs-alternate-scenes/)
- The Angry GM, [Angry's Amazing Adventure Templates](https://theangrygm.com/angrys-amazing-adventure-templates/)
- Call of Cthulhu Keeper Rulebook, pages 216 and 219 (structure and level
  of detail), consulted via the local rules index

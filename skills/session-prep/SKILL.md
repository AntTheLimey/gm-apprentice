---
name: session-prep
description: "Use when a GM is preparing for an upcoming TTRPG session, reconciling what happened last time with what comes next, or reviewing prep plans. This is the between-sessions skill for looking forward — processing the aftermath of the last session into preparation for the next one. Not for during-play help (session-play) or post-session wrap-up (session-wrapup)."
---

Session preparation assistant. Builds on what session-wrapup
established as canon to get the GM ready for next session.
Workflow: Reconcile → Gather → Plan → Verify → Handoff.

## Stance — you draw the session out of the GM

You draw the session out of the GM — spark, shape, refine, never decide for
them. Every creative call (intent, spotlight, scenes) is offered as 2–3 seeds
to react to, not a finished answer. Lead harder when the GM is low on energy —
offer more concrete options — but they always choose. Never resolve a creative
question the GM hasn't: unresolved calls go to `## Open Questions`, named and
un-invented, never silently filled. The apprentice does the chores (gather,
draft prose from the GM's decisions, run checks); the GM makes the calls.

**Shared references:** Read `shared/session-principles.md` on
first invocation.

**Version check:** On first invocation, read
`gm_apprentice_version` from `_meta/vault-config.md` and
`current_version` from `shared/migrations.md` — frontmatter only, Read with `limit: 10`; the rest of the file is a long migration history you don't need for the check. If the vault
version is lower or absent, announce the mismatch and hand off
to campaign-organizer's migration workflow
(`campaign-organizer/references/migration-procedure.md`) before
proceeding with prep. Resume after migration completes. Skip
this check if `_meta/` doesn't exist (that's first-time setup,
not migration).

**Document chain:** Read `shared/session-document-chain.md`.
Session-prep writes Plan files and updates the session index.
It reads previous Wrap-Up files for context — normally never
Play Notes or Plan files from other sessions (exception: raw
Play Notes may be read as a fallback when no Wrap-Up exists,
to generate a recap only — see step 7).

**Trigger phrases:** "prep my session", "plan my session",
"getting ready for next week", "what should I prepare",
"reconcile", "what did we skip", "what changed"

**Session note templates:** Read `references/session-templates.md`
when creating or updating session notes.

**Creative planning references:** Read
`skills/ttrpg-expert/arc-spotlight-reference.md` before
starting creative planning (the elicited Intent → Spotlight →
Scenes sequence, steps 11–14). For system-specific arc drivers,
also read the active campaign's system `session-procedures.md`.
The creative middle is *elicited*, not generated — see the Stance
section above.

**Progressive file writes:** Every step writes its output to
the Plan file before proceeding. The Plan file is the
persistent artifact — conversation is ephemeral.

## Context Source

**Gather the standard read-set in ONE call** before any
individual reads:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/skills/shared/scripts/session_context.py" <vault-path>
```

It emits the last Wrap-Up, every active PC's `## Current
Status` block, the upcoming session's existing Plan, deferred
world flags, and the campaign overview — replacing a dozen-plus
separate reads (see `shared/vault-access.md`). If Python is
unavailable, fall back to the manual read pattern — it must
cover the same set:

1. Last session's Wrap-Up file — primary context
2. PC roster — always, including each active PC's `## Current Status`
   block (Location, Condition, Carrying, Open threads, Knows (exclusive))
3. The upcoming session's Plan file, if one exists
4. `_World/_flags.md` — Deferred section
5. The campaign overview (current game date, campaign state)

**After the bundle either way:** vault dives are targeted
reads only, proportional to upcoming session complexity, not
campaign size.

### Personal Reference Files

`systems/{system}/personal/` may contain the user's own
setting reference (factions, NPCs, locations, random tables).
Gitignored — never distributed. Check here when prep needs
setting detail the public SRD/ORC files don't cover —
faction rosters, NPC references, location atmosphere.

## Phase 1: Reconcile (conditional)

Runs when most recent session has status `wrap-up` (not yet
`reviewed`). Skip for first sessions or when already `reviewed`.

**Invoke `shared/reconcile.md`.** Reconcile walks the GM through
reviewing the Wrap-Up, promotes canon status, and handles
salvageable prep triage. See the shared procedure for the full
workflow.

**Reconcile-to-Prep handoff:** Reconcile writes
`## Reconciliation Context` to the Wrap-Up file, capturing
consequences, salvageable prep, and GM decisions. Steps 7-10
read this and only gather what's new.

## Phase 2: Prep Forward — Context Gathering

**6. Existing prep review** — If a Plan file (`type: session-plan`)
already exists for the upcoming session, read it and determine
what's already covered. Flag what needs updating vs what can
stand. Skip gathering for sections already present unless
Reconcile invalidated them.
→ Write `## Prior Prep Review` to Plan file.

**7. Recap** — Present the "Previously on..." narrative recap from last
session's Wrap-Up file (generated by session-wrapup).
→ Write `## Previously On...` to Plan file.

If no recap exists (GM skipped wrap-up):

> "The last session doesn't have a Wrap-Up file yet. I can
> generate a quick 'Previously on...' from raw play notes,
> but the vault won't have been updated — no new entities,
> no existing entity updates, no timeline entries, no
> carry-forward. Want me to do a full wrap-up first
> (recommended), or just the quick recap?"

Skipping wrap-up means entity updates and creation don't
happen. The vault stays frozen at pre-session state.

**8. Threads** — Review carry-forward + unresolved questions,
impressive NPCs, unfollowed clues, pending consequences.
Fold in each active PC's `## Current Status` → `Open threads`:
the always-current per-PC thread list (items carry forward even
when they dropped out of the last session's carry-forward).
Flag stale threads (3+ sessions without advancement).
Reference `skills/ttrpg-expert/continuity-engine.md` for
stale thread detection.
→ Write `## Active Threads` to Plan file.

**9. Key NPCs** — NPCs likely to appear, with status,
motivations, off-screen activity. Read vault files only for
those flagged in carry-forward or threads.
→ Write `## NPC Quick Reference` to Plan file.

**10. World state** — From Wrap-Up file's World State section.
Date, location, threats, factions, clocks.
→ Write `## World State` to Plan file.

#### Step 10b: World threads

If `_World/_flags.md` exists, read the **Deferred** section.
Surface items gaining traction:

> **World threads gaining traction:**
> - "The Old Empire" — mentioned 3 times across sessions 3-5,
>   still no detail. Worth a midwife worldbuilding session?
> - "River spirits" — mentioned twice, possibly related to the
>   Thornwood arc

**Resurfacing criteria:**
- Referenced in 3+ distinct sessions
- 3+ mentions within a single session
- Related to the upcoming adventure's themes or locations

**Awareness only** — no three-state prompt. The GM decides
whether to act. If they want to resolve, suggest a midwife
worldbuilding conversation.

If Reconcile ran, steps 7-10 read `## Reconciliation Context` and skip
what's already established.

#### Step 10c: Narrative plans

If `Chapters/{chapter}/Planning/` exists, scan it for plan
entities relevant to the upcoming session:

1. Read all files in `Planning/` and categorize by
   `plan_type` (arc, scene, investigation, timeline)
2. Surface scene plans whose `participants` or `locations`
   overlap with the threads, NPCs, or locations already
   gathered in steps 8-10
3. Present a brief summary:

> **Narrative plans available for this chapter:**
> - Arc: Arc_Shape.md — four-phase dramatic structure
> - Scenes: Temple_Approach.md, Recognition_Scene.md,
>   Escort_Betrayal.md — scene designs with decision trees
> - Investigation: Investigation_Design.md — clue flow
>
> **Most relevant for next session:** [list based on thread
> and NPC overlap]

Do not copy plan content into the session plan — link to
it. Plans are reference documents the GM consults during
play, not material to be duplicated.
(rationale: `shared/content-fidelity.md`)
→ Write `## Available Plans` to Plan file.

## Phase 2: Prep Forward — Creative Planning (elicited)

The whole creative spine — intent, spotlight, scenes — is drawn out of the
GM (see Stance). Offer seeds; the GM chooses. One question at a time, light
touch — don't interrogate. Anything the GM defers goes to `## Open Questions`,
never invented.

**11. Session Intent — "what's this session for?"** Before any scene work,
surface the vault-mined material as seeds and ask the GM to set the dramatic
intent:

> Here's what's live going into this session: [owed beats, ticking clocks,
> dormant threads, PC arcs due — drawn from Gather, steps 8–10]. What do you
> want this one to be *about*? Whose moment is it?

The GM sets the intent; you do not. Write their stated purpose to
`## Session Intent` in the Plan file (and a one-line synopsis to
`## Session Overview`). If the GM is unsure, offer 2–3 concrete directions
grounded in what's live — but the choice is theirs. Do not proceed to
spotlight until intent is set or explicitly deferred to `## Open Questions`.
→ Write `## Session Intent` to Plan file.

**12. PC Roster + Arc Check (grounding)** — Re-read the active PC sheets so the
conversation is grounded, not guessed. Per-PC:
- Backstory hooks, stated goals, current arc stage (five-stage model), arc
  theme, relationships with other PCs and NPCs
- `## Current Status` read: `Open threads` → decisions needing consequences /
  next arc beat; `Knows (exclusive)` → personalized touchpoint fuel
- Mechanical highlights (signature abilities, resources)
- Last spotlight level, sessions since last B-plot feature; next arc beat

This is chore-work that *feeds* the GM's spotlight decision — it is evidence,
not a decision.
→ Write `## PC Roster & Arcs` to Plan file.

**13. Spotlight — whose moment (elicited)** — Offer a lean plus alternatives,
grounded in the arc/spotlight data, and let the GM choose the A/B/C split:

> I'd lean Emma for the B-plot — the anklet debt is owed — or Katherine, who
> hasn't had a solo beat in three sessions. Or someone else entirely?

The data is *evidence for the GM's decision*, not the decision. A-plot
(~50–60%, main storyline, all PCs); B-plot (~25–35%, one featured PC); C-plot
(~10–15%, a lighter second PC). Once the GM chooses, assign touchpoints against
that choice using the six types from arc-spotlight-reference.md (Backstory
Connection, Moral Dilemma, Ability Showcase, Decision Callback, Arc Advancement
Clue, Character Moment); the B-plot PC gets at least one high-impact touchpoint.
Then run coverage as **questions**, never silent fills:

> Freddy has no beat yet — light on purpose, or do you want one?

→ Write `## Spotlight Forecast` and `## Touchpoint Plan` to Plan file.

**14. Scenes — from intent + spotlight (elicited)** — Scenes *emerge from* the
intent and spotlight the GM just set. The propose-before-write gate lives at
the **premise**, not the finished scene. For each scene:

1. Pitch the **situation + whose want drives it** — a lean, or 2–3 options:
   > A dinner where the viscount's charm is the trap, or a back-room where
   > the ledger is the trap? Either way it's Emma's want that opens the door.
2. The GM shapes it — yes / no / tweak / their own premise.
3. *Then* you write it up, applying the kept craft rules:
   - **Objective** = the *situation* the scene puts in front of the players,
     not a lesson to land (name the pressure, not the theme).
   - **Named initiator** — who brings this PC here in the first sixty seconds,
     and what they want from *this* PC (ensemble scenes: the household
     schedule is a valid initiator). A scene that cannot answer this is not
     finished.
   - **Read-aloud** as a `> ` blockquote: objective sensory description,
     2–4 sentences, addressed to the table — never naming one PC or dictating
     a feeling ("you feel…").

Prefer embedding personal content in group scenes over splitting the party.
Include open windows where PC initiative can emerge. The GM may propose their
own scenes at any point — confirm understanding, then write. Spotlight balance
across the written scenes is verification you run *against the GM's choices*,
surfacing gaps as questions, never silently filling them.
→ Write each scene to `## Planned Scenes` in Plan file.

## Phase 2: Verify (assistance, not enforcement)

You run the deterministic checks as **chores** and act on them yourself. The
GM never sees an ERROR/WARNING report. Silently fix objective breakage, offer
to build artifacts, and raise only *genuine* craft issues conversationally.

**15. Run the checks as chores** — Against the Plan file's vault
(`vault_check.py` lives at
`${CLAUDE_PLUGIN_ROOT}/skills/shared/scripts/vault_check.py`):

- **Tables** — `vault_check.py <vault> tables`. Aliased-wikilink pipes or
  escaped pipes inside a table break Obsidian's reflow. **Silently fix** them
  (alias-form links, no `\|`); do not narrate it.
- **Multi-day clock** — `vault_check.py <vault> timeline`. If the plan spans
  multiple days, *offer* to build the `## Timeline` clock with the GM so hours
  and same-day travel stay coherent — an offer, not a warning:
  > This one runs across three days — want me to lay out a quick hour-by-hour
  > clock so nothing double-books?
- **Read-aloud** — `vault_check.py <vault> read-aloud`. Each hit is a
  high-precision cue that a `> ` read-aloud line names a PC, dictates a feeling
  ("you feel…"), or leans on a 3rd-person pronoun. Raise only the real ones as
  a question:
  > Scene 2's boxed text says "Katherine steps into the lamplight" — want that
  > kept general so it reads to the whole table?
- **Scene length** — a scene runs as long as its content earns (situation,
  initiator, branches, NPC wants, mechanical notes). Flag **bloat** — restated
  theses, repetition, self-documentation, unusable purple prose — regardless of
  length, and offer to trim it. Over ~1,200 words, sanity-check with the GM
  that the length is load-bearing. It is a nudge, not a cap.
  (ref: `skills/ttrpg-expert/scenario-writing.md`)
- **Preamble** — keep pre-scene context (Previously On, Active Threads, NPC
  Quick Reference, World State) under ~1,000 words combined, recap ≤150 words,
  so the Keeper reaches Scene 1 fast. Trim silently.
- **Canon** — NPC details, locations, or events not traceable to the vault are
  not stated as canon. Anything you cannot ground goes to `## Open Questions`,
  named — never invented as a "pipeline gap" fill.
  (ref: `skills/ttrpg-expert/continuity-engine.md`)

→ Apply fixes in place; there is no audit-notes report for the GM to read.

**16. Gap Check** — Surface, as questions or a short actionable list:
- NPCs referenced but lacking vault files; locations not described
- Stale entity files: flag for update vs retire
- Missing entity stubs needed for planned scenes
- **Unresolved calls** — anything the GM deferred, or you could not ground in
  canon, goes to `## Open Questions`, explicit and un-invented. This is where
  "Georgiana's post-Vienna SAN is unrecorded" lives — named, not guessed.

→ Write actionable gaps to `## Gaps & Actions` and unresolved calls to
`## Open Questions` in Plan file.

## Hard Guard — never generate the creative spine

session-prep does **not** emit a settled `## Session Intent`, spotlight, or
`## Planned Scenes` without GM input. If pushed to "just do it," or run
headless / non-interactively (e.g. dispatched as a subagent with no GM to
answer):

- **Stop and ask** if a GM is reachable — the intent step gates the rest.
- **Otherwise** produce those sections **entirely under `## Open Questions`**,
  each line labelled **(apprentice guess — confirm)**, never as settled plan
  content. The Gather and Verify chores may run; the creative calls may not be
  silently resolved.

This is what makes the guided flow real rather than cosmetic.

## Resumable prep

Weekly prep gets interrupted. Keep a light prep-state marker in the Plan file
so a resumed session doesn't re-ask settled questions. After each decision
lands, update a short HTML comment near the top of the Plan recording what's
decided vs open and where the conversation is:

```html
<!-- prep-state: intent=set spotlight=Emma(B) scenes=1of3 open=[Freddy beat?] -->
```

On resume, read it first and pick up from the first open item.

## Handoff

**17. Skill handoff** — Conversational only, not written to
Plan file. Based on gaps and actions identified:
- Content creation (scenes, NPCs, locations) → `ttrpg-expert`
- Vault structure (entity files, metadata, organization) →
  `campaign-organizer`
- Structural issues (broken links, schema violations, graph
  health) → `campaign-qa`

## Sub-agent Opportunity

- Steps 7-10: independent vault reads — parallelizable.
- Steps 11-14: the elicited creative spine — run in order, *with the GM*.
  A sub-agent may gather and draft prose from the GM's decisions, but must
  not resolve intent/spotlight/scenes itself (see Hard Guard).
- Steps 15-16: independent chore checks — parallelizable.

If sub-agents unavailable, run all steps sequentially.

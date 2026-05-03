---
query: "Run session prep for Session 4 of my campaign"
system: workflow
type: session-prep
total_tokens: 57293
wall_clock_ms: 254082
files_loaded:
  - skills/session-prep/SKILL.md
  - skills/session-prep/references/session-templates.md
  - skills/shared/session-principles.md
  - skills/shared/session-document-chain.md
  - skills/ttrpg-expert/arc-spotlight-reference.md
  - tests/benchmark-campaign/_meta/index.md
  - tests/benchmark-campaign/_Campaign/Player Characters.md
  - tests/benchmark-campaign/_Campaign/Timeline.md
  - tests/benchmark-campaign/Chapters/Chapter 1/Sessions/Session 01 - The Missing Professor - Wrap-Up.md
  - tests/benchmark-campaign/Chapters/Chapter 1/Sessions/Session 02 - The Docks at Night - Wrap-Up.md
  - tests/benchmark-campaign/Chapters/Chapter 1/Sessions/Session 03 - The Inner Sanctum.md
  - tests/benchmark-campaign/Chapters/Chapter 1/Sessions/Session 03 - The Inner Sanctum - Plan.md
  - tests/benchmark-campaign/NPCs/Brother_Ezra.md
  - tests/benchmark-campaign/NPCs/Professor_Ashford.md
  - tests/benchmark-campaign/NPCs/Inspector_Crane.md
  - tests/benchmark-campaign/NPCs/Mrs_Whitmore.md
  - tests/benchmark-campaign/NPCs/Tommy_Flanagan.md
  - tests/benchmark-campaign/Locations/St_Anselms_Church.md
  - tests/benchmark-campaign/Locations/Kingsport_Docks.md
  - tests/benchmark-campaign/Locations/Ashford_Study.md
  - tests/benchmark-campaign/Factions/Order_of_the_Silver_Twilight.md
  - tests/benchmark-campaign/Clues/Coded_Letter.md
  - tests/benchmark-campaign/Clues/Strange_Symbol.md
  - tests/benchmark-campaign/Clues/Witness_Statement.md
---

# Session 4 Prep — The Ashford Case

**Campaign:** The Ashford Case  
**System:** Call of Cthulhu 7th Edition  
**Session:** 4 (planned)

---

## Vault Assessment — A Note Before We Begin

The vault shows Session 3 ([[Session 03 - The Inner Sanctum]]) has
status `prepped` — a Plan file exists but there are no Play Notes and
no Wrap-Up. This means Session 3 has not been played (or was played
but not yet processed through session-wrapup).

Before running full Session 4 prep, I recommend one of three paths:

**Option A — Session 3 is still upcoming (not played):**  
You asked for "Session 4" but Session 3 hasn't happened yet. In that
case, this document is premature. We should instead review the
existing Session 3 Plan and confirm it's still ready to run.

**Option B — Session 3 was played but not wrapped up:**  
The right move is to run session-wrapup first. That will update the
vault with what actually happened, which this prep needs as its
foundation. Skipping wrap-up means entity updates don't happen and the
vault stays frozen. I can generate a "Previously on..." from raw play
notes, but the vault won't reflect the events.

**Option C — Proceed assuming Session 3's plan played out broadly as
written (bridge scenario):**  
If Session 3 happened and you want to push forward without a formal
wrap-up, I'll build Session 4 prep using Session 2's authoritative
Wrap-Up + Session 3's Plan as the primary context source. I'll flag
wherever uncertainty exists. This is a degraded-confidence run.

---

**For this prep document, I am proceeding with Option C.** I'll treat
Session 3's plan as a rough guide to what probably happened, draw on
Session 2's authoritative state as the confirmed baseline, and flag
assumptions clearly. The Plan file will be marked `source_confidence:
DRAFT` with a bridge note.

---

## Prior Prep Review

A Plan file exists for Session 3: [[Session 03 - The Inner Sanctum - Plan]].
No equivalent exists for Session 4. This is a fresh prep.

Session 3's plan covered:
- Act 1: The Silver Twilight Lodge visit (red herring pointing to the
  church)
- Act 2: Finding the entrance to the hidden chambers via the crypt
- Act 3: Confrontation with Brother Ezra and cultists; resolution of
  Ashford's fate

For Session 4, I am assuming Session 3 resolved — broadly — the
confrontation arc and the investigators encountered the inner sanctum.
Given that assumption, Session 4 is either the aftermath/resolution
session OR Session 3's plan ran long and the confrontation was only
partially resolved.

The two most likely shapes for Session 4:

1. **If the confrontation is done:** Session 4 is the denouement —
   Ashford recovered (or not), Crane confronted, the Order exposed or
   driven underground, and the investigators' personal aftermath.

2. **If the confrontation was cut short:** Session 4 picks up mid-
   crisis in the inner sanctum with the ritual still ticking.

I'll prep for **Shape 1 (denouement + aftermath)** as the primary
structure, with Shape 2 as the open contingency if the confrontation
carried over.

---

## Previously On...

*Reconstructed from Session 2 Wrap-Up and Session 3 Plan. Mark as
unverified until a formal wrap-up for Sessions 3 is completed.*

Three investigators arrived in Kingsport chasing the disappearance of
[[Professor Henry Ashford]], a Miskatonic antiquarian who had stumbled
into something far older than his career prepared him for. In his
study they found a coded letter — a breadcrumb trail he'd left for
exactly this eventuality — pointing them to warehouse 7 on the
[[Kingsport Docks]].

The docks visit turned violent. On the night of October 17th, the
investigators watched as [[Brother Ezra]] — a gaunt, inhuman figure
who moved wrong in ways that cost Dr. Voss three points of sanity —
oversaw the unloading of crates marked with the recurring [[Strange
Symbol]]. Stealth failed. The chase through the fog was harrowing.
Ezra broke off pursuit and vanished into the old quarter. The
investigators recovered two stone tablets — carved in an unknown
script, bearing the eye-within-crescent symbol — and the knowledge
that Ashford had seen an inner sanctum beneath "the old church."

Session 3 brought them to St. Anselm's: a deconsecrated church on
Burial Hill Lane, its respectable stone exterior hiding chambers of
pre-colonial stonework below. Professor Ashford was found there,
imprisoned and partially broken, forced to translate the complete
*Revelations of Glaaki* for the Order. Brother Ezra and the inner
circle stood between the investigators and the ritual chamber, where
something waited in the pit below the silver-inlaid floor.

*[Session 3 outcome details unknown — the following assumes the
investigators survived, disrupted the ritual or rescued Ashford or
both, and have emerged into the aftermath.]*

---

## Active Threads

### Hot (Immediate)

1. **Professor Ashford's condition** — If rescued, he is alive but
   broken. SAN: 15. He has seen what's in the pit. He knows things
   that will cost him further sanity to recount. Getting him to safety
   and deciding what to do with what he knows is an immediate problem.
   *No wrap-up to confirm; treat as unverified pending.*

2. **Brother Ezra's fate** — The Order's enforcer. If not conclusively
   defeated in Session 3, he is still at large and knows the
   investigators' faces. His binding renewal is due November 1st — a
   hard clock. If his powers fade, the Order's teeth come out. If he
   survived Session 3 and the ritual was stopped, he may be injured
   but not dead. *Status: UNVERIFIED.*

3. **The ritual and the pit** — Was the summoning completed? Disrupted?
   Something may have come through partially. The pit beneath the
   ritual chamber is a real presence — investigators who got close lost
   SAN. Whether what was in the pit is now contained, escaped, or
   dormant is the biggest unresolved variable.
   *Status: UNVERIFIED — depends entirely on Session 3's resolution.*

4. **The Order's outer circle** — Approximately 30 members, most of
   them respectable Kingsport men who believe they belong to a
   gentlemen's fraternal organization. If the inner circle is
   disrupted, these men will scatter — unless someone with standing
   (Inspector Crane, or the investigators themselves) moves to expose
   them. *Unchanged since Session 2.*

5. **Inspector Crane's bribery** — Crane has been taking monthly
   payments from the Order to look the other way at the docks. If the
   investigators have evidence of this (the bribe ledger in the lodge
   office, per the Session 3 plan), Crane can be flipped or arrested.
   A hard Persuade roll (modified by evidence) could make him an ally.
   *Status: UNVERIFIED — depends on what investigators found.*

### Warm (Developing)

6. **Dockmaster Hayes** — Identified at Session 2's end as a potential
   witness to regular deliveries at warehouse 7. The investigators
   haven't followed up. He may still have useful information about the
   Order's logistics or personnel. *Stale since Session 2.*

7. **Dr. Philip Hartwell and Judge Marcus Abernethy** — The inner
   circle members the investigators haven't yet encountered. Hartwell
   (physician) procures the Order's chemicals. Abernethy (judge)
   provides legal and political cover. Both remain at large and capable
   of continuing the Order's operations in a reduced form. *Not yet
   encountered.*

8. **The Grand Master's identity** — The Order's true leader has not
   been named in play. The Session 3 plan noted this as a good
   dramatic beat for the final session. If it was revealed, it may
   recontextualize relationships the investigators have had throughout
   the campaign. *Status: UNVERIFIED.*

9. **The stone tablets** — Two tablets in investigators' possession,
   carved with the Strange Symbol and text in an unknown script. They
   haven't been translated. They may be relevant to the pit and what
   inhabits it, or to stopping a future attempt at summoning.
   *No advancement since Session 2.*

### Stale (3+ Sessions Without Advancement)

10. **Tommy Flanagan as active asset** — Tommy was paid $20 in Session 1
    to keep watch and report. No follow-up in Sessions 2 or 3 is
    confirmed. He has not resurfaced. Three sessions without
    advancement. Flag: either use him in Session 4 or retire thread.

---

## NPC Quick Reference

| NPC | Role This Session | Key Detail | Location |
|-----|-------------------|------------|----------|
| [[Professor Ashford]] | Rescued party; unreliable narrator | SAN 15; has seen the pit; may not want to leave the texts behind | Unknown — if rescued, with investigators |
| [[Brother Ezra]] | Threat/antagonist, status uncertain | Binding renewal due Nov 1; weaker if renewal missed; has seen investigators' faces | Unknown — at large or defeated |
| [[Inspector Crane]] | Obstacle or reluctant ally | Takes Order bribes; can be flipped with evidence; genuinely liked Ashford | Kingsport Police Dept |
| [[Mrs Whitmore]] | Civilian at risk | Saw Ezra on Oct 11; could be used as leverage by surviving Order members | Ashford residence |
| [[Tommy Flanagan]] | Stale asset; can be reactivated | Underworld informant; knows Order by name; last paid Session 1 | Red Hook Tavern |
| Dr. Philip Hartwell | Unseen inner circle | Physician; procures ritual chemicals; not yet encountered in play | Unknown in Kingsport |
| Judge Marcus Abernethy | Unseen inner circle | Legal protection for the Order; not yet encountered | Unknown in Kingsport |

---

## World State

**In-game date:** October 18–20, 1923. The new moon — the ritual
deadline — is October 20. If Session 3 ended with the ritual
disrupted, this date may have passed harmlessly. If the ritual was
only partially stopped, the clock is still running.

**Location:** Kingsport, Massachusetts. The investigators likely
emerged from St. Anselm's Church and are now somewhere in the town.
If they rescued Ashford, he needs immediate shelter, food, and
probably medical attention.

**The Order of the Silver Twilight:** Inner circle potentially broken
or scattered. Outer circle ignorant and intact. The lodge on Harmon
Street is still standing. Hartwell and Abernethy are loose ends.
The Grand Master's fate is unverified.

**Active threats:**
- Brother Ezra (if alive) knows the investigators and will act
- Surviving inner circle members may attempt retaliation or cover-up
- The stone tablets and the pit-thing are unexplained dangerous
  objects

**Faction posture:** The Order is on its back foot if the inner sanctum
was disrupted. Whether it can reconstitute depends on whether the
Grand Master survived and whether the investigators pursue the loose
ends.

**Ticking clocks:**
- October 20 — new moon ritual deadline (may already be resolved)
- November 1 — Brother Ezra's binding renewal deadline
- Ongoing — Ashford's mental deterioration will not reverse on its
  own; he needs medical care and probably distance from Kingsport

---

## PC Roster & Arcs

This is an Establishment/Testing phase campaign — three sessions in,
all PCs are partway through Stage 1 (Establishment) transitioning to
Stage 2 (Testing).

### Dr. Eleanor Voss (Sarah)

**Occupation:** Physician  
**Arc Theme:** Rationalism vs. the impossible  
**Arc Stage:** Late Stage 1 → Stage 2 boundary  
**Arc progress:** Session 1 established her rational medical identity.
Session 2 pushed hard against it — she saw Ezra's inhuman eyes and
lost 3 SAN to something she cannot explain away. The encounter
cracked her framework but didn't break it. She is still fighting
to find an explanation that doesn't require the supernatural to be
real.

**Session 2 carry-forward:**
- Lost 3 SAN (current SAN: 52). Witnessed Ezra's inhuman features.
- Treated Ashford for insomnia before his disappearance — she has a
  personal connection to his deterioration.
- Knows [[Inspector Crane]] from a previous coroner's case.

**Next arc beat:** The Stage 2 testing question is: can she hold her
rational worldview after being inside the inner sanctum? If she entered
the ritual chamber and approached the pit, that's her Stage 2
inflection point. Session 4's aftermath is where the consequences of
that crack settle.

**A/B/C assignment:** **B-plot** this session. Her rationalism vs.
reality arc should be centered. She is the investigator most overdue
for personal arc focus — she took the hardest SAN hit in Session 2 and
her internal crisis has been building without resolution.

---

### Malcolm "Mal" Bridges (Tom)

**Occupation:** Private Investigator  
**Arc Theme:** Evidence-based trust vs. conspiracy beyond evidence  
**Arc Stage:** Stage 1, established  
**Arc progress:** Session 1 set up his methodical, cynical Pinkerton
persona. Session 2 gave him a physical wound (minor) and deepened his
suspicion of Crane. He's been the group's engine of investigation —
competent, grounded, useful.

**Session 2 carry-forward:**
- Minor wound (right arm bruise) — likely healed by Session 4.
- Suspicious of Crane's slow progress. Has contacts in Kingsport
  underworld.
- Knows [[Tommy Flanagan]].

**Next arc beat:** Mal is due for a moral complication. His arc theme
(evidence vs. conspiracy beyond evidence) will crystallize when he
must decide what to do with what he knows. Does he go to the
authorities with the evidence against Crane? Does he trust a
system he's increasingly certain is bought? This hasn't fully
surfaced yet. Session 4 is a good place for a Decision Callback.

**A/B/C assignment:** **C-plot** this session. A brief arc beat —
probably the Crane confrontation, where his evidence-driven instincts
are tested.

---

### Reverend Silas Marsh (Jamie)

**Occupation:** Clergy (Episcopal)  
**Arc Theme:** Faith under siege by the genuine supernatural  
**Arc Stage:** Stage 2 (Testing), early  
**Arc progress:** Session 1 established his faith and his friendship
with Ashford. Session 2's stone tablets gave him 1 Cthulhu Mythos and
cost him 1 SAN — more unsettling because his framework (faith) has
more to offer the Mythos than Eleanor's rationalism does. He is
"increasingly convinced that something genuinely supernatural is at
work" — which for a man of the church is a complicated feeling.

**Session 2 carry-forward:**
- Gained 1 Cthulhu Mythos. Lost 1 SAN.
- Knows church history — knew about rumors of older structures beneath
  local churches, which likely helped identify St. Anselm's.
- His faith is being tested by what he's encountering.

**Next arc beat:** Silas is Stage 2 (Testing) and his arc engine is
the tension between his faith and the reality of Mythos. Session 4's
aftermath — whatever happened in the chambers, what Ashford says when
he can speak, the pit and what was in it — is prime material for his
arc. But he had significant arc work in Sessions 2-3. He's not
neglected. Let Eleanor's crisis take center stage this session.

**A/B/C assignment:** Part of A-plot. Gets a Character Moment (see
Touchpoint Plan) connecting his faith crisis to the aftermath. Not a
featured session for him — that's coming once Eleanor's arc clears.

---

## Touchpoint Plan

**Coverage check:** Three PCs, three sessions in. Eleanor is the
B-plot this session. Mal gets a C-plot Decision Callback. Silas
gets an A-plot Character Moment. All three PCs covered.

| PC | Type | Description | Scene | Impact |
|----|------|-------------|-------|--------|
| Dr. Eleanor Voss | Moral Dilemma (High) | The investigators have the stone tablets — objects that clearly contain genuine Mythos knowledge. As a physician, Eleanor can see that Ashford's deterioration correlates directly with his exposure to such texts. Destroy them? Lock them away? Study them? The "right" choice isn't obvious. | Scene 2: Aftermath & Ashford's Account | B-plot centerpiece |
| Dr. Eleanor Voss | Decision Callback (Medium) | Ashford is the patient she noticed deteriorating before his disappearance. She treated him for insomnia. Now she sees the end state of that trajectory. What does she owe him as a doctor, and what can she actually do for him? | Scene 1: Emerging from the Sanctum | Reinforces B-plot |
| Mal Bridges | Decision Callback (Medium) | Confronting Crane with the bribe evidence (if found in the lodge or sanctum). This is the payoff for three sessions of Crane being a useless obstacle. Mal's suspicion has been building — now he has to decide what to do with proof. Does he threaten Crane into action, report him, or use him? | Scene 3: The Crane Reckoning | C-plot beat |
| Rev. Silas Marsh | Character Moment (Low-Med) | After everything — the sanctum, the pit, Ashford — Silas finds a moment alone (or with the others) to grapple with what he's witnessed. As a priest, he understands ritual; he's now seen ritual that works, that opens something real. A quiet scene, no pressure. A chance for Jamie to play the interior crisis. | Scene 4: Quiet in the Gray Dawn | A-plot texture |
| Rev. Silas Marsh | Ability Showcase (Medium) | The stone tablets. Silas has Occult 45% and History 55%. If the tablets connect to church history or religious tradition, he's the one who might recognize the connection. Even partial recognition advances the lore and gives him a meaningful contribution. | Scene 2: Aftermath & Ashford's Account | A-plot |

---

**Scene approval required before writing full scenes.** Here are the
four proposed scenes — approve, tweak, or reject each before I expand
them.

---

## Scene Proposals — Awaiting GM Approval

### Scene 1 Proposal: "Emerging from the Sanctum"

**Summary:** The investigators have come through whatever happened in
the inner sanctum. This is the transition from crisis to aftermath —
getting out with Ashford (or without him), taking stock of injuries
and sanity, and the first breath of outside air after the chambers.

**Type:** Transitional / character  
**Dramatic objective:** Re-establish the investigators' physical and
psychological state. Deliver Eleanor's Decision Callback (Ashford as
her patient, now reduced to this). Confirm the immediate threat level
(is Ezra dead? Is the ritual stopped?).  
**Key entities:** [[Professor Ashford]], [[St Anselms Church]],
[[Brother Ezra]] (status unknown)  
**PC touchpoints:** Eleanor (Decision Callback), all PCs (shared
experience, witnesses to each other's states)  
**Branching:** If Ashford was not rescued, this scene is a grim exit
with loose ends. If rescued, his first coherent words can seed the
session's remaining mysteries.

*Awaiting approval.*

---

### Scene 2 Proposal: "Ashford Speaks"

**Summary:** Ashford, stabilized enough to communicate (Eleanor's
medical attention helps), begins to describe what he knows — the pit,
what he translated, what the Order intended, and the dangerous
knowledge now in his head. The stone tablets may be examined here.

**Type:** Investigation / social  
**Dramatic objective:** Deliver exposition while making it
emotionally costly. Center Eleanor's B-plot (moral dilemma: what do
you do with a man whose knowledge is destroying him?). Give Silas
his Ability Showcase on the tablets. Establish what loose ends
remain.  
**Key entities:** [[Professor Ashford]], the stone tablets,
potentially [[Strange Symbol]] context  
**PC touchpoints:** Eleanor (Moral Dilemma), Silas (Ability Showcase)  
**Branching:** If Ashford is coherent: rich exposition scene. If he's
too far gone: the investigators must piece together partial fragments,
raising the cost. Either way, they learn something that demands action.

*Awaiting approval.*

---

### Scene 3 Proposal: "The Crane Reckoning"

**Summary:** The investigators confront [[Inspector Crane]] with what
they know — the inner sanctum, the cult, and if they have it, evidence
of his bribery. This is three sessions of obstacle payoff. Crane
can be broken (confession, becomes an ally), blackmailed (he uses his
position to help clean up the Order in exchange for silence), or
arrested (investigators go over his head).

**Type:** Social / confrontation  
**Dramatic objective:** Resolve the Crane subplot. Deliver Mal's
Decision Callback arc beat. Give the investigators meaningful agency
over how the aftermath is handled — this is the public/institutional
layer of the resolution.  
**Key entities:** [[Inspector Crane]], evidence from the sanctum (if
held)  
**PC touchpoints:** Mal (Decision Callback)  
**Branching:**
- Crane folds (Persuade success, especially with bribe evidence):
  becomes reluctant ally; files a report; may testify
- Crane stonewalls: investigators escalate to state police or go
  public — takes 24-48 hours but works; Crane becomes a loose end
- Crane is sympathetic without proof: offers limited help, buys time
- Grand reveal: if Crane himself is somehow more involved than just
  bribery, this scene cracks open further

*Awaiting approval.*

---

### Scene 4 Proposal: "Quiet in the Gray Dawn"

**Summary:** A short character scene before the investigators separate
or before the institutional aftermath kicks in. The sun is coming up.
Silas has a moment — with the others present, or stepping away briefly
— to put words to what he's experienced. Not a tidy resolution, just
a breath. An open interaction window for all three players.

**Type:** Character moment  
**Dramatic objective:** Pacing variety after the tension. Let players
reflect in-character. Give Jamie space to play Silas's faith crisis
without plot pressure. Set the emotional tone for how the campaign
ends (or transitions if this isn't the final session).  
**Key entities:** The investigators, maybe [[Mrs Whitmore]] if she's
been brought in  
**PC touchpoints:** Silas (Character Moment), opportunity for
Eleanor and Mal to react/support  
**Branching:** Entirely player-driven. No "right" answer. The scene
ends when the players move on.

*Awaiting approval.*

---

## Contingency Scenes

### The Ritual Carried Over
**Trigger:** If Session 3 ended without resolving the ritual — the
investigators are still in the sanctum, the new moon is October 20,
and time is running out.

In this case, discard Scenes 1-4 above and run the Session 3 Plan's
Act 3 first. Return to this plan for the aftermath after resolution.

**Key entities:** [[Brother Ezra]], ritual chamber, the pit  
**Structure:** This session becomes the climax session, not the
aftermath session. High physical and SAN stakes. At least three
resolution paths remain viable (see Session 3 Plan: Contingencies).

### Hartwell and Abernethy Retaliate
**Trigger:** If the investigators expose the Order publicly or move
against Crane, the two remaining inner circle members (Dr. Hartwell,
Judge Abernethy) move to suppress evidence or threaten witnesses.
**Key entities:** Dr. Philip Hartwell (not yet statted), Judge Marcus
Abernethy (not yet statted)  
**Structure:** A pressure scene — someone threatens Mrs. Whitmore,
or evidence goes missing, or a legal injunction appears. Forces the
investigators to act before the institutional machinery buries
everything. Requires creating vault files for Hartwell and Abernethy
if used (see Gaps & Actions).

### Tommy Flanagan Surfaces
**Trigger:** If investigators return to Kingsport's underworld or the
Red Hook Tavern. Tommy was paid in Session 1 to watch and report.
Three sessions later, he has something. This thread is stale — either
use it here or retire it.
**Potential information:** Tommy saw who collected the crates after
the dock chase. He has a name or a face connected to the Order's
logistics that the investigators don't have yet.

---

## Spotlight Forecast

Three-PC party. Target: roughly equal over the arc; no PC below 15%
this session.

| PC | Estimated Share | Notes |
|----|-----------------|-------|
| Dr. Eleanor Voss | ~40% | B-plot session. Two touchpoints. Ashford is her patient; the moral dilemma is hers to navigate. This is intentionally high. |
| Mal Bridges | ~35% | C-plot + strong A-plot contribution. Crane confrontation is his beat. He's the group's investigative engine. |
| Rev. Silas Marsh | ~25% | A-plot texture + two touchpoints. Character Moment gives Jamie meaningful screen time. No sustained imbalance — he had arc focus in Session 2. |

**Imbalance check:** No PC below 15%. No sustained imbalance (all three
have had B-plot focus across Sessions 1-3, roughly balanced). Eleanor
has been building to this featured session since Session 2's SAN loss.
No corrective action required beyond this assignment.

---

## Planned Scenes

*[Will be written here after GM scene approval. Proposals are above.
Each approved scene will be expanded with full read-aloud, setup,
NPC motivations, complications, resolution paths, and mechanical
notes.]*

---

## Session End Objectives

Not a railroad — possible good stopping points:

- **Strong ending:** Ashford is safe. Crane is confronted. The
  investigators know the Order's remaining loose ends (Hartwell,
  Abernethy, possibly the Grand Master). They face a choice: pursue,
  or let Kingsport have its secrets. A cliffhanger is optional but
  available if the Grand Master is still at large.

- **Alternate stopping point:** The Crane confrontation resolves but
  Ashford's fate and the stone tablets are open. A good mid-session
  break or session end if pace runs slow.

- **Minimum viable progress:** Ashford is out of the sanctum. The
  ritual is confirmed stopped (or a clock is set for the next attempt).
  The investigators understand the stakes for what comes next.

---

## Audit Notes

**Agency check (proposed scenes):**

- Scene 1: No PC actions assumed. "The investigators have come
  through" — conditional on Session 3 outcome, not predetermined.
  Ashford's first words are a GM offer, not a dictated PC response.
  **Pass.**

- Scene 2: Ashford speaks, players choose how to respond, whether
  to study the tablets, what to do with the knowledge. The Moral
  Dilemma has no right answer. **Pass.**

- Scene 3: Crane's response depends on what evidence the investigators
  bring and what roll they make. Three distinct outcomes all leave
  agency with players. **Pass.**

- Scene 4: Entirely player-driven. No PC action assumed. **Pass.**

**Canon check:**

- Hartwell and Abernethy are named in the [[Order of the Silver
  Twilight]] vault file — canon-grounded. Their actions in the
  contingency scene are consistent with their established roles.
- "The Grand Master's identity" — marked as unverified because it
  was flagged as a Session 3 revelation that may or may not have
  happened. The plan does not assert a specific identity as fact.
- Ezra's November 1 binding deadline — sourced from his vault file.
  **Canon-grounded.**
- All SAN figures drawn from PC roster and NPC files as of Session 2.
  **Canon-grounded.**

**Unverified assumptions flagged throughout:**
- Session 3 outcome is entirely UNVERIFIED. Every reference to "what
  happened in the sanctum" is explicitly flagged.
- Ashford's survival and rescue are assumed but unverified.
- Crane bribery evidence assumes investigators found the lodge ledger
  (per Session 3 Plan, Act 1) — also unverified.

---

## Gaps & Actions

**Missing vault files needed for this session:**

1. **Dr. Philip Hartwell** — Inner circle member, no vault file. Needed
   if Hartwell appears in the contingency scene. Action: create NPC
   stub with role, occupation, connection to Order. Hand off to
   `campaign-organizer`.

2. **Judge Marcus Abernethy** — Inner circle member, no vault file.
   Same as above. Action: create NPC stub. Hand off to
   `campaign-organizer`.

3. **The Grand Master** — Identity not yet named in play. If Session 3
   revealed an identity, a vault file update is needed for the NPC
   revealed as Grand Master. Action: confirm with GM whether this
   was revealed; update vault accordingly.

4. **Session 04 index file** — No `Session 04 - [Title].md` exists.
   Action: create session index hub with `status: planned`. Needs a
   session title (suggested: "The Morning After" or "The Reckoning" or
   "The Cost of Knowing" — GM to choose).

5. **Session 03 Wrap-Up** — Session 3 was played (assumed) but not
   wrapped. This is the most significant structural gap. The vault
   is frozen at pre-Session-3 state. Recommend running session-wrapup
   for Session 3 before this prep is finalized. Without it, this Plan
   file's `source_confidence` must remain DRAFT.

**Stale entity files:**

- [[St Anselms Church]] — `source_confidence: DRAFT`. Needs promotion
  to AUTHORITATIVE after session-wrapup confirms it as a played
  location.
- [[Coded Letter]] — Status `decoded` and file is complete. No action
  needed.
- [[Strange Symbol]] — Not read in detail for this prep; may need
  updating if the inner sanctum visit added new information.
  Flag for review after Session 3 wrap-up.

---

## Handoff

Based on the Gaps & Actions above:

- **Two new NPC stubs (Hartwell, Abernethy)** — hand off to
  `campaign-organizer` for vault file creation and wiki-linking.

- **Session 3 wrap-up (highest priority)** — hand off to
  `session-wrapup`. The vault needs to reflect what actually
  happened before this Session 4 plan is finalized. This prep document
  is a working draft; it becomes authoritative prep only after
  Session 3 is processed.

- **Session 04 index creation** — hand off to `campaign-organizer`
  after the GM chooses a session title.

- **Scene expansion (Scenes 1-4)** — awaiting GM approval on the
  proposals above. Once approved, full scene write-outs with
  read-aloud text, NPC motivations, mechanical notes, and resolution
  paths can be written here or in `ttrpg-expert`.

---

*Plan file status: `source_confidence: DRAFT` — bridge document built
from Session 2 Wrap-Up (AUTHORITATIVE) and Session 3 Plan (DRAFT).
To be finalized after Session 3 Wrap-Up is completed and GM approves
the four proposed scenes.*

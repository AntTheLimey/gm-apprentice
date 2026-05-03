---
query: "Run session prep for Session 4 of my campaign"
system: workflow
type: session-prep
total_tokens: 0
wall_clock_ms: 0
files_loaded:
  - skills/session-prep/SKILL.md
  - skills/session-prep/references/session-templates.md
  - skills/ttrpg-expert/arc-spotlight-reference.md
  - skills/ttrpg-expert/continuity-engine.md
  - skills/shared/session-principles.md
  - tests/benchmark-campaign/_meta/index.md
  - tests/benchmark-campaign/_Campaign/Player Characters.md
  - tests/benchmark-campaign/_Campaign/Timeline.md
  - tests/benchmark-campaign/Chapters/Chapter 1/chapter-overview.md
  - tests/benchmark-campaign/Chapters/Chapter 1/Sessions/Session 01 - The Missing Professor.md
  - tests/benchmark-campaign/Chapters/Chapter 1/Sessions/Session 01 - The Missing Professor - Wrap-Up.md
  - tests/benchmark-campaign/Chapters/Chapter 1/Sessions/Session 02 - The Docks at Night.md
  - tests/benchmark-campaign/Chapters/Chapter 1/Sessions/Session 02 - The Docks at Night - Wrap-Up.md
  - tests/benchmark-campaign/Chapters/Chapter 1/Sessions/Session 03 - The Inner Sanctum.md
  - tests/benchmark-campaign/Chapters/Chapter 1/Sessions/Session 03 - The Inner Sanctum - Plan.md
  - tests/benchmark-campaign/NPCs/Brother_Ezra.md
  - tests/benchmark-campaign/NPCs/Professor_Ashford.md
  - tests/benchmark-campaign/NPCs/Inspector_Crane.md
  - tests/benchmark-campaign/NPCs/Mrs_Whitmore.md
  - tests/benchmark-campaign/NPCs/Tommy_Flanagan.md
  - tests/benchmark-campaign/Factions/Order_of_the_Silver_Twilight.md
  - tests/benchmark-campaign/Locations/St_Anselms_Church.md
  - tests/benchmark-campaign/Clues/Coded_Letter.md
---

# Session 4 Prep — The Ashford Case

---

## Version Check

Campaign: *The Ashford Case* — Call of Cthulhu 7th Edition, Kingsport 1923.
Vault path: `tests/benchmark-campaign/`. Three PCs active (Dr. Voss, Mal Bridges, Rev. Marsh).

---

## ⚠ Missing Wrap-Up: Session 3

The vault shows Session 3 (*The Inner Sanctum*) with status `prepped` — a Plan file exists but there are no Play Notes and no Wrap-Up file. This means the session either:

1. Was played but no wrap-up has been written yet, or
2. Has not been run yet and you are jumping ahead.

**Recommended:** If Session 3 was played, do a full wrap-up first (use `session-wrapup`). This will update entity files, create canon entries, establish NPC status after the confrontation, and give us accurate carry-forward. Session 4 prep built on unrecorded Session 3 events will contain gaps.

**Quick path if you want to proceed anyway:** I can generate Session 4 prep based on the Session 3 Plan as a "what was intended to happen" baseline, flagging all claims as UNVERIFIED until a proper wrap-up is written. This is the approach used below.

---

## Prior Prep Review

No Session 4 Plan file exists. Starting fresh.

Session 3 Plan reviewed. It covered:
- Lodge visit (red herring) → discovery that the inner sanctum is beneath St Anselm's
- Descent into the crypt and inner sanctum
- Confrontation with Brother Ezra + 4-6 cultists
- Professor Ashford's rescue (prisoner in the cell adjacent to the library)
- Climactic choice: disrupt the ritual or flee

This prep is superseded by what actually happened in Session 3. **All content below assumes the Session 3 plan resolved broadly as written (sanctum reached, Ashford alive, Ezra confronted, ritual disrupted or interrupted) but flags every post-Session-3 claim as UNVERIFIED.** If actual play diverged significantly — Ashford died, Ezra was killed, the ritual completed — revise accordingly before running.

→ **[UNVERIFIED status applies to all Session 4 content until a Session 3 Wrap-Up is written.]**

---

## Previously On...

*The following recap is reconstructed from the Session 3 Plan, not from a Wrap-Up. It represents what was prepared, not necessarily what happened. Replace with your actual recap once the wrap-up is written.*

---

Three investigators — Dr. Eleanor Voss, Malcolm "Mal" Bridges, and Reverend Silas Marsh — came to Kingsport chasing the disappearance of Professor Henry Ashford, an antiquarian at Miskatonic University. The coded letter hidden in his ransacked study led them to the fog-shrouded docks, where they survived a terrifying chase through the waterfront by Brother Ezra — a gaunt, inhuman enforcer of the Order of the Silver Twilight.

Armed with the decoded letter and two stone tablets carved with eldritch symbols, the investigators traced Ashford to St Anselm's Church in the old quarter. Beneath the deconsecrated nave and through a false wall in the ossuary crypt, they found the inner sanctum — ancient stone chambers older than the church, colder than the autumn air, and lit by torchlight that threw the wrong shadows.

They found Ashford alive in a cell adjoining the forbidden library. His mind is fragile from weeks of forced translation and proximity to the Revelations of Glaaki. The ritual chamber below — a circular room with geometric silver inlay and a pit descending into absolute darkness — held Brother Ezra and the assembled cultists. The new moon was approaching. What happened next is yours to record.

---

## Active Threads

**Primary:**
1. **The Ritual / What Came Through the Pit** *(Immediate)* — The Order's summoning was scheduled for October 20 (new moon). Was it stopped, disrupted, or completed? UNVERIFIED. If disrupted: the entity may have been partially summoned, or the ritual components may have been scattered but not destroyed. If completed: something is now loose in Kingsport — or was the pit sealed? This is the most urgent thread for Session 4.

2. **Professor Ashford's Condition** *(Immediate)* — UNVERIFIED. If rescued: Ashford is physically intact but his SAN was ~15 at last count. Extended exposure to the Revelations of Glaaki will have cost him more. He is a man holding himself together with the thinnest thread. His care and testimony carry forward. If not rescued: this thread is unresolved and demands Session 4 focus.

3. **Brother Ezra's Fate** *(Immediate/Ongoing)* — UNVERIFIED. Three outcomes possible: (a) defeated/contained, (b) escaped, (c) dead. Note from vault: Ezra's binding ritual requires annual renewal — next due November 1. If alive, his powers begin fading soon. If he escaped, he is wounded and seeking the Order's surviving inner circle. Either way, his status shapes Session 4 directly.

4. **Order of the Silver Twilight — Aftermath** *(Short-term)* — UNVERIFIED. The inner circle (Grand Master, Dr. Philip Hartwell, Judge Marcus Abernethy — neither encountered in play) have not been identified or confronted. The outer circle of 25+ unwitting members still exists. The Order is damaged but not destroyed.

5. **Inspector Crane's Complicity** *(Short-term)* — Introduced Session 1, unresolved through Session 2. Crane has been paid to ignore dock activity. The investigators have reason to suspect him but no proof. With the cult's activities now exposed (assuming the sanctum was breached), Crane's position is precarious. Does he cover his tracks or can he be turned?

**Secondary / Background:**
6. **Tommy Flanagan's Debt** *(Background, watch)* — Tommy's debt to Rourke ($150) puts him at risk of selling out the investigators. He was holding back information (Ezra's movements in the old quarter, the wrong-shaped thing he saw). If he hasn't been paid properly or feels endangered, he is a liability. Last advanced: Session 1.

7. **The Stone Tablets and the Revelations of Glaaki** *(Background)* — Two tablets are in the investigators' possession. The complete Revelations of Glaaki is/was in the sanctum library. These items carry Mythos knowledge — dangerous to possess, dangerous to destroy, dangerous to submit for academic study without careful handling.

8. **What Ashford Saw in the Pit** *(Long-term)* — Ashford's journal notes reference "what they intend to summon will not be confined to the angles between." He was forced to look into the pit. He has seen something. He hasn't told anyone. Extracting this knowledge without breaking him further is a challenge for the investigators — and for the GM.

**Stale thread check:** No thread has gone 3+ sessions without advancement. Tommy Flanagan (Sessions 1-2) is approaching that threshold — bring him forward in Session 4 if possible.

---

## NPC Quick Reference

*Status marked UNVERIFIED where Session 3 outcome unknown.*

| NPC | Role This Session | Key Detail | Status |
|-----|-------------------|------------|--------|
| [[Professor Ashford]] | Rescue subject / fragile witness | SAN ~15 or lower; knows what's in the pit; will not volunteer this | UNVERIFIED — assumed rescued, but fragile |
| [[Brother Ezra]] | Primary threat (if escaped) / resolved threat (if defeated) | Binding renewal due Nov 1; weakening if alive | UNVERIFIED — see options above |
| [[Inspector Crane]] | Obstacle / potential ally | Bribed by the Order; file of ignored dock incidents in his desk; can be turned with overwhelming evidence + Persuade | Active |
| [[Mrs Whitmore]] | Emotional anchor; potential witness | Silver medallion with Strange Symbol still in her possession; recognized Ezra's voice; key to Ashford's house | Active |
| [[Tommy Flanagan]] | Informant / potential liability | Gambling debt to Rourke ($150); held back information; nightmare about wrong-shaped thing in the old quarter | Active |
| Dr. Philip Hartwell | Inner circle — not yet encountered | Physician; procures ritual chemicals; vault file: unnamed, no stat block — NEEDS CREATION if featured | Not yet encountered |
| Judge Marcus Abernethy | Inner circle — not yet encountered | Provides legal cover; political connections; vault file: unnamed — NEEDS CREATION if featured | Not yet encountered |
| The Grand Master | Unseen architect — not yet identified | Identity unrevealed; good candidates: university chancellor, the mayor, or someone the investigators trusted; vault file: absent — NEEDS CREATION | Not yet encountered |

---

## World State

**In-game date:** October 20, 1923 (new moon) — or shortly after.
**Location:** Kingsport, Massachusetts.
**Weather/Atmosphere:** Late October in New England. Autumn fog. Shorter days.

**Active Threats:**
- The ritual's aftermath (unknown — was the gate opened? partially? sealed?)
- Brother Ezra (UNVERIFIED status — escaped / wounded / defeated)
- The Order's surviving inner circle — Grand Master, Hartwell, Abernethy — unidentified and at large
- Any entity partially manifested through the pit

**Faction Status:**
- Order of the Silver Twilight: Damaged. Inner sanctum likely known to authorities or about to be (depending on whether the investigators involved police). Outer circle likely panicking or unaware.
- Kingsport Police: Crane assigned to the Ashford case; complicit through inaction; desk sergeant sympathetic but limited authority.

**Clocks:**
- Brother Ezra's binding renewal: **November 1** — 11 days from now. If alive and unfound, his powers degrade, making him more desperate.
- Ritual gate (if partially opened): Unknown urgency — a GM decision about what slipped through or was sealed.

**Resources in investigators' hands:**
- Two stone tablets with Mythos script
- Decoded Coded Letter
- Ashford himself (UNVERIFIED)
- Knowledge of the inner sanctum's location

---

## PC Roster & Arcs

*Arc stages use the Five-Stage Model (arc-spotlight-reference.md). This is Session 4 of the campaign.*

### Dr. Eleanor Voss
- **Arc Theme:** Rationalism confronting the irrational — "the world is not what I thought it was"
- **Arc Stage:** Stage 2 (Testing) → approaching Stage 3 (Crisis)
- **Arc Status:** Her rational worldview has been steadily eroded. Session 1: no SAN loss (grounded). Session 2: lost 3 SAN witnessing Ezra's inhuman features — the cracks appeared. Session 3 (UNVERIFIED): if she witnessed the pit or something from it, she may be at a personal breaking point. SAN 52 before Session 3; likely lower now.
- **Backstory Hook:** She knew Ashford as a patient (treated insomnia). His state now — broken, fragile, changed — will be personal for her in a way it isn't for the others.
- **Next Beat:** A moment where her medical training directly serves the investigation (treating Ashford, recognizing symptoms others dismiss) combined with a confrontation with something that cannot be explained away. She is overdue for a defining crisis moment that forces a choice: maintain professional detachment or acknowledge the Mythos is real.
- **Spotlight History:** B-plot never formally assigned. Has had organic spotlight in Sessions 1-2. Sessions since high-impact touchpoint: needs to be addressed in Session 4.
- **A/B/C Assignment:** **B-plot candidate** — her connection to Ashford and her eroding rationalism make her the natural featured PC for the aftermath session.

### Malcolm "Mal" Bridges
- **Arc Theme:** The cynical professional learning that some cases change you — "evidence leads somewhere you don't want to go"
- **Arc Stage:** Stage 2 (Testing)
- **Arc Status:** Mal is holding it together through professional discipline. He trusts evidence and method. The problem is the evidence now points at something methodically terrifying. He has a personal stake (hired by Ashford's sister — what does he tell her?). His contacts with Tommy Flanagan and the Kingsport underworld give him agency the others lack.
- **Backstory Hook:** Ashford's sister hired him. She is expecting a report. Delivering it — or deciding what to omit — is an arc beat due.
- **Next Beat:** A decision about what truth means when the truth is this: a callback to his professional identity as someone who delivers facts even when they're ugly. What does he tell Ashford's sister? What does he put in his notebook?
- **Spotlight History:** Drove Session 1 and had strong moments in Session 2 (the DEX check vault, the Stealth failure that triggered the chase). Has not had a purely personal scene. C-plot candidate — a brief scene or written note to/from Ashford's sister would serve his arc.
- **A/B/C Assignment:** **C-plot candidate** for Session 4 — a Decision Callback moment related to his client relationship.

### Reverend Silas Marsh
- **Arc Theme:** Faith tested by genuine cosmic horror — "what does prayer mean when you've heard what's in the pit"
- **Arc Stage:** Stage 2 (Testing) → possible Stage 3 inflection
- **Arc Status:** His faith is under systematic assault from the evidence of the case. He came in believing in evil as a theological category. He is now confronting evil as a material, physically present entity. He gained 1 Cthulhu Mythos from the stone tablets (Session 2) — that knowledge is now part of him. His Occult skill is now an active liability as well as an asset: he understands more than he wants to.
- **Backstory Hook:** He knows the history of local churches, including underground structures. He had the keys to this mystery before the investigators did — and that means he will feel responsible for whatever happened or whatever comes through.
- **Next Beat:** A moment of spiritual reckoning in the aftermath — does prayer hold any meaning after the pit? Does his knowledge of church history offer a solution (sealing the breach, consecrating the space) or only deepen the horror?
- **Spotlight History:** Strong Session 2 moment (decoding the letter via Library Use). Established as the team's occult anchor. Arc has not had a genuine crisis moment yet.
- **A/B/C Assignment:** **A-plot integrated** — his theological confrontation runs through the main plot of the aftermath. Can serve as B-plot support if Dr. Voss takes the B-plot feature.

---

## Touchpoint Plan

**Coverage requirement:** Every PC must have at least one assigned touchpoint.

### Dr. Eleanor Voss (B-plot — featured PC)
- **Touchpoint 1: Backstory Connection (High Impact)** — Ashford is alive and in her care. He was her patient. She knows his baseline health, his voice when it was steady. Seeing him now — SAN 15 or below, muttering about the angles between — is a direct, personal confrontation with what the case cost. *Scene: Voss alone with Ashford in a quiet moment (at Mrs Whitmore's house or a hospital room), trying to make a medical assessment while he tells her fragments of what he saw in the pit. She has to decide how much to document.*
- **Touchpoint 2: Moral Dilemma (High Impact)** — The Revelations of Glaaki and/or the stone tablets: the rational course is to destroy them. But they represent knowledge that could be used to understand — and counter — what the Order nearly summoned. Voss as a physician knows that some knowledge is dangerous to suppress as well as to have. *The dilemma: destroy and be safe, or preserve and study? This decision has no clean answer.*

### Malcolm "Mal" Bridges (C-plot)
- **Touchpoint 1: Decision Callback (Medium Impact)** — Ashford's sister hired him. She's been waiting for news. Mal has delivered bad news before — it's part of the work. But delivering this particular truth (her brother is alive but broken, touched by something that can't be put in a report) pushes against his professional identity. *Scene hook: a telegram or letter arrives from Agatha Ashford (Ashford's sister, not yet in play) asking for an update. What does Mal write back? Does he lie to protect her? Does he tell her enough?* This is brief — a written note, a conversation with one of the other investigators about what to say — but it addresses his arc directly.

### Reverend Silas Marsh (A-plot integrated)
- **Touchpoint 1: Arc Advancement Clue (Medium Impact)** — Marsh's church history knowledge may hold the key to sealing whatever the ritual opened. His diocese has records of St Anselm's — why was it deconsecrated, what do the older records say about the structure, were there earlier incidents? *He could find a reference in the diocesan archive to an 18th-century account of "sounds from below" being reported before the church was abandoned.* This advances his arc (his faith and his knowledge are useful rather than only a burden) and provides a practical path forward.
- **Touchpoint 2: Character Moment (Low-Medium Impact)** — After the climax, Marsh needs a quiet beat. Whether he prays, sits in silence, or says something half-formed to the others about what he believes now — this moment of self-expression grounds his transformation. Embed in a scene where the group is regrouping.

---

## Scene Design

The following scenes are proposed for GM approval. They assume Session 3 ended with: the investigators in or escaping the inner sanctum, the ritual disrupted (but not fully understood), Ashford rescued (fragile), Ezra outcome uncertain. Adjust if your Session 3 diverged.

---

**⚠ Scene approval required.** Under the session-prep workflow, each scene below should be approved, tweaked, or rejected by the GM before being treated as final. Because this is a written prep document, all scenes are included as proposals — mark any you want to change before running.

---

### Scene 1: The Morning After (Social / Character)
**Type:** Social / Character moment
**Dramatic Objective:** Establish the aftermath. Ground the investigators — and the players — in the human cost of Session 3 before the plot threads demand attention.
**Key Entities:** [[Mrs Whitmore]]'s house (or a Kingsport boarding house), [[Professor Ashford]], the three investigators.
**Setup:** The morning after the sanctum. The investigators have gotten Ashford out and are somewhere safe. He is barely coherent. Mrs Whitmore, if she knows they've found the professor, arrives and takes charge in her practical way — making tea, assessing his condition, being quietly devastated at what he has become.
**Touchpoints delivered:** Voss (Backstory Connection — medical assessment of Ashford), Marsh (Character Moment — he can pray, be quiet, say something halting about what he believes), Mal (Decision Callback hook — the telegram from Agatha can arrive here).
**Branching:**
- Do the investigators try to question Ashford immediately or let him rest?
- Does Voss document his condition medically? What does she write?
- Does Marsh ask Ashford anything about what he saw?

---

### Scene 2: What Ashford Knows (Investigation / Horror)
**Type:** Investigation / light horror
**Dramatic Objective:** Extract the crucial information Ashford is holding — what came through (or almost came through) the pit — without breaking him further. Deliver Voss's moral dilemma and the principal plot question for Session 4.
**Key Entities:** [[Professor Ashford]], [[Dr. Eleanor Voss]], the stone tablets, possibly the Revelations of Glaaki (if retrieved from the sanctum).
**Setup:** In a calm moment, Voss (or the group) sits with Ashford and carefully draws out what he knows. He speaks in fragments. He does not want to say it directly. He may write some of it — he is more functional with a pen in hand than speaking aloud. What emerges: the ritual opened the gate only partially. Something was aware of the opening. It may have sent a scout — something small, wrong-shaped (connecting back to Tommy's nightmare from the old quarter). The gate is not sealed; it is merely closed. The Order's inner circle could attempt the ritual again.
**Voss's dilemma:** Ashford wants the Revelations destroyed. But the tablets they already have — and possibly the Revelations, if they brought it out — contain the only countermeasures Marsh could use if another attempt is made. Does she honor his wish or overrule it?
**Branching:**
- PCs destroy the tablets/Revelations → safer psychologically, but removes the countermeasure option.
- PCs retain the materials → Ashford's distress increases; what does this do to Voss?
- PCs contact Miskatonic University for advice → Dr. Wilmarth (their original contact) could be reached; he is out of his depth but knows scholars who might help.

---

### Scene 3: The Crane Confrontation (Social / Consequence)
**Type:** Social / investigation
**Dramatic Objective:** Bring Inspector Crane to account. Give the investigators an opportunity to expose the Order's police corruption and — potentially — gain an unexpected ally. Deliver consequences for their earlier (fruitless) police contacts.
**Key Entities:** [[Inspector Crane]], Kingsport Police Department, the investigators.
**Setup:** The investigators have evidence that cannot be ignored: they have been in the inner sanctum, they have stone tablets, they (may) have a broken professor as a living witness, and they know about the bribed dock inspector. Crane's protection of the Order is the weak link in the Order's remaining power. Confronting him is risky — he is corrupt, but he is not a true believer. He is a weak man, not a villainous one.

**The pitch:** Bring Crane the bribe evidence (or the overwhelming weight of physical evidence from the sanctum) and offer him a choice: lead the raid on the Silver Twilight Lodge, or be exposed to the state police and the press. The vault notes that a hard Persuade roll, modified by presenting the bribe evidence, can turn him.

**The complication:** Crane has been paid by the Order. At least two inner circle members — Judge Abernethy — have political leverage that could bury any complaint Crane makes. If he turns, he turns knowing his career is probably over. That's the ask.

**GM Note:** This scene should not be a slam dunk. Crane is genuinely frightened of what Abernethy and the Grand Master can do to him. He needs to find a small spark of the good cop he used to be. The investigators' Psychology rolls will matter. If Voss is present — Crane is patronizing to her specifically — there is an interesting subtext in her making the decisive appeal.

**Branching:**
- Crane turns → leads or enables a raid on the Lodge; inner circle members scatter or are arrested; the Grand Master may escape
- Crane refuses → investigators go to the state police (24-48 hours); or to the press (faster, messier, less controlled)
- Crane turns hostile → he has a .38 and a nightstick; he is not suicidal, but cornered men act strangely

---

### Scene 4: Tommy Flanagan's Reckoning (Social / Consequence)
**Type:** Social
**Dramatic Objective:** Resolve the Tommy Flanagan thread before it resolves badly on its own. Tommy has information the investigators still need (Brother Ezra's movements, the wrong-shaped thing) and a debt that is making him dangerous.
**Key Entities:** [[Tommy Flanagan]], Rourke (not yet established in vault — stub needed), the Red Hook Tavern.
**Setup:** Tommy is getting nervous. If the investigators haven't contacted him since Session 1, Rourke's patience is expiring. Tommy has been watching the old quarter and knows something happened at St Anselm's — word travels in Kingsport. He wants to get paid and get out of the situation. He is also wrestling with whether to tell anyone about the wrong-shaped thing he saw.

**The information Tommy holds:** He saw Brother Ezra enter the old quarter on multiple nights (useful for establishing Ezra's movements if he is still at large). He saw something carried out of a building wrapped in cloth — the wrong shape, moving slightly. He has nightmares about it. He has never told anyone.

**The arc:** If the investigators treat him fairly, pay him adequately, and take his nightmare seriously (rather than dismissing it), he tells them about the wrong-shaped thing — which becomes a clue about what partially came through the gate. If they ignore him or stiff him, he may sell information about the investigators to the Order's remnants.

**Branching:**
- Pay Tommy generously ($50+, clearing his $150 debt with Rourke as part of the exchange) → he shares everything, potentially includes a map of where he saw the wrong-shaped thing carried
- Pay Tommy minimally → he gives partial information, holds back the nightmare detail
- Ignore Tommy → he approaches the Order remnants; becomes a threat

---

### Scene 5: The Lodge (Action / Consequence) — Contingency
**Type:** Action / investigation (contingent on Crane turning in Scene 3)
**Trigger:** Crane cooperates, or investigators decide to raid the Lodge themselves.
**Dramatic Objective:** Bring down the Order's visible face. Expose or capture the Grand Master.
**Key Entities:** Silver Twilight Lodge (42 Harmon Street), unnamed inner circle members, possibly the Grand Master.
**Setup:** The Lodge is a respectable brownstone. In the aftermath of the sanctum breach, the inner circle may have retreated here to regroup, or they may have scattered. A raid — whether police-led or investigator-led — finds the lodge's outer circle in disarray. The inner circle may have fled, or one or two members may still be present. The Grand Master's identity can be revealed here as a dramatic beat: the university chancellor, the mayor, a figure the investigators have met and trusted.

**GM Note:** Keep the Grand Master's identity as someone the investigators have interacted with. Best candidate from the vault: Dr. Wilmarth, the colleague who hired them (the man who sent them into harm's way — that betrayal lands harder than a stranger), or an authority figure who appeared briefly. The reveal should feel earned, not random.

**Branching:**
- Grand Master present and captured → confrontation scene, confession (or denial)
- Grand Master absent → evidence trail, documents, accounting ledgers showing the money flows; a lead to his identity
- Inner circle members resist → brief combat, Hartwell (the physician) is non-combatant; Abernethy (the judge) will lawyer up immediately

---

## Contingency Scenes

### Contingency A: Something Is Still Out There
**Trigger:** If the investigators (or Ashford's testimony) establish that something came through the gate partially, and is now loose in Kingsport.
**Setup:** A brief horror scene in which the investigators encounter evidence of the wrong-shaped thing Tommy saw. Not a full combat encounter — a moment of discovery. A body at the docks (wrong angle of the injuries). A witness report of something seen in the old quarter at night. Tommy's nightmare cross-referenced with a recent "animal attack" report Crane has been suppressing.
**Purpose:** Opens the question of whether Session 4 is truly the end of the chapter or whether a second chapter is needed to deal with the aftermath.

### Contingency B: Brother Ezra Returns
**Trigger:** If Ezra escaped from the sanctum encounter and the investigators have not neutralized him.
**Setup:** Ezra, weakening (binding renewal due November 1), makes one more move. He either comes for the investigators directly, goes after Ashford to silence him, or attempts to reach another inner circle member to arrange the renewal ritual. His declining powers make him more dangerous in a different way — more desperate, less calculating.
**Key mechanical note:** His enhanced stats begin degrading as of roughly October 25. By November 1 he is close to normal human capabilities — a credible but no longer supernaturally threatening opponent.

---

## Spotlight Forecast

| PC | Plot Role | Touchpoints Assigned | Estimated Spotlight |
|----|-----------|----------------------|---------------------|
| Dr. Eleanor Voss | B-plot (featured) | Backstory Connection (high), Moral Dilemma (high) | 35-40% |
| Malcolm Bridges | C-plot | Decision Callback (medium) | 20-25% |
| Reverend Marsh | A-plot integrated | Arc Advancement Clue (medium), Character Moment (low-med) | 30-35% |

**Floor check:** All PCs exceed 15% floor. No sustained imbalance flags.
**Imbalance watch:** Mal has not had a purely personal scene across 3+ sessions. The Decision Callback (Scene 1 + telegram hook) is lightweight but keeps his arc alive. If Session 4 runs long and the Crane/Lodge material dominates, Mal will absorb most of the investigative scenes naturally (Spot Hidden, Fast Talk, underworld contacts) — ensure his personal beat gets its moment early in the session rather than being crowded out by plot.

---

## Audit Notes

**Agency Violations — None Found.**
All planned scenes use conditional language for PC actions ("if the investigators question Ashford immediately," "do the investigators try to," "can be turned," "if they ignore him"). No read-aloud text prescribes PC emotions. The Crane confrontation has ≥2 contingencies. Tommy Flanagan scene has 3 outcome branches.

**Canon Violations — Flags:**
1. **Agatha Ashford (Mal's client)** — Named as "Ashford's sister" in the PC roster but no vault file exists. She is referenced as a Decision Callback trigger. She is UNVERIFIED as a named entity — GM should confirm her name before featuring her in play.
2. **Dr. Philip Hartwell, Judge Marcus Abernethy, the Grand Master** — All referenced in the Order of the Silver Twilight faction file as named inner circle members, but none have individual NPC vault files. They are listed but not statted or detailed. If any appear in Session 4, stub files should be created first.
3. **"Wrong-shaped thing" / partial manifestation** — Inferred from Tommy's nightmare (vault file) and Ashford's coded letter ("will not be confined to the angles between"). No entity file exists. This is flagged as UNVERIFIED — GM must decide whether something came through and what it is before featuring this in play.
4. **Rourke (Tommy's creditor)** — Named in Tommy's vault file as a dangerous man. No vault file. Stub needed if he appears.

**UNVERIFIED Status:**
The entire Session 4 prep is built on the Session 3 Plan rather than a Session 3 Wrap-Up. All NPC status (Ashford alive/condition, Ezra fate, ritual outcome) is marked UNVERIFIED. Promoting this prep to AUTHORITATIVE requires writing the Session 3 Wrap-Up first.

---

## Gaps & Actions

| Gap | Type | Action |
|-----|------|--------|
| Session 3 Wrap-Up missing | Critical | Write wrap-up before running Session 4; all UNVERIFIED flags resolve here |
| Agatha Ashford (Mal's client) | NPC stub missing | Create minimal NPC file if she appears in play; confirm name with GM |
| Dr. Philip Hartwell | NPC stub missing | Create NPC file if Lodge scene runs and he is present |
| Judge Marcus Abernethy | NPC stub missing | Create NPC file if Lodge scene runs or Crane confrontation references him |
| The Grand Master | NPC stub missing | Create NPC file before revealing identity in play — decide identity now |
| Rourke (Tommy's creditor) | NPC stub missing | Create minimal stub if Tommy scene runs |
| Partial manifestation entity | Entity missing | GM decision: did something come through the pit? If yes, create entity before running Contingency A |
| Session 04 session index | Session file missing | Create `Session 04 - [Title].md` with `status: planned` once title is chosen |

---

## Handoff Recommendations

- **Session 3 Wrap-Up first** → `session-wrapup` — This is the highest-priority action before any further prep.
- **NPC file creation** (Hartwell, Abernethy, Grand Master, Rourke, Agatha Ashford stub) → `campaign-organizer`
- **Grand Master identity decision** → `ttrpg-expert` if you want to brainstorm the reveal; the Dr. Wilmarth candidate (who hired the investigators) is the most dramatically charged option
- **Partial manifestation entity design** → `ttrpg-expert` for Mythos entity creation consistent with CoC 7e + Glaaki mythology
- **Vault index update** → `campaign-organizer` — `_meta/index.md` needs Session 4 entry and sessions_played updated from 2 to 3 once Session 3 wrap-up is written

---

*Plan written: Session 4 — The Ashford Case. Source confidence: DRAFT. Pending Session 3 Wrap-Up for promotion to AUTHORITATIVE.*

---
query: "Run session prep for Session 4 of my campaign"
system: workflow
type: session-prep
total_tokens: 0
wall_clock_ms: 0
files_loaded:
  - skills/session-prep/SKILL.md
  - skills/session-prep/references/session-templates.md
  - skills/shared/session-principles.md
  - skills/shared/version-check.md
  - skills/shared/migrations.md
  - skills/ttrpg-expert/arc-spotlight-reference.md
  - skills/ttrpg-expert/continuity-engine.md
  - skills/ttrpg-expert/systems/coc-7e/session-procedures.md
  - tests/benchmark-campaign/_meta/index.md
  - tests/benchmark-campaign/_Campaign/Player Characters.md
  - tests/benchmark-campaign/Chapters/Chapter 1/Sessions/Session 01 - The Missing Professor - Wrap-Up.md
  - tests/benchmark-campaign/Chapters/Chapter 1/Sessions/Session 02 - The Docks at Night - Wrap-Up.md
  - tests/benchmark-campaign/Chapters/Chapter 1/Sessions/Session 03 - The Inner Sanctum.md
  - tests/benchmark-campaign/Chapters/Chapter 1/Sessions/Session 03 - The Inner Sanctum - Plan.md
  - tests/benchmark-campaign/NPCs/Brother_Ezra.md
  - tests/benchmark-campaign/NPCs/Professor_Ashford.md
  - tests/benchmark-campaign/NPCs/Inspector_Crane.md
  - tests/benchmark-campaign/Factions/Order_of_the_Silver_Twilight.md
---

# Session Prep — Session 4: The Ashford Case

**Campaign:** The Ashford Case  
**System:** Call of Cthulhu 7th Edition  
**Setting:** Kingsport, Massachusetts, 1923

---

## Version Check

The benchmark vault has no `vault-config.md` with a `gm_apprentice_version` stamp. Current plugin version is 1.4.14. This is a pre-versioning vault — the baseline migration would apply (add the version stamp, verify `_meta/` files). No structural changes are required for this prep to proceed. Migration can run after this session prep if desired; flag it for `campaign-organizer`.

---

## Situation Notice: Session 3 Has No Wrap-Up

Before building Session 4 prep, I need to flag something important.

The vault shows **Session 3 — The Inner Sanctum** with status `prepped`. It has a Plan file, but **no Play Notes and no Wrap-Up file**. The campaign index records `sessions_played: 2`.

This means Session 3 either:
- Has not been played yet, or
- Was played but never wrapped up

**What this means for Session 4 prep:**

Since there is no Wrap-Up for Session 3, the vault is frozen at the post-Session-2 state. The planned Session 3 climax — the sanctum confrontation, [[Professor Ashford]]'s rescue, [[Brother Ezra]]'s final encounter — has not been canonically resolved. We don't know:

- Whether Ashford was rescued or died
- Whether the ritual was disrupted
- The PCs' current SAN, HP, and resource states
- Which threads were resolved vs carried forward
- Whether the Order was exposed, dismantled, or survived

> **Recommendation:** Do a full Wrap-Up for Session 3 first (use `session-wrapup`). This updates entities, creates canon, and gives us solid ground for Session 4.
>
> **Alternative:** If you want a quick start recap and a placeholder prep, I can generate Session 4 prep using two scenarios — one assuming the sanctum was a victory, one assuming it was a partial success or retreat. You'd choose which track fits your table.
>
> **Quick recap only:** If you want, I can also generate a "Previously on..." from the Session 3 Plan notes (raw prep, not played), but this won't update the vault — entities stay frozen, threads stay open, no consequences carry forward.

For this proof-run, I am generating a **complete Session 4 prep assuming the canonical "victory path" for Session 3** (Ashford rescued, ritual disrupted, Order in disarray). The GM should substitute or adjust any section based on actual play.

---

## Phase 1: Reconcile (Conditional)

Session 3 status is `prepped`, not `wrap-up`. **Reconcile is not applicable** — there is no Wrap-Up file to promote. The equivalent step here is a GM decision: what happened in Session 3?

**Assumed outcomes for this prep (confirm or correct):**
- [[Professor Ashford]] was rescued from the sanctum. He is physically alive but mentally fragile (SAN: ~10–15, barely coherent).
- The ritual was disrupted — the geometric patterns were destroyed or the ritual components were scattered. The summoning did not occur.
- [[Brother Ezra]] was driven off or incapacitated but not confirmed dead.
- The investigators escaped the sanctum. One or more took significant SAN loss.
- The Order of the Silver Twilight is exposed to some degree — at minimum the investigators know the full picture.

---

## Prior Prep Review

No prior Session 4 Plan file exists in the vault. Starting from scratch.

Session 3's Plan (`Session 03 - The Inner Sanctum - Plan.md`) is now fully consumed. All planned content from that document is treated as played — the lodge, the descent, the confrontation. The contingency scenes (Dockmaster Hayes providing the church location, prison-break scenario) are archived as prep artifacts and will not carry forward unless they were triggered.

---

## Previously On...

*The following is a reconstructed recap based on what the Session 3 Plan intended to happen. Confirm against actual play before presenting to players.*

Three nights ago, the investigators descended into the hidden sanctum beneath [[St_Anselms_Church]] — the old church in the quarter that [[Professor Ashford]]'s coded letter had pointed toward all along. They found the Silver Twilight Lodge on Harmon Street first, and a search of the office revealed a ledger entry for "preparations at the St. Anselm's site." The church's ossuary held a false wall. Beyond it: stone corridors carved with the [[Strange Symbol]], chambers full of forbidden texts, and at the center of it all, a ritual chamber with a pit that dropped into darkness.

[[Professor Ashford]] was alive — barely. They found him in a cell adjoining the library, his mind fractured from weeks of forced translation work. He recognized the investigators but his eyes were wrong, focused somewhere behind their faces.

[[Brother Ezra]] was there, and the cultists were with him. Whatever happened in the confrontation, the ritual did not complete. The pit did not open. The new moon passed without summoning.

The investigators got out. Ashford got out. The cost was real.

---

## Active Threads

### Primary — Critical Urgency

**Thread: What did Ashford see in the pit?**
- Type: Mystery / Horror
- State: Active
- Introduced: Session 3 Plan (core element of Ashford's character)
- Ashford looked into the pit and has not described what he saw. His SAN is nearly gone. This is the unresolved horror at the center of the story — and it belongs to Session 4.
- Next beat: Ashford regains enough coherence to attempt to speak. What emerges is not what the investigators expect.
- Resolution condition: Ashford communicates, is permanently lost, or the investigators choose not to know.

**Thread: Brother Ezra — alive, retreating, or dead?**
- Type: Faction / Antagonist
- State: Active — Immediate
- Ezra was driven off but not confirmed killed. His binding ritual renewal is due November 1st (three days from the in-game present). If investigators disrupted the renewal, his enhanced abilities begin to fade. If he lives, he is wounded and furious — and the investigators' faces are known to him.
- Next beat: Ezra surfaces in a way that makes clear whether he is diminished or still dangerous.

**Thread: The Order's inner circle — exposed or underground?**
- Type: Faction
- State: Active — This Arc
- The Order's outer circle will scatter once the sanctum is exposed. The inner circle — the Grand Master (identity unrevealed), Dr. Philip Hartwell, Judge Marcus Abernethy — may attempt to contain the damage, flee, or retaliate. None of these inner circle members have been encountered in play.
- Next beat: The investigators learn at least one inner circle identity and must decide what to do about them.
- Chekhov flag: Dr. Hartwell and Judge Abernethy were introduced in the faction file but never appeared in play. If not used in Session 4, they should be explicitly retired or transitioned to a future arc.

**Thread: Inspector Crane — corruption, complicity, or conscience?**
- Type: NPC Loyalty Shift / Subplot
- State: Active — This Arc
- Crane takes bribes from the Order. He is not evil, but he is complicit. The investigators now have overwhelming evidence of the Order's activities. Confronting Crane with the sanctum evidence and the bribery record (if they found the financial connection) is a natural Session 4 beat.
- Resolution condition: Crane turns (allies with investigators, helps with prosecution), doubles down (destroys evidence, becomes hostile), or breaks (resigns, disappears, or worse).
- Last advanced: Session 2 (investigators reported the docks; Crane dismissed them)
- Sessions since last advancement: 2 (Session 3 contact is assumed minimal)

**Thread: The stone tablets**
- Type: Clue / Mystery
- State: Active — Background
- Two stone tablets carved with the Strange Symbol were recovered at the docks in Session 2. They carry text in an unknown script. They have not been translated.
- Chekhov flag: Introduced Session 2 with narrative emphasis. They must eventually pay off or be explicitly retired.
- Next beat: Session 4 — if Ashford has any coherent periods, he can identify the script (it's the same language as the Revelations of Glaaki). Translation reveals something significant.

**Thread: Tommy Flanagan — loose end or asset?**
- Type: NPC Contact
- State: Dormant — 2 sessions since last advancement
- Tommy was paid $20 in Session 1 to watch the docks. He has not been followed up. The dock operation is now disrupted; what did Tommy witness?
- Next beat: Tommy surfaces with information — or surfaces having been warned off by Order remnants.

---

## NPC Quick Reference

| NPC | Role This Session | Key Detail | Location |
|-----|-------------------|------------|----------|
| [[Professor Ashford]] | Rescued prisoner; the human center of the story | SAN near zero; knows what's in the pit | Investigators' care / hospital |
| [[Brother Ezra]] | Off-screen threat; resurface at the right moment | Powers fading if binding not renewed Nov 1 | Unknown — fled the sanctum |
| [[Inspector Crane]] | Potential ally or obstacle; watershed moment | Takes Order bribes; genuinely liked Ashford | Kingsport Police Station |
| [[Tommy Flanagan]] | Street informant; Chekhov's gun | Watched the docks; saw something | The Red Hook Tavern |
| Grand Master (unnamed) | Hidden threat; revelation beat | Leads the Order's inner circle; identity unknown | Somewhere in Kingsport |

---

## World State

**In-game date:** October 21, 1923 (morning after the new moon — the ritual deadline has passed)  
**Location:** Kingsport, Massachusetts  
**Weather:** Autumn fog is persistent. The sea smells wrong. The fishing boats have not been going out.

**Active threats:**
- Brother Ezra: at large, presumed wounded, binding expiring November 1
- Order inner circle: exposed but not arrested; Grand Master not yet identified
- The pit: not opened but not sealed — whatever lives below it is still there

**Faction posture (Order of the Silver Twilight):**
- Narrative stage: **Post-Ritual Failure**. The Order has moved from Ritual to a fragmented Crisis response.
- Outer circle: scattering, invoking plausible deniability
- Inner circle: in damage-control mode
- Remaining threat: they still control the Grand Master's resources and Crane's willful blindness

**PC Heat level:** Aware → Hostile. The Order knows who the investigators are. Ezra has their faces. The Grand Master knows the ritual failed and has a suspect list of one group.

**Ticking elements:**
- November 1: Brother Ezra's binding renewal. If it lapses, his enhanced abilities fade. If he attempts to renew it without the Order's resources, it may go badly wrong.
- Ashford's mental state: he has days, not weeks, before his fragmented lucidity closes entirely.
- Inspector Crane: if inner circle members learn the investigators have evidence of the bribery, Crane becomes a target — silenced or turned.

---

## PC Roster & Arcs

### Dr. Eleanor Voss (Sarah)
**Arc Stage:** 2 — Testing  
**Arc Theme:** Rational medicine vs irrational reality — "I don't believe in what I've seen"  
**Current SAN:** ~45–50 (assumed some loss in Session 3)  
**Recent decisions with consequences:**
- Used her Medicine skill to keep Mal functional after the dock chase
- Her Psychology success at the docks (correctly reading Ezra's tactical intelligence) was prescient and unrewarded
- She is the investigator most committed to a rational framework — and most at risk of it shattering

**Arc beat for Session 4:** Eleanor now has a broken patient (Ashford) who has seen something that broke him. Her medical training tells her there is a treatment path. Her experience with the supernatural tells her there may not be. She has to decide how to care for someone whose trauma she cannot fully explain.  
**B-plot candidate:** Strong. Voss treating Ashford is the human core of the session.

**Plot assignment:** B-plot

### Malcolm "Mal" Bridges (Tom)
**Arc Stage:** 2 — Testing  
**Arc Theme:** Evidence and cynicism vs the unexplainable — "I believe what I can prove"  
**Current status:** Minor wound (right arm) from Session 2 chase; presumably more wear from Session 3  
**Recent decisions with consequences:**
- Mal's Stealth failure at the docks blew the group's cover and set the entire dock chase in motion
- His Pinkerton methodism has served him well in gathering physical evidence
- Suspicious of Crane from the start — the right instinct

**Arc beat for Session 4:** Mal has been building a case. He now has enough to confront Crane — or to take it over Crane's head. The question is whether Mal trusts institutions at all anymore, or whether the last three weeks have destroyed that trust entirely.  
**Plot assignment:** C-plot (Decision Callback on Crane suspicion)

### Reverend Silas Marsh (Jamie)
**Arc Stage:** 2 — Testing  
**Arc Theme:** Faith tested by genuine horror — "What does God have to do with this?"  
**Current Cthulhu Mythos:** 1 (from examining the stone tablets)  
**Recent decisions with consequences:**
- Marsh recognized protective wards in Ashford's notes — academic knowledge of occult, not belief
- His faith has been fraying session by session
- His clerical connections have been underused — this should change

**Arc beat for Session 4:** If Ashford is in any coherent state, Marsh and Ashford have a shared history (old university friends). Marsh may be the only person Ashford will speak to directly. This is a pastoral care scene with cosmic-horror weight: what does Silas say to a man who has seen the thing behind the stars?  
**Plot assignment:** C-plot / A-plot crossover (the Marsh-Ashford scene can serve the main investigation while delivering Silas's arc beat)

**Spotlight review (Sessions 1-3):**
- Voss: moderate spotlight in Session 1 (Medicine, payment from funds), strong Session 2 (Psychology on Ezra, SAN hit), unknown Session 3
- Mal: strong Session 1 (Spot Hidden finding the letter), moderate Session 2 (Stealth failure), unknown Session 3
- Marsh: moderate Session 1 (Occult, Library Use), lighter Session 2 (Luck roll saved him but nothing personal), unknown Session 3
- Marsh has had the least personally-focused material across known sessions. He is the C-plot candidate with the most overdue arc attention.

---

## Touchpoint Plan

| PC | Touchpoint Type | Description | Timing |
|----|----------------|-------------|--------|
| **Dr. Voss** (B-plot) | Moral Dilemma (High) | Voss must decide how much to tell Ashford about what happened — whether the truth helps or destroys him. She also faces a practical choice: does she commit her medical resources and reputation to sheltering a man connected to an occult conspiracy? | Scene 2 (Ashford care) |
| **Dr. Voss** | Ability Showcase (Medium) | Medicine/First Aid skills are the primary tool for stabilizing Ashford. Her Psychology skill can read whether Ashford's silence is protective or total collapse. | Scene 2 |
| **Mal** (C-plot) | Decision Callback (Medium) | Mal's suspicion of Crane from Session 1 pays off. He finds (or is given) the evidence of the bribe arrangement. What does the methodical ex-Pinkerton man do with proof that the cop on the case is bought? | Scene 3 |
| **Rev. Marsh** | Backstory Connection (High) | Marsh and Ashford were university friends. Ashford recognizes Marsh before he recognizes anyone else. In a moment of terrible lucidity, Ashford says something to Marsh specifically — a question, a warning, or a name. | Scene 2 / Scene 4 |
| **Rev. Marsh** | Character Moment (Low-Med) | After the Ashford scene, Marsh has a brief private moment — prayer, reflection, a conversation with Voss — where the weight of what he witnessed can be processed before the investigation resumes. | Between Scene 2 and Scene 3 |

**Coverage check:**  
- Voss: 2 touchpoints (Moral Dilemma + Ability Showcase) ✓  
- Mal: 1 touchpoint (Decision Callback) ✓  
- Marsh: 2 touchpoints (Backstory Connection + Character Moment) ✓  
- Every PC has at least one touchpoint ✓  
- No PC at 3+ sessions without high-impact touchpoint ✓  
- Touchpoint types vary: Moral Dilemma, Ability Showcase, Decision Callback, Backstory Connection, Character Moment ✓

---

## Planned Scenes

### Scene 1: The Morning After
**Type:** Dramatic / investigation setup  
**Objective:** Establish the post-climax world state; signal that the danger isn't over; let players process what happened  
**Entities:** Kingsport, morning fog, recovered Ashford, aftermath of the sanctum  
**Setup:** The investigators wake up wherever they made camp after escaping the sanctum — a hotel room, Voss's apartment, a rented house. Ashford is with them, barely coherent. The city sounds normal outside. The newspapers have nothing about the church. As if nothing happened.

**Development options:**
- The investigators try to assess their resources: who needs medical attention, what evidence did they carry out, how much SAN do they have left?
- A knock at the door: it's [[Tommy Flanagan]], nervous and pale. He watched the church last night from a safe distance. He saw people leaving in a hurry. He also saw one figure who didn't leave in a hurry — a tall man, limping, going north on Marsh Street. Ezra.
- Tommy wants to be paid, but more than that, he wants to know if it's over. It isn't.

**Branching:**  
- Investigators immediately move to secure location → Scene 2  
- Investigators want to return to the sanctum → Scene 2 leads there first  
- Investigators contact Crane directly → Scene 3 can be pulled forward

**Entities:** [[Tommy Flanagan]], [[Professor Ashford]], [[Kingsport_Docks]] area

---

### Scene 2: The Shape of Ruin (B-plot — Voss; C-plot — Marsh)
**Type:** Social / horror  
**Objective:** Deliver Voss's moral dilemma; deliver Marsh's backstory connection; surface what Ashford knows about the pit  
**Entities:** [[Professor Ashford]], [[Dr. Eleanor Voss]], [[Reverend Silas Marsh]]  
**Setup:** Ashford is stable enough to sit upright and drink something warm. He responds to questions but not consistently — his attention drifts, loops back on itself. Then he sees Marsh. Something sharpens in his eyes.

**Key beats:**
- **Voss's dilemma:** Ashford needs hospital care. Getting him to a hospital means explaining the circumstances, inviting scrutiny, and exposing the investigators to legal and social fallout. Keeping him means taking on a patient she cannot fully treat with tools she has. The right choice is not obvious.
  - *Psychology (Voss):* Can assess whether Ashford's lucid windows are narrowing or stable
  - *Medicine:* Can assess his physical condition and prognosis
- **Marsh's moment:** Ashford calls Marsh by name without prompting. "Silas. You found it." Pause. "Don't let them know what's in the pit." He won't say more right then, but the instruction lands. What does Silas do with it?
- **The pit fragment:** If the investigators ask Ashford what he saw in the pit, he responds — but not directly. He draws something on whatever is handy. A shape. Not the Strange Symbol. Something that hurts to look at if you've ever seen it before. Anyone who has made a Cthulhu Mythos roll recognizes elements of it. Marsh (Mythos 1) might recognize part of it. SAN check: 0/1 for everyone in the room.

**Branching:**
- Ashford has a lucid period and can answer questions → expands investigation leads  
- Ashford is too far gone → the shape-drawing is all they get; Marsh carries the warning  
- Investigators get Ashford to a hospital → triggers a later complication (Order's inner circle has resources to reach him there)

---

### Scene 3: The Envelope in the Desk (C-plot — Mal)
**Type:** Investigation  
**Objective:** Resolve the Crane thread; deliver Mal's Decision Callback; open the question of how to dismantle the Order legally  
**Entities:** [[Inspector Crane]], Kingsport Police Station, the bribery evidence  
**Setup:** Mal has been building this case. Now he has the sanctum, the tablets, the Order's ledger (assuming it was recovered from the lodge), and — possibly — the ability to trace the cash payments to Crane. How he goes at this determines the shape of the scene.

**Option A — Confrontation:**
Mal comes to Crane with evidence. Crane's response depends on how much Mal has:
- Physical evidence of the bribe + the sanctum: Crane's façade cracks. He doesn't confess, but he doesn't deny. He looks ten years older in one minute.
- Hard *Persuade* roll (modified by quality of evidence): Crane agrees to make a statement. Not an arrest. A statement. It's something.
- Failure or refusal: Crane doubles down. He tells Mal to get out of his station. He picks up the phone as Mal leaves.

**Option B — Go over his head:**
The state police are an option. Takes 24–48 hours. Crane finds out they're coming, which creates a complication.

**Option C — Use him:**
The investigators don't expose Crane yet. They leverage what they know to get something out of him — the names in the Order's inner circle, access to records, a look at that file on "unusual incidents" going back three years.

**Branching:**  
- Crane turns → possible ally for endgame; moral complication for Mal  
- Crane exposed → legal and social consequences for the Order begin  
- Crane used → information flows, but the corruption sits unresolved

---

### Scene 4: The Name You Didn't Know
**Type:** Investigation / revelation  
**Objective:** Reveal at least one inner circle identity; raise stakes for the final chapter; signal the Order is not finished  
**Entities:** Grand Master (identity TBD), Dr. Philip Hartwell, Judge Marcus Abernethy  
**Setup:** Through one or more of the following routes — the lodge ledger, Crane's cooperation, Ashford's lucid fragments, Tommy's observations, the stone tablet translations — the investigators learn a name they weren't expecting. Someone they know. Someone respected.

**Recommended design:** The Grand Master should be someone the investigators have at least heard of, even if not met. The campaign index suggests the university chancellor, the mayor, or a figure from their professional networks. Dr. Voss's connection to the hospital creates an opening for Dr. Philip Hartwell (a physician in the inner circle) to be someone she knows professionally.

**Dramatic note:** This is a revelation beat, not a confrontation beat. The investigators learn the name. What they do with it is their choice. The Order's response — whether the named individual knows the investigators know — is a consequence that can play out in the session's final moments or be held for a Chapter 2 opening.

---

### Contingency Scene A: Ezra's Warning
**Trigger:** If the investigators try to go home without taking precautions, or if the session runs long and needs an injection of threat.  
**Type:** Horror / pressure  
**Setup:** They find something at their base of operations. Not an attack — Ezra is too wounded for a direct assault. Something left deliberately. A page torn from the Revelations of Glaaki, placed inside the locked door. A single sentence underlined in what might be blood: *"We know where you sleep."*  
This is Ezra communicating that he is alive and watching. It is also a threat against Ashford — wherever the investigators are keeping him.

---

### Contingency Scene B: The Outer Circle Scapegoat
**Trigger:** If the investigators pursue legal channels or publicity.  
**Type:** Social / investigative complication  
**Setup:** The Order's inner circle moves to contain the damage by producing a scapegoat from the outer circle — a wealthy lodge member who "acted alone" in a "misguided occult obsession." This person is genuinely innocent of the worst crimes, but their cooperation is purchased or coerced. The story that emerges in the press is partially true but structured to protect the inner circle and discredit the investigators' more extreme claims (a summoning ritual? A pit?).

---

## Session End Objectives

The GM should try to reach at least one of these before ending Session 4:

1. **Strong ending:** The Grand Master is identified. The investigators now know who they're really up against. The threat has a face.
2. **Alternate ending:** Crane makes his statement. The legal machinery starts turning slowly. The Order begins to fracture. Ashford is safe, for now.
3. **Minimum viable:** The Ashford thread reaches a milestone — he communicates something specific about the pit, or he reaches a more stable state with medical care. The investigators know the danger isn't over and have at least one active lead into Chapter 2.

---

## Spotlight Forecast

| PC | Estimated Share | Primary Vehicle |
|----|----------------|-----------------|
| Dr. Voss | 38% | Scene 2 (B-plot, Ashford care; moral dilemma); Scene 1 medical assessment |
| Rev. Marsh | 33% | Scene 2 (Ashford recognition; pit fragment); character moment; A-plot contributions in Scenes 3-4 |
| Mal Bridges | 29% | Scene 3 (Crane confrontation; C-plot); Scene 1 (evidence gathering) |

**Imbalance check:**  
- No PC below the 15% floor ✓  
- No PC underserved for 3+ consecutive sessions (Marsh getting significant material this session) ✓  
- Voss is B-plot lead at ~38%; this is within the 25–35% B-plot range with slight overflow justified by the Ashford care arc being central ✓

---

## Audit Notes

### Agency Review

Checking planned scenes against agency violation criteria:

- Scene 1: "Tommy wants to be paid, but more than that, he wants to know if it's over." — NPC motivation statement, not PC prescription. ✓
- Scene 2: "Ashford calls Marsh by name without prompting" — NPC action, not PC action. ✓
- Scene 2: "What does Silas do with it?" — correctly frames as open question, not prescription. ✓
- Scene 3: All three options (Confrontation / Over his head / Use him) are offered as player choices. ✓
- Scene 4: "What they do with it is their choice." ✓
- Contingency A: Setup describes NPC action (Ezra leaving the threat); PC response left open. ✓
- Contingency B: Describes Order response to PC choices; investigators react. ✓

**One flag:** The "Ashford draws a shape" beat in Scene 2 triggers a SAN check (0/1) for everyone in the room. Verify the SAN call is appropriate — this is low SAN loss (0/1) for a glimpse of an abstract shape, which is within the CoC 7e early-session sanity budget guidelines (2–5 total for a slow burn session). ✓

No agency violations found.

### Canon Review

- [[Professor Ashford]] SAN 15 confirmed in vault file. Post-Session 3 assumed SAN in range 10–15 is consistent.
- Brother Ezra binding renewal November 1 — sourced from vault file. ✓
- Dr. Philip Hartwell and Judge Marcus Abernethy sourced from Order faction file, marked "not yet encountered in play." Flagged as unverified to players (they don't know these names yet). ✓
- Grand Master identity is explicitly unrevealed in vault. No identity assigned here — flagged for GM decision. ✓
- Tommy Flanagan as dock watcher — established in Session 1 Wrap-Up. ✓
- St. Anselm's Church — referenced in Session 2 Wrap-Up decoded letter and Order faction file, not yet a linked vault entity. **Flagged: needs entity file.** ✓ (see Gaps below)
- "Dr. Marsh" mentioned at end of Session 2 Wrap-Up open threads (Item 6: "Who is this?") — likely a transcription oddity or a different NPC. Not addressed in Session 3 or this prep. **Flagged for GM clarification.** ✓

No canon violations found. Two items flagged.

---

## Gaps & Actions

| Gap | Type | Priority | Action |
|-----|------|----------|--------|
| St. Anselm's Church — no vault entity file | Missing entity | High | Create `Locations/St_Anselms_Church.md` stub. It's now the most significant location in the investigation. |
| Grand Master identity — not established in vault | GM decision required | High | GM must decide before Session 4 runs. Suggested candidates: university chancellor, mayor, someone from Voss's or Marsh's professional network. Lock this in before play. |
| "Dr. Marsh" in Session 2 Wrap-Up open threads | Ambiguous reference | Medium | Confirm: is this a new NPC or a transcription error? If intentional, needs a vault stub. |
| Stone tablets — translation unresolved | Chekhov's gun | Medium | Ashford can initiate translation in Session 4 (Scene 2 lucid window). Alternatively, a linguist NPC could be introduced. Plan a payoff. |
| Dr. Philip Hartwell (inner circle physician) | Chekhov's gun | Medium | Either use him in Session 4 or explicitly retire. Suggested use: he is the physician Voss contacts for hospital care; she doesn't know he is Order. |
| Judge Marcus Abernethy (inner circle) | Chekhov's gun | Low | Can be held for Chapter 2. Acknowledge to GM this thread is live. |
| Session 3 Wrap-Up — doesn't exist | Vault gap | High | Recommended: run `session-wrapup` for Session 3 before Session 4. If skipped, the above prep assumptions (victory path) should be confirmed with the GM and stamped into a brief post-hoc wrap-up note. |
| No `_meta/vault-config.md` with version stamp | Structural | Low | Run baseline migration via `campaign-organizer` at next opportunity. |

---

## Skill Handoff

Based on the gaps above, the following work is recommended after this prep:

- **session-wrapup** — Run Session 3 wrap-up to canonize what happened. This is the highest-priority action before Session 4.
- **ttrpg-expert** — Use for: Grand Master identity brainstorming; Dr. Philip Hartwell NPC generation; Scene 4 revelation scene design; refining the pit-fragment horror moment in Scene 2.
- **campaign-organizer** — Create the `Locations/St_Anselms_Church.md` entity file; create stub for "Dr. Marsh" NPC if confirmed as real; run baseline vault version migration.
- **campaign-qa** — After Session 3 wrap-up is written, run a graph health check to verify all Session 3 entity changes landed correctly.

---

*Plan file written. Progressive write complete. Session 4 prep is ready for GM review. Confirm Grand Master identity and Session 3 outcomes before running.*

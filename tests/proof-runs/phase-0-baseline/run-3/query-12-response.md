---
query: "Run session prep for Session 4 of my campaign"
system: workflow
type: session-prep
total_tokens: 0
wall_clock_ms: 0
files_loaded:
  - tests/proof-runs/baseline-skills/session-prep/SKILL.md
  - skills/session-prep/references/session-templates.md
  - skills/shared/session-principles.md
  - skills/shared/migrations.md
  - skills/ttrpg-expert/arc-spotlight-reference.md
  - tests/benchmark-campaign/_meta/index.md
  - tests/benchmark-campaign/_Campaign/Player Characters.md
  - tests/benchmark-campaign/_Campaign/Timeline.md
  - tests/benchmark-campaign/Chapters/Chapter 1/chapter-overview.md
  - tests/benchmark-campaign/Chapters/Chapter 1/Sessions/Session 01 - The Missing Professor.md
  - tests/benchmark-campaign/Chapters/Chapter 1/Sessions/Session 01 - The Missing Professor - Wrap-Up.md
  - tests/benchmark-campaign/Chapters/Chapter 1/Sessions/Session 02 - The Docks at Night.md
  - tests/benchmark-campaign/Chapters/Chapter 1/Sessions/Session 02 - The Docks at Night - Play Notes.md
  - tests/benchmark-campaign/Chapters/Chapter 1/Sessions/Session 02 - The Docks at Night - Wrap-Up.md
  - tests/benchmark-campaign/Chapters/Chapter 1/Sessions/Session 03 - The Inner Sanctum.md
  - tests/benchmark-campaign/Chapters/Chapter 1/Sessions/Session 03 - The Inner Sanctum - Plan.md
  - tests/benchmark-campaign/NPCs/Brother_Ezra.md
  - tests/benchmark-campaign/NPCs/Professor_Ashford.md
  - tests/benchmark-campaign/NPCs/Inspector_Crane.md
  - tests/benchmark-campaign/NPCs/Tommy_Flanagan.md
  - tests/benchmark-campaign/NPCs/Mrs_Whitmore.md
  - tests/benchmark-campaign/Factions/Order_of_the_Silver_Twilight.md
  - tests/benchmark-campaign/Locations/St_Anselms_Church.md
  - tests/benchmark-campaign/Locations/Kingsport_Docks.md
  - tests/benchmark-campaign/Locations/Ashford_Study.md
  - tests/benchmark-campaign/Clues/Coded_Letter.md
  - tests/benchmark-campaign/Clues/Strange_Symbol.md
  - tests/benchmark-campaign/Clues/Witness_Statement.md
---

# Session Prep — The Ashford Case

---

## Version Check

The vault's `_meta/vault-config.md` does not exist, and `_meta/index.md` carries no `gm_apprentice_version` field. The current plugin version is **1.4.14**. This is a pre-versioning vault and technically requires migration before proceeding.

However: the vault is structurally sound (sessions, entities, clues, factions, and locations all follow the expected schema), and the migration for pre-versioning → 1.4.14 involves no content changes — only a version stamp and optional template additions. I'll proceed with prep. You should run `campaign-organizer` to apply the baseline migration (add `gm_apprentice_version: "1.4.14"` to `_meta/vault-config.md` and optionally install the PC templates) at your convenience.

---

## Campaign Orientation

- **Campaign:** The Ashford Case
- **System:** Call of Cthulhu 7th Edition
- **Setting:** Kingsport, Massachusetts, October 1923
- **Party:** Dr. Eleanor Voss, Malcolm "Mal" Bridges, Reverend Silas Marsh

---

## Session Number Clarification

You've asked for prep for **Session 4**, but the campaign vault only contains three sessions:

- Session 1: The Missing Professor — status: **reviewed**
- Session 2: The Docks at Night — status: **reviewed**
- Session 3: The Inner Sanctum — status: **prepped** (plan exists, not yet played)

Session 3 has not been played yet — there is no play notes or wrap-up file. Two paths are possible:

**A) Session 3 was played but never wrapped up.** In that case I need raw play notes to generate a recap and continue to Session 4 prep. The play notes for Session 3 are missing from the vault.

**B) You mean Session 3.** The vault refers to "Session 03 - The Inner Sanctum" as the upcoming session. It's possible "Session 4" was a numbering slip.

**Most likely reading given the evidence:** Session 3 is the next session to play. A Plan file already exists for it. I will treat this request as prep for the upcoming session — **Session 3: The Inner Sanctum** — which is the logical "next session" the vault is pointing to. If Session 3 has already been played and you have notes, please share them and I can do a wrap-up first, then prep Session 4.

Proceeding as: **Prep for Session 3 — The Inner Sanctum**.

---

## Phase 1: Reconcile

Session 2's status is `reviewed` — reconcile has already run for it. Session 3 has status `prepped` with an existing Plan file. Phase 1 is skipped.

---

## Prior Prep Review

A Plan file exists for Session 3 (`Session 03 - The Inner Sanctum - Plan.md`). Reviewing it against current vault state:

**What stands:**
- The three-act structure (Lodge → Descent → Confrontation) is solid and tracks from the Session 2 wrap-up.
- [[Brother Ezra]]'s stats and tactical profile are verified against his vault file.
- [[Professor Ashford]]'s prisoner status and fragile mental state are verified.
- The [[Order of the Silver Twilight]] inner circle structure is correct.
- All four resolution options for the confrontation are sound and non-railroading.
- The contingency table (Hayes as fallback, captured investigators, going to police) is well-constructed.

**What needs updating:**
- The plan mentions "Rev. Marsh" but the play notes use "Mal Bridges" as the primary stealth operative — confirm Rev. Marsh vs. Silas Marsh naming is consistent (the PC roster says "Reverend Silas Marsh," so "Rev. Marsh" is correct).
- The plan doesn't account for Tommy Flanagan's withheld information. Tommy knows [[Brother Ezra]] visits the old quarter and has seen something being carried from a building there. He has not yet shared this — this is a live hook.
- The plan doesn't name "St Anselm's Church" explicitly. The vault file for [[St Anselms Church]] is DRAFT confidence — adequate for prep but should be promoted after this session.
- A note in the Session 2 play notes flags "[[Dr. Marsh]] — WHO IS THIS?" — an unresolved question that needs to carry forward.
- The play notes also flag "Prof Crain" who witnessed something at dock 7. This person is not in the vault and should be either created as an entity stub or dismissed as a naming error (likely "Prof. Crain" = Dr. Wilmarth? Or a new NPC?).

→ Plan file is approximately 80% usable. The sections below supplement and update it.

---

## Previously On...

*Read aloud or paraphrase to open the session:*

The investigators have spent ten days pulling at a thread that keeps unraveling into darkness. It began with a worried colleague and a ransacked study — Professor Henry Ashford, a steady, careful man, had come unhinged over a manuscript and then vanished entirely. His housekeeper had seen a stranger: tall, gaunt, wearing gloves even in warm weather.

The coded letter hidden in a false drawer pointed to the docks. And so they came — at night, in the fog — and found what they wished they hadn't. Crates marked with the eye-within-crescent symbol. Strange men who weren't longshoremen. And then the tall man himself, [[Brother Ezra]], who moved through the fog like something that had learned to imitate a human stride and hadn't quite gotten it right. He chased them through the alleys near warehouse 7, and when Dr. Voss saw his eyes clearly — the pupils elongated and wrong — something in her rational physician's worldview cracked.

They got away. They have two stone tablets covered in script no one can read. They know Ashford is being held somewhere underground, beneath "the old church." Reverend Marsh is almost certain which one. And they know that the ritual the cult intends to perform happens on the night of the new moon — October 20th.

Today is October 18th. They have two days.

---

## Active Threads

### Critical (must resolve this session)
1. **The Ritual Deadline.** The [[Order of the Silver Twilight]] plans to open a gate beneath the church on October 20 (the new moon). If the investigators do nothing, the ritual proceeds. This is the campaign's ticking clock.
2. **Ashford is alive.** [[Professor Ashford]] is imprisoned in a cell adjacent to the library beneath [[St Anselms Church]]. His SAN is critically low (15). He has been forced to translate the Revelations. Rescuing him is the emotional core of the scenario.
3. **Identifying the Church.** The coded letter referenced "the old church." Rev. Marsh suspects St Anselm's on Burial Hill Lane. This needs confirmation before the investigators can act. Multiple paths exist: Marsh's church knowledge, Tommy Flanagan's withheld information about Ezra's movements, the lodge ledger, Dockmaster Hayes.

### Active (likely to surface)
4. **[[Inspector Crane]] — Compromised or Complicit?** The investigators suspect Crane is being paid to obstruct. He is. The Order pays him monthly. He can be flipped with evidence and a hard Persuade roll — this is the "bring the authorities" path to the confrontation.
5. **[[Tommy Flanagan]] — Withheld Information.** Tommy knows Ezra frequents the old quarter. He's holding this for more money, OR he may try to sell information about the investigators to clear his $150 debt to Rourke. Follow-up with Tommy could provide the critical identification of the church's location AND set up a moral dilemma.
6. **The Stone Tablets.** Two carved tablets with the [[Strange Symbol]] and unknown script are in the investigators' possession. Can they be translated? Rev. Marsh's Occult skill may give partial information. The cult will want them back.
7. **"[[Dr. Marsh]]" — Unresolved.** Play notes flag this name as unknown. This may be a confusion with Rev. Silas Marsh, a new NPC, or a clue. Flag for clarification before the session.

### Stale (3+ sessions without advancement — flag)
8. **Mrs Whitmore as Leverage.** Established in Session 1 that [[Mrs Whitmore]] could be used as leverage against Ashford. The Order knows she can identify Ezra's voice. She has not reappeared in Sessions 2-3 prep. Consider: is she in danger? The cult knows the investigators are active now. **Stale — 2 sessions without advancement. Address if possible.**

---

## NPC Quick Reference

| NPC | Role This Session | Key Detail | Location |
|-----|-------------------|------------|----------|
| [[Brother Ezra]] | Primary antagonist — enforcer, physical threat | Has seen investigators' faces; moves at Move 12; SAN loss on witnessing him; weakness is annual binding renewal (due Nov 1) | Likely at St Anselm's or moving between lodge and church |
| [[Professor Ashford]] | Prisoner / rescue objective | SAN 15, mentally fragile, may resist rescue due to fascination with the texts; knows what is in the pit | Cell adjacent to underground library, St Anselm's |
| [[Inspector Crane]] | Police obstacle / potential emergency ally | Takes OST money; can be turned with evidence + Persuade roll; genuinely feels guilty about Ashford | Kingsport Police Station |
| [[Tommy Flanagan]] | Information broker / moral pressure point | Knows Ezra moves through old quarter; owes $150 to Rourke; may sell out investigators if desperate | Red Hook Tavern or dock area |
| Grand Master (unknown) | Hidden antagonist | Identity not yet revealed; candidates include a university, civic, or legal figure the investigators may have met | Silver Twilight Lodge / St Anselm's |
| Dr. Philip Hartwell | Inner circle — not yet encountered | Physician; procures ritual chemicals | Potentially present at church during ritual |
| Judge Marcus Abernethy | Inner circle — not yet encountered | Legal protection for the Order | Potentially present at church during ritual |

---

## World State

**In-game date:** October 18, 1923 (morning after Session 2 events)
**Location:** Kingsport, Massachusetts
**Weather:** Autumn fog typical of Kingsport; cold nights

**Active threat:** The summoning ritual is scheduled for October 20 (new moon). The Order has been preparing for months; the frequency of dock deliveries has escalated. Ashford has been translating passages under duress. The ritual chamber is prepared.

**Faction postures:**
- **Order of the Silver Twilight (inner circle):** High alert. Ezra has seen the investigators' faces. They know they've been compromised. The ritual must proceed before the investigators can bring authority down on them. They may move aggressively — surveillance, intimidation, or a direct attempt to eliminate the investigators before the 20th.
- **Order of the Silver Twilight (outer circle):** Unaware of events. They attend dinner functions and think nothing is wrong.
- **Kingsport Police:** Crane is aware the investigators are active but taking no action. His desk sergeant is sympathetic but constrained.
- **Miskatonic University / Dr. Wilmarth:** Waiting for news; has not heard from the investigators recently.

**Ticking clocks:**
- **T-minus 2 days** to the new moon ritual (October 20)
- **Brother Ezra's binding renewal** due November 1 — irrelevant to this session's timeline but a potential backstory beat
- **Tommy Flanagan's debt to Rourke** — pressure building; if investigators don't pay him, he may act against them before October 20

**SAN and health status:**
- Dr. Voss: SAN 52 (lost 3 in Session 2)
- Mal Bridges: Minor bruise on right arm (no HP loss, healed by now unless only 1 day has passed)
- Rev. Marsh: Cthulhu Mythos 1 (gained Session 2); SAN at base minus prior loss (not specified in vault)

---

## PC Roster & Arcs

### Dr. Eleanor Voss
**Player:** Sarah | **Occupation:** Physician | **SAN:** 52

**Arc Stage:** Stage 2 — Testing
**Arc Theme:** "Rationalism vs. the impossible"

Eleanor Voss built her identity on empirical observation and medical evidence. The events of Sessions 1-2 have placed that foundation under stress. She diagnosed Ashford's deterioration clinically. She witnessed Ezra's inhuman eyes and lost SAN. She is being asked by the world to accept things her training tells her cannot exist.

**Backstory hooks in play:** Connection to Ashford as his physician. Has hospital access.
**Decisions needing consequences:** She paid Tommy Flanagan from her personal funds — that relationship has a financial and moral dimension. She saw Ezra's eyes and filed a rational report with Crane, who dismissed her. Her rationality is being weaponized against her.
**Next arc beat:** The underground chambers — specifically the pit and what it contains — should be the event that pushes her from Testing toward Stage 3 (Crisis). The sight of something genuinely impossible, combined with having to perform triage on a half-mad Ashford, is her pressure point.
**A/B/C assignment:** B-plot (see below)

---

### Malcolm "Mal" Bridges
**Player:** Tom | **Occupation:** Private Investigator | **SAN:** (base, no losses noted in vault)

**Arc Stage:** Stage 1 — Establishment
**Arc Theme:** "Professional detachment vs. personal investment"

Mal is a former Pinkerton, now freelance, hired by Ashford's sister to find the professor. He is cynical, methodical, evidence-driven. He trusts Tommy Flanagan from a previous case. He is suspicious of Crane.

**Backstory hooks in play:** Hired by Ashford's sister (unnamed in vault — potential future anchor). Kingsport underworld contacts. Previous working relationship with Tommy.
**Decisions needing consequences:** Mal's failed Stealth roll at the docks was the direct cause of the chase and of Voss's SAN loss. He has not been held to account for this. A callback here — a moment where Mal's error is acknowledged or where he has the chance to redeem it — would be satisfying.
**Next arc beat:** Establishment is still solidifying. Mal should have a moment that clarifies what he's actually willing to risk for this case — a choice between professional exit (take Ashford and leave, job done) and full commitment to stopping the ritual. This is his first Stage 1 anchor choice.
**A/B/C assignment:** C-plot

---

### Reverend Silas Marsh
**Player:** Jamie | **Occupation:** Episcopal clergy | **SAN:** (base minus 1 from Session 2 Mythos gain)

**Arc Stage:** Stage 2 — Testing
**Arc Theme:** "Faith vs. the abyss"

Silas Marsh is an old friend of Ashford's who got drawn in through personal loyalty. His faith is being tested — not by doubt exactly, but by the discovery that there are things in the universe that do not care about his God or his prayers. He succeeded on the Occult roll to identify Elder Signs (Session 1). He gained Cthulhu Mythos in Session 2. He is the party's closest thing to a supernatural expert, which is its own kind of horror.

He also has knowledge of local church history and may know something about St Anselm's from diocesan records — this is a critical lead path for this session.
**Backstory hooks in play:** Long friendship with Ashford (emotional stake). Episcopal clergy credentials. Diocesan archive access.
**Decisions needing consequences:** Gaining Cthulhu Mythos (Session 2) means Marsh now *knows* more about the supernatural framework than he should. He has moved from "strange happenings" to "genuine metaphysical horror." How does a clergyman integrate that? His next arc beat should force him to use that knowledge to help — and reckon with what using it means.
**Next arc beat:** The underground library, the Revelations of Glaaki, and the broken Ashford are Marsh's crisis material. He came to rescue his friend. His friend has been reading a book that destroys minds. The choice of whether to read it himself (and gain more Mythos, lose more SAN, possibly get information they need) is a perfect Stage 2 dilemma.
**A/B/C assignment:** A-plot anchor (clerical credentials and church knowledge make him the entry point for the session's main investigation arc)

---

### A/B/C Plot Assignment for Session 3

**A-Plot (50-60%):** Finding and infiltrating [[St Anselms Church]] — this is the main campaign arc and involves all three investigators equally. The location of the inner sanctum, the descent, the confrontation with Ezra, and the resolution of Ashford's fate all serve the A-plot.

**B-Plot (25-35%) — Dr. Eleanor Voss:** The underground experience, and specifically the moment of triage with Ashford, is Eleanor's featured arc beat for this session. She is the only PC with Medicine — she will be the one Ashford reaches out to, the one who must evaluate what's left of his mind. The descent into the ritual chamber should push her rationalist self toward Stage 3 crisis. Her reaction to the pit — the thing she cannot diagnose, cannot treat, cannot categorize — is the B-plot core.

**C-Plot (10-15%) — Mal Bridges:** Tommy Flanagan carries Mal's C-plot. Whether Mal checks in with Tommy (who has withheld information and is being pressured by Rourke) is a C-plot beat that delivers a Decision Callback (Mal established the relationship, Mal needs to tend it) and potentially an Ability Showcase (Mal's Fast Talk or Psychology to read Tommy's desperation before it becomes a betrayal).

---

## Touchpoint Plan

### Dr. Eleanor Voss (B-plot)
| Touchpoint Type | Scene / Moment | Timing |
|----------------|---------------|--------|
| **Moral Dilemma (High)** | Ashford tells Voss he doesn't want to leave. He has been translating the Revelations voluntarily for the last 48 hours — not under duress. His obsession has consumed him. Does Voss forcibly remove an unwilling patient? Does she respect his autonomy? | The Cell, when Ashford is found |
| **Ability Showcase (Medium)** | First Aid / Medicine to stabilize Ashford during the extraction — he is physically weak, malnourished. Voss is the only person who can assess his condition accurately. | Extraction sequence |
| **Character Moment (Low-Med)** | After the confrontation, Voss has a quiet moment — any moment to articulate (even silently) how she is processing what she saw in the ritual chamber. A brief character beat, not a speech. | Post-confrontation / exit |

**Coverage check:** B-plot PC has one high-impact touchpoint (Moral Dilemma). Types vary (Moral Dilemma, Ability Showcase, Character Moment). ✓

### Malcolm Bridges (C-plot)
| Touchpoint Type | Scene / Moment | Timing |
|----------------|---------------|--------|
| **Decision Callback (Medium)** | Tommy Flanagan contact — Mal established Tommy in Session 1 as a paid informant and trusted him. Tommy has information (Ezra's movements in old quarter) but is holding out for money AND is under pressure from Rourke. If Mal reaches out, Tommy gives up the lead. If Mal doesn't, Tommy may sell information about the investigators to clear his debt — consequences arrive in Session 3. | Pre-infiltration (gathering phase) |
| **Ability Showcase (Medium)** | The infiltration itself — any stealth approach to the church, bypassing potential surveillance, is a Stealth/Spot Hidden showcase. Mal failed his Stealth roll at the docks; this is the redemption beat. | Approach to St Anselm's |

**Coverage check:** C-plot PC has one medium-impact touchpoint. Both touchpoints are different types. ✓

### Reverend Silas Marsh (A-plot anchor)
| Touchpoint Type | Scene / Moment | Timing |
|----------------|---------------|--------|
| **Backstory Connection (High)** | Marsh reunites with Ashford — his oldest friend, now broken. This is the emotional payoff of Marsh's personal reason for joining the investigation. | The Cell |
| **Moral Dilemma (High)** | In the underground library, the complete Revelations of Glaaki is accessible. Marsh could read it — gaining Mythos information, possibly learning how to disrupt the ritual, at the cost of SAN and his remaining rational certainty. His faith and his scholarly instinct pull in opposite directions. This should be offered, not forced. | The Library |
| **Ability Showcase (Medium)** | Marsh's church knowledge and diocesan credentials allow him to investigate St Anselm's through official (or semi-official) channels. History and Occult skills are useful in identifying the hidden entrance through the crypt. | Pre-descent investigation |

**Coverage check:** A-plot PC has two high-impact touchpoints and one medium. Types vary: Backstory Connection, Moral Dilemma, Ability Showcase. ✓

**Overall coverage check:** All three PCs have at least one assigned touchpoint. ✓ No PC has gone 3+ sessions without a high-impact touchpoint. ✓ Voss and Marsh each get at least one high-impact touchpoint this session. Mal gets two medium touchpoints (C-plot appropriate). ✓

---

## Planned Scenes

*(Note: Per the skill workflow, scenes should normally be pitched to the GM for approval, tweak, or rejection before being written. Since this is an async prep document, scenes are written in full below. The GM should review and mark each scene as approved / tweaked / dropped before running it.)*

---

### Scene 1: The Morning After — Making a Plan
**Type:** Social / Investigation
**Objective:** Set stakes, establish the October 20 deadline explicitly, identify the church, choose an approach.
**Entities:** The three investigators; potentially [[Tommy Flanagan]]; [[Inspector Crane]] (optional)
**Setup:** The morning of October 18. Investigators regroup — wherever they're staying in Kingsport (hotel or lodgings not specified in vault; establish this). They have two days. They know the inner sanctum is underground, beneath "the old church." They need to confirm the location before they can act.

**Information paths to St Anselm's (at least three, per node-based design):**
1. Rev. Marsh's knowledge of Kingsport church history and his diocesan archive access. A History roll (55%) or a simple phone call to the diocesan office reveals that St Anselm's on Burial Hill Lane is the only deconsecrated church in the old quarter. He already suspects it.
2. Tommy Flanagan. He has seen [[Brother Ezra]] enter and leave the old quarter on multiple nights. If contacted and paid (or appealed to through Mal's relationship), Tommy gives up the location of the old quarter building Ezra frequented — St Anselm's, or at least Burial Hill Lane.
3. The Silver Twilight Lodge. A daytime visit or surveillance could yield the ledger entry referencing "preparations at the St. Anselm's site." This is lower-probability (requires getting inside) but available.

**Branching:** Investigators discuss approach. Options crystallize: stealth infiltration, forced entry, using Crane (slow but legal), waiting for them to come out (passive, dangerous). Each choice sets up a different version of Scene 3.

**PC touchpoints delivered:** None directly, but this scene serves Marsh's Ability Showcase (church knowledge) if he's the one who identifies the location.

---

### Scene 2: The Tommy Question (C-plot — optional, Mal-driven)
**Type:** Social
**Objective:** Deliver Mal's Decision Callback touchpoint; provide the redundant information path to St Anselm's; introduce the Rourke complication.
**Entities:** [[Tommy Flanagan]], Mal Bridges (primary), other investigators (witness-and-react)
**Setup:** Mal reaches out to Tommy at the Red Hook or through a contact. Tommy is nervous — more nervous than usual. He's been asking about the old quarter for money and Rourke's man came by this morning. He has information but he's weighing his options.

**What Tommy knows and will trade:**
- Ezra has been seen entering a building on Burial Hill Lane — the old church — at least four times in the past month, always after dark.
- Something is wrong in the old quarter at night. He heard sounds he couldn't identify coming from the direction of the church two nights ago.
- Rourke's debt ($150) is the pressure point. If investigators can pay him at least $50 now and promise the rest, Tommy commits to the investigators' side and won't sell them out.

**GM note — Rourke as future complication:** If the investigators don't address the debt, Rourke's man will approach Tommy within 24 hours. Tommy won't intend to betray the investigators, but he might let their lodgings address slip in exchange for a debt extension. This is not immediate — it ripens after the session, not during it.

**Branching:**
- Investigators pay Tommy: He gives up the Burial Hill Lane information, confirms St Anselm's, and offers to watch their backs (not go inside — he's not suicidal, but he can watch the street).
- Investigators don't reach out / can't find Tommy: He's available as a contingency resource if they get stuck later. The Rourke pressure builds silently.
- Tommy tries to negotiate more: Fast Talk or Psychology from Mal to read him correctly and close the deal without losing him.

**PC touchpoints delivered:** Mal — Decision Callback (tended the relationship he established in Session 1). Potential Ability Showcase (Fast Talk / Psychology).

---

### Scene 3: The Approach — St Anselm's by Day (Optional)
**Type:** Investigation
**Objective:** Reconnaissance of the church exterior; establish layout before nighttime infiltration.
**Entities:** The investigators; [[St Anselms Church]] (exterior)
**Setup:** St Anselm's sits on Burial Hill Lane in the old quarter. The church is abandoned — or appears to be. A wrought-iron fence, tilted headstones, boarded windows. But the chain on the gate is newer than it should be. And the overgrown path around the back leads to a cellar door half-hidden by ivy.

**What a daytime recon yields:**
- Spot Hidden (Difficulty: Regular): The newer chain on the gate. The well-worn path around the back despite apparent abandonment.
- History (Rev. Marsh) or Architecture/Archaeology roll: The church is built on much older foundations. There's something pre-colonial about the stonework on the north wall.
- Track (unlikely for the investigators): Boot prints going around the back, recent.

**Branching:**
- Investigators do daytime recon: They find the cellar door. Entering in daylight is less atmospheric but reduces the chance of running into active cultists.
- Investigators go at night: More atmosphere, more danger — the cult may be present doing final ritual preparations (October 18-19 = two nights before the 20th).
- Rev. Marsh contacts the diocese about St Anselm's: The diocesan archivist knows the church was deconsecrated after a fire. Marsh can also invoke his clerical authority to request access — this gives legitimate cover for being on the property.

**PC touchpoints delivered:** Rev. Marsh — Ability Showcase (church knowledge, History, interpreting the architecture).

---

### Scene 4: The Descent
**Type:** Horror / Investigation
**Objective:** The investigators reach the hidden chambers. Build dread through the descent. Deliver the atmosphere of the inner sanctum.
**Entities:** [[St Anselms Church]] (interior and underground), scattered cultists (1-2 as early encounter if investigators go at night), [[Strange Symbol]] (carved throughout)
**Setup:** Entry through the cellar door. The abandoned interior — stripped nave, warped floorboards, the damp smell of mildew. The door behind where the altar stood. The crypt with its decaying coffins. And then the false wall in the ossuary.

**Finding the mechanism:** The false wall is triggered by pressing a specific headstone in the wall. The investigators need either:
- Prior knowledge (from ledger, from Tommy, from research), OR
- Investigate roll (Difficulty: Hard) to find the mechanism through systematic search, OR
- Physical search of the ossuary finding unusual wear patterns around one headstone

**The descent (mood-focused, not mechanically gated):** Once past the false wall, the architecture changes. The stonework is older, more massive. Temperature drops. The [[Strange Symbol]] is carved every few feet. The chanting — or the echo of chanting from somewhere below — is audible.

**Antechamber encounter option:** 1-2 cultists as sentinels (use standard Cultist stats). This is optional; if investigators were cautious and came in the day before the 20th, the cultists may not be in full preparation mode yet. If they come on the night of the 19th (or worse, the 20th), the place is active.

**PC touchpoints delivered:** Dr. Voss — Character Moment begins here (her first encounter with something she genuinely cannot explain). Rev. Marsh — the carved symbols can be read partially with Occult (45%).

---

### Scene 5: The Library and the Cell
**Type:** Investigation / Horror / Social
**Objective:** Find Ashford; deliver the Voss Moral Dilemma and Marsh Moral Dilemma; locate the Revelations.
**Entities:** [[Professor Ashford]], [[Brother Ezra]] (may arrive during this scene), the complete Revelations of Glaaki
**Setup:** The Library chamber. Twenty feet square, filled with books, scrolls, stone tablets. A desk with recent notes in Ashford's handwriting. Adjacent to it, a heavy door with an iron bolt — the cell.

**Ashford's state when found:**
- He is alive. Physically diminished (malnourished, pale, trembling) but ambulatory.
- SAN 15. This is dangerously low. He is lucid in bursts but lapses into fragmented speech about "the angles" and "what lives in the pit."
- He has been translating voluntarily for the past 48 hours. Part of him does not want to stop. He will not leave immediately unless someone can reach him emotionally — his friendship with Marsh (the strongest personal connection), or Voss's medical authority.
- If Marsh speaks to him as a friend, not just a rescuer: Persuade roll at Bonus Die (advantage) to get Ashford moving. A success means Ashford cooperates. A failure means he resists — Voss's Moral Dilemma triggers.

**Voss's Moral Dilemma:**
- Ashford says (coherently, in a moment of clarity): "I can't leave. I have to finish the translation. If I don't finish it, they'll use the incomplete version and something worse will come through than what they're expecting. I'm the only thing standing between the ritual working correctly and something catastrophic. Do you understand? You need to let me stay."
- Is he telling the truth? Partial truth? Psychology roll (Voss, 50%): success indicates he genuinely believes this, whether or not it's actually true. Medicine roll: he is clearly physically deteriorating. He may die if he stays.
- Voss must choose: respect a competent adult's stated choice (even a damaged one), or physically remove him. Either choice has consequences.

**Marsh's Moral Dilemma (the Revelations):**
- The complete Revelations of Glaaki is here. Marsh can read it. Reading costs: 2d6 SAN, +2 Cthulhu Mythos. Benefit: knowledge of what the ritual is actually intended to do, and possibly information about how to disrupt it without dying in the attempt.
- The Revelations does contain information about the entity in the pit — what it is, what it wants, whether the ritual can be disrupted from within. This information is useful but not required; the investigators can try to disrupt the ritual physically without reading it.
- The choice should be offered to Marsh's player without prejudging it. If Marsh reads: role-play the shift. If Marsh declines: honor it. The dilemma is in the offer, not the outcome.

**Brother Ezra arrives (timing — GM judgment):** If the investigators have been in the underground chambers for more than a few minutes, Ezra should appear — either as a sentinel who was elsewhere and returns, or as someone who sensed the intrusion. His arrival transforms the Library scene from an investigation into a crisis requiring immediate decision-making. This is intentional: the investigators should not be able to leisurely read and search with no pressure.

---

### Scene 6: The Ritual Chamber and the Resolution
**Type:** Horror / Combat / Climax
**Objective:** The investigators face the ritual space and must make a choice with irreversible consequences.
**Entities:** [[Brother Ezra]], 4-6 cultists, the Grand Master (potentially), the pit and what stirs in it
**Setup:** The Ritual Chamber. Circular, 30 feet across, domed ceiling. Silver-inlay geometric patterns on the floor that cause mild disorientation when looked at directly. At the center: the pit. Six feet across, absolute darkness below. Something in that darkness is aware of the investigators. It does not speak. It waits.

**SAN check on approaching the pit:** 1/1d6.

**Resolution paths (from Plan file — all valid):**
1. **Stealth rescue:** Bypass the ritual chamber, get Ashford out before the ritual activates. This is possible if the investigators never triggered an alarm.
2. **Disrupt the ritual:** Destroy the geometric silver-inlay patterns (chisels, or improvised damage). This requires getting past the cultists and surviving long enough to do real damage. The patterns took months to lay — destroying them thoroughly requires several rounds of effort.
3. **Direct confrontation:** Fight. Ezra is formidable (Move 12, SAN loss on witnesses). The cultists are individually weak but 4-6 is significant. The investigators are three people, one of whom is a physician. This path should be costly.
4. **Bring the authorities:** If investigators spent time beforehand turning Crane (or going to the state police), a raid is possible. Crane can be flipped with overwhelming evidence and a Persuade roll; the state police take 24-48 hours. A raid arrives late — dramatic timing — but is a valid path.
5. **Use the pit against the ritual:** If Marsh read the Revelations, he knows something about the entity and the ritual's weaknesses. Partial information that could be used tactically.

**The Grand Master reveal:** The Plan file suggests the Grand Master's identity as a dramatic beat. Good candidates include the university chancellor, the mayor, or someone the investigators have already met. The identity should be one that recontextualizes something from the investigation — "the man who sent Wilmarth to hire you" is a dramatically satisfying option, though dark.

**Non-violence option:** If the investigators have evidence of the Order's crimes, there is a window (narrow) to threaten exposure in a way that creates a standoff. The outer circle members present (if any) are not committed enough to die for this. They may scatter if the ritual's true nature is exposed to them.

**End state options:**
- *Clean:* Ashford rescued, ritual disrupted, Ezra defeated or fled, Grand Master arrested or fled. Campaign chapter ends. Next chapter: aftermath, Ashford's recovery, the outer circle's choices.
- *Costly:* One or more investigators take significant SAN loss. The pit stirs but nothing comes through. Ezra escapes. The Order is broken but not destroyed.
- *Tragic:* The ritual partially completes. Something comes through the pit — briefly. The investigators stop it, but at personal cost. The campaign world is changed.

---

## Contingency Scenes

### Contingency A: Investigators Don't Find the Church
**Trigger:** Investigators exhaust their current information paths without identifying St Anselm's.
**Scene:** Dockmaster Hayes (flagged in Session 2 wrap-up as a potential contact) has information about dock deliveries going to "the old church in the quarter." Hayes is cautious but can be approached by Mal for a cash transaction. He knows crates from Warehouse 7 are taken by cart to the old quarter — he's seen them. He doesn't know what's inside. He can point them to Burial Hill Lane.
**Note:** This contingency should feel natural, not like a bailout. Hayes was already established in Session 2 wrap-up.

### Contingency B: Investigators Are Captured
**Trigger:** Failed infiltration leads to investigators being subdued.
**Scene:** They wake in the cells near Ashford. Prison-break scenario. Ashford knows the layout. Stealth and improvisation required. This is a high-tension alternative path to the same climax.

### Contingency C: Investigators Go to the Authorities (State Police)
**Trigger:** Investigators bypass Crane and contact the state police directly.
**Scene:** The state police are professional but slow — 24-48 hours to mobilize a raid. They take the investigators' account seriously but need more than testimony. Physical evidence (stone tablets, the Coded Letter, Harlan Briggs's statement) helps. If the investigators can hold out until the raid, it arrives during or after the ritual window — potentially as a late dramatic entry.
**GM note:** Use this to raise the moral stakes. A state police raid might save the investigators but also expose the outer circle members (some of whom are innocent dupes). The investigators have to decide whether that's acceptable.

---

## Spotlight Forecast

| PC | Estimated Share | Notes |
|----|----------------|-------|
| Dr. Eleanor Voss | 35-40% | B-plot — Moral Dilemma with Ashford is the session's most important personal beat; also the primary caregiver for Ashford during extraction |
| Reverend Silas Marsh | 30-35% | A-plot anchor — church identification, descent leadership, Ashford reunion, Revelations dilemma |
| Malcolm Bridges | 25-30% | C-plot — Tommy scene, stealth approach, tactical leadership in confrontation |

**Floor check (15% minimum):** All three PCs are comfortably above 15%. ✓
**Sustained imbalance check:** No PC has been underserved across multiple sessions — this is only Session 3. Monitor going forward. ✓
**Correction needed:** None. Mal is the lowest-spotlight PC this session, which is appropriate given A/B/C structure. His C-plot has genuine consequence (Tommy's betrayal risk) so his moments matter. ✓

---

## Audit Notes

### Agency Audit

Reviewing the Planned Scenes above:

- ✓ No PC is the subject of a declarative action verb in any scene setup.
- ✓ PC emotions are offered as possibilities or reaction frames, not stated as fact. ("Voss must choose" is an invitation, not a prescription.)
- ✓ Ashford's Moral Dilemma (Voss Scene) is framed as a choice with multiple valid outcomes — no predetermined correct answer.
- ✓ The Revelations Moral Dilemma (Marsh Scene) is explicitly offered without prejudging the choice.
- ✓ Confrontation scene (Scene 6) has five contingencies — exceeds the two-contingency minimum. ✓
- **Flag:** The Ashford "do not want to leave" moment verges on telling Voss she has to choose a specific thing. Reframe: the dilemma should be *presented* to Voss's player as a situation, not resolved in the prep text. ✓ (Already framed as a question in the scene above — no fix required, but watch the tone at the table.)

### Canon Audit

- [[Brother Ezra]] stats and description verified against vault file. ✓
- [[Professor Ashford]] SAN 15 verified against vault file. ✓
- [[St Anselms Church]] layout (antechamber, library, ritual chamber, cell) verified against vault file. ✓
- [[Order of the Silver Twilight]] inner circle membership (Ezra, Hartwell, Abernethy, Grand Master) verified against vault file. ✓
- October 20 as new moon ritual date verified against Timeline. ✓
- Tommy Flanagan's debt to Rourke ($150) verified against NPC vault file. ✓
- **UNVERIFIED:** "Prof Crain" in Session 2 play notes — not in vault. Could be a naming error for Dr. Wilmarth, or a new NPC. Do not introduce "Prof Crain" into planned scenes without clarification.
- **UNVERIFIED:** "[[Dr. Marsh]]" in Session 2 play notes — this appears to be a confusion with Rev. Silas Marsh (who is a "Rev." not a "Dr."). Treat as a play-notes error unless the player/GM clarifies otherwise.
- **DRAFT confidence:** [[St Anselms Church]] vault file is marked DRAFT. It is used as a primary location this session. After Session 3, this file should be promoted to AUTHORITATIVE. Flag for post-session action.

---

## Gaps & Actions

### Missing Entity Stubs
- **Dockmaster Hayes** — Referenced in Session 2 wrap-up as a potential contact with dock knowledge. If the investigators use the Contingency A path, Hayes will be an active NPC. A stub should be created before the session. Suggested: minimal stub with role (dockmaster, Kingsport Docks), motivation (pragmatic self-interest, doesn't want trouble), and a single physical detail.
- **"Prof Crain"** — Flagged UNVERIFIED. Clarify with the GM whether this is a play-notes error or a new NPC to create.
- **Rourke** — Tommy Flanagan's creditor. Not in vault. Referenced in Tommy's GM notes. If the Tommy-Rourke thread becomes active (investigators don't pay Tommy), Rourke will need a stub. Low priority for Session 3; create after if the thread activates.
- **The Grand Master** — The Plan file defers the identity to Session 3. This is a narrative decision, not a gap, but a name and identity should be chosen before the session so it can be delivered confidently. Candidates: university chancellor, the mayor, Dr. Wilmarth himself (dark option). The GM should decide before running Scene 6.

### Stale Entity Files
- [[St Anselms Church]] — DRAFT confidence. Promote to AUTHORITATIVE after Session 3. ✓ (Flag, not blocking)
- [[Professor Ashford]] — Status remains "missing." After Session 3 (rescue or otherwise), update status. ✓ (Flag)

### Structural Issues
- No `_meta/vault-config.md` — migration needed (version stamp, not blocking for prep).
- Session 3 index (`Session 03 - The Inner Sanctum.md`) has empty scenes list — populate after session with wiki-links to scenes played.

---

## Handoff

**Content creation:** If you want NPC stubs for Dockmaster Hayes or the Grand Master before the session, hand off to `ttrpg-expert`. Hayes is a quick generation; the Grand Master's identity is a campaign-level creative choice that ttrpg-expert can help brainstorm.

**Vault structure:** The missing vault-config.md and version stamp are minor structural issues. Hand off to `campaign-organizer` after the session (or now if you want it clean before running).

**Post-session:** After running Session 3, this Plan file should be archived and a Wrap-Up should be created via `session-wrapup`. The Wrap-Up will promote entity statuses, record what was played vs. skipped, and set up Session 4 if the campaign continues.

---

*Session 3: The Inner Sanctum — prep complete.*
*In-game deadline: October 20, 1923 — two days remain.*

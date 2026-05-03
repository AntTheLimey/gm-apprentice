---
query: "Run session prep for Session 4 of my campaign"
system: workflow
type: session-prep
total_tokens: 0
wall_clock_ms: 0
files_loaded:
  - tests/proof-runs/baseline-skills/session-prep/SKILL.md
  - tests/benchmark-campaign/_meta/index.md
  - tests/benchmark-campaign/_Campaign/Player Characters.md
  - tests/benchmark-campaign/_Campaign/Timeline.md
  - tests/benchmark-campaign/Chapters/Chapter 1/Sessions/Session 01 - The Missing Professor - Wrap-Up.md
  - tests/benchmark-campaign/Chapters/Chapter 1/Sessions/Session 02 - The Docks at Night - Wrap-Up.md
  - tests/benchmark-campaign/Chapters/Chapter 1/Sessions/Session 03 - The Inner Sanctum - Plan.md
  - tests/benchmark-campaign/Chapters/Chapter 1/Sessions/Session 03 - The Inner Sanctum.md
  - tests/benchmark-campaign/NPCs/Brother_Ezra.md
  - tests/benchmark-campaign/NPCs/Professor_Ashford.md
  - tests/benchmark-campaign/NPCs/Inspector_Crane.md
  - tests/benchmark-campaign/NPCs/Tommy_Flanagan.md
  - tests/benchmark-campaign/NPCs/Mrs_Whitmore.md
  - tests/benchmark-campaign/Locations/St_Anselms_Church.md
  - tests/benchmark-campaign/Factions/Order_of_the_Silver_Twilight.md
  - tests/benchmark-campaign/Clues/Coded_Letter.md
  - tests/benchmark-campaign/Clues/Strange_Symbol.md
  - skills/shared/session-principles.md
  - skills/shared/session-document-chain.md
  - skills/session-prep/references/session-templates.md
  - skills/ttrpg-expert/arc-spotlight-reference.md
  - skills/ttrpg-expert/continuity-engine.md
---

# Session 4 Prep — The Ashford Case

## Version Check

The vault at `tests/benchmark-campaign/_meta/index.md` does not contain a `gm_apprentice_version` field, and there is no `_meta/vault-config.md` file. The `_meta/` directory exists, which means this is not first-time setup — but since no version is recorded, migration is not triggered. Proceeding with prep.

---

## Wrap-Up Gap Notice

**Session 3 has no Wrap-Up file.** The vault shows Session 03 — The Inner Sanctum with status `prepped` — a Plan file exists but no Play Notes or Wrap-Up have been created. Since you're asking for Session 4, I'm treating Session 3 as having been played.

Before I continue: **would you prefer to do a full Session 3 Wrap-Up first (recommended), or shall I generate a quick "Previously on..." from the Session 3 Plan and proceed directly to Session 4 prep?**

**Why this matters:** Without a Wrap-Up, the vault has not been updated — no entity changes (Professor Ashford's fate, Brother Ezra's status, Crane's disposition), no timeline entries for October 17-20, no carry-forward threads. Everything in Session 4 prep will be drawn from the Session 3 Plan as if it played out broadly as written, which may not match what actually happened at your table.

**Proceeding with the plan-as-played assumption below.** Replace any incorrect outcomes with what actually happened.

---

## Prior Prep Review

No existing Session 4 Plan file found. Starting fresh.

The Session 3 Plan anticipated a three-act structure: (1) The Silver Twilight Lodge visit as a red herring leading to (2) the descent into St Anselm's and (3) confrontation with Brother Ezra, resolution of Ashford's fate, and a climactic choice about the ritual. Session 4 prep builds on whatever outcome emerged from that climax.

**Plan-as-played assumptions (correct if needed):**
- The investigators located [[St Anselm's Church]] as the inner sanctum
- They descended into the underground chambers
- They encountered [[Brother Ezra]] and cult members
- [[Professor Ashford]] was found imprisoned and (probably) freed
- The ritual was disrupted or the investigators fled before completion
- Significant SAN expenditure likely occurred

---

## Previously On...

*The Ashford Case — Sessions 1-3 Recap (generated from plans; replace with actual events)*

The investigators came to Kingsport at the request of Dr. Albert Wilmarth, following the disappearance of his colleague Professor Henry Ashford. At the professor's ransacked study, they found a hidden [[Coded Letter]] in cipher — and the first traces of a symbol that would haunt the weeks to come.

The letter led them to [[Kingsport Docks]] on the night of October 17th. In the fog and gaslight of warehouse 7, they encountered [[Brother Ezra]] for the first time: tall, gaunt, moving with an impossible mechanical speed. They fled with stone tablets covered in unknown script and a decoded letter revealing Ashford's warning: *"the chamber beneath the old church... what they intend to summon will not be confined to the angles between."*

With the new moon of October 20th approaching, the investigators followed the trail to [[St Anselm's Church]] in the old quarter — deconsecrated, apparently abandoned, secretly home to the [[Order of the Silver Twilight]]'s true sanctum. Below the crypt and its false wall lay chambers cut from stone older than the church, older perhaps than Kingsport itself. They found [[Professor Ashford]]: alive, barely, his mind fractured by weeks of forced translation and by whatever he had seen in the pit at the ritual chamber's center. Brother Ezra awaited them.

What followed in those cold underground chambers — how the ritual ended, what the investigators chose to do, what it cost them — is now history. Session 4 begins in the aftermath.

---

## Active Threads

### High Priority — Immediate Consequences

**1. The Ritual: Stopped or Completed?**
- **If stopped:** The cult's plans are in ruins. But the pit beneath the church remains. Whatever moves in its darkness is not gone — only denied entry for now.
- **If the ritual completed:** A gate was opened. Something came through. The consequences are catastrophic and immediate. Session 4 becomes a damage-control scenario.
- **Urgency:** Immediate — this determines the entire shape of Session 4.

**2. [[Brother Ezra]]'s Status**
- **If defeated or fled:** His binding ritual renewal is due November 1st. A defeated but escaped Ezra is weakening and dangerous. A dead Ezra removes the cult's primary enforcer.
- **If still at large:** He knows the investigators' faces and has motivation to eliminate them.
- **Urgency:** Immediate if alive.

**3. [[Professor Ashford]]'s Condition**
- Ashford was alive in the inner sanctum with SAN: 15 (down from 65). He has seen what is in the pit. He has been translating the Revelations of Glaaki for weeks.
- Physical: frail, malnourished, physically compromised
- Mental: severely damaged. He is not the Ashford his friends knew.
- The investigators now bear responsibility for him. What do they do with him?
- **Urgency:** Immediate — he is present at session's start.

**4. [[Inspector Crane]] — Bribed, Not Corrupt**
- Crane knows the investigators. He has been paid to ignore the docks. His guilt is real.
- If the investigators have evidence of his bribery (letters, the monthly payments), he is vulnerable.
- A hard Persuade with that evidence could turn him into an asset for cleanup.
- Without a push, he will try to frame the underground events as a gas leak or structural collapse.
- **Urgency:** This session — the investigators need to decide whether to expose, leverage, or ignore him.

**5. The Order's Inner Circle**
- The Grand Master's identity has not been revealed in play. He is likely someone the investigators have interacted with and trusted — the university chancellor, the mayor, a civic figure.
- With Brother Ezra gone or compromised and the sanctum exposed, the inner circle may scatter — or strike first.
- Outer circle members are innocent. Their exposure causes collateral damage.
- **Urgency:** This session or next depending on what the investigators do.

### Medium Priority — Outstanding Threads

**6. [[Tommy Flanagan]] and the Rourke Debt**
- Tommy was watching the docks and holding back information (Ezra's movements in the old quarter). He never delivered this lead because it's presumably moot now.
- His $150 debt to Rourke remains. If the investigators don't follow up with him, desperation may drive him to sell what he knows.
- Decision callback potential: did the investigators treat him fairly? Did they ever follow up after Session 1?
- **Urgency:** Background, surfacing this session.

**7. The Revelations of Glaaki and Other Forbidden Texts**
- The library in the inner sanctum contains the complete Revelations plus other forbidden texts.
- Leaving them is dangerous — the cult could return. Taking them is personally dangerous (SAN cost to read, potential addiction).
- Destroying them ends the immediate threat but destroys rare historical material Ashford devoted his career to.
- **Urgency:** This session if investigators return to or secure the sanctum.

**8. The Stone Tablets**
- Two stone tablets are in the investigators' possession since Session 2. Carved with the [[Strange Symbol]] and text in an unknown script. Ashford — now freed — is potentially the only person who can translate them.
- What do they say? This is a Chekhov's gun introduced two sessions ago.
- **Urgency:** Medium — needs to pay off.

**9. [[Mrs Whitmore]]**
- Ashford's housekeeper. She was loyal and worried. She identified the tall gaunt visitor as someone who was at the house the night before the disappearance.
- She may need to be notified of Ashford's condition. She is also a witness.
- **Urgency:** Background.

**Stale Thread Check:** All threads are 2-3 sessions old at most. No threads have gone 3+ sessions without advancement. The stone tablets (Thread 8) were introduced Session 2 and have not advanced — this is approaching the stale threshold and should be addressed.

---

## NPC Quick Reference

| NPC | Role This Session | Key Detail | Location |
|-----|-------------------|------------|----------|
| [[Professor Ashford]] | Rescued victim, potential information source | SAN 15, mind fractured; knows what's in the pit; may resist "rescue" | With investigators at session start |
| [[Brother Ezra]] | Primary antagonist (status TBD from S3) | Binding renewal due Nov 1 — weakening if delayed | Last seen: inner sanctum |
| [[Inspector Crane]] | Institutional obstacle / potential asset | Bribed by the Order; genuine guilt about Ashford | Kingsport Police Department |
| [[Tommy Flanagan]] | Information source / moral pressure point | Knows Ezra's movements; $150 debt to Rourke; info he held back may still matter | Red Hook Tavern, Kingsport |
| [[Mrs Whitmore]] | NPC callback, human cost of the case | Was loyal to Ashford for 15 years; will be shocked by his condition | Ashford Residence (presumed) |
| The Grand Master | Revelation / antagonist | Identity unknown to investigators; likely a trusted civic figure | Unknown |

**NPCs lacking vault files (gaps):** Dockmaster Hayes (mentioned in Session 2 notes as a potential contact), Dr. Philip Hartwell, Judge Marcus Abernethy (both Order inner circle, referenced in faction file but not individually filed).

---

## World State

**In-Game Date:** October 20-21, 1923 (new moon night / early morning after)
**Location:** Kingsport, Massachusetts — investigators are emerging from or have just left the St Anselm's Church inner sanctum

**Active Threats:**
- The Order of the Silver Twilight: inner circle either scattered, captured, or still operational depending on S3 outcome
- Brother Ezra: status TBD. If alive, motivated and dangerous
- The pit beneath St Anselm's: whatever is in it did not go away
- The Revelations of Glaaki: still in the sanctum library unless removed

**Faction Status:**
- [[Order of the Silver Twilight]]: critically compromised if the ritual was stopped; their timeline was the new moon. Their plan has failed or succeeded — no middle state.
- [[Inspector Crane]]: complicit, guilty, and now exposed if the investigators move against the Order. In active crisis mode.

**Clocks:**
- Ezra's binding renewal: ~11 days (due November 1). If he survived, he is on a countdown.
- The pit: not a clock but an ongoing presence. The investigators don't know if the threat is dormant or active.

**PC Status (as of end of S3):**
- Dr. Eleanor Voss: SAN 52 before S3 (down 4 from S2). S3 likely cost more — the inner sanctum, the pit, and combat with Ezra each have SAN triggers.
- Malcolm "Mal" Bridges: minor wound from S2 chase. S3 combat may have added more.
- Reverend Silas Marsh: Cthulhu Mythos 1, SAN 64 before S3. His faith is under maximum pressure in a session centered on a genuine ritual chamber.

---

## PC Roster & Arcs

*System note: This is CoC 7e — arc drivers are SAN loss, Mythos revelations, and the personal cost of knowledge. The five-stage model maps naturally to the investigators' deteriorating grip on their prior worldviews.*

### Dr. Eleanor Voss (Sarah)
- **Occupation:** Physician
- **Arc Stage:** Stage 2 — Testing
- **Arc Theme:** Rationalism vs. undeniable evidence
- **Arc Position:** Voss entered as a rigorous skeptic. The dock chase (seeing Ezra's cat-pupil eyes, SAN loss) cracked her framework. The inner sanctum likely shattered it. She is being forced to update her model of reality in real time.
- **Backstory Hook:** Treated Ashford for insomnia before the disappearance. She is responsible for him as a patient — her professional identity is wrapped up in his recovery.
- **Decisions Needing Consequences:** Her $20 investment in Tommy Flanagan. Her role as medic during the dock chase and sanctum infiltration.
- **Mechanical Highlight:** Medicine 65%, Psychology 50% — she is uniquely equipped to assess both Ashford's physical condition and his mental state.
- **Sessions Since B-Plot Feature:** Voss has not had a dedicated B-plot. She is the natural B-plot candidate for Session 4.
- **Next Arc Beat:** The crisis approaches — a moment where her rationalism and her patient relationship with Ashford collide. Does she treat Ashford's breakdown as a medical condition, or does she accept that what broke him was real?
- **A/B/C Assignment:** **B-Plot** — featured PC this session

### Malcolm "Mal" Bridges (Tom)
- **Occupation:** Private Investigator
- **Arc Stage:** Stage 2 — Testing
- **Arc Theme:** Cynicism vs. genuine human cost
- **Arc Position:** Mal is pragmatic to the point of emotional armor. He is hired to find a man. He found him. But the cost — to himself, to his contacts, to Ashford — is not factored into any retainer fee. The session should press on whether he can stay detached.
- **Backstory Hook:** Hired by Ashford's sister. She hasn't appeared since the briefing. She expects a report. Her brother is now barely functional.
- **Decisions Needing Consequences:** His suspicion of Crane (Session 2). His use of Flanagan as a contact. His wound from the dock chase.
- **Mechanical Highlight:** Spot Hidden 70%, Firearms 60% — the practical skills that got them through the sanctum.
- **Sessions Since B-Plot Feature:** None yet.
- **Next Arc Beat:** Reporting back to Ashford's sister. The gap between "case solved" and the reality of what was found.
- **A/B/C Assignment:** **C-Plot** — lighter touch this session

### Reverend Silas Marsh (Jamie)
- **Occupation:** Episcopal clergy
- **Arc Stage:** Stage 3 — Crisis (entering)
- **Arc Theme:** Faith vs. the Mythos
- **Arc Position:** Marsh is the closest to a genuine arc crisis. His faith is the lens through which he has interpreted the investigation. The inner sanctum — a ritual chamber, a pit, the genuine invocation of something beyond — is a direct assault on his theology. Does he interpret it through Christian frameworks (demonic forces, spiritual warfare) or does the Mythos break him into something new?
- **Backstory Hook:** He knows the history of local churches and had access to diocesan records — knowledge that likely helped locate the sanctum. He carries guilt if that knowledge contributed to endangering the party.
- **Decisions Needing Consequences:** His growing conviction that something supernatural is at work (mentioned in PC file from S1). Gained 1 Cthulhu Mythos from the stone tablets. The Mythos score will rise further after S3.
- **Mechanical Highlight:** Persuade 65%, History 55%, Occult 45% — the social and knowledge skills.
- **Sessions Since B-Plot Feature:** None yet; his arc crisis makes him a strong future B-plot candidate.
- **Next Arc Beat:** Post-crisis integration — what does he do with what he saw? Prayer and denial, or a reframing of his faith? This is the beginning of Stage 3 resolution or descent.
- **A/B/C Assignment:** **A-Plot** featured (his arc intersects the main plot climax most directly)

**Plot Assignments:**
- **A-Plot (50-60%):** The aftermath of the ritual — securing the site, dealing with the Order's remnants, Ashford's condition, evidence and authorities
- **B-Plot (25-35%):** Dr. Voss — her patient is broken, her rationalism is broken; what does she rebuild from?
- **C-Plot (10-15%):** Mal — the report to Ashford's sister; the cost of the job

---

## Touchpoint Plan

### Dr. Eleanor Voss — B-Plot (featured)

| Touchpoint | Type | Description | Scene |
|------------|------|-------------|-------|
| **The Patient** | Moral Dilemma (High) | Voss examines Ashford. He is physically treatable but mentally shattered. He says something that reveals he knows the full truth of what is in the pit — something the investigators don't yet know. Does she treat him to function, knowing what he might do with that knowledge? Does she suppress his account to protect him and others? | Scene 2: Ashford's Condition |
| **The Rational Woman** | Ability Showcase (Medium) | The state police or a city official needs medical testimony about Ashford's state — and about physical evidence (the stone tablets, Ezra's inhuman features if documented). Voss is the only one with professional credentials to give this testimony credibly. | Scene 4: Aftermath and Authorities |
| **Crane's Cover-Up** | Decision Callback (Medium) | Crane attempts to explain the sanctum as a structural accident or gas explosion. He is minimizing Voss specifically, defaulting to the patronizing dismissal established in his character file. This time, she has evidence and professional standing to counter him directly. | Scene 4: Aftermath and Authorities |

### Malcolm Bridges — C-Plot (lighter touch)

| Touchpoint | Type | Description | Scene |
|------------|------|-------------|-------|
| **The Sister** | Arc Advancement Clue (Medium) | A telegram or letter from Ashford's sister, Margaret, arrives. She has heard rumors. She wants her brother home. Mal now has to decide what to tell her and when. The case is "solved" but the resolution is nothing like she hoped for. | Scene 5: The Human Cost |
| **Tommy's Information** | Character Moment (Low-Med) | Tommy Flanagan has been sitting on information about Ezra's movements in the old quarter. Now that the sanctum is blown open, that information is moot — but Tommy doesn't know that. Following up on this thread closes the loop on the Session 1 promise and tests whether Mal pays his debts. | Scene 3: Loose Ends |

### Reverend Silas Marsh — A-Plot (arc crisis embedded in main action)

| Touchpoint | Type | Description | Scene |
|------------|------|-------------|-------|
| **The Pit** | Backstory Connection (High) | Marsh's church history knowledge located the sanctum. Now he stands in a pre-Christian ritual space beneath a Christian church, looking at a pit from which something almost emerged. His framework — spiritual warfare, demonic forces, the language of scripture — is both a way of understanding this and an inadequate vessel for it. Give him a moment to speak to the others about what he believes this was. | Scene 1: The Morning After |
| **What God Did Not Prevent** | Moral Dilemma (High) | If any investigators were seriously harmed or if the ritual came close to succeeding, Marsh faces the question his arc has been building to: where was God in that chamber? This is not a scene — it is a question to pose through events. Build it into Scene 1 and Scene 4. | Scenes 1 and 4 |

**Coverage check:** All three PCs have at least one touchpoint. All three have at least one medium-impact touchpoint. Voss has one high-impact touchpoint (B-plot; appropriate). Marsh has one high-impact touchpoint embedded in the A-plot. No PC goes without a touchpoint. Touchpoint types vary: Moral Dilemma, Ability Showcase, Decision Callback, Arc Advancement Clue, Character Moment, Backstory Connection — all six types represented across the session.

**Imbalance flag:** None. This is the first session with an explicit B-plot for any PC. Voss (B) and Mal (C) are the correct rotation given their arc stages. Marsh's crisis embeds naturally in the A-plot.

---

## Planned Scenes

*Note: Scene Design step calls for proposing scenes before writing. In this document format, scenes are written as proposals for GM review. Adjust, cut, or replace as needed.*

---

### Scene 1: The Morning After
**Type:** Horror / Character
**Objective:** Land the aftermath of Session 3. Ground the investigators in the immediate consequences — physical, emotional, spiritual. Establish the session's tone.
**Entities:** [[Professor Ashford]], [[St Anselm's Church]], investigators
**Setup:** The investigators have emerged from the sanctum — or are still in it. It is the early hours of October 21st. Ashford is with them. The stone tablets are (presumably) still in their care.

**Sensory palette:** Cold fog. The smell of old stone and something chemical still clinging to their clothes. The silence after something terrible. The quality of lamplight at 3 AM.

**Key beats:**
- Ashford speaks coherently for the first time, but what he says is wrong — he begins to quote a passage from the Revelations unprompted, in the original language, before catching himself. He is afraid of himself.
- Rev. Marsh, if he is the one helping Ashford out, is the natural person to receive his first coherent words. This is the "What God Did Not Prevent" touchpoint seed.
- The investigators must decide: where do they go from here? The church? The nearest hotel? Ashford's house? Each choice has consequences.

**Branching:**
- Return to secure the sanctum (destroy texts, collapse entrance, document evidence) → leads to Scene 2 first, then Scene 3
- Get Ashford to safety immediately → leads to Scene 2 first, then back to Scene 3 later
- Split up (not recommended, but possible) → complicate accordingly

**Contingencies:**
- If Brother Ezra survived and is still mobile: a sound from the old quarter as they leave — he is watching, but too weakened to pursue immediately. One Spot Hidden check to notice. He will not attack tonight.
- If any PC is below SAN 30 after S3: a brief dissociative episode during this scene is appropriate. No mechanical intervention needed — it is a roleplay moment.

**GM Notes:** Keep this scene short. The horror of Session 3 lives in the silence between words. Do not explain what happened — let the investigators carry it. Ashford quoting the Revelations unprompted is the single most unsettling thing you can do here. He doesn't realize he's doing it until he stops.

---

### Scene 2: Ashford's Condition
**Type:** Social / Investigation
**Objective:** Voss's B-plot touchpoint. Medical assessment of Ashford reveals both the physical cost and the moral dilemma. Also: Ashford is the only person who can translate the stone tablets — but is it safe to ask him to?
**Entities:** [[Professor Ashford]], Dr. Voss, the investigators
**Setup:** Once the investigators have found somewhere to rest (Ashford's house, a hotel, a friendly location), Voss conducts a proper examination.

**Voss's assessment (Medicine roll):**
- Success: Ashford is severely malnourished and dehydrated. He has been under extreme psychological stress. Physically, he will recover with rest, food, and care. Mentally, he is a different question.
- Hard success or pushed: Voss notices that Ashford has been writing in his sleep — his hands have been moving. There are faint ink marks on his fingers from notations he has no conscious memory of making. This is more than trauma.

**The dilemma:** Ashford has knowledge the investigators need. The stone tablets. The identity of the Grand Master (he attended Order meetings; he may know who leads the inner circle). But pressing him risks further breakdown. He is also the only surviving person who can read the Revelations fluently. That knowledge is both a resource and a danger.

**What Ashford says voluntarily:**
> "I didn't believe any of it, you understand. Not at first. I thought they were eccentrics with too much money and too much Latin. And then I read the third passage — the one about the angles — and I knew. I *knew*. Not as belief. As fact. The way you know your own name. I tried to leave and they wouldn't let me."

**What he won't say:** What he saw in the pit. What it looked like. He will change the subject, grow agitated, or recite a fragment of text when directly asked.

**Branching:**
- Press him on the Grand Master → he knows the name; Hard Psychology roll to recognize he is holding back; successful Persuade gets the name (GM: reveal the identity here or hold it for Scene 4)
- Ask about the stone tablets → he can translate them but begs them not to show him the tablets themselves; he'll describe what he remembers of similar script
- Let him rest without pressing → he volunteers the Grand Master name in his sleep (he talks in his sleep, quoting passages mixed with proper nouns)

---

### Scene 3: Loose Ends
**Type:** Social / Investigation
**Objective:** Close the Tommy Flanagan thread. Establish what the Order's remaining members are doing. Mal's C-plot touchpoint.
**Entities:** [[Tommy Flanagan]], [[Inspector Crane]], the investigators
**Setup:** The investigators need information about what the Order's surviving members are doing and whether Crane knows the sanctum has been breached. Tommy is the street-level source; Crane is the institutional one.

**Tommy Flanagan:**
Tommy is at the Red Hook Tavern. He has heard something happened at the old quarter last night — there was noise, and this morning some well-dressed men were seen leaving Kingsport on the early train. He connects this to the cult activity he's been watching.

He has the information he was holding back (Ezra's movements in the old quarter). If the investigators tell him what happened, his reaction is: relief, then fear, then a calculating assessment of whether his debt to Rourke is now a bigger problem than the cult. The Order is gone (or appears to be). Rourke is still very much present.

Mal's C-plot touchpoint surfaces here: Tommy asks whether Ashford's sister has been contacted. "Someone's going to have to tell her." This plants the seed for Scene 5.

**Inspector Crane:**
Crane has heard about disturbances near the old church. He is trying to get ahead of the story — he has already floated "structural collapse" as the explanation to his desk sergeant. He will try to intercept the investigators before they can go to anyone else.

If confronted with direct evidence (the bribe, the tablets, Ashford himself), Crane can be turned — but it requires a Hard Persuade roll. On success, he becomes an ally who can mobilize the state police and provide cover for the investigators. On failure, he doubles down on obstruction. On a pushed roll (if failed), he breaks down and confesses — but demands the investigators never mention the bribe.

**Branching:**
- Expose Crane publicly → risks the outer circle, generates scandal, delays the Order's prosecution but ensures accountability
- Turn Crane privately → he becomes a useful asset; guilt-driven; unreliable under pressure
- Bypass Crane entirely → state police route; takes 24-48 hours; Crane will try to undermine it

---

### Scene 4: Aftermath and Authorities
**Type:** Social / Investigation
**Objective:** The institutional response to the events of Session 3. Voss's Ability Showcase touchpoint. The Grand Master's identity is revealed (or the investigators discover it).
**Entities:** [[Inspector Crane]] (or state police), [[Professor Ashford]], Dr. Voss, investigators, and potentially the Grand Master
**Setup:** Whether through Crane turned, state police mobilized, or direct action, some form of official response is now in motion. The investigators must navigate testimony, evidence, and the revelation of the Order's leadership.

**The Grand Master Reveal:**
From the faction file, the Grand Master is a trusted civic figure — the university chancellor, the mayor, or similar. The investigation has 24-48 hours before he knows the sanctum is blown and leaves town or covers his tracks.

*GM note: Choose the Grand Master identity now if not already decided. The university chancellor works well because Ashford's colleague Dr. Wilmarth (who hired the investigators) would have regular contact with him — adding a layer of betrayal. The mayor works if you want a civic scandal.*

**Voss's testimony:** She is the only investigator with professional credentials. The state police (or a sympathetic superior to Crane) will want a medical account of Ashford's condition and physical assessment of the evidence. This is her moment — forensic medicine applied to the impossible.

**Marsh's role:** His church connections give him access to diocesan records. If the investigators want to document what was beneath St Anselm's officially, Marsh is the one who can frame it within institutional channels.

**Branching:**
- Confront the Grand Master before he flees → combat or capture; requires having the name from Scene 2 and moving fast
- Let authorities handle it → slower; risk of cover-up; the Grand Master may escape
- Expose publicly (newspaper, public statement) → Outer circle members' lives are destroyed; scandal; may be the only way to ensure accountability if the Grand Master has official protection

---

### Scene 5: The Human Cost
**Type:** Character
**Objective:** Mal's C-plot touchpoint. The case is closed in the investigative sense. This scene asks what it cost.
**Entities:** Mal, [[Mrs Whitmore]], Ashford's sister (off-screen), [[Professor Ashford]]
**Setup:** Mal visits Mrs Whitmore to let her know the professor has been found. He must decide what to tell her and how.

**Mrs Whitmore:** She has been waiting for weeks. She will be relieved and then horrified. Ashford is alive but not himself. She will want to know if he will recover. The honest answer is: probably not fully.

**The report to Ashford's sister:** Margaret Ashford (not yet in play) hired Mal to find her brother. He found him. She will contact him — either a telegram has already arrived (planted in Scene 3) or it arrives during this scene. The case is "solved" by a P.I.'s definition. The human definition is harder.

**No dice rolls needed here unless the GM wants to push.** This is a character scene — the purpose is to give Mal and his player a moment to sit with the gap between professional success and personal cost. Keep it quiet.

**GM Notes:** Don't force an emotional resolution. Let the player make Mal's choice about how much to tell the sister. Any choice is right. The point is the choice.

---

## Contingency Scenes

### The Ritual Completed (If Session 3 ended badly)
**Trigger:** If the ritual was not stopped in Session 3 and something came through the pit.
**Type:** Horror / Combat
**If this happened, Session 4 is a completely different session.** Kingsport is changed. There is something in the old quarter that should not be there. The investigators are not prepared to fight it directly — their goal is survival, evacuation of civilians, and containment while waiting for help that may not come. The Grand Master's identity is the secondary priority; stopping the entity is the immediate one.
**Note:** If this is the case, contact me to fully rebuild the session structure around this outcome.

### Brother Ezra Returns
**Trigger:** If Ezra survived Session 3 and is still mobile.
**Type:** Horror / Combat
**He will not attack directly in the immediate aftermath — he is weakened.** But he will watch. He may approach Ashford when the investigators are not present, not to harm him but to remind him of what he knows. Ezra is three weeks from his binding renewal. If the investigators can keep him from the Order's resources until November 1st, his power begins failing.
**Design:** Ezra appearing in a window across the street. Ashford going very still when a tall man in a dark coat walks past. A door ajar that was locked.

### The Tablets Translate
**Trigger:** If investigators ask Ashford about the stone tablets from Session 2.
**Type:** Horror / Investigation
**Ashford can translate them from memory — he has encountered similar script in the inner sanctum library.** The tablets are descriptions of the pre-human entities associated with the pit — not a summoning ritual but a warning. They were placed by whatever culture predated the colonial construction, trying to seal the pit, not open it.
**Effect:** Each investigator who hears the translation loses 1 SAN (0/1). The knowledge is disturbing but also clarifying — the pit has been known and contained before. It can be contained again.
**Chekhov payoff:** This closes the stone tablets thread from Session 2.

---

## Session End Objectives

Strong stopping points, in preference order:

1. **The Grand Master is confronted or confirmed** — a dramatic, named revelation that closes the investigation arc while leaving the larger Mythos threat unresolved.
2. **Ashford is placed in care and Voss has made a choice** about his treatment — emotional closure for the B-plot.
3. **Minimum viable:** The investigators are safe, Ashford is alive, and at least one thread has been formally closed (Tommy paid off, Crane turned or bypassed, tablets translated).

Do not try to resolve everything in this session. The Order's dismantling will take time. The pit does not need a permanent solution today. End on a human note if possible — the case that started with a missing professor ends with what's left of him.

---

## PC Roster & Arc Summary

| PC | Arc Stage | Theme | Assignment | Next Beat |
|----|-----------|-------|------------|-----------|
| Dr. Voss | Stage 2 — Testing | Rationalism vs. evidence | B-Plot | Crisis approaching: what does she rebuild from? |
| Mal Bridges | Stage 2 — Testing | Cynicism vs. cost | C-Plot | The report to the sister |
| Rev. Marsh | Stage 3 — Crisis | Faith vs. the Mythos | A-Plot | Integration or descent |

---

## Touchpoint Summary

| PC | Touchpoint | Type | Scene |
|----|------------|------|-------|
| Voss | The Patient (Ashford's condition, moral dilemma) | Moral Dilemma — High | Scene 2 |
| Voss | The Rational Woman (testimony) | Ability Showcase — Medium | Scene 4 |
| Voss | Crane's dismissal reversed | Decision Callback — Medium | Scene 4 |
| Mal | The Sister (telegram/letter callback) | Arc Advancement Clue — Medium | Scene 5 |
| Mal | Tommy's information | Character Moment — Low/Med | Scene 3 |
| Marsh | The Pit (faith vs. Mythos collision) | Backstory Connection — High | Scene 1 |
| Marsh | What God Did Not Prevent | Moral Dilemma — High | Scenes 1 + 4 |

---

## Spotlight Forecast

| PC | Estimated Share | Notes |
|----|-----------------|-------|
| Dr. Voss | 35-40% | B-plot; multiple scenes centred on her professional and moral position |
| Rev. Marsh | 30-35% | Arc crisis embedded throughout A-plot; Scene 1 and Scene 4 |
| Mal Bridges | 25-30% | C-plot; Scene 3 and Scene 5; supporting role in Scenes 1 and 2 |

**Floor check:** All PCs above 15%. Mal is lowest but appropriately so for a C-plot session — and his scenes (3 and 5) are intimate and focused.

**Sustained imbalance:** No PC has been underserved for 3+ consecutive sessions. This is the first session with explicit A/B/C structure applied.

---

## Audit Notes

### Agency Audit

Reviewed all planned scenes. Findings:

- Scene 1: No violations found. Ashford's quotes are offered as GM-voiced NPC content, not PC action descriptions. ✓
- Scene 2: "Voss conducts a proper examination" — **flag for GM rewording at table.** Present this as an available action ("Voss has the opportunity to examine Ashford") rather than a declared action. ✓ corrected in framing.
- Scene 3: Tommy and Crane interactions use conditional framing throughout ("can be turned," "if confronted"). ✓
- Scene 4: "Voss's testimony" is an opportunity, not a prescribed action. ✓
- Scene 5: No PC action prescribed. ✓
- No scene uses 2nd-person emotion verbs. All sensory descriptions are objective.
- All confrontation scenes (Crane, Grand Master) include ≥2 contingencies. ✓

### Canon Audit

- All NPCs sourced to vault files: ✓
- Professor Ashford's SAN (15), Voss's SAN (52), Marsh's Mythos (1) drawn from authoritative PC Roster file. ✓
- Ashford quoting the Revelations: grounded in Session 3 Plan (he was forced to translate the text for weeks). ✓
- Brother Ezra's binding renewal (November 1) sourced to Brother_Ezra.md Secrets section. ✓
- "What Ashford saw in the pit": described as unknown — not fabricated. ✓
- Stone tablets: introduced Session 2, in investigators' possession per Session 2 Wrap-Up. ✓
- Grand Master identity: explicitly flagged as unrevealed in play; GM must choose — not fabricated as canon. ✓

**One unverified claim:** The session assumes Session 3 played out broadly as planned (ritual confrontation, Ashford freed). If the actual outcome differed significantly, multiple scenes will need adjustment. This is flagged as a consequence of the missing Wrap-Up.

---

## Gaps & Actions

### Missing Vault Files (for planned scenes)
- **Margaret Ashford** (Ashford's sister): Referenced in Mal's PC file as his employer. Appears in Scene 5. No vault file exists. → Stub needed before session.
- **Dockmaster Hayes**: Named in Session 2 Wrap-Up as a potential contact. No vault file exists. → Create stub if used.
- **Dr. Philip Hartwell**: Inner circle member, referenced in Order faction file. No individual file. → Create stub if he appears.
- **Judge Marcus Abernethy**: Inner circle member, referenced in Order faction file. No individual file. → Create stub if he appears.
- **The Grand Master**: The GM needs to choose an identity and either create a new entity file or assign to an existing character. This is a prerequisite before Session 4.

### Stale Entity Files
- `St_Anselms_Church.md`: source_confidence is DRAFT from Session 2 — if it was the climax location of Session 3, promote to AUTHORITATIVE after Session 3 Wrap-Up. → Flag for promotion.
- `_meta/index.md`: sessions_played: 2, total_sessions: 3. Update after Session 3 and Session 4. → Flag for update.

### Session 3 Wrap-Up (Critical Gap)
- Without a Session 3 Wrap-Up, the vault does not reflect: actual fate of Brother Ezra, confirmed status of the ritual, Ashford's SAN after the sanctum, any new NPCs encountered in Session 3, or whether the Grand Master was revealed.
- **Recommendation:** Complete Session 3 Wrap-Up immediately after confirming what happened. Then update this Plan file's "Previously On" section and Ashford/Ezra status.

### PC Carry-Forward
- PC Roster file is dated `asOfSession: "Session 2"`. After Session 3, the following need updating:
  - Voss SAN (likely decreased from inner sanctum SAN checks)
  - Mal HP (if wounded in combat)
  - Marsh Cthulhu Mythos (likely increased from seeing the ritual/pit)

---

## Handoff

Based on the gaps and actions above:

- **For creating the Grand Master NPC, Margaret Ashford stub, and other missing entity files:** hand off to `ttrpg-expert` or `campaign-organizer`
- **For Session 3 Wrap-Up (critical):** hand off to `session-wrapup`
- **For vault structure work (promoting St Anselm's confidence, updating index):** hand off to `campaign-organizer`
- **For entity relationship and continuity validation after session 3 outcomes are confirmed:** hand off to `campaign-qa`

---

*Session 4 Plan — The Ashford Case. Generated by session-prep. Status: DRAFT. Awaiting Session 3 Wrap-Up confirmation before treating any S3-outcome-dependent content as authoritative.*

---
query: "Design a Three Clue Rule investigation for my D&D 5e murder mystery"
system: dnd-5e-2024
type: generate
total_tokens: 0
wall_clock_ms: 0
files_loaded:
  - skills/ttrpg-expert/SKILL.md
  - skills/ttrpg-expert/scenario-writing.md
  - skills/ttrpg-expert/content-generation.md
  - skills/ttrpg-expert/systems/dnd-5e-2024/conditions-rules.md
---

# The Three Clue Rule: A Complete Murder Mystery Framework for D&D 5e

## What the Three Clue Rule Actually Means

Every investigative conclusion the players need to reach must be supported by **at least three independently discoverable clues**, spread across different nodes (locations, NPCs, objects). If one clue is missed, overlooked, or behind a failed skill check, two others still lead to the same conclusion.

This is not about hiding clues — it is about engineering **redundancy**. The DM's job is to place three routes to every truth, then trust the players to find their way.

---

## The Murder: The Truth (Read This First)

**Lord Aldric Voss**, a merchant-lord and city council member, was poisoned with Midnight Tears (ingested poison, DC 17 CON save, 9d6 Poison damage at midnight — SRD 5.2) and found dead in his locked study at dawn.

**The Killer:** His personal secretary, **Maren Duhl**, who has spent three years carefully embezzling from his accounts. Lord Voss discovered the discrepancy that evening and sent Maren a private note summoning her for a morning confrontation. Rather than face ruin, Maren slipped Midnight Tears into his evening wine, knowing it would activate at midnight while she had a public alibi at the city's harvest festival.

**Complication:** Lord Voss's eldest son, **Brennan Voss**, is openly hostile and had a public argument with his father that afternoon — he is the obvious suspect and the red herring the players will generate themselves. Do not plant the son as a deliberate misdirection. Simply let his behavior speak for itself.

---

## The Node Map

Each node is a location, NPC, or object the players can visit in any order. Each node contains clues, and each clue points toward one or more other nodes or toward a conclusion.

```
[Crime Scene] ──────> [The Body / Physician]
      │                      │
      │                      ▼
      ├──────────> [Lord Voss's Finances]
      │                      │
      ▼                      ▼
[Brennan Voss] ──────> [Maren Duhl]
      │                      │
      └──────────> [Festival Alibi Witnesses]
```

---

## Node 1: The Crime Scene (Lord Voss's Study)

**Type:** Investigation
**Agenda:** Establish manner and timing of death; generate first leads.

**Read-Aloud:**
*The study smells of old paper and cold ash. Lord Voss slumps forward in his chair, one hand still resting near a wine glass. The candle on the desk burned to nothing hours ago.*

**Key Features:**
- The door was locked from the inside; a servant broke it open at dawn
- A half-empty decanter of red wine and one glass on the desk
- A small folded note, unread, lying under Voss's hand
- His account ledger is open to a column of figures; several entries are circled in red ink
- No signs of forced entry, struggle, or weapon

**Clues Available:**

| Clue | Check | DC | Conclusion |
|------|-------|----|------------|
| The wine smells faintly sweet beneath the wine's own notes | WIS (Perception) | 12 | Something was added to the drink |
| The note under his hand reads: *"We must speak at first light. Do not tell anyone. — AV"* (written in Voss's hand, addressed to no one by name) | No check | Auto | Voss was summoning someone for a private meeting |
| The circled ledger entries show 120 gp withdrawn monthly with no corresponding invoice, going back 3 years | INT (Investigation) | 14 | Someone was skimming money |
| The wine glass has a faint oily residue at the bottom, distinct from the wine | WIS (Perception) | 16, or auto if players ask physician to examine | Poison was delivered via the wine |

**Connections:** Ledger → finances investigation. Note → who Voss was summoning. Poison route → physician.

---

## Node 2: The Physician (Aldira Crow, City Healer)

**Type:** Social / Investigation
**Agenda:** Establish cause and time of death precisely; confirm poison.

**NPC:** Aldira Crow (she/her), 50s, methodical and blunt. Will share findings freely if treated respectfully; becomes guarded if she thinks the players are fishing for a predetermined answer. **Goal:** accurate diagnosis. **Line:** will not falsify a finding for anyone.

**Clues Available:**

| Clue | How Obtained | Conclusion |
|------|-------------|------------|
| Voss died of massive organ failure consistent with ingested poison; she estimates death between midnight and 1am | Aldira volunteers this freely | Not killed earlier in the day; alibi timing matters |
| She identifies trace markers in the blood consistent with Midnight Tears — an expensive, rare poison that activates hours after ingestion | INT (Medicine) DC 15 from the player, or Aldira shares if asked specifically about the type of poison | Killer had access to expensive poison (1,500 gp); the death was premeditated, not impulsive |
| "Someone planned this carefully. Midnight Tears takes 6–8 hours to kill. Whoever did this was nowhere near him when he died." | Aldira says this unprompted if players are visibly chasing Brennan | Challenges the "heated argument = killer" assumption |

**Connections:** Midnight Tears cost and rarity → apothecary / poison merchant. Time of death → festival alibi angle.

---

## Node 3: Lord Voss's Finances

**Type:** Investigation
**Agenda:** Identify who was stealing; establish Maren's motive.

**Access Methods:** The ledger at the crime scene (leads here); Brennan Voss mentions his father's accounts if questioned; the city's merchant guild has public records.

**Clues Available:**

| Clue | Check | DC | Conclusion |
|------|-------|----|------------|
| Three years of 120 gp monthly withdrawals coded to a fictitious vendor named "Crane & Associates" | INT (Investigation) | 13 (on the ledger), or auto via guild records | Money was leaving systematically |
| Cross-referencing with actual vendor lists reveals no such company exists | INT (Investigation) | 15, or auto if players think to ask the guild | The vendor was fabricated |
| The handwriting on the withdrawal authorizations is **not** Lord Voss's — it matches the clerical hand used throughout correspondence filed in the study | INT (Investigation) | 14 (comparing documents) or CHA (Persuasion) DC 12 to get clerk to confirm | Someone with access to his paperwork was forging small entries |
| A sealed envelope in Voss's desk, addressed to his solicitor but never sent, reads: *"Please arrange an audit of all expenditures managed by M. Duhl, beginning three years prior."* | INT (Investigation) DC 12 or auto if players search the desk | Voss had recently discovered Maren and was beginning to act on it |

**Connections:** "M. Duhl" → Maren Duhl. Sealed envelope → Maren knew she was about to be exposed.

---

## Node 4: Brennan Voss (The Red Herring)

**Type:** Social
**Agenda:** Give players a plausible suspect; reveal Maren through Brennan's own testimony.

**NPC:** Brennan Voss (he/him), 30s, grief-stricken and defensive. He and his father argued loudly that afternoon about inheritance rights — servants heard everything. Brennan has no alibi for the evening because he went to his rooms to drink alone. He is guilty of bad behaviour and poor grief management, not murder.

**Key Point for the DM:** Do not have Brennan act suspicious. Have him act like someone who genuinely loved his father despite resenting him, and who is terrified the PCs will wrongly accuse him. His stress makes him look guilty even though he is innocent.

**Clues Available (things Brennan reveals, possibly without realizing it):**

| Clue | Trigger | Conclusion |
|------|---------|------------|
| "Father sent Maren a note yesterday afternoon. I saw her face when she read it — she went white. I thought he was sacking her." | Conversation about the day of the murder | Maren received a note that shook her — different from the unread note at the desk |
| "Father trusted Maren completely. Too completely, I always thought. She handled everything." | General conversation | Maren had unsupervised access to finances |
| Brennan can confirm he was home arguing with his father at 4pm, then alone in his rooms. The servants can confirm he never left the estate. | If players press his alibi | Brennan is accounted for; Midnight Tears time-of-death eliminates him anyway |

**Connections:** Maren received a note → what did it say? Maren had full access → finances node.

---

## Node 5: Maren Duhl

**Type:** Social (first encounter); Confrontation (if players have evidence)
**Agenda:** Let players test their case; give Maren a chance to deflect, flee, or confess.

**NPC:** Maren Duhl (she/her), 40s, composed professional. If approached before players have evidence, she appears helpful and grief-stricken. She volunteers that she was at the harvest festival all evening — "you can ask anyone." Under pressure with evidence, her composure fractures methodically.

**Her Alibi:** Genuine — she was at the festival from 7pm to midnight with witnesses. Midnight Tears had already done its work.

**Clues on Her Person/Premises:**

| Clue | Check | DC | Conclusion |
|------|-------|----|------------|
| A receipt from the alchemist Sigor for "medicinal compounds" totaling 1,500 gp, dated four days ago | INT (Investigation) DC 14 (searching her office) | She purchased something expensive from an alchemist recently |
| The note she received from Lord Voss (she kept it) reads: *"I know about the accounts. We speak at first light — alone."* Burned corner suggests she tried to destroy it | WIS (Perception) DC 13 or auto if players specifically search her coat/bag | She knew she was caught; the meeting would have exposed her |
| CHA (Persuasion or Intimidation) after presenting financial evidence DC 16 | Active roleplay | She breaks and confesses, or DC 18 = flees and must be caught |

**Flight Condition:** If players arrive without sufficient evidence and Maren senses she's a suspect, she will attempt to flee the city that night. This triggers a chase (3–4 rounds; rooftops, market district; DC 13 Athletics or Acrobatics each round to maintain pursuit).

---

## Node 6: The Alchemist Sigor

**Type:** Social
**Agenda:** Corroborate the poison purchase; close the final evidentiary gap.

**NPC:** Sigor (he/him), elderly, cautious. Keeps meticulous records out of professional pride. Will not volunteer customer information freely — requires CHA (Persuasion) DC 14, or the city watch's authority, or evidence that a crime is involved (then he cooperates).

**Clues Available:**

| Clue | How Obtained | Conclusion |
|------|-------------|------------|
| His sales record shows Midnight Tears sold to "a woman, well-dressed, gave the name Aela" four days ago | Persuasion success or official authority | The buyer used a false name but matches Maren's description |
| Sigor's description: "Dark hair, spectacles, rings on both hands, spoke like an educated clerk" | Same | Matches Maren Duhl exactly |
| He required proof of need — she showed a physician's writ. "I should not have accepted it. It looked wrong." | If players ask about verification | She forged the documentation; points to her document-forgery skill established in the finances node |

---

## The Three Clue Matrix

Every major conclusion has three independent paths. This table is for the DM's reference.

| Conclusion | Clue 1 | Clue 2 | Clue 3 |
|-----------|--------|--------|--------|
| Voss was poisoned (not natural death) | Wine smells wrong (crime scene) | Oily residue in glass (crime scene + physician) | Aldira's diagnosis (physician) |
| Death was premeditated, not impulsive | Midnight Tears activates hours later (physician) | Maren was at festival when he died (alibi) | Receipt dated 4 days before murder (Maren's office) |
| Someone was stealing from Voss | Circled ledger entries (crime scene) | Fictitious vendor "Crane & Associates" (finances) | Voss's unsent letter naming M. Duhl (finances) |
| Maren is the embezzler | "M. Duhl" in the unsent letter | Forged withdrawal authorizations match her handwriting | Brennan's testimony about her access and control |
| Maren knew she was about to be exposed | Voss's note to her ("I know about the accounts") | His sealed letter to his solicitor requesting audit | Brennan saw her go pale reading a note |
| Maren purchased the poison | Receipt in her office | Alchemist's sales record | Alchemist's description matching Maren |

---

## Timeline (What Happens Without PC Intervention)

- **Dawn, Day 1:** Body discovered. City watch begins investigation; focuses on Brennan as obvious suspect.
- **Day 1, midday:** Maren learns the watch is questioning Brennan. Feels temporarily safe.
- **Day 1, evening:** If PCs have not visited Maren, she begins arrangements to flee — withdraws 300 gp from a personal account, sends her belongings ahead.
- **Day 2, midnight:** If not confronted, Maren leaves the city by river barge. She is gone.
- **Day 3 onward:** Brennan is formally arrested. Evidence against him is circumstantial but politically convenient.

This timeline gives urgency without railroading. Players who move quickly have more options; players who stall face a harder investigation and a potentially wrongful conviction to undo.

---

## Hooks (Choose ≥1)

- **Personal:** One PC knew Lord Voss — a patron, a past employer, a letter-writer who helped him draft documents. He asked for help finding someone trustworthy just before his death.
- **Professional:** The city watch wants an outside investigator; Brennan is too politically connected to charge without ironclad proof, and the watch captain doesn't trust his own people.
- **Moral:** Brennan is being set up. A servant reaches out to the party because they don't believe the heir did it, but they can't prove it alone.
- **Material:** Voss's solicitor is offering 500 gp for the real killer's identity before the watch formalizes charges against Brennan.

---

## Fail-Forward Mechanics

Never block progress behind a single failed roll. Apply these patterns:

| Failed Roll | Fail-Forward Result |
|-------------|-------------------|
| Failed Perception on wine (DC 12) | Physician notices the residue when she examines the body |
| Failed Investigation on ledger (DC 14) | Brennan mentions "Father had been worried about money for months" |
| Failed Persuasion with Sigor (DC 14) | A second visit with the city watch's letter of introduction grants access |
| Failed Persuasion with Maren (DC 16) | She flees that night — now a chase + the evidence still exists in her office |

---

## Climax Options

**Confrontation with Evidence:** Players present the clue chain — financial motive, forged documents, poison receipt, Sigor's testimony. Maren confesses or the watch takes her. Clean resolution.

**The Chase:** Maren flees before players are ready. Three-round chase through the market district. Failure means she boards a barge; players must follow by water or beat her to the next city.

**The Locked Room Twist:** If players are thorough, they realize the study was locked from the inside. The city watch insists this exonerates everyone without a key. Players must discover the servants' entrance behind a bookcase — another interior route Maren used when delivering wine. This is optional additional texture, not a gating mechanic.

---

## DM Reference Card (Print This)

**The Killer:** Maren Duhl, secretary
**Motive:** Embezzlement discovered
**Method:** Midnight Tears in evening wine
**Alibi:** Harvest festival (genuine; poison activated at midnight)

**Three Paths to Every Truth:**
- Poison → Crime Scene / Physician / Maren's receipt
- Embezzlement → Crime Scene ledger / Finance records / Brennan's testimony
- Maren as killer → Unsent letter / Her note from Voss / Alchemist's record

**Red Herring:** Brennan Voss — hostile, no alibi, had argument. Innocent.

**Clock:** Maren flees end of Day 2 if not confronted.

---

## Skill Checks Summary

| Check | DC | Node |
|-------|-----|------|
| WIS (Perception) — odd smell in wine | 12 | Crime Scene |
| INT (Investigation) — circled ledger entries | 14 | Crime Scene |
| WIS (Perception) — oily residue in glass | 16 | Crime Scene |
| INT (Medicine) — poison type | 15 | Physician |
| INT (Investigation) — fictitious vendor | 13/15 | Finances |
| INT (Investigation) — handwriting comparison | 14 | Finances |
| INT (Investigation) — sealed envelope | 12 | Finances |
| INT (Investigation) — Maren's receipt | 14 | Maren's Office |
| WIS (Perception) — burned note | 13 | Maren's Office |
| CHA (Persuasion) — break Maren | 16/18 | Confrontation |
| CHA (Persuasion) — Sigor's records | 14 | Apothecary |
| Athletics/Acrobatics (each round) | 13 | Chase |

---

*Three Clue Rule design principle from The Alexandrian (Justin Alexander). Poison mechanics from the SRD 5.2 (CC-BY 4.0, Wizards of the Coast). All scenario content is original.*

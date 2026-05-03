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
---

# The Three Clue Rule — D&D 5e Murder Mystery Design Guide

## What the Three Clue Rule Is

Every investigative conclusion your players need to reach must be supported by **at least three independently discoverable clues**, each pointing to the same conclusion via a different source, method, or location. If the players miss one clue — fail a roll, skip a room, antagonize an NPC — two more still lead them to the same place.

This is not redundancy. It is **structural insurance against a single bad roll halting your mystery cold**.

The rule comes from Justin Alexander (The Alexandrian) and is the single most important design principle for investigation scenarios. It applies at every node of your mystery, not just the final reveal.

---

## Murder Mystery Structure: Node-Based Design

Do not prep a plot. Prep a **situation**: the murder, the cast, the locations, the clues. The players determine what happens.

### The Truth (Write This First)

Before placing any clues, write out everything that actually happened — for the GM's eyes only. This is your anchor. Every clue must be consistent with it.

**Example Truth:**
> Lord Aldric Vanthorpe was poisoned by his business partner, Magistrate Sorin Crane, using Night's Veil (a rare contact poison extracted from shadowberries). Crane needed Vanthorpe dead before he could expose embezzlement from the city's road-building fund. Crane's personal alchemist, Thessaly Ward, brewed the poison and applied it to Vanthorpe's signet ring weeks ago. Crane does not know that Vanthorpe's steward witnessed him planting the ring.

With the truth locked, every clue you write is traceable to a real fact.

---

## The Node Map

Structure your mystery as interconnected nodes. Each node is a **location, NPC, or document** the players can investigate. Nodes contain clues that point to other nodes or conclusions.

```
[Crime Scene]
    |   |
    |   +---> [Victim's Study]
    |               |
    |               +---> [The Alchemist - Thessaly Ward]
    |                             |
    +---> [Magistrate's Office]   +---> [CONCLUSION: Crane is the killer]
              |                   |
              +---> [City Records] +
```

**Every arrow represents a clue.** Every conclusion needs at least three arrows pointing to it from different nodes.

### Core Nodes for a Murder Mystery

| Node | What It Is | Primary Clues |
|------|-----------|---------------|
| Crime Scene | Where the body was found | Physical evidence, wound analysis |
| Victim | The deceased's home/workplace/allies | Motive evidence, correspondence |
| Suspects | NPCs with opportunity, motive, or means | Contradictions, reveals |
| Witnesses | Bystanders who saw something partial | Partial confirmation, new leads |
| Records | Documents, ledgers, official papers | Paper trail, alibi contradictions |
| The Killer | Final confrontation node | All clues converge here |

---

## Building the Three Clue Rule in Practice

### Step 1: Identify Every Conclusion Players Must Reach

List the logical steps from "we've been asked to investigate a murder" to "Magistrate Crane is the killer." Each step is a conclusion that needs three clues.

**Example Conclusions:**
1. The victim was poisoned, not killed by a fall (cause of death)
2. The poison was Night's Veil, applied via the signet ring
3. Night's Veil requires a skilled alchemist to produce
4. Magistrate Crane had motive (the embezzlement)
5. Crane had access to the alchemist (Thessaly Ward)
6. Crane planted the ring

### Step 2: Assign Three Clues to Each Conclusion

For each conclusion, write three clues from **different sources**. Mix:
- **Physical evidence** — found at locations via Perception/Investigation
- **NPC testimony** — gathered via Persuasion/Insight or just talking
- **Documents** — found by searching or Thieves' Tools/magic
- **Magic** — Detect Poison, Speak with Dead, Divination spells

**Conclusion 1: Death by poisoning**
- Clue A (Physical): The court physician's initial report says "cardiac arrest," but a DC 14 Medicine check on the body reveals discolouration on the right hand inconsistent with heart failure.
- Clue B (NPC): The victim's personal valet recalls Vanthorpe complained of "numbness in his ring hand" three days before death.
- Clue C (Document): Vanthorpe's private diary entry from the week prior — "A strange tingling when I work at my desk. Must ask Aldus about the new hand cream."

**Conclusion 2: Night's Veil via the signet ring**
- Clue A (Physical): A DC 16 Arcana or Nature check on the recovered signet ring detects trace residue of shadowberry extract. Alternatively, Detect Poison reveals it automatically.
- Clue B (NPC): An herbalist in the market district recognizes the scent description from the body and names Night's Veil. She mentions it must be applied to an object the victim touches regularly.
- Clue C (Document): A pamphlet in the city library on "Poisons of the Shadow Vale" — an esoteric text, DC 13 Investigation to find — describes Night's Veil's delivery vector.

**Conclusion 3: Required a skilled alchemist**
- Clue A (NPC): The herbalist (above) says "No hedge witch brewed this. You want a licensed alchemist — this is refined work."
- Clue B (Document): A trade guild registry shows only four licensed alchemists in the city capable of extracting contact poisons.
- Clue C (Physical): The residue on the ring shows precise concentration — a DC 14 Arcana check confirms this is not amateur work.

**Conclusion 4: Crane had motive**
- Clue A (Document): Vanthorpe's personal ledger contains entries flagging discrepancies in road-fund invoices, with a note: "Speak to Crane. This cannot stand."
- Clue B (NPC): Vanthorpe's solicitor reveals a meeting was scheduled for the morning after the death — "Lord Vanthorpe told me he intended to confront someone about stolen money."
- Clue C (Document): City road-fund records (DC 15 Investigation to interpret) show Crane's contractor approvals generated 3,000 gp in phantom invoices.

**Conclusion 5: Crane employed Thessaly Ward**
- Clue A (Document): The alchemist guild registry (one of four names) includes Thessaly Ward, listed at an address in the merchant quarter — and a notation that her license is sponsored by Magistrate Crane's office.
- Clue B (NPC): Ward's neighbour saw Crane's personal coach outside her shop three weeks ago.
- Clue C (NPC): A junior clerk at Crane's office, if befriended or pressed (DC 12 Persuasion), recalls delivering a sealed package to "the alchemist on Coppergate Lane."

**Conclusion 6: Crane planted the ring**
- Clue A (NPC): Vanthorpe's steward — the key witness — saw Crane alone in the study during a dinner party two weeks prior. He was afraid to come forward. DC 12 Persuasion to gain his trust.
- Clue B (Physical): A wax seal impression in Vanthorpe's desk drawer was made by Crane's personal signet (DC 14 Investigation to notice the faint impression; players who have seen Crane's seal recognise it).
- Clue C (Document): Ward's workshop, if searched, contains a receipt for "bespoke ring-coating service, client: SC" dated six weeks prior.

---

## The Proactive Clue Rule

If the players stall — if they've gathered some clues but haven't moved to the next node — the **situation moves to them**. The world doesn't wait.

Proactive clue triggers for this mystery:
- Crane's enforcer visits the steward to "remind him to stay quiet" — the players witness or hear about this, pointing straight at the steward as a source of damaging information.
- Ward flees the city once she realizes investigators are asking questions — her sudden departure is itself a clue that she fears exposure.
- Another city official approaches the players, warning them off the road-fund audit — which confirms something is buried there.

---

## Key NPCs

### Magistrate Sorin Crane (Villain)
**Role:** The killer. Corrupt city official.
**Goal:** Suppress the embezzlement investigation. Get the players to close the case as an accidental death.
**Plan:** Frame it as a heart attack. Discredit any investigation. Use legal authority to obstruct.
**Reaction:** Cooperative and helpful if players respect his authority. Threatening if they close in. Violent only as last resort (he'll use proxies).
**Escalation:** Attempts to have a key witness intimidated, then bribed, then vanished if players don't intervene.
**Stat Block Tier:** Use Noble (MM, CR 1/8) plus Assassin bodyguard (MM, CR 8) for a confrontation scene.

### Thessaly Ward (Alchemist, Reluctant Accomplice)
**Role:** Brewed the poison. Does not know a man died; Crane told her it was a "sleeping draught for a difficult business meeting."
**Goal:** Protect herself. She is terrified. She genuinely didn't know the full scope.
**Reaction:** Denies everything unless cornered. DC 14 Insight reveals she's terrified rather than defiant. DC 15 Persuasion (or evidence of her innocence regarding the murder) causes her to break and confess Crane's involvement.
**Key Information She Has:** The commission, the date, the delivery address, and a copy of the receipt she stupidly kept.

### Aldric Vanthorpe's Steward — Emmett Dorn
**Role:** Key witness. Saw Crane with the ring.
**Goal:** Stay alive. Stay out of it.
**Reaction:** Frightened. Won't talk unless he feels safe (DC 12 Persuasion after players have demonstrated they can protect him, or after the intimidation attempt above alerts them to his existence).
**Key Information:** Direct eyewitness to Crane in the study. Will testify before the Lord's Council if protected.

---

## Skill Check Design (D&D 5e 2024)

Design checks so that **failure produces information, not a dead end**. Use the fail-forward principle from `scenario-writing.md`.

| Check | DC | On Success | On Failure |
|-------|----|-----------|-----------|
| Medicine (body) | 14 | Identifies poisoning | "Something feels wrong but you can't name it" — another clue to the herbalist |
| Investigation (study) | 13 | Finds the diary | Finds the wax seal impression instead (different clue, same node) |
| Arcana/Nature (ring) | 16 | Identifies Night's Veil | Confirms poison residue but not type — sends them to an expert |
| Persuasion (steward) | 12 | Full testimony | Partial — he admits he saw someone but won't name them yet |
| Investigation (city records) | 15 | Spots the phantom invoices | Notices the records seem unusually complete — suspicious in itself |
| Insight (Thessaly Ward) | 14 | Reads her terror | She's hiding something big, not involved in murder per se |

**Important:** Detect Poison and Diseases (1st level spell) should auto-confirm the ring as the vector if cast. Speak with Dead (5th level) on Vanthorpe could reveal the ring numbness if the right questions are asked. Do not penalize players for using spell resources — reward cleverness by giving clean information.

---

## Timeline (What Happens Without PC Intervention)

Day 0: Lord Vanthorpe's body found.
Day 1–2: Crane controls the official investigation. "Accidental heart failure" verdict imminent.
Day 3: Crane's enforcer visits Emmett Dorn to "ensure his silence."
Day 5: If players haven't reached Ward, she receives a message from Crane: burn the records, leave the city.
Day 7: Official verdict closes the case. Crane is now untouchable unless players have concrete evidence for the Lord's Council.

Advancing this timeline creates urgency and delivers proactive clues to stalled players.

---

## Climax Scene

**The Confrontation** — the players bring their evidence before the Lord's Council, or confront Crane directly.

Two possible end states:
1. **Legal victory:** Players present evidence to the Lord's Council. Crane is arrested. The steward testifies. Ward's confession seals it. Satisfying procedural ending.
2. **Direct confrontation:** Players move on Crane before the verdict. He has bodyguards (Assassin stat block, or use Veterans). The Lord's Council scene still happens — but now as a trial of the players for extrajudicial action, complicated by their evidence.

Plan for failure: if players arrive with insufficient evidence, Crane walks. The steward disappears. The city is worse for it. This is a valid ending — make it feel earned and consequential, not a GM punishment.

---

## Common Pitfalls to Avoid

**Don't put three clues in the same room.** If all three clues for a conclusion are in the victim's study, a single missed room ends the thread. Spread clues across locations and NPCs.

**Don't build deliberate red herrings.** Players generate their own misreadings. An NPC with suspicious behaviour who turns out to be innocent is fine — but don't design false trails that cost players sessions of dead effort with no reward.

**Don't gate the mystery on a single NPC.** If Thessaly Ward is the only path to the killer and she refuses to talk, you need a second route. The alchemist guild registry and the receipt in her shop both point to her without requiring her cooperation.

**Don't forget Speak with Dead.** In D&D, players have access to magic. Vanthorpe can be questioned. His answers won't name Crane (he never knew who was behind it), but they can confirm the ring, the numbness, and the meeting he was planning. Design around what magic could reveal — and make sure those answers are consistent with your truth.

---

## Quick Reference: Three Clue Checklist

Before you run the session, verify each conclusion:

- [ ] Cause of death — 3 clues from 3 different sources?
- [ ] Delivery vector (the ring) — 3 clues?
- [ ] Required an alchemist — 3 clues?
- [ ] Crane had motive — 3 clues?
- [ ] Crane had access to the alchemist — 3 clues?
- [ ] Crane planted the ring — 3 clues?
- [ ] At least one proactive clue ready if players stall at each node?
- [ ] At least two routes to every key NPC (don't rely on one gatekeeper)?
- [ ] Spell-based discovery paths accounted for?
- [ ] Timeline advancement planned for Days 3, 5, and 7?

If any conclusion has fewer than three independent clues, add one before you run.

---

*Framework based on The Alexandrian's Three Clue Rule and Node-Based Design. D&D 5e stat block references: Noble (CR 1/8), Assassin (CR 8), Veteran (CR 3) from the 2024 Monster Manual. Skill DCs per 2024 DMG difficulty guidelines (Easy 10, Moderate 15, Hard 20).*

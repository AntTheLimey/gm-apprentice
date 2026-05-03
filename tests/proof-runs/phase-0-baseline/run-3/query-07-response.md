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
  - skills/ttrpg-expert/npc-generation.md
---

# Three Clue Rule Murder Mystery — D&D 5e (2024)

## The Three Clue Rule: How It Works

The core principle: **every conclusion the players need to reach must be supported by at least three independently discoverable clues, spread across different nodes (locations, NPCs, objects).** If they miss one clue, they still have two paths to the same truth. If they miss two, the third saves the investigation.

This replaces linear "find clue A to unlock clue B" chains, which collapse on a single failed roll or missed location.

**Design formula:**
1. State the truth you want players to discover.
2. Identify the three (or more) independent ways they could learn it.
3. Assign each to a different node — NPC, location, or object.
4. Make at least one clue proactive (it comes to the players if they sit still).

---

## The Scenario: "The Vintner's Last Vintage"

### Premise

Lord Casimir Holt, a wealthy wine merchant in the prosperous trading city of Amberveil, is found dead in his locked cellar on the morning his daughter Sera is to be married. The city watch rules it a heart attack. The players have reason to believe otherwise.

### The Truth (GM Only — Read First)

Lord Holt was poisoned with **Midnight Tears** (ingested poison, DC 17 CON save, 9d6 Poison damage at midnight — see *SRD 5.2 poison table*). The killer is **Renata Voss**, Holt's business partner. Holt had discovered Renata was skimming from their joint wine import business and planned to expose her at the wedding, where most of Amberveil's merchant elite would be present. Renata slipped the poison into a "celebratory vintage" she delivered to Holt the evening before.

**Key facts players must discover:**

| Conclusion | Three Clues Pointing There |
|---|---|
| Death was not natural | (A1) Apothecary report: faint almond smell on lips; (A2) cellar wine glass has crystalline residue; (A3) Holt's dog refuses to enter cellar (animals detect poison) |
| Midnight Tears was used | (B1) Apothecary identifies residue from glass; (B2) merchant guild records show a Midnight Tears purchase under a false name; (B3) Renata's locked strongbox contains the empty poison vial |
| Renata Voss is the killer | (C1) Holt's private ledger documents the discrepancy and names Renata; (C2) the wedding gift wine bottle has Renata's vineyard wax seal; (C3) a kitchen servant saw Renata deliver the wine personally the night before |

---

## Node Map

Six nodes, each a distinct location or NPC. Clues spread so no single node holds all three clues for any conclusion.

```
[Crime Scene: Holt's Cellar]
    A2, C2 → leads to Apothecary, Renata's Estate

[Holt's Study]
    C1 → leads to Merchant Guild

[City Apothecary]
    A1, B1 → leads to Merchant Guild, Holt's Cellar

[Merchant Guild Records Office]
    B2 → leads to Renata's Estate

[Renata's Estate]
    B3, C3 (servant Mira) → confrontation/arrest

[Kitchen Servant (Mira Doss)]
    A3, C3 → leads to Renata's Estate
```

---

## The Nodes in Full

---

### Node 1: Lord Holt's Cellar (Crime Scene)

**Type:** Investigation  
**Agenda:** Establish foul play; connect the wine bottle to the killer.

**Opening (read aloud):**
*The cellar smells of oak, must, and something faintly sweet — almost floral. Lord Holt lies slumped against a wine rack, his expression slack, both hands folded in his lap as if he sat down deliberately. A half-empty glass of red wine rests beside him on a low shelf.*

**Clues available:**

- **A2 — The Glass (Passive DC 12 Perception or active search):** A faint crystalline residue rings the inside of the wine glass. Medicine DC 14 or Poisoner's Kit check: "This is not wine sediment. Something was dissolved in this."
- **C2 — The Wine Bottle (DC 13 Investigation):** The bottle label reads "Voss & Daughter Vineyards — Private Reserve." The wax seal is distinctive: a pressed rose pattern used only for Renata Voss's personal gift bottles, not commercial stock.

**Fail-forward:** If players fail all checks here, the city watch's young constable, Edda, approaches them outside. She found something odd but was told to drop it — she'll share her notes if the players seem trustworthy (Persuasion DC 10 or any sympathetic approach). Her notes describe the sweet smell and the out-of-place glass.

**Connections:** Glass residue → City Apothecary. Bottle seal → Renata's Estate or Merchant Guild (who knows her marks).

---

### Node 2: Holt's Study

**Type:** Investigation  
**Agenda:** Establish motive; give players the name of the killer.

**Opening (read aloud):**
*The study is neatly ordered — the desk of a man who valued control. A locked drawer has been forced, papers scattered. Whoever searched here was in a hurry.*

**Clues available:**

- **C1 — Holt's Private Ledger (DC 14 Investigation to find the hidden compartment beneath the desk):** The ledger documents three years of the Holt-Voss trading partnership. The final entry, dated two days before his death: *"R.V. — 4,200 gold. I have the proof. I will speak at the celebration if she does not return the funds by tomorrow."* The initials and sum are unambiguous.

**Fail-forward:** Sera Holt (the daughter) can lead players here if they interview her. She knows her father was troubled in his final days and was "writing in that old book of his." She doesn't know the contents.

**Connections:** Ledger name → Merchant Guild (to confirm Renata's partnership), Renata's Estate (confrontation).

---

### Node 3: City Apothecary

**Type:** Social/Investigation  
**Agenda:** Confirm poison; identify the specific substance.

**Apothecary: Tomas Birren**
- 3-Line: *A lean half-elf with ink-stained fingers and a magnifying lens on a cord around his neck. Speaks precisely and expects precision in return. Wants to be useful but won't speculate beyond evidence.*
- AIMS: Immediate — complete his work professionally. Secret — he already suspects poison but the city watch told him not to file a full report.

**Clues available:**

- **A1 — The Body (if players request an examination or bring him there; Medicine DC 10 with his assistance):** "The scent at the lips is characteristic of Midnight Tears — a rare ingested poison. No natural illness produces it."
- **B1 — The Glass Residue (if players bring the glass or describe it):** With his kit: "Yes. Midnight Tears. The crystalline breakdown product is unmistakable. This was dissolved in the wine."

**Fail-forward:** Tomas will volunteer that someone inquired about Midnight Tears three weeks ago — he refused to sell it but noted the inquiry in his records. He'll show the players his ledger (the customer gave a false name, but the description is a well-dressed woman with a rose-pattern ring — Renata's signet).

**Connections:** Poison identified → Merchant Guild (who could obtain it). Inquiry record → Merchant Guild Records Office.

---

### Node 4: Merchant Guild Records Office

**Type:** Social/Investigation  
**Agenda:** Confirm poison purchase; tie false identity to Renata.

**Guild Clerk: Aldous Pell**
- 3-Line: *A stout dwarf who keeps every transaction in duplicate. Suspicious of outsiders but legally required to assist city investigations. Fusses constantly with his ledger bindings.*

**Clues available:**

- **B2 — Purchase Record (DC 12 Persuasion or presenting city watch credentials; Investigation DC 11 to locate the right ledger):** A purchase of Midnight Tears through a licensed broker, six weeks prior, under the name "Lena Marsh." The buyer's guild membership number was falsified — but the handwriting on the transaction form matches Renata Voss's signature on file (DC 13 Investigation to notice, or Aldous will flag it if shown the form directly). The transaction included a delivery address: a warehouse Renata owns on the south dock.

**Fail-forward:** Aldous independently noticed the irregularity and filed a complaint two weeks ago — which went nowhere. He's bitter about it and will share everything freely to anyone who seems likely to act on it.

**Connections:** South dock warehouse → Renata's Estate (she's been moving assets). False identity → confirms deliberate planning.

---

### Node 5: Kitchen Servant — Mira Doss

**Type:** Social  
**Agenda:** Place Renata at the scene; confirm the wine delivery.

**Mira Doss**
- 3-Line: *A middle-aged halfling woman who's worked the Holt household for twelve years. Nervous around authority; devoted to Sera. Clutches her apron when anxious.*
- AIMS: Immediate — protect her job and Sera's wedding. Instinct — honest but afraid. Secret — she saw something she hasn't told the watch because she wasn't asked.

**Clues available:**

- **A3 (Proactive clue — no check required):** Mira approaches the players during any investigation of the estate. "Lord Holt's hound, Barley, won't go near the cellar. He hasn't eaten since the master died." (A trained animal's distress signals environmental toxin — a ranger, druid, or player who asks a Survival DC 10 will connect this to ingested poison in the vicinity.)
- **C3 — The Delivery (Persuasion DC 10 or any gentle approach):** "Mistress Voss came herself, evening before last, with a bottle. Said it was a gift for the wedding. Lord Holt seemed pleased — said she was making amends. She stayed maybe ten minutes."

**Fail-forward:** If players don't seek out Mira, Sera mentions her mother's hound's strange behaviour during a conversation at the funeral preparations. Any NPC who spends time at the estate can mention "the dog won't go downstairs."

**Connections:** Renata's visit confirmed → Renata's Estate (confrontation).

---

### Node 6: Renata's Estate (Confrontation Node)

**Type:** Social / Combat (optional)  
**Agenda:** Confront Renata with evidence; recover the poison vial; resolve the mystery.

**NPC: Renata Voss (Primary Antagonist)**

Concept: A self-made merchant who clawed her way into Amberveil's elite and will not let one man's sudden conscience ruin everything.

Appearance: A tall human woman in her late fifties, silver hair pinned severely, always wearing a rose-patterned signet ring.

Voice: Formal diction; refers to herself in the third person when defensive. "Renata Voss does not explain herself to adventurers."

AIMS:
- Agenda (Immediate): deny everything; discredit witnesses
- Agenda (Short-term): leave Amberveil before charges can be filed
- Agenda (Long-term): she was building toward buying out the entire Holt trading operation; that plan is now collapsing
- Instinct: cold calculation under pressure; will flee if cornered
- Moves: (1) has already arranged a carriage to the harbor; (2) has a hired bodyguard on premises (Veteran stat block, MM); (3) will attempt to bribe players if evidence is weak

Secrets:
- Surface: visibly tense; the rose ring keeps turning in her fingers
- Investigation: her study has packed travel trunks
- Deep: the strongbox in her bedroom (DC 15 Thieves' Tools or forced) contains the empty Midnight Tears vial, 800 gold in mixed coin, and a letter of credit for passage to Neverwinter

**Clue available:**
- **B3 — The Vial (strongbox):** Empty Midnight Tears vial, still faintly fragrant. Combined with any two B-series clues = conclusive.

**Stat Block (Renata, if combat required):**
Use **Noble** base (MM/SRD) with the following additions:
- +2 DEX, Proficiency in Deception and Insight
- Bonus Action: *Commanding Presence* — one ally within 30 ft can use their Reaction to make one weapon attack
- Has a Dagger of Venom (SRD magic item) concealed in her sleeve

**Confrontation outcomes:**
- Evidence ≥ 2 conclusions proved: Renata attempts to flee; if stopped, confesses in exchange for mercy rather than the gallows. Offers to expose two other corrupt guild officials as part of a deal.
- Evidence = 1 conclusion proved: Renata denies, calls guards. Players must either find more evidence or make the arrest on partial proof (consequences: merchant guild protests, city watch reluctant to act).
- Evidence = 0 conclusions proved: Renata is politely dismissive. The investigation isn't over yet — return to earlier nodes.

---

## Timeline (Unopposed)

What happens if players do nothing:

| Day | Event |
|-----|-------|
| Day 1 | Lord Holt found dead. Wedding postponed. City watch files "heart attack." |
| Day 2 (today) | Renata attends the funeral preparations; appears grieving. Continues packing assets. |
| Day 3 | Renata transfers warehouse deed to a proxy and withdraws guild funds. |
| Day 4 | Renata books passage on the evening tide. |
| Day 5 | Renata departs Amberveil. Without her, the strongbox evidence is gone. Mira and the clerk are still accessible, but conviction becomes much harder. |

This timeline gives the players urgency without railroading them. If they dawdle past Day 4, Renata is gone — but the mystery can follow them to Neverwinter as a sequel hook.

---

## Proactive Clue (In Case Players Stall)

If the players spend more than a session without finding a lead, fire one of these:

1. **Someone tries to bribe Mira** to leave the city before she can testify. A stranger offers her a bag of gold "to take a holiday." Mira comes to the players, frightened.
2. **Renata's bodyguard makes a mistake:** he's spotted near the apothecary, warning Tomas Birren to "keep his nose out of merchant business." Tomas sends for the players.
3. **The dog leads the way:** if players are at the Holt estate, Barley the hound begins barking at the wine rack where the bottle came from, then pads to the gate Renata used to enter. Animals don't lie.

---

## Skill Checks Reference

| Check | DC | Purpose |
|---|---|---|
| Perception (passive) | 12 | Notice glass residue in cellar |
| Investigation | 11-15 | Search study, find ledger compartment, locate records |
| Medicine | 10-14 | Evaluate body, identify poison symptoms |
| Persuasion | 10-12 | Get Mira or Aldous to talk |
| Thieves' Tools | 15 | Open Renata's strongbox |
| Insight | 13 | Detect Renata's deception during confrontation |
| Survival | 10 | Interpret the dog's behavior |

**Fail-forward rule:** No single failed check locks progress. Every gated clue has an alternate path. If a player fails a key check, give a partial result ("You find the drawer but can't make sense of the numbers") and let them try again with advantage after gathering more context, or let another character attempt it.

---

## Three Clue Rule Audit

Before running, verify each conclusion has three paths:

- **Death was not natural:** A1 (body) + A2 (glass residue) + A3 (the dog) ✓
- **Midnight Tears was used:** B1 (apothecary + glass) + B2 (guild records) + B3 (vial in strongbox) ✓
- **Renata Voss is the killer:** C1 (ledger) + C2 (bottle seal) + C3 (Mira's testimony) ✓

Each conclusion has clues spread across at least three different nodes. No single location holds all the evidence for any one conclusion. Players can reach the truth through Renata → evidence OR evidence → Renata, in either order.

---

## Sequel Hooks

- The two corrupt guild officials Renata offers to expose open a larger conspiracy arc.
- Sera Holt inherits a trading empire she knows nothing about — and several of Renata's enemies will want to "help" her.
- The south dock warehouse contains more than wine — whatever Renata was really moving becomes the next investigation.

---

*Sources: The Alexandrian (Three Clue Rule, Node-Based Design); Robin Laws / Pelgrane (core clue design); WotC SRD 5.2 (stat blocks, poison table). Poison mechanics from SRD 5.2, licensed under CC BY 4.0.*

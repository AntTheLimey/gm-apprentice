---
query: "Design a Three Clue Rule investigation for my D&D 5e murder mystery"
system: dnd-5e-2024
type: generate
total_tokens: 32759
wall_clock_ms: 121511
files_loaded:
  - skills/ttrpg-expert/SKILL.md
  - skills/ttrpg-expert/content-generation.md
  - skills/ttrpg-expert/scenario-writing.md
  - skills/ttrpg-expert/systems/dnd-5e-2024/conditions-rules.md
---

# Three Clue Rule: D&D 5e Murder Mystery — "The Gilded Hand"

## Design Principle: Why Three Clues Per Conclusion

The Three Clue Rule (The Alexandrian) states: **for every conclusion you want the players to reach, place at least three independent clues pointing to it.** Players will miss clues, misread clues, skip locations, and interrogate NPCs in the wrong order. Three clues means a 50% miss rate still gets them there. This is not redundancy — it is insurance that the investigation survives real table play.

Each clue should be **independently discoverable** from a different node (location, NPC, or object). Never put all three clues in one room.

---

## The Truth (GM-Only — Read First)

Lord Aldric Voss, a wealthy textile merchant, was murdered by his business partner **Sera Dunmore** using **Midnight Tears poison** (ingested; DC 17 CON save; no effect until midnight, then 9d6 Poison damage — 1,500 gp, from the SRD 5.2 Gameplay Toolbox). Aldric had discovered Sera was skimming profits to fund a gambling debt to the thieves' guild. She slipped the poison into his wine at a private dinner two nights before the body was found, then staged the scene to implicate the head groundskeeper, **Tobyn Marsh**, who has a public grievance with the lord.

Sera is currently in the city, attending social functions to establish an alibi and waiting for the heat to die down.

---

## Key NPCs

| NPC | Role | Goal | Secret |
|-----|------|------|--------|
| **Sera Dunmore** | Killer / Business partner | Escape suspicion; recover her ledger | Poisoned Aldric; owes 2,000 gp to the Copperscale guild |
| **Tobyn Marsh** | Groundskeeper / False suspect | Prove innocence | Had a shouting match with Aldric the day before death |
| **Hella Voss** | Widow | Learn the truth; protect reputation | Knew of Aldric's suspicions about Sera but said nothing |
| **Brother Cedd** | Temple healer who examined body | Help the investigation | Has his own notes; won't share without trust or a reason |
| **Reva "Fingers"** | Thieves' guild fence | Protect Copperscale's interests | Knows Sera owes the guild; will bargain with this |

---

## Node Map and Clue Paths

The investigation has **four nodes** (locations/NPCs). Each node contains at least one clue toward each major conclusion. Players can enter the nodes in any order.

### Conclusions to Prove

**Conclusion A: The Cause of Death Was Poison, Not a Blow**
**Conclusion B: Sera Dunmore Is the Killer**
**Conclusion C: The Motive Was Financial (Embezzlement)**

---

### Node 1 — The Body (Estate Study)

*Read-Aloud (Boxed Text):*
> The study smells of old paper and candle wax. Lord Voss lies slumped behind his writing desk, one hand still curled around a quill. No obvious wounds mar his body. A wine glass, half-full, sits at his right hand. The shuttered windows are latched from the inside.

**Clues Available Here:**

| Clue | Check | Conclusion |
|------|-------|------------|
| No wound, livid complexion, burst blood vessels in the eyes — clearly not a blow | DC 10 WIS (Medicine) or DC 12 INT (Investigation) | A: Poison, not trauma |
| The wine glass has a faint oily residue at the base; the dregs smell faintly of almonds | DC 14 INT (Investigation) + DC 12 WIS (Perception) | A: Poison confirmed |
| A torn corner of a letter, partially burned in the fireplace: "…the third column never matches…" — matching Sera's letterhead style | DC 15 INT (Investigation) to notice; no check to read once found | C: Embezzlement motive |

**GM Note:** If the players bring Brother Cedd here (or he is already present), he can confirm the poison cause on sight (no check needed — he's seen Midnight Tears before). That is the proactive clue — an NPC delivers if players stall.

**Skill DCs note (2024 rules):** Investigation (INT) for searching, Medicine (WIS) for physical examination, Perception (WIS) for noticing sensory details. No single check gates the entire node — each clue is reachable via a different skill.

---

### Node 2 — Brother Cedd's Temple Notes

*Brother Cedd examined the body the morning it was found. He is at the Temple of the Everflame, two streets away.*

**Approach:** Social or persuasion. Cedd is cautious but not hostile. He wants to know the PCs are serious before sharing his notes.

| Approach | DC | Result |
|----------|----|--------|
| Honest appeal to justice | DC 12 CHA (Persuasion) | Shares notes freely |
| Offer temple donation (10+ gp) | No check needed | Shares notes freely |
| Intimidation | DC 16 CHA (Intimidation) | Shares notes but becomes hostile — won't help again |

**Clues Available Here:**

| Clue | Conclusion |
|------|------------|
| Cedd's written notes: "Congestion of liver, burst capillaries, purple discoloration of tongue — consistent with a slow-acting ingested toxin, likely administered 36–48 hours before death." | A: Poison confirmed; establishes dinner timeline |
| Cedd mentions Sera Dunmore was at the estate the night of the private dinner ("I passed her carriage leaving the estate gate as I arrived the next morning — unusual hour for a business call") | B: Sera was present at the critical time |
| On prompting, Cedd recalls Aldric seemed "oddly distracted" at temple two weeks prior; "spoke about a colleague who had been 'stealing from beneath his nose' — wouldn't say who" | C: Embezzlement motive |

---

### Node 3 — Sera Dunmore's Office (Business Quarter)

*Sera's counting-house; she is out but her assistant Pell is present. The office can be searched legally (with Hella Voss's authority) or covertly.*

**Entry options:** Hella grants written authority; players bluff as city assessors (DC 13 CHA Deception); players enter covertly (DC 14 DEX Stealth past Pell, DC 12 DEX Thieves' Tools on back lock).

**Clues Available Here:**

| Clue | Check | Conclusion |
|------|-------|------------|
| A second set of ledgers behind a false panel in the desk drawer | DC 15 INT (Investigation) to find the panel | C: Embezzlement — the numbers clearly diverge from the main books |
| A receipt from an apothecary: "1 vial, special order, as discussed — Midnight Tears, balance paid" dated three days before the murder | DC 12 INT (Investigation) — it is misfiled not hidden | A + B: Poison identified, Sera purchased it |
| A sealed letter from "R.F." (Reva Fingers): "Miss D. — your debt is 2,000 gp. Lord V. must not learn of this." | No check needed once letter is found; DC 13 INT (Investigation) to find it | B + C: Motive (debt) + Sera's guilt |

**Fail-forward note:** If Pell is questioned instead of the office being searched, he nervously mentions that "Miss Dunmore came in very late two nights ago and burned something in the grate." This points toward the office and is enough to motivate a proper search.

---

### Node 4 — Reva "Fingers" (Thieves' Guild Contact)

*Reva operates out of a pawnshop in the Tallow District. She is not hostile — she is pragmatic. She does not want the guild implicated in a noble's murder.*

**Approach:** Reva bargains. She wants something (cleared debt record, immunity, a favour) in exchange for information. She will not volunteer information for free but she will not lie if questioned directly.

| Offer | DC | Result |
|-------|----|--------|
| Promise to keep guild out of official report | DC 14 CHA (Persuasion) | Talks freely |
| Information trade ("we know about the letter") | DC 10 CHA (Persuasion) | Talks freely — she's already nervous |
| Payment (50+ gp) | No check | Talks, but guards her words more carefully |

**Clues Available Here:**

| Clue | Conclusion |
|------|------------|
| "Sera Dunmore owes us 2,000 gold. She told us three weeks ago she was 'handling the problem permanently' — I didn't ask questions." | B: Sera confirmed as the actor; C: Motive confirmed |
| Reva can confirm the apothecary receipt is legitimate: "Theron's Quiet Remedies, on Candler's Row. He supplies the guild sometimes. That's his mark on the wax." | A: Poison purchase authenticated |
| Reva mentions Tobyn Marsh has nothing to do with this: "Marsh borrowed money from us once, years ago. Paid it back on time. Dunmore tried to point us at him last week. We didn't bite." | Clears the false suspect — helps players trust Tobyn |

---

## Three-Clue Matrix (Summary)

| Conclusion | Node 1 (Body) | Node 2 (Brother Cedd) | Node 3 (Sera's Office) | Node 4 (Reva) |
|------------|--------------|----------------------|----------------------|--------------|
| A: Death by poison | Residue + livid complexion | Full notes confirming poison | Apothecary receipt | Receipt authenticated |
| B: Sera is the killer | Burned letter fragment (circumstantial) | Sera's carriage at scene | Apothecary receipt + debt letter | Direct testimony |
| C: Embezzlement motive | Burned letter fragment | Aldric's comments about a colleague | Hidden ledgers + debt letter | Direct testimony |

Every conclusion has at least three independent routes. Players can skip any single node and still solve the case.

---

## Proactive Clue (If Players Stall)

After 2 in-game days without progress, Tobyn Marsh seeks out the PCs directly. He knows he is being set up and will share everything he knows: Sera was at the estate for a private dinner with Aldric two nights before death ("I saw her carriage in the east courtyard past midnight"). He also found a small glass vial behind a flower bed near the study window — empty, still faintly smelling of almonds. This is the same poison, discarded after use.

This delivers Clue A (poison) and Clue B (Sera at scene) simultaneously and re-engages stalled players without railroading.

---

## Climax — Confronting Sera

When players have enough evidence, they confront Sera at a social event she is attending (evening gala at a rival merchant's estate — public, witnesses present). She is not a combat encounter by default; she is a social/moral conclusion.

**Her gambits (in order):**
1. Deny everything: "This is slander. Where is your proof?"
2. Pivot to Tobyn: "The groundskeeper had every reason—"
3. If evidence is overwhelming: Flee (she has a horse ready; DC 14 Athletics/Acrobatics chase through the gala estate, 4 rounds)
4. If cornered completely: Confess and bargain — she offers to expose the Copperscale guild's full operations in exchange for mercy

**Mechanical resolution options:**
- Peaceful arrest: social resolution, city watch summoned
- Chase: use standard chase rules (4 rounds, players choose action each round; environmental features — a ballroom, a kitchen, a stable yard)
- Combat (last resort): Sera is a commoner stat-block with a hidden dagger (1d4 Piercing, Finesse) and **Midnight Tears** on her person (DC 17 CON or 9d6 Poison at midnight — she will threaten to use it)

---

## Timeline (Unopposed — What Happens If PCs Do Nothing)

| Day | Event |
|-----|-------|
| Day 0 | Murder discovered. Tobyn Marsh arrested as suspect. |
| Day 2 | Sera transfers business assets to a holding account. |
| Day 4 | Sera approaches the city watch with forged evidence against Tobyn. |
| Day 6 | Tobyn faces formal trial. Evidence mounts against him. |
| Day 8 | Sera leaves the city — permanently. Tobyn convicted. |

Players can intervene at any point. The timeline creates urgency without forcing a specific path.

---

## Hooks (3 Minimum)

- **Personal:** Hella Voss contacts a PC directly — she heard their name mentioned as someone with investigative skill. She offers payment and a personal favour.
- **Professional/Civic:** The city watch captain approaches the party — his lead suspect (Tobyn) doesn't feel right to him, but he lacks the resources to dig further. He needs off-the-books help.
- **Material:** Tobyn Marsh smuggles out a message from his cell: "I know what Aldric knew. I hid proof. Find it before they hang me."

---

## Investigation Skill Reference (D&D 5e 2024)

| Skill | Attribute | Primary Uses in This Adventure |
|-------|-----------|-------------------------------|
| Investigation | INT | Searching rooms, finding hidden items, reading evidence |
| Perception | WIS | Noticing sensory details, detecting eavesdroppers |
| Medicine | WIS | Identifying cause of death, poison symptoms |
| Persuasion | CHA | Getting NPCs to cooperate willingly |
| Deception | CHA | Bluffing past gatekeepers |
| Intimidation | CHA | Coercing reluctant NPCs (with social cost) |
| Insight | WIS | Reading NPC honesty, detecting lies |
| Stealth | DEX | Covert entry to Sera's office |
| Sleight of Hand | DEX | Palming the apothecary receipt before Pell notices |

**Fail-forward principle:** No single failed check ends the investigation. If a clue check fails, the player notices something is there but can't interpret it yet — or a different NPC volunteers the same information. Never lock a conclusion behind a single roll.

---

## Sequel Hooks

- The Copperscale thieves' guild is now aware the PCs disrupted their debt collection. A guild representative makes contact — offering work or issuing a warning, depending on how much the PCs exposed.
- Hella Voss's revealed knowledge (she knew Aldric suspected Sera) creates a moral complication: she is not guilty of murder, but her silence enabled it. What do the PCs do with that?
- The hidden second ledger reveals Aldric was himself involved in something questionable — a tax evasion scheme that could embarrass several noble families. This is an unlit Chekhov's gun the GM can fire in a future session.

---

*Sources: The Alexandrian, "The Three Clue Rule" (node-based design); WotC 2024 DMG (D&D 5e adventure design); SRD 5.2 CC-BY 4.0 (poison table, skill rules, chase rules). Midnight Tears poison is from SRD 5.2.*

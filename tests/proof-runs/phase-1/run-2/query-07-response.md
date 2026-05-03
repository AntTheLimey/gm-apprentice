---
query: "Design a Three Clue Rule investigation for my D&D 5e murder mystery"
system: dnd-5e-2024
type: generate
total_tokens: 0
wall_clock_ms: 0
files_loaded:
  - skills/ttrpg-expert/SKILL.md
  - skills/ttrpg-expert/content-generation.md
  - skills/ttrpg-expert/scenario-writing.md
---

# Three Clue Rule Murder Mystery — D&D 5e (2024)

## Design Philosophy First

The **Three Clue Rule** (The Alexandrian) states: for every conclusion you need the players to reach, place at least three independently discoverable clues in at least three different locations/NPCs/sources. Any one clue is sufficient; the redundancy ensures a single missed roll, overlooked NPC, or avoided location never halts the investigation.

The corollary: **never hide the essential clue behind a single skill check**. Checks earn bonus clues, context, or advantage — they do not gate the only path forward.

---

## Worked Example: "The Alderman's Last Supper"

A complete, ready-to-run murder mystery scenario using this framework.

---

### The Truth (GM Eyes Only)

Alderman Corvus Drale was poisoned during the Harvest Feast by his wife, **Mira Drale**, using wolfsbane extract dissolved in his personal wine carafe. Mira discovered Corvus was selling her family's ancestral estate to a mining consortium — property she stood to inherit on his death regardless. The poison was obtained from the apothecary **Thessaly Vane**, who prepared it believing it was for rat control. Mira substituted Corvus's carafe just before the toast. The feast had forty witnesses who saw nothing unusual; only three people know anything incriminating.

**Corvus did not die immediately.** He collapsed three hours after the feast, so the killer was no longer at table when he fell. This complicates witness testimony.

---

### Premise

> Alderman Corvus Drale is found dead the morning after the annual Harvest Feast. The city guard rules it natural causes (heart failure, advanced age). Corvus's business partner, **Rennick Holt**, hires the party to investigate quietly — he believes foul play, because Corvus had recently changed his will and Rennick stands to lose a lucrative partnership.

---

### Hook Variants (use at least one per party)

- **Personal:** A PC received a note from Corvus the week before, requesting a private meeting that never happened.
- **Professional:** The party's guild/patron has dealings with Rennick Holt and is owed a favour.
- **Moral:** The city guard is closing the case by morning; a servant will be blamed unless someone acts.
- **Curiosity:** Corvus was found with a torn message referencing the PCs' names.

---

### Node Map

Each node is independently reachable. Clues within each node point toward the truth AND toward other nodes. PCs can enter any node first.

```
[Corvus's Townhouse] ──► [Harvest Feast Venue: The Gilded Carp]
        │                           │
        ▼                           ▼
 [Apothecary Vane]          [Mira Drale / Widow's Suite]
        │                           │
        └───────────────────────────┘
                    │
              [City Records Office]
                  (optional)
```

---

## Nodes in Full

---

### Node 1: Corvus's Townhouse

**Scene Type:** Investigation
**Agenda:** Establish that Corvus was poisoned and that someone had motive related to the estate.

**Read-Aloud:**
> The alderman's study smells of tallow and old paper. A half-empty carafe of dark wine sits on the writing desk beside a spilled ledger. The body has been moved to the undertaker, but the servants haven't been allowed to clean.

**Key Features:**
- The writing desk with the carafe and ledger
- A locked iron strongbox behind a portrait (key on Corvus's body at the undertaker)
- A wastebasket containing a torn letter

**Clues Available Here:**

| Clue | How Found | Skill Check |
|------|-----------|-------------|
| **C1.** The personal wine carafe smells of bitter almonds and crushed flowers — a Healer or Herbalism Kit user identifies it as wolfsbane. | Examine carafe + DC 12 Medicine or Herbalism Kit | DC 12 (free info on 15+: onset time 2–4 hrs) |
| **C2.** The torn letter in the wastebasket is a draft from Corvus to a solicitor, instructing transfer of "the Aldenmoor estate" to the mining consortium Irongate Holdings. It is dated three days before his death. | Search wastebasket (no check) | Automatic |
| **C3.** The locked strongbox holds a revised will — Mira is removed as beneficiary of the Aldenmoor estate. The previous will, still filed at the Records Office, names her sole heir. | Unlock strongbox + DC 13 Investigation to understand legal significance | Open with key; comprehension auto at DC 13 |

**Proactive Clue (if PCs skip this node):** The undertaker mentions an unusual bitterness when he prepared the body and asks if the party knows of any enemies. He kept the carafe as evidence.

---

### Node 2: The Gilded Carp (Feast Venue)

**Scene Type:** Social + Investigation
**Agenda:** Establish the method (the carafe was tampered with) and narrow the window of opportunity.

**Read-Aloud:**
> The great hall is being cleared after the feast. Trestle tables still bear the wreckage of the previous night — platters scraped clean, overturned cups, burnt-down candles. The head of house, a stout woman named Brenna, is directing servants with the weary efficiency of someone who has done this a hundred times.

**Key NPCs:**
- **Brenna Holt** (head of house): no motive, cooperative. Will confirm seating arrangements and timeline if asked.
- **Tomlin** (serving boy, 14): nervous. Saw Mira step away from the head table during the toast preparation, near the alderman's carafe.
- **Festus Crane** (Corvus's business rival, present at feast): hostile, delights in the death but knows nothing. Good red herring; PCs will spend time on him.

**Clues Available Here:**

| Clue | How Found | Skill Check |
|------|-----------|-------------|
| **C4.** Brenna confirms that Corvus used a personal carafe — a Drale family heirloom — always filled from a private bottle, never from common stock. No one else drank from it. | Ask about the carafe / seating | Automatic |
| **C5.** Tomlin saw Mira lean over the head table during the bustle before the toast, her back to the room for "just a moment." He didn't think much of it. | Ask servants about the toast (DC 14 Persuasion or Insight on Tomlin's nervousness draws this out) | DC 14 Persuasion; automatic if PCs are kind and patient |
| **C6.** The seating chart (pinned to Brenna's clipboard) shows Mira sat immediately to Corvus's left, directly adjacent to the carafe position. | Ask to see the chart | Automatic |

**Proactive Clue (if PCs skip this node):** Tomlin shows up at wherever the PCs are staying, frightened — he heard a "loud argument" in the Drale townhouse the night before Corvus died and wants to tell someone. He'll describe what he saw at the feast.

---

### Node 3: Apothecary Vane

**Scene Type:** Social
**Agenda:** Confirm the poison, trace its purchase to a buyer matching Mira's description.

**Read-Aloud:**
> The apothecary is a narrow shop wedged between a tannery and a chandler. The smell of dried herbs and vinegar is almost medicinal. Thessaly Vane, a lean woman with ink-stained fingers, looks up from her mortar with the expression of someone who resents interruption.

**Key NPC:**
- **Thessaly Vane**: cautious but not guilty. Sold "rat poison compound" (wolfsbane extract) six days ago. Will not volunteer information without a plausible reason; a DC 13 Persuasion (official capacity, appeal to civic duty) or DC 11 Intimidation unlocks her ledger.

**Clues Available Here:**

| Clue | How Found | Skill Check |
|------|-----------|-------------|
| **C7.** Vane's sales ledger lists "wolfsbane extract, concentrated, 1 vial" sold to "a lady, dark hair, fine dress, said it was for the cellar rats." No name recorded. | Access ledger (DC 13 Persuasion or DC 11 Intimidation, or a forged official document) | DC 13 Persuasion / DC 11 Intimidation |
| **C8.** Vane mentions the buyer paid with a gold coin bearing an unusual mint mark — a double-headed swan, the heraldry of House Aldenmoor. She kept it as a curiosity; she'll show it. | Ask about payment | Automatic once inside |
| **C9.** Vane can confirm that wolfsbane extract in the dose sold would produce symptoms 2–4 hours after ingestion, consistent with Corvus collapsing after the feast ended. | Ask about the poison's effects | Automatic (Vane knows her trade) |

**Proactive Clue (if PCs skip this node):** A note arrives at the inn — anonymous, written in a careful hand. "The poison came from Vane's. Ask about the swan coin." (Mira's scared maid sent this to protect herself.)

---

### Node 4: Mira Drale / Widow's Suite

**Scene Type:** Social (confrontation node — visit last or mid-investigation)
**Agenda:** Confront the killer; she will lie until evidence is presented.

**Read-Aloud:**
> Mira Drale receives you in a sitting room draped in black cloth. She is composed — too composed for a woman whose husband died last night. Her hands are folded in her lap. She watches you the way a cat watches a mouse hole.

**Key NPC:**
- **Mira Drale**: intelligent, cold, self-controlled. She has a cover story (she was in the retiring room during the toast). She will not break on social pressure alone. She will break when confronted with two or more concrete clues: the revised will + Tomlin's testimony, or the coin + the ledger, or any combination of two hard pieces of evidence.

**Confrontation Mechanics:**

| Evidence Presented | Mira's Response |
|---|---|
| 0–1 clues | Denies, threatens to call guard, shows PCs out |
| 2 clues | Cracks — attempts to bargain (accuses Irongate Holdings of pressuring Corvus) |
| 3+ clues | Confesses under pressure; claims she acted to save her family's legacy |
| Physical evidence (coin / carafe) | DC 16 Insight to catch her composure failing; she asks to speak to a solicitor |

**Clues Available Here (regardless of confrontation outcome):**

| Clue | How Found | Skill Check |
|------|-----------|-------------|
| **C10.** A faint smell of dried herbs in the retiring room adjacent to the sitting room — the same bitterness as the carafe. | Search retiring room (DC 12 Perception) | DC 12 Perception |
| **C11.** An empty vial in the back of Mira's wardrobe, wrapped in a handkerchief bearing the swan heraldry. | Thorough search of suite (DC 14 Investigation or Thieves' Tools DC 12 on locked wardrobe) | DC 14 Investigation |

---

### Node 5: City Records Office (Optional)

**Agenda:** Confirm legal motive via the original and revised wills.

This node exists to give players who want to do it "by the book" a satisfying paper trail. It adds nothing essential but rewards thoroughness.

**Clue:** The original will names Mira sole heir to the Aldenmoor estate. Corvus filed a change-of-beneficiary notice three days before his death. If the estate transfers to Irongate Holdings, Mira loses approximately 12,000 gold pieces in land value.

---

## Clue Redundancy Map

The truth has three components: **Motive, Method, Opportunity**. Each component has at least three independently discoverable clues.

| Component | Clues |
|-----------|-------|
| **Motive** (estate/will) | C2 (torn letter), C3 (strongbox will), Records Office (C opt) |
| **Method** (wolfsbane in carafe) | C1 (smell + ID), C7 (ledger), C9 (Vane confirms onset time) |
| **Opportunity** (Mira near carafe) | C5 (Tomlin's testimony), C6 (seating chart), C10 (herb smell in retiring room) |
| **Identity link** (Mira as buyer) | C8 (swan coin), C11 (empty vial + handkerchief), C5 (description matches) |

Any single component can be established with only one clue; the redundancy means even a party that skips two entire nodes has enough.

---

## Skill Check Summary

| Check | DC | Where | Consequence of Failure |
|-------|----|-------|------------------------|
| Medicine / Herbalism Kit (carafe) | 12 | Node 1 | Don't ID the poison — but Vane can still ID it |
| Investigation (strongbox / will) | 13 | Node 1 | Miss legal significance — Records Office covers it |
| Persuasion (Tomlin) | 14 | Node 2 | Miss his testimony — but seating chart + coin still place Mira |
| Persuasion (Vane) | 13 | Node 3 | Try Intimidation (11) or forged authority doc instead |
| Intimidation (Vane) | 11 | Node 3 | Try Persuasion instead |
| Perception (herb smell) | 12 | Node 4 | Miss atmosphere clue — vial still findable |
| Investigation (wardrobe) | 14 | Node 4 | Miss physical evidence — but confession path still open |

**Fail-Forward Rule:** Any failed skill check that would gate essential information should instead provide partial information or point to an alternate source. "You don't recognise the plant, but it smells wrong — wrong enough that Vane at the apothecary would know it in a moment."

---

## Timeline (Unopposed)

What happens if the PCs do not investigate:

| Time | Event |
|------|-------|
| Day 1 (morning) | Corvus found dead; guard rules natural causes |
| Day 1 (evening) | Mira retains solicitor, begins estate transfer proceedings |
| Day 2 | Irongate Holdings representatives arrive in town to formalise purchase |
| Day 3 | Rennick Holt, without evidence, is dismissed from the partnership |
| Day 4 | Mira quietly pays a clerk to lose the change-of-beneficiary filing |
| Day 5 | Tomlin, frightened by Mira's increasingly cold behaviour, leaves town |
| Day 7 | Case closes; Mira inherits; Corvus's death is forgotten |

The timeline creates urgency without railroading. Witnesses become harder to reach. The physical evidence (vial, coin) can still be found regardless, but witness testimony degrades.

---

## Climax Variants

**Confession Route:** Mira breaks when presented with sufficient evidence. She pleads she acted to save her family's legacy from a husband who had "already betrayed it." City guard takes her into custody; party is paid and thanked. Legal aftermath is a sequel hook.

**Escape Route:** If the party tips their hand too early, Mira attempts to flee — a chase through the merchant quarter, or she hires muscle for a brief combat encounter before being cornered.

**Frame Route (complication):** Mira, realising she's cornered, tries to implicate Festus Crane (the business rival). PCs must assess the counter-evidence. DC 14 Insight on her statement reveals she's improvising.

**Failure Route:** If the party never presents sufficient evidence, Mira walks free. Rennick Holt is ruined. The estate transfers. Three months later, a new hook: Mira's maid, now dismissed, approaches the party with the empty vial she kept — she wants justice and revenge.

---

## Sequel Hooks

- Irongate Holdings was more than a buyer — they had advance knowledge of the will change and may have encouraged it. What else have they "encouraged"?
- The twin-swan heraldry of House Aldenmoor resurfaces in a different context: a noble family the party encounters holds the same mint mark.
- Corvus's revised will contained a second change the party never found: a bequest to a mystery figure in a distant city.

---

## GM Quick Reference

**Core principle:** Three clues per conclusion. Never a single point of failure.

**If players are stuck:** advance the timeline (Day 2 Irongate reps arrive), have Tomlin find them, or have the apothecary's assistant mention an unusual sale to anyone asking about wolfsbane.

**If players skip the apothecary entirely:** Vane can appear as a background NPC at the Gilded Carp, asking Brenna if anyone's investigated the alderman's death — she sold something she now regrets.

**The confrontation only works with evidence.** Don't let Mira confess to social pressure alone. The clues must matter — they are the reward for investigation, not decoration.

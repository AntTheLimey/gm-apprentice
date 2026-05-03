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

# The Three Clue Rule — D&D 5e Murder Mystery Framework

## What the Three Clue Rule Actually Is

The Three Clue Rule (from The Alexandrian): **for every conclusion you need the players to reach, place at least three independently discoverable clues pointing to it.** This is insurance, not hand-holding. Players miss clues constantly — they go the wrong direction, fail a roll, skip a location, or just don't recognise significance. With three independent paths to the same conclusion, missing one or even two clues still gets them there.

Key points:
- "Independent" means: if one clue is destroyed, buried, or missed, the others still work.
- The clues don't need to say the same thing — they can approach the conclusion from different angles.
- Three is a *minimum*. Complex conclusions or long investigations benefit from five or six.
- Clues pointing at **different conclusions** build depth; clues that *all* point toward the same wrong suspect before pivoting are a trap (deliberate red herrings cause more frustration than mystery — players generate their own).

---

## The Murder: A Complete Worked Example

### The Truth (GM Only — State This First)

**Councillor Ereth Vane** killed **Merchant Lord Pieter Drunn** with a slow-acting poison (Oil of Taggit, PHB) administered in a gift of wine three days before the body was found. Vane stood to inherit Drunn's seat on the trade council once Drunn's debts forced him to sell — debts Vane had secretly engineered by bribing Drunn's trading partners to break contracts. Drunn discovered the betrayal the night before he died and sent a letter; Vane intercepted it.

Vane's household servant, **Marta**, witnessed Vane leaving Drunn's estate that evening but is terrified of losing her position and will lie unless the players earn her trust.

This is the truth. Every clue the players find connects back to some part of it.

---

## Node Map

Each node is a location, NPC, or object the players can investigate. Arrows show what clues each node contains and where they point.

```
[Scene of Death: Drunn's Estate]
  → Clue A1: Oil of Taggit residue in the wine decanter (points to poison, not violence)
  → Clue A2: A second wine glass — wiped clean, but faintly smells of cedar (Vane's cologne)
  → Clue A3: A torn corner of a letter in the fireplace (Drunn was drafting a message)

[The Apothecary Quarter]
  → Clue B1: A purchase record for Oil of Taggit, three weeks ago, signed with an alias
  → Clue B2: The apothecary remembers the buyer wore a city council signet ring (distinctive)
  → Clue B3: A second apothecary was approached first and refused — she remembers the buyer's voice

[Drunn's Financial Records / His Solicitor]
  → Clue C1: Three major trade contracts cancelled in the last six months, all citing the same obscure clause
  → Clue C2: The solicitor received a final message from Drunn the morning of his death: "V. knows I know."
  → Clue C3: Drunn's will names Vane as the beneficiary of his council seat

[Councillor Vane]
  → Clue D1: His alibi is his steward — who, on careful questioning (Insight DC 14), is clearly lying
  → Clue D2: His wine cellar contains the same vintage as the poisoned decanter, with one bottle missing
  → Clue D3: He becomes visibly shaken if players mention the letter (Insight DC 12)

[Marta the Servant]
  → Clue E1: She saw Vane leave Drunn's estate that evening (will lie initially; requires trust)
  → Clue E2: She found a handkerchief monogrammed "V" near the back entrance the next morning
  → Clue E3: If players protect her or promise safety, she reveals Vane threatened her silence
```

**Key Conclusions and Their Clue Coverage:**

| Conclusion | Clues Covering It |
|---|---|
| Drunn was poisoned (not natural death) | A1, A3 (implies foul play), B1 |
| The poison was Oil of Taggit | A1, B1, B3 |
| The killer was at Drunn's estate that evening | A2, E1, E2 |
| The killer has council connections | B2, C3, D2 |
| Vane is the killer | A2, B2, C2, C3, D1, D2, E1, E2 |
| Vane engineered the debts | C1, C2 (implied), D3 |
| Marta is a witness who knows more | (NPC behaviour cue — she avoids eye contact when asked direct questions) |

Every major conclusion has at least three clues. Vane as killer has eight — the players will get there even if three or four nodes go unvisited.

---

## Scene Breakdowns

### Scene 1: The Body
**Type:** Investigation
**Agenda:** Establish foul play; give players their first direction choices.

*Opening (read aloud):*
> The merchant lord lies slumped in his study chair, one hand trailing toward a wine decanter on the side table. The hearth has burned low — someone let the fire die overnight. The room smells of cedar and, beneath it, something faintly sweet.

**Clues available:**
- **A1 (Oil of Taggit residue):** Medicine DC 12 or Poisoner's Kit proficiency to identify the residue in the decanter. Fail forward: on a failure, they know it isn't natural death but not the specific poison.
- **A2 (Second wine glass):** Investigation DC 10 to notice it was wiped but not cleaned. The cedar scent is detectable passively to anyone who has met Vane (no roll needed if they have).
- **A3 (Torn letter fragment):** Investigation DC 8 — the fragment reads "...cannot let him silence me before—" It points players toward the solicitor.

**Complication:** A city watch sergeant arrives mid-scene and wants to rule it natural causes quickly (political pressure from Vane's allies). He doesn't obstruct actively but tries to limit how long the players stay.

---

### Scene 2: The Apothecary Quarter
**Type:** Social/Investigation
**Agenda:** Confirm the poison and get a description of the buyer.

Three apothecaries operate here. Two are cooperative; one (the refusal witness, **B3**) requires a successful Persuasion DC 13 or a creative approach before she'll talk.

**Clues available:**
- **B1 (Purchase record):** Available on a successful Investigation DC 10 at the cooperative apothecary. The alias "Marsh Elden" is an anagram of Ereth Vane's middle name — a puzzle hook if players want it, but not required to progress.
- **B2 (Signet ring memory):** The cooperative apothecary mentions it unprompted once she trusts the players are investigating properly.
- **B3 (Refusal witness):** The second apothecary will only speak after Persuasion DC 13 or equivalent reassurance. She describes the voice as "educated, smooth — councillor type."

**Fail-forward for B3:** If players fail the Persuasion check, she doesn't help now but the players can return after establishing official backing or finding another hook.

---

### Scene 3: Drunn's Solicitor
**Type:** Social
**Agenda:** Establish motive (debts) and reveal the final message.

The solicitor, **Aldric Wenn**, is nervous — he doesn't know who to trust. He'll share financial records freely (he wants justice) but requires Persuasion DC 11 before he produces the message "V. knows I know."

**Clues available:**
- **C1 (Cancelled contracts):** Handed over freely. A successful History DC 13 or merchant background knowledge recognises the cited clause as rarely used and usually negotiated away — these cancellations look engineered.
- **C2 (Final message):** Requires DC 11 Persuasion or a credible claim of official mandate. If players press: "V. — could that be Vane?" Wenn goes pale.
- **C3 (Will):** Wenn volunteers this once he's decided to trust the players.

---

### Scene 4: Approaching Vane
**Type:** Social (with Investigation sub-checks)
**Agenda:** Confront, probe, or gather evidence from the suspect himself.

Vane is confident and controlled. He has a prepared alibi (D1) and is polished enough that he won't crack from a single roll. This scene rewards sustained pressure across multiple approaches.

**Clues available:**
- **D1 (Lying steward alibi):** Insight DC 14 on the steward. If the players interview Vane and steward separately and compare answers, the inconsistency is automatic (no roll).
- **D2 (Missing wine bottle):** Investigation DC 12 in the wine cellar, if players get access. Access requires either Vane's permission (unlikely without a solid pretext) or an Insight/Persuasion DC 15 to talk their way in, or a more creative approach.
- **D3 (Letter reaction):** If players mention "a letter Drunn was writing," Vane's composure slips — Insight DC 12 to catch it. Even on failure, the GM can describe his pause as a free beat.

**Complication:** Vane has legal standing and political allies. If players accuse without evidence, he threatens a defamation complaint and has leverage to make it stick. This is a genuine consequence — it doesn't end the investigation but makes the endgame harder.

---

### Scene 5: Finding Marta
**Type:** Social
**Agenda:** Secure the eyewitness testimony that closes the case.

Marta won't approach the players. She must be found — Investigation DC 13 to learn she was at the estate that evening (from other servants), or a Persuasion DC 11 with a servant at Drunn's household.

Once found, she lies (Deception +4 against players' Insight). She'll open up under one of three conditions: players promise her protection (specific, believable), players reveal they already know most of the truth (showing clues from E2 unlocks her), or players have official backing.

**Clues available:**
- **E1 (Eyewitness):** Direct testimony once she opens up — names the time, the direction, the description.
- **E2 (Monogrammed handkerchief):** She kept it. Players asking about physical evidence will have her retrieve it from her quarters.
- **E3 (Vane's threat):** Once she's talking, she describes exactly what Vane said, which establishes consciousness of guilt.

---

## Timeline (What Happens Without PC Intervention)

| Day | Event |
|---|---|
| Day 0 | Body discovered. Watch sergeant moves to close case. |
| Day 1 | Vane attends the funeral and publicly expresses grief. |
| Day 2 | Vane's allies on the council begin the process to appoint him Drunn's successor. |
| Day 3 | Marta is quietly dismissed from service. |
| Day 4 | The apothecary's purchase record goes missing (Vane's agent removes it). |
| Day 5 | Wenn, the solicitor, receives an anonymous threatening letter. |
| Day 7 | Vane is formally installed. The case is closed. |

This timeline means delay has consequences, not failure — it makes certain clues harder to reach and increases the political difficulty of the endgame.

---

## Endgame Options

**Enough evidence (4+ strong clues):** The watch captain, shown the evidence, moves on Vane. Trial scene with social encounter structure — the players present, Vane's lawyers challenge, Marta's testimony is decisive.

**Moderate evidence (2-3 clues):** Vane isn't arrested but is placed under scrutiny. The players may need to set a trap — stage information that draws Vane to take a dangerous action, or pressure Marta to go public. Harder, higher stakes, more interesting.

**Insufficient evidence / players confront without proof:** Vane turns it around on them. Defamation, watch hostility, possibly an attempt on a player's life — which is itself a new clue (consciousness of guilt).

**Players go direct to Marta early:** If clever players identify and flip Marta before gathering other evidence, her testimony alone isn't enough for arrest — but it gives them a map to all other clues. Reward the insight, don't gate progress.

---

## D&D 5e Mechanical Notes

- **Skill checks used:** Investigation (physical evidence), Persuasion (NPC cooperation), Insight (detecting lies/reactions), Medicine (poison identification), History (contextual knowledge).
- **Fail-forward rule:** No single failed check should end a clue path. Failing Investigation DC for a clue: the character doesn't find it now but can try again with a different approach, assistance, or tool (Poisoner's Kit aids the poison check). Failing Persuasion: NPCs don't help now but can be revisited.
- **Passive Perception:** Use it for ambient clues (the cedar smell, Vane's visible discomfort). Players who invest in Perception should be rewarded without requiring active checks for things their characters would naturally notice.
- **Oil of Taggit** is a published poison in the 2024 PHB (Constitution save DC 13; failure — incapacitated for 1 hour; used narratively here as a slow-acting version administered in wine over days).
- **Monsters/combat:** This scenario can run without combat. Optional: Vane sends a hired thug after players on Day 3 (use Thug stat block, MM) if they're getting too close. This is a proactive clue that tells players they're on the right track and raises stakes.

---

## Key Design Principles Applied

1. **State the truth first.** The GM knows everything from page one. The players discover it at their own pace.
2. **Three clues per conclusion, not per suspect.** Every important deduction — "poison", "cedar smell = Vane", "Vane had motive", "Vane was there" — has independent coverage.
3. **Node-based, not linear.** Players can start at any node. Visiting the apothecary before the solicitor, or vice versa, produces different but equally valid paths to the same endpoint.
4. **Timeline creates urgency without railroading.** Vane's actions advance whether PCs act or not. This isn't punishment — it's a living world. Players who move quickly get more options; players who delay face a harder endgame. Both are valid.
5. **Proactive clues for stalled players.** If players are genuinely stuck, Marta makes eye contact with one of them in the market — she's frightened and clearly wants to speak. Or Wenn contacts them: "I've received a threatening letter. This is connected, isn't it."

*Sources: The Alexandrian (Three Clue Rule, Node-Based Design, Don't Prep Plots); WotC 2024 PHB (Oil of Taggit); WotC 2024 DMG (adventure design); Robin Laws / Pelgrane (GUMSHOE core clue philosophy).*

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

# The Three Clue Rule: D&D 5e Murder Mystery Design Guide

## The Core Principle

The Three Clue Rule states: **for any conclusion you want players to reach, plant at least three independently discoverable clues pointing to that same conclusion.** If players miss one, two remain. If they miss two, one is still there. This transforms a fragile, single-path investigation into a robust, player-driven experience.

In D&D 5e, this matters more than in investigation-specific games because the system's skill check mechanics can gatekeep information. A critical clue locked behind a single DC 20 Investigation roll can stall an entire session. The Three Clue Rule is your structural safety net — not a difficulty reduction, but a redundancy design.

---

## Worked Example: "The Magistrate's Last Night"

**The Truth (GM-only — read this first):**
Magistrate Edric Holloway was poisoned with Midnight Tears (ingested, no effect until midnight, then 9d6 Poison damage, DC 17 CON save). The killer is Seraphine Voss, the magistrate's own clerk, who discovered he had been embezzling temple funds and framing the local thieves' guild. She planned to expose him — then learned he had already arranged for her to take the fall. She acted first.

---

## The Node Map

Three Clue Rule requires thinking in **nodes** (locations, NPCs, documents) rather than linear scenes. Every node contains multiple clues. Every conclusion has at least three paths in.

```
[Murder Scene: Holloway's Study]
  ├── Clue A1: Overturned wine goblet (Midnight Tears residue)
  ├── Clue A2: Seating arrangement shows private dinner for two
  └── Clue A3: Holloway's appointment ledger — "S.V., private, 9th bell"

[The Victim's Body — Temple Healer Examination]
  ├── Clue B1: Poison diagnosis (Midnight Tears — ingested)
  ├── Clue B2: No signs of struggle; Holloway ate and drank willingly
  └── Clue B3: Half-digested meal consistent with a dinner, not a work meeting

[Seraphine Voss — The Clerk]
  ├── Clue C1: Visibly distressed; deflects questions about that evening
  ├── Clue C2: Her desk contains a draft letter to the Temple never sent
  └── Clue C3: A key to Holloway's private cabinet on her key ring

[Holloway's Private Cabinet]
  ├── Clue D1: Embezzlement ledger implicating Seraphine (forged by Holloway)
  ├── Clue D2: Real embezzlement ledger in Holloway's own hand (hidden false bottom)
  └── Clue D3: Letter from Holloway to a city official framing Seraphine

[The Thieves' Guild (Dockside Contact)]
  ├── Clue E1: Guild knows Holloway was skimming temple taxes
  ├── Clue E2: Guild has a letter from an anonymous source warning them of a frame-up
  └── Clue E3: Guild member saw Seraphine leaving the magistrate's building late on the night in question
```

---

## Three Clue Coverage Matrix

Every conclusion a player must reach has at least three clues pointing to it from different nodes. This table shows the coverage:

| Conclusion | Clue 1 | Clue 2 | Clue 3 |
|---|---|---|---|
| **Victim was poisoned** | B1 (healer) | A1 (goblet residue) | B3 (meal timing) |
| **Poison was Midnight Tears (ingested)** | B1 (diagnosis) | Conditions rules: no injury wound | A1 (residue in wine) |
| **Killer dined with victim** | A2 (seating) | A3 (appointment ledger) | B2 (no struggle) |
| **Seraphine is the killer** | C1 (behavior) | E3 (seen leaving) | A3 (her initials in ledger) |
| **Seraphine's motive (self-preservation)** | C2 (unsent letter) | D2 (real embezzlement ledger) | D3 (frame-up letter) |
| **Holloway was framing Seraphine** | D1 vs D2 (forged vs real) | D3 (letter to official) | C2 (Seraphine's draft) |

No conclusion depends on a single clue. Players who skip the healer still learn of poison from the goblet. Players who never crack the cabinet still learn Seraphine dined with the victim via the appointment ledger and the guild witness.

---

## Scene Designs

### Scene 1: Holloway's Study (Investigation)

**Type:** Investigation
**Agenda:** Establish method of death and narrow the suspect pool to someone with access to Holloway's private life.

**Opening (read-aloud):**
*A cold hearth. One chair pushed back at an angle, the other neatly placed. A shattered wine goblet lies on the hearthrug, its dark stain soaked deep into the wool. The magistrate's desk is immaculate — every document squared, every seal pot capped.*

**Environment:**
- The overturned goblet (Clue A1): DC 12 Investigation identifies a faint bitter smell. DC 14 Arcana or DC 15 Nature identifies it as consistent with an ingested toxin. Fail-forward: even on failure, the goblet's position signals something went wrong during the meal.
- The seating arrangement (Clue A2): DC 10 Perception — two place settings, both used.
- The appointment ledger (Clue A3): DC 10 Investigation or simply asking to search the desk. "S.V., private, 9th bell." No check required if they look.

**System Notes:**
- Magistrate's body has already been moved to the temple. If PCs ask about wounds, they must visit the healer.
- DC 12 Investigation (overall scene sweep) reveals all three clues automatically — do not gate individual clues behind separate rolls.
- Fail-forward for poison check: even a failed Nature roll produces "something was wrong with this goblet — it smells off."

---

### Scene 2: Temple Healer's Examination (Social + Investigation)

**Type:** Social / Investigation
**Agenda:** Confirm cause of death; establish that victim had to consume the poison willingly (i.e., no forced ingestion).

**Opening:**
*Brother Aldric stands over the magistrate's covered form in the temple infirmary, his expression carefully blank. He wipes his hands on a clean cloth with the mechanical repetition of a man trying to appear composed.*

**Who Is Present:**
- **Brother Aldric (healer):** Wants to be helpful; fears the political implications of naming a poison. Will share findings freely to any PC who treats him as a professional (DC 10 Persuasion or simply showing official authority). Will share everything to a Paladin or Cleric as a matter of faith.

**What Aldric Can Reveal:**
- Clue B1: Midnight Tears. He knows the poison by its presentation — no physical trauma, massive internal hemorrhage at precisely midnight. He has seen it once before in a poisoner's trial.
- Clue B2: "There is no sign of struggle. He was relaxed when he died. He consumed whatever killed him willingly, with someone he trusted."
- Clue B3: "His last meal was rich — roasted fowl, sweet wine. A dinner, not working fare."

**System Notes:**
- No check needed if PCs are respectful. DC 10 Persuasion if they are brusque.
- DC 15 Medicine confirms Aldric's findings independently.
- If PCs ask about the poison's cost or source: Midnight Tears runs ~1,500 GP. This points toward someone with access to significant funds — not a street assassin.

---

### Scene 3: Seraphine Voss at the Magistrate's Office (Social)

**Type:** Social
**Agenda:** Establish Seraphine's guilt through behavioral tells and physical evidence at her workstation.

**Opening:**
*The clerk's desk sits immediately outside Holloway's study. Seraphine Voss looks like a woman who has not slept. Her inkpot is open, a half-written document abandoned mid-sentence. She stands when you enter.*

**Who Is Present:**
- **Seraphine Voss:** Goal — to survive this. She is not innocent; she is desperate. She did not plan to become a murderer; she planned to expose a corrupt man and instead found herself cornered. She will deflect, minimize, and misdirect.

**Behavior:**
- She volunteers that she left the office at 7th bell (two hours before Holloway died, two hours before her own appointment ledger entry).
- DC 13 Insight catches the lie — her hands tighten on the desk edge when she names the time.
- Clue C1: Ask directly if she dined with Holloway → DC 15 Insight detects the micro-flinch. She says "only briefly, to go over filings."
- Clue C2: Her desk contains a draft letter to the High Temple Treasurer. "I have discovered irregularities in the magistrate's accounts..." It breaks off mid-paragraph. Visible to any PC who scans the desk (DC 10 Perception).
- Clue C3: Key on her ring that doesn't match her office locks. DC 12 Investigation identifies it as a type used for private document cabinets. She claims it is a spare she never returned.

**System Notes:**
- Insight DC is 13, not 20 — she is under pressure, not a trained spy.
- If PCs try to detain her: she does not run. She sits down and says "Then I want to speak with a temple advocate."
- If PCs are kind and give her an opening to confess: she asks "What happens to someone who kills a man who was going to destroy her?" This is not a confession in law but signals her moral state.

---

### Scene 4: Holloway's Private Cabinet (Investigation)

**Type:** Investigation
**Agenda:** Reveal both the frame-up and the real embezzlement; invert the apparent motive.

**Opening:**
*The cabinet stands behind a false panel in Holloway's study — a floor-to-ceiling bookshelf that swings on a brass pivot. Inside: rows of identical leather ledgers and a locked iron strongbox.*

**Access:**
- Seraphine's key (Clue C3) opens the cabinet and the strongbox directly.
- Thieves' Tools DC 15 opens the strongbox lock.
- The High Temple's master key (obtainable via DC 14 Persuasion with the Temple Treasurer, who is also concerned about the embezzlement) works.

**What Is Inside:**
- Clue D1: A ledger in neat, bureaucratic hand — initialed "S.V." throughout — showing temple tax diversions. This is the forgery Holloway prepared.
- Clue D2: DC 14 Investigation reveals a false bottom in the strongbox. Beneath it: a second ledger in Holloway's own hand (DC 12 Investigation confirms handwriting matches his personal letters), showing the same diversions. This is the real record.
- Clue D3: A sealed letter addressed to Alderman Cassius Dray: "When the time is right, present the clerk's ledger. She will not be able to explain it. The matter of the temple funds will be closed." Unsigned, but Holloway's seal.

**System Notes:**
- DC 14 Investigation (false bottom) is the only check with meaningful stakes. Add fail-forward: on a failure, a PC notices the strongbox is heavier than expected and can try again with Advantage if they take time to examine it carefully.
- If PCs only find D1 (the forgery) and not D2: Seraphine looks guilty. This is intentional. The truth requires the false bottom. Good investigation should change the picture.

---

### Scene 5: The Dockside Contact (Social / Optional)

**Type:** Social
**Agenda:** Provide outside corroboration; give PCs who skipped earlier scenes a second path to Seraphine as suspect.

**Who Is Present:**
- **Tomas Cray (guild fence):** Cautious, not hostile. The guild has no love for Holloway and no particular interest in protecting Seraphine. He will trade information for a small favor or DC 13 Persuasion.

**What He Can Reveal:**
- Clue E1: "Holloway's been skimming temple revenues for three years. Everyone on the docks knew. No one could prove it — he's careful."
- Clue E2: "Six weeks ago, someone sent a letter to the guildmaster. Anonymous. Said Holloway was going to frame one of his own people for the whole scheme. Warned us not to get involved."
- Clue E3: "Night he died, one of my boys was moving cargo on Harbor Street. Saw a woman leaving the magistrate's tower around the midnight bell. Well-dressed. Ink-stained fingers." (DC 12 Investigation to connect this to Seraphine from prior description.)

**System Notes:**
- This scene is optional. Skip it if the party already has sufficient evidence for Seraphine. Use it if they are stalled after Scenes 1–2 or have not visited Seraphine yet.
- Tomas will not name Seraphine; he doesn't know her name. The ink-stained fingers detail connects only if PCs noticed it earlier (or DC 12 Investigation to recall).

---

## Proactive Clues (When Players Stall)

If the players spend 20+ minutes going in circles, one of these fires automatically:

1. **Seraphine sends a message:** A temple runner arrives with a note for one PC. "I need to speak with someone before this goes further. Come alone." She is ready to confess — on her terms, to a person she trusts.
2. **Alderman Dray acts:** He visits the magistrate's office to "retrieve sensitive documents." The PCs see him going straight for the false-panel bookshelf — he knows the cabinet exists.
3. **The forgery surfaces:** A temple official presents Seraphine's forged ledger to the PCs as "evidence." The numbers are almost right but not quite — DC 13 Investigation spots a discrepancy (ink age is wrong for the dates listed).

---

## Climax: The Confrontation

When the PCs have assembled sufficient evidence, the scenario moves to confrontation. Three possible forms:

**Legal Proceeding:** PCs present evidence before the city aldermen. Requires establishing (a) cause of death, (b) Seraphine's opportunity, (c) the frame-up motive. Evidence from three different nodes meets this bar. Seraphine can testify in her own defense — and the evidence of Holloway's frame-up likely saves her from execution even if convicted.

**Private Confrontation:** PCs find Seraphine alone and present what they know. She confesses if they have the forged ledger, the real ledger, and the appointment entry. She asks: "What would you have done?" This is a role-playing scene with no single correct answer.

**The Alderman Intervenes:** If PCs take too long, Dray moves to formally accuse Seraphine using Holloway's forged evidence. The climax becomes stopping an unjust conviction — which requires the PCs to produce the false bottom ledger before the proceeding closes.

---

## Possible Resolutions

| Ending | Conditions | Consequence |
|---|---|---|
| Seraphine convicted (unjust) | PCs accept forged ledger; never find false bottom | Holloway's corruption buried; guild contact loses faith in the PCs |
| Seraphine convicted (just) | PCs find real motive but don't argue mitigation | Legal outcome, but morally ambiguous |
| Seraphine acquitted | PCs present both ledgers + D3 | Holloway's corruption exposed; temple audits; Dray investigated |
| Seraphine escapes | PCs help her flee | Guild owes PCs a favor; formal charges against PCs pending |
| No resolution | PCs abandon investigation | Dray uses forged evidence; Seraphine hangs; hooks for future revenge arc |

---

## DM Notes: Skill Check Philosophy

Consistent with D&D 5e 2024 design philosophy and the Three Clue Rule:

- **No single check should gate a major conclusion.** If one clue requires DC 18 Arcana, two other clues point to the same conclusion via DC 10 Perception and free information.
- **Fail-forward always.** A failed Insight roll on Seraphine still produces "she seems uncomfortable with that question." It just doesn't tell the PC exactly why.
- **Free information is real information.** The appointment ledger requires no roll — anyone who looks at the desk finds it. Not every clue should be hidden.
- **Social checks open doors, not gates.** Aldric shares everything if treated respectfully; the check just determines how much effort the PCs expend.

---

## Midnight Tears — Mechanical Summary (SRD 5.2)

**Type:** Ingested poison
**Cost:** 1,500 GP
**Save:** DC 17 CON
**Effect:** No immediate effect. At midnight, the victim takes 9d6 Poison damage. A failed save produces death in a healthy adult of Holloway's constitution (he had no resistance to poison).
**Significance:** The delayed onset means Seraphine was gone before the poison activated. It creates the appearance of natural death until a healer examines the body. Acquiring it required either significant wealth or dangerous underworld contacts — another investigative thread if the DM wants to extend the scenario.

*Midnight Tears is from the SRD 5.2 (Wizards of the Coast, CC-BY 4.0).*

---

## Template: Apply This Structure to Your Own Mystery

1. **Write the truth first.** Killer, method, motive, timeline. Everything else flows from this.
2. **List every conclusion players must reach.** Usually 4–6 key conclusions.
3. **For each conclusion, plant 3 clues in 3 different nodes.** Mix free information, low-DC checks, and higher-DC checks.
4. **Map the nodes.** Every node should connect to at least two other nodes so players always have somewhere to go.
5. **Write two proactive clues.** For when the table stalls.
6. **Design at least three endings.** The investigation should be completable at different evidence thresholds with different consequences.

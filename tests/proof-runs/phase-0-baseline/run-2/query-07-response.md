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

# Three Clue Rule Murder Mystery: The Thornwall Affair

A ready-to-run D&D 5e (2024) investigation adventure for 3–5 characters of any level. Uses node-based design: the PCs can reach any conclusion through multiple paths. No single clue is required.

---

## The Truth (GM Only — Read This First)

**What actually happened:** Lord Aldric Thornwall, a wealthy merchant lord, was poisoned with Midnight Tears (ingested; DC 17 CON save; 9d6 Poison at midnight) by his business partner, Mira Calstone. Aldric had discovered that Mira was skimming profits from their joint spice trade and planned to expose her the next morning. At a dinner party the previous evening, Mira slipped the poison into his wine glass. Aldric appeared fine all evening, then died in his sleep at midnight, no visible wounds. His body was found by his steward at dawn.

**Why it looks complicated:** Aldric's estranged son, Tomas, had publicly threatened him three days prior. His personal physician, Dr. Orvyn Hatch, had recently been pressured by Aldric to falsify a patient's medical records. The household cook, Bess, had been stealing small sums from the pantry budget. All three have obvious motives that point away from Mira.

---

## Hooks (Use at Least One — Three Given)

**Personal:** A PC knows Tomas Thornwall and is certain he wouldn't kill his father despite the argument. Tomas asks for help privately.

**Professional:** The City Watch approaches the party — they're overwhelmed, this is politically sensitive, and they'll pay 200 GP for a credible finding before sunset.

**Curiosity/Moral:** The party was at the dinner party themselves. They witnessed the argument between Tomas and Aldric. Something felt off about the evening.

---

## Key NPCs

**Mira Calstone** — The Killer. Composed, charming, deeply worried beneath the surface. She'll steer suspicion toward Tomas aggressively. If cornered she'll attempt to bribe the PCs (500 GP); if that fails, she has a contact in the city who can arrange "accidents." Goal: escape blame. Flaw: she kept the financial ledger evidence at her own warehouse, intending to destroy it after the heat dies down. She hasn't yet.

**Tomas Thornwall** — The Obvious Suspect. Bitter, grieving despite himself, innocent. He threatened his father over inheritance after Aldric cut him out of the will. He was seen leaving early — he can account for his whereabouts (at the Gilded Stag inn, verifiable). Will be hostile if approached clumsily; opens up if treated with dignity.

**Dr. Orvyn Hatch** — The Nervous Witness. Knows that Aldric called for wine near the end of the evening and that Mira refilled his glass personally — an unusual act he noticed but thought nothing of. Will only reveal this if the PCs earn his trust or press him meaningfully; he fears that cooperation will expose his own forgery.

**Bess the Cook** — The Red Herring. Terrified. Has been taking small amounts from the household budget. Aldric had started questioning the accounts. She had motive (fear of dismissal, possibly arrest for theft) but did not kill him. Her panic makes her look guilty. She can confirm the guest list and approximate timings if reassured.

**Sera, the Steward** — Reliable Witness. Found the body. Methodical and honest. Can describe the state of the room, confirm the dinner guest list, and note that a wine glass was missing from the table settings when she cleared up — Mira took hers with her when she left.

---

## Node Map

Every investigative conclusion has at least three independently discoverable clues across at least two nodes. The PCs cannot be locked out of the solution by a single failed roll.

```
[The Body] ──────────────────────────┐
     │ Clues: poison signs, no wounds  │
     ▼                                 │
[The Dinner Party Guests]             │
     │ Clues: Mira/glass, timeline     │
     ├──► [Dr. Hatch] ───────────────►─┤
     │    Clue: Mira refilled glass     │
     │                                  │
     ├──► [Tomas Thornwall] ──────────►─┤
     │    Exonerates himself, points     │
     │    at Mira's nervousness          │
     │                                  │
     ├──► [Bess the Cook] ───────────►──┤
     │    Red herring + guest list       │
     │                                  │
     └──► [Sera the Steward] ─────────►─┤
          Clue: missing wine glass       │
                                         ▼
[Mira's Warehouse] ─── Clue: falsified ledger proving embezzlement
[The Gilded Stag Inn] ─ Clue: Tomas's alibi (innkeeper, three witnesses)
[Apothecary Records] ── Clue: Midnight Tears purchase 4 days ago (false name, description matches Mira)
```

---

## The Three-Clue Guarantee Per Conclusion

### Conclusion: Mira Is the Killer

| Clue | Source | How Found | Skill Check |
|------|--------|-----------|-------------|
| Mira personally refilled Aldric's glass (unusual, noted) | Dr. Hatch | Earn trust or press (Social) | DC 13 CHA (Persuasion) or DC 15 CHA (Intimidation) |
| Sera noticed Mira left with her wine glass — the glass the poison was in | Sera the Steward | Ask about the dinner / scene of death | No check needed; she volunteers freely |
| Midnight Tears purchased 4 days ago under false name, physical description matches Mira | Apothecary records | Investigate the cause of death first (leads to poison), then track the purchase | DC 14 INT (Investigation) at apothecary |
| Falsified ledger showing Mira's embezzlement (motive) | Mira's Warehouse | Search warehouse — requires probable cause or legal writ, or breaking in | DC 16 INT (Investigation) to find hidden ledger |
| Mira deflects all questions about the evening and pushes suspicion toward Tomas with specific, prepared-sounding details | Social interaction | Any conversation with Mira | DC 12 WIS (Insight) — she's skilled but rattled |

**Three clues are sufficient to confront Mira.** The ledger and insight check are bonus confirmation. The party does not need all five.

### Conclusion: Cause of Death Was Poison (prerequisite node)

| Clue | Source | How Found | Skill Check |
|------|--------|-----------|-------------|
| No wounds; body unmarked; face slightly discoloured | The body | Visual inspection | No check — obvious to anyone who looks |
| Faint sweet-metallic smell around the mouth | The body | Close examination | DC 12 WIS (Perception) or DC 10 INT (Medicine) |
| Physician's initial finding: "heart failure" is suspicious given Aldric's age and health | Dr. Hatch | Ask for medical opinion | No check — he'll admit his own report troubled him |
| Residue in the wine glass found at Mira's home (if retrieved) | Mira's home | Search + Lab check | DC 14 INT (Investigation) + DC 12 INT (Alchemist tools or Medicine) |

---

## Scene Templates

### Scene 1: The Body

**Type:** Investigation
**Agenda:** Establish that this was murder, not natural death.

*Opening (read aloud):*
> The bedroom is still. Lord Thornwall lies in his bed, hands at his sides, face slack. The window is latched. The bedclothes are barely disturbed. He looks, at first, like a man who simply did not wake up — except for the faint blue tinge at the corners of his lips.

**Who Is Present:** Sera (waiting, composed), possibly a Watch officer (impatient, doesn't want this to be murder).

**Environment:**
- Bedside table: water carafe, a small stack of correspondence, a signet ring left out (unusual — he always wore it).
- The correspondence on top: a draft letter to a solicitor about dissolving the Calstone partnership, dated yesterday.
- No food or drink except the water carafe (clean; check DC 10 confirms untainted).

**Complications:** A Watch officer may push the party toward ruling it natural causes — political pressure, not malice.

**Outcomes:**
- Party identifies poison signs → moves to identify the substance and its source.
- Party misses poison signs → Tomas approaches them at the funeral the next morning with the same suspicion (proactive clue).

**System Notes:**
- DC 10 INT (Medicine) to recognise the lip discolouration as a potential toxin effect.
- DC 12 WIS (Perception) for the metallic-sweet smell.
- The draft letter is visible on the table; no check required to read it. It names Mira Calstone explicitly.

---

### Scene 2: Interviewing the Guests

**Type:** Social / Investigation
**Agenda:** Establish the timeline and identify who had access to Aldric's wine glass.

*Opening (read aloud):*
> The drawing room where the dinner guests have been asked to wait is tense. Mira Calstone stands by the window, arms folded, studying the street below. Dr. Hatch occupies a chair in the corner, turning his spectacles over in his hands. Bess stands near the door, red-eyed.

**Who Is Present:** Mira (controlled, watchful), Dr. Hatch (nervous), Bess (frightened), possibly Tomas (if not yet questioned separately).

**NPC Behaviour:**
- **Mira** volunteers early that Tomas had threatened his father and was "erratic all evening." She does not mention the wine glass unless asked specifically. DC 12 WIS (Insight) reveals she's choosing her words very carefully.
- **Dr. Hatch** will say little without pressure. A DC 13 CHA (Persuasion) or strong roleplay unlocks his observation that Mira refilled Aldric's glass — he says it only because it was odd, not accusatory.
- **Bess** is a mess. If calmed (DC 12 CHA Persuasion or kind roleplay), she produces an accurate guest list and notes that the Lord seemed "perfectly fine" all evening until he complained of a headache around the 10th bell and retired.

**Complications:** Mira attempts to redirect the conversation to Tomas's argument at every opportunity. If a PC succeeds on DC 14 CHA (Persuasion) or DC 12 WIS (Insight), they can notice she keeps steering.

**Outcomes:**
- Dr. Hatch reveals the wine glass → Sera's missing-glass clue becomes meaningful.
- Party pushes Tomas as suspect → he goes to ground, but his alibi is still findable at the Gilded Stag.

---

### Scene 3: The Apothecary

**Type:** Investigation / Social
**Agenda:** Confirm the poison and trace its purchase.

*Opening (read aloud):*
> Vials, powders, and bundles of dried herbs line every wall of Calder's Apothecary. The proprietor looks up from a pestle with the wariness of a man who regularly answers awkward questions.

**Who Is Present:** Calder the apothecary (cautious but law-abiding, respects official inquiries).

**Environment:**
- Poison sales ledger behind the counter (Calder keeps records; it's the law).
- A back room with actual poisons kept locked (AC 19, iron; HP 27).

**Key Info:** Four days ago, a woman matching Mira's description — tall, copper-streaked hair, well-dressed — purchased Midnight Tears under the name "Elara Voss." DC 14 INT (Investigation) to find the entry and cross-reference the date; Calder can describe the buyer without a check once shown cause.

**System Notes:**
- Midnight Tears: ingested poison, DC 17 CON save, 9d6 Poison at midnight, no effect before then. This explains the clean examination — he died hours after exposure.
- Calder knows Midnight Tears is used as an assassination tool; he sold it under duress (the buyer implied she had Watch connections — a lie, but Calder believed it).

---

### Scene 4: Mira's Warehouse (Optional — Confirms Motive)

**Type:** Exploration / Investigation
**Agenda:** Find the embezzlement ledger that gives Mira clear motive.

*Opening (read aloud):*
> The warehouse sits near the dockside, smelling of cinnamon and cardamom. Crates are stacked to the rafters. It feels empty — no workers today.

**Who Is Present:** One warehouse guard (CR 1/2 Guard, or roleplaying — he can be bribed for 5 GP or convinced with a DC 12 CHA check).

**Secrets:** Hidden ledger behind a false panel in the office wall (DC 16 INT Investigation). It shows two years of systematically falsified trade records — Aldric was being defrauded of approximately 4,000 GP.

**Hazards:** If Mira learns the party is here (possible if she's been watching them), she sends a hired thug (CR 1 Thug) to "discourage their curiosity" within 1d4 hours.

---

### Scene 5: The Confrontation

**Type:** Social / possible Combat
**Agenda:** Present the evidence to Mira and resolve the mystery.

**Trigger:** Party has at least three of the five clues pointing to Mira.

**Mira's Responses by Evidence Level:**

| Clues Held | Mira's Behaviour |
|-----------|-----------------|
| 1–2 clues | Dismissive, confident, threatens legal action for slander |
| 3 clues | Offers bribe (500 GP, "for your silence") |
| 4+ clues | Attempts to flee or stall for her contact to arrive |

**If Cornered:** Mira confesses under legal pressure, or fights her way out (she carries a vial of Spider's Sting poison, DC 13 CON, Poisoned 1 hour, fail by 5+ = Unconscious; she'll use it on whoever is holding her).

**Resolution Options:**
- Handed to the Watch → trial, conviction, execution or imprisonment.
- PCs deal with her privately → Tomas is grateful; Mira's criminal contact may become a future thread.
- Mira escapes → remains a villain in the campaign, knows the PCs by name.

---

## Timeline (Unopposed — If PCs Do Nothing)

| Time | Event |
|------|-------|
| Day 0, midnight | Aldric dies |
| Day 1, dawn | Body discovered |
| Day 1, morning | Tomas arrested by Watch as prime suspect |
| Day 1, afternoon | Mira visits warehouse, destroys ledger |
| Day 2 | Mira arranges to leave the city "on business" |
| Day 3 | Mira is gone. Tomas faces trial with circumstantial evidence. |

**The clock is real.** If the party moves quickly, all evidence is available. After Day 1 afternoon, the ledger is gone (Mira had 1 hour head start on them). After Day 3, Mira requires a separate adventure to find.

---

## Fail-Forward Procedures

| Situation | What Happens |
|-----------|-------------|
| Party fails to identify poison at the body | A physic hired by the family confirms poison at the funeral — passive clue, no roll required |
| Dr. Hatch refuses to talk | Sera independently remembers the missing wine glass (she was going to mention it anyway) |
| Party focuses entirely on Tomas | His alibi at the Gilded Stag is airtight — three named witnesses, innkeeper's ledger. This exoneration redirects them |
| Party never goes to the apothecary | The draft letter naming Mira (found at the body) still points at the partnership, and Mira's deflection during interviews is a second path in |

No single clue is required. Every node has a proactive fallback.

---

## Sequel Hooks

- Mira's criminal contact (the one who could arrange "accidents") is still at large and now has reason to want the PCs dealt with.
- Dr. Hatch's forged medical records concern a patient with a serious illness who was denied treatment. That patient is getting worse.
- The Thornwall estate is now Tomas's. He is grateful but inexperienced — and someone else was watching the partnership closely.

---

## Quick Reference: DCs and Checks

| Check | DC | Skill | Location |
|-------|----|-------|----------|
| Notice lip discolouration as toxin | 10 | INT (Medicine) | The body |
| Detect metallic-sweet smell | 12 | WIS (Perception) or INT (Medicine) | The body |
| Calm Bess enough to get guest list | 12 | CHA (Persuasion) | Drawing room |
| Notice Mira is steering suspicion | 12 | WIS (Insight) | Drawing room |
| Persuade Dr. Hatch to reveal wine glass | 13 | CHA (Persuasion) | Drawing room |
| Find Midnight Tears entry in ledger | 14 | INT (Investigation) | Apothecary |
| Spot Mira's over-prepared answers | 14 | CHA (Persuasion) to press / 12 WIS (Insight) to notice | Drawing room |
| Find hidden ledger in warehouse | 16 | INT (Investigation) | Warehouse office |
| Pick/break warehouse office door | 19 | DEX (Thieves' Tools) or STR | Warehouse |

---

*System note: Midnight Tears is drawn from the SRD 5.2 Poisons table (CC-BY 4.0). All other content is original.*

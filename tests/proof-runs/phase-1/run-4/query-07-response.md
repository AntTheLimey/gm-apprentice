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
  - skills/ttrpg-expert/npc-generation.md
---

# Three Clue Rule Murder Mystery: The Gilded Silence

A complete D&D 5e 2024 investigation scenario using the Three Clue Rule. Every investigative conclusion is supported by at least three independently discoverable clues across different nodes — no single missed clue can halt progress.

---

## The Truth (GM-Only)

Lord Aldric Vane, a wealthy merchant-noble, was poisoned by his own apprentice, **Sera Dusk**, using a distillation of Midnight's Bloom (a rare alchemical toxin). Sera had served Aldric for six years and discovered he was selling her family's ancestral deed to a rival lord to pay gambling debts. She chose to act before the transfer completed. The murder was methodical: Sera slipped the poison into Aldric's nightly wine, then staged the study to suggest a break-in. She has since maintained perfect composure and positioned herself as a grieving subordinate.

The deed transfer — the motive — has not yet completed. Lord Rivard, the buyer, is waiting for paperwork. He has no knowledge of the murder.

---

## Premise

The players are investigators (adventurers, Harborwatch agents, or hired by the Vane family solicitor). Lord Aldric Vane, found dead in his locked study three days ago, was publicly ruled a natural death. A junior servant has come to the party in secret claiming she saw someone leaving the study at midnight — the same night Aldric died.

---

## Hooks (≥3)

- **Personal:** One PC has family dealings with the Vane estate — they'll lose a promised contract if the estate passes into chaos.
- **Professional:** The Harborwatch (city watch equivalent) ruled it natural causes. A Watch captain who dislikes the ruling has quietly hired the party to confirm or deny foul play.
- **Moral:** The junior servant who comes to the party is Sera's younger sister — she doesn't know Sera is the killer, only that something is wrong.
- **Material:** Aldric's solicitor promises a substantial fee if the party can produce evidence sufficient to challenge the death ruling in court.

---

## Node Map

Each node can be reached from any other. No single node is required first.

```
[Vane Estate: Study]
        |
   [Clues A1, A2, A3]
        |
  ----+------+-------+
  |          |       |
[Sera]   [Servants] [Solicitor]
[Dusk]   [Quarter]  [Harlan]
  |          |           |
[B1,B2,B3][C1,C2,C3] [D1,D2,D3]
  |                       |
[Alchemist              [Rivard
 Torrin]               Holdings]
  |                       |
[E1,E2,E3]            [F1,F2]
```

---

## Investigative Conclusions and Clue Clusters

Each conclusion has ≥3 clues pointing to it from different sources. PCs need to reach the conclusions in rough order, but within each conclusion they only need to find one or two clues.

---

### Conclusion 1: Aldric was murdered (not natural causes)

**A1 — The Study** (physical evidence, no check required)
The wine goblet on Aldric's desk has a faint blue-black residue around the interior rim that ordinary wine does not leave. DC 12 Arcana or Medicine to identify it as an alchemical compound rather than simple wine sediment; automatic to notice it exists.

**A2 — The Servants' Quarter** (social, DC 12 Persuasion to loosen tongues)
Two servants independently recall that Aldric was in excellent health the day before he died — no cough, no pallor, no complaints. He even complained about being hungry and asked for an extra supper tray. This contradicts the "sudden illness" narrative.

**A3 — The Solicitor Harlan** (social, no check to receive)
Harlan mentions that Aldric had signed papers the morning of his death and his hand was steady and clear. A dying man with a wasting illness rarely has steady hands. Harlan will share this observation if the party asks whether Aldric seemed ill recently.

**Proactive clue (if party stalls):** The junior servant contacts them again — she overheard two other servants whispering that they think the death was strange, and she shares the details of the wine goblet she noticed when cleaning.

---

### Conclusion 2: The poison is Midnight's Bloom

**B1 — The Study** (no check required)
A small dark stain on the writing desk, distinct from ink, has an oily texture. DC 14 Arcana or Medicine: characteristic residue of Midnight's Bloom distillation.

**B2 — Alchemist Torrin** (social, DC 10 Persuasion to share records)
City alchemist Torrin keeps a ledger. One dose of Midnight's Bloom precursor was sold eight weeks ago. The buyer registered as "Merchant Guild — general stores" — a false entry (DC 15 Investigation to notice the handwriting matches Sera's when compared to estate papers).

**B3 — The Solicitor Harlan** (Investigation, DC 13)
Among the papers on Aldric's desk is a copy of a toxicology pamphlet Harlan had sent Aldric two months ago after a client's poisoning case. It has been heavily annotated in a hand the party can trace to Sera with other estate documents. The annotation on the Midnight's Bloom entry reads: *"delayed onset — 6 to 8 hours."*

---

### Conclusion 3: The deed transfer is the motive

**C1 — The Study** (Investigation, DC 12)
Among the papers on Aldric's desk: a draft deed transfer document. The property listed belongs to the Dusk family (Sera's family name appears in the marginalia). Transfer date: four days from the night of death. The transfer would have been completed by now if Aldric had lived.

**C2 — The Solicitor Harlan** (no check, he volunteers this once the party asks about Aldric's recent business)
Harlan confirms the deed transfer was pending. He seems uncomfortable and admits Aldric asked him to process it quickly, "before anyone could raise objection." He does not know Sera is connected — he just knows it was uncharacteristically rushed.

**C3 — Lord Rivard Holdings** (social, DC 14 Persuasion or DC 16 Deception to get Rivard's steward to talk)
Rivard's steward confirms the deal, noting the purchase price was unusually low — "distressed sale terms." The property is the Dusk family home and small farmhold. The steward is not involved in anything criminal, just business.

---

### Conclusion 4: Sera Dusk is the killer

**D1 — Sera herself** (Investigation + Insight during conversation)
Sera describes being awoken in the night by a crash from the study but says she was too frightened to investigate. DC 15 Insight: her account is rehearsed — she uses identical phrasing the second time she tells it. DC 14 Investigation cross-referencing: the crash she describes would have been heard by the servant sleeping next door, who heard nothing.

**D2 — The Servants' Quarter** (Persuasion DC 13 to get the night-servant to admit what she saw)
The junior servant (who originally approached the party) saw Sera leaving the study corridor at roughly midnight. She was afraid to say so because Sera is her supervisor. If pressed gently (or if a PC has shown kindness), she gives a description and a detail: Sera was carrying a small cloth-wrapped bundle and placed it in her apron pocket.

**D3 — Alchemist Torrin** (DC 15 Investigation on the ledger, or DC 12 Persuasion asking Torrin to describe the buyer)
Torrin describes the buyer as "a composed young woman, dark-haired, spoke well, claimed she worked for the Merchant Guild." Torrin can give a sketch-accurate description matching Sera. The false Guild entry means Torrin had no reason to report it.

---

## Key Locations

### The Vane Estate: Study (Scene 1)

Type: Investigation
Atmosphere: Expensive, still, wrong.

*Read-aloud:* The study is lined floor-to-ceiling with ledgers and correspondence. The dead man's chair still sits pushed out from the desk, a half-emptied wine goblet beside the inkwell. The window is latched from the inside. Nothing is visibly disturbed.

GM notes:
- The "break-in staging" was abandoned by Sera when she realised the window latch gave away anyone had touched it. She reset it, which is why nothing looks wrong — but nothing looks like a natural-death room either.
- Key finds: wine goblet residue (A1), oily desk stain (B1), draft deed (C1), annotated toxicology pamphlet (B3).
- DC 12 Investigation to find the pamphlet under the blotter.
- DC 14 Investigation to notice the wine goblet's residue is on the desk side, not where Aldric would hold it — suggesting the goblet was moved after he collapsed.

---

### Alchemist Torrin's Workshop (Scene 2)

Type: Social/Investigation
Atmosphere: Cluttered, acrid, precise.

*Read-aloud:* Shelves of glass and copper line every wall. The alchemist does not look up when the door opens. Ledger books are stacked on a side table, each labelled by month and year.

GM notes:
- Torrin is cooperative if treated respectfully. He is proud of his record-keeping and will show the ledger without hesitation if the party explains they are investigating a suspicious death.
- DC 15 Investigation to notice the "Merchant Guild" entry is in different ink from surrounding entries — filled in later.
- DC 13 Arcana: cross-referencing the precursor sale with known formulations confirms Midnight's Bloom.

---

### Sera Dusk (Scene 3 — First Encounter)

Type: Social
Atmosphere: Grief worn like armour.

*Read-aloud:* The young woman who answers the servants' door is dressed in muted grey. Her eyes are red-rimmed but dry. She keeps her hands folded in front of her.

Portrayal: Measured, composed, answers questions with questions. Speaks softly. Does not fill silences — lets them sit.
Voice: "That's a difficult question. What makes you ask it?"

AIMS:
- Immediate: Appear cooperative while revealing nothing incriminating.
- Short-term: Ensure the death ruling stands; the deed transfer dies with Aldric.
- Long-term: Preserve her family's home; eventually leave service.
- Instinct under pressure: Goes cold and formal rather than defensive.
- Moves: Volunteers sympathy, deflects specifics, cites poor memory for the night in question, monitors what the party knows.
- Secrets: Surface — grief seems rehearsed. Investigation — account contains a false detail (the crash). Deep — she purchased the Midnight's Bloom precursor; she was present in the corridor.

D&D Stat Block (if confrontation occurs): Use Noble (MM) + Assassin dagger attack, swap Persuasion for Deception +6.

---

### Solicitor Harlan (Scene 4 — Supporting)

Type: Social
Atmosphere: Anxious legitimacy.

3-Line: Grey-haired man who polishes his spectacles every time he's asked something uncomfortable. Speaks in complete legal sentences. Knows more than he's said because he doesn't want to be involved.

Harlan will share C2 and A3 freely once he understands the party is investigating properly. He becomes a useful ally if treated as a professional, not a suspect. He will refuse to breach client privilege unless shown legal authority or evidence of actual crime.

---

## Timeline (Unopposed)

| Day | Event |
|-----|-------|
| Day 0 (murder night) | Aldric poisoned; dies before dawn. |
| Day 1 | Watch called; rules natural causes. Deed transfer paused pending estate proceedings. |
| Day 3 | Party is approached. |
| Day 7 | Estate solicitor files deed transfer paperwork as part of standard estate settlement (standard business, unless stopped). |
| Day 10 | Lord Rivard receives the deed. Motive evidence becomes harder to prove (transfer complete). |
| Day 14 | Sera receives a small discretionary bequest from Aldric's estate. She begins quietly searching for new employment. |

**Pressure:** if the party takes longer than 10 days, Conclusion 3 (motive) becomes murkier because the deed is complete. The murder is still provable; the why becomes harder to articulate in court.

---

## Climax

Once the party has found sufficient clues (3+ conclusions, at least one clue each), they have a choice of how to confront Sera:

**Option A — Confront privately.** Sera's instinct is to go cold and deny. If the party has physical evidence (goblet residue identified, ledger entry) AND a witness (the junior servant), she will eventually break. She does not confess lightly. DC 18 Persuasion or Intimidation with evidence, or she walks out.

**Option B — Bring evidence to the Watch captain.** The captain can compel Sera to attend a formal questioning. The party's evidence package determines how the scene plays out. A complete package (all four conclusions supported) results in arrest; partial evidence results in a supervised investigation with pressure on Sera.

**Option C — Tell Sera the party knows, without going to the Watch.** Sera offers to leave the city permanently if the party lets her. Morally charged — she's not wrong that Aldric was destroying her family's home to cover gambling debts. The Watch captain is not pleased if this comes out later.

**Combat (if Sera panics):** She carries a poisoned dagger (Midnight's Bloom, DC 14 Constitution saving throw or Poisoned for 1 hour). AC 13, HP 32, Multiattack. She will flee rather than fight if she can.

---

## Possible Endings

**Full resolution:** Sera is arrested. The deed transfer is challenged in court. The Dusk family home is protected pending proceedings. The Watch captain pays the party. The junior servant is quietly devastated.

**Partial resolution:** The party proves murder but cannot conclusively name Sera. The Watch reopens the case. The deed transfer is delayed. Sera remains free but under suspicion — a potential recurring NPC.

**Moral resolution:** The party helps Sera disappear. The deed transfer is disrupted by exposing Aldric's gambling debts (C3 evidence used without accusing Sera directly). The truth never fully comes out.

**Failure state:** The deed completes. Sera is never named. The junior servant goes quiet. Months later, a rumour surfaces that Lord Rivard is looking for more "distressed sales" — and several noble households have recently lost prominent members to sudden illness.

---

## Sequel Hooks

- Lord Rivard's pattern of "distressed acquisitions" — is he connected to something bigger, or just opportunistic?
- Sera's surviving family — if she went to prison, they are in trouble. If she fled, they are unprotected. Either way, they are a hook back into the city.
- Alchemist Torrin's false ledger entry — who helped Sera file a false Guild record? She needed inside access.

---

## GM Running Notes

**First session pacing:** Introduce the hook, let the party decide their first node. The Study (A) and the Solicitor (C/A) are the lowest-friction entries. Sera (D) should come mid-investigation once the party has something to confront her with.

**If the party charges Sera too early:** She has a plausible story and no hard evidence yet contradicts it. Let her composure frustrate them. This is correct — they need to do the work.

**Skill-gated clues:** Every clue above has either a low DC (12-13) or an alternative route. No clue is behind a single high DC with no bypass. If a party member rolls poorly, apply fail-forward: they notice the evidence exists but misread it — another party member or NPC can correct the interpretation.

**The junior servant:** Do not make her a puzzle or a trap. She is a real person in a terrible situation. Her loyalty to her sister versus her conscience is the emotional core of the scenario. Let that breathe.

---

## Skill Checks Reference

| Check | DC | Location | Clue |
|-------|----|----------|------|
| Medicine or Arcana | 12 | Study | Identify residue as alchemical |
| Investigation | 12 | Study | Find deed draft under papers |
| Investigation | 14 | Study | Find annotated toxicology pamphlet |
| Persuasion | 12 | Servants | Servants confirm Aldric was healthy |
| Persuasion | 13 | Servants | Junior servant names Sera in corridor |
| Persuasion | 10 | Torrin | Torrin shows ledger |
| Investigation | 15 | Torrin | Ledger entry is in different ink |
| Arcana | 13 | Torrin | Cross-reference precursor to Midnight's Bloom |
| Insight | 15 | Sera | Her account is rehearsed |
| Investigation | 14 | Sera | Cross-reference her account with other witnesses |
| Persuasion | 14 | Rivard's Steward | Confirm distressed sale terms |

All skill checks are bypassed if the party describes a creative approach that would logically achieve the same result.

---

*Sources: The Alexandrian (Three Clue Rule, Node-Based Design); WotC 2024 DMG (adventure design); Robin Laws / Pelgrane Press (GUMSHOE core clue design principles); Sly Flourish (Lazy DM, NPC generation).*

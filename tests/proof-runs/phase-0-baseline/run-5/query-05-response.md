---
query: "Build me a GURPS 4e cat burglar, 150 points"
system: gurps-4e
type: generate
total_tokens: 0
wall_clock_ms: 0
files_loaded:
  - skills/ttrpg-expert/SKILL.md
  - skills/ttrpg-expert/systems/gurps-4e/mechanics.md
  - skills/ttrpg-expert/systems/gurps-4e/character-generation.md
  - skills/ttrpg-expert/systems/gurps-4e/chargen-kit-thief.md
---

# MIRA VOSS
**Cat Burglar — 150 points**

*A precision infiltrator who treats high-security buildings as puzzles to be solved. She cases every target obsessively, moves like smoke through dark corridors, and is out before anyone knows she was there. Takes commissions from a private fence; never asks what the client wants with it.*

---

## Campaign Defaults Assumed

| Parameter | Value |
|-----------|-------|
| Point total | 150 pts |
| Disadvantage limit | -50 pts |
| Quirk limit | -5 pts (5 quirks) |
| Genre/setting | Modern realistic (TL8) |
| Realism level | Realistic |
| Tech Level | TL8 |
| Supplements | Basic Set only |

---

## == Attributes == [130 pts]

```
ST  10  [  0]  |  DX  14  [ 80]
IQ  12  [ 40]  |  HT  11  [ 10]
```

**Archetype rationale:** DX 14 is the spine of the build — it drives Stealth 15, Climbing 14, Acrobatics 15, and every fine-motor skill. IQ 12 pays for Lockpicking 13, security electronics, and operational planning. HT 11 is the minimum worth buying: better FP for long operations, better KO resistance, and a marginally improved Basic Speed. ST 10 is baseline — cat burglars avoid fights.

---

## == Secondary Characteristics == [5 pts]

```
HP   10  [  0]  |  Will  12  [  0]
Per  13  [  5]  |  FP    11  [  0]
Basic Speed  6.25  [  0]
Basic Move      6  [  0]
Dodge           9
Damage  Thr 1d-2  /  Sw 1d
Basic Lift  20 lbs
```

**Per 13** is bought up 1 level (+5 pts). A burglar needs sharp senses — spotting cameras, guards through a window, and motion sensors. Per 13 gives Observation-13 and Search-12 without additional skill investment.

---

## == Advantages == [25 pts]

```
Flexibility            [  5]  — +3 to Climbing and Escape; squeeze through tight spaces (B56)
Luck                   [ 15]  — Reroll any one bad roll once per hour; the essential safety net (B66)
Night Vision 5         [  5]  — Reduce darkness penalties by 5 levels; works unlit buildings at night (B71)
```

**Notes:**
- **Flexibility** over Double-Jointed: saves 10 pts for skills. The +3 bonus to Climbing and Escape is the critical payoff; the full +5 only matters for truly extreme contortions.
- **Luck** is non-negotiable for a solo operator. A single critical failure on Lockpicking or Stealth can end the night — or the character. One reroll per hour is worth every point.
- **Night Vision 5** effectively eliminates the penalty for working in poorly-lit environments. At -5 lighting penalty negated, Mira operates at full skill in near-darkness without requiring gear.

---

## == Disadvantages == [-40 pts]

```
Code of Honor (Professional Thief)  [ -5]  — Never harms innocents, honors client contracts,
                                              no betrayal of employers (B127)
Greed (CR 12)                       [-15]  — Classic thief driver: roll CR when presented
                                              with a tempting opportunity to deviate (B137)
Loner (CR 12)                       [ -5]  — Prefers to work solo; -2 reaction in groups;
                                              roll CR when pressured to cooperate (B142)
Overconfidence (CR 12)              [ -5]  — Roll CR when a target seems too big; she'll
                                              take jobs she should walk away from (B148)
Secret (Criminal Career)            [-10]  — Known criminal record would mean imprisonment;
                                              she has a false identity but it's fragile (B152)
```

**Disadvantage total: -40 pts** (within -50 cap)

**Narrative coherence check:** These five disadvantages tell one story. The Code of Honor keeps her from becoming a villain; Greed explains why she can't retire; Overconfidence is why she's in trouble at the start of every adventure; Loner creates friction with party members; Secret provides external pressure and GM hooks.

---

## == Quirks == [-5 pts]

```
Always cases a target for at least 3 days before entry          [-1]
Never uses the same entry method twice on the same building     [-1]
Carries a small worn coin as a "lucky piece" at all times       [-1]
Speaks softly; almost never raises her voice                    [-1]
Dislikes heights — does the job anyway, but hates every second  [-1]
```

---

## == Skills == [35 pts]

### Core Infiltration

```
Stealth         (DX/A)  — 15  [  4]  controlling attr DX 14, effective 15
Climbing        (DX/A)  — 14  [  2]  DX 14; +3 Flexibility = 17 on contested climb checks
Acrobatics      (DX/H)  — 15  [  8]  DX 14; +2 Dodge on success; rooftop movement
Escape          (DX/H)  — 13  [  2]  DX 14; +3 Flexibility = 16 when wriggling free
Lockpicking     (IQ/A)  — 13  [  4]  IQ 12; picks most TL7-8 mechanical locks
Traps           (IQ/A)  — 11  [  1]  IQ 12; detect and disarm alarm sensors
Observation     (Per/A) — 13  [  2]  Per 13; spot surveillance, counter-surveillance
Search          (Per/A) — 12  [  1]  Per 13; locate hidden compartments, concealed items
```

### Security and Technical

```
Electronics Op (Security)  (IQ/A) — 12  [  2]  IQ 12; operate/bypass TL8 security panels
```

### Thief Utility

```
Holdout   (IQ/A)  — 11  [  1]  IQ 12; conceal tools and small items on person
Filch     (DX/A)  — 13  [  1]  DX 14; casual theft of unattended objects
Streetwise (IQ/A) — 11  [  1]  IQ 12; fences, safe houses, underworld contacts
```

### Escape and Movement

```
Jumping       (DX/E) — 14  [  1]  DX 14; clear gaps, clear fences, rooftop work
Forced Entry  (DX/E) — 14  [  1]  DX 14; when the lock won't pick, the window breaks
Running       (HT/A) — 10  [  1]  HT 11; sustained running when the sprint doesn't work
```

### Combat (Light — failure state only)

```
Brawling  (DX/E) — 14  [  1]  DX 14; Parry 10; unarmed backup
Knife     (DX/E) — 14  [  1]  DX 14; Parry 10; primary weapon
Criminology (IQ/A) — 11  [ 1]  IQ 12; anticipate security mindset, understand threats
```

**Skills total: 35 pts**

---

## == Equipment == (from $20,000 starting wealth, TL8)

```
Holdout Pistol, .380      $300   1.3 lbs   2d pi; Acc 1; Range 125/1500; RoF 3; Shots 5+1(3);
                                            Bulk -1; Rcl 3 (B278). Last resort only.
Silencer                  $400   1.0 lb    -1 damage/die; significantly quieter (B289)
Shoulder Holster          $ 50   1.0 lb    Allows Holdout roll; -1 Fast-Draw (B289)
Large Knife               $ 40   1.0 lb    sw-2 cut / thr imp; Reach C,1 / C; Parry -1 (B272)
Lockpicks                 $ 50   neg.      Basic mechanical lock kit (B289)
Electronic Lockpicks      $1500  3.0 lbs   +2 to pick electronic locks (B289)
Climbing Gear             $ 20   4.0 lbs   Hammer, spikes, carabiners (B288)
Grapnel                   $ 20   2.0 lbs   Range STx2 yds; supports 300 lbs (B288)
Rope, 3/8" (10 yds)       $  5   1.5 lbs   300 lb capacity (B288)
Night Vision Goggles      $600   2.0 lbs   Night Vision 9; 8 hours (B289). Backup to innate NV5.
Homing Beacon             $ 40   neg.      GPS tracker on vehicle if needed (B289)
Cell Phone                $250   0.25 lbs  Contact with fence; encrypted app (B288)
Disguise Kit              $200   10.0 lbs  +1 Disguise; left at base unless needed (B289)
Formal Wear (cover)       $200   2.0 lbs   Cover identity for social approach (B266)
Iron Spike x3             $  3   1.5 lbs   Wedge doors, spike locks from inside (B288)

TOTAL GEAR COST: ~$3,678   (well within $20,000)
```

**Field loadout (what she carries on a job):**
Holdout pistol + silencer (shoulder holster), large knife, lockpicks, electronic lockpicks, grapnel, rope, climbing gear, spikes x3, cell phone = approx. 15.05 lbs

```
Basic Lift: 20 lbs
Carried (field): ~15 lbs
Encumbrance: None (≤ 20 lbs)
Move: 6   Dodge: 9
```

No encumbrance penalty on a standard job. If she brings the disguise kit too, she hits Light encumbrance (Move 5, Dodge 8) — she leaves it at her vehicle.

---

## == Multi-Action Combat Skill Chains ==

**Mira's combat doctrine: she doesn't fight. These chains represent failure states.**

### Chain 1: Disengage and Flee (2-Turn)

*Situation: Spotted by a single guard; need to break contact.*

| Turn | Maneuver | Action | Roll | Notes |
|------|----------|--------|------|-------|
| 1 | All-Out Defense (Dodge) | Dodge guard's grab/attack | 9 + 2 = 11 | All-Out adds +2 to Dodge |
| 2 | Move | Sprint to exit, Acrobatics to vault obstacle | 15 | If obstacle in the way; no attack to worry about |

**Outcome:** She's gone. Don't fight; run.

### Chain 2: Silent Takedown (3-Turn)

*Situation: Must neutralize a guard without noise (last resort).*

| Turn | Maneuver | Action | Roll | Notes |
|------|----------|--------|------|-------|
| 1 | Move + Attack | Approach from behind; Brawling grapple (B370) | 14 | Reach C; must be behind target or at -2 |
| 2 | Follow-Up | Apply garrote (requires grapple; both hands) | 14* | *Defaults to DX-3 = 11 (no Garrote skill bought) |
| 3 | Hold | Maintain choke; target rolls HT each turn | — | Crushing damage; victim can't speak above whisper |

**Note:** She has no Garrote skill — this defaults to DX-3 = 11. She uses her knife or pistol if this fails. This is a last resort, not a preferred chain.

### Chain 3: Fast Exit Under Fire (1-Turn)

*Situation: Shot at from range; needs cover.*

| Turn | Maneuver | Action | Roll | Notes |
|------|----------|--------|------|-------|
| 1 | Move + Acrobatics | Roll Acrobatics to gain +2 Dodge, sprint to cover | 15 | On success: Dodge 11 this turn |

---

## == Combat Summary ==

```
Best Attack:     Knife-14 (sw-2 cut = 1d-2 cut / thr imp = 1d-2 imp, Reach C,1)
                 Holdout Pistol-14* (2d pi, silenced; *uses Guns (Pistol) default DX-4 = 10)
                 Note: No Guns skill bought — defaults DX-4 = 10. Take the knife.
Unarmed:         Brawling-14, Parry 10
Active Defense:  Dodge 9 (11 with All-Out Defense; 11 on Acrobatics success)
                 Parry 10 (knife or brawling)
Retreat:         +3 Dodge = 12 (with retreat step)
Combat Reflexes: Not taken — she avoids combat; cost redirected to skills
HP:              10 (dies at -10, unconscious check at 0)
```

**Tactical note:** Mira at close quarters has Dodge 9 and Knife-14. Against a single opponent she can hold her own briefly. Against two or more she runs. Her Acrobatics-15 means she can generally reach cover or a window before taking a second hit. The Holdout Pistol defaults DX-4 = 10 — she can fire it but misses often. If the campaign expects regular gunfights, buy Guns (Pistol) with spare points.

---

## == Point Summary ==

```
Attributes:       130 pts   (ST 0 + DX 80 + IQ 40 + HT 10)
Secondary:          5 pts   (Per +1 = 5 pts)
Advantages:        25 pts   (Flexibility 5 + Luck 15 + Night Vision 5 5)
Disadvantages:    -40 pts   (Code of Honor -5, Greed -15, Loner -5,
                             Overconfidence -5, Secret -10)
Quirks:            -5 pts   (5 × -1)
Skills:            35 pts
                ─────────
TOTAL:            150 / 150 pts
Unspent:            0 pts
```

---

## Validation Checklist

**Point Budget:**
- [x] Attributes correct: 130 pts
- [x] Secondary correct: 5 pts
- [x] Advantages correct: 25 pts
- [x] Disadvantages within -50 cap: -40 pts
- [x] Quirks at limit: -5 pts
- [x] Skills correct: 35 pts
- [x] Grand total: 150 / 150 pts — zero unspent

**Mechanical:**
- [x] Derived stats correct (HP 10, Will 12, Per 13, FP 11, BS 6.25, BM 6, Dodge 9)
- [x] No illegal advantage/disadvantage combinations
- [x] Skill prerequisites met (all skills are stand-alone or default-based)
- [x] Equipment matches skills (lockpicks for Lockpicking, climbing gear for Climbing)
- [x] Encumbrance calculated (None on field loadout)
- [x] TL8 skills and gear throughout

**Narrative:**
- [x] Disadvantages reflect concept (Greed drives her into danger; Loner creates party friction)
- [x] Skills support stated role (Stealth 15, Climbing 14, Lockpicking 13, Acrobatics 15)
- [x] Background coherent: solo professional with false identity, criminal record risk
- [x] GM hooks: Secret (criminal career), Enemy potential (former employer, rival), Greed (one more job)
- [x] Party integration: Loner means friction but she's workable; she has reasons to join a crew for a complex score

---

## GM Notes

**Skill ceiling without Combat Reflexes:** Mira is deliberately built without Combat Reflexes [15]. At 150 pts that 15 pts was more valuable in Acrobatics (level 15 vs 14) and the second level of core skills. If the campaign is more action-oriented, trade Night Vision 5 [5] and one skill point pool for Combat Reflexes and drop Per to 12.

**Guns (Pistol) upgrade:** If the GM runs modern-day scenarios with regular gunplay, the first advancement Mira should buy is Guns (Pistol) at DX+0 (1 pt = 14). It costs almost nothing and transforms her sidearm from "panic button" to "credible threat."

**Flexibility vs Double-Jointed:** She took Flexibility [5] not Double-Jointed [15]. The +3 bonus is sufficient at these skill levels (Climbing 14+3 = 17 with Flexibility is already excellent). Double-Jointed would push it to 19 but costs 10 more points that bought better infiltration skills.

**Night Vision stacking:** Her innate Night Vision 5 stacks with Night Vision Goggles (NV 9 from gear). If she wears the goggles, she effectively has Night Vision 14 — complete darkness is almost no penalty. Normally she relies on NV 5 to keep her hands free; the goggles come out for truly pitch-black vaults.

**Sources:** GURPS Basic Set Characters (B) — attributes and point costs B14; advantage costs B39-B100; disadvantage costs B124-B165; skill costs B168-B230; equipment B261-B295. All costs paraphrased per SJG Online Policy — see ATTRIBUTION.md.

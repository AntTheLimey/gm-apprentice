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

# MIREILLE "GREY" VASSEUR
Cat Burglar — 150 points

**Campaign defaults assumed:** TL8 (modern), disadvantage limit -50 pts,
quirk limit -5 pts, Basic Set only, realistic tone. No supernatural traits.

---

## Concept

Former competitive free-climber turned high-end thief. Grey specializes
in residential and gallery jobs — she scales the outside, bypasses
security, takes only what she came for, and leaves before anyone notices
she was there. She avoids confrontation religiously; a job that ends in
gunfire is a job that went wrong.

**Build path:** Physical infiltration (DX-primary). High Stealth,
Climbing, Lockpicking, and Acrobatics. Minimal combat investment —
enough to not be helpless, not enough to pick fights.

---

## Attributes

```
ST  10  [0]    DX  14  [80]
IQ  12  [40]   HT  11  [10]
```

Attribute cost: **130 pts**

---

## Secondary Characteristics

```
HP   10  [0]      Will  12  [0]
Per  13  [5]      FP   11  [0]
Basic Speed  6.25  [0]   Basic Move  6  [0]
Dodge  9           Damage  Thr 1d-2 / Sw 1d
Basic Lift  20 lbs
```

Secondary modification cost: **5 pts** (Per +1 over IQ)

---

## Advantages  [33 pts]

| Trait | Cost | Page | Notes |
|-------|------|------|-------|
| Flexibility | 5 | B56 | +3 to Climbing and Escape rolls; squeeze through tight spaces |
| Luck | 15 | B66 | Reroll any single bad roll once per hour; essential safety net |
| Night Vision 4 | 4 | B71 | Reduce darkness penalties by 4; work in near-darkness without penalty |
| Acute Vision 2 | 4 | B35 | +2 to Vision rolls; spot cameras, motion sensors, guards |
| High Manual Dexterity 1 | 5 | B59 | +1 to DX-based fine-work skills; benefits Lockpicking in particular |

**Advantages total: 33 pts**

---

## Disadvantages  [-45 pts]

| Trait | Cost | CR | Page | Notes |
|-------|------|-----|------|-------|
| Greed | -15 | 12 | B137 | Tempted by wealth; the reason she does this in the first place |
| Secret (Criminal Record) | -10 | — | B152 | Discovery means imprisonment; motivates staying low-profile |
| Overconfidence | -5 | 12 | B148 | Takes jobs she should turn down; underestimates new security |
| Loner | -5 | 12 | B142 | Prefers working solo; -2 reaction when in groups for extended time |
| Code of Honor (Professional) | -5 | — | B127 | No harming innocents; no betraying clients; honor among thieves |
| Social Stigma (Criminal Record) | -5 | — | B155 | Complications with law; -1 reaction from authority figures |

**Disadvantages total: -45 pts**

---

## Quirks  [-5 pts]

- Superstitious — considers black cats good luck and will never shoo one away [-1]
- Always cases a target at least twice before committing to a job [-1]
- Keeps a small souvenir from every successful job (nothing valuable) [-1]
- Highly sensitive to strong cologne and perfume — sneezes at the worst moments [-1]
- Refuses to hit the same target twice [-1]

**Quirks total: -5 pts**

---

## Skills  [32 pts]

### Infiltration Core

| Skill | Diff | Attr | Pts | Level | Notes |
|-------|------|------|-----|-------|-------|
| Stealth | DX/A | DX 14 | 8 | 17 | Move silently in near-darkness; primary operational skill |
| Climbing | DX/A | DX 14 | 2 | 15 | +3 from Flexibility = effective 18 for most climbs |
| Lockpicking | IQ/A | IQ 12 | 4 | 14 | +1 from HMD = effective 15; TL8 mechanical and electronic |
| Acrobatics | DX/H | DX 14 | 4 | 14 | +2 to Dodge when successful; rooftop movement, vaulting |
| Escape | DX/H | DX 14 | 2 | 13 | +3 from Flexibility = effective 16; slip bonds and tight gaps |
| Observation | Per/A | Per 13 | 2 | 13 | Spot guards, cameras, patrol patterns |
| Traps | IQ/A | IQ 12 | 1 | 11 | Detect and disarm alarm sensors; default for basic setups |
| Holdout | IQ/A | IQ 12 | 2 | 12 | Conceal tools and small items on person |
| Filch | DX/A | DX 14 | 2 | 14 | Take items from surfaces without attracting notice |

### Social and Support

| Skill | Diff | Attr | Pts | Level | Notes |
|-------|------|------|-----|-------|-------|
| Streetwise | IQ/A | IQ 12 | 2 | 12 | Navigate criminal underworld; find fences and safe houses |

### Combat (Minimal)

| Skill | Diff | Attr | Pts | Level | Notes |
|-------|------|------|-----|-------|-------|
| Guns (Pistol) | DX/E | DX 14 | 1 | 14 | Holdout pistol only; last resort |
| Knife | DX/E | DX 14 | 1 | 14 | Backup; concealed large knife |
| Brawling | DX/E | DX 14 | 1 | 14 | Unarmed backup; Parry 10 |

**Skills total: 32 pts**

---

## Combat Summary

Grey's combat doctrine is simple: don't fight. A job that requires
shooting someone went wrong before she drew the weapon.

```
Dodge  9   (10 if retreating)
Parry  10  (Brawling, -4 each additional parry same turn)
Brawl  14  — thr-1 cr (1d-3 cr at ST 10)

Knife  14  — sw-2 cut (1d-2 cut) / thr imp (1d-2 imp), Reach C,1
Pistol 14  — Holdout pistol .380: 2d pi, Acc 1, Range 125/1500
             Bulk -1, RoF 3, 5+1 shots
             Silenced: 2d-2 pi, noise significantly reduced

Acrobatics Dodge: if Acrobatics roll succeeds before combat,
  Dodge becomes 11 (9+2) for the turn.
```

**Priority in a confrontation:**
1. Stealth 17 — avoid being seen in the first place
2. Acrobatics/Climbing — escape over obstacles
3. Basic Move 6 — run; disengage is often the right play
4. Holdout pistol — only if cornered with no exit

---

## Key Skill Interactions

**Climbing with Flexibility:** Effective Climbing 18 for most
climbs (15 + 3). Difficult surfaces (wet, overhanging) at 15.
Exceptional performance at high speed possible.

**Escape with Flexibility:** Effective Escape 16. Handcuffs,
restraints, and tight ductwork all fall under this. Can squeeze
through a gap sized for someone ST 6 at a penalty.

**Lockpicking with HMD:** Effective Lockpicking 15. Work By Touch
technique (B233) defaults to Skill-4 = 11 and can be bought up —
picking in darkness without looking is within reach.

**Night Vision 4:** Up to -4 darkness penalties cancelled. A -2
(dim room, moonlight) applies no penalty at all. A -6 (very dark,
candles only) becomes -2.

**Acute Vision 2:** Vision rolls at Per 15 (13+2). Spotting a
pinhole camera, motion sensor, or guard in shadow is Per-based.

---

## Equipment

Starting wealth: $20,000 (TL8 default). Grey lives modestly —
wealth goes into tools and a low-profile apartment.

### Carried on a Job

| Item | TL | Cost | Wt | Notes |
|------|----|------|----|-------|
| Holdout Pistol, .380 | 7 | $300 | 1.3 | Concealed; backup only |
| Silencer | 7 | $400 | 1.0 | Noise reduction; -2 damage per die |
| Shoulder Holster | 5 | $50 | 1.0 | Holdout roll to conceal; -1 Fast-Draw |
| Large Knife | 0 | $40 | 1.0 | Boot knife; always on hand |
| Lockpicks | 3 | $50 | neg. | Mechanical lock work |
| Electronic Lockpicks | 7 | $1,500 | 3.0 | +2 to pick electronic locks |
| Climbing Gear | 2 | $20 | 4.0 | Spikes, carabiners, basic kit |
| Grapnel | 5 | $20 | 2.0 | Throw to ST×2 yds; 300 lb capacity |
| Rope, 3/8" (10 yds) | 0 | $5 | 1.5 | 300 lb capacity |
| Cord, 3/16" (10 yds) | 0 | $1 | 0.5 | 90 lb capacity; lighter option |
| Night Vision Goggles | 8 | $600 | 2.0 | Night Vision 9; 8 hours |
| Mini-Camera, Digital | 8 | $500 | neg. | Document security layouts; photograph targets |
| Homing Beacon | 7 | $40 | neg. | Track a target vehicle or package |
| Radio, Headset | 8 | $500 | 0.5 | 1-mile range; coordinate with outside contact |
| Pouch | 1 | $10 | 0.5 | Holds small tools |

**Job kit total:** $4,036 — 18.3 lbs

### Encumbrance

Basic Lift: ST×ST/5 = 100/5 = **20 lbs**

| Encumbrance Level | Weight | Move | Dodge |
|------------------|--------|------|-------|
| None (0) | ≤20 lbs | 6 | 9 |
| Light (1) | ≤40 lbs | 4 | 8 |

At 18.3 lbs: **No Encumbrance.** Move 6, Dodge 9.

Dropping the NVGs (2 lbs) and radio (0.5 lbs) during a
quiet residential job saves 2.5 lbs and frees the hands further.

---

## Multi-Action Skill Chains

### Chain 1: Rooftop Approach (3–4 Turns)

**Situation:** Approaching a building exterior at night with guards on a predictable patrol.

| Turn | Maneuver | Roll | Target | Notes |
|------|----------|------|--------|-------|
| 1 | Move + Stealth | Stealth 17 | Guard Per 10 | Move at half speed in shadows; darkness penalty cancelled by NV4 |
| 2 | All-Out Move | — | — | Dash to base of building while guard faces away |
| 3 | Move + Climbing | Climbing 15 (+3 Flex = 18) | — | Scale exterior; roof in 2–3 turns at 1 yd/turn |
| 4 | Stealth | Stealth 17 | Any new Per roll | Freeze or crouch on reaching roof; re-establish silence |

### Chain 2: Lock Bypass (2–3 Minutes)

**Situation:** Electronic keypad lock on a service entrance.

| Step | Roll | Target | Time | Notes |
|------|------|--------|------|-------|
| Inspect | Observation 13 | — | 1 turn | Identify lock model; note any sensors |
| Bypass | Electronics Op (Security) default IQ-5 = 7, OR | — | — | — |
| — | Lockpicking 15 (with ELockpicks +2 = 17) | — | 4 min | Against a TL8 electronic lock |
| Clear | Traps 11 | — | 1 turn | Check for secondary alarm trigger before opening |

### Chain 3: Caught — Rapid Escape (2 Turns)

**Situation:** Guard turns and shouts. Grey has 2 turns before backup arrives.

| Turn | Maneuver | Roll | Notes |
|------|----------|------|-------|
| 1 | All-Out Defense (Dodge) + Move | Dodge 11 (Acrobatics success) | If guard attacks; move toward exit |
| 1 | OR: Move + Stealth | Stealth 17 | If guard hasn't pinpointed; go dark immediately |
| 2 | Climbing 18 (w/ Flex) | — | Out the window; rope pre-attached to anchor |
| — | OR: Escape | Escape 16 (w/ Flex) | If grabbed; slip hold and run |

---

## Point Summary

```
Attributes:       130 pts  (ST 10, DX 14, IQ 12, HT 11)
Secondary mods:     5 pts  (Per 13)
Advantages:        33 pts  (Flexibility, Luck, Night Vision 4, Acute Vision 2, HMD 1)
Disadvantages:    -45 pts  (Greed, Secret, Overconfidence, Loner, CoH, Social Stigma)
Quirks:            -5 pts  (5 × -1)
Skills:            32 pts  (see skill table above)
─────────────────────────
TOTAL:            150 / 150 pts
Unspent:            0 pts
```

---

## GM Hooks

- **The fence knows something:** Grey's regular fence (Streetwise
  contact, skill 15) is being leaned on by someone who wants Grey's
  next target list. The fence hasn't told her yet.
- **The one she didn't take:** A job three years ago — she went in,
  saw something she wasn't supposed to, and left empty-handed. Whoever
  owns that secret still doesn't know she was there. Or do they?
- **The souvenir problem:** One of the mementos in her collection is
  identifiable. If the right person ever saw it, the Secret (Criminal
  Record) becomes much worse.
- **Greed check trigger:** A fence contacts her with a score that is
  clearly too dangerous — but the number is extraordinary. Roll CR 12.

---

*Cite: GURPS Basic Set — Characters (B), all page references above.
GURPS is a trademark of Steve Jackson Games. This character sheet is
fan-created content for free distribution under the SJG Online Policy.*

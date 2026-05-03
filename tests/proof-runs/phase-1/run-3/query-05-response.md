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

# MIREILLE "MIRI" VOSS
**Cat Burglar — 150 points**

*Concept:* A meticulous second-story specialist who treats every job
as a puzzle. Former architectural draughtswoman turned thief; she
knows buildings from the inside out and moves through them like a
ghost. Never carries a gun — noise and weight are both enemies.
Self-employed, never takes a job without a week's research.

---

## Assumptions (Step 0)

| Parameter | Value |
|-----------|-------|
| Point total | 150 pts |
| Disadvantage limit | -50 pts |
| Quirk limit | -5 pts (5 quirks) |
| Genre/setting | Modern realistic, TL8 |
| Realism level | Realistic |
| Tech Level | TL8 |
| Available supplements | Basic Set (B-refs throughout) |
| Special rules | None |
| House rules | None |

---

## Character Sheet

```
MIREILLE "MIRI" VOSS
Cat Burglar — 150 points

== Attributes ==
ST  9   [-10]  | DX 14  [80]
IQ 12   [40]   | HT 11  [10]

== Secondary Characteristics ==
HP   9   [+0]     | Will 12  [+0]
Per 14   [+10]    | FP  11   [+0]
Basic Speed  6.25 [+0]
Basic Move   6    [+0]
Dodge 9 | Damage Thr 1d-2 / Sw 1d-1
Basic Lift: 16.2 lbs (ST 9 × ST 9 / 5)
```

**Point check after attributes + secondary:**
ST 9 = -10; DX 14 = +80; IQ 12 = +40; HT 11 = +10 → **120 pts**
Per 14 (base IQ 12, +2 levels) = +10 → **130 pts**
Remaining: **20 pts** before disadvantages

```
== Advantages == [32 pts]
Double-Jointed         [15]  — +5 Climbing, Escape; squeeze
                               through tight spaces (B56)
Luck                   [15]  — Reroll once per hour; essential
                               safety net on jobs (B66)
Night Vision 2          [2]  — Reduce darkness penalties by 2;
                               work in near-dark interiors (B71)
```

**Running total: 130 + 32 = 162 pts. Disadvantages will bring this down.**

```
== Disadvantages == [-47 pts]
Greed (CR 12)          [-15] — Tempted by a big score; the
                               classic driver (B137)
Overconfidence (CR 12)  [-5] — Underestimates complexity of
                               jobs; takes on one too many (B148)
Curious (CR 12)         [-5] — Must look inside the locked room
                               she was told to ignore (B129)
Secret (Criminal)      [-10] — Her burglary career; [-10]
                               harmful if revealed (B152)
Sense of Duty
  (Clients)             [-5] — Once she takes a job she sees
                               it through; honor among thieves
                               (B153)
Stubbornness            [-5] — Won't abandon a plan mid-job
                               even when she should (B157)
Code of Honor
  (Professional)        [-2] — No violence, no harm to
                               innocents; expressed as quirk-
                               level given overlap with above
```

*Note: Code of Honor (Professional) at -2 reflects the "never
hurt anyone" version of a professional thief's code, priced here
as a minor variant. If your GM prices it at -5, drop Stubbornness
and gain 3 pts spare.*

**Running total: 162 - 47 = 115 pts spent so far.**
**Remaining: 35 pts for skills.**

```
== Quirks == [-5 pts]
- Hums quietly to herself while casing a building [-1]
- Always cases a target in daylight before the job [-1]
- Keeps meticulous handwritten notes in a cipher only
  she knows [-1]
- Will not work with a partner who talks during entry [-1]
- Has a weakness for impractical shoes; hates sensible
  footwear off-the-job [-1]
```

**Running total: 115 + 5 (quirks give back 5) = 110 pts spent.
Wait — quirks reduce total cost, so: 115 - 5 = 110 pts so far.
Remaining: 40 pts for skills.**

```
== Skills == [40 pts]

-- Core Infiltration --
Stealth (DX/A)-16       [4]   DX 14 +2; work unseen/unheard
                               (B222); at 16, -2 darkness
                               penalty still leaves 14+
Climbing (DX/A)-16      [4]   DX 14 +2; scaling buildings,
                               drainpipes, balconies (B183);
                               Double-Jointed adds +5 → eff. 21
                               on climbing with handholds
Lockpicking (IQ/A)-14   [4]   IQ 12 +2; bypass mechanical
                               locks (B206); TL8
Electronics Operation
  (Security) (IQ/A)-13  [2]   IQ 12 +1; defeat and bypass
                               electronic security (B189); TL8
Escape (DX/H)-14        [2]   DX 14; default Attr+0 with 2 pts
                               Hard skill; Double-Jointed adds
                               +5 → eff. 19 for slipping bonds
                               or tight-space squeezes (B192)
Traps (IQ/A)-13         [2]   IQ 12 +1; detect and disarm
                               alarm sensors (B226)
Search (Per/A)-14       [2]   Per 14; find hidden items,
                               compartments, safes (B219)
Observation (Per/A)-15  [4]   Per 14 +1; counter-surveillance,
                               spot cameras and guards (B211)
Acrobatics (DX/H)-13    [2]   DX 14 -1; +2 Dodge if
                               successful; rooftop movement
                               (B174)
Jumping (DX/E)-14       [1]   DX 14; no roll in normal
                               conditions; needed for gaps and
                               fences (B203)
Forced Entry (DX/E)-14  [1]   DX 14; break doors/windows
                               when locks won't yield (B196)

-- Supporting Skills --
Holdout (IQ/A)-13       [2]   IQ 12 +1; conceal tools and
                               equipment on person (B200)
Filch (DX/A)-14         [2]   DX 14; casual theft, pocket
                               small items without notice
                               (B195)
Shadowing (IQ/A)-12     [1]   IQ 12; follow marks, learn
                               routines before a job (B219)
Streetwise (IQ/A)-12    [1]   IQ 12; find fences, fixers,
                               safe houses (B223)

-- Professional Background --
Architecture (IQ/H)-12  [4]   IQ 12; read blueprints, identify
                               structural weak points, understand
                               building layout; not in Basic Set
                               by name — use Engineering/Civil or
                               Professional Skill (Architecture)
                               per GM preference
Criminology (IQ/A)-12   [1]   IQ 12; anticipate security
                               mindset, understand how targets
                               think (B186)
Research (IQ/A)-12      [1]   IQ 12; compile dossiers on
                               targets and buildings before jobs
                               (B217)

-- Self-Defense (minimal) --
Knife (DX/E)-15         [2]   DX 14 +1; backup only; never
                               initiates violence (B208)
Brawling (DX/E)-14      [1]   DX 14; last resort (B182)
```

**Skill total: 4+4+4+2+2+2+2+4+2+1+1+2+2+1+1+4+1+1+2+1 = 39 pts**

*(Rounding check: 40 pts allocated to skills — 1 pt left over.
Add 1 pt to Lockpicking for a clean 15, or bank it.)*

**Final allocation: Lockpicking to skill level 15 [+1 pt].**

---

## Derived Combat Values

| Value | Calculation | Result |
|-------|-------------|--------|
| Basic Speed | (HT 11 + DX 14) / 4 | 6.25 |
| Basic Move | floor(6.25) | 6 |
| Dodge | floor(6.25) + 3 | 9 |
| Parry (Knife) | floor(15/2) + 3 | 10 |
| HP | = ST | 9 |
| Thrust | ST 9 | 1d-2 |
| Swing | ST 9 | 1d-1 |

With **Combat Reflexes** (not taken — budget too tight):
*If adding Combat Reflexes, drop Night Vision 2 [2] and 2 pts of
skills to free 15 pts — or revisit at next advancement.*

---

## Equipment

*Starting wealth: $20,000 (TL8 default, B26). Miri is Average
Wealth (built into default — no wealth advantage or disadvantage
taken). Spending a working budget appropriate to a professional
thief's kit; she keeps the rest liquid.*

```
== Equipment == (from $20,000)

-- Burglar's Kit --
Lockpicks                $50      neg.   B289
Electronic Lockpicks    $1,500     3 lb  B289  +2 electronic locks
Climbing Gear (basic)    $20      4 lb   B288  hammer, spikes, carabiners
Grapnel                  $20      2 lb   B288  throws STx2 yds; 300 lb cap.
Rope, 3/8" (10 yds)       $5     1.5 lb  B288  300 lb cap.
Cord, 3/16" (10 yds)      $1     0.5 lb  B288  90 lb cap.; lighter tie-off
Iron Spike x3             $3     1.5 lb  B288  wedge doors, spike locks
Crowbar, 3'              $20      3 lb   B289  forced entry last resort

-- Observation & Documentation --
Binoculars              $400      2 lb   B289  casing from distance
Night Vision Goggles    $600      2 lb   B289  Night Vision 9 in dark interiors
Mini-Camera, Digital    $500     neg.    B289  document layouts, combinations
Mini-Recorder           $200     0.5 lb  B289  voice notes during case

-- Identity & Cover --
Disguise Kit            $200     10 lb   B289  +1 Disguise; change appearance
Formal Wear             $800      2 lb   B266  cover for upscale targets
Cell Phone              $250     0.25 lb B288  comms; operational coordination

-- Self-Defense --
Large Knife              $40      1 lb   B272  backup; never drawn first
Knife Sheath             $15     0.25 lb —     ankle or forearm carry

-- Miscellaneous --
Pouch x2                 $20      1 lb   B288  tool pouches on belt
Backpack, Small          $60      3 lb   B288  carry kit; left outside on entry

TOTAL GEAR COST: ~$4,704
REMAINING LIQUID: ~$15,296

Encumbrance:
  Gear weight: ~38 lbs (full kit including backpack)
  Basic Lift: 16.2 lbs
  Encumbrance level: Heavy (5× BL = 81 lbs; 38 lbs = Medium at
    3× BL = 48.6 lbs) → MEDIUM encumbrance on job

  Medium encumbrance: -2 Move (Move 4), -2 Dodge (Dodge 7)

  On entry, Miri leaves the backpack/heavy kit at the staging
  point and carries only: lockpicks, electronic lockpicks,
  mini-camera, cord, 1 iron spike, knife. ~6 lbs = NO
  encumbrance. Move 6, Dodge 9.
```

*Smart play: she caches most gear and enters light.*

---

## Multi-Action Combat Skill Chains

### Chain 1: Escape and Evade (Primary)
**Situation:** Miri is spotted, grabbed, or cornered. Goal: get out, not win.

| Turn | Maneuver | Action | Roll | Notes |
|------|----------|--------|------|-------|
| 1 | Change Posture / Step | Move to door or gap | — | Move 6 |
| 1 | (if grabbed) Escape | Contest vs grappler's ST | Escape 14+5=19* vs ST | Double-Jointed: +5 to Escape |
| 2 | All-Out Defense | Dodge | Dodge 9+2=11† | †+2 if Acrobatics roll (13) first |
| 3 | Move | Sprint for exit | — | 6 yards; reduce to 2 on Medium enc. |

\* **Escape 19** vs average human ST 10: almost automatic unless opponent is exceptional.

### Chain 2: Silent Approach (Standard Op)
**Situation:** Entering a target building. Guards on patrol.

| Turn | Maneuver | Action | Roll | Notes |
|------|----------|--------|------|-------|
| Any | Move | Stay in shadow, slow | Stealth 16 | -2 darkness offset by Night Vision 2 → Stealth 16 |
| — | Observation | Spot guard patrol timing | Observation 15 | Success = note gap in coverage |
| — | Climbing | Scale wall or drainpipe | Climbing 21* | *With Double-Jointed +5 and handholds |
| — | Lockpicking | Bypass lock | Lockpicking 15 (mechanical) or 15+2=17 (electronic) | Roll once; failure may trigger alarm |

---

## Combat Summary

Miri is **not a fighter**. Her combat posture is avoidance and
escape, not engagement.

| Situation | Best Option | Effective Roll |
|-----------|-------------|---------------|
| Spotted indoors | All-Out Defense + Retreat | Dodge 12 |
| Grabbed | Escape | 19 (Double-Jointed) |
| Cornered, must act | Knife attack | 15 |
| Must buy time | Knife Parry | 10 |
| Open space | Run | Move 6 |

**Do not engage unless there is no exit.** A fight is a mission
failure regardless of outcome.

---

## Point Summary

```
== Point Summary ==
Attributes:        120 pts  (ST -10, DX +80, IQ +40, HT +10)
Secondary mods:     10 pts  (Per +2 × 5 = +10)
Advantages:         32 pts  (Double-Jointed 15, Luck 15, Night Vision 2)
Disadvantages:     -47 pts  (Greed, Overconfidence, Curious, Secret,
                             Sense of Duty, Stubbornness, Code of Honor)
Quirks:             -5 pts  (5 × -1)
Skills:             40 pts

TOTAL:             150 / 150 pts
Unspent:             0 pts
```

---

## GM Hooks

- **The Client Who Knows Too Much:** The fence who sold Miri's
  contact info just got arrested. Who did he give up?
- **The Job She Can't Refuse:** A warehouse she cased 3 years ago
  finally goes on the market — but someone else is already inside.
- **The Mistake:** She left a handwritten note (her distinctive
  cipher) at a past job site. A detective just found it.
- **Greed Trigger:** Overhears two marks discussing a second safe
  she wasn't contracted to touch. Does she go for it?

---

## Advancement Notes

**First 25 points to spend:**
1. Combat Reflexes [15] — immediate defensive value
2. Per 15 [+5] — better trap/surveillance detection
3. Stealth 17 [+4 pts from current] — elite level
4. Climbing 17 [+4 pts from current]

**Alternatively:** Raise DX to 15 [+20] for broad skill improvement
across Stealth, Climbing, Escape, Knife, Lockpicking simultaneously.

---

*All rules references are to GURPS Basic Set — Characters, 4th Ed.
(abbreviated B + page). This character aid is an original creation
under the SJG Online Policy; no rule text has been reproduced
verbatim.*

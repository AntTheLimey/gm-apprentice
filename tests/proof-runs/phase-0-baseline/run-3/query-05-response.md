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

# MARA "NINE" VOSS
Cat Burglar (Physical Infiltration Specialist) — 150 points

## Campaign Parameters (Defaults Applied)

- **Point total:** 150 pts
- **Disadvantage limit:** -50 pts
- **Tech Level:** 8 (modern)
- **Setting:** Modern realistic
- **Supplements:** Basic Set only (with references noted)

---

## Concept

Mara Voss earned her street name from her nine successful escapes from police custody. She specializes in high-rise break-ins: security system bypass, silent entry, and clean extraction. She works exclusively for clients who pay well and ask no questions about method — and she has a strict personal code about not hurting anyone on a job. She is patient, meticulous, and entirely too fond of taking jobs that are slightly beyond her reach.

**Role:** Physical infiltration specialist. Primary competencies are climbing, silent movement, lock and alarm bypass. She avoids combat entirely — getting caught is a failure state, and getting shot is a career-ending one.

**Path:** Physical (DX-primary). Refer to chargen-kit-thief.md for path rationale.

---

## Attributes

| Attribute | Value | Cost |
|-----------|-------|------|
| ST | 10 | 0 |
| DX | 14 | 80 |
| IQ | 12 | 40 |
| HT | 11 | 10 |

*After Step 2 (Attributes): 130 pts spent | 20 pts remaining of 150 (plus disadvantage/quirk budget)*

---

## Secondary Characteristics

| Characteristic | Base | Modifier | Final | Cost |
|---------------|------|----------|-------|------|
| HP | ST 10 | — | 10 | 0 |
| Will | IQ 12 | — | 12 | 0 |
| Per | IQ 12 | +1 | **13** | +5 |
| FP | HT 11 | — | 11 | 0 |
| Basic Speed | (14+11)/4 = 6.25 | — | 6.25 | 0 |
| Basic Move | 6.25 → floor = 6 | — | 6 | 0 |
| Dodge | floor(6.25)+3 | — | **9** | — |
| Damage | ST 10 | — | thr 1d-2 / sw 1d | — |
| Basic Lift | 10×10/5 | — | **20 lbs** | — |

Per raised by 1 to 13 for trap detection, spotting surveillance cameras, and Observation/Search rolls. Cost: 5 pts.

*After Step 3 (Secondary): 135 pts spent | secondary mods cost 5 pts*

---

## Advantages (20 pts)

| Advantage | Cost | Page | Notes |
|-----------|------|------|-------|
| Flexibility | 5 | B56 | +3 to Climbing and Escape skill; squeeze through tight spaces. Gateway physical infiltration advantage. |
| Luck | 15 | B66 | Reroll any one bad roll once per hour. Essential safety net for solo high-risk operations. |
| **Total** | **20** | | |

**Design note:** Flexibility is strongly recommended for physical infiltrators (chargen-kit-thief.md). Luck is the most efficient broad protection for a character who relies on difficult-to-retry actions (alarm bypass, lock picking at height). The 20-pt budget is tight at 150 pts — do not cut Luck.

---

## Disadvantages (-50 pts)

| Disadvantage | Cost | Page | CR | Notes |
|-------------|------|------|----|-------|
| Greed | -15 | B137 | 12 | Tempted by the value of a score. Will accept jobs she knows are risky if the payout is high enough. |
| Secret (Criminal Career) | -10 | B152 | — | Discovery leads to arrest and a long prison sentence. Drives her use of aliases and Zeroed-adjacent behaviors. |
| Overconfidence | -5 | B148 | 12 | Consistently underestimates how hard a job is. GM may require a self-control roll before she admits a site is too dangerous. |
| Loner | -5 | B142 | 12 | Prefers to work without partners. -2 to reactions in group working situations; may refuse assistance. |
| Code of Honor (Professional) | -5 | B127 | — | Never harms bystanders or innocents. Will not betray a client. Will abort a job rather than hurt someone. |
| Enemy (Ex-Partner; Rival; Equal Power; 9 or less) | -10 | B135 | — | A former partner who believes Mara burned him on a job. Shows up at bad moments. |
| **Total** | **-50** | | | |

**Disadvantage limit:** -50 pts (at cap).

---

## Quirks (-5 pts)

- Keeps a cat at home; worries about it constantly during long jobs. [-1]
- Always cases a target for at least one week before entry — will cancel if she can't. [-1]
- Never uses her real name with clients. [-1]
- Chain-smokes on the roof immediately after a successful job. [-1]
- Genuinely underestimates how much noise she makes when she gets excited. [-1]

**Total:** -5 pts

---

## Skills (50 pts)

### Core Infiltration

| Skill | Ctrl Attr | Diff | Pts | Effective Level | Notes |
|-------|-----------|------|-----|-----------------|-------|
| Stealth | DX 14 | A | 8 | **16** | +2 above DX. Primary approach skill. Move at full speed with -5 penalty (B222). |
| Climbing | DX 14 | A | 4 | **15** (+3 Flex = **18**) | +1 above DX; Flexibility adds +3 for a practical working level of 18. |
| Acrobatics | DX 14 | H | 4 | **14** | = DX. +2 Dodge if roll succeeds before move; rooftop chases and drops. |
| Escape | DX 14 | H | 2 | **13** (+3 Flex = **16**) | -1 DX; Flexibility adds +3. Slip restraints and squeeze through gaps. |
| Forced Entry | DX 14 | E | 1 | **14** | = DX. Break door, window, or hatch when finesse fails. |
| Jumping | DX 14 | E | 1 | **14** | = DX. Cross gaps, clear fences. No roll normally needed; roll when it matters. |

### Security Bypass

| Skill | Ctrl Attr | Diff | Pts | Effective Level | Notes |
|-------|-----------|------|-----|-----------------|-------|
| Lockpicking | IQ 12 | A | 4 | **13** | +1 IQ. TL8. Core bypass skill; use with Electronic Lockpicks (+2 bonus gear). |
| Traps | IQ 12 | A | 2 | **12** | = IQ. Detect and disarm alarm sensors, mechanical triggers. |
| Electronics Op. (Security) | IQ 12 | A | 2 | **12** | = IQ. TL8. Operate, bypass, and spoof security cameras and panels. |
| Holdout | IQ 12 | A | 2 | **12** | = IQ. Conceal tools and weapons on person; resist Search. |
| Filch | DX 14 | A | 1 | **13** | -1 DX. Casual theft from nearby surfaces without being noticed. |

### Surveillance and Awareness

| Skill | Ctrl Attr | Diff | Pts | Effective Level | Notes |
|-------|-----------|------|-----|-----------------|-------|
| Observation | Per 13 | A | 2 | **13** | = Per. Spot guards, cameras, patterns; counter-surveillance during casing. |
| Search | Per 13 | A | 2 | **13** | = Per. Find hidden compartments, safes, concealed items on site. |
| Shadowing | IQ 12 | A | 2 | **12** | = IQ. Follow marks without being spotted; tail security patrols. |

### Social and Cover

| Skill | Ctrl Attr | Diff | Pts | Effective Level | Notes |
|-------|-----------|------|-----|-----------------|-------|
| Streetwise | IQ 12 | A | 2 | **12** | = IQ. Navigate criminal underworld; find fences, clients, safe houses. |
| Fast-Talk | IQ 12 | A | 2 | **12** | = IQ. Talk her way past security if spotted; bluff on the spot. |
| Savoir-Faire (High Society) | IQ 12 | E | 1 | **12** | = IQ. Pass as a guest at high-end venues she targets. |
| Criminology | IQ 12 | A | 2 | **12** | = IQ. Understand security design philosophy; anticipate what she'll face. |
| Driving (Automobile) | DX 14 | A | 1 | **13** | -1 DX. TL8. Getaway driving; surveillance from vehicle. |

### Backup Combat

| Skill | Ctrl Attr | Diff | Pts | Effective Level | Notes |
|-------|-----------|------|-----|-----------------|-------|
| Guns (Pistol) | DX 14 | E | 1 | **14** | = DX. TL8. Last resort only. Holdout pistol at this level is adequate. |
| Knife | DX 14 | E | 1 | **14** | = DX. Concealable backup; parry at 10. |
| Brawling | DX 14 | E | 1 | **14** | = DX. Unarmed. Parry at 10. Escape-first doctrine. |
| Running | HT 11 | A | 2 | **11** | = HT. Sustained sprint when the job goes wrong. |

**Skills subtotal: 50 pts**

---

## Point Summary

| Category | Points |
|---------|--------|
| Attributes | 130 |
| Secondary (Per +1) | 5 |
| Advantages | 20 |
| Disadvantages | -50 |
| Quirks | -5 |
| Skills | 50 |
| **TOTAL** | **150 / 150** |
| Unspent | 0 |

---

## Equipment

Starting wealth: $20,000 (TL8 default). She keeps cash reserves and owns a modest apartment. Gear below represents her working loadout.

### Full Loadout

| Item | Cost | Weight (lbs) | Notes |
|------|------|-------------|-------|
| Large Knife | $40 | 1.0 | B272. sw-2 cut / thr imp, Reach C,1. Concealable. |
| Holdout Pistol, .380 | $300 | 1.3 | B278. 2d pi, Acc 1, Range 125/1500, RoF 3, Shots 5+1(3), Bulk -1. |
| Silencer (TL6) | $400 | 1.0 | B278. -1 dam/die; dramatically reduces noise. |
| Shoulder Holster | $50 | 1.0 | B289. Allows Holdout roll; -1 Fast-Draw. |
| Electronic Lockpicks | $1,500 | 3.0 | B289. TL7. +2 to pick electronic locks. |
| Climbing Gear (hammer, spikes, carabiners) | $20 | 4.0 | B288. Basic kit. |
| Grapnel | $20 | 2.0 | B288. Throw to ST×2 yds; supports 300 lbs. |
| Rope, 3/8" (10 yds) | $5 | 1.5 | B288. 300 lb capacity. |
| Night Vision Goggles | $600 | 2.0 | B289. Night Vision 9; 8 hours. |
| Bug, Audio ×2 | $400 | neg. | B289. -7 to spot; 1/4-mile range; 1-week battery. |
| Mini-Camera, Digital | $500 | neg. | B289. Optical disk; documents the site during casing. |
| Binoculars | $400 | 2.0 | B289. (TL-4) levels Telescopic Vision for surveillance. |
| Cell Phone | $250 | 0.25 | B288. Communications; coordination with fence. |
| Pouch | $10 | 0.5 | B288. Holds 3 lbs of small tools. |
| All-black work clothes | $100 | 2.0 | No game bonus, but -2 to Spot (GM's call) in low light. |
| **Total** | **$4,595** | **~21.55 lbs** | |

**Encumbrance (full loadout):** 21.55 lbs against BL 20 lbs → **Light** encumbrance.
- Move: 6 - 1 = **5**
- Dodge: 9 - 1 = **8**

### Job Kit (stripped for the job)

Leave disguise kit, binoculars, and surveillance bugs behind. Carry:

| Item | Weight |
|------|--------|
| Night Vision Goggles | 2.0 |
| Electronic Lockpicks | 3.0 |
| Climbing Gear | 4.0 |
| Grapnel | 2.0 |
| Rope (10 yds) | 1.5 |
| Holdout Pistol + Silencer + Holster | 3.3 |
| Large Knife | 1.0 |
| **Job Kit Total** | **~16.8 lbs** |

**Encumbrance (job kit):** 16.8 lbs against BL 20 lbs → **None** encumbrance.
- Move: **6** (full)
- Dodge: **9** (full)

Remaining wealth after gear: approximately $15,405 (savings, apartment, vehicle).

---

## Combat Summary

Mara's combat doctrine is **avoidance first, escape second, fight only if cornered**.

| Defense | Value | Notes |
|---------|-------|-------|
| Dodge | 9 (job kit) / 8 (full load) | Primary defense; retreat adds +3 |
| Parry (Knife 14) | 10 | -4 cumulative same weapon |
| Parry (Brawling 14) | 10 | |

| Attack | Skill | Damage | Notes |
|--------|-------|--------|-------|
| Holdout Pistol | 14 | 2d pi (-1/die with silencer = 2d-2 pi) | Last resort only |
| Knife (thrust) | 14 | thr-1 imp = 1d-3 imp | Close quarters |
| Knife (swing) | 14 | sw-2 cut = 1d-2 cut | |
| Brawling (punch) | 14 | thr-2 cr = 1d-4 cr | Unarmed |

**Tactical notes:**
- If detected, first option is Stealth (move to shadows) or Fast-Talk (explain presence).
- If grabbed, Escape at **16** (with Flexibility) will usually succeed.
- If cornered with armed opposition, Dodge-and-retreat to create distance, then run.
- Acrobatics at 14: a pre-move success gives +2 Dodge for that turn; useful on rooftops.

---

## Multi-Action Combat Chain: Escape Under Fire (2-Turn)

**Situation:** Mara is spotted and a guard closes to grapple.

| Turn | Maneuver | Action | Roll | Notes |
|------|----------|--------|------|-------|
| 1 | Step and Attack | Acrobatics before moving | 14 or less | Success: +2 Dodge this turn (Dodge = 11) |
| 1 | — | Dodge guard's grapple | 11 (or 9) | Retreat to add +3 if needed (Dodge 14!) |
| 2 | Move | Full move 6 yds | — | Head for exit or climb point |
| 2 | — | Guard pursues; Quick Contest Running if caught | 11 vs guard | Running skill used here |

If guard gets through: Escape at 16 to break the grapple (roll 3d6 ≤ 16 — nearly automatic).

---

## Effective Skill Levels (Working Reference)

| Skill | Effective Level | Difficulty of Action |
|-------|----------------|---------------------|
| Stealth (moving) | 16 | -5 penalty to move at full speed → still 11 |
| Climbing | 18 (with Flexibility) | Difficult surfaces at -6 → still 12 |
| Escape from grapple | 16 (with Flexibility) | Handcuffs at -5 → 11 |
| Lockpicking (electronic, with gear) | 13 + 2 = **15** | Complex lock at -5 → 10; take time for bonus |
| Electronics Op. (Security) | 12 | Average security panel at no penalty |
| Observation (spotting camera) | 13 | Concealed camera (-5 to spot) → Per 8 base, but Observation 13 |

---

## GM Hooks

- **The Ex-Partner:** Marcus Fane, her Enemy, was cut out of a job three years ago when Mara judged him a liability mid-op. He believes she pocketed his share. He's now working with the same criminal networks she does — and he's been talking.
- **The Client She Can't Refuse:** A contact has a job that pays 10× her normal rate. Her Greed will trigger — CR 12 to turn it down. The job, of course, involves something her Code of Honor may prevent her from completing.
- **Nine Lives:** She has escaped custody nine times. The tenth will end differently — unless she can find a way out that requires everything she has.
- **The Score of a Lifetime:** There is always one job too big to pass up. When it appears, her Overconfidence will assure her she can handle it.

---

## Source References

- Character generation workflow: GURPS Basic Set Characters, B12-B31 (chargen), B487 (point levels)
- Attributes and costs: B14-B17
- Secondary characteristics: B16-B17
- Advantages — Flexibility: B56; Luck: B66
- Disadvantages — Greed: B137; Overconfidence: B148; Loner: B142; Code of Honor: B127; Secret: B152; Enemy: B135
- Skills — Stealth: B222; Climbing: B183; Lockpicking: B206; Acrobatics: B174; Escape: B192; Observation: B211; Search: B219; Traps: B226; Electronics Operation: B189; Holdout: B200; Filch: B195; Shadowing: B219; Streetwise: B223; Fast-Talk: B195; Criminology: B186; Brawling: B182; Knife: B208; Guns (Pistol): B198; Running: B218; Driving: B188; Savoir-Faire: B218
- Equipment: B271-B289
- Encumbrance: B17

> GURPS is a trademark of Steve Jackson Games, and its rules and art are copyrighted by Steve Jackson Games. All rights are reserved by Steve Jackson Games. This character sheet is original content created as a game aid and is released for free distribution, not for resale, under the permissions granted in the Steve Jackson Games Online Policy (https://www.sjgames.com/general/online_policy.html). Skill descriptions, advantage text, and disadvantage text have been summarized in original language; no verbatim rule text has been reproduced.

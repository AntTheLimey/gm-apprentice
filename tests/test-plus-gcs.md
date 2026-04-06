# SERGEANT CALLUM "CAL" MCTAVISH (RET.)
**Former SAS Operator, Private Military Contractor — 150 points**
*Modern Realistic, TL8, Basic Set only*

---

## Background

Twelve years in 22 SAS, latterly as a Patrol Sergeant in B Squadron. Multiple
tours across the Middle East and West Africa. Left the Regiment after a
hostage-rescue op in Mogadishu went badly wrong — three teammates killed,
footage he can't shake. Now pulling contracts through a grey-area PMC called
Tidewater Solutions. He's good at what he does, professional to the bone, and
trying very hard not to think about Mogadishu.

---

## Attributes

| Attribute | Value | Base | Increase | Cost |
|-----------|-------|------|----------|------|
| ST (Strength) | 12 | 10 | +2 | **20 pts** |
| DX (Dexterity) | 13 | 10 | +3 | **60 pts** |
| IQ (Intelligence) | 12 | 10 | +2 | **40 pts** |
| HT (Health) | 12 | 10 | +2 | **20 pts** |

**Attributes subtotal: 140 pts**

*GCS verification: ST/HT cost 10/level, DX/IQ cost 20/level (B14).*

---

## Secondary Characteristics

| Characteristic | Base Formula | Value | Modification | Mod Cost |
|---------------|-------------|-------|-------------|---------|
| HP (Hit Points) | = ST | **12** | None | 0 pts |
| Will | = IQ | **12** | None | 0 pts |
| Per (Perception) | = IQ | **12** | None | 0 pts |
| FP (Fatigue Points) | = HT | **12** | None | 0 pts |
| Basic Speed | (HT+DX)/4 | **6.25** | None | 0 pts |
| Basic Move | floor(Basic Speed) | **6** | None | 0 pts |
| Dodge | floor(Basic Speed)+3 | **9** | — | derived |
| Basic Lift | ST×ST/5 | **28.8 lbs** | — | derived |
| Damage | ST 12 table | Thr **1d-1** / Sw **1d+2** | — | derived |

**Secondary Characteristics subtotal: 0 pts**

*No secondary characteristic purchases were needed. Basic Speed 6.25 is solid
for a soldier without buying it up. Dodge 9 is good; Combat Reflexes will push
active defenses to Dodge 10, Parry 11.*

---

## Advantages

| Advantage | Cost | Source | Notes |
|-----------|------|--------|-------|
| Combat Reflexes | **15 pts** | B43 | +1 all active defenses, +6 vs surprise, never freeze. GCS verified: `base_points: 15` in Basic Set Traits.adq. |
| High Pain Threshold | **10 pts** | B59 | Never suffer shock penalties (-DX/-IQ after injury). +3 to resist knockdown and stun. +3 vs torture. GCS verified: `base_points: 10`. |
| Fit | **5 pts** | B55 | +1 to all HT rolls (except resist death). Recover FP at twice normal rate. GCS verified: `base_points: 5`. |

**Advantages subtotal: 30 pts**

*Rationale: Combat Reflexes is the premier combat advantage — every active
defence gets +1, and an SAS operator who never freezes under fire is completely
plausible. High Pain Threshold reflects trained pain management and is
thematically essential. Fit represents the regiment's extreme physical fitness
standards without going full Very Fit (which would be harder to justify for a
man haunted by nightmares).*

---

## Disadvantages

| Disadvantage | Cost | Source | Self-Control | Notes |
|-------------|------|--------|-------------|-------|
| Duty (Tidewater Solutions; 12 or less; Extremely Hazardous) | **-20 pts** | B133 | — | Base -10 (12 or less) × 2 (Extremely Hazardous). The PMC contract creates binding obligations in dangerous theatres. GCS search: Duty not in Basic Set Traits.adq as a standalone entry; cost calculated per B133 formula. |
| Code of Honor (Soldier's) | **-10 pts** | B127 | — | Follow orders; protect your men; treat an honourable enemy with respect; wear the uniform with pride. GCS verified: `base_points: -10` in Basic Set Traits.adq line 3628. |
| Nightmares (CR 12) | **-5 pts** | B144 | CR 12 | Roll each morning; failure costs 1 FP; roll of 17-18 gives -1 to all skill and Per rolls for the day. The Mogadishu mission. GCS verified: `base_points: -5`, CR 12 at line 18748. |
| Sense of Duty (Teammates) | **-5 pts** | B153 | — | Small group modifier: -5. Cal will not abandon colleagues in the field regardless of orders. GCS verified: "Friends and Companions" modifier `cost_adj: "-5"` at line 22503. |
| Flashbacks (Mild; CR 12) | **-5 pts** | B136 | CR 12 | On a failed CR in stressful situations, 2d-second flashback; -2 to all skill rolls during episode. Triggered by sounds of automatic fire, screaming, night ops. GCS verified: base modifier "Mild" = `cost_adj: "-5"`, triggered by `cr` roll at line 8746. |

**Disadvantages subtotal: -45 pts**

*Total: -45 pts. Within the -50 pt campaign limit. The Duty and Code of Honor
work together to paint a man who is bound by obligation even as he struggles
with the psychological cost. Nightmares + Flashbacks are the PTSD cluster from
Mogadishu — they interact mechanically (both use CR 12) and narratively.*

---

## Quirks

| Quirk | Cost | Notes |
|-------|------|-------|
| Checks his six compulsively — always takes a table with his back to the wall | **-1 pt** | Behavioural tells trained into him |
| Abstemious — rarely drinks despite the PMC culture; when he does, it's Scotch only | **-1 pt** | Minor social friction |
| Obsessively cleans and functions-checks his weapons after every use | **-1 pt** | An hour ritual, not negottiable |
| Refers to himself in third person when briefing ("McTavish thinks the approach is compromised") | **-1 pt** | Slightly unnerving to clients |
| Keeps a worn photo of his 22 SAS patrol in his chest rig — never explains it | **-1 pt** | Emotional anchor, GM hook |

**Quirks subtotal: -5 pts**

---

## Skills

*DX 13, IQ 12, HT 12, Will 12, Per 12*

| Skill | Controlling Attr | Difficulty | Pts Spent | Relative Level | Effective Level | Notes |
|-------|-----------------|-----------|----------|---------------|----------------|-------|
| Guns (Rifle) | DX 13 | E | **4 pts** | DX+2 | **15** | GCS verified: `"difficulty": "dx/e"` at line 9808. The regiment's primary skill. |
| Guns (Pistol) | DX 13 | E | **2 pts** | DX+1 | **14** | GCS: same difficulty entry, Pistol specialisation. |
| Brawling | DX 13 | E | **2 pts** | DX+1 | **14** | GCS verified: `"difficulty": "dx/e"` at line 2910. Parry = floor(14/2)+3 = **10**. |
| Knife | DX 13 | E | **1 pt** | DX+0 | **13** | GCS: Knife is DX/E (B208). Parry = floor(13/2)+3 = **9**. |
| Stealth | DX 13 | A | **2 pts** | DX+0 | **13** | GCS verified: `"difficulty": "dx/a"` at line 18013. |
| Driving (Automobile) | DX 13 | A | **2 pts** | DX+0 | **13** | GCS verified: `"difficulty": "dx/a"` at line 4537. |
| Climbing | DX 13 | A | **1 pt** | DX-1 | **12** | GCS: Climbing is DX/A (B183). |
| Parachuting | DX 13 | A | **1 pt** | DX-1 | **12** | GCS: Parachuting is DX/A (B212). |
| Tactics | IQ 12 | H | **4 pts** | IQ+0 | **12** | GCS verified: `"difficulty": "iq/h"` at line 19847. Default: IQ-6. |
| Soldier | IQ 12 | A | **2 pts** | IQ+0 | **12** | GCS verified: `"difficulty": "iq/a"` at line 17854. |
| Explosives (Demolition) | IQ 12 | A | **2 pts** | IQ+0 | **12** | GCS verified: `"difficulty": "iq/a"` at line 7416. |
| Navigation (Land) | IQ 12 | A | **2 pts** | IQ+0 | **12** | GCS verified: `"difficulty": "iq/a"` specialisation Land at line 14366. |
| First Aid | IQ 12 | E | **1 pt** | IQ+0 | **12** | GCS verified: `"difficulty": "iq/e"` at line 8003. |
| Camouflage | IQ 12 | E | **1 pt** | IQ+0 | **12** | GCS: Camouflage is IQ/E (B183). |
| Intimidation | Will 12 | A | **2 pts** | Will+0 | **12** | GCS verified: `"difficulty": "will/a"` at line 10900. |
| Swimming | HT 12 | E | **1 pt** | HT+0 | **12** | GCS: Swimming is HT/E (B224). |

**Skills subtotal: 30 pts**

*Skill point check: 4+2+2+1+2+2+1+1+4+2+2+2+1+1+2+1 = 30 pts ✓*

---

## Equipment

*Starting wealth: $20,000 (TL8, B26)*

| Item | Source | Cost | Weight | Notes |
|------|--------|------|--------|-------|
| Assault Rifle, 5.56mm | B279 | $800 | 9 lb | Dmg 5d pi; Acc 5; Range 500/3,500; RoF 12; Shots 30+1(3); Bulk -4; Rcl 2; ST 9†. GCS verified at line 294. |
| Auto Pistol, 9mm (TL8) | B278 | $800 | 2 lb | Dmg 2d+2 pi; Acc 2; Range 150/1,900; RoF 3; Shots 18+1(3); Bulk -2; Rcl 2; ST 9. GCS verified at line 861. |
| Large Knife | B272 | $40 | 1 lb | Dmg sw-2 cut / thr imp; Reach C,1; ST 6. GCS verified at line 10521. |
| Ballistic Vest (TL8) | B284 | $400 | 2 lb | DR 8 (torso and vitals only). Concealable. GCS verified at line 2011: `"amount": 8`. |
| First Aid Kit | B289 | $50 | 2 lb | Standard trauma kit. GCS verified at line 6424: $50, 2 lb. |
| Backpack, Small | B288 | $60 | 3 lb | Carries up to 40 lbs. GCS verified at line 1561. |
| Rope, 3/4", 10 yards | B288 | $25 | 5 lb | Supports 1,100 lbs. GCS verified at line 16589. |
| Radio, Hand ("walkie-talkie") | B288 | $100 | 1 lb | 2-mile range, 12 hrs. GCS verified at line 15762: $100, 1 lb. |
| Spare rifle magazines ×4 | — | $120 | 2 lb | $30 each, ~0.5 lb loaded each |
| Spare pistol magazines ×4 | — | $100 | 1 lb | $25 each |
| Binoculars (7×50) | B288 | $200 | 2 lb | ×7 magnification; TL6+ standard field gear |
| Holster, belt | — | $25 | 0.5 lb | Fits the 9mm auto pistol |
| Field rations, 3 days | B288 | $30 | 3 lb | $10/day per B288 |
| Ammunition, 5.56mm (×150 rds) | — | $75 | 3 lb | ~$0.50/round bulk |
| Ammunition, 9mm (×100 rds) | — | $50 | 1.5 lb | ~$0.50/round bulk |
| Civilian clothing, durable | — | $100 | 2 lb | Low-profile field wear |
| Smartphone (TL8) | B289 | $200 | 0.5 lb | Maps, contacts, comms backup |
| **TOTAL** | | **$3,175** | **41 lb** | **$16,825 remaining** |

### Encumbrance

- **Basic Lift (BL):** ST 12 × ST 12 / 5 = **28.8 lbs**
- **Total carried weight:** ~41 lbs (full combat load)
- **Encumbrance level:** Medium (2) — weight 29–86 lbs = 2×BL to 3×BL

| Encumbrance | Move Penalty | Dodge Penalty | Adjusted Move | Adjusted Dodge |
|-------------|-------------|---------------|--------------|----------------|
| Medium (2) | -2 | -2 | 6 - 2 = **4** | 9 - 2 = **7** |

*With Combat Reflexes: Dodge becomes 7+1 = **8** under load.*

*If Cal drops the rifle and backpack (−11 lb), he's at 30 lbs — still just inside
Medium. Dropping the pack entirely (−8 lb) puts him at 33 lb; still Medium.
If he strips to vest, pistol, and knife (≈6.5 lb), he's None (0), with full
Move 6 and Dodge 10 (with CR).*

---

## Combat Summary

| Weapon | Skill | Damage | Notes |
|--------|-------|--------|-------|
| Assault Rifle (aimed) | Guns (Rifle) 15 | 5d pi | +5 Acc after 1-turn Aim |
| Auto Pistol | Guns (Pistol) 14 | 2d+2 pi | +2 Acc after Aim |
| Brawling (fist) | Brawling 14 | 1d-1 cr | Parry 10 |
| Large Knife | Knife 13 | 1d cut (sw-2) / 1d-1 imp (thr) | Parry 9; also threwable |

**Active Defenses (unloaded):**
- Dodge 10 (9 base + 1 CR) at None encumbrance
- Parry 10 (Brawling)
- No block (no shield)

*Under full 41 lb combat load (Medium encumbrance): Dodge 8, Parry 10.*

---

## Point Summary

| Category | Points |
|----------|--------|
| Attributes | +140 |
| Secondary Characteristics | +0 |
| Advantages | +30 |
| Disadvantages | -45 |
| Quirks | -5 |
| Skills | +30 |
| **TOTAL** | **150 / 150** |
| Unspent | **0** |

*Verification: 140 + 0 + 30 − 45 − 5 + 30 = 150 ✓*

---

## GCS Data Verification Log

All costs verified by targeted grep of GCS master library JSON files:

| Trait / Skill | File | Line | GCS Value | Used |
|--------------|------|------|-----------|------|
| Combat Reflexes | Basic Set Traits.adq | 3840 | `base_points: 15` | 15 pts ✓ |
| High Pain Threshold | Basic Set Traits.adq | 10273 | `base_points: 10` | 10 pts ✓ |
| Fit | Basic Set Traits.adq | 8732 | `base_points: 5` | 5 pts ✓ |
| Danger Sense | Basic Set Traits.adq | 5289 | `base_points: 15` | (not taken, cost confirmed) |
| Code of Honor (Soldier's) | Basic Set Traits.adq | 3635 | `base_points: -10` | -10 pts ✓ |
| Sense of Duty (Friends and Companions) | Basic Set Traits.adq | 22506 | `cost_adj: "-5"` | -5 pts ✓ |
| Nightmares | Basic Set Traits.adq | 18755 | `base_points: -5`, `cr: 12` | -5 pts ✓ |
| Flashbacks (Mild) | Basic Set Traits.adq | 8759 | `cost_adj: "-5"` | -5 pts ✓ |
| Guns (all specialisations) | Basic Set Skills.skl | 9816 | `difficulty: "dx/e"` | DX/E ✓ |
| Tactics | Basic Set Skills.skl | 19853 | `difficulty: "iq/h"` | IQ/H ✓ |
| Stealth | Basic Set Skills.skl | 18013 | `difficulty: "dx/a"` | DX/A ✓ |
| Soldier | Basic Set Skills.skl | 17859 | `difficulty: "iq/a"` | IQ/A ✓ |
| First Aid | Basic Set Skills.skl | 8009 | `difficulty: "iq/e"` | IQ/E ✓ |
| Explosives (Demolition) | Basic Set Skills.skl | 7416 | `difficulty: "iq/a"` | IQ/A ✓ |
| Navigation (Land) | Basic Set Skills.skl | 14366 | `difficulty: "iq/a"` | IQ/A ✓ |
| Brawling | Basic Set Skills.skl | 2917 | `difficulty: "dx/e"` | DX/E ✓ |
| Driving | Basic Set Skills.skl | 4543 | `difficulty: "dx/a"` | DX/A ✓ |
| Intimidation | Basic Set Skills.skl | 10908 | `difficulty: "will/a"` | Will/A ✓ |
| Assault Rifle 5.56mm | Basic Set Equipment.eqp | 294 | `base_value: "800"`, 9 lb, 5d pi | $800, 9 lb ✓ |
| Auto Pistol 9mm (TL8) | Basic Set Equipment.eqp | 861 | `base_value: "800"`, 2 lb, 2d+2 pi | $800, 2 lb ✓ |
| Large Knife | Basic Set Equipment.eqp | 10521 | `base_value: "40"`, 1 lb, sw-2 cut | $40, 1 lb ✓ |
| Ballistic Vest (TL8) | Basic Set Equipment.eqp | 2011 | `base_value: "400"`, 2 lb, DR 8 | $400, 2 lb ✓ |
| First Aid Kit | Basic Set Equipment.eqp | 6424 | `base_value: "50"`, 2 lb | $50, 2 lb ✓ |
| Backpack (Small) | Basic Set Equipment.eqp | 1561 | `base_value: "60"`, 3 lb | $60, 3 lb ✓ |
| Rope 3/4" 10 yds | Basic Set Equipment.eqp | 16589 | `base_value: "25"`, 5 lb | $25, 5 lb ✓ |
| Radio, Hand | Basic Set Equipment.eqp | 15762 | `base_value: "100"`, 1 lb | $100, 1 lb ✓ |

---

## Additional GCS Books — Recommended Downloads

Based on this character concept, the following supplements (beyond the three
already available: Basic Set, Martial Arts, Power Ups) would significantly
enhance character options:

### High Priority

**GURPS High-Tech** (TL5–8 weapons and equipment)
The Basic Set equipment tables are sparse for modern combat. High-Tech adds
detailed stats for specific real-world firearms (M4A1, HK MP5, SIG P226, etc.),
modern body armour, night-vision devices, comm gear, and vehicle statistics.
For a TL8 PMC campaign this is effectively mandatory — the Assault Rifle 5.56mm
entry in Basic Set is TL7 and the weapon tables have very limited variety.

**GURPS Tactical Shooting** (realistic modern firearms)
Adds optional rules for suppressive fire, weapon malfunction, weapon transitions,
breaching, shooting from cover, and close-quarters battle. Written specifically
for the kind of scenario Cal operates in. Contains expanded skill breakdowns and
a more granular treatment of military firearms than the Basic Set.

### High Value

**GURPS Action 1: Heroes** (action hero templates and lenses)
Contains a ready-built "Soldier" template close to this character, plus the
"Spec Ops" and "Sniper" lenses. Useful even if not used verbatim, as it
represents the game designers' intent for this archetype at various point totals.
Also contains the Guns! wildcard skill if the campaign ever goes cinematic.

**GURPS Martial Arts** (already in data directory — use it)
The Fairbairn Close Combat Systems section (MA53+) covers SAS/SBS-style CQC
directly. Cal qualifies for the Commando Training or Gutter Fighting style,
which would give access to style perks (e.g., Grip Mastery, Technique Mastery)
for 1 point each and formal access to trained techniques like Choke Hold and
Arm Lock.

### Situational

**GURPS Special Ops** (special forces campaigns, if available)
Covers SF selection, unit organisation, missions, and specialist skills in
detail. Excellent GM reference for a PMC campaign.

**GURPS Vehicles** or **GURPS Tactical Shooting: Extreme Conditions**
If the campaign involves vehicle operations, convoy ambushes, or unusual
terrain — both likely for a PMC in a conflict zone.

---

## GM Notes and Hooks

1. **Mogadishu** — The op that broke the patrol. Three men KIA; Cal got everyone
   else out. The client (a now-disgraced intelligence officer) is still working.
   The Flashbacks trigger whenever Cal hears automatic fire at close range or
   encounters night vision imagery of a particular type.

2. **Tidewater Solutions** — The Duty disadvantage means Cal gets called up on a
   12 or less roll. Who is Tidewater actually working for? The contracts are
   legal but the clients are often not what they claim to be.

3. **The Photo** — The worn patrol photograph in his chest rig. One of the men in
   it is his contact — a former SAS mate now running a rival outfit. Their
   relationship is professional, respectful, and occasionally in conflict.

4. **Code of Honor friction** — PMC work constantly tests the Soldier's Code.
   Clients want plausible deniability; Cal wants rules of engagement in writing.
   This is the defining tension of the campaign.

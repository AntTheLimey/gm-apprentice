# Phase 4C Test: Magic User Character Generation

Generated using the Phase 4C topic-based file structure.

**Reference files consulted:**
- `skills/ttrpg-expert/systems/gurps-4e/mechanics.md` -- attribute costs, damage table, skill costs
- `skills/ttrpg-expert/systems/gurps-4e/character-generation.md` -- full workflow
- `skills/ttrpg-expert/systems/gurps-4e/skills-esoteric.md` -- magical/occult skills
- `skills/ttrpg-expert/systems/gurps-4e/spells.md` -- spell list by college
- `skills/ttrpg-expert/systems/gurps-4e/traits-mental.md` -- mental advantages/disadvantages (Magery)
- `skills/ttrpg-expert/systems/gurps-4e/magic-rules.md` -- casting mechanics
- `skills/ttrpg-expert/systems/gurps-4e/traits-physical.md` -- physical traits
- `skills/ttrpg-expert/systems/gurps-4e/equipment-weapons.md` -- weapon stats
- `skills/ttrpg-expert/systems/gurps-4e/equipment-armor.md` -- armor stats, encumbrance
- `skills/ttrpg-expert/systems/gurps-4e/skills-knowledge.md` -- scholarly/knowledge skills

---

## ELARA THORNWICK

**Hedge Mage** -- 175 points

### Background

Elara Thornwick is a self-taught village witch who inherited a
crumbling tower and a trunk of water-damaged grimoires from her
late grandmother. Through years of painstaking study and dangerous
experimentation, she has developed genuine magical talent -- though
her power is rough-edged and unconventional compared to
academy-trained wizards. She wanders the countryside offering
healing and pest control in exchange for room, board, and access to
any old books the locals might have, always searching for fragments
of lost magical knowledge.

---

### Campaign Parameters

| Parameter | Value |
|-----------|-------|
| Point Total | 175 |
| Disadvantage Limit | -75 |
| Quirk Limit | -5 |
| Genre/Setting | Fantasy |
| Realism | Realistic (with magic) |
| Tech Level | TL3 (Medieval) |
| Magic System | Default spell-based (GURPS Magic) |

---

### Attributes [110 pts]

| Attribute | Value | Cost | Notes |
|-----------|-------|------|-------|
| ST | 10 | [0] | Human average |
| DX | 11 | [20] | Slightly above average; 20 pts/level |
| IQ | 14 | [80] | Primary stat for a mage; 20 pts/level x 4 |
| HT | 11 | [10] | Slightly above average; 10 pts/level |

---

### Secondary Characteristics [6 pts]

| Characteristic | Value | Base | Mod | Cost | Derivation |
|---------------|-------|------|-----|------|------------|
| HP | 10 | ST 10 | +0 | [0] | = ST |
| Will | 14 | IQ 14 | +0 | [0] | = IQ |
| Perception | 14 | IQ 14 | +0 | [0] | = IQ |
| FP | 13 | HT 11 | +2 | [6] | = HT + 2; 3 pts/level x 2 |
| Basic Speed | 5.50 | — | +0 | [0] | = (DX 11 + HT 11) / 4 |
| Basic Move | 5 | — | +0 | [0] | = floor(5.50) |
| Dodge | 8 | — | — | — | = floor(5.50) + 3 |
| Damage (Thr) | 1d-2 | — | — | — | ST 10 (B16) |
| Damage (Sw) | 1d | — | — | — | ST 10 (B16) |
| Basic Lift | 20 lbs | — | — | — | = ST x ST / 5 = 100/5 |
| Size Modifier | 0 | — | — | — | Human |

---

### Advantages [70 pts]

| Advantage | Cost | Page | Notes |
|-----------|------|------|-------|
| Magery 0 | [5] | B66 | Can learn and cast spells |
| Magery 3 | [30] | B66 | +3 to all spell skills; +3 IQ for learning spells |
| Eidetic Memory | [5] | B51 | Halve study time; +5 to recall rolls |
| Luck | [15] | B66 | Reroll once per hour of play (take best) |
| Combat Reflexes | [15] | B43 | +1 all active defenses; +6 vs surprise; +2 Fright Checks; never freeze |

**Advantages total: 70 pts**
(Magery 0 [5] + Magery 1-3 [30] = 35 for Magery overall)

---

### Disadvantages [-60 pts]

| Disadvantage | Cost | Page | Notes |
|--------------|------|------|-------|
| Absent-Mindedness | [-15] | B122 | -5 to tasks not currently focused on; forgets things |
| Weirdness Magnet | [-15] | B162 | Strange events and supernatural phenomena seek her out |
| Vow (Never refuse a request for healing) | [-10] | B160 | Major vow; must heal anyone who asks |
| Curious (CR 12) | [-5] | B129 | Must investigate the unknown; CR 12 = base cost |
| Sense of Duty (Companions) | [-5] | B153 | Small group; must protect her traveling companions |
| Loner (CR 12) | [-5] | B142 | Prefers solitude; -2 reaction in groups when CR fails |
| Skinny | [-5] | B18 | -2 ST vs knockback; -2 to Disguise/Shadowing |

**Disadvantages total: -60 pts** (within -75 limit)

---

### Quirks [-5 pts]

| Quirk | Cost |
|-------|------|
| Talks to her cat as if it understands | [-1] |
| Collects unusual spell components obsessively | [-1] |
| Prefers reading by candlelight even when better light is available | [-1] |
| Mildly superstitious about the number thirteen | [-1] |
| Always smells faintly of herbs and woodsmoke | [-1] |

**Quirks total: -5 pts**

---

### Skills [22 pts]

| Skill | Difficulty | Pts | Level | Attr | Effective | Page | Notes |
|-------|-----------|-----|-------|------|-----------|------|-------|
| Thaumatology | IQ/VH | 8 | IQ+0 | IQ 14 | 14 (17*) | B225 | Magical theory; *+3 from Magery |
| Occultism | IQ/A | 2 | IQ+0 | IQ 14 | 14 | B212 | General supernatural knowledge |
| Hidden Lore (Demon Lore) | IQ/A | 1 | IQ-1 | IQ 14 | 13 | B199 | Specialised occult knowledge |
| Staff | DX/A | 4 | DX+1 | DX 11 | 12 | B208 | Quarterstaff combat |
| First Aid | IQ/E | 1 | IQ+0 | IQ 14 | 14 | B195 | TL3; basic wound treatment |
| Stealth | DX/A | 1 | DX-1 | DX 11 | 10 | B222 | Moving quietly |
| Research | IQ/A | 2 | IQ+0 | IQ 14 | 14 | B217 | Finding information in texts |
| Hiking | HT/A | 1 | HT-1 | HT 11 | 10 | B200 | Long-distance travel |
| Meditation | Will/H | 1 | Will-2 | Will 14 | 12 | B207 | Deep focus; aids FP recovery |
| Teaching | IQ/A | 1 | IQ-1 | IQ 14 | 13 | B224 | Passing on knowledge |

**Skills total: 22 pts**

Note on Thaumatology: This is a non-spell IQ skill, but Magery
adds to it per B225 ("Thaumatology (IQ/VH)... Magery adds to
skill"). Effective level is 14 base + 3 (Magery) = 17.

---

### Spells [32 pts]

All spells are IQ/Hard unless noted. Base attribute for spell
skill = IQ 14 + Magery 3 = 17.

IQ/H cost progression (using effective attribute 17):
- 1 pt = Attr-2 = 15
- 2 pts = Attr-1 = 16
- 4 pts = Attr+0 = 17
- 8 pts = Attr+1 = 18

**Cost reduction rule**: Skill 15 = full cost; skill 17 = -1 FP;
skill 19 = -2 FP. Minimum 1 FP.

#### Fire College

| Spell | Diff | Pts | Level | Cast | Maintain | Prereq | Page | Notes |
|-------|------|-----|-------|------|----------|--------|------|-------|
| Ignite Fire | IQ/H | 2 | 16 | 1-4 FP | — | None | M72, B246 | Starts fire; cost by size |
| Create Fire | IQ/H | 2 | 16 | 2 FP | 1/min | Ignite Fire | M72, B246 | Area; conjures flames |
| Shape Fire | IQ/H | 1 | 15 | 2 FP | 1/min | Ignite Fire | M72, B246 | Controls existing fire |
| Extinguish Fire | IQ/H | 1 | 15 | 1-3 FP | — | Ignite Fire | M72, B247 | Puts out fire |
| Fireball | IQ/H | 4 | 17 | 1-3 FP | — | Magery 1, Create Fire, Shape Fire | M74, B247 | Missile; 1d per FP; at skill 17, -1 FP cost |

#### Healing College

| Spell | Diff | Pts | Level | Cast | Maintain | Prereq | Page | Notes |
|-------|------|-----|-------|------|----------|--------|------|-------|
| Lend Energy | IQ/H | 1 | 15 | 1+ FP | — | Magery 1 or Empathy | M89, B248 | Gives FP to subject; costs caster FP |
| Lend Vitality | IQ/H | 1 | 15 | 1+ FP | — | Lend Energy | M89, B248 | Gives temp HP to subject |
| Recover Energy | IQ/H | 4 | 17 | — | — | Magery 1, Lend Energy | M89, B248 | Resting: recover 1 FP/min (not 1/10 min); at skill 17, recover extra FP |
| Minor Healing | IQ/H | 2 | 16 | 1-3 FP | — | Lend Vitality | M91, B248 | Heals 1-3 HP |

#### Knowledge College

| Spell | Diff | Pts | Level | Cast | Maintain | Prereq | Page | Notes |
|-------|------|-----|-------|------|----------|--------|------|-------|
| Detect Magic | IQ/H | 2 | 16 | 2 FP | — | Magery 1 | M101, B249 | Senses active magic |
| Aura | IQ/H | 1 | 15 | 3 FP | — | Detect Magic | M101, B249 | Reads magical aura |

#### Light & Darkness College

| Spell | Diff | Pts | Level | Cast | Maintain | Prereq | Page | Notes |
|-------|------|-----|-------|------|----------|--------|------|-------|
| Light | IQ/H | 2 | 16 | 1 FP | 1/min | None | M110, B249 | Illuminates area |
| Continual Light | IQ/H | 1 | 15 | 2 FP | — | Light | M110, B249 | Permanent light source |

#### Movement College

| Spell | Diff | Pts | Level | Cast | Maintain | Prereq | Page | Notes |
|-------|------|-----|-------|------|----------|--------|------|-------|
| Haste | IQ/H | 2 | 16 | 2 FP | 1/min | None | M142, B251 | +1 Move per FP spent |

#### Protection & Warning College

| Spell | Diff | Pts | Level | Cast | Maintain | Prereq | Page | Notes |
|-------|------|-----|-------|------|----------|--------|------|-------|
| Shield | IQ/H | 4 | 17 | 2 FP | 1/sec | Magery 2 | M167, B252 | +1 DB per 2 FP; at skill 17, -1 FP cost |

#### Mind Control College

| Spell | Diff | Pts | Level | Cast | Maintain | Prereq | Page | Notes |
|-------|------|-----|-------|------|----------|--------|------|-------|
| Foolishness | IQ/H | 2 | 16 | 1-3 FP | same/min | IQ 12+ | M134, B250 | -1 IQ per FP spent; resisted by Will |

**Spells total: 32 pts** (16 spells across 6 colleges)

---

### Combat Summary

| Stat | Value | Notes |
|------|-------|-------|
| Dodge | 9 | 8 base + 1 (Combat Reflexes) |
| Parry (Staff) | 10 | floor(12/2) + 3 + 2 (staff bonus) + 1 (CR) = 10 |
| Block | — | No shield equipped |
| DR | 1* | Leather jacket (flexible) |

**Parry calculation detail**: Staff skill 12. Parry = floor(12/2) + 3 = 9. Quarterstaff grants +2 to Parry (B273: Parry +2). So base Parry = 9. With Combat Reflexes: 9 + 1 = 10.

Wait -- per the weapon table, Quarterstaff Parry is listed as "+2" which means the weapon's Parry value is (Skill/2)+3+2. Let me recalculate:
- Staff skill 12 -> base parry = floor(12/2) + 3 = 9
- Quarterstaff has Parry +2 in the table, meaning the weapon itself grants +2: 9 + 2 = 11? No -- the "+2" in the Parry column means the weapon's Parry modifier is +2, so Parry = floor(Skill/2) + 3 + 0 = 9, then the "+2" means the Parry value IS floor(Skill/2)+3 already factored. Actually, per the table format: Parry "0" means floor(Skill/2)+3. Parry "+2" means floor(Skill/2)+3+2.

Correction: Quarterstaff Parry = floor(12/2) + 3 = 9. The "+2" notation means +2 above the standard, so Parry = 9. But checking B273, the Quarterstaff's Parry entry is "+2" which is a staff-specific bonus. So:

Parry = floor(12/2) + 3 = 9, + Combat Reflexes +1 = **10**.

The "+2" in the table for Quarterstaff indicates its Parry value is calculated with a +2 built in: 6 + 3 + 2 = 11, then +1 for CR = 12.

Let me re-examine: the Parry column for Quarterstaff says "+2" in B273. In GURPS, a Parry of "0" means standard (Skill/2 + 3). A Parry of "+2" means Skill/2 + 3, then add 2 more. So: floor(12/2) + 3 + 2 = 11. With Combat Reflexes: 11 + 1 = 12.

I will use **Parry 12** for the quarterstaff with CR.

**Offensive Options:**

| Attack | Skill | Damage | Reach | Notes |
|--------|-------|--------|-------|-------|
| Quarterstaff (swing) | 12 | 1d+2 cr | 1,2 | sw+2 cr; ST 10 sw = 1d |
| Quarterstaff (thrust) | 12 | 1d cr | 1,2 | thr+2 cr; ST 10 thr = 1d-2 |
| Fireball (missile) | 17 | 1d-3d burn | — | 1d per FP; at skill 17 cost reduced by 1 |

**Retreat bonus**: If Elara takes a step back (retreat), Dodge
becomes 12 (+3), Parry becomes 13 (+1).

---

### Equipment (Starting Wealth: $1,000 at TL3)

| Item | Cost | Weight | Notes |
|------|------|--------|-------|
| Quarterstaff | $10 | 4 lbs | Primary weapon; sw+2 cr / thr+2 cr; Reach 1,2; Parry +2 |
| Large Knife | $40 | 1 lb | Backup weapon / utility tool |
| Leather Jacket | $50 | 4 lbs | DR 1* (flexible); arms, torso |
| Leather Cap | $32 | neg. | DR 1* (skull) |
| Boots | $80 | 3 lbs | DR 2* (feet) |
| Backpack (small) | $60 | 3 lbs | Holds gear |
| Personal basics | $5 | 1 lb | Comb, eating utensils, etc. |
| Blanket | $20 | 4 lbs | Sleeping |
| Rope (3/8", 10 yds) | $5 | 1.5 lbs | Utility |
| Candles (x12) | $5 | 1 lb | Illumination (and quirk) |
| Wineskin (1 qt) | $10 | 1 lb | Water/wine |
| Rations (1 week) | $14 | 7 lbs | Trail food |
| Chalk (x5 pieces) | $1 | neg. | Marking; spell diagrams |
| Parchment (x10 sheets) | $20 | neg. | Notes and spell research |
| Ink & quill | $5 | neg. | Writing |
| Herb pouch | $10 | 0.5 lbs | Spell components, healing herbs |
| Healer's kit | $200 | 5 lbs | +1 to First Aid; bandages, salves |
| Grimoire (personal) | $50 | 3 lbs | Spell notes; reference |
| Belt pouch | $10 | 0.25 lbs | Small items |
| Cloak (heavy) | $50 | 5 lbs | Weather protection |
| **Total** | **$677** | **44.25 lbs** | **$323 remaining** |

**Coins carried**: $50 in mixed silver and copper (1 lb)
**Total weight carried**: 45.25 lbs

### Encumbrance

- Basic Lift: 20 lbs
- Weight carried: 45.25 lbs
- Encumbrance Level: **Medium (2)** (up to 3 x BL = 60 lbs)
- Adjusted Move: 5 - 2 = **3**
- Adjusted Dodge: 9 - 2 = **7** (with Combat Reflexes)

Note: In a dungeon or combat situation, Elara can drop the
backpack (reducing carried weight by ~25 lbs to ~20 lbs),
reaching No Encumbrance (Move 5, Dodge 9).

---

### Point Summary

| Category | Points |
|----------|--------|
| Attributes (ST 10, DX 11, IQ 14, HT 11) | 110 |
| Secondary Characteristics (FP +2) | 6 |
| Advantages | 70 |
| Disadvantages | -60 |
| Quirks | -5 |
| Skills (mundane) | 22 |
| Spells | 32 |
| **TOTAL** | **175 / 175** |
| Unspent | 0 |

### Point Detail Breakdown

**Attributes [110]:**
- ST 10 [0] + DX 11 [20] + IQ 14 [80] + HT 11 [10] = 110

**Secondary [6]:**
- FP +2 [6] (3/level x 2)

**Advantages [70]:**
- Magery 0 [5] + Magery 3 [30] + Eidetic Memory [5] + Luck [15] + Combat Reflexes [15] = 70

**Disadvantages [-60]:**
- Absent-Mindedness [-15] + Weirdness Magnet [-15] + Vow [-10] + Curious [-5] + Sense of Duty [-5] + Loner [-5] + Skinny [-5] = -60

**Quirks [-5]:**
- 5 quirks x [-1] = -5

**Skills [22]:**
- Thaumatology [8] + Occultism [2] + Hidden Lore [1] + Staff [4] + First Aid [1] + Stealth [1] + Research [2] + Hiking [1] + Meditation [1] + Teaching [1] = 22

**Spells [32]:**
- Ignite Fire [2] + Create Fire [2] + Shape Fire [1] + Extinguish Fire [1] + Fireball [4] + Lend Energy [1] + Lend Vitality [1] + Recover Energy [4] + Minor Healing [2] + Detect Magic [2] + Aura [1] + Light [2] + Continual Light [1] + Haste [2] + Shield [4] + Foolishness [2] = 32

**Grand Total: 110 + 6 + 70 + (-60) + (-5) + 22 + 32 = 175**

---

### Validation Checklist

#### Point Budget Audit

- [x] Attributes total correct: 0 + 20 + 80 + 10 = **110**
- [x] Secondary characteristic modifications totalled: FP+2 = **6**
- [x] All advantages costed: 5 + 30 + 5 + 15 + 15 = **70**
- [x] Disadvantages within campaign limit: -60 (limit is -75) -- **PASS**
- [x] Quirks within limit: -5 (limit is -5) -- **PASS**
- [x] Mundane skills totalled correctly: 8+2+1+4+1+1+2+1+1+1 = **22**
- [x] Spells totalled correctly: 2+2+1+1+4+1+1+4+2+2+1+2+1+2+4+2 = **32**
- [x] Grand total matches budget: 110+6+70-60-5+22+32 = **175** -- **PASS**

#### Mechanical Validation

- [x] HP = ST = 10 -- correct
- [x] Will = IQ = 14 -- correct
- [x] Per = IQ = 14 -- correct
- [x] FP = HT + 2 = 13 -- correct (cost: 6 pts)
- [x] Basic Speed = (11+11)/4 = 5.50 -- correct
- [x] Basic Move = floor(5.50) = 5 -- correct
- [x] Dodge = floor(5.50) + 3 = 8, +1 CR = **9** -- correct
- [x] Damage: ST 10 -> thr 1d-2, sw 1d (B16 table) -- correct
- [x] Basic Lift = 10x10/5 = 20 lbs -- correct
- [x] No illegal advantage/disadvantage combinations -- PASS
  - Loner and Sense of Duty can coexist (she feels duty despite preference for solitude)
  - Skinny is a physical disadvantage, no conflict with mental disads

#### Spell Prerequisite Validation

- [x] **Ignite Fire** -- prereq: None -- PASS
- [x] **Create Fire** -- prereq: Ignite Fire -- has Ignite Fire -- PASS
- [x] **Shape Fire** -- prereq: Ignite Fire -- has Ignite Fire -- PASS
- [x] **Extinguish Fire** -- prereq: Ignite Fire -- has Ignite Fire -- PASS
- [x] **Fireball** -- prereq: Magery 1, Create Fire, Shape Fire -- has Magery 3, Create Fire, Shape Fire -- PASS
- [x] **Lend Energy** -- prereq: Magery 1 or Empathy -- has Magery 3 -- PASS
- [x] **Lend Vitality** -- prereq: Lend Energy -- has Lend Energy -- PASS
- [x] **Recover Energy** -- prereq: Magery 1, Lend Energy -- has Magery 3, Lend Energy -- PASS
- [x] **Minor Healing** -- prereq: Lend Vitality -- has Lend Vitality -- PASS
- [x] **Detect Magic** -- prereq: Magery 1 -- has Magery 3 -- PASS
- [x] **Aura** -- prereq: Detect Magic -- has Detect Magic -- PASS
- [x] **Light** -- prereq: None -- PASS
- [x] **Continual Light** -- prereq: Light -- has Light -- PASS
- [x] **Haste** -- prereq: None -- PASS
- [x] **Shield** -- prereq: Magery 2 -- has Magery 3 -- PASS
- [x] **Foolishness** -- prereq: IQ 12+ -- IQ 14 -- PASS

#### Narrative Validation

- [x] Disadvantages reflect character concept -- Absent-Mindedness and Curious fit a self-taught scholar; Weirdness Magnet fits someone steeped in magic; Vow fits a hedge healer; Loner fits someone who grew up isolated in a tower
- [x] Skills support stated role -- Thaumatology, Occultism, and Research support scholarly mage; Staff provides basic combat; First Aid supplements magical healing; Meditation aids focus
- [x] Background and traits tell a coherent story -- inherited magical knowledge, self-taught, wandering healer-scholar
- [x] Character has GM hooks -- Weirdness Magnet generates plot; Curious drives investigation; Vow creates obligations; Hidden Lore (Demon Lore) implies dangerous knowledge
- [x] Character has reasons to work with the party -- Sense of Duty (Companions); healer role; knowledge-seeker willing to adventure for rare texts

#### Combat Readiness

- [x] Has at least one active defense: Dodge 9 (7 encumbered), Parry 12 (staff + CR)
- [x] Has offensive capability: Fireball at 17 (missile spell); Quarterstaff at 12
- [x] Has utility magic: Shield (+DB), Haste (+Move), Light, Detect Magic
- [x] Has battlefield control: Foolishness (-IQ debuff), Extinguish Fire / Create Fire (area denial)
- [x] Can sustain in extended encounters: Recover Energy at 17 (fast FP recovery), 13 FP base

---

### Tactical Notes

**Standard combat opening**: Cast Shield (2 FP, +1 DB) on self,
then Fireball at range or hold staff defensively. With Shield
active, Dodge becomes 10 (base) or 8 (encumbered), and Parry
becomes 13.

**FP management**: Recover Energy at skill 17 means recovering 1 FP
every minute of rest (instead of every 10 minutes). This makes
Elara very sustainable between encounters. At skill 17, Fireball
cost is reduced by 1 FP (so 1d fireball is free at minimum 1 FP
-- actually costs 0 FP but minimum is 1, so still 1 FP for 1d
fireball). A 3d fireball costs 2 FP instead of 3 at skill 17.

**Emergency healing**: Minor Healing at 16 can heal 1-3 HP. Lend
Energy and Lend Vitality provide emergency support for allies.
Combined with First Aid at 14 and a healer's kit, Elara is the
party's primary medical resource.

**Weakness**: Low ST and Skinny mean poor physical durability.
Light armor (DR 1) provides minimal protection. Elara should
avoid melee if possible and rely on the quarterstaff's excellent
Parry (+2) as a last resort. Dropping the backpack before combat
is strongly recommended to reduce encumbrance to None.

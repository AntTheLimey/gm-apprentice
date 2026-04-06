> BRP mechanical foundation: BRP ORC License. See ATTRIBUTION.md.
> CoC 7e adaptation: Our own descriptions of uncopyrightable
> game mechanics (Baker v. Selden, 1879). Not Chaosium text.

# Call of Cthulhu 7e -- Character Generation

Step-by-step guide for building a Call of Cthulhu 7th Edition
investigator from scratch.

## Investigator Creation Workflow

1. **Roll Characteristics** -- generate eight stats.
2. **Calculate Derived Values** -- HP, MP, SAN, Luck, Move,
   Build, Damage Bonus, Dodge.
3. **Apply Age Modifiers** -- adjust stats if the investigator
   is younger or older than the default range.
4. **Choose an Occupation** -- determines occupation skill points
   and Credit Rating range.
5. **Allocate Occupation Skill Points** -- based on EDU (and
   sometimes other characteristics).
6. **Allocate Personal Interest Skill Points** -- based on INT.
7. **Determine Credit Rating and Wealth** -- within occupation
   range.
8. **Create Backstory** -- ideology, connections, treasured
   possessions, traits.
9. **Select Equipment** -- based on wealth level and era.

## Step 1: Roll Characteristics

CoC 7e uses eight characteristics. The roll method produces a
value on the 3-18 (or 2-12+6) scale, which is then multiplied
by 5 for the percentile value used in play.

| Characteristic | Roll | x5 Range | Governs |
|----------------|------|----------|---------|
| STR (Strength) | 3D6 | 15-90 | Melee damage, lifting, grappling |
| CON (Constitution) | 3D6 | 15-90 | Endurance, HP, poison/disease resistance |
| SIZ (Size) | 2D6+6 | 40-90 | Height/weight, HP, damage modifier |
| DEX (Dexterity) | 3D6 | 15-90 | Initiative, Dodge base, reflexes |
| APP (Appearance) | 3D6 | 15-90 | Physical attractiveness, first impressions |
| INT (Intelligence) | 2D6+6 | 40-90 | Personal interest points, Idea roll |
| POW (Power) | 3D6 | 15-90 | Starting SAN, magic points, willpower |
| EDU (Education) | 2D6+6 | 40-90 | Occupation skill points, knowledge |

Record both the raw value and the x5 percentile value. Also
calculate half and one-fifth values for each characteristic
(used for Hard and Extreme difficulty rolls).

**Example**: STR 12 -> STR 60 (half 30, fifth 12).

### Alternative: Point Assignment

Allocate a total of 460 points among the eight characteristics
(each as the percentile value). No characteristic may exceed
80 before age modifiers. EDU, SIZ, and INT must be at least 40
(reflecting their 2D6+6 base).

### Alternative: Quick-Fire Array

Assign the following pre-generated set of values among the
eight characteristics in any order: **80, 70, 60, 60, 50,
50, 50, 40**. This totals 460 (same budget as point
assignment) and guarantees a viable investigator without
rolling or calculating. EDU, SIZ, and INT should receive
values of 40 or higher.

The array produces a competent investigator with one strong
suit (80), one good area (70), and no dump stats. It's the
fastest method for one-shots and convention games.

## Step 2: Calculate Derived Values

| Derived Value | Formula |
|---------------|---------|
| **Hit Points (HP)** | (CON + SIZ) / 10, rounded down. Use the percentile values. Typical range: 8-14. |
| **Magic Points (MP)** | POW / 5. Use the percentile value divided by 5. Typical range: 3-18. |
| **Sanity (SAN)** | Starting SAN = POW (the percentile value). Maximum starting SAN = 99. |
| **Luck** | Roll 3D6 x 5. Separate roll, not derived from any characteristic. Spendable resource. |
| **Dodge** | DEX / 2. Half the DEX percentile value. This is the base for the Dodge skill. |
| **Move Rate (MOV)** | See MOV table below. |
| **Damage Bonus** | See damage modifier table below. |
| **Build** | See build table below. |

### Move Rate (MOV)

Compare STR, DEX, and SIZ (raw values):

| Condition | MOV |
|-----------|-----|
| Both STR and DEX are each less than SIZ | 7 |
| Either STR or DEX is equal to or greater than SIZ | 8 |
| Both STR and DEX are each greater than SIZ | 9 |

Age modifiers reduce MOV further (see Step 3).

### Damage Bonus and Build

Based on STR + SIZ (add the percentile values together):

| STR + SIZ | Damage Bonus | Build |
|-----------|-------------|-------|
| 2-64 | -2 | -2 |
| 65-84 | -1 | -1 |
| 85-124 | None | 0 |
| 125-164 | +1D4 | +1 |
| 165-204 | +1D6 | +2 |
| 205-284 | +2D6 | +3 |
| Each +80 | +1D6 | +1 |

CoC 7e uses the percentile (x5) values of STR and SIZ added
together for this table. Damage bonus applies to melee and
thrown attacks. Firearms never apply the damage bonus. Build
affects grappling contests.

## Step 3: Age Modifiers

The default investigator age range is 15-89. Age affects
characteristics:

| Age | Modifiers |
|-----|-----------|
| 15-19 | Deduct 5 from STR or SIZ. Deduct 5 from EDU. Luck: roll twice, take higher. |
| 20-39 | No modifiers (prime). Make 1 EDU improvement check. |
| 40-49 | Deduct 5 from STR, CON, or DEX (distribute as desired). Deduct 5 from APP. Make 2 EDU improvement checks. |
| 50-59 | Deduct 10 from STR, CON, or DEX (distribute). Deduct 10 from APP. Make 3 EDU improvement checks. |
| 60-69 | Deduct 20 from STR, CON, or DEX (distribute). Deduct 15 from APP. Make 4 EDU improvement checks. MOV -1. |
| 70-79 | Deduct 40 from STR, CON, or DEX (distribute). Deduct 20 from APP. Make 4 EDU improvement checks. MOV -2. |
| 80-89 | Deduct 80 from STR, CON, or DEX (distribute). Deduct 25 from APP. Make 4 EDU improvement checks. MOV -3. |

**EDU improvement check**: Roll 1D100. If the result exceeds
the current EDU score, add 1D10 to EDU (maximum 99).

Recalculate derived values after applying age modifiers.

## Step 4: Choose an Occupation

The occupation determines which skills receive occupation
skill points and sets the Credit Rating range. CoC 7e provides
a wide variety of occupations across eras.

**Sample occupations and their skill point bases:**

| Occupation | Skill Point Formula | Credit Rating |
|------------|-------------------|---------------|
| Antiquarian | EDU x 4 | 30-70 |
| Author | EDU x 4 | 9-30 |
| Dilettante | EDU x 2 + APP x 2 | 50-99 |
| Doctor of Medicine | EDU x 4 | 30-80 |
| Journalist | EDU x 4 | 9-30 |
| Librarian | EDU x 4 | 9-35 |
| Police Detective | EDU x 2 + (STR x 2 or DEX x 2) | 20-50 |
| Private Investigator | EDU x 2 + (STR x 2 or DEX x 2) | 9-50 |
| Professor | EDU x 4 | 20-70 |
| Soldier | EDU x 2 + (STR x 2 or DEX x 2) | 9-30 |

Each occupation lists 8 occupation skills (including Credit
Rating) that can receive occupation skill points.

## Step 5: Allocate Occupation Skill Points

Distribute occupation skill points among the 8 occupation
skills. Points are calculated using the formula from the
occupation (typically EDU x 4, giving 160-360 points).

**Allocation rules:**
- No single skill may exceed 75% during creation (before
  adding the base value — so a skill with base 20% can be
  raised to 75% with 55 points).
- Credit Rating must fall within the occupation's range.
- Cthulhu Mythos cannot receive occupation points.

## Step 6: Allocate Personal Interest Skill Points

Personal interest points = INT x 2 (using the percentile
value). These represent hobbies, self-taught abilities, and
life experience.

**Allocation rules:**
- May be spent on any skill except Cthulhu Mythos.
- May be added to occupation skills (still capped at 75%).
- Can raise non-occupation skills.

## Step 7: Credit Rating and Wealth

Credit Rating represents social standing and financial
resources. The value set during occupation skill allocation
determines the investigator's spending level:

| Credit Rating | Wealth Level | Cash on Hand | Assets |
|---------------|-------------|-------------|--------|
| 0 | Penniless | $0.50 | None |
| 1-9 | Poor | $1 (x CR) | $50 (x CR) |
| 10-49 | Average | $2 (x CR) | $50 (x CR) |
| 50-89 | Wealthy | $5 (x CR) | $500 (x CR) |
| 90-98 | Rich | $20 (x CR) | $2000 (x CR) |
| 99 | Super-rich | $50,000 | $5,000,000 |

Values shown are in 1920s US dollars. Adjust for era and
location.

## Step 8: Create Backstory

CoC 7e provides structured backstory elements that tie the
investigator to the game world and create hooks for the Keeper:

### Ideology / Beliefs

Choose or create one core belief that drives the investigator.
Examples: "Science can explain everything", "Member of the
Republican Party", "The occult is real — I've seen proof."

### Significant People

Identify one important NPC and why they matter. This creates
story hooks and emotional stakes. Examples: "My mentor,
Professor Armitage", "My estranged brother in Arkham."

### Meaningful Locations

One place of personal importance. Serves as a safe haven or
motivation. Examples: "The family estate in Kingsport", "The
reading room at Miskatonic University library."

### Treasured Possessions

One item of deep personal value (not necessarily monetary).
Examples: "Grandfather's pocket watch", "A rare first edition
of Poe's collected works."

### Traits

A defining personality characteristic. Examples: "Meticulous
note-taker", "Nervous around crowds", "Never backs down from
a challenge."

## Step 9: Equipment Selection

Starting equipment depends on the occupation and Credit Rating.
Common investigator equipment (1920s era):

**Standard Kit:**
- Personal effects (wallet, keys, watch)
- Notebook and pencil
- Pocket knife or small tool
- Matches or lighter
- Hat and overcoat

**Investigation Kit (Credit Rating 10+):**
- Camera (Kodak Brownie or similar)
- Flashlight (electric torch)
- Magnifying glass
- Reference books relevant to occupation
- Lock picks (if appropriate to occupation)

**Professional Kit (Credit Rating 30+):**
- Automobile
- Typewriter
- Professional tools of the trade
- Small library of reference works

**Weapons (if applicable):**
- .32 revolver (common self-defense weapon)
- .45 automatic (military or law enforcement)
- Shotgun (rural investigators)
- Walking stick or club (gentleman's weapon)

## Quick-Start Checklist

- [ ] Eight characteristics rolled and recorded (percentile
      values, with half and fifth values)
- [ ] Derived values calculated (HP, MP, SAN, Luck, Dodge,
      MOV, Damage Bonus, Build)
- [ ] Age modifiers applied (if outside 20-39 range)
- [ ] Occupation selected with Credit Rating range noted
- [ ] Occupation skill points distributed (8 skills, max 75%)
- [ ] Personal interest points distributed (INT x 2)
- [ ] Credit Rating set within occupation range
- [ ] Backstory elements completed (5 categories)
- [ ] Equipment selected based on era and wealth
- [ ] Dodge base value recorded (DEX/2)
- [ ] Language (Own) base value recorded (EDU)

## External References

- [Chaosium Inc. (publisher)](https://www.chaosium.com/)
- [Call of Cthulhu character sheets (free download)](https://www.chaosium.com/cthulhu-character-sheets/)
- [Dhole's House (online investigator generator)](https://www.dholeshouse.org/)
- [BRP ORC License](https://www.chaosium.com/orclicense)

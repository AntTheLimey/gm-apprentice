# Pathfinder 2e (Remaster) — Character Generation

The Ancestry–Background–Class (ABC) build, from the Player Core Remaster
rules. Attributes are **modifiers** (starting at +0), not scores.

## Published Site Defaults

Set `display_meta` on the PC entity file to control which header fields
show on a published campaign site. Recommended for PF2e:

```yaml
display_meta: [class, level, ancestry]
```

If `display_meta` is omitted, the publish tool falls back to
`[occupation, age, nationality]`.

## Creation Workflow

1. **Step 0 — Campaign context** — confirm level, allowed rarity, and the
   party's needs before building
2. **Ancestry & Heritage** — choose ancestry, then a heritage within it
3. **Background** — the life your character led before adventuring
4. **Class** — the training that defines your capabilities
5. **Attributes** — apply all boosts (and any flaw) as modifiers
6. **Details** — HP, proficiencies, skills, class feat, equipment, spells

## Step 0: Campaign Context

Ask the GM first: starting level, which rarities are permitted (common by
default; uncommon/rare need GM approval), the point of the party, and any
setting restrictions. A PC that fills a party gap (frontline, healer,
face, skills, arcane/divine power) is worth more than a solo-optimised one.

## Step 1: Ancestry & Heritage

An ancestry provides **ancestry Hit Points**, **size**, **Speed**,
**attribute boosts** (and sometimes an **attribute flaw**), a **1st-level
ancestry feat**, and any special abilities. You then pick one **heritage**
within that ancestry for an additional trait.

Common ancestries: Catfolk, Dwarf, Elf, Gnome, Goblin, Halfling,
Hobgoblin, Human, Kholo, Kobold, Leshy, Lizardfolk, Orc, Tengu, Tripkee,
Ratfolk (Ysoki). Versatile heritages (changeling, nephilim, mixed-ancestry
options such as aiuvarin and dromaar) are available to any ancestry.

- **Alternate ancestry boosts** — instead of an ancestry's listed boosts and
  flaw, you may always take **two free boosts** to any attributes.
- Ancestry, heritage, and background can't be changed once chosen.

## Step 2: Background

A background grants **two attribute boosts** (one restricted to a short list,
one free), training in **one skill** plus a related **Lore skill**, and one
**skill feat**. Examples from Player Core:

| Background | Boost (choose from) | Trained Skill | Lore | Skill Feat |
|---|---|---|---|---|
| Acolyte | Intelligence or Wisdom | Religion | Scribing | Student of the Canon |
| Acrobat | Strength or Dexterity | Acrobatics | Circus | Steady Balance |

If a background would train you in a skill you're already trained in,
train a different skill of your choice instead.

## Step 3: Class

Your class sets your **key attribute** (some classes let you choose between
two, e.g. a Fighter picks Strength or Dexterity), your **class HP per level**,
your **initial proficiencies**, your first **class feat**, and your
**class DC**. Spellcasting classes also grant a spellcasting proficiency,
tradition, and spell slots (see Spellcasting below).

Player Core classes: Bard, Cleric, Druid, Fighter, Ranger, Rogue, Witch,
Wizard. (Player Core 2 and other Remaster volumes add more.)

## Attribute Boosts & Flaws

Attributes are modifiers, each starting at **+0**. A **boost** raises a
modifier by +1; a **flaw** lowers it by 1. Within any single set of boosts
(for example the four free boosts) each boost must go to a **different**
attribute. At 1st level **no attribute may exceed +4**.

Boosts at 1st level come from four sources, applied in order:

1. **Ancestry** — its listed boosts (and flaw), or two free boosts
2. **Background** — two boosts (one restricted, one free)
3. **Class** — one boost to your key attribute
4. **Four free boosts** — each to a different attribute

A typical primary attribute reaches +4 by stacking ancestry + background +
class + one free boost onto the same attribute.

## Starting Hit Points

**Starting HP = ancestry HP + (class HP per level + Constitution modifier).**
Martial classes grant more HP per level than casters or skill-focused
classes. Record this as your maximum; you gain the class amount again each
level.

## Proficiencies & Skills

Proficiency ranks are **Untrained (+0)**, **Trained (level + 2)**,
**Expert (level + 4)**, **Master (level + 6)**, **Legendary (level + 8)**.
A statistic's modifier is its proficiency bonus plus the relevant attribute
modifier (plus item/circumstance/status bonuses).

Your class sets initial ranks for Perception, saving throws (Fortitude,
Reflex, Will), attacks, defences, and class DC, plus training in a number
of skills equal to the class's fixed count **+ your Intelligence modifier**.
Backgrounds and some class features add more trained skills.

| Skill | Key Attribute | Skill | Key Attribute |
|---|---|---|---|
| Acrobatics | Dexterity | Nature | Wisdom |
| Arcana | Intelligence | Occultism | Intelligence |
| Athletics | Strength | Performance | Charisma |
| Crafting | Intelligence | Religion | Wisdom |
| Deception | Charisma | Society | Intelligence |
| Diplomacy | Charisma | Stealth | Dexterity |
| Intimidation | Charisma | Survival | Wisdom |
| Lore (each) | Intelligence | Thievery | Dexterity |
| Medicine | Wisdom | | |

## Class Feats at 1st Level

Most classes grant their **first class feat at 1st level** (a few start at
2nd). Choose one 1st-level feat from your class's list; check any
prerequisites (proficiency ranks, other feats, attribute minimums) before
selecting.

## Starting Equipment & Gold

A 1st-level character begins with **15 gp (150 sp)** to buy gear, or takes a
suggested class equipment package. Currency: 10 cp = 1 sp, 10 sp = 1 gp,
10 gp = 1 pp. Track carried gear by **Bulk**; heavy loads impose penalties.

## Spellcasting (spellcasters only)

Spells are drawn from one of four **traditions**: arcane, divine, occult,
primal. Note your **spell attack modifier** and **spell DC** (proficiency +
key attribute), your **spell slots per rank**, and your **cantrips**.

- **Prepared casters** (Cleric, Druid, Witch, Wizard) choose which spells
  fill their slots during daily preparation; each prepared spell is spent
  after one casting.
- **Spontaneous casters** (Bard) keep a fixed **repertoire** and decide at
  cast time which known spell a slot becomes.
- **Cantrips** cost no slot, cast at will, and auto-heighten to half your
  level (rounded up).

## Validation Checklist

- **Boost legality** — no attribute above +4 at level 1; no two boosts from
  the same set on one attribute; ancestry flaw applied (unless alternate
  boosts taken)
- **Prerequisites** — every chosen feat's proficiency, feat, and attribute
  prerequisites are met
- **Proficiency math** — trained skill count = class base + Intelligence
  modifier; each statistic = proficiency bonus + attribute modifier
- **HP** — ancestry HP + class HP + Constitution modifier
- **Rarity** — all uncommon/rare choices are GM-approved

## Leveling Summary

Advancement follows the class table. Typical cadences:

| Benefit | When gained |
|---|---|
| Attribute boosts (4 at once) | 5th level, then every 5 levels |
| Ancestry feat | 5th, 9th, 13th, 17th |
| Skill increase | 3rd level, then every 2 levels (rogues earlier/more) |
| Skill feat | 2nd level, then every 2 levels (rogues earlier/more) |
| General feat | 3rd level, then every 4 levels |
| Class feat | per class table (usually even levels) |

Each set of attribute boosts raises four **different** modifiers by +1; a
modifier already +4 or higher increases by only +1 as well but obeys the
per-level caps in the advancement rules.

---

*This work includes Licensed Material from Pathfinder Player Core, Player Core 2, GM Core, Monster Core, and Monster Core 2 © Paizo Inc., used under the ORC License (Library of Congress TX 9-307-067, https://paizo.com/orclicense).*

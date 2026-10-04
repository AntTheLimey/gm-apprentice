# File Format Standards — System Reference Files

Standards for all files under `skills/ttrpg-expert/systems/`.

---

## 1. Licence Notice

**One notice per system, not one per file.** Each system directory ships a
`NOTICE.md` with the licence notice for the files in it, and the skill zips
include it. Reference files carry no attribution header or footer; the H1 is
the first line.

When you add a file that references copyrighted game content:

- Add it to that system's `NOTICE.md` if the system's notice records sources
  per file (Call of Cthulhu does: which files derive from BRP, which from
  Lovecraft's public-domain fiction, which are our own descriptions).
- Update `ATTRIBUTION.md` in the same commit with the source, licence and
  what was done to it. CI fails if a PR adds licensed files without it.
- GURPS content stays within names, point costs and short notes. CI benchmarks
  GURPS tables against the public GCS library (`scripts/license_check.py`).

Original-content-only files need nothing.

---

## 2. Priming Paragraph

Immediately after the H1, no blank line between them. 2–4 lines of prose.
States: what the file contains, when to use it (chargen / play / lookup),
and what is **not** here (point to other files). No headers or lists.

```text
# System Name -- Topic Reference

What this file covers. When to reach for it. What's not covered:
see other-file.md.
```

---

## 3. Overlay Priming (variant files)

Files in `variants/` subdirectories (e.g., `variants/regency/`)
must state in the priming paragraph: which base file this overlays,
that only differences are listed, and that unlisted base content
still applies.

```text
Regency (1811-1820) overlay for CoC 7e. Use alongside base
`../skills.md`. Only differences listed here; all unlisted
base CoC skills remain available.
```

---

## 4. Compact Writing Rules

**One-line entries** for skills, traits, items:
```text
**Skill Name** (base%) — what it does. Key mechanic if any.
**Trait Name** [cost] — effect. Limitation if any.
```

**Tables** for lookup data with 3+ fields or 5+ rows.

**In vault content files that Obsidian formats** (PC sheets, session plans,
entity notes), **never put a `|` inside a table cell.** Both an aliased wikilink
(`[[Target|Alias]]`) and an escaped pipe (`\|`) break the table: the escape
renders correctly until Obsidian's formatter reflows the table, then parses the
escape as a real column boundary and splits the cell. Link by frontmatter alias
(`[[Hassan]]`), which Obsidian resolves to the file and displays cleanly with no
pipe; fall back to a plain `[[Filename]]` where no alias exists. (This governs
vault content, not repo docs rendered by GitHub — §8 below deliberately uses
`\|` to illustrate another file's parser columns, which is safe here.)

**No padding:** no "This section covers…" lead-ins, no flavour text,
no restatements of the header. Every sentence must carry mechanical
information.

**Mechanical precision:** exact values always — dice (`3d6`), thresholds
(`≤ half skill`), formulas (`Parry = Skill/2+3`), page refs (`B208`).

---

## 5. Cross-Reference Conventions

Do not duplicate content across files. Link instead.

| Situation | Format |
|-----------|--------|
| Within same system | `See combat-reference.md` |
| From variant to base | `See ../skills.md` |
| To a shared ref | `See shared/entity-schema.md` |

Place cross-references in the priming paragraph or at the top of the
relevant section.

---

## 6. Attribution Footer

Removed. Reference files no longer end with a licence footer; the system's
`NOTICE.md` carries it (see section 1). Do not add one.

---

## 7. Copyright Boundaries

**Permitted:** skill and trait names, point costs, base percentages, stat
block formats, damage values, dice expressions, formulas, page references,
rule and procedure names, short mechanical notes (one line per item).

**Not permitted:** verbatim rulebook prose, flavour text, extended
descriptions reproducing book explanations, scenario or adventure content.

Original-content files (house rules, campaign notes) need no attribution.

---

## 8. CoC 7e investigator sheet — structure the publish tool reads

`tools/publish/lib/templates/coc/parse.js` renders CoC PC pages by
**parsing the markdown body tables** of the PC file. The shipped templates
(`skills/shared/templates/pc-coc-7e.md` and `pc-coc-7e-regency.md`) must
keep this structure exactly — the parser matches on section titles,
subsection titles, and the first column of each table. If you rename a
section or column, **you must update
`tools/publish/lib/templates/coc/parse.js`** in the same change, or the
field silently stops rendering.

Required body structure:

| Section | Subsection | Table columns / rows the parser reads |
|---------|-----------|----------------------------------------|
| `## Stat Sheet` | `### Characteristics` | `Characteristic \| Regular \| Half \| Fifth` (rows STR/CON/DEX/INT/SIZ/POW/APP/EDU) |
| | `### Derived` | `Attribute \| Max \| Current` (rows HP, MP, `Luck \| — \|`, Sanity) |
| | `### Reputation` (Regency only) | `Attribute \| Value` (rows `Starting Reputation`, `Current Reputation`, `Censure`) |
| | `### Combat` | `Attribute \| Value` (rows Move, Build, Damage Bonus, `Dodge (Regular)`, `Dodge (Half)`, `Dodge (Fifth)`) |
| | `### Status` | 5 checkbox items (Temporary Insanity, Indefinite Insanity, Major Wound, Unconscious, Dying) |
| `## Skills` | — | `Skill \| Base \| Regular \| Half \| Fifth` |
| `## Combat` | — | weapons: `Weapon \| Skill % \| Damage \| Attacks \| Range \| Ammo \| Malf` |
| `## Equipment` | — | Wealth: `Attribute \| Value` (rows `Spending Level`, `Cash`, `Assets`); plus the prose Record sections |

Notes:

- **Two sections are both titled Combat.** `### Combat` *inside* `## Stat
  Sheet` holds Move/Build/DB/Dodge; the top-level `## Combat` holds the
  weapons table. The parser scopes the stat one to the Stat Sheet section,
  so keep both titles as-is.
- **Skill names must match the builder's canonical names.** The merger
  (`coc/skills.js`) starts from a canonical skill list and appends any
  extra skills it finds on the sheet; it recomputes Half/Fifth from
  `Regular` and derives a "developed" flag from `Regular > Base`, so the
  `Base` column is advisory for canonical skills. Use full names
  (`Mechanical Repair`, `Electrical Repair`, `Operate Heavy Machinery`,
  `Language (Other)`) rather than abbreviations — an alias table exists only
  as a safety net for legacy hand-written sheets. Leave specialisation
  placeholders (`Art/Craft ()`, `Science ()`, `Survival ()`, `Pilot ()`)
  empty; the builder appends real specialisations and suppresses the bare
  parent.
- **Record prose sections** the page renders as narrative: Background,
  Injuries & Scars, Phobias & Manias, Encounters with Strange Entities,
  Arcane Tomes & Spells, Fellow Investigators, Current Status.

### Sheet crest (campaign-wide masthead image)

The optional investigator-sheet crest is a **campaign-level** setting, not a
per-PC frontmatter field. Set `sheet_crest` (a path or URL to the crest
image) in the vault config (`_meta/vault-config.md` frontmatter, alongside
other publish settings such as `setting_year`); it applies to every CoC PC
page in the campaign. There is **no** per-PC `crest` frontmatter override —
that was deliberately deferred, so adding a crest needs no
schema-change-procedure and no entity-template change.

---

## 9. D&D 5e PC sheet — structure the publish tool reads

`tools/publish/lib/templates/dnd/` renders D&D PC pages by parsing the
markdown body of the PC file, as the CoC renderer does (`parse.js` reads
the note, `blocks/` draws one block each). The shipped template
(`skills/shared/templates/pc-dnd-5e-2024.md`) must keep this structure.
If you rename a section, subsection, column or first-column label,
update `dnd/parse.js` in the same change. Its tests build a PC from the
real template, so a mismatch fails the suite.

| Section | Subsection | What the renderer reads |
|---------|-----------|--------------------------|
| `## Stat Sheet` | `### Core` | `Attribute \| Value` (rows Level, XP, Proficiency Bonus, Heroic Inspiration) |
| | `### Ability Scores` | `Ability \| Score \| Modifier \| Save Proficiency \| Save` (rows STR/DEX/CON/INT/WIS/CHA) |
| | `### Combat` | `Attribute \| Value` (rows AC, Initiative, Speed, Size, `HP (Current)`, `HP (Max)`, `Temp HP`, `Hit Dice (Spent/Max)`, `Death Saves (S/F)`, Exhaustion, Conditions) |
| | `### Senses` | `Attribute \| Value` (rows Passive Perception, Passive Investigation, Passive Insight, then any special sense) |
| | `### Defences` | the `**Resistances:**`, `**Immunities:**`, `**Vulnerabilities:**`, `**Condition Immunities:**` and `**Armour Class:**` lines |
| `## Background` | — | the `**Species:**`, `**Class/Subclass:**` and `**Background:**` lines, for the header. The class line carries levels: `Paladin 5 (Oath of Devotion)`, a multiclass joined by `/` |
| `## Skills` | — | `Skill \| Ability \| Proficient \| Expertise \| Modifier` |
| `## Class Features`, `## Species Traits`, `## Feats` | — | each `Name \| Action \| Uses \| Used \| Recovers \| Summary` |
| `## Spellcasting` | — | `Attribute \| Value` (ability, attack modifier, save DC); a second casting class adds rows labelled with the class |
| | `### Spell Slots` | `Level \| Total \| Expended`; a warlock adds a row `Pact (3rd)`; a row with neither Total nor Expended is left out |
| | `### Spells` | `Spell \| Level \| Time \| Range \| Components \| Duration \| Hit / DC \| Tags \| Summary` |
| `## Proficiencies` | — | shown as written (`**Armor Training:**`, `**Weapons:**`, `**Weapon Mastery:**`, `**Tools:**`, `**Languages:**`) |
| `## Equipment` | `### Weapons & Damage Cantrips` | `Name \| Atk Bonus / DC \| Damage & Type \| Notes`; this is the attack list |
| | `### Gear` | `Item \| Qty \| Notes` |
| | `### Magic Item Attunement` | `Slot \| Item` |
| | `### Coins` | `CP \| SP \| EP \| GP \| PP`, one row of numbers |

Vocabulary the page acts on:

- **Action**: `Action`, `Bonus Action` or `Reaction`, or blank for a
  passive feature. These group the Combat tab; any other word is shown
  as a tag and not grouped.
- **Uses / Used**: whole numbers. Ten or fewer are drawn as marks,
  more as `18 / 25`.
- **Recovers**: `Long Rest`, `Short Rest`, or
  `1 Short Rest, all Long Rest`. Anything else (`Dawn`) is shown and
  left to the player. Hit dice and spell slots have no Recovers cell;
  the `Pact` row is the short-rest one.
- **Tags** (spells): comma-separated. `C` (concentration) and `R`
  (ritual) are recognised; the rest are shown (`Always prepared`).
- **Level** (spells): `Cantrip` or `1` to `9`; the page groups by it.

Notes:

- **The site does no sums.** Every modifier, save, passive score and DC
  is shown as the note has it, and a blank cell stays blank.
  `skills/shared/scripts/dnd_sheet.py` fills the derived cells:
  Proficiency Bonus, each ability's Modifier and Save, each skill's
  Modifier, the three passive scores, Initiative, Spell Attack Modifier
  and Spell Save DC. It maintains a cell that is blank or a bare number
  and keeps one that carries a reason, `+7 (cloak of elvenkind)`. AC,
  HP, Speed, attack lines and slot totals are written by hand.
- **Nothing in a consumed section is dropped.** Stat Sheet, Skills,
  Class Features, Species Traits, Feats, Spellcasting, Proficiencies
  and Equipment leave the accordion list once the sheet renders
  (`isDndConsumedTitle` in `dnd/index.js` is the one matcher both sides
  use), so the renderer shows as written whatever it cannot place: an
  extra or repeated `###` subsection, a repeated `##` section, prose or
  a second table beside a parsed table, and any table row it could not
  read.
- **Tables are read by position, checked against the header.** A table
  whose leading header cells are not the ones above is shown whole as a
  table. So is any single row it cannot read: a Proficient, Expertise
  or Save Proficiency cell that is not a yes or no word, an ability row
  that is not one of the six, a Uses or Used cell that is not a whole
  number, a spell whose Level is not `Cantrip` or `1` to `9`, and a
  slot row whose Total is not a number or whose Expended exceeds it. A
  feature, spell, attack or gear name may be a wikilink.
- **The layout before 1.10.33 is still read**, so a note nobody has
  converted keeps publishing with every line on the page. A
  four-column ability table (no `Save`) is placed with no save number.
  `Passive Perception` under Combat is placed with the senses. A
  `### Prepared Spells` list, prose under Class Features, Species
  Traits or Feats, and a prose Gear list are shown as written under
  their own headings; prose features are not grouped on the Combat
  tab. `dnd_sheet.py` fills the cells such a note has and adds no
  column.
- **Background stays an accordion.** The header reads three lines from
  it (`Race` and `Classes` are accepted too); its prose is not on the
  sheet.
- The template's own `{list}` placeholders, its empty table rows and
  its "Omit this section" note are not content, and a Spellcasting
  section with nothing filled in is left out, so a non-caster has no
  Spells tab. Braces an author wrote are kept.

---

## 10. PF2e PC sheet — structure the publish tool reads

`tools/publish/lib/templates/pc-pf2e.js` renders PF2e PC pages from the
body of the PC file, on its own engine (`d20-sheet.js`, which D&D left
for §9's renderer), under the same rules as §9: positional tables
checked against their header, nothing in a consumed section dropped,
Background left as an accordion. The shipped template
(`skills/shared/templates/pc-pf2e.md`) must keep this structure; its
tests build a PC from the real template.

| Section | Subsection | What the renderer reads |
|---------|-----------|--------------------------|
| `## Stat Sheet` | `### Core` | `Attribute \| Value`; `Level` goes to the header, every other row becomes a tile |
| | `### Attributes` | `Attribute \| Modifier` (rows STR/DEX/CON/INT/WIS/CHA) |
| | `### Combat` | `Attribute \| Value`; `HP (Current)` (or a bare `HP`) and `HP (Max)` merge into one tile, every other row becomes a tile |
| `## Background` | — | the `**Class/Subclass:**`, `**Ancestry:**`, `**Heritage:**` and `**Background:**` lines, for the header |
| `## Skills` | — | `Skill \| Attribute \| Rank \| Modifier`; Rank is U/T/E/M/L or the word |
| `## Spellcasting` | — | `Attribute \| Value` (tradition, prepared / spontaneous, attack modifier, DC) |
| | `### Spell Slots` | `Rank \| Total \| Expended` |
| | `### Focus Spells` | the one-row table `Focus Points (Current/Max) \| value`; the rest is shown as written |
| | other subsections | shown as written |
| `## Proficiencies` | — | shown as written |

Consumed sections: Stat Sheet, Skills, Spellcasting, Proficiencies. The
template's own notes ("Remaster attributes are modifiers, not scores.",
the rank legend, "Omit this section…"), its `{…}` placeholder lines and
its unfilled `Lore ({topic})` row are not content.

---

## 11. FitD PC sheet — structure the publish tool reads

`tools/publish/lib/templates/pc-fitd.js` renders Forged in the Dark PC
pages from the body of the PC file, with the same no-loss rule as §9.
The shipped template (`skills/shared/templates/pc-fitd.md`) must keep
this structure; its tests build a PC from the real template.

| Section | Subsection | What the renderer reads |
|---------|-----------|--------------------------|
| `## Stat Sheet` | (top) | the `**Playbook:**` line, for the identity block |
| | `### Action Ratings` | a bold attribute name (`**Insight**`) on its own line over each `Action \| Rating` table; a rating of 0 to 4 becomes dots |
| | `### Stress & Trauma` | `Attribute \| Value`; `Stress` as `n / max` becomes a track, `Trauma` a list split on commas or semicolons, any other row a tile |
| | `### Armor Uses` | `Type \| Used` with a yes or no word |
| | `### Harm`, `### XP`, others | shown as written |
| `## Background` | — | every filled `**Label:** value` line of up to 80 characters that does not wrap (Heritage, Background, Look, Vice/Purveyor), each shown under its own label in the identity block |
| `## Special Abilities` | — | shown as written |
| `## Stash & Coin` | — | `Attribute \| Value`, every row a tile |

Consumed sections: Stat Sheet, Special Abilities, Stash & Coin. Friends
& Rivals, Long-Term Projects and Background stay accordions; Equipment
stays on its tab. An action table with no attribute name over it, a
rating outside 0 to 4 and a stress value that is not `n / max` are
shown as written.

---

## Quick Checklist

- [ ] Licensed content: system `NOTICE.md` and `ATTRIBUTION.md` updated; no per-file notice
- [ ] H1 + priming paragraph ≤ 4 lines, states scope and exclusions
- [ ] One-line format or tables — no prose padding
- [ ] All numbers exact (dice, %, formulas, page refs)
- [ ] Cross-references use correct relative paths
- [ ] No verbatim rulebook prose

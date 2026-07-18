# File Format Standards — System Reference Files

Standards for all files under `skills/ttrpg-expert/systems/`.

---

## 1. Attribution Header

**Required** for files referencing copyrighted game content. First lines,
before the H1:

```text
> [Source] attribution: [License]. See ATTRIBUTION.md.
> [System] adaptation: Our own descriptions of uncopyrightable
> game mechanics (Baker v. Selden, 1879). Not [Publisher] text.
```

GURPS files use the full SJG Online Policy notice block (see
`gurps-4e/skills-combat.md`). **Omit** for original-content-only files.

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

**Required** for licensed content files. Last lines, after all content:

```text
---
*[System] content: [brief license statement]. See ATTRIBUTION.md.*
```

GURPS files use the full SJG notice block. Original-content files need
no footer.

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

## Quick Checklist

- [ ] Attribution header present (licensed content)
- [ ] H1 + priming paragraph ≤ 4 lines, states scope and exclusions
- [ ] One-line format or tables — no prose padding
- [ ] All numbers exact (dice, %, formulas, page refs)
- [ ] Cross-references use correct relative paths
- [ ] Attribution footer present (licensed content)
- [ ] No verbatim rulebook prose

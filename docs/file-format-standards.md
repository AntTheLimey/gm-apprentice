# File Format Standards — System Reference Files

Standards for all files under `skills/ttrpg-expert/systems/`.

---

## 1. Attribution Header

**Required** for files referencing copyrighted game content. First lines,
before the H1:

```
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

```
# System Name -- Topic Reference

What this file covers. When to reach for it. What's not covered:
see other-file.md.
```

---

## 3. Overlay Priming (variant files)

Files in `personal/` or other variant subdirectories must state in the
priming paragraph: which base file this overlays, that only differences
are listed, and that unlisted base content still applies.

```
Overlays `systems/coc-7e/mechanics.md`. Only differences and additions
are listed. All base mechanics apply unless explicitly replaced.
```

---

## 4. Compact Writing Rules

**One-line entries** for skills, traits, items:
```
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

```
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

## Quick Checklist

- [ ] Attribution header present (licensed content)
- [ ] H1 + priming paragraph ≤ 4 lines, states scope and exclusions
- [ ] One-line format or tables — no prose padding
- [ ] All numbers exact (dice, %, formulas, page refs)
- [ ] Cross-references use correct relative paths
- [ ] Attribution footer present (licensed content)
- [ ] No verbatim rulebook prose

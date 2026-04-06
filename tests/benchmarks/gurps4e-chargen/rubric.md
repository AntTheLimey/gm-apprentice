# GURPS 4e Character Quality Rubric

Score each dimension 1-5. Max total: 25.

## 1. Math Accuracy

- **5**: Zero errors. Every point traceable. Derived stats
  (HP, Will, Per, FP, Basic Speed, Basic Move, Dodge, BL,
  Damage) all correct. Skill levels match cost progression.
  Point summary totals exactly to budget.
- **4**: One minor error (e.g., Dodge off by 1, BL rounded
  differently). Points still sum correctly.
- **3**: 1-2 calculation errors in skills or derived stats.
  Point total may be off by 1-2 points.
- **2**: Multiple errors. Point total off by 3+ points.
  Some derived stats clearly wrong.
- **1**: Pervasive errors. Point total badly wrong. Many
  derived stats incorrect.

## 2. Prerequisites

- **5**: All spell prerequisites satisfied (each prereq
  spell appears on the sheet). No illegal trait combinations.
  Magery level sufficient for all spells. Technique defaults
  reference skills that exist on the sheet.
- **4**: All satisfied, minor technicality (e.g., a spell
  college assignment is arguable).
- **3**: One prerequisite gap (missing prereq spell, or a
  technique referencing an unpurchased skill).
- **2**: Multiple prerequisite violations.
- **1**: Systematic prerequisite failures — spells without
  Magery, techniques without base skills, etc.

For non-magic, non-power characters: score based on trait
prerequisites only (e.g., Weapon Master requiring a stated
weapon group, Style Familiarity requiring the style).
If the character has no prerequisite-dependent traits at all,
score 5 by default.

## 3. Build Efficiency

- **5**: Every point serves the concept. No orphan skills
  (skills that don't support the character's role). Attribute
  levels justify the skill spread. Passes the Attribute
  Efficiency Check.
- **4**: Tight build with 1 minor suboptimal choice. Passes
  the Attribute Efficiency Check.
- **3**: Reasonable build, some odd choices OR fails the
  Attribute Efficiency Check (capped here).
- **2**: Noticeable waste — points in irrelevant skills, or
  badly distributed attributes.
- **1**: Major misallocation — high attributes with few
  skills, or scattered skills that don't form a coherent
  capability set.

### Attribute Efficiency Check

For each controlling attribute (ST, DX, IQ, HT), check
whether raising the attribute by +1 would save more skill
points than it costs.

**Procedure:**
1. Group all skills by controlling attribute.
2. For each skill, calculate savings if attribute were +1:
   - 8 pts spent → saves 4 (drop to 4 pts, same level)
   - 4 pts spent → saves 2 (drop to 2 pts, same level)
   - 2 pts spent → saves 1 (drop to 1 pt, same level)
   - 1 pt spent → saves 0 (can't go below 1 pt; level
     goes up for free as a bonus)
3. Sum savings for that attribute.
4. Compare to attribute cost: DX and IQ cost 20/level,
   ST and HT cost 10/level.
5. If savings > attribute cost: **MISS** — the character
   would be strictly better with the attribute raised.

Report: "Attr Eff Miss: yes/no" and if yes, which
attribute(s) and by how much.

## 4. Concept Coherence

- **5**: Tight narrative. Disadvantages drive play and
  create GM hooks. Skills, traits, and equipment all support
  one clear character concept. Background connects to
  mechanical choices.
- **4**: Cohesive build with one slightly odd fit.
- **3**: Mostly consistent, 1-2 traits or skills don't
  clearly serve the concept.
- **2**: Noticeable disconnect between concept and build.
  Several choices feel arbitrary.
- **1**: Disjointed grab-bag — no clear character emerges.

## 5. Completeness

- **5**: Full character sheet ready to hand to a player.
  All required sections present and populated. Equipment has
  costs and weights. Combat summary includes attacks with
  damage and active defenses. Encumbrance calculated.
- **4**: All sections present, one slightly sparse (e.g.,
  equipment missing weights, or background is thin).
- **3**: All sections present but some sparse. May be
  missing encumbrance or combat techniques.
- **2**: One or more required sections missing entirely.
- **1**: Multiple sections missing. Not usable at the table.

## Output Format

For each character, output a JSON block:

```json
{"type":"combat","scores":{"math":N,"prereqs":N,"efficiency":N,"coherence":N,"completeness":N,"total":N},"attr_eff_miss":BOOL,"attr_eff_detail":"STRING_OR_NULL","notes":"STRING"}
```

Output exactly 3 JSON blocks, one per character (combat,
magic, super), each on its own line. Separate the blocks
with a line containing only `---`. No other text.

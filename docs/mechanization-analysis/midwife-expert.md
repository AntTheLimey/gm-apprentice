# Mechanization analysis — the-midwife + ttrpg-expert

Scope covered: `skills/the-midwife/` (SKILL.md + all 5 references),
`skills/ttrpg-expert/SKILL.md`, `INDEX.md`, and the 8 named top-level
refs; `skills/ttrpg-expert/systems/` surveyed structurally (139 non-personal
`.md`, 27,467 lines, 1.39 MB, 7,611 markdown table rows) with all five
`character-generation.md` files read in full plus samples of the big data
files. Existing scripts probed via `--help` / source.

---

## 0. Baseline — what is ALREADY-SCRIPTED (class A)

| Script | Covers |
|---|---|
| `vault_check.py` | frontmatter schema + enums, name similarity, index drift, stale drafts, changed-since, tables, timeline, read-aloud, **relationship predicate vocabulary** |
| `graph_check.py` | orphans, unresolved links, dead ends, backlinks, ambiguous |
| `vault_search.py` | BM25 ranked prose search **over a vault only** |
| `session_context.py` | session-prep read-set bundle (wrap-up, PC `## Current Status`, plan, `_World/_flags.md`, overview) |
| `stamp_entities.py` | batch `asOfSession`/`lastUpdated`/tag stamping |
| `gurps_check.py` | GURPS sheet arithmetic: attributes, encumbrance, load, defenses, points (**sums only**), skills (B170), damage |
| `gurps_calc.py` | pure GURPS formulas: BL, enc tiers, Move/Dodge, thrust/swing, Parry/Block, B170 closed form |
| `schema_rules.py` | frontmatter parser, enums, required fields, predicate vocabulary + inverses + fuzzy suggest |

**Neither skill in scope invokes any of them**, with one exception:
`systems/gurps-4e/character-generation.md:348` and
`systems/gurps-4e/character-sheet.md:257` call `gurps_check.py`. A repo-wide
grep for `shared/scripts` returns zero hits in `skills/the-midwife/` and zero
in any top-level `ttrpg-expert` reference. Everything below the GURPS line is
done by prose interpretation.

---

## 1. The four focus questions, answered

### (1) Routing — would a lookup script beat the current approach?

**Yes, decisively for `systems/`, marginally for the top-level prose refs.**
`docs/experiment-section-extraction.md` frames the problem as *section*
extraction from prose files (its candidates at :90-92 are
`check-procedures.md`, `active-play-management.md`, `content-generation.md`)
and concludes the win is ~10% (`:96`). That framing misses where the tokens
actually are. The `systems/` corpus is **record-shaped, not section-shaped**:
7,611 table rows and thousands of `**Name** (base%) — note` entries across 139
files. The unit a query wants is a *row*, not a section.

Current cost of a one-line lookup, e.g. "what does Combat Reflexes cost?":
`SKILL.md` (13.3 KB) + routing decision + `traits-mental.md` (12 KB) ≈ 6.5k
tokens to return `15 pts, B43`. "Stats for an Ankheg" costs `SKILL.md` +
`monsters.md` index + `monsters-cr2-4.md` (28 KB) ≈ 10k tokens for six lines.
A record lookup returns ~50 tokens.

Worse, routing is *ambiguous by construction* for GURPS: `SKILL.md:181-195`
and `INDEX.md:29` say traits live in `traits-*.md` and skills in `skills-*.md`
— six files each, with no key telling the model which one holds a given trait.
The model guesses or reads several.

The experiment doc's rejection of hard-coded line ranges (`:19-29`) is correct
and my proposal does not reintroduce them: the index is **generated at build
time** (the doc's own approach 3, `:39-44`) but keyed on *entries* rather than
*sections*, and the query returns row text **plus** `file:line` so the model
can widen if it wants.

Second-order win, larger than the per-query one: ~350 lines of routing table
(`SKILL.md:24-71`, `:181-281`; `INDEX.md:21-48`) load on **every**
ttrpg-expert invocation. Most of that collapses to one line ("unknown term →
run `rules_lookup.py`") once lookup is mechanical.

Keep `§` section routing for the genuinely prose refs. Two mechanisms, two
problems.

### (2) Character build validation across five systems

| System | Chargen file | Validation prose | Script |
|---|---|---|---|
| GURPS 4e | `gurps-4e/character-generation.md` | `:315-341` (3 checklists) | `gurps_check.py` — **partial**, see B4 |
| CoC 7e | `coc-7e/character-generation.md` | `:379-396` full checklist | **none** |
| D&D 5e 2024 | `dnd-5e-2024/character-generation.md` | none written | **none** |
| PF2e | `pf2e/character-generation.md` | `:155-165` checklist | **none** |
| FitD | `fitd/character-generation.md` | none written | **none** |
| generic | `generic/character-generation.md` | — | **none** |

Every one of those checklists is arithmetic the model performs by hand. The
GURPS asymmetry isn't justified by anything in the prose — it's just where the
work happened to start.

And `gurps_check.py` is narrower than it reads: `check_points()`
(`gurps_check.py:366-405`) **sums the costs the sheet declares** and compares
them to the sheet's own summary. It never asks whether a declared cost is the
*canonical* cost. A sheet claiming `Combat Reflexes [10]` (true value 15,
`character-generation.md:452`) passes cleanly because the row and the summary
agree. Disadvantage limit, quirk limit (`:499-500`), self-control multipliers
(`:204-211`, `:496-497`), Duty frequency (`:220-222`) and the
enhancement/limitation 20% floor (`:168-172`) are all unchecked.

### (3) Random generation — is the model rolling dice in its head?

**Yes, everywhere, with no code anywhere in the repo.** `grep -rn
"randint\|random.choice\|def roll" tools/ scripts/ skills/` returns nothing.

Places where prose asks for a roll and the model must fabricate it:

- `random-generation.md:30-247` — every table: yes/no oracle (d6), Action+Theme
  2d20, NPC motivation d10 / demeanor d10 / quirk d12 / secret d8, encounter
  layers d12+d8+d6, location d10+d8, plot hooks d20 (`:91` "Roll or choose
  from each column"; `:229` "Roll 2-3 and combine")
- `active-play-management.md:64-71` — improv NPC name/motivation/quirk
- `coc-7e/character-generation.md:41-62` (3D6 / 2D6+6 ×8), `:91` (Luck 3D6×5),
  `:135` ("roll twice, take higher"), `:143` (EDU improvement: 1D100 vs EDU,
  then +1D10)
- `dnd-5e-2024/character-generation.md:88` — 4d6 drop lowest, six times
- `fitd/session-procedures.md:46,151-156` — fortune rolls, acquire-asset tier
  roll, indulge-vice lowest-attribute roll

Two distinct failure modes: (a) LLM "random" numbers are biased and
non-reproducible; (b) nothing constrains the *result* to the table, so a d20
plot hook can come back as an entry that isn't in the d20 list — a hallucinated
table row that reads exactly like a real one.

### (4) Copyright compliance — is there any mechanical check?

**None.** The entire enforcement surface is prose: `CLAUDE.md` hard rules 1-5,
and `publish-site/SKILL.md:346-349` ("If a vault note contains verbatim rules
text from a published source, flag it") — an instruction to eyeball it.
`ROADMAP.md:89` records that a *manual, one-off* "10-word-shingle overlap
audit" was run against the PF2e dataset. The technique works; it is not
repeatable and will not happen on the next content addition.

There is also no check that attribution banners exist. Scanning the corpus for
any license marker finds **18 non-personal files with none**. Some are
legitimately original (`generic/*`, `shared-patterns.md`) or carry a
differently-worded notice (`gurps-4e/character-sheet.md:3-5`,
`coc-7e/character-sheet.md:1-4`). But three FitD files carrying licensed
mechanics have **no attribution at all** — `fitd/rules-reference.md`,
`fitd/mechanics.md`, `fitd/session-procedures.md` — and FitD is CC-BY 3.0,
which *requires* attribution. `gurps-4e/session-procedures.md` likewise carries
GURPS mechanics with no SJG notice, under the repo's strictest license. These
are real compliance defects that a 40-line CI check would have caught.

---

## 2. MECHANIZABLE (class B)

### B1 — Rules lookup index (`rules_lookup.py` + build-time index) — **highest value**

- **Where:** `ttrpg-expert/SKILL.md:13-144` (Quick Commands), `:177-281`
  (System Routing tables); `INDEX.md:21-74`.
- **Prose asks:** match user intent to a file path, then Read the whole file
  and find the row.
- **Contract:** `rules_lookup.py <system> "<term>" [--kind
  trait|skill|spell|monster|feat|item|occupation|condition] [--limit N]` →
  matching entries as `name<TAB>system<TAB>kind<TAB>row-text<TAB>file:line`,
  built from a build-time JSON index over the 7,611 table rows and bold-lead
  entries. Fuzzy fallback on no exact hit.
- **Goes wrong today:** 6.5k–10k tokens to answer a one-line lookup; ambiguous
  routing across `traits-*.md` / `skills-*.md` (six files each, no key); the
  model may answer from trained knowledge when the read feels expensive, which
  is exactly the failure the corpus exists to prevent.
- **Size:** M (indexer ~150, query CLI ~120, plus generated JSON).
- **Overlap:** none. `vault_search.py` is vault-scoped BM25 and does not index
  `skills/`. Supersedes/refines `ROADMAP.md:57`.

### B2 — Dice and table roller (`roll.py`)

- **Where:** citations in §1(3) above.
- **Contract:** `roll.py "3d6"` / `"4d6dl1"` / `"3d6x5"` → `{rolls, kept,
  total}`; `roll.py --table <file>#<anchor> [--count N]` → the *actual* row,
  resolved through the B1 index.
- **Goes wrong today:** biased, unreproducible numbers; hallucinated table
  entries; "roll twice take higher" and "4d6 drop lowest" narrated rather than
  performed.
- **Size:** S for dice; S–M for `--table` (reuses B1).

### B3 — CoC 7e investigator calculator/validator (`coc_check.py`)

- **Where:** `coc-7e/character-generation.md:84-127` (HP=(CON+SIZ)/10,
  MP=POW/5, Dodge=DEX/2, MOV table `:97-106`, damage-bonus/Build band table
  `:109-126`), `:128-146` (age modifier bands + EDU improvement),
  `:154-193` (occupation formulas EDU×4 / EDU×2+APP×2 / …, 75% creation cap,
  CR range, INT×2 personal points), `:64-78` (460-point / quick-fire array
  budgets), `:379-396` (the checklist itself).
- **Contract:** `coc_check.py SHEET.md [--occupation NAME]` → derived-value
  deltas, half/fifth column check, occupation-point budget vs formula,
  personal-point budget vs INT×2, per-skill 75% cap, CR inside occupation
  range, age modifiers applied.
- **Goes wrong today:** nobody re-adds fifteen skill allocations; a budget
  overspend is invisible and permanent. This is precisely the class of error
  `gurps_check.py` exists for, on the system this repo's own campaigns use most.
- **Size:** M (~250–350). Reuse `gurps_check.py`'s sheet-parser design and the
  `pc-coc-7e.md` template shape.

### B4 — GURPS cost validation (extend `gurps_check.py` + `gurps_calc.py`)

- **Where:** `gurps-4e/character-generation.md:99-128` (ST/HT 10, DX/IQ 20 per
  level), `:129-141` (HP 2, Will 5, Per 5, FP 3, Speed 5/+0.25, Move 5),
  `:168-172` (enhancement/limitation, 20% floor), `:199-230` (disadvantage
  limit, CR multipliers ×2/×1.5/×1/×0.5, Duty frequency), `:499-500` (quirk
  cap), `:315-333` (Point Budget Audit).
- **Gap proven at:** `gurps_check.py:337-344` (`_POINT_SOURCES`), `:347-365`
  (`_sum_costs`) — sums declared costs only.
- **Contract:** new `gurps_check.py SHEET.md costs` → attribute cost recomputed
  from delta × rate; secondary cost from delta × rate; each trait's declared
  cost vs the canonical cost from the B1 trait index; disadvantage total vs
  frontmatter `disadvantage_limit`; quirk count/total vs `quirk_limit`; CR
  multiplier arithmetic on `*`-marked disadvantages.
- **Size:** M. Depends on B1 for the trait-cost table.

### B5 — D&D 5e 2024 build math (`dnd_check.py`)

- **Where:** `dnd-5e-2024/character-generation.md:90-98` (27-point buy table),
  `:86` (standard array), `:116-118` (background +2/+1 or +1/+1/+1, cap 20),
  `:120-122` (`floor((score-10)/2)`), `:136-148` (saves/skills = mod + PB,
  passive Perception, AC, spell DC = 8 + mod + PB), `:150-157` (level-1 HP by
  class + CON mod).
- **Contract:** `dnd_check.py SHEET.md` → point-buy total vs 27 / array
  legality, background-adjustment legality, recomputed modifiers and every
  derived number, HP, spell DC/attack, passive Perception.
- **Size:** S–M (~150–250). Nothing exists.

### B6 — PF2e boost legality and proficiency math (`pf2e_check.py`)

- **Where:** `pf2e/character-generation.md:80-95` (four boost sources; "within
  any single set each boost must go to a **different** attribute"; "at 1st
  level no attribute may exceed +4"), `:97-102` (HP = ancestry + class + CON),
  `:104-114` (proficiency ranks +2/+4/+6/+8; trained skill count = class base +
  INT mod), `:155-165` (the checklist).
- **Contract:** `pf2e_check.py SHEET.md` → boost-set legality (pure set
  arithmetic), +4 cap, HP, per-statistic modifier recomputation, trained-skill
  count.
- **Goes wrong today:** the "different attribute per set" rule is the most
  commonly broken PF2e build rule and is mechanically trivial to verify.
- **Size:** M. Nothing exists.

### B7 — FitD build/load validation (`fitd_check.py`)

- **Where:** `fitd/character-generation.md:57-71` (3 playbook dots + 4
  assigned = 7; max rating 2 at creation; one dot each from heritage and
  background), `:128-148` (load bands 1-3/4-5/6/7-9; two-load items),
  `:170-239` (crew starts 2 coin / Tier 0 / 0 rep; 2 preselected + 2 chosen
  upgrades).
- **Contract:** `fitd_check.py SHEET.md` → dot total, per-rating cap, load
  level vs summed item load, crew upgrade count and starting resources.
- **Size:** S.

### B8 — Vault scaffold (`vault_scaffold.py`)

- **Where:** `the-midwife/SKILL.md:64-70` (`_midwife/index.md` + six seed
  subdirs `premises/ npcs/ locations/ hooks/ tone/ mechanics/`);
  `references/scaffold-handoff.md:106-120` (`_World/` + `world-index.md` +
  `_flags.md` stubs), `:70-73` (`Planning/` under the chapter), `:127-157`
  (Campaign Overview from `shared/templates/campaign-overview.md`, eight named
  frontmatter fields + six named body sections); `shared/vault-structure.md:5-45`
  (the full ~20-directory tree); `worldbuilding-mode.md:9-12` (same `_World/`
  stub creation, described a second time).
- **Contract:** `vault_scaffold.py <root> --campaign NAME --system X
  [--midwife|--world|--full]` → creates the tree, instantiates all 17
  `shared/templates/*.md` into `_Templates/`, writes `_meta/vault-config.md`;
  idempotent, never overwrites, prints what it made.
- **Goes wrong today:** ~20 directories + 17 templates by hand is a long tail
  of tool calls, and a *partially* created tree is silent — downstream skills
  assume `_meta/vault-config.md`, `_World/_flags.md`, `_Templates/` exist. The
  tree is also described in prose in three places, which is how it drifts.
- **Size:** M (~200), mostly data-driven from `vault-structure.md` +
  `shared/templates/`.

### B9 — Adventure-brief conformance (`vault_check.py brief`)

- **Where:** `scaffold-handoff.md:195-234` — 13 required sections, a
  visibility column, `## GM Notes` nesting rule, `<!-- spoiler -->` fencing for
  Open Questions, "If They Do Nothing is required"; frontmatter template at
  `:178-193`.
- **Contract:** new subcommand → missing required sections; sections that must
  live under `## GM Notes` but appear as top-level `##`; Open Questions not
  spoiler-fenced; CATS/Session-0 wrongly hidden. (The frontmatter enums —
  `scope`, `continuation_type`, `adventure_shape` — are already class A:
  `schema_rules.py:26-36`.)
- **Goes wrong today:** the brief is the handoff artifact and the input to the
  published site. A GM-Notes section left as a public `##` is a spoiler leak.
- **Precedent:** identical in shape to the session wrap-up conformance check
  shipped in PR #192.
- **Size:** S–M (~120–200).

### B10 — Predicate lookup CLI (`predicate_lookup.py`)

- **Where:** `scaffold-handoff.md:40-44` ("map narrative verbs and normalize
  inverses via `shared/relationship-normalization.md` — never invent a
  predicate"); `relationship-patterns.md:19-81`.
- **Contract:** `predicate_lookup.py "reports to"` → canonical predicate,
  inverse, `bidirectional` flag, and the storage direction — a ~50-line argparse
  wrapper over `schema_rules.suggest_predicates()`,
  `inverse_predicates()`, `predicate_vocabulary()`, which already exist.
- **Size:** S (<80 lines).
- **⚠ Defect found:** `relationship-patterns.md` (the file both `INDEX.md:72`
  and `the-midwife/SKILL.md:247-249` route to for relationship modelling)
  teaches a vocabulary that **does not exist** in the ontology. Of the ~30
  types it lists — `friend`, `family`, `married`, `employer`, `employee`,
  `colleague`, `student`, `member`, `leader`, `ally`, `lives_in`, `works_in`,
  `frequents`, `guards`, `knows_about`, `reports_to`, `stalks` — only `knows`,
  `owns`, `created`, `seeks`, `studies`, `fears`, `worships` are in the
  canonical 77. Its "Core Fields" table (`:9-17`) is a UUID/JSONB database
  schema, not vault frontmatter. `vault_check.py relationships` (added for
  issue #130, "one session's entity generation invented eleven of them") will
  ERROR on anything authored from this file. This is a live prose-vs-code
  contradiction, not a hypothetical.

### B11 — Attribution-banner check (CI)

- **Where:** `CLAUDE.md` hard rule 3; the per-file banners at e.g.
  `coc-7e/character-generation.md:1-3`, `gurps-4e/character-generation.md:3-9`,
  `pf2e/character-generation.md:1-3`, `dnd-5e-2024/character-generation.md:178`,
  `fitd/character-generation.md:271`.
- **Contract:** `attribution_check.py skills/ttrpg-expert/systems` → every
  non-`generic/` file under `systems/<sys>/` must carry that system's required
  notice (pattern table per system); report `file<TAB>missing/mismatched`.
- **Goes wrong today:** already has. `fitd/rules-reference.md`,
  `fitd/mechanics.md`, `fitd/session-procedures.md` carry licensed FitD
  mechanics with **no** CC-BY attribution; `gurps-4e/session-procedures.md`
  carries GURPS mechanics with no SJG notice.
- **Size:** S (<100).

### B12 — Cross-domain matrix row lookup (fold into B1)

`cross-domain-implications.md:17-125` is 10 domains × 6 targets = 60 rows in a
7 KB file, and `the-midwife/SKILL.md:287-288` loads all of it to pick **one**
question for **one** domain. ~1.8k tokens for ~150 tokens of content. Per the
extraction threshold in `CLAUDE.md` this clears the bar, but it does not
warrant a bespoke script — index it as a `kind: implication` record in B1.

---

## 3. HYBRID (class C)

### C1 — License / verbatim-overlap scan (`license_check.py`)

- **Where:** `publish-site/SKILL.md:346-349`; `CLAUDE.md` hard rules 1–2;
  precedent at `ROADMAP.md:89`.
- **Script emits:** for each candidate file, longest verbatim n-gram (n=10
  words, rolling hash) shared with the reference corpus, with `file:line` for
  both sides; plus GURPS-specific structural flags — a stat table over N rows,
  a trait row whose note exceeds "short note" length, an unattributed paragraph
  over X words in a GURPS-tagged file.
- **Model decides:** whether a hit is a legitimate short quoted fragment,
  coincidental phrasing, or covered by SRD/ORC.
- **Goes wrong today:** zero mechanical coverage of the repo's stated
  highest-priority rule. The one audit that was done was manual and is not
  repeatable.
- **Size:** M (~200–300, stdlib). Wants two entry points: skill-invoked
  (publish-site, ttrpg-expert generation) and CI over `systems/`.

### C2 — Vault mining for the-midwife Phase 1 (`vault_check.py dormant`)

- **Where:** `the-midwife/SKILL.md:150-164` — unresolved threads, dormant
  factions, PC `## Current Status → Open threads` / `Knows (exclusive)`,
  unfired Chekhov elements, NPCs with unfinished business, parked hooks.
- **Already available and unused:** `session_context.py` emits the wrap-up +
  active-PC `## Current Status` blocks + `_World/_flags.md` deferred items in
  one call; `vault_check.py stale-drafts`; `graph_check.py orphans|deadends`.
  The-midwife invokes none of them. **Zero-cost win: wire
  `session_context.py` into `SKILL.md:150-164` the way session-prep does
  (`session-prep/SKILL.md:65`).**
- **Genuinely new script emits:** entities whose `asOfSession` is ≥N sessions
  behind the vault max, grouped by type; factions whose `clock` has not moved;
  open threads with the session they were opened (feeds the Chekhov protocol at
  `ttrpg-expert/SKILL.md:110-113` and `Canon and Validation:302-303`, which
  states hard numeric thresholds — "no stale threads (3+ sessions), no unfired
  Chekhov's guns (5+ sessions)" — that nothing counts).
- **Model decides:** which dormant thing is creatively interesting.
- **Size:** M (~150 as a `vault_check.py` subcommand); reuses its active-PC
  helper (`vault_check.py:443`) and `session_context`'s chapter scoping.

### C3 — Spotlight / arc-stage evidence (`spotlight.py`)

- **Where:** `arc-spotlight-reference.md:61-72` (15% floor; sustained
  imbalance = 3+ consecutive sessions), `:45-59` (B-plot rotation = party
  size), `:105-109` ("No PC should go three or more sessions without a
  high-impact touchpoint"); `ttrpg-expert/SKILL.md:115-118` ("Review last 2-3
  sessions per-PC. Flag below 15% floor").
- **Script emits:** per-PC mention/participation counts across the last N
  session and wrap-up files, sessions since last B-plot feature, sessions since
  each touchpoint type, sorted — as counts with the source files named.
- **Model decides:** whether a low count means an underserved *player*, and
  what the corrective B-plot is.
- **Goes wrong today:** the model is asked to compute a percentage by eyeballing
  several long files, then apply a hard 15% threshold to that invented number.
  A fabricated number under a precise threshold is worse than no number,
  because it reads as measured.
- **Size:** M (~200).

### C4 — Handout continuity register

- **Where:** `handouts-and-props.md:301-309` (record every handout: number,
  type, content, session delivered; cross-check names/dates against canon;
  callbacks), `:245-247` (CoC numbering + summary table).
- **Script emits:** the register built from `Documents/` frontmatter; plus
  proper nouns and dates appearing in handout bodies that resolve to no vault
  entity (reuses `graph_check`'s resolution machinery over plain text).
- **Model decides:** whether an unresolved name is a deliberate mystery or a
  continuity error.
- **Size:** M. Overlaps the `props_check` already sketched in `ROADMAP.md:51` —
  ship as one handout pipeline.

### C5 — Three Clue Rule counting at generation time

- **Where:** `content-generation.md:25-28`, `:64-67` (≥3 clues across ≥2
  sources); `scaffold-handoff.md:205` (Entry Points ≥3).
- Auditing is already covered by campaign-qa's clue-redundancy check; the only
  gap is the generation-time counterpart. Script emits the clue count per
  conclusion node; model judges *independence*. **Size:** S, low priority.

---

## 4. JUDGMENT (class D) — leave with the model

Worldbuilding question selection and why-chains
(`worldbuilding-questions.md` in full; `worldbuilding-mode.md:32-33` — "ask
questions the world needs answered, not questions a template needs filled" is
explicitly anti-mechanical); pitfall diagnosis
(`worldbuilding-principles.md:43-102`); AIMS agendas and layered secrets
(`npc-generation.md:33-58`); voice, mannerism and period register
(`npc-generation.md:69-86`; `handouts-and-props.md:61-72`, `:218-225`); scene
framing and the bang (`content-generation.md:76-80`); read-aloud prose; tone
calibration (`content-generation.md:218-226`); adventure-shape choice
(`the-midwife/SKILL.md:198-201`); the block/seam fidelity rule
(`scaffold-handoff.md:12-17`); fail-forward pattern selection
(`active-play-management.md:73-82`); reading the table
(`active-play-management.md:110-120`); mid-session difficulty judgement
(`:155-180`).

---

## 5. Ranked recommendation

| # | Item | Class | Size | Why first |
|---|---|---|---|---|
| 1 | B1 rules lookup index | B | M | Largest token win; unblocks B4; lets ~350 lines of routing table collapse |
| 2 | C1 license/verbatim scan | C | M | Only mechanical guard on the repo's stated top-priority rule; zero coverage today |
| 3 | B3 CoC investigator check | B | M | Most-used system, most arithmetic, no coverage |
| 4 | B2 dice + table roller | B | S | Cheap; removes a whole class of invented results |
| 5 | B8 vault scaffold | B | M | Removes the longest deterministic tool-call tail in the-midwife |
| 6 | B11 attribution check | B | S | Already found 4 live compliance defects |
| 7 | B5/B6/B7 D&D/PF2e/FitD checks | B | S–M | Closes the five-system asymmetry |
| 8 | C3 spotlight evidence | C | M | Stops a precise threshold being applied to a fabricated number |
| 9 | B4 GURPS cost validation | B | M | Blocked on B1's trait index |
| 10 | B9 brief conformance, B10 predicate CLI | B | S | Small; B10 also forces the B10 defect fix |

## 6. Defects found in passing (independent of any script work)

1. **`relationship-patterns.md` contradicts the canonical predicate
   vocabulary** (detail in B10). Two skills route to it. `vault_check.py
   relationships` ERRORs on its output.
2. **Four `systems/` files carry licensed mechanics with no attribution** —
   `fitd/rules-reference.md`, `fitd/mechanics.md`, `fitd/session-procedures.md`
   (CC-BY 3.0 *requires* it), `gurps-4e/session-procedures.md` (strictest
   license in the repo).
3. **the-midwife invokes zero shared scripts** despite `session_context.py`
   emitting almost exactly the Phase-1 read-set it describes in prose at
   `SKILL.md:150-164`.
4. **`campaign-structure.md` is legacy database documentation, not vault
   guidance** — `:9-14` (`system_id UUID`, `settings JSONB`), `:40-53` (session
   fields as JSONB columns), `:34-38` (a `PLANNED → COMPLETED → SKIPPED`
   lifecycle that contradicts `schema_rules.SESSION_STATUS` =
   `planned/prepped/played/wrap-up/reviewed`), `:97-105` (UUID discovery
   records). `INDEX.md:73` routes "Campaign structure" here. Same class of
   prose-vs-code drift as (1).

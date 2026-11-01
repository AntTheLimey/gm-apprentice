# Baseline Summary — All Skills

**Date:** 2026-04-10 (original 4 skills), 2026-04-20 (session split)
**Purpose:** Establish quality baselines before refactors
**Methodology:** 3 runs per skill, 2 agents per run (sonnet), blind evaluation (opus), 5-dimension rubric (15 pts/question, 75 pts max)
**Campaign data:** tests/benchmark-campaign/ (synthetic CoC 7e campaign, 19 files, 6 deliberate problems)

## Benchmark campaign v2 (1.10.118): a new baseline starts here

Every result below was scored against the campaign as it stood in 2026-04
(stamped 1.9.10, 19 files at the time, notes named with underscores, no
publish list). In 1.10.118 the campaign was brought to the current schema
with the update tool (`migrate.py`), its 16 note files were renamed to match
the wikilinks that name them (`Brother_Ezra.md` is now `Brother Ezra.md`), and
it gained the settings file, a publish list, the `_Templates` folder and the
other folders the update adds. No note text was changed. The deliberate
problems are untouched.

Results from before this change are not directly comparable with results from
after it: the files an agent lists and reads differ in name and in number.
Nothing was deleted or edited here; the old campaign is in git history before
1.10.118, and the scores below stand as recorded. Start any new comparison from
a run on the new campaign.

## Results

| Skill | Median | Mean | Range | Variance | Pass Threshold |
|-------|:------:|:----:|:-----:|:--------:|:--------------:|
| ttrpg-expert | 68 | 67.7 | 64-71 | 7 | ≥ 61 |
| campaign-organizer | 67 | 67.3 | 63-73 | 10 | ≥ 57 |
| campaign-qa | 66 | 64.8 | 61-67 | 6 | ≥ 60 |
| session-prep | 68 | 69.7 | 65-73 | 8 | ≥ 60 |
| session-play | 62 | 62.0 | 61-63 | 2 | ≥ 60 |
| session-wrapup | 70 | 71.7 | 69-73 | 4 | ≥ 66 |

## All Individual Scores

| Skill | R1-A | R1-B | R2-A | R2-B | R3-A | R3-B |
|-------|:----:|:----:|:----:|:----:|:----:|:----:|
| ttrpg-expert | 68 | 71 | 64 | 68 | 69 | 66 |
| campaign-organizer | 67 | 70 | 64 | 67 | 63 | 73 |
| campaign-qa | 62 | 66 | 66 | 67 | 61 | 67 |
| session-prep | 73 | 68 | 68 | — | — | — |
| session-play | 63 | 64 | 61 | — | — | — |
| session-wrapup | 73 | 72 | 70 | — | — | — |

## Pass Criteria

Post-refactor median must meet or exceed the pass threshold for each skill.
Pass threshold = floor(baseline median - variance). Thresholds are integers
because individual scores are integers. A score below the threshold indicates
a regression beyond normal variance.

## Observations

- All six skills cluster in the 62-72 median range.
- Variance ranges from 2 (session-play, tightest) to 10 (campaign-organizer, widest).
- session-play has tight variance because it's a speed-focused skill with consistent output.
- session-wrapup has the highest median (70) of all skills.
- Within-run A/B spreads are typically 1-6 points; the largest outlier is campaign-organizer R3 at 10.
- Evaluator scores are meaningful for within-run deltas but not for cross-run absolute comparisons.
- session-prep/play/wrapup baselines from the split benchmark (2026-04-20) used test variant only (split skill), not control.

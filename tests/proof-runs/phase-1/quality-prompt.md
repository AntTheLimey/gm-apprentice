# Quality Comparison Prompt

**Test median run:** run-2
**Baseline run:** run-4

Feed this to a Sonnet agent for quality comparison.

---

You are a quality checker for the gm-apprentice TTRPG plugin. Compare baseline and test responses using the plugin's own reference files as ground truth.

For each query, read BOTH response files and the ground truth reference. Report:

1. **Accuracy** — facts wrong vs the reference? Cite specifics.
2. **Completeness** — important content missed or hallucinated?
3. **Verdict** — BASELINE BETTER / TEST BETTER / EQUIVALENT

| # | Baseline | Test | Ground truth |
|---|----------|------|--------------|
| 1 | tests/proof-runs/phase-0-baseline/run-4/query-01-response.md | tests/proof-runs/phase-1/run-2/query-01-response.md | skills/ttrpg-expert/systems/coc-7e/combat-reference.md |
| 2 | tests/proof-runs/phase-0-baseline/run-4/query-02-response.md | tests/proof-runs/phase-1/run-2/query-02-response.md | skills/ttrpg-expert/npc-generation.md |
| 3 | tests/proof-runs/phase-0-baseline/run-4/query-03-response.md | tests/proof-runs/phase-1/run-2/query-03-response.md | skills/ttrpg-expert/systems/coc-7e/variants/regency/occupations.md |
| 4 | tests/proof-runs/phase-0-baseline/run-4/query-04-response.md | tests/proof-runs/phase-1/run-2/query-04-response.md | skills/ttrpg-expert/systems/gurps-4e/combat.md |
| 5 | tests/proof-runs/phase-0-baseline/run-4/query-05-response.md | tests/proof-runs/phase-1/run-2/query-05-response.md | skills/ttrpg-expert/systems/gurps-4e/chargen-kit-thief.md, skills/ttrpg-expert/systems/gurps-4e/character-generation.md |
| 6 | tests/proof-runs/phase-0-baseline/run-4/query-06-response.md | tests/proof-runs/phase-1/run-2/query-06-response.md | skills/ttrpg-expert/systems/dnd-5e-2024/classes.md |
| 7 | tests/proof-runs/phase-0-baseline/run-4/query-07-response.md | tests/proof-runs/phase-1/run-2/query-07-response.md | skills/ttrpg-expert/scenario-writing.md |
| 8 | tests/proof-runs/phase-0-baseline/run-4/query-08-response.md | tests/proof-runs/phase-1/run-2/query-08-response.md | skills/ttrpg-expert/systems/fitd/mechanics.md |
| 9 | tests/proof-runs/phase-0-baseline/run-4/query-09-response.md | tests/proof-runs/phase-1/run-2/query-09-response.md | skills/ttrpg-expert/systems/fitd/factions.md |
| 10 | tests/proof-runs/phase-0-baseline/run-4/query-10-response.md | tests/proof-runs/phase-1/run-2/query-10-response.md | skills/ttrpg-expert/npc-generation.md |
| 11 | tests/proof-runs/phase-0-baseline/run-4/query-11-response.md | tests/proof-runs/phase-1/run-2/query-11-response.md | skills/ttrpg-expert/world-evolution.md |
| 12 | tests/proof-runs/phase-0-baseline/run-4/query-12-response.md | tests/proof-runs/phase-1/run-2/query-12-response.md | skills/session-prep/SKILL.md |

Write your report to: tests/proof-runs/phase-1/quality-comparison.md

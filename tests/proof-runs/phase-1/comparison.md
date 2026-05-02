# Phase 1 vs Phase 0 Baseline — Comparison

**Date:** 2026-05-02
**Regression threshold:** >10% per-system average increase = FAIL

## Per-System Verdicts

| System | Baseline Avg Tokens | Phase 1 Avg Tokens | Δ% | Verdict |
|--------|--------------------|--------------------|-----|---------|
| CoC 7e | 34,849 | 27,128 | -22.1% | PASS |
| CoC Regency | 22,633 | 22,673 | +0.2% | PASS |
| GURPS 4e | 31,762 | 32,974 | +3.8% | PASS |
| D&D 5e 2024 | 25,790 | 24,928 | -3.3% | PASS |
| FitD | 28,003 | 27,504 | -1.8% | PASS |
| Generic | 26,026 | 23,217 | -10.8% | PASS |
| Cross-system | 27,189 | 25,696 | -5.5% | PASS |
| Workflow | 45,672 | 39,050 | -14.5% | PASS |

## Overall Result: PASS

All 8 system categories pass the regression gate. No system shows a
token increase above 10%.

## Notable Observations

- **CoC 7e improved the most** (-22.1%), likely benefiting from the
  DRY version-check extraction reducing duplicated preamble text.
- **GURPS 4e showed the largest increase** (+3.8%), well within the
  10% threshold. This is within normal run-to-run variance for a
  single-run comparison.
- **Workflow (session prep) improved 14.5%**, consistent with the
  reconcile fast-path addition reducing unnecessary file reads.
- **Overall token reduction: 7.3%** (26,622 fewer tokens across
  12 queries).

## Caveats

- Single-run comparison (not the 5-run protocol from the new
  benchmark methodology). Sufficient for a merge gate but not
  for statistical claims.
- Phase 1 changes were primarily structural (DRY extraction,
  fast paths) — token improvements are expected to compound
  when combined with Phase 2 and Phase 3 content changes.

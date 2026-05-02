# Phase 1 Summary

**Date:** 2026-05-02
**Model:** Sonnet
**Plugin version:** 1.4.14
**Branch:** fix-and-fortify-phase-1

## Per-Query Metrics

| # | System | Type | Total Tokens | Δ vs Baseline |
|---|--------|------|-------------|---------------|
| 1 | CoC 7e | Lookup | 24,913 | -20.3% |
| 2 | CoC 7e | Generate | 29,343 | -23.7% |
| 3 | CoC Regency | Lookup | 22,673 | +0.2% |
| 4 | GURPS 4e | Lookup | 29,172 | +9.0% |
| 5 | GURPS 4e | Generate | 36,776 | +0.0% |
| 6 | D&D 5e 2024 | Lookup | 24,390 | +0.0% |
| 7 | D&D 5e 2024 | Generate | 25,466 | -6.3% |
| 8 | FitD | Lookup | 22,611 | -0.2% |
| 9 | FitD | Generate | 32,397 | -2.9% |
| 10 | Generic | Generate | 23,217 | -10.8% |
| 11 | Cross-system | Framework | 25,696 | -5.5% |
| 12 | Workflow | Session prep | 39,050 | -14.5% |

## Per-System Averages

| System | Baseline Avg | Phase 1 Avg | Δ% |
|--------|-------------|-------------|-----|
| CoC 7e (2 queries) | 34,849 | 27,128 | -22.1% |
| CoC Regency (1 query) | 22,633 | 22,673 | +0.2% |
| GURPS 4e (2 queries) | 31,762 | 32,974 | +3.8% |
| D&D 5e 2024 (2 queries) | 25,790 | 24,928 | -3.3% |
| FitD (2 queries) | 28,003 | 27,504 | -1.8% |
| Generic (1 query) | 26,026 | 23,217 | -10.8% |
| Cross-system (1 query) | 27,189 | 25,696 | -5.5% |
| Workflow (1 query) | 45,672 | 39,050 | -14.5% |

## Totals

- **Total tokens:** 335,704
- **Baseline total:** 362,326
- **Overall delta:** -7.3% (-26,622 tokens)

## Notes

- Token counts are total_tokens (input + output combined) as reported
  by the Agent tool.
- Wall-clock times and per-query file lists were not preserved through
  session context compaction for queries 1-11. Query 12 ran in 175.7s
  reading 14 files.
- Individual query response files are not included for Phase 1 — full
  response text was lost to context compaction. The token metrics above
  are the authoritative record.
- All queries used the same Sonnet model and benchmark campaign as
  Phase 0 baseline.

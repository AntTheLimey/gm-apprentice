# Phase 0 Baseline Summary

**Date:** 2026-05-02
**Model:** Sonnet
**Plugin version:** 1.4.13

## Per-Query Metrics

| # | System | Type | Total Tokens | Wall-clock (s) | Files Loaded |
|---|--------|------|-------------|----------------|-------------|
| 1 | CoC 7e | Lookup | 31,238 | 29.9 | 4 |
| 2 | CoC 7e | Generate | 38,460 | 68.6 | 5 |
| 3 | CoC Regency | Lookup | 22,633 | 20.4 | 3 |
| 4 | GURPS 4e | Lookup | 26,760 | 42.1 | 3 |
| 5 | GURPS 4e | Generate | 36,764 | 104.1 | 4 |
| 6 | D&D 5e 2024 | Lookup | 24,390 | 26.2 | 2 |
| 7 | D&D 5e 2024 | Generate | 27,189 | 96.6 | 4 |
| 8 | FitD | Lookup | 22,651 | 24.7 | 3 |
| 9 | FitD | Generate | 33,354 | 87.4 | 5 |
| 10 | Generic | Generate | 26,026 | 63.1 | 5 |
| 11 | Cross-system | Framework | 27,189 | 47.6 | 4 |
| 12 | Workflow | Session prep | 45,672 | 196.5 | 17 |

## Per-System Averages

| System | Avg Total Tokens | Avg Wall-clock (s) | Avg Files |
|--------|-----------------|-------------------|-----------|
| CoC 7e (2 queries) | 34,849 | 49.3 | 4.5 |
| CoC Regency (1 query) | 22,633 | 20.4 | 3.0 |
| GURPS 4e (2 queries) | 31,762 | 73.1 | 3.5 |
| D&D 5e 2024 (2 queries) | 25,790 | 61.4 | 3.0 |
| FitD (2 queries) | 28,003 | 56.1 | 4.0 |
| Generic (1 query) | 26,026 | 63.1 | 5.0 |
| Cross-system (1 query) | 27,189 | 47.6 | 4.0 |
| Workflow (1 query) | 45,672 | 196.5 | 17.0 |

## Totals

- **Total tokens:** 362,326
- **Total wall-clock:** 806.2s (13.4 min)
- **Total files loaded:** 59 (not deduplicated)
- **Unique files loaded:** ~25 (estimated from distinct paths across queries)

## Notes

- Token counts are total_tokens (input + output combined) as reported
  by the Agent tool. Separate input/output splits are not available
  from the subagent interface.
- Wall-clock times include agent startup overhead, not just LLM
  inference time.
- Query 1 was re-run due to the original agent hanging; the retry
  metrics are used here.

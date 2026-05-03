# Proof Run Summary — phase-1

**Runs:** 5
**Queries per run:** 12

## Per-Query Statistics

| # | System | Type | Median Tokens | IQR Tokens | Median Time (s) | IQR Time (s) |
|---|--------|------|--------------|------------|----------------|-------------|
| 1 | CoC 7e | lookup | 29,070 | 28,194–31,804 | 53.7 | 40.8–60.9 |
| 2 | CoC 7e | generate | 30,844 | 30,294–36,690 | 93.0 | 71.8–95.3 |
| 3 | CoC Regency | lookup | 25,296 | 25,062–25,556 | 41.8 | 31.0–48.9 |
| 4 | GURPS 4e | lookup | 30,696 | 28,000–32,114 | 75.0 | 62.3–88.7 |
| 5 | GURPS 4e | generate | 42,155 | 41,450–50,310 | 120.0 | 92.2–263.3 |
| 6 | D&D 5e 2024 | lookup | 27,281 | 26,826–27,332 | 59.2 | 48.4–62.5 |
| 7 | D&D 5e 2024 | generate | 32,488 | 29,268–32,628 | 133.3 | 122.1–140.0 |
| 8 | FitD | lookup | 28,270 | 27,938–28,782 | 59.7 | 57.1–63.5 |
| 9 | FitD | generate | 36,128 | 33,715–39,475 | 118.8 | 101.8–126.1 |
| 10 | Generic | generate | 22,555 | 22,298–23,228 | 59.7 | 49.8–65.0 |
| 11 | Cross-system | framework | 33,882 | 29,492–40,388 | 85.1 | 71.2–95.1 |
| 12 | Workflow | session-prep | 59,111 | 50,076–62,901 | 276.3 | 183.3–294.0 |

## Per-System Averages

| System | Median Tokens (avg) | Token IQR (Q1–Q3) |
|--------|--------------------|--------------------|
| CoC 7e (2 queries) | 29,957 | 29,244–34,247 |
| CoC Regency (1 query) | 25,296 | 25,062–25,556 |
| GURPS 4e (2 queries) | 36,426 | 34,725–41,212 |
| D&D 5e 2024 (2 queries) | 29,884 | 28,047–29,980 |
| FitD (2 queries) | 32,199 | 30,827–34,128 |
| Generic (1 query) | 22,555 | 22,298–23,228 |
| Cross-system (1 query) | 33,882 | 29,492–40,388 |
| Workflow (1 query) | 59,111 | 50,076–62,901 |

## Totals

- **Total tokens (sum of medians):** 397,776
- **Runs:** 5

# phase-1 vs phase-0-baseline — Comparison

**Test runs:** 5
**Baseline runs:** 5

## Per-Query Scorecard

| # | Query | Cheaper? | Faster? | Tokens (baseline → test) | Time (baseline → test) |
|---|-------|----------|---------|--------------------------|------------------------|
| 1 | What are the CoC 7e Chase rules? | ~ (noise) | ~ (noise) | 31,238 → 29,070 (-6.9%) | 52.2s → 53.7s (+2.9%) |
| 2 | Create a CoC 7e NPC — a paranoid antiquarian … | ~ (noise) | ~ (noise) | 30,384 → 30,844 (+1.5%) | 89.4s → 93.0s (+4.1%) |
| 3 | What occupations are available in Regency Cth… | ~ (noise) | ~ (noise) | 25,218 → 25,296 (+0.3%) | 41.8s → 41.8s (-0.0%) |
| 4 | How does the GURPS 4e grappling system work? | ~ (noise) | ~ (noise) | 31,006 → 30,696 (-1.0%) | 74.5s → 75.0s (+0.7%) |
| 5 | Build me a GURPS 4e cat burglar, 150 points | ~ (noise) | YES | 44,308 → 42,155 (-4.9%) | 155.0s → 120.0s (-22.6%) |
| 6 | What are the Paladin's 2024 class features? | ~ (noise) | ~ (noise) | 27,157 → 27,281 (+0.5%) | 60.9s → 59.2s (-2.9%) |
| 7 | Design a Three Clue Rule investigation for my… | no | no | 27,541 → 32,488 (+18.0%) | 116.5s → 133.3s (+14.4%) |
| 8 | How do Fortune Rolls work in Blades in the Da… | ~ (noise) | no | 28,019 → 28,270 (+0.9%) | 57.0s → 59.7s (+4.8%) |
| 9 | Create a FitD score opportunity against the B… | no | no | 33,332 → 36,128 (+8.4%) | 96.7s → 118.8s (+22.9%) |
| 10 | I need to improvise a suspicious NPC for an i… | ~ (noise) | ~ (noise) | 22,633 → 22,555 (-0.3%) | 57.7s → 59.7s (+3.4%) |
| 11 | Explain the Universal Faction Turn procedure | ~ (noise) | no | 32,830 → 33,882 (+3.2%) | 64.0s → 85.1s (+32.9%) |
| 12 | Run session prep for Session 4 of my campaign | no | no | 48,051 → 59,111 (+23.0%) | 212.0s → 276.3s (+30.3%) |

## System Summary

| System | Cheaper? | Faster? | Token Δ | Time Δ | Significant? |
|--------|----------|---------|---------|--------|-------------|
| CoC 7e | YES | no | -2.8% | +3.6% | 0/2 tok, 0/2 time |
| CoC Regency | ~ | ~ | +0.3% | -0.0% | 0/1 tok, 0/1 time |
| GURPS 4e | YES | YES | -3.3% | -15.0% | 0/2 tok, 0/2 time |
| D&D 5e 2024 | no | no | +9.3% | +8.5% | 1/2 tok, 1/2 time |
| FitD | no | no | +5.0% | +16.2% | 1/2 tok, 2/2 time |
| Generic | ~ | no | -0.3% | +3.4% | 0/1 tok, 0/1 time |
| Cross-system | no | no | +3.2% | +32.9% | 0/1 tok, 1/1 time |
| Workflow | no | no | +23.0% | +30.3% | 1/1 tok, 0/1 time |

## Overall

- **Baseline total (median tokens):** 381,717
- **Test total (median tokens):** 397,776
- **Overall delta:** +4.2%

## Statistical Confidence

With 5 runs, the IQR (interquartile range) shows the spread of the middle 50% of results. When the baseline value falls outside the test IQR, the difference is likely real — not noise.

The Significant? column shows how many queries per system have their baseline outside the test IQR. Higher counts = more confidence the change is real.


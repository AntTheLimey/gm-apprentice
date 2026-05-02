# Phase 0 Baseline — Query Runner Instructions

**Model:** Sonnet (consistent across all checkpoints)
**Campaign:** tests/benchmark-campaign/
**Date:** 2026-05-02

## How to run

For each query below, dispatch a Sonnet subagent with:
- The query text as the user message
- Access to the skills/ directory (SKILL.md as entry point)
- The benchmark campaign at tests/benchmark-campaign/

Capture per query:
- Input tokens (from usage report)
- Output tokens (from usage report)
- Wall-clock time (from duration_ms)
- Files loaded (list of files the agent read)
- Full response text

## The 12 Queries

| # | System | Type | Query |
|---|--------|------|-------|
| 1 | CoC 7e | Lookup | "What are the CoC 7e Chase rules?" |
| 2 | CoC 7e | Generate | "Create a CoC 7e NPC — a paranoid antiquarian who's seen too much" |
| 3 | CoC Regency | Lookup | "What occupations are available in Regency Cthulhu?" |
| 4 | GURPS 4e | Lookup | "How does the GURPS 4e grappling system work?" |
| 5 | GURPS 4e | Generate | "Build me a GURPS 4e cat burglar, 150 points" |
| 6 | D&D 5e 2024 | Lookup | "What are the Paladin's 2024 class features?" |
| 7 | D&D 5e 2024 | Generate | "Design a Three Clue Rule investigation for my D&D 5e murder mystery" |
| 8 | FitD | Lookup | "How do Fortune Rolls work in Blades in the Dark?" |
| 9 | FitD | Generate | "Create a FitD score opportunity against the Billhooks faction" |
| 10 | Generic | Generate | "I need to improvise a suspicious NPC for an investigation scene right now" |
| 11 | Cross-system | Framework | "Explain the Universal Faction Turn procedure" |
| 12 | Session workflow | Workflow | "Run session prep for Session 4 of my campaign" |

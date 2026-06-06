# Content Fidelity Benchmark — Summary

**Date:** 2026-06-06
**Branch:** `content-fidelity` (vs `main` instruction text)
**Model:** Opus 4.8 (1M) — both A/B arms, held constant
**Method:** Each scenario runs two agents on an identical fixture, differing
ONLY in the instruction text (OLD = `main` / v1.7.0, NEW = this branch). Agents
were framed as ordinary skill executions with no mention of preservation,
fidelity, or that a test was running — so the OLD arm had no reason to behave
differently than it would in production. Scoring done by the orchestrator from
the written outputs, not self-reported.

## Results

| Scenario | Metric | OLD | NEW | Verdict |
|---|---|---|---|---|
| Relocation (midwife plan promotion) | body prose preserved verbatim | 100% | 100% | tie — bug did **not** reproduce on 4.8 |
| Dissect (campaign-organizer extract) | body prose preserved verbatim | **0%** (all 3 entities reworded/condensed) | **100%** (all 3 verbatim) | **fix works — bug reproduced & eliminated** |
| Authoring (session-wrapup recap) | full prose generated (not pasted shorthand) | yes (3/3) | yes (3/3) | regression PASS — NEW still authors |
| Authoring (session-wrapup recap) | fidelity to notes (no invention) | embellished | tighter to source | NEW more faithful, quality comparable |
| Compaction round-trip (the-midwife) | rationale "why" surviving compaction | n/a | 100% (4/4 phrases) | **guard works — why not stripped** |

## Per-agent metrics (stamped from agent metadata)

| Agent | Tokens | Wall clock (ms) |
|---|---|---|
| relocation OLD | 21,267 | 12,247 |
| relocation NEW | 21,569 | 14,238 |
| dissect OLD | 21,750 | 15,005 |
| dissect NEW | 22,028 | 19,406 |
| authoring OLD | 21,977 | 29,750 |
| authoring NEW | 21,902 | 26,316 |
| compaction round-trip | 32,503 | 177,362 |

## Objective checks (grep-verified)

- Dissect OLD dropped source phrases "did not come back" (→ "did not return")
  and "will be courteous" (→ "is courteous"): 0/0 present. NEW kept both: 1/1.
- Relocation: the planted clue ("brown ink that stains Aldous['s cuff]") survived
  in BOTH arms: 1/1 each.
- Compaction: "Preserve the body prose verbatim" [1], "does not re-author it" [1],
  "rationale: `shared/content-fidelity.md`" [2], "block/seam test" [1] all present
  after compaction.

## Reading of the result (honest)

The rewriting failure **tracks the instruction text**, not the model's mood:

- Where the OLD instruction licensed condensing — Dissect literally said
  "body summary" — 4.8 condensed and re-voiced every entity. The fix (kill
  "body summary"; require the verbatim source slice) eliminated it: 100% verbatim.
- Where the OLD instruction already said "preserve the full narrative content"
  (midwife promotion), 4.8 already preserved, so the NEW text changed nothing on
  this model/run. The original reported bug did **not** reproduce here on 4.8.
- The authoring carve-out did its job in both directions: NEW still wrote a full
  dramatic recap (it did not collapse into pasted shorthand), and it stayed
  closer to the notes than OLD, which added invented flourishes.
- The compactor guard held: the new "why" text was classified as Rationale and
  preserved, not stripped as connective tissue.

**Caveat, stated plainly:** this is a single run per scenario on one model. The
strongest evidence is the Dissect site (clear reproduce-and-fix) and the
compaction guard. The midwife-promotion site showed no behavioral change on 4.8
because the old wording already said "preserve" — the NEW wording hardens that
site against weaker models and messier inputs, but this run does not prove a
difference there. A 4.6 rerun, or a messier/longer source, would test that.

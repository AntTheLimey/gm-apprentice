# Why the numbers came out

Date: 2026-10-17. A record of a reversal: from its first version in April
2026 the ttrpg-expert skill carried spotlight percentages and thresholds,
and a test that month seemed to prove they helped. In October they were
taken out. Both decisions were reasonable on what was known at the time.
This note explains what changed, so the reasoning is not lost and the
numbers do not creep back.

## What went in, and why it looked right

The thresholds were there from the start: the first ttrpg-expert commit
(8df1428d, 2026-04-04) already flagged a PC with "less than 15% of
spotlight time" and one "without a high-impact touchpoint for 3+
sessions".

Two days later, a benchmark compared answers with and without the skill
(`tests/quick-commands/benchmark-2026-04-06.md`). Its spotlight question
was open: one PC had been in six scenes and another in two, so what
should the GM do? The two answers it compared:

- "Give underserved PCs more scenes." (no skill)
- "Delgado is below the 15% floor, assign B-plot." (with the skill)

The second scored six points higher, and the evaluator praised its
"measurable criteria (15% floor, 15-20 minute timer, three-session
threshold)". The lesson written into `docs/testing-methodology.md` was
"named frameworks with thresholds produce dramatically better output". A
compaction test the same day (a802c270) then kept the line "Flag below
15% floor. Assign B/C plots to underserved PCs" through a cut to save
tokens. On 2026-04-22 `arc-spotlight-reference.md` gathered the full set:
A/B/C plot shares of 50-60%, 25-35% and 10-15%, a 15% floor per session,
"three or more sessions" of imbalance that "demands immediate corrective
action", and no PC going three sessions without a high-impact touchpoint.

## What was wrong with it

Nothing was wrong with the measurement. It measured the wrong thing.

1. **The rubric paid for a number, and a later test asked for it
   outright.** The scoring rubric's "Mechanical grounding" row gives full
   marks for "specific stats, DCs, costs, rolls, thresholds", which is
   right for a stat block and wrong for spotlight. So an answer that cited
   a 15% floor scored as "grounded" even though the floor was made up.
   Two weeks later, session-prep benchmark question Q8 (2026-04-21) baked
   the floor into the question itself: "Flag any PC below the 15% floor."
   The benchmarks showed that the skill applied its own rule. They could
   not show that the rule made a better night at the table.

2. **Numbers nobody can measure get made up.** No one at a table can tell
   a 30% B-plot from a 20% one. The model was asked to estimate a "share"
   for each PC in every plan, then the next prep read those estimates
   back as if they were data (`session_context.py --arcs` printed
   "Session 6: B (30%)"). The precision was invented, and then trusted.

3. **A number turns a habit into a quota.** "No PC should go three sessions
   without a high-impact touchpoint" makes every plan schedule big moments
   on a timer, whether or not the story wants one. "Demands immediate
   corrective action" overrules the GM's own sense that an arc is resting
   on purpose. The skills also said "evidence for the GM's call, not the
   call", and the numbers contradicted it.

4. **An average hides a bad night.** Balance "over a run of sessions" is
   the GM's view from above. A player lives through one evening at a
   time. Ant's ruling: each session has to be enjoyable for the players on
   its own; balance over time does not matter if they are not enjoying
   every night. A percentage averaged across sessions can look healthy
   while one player sat through a whole evening with nothing that touched
   them.

## What replaced it

The useful part of the April lesson was kept: concrete beats vague. "Give
underserved PCs more scenes" is weak advice, and the replacement is not
vaguer. It is one concrete rule, the right one:

**Every PC at the table gets a moment every session where they are
involved.** Its size varies; whether there is one does not. An absent
player's PC is still hand-waved.

Everything else about spotlight became "notice and ask": say who has had
little lately, offer options, and let the GM decide. The A/B/C words
stayed as vocabulary; the percentages, the 15% floor, the three-session
timer and the "share" column went. The text the model reads got shorter
(1,187 bytes less across six files), because the reasons now live here
and in the commit, not in the skill.

## The same mistake, three times

This was not a one-off. The same shape turned up three times in 2026:

| When | What was prescribed | What showed it was wrong |
|------|---------------------|--------------------------|
| September | Every scene in a session plan had to carry seven labelled parts, checked as errors | Run against a real plan Ant had already run a game from, it raised nine errors, seven against a short routing scene. Research found no tradition that prescribes a fixed scene shape (`docs/scene-design-research.md`). Now only Situation and Starts it are required. |
| October | A clue-paths check: count clues per conclusion and flag fewer than three | Ant: "it's not just about the mechanics, but about the freedom of storytelling." Clues come out of play, and at the table the GM is the redundancy. Dropped before it shipped. |
| October | Counters for "stale threads", "Chekhov age", "threads gaining traction" and a spotlight script | A thread lying unused is not overdue. Struck from the roadmap, and the same deadlines ("must fire or be explicitly retired", 3-5 and 5+ sessions) came out of the skill text. |

Each time, a rule of thumb about storytelling had been turned into a
number, a check or a required shape, and each time it pushed the GM
toward one fixed way of running a game.

## The test to apply from now on

A number or a check belongs in the skills when it is one of these:

- **Bookkeeping the code can count from the vault**: a broken link, a
  missing field, a session status, a request still pending. These are
  facts, and code should own them.
- **A hard line the GM chose**: "every PC gets a moment every session".
  These are concrete because the GM made them so.

It does not belong when it is a craft rule of thumb written as a target,
and above all when the model would have to estimate the number to apply
it. Those stay as things to notice and ask about.

And when a test says a rule helped, check first whether the test asked
for that rule.

## Where this is recorded

- `docs/testing-methodology.md`, lesson 3, notes the 15% floor is retired.
- Benchmark Q8 now asks for a moment for every PC instead of a 15% check.
- The spotlight walkthrough Ant approved:
  <https://claude.ai/artifact/EQ7v54xz6W5BUPrE8YUwVt>
- ROADMAP's Slice D row records the struck counters and why.

## Thread Tidy

Closes threads a later note says are over, moves word-for-word duplicates
to the shared list, and reports both. It asks the GM about nothing else.

A thread is an open question or obligation. Shared threads live under the
Campaign Overview's `## Open Threads`; each PC's own sit under their
`**Open threads:**`. A closed thread is never deleted: it moves to a
Wrap-Up's `#### Resolved Threads` with its evidence.

**Procedure:**

1. Run `gma session-context <vault> --threads`. It lists the shared
   threads, each PC's own, and Wrap-Up threads on no list.
2. For each thread, read the notes after it was first seen (recaps,
   Wrap-Ups, the PC's Story, the timeline) for a line that ends it.
   - **Ended:** the note says so ("Sophia's note is read", "delivered and
     paid"). Close it, that line quoted as evidence.
   - **Implied:** the note suggests an end but doesn't say it ("he's in
     custody"). Leave it open.
   - **Dormant:** nothing new. Leave it open; age is not an ending.
   - **Not a thread:** where play stopped, or an event that happened.
     Close it with evidence `not a thread: where play stopped in Session N`
     or `not a thread: an event, in the Session N recap`. The text itself
     shows it, so no other line is needed.
3. Duplicates: the same thread on two or more PCs. Word for word: a
   `move` row (it refuses wordings that differ). In other words: list
   them in the report as near-duplicates for the GM. Never merge
   differing wordings.
4. One call for every row of the run, against the latest Wrap-Up:
   `gma vault-write <vault> threads --wrapup "<latest wrap-up>"` with the
   `close` and `move` rows on stdin. Read the preview, then run it again
   with `--write`.
5. Report: `gma vault-check <vault> report-new --mode thread_tidy --scope
   full_vault`. List every close with its evidence, every move with the
   PCs it involves, and the near-duplicates.

Severity: **Info**. Each change is already made; the report is the record.

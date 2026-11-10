# gma session-context

Use it at the start of session-prep, play or wrap-up to read the standard context in one call instead of opening the files one by one. It needs the vault and one mode (`--prep`, `--play`, `--brief`, `--carry` and so on); it reads only.

<!-- BEGIN GENERATED: gma session-context -->
Session-prep context bundle in one call.

```text
gma session-context <vault> [options]
```

| Argument | Value | Help |
|---|---|---|
| `<vault>` |  | the vault folder |
| `--session` | `SESSION` | just-played session number (default: highest); with --play, the session whose Plan to print |
| `--play` |  | print only the upcoming (or --session) Play Brief |
| `--threads` |  | print the Session Context header and Threads report only: each active PC's Open threads aged against the Wrap-Ups' Unresolved Threads and PC Carry-Forward bullets, then the Campaign Overview's whole Dormant Threads list, age=N sessions since last touched, STALE at the vault's stale-after number (vault.stale_after_sessions; a candidate, not a verdict — resolve, advance, or retire is the GM's call). A thread read as first~N age~N (~ instead of =) is a likely match by shared names and words, not the same text: check it |
| `--dormant` |  | print the Session Context header and the Campaign Overview's Dormant Threads only: threads parked when the party left a place or arc |
| `--arcs` |  | print the Session Context header and the PC Arcs report only: each active PC's ## Background and ## GM Notes sections (the durable arc material the bundle does not carry — ## Current Status is already in the bundle and is not repeated) plus a chapter-scoped spotlight history parsed from every earlier Plan's ## Spotlight Forecast table (role A/B/C from the row text) with sessions since the PC last carried the B- and C-plot. A forecast section is one of three states: absent, present but prose (listed once for direct reading — no per-PC row, and not counted in the 'plans read' denominator), or a table. Arc stage is not a field: judge it against the five-stage model from this evidence. |
| `--prep` |  | a prep run's opening read in one call: the version verdict, the --brief bundle, the reconcile scan (status wrap-up only), --threads (its dormant part only the threads that may wake: their names are in the Wrap-Up or the upcoming Plan), --arcs (each PC's Background and GM Notes as one line with its size and fetch path; deferred world flags likewise, under each flag's first line), the chapter's scene queue and its narrative plans checked against the NPCs, locations and factions the Wrap-Up links, then a Map: the path and size of every note the Wrap-Up and the upcoming Plan link, and of the latest sessions' notes |
| `--carry` |  | print only what the previous Wrap-Up carries forward: its Handoff to session-prep, Unresolved Threads, Player-Stated Intentions, Pending Consequences and open Keeper Checklist items. Runs on a vault kept by a player too. |
| `--before` | `INDEX` | with --carry: the session being wrapped (its index, vault-relative); the Wrap-Up read is the one before it in chapter and session order. Default: the latest Wrap-Up. |
| `--brief` |  | default mode only: Wrap-Up with the reconcile-provenance blocks stubbed (Memorable Moments; Name Conflicts, Cross-Entity Claims, World Fact Findings, Quality Notes — heading kept, body replaced by a one-line stub with its word count), and the Campaign Overview and the existing Session Plan each as frontmatter plus a heading outline with word counts. Everything else unchanged. Drill into a file only where a stub or outline shows the need — for the Plan that means `gma plan-check` with `--inventory` or `--state`, not a full read. |

Example: `gma session-context "<vault>" --prep`
<!-- END GENERATED -->

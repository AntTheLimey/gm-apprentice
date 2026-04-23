# CLAUDE.md — gm-apprentice

Context for Claude sessions working in this repository.

## What this is

A Claude Code plugin marketplace at `AntTheLimey/gm-apprentice` containing
seven TTRPG Game Master skills:

- `ttrpg-expert` — rules, content generation, session planning
- `campaign-organizer` — vault structure, knowledge graph metadata
- `campaign-qa` — canon auditing, graph health checks
- `session-prep` — between-session preparation and reconciliation
- `session-play` — at-the-table GM support (speed-optimised)
- `session-wrapup` — post-session processing, entity creation, recaps
- `vault-ingest` — ingestion of old campaign materials into the vault

Supported systems: CoC 7e (+ Regency Cthulhu variant), GURPS 4e, FitD,
D&D 5e 2024.

---

## ⚠️ Copyright compliance — read before touching any system content

This repository redistributes TTRPG content under multiple licenses.
**Misusing licensed content exposes the project to takedown requests and
puts the author at personal legal risk.** Every Claude session working in
this repo must treat copyright compliance as the highest-priority rule,
above all other conventions.

### The licenses in play

| System | License | What's allowed |
|--------|---------|----------------|
| CoC 7e / BRP | [BRP ORC License](https://www.chaosium.com/orclicense) | Mechanics, stat blocks, generic content. No proprietary Chaosium IP (Arkham, Lovecraft Country NPCs, published adventures, flavour text) |
| D&D 5e (2024) | [CC-BY 4.0 SRD](https://dnd.wizards.com/resources/systems-reference-document) | Anything in the 5.2 SRD with attribution. No content outside the SRD |
| FitD | [CC-BY 3.0](https://bladesinthedark.com/about-the-dark) | Blades in the Dark rules with attribution. No Deep Cuts, no publisher-specific content |
| GURPS 4e | [SJG Online Policy](http://www.sjgames.com/general/online_policy.html) | **Names, point costs, short notes only.** No full rule text, no full character builds, no tables reproduced verbatim |

**Full license texts and attribution requirements live in `ATTRIBUTION.md`.
Read it before adding any content derived from a published source.**

### Hard rules

1. **Never reproduce rule text verbatim** from any system's core book
   unless the SRD or ORC license explicitly covers it. Paraphrase
   mechanics in your own words, or cite short quoted fragments.

2. **GURPS is the strictest** — SJG Online Policy only permits "names,
   point costs, short notes" in free fan aids. This means:
   - ✅ `Broadsword [8 pts] — Swing weapon, Reach 1`
   - ❌ Full advantage/skill descriptions copied from Basic Set
   - ❌ Long tables of weapon stats reproduced wholesale
   - If in doubt, summarize and cite the page reference — don't transcribe

3. **Update `ATTRIBUTION.md` in the same commit** as any licensed-content
   addition. Every new file sourced from a licensed document needs a
   line item recording where it came from, what license applies, and
   what was done to it.

4. **When in doubt, ask the user.** Do not guess at what's permissible.
   Copyright mistakes are not cheap to fix — an unclear commit may need
   to be reverted, the content rewritten, and the history rewritten.

5. **Personal reference files are gitignored** under
   `skills/ttrpg-expert/systems/*/personal/`. These are the user's local
   working copies of full rulebooks. **Never commit files from these
   directories** — they're private and licensed for personal use only.

### When generating new content

- Original content you write from scratch is fine and desirable
- Mechanics summaries in your own words are fine
- Pointing users at page references in their own books is fine
- Copying and pasting more than a sentence or two from a source is not fine
- Adding a new licensed source? Add its license to `ATTRIBUTION.md` first

---

## Repository structure

- `skills/` — one directory per skill (`SKILL.md` + `references/`)
- `docs/` — user-facing documentation
- `tests/` — schema validation, benchmark infrastructure, compaction tests
- `scripts/` — utility scripts (not user-facing)
- `tools/` — standalone tools (e.g., future `tools/publish/` npm package)
- `.claude-plugin/` — plugin metadata (`plugin.json`, `marketplace.json`)
- `ATTRIBUTION.md` — copyright compliance records (authoritative)
- `README.md` — installation and overview
- `ROADMAP.md` — force-ranked backlog (see workflow below)

Note: `.claude/` is gitignored (local Claude Code settings and worktrees).
`docs/superpowers/` and `docs/plans/` are gitignored (local specs and plans).
`skills/ttrpg-expert/systems/*/personal/` are gitignored (user's private
licensed reference files — see copyright rules above).

## Roadmap workflow

**Before planning new work**, read `ROADMAP.md` to check current priorities
and see if the work is already listed.

**If work isn't listed but should be**, add it using the formula:

```text
Score = (Impact × 2 + Urgency) / Effort
```

Keep the list sorted by score (highest first).

**When completing work**, strike through the item with `~~` on both sides
and move it to the "Completed" section with a PR number or commit SHA.

## Commit conventions

- **Never add `Co-Authored-By` trailers** to commits
- **Never mention Claude, AI, or LLM tools** in commit messages or PR bodies
- Match existing commit style — terse, sentence-case, no conventional-commits
  prefixes
- Prefer small, focused commits over batched changes

## Skill edits

- **Use Opus** (not Sonnet/Haiku) for any skill file modifications
- **Run `skill-creator` validation** before committing skill changes
- `SKILL.md` is the routing layer — keep it concise
- Detailed content belongs in `skills/*/references/`

## Testing

- Schema validation: `python3 scripts/validate_schema.py`
- Benchmarks live in `tests/benchmark-campaign/` and `tests/benchmark-questions/`
  — do not delete these
- One benchmark run is enough; fix issues before benchmarking; use A/B
  comparisons rather than absolute scores

## Key documentation

- `README.md` — installation, supported systems, high-level overview
- `ATTRIBUTION.md` — copyright licenses and compliance records
- `docs/quickstart.md` — first-campaign setup walkthrough
- `docs/campaign-organizer.md` — vault schema and knowledge graph
- `docs/file-format-standards.md` — frontmatter and markdown conventions
- `docs/testing-methodology.md` — how to run and interpret tests
- `docs/campaign-lifecycle.md` — campaign management across sessions

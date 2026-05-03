---
query: "Run session prep for Session 4 of my campaign"
system: workflow
type: session-prep
total_tokens: 0
wall_clock_ms: 0
files_loaded:
  - tests/proof-runs/baseline-skills/session-prep/SKILL.md
  - tests/proof-runs/baseline-skills/session-prep/references/session-templates.md
  - tests/proof-runs/baseline-skills/shared/session-principles.md
  - tests/proof-runs/baseline-skills/shared/session-document-chain.md
  - tests/proof-runs/baseline-skills/shared/reconcile.md
  - tests/proof-runs/baseline-skills/shared/migrations.md
  - tests/proof-runs/baseline-skills/ttrpg-expert/arc-spotlight-reference.md
  - tests/proof-runs/baseline-skills/ttrpg-expert/continuity-engine.md
  - tests/benchmark-campaign/_meta/index.md
  - tests/benchmark-campaign/Chapters/Chapter 1/Sessions/Session 03 - The Inner Sanctum.md
  - tests/benchmark-campaign/Chapters/Chapter 1/Sessions/Session 03 - The Inner Sanctum - Plan.md
  - tests/benchmark-campaign/Chapters/Chapter 1/Sessions/Session 02 - The Docks at Night - Wrap-Up.md
  - tests/benchmark-campaign/Chapters/Chapter 1/Sessions/Session 01 - The Missing Professor - Wrap-Up.md
  - tests/benchmark-campaign/_Campaign/Player Characters.md
---

# Session Prep — The Ashford Case

## Version Check

The vault's `_meta/` directory exists but contains only `index.md` — no `vault-config.md` with a `gm_apprentice_version` field. The current plugin version is `1.4.9`. This means the vault predates the versioning system and needs a migration before full prep can proceed.

**Migration needed:** The baseline migration (pre-versioning → 1.4.9) should be run. This is a lightweight structural step:
- Add `gm_apprentice_version: "1.4.9"` to `_meta/vault-config.md` (file needs to be created)
- Add `publish.system` field (Call of Cthulhu 7th Edition, confirmed from index)
- Ensure remaining `_meta/` files exist: `entity-types.md`, `relationship-types.md`

I'll flag this but proceed with prep — the structural gaps don't block us from reading the vault or planning Session 4. The migration should be handed off to `campaign-organizer` when prep is complete.

---

## Session Status Check

**Problem: Session 3 hasn't been played yet.**

Checking the session index:

```
Session 03 - The Inner Sanctum
  status: prepped
  play_notes: null
  wrap_up: null
```

The campaign index confirms only three sessions exist (Sessions 1-3), and Session 3's status is `prepped` — there is no Play Notes file and no Wrap-Up file. Session 3 has not been played.

**You asked to prep Session 4, but your group hasn't played Session 3 yet.**

Before I build a Session 4 plan, I need to understand the situation. There are a few possibilities:

**A. Session 3 was played but not documented**
Your group ran The Inner Sanctum but no one wrote up what happened. In this case I can:
- Help you do a quick wrap-up from memory (you tell me what happened, I write it up)
- Or do a minimal "Previously on..." recap from the Session 3 Plan for continuity purposes

**B. You want to run Session 3 with an extended campaign**
Perhaps The Ashford Case is continuing beyond its original 3-session structure — Session 3 was the planned climax but the story isn't finished, and you need Session 3 done before planning Session 4.

**C. The session numbering shifted**
Perhaps what you're calling "Session 4" is a continuation of the original arc — i.e., Session 3 ran over two nights, or there was a between-sessions gap session. In this case, tell me what Session 3 actually covered.

**Recommendation:** If Session 3 was played, the cleanest path is a quick wrap-up now. It takes 10-15 minutes, updates the vault with what actually happened, and gives Session 4 prep a solid foundation. Without it, the vault is frozen at the state before the Inner Sanctum confrontation — no entity updates, no consequence tracking, no confirmed arc changes for the three investigators.

> "Session 3 doesn't have a Wrap-Up file yet. I can generate a quick 'Previously on...' from the Session 3 Plan as a fallback, but the vault won't have been updated — no entity updates for [[Brother Ezra]], [[Professor Ashford]], or [[Inspector Crane]], no timeline entries for the sanctum events, no carry-forward from what your players actually decided. Want me to do a full wrap-up first (recommended), or just the quick recap so we can push forward to Session 4 prep?"

---

## If You Want to Proceed Anyway (Quick Recap Mode)

If you confirm you want to skip wrap-up and go straight to Session 4 prep, here is what I can reconstruct from the Session 3 Plan as a working baseline. **Note: this reflects planned content, not what actually happened at the table.**

### Assumed Session 3 Outcome (from Plan — UNVERIFIED)

Based on the Session 3 Plan, the likely narrative shape of the session was:
- Investigators followed the trail to the [[Order of the Silver Twilight]] Lodge on Harmon Street
- Discovered a ledger reference pointing to [[St Anselm's Church]] as the sanctum location
- Descended through the crypt to the underground chambers (Antechamber → Library → Ritual Chamber)
- Confronted [[Brother Ezra]] and cult members
- Found [[Professor Ashford]] imprisoned adjacent to the library, mentally damaged from translating the Revelations of Glaaki
- Faced a choice: stealth rescue, ritual disruption, direct confrontation, or calling in [[Inspector Crane]]

**The plan does not tell us:**
- Which resolution path the players chose
- Whether Ashford survived and was extracted
- Whether Brother Ezra was defeated, escaped, or fled
- How much SAN the investigators lost in the sanctum
- Whether the ritual was stopped or completed
- Inspector Crane's ultimate allegiance

All of these are major unresolved questions that Session 4's story depends on entirely.

---

## What Happens When You Confirm

Once you tell me either (a) what happened in Session 3, or (b) to proceed with the unverified plan as the baseline, I'll run full Session 4 prep:

**Phase 1: Reconcile** — If Session 3 happened, I'll walk you through a brief reconciliation to capture the actual outcome, then proceed.

**Phase 2: Context Gathering**
- Recap from confirmed Session 3 events
- Active threads (7 open threads going into Session 3, all potentially resolved or transformed)
- Key NPCs — particularly Ashford's condition, Ezra's fate, and Crane's status
- World state — new moon date, whether the ritual was stopped, cult's next move

**Phase 2: Creative Planning**
- PC arcs for all three investigators (Sessions 1-3 complete the Establishment stage for all three; Session 4 begins the Testing stage)
- A/B/C plot assignment
- Touchpoints per PC
- Scene proposals (each pitched for your approval before writing)
- Spotlight forecast

**Phase 2: Verify**
- Agency + canon audit
- Gap check (several NPC vault files are missing — [[Brother Ezra]], [[Professor Ashford]], [[Inspector Crane]], [[Tommy Flanagan]], [[Mrs Whitmore]] all lack individual files)

---

## Immediate Questions for You

1. **Was Session 3 played?** If yes, how did it end? (Even a few bullet points is enough — I'll shape the plan around the actual events.)

2. **Is The Ashford Case continuing as a longer campaign, or is Session 4 a new chapter/scenario?** The original structure was a 3-session case. If the story continues, is this Chapter 1 extended, or are you starting Chapter 2 with new threats or a new investigation?

3. **Any casualties or major SAN changes from Session 3?** The investigators entered Session 3 with:
   - Dr. Eleanor Voss: SAN 52 (lost 3 at the docks)
   - Rev. Silas Marsh: +1 Cthulhu Mythos, SAN 69 (estimated)
   - Mal Bridges: minor injury, SAN intact

4. **Was the ritual stopped?** This is the hinge question for Session 4. If the ritual was completed, whatever was being summoned may now be loose in Kingsport. If it was stopped, the cult's next move is retaliation and rebuilding.

Once I have these answers, I can build a proper Session 4 plan.

---

## Gaps Noted (for later action)

The following vault files are referenced in the campaign index and session notes but don't exist as individual entity files:

**NPCs missing files:**
- [[Brother Ezra]] — primary antagonist, no vault file
- [[Professor Ashford]] — central figure, no vault file
- [[Inspector Crane]] — recurring NPC, no vault file
- [[Mrs Whitmore]] — Ashford's housekeeper, no vault file
- [[Tommy Flanagan]] — informant contact, no vault file

**Locations missing files:**
- [[Kingsport Docks]] — used in Session 2, no vault file
- [[Ashford Study]] — used in Session 1, no vault file
- St Anselm's Church — referenced in wrap-ups, no vault file, not wiki-linked

**Clues/Items missing files:**
- [[Coded Letter]] — no vault file
- [[Strange Symbol]] — no vault file
- [[Witness Statement]] — no vault file
- Stone tablets recovered from the docks — not formally filed

**Structural:**
- `_meta/vault-config.md` — missing (needed for version tracking and system config)
- `_meta/entity-types.md` — missing
- `_meta/relationship-types.md` — missing

Handoff recommendation after Session 4 prep completes:
- Entity stubs → `campaign-organizer` (Dissect mode from the existing session notes)
- Migration → `campaign-organizer` (baseline migration procedure)
- Structure audit → `campaign-qa`

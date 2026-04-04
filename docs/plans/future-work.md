# gm-apprentice Future Work

Backlog of ideas and planned work identified during
brainstorming sessions. Items move out of here when they
get their own spec and implementation plan.

## Phase 5: Per-System Content Knowledgebases

Enrich each system subfolder with non-rules SRD content
using multiple topic files (option B from brainstorming).

Per system, as applicable:
- `monsters.md` / `creatures.md`
- `spells.md`
- `magic-items.md`
- `setting.md` (Doskvol for FitD, etc.)
- `factions.md`
- Other system-specific topics

Source from SRDs where available (CC-BY 4.0 for D&D,
CC-BY 3.0 for FitD, ORC for BRP). For GURPS, generated
from user's GCA data via connector.

## Phase 5+: Additional Connectors

- **PDF-to-markdown converter** for CoC rulebooks and
  other systems without structured data files
- **Auto-download of freely available SRDs** on first
  setup (D&D SRD 5.2 from GitHub, FitD SRD, BRP ORC
  Content Document)
- **Connector for new game systems** as they're added

## Unfinished from Earlier Phases

- campaign-qa and session-lifecycle could potentially
  get filesystem fallbacks similar to campaign-organizer
  (lower priority — campaign-organizer was the most
  impactful)

## Ideas Under Consideration

- Character sheet templates per system (see Phase 4 spec —
  included there)
- GCA `.gcs` sheet template parsing (character sheet
  formats from GCA4's sheets/ directory)
- skill-creator description optimization loop for all
  four skills
- Eval suite for each skill (beyond the campaign-organizer
  evals already done)

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.9.0] — 2026-07-21

Graduates the mobRPG integration CLI (`docs/prototypes/mobrpg/`) into the repo:
the legacy crosswalk is fully excised in favour of per-note `mobrpg:` nodes, and
two new verbs — `adopt` (establish nodes by live name-match) and `auth` (managed,
cross-platform credentials) — complete the sync surface.

### Added

- **`mobrpg auth` verb** — managed credential setup replacing the hand-managed
  `credentials.csv` + `MOBRPG_TOKEN` dance. `import <credentials.csv>` verifies a
  website-issued token via `whoami` and stores it in a user-level config
  (`~/.config/mobrpg` on POSIX, `%APPDATA%\mobrpg` on Windows, `0600` on POSIX);
  `status`, `refresh`, and `logout` manage it. Tokens are never printed. New
  `mobrpg/config.py` store and a portable `skill/references/auth-setup.md`
  (one-URL download preferred, manual CSV fallback).
- **`mobrpg adopt` verb** — stamps `mobrpg:` nodes onto unlinked notes by matching
  them to live mobRPG elements by normalized name (aliases included); one match is
  accepted with the real `element_id`, ambiguous/unmatched are reported never
  guessed. A dup-safe replacement for the retired crosswalk/backfill flow.

### Changed

- **README + Quickstart overhaul.** README leads with Installation, the skill
  list, and an inline Quickstart; the long Obsidian setup walkthrough is
  condensed to a short Vaults note. The Quickstart is rewritten to start from
  the-midwife (which scaffolds the vault) and flow through ttrpg-expert →
  session-prep → session-play → session-wrapup, with campaign-organizer/qa
  reframed as as-needed upkeep. Both now list all five systems (Pathfinder 2e
  was missing) and drop the redundant install/pick-system/Obsidian steps.
- **`client.get_access_token()` precedence** — `MOBRPG_TOKEN` env still wins, then
  the managed config, then `MOBRPG_EMAIL`/`MOBRPG_PASSWORD`, else a helpful error.

### Removed

- **Legacy crosswalk** — the `backfill`/`sync` verbs, all `--crosswalk` inputs, and
  the packaged `canticle-regency-crosswalk.json`. Ids resolve only from `mobrpg:`
  nodes; `images` derives its id→file map from nodes.

### Fixed

- **mobRPG containment edge direction** — `suggest` now emits spatial containment
  relations (`part_of`/`located_at`/`headquartered_at`) container-first to match
  mobRPG's `Link` convention, instead of subordinate-first (which landed
  `planet part_of system` as "planet is the system's parent"). The reversed-
  predicate set is derived from the ontology (asymmetric `Link` predicates).
- **Credential CSV gitignore gap** — `credentials*.csv` is now ignored in the
  prototype so a stray token file can never be committed. Untracked stale run
  artifacts (`*_out/`, `space_vault_preview/`, `space_extract.json`).

---

## [1.8.41] — 2026-07-21

Ports the mobRPG node schema into the shipped entity schema and settles the
`mobrpg:` node as the single source of truth for mobRPG sync — the sidecar
crosswalk is retired.

### Added

- **`mobrpg:` node schema** documented in `skills/shared/entity-schema.md`: the
  machine-managed, regenerable sync ledger the `mobrpg` CLI writes for entities
  synced to a mobRPG world (identity anchors, `review_state`, `content_hash`,
  `determined` classifiers, reified-Event relationship ids). Never
  hand-authored; top-line frontmatter stays the source of truth. Registered as
  a `1.8.40 → 1.8.41` migration.

### Changed

- **mobRPG CLI (`docs/prototypes/mobrpg/`) resolves all element/event ids from
  the vault's own `mobrpg:` nodes** — the sole source of truth. `suggest` drops
  `--crosswalk` and the packaged default; `images` derives its id→file map from
  nodes.

### Removed

- **The legacy sidecar crosswalk and every path that read it.** Removed the
  `backfill` and `sync` verbs, the packaged `canticle-regency-crosswalk.json`,
  and all `--crosswalk` inputs. The hand-vendored crosswalks had drifted (wrong
  ids/kinds/paths) and were never tied to the ontology; nodes replace them.

## [1.8.40] — 2026-07-21

Publish tool 1.11.15. Documents index grouped by character (#96).

### Added

- The **Documents** section index now groups handouts into headed sections, one per character the document concerns — mirroring the Factions/Locations grouped-listing pattern instead of falling through to a flat A–Z card grid. The grouping key is frontmatter `about` (narrative handouts) or `practitioner` (mechanical/reference cards), resolved from a `[[wiki-link]]` to a plain name; documents with neither land in a trailing **Other Documents** group. Character groups sort alphabetically, "Other" always last, cards alphabetical within a group. Reuses the existing `intel-section`/`card-grid` styling, so no CSS changes (#96).
- `documents` section-title key for the genre presets — scifi "Files & Dossiers", military "Dossiers & Records", horror "Documents & Evidence", fantasy "Records & Correspondence" — with an explicit `section_titles.documents` override winning over the genre default (#96).

### Fixed

- Grouped index filtering: when the name filter hides every card in a group, the group's heading now collapses too instead of lingering over an empty grid (#96).

The relationship-ontology cluster: land the ontology, enforce it, author against it.

### Added

- `skills/shared/gm-apprentice-ontology.json` — the reconciled relationship-ontology export (77 predicates + the mobRPG projection: `mobrpg_event_type` and `mobrpg_relation_type`), landed on main from the previously-gitignored prototype directory. `entity-schema.md` is the authoritative vocabulary; this export is generated from it (#124).
- `scripts/validate_ontology.py`, wired into CI — fails the build if the predicate set in `entity-schema.md` and the ontology export ever diverge, or if a predicate's mobRPG mapping falls outside the declared enums. This is the drift check the three-copies problem needed (#123).
- `skills/shared/relationship-normalization.md` — one narrative-verb → sanctioned-predicate and inverse-normalization table (`owned_by A→B` ⇒ `owns B→A`), shared by the skills that write relationship edges and the QA pass that repairs them.

- Relationship-writing skills now author `type:` from the controlled vocabulary instead of freeform-inventing predicates (which left ~a third of a real vault's edges off-ontology and pushed junk Generic nodes to mobRPG): session-wrapup, session-play, the-midwife handoff, and campaign-organizer's repair path all point at `_meta/relationship-types.md` + the normalization map (#120).
- campaign-qa graph-health gains a strict **vocabulary-conformance** check — off-vocabulary, inverse-stored (wrong-direction), blank/malformed, and non-entity-target edges — separate from the existing vagueness/duplication checks (#120, #123).
- `entity-schema.md` now documents the authority relationship (schema is the source of truth; the JSON export is generated) and resolves the Sequencing question. Narrative sequencing is not a relationship predicate — it is **node-based flow** (Alexandrian node design / Twine's passage graph), modelled as a **`leads_to` frontmatter field** (an array of wiki-links; two or more targets is a branch). The Clue type already carried `leads_to`; this adds the same field to the **Plan** type (schema, `plan.md` template, `validate_schema.py`, and a migration converting legacy `precedes`/`alternative_to`/`leads_to` sequencing edges onto it). session-prep reads it to find the next plan node(s)/branches. `precedes` folds into `leads_to`; `alternative_to` is emergent from multiple targets — neither is a predicate or a field.

---

## [1.8.38] — 2026-07-20

Publish tool 1.11.14. A publish-site bug-sweep.

### Fixed

- Inbox CLI crashed the whole `inbox pull` on any absent/orphaned KV key: wrangler's missing-key 404 embeds the REST endpoint URL (`.../storage/kv/namespaces/<id>/values/<key>`), and the `namespaces` substring tripped the `namespace` operational signal, so every missing key threw instead of returning `null`. A single TTL-reaped or orphaned `config:req-index` id then took down the entire at-table request queue. The error is now classified on the human-readable prose only (URLs stripped first), and a regression test covers the missing-key-404 case (#118).
- GURPS PC renderer: the Ranged Attacks table now surfaces the current skill level the way Melee does — the trailing to-hit number is wrapped in `<span class="wp-tohit">` and each row carries `data-weapon-key`, and `buildWeapons` feeds ranged weapons into the live to-hit map (parry stays `null` for them). Ranged to-hit was previously inert on every sheet; no client change was needed (#119).
- A played session/chapter present in the vault but absent from `_meta/publish-manifest.md` silently never published (the manifest is an allowlist and session-wrapup never registers the files it writes), so the landing "Latest Session" block pointed at the previous session while showing the new date. The build now warns on a `session`/`session_wrap`/`chapter` file that is in neither the manifest's Publishing nor Excluded list — the manifest parser now also reads the Excluded section, so a deliberate exclusion is not mistaken for an oversight (#101).
- GURPS Load-Outs: the `### Load-Outs` feature had no PC-template guidance and no migration, so legacy sheets used ad-hoc equipment sections that silently rendered nothing. Documented a worked `### Load-Outs` example in `pc-gurps-4e.md`, added a migration to detect and convert/flag legacy equipment sections, and hardened the load-out-name parser so bold inside a table cell can no longer be read as a load-out name (#106).
- CoC investigator sheet: a legacy sheet whose body structure diverges from the documented contract parsed to a near-empty model and rendered mostly blank with no signal. The build now warns when a CoC PC parses no characteristics, and a migration detects divergent sheets to convert or flag (#107).

### Added

- Scene skeleton gains a **Behaviours** field — what the situation and its NPCs do on their own, independent of the players, and how it escalates if the PCs do nothing ("what happens here if they never show up?"). This is the load-bearing element of situation-based design that our operational scene template had distilled away: the reference layer already taught it (Sly Flourish's situation checklist, the Alexandrian's proactive nodes, PbtA Fronts' clocks — all attributed), but the `## Planned Scenes` skeleton the GM fills in only captured how a scene opens (Slice A's situation objective + named initiator) and how players branch, never the engine that runs regardless of player choice. It is the durable form of the failure report's RC1 fix ("an engine that runs entirely on NPC behaviour and survives any player choice"). Added to the `## Planned Scenes` skeleton and the standalone scene-note template in `session-prep/references/session-templates.md`, and as a craft rule in session-prep step 14.
- Scene skeleton also gains a **Complications** field — the 2–3 curveballs a GM holds ready to spike tension (a rival arrives, a PC is recognised, the timer is discovered), distinct from Behaviours (the situation's default motion) and Branching (the players' own choices). The standalone scene-note template already had a `## Complications` section; the operative `## Planned Scenes` skeleton did not, so it only half-carried Sly Flourish's five-field situation checklist (Location · Inhabitants · Behaviours · Goal · Complications). Together with Behaviours this completes that mapping in the skeleton the GM actually fills.
- No new sources for either field — Sly Flourish, The Alexandrian, and Fronts (Apocalypse World) are all already in `ATTRIBUTION.md`.

---

## [1.8.36] — 2026-07-19

### Changed

- Session-plan quality guardrails (failure-report Slice C, reframed): the failure report's RC5 (a table-note claim laundered into an AUTHORITATIVE file) and RC6 (a plan trusting its own stale PC-state snapshot) are one problem — the plan mints a private copy of authority and then trusts the copy. The fix is single-source-of-truth plus one human checkpoint, not perpetual re-verification. session-prep step 12 no longer re-reads each PC's `## Current Status` (already carried by the `session_context.py` bundle; the durable arc/backstory data still gets a targeted read) and now writes `## PC Roster & Arcs` by **reference, not copy** — mutable state points at the PC's live `## Current Status` instead of transcribing a snapshot that goes stale. session-wrapup gains a **cross-entity claim checkpoint**: an incidental aside in table shorthand about a *different* existing entity is surfaced for a one-time GM confirm or marked `<!-- UNVERIFIED -->` (which `reconcile` already gates on), rather than silently folded into that entity's file. Recommendations 7, 8, and 10 as originally written are withdrawn (re-read/distrust is a token sink and does not catch an error that lives inside an authoritative source). Edits in `session-prep` and `session-wrapup`.

---

## [1.8.35] — 2026-07-19

### Changed

- session-prep now draws the session out of the GM instead of generating it: a new up-front Session Intent step, an elicited Intent → Spotlight → Scenes sequence (seeds to react to, propose-before-write at the premise, not the finished scene), and a stance preamble transplanted from the-midwife ("spark, shape, refine, never decide for them").
- session-prep's Verify half is now assistance, not enforcement — the apprentice silently fixes table pipes, offers a clock for multi-day plans, and raises only real read-aloud issues conversationally; the GM never sees an ERROR/WARNING report.
- Scene length is now earn-your-length with a soft ~1,200-word bloat nudge, replacing the fixed 400-600-word per-scene cap (`scenario-writing.md`, session-prep step 15). Preamble (~1,000-word) and recap (≤150-word) caps stay.
- `vault_check.py` gains `tables`, `timeline`, and `read-aloud` checks reworked for the assistance model: `timeline` is an INFO cue (offer to build a clock), and the high-precision read-aloud blockquote signal replaces the dropped noisy plan-wide agency PC-subject scan.

### Added

- `## Session Intent` and `## Open Questions` sections in the session-plan template; a hard guard so headless / "just do it" runs cannot silently produce a creative spine (they stop-and-ask or file the spine under Open Questions marked apprentice-guessed); and a light resumable-prep marker so interrupted weekly prep resumes without re-asking.

---

## [1.8.34] — 2026-07-19

### Changed

- Session-plan quality guardrails (failure-report Slice A): scene objectives are now framed as situations rather than authorial theses, and every scene must name the NPC or schedule that initiates it ("why would this PC go there"); added a 400-600-word per-scene budget and a ~1,000-word preamble cap enforced by the session-prep audit; banned self-documentation (edit-history notes) in session plans; reframed the player-agency rule as scene engineering (a PC-predicted engine is fragile) alongside the ethics framing; and made "no pipe inside a markdown table cell" a hard formatting rule. Edits in `session-prep`, `ttrpg-expert` (`scenario-writing.md`, `continuity-engine.md`), `shared/session-principles.md`, and `docs/file-format-standards.md`.

---

## [1.8.33] — 2026-07-19

Publish tool 1.11.12.

### Fixed

- Cloudflare Pages Functions added or fixed in a newer plugin version never reached sites scaffolded before they existed: `init` copies them once and refuses to run over an existing site, and neither `build` nor the version repoint touched `functions/`. Sites therefore 404'd on new API routes (e.g. `/api/loadout-list`). `build` now syncs the plugin-owned scaffold Functions into the site on every run — copying missing files and overwriting stale ones to match the running plugin version (byte comparison, so an in-sync site produces no churn) (#115).

---

## [1.8.32] — 2026-07-19

Publish tool 1.11.11.

### Fixed

- CoC investigator-sheet crest/seal (`publish.sheet_crest`) never rendered: the config loader's field-by-field allow-list silently dropped the key, so it never reached the renderer. `loadPublishConfig` now carries `sheet_crest` (publish block first, then the `vault.config.json` fallback), and it is documented in the publish-site configuration reference (#112).

---

## [1.8.31] — 2026-07-18

Publish tool 1.11.10.

### Added

- Read-only CoC investigator party board on the roster page: per-PC HP/SAN/MP/Luck, DEX, optional Reputation (Regency), and the five condition badges. Reuses the roster-index/`getStates` fan-out and the 60s adaptive poller (no `kv.list`). The party board is now system-aware via a shared spine (`js/party-core.js`) + per-system skins dispatched by `lib/party-board-registry.js`.

---

## [1.8.30] — 2026-07-18

Publish tool 1.11.9.

### Added

- `flush` command: writes each player's current KV live-state (HP/MP/SAN/Luck, Reputation, and Status conditions) back into the CoC vault sheets, keeping the build-time fallback seed fresh past KV's 30-day TTL. Run automatically when the change-request loop stops, or ad hoc; idempotent, edits vault source only (no rebuild/deploy). Skill experience ticks are left for Advancement.

---

## [1.8.29] — 2026-07-18

Publish tool 1.11.8.

### Added

- Shared live-state store (`js/live-state.js`) that persists per-device sheet
  state to Cloudflare KV with a localStorage fallback, behind one opaque-blob
  interface reused by every system's live client.
- Call of Cthulhu investigator sheet live tracking: HP/MP pips, SAN/Luck/
  Reputation steppers, condition chips, and per-skill experience ticks now
  persist and restore across reloads (`js/coc-live.js`).

### Changed

- Unified live-state persistence across systems: current state now lives in KV,
  with localStorage and then the vault's authored values as fallbacks, and is no
  longer discarded on a site rebuild. The GURPS live client and party board were
  migrated onto the shared store, so a stale-build member now shows current KV
  values rather than authored defaults.

---

## [1.8.28] — 2026-07-18

Publish tool 1.11.7.

### Fixed

- GURPS party board no longer exhausts the Cloudflare KV free-tier list quota.
  The board polled `/api/loadout-list` every 5 seconds and that endpoint ran a
  `kv.list()` on every poll; the free tier allows only 1,000 list operations per
  day, so a single open party-board tab drained the day's quota in about 1h23m
  (after which the board silently stopped updating until UTC midnight). The
  loadout Functions now maintain a per-campaign `roster:<campaignId>` index on
  write and read party state with plain `kv.get()` calls — **zero `kv.list()`** —
  and the board polls every 60 seconds only while a game is actively running
  (activity = a player edit advancing state, a keypress/pointer press, or the tab
  becoming visible), going dormant after 15 idle minutes and never fetching while
  the tab is hidden. Migration is self-healing and needs no backfill: the roster
  starts empty and each player is registered the first time they save (the roster
  key's TTL is refreshed on every save so it never expires under an active
  party); pre-existing per-player keys stay valid.
- Change-request inbox no longer runs a `kv.list()` on every poll of the GM
  loop. `readPending` now reads a single `config:req-index` key and fetches each
  request by id; `enqueue` maintains the index. The index is seeded once from a
  single `kv.list()` the first time it is missing, so a site upgraded from an
  earlier deployment recovers any in-flight pending requests without losing them,
  and never lists again afterwards.
- **Existing deployed sites keep running the old, quota-burning Functions until
  updated** — re-copy `functions/api/loadout-core.mjs`, `functions/api/loadout.js`,
  `functions/api/loadout-list.js`, `functions/api/inbox-core.mjs`, and
  `js/gurps-party.js` from the scaffold and redeploy (see the Cloudflare Pages
  guide). Closing the party-board tab stops the loadout burn immediately in the
  meantime.

---

## [1.8.27] — 2026-07-18

Publish tool 1.11.6.

### Added

- CoC 7e investigator sheet: the publish tool now renders Call of Cthulhu PCs as
  an authentic Regency-parchment dossier (the CoC analogue of the GURPS sheet).
  It reads the PC's body tables into a structured model and shows the full
  alphabetical skill list (Regular / ½ / ⅕, always complete, untouched skills at
  their base default), a live status bar (HP/MP pip tracks, Sanity bar with
  starting marker, Luck/Reputation steppers, and the five condition chips), folio
  tabs (Character Sheet / Investigator's Record / Equipment & Wealth / Story /
  Journey), a backstory strip drawn from the Background section, a portrait
  cameo, and a configurable Order crest. The masthead era line shows the
  campaign's `setting_year`. Interactive controls (pips, steppers, chips,
  experience boxes) respond locally this release; persistence and recompute
  follow in a later release.

### Changed

- Change-request widget (all PC sheets): the correspondence history now opens in
  a modal dialog (backdrop / Esc / click-away to close) instead of an inline
  panel, and the compose box stays collapsed until asked for. On CoC pages the
  modal picks up the parchment styling; other systems get a neutral modal.

---

## [1.8.26] — 2026-07-17

Publish tool 1.11.5.

### Changed

- Change-request widget (PC sheets): the message box is now large by default
  (~8rem, ~9rem on phones) with the browser's native drag-resize handle, the
  fiddly slim expand/contract button is gone, and the Send button is a proper
  tap target (full-width on mobile). The chat-history button ("💬 History") is
  now always visible instead of only appearing once a device already has
  messages, so players can find past replies on a fresh phone.
- Change-request message box now uses the theme's card surface and text colours
  (`--bg-card`/`--text`) instead of a hardcoded white background, so typed text
  is readable on dark genre themes.
- GURPS party board (GM screen) redesign: character portraits now render as
  circular thumbnails (initials fallback); Basic Speed — the initiative sort
  key — is its own column and the redundant rank/number column is gone; Move
  shows current/basic (e.g. `3/6`) so encumbrance/condition loss is visible at a
  glance. The board still auto-refreshes from live KV state.

### Fixed

- GURPS party board: HP and FP collapsed into a single cell because the status
  panel's `.gl-vital { display: inline-flex }` rule also matched the board's
  `<td class="gl-vital">` cells, knocking them out of the table's column layout.
  Scoped that rule to the status panel (`.gl-vitals .gl-vital`) and the
  min-width rule to `.gl-party-table .gl-vital`.
- GURPS party board: portrait thumbnails rendered as a clipped sliver because
  `height: 100%` didn't resolve against the avatar's `display: grid` track. The
  thumbnail wrapper is now a plain block so the image fills the circle.

- GURPS status panel: the REELING and TIRED badges (and the effects row) were
  permanently visible even at full HP/FP. They are rendered with the `hidden`
  attribute and toggled by the live client, but the author `.gl-badge { display:
  inline-block }` rule outranked the user-agent `[hidden] { display: none }`, so
  `hidden` never took effect. Added a `[hidden] { display: none !important }`
  safeguard for the live-toggled panel elements; badges now show only when a PC
  is actually below ⅓ HP (Reeling) or ⅓ FP (Tired).

## [1.8.25] — 2026-07-16

Publish tool 1.11.4.

### Added

- GURPS live GM dashboard (SP3): the PC roster page now leads with a read-only,
  initiative-ordered party-status board showing every GURPS PC's current HP/FP
  and condition-adjusted Move/Dodge/ST with Reeling/Tired badges, auto-refreshing
  (~5s) from the Cloudflare KV `loadout:` keys via a new read-only
  `/api/loadout-list` Function. Reuses the SP1/SP2 recalc math; writes nothing.

## [1.8.24] — 2026-07-15

Publish tool 1.11.3.

### Added

- GURPS PC sheets — live in-session HP/FP with condition penalties: players edit
  current HP and FP in a persistent status panel above the tabs, and the sheet
  derives Reeling (current HP below ⅓ max → halve Move and Dodge) and Tired
  (current FP below ⅓ max → halve Move, Dodge, and ST), rounded up and cumulative
  when both apply. The halved Move/Dodge/ST update everywhere they appear, and a
  before → after delta line plus Reeling/Tired badges show only while a condition
  is active. HP/FP persist per player alongside the loadout (Cloudflare KV +
  localStorage). ST-based quantities (Basic Lift, encumbrance, damage) are not
  cascaded, per RAW.

### Changed

- The GURPS inline status pips (previously rendered twice, in the Character Sheet
  and Combat tabs) are replaced by a single persistent status panel above the tab
  bar.

## [1.8.23] — 2026-07-13

Publish tool 1.11.2.

### Added

- GURPS PC sheets — live in-session equipment loadout: players toggle gear on/off
  and Move, Dodge, encumbrance level, skill levels, and weapon to-hit/Parry
  recalculate instantly in the browser. Move and Dodge update everywhere they
  appear on the sheet — the Attributes block, the status line, the Combat defense
  chips, and the encumbrance readout (shown as current / base) — so no stat is
  left frozen. Toggle state persists to Cloudflare KV (`/api/loadout`) with a
  localStorage cache and a Reset control.

### Fixed

- `ENC_PENALIZED_SKILLS` now includes the fencing skills (Rapier, Saber,
  Smallsword, Main-Gauche), which take a penalty equal to encumbrance level.

## [1.8.22] — 2026-07-12

### Changed
- The change-request loop now trusts the player by default: XP grants and
  narrative edits always apply, and a player can push an unaffordable change
  through by adding "GM said OK" (or "do it anyway") — the change applies with
  Unspent Points shown as a deficit, and every override is logged to the GM's
  terminal. Ambiguous requests still ask which was meant. The widget hints at
  the override.

## [1.8.21] — 2026-07-12

### Added

- Two-way comms on the change-request channel: players can ask questions and get
  a brief, player-safe answer, and every message now returns a response to a
  per-device chat log (💬) on the sheet — including a plain-language explanation
  (with point math) when a change can't be applied. The widget reloads only when
  a change actually applied; advice and refusals update the log without a reload.

### Changed

- Widget input shows its example as helper text (not a placeholder), with a
  roomier, resizable box. The mobile back-to-top button is centered and more
  transparent.

## [1.8.20] — 2026-07-12

### Added

- At-table player change requests. Players submit natural-language character-sheet
  edits from the published site via a collapsed request bar on each PC page (the
  character sheet render itself is unchanged), gated by a 4-character session code
  remembered for 72 hours, with the page auto-refreshing when a change goes live.
  A Cloudflare Pages Function validates the code and queues requests in KV; new
  sites scaffold the Function and a `wrangler.toml` KV binding automatically.
- publish-site "start your checking loop" workflow: a dedicated, unattended session
  that drains the request queue on a self-paced ~60s loop, applies clean GURPS 4e
  edits to the vault (validated against ttrpg-expert's point-cost references),
  batches one rebuild + redeploy per tick, marks requests handled only after a
  successful deploy, and flags edge cases for the GM. GURPS 4e for this release.

## [1.8.19] — 2026-07-10

Publish tool 1.11.1.

### Added

- **Cloudflare Pages as an alternative deploy target.** A new `host`
  field in `vault.config.json` (`github-pages`, the default when absent,
  or `cloudflare-pages`) selects where the site is deployed. The built
  `docs/` folder is identical for both, so only the final step differs:
  GitHub Pages keeps using `git push`; Cloudflare uses
  `wrangler pages deploy docs/`. publish-site's routine-update deploy
  branches on `host` and, for Cloudflare, checks credentials with
  `wrangler whoami` first and degrades gracefully — if the token isn't
  set up or the deploy fails, it points the GM at the setup guide rather
  than surfacing a raw error. New `references/cloudflare-pages.md` covers
  creating a least-privilege API token, saving it in `~/.zshenv` (not
  `~/.zshrc`, which non-interactive deploys skip), the first deploy,
  custom domains, and troubleshooting. The setup wizard gains a
  host-selection step; `docs/publish-tool.md` compares the two hosts. The
  build warns when `host: cloudflare-pages` is paired with a leftover
  `github.io` `siteUrl` (which would break the 404 page). GitHub Pages
  behaviour is unchanged, and the two hosts can run in parallel.

## [1.8.18] — 2026-07-10

Publish tool 1.11.0.

### Added

- **Section index banners.** `publish.banners` attaches a hero image or a
  clickable map to the top of a section index, or a conventional
  `_banner.*` file in the section's vault folder is picked up with no
  config at all. An SVG with no click-through target is inlined, so its
  internal `<a>` elements stay live — a star map whose nodes link to
  entity pages keeps working, which an `<img>` could not do and an outer
  anchor would have swallowed. A banner declaring a `link` renders as an
  `<img>` inside an `<a>` instead. Assets copy to `docs/images/banners/`;
  a path resolving outside the vault, or a missing file, warns and is
  skipped rather than failing the build. Assets are namespaced by section
  (`docs/images/banners/<section>/`), since the conventional `_banner.*`
  filename is identical in every section folder. (#95)

## [1.8.17] — 2026-07-09

Publish tool 1.10.0.

### Added

- **Opt-in WebP image optimization.** `publish.images.optimize` re-encodes
  PNG/JPEG attachments to WebP as they're copied, resizing to
  `max_width` (default 1600) at `quality` (default 82). On a
  portrait-heavy vault this cut 164 MB of images to 11 MB. The pass runs
  before any page renders, so the swapped extension flows into `<img src>`
  at emission time rather than being rewritten into generated HTML
  afterwards. Requires the `cwebp` binary; without it the build warns and
  copies originals. Images that would grow when re-encoded keep their
  original bytes. (#91)
- **Pivot grouping for the Locations index.** `publish.locations.group_by`
  gives each matching `location_type` — a star system, say — its own
  section, instead of one deep tree rooted at a single political node. The
  scaffolding above the pivot collapses into a context caption; every
  location below it stays a first-class row with its own thumbnail and
  type badge, children nested beneath it. Locations outside any pivot
  collect under `ungrouped_label`. Defaults on for the `scifi` genre, and
  falls back to the flat view when fewer than two locations match. (#93)

### Fixed

- **`css/overrides.css` is now wired into the build.** `gm-publish init`
  scaffolded it, but nothing copied or linked it, so the one file that
  looked like the customization seam did nothing — and `theme.css`, the
  only file that would have worked, is regenerated every build. It is now
  copied into `docs/css/` and linked last in `<head>`, after `theme.css`
  and the genre overlay, so site rules win the cascade. Sites without one
  emit no link tag. (#92)
- **Portraits resolve through the scanner's image map.** `portraitImg`
  built its output path from the `portrait:` frontmatter string, so a
  `portrait:` that omitted its subdirectory pointed at a file the build
  had copied elsewhere.

## [1.8.16] — 2026-07-09

Publish tool 1.9.0. Fixes the eight open publish-site issues.

### Added

- **Obsidian callouts render as styled callouts.** `> [!type] Title`
  blockquotes become `<div class="callout callout-{type}">` with a title
  row, instead of leaking the literal `[!type]` marker as body text. A
  shared markdown renderer (`lib/markdown.js`) now backs both the page
  and index-page renderers. (#86a)
- **Aggregate `characters/index.html`.** The homepage "Characters" card
  pointed at a page that was never generated; the index now exists and
  lists PCs and NPCs together. (#84)
- **Warning for unmatched manifest entries.** A Publishing entry that
  resolves to no scanned vault file now prints a warning instead of
  silently dropping the page. (#80)

### Fixed

- **HTML comments no longer reach the published site.** `<!-- ... -->`
  was HTML-escaped and printed as visible body text, leaking private
  authoring notes (including "needs GM confirmation" flags) onto
  player-facing pages. Comments are now stripped before render, outside
  fenced code blocks, with a warning on an unclosed comment. (#85)
- **Manifest Publishing entries tolerate inline comments.** `- [x] path
  — note` silently published nothing, because the whole line was matched
  against the vault path. The comment is now stripped, matching how the
  Excluded section is annotated. (#80)
- **Image embeds render as images.** `![[Some Image.png]]` produced a
  markdown link with an unencoded space, which markdown-it could not
  parse, so it fell through as literal text and the typographer rewrote
  the leading `../` into `…/`. Destinations are now percent-encoded, in
  embeds and in portrait `src` attributes alike. (#86b)
- **Wikilinks in frontmatter fields resolve.** `summary:`, `occupation:`
  and friends leaked literal `[[…]]` while the same links resolved in
  body prose. (#86c)
- **Inline embeds are deduped against the frontmatter portrait.** An
  `![[X.png]]` embed that resolves to the page's `portrait:` is skipped,
  so authors can keep the embed for Obsidian's reading view without
  publishing the image twice. (#88)
- **Pull-quote excerpts are sanitized.** They no longer include section
  headings, raw image markdown, HTML comments (whole or truncated), or
  callout markers, and de-linking a wikilink no longer leaves a stray
  space ("Magellan 's"). (#87)
- **Timeline nav link and `events/` redirect point at the real page.**
  Both hard-coded a root `timeline.html` that is only written when dated
  events exist; with an authored timeline elsewhere (e.g.
  `campaign/timeline.html`) the global nav dangled on nearly every page.
  The target is now computed once, and `events/` gets a real index when
  no timeline exists at all. (#83)
- **The NPC listing's session filter no longer treats `lastUpdated` as a
  session.** It fell back to that field when `asOfSession` was empty, so a
  maintenance date (`2026-07-05`) appeared in the "filter by session"
  dropdown and was sorted against `Session N`. An entity with no
  `asOfSession` is simply not session-filterable, and an ISO date written
  directly into `asOfSession` is ignored. (#89)
- **GURPS `parseTechniques()` no longer merges sub-tables.** Descriptive
  helper tables under a `###` subheading were force-fit into the
  Name/Default/Lvl/Pts grid. Techniques, Skills and Spells now read only
  tables above the first subheading. (#82)
- A missing image embed no longer emits a visible `<!-- image not found -->`
  paragraph; it is dropped, with a build warning.
- PC sheets resolve image embeds before wikilinks, so an `![[image.png]]`
  on a character sheet is no longer flattened to literal text.
- A non-image transclusion (`![[Some Note]]`) degrades to a link instead
  of becoming an `<img>` whose `src` points at an HTML page.
- `world_domain` pages render their `portrait:` frontmatter, which every
  other entity template already did.
- Unclosed `<!-- gm-only -->`, `<!-- spoiler -->` and comment markers now
  print the build warning they always recorded; it was being discarded.
- `<!-- ... -->` inside a `~~~` fenced block containing a nested ```` ``` ````
  line is no longer stripped.

### Changed

- The NPC listing's last column is now headed **As of Session** rather than
  "Last Updated". It always showed `asOfSession` first and was sorted and
  filtered as a session; the header was the part that was wrong.
- Pull-quote excerpts derive from a page's published markdown rather than
  from its rendered HTML — the same source backlinks, search and recency
  already read, and the reason the sanitization above is not a regex pass
  over the renderer's own output. `publishedSource()` is now a single
  shared helper instead of four near-identical copies.

## [1.8.15] — 2026-07-09

### Added

- **Pathfinder 2e (Remaster) system support** — new
  `systems/pf2e/` knowledge base for ttrpg-expert, sourced
  entirely from ORC-licensed material (Player Core, Player
  Core 2, GM Core, Monster Core, Monster Core 2) with all
  descriptive text paraphrased. Core five files (mechanics,
  character generation, rules reference, session procedures
  with DC/encounter-XP/treasure GM math tables, character
  sheet) plus index+shard fan-outs: spells by rank
  (cantrips + ranks 1-10, ~408 Player Core spells), monsters
  by level band (243 curated Monster Core creatures across
  6 shards), feats by category (general+skill, ancestry,
  class, archetype), all 24 ORC-remastered classes,
  ancestries/heritages/backgrounds, all 43 conditions, and
  Player Core equipment. Routed through ttrpg-expert
  SKILL.md/INDEX.md and session-play; `pf2e` added to the
  publish `system` enum; PF2e tone row in shared-patterns.
- **PF2e PC sheet template** (`skills/shared/templates/pc-pf2e.md`)
  — Remaster attribute modifiers, TEML skill ranks, hero
  points, spellcasting by rank, invested items, and the
  standard Current Status block.
- **PF2e character sheet renderer** (publish tool 1.8.0) —
  `pc-pf2e.js` renders attribute cards, skill-rank pills,
  class features, hero points, and spell slots by rank;
  registered for `pf2e`, `pathfinder-2e`, and `pathfinder`
  system identifiers, with unit tests.
- **PF2e benchmark questions** — five routing/quality probes
  in `tests/benchmark-questions/ttrpg-expert.md`.
- **PF2e ORC attribution** — ORC Notice and per-book
  attribution recorded in `ATTRIBUTION.md`; personal
  reference directory gitignored at
  `systems/pf2e/personal/`.

---

## [1.8.14] — 2026-07-08

### Fixed

- **GURPS Techniques level renders from `Base`/`Current` columns**
  (publish tool 1.7.1) — the Techniques table parser now resolves the
  displayed level with the same column priority as Skills
  (`Current` > `Effective` > `Base` > `Level`), so sheets using the
  1.8.12-style header no longer publish a blank `Lvl` cell. The
  Skills, Techniques, and Spells table parsers now share one
  column-resolution helper so they can't drift apart, and the
  frontmatter paths for all three share a matching level fallback
  (`current` > `level` > `effective` > `base`, skipping blank
  values). Legacy `Effective`/`Skill Level` sheets are unaffected.
  (#78)

---

## [1.8.13] — 2026-07-07

### Added

- **`scifi` theme preset** (publish tool 1.7.0) — worn space-noir:
  rust-black background, K-star amber accent, terminal cyan secondary,
  condensed technical headings, with a light "station work order"
  variant. Aliases: `sci-fi`, `science-fiction`, `space`,
  `space-opera`, `space-noir`. Section titles: "Star Charts" /
  "Powers & Interests" / "Hardware & Equipment" / "Xenofauna".
- **Theme showcase** — `scripts/build-theme-showcase.mjs` builds the
  benchmark campaign once per preset; a new Pages workflow publishes
  the gallery on pushes to main.
- **NPC table avatars** — the NPC listing's Name column shows portrait
  thumbnails with an initials fallback; sorting is unaffected.

### Fixed

- **Location card excerpts** no longer render raw markdown and can
  never surface excluded-section (GM Notes) content — location
  sub-location cards and the location/NPC/PC pull-quotes route
  through one shared helper that also truncates cleanly at word
  boundaries with an ellipsis.
- **Locations index renders the full hierarchy** — deep trees (depth
  ≥ 2) now appear recursively inside their root cards instead of being
  silently dropped; children of unpublished parents still float up as
  roots, and empty region headings are gone.
- **Relationship graphs exclude index pages** — authored section
  indexes (e.g. `_World/index.md`) no longer wire every entity into
  one hub.

## [1.8.12] — 2026-07-06

### Added

- **GURPS skill-level verification** — `gurps_check.py` gains a
  `skills` check: point cost + difficulty → relative level via the
  B170 closed form (WARNING on mismatch), attribute + relative level
  → Base (INFO residual — a Talent may explain), and a naive Current
  tripwire (Base − enc level for Climbing/Stealth/Swimming/Judo/
  Karate, INFO with an Armor Familiarity MA49 hint). The script
  computes closed-form arithmetic only; perk and Talent
  reconciliation belongs to the model's verification pass.
- **Skills table Base/Current columns** (migration 1.8.11 → 1.8.12)
  — the GURPS PC template's Skills table renames `Effective` →
  `Base` and appends `Current` (what you roll now under the declared
  `Enc:`). Old-format sheets keep working in both the checker and
  the publish tool.
- **Publish tool 1.6.1** — renders `Current` as the displayed skill
  level with `base N` alongside when they differ.

### Changed

- GURPS character-generation and character-sheet references extend
  the verification loop with a reconciliation pass: resolve `skills`
  residuals against the sheet's Advantages & Perks and Talents
  before escalating to the GM.

## [1.8.11] — 2026-07-06

### Added

- **Portrait thumbnails on listing cards** (publish tool 1.6.0) — the
  Locations and Factions index pages now render a thumbnail when an
  entity has a `portrait:`, with text-only fallback; the generic
  character card's portrait now resolves through the image map instead
  of emitting an unresolvable vault-relative path.
- **Genre-aware section titles** — section index h1s ("Theater of
  Operations", "Intelligence Briefing", "Armory & Acquisitions",
  "Bestiary") are now driven by the theme genre preset with neutral
  defaults, overridable via `publish.section_titles` in
  `_meta/vault-config.md`.
- **Heritages and World index pages** — `DIR_LABELS` gained both
  sections, so their nav links (already present) stop pointing at
  missing index pages.
- **Scanner warning for unmapped directories** — typed pages in a
  directory missing from `folderMap` now produce a one-per-directory
  warning instead of being silently skipped.

### Changed

- The setup scaffold's default `folderMap` now maps `Chapters` →
  `chapters`, so sessions, chapters, and wrap-ups publish out of the
  box.
- Faction listings honor the legacy camelCase `factionType` field, and
  parentless locations group by `location_type` instead of dumping
  into "Other".
- Documented the recap-surfacing rule (session index + chapter +
  wrap-up must all publish) in publish-site troubleshooting, and the
  listing grouping keys in the schema reference.
- **Authored section index pages now win** — a vault page that slugs
  to a section index (e.g. `_World/index.md` → `world/index.html`)
  is kept as-is instead of being silently overwritten by the
  auto-generated section index.

---

## [1.8.10] — 2026-07-05

### Added

- **GURPS sheet arithmetic checker** — new bundled utility
  `skills/shared/scripts/gurps_check.py` (with pure-formula core
  `gurps_calc.py`) verifies a GURPS PC markdown sheet against Basic
  Set arithmetic and reports advisory deltas: Basic Lift and the
  encumbrance table (B15/B17), carried load vs the Current Status
  `Enc:` line, Move/Dodge per level, secondary characteristics,
  Parry/Block (B375–B376), a point-budget audit, and the
  thrust/swing damage chain via closed-form B16 formulas with B269
  dice-equivalence (so `2d+5` and `3d+1` compare equal). Read-only
  and stdlib-only; wired into ttrpg-expert's GURPS chargen and
  character-sheet references. The parser also accepts parenthetical
  attribute labels like `ST (Strength)`. Damage formulas validated
  against a GCS-derived oracle at development time — GCS is not a
  dependency.

---

## [1.8.9] — 2026-07-05

### Added

- **Current-encumbrance-row highlighting from markdown tables**
  (publish tool 1.5.1) — the GURPS sheet's Encumbrance block now
  flags the character's current level when the sheet is written as
  a plain markdown table, not just from a frontmatter
  `encumbrance:` array. Two detection paths, in priority order: an
  explicit marker on the Level cell (trailing `*` — canonical —
  `←`, or `(current)`), stripped from the displayed text; otherwise
  the `**Enc:**` value in `## Current Status` is matched against
  the level names (case-insensitive, parentheticals like `(1)`
  ignored; a bare number matches the row's parenthetical level
  number). At most one row is ever flagged, whatever the source.
  Sheets with an explicit frontmatter `current: true` keep it;
  sheets with neither a marker nor a matching status value render
  exactly as before — the status fallback applies to frontmatter
  arrays without a `current` flag too.
  The GURPS PC template documents the marker and gains an
  `**Enc:**` line in its Current Status block. Sites pinned to an
  earlier published tool need to move to ≥1.5.1 to pick this up.

## [1.8.8] — 2026-07-05

### Changed

- **Extracted the-midwife's conditional sections into reference
  files** — Phase 4 (Scaffold & Handoff) plus the Adventure Brief
  Template (~8.2 KB) move to `references/scaffold-handoff.md`, and
  Worldbuilding Mode (~1.8 KB) moves to
  `references/worldbuilding-mode.md`. `SKILL.md` (22.3 KB → 13.0 KB,
  −42%) keeps the phase goal and mode trigger as routing stubs, so
  Discover/Shape/Structure conversations — the majority of midwife
  turns — no longer load scaffold or worldbuilding procedure.
  Moved content is unchanged from the prior sections apart from
  the fix below and de-duplicated trigger/goal lines that now
  live only in the SKILL.md stubs.
- **Closed the "extract remaining conditional reference chunks"
  roadmap item** — the reconcile world-evolution step and
  session-prep world-threads/narrative-plans chunks were measured
  and skipped: the reconcile 6.5 offer runs on every reconcile
  (only the acceptance body is conditional, and splitting it risks
  missed `world_evolved` bookkeeping), and the session-prep steps
  (0.8/1.0 KB behind different guards) net under ~160 tokens each.

### Fixed

- **Phase 4 now delivers the world facts Woven Worldbuilding
  promises** — the Woven Worldbuilding section has always said
  accumulated world facts "are written to `_World/` domain files
  during the Scaffold phase," but no Phase 4 step actually did
  it. New Step 2c in `references/scaffold-handoff.md` flushes
  captured facts to `_World/` domain files and deferred flags to
  `_World/_flags.md`, creating stubs per the campaign-organizer
  conventions when needed.

## [1.8.7] — 2026-07-05

### Changed

- **Split `campaign-qa/references/check-procedures.md` into eight
  per-check files** under `references/checks/` (canon-audit,
  timeline-validation, name-similarity, clue-redundancy,
  graph-health, stale-draft-detection, legacy-canon-field-repair,
  open-spoilers). `check-procedures.md` is now a thin index. A
  single-mode audit reads only its one check file (~1–6 KB) instead
  of the whole 22.9 KB reference; `campaign-qa/SKILL.md` routing and
  Full Audit updated to read the per-check files. Content is
  byte-identical to the prior sections.
- **Extracted the PC body-structure block into
  `shared/pc-body-structure.md`** — the PC body-heading hierarchy,
  the `## Current Status` block spec, and the Story Companion
  Convention (~4.9 KB) move out of `shared/entity-schema.md`
  (24.8 KB → 20.5 KB, −17%). Entity work that doesn't touch PC files
  no longer loads the PC-body content. `entity-schema.md` keeps a
  breadcrumb; consumers re-pointed (session-wrapup, the-midwife, all
  six `pc-*` templates). Content preserved verbatim across the split.

## [1.8.6] — 2026-07-05

### Changed

- **Version check reads `shared/migrations.md` frontmatter only**
  (Read with a 10-line limit) in all eight consuming skills — the
  file is 16 KB of append-only migration history, and the check
  needs one frontmatter field. Saves roughly 4k tokens on nearly
  every skill invocation. Compaction plan Phase 0.

## [1.8.5] — 2026-07-04

### Added

- **Two more bundled vault utilities** targeting the weekly session
  loop (the largest recurring token/time cost):
  `session_context.py` emits session-prep's entire standard
  read-set in one call — latest Wrap-Up, active PC `## Current
  Status` blocks, the upcoming session's Plan, deferred world
  flags, and the campaign overview — replacing a dozen-plus
  separate reads per prep (verified on a real 15-session vault in
  0.3s); `stamp_entities.py` batch-stamps `asOfSession`,
  `lastUpdated`, and the chapter-tag swap across all active PC
  sheets for session-wrapup Step 3c, dry-run by default and
  surgical (only the targeted frontmatter lines change).
- **Incremental audits**: `vault_check.py changed --since N` lists
  entities touched at or after session N via session-anchored
  fields; campaign-qa's Canon Audit gains a documented incremental
  mode (audit the delta plus its backlink neighborhood) so audit
  cost scales with what changed, not vault size.
- Regression coverage: new `tests/fixtures/mini-vault-prep/`
  fixture and 17 new checks (context bundle content and
  exclusions, changed-since listing, stamper dry-run/write/body
  preservation).

### Fixed

- docs/campaign-organizer.md no longer claims Weave-mode link
  discovery uses Smart Connections — link discovery uses the
  bundled utilities in every environment.
- Session-number parsing hardened against real-vault free text:
  compound references ("Chapter 3, Session 7") key on the session
  number, and date-bearing values ("Reconstructed 2026-07-04")
  parse as unknown instead of session 2026 — affecting
  stale-DRAFT and changed-since semantics.

## [1.8.4] — 2026-07-04

### Added

- **Three bundled vault utilities** under `skills/shared/scripts/`
  (Python 3 standard library only, shipped in every skill zip):
  `graph_check.py` reports orphans, unresolved and ambiguous
  links, dead ends, and backlinks in one deterministic pass —
  handling aliases, `[[Name|alias]]`, anchors, embeds, quoted
  frontmatter links, and space/underscore/case variants;
  `vault_search.py` is index-free BM25 ranked search with context
  snippets for prose queries; `vault_check.py` covers entity
  schema validation (required fields, enums, legacy fields,
  unquoted frontmatter links), duplicate/confusable name and
  alias detection (document-chain and numbered-structural
  families filtered), `_meta/index.md` drift in both directions,
  and stale-DRAFT sweeps. Benchmarked on a 705-note vault:
  identical results to per-query LLM approaches in under a
  second, versus 50–125 seconds and ~40–56k tokens.
- **Validation loops for entity creation** (top roadmap item):
  session-wrapup, vault-ingest, and campaign-organizer now run
  `vault_check.py frontmatter` on folders they touch and fix
  ERRORs before presenting results; campaign-qa's name-similarity
  and stale-DRAFT procedures and campaign-organizer's Validate
  mode prefer the utilities over manual passes.
- Schema rules and the frontmatter parser extracted to
  `skills/shared/scripts/schema_rules.py` — single source of
  truth shared by `scripts/validate_schema.py` and the bundled
  utilities.
- Fixture-based regression tests for all utilities
  (`tests/test_vault_utilities.py`, `tests/fixtures/mini-vault/`,
  `tests/fixtures/mini-vault-schema/`), wired into CI.

### Changed

- **Vault access no longer uses the Obsidian MCP server stack.**
  `shared/filesystem-mode.md` is rewritten and renamed to
  `shared/vault-access.md`, the Vault Access Reference: plain filesystem tools plus the bundled utilities —
  no server, no app dependency, no mode split. Obsidian is a
  viewer, never a requirement. campaign-organizer, campaign-qa,
  the shared session principles, and the QA check procedures now
  point at the shared reference instead of restating detection.
- campaign-qa's Graph Health procedure prefers one `graph_check.py`
  pass over hand-building a link map with Grep.
- README setup instructions replace the MCP server / Local REST API
  configuration with the bundled-utilities section and a migration
  note for users carrying the old MCP plugins and `.mcp.json` entry.

### Removed

- All references to the archived Obsidian MCP server, MCP Tools
  plugin, and Local REST API plugin across skills, docs, README, and
  ROADMAP. Neither plugin is required or recommended any longer.

## [1.8.3] — 2026-07-04

### Added

- **`## GM Notes` is now the single canonical heading for whole-section
  GM-only content**, replacing the exact-heading-string-list approach
  (`exclude_sections`) that couldn't generalize — a production vault
  had grown that list to 47 one-off entries and was still leaking.
  Anything that used to get its own top-level heading (Keeper
  Checklist, World State, Source References, tactical notes, etc.)
  becomes a subsection nested under `## GM Notes` instead; the publish
  tool's heading filter is already level-aware, so this needed no
  filtering-code changes.
- **`<!-- spoiler -->` marker** for narrative content that's hidden
  only until it's revealed in play, distinct from permanently-hidden
  `<!-- gm-only -->` content. `reconcile` gains a step asking the GM,
  per session, whether any spoilers in entities touched that session
  were revealed — if so, the fence is stripped and the content becomes
  permanently public prose.
- **campaign-qa: two new checks** — un-fenced GM-only content
  (headings or bold-paragraph lines that look GM-only but sit outside
  any hiding mechanism) and an open-spoilers audit listing every
  currently-pending `<!-- spoiler -->` block for GM review.
- Migration entry backfilling existing vaults: re-nests every heading
  already in a vault's `exclude_sections` list under `## GM Notes`,
  with a GM-confirmed batch for bold-wrapped headings, bold-paragraph
  pseudo-headings, and callout-only-marked content that exact-string
  matching can't catch.

### Fixed

- `exclude_fields` had the same config-shadowing bug already fixed for
  `exclude_sections`/`exclude_dirs` in previous work — a field named
  only in `vault.config.json` was silently never stripped. Now unions
  both sources like its siblings. Defaults gain `gm_notes` and
  `prep_notes` (real, populated fields that were never excluded);
  `secrets`/`current_plan`/`plan_progress` stay in the list even
  though unused, since removing them could strip less than some vault
  depends on.
- Landing page session recap extraction read raw markdown instead of
  the publish-filtered view, so it could quote GM-only content; also
  fixed matching the wrong chapter's wrap-up when two chapters share a
  session number, and wikilink targets rendering with literal
  underscores instead of spaces.
- Portrait-less entity hero banners rendered their initials avatar as
  a clipped sliver overlapping the entity name instead of stacking
  above it.
- NPC portraits rendered as a cropped hero-banner background — showing
  only a thin band around the image's 25%-height line, with no way to
  view the full portrait — because the with-portrait branch used the
  same landscape-oriented layout as location art instead of the
  portrait-shaped card PC pages already use. Also, hero images
  (portraits included) weren't wired into the site's click-to-enlarge
  lightbox at all, since the binding only looked inside `.content`.

### Removed

- `PUBLISH_SITE_BUGS_SPEC.md` — verified against current code that
  every item in it (a narrative-IA redesign and eight defects) already
  shipped in previous releases.

## [1.8.2] — 2026-07-03

### Added

- **Schema Mirror Sync** — every vault migration pass now diffs
  `_meta/entity-types.md`'s Type-Specific Fields entries against
  the canonical ones in `shared/entity-schema.md`, for every
  built-in type, regardless of which versioned migration entries
  are pending. Missing or stale entries are offered as opt-in
  Content items, the same way stale `_Templates/` files already
  are.
- **campaign-qa: Ambiguous Links check** — Graph Health now flags
  bare wikilinks whose basename matches more than one file in the
  vault, not just links pointing at nothing. Obsidian resolves
  these silently and unpredictably; this catches them before they
  cause a GM to read the wrong session's recap.
- Migration `1.8.0 → 1.8.2` backfills two known drift points:
  the Event field rename from 1.4.22 (`date` → `in_game_date`)
  never reached `_meta/entity-types.md`, and no migration ever
  added a `character-story` entry to it. It also renames every
  Session Wrap-Up file to a chapter-disambiguated filename
  (`Chapter_CC_Session_NN_Wrap_Up.md`) and repairs every
  reference to it — the old chapter-free filename guaranteed a
  basename collision the first time any campaign ran a second
  chapter with per-session wrap-ups.

### Fixed

- `shared/entity-schema.md`'s Type-Specific Fields summary was
  missing compact entries for `character-story`, `plan`,
  `heritage`, `world_domain`, and `world_flags` — types that
  already have real templates and are in active use, but were
  never added to the summary section that vaults mirror.
- `campaign-qa`'s Story file recency check and `vault-ingest`'s
  classification heuristic both still referenced the pre-1.4.22
  wrap-up type name `session-wrap-up` instead of the current
  `session_wrap`, silently failing against every vault using the
  current (correct) type.

## [1.8.1] — 2026-07-02

### Fixed

- **Story spine wiki-links:** `buildStorySpine` rendered recap markdown
  to HTML without running `resolveWikiLinks`, so story unit pages
  showed raw `[[wiki-link]]` text. Recaps now resolve against their
  unit's `story/` output path before rendering, matching the PC-page
  flow.
- **Wrap-up matching in flat `Sessions/` folders:** `wrapUpForUnit`
  tried the same-folder heuristic before the ref index, so vaults where
  every session and wrap-up shares one `Sessions/` folder had every
  story unit pull the first wrap-up's recap. Exact `session:`/`chapter:`
  ref matches now win; the folder heuristic only applies when the
  folder contains exactly one wrap-up.

## [1.8.0] — 2026-07-02

### Changed

- **`canon_status` is now the single canonical field name** for canon
  status (DRAFT / AUTHORITATIVE / SUPERSEDED / STUB). Three names for
  the same field had accumulated since the first release —
  `canon_status`, `source_confidence`, and a bare `confidence` row in
  the entity-schema Universal Fields table — and vaults collected
  whichever name was current when each file was written. All templates,
  skill references, the validator, and CI now write and require
  `canon_status` exclusively; "confidence" naming is gone from code
  identifiers, UI labels, and prose (`shared/canon-confidence.md` is now
  `shared/canon-status.md`, publish tool exports `getCanonStatus` /
  `canonStatusBadge`, NPC index column reads "Canon Status").
- **Migration 1.7.10 → 1.8.0 sweeps the whole vault** on the next skill
  invocation after updating: legacy keys are renamed to `canon_status`,
  duplicate fields collapse to one (never leaving two `canon_status:`
  lines in a file), and value conflicts are kept on the `canon_status`
  value and reported for GM review. campaign-qa gains a permanent
  Legacy Canon Field Repair check so reintroduced legacy names are
  caught on every full QA pass.
- Publish tool bumped to 1.4.0: reads `canon_status` first, with the
  legacy names still honored at read time so unmigrated vaults publish
  correctly.

### Fixed

- **SUPERSEDED leak:** a file whose only canon field was the legacy bare
  `confidence: SUPERSEDED` was published as a live page instead of being
  filtered and redirected to its successor.
- **Missing draft badges:** items/NPC index pages read only
  `confidence`/`canon_status` and ignored `source_confidence`, so files
  written by the current schema never showed their Draft/Stub badge.
- Schema validator now rejects legacy field names with a pointer to the
  1.8.0 migration instead of silently accepting them.

## [1.7.10] — 2026-06-30

### Added

- **Published sites now have a "Story" section** — a curated, prose-first
  reading layer over the narrative that already lives in a vault, alongside
  the unchanged reference Wiki. A `/story.html` landing presents two
  branches:
  - **The Campaign Saga** — dedicated story pages built from each unit's
    `Narrative Recap`, walked in order with prev/next (cover to cover). The
    spine is *adaptive*: a chapter contributes one page, or one page per
    session, depending on where its recaps live. Chapters/sessions with no
    recap are omitted (no dead pages).
  - **Character Stories** — a dedicated prose page per PC built from
    `*_Story.md`, grouped Current / Retired / Fallen; the PC stat-sheet's
    Story tab now links to it.
  - The recap is found by heading wherever it lives — a separate wrap-up
    file or embedded in the session/chapter file — and matched even when
    decorated (e.g. `What Happened — Narrative Recap`). Units are paired by
    folder proximity (robust to free-form title refs). Story pages are built
    only from the published view (gm-only/excluded sections stripped), so no
    spoilers leak, and a vault with no narrative gets no Story section at all.
  - New modules: `lib/story-spine.js` (pure spine builder),
    `lib/templates/story.js`, `lib/templates/story-landing.js`. The "Story"
    nav points at the landing when a Story section exists.

### Changed

- `gm-apprentice-publish` bumped to 1.3.2.

---

## [1.7.9] — 2026-06-30

### Fixed

- **Excluded sections no longer leak when both config sources are set
  (B8).** `_meta/vault-config.md`'s `exclude_sections`/`exclude_dirs`
  silently shadowed `vault.config.json`'s lists (an `A || B`), so a section
  listed only in the JSON — e.g. `Source References` — was never stripped.
  The two sources are now unioned (case-insensitive dedupe), falling back to
  defaults only when neither is set.
- **Derived widgets no longer leak GM-only names (B6).** "NPCs in Play"
  (recency) and the relationship graph (via backlinks) scanned raw page
  markdown, surfacing entities mentioned only in `<!-- gm-only -->` blocks or
  excluded sections. Each page's "published view" (those stripped) is now
  computed once and used by backlinks and recency; graph edges derive from
  backlinks, so they are covered too.
- **Cross-subtree links no longer 404 (B3).** `wiki.js`, `location.js`, and
  `npc.js` passed a page's file path where `relativePath` expects a
  directory, adding an extra `../` that dropped a path segment (e.g. cross-
  chapter links lost `chapters/`). Added a `relativeHref(fromFile, toFile)`
  helper and routed all file-to-file links through it.
- **Wikilinks no longer render as raw underscore slugs (B1).** Body links
  showed `Lord_Percival_Harcourt`; display text is now humanized (underscores
  to spaces) for resolved and unresolved links, leaving explicit aliases
  untouched.
- **The 404 page is themed (B4).** It loaded `style.css` + `theme.css` but
  not `css/themes/<genre>.css`, so it fell back to default accents; the genre
  overlay link is now emitted.
- **Breadcrumb dead-links removed.** Breadcrumbs linked every last directory
  segment to `index.html`, but only top-level dirs get one — chapter
  subfolders 404'd; those segments are now plain text. The `parent_location`
  breadcrumb also used the root-relative output path as a same-dir href
  (resolving to `locations/locations/…`); it is now made relative.
- **More raw-slug surfaces humanized.** Beyond body wikilinks (B1), event
  participant/location links and item holder/origin links showed raw
  underscore slugs; all now humanize via a shared `humanizeName` helper,
  preserving explicit aliases. Against the Canticle vault this drives broken
  links from 586 (pre-fix) to 15 and raw-slug links from 2043 to 0 (the
  remaining 14 broken are relationship-graph SVG node paths, tracked
  separately).
- **Sparse sidebars no longer squeeze the article (B2).** A page with a
  single small sidebar box still reserved the full 18rem column; sidebars
  with ≤1 section now collapse to a single comfortably-wide column.

### Changed

- `gm-apprentice-publish` bumped to 1.3.1.

---

## [1.7.8] — 2026-06-29

### Fixed

- **Publish build no longer fails on a clean install with "Cannot find
  module 'gray-matter'".** The `gm-apprentice-publish` tool is distributed
  by git-copying the repo into the plugin cache; a site pins it with a
  `file:` dependency, which npm satisfies by symlinking the cached copy.
  Node then resolves the tool's `require()`s from the cache, where
  `npm install` never runs — so its runtime deps were absent. The tool now
  **vendors** its production dependencies (`gray-matter`, `lunr`,
  `markdown-it` + transitive) as committed files, so a fresh install builds
  with no manual steps and offline. A root `.gitignore` negation tracks the
  subtree; `tools/publish/README.md` documents re-vendoring.
- **Stale build-tool version pins no longer fail silently.** A bare
  `/plugin` update drops a new version into the cache but leaves existing
  sites pinned to the old one, so builds kept using the old renderer (e.g.
  the new Phoenix GURPS sheet didn't appear). The build CLI now detects this
  drift at startup — comparing the version it runs as against the newest
  installed in the cache — and prints a loud warning naming the exact `file:`
  path to switch to. The publish-site routine-update flow (capability 2) and
  troubleshooting guide were tightened to repoint reliably and verify the
  repoint took effect.

### Added

- `tools/publish/lib/version-check.js` — `detectVersionDrift()`, with unit
  coverage for semver comparison, no-drift, dev-checkout, and non-semver
  sibling cases.
- Build CLI preflight that reports missing runtime dependencies with
  actionable remediation instead of a raw stack trace.
- `clean-install` integration test (mirrors a git-copy cache + symlinked
  site, fully offline) and a `runtime-deps` test that fails if any declared
  dependency is not both requireable and git-tracked.

### Changed

- **Committed fully to the plugin-cache distribution model for the publish
  tool.** The build tool ships inside the plugin and is driven from the
  plugin cache, never the npm registry (which lagged at 1.2.1 and risked
  version skew between the renderer and the skill). `init` now auto-pins a
  new site's `package.json` to the exact cache version it ran from — the
  scaffold default changed from `"latest"` to a self-referential `file:`
  pin — so a new site needs no manual repoint and no registry round-trip.
  The publish-site SKILL, setup wizard, and tool README were updated to
  drive `init` from the cache and to stop pointing users at npm.
- `gm-apprentice-publish` bumped to 1.3.0; lockfile version realigned to
  1.3.0 (it was stale at 1.2.1, two patches behind the previous
  `package.json` value of 1.2.3).

---

## [1.7.7] — 2026-06-29

### Added

- **GURPS character sheets now publish as a complete Phoenix-style record.**
  A new `tools/publish/lib/templates/gurps/` module replaces the previous
  thin renderer. It reads standard markdown-table vault format (with optional
  frontmatter overrides) and produces three output payloads assembled by the
  PC shell:
  - **Character Sheet** — 2-column block flow: attributes/secondary/derived,
    lifting feats + slam derived tables, active defenses + hit-location DR,
    senses + checks, encumbrance ramp, reaction modifiers, cultural
    familiarities + languages, advantages/perks/disadvantages/quirks/templates,
    skills with effective levels + footnote legend + parry/block sub-lines,
    techniques, spells, points summary, melee + ranged attack tables, grimoire.
  - **Combat tab** — dedicated dashboard tab with current status banner,
    active defenses, melee and ranged attack tables, combat action chains +
    multi-action chains, and a collapsible rules-reference appendix (hit
    location B552, size/speed-range B550) with source citation. Appears only
    for GURPS vaults; non-GURPS PCs are unaffected.
  - **Equipment tab** — Phoenix-styled inventory table + per-load-out tables
    with totals footer. Parses `## Equipment` and `### Encumbrance` / `### Load-Outs`
    subsections from the PC body.
  - Always-on footnote legend, page citations (`{p. Bxxx}`), and parry/block
    sub-lines on skill rows. Dark/light theming via CSS variables. Print styles
    force all tabs visible and rules-reference open.
  - Parser hardening: header-row guard, cost-column auto-detection, encumbrance
    subsection fallback, skill cross-reference to active defenses and melee
    weapon parry values.

---

## [1.7.6] — 2026-06-28

### Fixed

- **Non-Earth campaign dates are no longer corrupted.** Three skills told
  agents that `in_game_date` "must be parseable by JS `new Date()`"
  (`session-wrapup`, `vault-ingest`, and the shared
  `session-document-chain.md`). That was wrong: the published timeline
  parser (`tools/publish/lib/timeline.js`) anchors on a 4-digit year and
  accepts ISO, month-name, and seasonal forms — it does not require a
  `new Date()`-parseable string. A compliant agent following the old rule
  would *fabricate* a Gregorian date for a fantasy/sci-fi calendar (e.g.
  rewriting "14th of Flamerule, 1492 DR" as "July 14, 1492"), silently
  losing the campaign's real date. The rule now says to record non-Earth
  dates in the world's own format and never invent a Gregorian date to
  satisfy the parser. `play_date` is clarified as `YYYY-MM-DD`.

---
## [1.7.5] — 2026-06-27

### Changed

- **The PC `## Current Status` block is now load-bearing.** PR #57 made it
  a canonical, cumulative PC body block but left it read only by the
  website and the GM. Four skills now consume it: **session-prep** folds
  each active PC's `Open threads` into its Threads review (fixing
  "thread-decay" — a thread no longer vanishes just because it fell out of
  the last session's carry-forward) and reads `Open threads` /
  `Knows (exclusive)` in its per-PC arc check; **the-midwife** mines it for
  new-chapter hooks; **ttrpg-expert** routes its arc/thread commands
  through it; **campaign-qa** gains a Canon Audit consistency check
  (missing/empty block on an active PC, or an `Open threads` item the
  timeline shows resolved). The read contract lives in
  `ttrpg-expert/arc-spotlight-reference.md` and `continuity-engine.md`
  (the bottom-level references the others already load), with a
  `Consumed by:` pointer in `shared/entity-schema.md`. A new
  `tests/test_current_status_consumers.py` regression (run in CI) fails if
  any consumer is silently un-wired. No schema or template change.

## [1.7.4] — 2026-06-26

### Fixed

- **session-wrapup now keeps PC entity sheets current.** Wrap-up advanced
  each active PC's Story file (Step 3b) and the campaign overview (Step 4b)
  every session, but never the PC's own entity sheet — so its `asOfSession`,
  `lastUpdated`, chapter `tags`, and especially the player-facing
  `## Current Status` block froze at whatever session it was last hand-edited.
  Because `## Current Status` publishes (it sits outside the `<!-- gm-only -->`
  fence), the live character page rendered a stale status that contradicted
  the current Story narrative on the same page. A new **Step 3c (PC Sheet
  Refresh)** reconciles those fields and the `## Current Status` block every
  wrap-up, skipping `dead` PCs.

### Added

- **`## Current Status` is now a canonical PC body section.** Documented in
  `shared/entity-schema.md` and added to all six `pc-*` templates as a
  skill-maintained, player-facing block holding the PC's **cumulative living
  state** in labelled fields (`Location`, `Condition`, `Carrying`,
  `Open threads`, `Knows (exclusive)`) — the counterpart to the protected
  `## Notes`/`## GM Notes`. Each wrap-up reconciles it cumulatively:
  unresolved `Open threads` carry forward across sessions, new ones are
  added, resolved ones removed — so a single read of the latest sheet gives
  the always-current state without walking old wrap-ups. Existing sheets
  self-heal on their next wrap-up.
- **PC freshness check** (`validate_schema.py freshness <vault>`): flags
  active PC entity sheets whose `asOfSession` lags the campaign overview's,
  with a Python regression suite (`tests/test_pc_freshness.py`) and fixture.
  Pointed at a vault with the old behaviour it fails; after a wrap-up it
  passes — guarding the drift from returning.

---

## [1.7.3] — 2026-06-26

### Fixed

- **"NPCs in Play" now reflects who's actually in recent play.** `scoreByRecency`
  identified recent sessions by `session_number`, which breaks when a chapter
  restarts numbering (Calcutta 1–3 ranked below Vienna 12–14), so the landing
  surfaced old NPCs. It now selects recent sessions by `play_date`, scores
  mentions from the paired **wrap-up recaps** (the session index pages are thin
  stubs), counts sessions that are still in the `wrap-up` state (played but not yet
  reviewed), and **recency-weights** so the latest session counts most. Terminal-status
  entities (dead, destroyed, …) are no longer hidden outright — they appear when
  they feature in the **latest** session (e.g. an NPC who just died) and are
  otherwise retired from the list.

---

## [1.7.2] — 2026-06-26

### Fixed

- **Landing page reflects authoritative campaign state.** The hero (in-game date
  and session count) and the *Latest Session* card now read `current_game_date`,
  `sessions_played`, `last_session`, and `last_play_date` from the `_Campaign`
  overview frontmatter (maintained by `session-wrapup`) instead of re-deriving
  them by scanning session pages. The overview is located by its
  `type: campaign_overview` frontmatter — not by filename, so a renamed overview
  such as `Campaign_Overview_Updated` still works — and is read from the full
  vault corpus, so it applies even though the overview is normally excluded from
  publishing. `getLatestSession` now sorts by `play_date` (most recently played),
  with `session_number` only as a tiebreak, so chapters that restart session
  numbering no longer surface the wrong "latest" session. All fields fall back to
  the previous behaviour when absent.

### Internal

- `build` now exposes the full scanned corpus to the landing template, kept
  separate from the manifest publish-filter that governs what is rendered.

---

## [1.7.1] — 2026-06-06

### Added

- **Content-fidelity shared rule** — `skills/shared/content-fidelity.md`
  establishes preserve-by-default for content-moving operations: moving
  existing prose preserves it verbatim; authoring new prose is an explicit,
  justified exception. Includes the block/seam test for mixed operations.
- **Compactor rationale category** — the skill-compactor now treats rule
  rationale ("why") as a preserved category, so the reasoning behind a rule
  is not stripped as verbose connective tissue.

### Changed

- **Fidelity guards across skills** — the-midwife (plan promotion, brief
  synthesis), campaign-organizer (Organize, Dissect, Weave), session-wrapup
  (recap, character story, new entities, timeline), vault-ingest (synthesis,
  backstory entries), and session-prep now carry explicit preserve-guards or
  grudging authoring carve-outs pointing at `content-fidelity.md`.
- **campaign-organizer Dissect** — removed the "body summary" instruction;
  each entity now carries its source slice verbatim rather than condensing it.

---

## [1.7.0] — 2026-05-30

### Added

- **Plan entity type** — new `plan` entity under `narrative`
  hierarchy with `plan_type` discriminator (arc, scene,
  investigation, timeline). Plans live in `Planning/` under
  their chapter directory, capturing the GM's narrative
  planning content (scene designs, arc structures,
  investigation flows, timelines) as first-class vault entities.
- **Plan template** — `skills/shared/templates/plan.md` added
  as canonical template for plan entities
- **Midwife plan promotion** — Phase 4 handoff now promotes
  narrative planning content from `_midwife/` to vault
  `Planning/` folder alongside existing entity promotion
- **Session prep plan surfacing** — context gathering reads
  `Planning/` and surfaces relevant scene plans for the
  upcoming session
- **Session play plan lookup** — scene plans accessible via
  mid-game routing table
- **Campaign QA plan validation** — graph health checks
  validate plan entity frontmatter and references
- **Vault ingest plan support** — planning content from
  external sources can be ingested as plan entities
- **Schema validation** — `validate_schema.py` validates
  plan entities (required fields, plan_type enum)
- **Migration 1.6.6 → 1.7.0** — documents structural and
  content changes for existing vaults

---

## [1.6.6] — 2026-05-28

### Added

- **World evolution in reconcile** — reconcile step 5.5
  offers faction turns, consequence surfacing, foreshadowing
  review, and discovery state updates after session confidence
  is promoted. Gated to most recent session only.
- **`world-evolution` entity source** — entities created by
  the world-evolution procedure are tagged with
  `source: "world-evolution"` for provenance tracking
- **`world_evolved` session field** — session index records
  when world-evolution has run, preventing duplicate offers

### Removed

- **campaign-tracker.md references** — removed dead reference
  from campaign-organizer. The file was never created; its
  functionality is covered by the entity schema and session
  document chain.
- **Tracking templates** — replaced consequence tracker,
  foreshadowing log, campaign tracker, and per-PC discovery
  state templates in world-evolution.md with a pointer to the
  entity schema where these are now tracked

### Changed

- **world-evolution.md** — Storage Checkpoint and timeline
  entry marked standalone-only (reconcile skips both). Filing
  protocol updated for reconcile handoff.

## [1.6.5] — 2026-05-22

### Added

- **Heritage page template** — stat card (lifespan, maturity,
  height), notable traits badges, portrait, relationship graph,
  and context sidebar for published heritage pages
- **World domain page template** — rules sidebar (hideable via
  `publish_rules: false`), summary subtitle for world domain
  pages
- **World nav group entries** — World Overview and Heritages
  added to the World navigation group
- **Vault config template** — `_World` and `Heritages` folder
  mappings added to scaffold template

### Fixed

- **Landing page recap** — now extracts narrative from the
  session's Wrap-Up file instead of the session index
- **Landing page recap link** — points to the Wrap-Up page
  instead of the session index
- **Wrap-up sidebar suppression** — wrap-up pages no longer
  show a "Mentioned In" backlinks sidebar that compressed
  content
- **World flags exclusion** — `_flags.md` (`type: world_flags`)
  is skipped during build instead of generating an error page

### Fixed (upstream from publish-patches-1.5.1)

- **Session count includes reviewed status** — landing page hero
  now counts both `played` and `reviewed` sessions; supports
  `total_sessions` config override
- **Chapter status fallback** — chapters with `status: complete`
  in frontmatter render correctly even without published session
  index files
- **Scanner uses frontmatter title** — `displayTitle` prefers
  frontmatter `title` over filename, fixing redundant session
  titles on chapter index pages

---

## [1.6.4] — 2026-05-22

### Added

- **Session-prep deferred flag surfacing** — world threads
  gaining traction are surfaced during prep (awareness only,
  no prompts)
- **Campaign-QA world consistency audits** — heritage
  consistency, geographic plausibility, economic coherence,
  timeline contradictions, and deferred flag review
- **World audit criteria reference** — hard checks vs soft
  checks, scoping rules, output format

---

## [1.6.3] — 2026-05-22

### Added

- **Session-wrapup world fact detection** — scans session notes
  for unrecognized heritages, place names, cultural practices,
  deity names, and other world facts; stages findings for
  reconcile review
- **Reconcile step 2.5** — world fact review with three-state
  prompts (canon/ignore/defer) during post-session reconciliation
- **Reconcile step 5 world-rule validation** — checks entities
  against `_World/` rules during promotion to AUTHORITATIVE
- **Deferred flag accumulation** — mention counting and
  resurfacing for deferred world facts
- **World fact detection heuristics** — signal/noise distinction
  reference for session-wrapup scanning

---

## [1.6.2] — 2026-05-22

### Added

- **Entity validation against world rules** — campaign-organizer
  checks NPCs, locations, and factions against `_World/` domain
  rules during creation and updates
- **Three-state flag prompts** — violations surface as advisory
  prompts with canon/ignore/defer responses
- **Ad-hoc bootstrap** — world infrastructure created on demand
  when validation needs a domain file that doesn't exist yet

---

## [1.6.1] — 2026-05-22

### Added

- **Midwife standalone worldbuilding mode** — why-chain
  conversations for fleshing out world domains, with per-domain
  question banks, cross-domain implication surfacing, and
  Second-Order Notes
- **Midwife woven worldbuilding** — one-question why-chain
  prompts during adventure creation when world facts are implied
- **Worldbuilding reference files** — question banks (10
  domains), cross-domain implication matrix, spiral/iceberg
  principles, pitfall avoidance
- **TTRPG-expert worldbuilding advisory** — principles reference
  with per-system notes and midwife handoff
- **Worldbuilding benchmarks** — A1-A6 purposeful worldbuilding
  and C2 adventure creation regression

---

## [1.6.0] — 2026-05-22

### Added

- **Heritage entity type** — first-class vault entity for species/ancestry
  definitions with lifespan ranges, maturity age, notable traits, and
  Second-Order Notes
- **`_World/` vault layer** — 10 domain files for world rules (heritages,
  geography, history, politics, economics, magic/technology, cosmology,
  culture, ecology, language), each with machine-checkable rules
- **Three-state flag system** — `_flags.md` tracks world facts as canon,
  ignored, or deferred with accumulation and resurfacing
- **Organization hierarchy** — `part_of` field on faction/organization
  entities enables nested political, military, and religious structures
- **Era field** — optional `era` universal field for temporal referencing
  against world history eras
- **World structural templates** — world-index, world-flags, world-domain,
  heritage, and faction templates in `skills/shared/templates/`
- **Schema validation** — `heritage`, `world_domain`, `world_flags` types
  and `WORLD_DOMAIN_STATUS` enum in `validate_schema.py`
- **Benchmark fixtures** — `_World/` and `Heritages/` test data in
  benchmark campaign

---

## [1.5.3] — 2026-05-16

### Added

- **Gotchas sections** — consolidated critical constraints with inline
  reasoning added to vault-ingest (5) and the-midwife (4). Placed
  before workflow steps to front-load common failure modes.
- **Validation loops** — inline self-check steps after entity creation
  in vault-ingest and the-midwife. Re-read file, compare frontmatter
  against template, verify type/confidence/wiki-links, fix before
  proceeding.
- **Why-reasoning** — downstream-consequence explanations added to bare
  directives in vault-ingest (vault dependency) and the-midwife
  (session-prep invocation).
- **Benchmark questions** — new test suites for vault-ingest (4 Qs) and
  the-midwife (4 Qs), matching the existing session-wrapup and
  campaign-organizer format.

---

## [1.5.2] — 2026-05-12

### Added

- **Campaign overview template** — new `campaign_overview` entity type
  with frontmatter for game date, session tracking, and narrative
  position (arc/chapter progress).
- **Session-wrapup auto-updates** — campaign overview mechanical fields
  (game date, session count, last session, last play date) updated
  after each wrap-up with GM confirmation.
- **The-midwife integration** — creates campaign overview during vault
  scaffolding, populated from the adventure brief conversation.
- **Publish tool rendering** — campaign landing page shows new sections
  (Premise, Setting, Key Themes, Key Factions) with game date and
  current arc param cards.

### Changed

- Publish tool landing page replaces Known Threats / Key Organizations
  / Key Individuals sections with Setting and Key Factions.

---

## [1.5.1] — 2026-05-09

### Added

- **the-midwife skill** — guided adventure creation through
  creative conversation. Handles greenfield campaigns and
  existing vault continuations (new chapters, arcs, prequels,
  time jumps). Produces an adventure brief and scaffolds the
  vault for Session 0 handoff.
- **adventure-brief entity type** — new entity under
  `narrative (abstract)` for structured adventure design
  documents with scope, shape, and continuation metadata.
- **Adventure Shapes framework** — structural skeleton
  taxonomy (linear, branching, hub-and-spoke, open-node,
  sandbox) in scenario-writing reference.
- **CATS pitch method** — Concept/Aim/Tone/Subject session 0
  pitch framework in gm-session-patterns reference.
- **One-shot and few-shot structural guidance** — conception-
  phase constraints and principles in scenario-writing
  reference.
- **Victory-state antagonist design** — reverse-engineering
  villain plans from victory state in scenario-writing
  reference.
- **Playability stress test** — checklist for testing RPG
  viability of adventure concepts.
- **Midwife workspace** — per-adventure working directories
  with automatic topic splitting, shared seed bank, and
  context-aware reading. Replaces monolithic
  `_midwife-notes.md`. Supports multiple adventures in
  parallel.
- **Adventures/ subfolder convention** — adventure briefs
  now live in `Adventures/{adventure-name}/` subdirectories.
- **`_midwife/` vault folder** — creative workspace added
  to vault structure for midwife working files.

## [1.5.0] — 2026-05-09

### Added

- **FitD: gathering-information.md** — SRD gathering info mechanics:
  effect levels, action-specific questions, long-term projects, GM
  guidance for calibrating disclosure
- **FitD: cohorts.md** — consolidated cohort rules: gang types, experts,
  edges/flaws, cohort harm, supervised vs unsupervised use, elite
  upgrades
- **FitD: gm-techniques.md** — practical GM reference: consequence
  fiction with original examples, devil's bargain design, position/effect
  3×3 matrix, clock patterns and anti-patterns
- **FitD: rituals-crafting.md depth pass** — 4 original example rituals
  (ward, compulsion, divination, transformation) and 4 sample
  alchemicals/gadgets with drawbacks
- **Personal reference file routing** — ttrpg-expert, session-play,
  session-prep, and session-wrapup skills now discover and use
  `systems/*/personal/` directories for setting-specific content

### Changed

- **FitD copyright compliance** — stripped Doskvol setting IP from all
  public FitD files. Named factions, NPCs, heritage regions, and
  setting descriptions removed or genericized. Faction mechanics, crew
  frameworks, and playbook role descriptions preserved as SRD content.
- **FitD: factions.md** — retitled "Faction Mechanics", reduced from
  171 to 77 lines. Named factions removed; faction status table, tier
  rules, claims, and faction turn procedure retained.
- **FitD: setting-doskvol.md deleted** — pure setting IP, replaced by
  personal reference files

### Removed

- **FitD: setting-doskvol.md** — Doskvol setting content (not covered by
  CC-BY 3.0 SRD license)

---

## [1.4.22] — 2026-05-08

### Fixed

- **Timeline date parsing** — timeline now reads `in_game_date` (falling
  back to `date` for pre-migration vaults). Vague dates like "Autumn 1813"
  now parse to approximate months instead of defaulting to January 1.
- **Chapter-session matching** — chapter pages now find their sessions via
  three-stage matching (exact filename, filename with spaces, display title
  substring). Previously failed when session `chapter:` values didn't
  exactly match the chapter page title.
- **Genre preset override** — custom theme.css no longer stomps genre
  preset colors when no custom palette is provided. Config sets palette to
  null instead of spreading defaults.
- **Stale npm detection** — publish-site routine updates now check the
  build tool version against the plugin cache and auto-update the `file:`
  dependency path if stale.

### Changed

- **Schema: event `date` → `in_game_date`** — event entity frontmatter
  field renamed for consistency. Migration 1.4.22 auto-applies the rename.
- **Schema: session `planned_date`/`actual_date` → `play_date`** — two
  legacy fields consolidated into one. Migration 1.4.22 picks the
  `actual_date` value (or `planned_date` if that's all that exists) and
  removes both old fields.
- **Session wrap-up conventions** — standardized filename
  (`Session_NN_Wrap_Up.md`), frontmatter type (`session_wrap`), and date
  format guidance (JS-parseable values only).
- **Publish tool field references** — landing page, location pages, badges,
  and event sorting all use new field names with backward-compatible
  fallbacks.

### Added

- **Migration 1.4.22** in `shared/migrations.md` — structural renames for
  event and session date fields; opt-in wrap-up `type` standardization
- **Deprecation warnings** in `validate_schema.py` — flags `date` on events
  and `planned_date`/`actual_date` on sessions
- **`session_wrap` type** recognized in schema validation alongside legacy
  `session-wrap-up`

## [1.4.21] — 2026-05-06

### Added

- **Story progression page** (chapters index) — chapter cards with session lists, status badges
- **Bestiary page** (creatures index) — dossier cards with threat/status badges, abilities/weaknesses pills
- **Theater of Operations** (locations index) — region-grouped layout with parent/child nesting
- **Intelligence Briefing** (factions index) — cards grouped by type with goals, leadership, connections
- **Armory & Acquisitions** (items index) — manifest rows grouped by item type with holder/origin/TL
- **Campaign deep dive** — extracted sections from campaign overview with resolved wikilinks
- **GURPS combat stats bar** on PC sheets — HP, FP, Speed, Move, Dodge, Parries, skills
- **Events index redirect** to timeline page
- **Schema change procedure** checklist (`docs/schema-change-procedure.md`)
- **`in_game_date` array support** for multi-day sessions in timeline

### Fixed

- PC portrait now constrained card layout instead of full-width crop
- Tab-tag clicks now open corresponding accordion section on PC pages
- Empty Relationships/Appearances boxes hidden on PC pages
- Weapons/encumbrance sections moved to Equipment tab (not Sheet)
- Bestiary badges now labeled "Threat:" / "Status:" for clarity
- Nav label "Chapters" renamed to "Story"
- Integration test updated for new locations/creatures page structure

### Changed

- Publish tool npm package bumped to 1.2.1 (patch: QA fixes + index page overhauls)

## [1.4.20] — 2026-05-04

### Added

- **Dark-first responsive CSS** with CSS custom properties and mobile-first breakpoints
- **4 genre preset themes** (horror, fantasy, noir, military) with dark + light mode variants
- **Semantic top navigation** with 4 groups: Story, Characters, World, Reference
- **Breadcrumbs** on all entity pages with path-based crumb generation
- **Backlink resolution engine** — scans wiki-links to build reverse index
- **Recency scoring engine** — weights entities by recent session mentions
- **Full-text search** with lunr.js (Cmd+K overlay, lazy-loaded index)
- **Image lightbox** — pure JS lightbox for all content images
- **8-zone landing page** — hero, recap, team, in memoriam, NPCs, locations, events, explore
- **Index pages** with pill filters, name search, sort controls, and type-specific layouts
- **Context sidebar** on all entity pages showing backlinks, relationships, and parent entity
- **Location pages** with 6-zone layout: hero banner, pull-quote, sub-locations, NPCs, events
- **NPC pages** with 6-zone layout: portrait banner, location card, relationship web, story arc
- **PC pages** with cinematic hero banner and 4-tab layout (Sheet, Equipment, Story, Journey)
- **4 system-specific character sheet renderers** — CoC 7e, GURPS 4e, D&D 5e, FitD
- **SVG relationship graphs** with 2-hop radial layout on all entity pages
- **Campaign timeline** — full-page SVG with zoom controls and landing strip
- **Story/chapter nav** with prev/next links and enriched sidebar (NPCs, events, sessions)
- **Client-side index filters** — pill toggle, name input, sort-select for index pages
- **session-wrapup** gmassistant.app passthrough — when Play Notes are a gmassistant.app export (detected by `## Memorable Moments` heading), adopts the app's narrative summary verbatim and uses its structured NPC/Location/Item sections as entity input instead of regenerating from scratch

### Fixed

- `getLatestSession` now includes `reviewed` sessions (not just `played`)
- `formatDate` no longer shifts dates by timezone offset (UTC parsing fix)

### Changed

- Publish tool npm package bumped to 1.2.0 (minor: new features, no breaking changes)
- Location, NPC, PC, and wiki templates fully rewritten with modern layouts

## [1.4.19] — 2026-05-03

### Added

- Confidence badges in published sites (Draft, Stub, Superseded)
- `exclude_drafts` publish config option to filter DRAFT entities from sites
- Stale DRAFT detection in campaign-qa (WARNING after 3+ sessions)
- SUPERSEDED entities must declare `superseded_by` (enforced in CI)
- Session 4 + confidence test entities in benchmark campaign

### Fixed

- Publish tool now reads `source_confidence` field (was checking nonexistent `canon_status`)
- SUPERSEDED link-map redirect now works against real vault entities

## [1.4.18] — 2026-05-03

### Changed

- **session-play enrichment** — expanded from 80 to 129 lines with direct routing for common mid-game needs (rules disputes, improv NPCs, spotlight management, combat pacing, scene recovery)
- Added Common Mid-Game Lookups routing table pointing to exact files and sections in ttrpg-expert
- Added Capture Shorthand section documenting entity extraction markers (`NEW-NPC:`, `NEW-LOC:`, `UPDATE:`, etc.) that session-wrapup expects
- Explicit companion reference to `active-play-management.md` for GM-craft advice during play

### Removed

- Fix 9 (Filesystem Mode Honest Labeling) dropped from Fix and Fortify design spec

---

## [1.4.17] — 2026-05-03

### Changed

- **D&D monster data enrichment** — 235 monster stat blocks expanded with full SRD 5.2 combat data: ability scores, attack bonuses, damage dice, save DCs, traits, and legendary actions
- Monster CR 11+ split into `cr11-16` and `cr17-plus` sub-files for headroom
- ATTRIBUTION.md updated with expanded SRD 5.2 content note

### Fixed

- Enricher script: combat traits (Heated Body, Trampling Charge) no longer stripped in normal mode
- Enricher script: two-stage save abilities (Paralyzing Breath, Petrifying Breath) now fully parsed
- Enricher script: spellcasting-style actions (Ice Wall, Hellfire Spellcasting) now rendered correctly
- Enricher script: SRD path configurable via CLI argument; size limit aligned to 25 KiB
- Corrupted spell rows fixed: Forcecage, Fly, Knock, Moonbeam, Freedom of Movement, Greater Invisibility
- Missing magic item effects restored: Ring of Telekinesis, Wand of Fear, Belt of Dwarvenkind
- CI lint: `find` command no longer fails when `references/` directory is absent
- Missing migration registry entries for 1.4.16 and 1.4.17 added

---

## [1.4.16] — 2026-05-03

### Added

- **D&D response templates** — spell lookup/browse, magic item lookup/browse, and monster standard/boss templates added to index file headers

---

## [1.4.15] — 2026-05-02

### Changed

- **D&D reference decomposition** — spells.md (79KB), magic-items.md (40KB), and monsters.md (23KB) split into compact indexes + sub-files; no sub-file exceeds 25KB
- CI enforces 25KB reference file size limit

---

## [1.4.14] — 2026-05-02

### Fixed

- Migration version auto-synced from plugin.json at build time
- Content filtering now makes deterministic decisions for cut/skipped/modified scenes

### Added

- Reconcile fast-path for straightforward sessions
- Proof-run infrastructure: 5-run statistical benchmark with median/IQR analysis
- CI checks: migration version sync, content filtering validation

---

## [1.4.13] — 2026-05-02

### Fixed

- **Session-prep: GM approval gate** — Step 13 (Scene Design) now
  proposes each scene to the GM before writing it to the Plan file.
  The GM approves, tweaks, or rejects each scene individually.

---

## [1.4.12] — 2026-05-01

### Added

- **Development workflow** — CLAUDE.md now documents the required
  branch → implement → version bump → changelog → review → PR → merge
  sequence for all non-trivial changes
- **PR discipline checks** — CI warns on missing version bumps and
  changelog updates; blocks on broken build script output

---

## [1.4.11] — 2026-05-01

### Added

- **Automated releases** — GitHub Action creates tagged releases with
  skill zips on version bump; skill zips attached as release assets
  for users who can't install plugins
- **Build script** — `scripts/build-skill-zips.sh` packages each skill
  as a self-contained zip with shared references bundled
- **Individual skill upload docs** — README and quickstart updated with
  instructions for uploading skill zips to Claude Desktop

### Fixed

- **ttrpg-expert description** — trimmed to 983 chars to fit the
  1024-character limit for skill descriptions
- **Claude Desktop install instructions** — updated for the new
  Cowork > Customize > Personal plugins UI flow
- **Stale skill counts** — README Obsidian section and quickstart now
  reference all 8 skills

---

## [1.4.10] — 2026-05-01

### Fixed

- **GURPS PC template** — Skills and Spells sections now enforce single alphabetized tables with no category sub-headings
- **Mobile: accordion table scroll** — Wide tables inside accordion sections scroll horizontally on mobile instead of overflowing
- **Mobile: back-to-top button** — Fixed-position button appears after 400px scroll on all published pages

---

## [1.4.9] — 2026-04-26

### Added

- **Vault versioning and migration system** — vaults now track `gm_apprentice_version` in vault-config; every vault-aware skill checks the version on first invocation and runs campaign-organizer's migration workflow if the vault is behind the plugin version
- **Migration registry** — `skills/shared/migrations.md` defines the current version and per-version migration steps in three categories: structural (auto), content (opt-in), and tooling (opt-in)
- **Publish site directory in vault-config** — `publish.site_dir` field stores the site repo path so the publish-site skill reads it directly instead of asking each session
- **Vault-config field documentation** — entity schema now documents all vault-config frontmatter fields

---

## [1.4.8] — 2026-04-26

### Added

- **Tabbed PC page layout** — published PC pages now show Character Sheet and Story in a two-tab layout with hash-based routing (`#sheet`, `#story`) for direct-linking
- **Story companion rendering** — `{Name}_Story.md` files auto-discovered alongside PC files and rendered as prose narrative in the Story tab; validated via `type: character-story` frontmatter
- **System renderer registry** — dispatch architecture (`pc-registry.js`) decouples layout from system-specific rendering; ships with default renderer, ready for per-system overrides
- **Enhanced stat sheet CSS** — alternating row shading, monospace numeric values, responsive table collapsing, serif prose sections, print styles for tabbed layout

### Changed (publish tool)

- Publish tool version bumped to 1.1.0

---

## [1.4.7] — 2026-04-26

### Added

- **Story lifecycle** — session-wrapup Step 3b writes per-PC character story entries after each session; vault-ingest reconstructs consolidated backstory entries from historical material and recognizes wrap-up files as a source type; campaign-qa Graph Health validates story file existence and recency for active PCs

---

## [1.4.6] — 2026-04-25

### Added

- **Character sheet templates** — 8 canonical vault templates in `skills/shared/templates/` covering GURPS 4e, CoC 7e (base + Regency variant), D&D 5e 2024, FitD (scoundrel + crew), and a generic fallback
- **Character story format** — `skills/shared/character-story-format.md` defines companion story file structure, narrative voice by campaign genre, writing rules, and append protocol
- **PC body structure in entity schema** — canonical heading hierarchy (Stat Sheet → Background → System Sections → Equipment → Notes → GM Notes) and story companion convention documented in `entity-schema.md`

---

## [1.4.5] — 2026-04-25

### Added

- **Skill taxonomy table** in README — documents all skill categories, roles, and boundaries with the advisor/doer distinction
- **ttrpg-expert capabilities table** in `docs/ttrpg-expert.md` — maps all 18 functions to their reference files
- **the-midwife** added to roadmap — planned adventure creation skill with guided creative persona
- vault-ingest added to README Skills table (was missing)

### Changed

- ttrpg-expert description rewritten to clarify advisor-only role with zero dependencies on other skills
- Removed all remaining hardcoded model names: inline `**Model:** Sonnet` from vault-ingest Phases 1-2, `Sonnet/Haiku` from session-wrapup sub-agent guidance

---

## [1.4.4] — 2026-04-25

### Added

- **vault-ingest image handling** — images arriving via folder, one-at-a-time, or mixed batch are classified, filed to the correct `_attachments/` subfolder, and linked to entities via `portrait` frontmatter or `![[embed]]` body syntax
  - Format conversion (best-effort via `sips`/`magick`, skip with message if unavailable)
  - Filename-based entity matching (exact slug → batch → suffix strip)
  - Duplicate detection (identical files skipped, different-content conflicts flagged for GM)
  - Keeper interview questions for unmatched images and portrait selection
  - New reference: `skills/vault-ingest/references/image-handling.md`
- Roadmap item: remove model-specific prescriptions from all skills

### Changed

- vault-ingest model selection table uses complexity guidance (Light/Heavy) instead of hardcoded model names
- Classification taxonomy Image/map row expanded with supported formats and reference pointer

---

## [1.4.3] — 2026-04-23

### Added

- **displayTitle + template overhaul** — `displayTitle` on all page objects, data-driven `display_meta` PC meta row, Team/Fallen landing split with SVG status icons
- `display_meta` field added to PC entity schema and publish-site schema reference
- Character generation references updated with `display_meta` defaults

### Changed

- All publish templates switched to `displayTitle` for rendering
- Landing page roster split into The Team and The Fallen sections
- Relationship link display text replaces underscores with spaces

---

## [1.4.2] — 2026-04-22

### Added

- **vault-ingest skill** — ingests old campaign materials (notes, character sheets, images, transcripts, spreadsheets) into a structured vault via a six-phase pipeline: survey, sort, extract, keeper interview, synthesize, review
  - Classification taxonomy, keeper interview technique, and synthesis templates as references
  - Benchmark questions and campaign fixtures
- **Session document chain** — standardised naming and type conventions for session files (Plan, Play Notes, Wrap-Up)
  - Shared reconcile procedure for GM review workflow
  - All three session skills updated for document chain
  - Benchmark campaign converted to document chain format

### Changed

- Plugin description updated for seven-skill lineup
- vault-structure.md updated with `_inbox/` and document chain naming

---

## [1.4.1] — 2026-04-21

### Added

- **Arc-spotlight reference** — pure GM framework reference for dramatic arc planning, spotlight rotation, and session pacing
- Creative planning benchmark questions for session-prep

### Changed

- **session-prep refactored** — unified gather-plan-verify workflow replacing the older session-planner approach
  - Prep note template rewritten with progressive write sections
  - System-specific arc drivers folded into session-procedures files
- ttrpg-expert routing updated for advisor/doer split
- Compaction pass on arc-spotlight-reference and session-prep workflow

### Removed

- `skills/session-prep/references/session-planner.md` — replaced by arc-spotlight-reference + unified workflow

---

## [1.4.0] — 2026-04-20

### Added

- **session-prep skill** — dedicated between-sessions preparation with two-phase reconcile/prep-forward workflow, status-gated reconciliation (`played` → `reviewed`), and sub-agent opportunity for parallel vault reads
- **session-play skill** — speed-optimised at-the-table assistant for quick lookups, rules questions, on-the-fly content generation, and play note capture
- **session-wrapup skill** — post-session processor turning raw play notes into canon: narrative recaps, entity creation, event decomposition, timeline updates, and carry-forward package
- **Shared session-principles** (`skills/shared/session-principles.md`) — common rules, vault integration, and canon workflow shared across all three session skills
- **Benchmark infrastructure** — per-skill benchmark questions and 3-run blind A/B evaluation results for the session split

### Changed

- **session-lifecycle replaced** — the monolithic 491-line skill is split into three focused skills (402 total lines, 18% reduction) with quality improvement confirmed across 3 benchmark runs
- Plugin description updated to reflect the six-skill lineup
- campaign-qa companion skill references updated for the three-way split
- campaign-organizer, ttrpg-expert references updated
- User-facing docs split into per-skill pages (`docs/session-prep.md`, `docs/session-play.md`, `docs/session-wrapup.md`)
- `docs/campaign-lifecycle.md` and `docs/quickstart.md` updated for new skill names

### Removed

- `skills/session-lifecycle/` — replaced by session-prep, session-play, session-wrapup
- `docs/session-lifecycle.md` — replaced by per-skill docs

---

## [1.3.1] — 2026-04-19

### Added

- **Event dedicated template** — site template, vault template, and session-lifecycle event decomposition
  - `parseParticipant()` supports three formats: `[[Entity]] (role)`, `[[Entity|Display]] (role)`, plain text
  - Location wiki-link alias parsing (`[[Target|Display]]`)
  - Event threshold criteria for coarse-grained event decomposition in wrap-up
  - CSS: outcome callout and participants list styling

### Changed

- Entity schema: `eventType` renamed to `event_type`, `significance` field removed
- Session-lifecycle wrap-up: timeline entries now use linked vs inline format
- Roadmap: favicon generation demoted, event template marked completed

---

## [1.3.0] — 2026-04-19

### Added

- **publish-site skill** — new skill guiding the vault-to-website publishing workflow
- **gm-apprentice-publish npm package (v1.0.0)** — static site generator featuring:
  - Dashboard landing page and PC roster cards
  - NPC scoring and player-mode content/image filtering
  - Themed 404 page
  - Wiki-link resolution and image embed support
  - Relationship rendering
  - Configurable folder mapping and attachment directory
  - CLI entry point
- Pulp Cthulhu variant added to roadmap backlog

### Fixed

- Path traversal guard — bidirectional vault boundary check prevents escaping the vault root
- XSS prevention — HTML escaping applied across all site generator templates

---

## [1.2.0] — 2026-04-12

### Added

- **Regency Cthulhu variant** — skills overlay, occupations, equipment, chargen rules, GM guidance, routing, and benchmark question sets
- **Shared references directory** (`skills/shared/`) — deduplicated entity schema, frontmatter conventions, file format standards, and RPG terminology available to all skills
- **Benchmark infrastructure** — synthetic campaign, question sets, and baselines under `tests/`
- **CI checks** — markdown lint, consistency checks, and relative path validation
- **CLAUDE.md** — copyright compliance rules, GURPS usage constraints, commit conventions, and roadmap workflow
- **Force-ranked ROADMAP.md** backlog with scoring formula
- Image attachment support for campaign-organizer
- Installation instructions for all platforms (Claude Code, Desktop, VS Code, Cursor, JetBrains)
- Cross-routing prompts in all reference and framework files

### Changed

- Compacted 20+ reference and framework files (30–60% token reduction)
- campaign-qa and session-lifecycle now fall back to filesystem when no vault path is configured

---

## [1.1.0] — 2026-04-06

### Added

- Initial public release
- Four skills: `ttrpg-expert`, `campaign-organizer`, `campaign-qa`, `session-lifecycle`
- System support: Call of Cthulhu 7e, GURPS 4e, Forged in the Dark, D&D 5e 2024
- GURPS archetype chargen kits and reference files
- Plugin marketplace packaging (`.claude-plugin/plugin.json`, `marketplace.json`)

---

[1.7.1]: https://github.com/AntTheLimey/gm-apprentice/compare/v1.7.0...v1.7.1
[1.7.0]: https://github.com/AntTheLimey/gm-apprentice/releases/tag/v1.7.0
[1.6.6]: https://github.com/AntTheLimey/gm-apprentice/compare/v1.6.5...v1.6.6
[1.6.5]: https://github.com/AntTheLimey/gm-apprentice/compare/v1.6.4...v1.6.5
[1.6.4]: https://github.com/AntTheLimey/gm-apprentice/compare/v1.6.3...v1.6.4
[1.6.3]: https://github.com/AntTheLimey/gm-apprentice/compare/v1.6.2...v1.6.3
[1.6.2]: https://github.com/AntTheLimey/gm-apprentice/compare/v1.6.1...v1.6.2
[1.6.1]: https://github.com/AntTheLimey/gm-apprentice/compare/v1.6.0...v1.6.1
[1.6.0]: https://github.com/AntTheLimey/gm-apprentice/compare/v1.5.3...v1.6.0
[1.5.3]: https://github.com/AntTheLimey/gm-apprentice/compare/v1.5.2...v1.5.3
[1.5.2]: https://github.com/AntTheLimey/gm-apprentice/compare/v1.5.1...v1.5.2
[1.5.1]: https://github.com/AntTheLimey/gm-apprentice/compare/v1.5.0...v1.5.1
[1.5.0]: https://github.com/AntTheLimey/gm-apprentice/compare/v1.4.22...v1.5.0
[1.4.22]: https://github.com/AntTheLimey/gm-apprentice/compare/v1.4.21...v1.4.22
[1.4.19]: https://github.com/AntTheLimey/gm-apprentice/compare/v1.4.18...v1.4.19
[1.4.18]: https://github.com/AntTheLimey/gm-apprentice/compare/v1.4.17...v1.4.18
[1.4.17]: https://github.com/AntTheLimey/gm-apprentice/compare/v1.4.16...v1.4.17
[1.4.16]: https://github.com/AntTheLimey/gm-apprentice/compare/v1.4.15...v1.4.16
[1.4.15]: https://github.com/AntTheLimey/gm-apprentice/compare/v1.4.14...v1.4.15
[1.4.14]: https://github.com/AntTheLimey/gm-apprentice/compare/v1.4.13...v1.4.14
[1.4.13]: https://github.com/AntTheLimey/gm-apprentice/compare/v1.4.12...v1.4.13
[1.4.12]: https://github.com/AntTheLimey/gm-apprentice/compare/v1.4.11...v1.4.12
[1.4.11]: https://github.com/AntTheLimey/gm-apprentice/compare/v1.4.10...v1.4.11
[1.4.10]: https://github.com/AntTheLimey/gm-apprentice/compare/v1.4.9...v1.4.10
[1.4.9]: https://github.com/AntTheLimey/gm-apprentice/compare/v1.4.8...v1.4.9
[1.4.8]: https://github.com/AntTheLimey/gm-apprentice/compare/v1.4.7...v1.4.8
[1.4.7]: https://github.com/AntTheLimey/gm-apprentice/compare/v1.4.6...v1.4.7
[1.4.6]: https://github.com/AntTheLimey/gm-apprentice/compare/v1.4.5...v1.4.6
[1.4.5]: https://github.com/AntTheLimey/gm-apprentice/compare/v1.4.4...v1.4.5
[1.4.4]: https://github.com/AntTheLimey/gm-apprentice/compare/v1.4.3...v1.4.4
[1.4.3]: https://github.com/AntTheLimey/gm-apprentice/compare/v1.4.2...v1.4.3
[1.4.2]: https://github.com/AntTheLimey/gm-apprentice/compare/v1.4.1...v1.4.2
[1.4.1]: https://github.com/AntTheLimey/gm-apprentice/compare/v1.4.0...v1.4.1
[1.4.0]: https://github.com/AntTheLimey/gm-apprentice/compare/v1.3.1...v1.4.0
[1.3.1]: https://github.com/AntTheLimey/gm-apprentice/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/AntTheLimey/gm-apprentice/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/AntTheLimey/gm-apprentice/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/AntTheLimey/gm-apprentice/releases/tag/v1.1.0

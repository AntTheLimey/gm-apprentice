# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Releases before 1.11.0 are in [docs/history/changelog-archive.md](docs/history/changelog-archive.md).

---

## [1.12.148] — 2026-11-25

### Fixed

- The GM site served for the table keeps running until you ask for it to
  stop: `gma publish serve --background` starts it apart from the terminal
  and from the assistant's session, `serve --status` says where it is, and
  `serve --stop` stops it and frees the port, on every OS.

## [1.12.147] — 2026-11-24

### Fixed

- The Cloudflare token steps in the publish guide match Cloudflare's current
  screens (Start from scratch, then a permission search), and the publish
  tool's KV-permission message points at the API tokens page.

## [1.12.146] — 2026-11-24

### Changed

- Saving your Cloudflare token never goes through the chat: the apprentice gives you one line to run in your own terminal, on a Mac, Linux or Windows, and it asks for the token with nothing showing as you paste. On Windows it reminds you to reopen your apps afterwards. The by-hand route finds your Account ID with `wrangler whoami`, since Cloudflare's dashboard no longer shows it in a sidebar (#877). Publish tool 1.70.63.

### Fixed

- On Windows, the publish tool can now start wrangler: checking your Cloudflare login, saving the token and deploying all failed there before (#877).

## [1.12.145] — 2026-11-24

### Fixed

- Turning on `player_site.own_pages` for a page no longer stops the next deploy on leak findings you had already accepted there: an accept on the page's address now also covers its kept copy (#878). Publish tool 1.70.62.

## [1.12.144] — 2026-11-24

### Added

- A page of your own that an after_build step puts on the site, such as a star map, can show the site's menu bar: list its address under `player_site.own_pages` and the build puts it under the bar, unchanged, in a frame filling the window. Add its menu entry with `player_site.menu_extra` (#850). Publish tool 1.70.61.

## [1.12.143] — 2026-11-24

### Fixed

- An NPC or location page with no picture shows its name, details and badges clearly in light mode: the banner keeps the header's colour, and a custom palette whose accent is too dark for its header gets a lighter shade of it there, the same hue (#868). Publish tool 1.70.60.

## [1.12.142] — 2026-11-23

### Changed

- Wrap-up offers a location note for each place you typed into the run sheet during play (a Table Log's New place line), yes or no each (#840).

## [1.12.141] — 2026-11-23

### Fixed

- A site with a long title or extra menu entries no longer scrolls sideways on a tablet or phone: the title is cut short first, and a menu still too wide for the bar folds into the phone menu (#863). Publish tool 1.70.59.

## [1.12.140] — 2026-11-23

### Changed

- A campaign site credits GM-Apprentice more quietly, in three small parts in place of the footer line: a raven at the end of the header on a computer, the raven and a line at the end of every page, and a line at the foot of the phone menu. All take the site's own colours; `player_site.credit` off removes all three (#862). Publish tool 1.70.58.

## [1.12.139] — 2026-11-23

### Fixed

- A session's Story page now shows its `banner:` (or its Wrap-Up's), where readers actually reach the session (#837).

### Added

- `gma image plan` draws scene pictures for a played session note that keeps its own Narrative Recap and has no Wrap-Up, placed after a recap paragraph as in a Wrap-Up (#837). Publish tool 1.70.57.

## [1.12.138] — 2026-11-23

### Fixed

- Player builds stop warning that the Midwife's `Adventures/` folder is "not in player_site.folder_map" (#839). The adventure brief stays off the site until you map the folder, as before; other notes put there are still warned about, and `explain` names the unmapped folder as the reason. Publish tool 1.70.56.

## [1.12.137] — 2026-11-22

### Fixed

- The personal reference files guide and `gma personal --system` now name the `generic/` folder for games without their own, and the guide says each system's folder appears when the first file is saved there (#844).

## [1.12.136] — 2026-11-22

### Fixed

- The run sheet no longer loses a click made just after a slow one (#852). When a click took a moment to handle, the next press could lose its hold, and a redraw under the pointer ate the click; on a slow machine a fold, Fight or Start could do nothing. Publish tool 1.70.55.

## [1.12.135] — 2026-11-22

### Fixed

- `gma image draw --redo` now redraws a picture you held with `place --hold`, instead of saying it "has not been drawn yet" (#835). The redrawn picture waits for a new keep-or-hold verdict; redoing a picture already kept says to plan it again.

## [1.12.134] — 2026-11-22

### Fixed

- On the Connections panel, "From <Name>'s page" now sits on its own line in smaller italics under a tie written on the other note, so it no longer reads as part of the tie's sentence (#824). Publish tool 1.70.54.

## [1.12.133] — 2026-11-22

### Changed

- Only wrap-up marks a session played (#855). Filing a Table Log, Play Notes or an export no longer raises the session's status, so a session in play stays off the player site until you wrap it up.
- The run sheet files its Table Log on the first thing that happens at the table, not when it opens, so a look before game night leaves nothing behind. The session check no longer suggests stamping `played` on a session in play. Publish tool 1.70.53.

## [1.12.132] — 2026-11-22

### Added

- A campaign site's pages end with a small "Powered by GM-Apprentice" line, linked to gmapprentice.com, under your own footer. Turn `player_site.credit` off to take it out; the GM site and a handout's own styled page never show it. The update tells a GM with a site once (`site-credit`) (#849)

### Fixed

- A menu entry that is a link lines up with the menu's buttons (#851)

## [1.12.125] — 2026-11-22

### Added

- The run sheet's fights show each row's side by colour, and three buttons in the acting panel set it (#556).
- A Colours menu offers Pens (green, purple, red and grey), Colour-blind safe or your own, saved as a vault setting. A site tool older than 1.70.47 asks for an update first.
- Add anyone mid-fight by typed name or from the whole cast, with Same for all for a group of copies and an Undo until the new rows first act.
- Fight here starts a beat's own fight, and Move them sends the party to a Plan place or one typed tonight. Places the party goes to show on the players' screen and are linked in the Table Log, so wrap-up offers to publish them.
- The Table Log gains Sides set (the side you set is the next fight's start) and New place lines.
- Allies the Plan or a stat block names start as written; ones inferred from the quick reference, affiliation or relationships start unseen until you show them.
- The party is the session's own PCs, and a Dead End PC's sheet reads in full.

### Changed

- The fight page keeps its pane bar, folds either rail (remembered), drags the pane line, and scrolls a big order in its own box with the turn in view. Statuses no longer widen the order: those that do not fit go on a second line for that row. The page folds a column itself only when the window is too narrow, until you resize.
- Stat boxes keep every click and Tab: initiative walks down its column, max HP pairs with AC, and a server update never steals focus mid-typing. Esc takes back an edit, and empties a damage box.
- J reaches the jot box from a status list, and a typed letter never picks a status. On machines whose fonts run wider (Windows, Linux) a long name in the order is never cut, and the preview stays beside it.

## [1.12.121] — 2026-11-22

### Fixed

- The D&D 2024 rules summary's Hide row now says you must be out of every enemy's line of sight, that your Stealth total is the Perception DC to find you, and what ends hiding (#812).

## [1.12.119] — 2026-11-20

### Fixed

- The build no longer warns that a prepped or planned session or chapter "will NOT publish" (#828). Prep is held back on purpose until it is played; the warning still names any other session or chapter missing from the publish list.

## [1.12.118] — 2026-11-20

### Fixed

- A picture's likeness whose name several notes share now says so and names every path, instead of "no such note" (#833), so the right path can be passed.

## [1.12.117] — 2026-11-20

### Fixed

- CoC reference files now give 7e rules, not Basic Roleplaying ones (#832). Creatures are on the 7e scale (characteristics x5, one Fighting skill, damage bonus and Build), weapons use the 7e skills and impale rule, armour penalties are penalty dice, poison, falls, fire and explosions follow the Keeper Rulebook's damage table, fumble tables and the Resistance Table are gone, the magic file describes 7e spellcasting, and occupations' skill-point formulas, Credit Ratings and skills match the Investigator Handbook (Clergy, Occultist and Mechanic were wrong). Each rule cites its page.

## [1.12.116] — 2026-11-20

### Fixed

- Foes a contingency brings in get a note and a stat block (#827). Session prep gives each kind of foe its own note with a full stat block and lists it under the contingency's **NPCs** with a count, so the run sheet has their fight rows. plan-check warns when a contingency writes its fighters' numbers into the Plan, or points at someone else's ("stat the two as [[Mickey Dunne]]"), and when a creature in a scene has no stat block.

## [1.12.115] — 2026-11-20

### Fixed

- Vault checks leave the Midwife's drafts in `_midwife/` alone (#826). Names no longer pairs a note with its own draft, frontmatter no longer lists drafts without frontmatter, and graph-check no longer counts drafts as orphans, dead ends or ambiguous link targets. Names also skips archived notes and QA reports.

## [1.12.114] — 2026-11-20

### Fixed

- CoC 7e reference (#825): age now lowers MOV from the 40s (-1 per decade, up to -5 in the 80s), and firing into melee is one penalty die, with a fumble hitting the ally with the lowest Luck.
- CoC 7e reference: range is Regular, Hard (up to 2x base) or Extreme (up to 4x), and point-blank (a fifth of DEX in feet) gives a bonus die, in every file that gives range. Bullets can't be dodged (diving for cover gives the shooter a penalty die), and after a character's first defence in a round, later melee attackers gain a bonus die.

## [1.12.112] — 2026-11-20

### Fixed

- At the table, a name the vault doesn't have (an adventure's NPC, a monster) is looked for in your personal reference files before the skill says it isn't there (#807).

## [1.12.111] — 2026-11-20

### Added

- The run sheet runs a D&D fight (#556): a turn order with HP, statuses, recharges, Legendary Resistance and lair actions, dice rolled on the page, and the fight written to the Table Log (a figure from a fight reads `12/40 (after the fight, 20:14)`).
- The players' screen: a second window for the table monitor that shows only what you choose to show, with names, places and maps filtered on the server so nothing you keep back reaches it.
- An npc or creature note can set `unseen_as`, what players call it before they learn its name ("a brother"). Optional; no vault change is needed.

### Fixed

- The run sheet reads plain recharges and lair actions in a stat block, and a bare Bloodied If-row lights for the foe it names.

## [1.12.110] — 2026-11-20

### Added

- `gma table <vault>` runs tonight's session from the run sheet (#556): a page on your computer with the Plan, the cast and the notes, which keeps its place through a reload or restart and writes the session's Table Log as you play. It files the Table Log if there is none, and a busy port or a wrapped-up session stops it with a plain line.

### Fixed

- A dead NPC is treated alike everywhere the run sheet shows one (#788), and the run sheet's reader no longer mistakes a reinforcements cue or a routing line for a person, and warns about a stock stat block with no actions.

## [1.12.109] — 2026-11-20

### Changed

- Personal reference files (your own notes from books you own) live in `~/gm-apprentice/personal/<system>/`, outside the plugin, so an update no longer leaves them behind and the apprentice can save them. `gma personal` names the folder and lists what is there (#806)
- The first `gma update` or `gma personal` copies any personal files still in the plugin's own folders, older versions' included, into that folder; it never moves, deletes or overwrites one. `gma doctor` counts them (#806)

### Fixed

- The personal reference files page no longer says GURPS ships as SRD or ORC text (#808)

## [1.12.108] — 2026-11-20

### Fixed

- The party page no longer repeats the board as a grid of PC cards; a card shows only for a PC the board leaves out. A board PC's hook shows on its page and when you hover its name on the board. An index with one type of note shows no filter chips, and the chips read "NPC" and "Player character" (#804)
- A PC whose backstory opens on a picture no longer prints `![[...]]` in its card, its page's pull-quote or its link preview (#804)

## [1.12.107] — 2026-11-20

### Added

- The README links the GM-Apprentice website, gmapprentice.com: the start-here guides, a tutorial for each skill, and the gallery.

## [1.12.105] — 2026-11-20

### Added

- The Table Log, a session's third play record beside the Play Notes and the Export (#556): the run sheet's record of where everyone ended, which Plan points landed, loot, unmaskings, handouts and end-of-session vitals. `vault-write table-log-new` files one; the GM site pages it and links it from the session's GM Story page; it is never a player page.
- Wrap-up reads a Table Log when there is one: it wins for numbers, loot, point states and where everyone ended, the Play Notes and Export win for what was said, and the review names each disagreement. Where its hit points differ from what the players entered, the review shows both and you pick.
- The run sheet starts an ally with the hit points the last Table Log naming it ended it on, and warns on an HP cell it cannot read.
- The README and quickstart link the sample campaign, Snowbound.

## [1.12.104] — 2026-11-20

### Added

- An install prompt in the README: paste it into your agent and it checks Python and Node, installs gm-apprentice the way that agent takes plugins or skills, and checks the install.
- `gma doctor` checks a machine is ready (Python, the skills' version, Node, the publish tool) and says what to do about anything missing. It changes nothing.

## [1.12.102] — 2026-11-19

### Fixed

- A card on another page (a place within, a figure known there) that prints a public name holding a GM alias no longer warns that the alias is in that page's prose. The note whose own name holds the alias still warns (#797).

## [1.12.101] — 2026-11-19

### Added

- A disguised NPC keeps its true name in `unmasked_name`, its true face in `unmasked_portrait` and its true voice in an `**Unmasked:**` line, ready for the run sheet's Unmask (#556). None of them reaches the player site, and the leak check flags the true name on any page.
- `gma reveal --unmask` makes an unmasking canon at wrap-up: the true name joins `aliases` (and leaves `gm_aliases`), the true face becomes the portrait, the true voice becomes Speech, and the old face is kept in the reveals log.
- A GM map Document can name the map players see in `player_version`. The run sheet pairs the two, and pairs `X (GM)` with `X` by name when the field is not set.

### Fixed

- A secret name (`gm_aliases` or `unmasked_name`) also written in the note's `aliases` is now kept off the player site and still searched by the leak check; a secret name that is really a published page's own name is told in the build log (#796). A link to a disguised NPC's true name prints as plain text on the player site, never as the disguise's name, and the leak check stops the deploy until it is reworded.

## [1.12.100] — 2026-11-19

### Fixed

- The build no longer warns that a GM alias is printed on a page that only links a public place or person whose name holds it (#797): `[[Rook Hollow]]` is not the secret "Rook". The page whose own name holds it still gets the warning, so you can decide whether to rename it.

## [1.12.99] — 2026-11-19

### Fixed

- The site follows a link written in another letter case, as Obsidian does (#790): `[[the cloister]]` links to The Cloister. If two notes differ only by case, the link stays plain words. The run sheet uses the same rule.

## [1.12.98] — 2026-11-19

### Fixed

- `manifest diff` no longer says a file needs a decision when the publish list already excludes it (#793). Its two count lines now say which is the build's verdict and which is the list's entries.

## [1.12.97] — 2026-11-19

### Fixed

- A prep rewrite that renames a scene and loses its Treasure (or any labelled block) now says so (#787): the scene is compared under its new title, and the warning names both.

## [1.12.96] — 2026-11-19

### Added

- The build warns when the PCs' folder is published at an address other than `characters/pcs`, where the party page and its Party Status board are built (#744). Campaign-qa's Site Faults check offers to set it back.

### Fixed

- A retired or dead PC stays off the party page's threads and its Party Status board when the site hides the `status` field.

## [1.12.95] — 2026-11-19

### Fixed

- A GURPS character's page now shows its Current Status (#782): the lede, location, condition, its own open threads and the shared threads that name it. The live HP and FP panel is unchanged.

## [1.12.94] — 2026-11-19

### Added

- The party page lists the open threads: the party's, newest first, with when each began and who it involves, then each PC's own.

### Changed

- A `section --replace` or `--lead --replace` with the text already there reports UNCHANGED (#784).

## [1.12.93] — 2026-11-19

### Added

- Session Plans give every scene a **Place:** line, a hub a **Where they can go** block of places and pointers, and fights and hoards a **Treasure** block; plan-check warns, and prep fixes its own draft, when a part the run sheet reads is missing (#556).
- `gma stat-fill` writes a stock D&D creature's SRD numbers, Initiative included, into an NPC or creature note, keeping the GM's own words; the shipped D&D creature and animal blocks now carry Initiative.
- Rewriting a Plan or scene says DROPPED when a labelled block such as Treasure goes missing, so prep can put it back.

### Fixed

- The shipped D&D creature blocks take Initiative, size and speed from the official SRD 5.2.1: 30 Initiatives (most of the legendary dragons among them), 61 sizes and 6 speeds were wrong in the transcription they were built from.

### Changed

- The run sheet reader reads the Place line and the hub block, and records who stands at each place in a hub (#556).

## [1.12.92] — 2026-11-19

### Fixed

- Session prep can write a scene's Situation when a hidden picture block sits above it (#760); an older scene whose Situation sits under a heading further down is refused safely rather than given a second one.

## [1.12.91] — 2026-11-19

### Added

- The publish tool reads a session Plan into the run sheet's model, the first step of the GM's run sheet (#556); nothing on the site changes yet.

## [1.12.90] — 2026-11-19

### Fixed

- `stamp-entities --set` of a list that already holds those items leaves the note alone and says UNCHANGED, whatever list shape it is written in (#778).

## [1.12.89] — 2026-11-19

### Fixed

- `npc-stats --plan`, the run session prep uses, no longer asks for a stat block for a dead NPC the Plan names (a body found, a grave visited); a hidden fate beats `status`, so one who rises again takes a later fate such as **Risen.**; `--plan` also takes a full path to a Plan inside the vault (#776).

## [1.12.88] — 2026-11-19

### Fixed

- After a workaround is answered `retire`, the update's report says nothing is retired yet and gives the `gma workaround retire` command to run once it is swapped for the built-in way (#774).

## [1.12.87] — 2026-11-19

### Changed

- A wrap-up's unasked scene pictures put action first: the Direction still sets how many, and fights or chases come first, shown in motion (a long fight may take its opening, its turn and its end), then the dramatic beats, and a quiet beat or an aftermath only when nothing bigger happened (#770).

## [1.12.86] — 2026-11-19

### Fixed

- The party page's portraits sat 12px low in their circles, the top of each circle empty: the article picture rule's margin reached them. The same margin no longer shifts the small pictures on the characters, NPC, faction and location lists (#769, tool 1.70.31).

## [1.12.85] — 2026-11-19

### Removed

- A scene note's `scene_type` field and the Plan's `**Type:**` line: nothing read them, and they mixed a tone (horror) with what the players do. A routing or hub scene is marked by "(routing)" or "(hub)" in its title, or Scene 0; an old Plan's `**Type:** transition` still counts. The update removes the `scene_type` line from every scene note and changes nothing else in them (check `scene-type`); played Plans are left as they are (#759).

## [1.12.84] — 2026-11-19

### Fixed

- `vault-write resolve --export` reads the Export note by its path in the vault, as every other `vault-write` command names a note; before, only an absolute path or one relative to the shell's folder worked, and the vault path said "unreadable" (#766).

## [1.12.83] — 2026-11-18

### Fixed

- The leak check no longer flags a paused scene's `After [[Session]].` line, which the update tool writes and which says only the published session's title; the snapshot under it, and the line when its session is not on the site, are still hidden text (#765, tool 1.70.30).

## [1.12.82] — 2026-11-18

### Fixed

- `gma stamp-entities --set` wrote a list as one quoted string, so a scene's `entities` and `locations` were set by hand; it now writes a JSON list as a real list, `--add` appends one item, and in link fields a bare name becomes a link to its note (#761).

## [1.12.81] — 2026-11-18

### Fixed

- On a paused scene, `section --lead` reads and writes the Situation, Starts it and If-table below the `## Paused` snapshot instead of the empty space above it, and leaves the snapshot alone; on an older scene that opens with a `# Title` line it does the same below the title; an empty lead with a Situation further down is refused rather than written twice (#758).

## [1.12.80] — 2026-11-18

### Added

- `gma vault-write <vault> entity-new --type pc` makes a PC note: the vault's own system sheet, filed in the PC folder, with the fields, ties and sections you send and the sheet's tables kept to fill; `--from-npc` lets an NPC who joins the party keep its name, ready for `npc-merge` (#750).

## [1.12.79] — 2026-11-18

### Changed

- Session prep no longer asks the GM to pick or predict what the players do: it asks about the world, writes player-driven outcomes as `Do | Then` rows that answer the attempt, gives every PC a hook, and counts spotlight history from what the wrap-ups recorded (#719).

## [1.12.78] — 2026-11-18

### Fixed

- `dnd-sheet` counts a Powerful Build row (Species Traits, Class Features or Feats) as one size larger, so a goliath with STR 12 gets 360 lb carrying capacity and 720 lb drag/lift/push, and says "incl. Powerful Build" (#751).

## [1.12.77] — 2026-11-18

### Fixed

- The leak check no longer flags a PC sheet for printing its own class features or spells when a hidden NPC stat block uses the same words (a Monk PC's "Flurry of Blows (1 Focus)" against a monk villain's): it reads the sheet as the build makes it from the PC's own note, and hidden text that note does not hold is still found (#752, tool 1.70.29).

## [1.12.74] — 2026-11-18

### Added

- A wrap-up now writes a PC's end-of-session vitals to the Stat Sheet as well as Current Status: a batch's `=== sheet <PC> hp=41 hit-dice=1/5` block sets them with the writers flush uses, shows them in the dry run, leaves alone any value not given, and says so when the sheet has no row for one. `gma publish sheet set` does the same from the command line, with the keys for D&D, Call of Cthulhu, Regency and GURPS in its help (#749, tool 1.70.28).

### Fixed

- After a wrap-up, the party page's Party Status board showed a PC's hit points from before the session, because the wrap-up changed only the Current Status text; the wrap-up now writes the same numbers to the sheet the board reads (#749, tool 1.70.28).

## [1.12.73] — 2026-11-18

### Fixed

- `npc-stats` no longer asks for a stat block for an NPC who is secretly dead: it reads the current fate in the note's GM Notes Behind the Scenes, as session prep does, and leaves out one whose fate is **Dead.** while `status:` still says alive (#747).

## [1.12.72] — 2026-11-18

### Added

- A scene's Situation, Starts it and If-table can be changed through vault-write: a batch's `=== section "<scene>" --lead --replace` (or `--append`, which adds a row to the If-table) writes the text above a note's first heading or hidden block, with the usual dry run and checks, and `gma section <vault> "<scene>" --lead` reads it (#738).

### Fixed

- A batch `section` block can no longer write text that leaves a code fence or comment open: before writing, the publish tool checks that everything below the new text shows on the site exactly as before, so nothing hidden is published and nothing visible disappears (#738).

## [1.12.71] — 2026-11-18

### Fixed

- The session skills' first rule reads the PC roster from the PC notes (`gma vault-check <vault> active-pcs`, now with each PC's player and status; `--all` adds those out of play) instead of `_Campaign/Player Characters.md`, which a Midwife vault left empty and some vaults never had (#729).

### Removed

- The PC roster note (`_Campaign/Player Characters.md`) is gone: each PC's player and status live on the PC's own note, and new vaults no longer get one. The update (check `pc-roster-retired`) deletes an empty one with any empty `_Templates/` copy, asks before deleting one you wrote in (saying first anything the PC notes may not hold), and waits while it names a PC with no note of their own. Links to it become plain words, a frontmatter entry that is only the link comes out (any other is named for you), it leaves the publish list, and any line of your vault's CLAUDE.md or AGENTS.md that sends the agent to it is named for you to change. Archived and QA copies are left alone. The site makes its party page itself, the PCs' index with the Party Status board and a list of the PCs out of play; the old roster address sends readers there unless a page of yours is at it (tool 1.70.27, #729).

## [1.12.70] — 2026-11-18

### Fixed

- The update now removes the adventure brief's `adventure_shape` line (check `adventure-shape`). 1.12.68 shipped that step marked with an earlier release, so a vault already past it skipped it. A test now holds each update check to the release that ships it (#745).

## [1.12.69] — 2026-11-18

### Added

- `gma vault-check <vault> npc-stats` lists the NPCs with no real stat block (missing, a placeholder, blank, or a major NPC given only a stock block), and says which are major: a companion or one of the brief's Key NPCs. `--plan` keeps a Plan's NPCs, `--played` those met in play (#725).
- Missing stat blocks get built once the game system is known: the Midwife builds a full workup for each major NPC at scaffold, session prep builds the blocks its Plan's scenes need, and campaign-qa's new NPC Stats check offers the rest for the GM's yes. With no system recorded, nothing is built: it becomes a question for the GM (#725).

## [1.12.68] — 2026-11-18

### Removed

- The adventure brief's `adventure_shape` field, a one-word label (linear, branching…) that couldn't say what the GM chose and was read as the GM's decision. The shape lives in the brief's Adventure Shape section, in the GM's words, and the Midwife works it out that way. The update (check `adventure-shape`) removes the line, and asks first when the brief has a word there but no Adventure Shape section written (#735).

## [1.12.67] — 2026-11-18

### Fixed

- Wrap-up states an NPC's hidden fate plainly in their GM Notes ("**Dead.**", "**Captive, in the ice crypt.**") and leaves `status:` at what the players know until they learn it. Prep reads that fate over `status:`, so a dead NPC isn't planned as a helper (#739).

## [1.12.66] — 2026-11-18

### Fixed

- plan-check's duration rule no longer flags time left or gone on the session's clock ("with about 15 minutes left", "15 minutes of play are left", "30 minutes in"): that is the GM's pacing trigger, not a scene estimate (#726).

## [1.12.65] — 2026-11-18

### Fixed

- A page no longer prints a lone template placeholder like `{To flesh out for colour.}`: the paragraph or bullet is left off, and so is a heading it empties. The build warns with the note and section, and campaign-qa's Site Faults check asks whether to fill it or remove the line. Only note-like braces with a space in them count (`{REDACTED}` and `{1d6}` stay), `\{…\}` keeps a literal, and PC sheets are skipped (#720, tool 1.70.26).

## [1.12.64] — 2026-11-18

### Added

- House rules have a home: a `## House Rules` section in the Campaign Overview, one bullet per rule in your words. The player site gets its own House Rules page and menu link from it, and the play brief, prep bundle and wrap-up's carry read it; the Midwife asks for them at session 0. Existing vaults get the section when the first rule is written (#721, tool 1.70.25).

## [1.12.62] — 2026-11-18

### Fixed

- The prep Threads list matches a thread to a Wrap-Up line that shares a place or other proper name no note is named for, such as "the Widow's Stair" (#733).
- An NPC's given name no longer counts as that NPC inside someone else's full name: "Dorothea" of Miss Dorothea Bexley is not "Dorothea de Courlande" (#734).

## [1.12.58] — 2026-11-17

### Fixed

- The prep Threads list no longer says a thread is "not in any wrap-up" when the last Wrap-Up lists it in other words. A thread and a Wrap-Up line (Pending Consequences too) that name the same person, place or thing now match, linked or bare, alias or first name, with `~`; when nothing matches it says "no match found in a wrap-up" (#718).

## [1.12.57] — 2026-11-17

### Changed

- Several vault writes at once are easier to find: the shared tool table has a row for `gma vault-write <vault> batch`, and every writer's `--help` says it can be a block of one, previewed together and written all or nothing (#730).

## [1.12.52] — 2026-11-17

### Fixed

- A value written as escaped empty quotes (`voice: \"\"`) no longer counts as a voice or a filled field: the voices check reads it as none, `gma vault-check <vault> frontmatter` warns on it and `--fix` rewrites it to `""` (campaign-qa offers it), and `entity-new` writes `""` when it is sent the escaped form (#715).
- The Midwife's adventure brief and `_World/` notes are stamped as made before play, so `stale-drafts` can date them, and the next reconcile promotes the campaign's brief and world notes made before play whether or not the Wrap-Up links them (`reconcile-scan` says why; a stub is left out; `--except` holds a note back for one run). A brief written once sessions exist takes `entity-new --session N`, so it stays out of that set. The update stamps older ones (check `scaffold-pre-play`) (#717).

## [1.12.51] — 2026-11-17

### Fixed

- Wrap-up keeps a PC's Current Status lede current: `vw status --show` prints the one-line lede above the fields, and a plain first line sent to `status` replaces it, so the line written before play no longer stays on the live PC page (#714).
- The first wrap-up moves the Campaign Overview from `not_started` to `in_progress` (new `stamp --advance KEY=FROM:TO`); a paused, completed or abandoned campaign is never touched; a Current Arc still reading "Not yet begun." gets a two-sentence draft in the wrap-up's review, the rest of the section kept (#716).

## [1.12.50] — 2026-11-17

### Fixed

- With drawing without asking off but a picture source set, wrap-up no longer skips its scene pictures in silence: its report ends with one line offering them, and draws nothing unless asked. `gma llms image` says Event notes get their picture as a recap scene, not one of their own (#712).

## [1.12.49] — 2026-11-17

### Fixed

- A table assistant's moment (a bold beat, its italic context, then the quote said in it) is one Memorable Moments card on the Story page, not two, and `gma moments` tags it once, after the speaker line. A tag ends a moment, so a beat that carries its own tag, or a quote with a context line of its own, stays a card of its own: Canticle, Dead End and Special Forces render exactly as before (#705, tool 1.70.22).

## [1.12.48] — 2026-11-17

### Fixed

- The leak check no longer stops a deploy over a Wrap-Up's GM-only World State date: the session page and its preview print the session's in-game date once a Wrap-Up pairs with it, so the same date in World State is no secret. A date the GM hides from players (`hide.fields`) is still checked (#704, tool 1.70.21).

## [1.12.47] — 2026-11-17

### Fixed

- `manifest publish-played` names a played session whose index is Excluded (often excluded before play, as prep) as unclear, with the way out (`manifest apply --decide`), instead of skipping it in silence; it is still never published behind the GM's back (#703, tool 1.70.20).

## [1.12.46] — 2026-11-17

### Fixed

- `gma update .`, run from inside a vault, names the vault in its report instead of a blank ("Updated  from …"); so does the scaffold's clean-up note (#709).

## [1.12.42] — 2026-11-17

### Changed

- A story without a calendar is normal: timeline entries dated "Day 2, morning", "Night 1" or not at all no longer warn. The unsortable-date warning comes only once the campaign's dates carry a year (a session's, an event's or a timeline entry's), so a game that gains a calendar later is checked from then. The site's timeline no longer turns a relative date into one in 2001 ("Day 2" was 1 February 2001), so a story without a calendar gets no invented timeline; a month with no year ("1 March") is placed as before (tool 1.70.19). The date guidance and the templates say so (#697).

## [1.12.41] — 2026-11-17

### Fixed

- Notes made at the table count as this session's: `entity-new --session` stamps `createdSession`, `asOfSession` and an empty `source` as `play`. Wrap-up's new entities and events and session-play's saved notes pass it, so reconcile no longer lists them as pre-play prep. A new event is linked from the Wrap-Up, so reconcile sees it (#698).
- `gma reconcile-scan` finds a Wrap-Up by its name or `[[link]]`, as the vault-write commands do (#699).

### Added

- `gma reconcile-promote <vault> <wrap-up> --reconciled D [--write]` does reconcile's promotion in one step: the Wrap-Up promoted and stamped, the session index set to reviewed, and exactly the DRAFTs the scan lists as created or played this session promoted, never older ones. Nothing is copied across by hand, `--except` keeps a note the GM has not confirmed as DRAFT, and it writes every note or none. Reconcile's quick path and step 6 use it (#701).

## [1.12.40] — 2026-11-17

### Fixed

- Fewer false near-matches when an export's names are resolved: a capitalised word that only ever starts a sentence ("Later") is no longer offered as a misspelt name, a "Dr." or "Mr." is no sentence end, and a word-in-common match is offered only for a note of the section's kind (a faction or organization fits a person or a place), so a place is never its battle map and an item named for a person is never that person (#694).
- Play Notes and Export notes say who filed them: `session-new`, `play-notes-new` and `export-new` take `--created-by session-play | vault-ingest | manual` (default `manual`); session-play and vault-ingest pass their own name (#695).

## [1.12.39] — 2026-11-17

### Fixed

- The update marks older Play Notes and Export notes `publish: false` when the vault has no publish list, so a site with no list stops showing raw table records to the players. A vault with a publish list is left alone: those notes are already off unless the GM listed them (check `play-records-publish`) (#692).

## [1.12.38] — 2026-11-17

### Added

- A gmassistant.app export can join a session at any time, before or after session-play's Play Notes: `gma vault-write <vault> export-new --session "<index>" --export <file>` files it whole as its own Export note beside the index and links it as `documents.export`, leaving the Play Notes alone. Wrap-up reads both: the export's Summary for the recap, the Play Notes as the GM's jottings (#691).

### Changed

- `session-new --export` and `play-notes-new --export` file the export as its own Export note too, beside empty Play Notes, instead of inside them. A vault's existing Play Notes that already hold an export still wrap up as before.
- The Play Notes and Export notes these commands file carry `publish: false`, so a raw table record stays off the player site even in a vault with no publish list; the GM site still shows them (older notes: #692).
- The session template's `documents:` gains `export: null`; the update brings `_Templates/_Template_Session.md` up to date. The session check counts an Export as played, and the GM site gives it a page linked from the session's Story page, as it does the Play Notes (tool 1.70.18).

## [1.12.37] — 2026-11-17

### Changed

- Session wrap-up and vault-ingest create a new NPC, place, group, item or event note through `entity-new`: the wrap-up sends the fields, the ties and the sections, and the command fills the template and writes `## Related` and `### Hidden Ties` from the ties, so a new note's Related list and its relationships can no longer disagree (#684).

## [1.12.36] — 2026-11-17

### Added

- The adventure brief has a template, `_Templates/_Template_Adventure_Brief.md`: a new vault gets it, and the update copies it into an existing one (the `templates` check). `gma vault-write entity-new --type adventure-brief --name "<adventure>"` writes the brief at `Adventures/<adventure>/<adventure>.md` from the sections sent to it (#681).

### Changed

- The Midwife writes the adventure brief with that command. It sends the sections; the command puts the GM's under `## GM Notes` inside the gm-only fence and Open Questions in its spoiler block, and refuses a GM section written where players would read it.

## [1.12.35] — 2026-11-17

### Added

- `gma vault-write entity-new` creates an NPC, place, group, creature, item, event, document, clue or heritage note from its template. You send the fields to set, the ties and the sections; it writes `## Related` and `### Hidden Ties` from the ties, puts every `###` section under GM Notes (inside the template's fence when it has one), and marks two-way ties. Several notes go in as blocks of one `batch`, and the Midwife's entity promotion uses it (#676).

## [1.12.34] — 2026-11-16

Publish tool 1.70.17.

### Fixed

- A new adventure's twist no longer reaches the player site through its brief: the Midwife writes the brief's public sections, and the Campaign Overview's Premise and Key Factions, as what the players are told at the start, and puts what they are to find out under GM Notes (The Truth, Adventure Shape, Escalation) (#678).
- The Midwife's workspace (`_midwife/`), QA reports (`_QA/`) and the ingest inbox (`_inbox/`) are never published, on the player site or the GM site, and neither the publish list nor a build asks about their files, whatever your own list of hidden folders holds (#680).
- A plan promoted from a Midwife draft links to your vault's own Campaign Overview; the plan template no longer names `[[Campaign_Overview_Updated]]`, a note a new vault never has (#677).
- The site set-up creates the Cloudflare Pages project with `--force`: without it the current wrangler hands the create to Workers and fails, so the first deploy found no project (#679).
- The Midwife's scaffold reads entity sketches from the folders the skill files them in (`npcs/`, `locations/`, `factions/` and the like), and says which `status` words a `_World` note takes.

### Changed

- `gma vault-write promote-plan` fills a plan's participants and locations from `--participant` and `--location` (a note's name, alias or vault path) and from the notes the plan links to, stamps `lastUpdated` with `--date`, and promotes one heading of a draft that holds several plans with `--section`.

## [1.12.33] — 2026-11-13

### Fixed

- The leak check no longer stops a deploy over the Campaign Overview's shared threads that the build itself puts on PC pages: they count as published there, and the rest of an unpublished Overview is still checked (#674).

## [1.12.32] — 2026-11-13

### Added

- The build warns when your own list of hidden details or headings lacks one the plugin now hides by default (such as `voice` or `Dormant Threads`), naming each and what it is for; campaign-qa offers to add them (#594).
- `player_site.hide.declined` records the built-in entries you chose to leave off your own list, so the warning stays quiet about them. Removing a built-in entry, or saying no when an update offers one, records it there for you.

## [1.12.31] — 2026-11-13

### Added

- GURPS and Call of Cthulhu PC pages get the backstory showcase D&D pages have: a prologue on the Story tab, the look beside the portrait, "what drives them" cards (CoC's backstory fields, GURPS's Personality and Motivations), a teaser on the sheet tab and the hook on party cards. A Background written as plain prose counts as the backstory. The PC templates gain a `### Backstory` section; the update offers it to unchanged templates (#483).

## [1.12.30] — 2026-11-13

### Fixed

- A replaced picture is kept 14 days from the replacement, not from when its job was made (#639).
- A picture job left in the temp folder (by a sandboxed draw) moves to the cache folder the next time a plan or place runs, so the system can't clear a held picture early; a draw in progress locks its job so nothing moves underneath it (#645).

## [1.12.29] — 2026-11-13

### Added

- `mobrpg withdraw` takes back Pending suggestions you filed: preview first, your own namespace only, relations before what they point at, then each vault note re-stamped `dismissed` once the queue confirms it is gone. `--only` previews and prints the exact `--id` command to run (#504).

### Changed

- `mobrpg suggest --execute` needs a scope (`--only`, `--chapter`, `--kind`) or an explicit `--all` (#504).

## [1.12.28] — 2026-11-13

### Changed

- Story pages show scene pictures as full-width plates between paragraphs, like plates in a book, each with its zoom link. A picture embedded in the recap gets the same treatment, with `![[pic.png|caption]]` giving its alt text and caption. `player_site.story.scene_pictures` (`inline`, `float` or `mixed`) chooses; portraits stay beside the text (#615).

## [1.12.25] — 2026-11-13

### Fixed

- GURPS gravity counts Total G-Intolerance (S222): 0.05G steps plus one anywhere off home gravity, and G-Experience does not halve it (#665).

## [1.12.24] — 2026-11-13

### Added

- `vw npc-merge` folds an NPC note into the PC it became: every section, tie and alias is carried over word for word with secrets kept fenced, links are repointed, and the NPC note is archived as `<name> (NPC).md`. `gma vault-check <vault> npc-pairs` finds same-name NPC/PC pairs, and campaign-qa offers the merge one pair at a time (#445).
- A retired PC who carries on as an NPC keeps one note: wrap-up logs later appearances under `## Further Appearances`, which the player site shows.

## [1.12.23] — 2026-11-13

### Added

- GURPS gravity now works out the DX penalty (B350): −1 per 0.2G step from home gravity, halved by G-Experience, with wider steps for Improved G-Tolerance and narrower ones for G-Intolerance. The to-hit calculator has a ticked-by-default Gravity modifier (Beam Weapons exempt), the sheet opens with a gravity warning (DX, jump and throw), and the party board chip names the penalty (#629).
- New optional PC field `home_gravity` (in G) for a character raised elsewhere. Nothing is backfilled: absent means 1G.

## [1.12.22] — 2026-11-13

### Changed

- Wrap-up creates a note for a PC who played but has none, with only the name, the player and what they did; the player fills in the rest (#601).
- PC Open threads stay a list of what is open now: wrap-up drops session labels from thread items and keeps one Knows field (#635).
- A PC's voice is still the GM's to approve, and the GM may run it past the player first.

### Fixed

- A vault last updated before 1.10.12 is told plainly it is out of support and pointed to a new vault plus vault-ingest, instead of a chain of releases that each refuse it (#624).

## [1.12.21] — 2026-11-13

### Fixed

- CoC sheet weapon-table headers are readable on dark themes, and a long code line in a note wraps instead of widening the page (#606, #607).
- In-line pictures no longer carry their file name as alt text (`![[pic.png|alt text]]` sets it), which also stops false leak-check hits on those names (#620).
- Story pages put a scene's picture beside the paragraph its title describes, and an unlinked first name no longer pulls in another character's portrait when that character isn't in the recap (#614, #628).
- The "settings written by a newer gm-apprentice" message no longer tells npx skills users to update a plugin (#616).
- Windows: stopping a background `gma publish serve` stops the server too, so its port is freed (#609).

### Changed

- Live stats and the change-request inbox publish only on Cloudflare Pages, and the warning says why. A site with no host setting now defaults to Cloudflare Pages; the update first writes each existing site's host down (Cloudflare where the site shows Cloudflare signs, GitHub Pages otherwise), so no site changes host (check `site-host`) (#605).

## [1.12.20] — 2026-11-12

### Fixed

- A place, group or person marked `withheld: true` no longer gets a page on a new campaign's first player site: it stays off until a reveal publishes it, and the GM site still shows it, marked (#619).
- The site check no longer calls a link to such a note an error when its withheld mark is what keeps it off, and never suggests a publish-list change that would create a list on a vault without one.

### Changed

- The-midwife marks an entity whose existence is itself the secret (a hidden lodge, an unfound room) as withheld when it hands the campaign to the vault (#619).

## [1.12.19] — 2026-11-12

### Fixed

- A second prep finds the Plan the first one filed in the new chapter, so it no longer writes a second Plan; an older chapter's Plan with the same number is never taken for the next one (#647).
- `vault-write status` keeps the sheet's own sub-bullet indent instead of rewriting 4 spaces as 2 (#637).
- In a wrap-up batch, `section --append` puts list items above a closed gm-only block, the way `log` does (#655).
- Shared threads: closing one works when a hidden copy exists, a near-miss lead gets a hint, and the site and the scripts read a code fence inside a thread, a list that outdents and an empty `##` heading the same way; the prep brief keeps hidden text fenced (#631).

## [1.12.18] — 2026-11-12

### Fixed

- Reconcile now promotes notes made before play (the PCs, NPCs and places the-midwife or the scaffold wrote) once the Wrap-Up links them, and promotes each PC's Story file along with the PC (#622, #623).
- campaign-qa no longer warns about every note made before play: a blank `createdSession` counts as "made before play" and is flagged only once it goes stale (#622).

## [1.12.17] — 2026-11-12

### Fixed

- Two picture draws at once on one vault no longer lose a count of the month's pictures: every writer of the vault's state file now takes the same lock.
- A scene picture follows the recap paragraph that opens with your exact words, and a bare picture name in a recap is read the way Obsidian reads it (the note's own folder first, then the shortest path in the vault).
- If a file turns up where a picture is going, `gma image place` skips that one picture, says so, and files the rest, even when two scene pictures share one recap.
- A Codex run that finishes but leaves no picture uses an attempt after the first, so it stops retrying forever.

### Changed

- The Image Guidance template asks for no signature, watermark or lettering in a picture.

## [1.12.16] — 2026-11-12

### Fixed

- A quoted value is read as the text it is: a session title with a comma no longer drops that session's Wrap-Up from the threads report and prep bundle, and `chapter: "[[Ch 1]]"` is no longer read as a list (#604, #638).
- A Wrap-Up whose `session:` names no session number is named in a warning instead of being left out silently (#638).
- A `played_in` or `entities` field written as one quoted string of links (`"[[A]], [[B]]"`) keeps every link when it is rewritten, and the plans index reads quoted participants.

## [1.12.14] — 2026-11-12

### Fixed

- `gma workaround add --where site:<path>` records a stand-in that lives in the site folder (`css/overrides.css`), so the update that retires it can point at the file (#608).
- A "leave" answered on an up-to-date vault no longer hides the next, changed question for a release (#626).
- The README, the image docs and the hints a GM is shown now give the real command to type in a terminal, not the `gma` shorthand, which oh-my-zsh turns into `git merge --abort` (#627).
- `mobrpg images` no longer saves a `(mobRPG)` copy of a picture the vault already holds under another name, and the dry run says so (#630).

## [1.12.13] — 2026-11-12

### Fixed

- Export names with a short title ("Mr. Ashworth") now match the vault's note, and a person, place or thing comes before a plan or document that matches as well.

## [1.12.12] — 2026-11-11

### Changed

- Wrap-up writes once: it drafts everything into one batch file, shows the GM a single review, and places it all with one write (or nothing, if anything is refused). A "no" keeps the drafts: change just the parts named, or write the rest now and those later.

### Added

- `gma vault-write batch`: many writes, one plan, one commit, then the note checks on exactly what it wrote. Blocks for every writer, plus `stamp`, `note-new` (a whole new note) and `section` (text into one section by heading, which won't drop a hidden block).
- Names from a table-assistant export come out in the vault's spelling: `resolve` also finds names misspelt in the export's running text, and one `names` block puts the vault's spelling in everywhere and fills the Name Conflicts table.
- A PC sheet refresh warns in the review when it would lose a sentence the sheet already held.

## [1.12.11] — 2026-11-10

### Changed

- Prep writes the whole Plan in one go: the skill carries the Plan's shape, and the write prints every check prep used to run by hand (read-aloud lines naming a PC, a multi-day clock, links with no note, scene pointers).
- `--gm-input` implies `--headless` and takes its parts comma-separated too.

### Removed

- `## Planned vs Played` leaves the Session Plan template: nothing filled it, and each scene note and the Wrap-Up already record what was played. `gma update` updates an untouched vault template; older Plans keep theirs, unreported.

### Fixed

- The Plan write checks the scene notes the Plan points at (read-aloud, table cells, links), and the multi-day clock cue reads the session's date from its index, so it fires again.
- `--gm-input ""` is refused instead of skipping the whole hard guard; a section of wikilink bullets no longer reads as template text.

## [1.12.10] — 2026-11-10

### Added

- With `vault.images.auto` on, wrap-up draws the session's big moments and pictures for its new notes, and the other skills draw for the notes they create. Drawing comes last, after the report; "not now" leaves the job waiting. Nothing is drawn unasked without an Image Guidance note, and more than ten pictures become a fill offer.
- "Fill in the missing pictures": the apprentice lists notes with no picture (`gma image missing`), asks once, and draws ten at a time.
- `gma image status` names jobs still waiting to be drawn or placed; `gma image plan` takes its requests on stdin.

## [1.12.9] — 2026-11-10

### Changed

- Prep's opening read ends with a map: where every note the last Wrap-Up and the next Plan link lives, with its size, and the latest sessions' notes. Prep finds what it needs without searching the vault; on Canticle it took fewer turns and cost less.
- Prep's opening read leaves out the PCs' Backgrounds and the deferred world flags, which no prep plan used. `gma session-context --arcs` still prints the Backgrounds, and the default bundle the flags.

## [1.12.8] — 2026-11-10

### Added

- Reconcile now settles threads with you: it proposes which open threads to close or park, and writes only what you agree to.
- A Dormant Threads list for threads parked when the party left a place or arc. Prep leaves it out of the brief until the thread is woken or its names come up.
- Thread rows `hand` (give a PC's thread to another PC), `rest` (park a thread) and `wake` (bring it back).
- `gma vault-write wrapup-settle` ticks checklist items and strikes answered questions in the Wrap-Up.

### Changed

- Wrap-up writes only active threads; settled and dormant ones stay out of what prep reads.
- The player site never publishes a Dormant Threads heading: threads are parked only once the site's publish tool hides it, and the update offers the entry to vaults that keep their own hidden-headings list (check `hide-sections-dormant`).
- Publish tool 1.70.6: `Dormant Threads` joins the hidden headings.

### Fixed

- A one-line comment no longer hides the threads next to it (#641).
- A thread closed from the Wrap-Up no longer needs to be on a list (#642).
- Settled checklist items and answered questions stop reappearing in prep (#643).

## [1.12.7] — 2026-11-10

### Added

- Pictures on a ChatGPT plan: choose Codex (`vault.images.source: codex`) and it draws with its own image tool on your plan, with no money counted. A Codex signed in with an API key is never used this way. See [docs/images.md](docs/images.md).
- An apprentice running inside Codex can draw the pictures with its own image tool (`vault.images.source: self`; `draw --picture N FILE` hands them in).
- What draws is always your choice: until `vault.images.source` is set, the apprentice asks.

### Fixed

- `gma image` works for an apprentice in a sandbox that may not write to the machine's cache folder (Codex's default): its picture jobs go to the temp folder instead, never the vault.

### Changed

- Publish tool 1.70.5: the `vault.images.source` setting (`codex`, `self` or `service`).

## [1.12.6] — 2026-11-10

### Added

- Pictures. Ask the apprentice for a portrait, a place, an insignia or a scene picture and it draws it with Google Gemini on your own key, looks at it, redraws once if it is wrong, and files it. Set-up and costs are in [docs/images.md](docs/images.md). Nothing is drawn unless you ask.
- `gma image` (`status`, `key`, `plan`, `draw`, `place`), with spending limits in the vault's settings under `vault.images` that the tool enforces. The key stays on your machine.
- An Image Guidance note for the campaign's look, from a new template the update offers to existing vaults. It never reaches the player site.

### Changed

- A document note may hold a `portrait`. Image ingest files pictures for heritage and document notes too.
- Publish tool 1.70.4: the `vault.images` settings, and the Image Guidance note is never published.

## [1.12.5] — 2026-11-09

### Fixed

- Session prep now reads the Wrap-Up's Reconciliation Context, World Evolution included. The prep bundle used to hide it behind a one-line stub, so a plan could follow rulings that reconcile had already replaced.

### Changed

- Thread ageing on a long campaign is faster: pairs that cannot match are skipped.

## [1.12.4] — 2026-11-09

### Added

- `gma section VAULT NOTE "Section/Sub"` prints one section of a note by heading path. Case does not matter, headings in code blocks are ignored, and a path that fits more than one heading is refused with the candidates listed.

### Changed

- `session-context` prints a PC's `###` subsections as an outline with sizes and paths, to fetch when needed: Current Status for Active PCs, and Background and GM Notes in `--arcs`. Open threads stay whole.
- session-prep reads an outlined subsection only when a step needs it.
- One section finder serves the Overview's Open Threads and the rest of the scripts. An unclosed code block now runs to the end of the note, as on the site.
- `gma section` takes `"## Heading/Sub"` to pin a heading's level, so a repeated name can still be fetched.

### In numbers

Measured on notes-only copies of three campaigns, in characters. How much each shrinks depends on how much of the campaign sits in PC subsections:

| | 1.12.3 | 1.12.4 | Change |
|---|---|---|---|
| `session-context --prep`, 4 PCs with long session logs | 155,196 | 129,610 | −16% |
| `session-context --prep`, 4 PCs with long GM Notes | 82,881 | 51,609 | −38% |
| `session-context --arcs`, the same 4 PCs | 42,546 | 11,274 | −74% |
| `session-context --prep`, 6 PCs | 127,035 | 118,171 | −7% |
| `session-context --arcs`, the same 6 PCs | 30,675 | 21,679 | −29% |
| Prep plan quality (blind judge, both orders) | | nothing lost to the outline | |

---

## [1.12.3] — 2026-11-09

### Added

- A shared `## Open Threads` list in the Campaign Overview, for threads two or more PCs share.
- `gma vault-write threads` adds, moves and closes threads. A closed thread is recorded in that session's Wrap-Up under `#### Resolved Threads`, with the line that ends it.
- Thread Tidy mode in campaign-qa, for going through the open threads. It closes ended threads and moves word-for-word duplicates without asking, the one campaign-qa check that fixes before you see it, and reports every change it made.
- Each PC page on the site shows the shared threads that name that PC. They are read from the Overview's Open Threads even when the Overview page does not publish, or sits in a folder the player site hides; GM-only text, spoilers and comments stay hidden (publish tool 1.70.3).

### Changed

- Wrap-up writes only open questions and obligations as threads: stopping points go to the Handoff and events to the recap. It puts shared threads on the shared list, and closes a thread only on a note that says it is over, telling you each time.
- `--threads` prints each thread once and whole. `--brief` and `--prep` stub the last Wrap-Up's Resolved Threads.
- `vw threads move` waits, as the update does, while the site's publish tool is older than 1.70.3.
- `vw status` warns when a rewrite of a PC's Open threads drops a thread, and points at `vw threads close` so the end is recorded.
- The `shared-threads` check moves threads that sit word for word on several PC sheets into the Overview's Open Threads. Struck-through ones go to the latest Wrap-Up's Resolved Threads. Threads in or next to hidden text stay put, with a notice.

### In numbers

Measured on a notes-only copy of a 16-session chapter (six PCs), after the update and one Thread Tidy:

| | 1.12.2 | 1.12.3 | Change |
|---|---|---|---|
| `session-context --threads` | 49,550 chars | 36,000 chars | −27% |
| `session-context --prep` | 157,760 chars | 126,922 chars | −20% |
| Threads lost from any PC page on the site | — | 0 | |

---

## [1.12.2] — 2026-11-08

### Changed

- The update now takes vaults from 1.11.0 on, and from here the oldest it takes moves up one minor release at every minor release. A vault behind is told which release to update with first, and how to run it from its download with Python alone.

### Removed

- The update's checks for 1.10 releases, which no vault it takes can need, and the publish tool's `google-fonts` question, which only they asked (publish tool 1.70.2).

### In numbers

| | 1.12.1 | 1.12.2 | Change |
|---|---|---|---|
| Checks the update carries | 40 | 13 | −67% |
| The two migration modules | 3,230 lines | 1,481 lines | −54% |
| All shipped vault scripts | 41,376 lines | 39,389 lines | −4.8% |
| `template-history.json` | 26,242 B | 18,573 B | −29% |
| What an install downloads (`skills/`, gzipped) | 1,249 KB | 1,222 KB | −2.1% |
| Test functions | 4,324 | 4,097 | −227 |
| Full Python suite, one local run | 429 s | 398 s | −7% |

No faster on a current vault (those checks never ran on one); the gain is upkeep. From here each minor release deletes the last minor's checks, so the update stays about this size.

## [1.12.1] — 2026-11-08

Codex and Cursor tested end to end on 1.12.0 (create a vault, prep, wrap-up, build the site locally, update).

### Fixed

- A first session is reconciled like any other: before, a tidy session 1 (the campaign's, or a chapter's in a vault that restarts numbering each chapter) was skipped, so its Wrap-Up and new notes stayed DRAFT for good (#618).
- When an agent's sandbox blocks the update's backup or `gma tool install`, the message says the folder is outside the project folder and asks the assistant to stop and ask the GM to allow it, not to work around it. The automatic download before other commands only warns.

### Changed

- README: what was tested on Codex and Cursor, and the one command a sandbox may ask you to allow.

## [1.12.0] — 2026-11-08

gm-apprentice installs in Codex and in the other agents `npx skills` supports, and the skill zips are gone.

### Added

- **Codex plugin:** `codex plugin marketplace add AntTheLimey/gm-apprentice`, then `codex plugin add gm-apprentice@gm-apprentice`, installs the whole plugin, publish tool included.
- **`npx skills add AntTheLimey/gm-apprentice --all -g`** installs the nine skills and `shared`, the helper skill they use. Claude Code and Codex keep `shared` out of the skill list.

### Changed

- When a vault is newer than the skills, an install that isn't a plugin is told to run `npx skills update`; the plugin's words are unchanged.
- `gma update` offers to retire a workaround when GitHub says its issue was closed as fixed before the installed release came out; it no longer reads the changelog.
- The vault's managed note block names the `shared` folder rather than a plugin path, so it refreshes once.
- Releases before 1.11.0 moved to `docs/history/changelog-archive.md`.

### Removed

- **The skill zips.** Install through the Claude Code or Codex plugin, or `npx skills`, instead.

---

## [1.11.8] — 2026-11-08

Installs other than the Claude Code plugin now get the publish tool too: it downloads once, on first use. Nothing changes for a Claude Code GM.

### Added

- **The publish tool reaches every install.** An install without the tool beside its skills (the zips now; `npx skills` and other assistants next) downloads the matching tool release once, on the first command that needs it, checks it against the release's SHA256SUMS and keeps it in a per-user cache folder. Node does the download, so it goes through a sandbox's proxy; that needs Node 22.21 or newer (any 24 or later), and an older Node is told to upgrade. A failed download warns once, waits 15 minutes before trying again on its own, and the command carries on as it would without the tool. The three newest versions are kept, for other installs on the same machine.
- **`gma tool install` and `gma tool path`.** Install fetches the tool now, for a sandbox that blocks network access until the GM allows it; path prints the tool in use.
- **`skills/shared/PUBLISH_VERSION`** names the tool release the skills go with. A test, CI and the zip build fail when it differs from `tools/publish/package.json`.

### Changed

- **Each install pins the site its own way.** The Claude Code plugin keeps today's pin. Other installs, and a site already pinned to a release tarball, pin the checksummed release named by `PUBLISH_VERSION`, kept inside the site folder, so the site builds wherever it is. `gma publish update-pin` does the same, so the publish-site steps that run it work everywhere.
- **The checks say "run `gma update`"** where they said "run update-pin" for a site tool that is too old: the update repins the site on every install.
- **The settings schema is read from beside the publish tool**, so a downloaded tool brings it too.
- **`gma publish update-pin --check`** asks about the same release a real run would pin, and a repin stops plainly when `PUBLISH_VERSION` is missing or unreadable or Node is older than 22.21.
- **Node 22.21 or newer** is now what the docs ask for: the release download and the site repin need it to reach the network through a proxy.

## [1.11.7] — 2026-11-08

Every install now knows its own version, and an install that is missing a piece says so and stops. Nothing for a GM to do.

### Added

- **A version stamp that ships with the skills.** `skills/shared/VERSION` is committed and is the version every install reads, the Claude Code plugin included. A plugin manifest beside it is checked against it and only warns when they differ, so an install converted for another assistant no longer refuses first use. A test, CI and the zip build all fail when the stamp and `plugin.json` differ.

### Changed

- **The zips carry the committed stamp** instead of writing their own.
- **A missing piece tells the assistant to stop.** When the version cannot be found, or the publish tool is not installed, the message now ends: "Assistants: stop here, tell the GM what is missing, and do not work around it." A version mismatch warns once per command, not once per check.

## [1.11.6] — 2026-11-07

Every skill now runs its vault scripts and the publish tool through `gma`, and `gma` finds its own install. Nothing for a GM to do; the publish tool is 1.70.1.

### Changed

- **The skills call only `gma`.** Every vault script and the publish tool run as a `gma <command>` line, so the skills no longer depend on a Claude Code variable to find where the plugin lives. `gma` finds its own install, and the scripts' hints and the generated text name `gma` too. A test keeps the skill text `gma`-only.
- **Publish tool 1.70.1:** the fix line for a link that is not shown on the site names `gma links`, and its build warnings and help name `gma` commands rather than script files.

### Fixed

- **On macOS and Linux, stopping a background `gma publish serve` stops the server.** `gma publish` now hands over to the publish tool instead of running it as a child, so ending the background job ends the server rather than leaving it running. When the publish tool is not installed, `gma publish` says so plainly and stops.

## [1.11.5] — 2026-11-06

Four bug fixes.

### Fixed

- **A note that starts with a byte-order mark** (some Windows editors save one) is now read: `vault_write.py story` and `npc-story` found no such PC or NPC, and the scripts read it as having no frontmatter, so the checks skipped it. Every frontmatter and body reader in the scripts now skips the mark (#593).
- **Quoted frontmatter values are decoded** by the scripts' reader as YAML reads them: `"a \"b\""` reads `a "b"`, `"C:\\x"` reads `C:\x`, an escaped tab is a tab, and `'O''Brien'` reads `O'Brien`. Values the scripts wrote with escapes used to read back with their backslashes (#597). Block and flow lists are decoded too. The writers that put a read value back (a scene's linked notes and `played_in`, the props move's `prop_hand`) now escape it, so a name with a quote or backslash keeps its frontmatter valid. A shared set of test notes checks the publish tool's reader against the same values.
- **`migrate.py apply`** no longer lists a choice whose step failed under "not offered" as well; a choice whose step the run never reached, because an earlier step failed, reads "not run" (#595).
- **session-wrapup** never replaces the Campaign Overview's `current_game_date` with a vaguer one: with no date in the notes it keeps the date there, or moves it on only as far as the notes say time passed, and asks when unsure (#600).

## [1.11.4] — 2026-11-06

Voices, part two (#460): the skills draft and use the voices. With `vault.voices` on (the default), session-wrapup and session-prep read the campaign's voice and each character's before writing story prose, and draft a missing one for the GM's yes; session-play and ttrpg-expert use the voices they find and never draft. Records stay plain. The update refreshes an unedited character-story template and asks about an edited one, as usual.

### Added

- **`shared/voice.md`**: how a voice is drafted (from the vault: background, backstory, sheet, how the character played; a few sentences on one line), checked against the player site's hidden list before it is written, shown to the GM, and stored with `stamp_entities.py --set`; and how a GM's correction to voiced prose is folded into that voice without making it longer.
- **session-wrapup** runs `vault_check.py VAULT voices` before the recap, names a PC who died or left this session and an NPC the GM gives a story, drafts any missing voice for the GM's yes, and writes the recap in the campaign voice and each Story entry in its PC's voice. A voiced NPC who appeared gets a passage through `vault_write.py npc-story`. A gmassistant.app export's `## Summary` is still adopted word for word; it is rewritten in the campaign voice only when the GM asks.
- **session-prep** uses the campaign voice for read-aloud, scene-setting and handouts, and a voiced character's own when they speak or write; it drafts a missing campaign voice for the GM's yes. **session-play**, **ttrpg-expert** and **vault-ingest**'s backstory entries use the voices when a vault has them.
- **`vault_write.py story --replace` and `npc-story --replace`** replace a session's existing Story entry or NPC passage, found by session number (and by chapter where sessions restart or the heading names one), all or nothing. An NPC passage is looked for only where a new one would go (`## Story`, or the `--section` given, never a gm-only or hidden section), so an appearance log or GM Notes heading for the same session is never overwritten; `npc-story --replace` works while `vault.voices` is off. The preview names any gm-only or spoiler block (inline too), or comment, the new text drops. `--date` and `--as-of` stamp `lastUpdated` and `asOfSession` when given. The story format's new Corrections section says how a GM's correction is made: dry-run first, hidden blocks kept.

### Changed

- **The story format** reads the voices first; the genre table is the fallback when a voice is `(none)` or voices are off, and a starting point for drafting.
- **"Voice" means only the story voice** in the skills: the NPC generator's `Voice:` line is now `Speech:`, and craft uses elsewhere read "register", "style" or "restyle".
- **`vault_write.py timeline --under` and `--after`** take a heading by its text, without the `#` marks, when exactly one heading has that text.

### Fixed

- **session-wrapup step 4b and the world-evolution stamps** passed `--session N`, which `stamp_entities.py` refuses when the Campaign Overview labels sessions ("Session 3"); they now pass the session's value in the Overview's own shape.

---

## [1.11.3] — 2026-11-06

A new vault no longer starts with a table error, and the update repairs the same row in an existing vault (check `publish-row-pipe`) (#599, thanks to dcordle).

### Fixed

- **The `publish` row of the schema table** wrote its two values as `` `false` \| `stub` ``. A new vault copies that table into `_meta/entity-types.md`, and the table check rejects an escaped pipe in a cell, so every new vault began with one ERROR. The row now reads `` `false` or `stub` ``, and a test runs the table check over the text a new vault gets. In an existing vault, the update (check `publish-row-pipe`) rewrites the value cell of the `publish` row in `_meta/entity-types.md` the same way, whatever wording the rest of the row has; a row whose values you changed is left alone.

---

## [1.11.2] — 2026-11-05

Voices, part one (#460): the field, the switch, and the tools the skills will use. Publish tool 1.70.0. The skills start drafting and using voices in the next release. The update adds the `voice:` line to unedited PC, NPC and Campaign Overview templates and asks about edited ones, as usual; it leaves existing notes alone. A vault that keeps its own list of hidden details is asked whether to add `voice` to it, and the update waits for that answer.

### Added

- **`vault.voices`**, a vault setting, on by default. It says whether the skills keep a short voice for the campaign and for each storied character, and write story prose in it. Off, story prose takes its tone from the genre, as before.
- **A `voice:` line** on the Campaign Overview, PC and NPC templates: a few sentences on how the campaign or character is told and how they speak, on one line. An NPC with a voice is one the GM has given their own story. A voice cleared to `null`, `~` or only a comment counts as none.
- **`vault_check.py VAULT voices [NAME ...]`** prints the campaign's voice and each character's in one short list (every active PC and every NPC with a voice, or the characters named). Names match by name, alias or `[[link]]`, with or without underscores; a name two characters answer to shows as ambiguous. A voice not on one line shows as unreadable.
- **`vault_write.py npc-story`** writes a storied NPC's passage for the session at the end of its `## Story` section, made when the note has none, or under the section `--section` names. It refuses a hidden or gm-only section (and will not open a `## Story` that `player_site.hide.sections` hides), a place inside a block the site strips, a session already written there, an NPC with no voice, and every NPC while `vault.voices` is off. With no `--section`, it points out a section that already holds earlier session passages.

### Changed

- **The NPC template's `**Voice:**` line under Playing Them is now `**Speech:**`**, so "voice" means only the story voice. Existing NPC notes keep their line as written.
- **`voice` is kept off the player site.** It joins the built-in `player_site.hide.fields`. A vault that keeps its own list is asked by the update (check `hide-fields-voice`) to add `voice` to it, and stays at its old version until it answers. Answering leave keeps the list as it is, so a voice can show wherever a page names that detail.

### Fixed

- **`vault_write.py story` and `npc-story`** no longer write `lastUpdated: "null"` from a Wrap-Up whose `play_date` is still `null`; they leave `lastUpdated` as it was and warn.
- **`vault_write.py story`** in a vault that numbers sessions per chapter no longer refuses chapter 2's Session 2 as chapter 1's again; the entry is headed `Chapter 2 Session 2`, as `npc-story` heads its passage there.
- **Notes already holding `lastUpdated: "null"`**: the update (check `null-last-updated`) clears it to `lastUpdated: ""` on character story and NPC notes.
- **A value written with a line break or tab** (`stamp_entities.py --set`) is escaped onto one line, so it reads back whole.

---

## [1.11.1] — 2026-11-05

Settings writer fixes (#380). Publish tool 1.69.1. No vault change.

### Fixed

- **Values a YAML 1.1 reader would misread** (`12:30`, `yes`, `1_000` and the like) are written quoted, so Obsidian and the scripts read the same text the publish tool does. A lone `y` or `n` stays bare.
- **A value already in quotes keeps its own quotes** when a change still needs it quoted (`'yes'` stays single-quoted).
- **Renaming a note reports a settings error** (an unreadable file, or a vault with only the old settings file) instead of silently leaving the settings unchanged.
- **The site doctor reports a malformed `package.json` once**, as the settings stop, not again as a version warning.

### Changed

- **Dead code from the old settings layer removed**: the layout-aware name and file-label helpers, the hidden `layout` property of the publish config, and the old-file branches of the writer's tests. The settings-name and file-label helpers take no layout argument.

---

## [1.11.0] — 2026-11-05

**Before you update: every vault and site must already be moved.** Update each vault with plugin 1.10.134 or later first (its update moves the settings to `_meta/vault-config.yaml` and the publish list to `_meta/publish-list.yaml`, and repins the site's publish tool). Then check three things the 1.10 update can leave behind: `_meta/vault-config.md` beside the new file (remove it once its settings are in `_meta/vault-config.yaml`), a key other than `vaultPath` in the site folder's `vault.config.json`, and a `prebuild` or `postbuild` script in the site's `package.json` (move it to `player_site.before_build` or `player_site.after_build`). Plugin 1.11.0 no longer moves anything: its update refuses a vault that is not moved or still holds any of these, and names each with its fix; the build stops on them by name. Publish tool 1.69.0.

### Removed

- **The old settings file's reader** (`_meta/vault-config.md`): the scripts and the publish tool read only `_meta/vault-config.yaml`.
- **The old publish list** (`_meta/publish-manifest.md`): its reader and writer are gone.
- **The settings move** (`settings move`, with `--fold-site-file`, `--no-site-file` and `--discard-old-file`) and the update's settings-move, publish-list and hidden-entry rows.
- **`manifest convert` and `manifest hidden`.**
- **Settings in the site folder's `vault.config.json`**: only `vaultPath` is read there.
- **Running the site's `package.json` build hooks**: build steps live in `player_site.before_build` and `player_site.after_build`.
- **The closing WARNING line** a build printed for campaign settings left in the site folder's `vault.config.json` (a leftover is now a stop, below).

### Changed

- **A leftover stops the build by name.** Any key but `vaultPath` in the site folder's `vault.config.json` stops it with each key's new home (`siteTitle (now player_site.title)`); so does a build hook left in the site's `package.json`, naming the setting it moved to, and a `package.json` that cannot be read. `setup-status-bar` and `setup-inbox` stop on a leftover before they change anything.
- **Both settings files present stops the build**, and says to remove or rename the old one once its settings are checked against the new one.
- **The update refuses a vault that is not moved** (exit 2; `vault_check.py version` says `REFUSED`, a new verdict, with the file and the fix): no stamp or one older than 1.10.60, the old settings file (alone or beside the new one), the old publish list, a site publish tool older than 1.27.0, and every leftover the build stops on (site-folder keys, `package.json` build scripts or a `package.json` that cannot be read). It asks the publish tool which leftovers there are, so the update and the build agree; settings the tool refuses, or a site tool whose version cannot be read, are named. The gate does not need node: without it, it checks the stamp, the old settings file and the old publish list, and the update says the site checks were skipped (the build still stops on the rest). A vault with no site has no site checks. The message links to the last 1.10 release.
- **The Settings check names the file a leftover is in** (`vault.config.json`, `package.json`, the old file) and shows the `package.json` stops it used to miss.
- **The update's floor is 1.10.60, and the vault must actually be moved.** A stamp alone is not enough.
- **Messages name settings directly**, by the one name each has.

### Fixed

- **An unreadable `player_site.folder_map` stops the build** (#375). It was a warning, and the build then read an empty map and published no pages.
- **A hiding-list entry YAML reads as something else stops the build.** A bare `007` was read as the number 7 (and `1e3`, `0x1F`, `1.50` and `true` likewise), so it matched nothing and what it hid published. Quote it (`'007'`); a number that reads back as written (`1999`) is fine.
- **A `player_site.folder_map` entry whose value is not a folder name** (empty, a number, a list) stops the build, naming the entry. It published under a made-up folder (`null/`).

### Publish tool 1.69.0

- Reads only `_meta/vault-config.yaml` and `_meta/publish-list.yaml`; the old settings file or publish list stops a build by name, alone or beside the new one.
- A key other than `vaultPath` in the site folder's `vault.config.json`, a non-list, empty or null hiding key there, a build hook left in the site's `package.json`, or a `package.json` that cannot be read stops `build`, `deploy`, `doctor --site` and the set-up commands, naming each and where it moved.
- `build --site gm` on a vault with only the old settings file names that file.
- `settings move`, `manifest convert` and `manifest hidden` are gone, with the site-file fallback and the closing WARNING line.
- An unreadable `player_site.folder_map` is a stop (#375).
- `config.js` no longer exports `SITE_OFF` for one test (#382).
- `settings get` and `settings check` carry the `package.json` stops, the old publish list and an unparseable site `vault.config.json`, each with its `source`; the old-file and old-list messages say a 1.10 release, 1.10.134 or later.
- A hiding-list entry YAML reads as other than its text, and a `folder_map` value that is not a folder name, stop.

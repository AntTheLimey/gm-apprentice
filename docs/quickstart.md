# Quickstart: Your First Campaign

From a spark of an idea to your first session. This assumes you've
[installed gm-apprentice](../README.md#installation) and know your way
around a tabletop RPG, but are new to using Claude as a GM tool.

You talk to Claude normally — "skills" activate automatically from what
you ask. You never pick one by hand. When you say "help me start a new
campaign," Claude reaches for **the-midwife**; "build me an NPC" reaches
for **ttrpg-expert**. The skills handle the rest.

Tell Claude which system you're running when you start — it won't assume.
gm-apprentice supports **Call of Cthulhu 7e** (with the Regency Cthulhu
variant), **GURPS 4e**, **Forged in the Dark**, **D&D 5e (2024)**, and
**Pathfinder 2e (Remaster)**.

## 1. Conceive it — the-midwife

Start with the idea, however rough — or with nothing at all:

> "I want to run a Call of Cthulhu game set in 1920s New York. Help me
> figure out what it's about."

The midwife draws the concept out through conversation. It sparks,
shapes, and refines — offering possibilities as seeds, never deciding for
you — and builds worlds in motion: factions that act, clocks that tick,
and a "what if the players do nothing?" answer for every problem. Three
strong ideas beat six half-formed ones.

When you're happy with the shape of it, the midwife writes an **adventure
brief** and **scaffolds your vault** — the folder structure, config, and
the Session 0 entities — ready to play. Starting fresh, building on an
existing campaign, or adding a new chapter all work; point it at an
existing vault and it will build on your canon instead.

## 2. Build out the world — ttrpg-expert

Now fill in the specifics, as you need them:

> "Make the campaign's main antagonist — a wealthy industrialist who's
> funding occult research. CoC 7e."

> "Create three Manhattan locations the investigators might visit: a
> speakeasy, a university library, and a waterfront warehouse."

> "I need a faction — a secret society operating out of a brownstone on
> the Upper East Side."

Each piece of generated content starts as DRAFT. Review it, and it
becomes part of your canon. ttrpg-expert also handles rules lookups,
stat blocks, encounter design, and continuity checks across all five
systems.

## 3. Prep your first session — session-prep

With the world taking shape, prep for play:

> "Help me prep session 1. The investigators are hired by a missing
> professor's daughter to find her father — last seen at his office at
> Columbia University."

Session-prep reconciles where things stand, plans the session as scenes
you choose from (offered as options, never decided for you), and flags
the gaps — NPCs you still need, locations you haven't fleshed out, clues
you should plant. Hand any gap back to ttrpg-expert:

> "Create the professor's office as a location — include three clues the
> investigators might find there."

## 4. Run it — session-play

At the table, keep it fast:

> "What's the roll to notice a hidden drawer in a desk? CoC 7e."

> "Quick NPC: a nervous front-desk clerk who knows more than she says."

session-play is speed-optimised — short answers, no unsolicited analysis
— and captures play notes as you go for the wrap-up.

## 5. Process it — session-wrapup

When the session ends, hand over what happened:

> "Session's over. Here are my notes:
> - Players explored the office, found the diary and a strange symbol but
>   missed the locked drawer
> - Met Mrs. Chen at the front desk, she was helpful
> - Combat with two thugs in the alley behind the speakeasy
> - Ended with the informant dead and a cryptic note"

Wrap-up writes a narrative recap, creates entity files for the new NPCs
(Mrs. Chen, the informant, the thugs), updates existing entities, records
the timeline, and tells you what carries forward. Next time you prep,
session-prep reconciles anything that got skipped.

## Keep the vault healthy

The midwife scaffolds your starting vault, so you don't need these on day
one — reach for them as the campaign grows:

- **campaign-organizer** — once you've generated a lot of content (or want
  to bring in notes from elsewhere), it files entities into the right
  folders, cross-links them, and builds the knowledge graph.
- **campaign-qa** — a periodic health check for contradictions, timeline
  slips, confusable names, and clue coverage. Run it after a big session:
  > "Run a QA check on Chapter 1."
- **vault-ingest** — import old campaign material (notes, character
  sheets, transcripts, spreadsheets) into the vault, interviewing you to
  recover what actually happened.
- **publish-site** — publish the vault as a static website to share with
  your players.

## What's next

You now have a working campaign vault and a session under your belt. The
rhythm from here: **prep → play → wrap-up** each session, with
**campaign-qa** and **campaign-organizer** for upkeep and **ttrpg-expert**
on call for rules, content, and continuity.

**Want deeper system coverage?** If you own rulebooks beyond the free
SRDs, add personal reference files so Claude can use your setting content,
factions, and generation tables. See
[Adding Your Own Reference Material](personal-reference-files.md).

For detailed guidance on each skill:

- [the-midwife](the-midwife.md)
- [ttrpg-expert](ttrpg-expert.md)
- [campaign-organizer](campaign-organizer.md)
- [campaign-qa](campaign-qa.md)
- [session-prep](session-prep.md)
- [session-play](session-play.md)
- [session-wrapup](session-wrapup.md)
- [vault-ingest](vault-ingest.md)
- [publish-site](publish-tool.md)
- [Campaign Lifecycle](campaign-lifecycle.md) — the whole arc, end to end

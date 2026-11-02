'use strict';
// A small campaign for the Story page tests: one chapter, two played sessions, each with a wrap-up shaped as the
// session-wrapup skill writes one (skills/shared/templates/session-wrap.md) and a Play Notes note, and one NPC the
// recaps link. `storyVault(overrides)` returns { 'Folder/Note.md': text }; an override replaces the note at its path,
// adds a new one, or (given null) takes one out.

const PLAY_NOTES = (n) => `---
type: session-play-notes
session: "[[Session ${n}]]"
publish: false
---

# Session ${n} — Play Notes

## Scenes

- Scene one of session ${n}: PLAYNOTES-${n}.
`;

const SESSION = (n) => `---
type: session
title: Session ${n}
session_number: ${n}
chapter: "[[Chapter 1 Overview]]"
status: played
play_date: "2026-10-0${n}"
documents:
  wrap_up: "[[Session ${n} Wrap-Up]]"
  play_notes: "[[Session ${n} Play Notes]]"
---

# Session ${n}

HUB-BODY-${n}: what the GM prepped.
`;

const WRAP_1 = `---
type: session_wrap
session: "[[Session 1]]"
session_number: 1
chapter: "[[Chapter 1 Overview]]"
campaign: "Story Test"
play_date: "2026-10-01"
source_document: "[[Session 1 Play Notes]]"
canon_status: DRAFT
created_by: session-wrapup
tags: []
---

# Chapter 01 · Session 01 — The Docks — Wrap-Up

<!-- gm-only -->
> [!info] Source
> Written from the Play Notes, GMSECRET-SOURCE-1.
<!-- /gm-only -->

## Narrative Recap

The party reached the docks at dusk, where [[Mara Quill]] waited with a lantern and a ledger.

## Loot

- A brass key stamped LOOT-KEY-1.

## Memorable Moments

**Mara Quill walked straight off the end of the pier, MOMENT-FUNNY-1.**
*Nobody moved to help her for a full minute. #moment/funny*

> "The tide waits for no one, and neither do I. MOMENT-QUOTE-1"
> — [[Mara Quill]]

*Said as the last boat left without the party, MOMENT-CONTEXT-1. #moment/epic*

<!-- gm-only -->

## GM Notes

### Quick Bullets

- GMSECRET-NOTES-1: Mara is the smuggler they are hunting.

### Handoff to session-prep

The next session opens on the boat.

<!-- /gm-only -->
`;

const WRAP_2 = `---
type: session_wrap
session: "[[Session 2]]"
session_number: 2
chapter: "[[Chapter 1 Overview]]"
campaign: "Story Test"
play_date: "2026-10-02"
source_document: "[[Session 2 Play Notes]]"
canon_status: DRAFT
created_by: session-wrapup
tags: []
---

# Chapter 01 · Session 02 — The Boat — Wrap-Up

<!-- gm-only -->
> [!info] Source
> Written from the Play Notes, GMSECRET-SOURCE-2.
<!-- /gm-only -->

## Narrative Recap

The party crossed the bay at night, RECAP-TWO-1, and lost sight of the lantern.

<!-- gm-only -->

## GM Notes

- GMSECRET-NOTES-2: the boat was hers all along.

<!-- /gm-only -->
`;

const MARA = `---
type: npc
title: Mara Quill
status: alive
---

# Mara Quill

A dockside fixer with a ledger, NPC-BODY-1.
`;

const CHAPTER = `---
type: chapter
title: Chapter 1 — Docks
sort_order: 1
---

# Chapter 1 — Docks

## Overview

The docks, CHAPTER-BODY-1.
`;

const BASE = {
  'Chapters/Chapter 1/Chapter 1 Overview.md': CHAPTER,
  'Sessions/Session 1.md': SESSION(1),
  'Sessions/Session 2.md': SESSION(2),
  'Sessions/Session 1 Wrap-Up.md': WRAP_1,
  'Sessions/Session 2 Wrap-Up.md': WRAP_2,
  'Sessions/Session 1 Play Notes.md': PLAY_NOTES(1),
  'Sessions/Session 2 Play Notes.md': PLAY_NOTES(2),
  'NPCs/Mara Quill.md': MARA,
};

// The strings that must never reach the player site: each sits only in a gm-only part of a note, or in a note that
// does not publish. Every other marker above (LOOT-KEY-1, MOMENT-FUNNY-1, ...) is player text: SHOWN.
const SECRETS = ['GMSECRET-NOTES-1', 'GMSECRET-NOTES-2', 'GMSECRET-SOURCE-1', 'GMSECRET-SOURCE-2', 'PLAYNOTES-1', 'PLAYNOTES-2'];
const SHOWN = ['The party reached the docks', 'LOOT-KEY-1', 'MOMENT-FUNNY-1', 'MOMENT-QUOTE-1', 'MOMENT-CONTEXT-1', 'RECAP-TWO-1', 'NPC-BODY-1', 'CHAPTER-BODY-1'];

function storyVault(overrides = {}) {
  const files = { ...BASE };
  for (const [rel, text] of Object.entries(overrides)) {
    if (text == null) delete files[rel];
    else files[rel] = text;
  }
  return files;
}

module.exports = { storyVault, SECRETS, SHOWN, CHAPTER, WRAP_1, WRAP_2, SESSION, PLAY_NOTES };

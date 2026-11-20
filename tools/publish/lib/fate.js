'use strict';

// An NPC's hidden fate: the one rule for "is this note's person dead?". The run sheet reader asks it
// directly, and npc_stats.py (Python) asks it through `gm-publish lines` ({"op":"fate"}), so there is
// one copy of the rule and nothing to drift (#788).
//
// The fate is the last bullet of the note's `GM Notes` > `Behind the Scenes` section that is not struck
// through and opens with a bold sentence ending in a full stop (`**Dead.**`, `**Alive, freed.**`). A bold
// lead with no full stop (`**Motive:**`, `**The Lodge**`) is no fate. A later fate beats an earlier one.
// The truth beats `status`, which is what the players know.

const { fenceMask } = require('./run-sheet/plan-text');

const FATE = /^[-*+]\s+(?<s1>~~)?\s*(?:(?:\*\*)?\[\[[^\]\n]+\]\](?:\*\*)?\s*[—–-]+\s*)?(?<s2>~~)?\*\*(?<fate>(?!\[\[)[^*\n]+?)\*\*/;
const DEAD = /^dead\b/i;
const HEADING = /^(#{1,6})\s+(.+?)\s*$/;
const ATX_CLOSE = /\s+#+\s*$/;

// Headings compare case folded, spaces folded, and no space round a "/".
const key = (title) => title.split('/').map((p) => p.split(/\s+/).filter(Boolean).join(' ')).join('/').toLowerCase();

// The note's body: everything after the closing `---`, stripped; the whole text with no frontmatter.
function bodyOf(text) {
  const m = /^﻿?---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  return (m ? m[1] : text).trim();
}

// The lines of `GM Notes` > `Behind the Scenes` (first match of each, at any depth below), or null.
function behindTheScenes(lines) {
  const mask = fenceMask(lines);
  const heads = [];
  lines.forEach((l, i) => {
    if (mask[i]) return;
    const m = HEADING.exec(l);
    if (m) heads.push({ at: i, level: m[1].length, title: key(m[2].replace(ATX_CLOSE, '').trim()) });
  });
  const endOf = (h) => {
    const next = heads.find((x) => x.at > h.at && x.level <= h.level);
    return next ? next.at : lines.length;
  };
  // Any `GM Notes` heading: the first one that holds a `Behind the Scenes` section (a stub above the real one is skipped).
  for (const gm of heads.filter((h) => h.title === 'gm notes')) {
    const gmEnd = endOf(gm);
    const bts = heads.find((h) => h.at > gm.at && h.at < gmEnd && h.level > gm.level && h.title === 'behind the scenes');
    if (bts) return lines.slice(bts.at + 1, endOf(bts));
  }
  return null;
}

// The current hidden fate (the words inside the bold) of a note's BODY, frontmatter already gone; null when none.
function hiddenFateOfBody(body) {
  const lines = String(body).replace(/\r\n?/g, '\n').trim().split('\n');
  const section = behindTheScenes(lines);
  if (!section) return null;
  let fate = null;
  for (const line of section) {
    const m = FATE.exec(line);
    if (!m) continue;
    const { s1, s2, fate: f } = m.groups;
    if (s1 || s2 || !f.trimEnd().endsWith('.') || f.trimStart().startsWith('~~')) continue;
    fate = f.trim();
  }
  return fate;
}

// The same for a whole note's text, frontmatter and all.
const hiddenFate = (text) => hiddenFateOfBody(bodyOf(String(text).replace(/\r\n?/g, '\n')));

// Is the NPC dead? Its hidden fate says so when it has one; else its frontmatter `status` does.
function isDeadBody(body, fm) {
  const fate = hiddenFateOfBody(body);
  if (fate !== null) return DEAD.test(fate);
  return String((fm && fm.status) || '').trim().toLowerCase() === 'dead';
}
const isDead = (text, fm) => isDeadBody(bodyOf(String(text).replace(/\r\n?/g, '\n')), fm);

module.exports = { hiddenFate, hiddenFateOfBody, isDead, isDeadBody };

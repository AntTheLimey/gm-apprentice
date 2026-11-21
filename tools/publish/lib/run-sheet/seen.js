'use strict';
// A foe's starting "seen": whether its name already shows on the players' screen. A note is seen when
//   - it publishes on the player site (the caller's `publishes`, the build's own decision), or
//   - an earlier played session named it in its Play Notes or Table Log: by a [[link]] to it, or by its
//     WHOLE name or an alias as words. Never part of a word, never a first name alone, never a
//     `gm_aliases` name (that is the GM's own word for the person).
// "Earlier" is the story order `listSessions` gives, never `play_date` (free text). Matching a wrong note
// would put a hidden foe's name in front of the players, so every doubt reads as not seen.
// Returns `{ [note]: 'on the player site' | 'named in <session label>' }`, and only for the notes seen.

const pt = require('./plan-text');
const { stemOf } = require('./notes');
const { listSessions, isPlayed, tableLogOf, playNotesOf } = require('./sessions');
const { nameList } = require('../processor');
const { canonicalNfc } = require('../unicode');

const TYPES = new Set(['npc', 'creature']);
const MIN_NAME = 3;
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The whole name as words: no letter, digit or underscore either side; a space in the name matches a
// space, an underscore (file names) or a run of either. Case counts: "Hunter" is not "hunter".
function wholeName(name) {
  const body = escape(name.trim()).replace(/(?:\\?[ _])+/g, '[ _]+');
  return new RegExp(`(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])`, 'u');
}

function readSeen({ vaultPath, index, sessionIndex, publishes, deps }) {
  const fmOf = (p) => (index.has(p) ? index.read(p).fm || {} : {});
  const people = index.notes().filter((p) => TYPES.has(String(fmOf(p).type || '').trim().toLowerCase()));
  const seen = {};
  for (const p of people) if (publishes(p)) seen[p] = 'on the player site';

  // The played sessions before this one, in story order, with the texts they hold.
  const sessions = sessionIndex ? listSessions(vaultPath, { deps, index }) : [];
  const at = sessions.findIndex((s) => s.index === sessionIndex);
  const records = [];
  for (const s of at < 1 ? [] : sessions.slice(0, at)) {
    if (!isPlayed(index, s.index)) continue;
    const texts = [playNotesOf(index, s.index), tableLogOf(index, s.index).log]
      .filter((n, i, all) => n && all.indexOf(n) === i)
      .map((n) => canonicalNfc(index.read(n).body || ''));
    if (!texts.length) continue;
    records.push({ label: s.label, text: texts.join('\n'), targets: new Set(texts.flatMap((t) => pt.links(t)).map((t) => index.resolve(t)).filter(Boolean)) });
  }
  if (!records.length) return seen;

  for (const p of people) {
    if (seen[p]) continue;
    const fm = fmOf(p);
    const names = [...new Set([typeof fm.name === 'string' ? fm.name : '', stemOf(p), ...nameList(fm.aliases)]
      .map((n) => canonicalNfc(n).trim()).filter((n) => n.length >= MIN_NAME))];
    const res = names.map(wholeName);
    const hit = records.find((r) => r.targets.has(p) || res.some((re) => re.test(r.text)));
    if (hit) seen[p] = `named in ${hit.label}`;
  }
  return seen;
}

module.exports = { readSeen };

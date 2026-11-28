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
const { nameList, playerSafeMarkdown } = require('../processor');
const { readTableLog } = require('./table-log');
const { TABLE_LOG_SECTIONS } = require('./record');
const { canonicalNfc } = require('../unicode');

const TYPES = new Set(['npc', 'creature']);
const MIN_NAME = 3;
// What a Table Log holds of play the players saw: who was unmasked, what points landed, what was handed
// over. The rest is prep, misses and the vitals of foes fought unseen. The titles come from record.js.
const PLAYED_SECTIONS = TABLE_LOG_SECTIONS.filter((n) => ['Unmasked', 'Points landed', 'Handouts'].some((k) => n.startsWith(k)));
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The whole name as words: no letter, digit or underscore either side; a space in the name matches a
// space, an underscore (file names) or a run of either. Case counts: "Hunter" is not "hunter".
function wholeName(name) {
  const body = escape(name.trim()).replace(/(?:\\?[ _])+/g, '[ _]+');
  return new RegExp(`(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])`, 'u');
}

// `config` is loadPublishConfig's shape (exclude_sections, exclude_callouts); `publishes(note)` is the
// players' publish answer, strict (see read.js). `after`, for a session not filed yet (no index, or one the
// order lacks): the sessions read are those up to and including it.
function readSeen({ vaultPath, index, sessionIndex, after = null, publishes, config = {}, deps }) {
  const fmOf = (p) => (index.has(p) ? index.read(p).fm || {} : {});
  const people = index.notes().filter((p) => TYPES.has(String(fmOf(p).type || '').trim().toLowerCase()));
  const seen = {};
  for (const p of people) if (publishes(p)) seen[p] = 'on the player site';

  // The played sessions before this one, in story order, with the texts they hold.
  const sessions = sessionIndex || after ? listSessions(vaultPath, { deps, index }) : [];
  const here = sessionIndex ? sessions.findIndex((s) => s.index === sessionIndex) : -1;
  const at = here >= 0 ? here : (after ? sessions.findIndex((s) => s.index === after) + 1 : -1);
  const records = [];
  for (const s of at < 1 ? [] : sessions.slice(0, at)) {
    if (!isPlayed(index, s.index)) continue;
    // Each record is cut as the player site cuts a page (the one strip chain), so a name a note hides from
    // players (%% %%, gm-only, spoiler, a hidden section) is not read as met.
    const safe = (note, body) => playerSafeMarkdown(body, {
      excludeSections: config.exclude_sections, excludeCallouts: config.exclude_callouts, frontmatter: index.read(note).fm || {},
    }).text;
    const texts = [];
    const notes = playNotesOf(index, s.index);
    if (notes) texts.push(safe(notes, index.read(notes).body || ''));
    const log = tableLogOf(index, s.index).log;
    if (log) {
      // cut first, so a section the vault hides by its heading is gone before the sections are read
      const sections = readTableLog(safe(log, index.read(log).body || '')).sections;
      for (const name of PLAYED_SECTIONS) if (sections.get(name)) texts.push(sections.get(name));
    }
    if (!texts.length) continue;
    const text = canonicalNfc(texts.join('\n'));
    records.push({ label: s.label, text, targets: new Set(pt.links(text).map((t) => index.resolve(t)).filter(Boolean)) });
  }
  if (!records.length) return seen;

  for (const p of people) {
    if (seen[p]) continue;
    const fm = fmOf(p);
    const full = typeof fm.name === 'string' ? canonicalNfc(fm.name).trim() : '';
    // the file name counts unless it is only part of the declared name (NPCs/Marek.md for Marek Solano)
    const stem = canonicalNfc(stemOf(p)).trim();
    const part = full && stem !== full && full.split(/[\s_]+/).includes(stem);
    const names = [...new Set([full, part ? '' : stem, ...nameList(fm.aliases)]
      .map((n) => canonicalNfc(n).trim()).filter((n) => n.length >= MIN_NAME))];
    const res = names.map(wholeName);
    const hit = records.find((r) => r.targets.has(p) || res.some((re) => re.test(r.text)));
    if (hit) seen[p] = `named in ${hit.label}`;
  }
  return seen;
}

module.exports = { readSeen };

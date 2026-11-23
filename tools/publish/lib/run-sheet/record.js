'use strict';
// The Table Log writer: the 17-section body a session's state renders to, and the rewrite of a Table
// Log note around it (skills/shared/session-document-chain.md §3c; the reader is table-log.js).
// Pure: it reads no file and no clock. The server (step 7) decides when to write and what to keep aside.

const crypto = require('node:crypto');
const path = require('node:path');
const RS = require('./web/state');
const { fenceMask } = require('./plan-text');
const { vitalsColumns } = require('../shared-lists');

// The sides the GM set in a fight (plan 6a), one `- [[Note]]: side` per note; the reader carries the latest.
const SIDES_SET = 'Sides set';
// every known place a PC stood at tonight, linked, in order of first arrival (Task 13 proof: Ant's ruling, a place the
// players go to becomes visible and published; reveal_scan reads this section)
const PLACES_WENT = 'Places the party went';
// The same list as `TABLE_LOG_SECTIONS` in skills/shared/scripts/vault_write.py; a test compares the two.
const TABLE_LOG_SECTIONS = [
  'Where everyone ended', 'Stopped in', 'Points landed',
  'Tried and missed', 'Overtaken', 'Reached but not landed',
  'Not reached', 'Changed since play started',
  'Contingencies that fired', 'Improvised beats', PLACES_WENT,
  'Unmasked this session', SIDES_SET, 'Handouts handed over', 'Log', 'Loot',
  'Vitals at the end', 'Advancement',
];
const VITALS = 'Vitals at the end';
// An Improvised beats line for a place typed tonight (plan 6a Task 7): `- New place: The Docks`.
const NEW_PLACE = 'New place:';
// The vitals table's header and separator rows: Who, then the system's columns (model.rules.vitals, the ontology's
// `run_sheet.vitals`; D&D's `| Who | HP | Conditions |` when none). vault_write.table_log_vitals_head writes the same.
const vitalsHead = (cols) => {
  const names = ['Who', ...cols.map((c) => c.column)];
  return `| ${names.join(' | ')} |\n|${' --- |'.repeat(names.length)}`;
};
const columnsOf = (model) => (model && model.rules && Array.isArray(model.rules.vitals) && model.rules.vitals.every((c) => c && typeof c === 'object')
  ? model.rules.vitals : vitalsColumns(model && model.system));
// A pool's max, by its field (Luck has none).
const MAX_OF = { hp: 'max', mp: 'mpMax', san: 'sanMax', fp: 'fpMax' };

const lf = (s) => String(s == null ? '' : s).replace(/\r\n?/g, '\n');
const one = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const low = (s) => String(s).trim().toLowerCase();
const TITLES = new Set(TABLE_LOG_SECTIONS.map(low));

// `[[stem]]` when the vault resolves that stem to this very note, else the path without `.md`.
function linkFor(index) {
  return (p) => {
    const stem = path.posix.basename(p, '.md');
    return index.resolve(stem) === p ? `[[${stem}]]` : `[[${String(p).replace(/\.md$/, '')}]]`;
  };
}

function localTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--:--';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// A section is its heading and its text; an empty one is a bare heading.
function render(sections) {
  return sections.map(({ title, text }) => (text ? `## ${title}\n\n${text}\n` : `## ${title}\n`)).join('\n');
}

function tableLogBody(model, state, { linkFor: link, timeOf = localTime } = {}) {
  const d = RS.derive(model, state);
  const bullets = (items) => items.map((t) => `- ${t}`).join('\n');
  const sec = {};
  const beatByKey = new Map(d.beats.map((b) => [b.key, b]));
  const who = (to) => (to === 'party' ? 'the party' : link(to));
  // a place's link carries its title when the link's own words would not say it (a folder note's `[[…/index]]`)
  const placeLink = (p) => {
    const n = (model.placeNotes && model.placeNotes[p]) || (model.notes && model.notes[p]) || null;
    const t = n && n.title;
    const l = link(p);
    const shown = l.slice(2, -2).split('/').pop();
    return t && shown !== t ? `${l.slice(0, -2)}|${t.replace(/[|\]]/g, ' ')}]]` : l;
  };

  // Everyone left unplaced is "not placed", but only when someone was placed: a GM who touched
  // nothing gets a bare section, never a made-up "everyone at beat 1".
  const anyPlaced = d.whereEnded.some((w) => w.status !== 'unplaced' || w.text);
  sec['Where everyone ended'] = bullets(d.whereEnded.filter((w) => anyPlaced).map((w) => {
    let at;
    if (w.text) at = one(w.text);
    else if (w.status === 'unplaced') at = 'not placed';
    else if (w.status === 'off') at = 'off-screen';
    else if (w.status === 'gone') at = one(w.title);
    else if (w.place) at = `${placeLink(w.place)}${w.spotName ? ` (${one(w.spotName)})` : ''}`;
    else at = one(w.title);
    return `${link(w.pc)}: ${at}`;
  }));

  sec['Stopped in'] = d.stopped ? bullets([(() => {
    const b = beatByKey.get(d.stopped.beat);
    return `${one(d.stopped.title)}${b && b.place ? ` (${link(b.place)})` : ''}`;
  })()]) : '';

  const point = (p) => `${one(p.beatTitle)}: ${one(p.text)}`;
  sec['Points landed'] = bullets(d.pointsBy.landed.map(point));
  sec['Tried and missed'] = bullets(d.pointsBy.missed.map(point));
  sec.Overtaken = bullets(d.pointsBy.overtaken.map(point));
  sec['Reached but not landed'] = bullets(d.pointsBy.open.map(point));
  // Nothing reached yet means play has not started: a bare section, not "every beat".
  sec['Not reached'] = d.reached.size ? bullets(d.notReached.map((b) => one(b.title))) : '';

  sec['Changed since play started'] = bullets(d.orphans.map((o) => {
    const text = one(o.text);
    const beat = one(o.beatTitle);
    if (o.kind === 'point') return `Point "${text}"${beat ? ` (${beat})` : ''}: ${one(o.value)}; no longer in the Plan`;
    if (o.kind === 'loot') return `Loot "${text}"${beat ? ` (${beat})` : ''}: to ${who(o.value)}; no longer in the Plan`;
    if (o.kind === 'handout') return `Handout "${text}": handed over; no longer in the Plan`;
    if (o.kind === 'spot') return `Spot${beat ? ` in "${beat}"` : ''}: ${link(o.value)} stood there; no longer in the Plan`;
    if (o.kind === 'vitals') {
      const v = o.value;
      const hp = v.hp !== null ? `HP ${one(v.hp)}${v.max !== null ? `/${one(v.max)}` : ''}` : v.max !== null ? `HP max ${one(v.max)}` : '';
      // the system's pools the GM set on the end panel (MP, SAN, Luck, FP), by their column words
      const pools = columnsOf(model).filter((c) => c.field !== 'hp' && c.field !== 'conditions' && v[c.field] !== undefined && v[c.field] !== null && v[c.field] !== '')
        .map((c) => `${c.column} ${one(v[c.field])}`);
      return `Vitals for ${link(o.note)}${o.copy > 1 ? ` ${o.copy}` : ''}: ${[hp, ...pools, one(v.conditions)].filter(Boolean).join(', ')}; no longer in the Plan`;
    }
    const uses = o.value.map((v) => (v.startsWith('stood: ') ? `${link(v.slice(7))} stood there` : v));
    return `Beat "${text || o.key}": ${uses.join(', ')}; no longer in the Plan`;
  }));

  sec['Contingencies that fired'] = bullets(d.fired.map((f) => one(f.title)));
  // a place typed tonight (plan 6a Task 7) is `New place: <name>`, plain words: it has no note yet, and wrap-up
  // offers to make one. A known place the players were at tonight is its link: a PC was moved there (visited),
  // even if they left, or a fight was fought there (Fight here). reveal_scan reads these links and offers to
  // publish an unpublished place: the players have seen it (Ant, Task 7 fix round 1, review I2).
  const visited = (state && state.visited) || {};
  const fought = new Set([...(Array.isArray(state && state.fights) ? state.fights : []), ...(state && state.fight ? [state.fight] : [])].map((f) => f && f.beat));
  sec['Improvised beats'] = bullets(d.improvised.map((i) => {
    if (i.newPlace) return `${NEW_PLACE} ${one(i.title)}`;
    if (typeof i.place === 'string' && i.place && (visited[i.key] || fought.has(i.key))) return placeLink(i.place);
    return one(i.title);
  }));
  // Places the party went: a Plan beat's place, a hub spot's note, a known place's own beat. A place typed tonight
  // stays plain words under Improvised beats (it has no note). One link a place, by the time a PC first stood there.
  const went = [];
  const spotSuffix = (k) => String(k).split('.spot.')[1] || null;
  for (const [key, v] of Object.entries((state && state.visited) || {})) {
    const b = beatByKey.get(key);
    if (!b || !v || typeof v !== 'object' || b.newPlace) continue;
    const spots = b.spots || [];
    if (spots.length > 1) {
      for (const [sk, sat] of Object.entries(v.spots && typeof v.spots === 'object' ? v.spots : {})) {
        const sp = spots.find((x) => x.key === sk || (spotSuffix(x.key) && spotSuffix(x.key) === spotSuffix(sk)));
        if (sp && sp.note) went.push({ note: sp.note, at: sat });
      }
    } else {
      const note = b.place || (spots[0] && spots[0].note) || null;
      if (note) went.push({ note, at: v.at });
    }
  }
  went.sort((x, y) => String(x.at || '').localeCompare(String(y.at || '')));
  const wentSeen = new Set();
  sec[PLACES_WENT] = bullets(went.filter((x) => !wentSeen.has(x.note) && wentSeen.add(x.note)).map((x) => placeLink(x.note)));
  sec['Unmasked this session'] = bullets(
    d.unmaskedNow.filter((u) => !u.carried).map((u) => `${link(u.note)} as ${one(u.name)}`)
      .concat(d.maskedAgain.map((u) => `${link(u.note)} masked again`)),
  );
  sec[SIDES_SET] = bullets(d.sidesSet.map((x) => `${link(x.note)}: ${x.side}`));
  sec['Handouts handed over'] = bullets(d.handedOver.map((h) => (h.note ? link(h.note) : one(h.name || h.text))));

  // the GM's "Took back" line stays on the page: the Table Log keeps no trace of an add that never was
  sec.Log = bullets(d.log.filter((l) => !l.tookBack).map((l) => `${timeOf(l.at)} ${l.beatTitle ? `${one(l.beatTitle)}: ` : ''}${one(l.text)}`));

  sec.Loot = bullets(d.loot.map((l) => `${l.item ? link(l.item) : one(l.text)} to ${who(l.to)}`));

  const cell = (s) => one(s).replace(/\|/g, '/');
  // a figure is written with an ASCII hyphen-minus (`-3/12`), never U+2212: `sheet set` and the reader take `-`
  const figure = (x) => cell(String(x)).replace(/\u2212/g, '-');
  const cols = columnsOf(model);
  const rows = d.vitalsRecorded.map((v) => {
    const name = `${link(v.note)}${v.copy > 1 ? ` ${v.copy}` : ''}`;
    // The page sends what was typed: a `|` or a line break in a figure must not break the row.
    const set = (x) => x !== null && x !== undefined && x !== '';
    const cells = cols.map((c) => {
      if (c.field === 'conditions') return cell(v.conditions);
      // Luck (`pcs_only`) is never an ally's
      if (c.pcs_only && v.ally) return '';
      const now = v[c.field];
      if (!set(now)) return '';
      const max = MAX_OF[c.field] && v[MAX_OF[c.field]];
      let out = c.shape === 'current/max' && set(max) ? `${figure(now)}/${figure(max)}` : figure(now);
      // a figure from a fight says when it was taken; one set on the end panel or by a long rest is bare (decision 17)
      if (c.field === 'hp' && v.source === 'fight' && v.at) out += ` (after the fight, ${timeOf(v.at)})`;
      return out;
    });
    return `| ${name} | ${cells.join(' | ')} |`;
  });
  sec[VITALS] = rows.length ? `${vitalsHead(cols)}\n${rows.join('\n')}` : '';

  // Each non-empty line the GM typed is one bullet, so a typed `## ` never makes a section.
  sec.Advancement = bullets(lf(d.advancement).split('\n').map((l) => l.trim()).filter(Boolean));

  return render(TABLE_LOG_SECTIONS.map((title) => ({ title, text: sec[title] || '' })));
}

// A section's text without the blank lines round it; a first line's indent is kept (an indented
// code block or a nested bullet means something).
const unpad = (text) => text.replace(/^(?:[ \t]*\n)+/, '').replace(/\s+$/, '');

// The file's `##` sections: `head` is everything above the first one. A `## ` inside a code fence is
// the fence's text, never a section.
function split(fileText) {
  const lines = lf(fileText).split('\n');
  const fenced = fenceMask(lines);
  const head = [];
  const sections = [];
  let cur = null;
  lines.forEach((line, i) => {
    const m = fenced[i] ? null : /^##[ \t]+(.+?)[ \t]*$/.exec(line);
    if (m) { cur = { title: m[1], lines: [] }; sections.push(cur); } else if (cur) cur.lines.push(line);
    else head.push(line);
  });
  return { head: head.join('\n'), sections: sections.map((s) => ({ title: s.title, text: unpad(s.lines.join('\n')) })) };
}

const FM_TYPE = /^---\n([\s\S]*?)\n---(?:\n|$)/;
function isTableLog(fileText) {
  const m = FM_TYPE.exec(lf(fileText));
  return !!m && /^type:\s*["']?session-table-log["']?\s*$/m.test(m[1]);
}

// The note with its 17 sections replaced by `body`: the frontmatter, everything above the first `##`
// and any `##` section that is not one of the 17 (kept after Advancement, in order) stay as they are.
function rewriteTableLog(fileText, body) {
  if (!isTableLog(fileText)) {
    const e = new Error('not a Table Log note (type: session-table-log): not written');
    e.code = 'NOT_A_TABLE_LOG';
    throw e;
  }
  const crlf = /\r\n/.test(fileText);
  const { head, sections } = split(fileText);
  const own = sections.filter((s) => !TITLES.has(low(s.title)));
  let out = `${head.replace(/\s+$/, '')}\n\n${lf(body).trim()}\n`;
  if (own.length) out += `\n${render(own)}`;
  return crlf ? out.replace(/\n/g, '\r\n') : out;
}

// The file's 17-section body, normalised: LF, trimmed, in file order. What a hash is taken over.
function recordBodyOf(fileText) {
  return render(split(fileText).sections.filter((s) => TITLES.has(low(s.title)))).trim();
}

const bodyHash = (body) => crypto.createHash('sha1').update(lf(body).trim()).digest('hex');

// No section holds a bullet, a table data row or any other text. A header-only table counts as empty.
function isEmptySkeleton(body) {
  const { sections } = split(`## x\n${lf(body)}`.replace(/^## x\n(?=## )/, ''));
  const sepRow = (l) => /^\|?[\s:|-]*-[\s:|-]*\|?$/.test(l) && /\|/.test(l);
  return sections.every((s) => {
    const lines = s.text.split('\n').map((l) => l.trim()).filter(Boolean);
    return lines.every((l, i) => sepRow(l) || (/^\|/.test(l) && lines[i + 1] !== undefined && sepRow(lines[i + 1])));
  });
}

// True when the file's body is not what the server last wrote and holds something: copy it aside first.
function needsBackup(fileText, recordHash) {
  const b = recordBodyOf(fileText);
  if (isEmptySkeleton(b)) return false;
  return bodyHash(b) !== recordHash;
}

module.exports = { TABLE_LOG_SECTIONS, SIDES_SET, PLACES_WENT, NEW_PLACE, tableLogBody, rewriteTableLog, recordBodyOf, bodyHash, isEmptySkeleton, needsBackup, linkFor, timeOf: localTime };

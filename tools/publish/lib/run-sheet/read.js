'use strict';
// The run sheet reader: one session Plan and the notes it links, as one plain-data model (the
// shape is in the run-sheet reader plan). Read-only.
//
// Works with what it has: the one throw is a Plan file that cannot be read. Everything else that
// is missing or odd reads as an empty value ('' / [] / null) and a warning, a prep note for the GM.
// Nothing the Plan holds is dropped silently: a section no field takes goes to `prep`, and so do
// the lines a section's reader left over.

const path = require('node:path');
const pt = require('./plan-text');
const { buildIndex, stemOf } = require('./notes');
const { readBeats, sceneSection } = require('./beats');
const { readPcs, SECTIONS: PC_SECTIONS } = require('./party');
const { readPeople, TITLE: PEOPLE_TITLE } = require('./people');
const { readHandouts, TITLE: HANDOUTS_TITLE } = require('./handouts');
const { foesFor } = require('./foes');
const { readTableLog, VITALS } = require('./table-log');
const { orderedSessions } = require('../story-spine');
const { displayTitleOf } = require('../scanner');
const { unmaskedPlayAsOf } = require('./people-from-notes');
const { parseNote } = require('../frontmatter');
const { readSettings } = require('../settings/read');
const { readerFrom } = require('../vault-reader');
const { isWithheld, nameList, unmaskedNames, unmaskedNameUnread } = require('../processor');
const { canonicalNfc } = require('../unicode');

const toPosix = (p) => p.split(path.sep).join('/');
const low = (s) => canonicalNfc(String(s == null ? '' : s)).trim().toLowerCase();
const firstLine = (s) => String(s || '').split('\n')[0];

// The Plan's sections a field takes: the part readers' own tests, and the brief's three plus threads.
const FIELDS = [
  ['overview', (t) => low(t) === 'session overview'],
  ['world', (t) => low(t) === 'world state'],
  ['stops', (t) => low(t) === 'session end objectives'],
  ['threads', (t) => low(t) === 'active threads'],
  ['handouts', (t) => HANDOUTS_TITLE.test(t)],
  ['people', (t) => PEOPLE_TITLE.test(t)],
  ['planned', (t) => sceneSection(t) === 'planned'],
  ['contingency', (t) => sceneSection(t) === 'contingency'],
  ['pc', (t) => PC_SECTIONS.some((s) => s.re.test(t))],
];
const fieldOf = (title) => (FIELDS.find(([, test]) => test(String(title || ''))) || [null])[0];

// Every primitive string under `value`, depth first.
function stringsOf(value, out = []) {
  if (Array.isArray(value)) value.forEach((v) => stringsOf(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => stringsOf(v, out));
  else if (typeof value === 'string') out.push(value);
  return out;
}

// A frontmatter link field (`"[[X]]"`, a list of them, or a bare name) as one target, or ''.
const fmTarget = (v) => {
  const x = Array.isArray(v) ? v[0] : v;
  const s = x == null ? '' : String(x);
  return pt.links(s)[0] || s.trim();
};

// For each `##` section, every link in it must be on the page: in what came from that section
// (its fields' strings and paths, or its `prep` entry); a party PC counts in every section, its row
// being on the page. `resolve(target)` gives a path, null for a link to nowhere (that is a
// missing-note warning, not repeated here); by default the model's own `links` map answers, and a
// target it does not know is looked for by its text alone.
function completeness(planBody, model, { resolve } = {}) {
  const res = typeof resolve === 'function'
    ? resolve
    : (t) => (model.links && Object.prototype.hasOwnProperty.call(model.links, t) ? model.links[t] : undefined);
  const m = model || {};
  const prepOf = (title) => (m.prep || []).filter((p) => p.title === title);
  const partsOf = (title) => {
    const f = fieldOf(title);
    const brief = m.brief || {};
    switch (f) {
      case 'overview': return [brief.overview];
      case 'world': return [brief.world, prepOf(title)];
      case 'stops': return [brief.stops];
      case 'threads': return [m.threads];
      case 'handouts': return [m.handouts, prepOf(title)];
      case 'people': return [m.people, prepOf(title)];
      case 'planned': return [(m.beats || []).filter((b) => !b.contingency), prepOf(title)];
      case 'contingency': return [(m.beats || []).filter((b) => b.contingency), prepOf(title)];
      case 'pc': return [m.pcs, (m.unmatchedPcLines || []).filter((u) => u.section === title)];
      default: return [prepOf(title)];
    }
  };
  // A party PC is on the page in its own row, whichever section links it.
  const party = (m.pcs || []).map((p) => p.note);
  const out = [];
  const seen = new Set();
  for (const sec of pt.sections(planBody, 2)) {
    const strings = [...stringsOf(partsOf(sec.title)), ...party];
    const paths = new Set(strings);
    const targets = new Set();
    for (const s of strings) {
      for (const t of pt.links(s)) {
        targets.add(low(t));
        const p = res(t);
        if (p) paths.add(p);
      }
    }
    for (const t of pt.links(sec.text)) {
      const p = res(t);
      if (p === null) continue;
      if (targets.has(low(t)) || (p && paths.has(p))) continue;
      const name = sec.title || 'the text before the first section';
      const text = `${name}: [[${t}]] is in the Plan but not on the page`;
      if (seen.has(text)) continue;
      seen.add(text);
      out.push({ kind: 'not-on-page', note: m.plan || null, text });
    }
  }
  return out;
}

function readRunSheet(vaultPath, planPath, { party = [], deps } = {}) {
  const rd = readerFrom(deps);
  const abs = path.resolve(vaultPath, planPath);
  const plan = toPosix(path.relative(vaultPath, abs));
  // A Plan outside the vault cannot be read as part of it: the one error, like an unreadable file.
  if (plan === '' || plan === '..' || plan.startsWith('../') || path.isAbsolute(plan)) {
    throw new Error(`run sheet: the Plan ${planPath} is not inside the vault ${vaultPath}`);
  }
  let text;
  try {
    text = rd.readFile(abs);
  } catch (err) {
    throw new Error(`run sheet: could not read the Plan ${plan}: ${firstLine(err.message)}`, { cause: err });
  }
  text = String(text).replace(/\r\n?/g, '\n');

  const warnings = [];
  const portraits = new Map();
  const unmasks = new Map();
  const add = (list) => { for (const w of list || []) warnings.push(w); };
  let fm = {};
  let body = text;
  try {
    const parsed = parseNote(text);
    fm = parsed.data || {};
    body = parsed.content;
  } catch (err) {
    warnings.push({ kind: 'unreadable-frontmatter', note: plan, text: `frontmatter does not parse: ${firstLine(err.message)}` });
  }

  let system = null;
  try {
    // Settings values are nested by group: `vault.system` is values.vault.system.
    const values = readSettings({ vaultPath, deps }).values || {};
    system = (values.vault && values.vault.system) || null;
  } catch (err) {
    warnings.push({ kind: 'unreadable-settings', note: null, text: `the vault's settings could not be read (${firstLine(err.message)}): the game system is unknown` });
  }

  const index = buildIndex(vaultPath, { deps });
  const fmOf = (p) => (index.has(p) ? index.read(p).fm || {} : {});
  // A link that resolves to no note warns once, saying why (missing, ambiguous, in a skipped folder).
  const warnedLinks = new Set();
  const warnLink = (t) => {
    const why = index.linkProblem(t);
    if (!why || warnedLinks.has(low(why.text))) return;
    warnedLinks.add(low(why.text));
    warnings.push({ kind: why.kind, note: null, text: why.text });
  };
  const resolveFm = (v) => {
    const t = fmTarget(v);
    if (!t) return null;
    const p = index.resolve(t);
    if (p === null) warnLink(t);
    return p;
  };

  // Session.
  const sessionIndex = resolveFm(fm.session);
  const chapter = resolveFm(fm.chapter);
  const title = sessionIndex ? stemOf(sessionIndex) : stemOf(plan).replace(/\s+-\s+plan$/i, '');
  const numberOf = (planFm, indexPath, fallback) => {
    for (const v of [fmOf(indexPath).session_number, planFm.session_number]) {
      const n = Number(v);
      if (v !== undefined && v !== null && v !== '' && Number.isInteger(n)) return n;
    }
    const m = /\bsession\s+0*(\d+)\b/i.exec(fallback);
    return m ? Number(m[1]) : null;
  };
  const number = numberOf(fm, sessionIndex, fmTarget(fm.session) || title);

  // The parts.
  const sections = pt.sections(body, 2);
  const joined = (field) => sections.filter((s) => fieldOf(s.title) === field).map((s) => s.text).filter(Boolean).join('\n\n');
  const beatsRead = readBeats(body, index);
  add(beatsRead.warnings);
  const beats = beatsRead.beats;
  const seen = new Set();
  const carried = readCarried();
  for (const beat of beats) {
    const r = foesFor(beat, index, seen, carried);
    beat.foes = r.foes;
    beat.treasure.push(...r.treasure);
    add(r.warnings);
  }
  const pcsRead = readPcs(body, index, party);
  add(pcsRead.warnings);
  const peopleRead = readPeople(body, index);
  add(peopleRead.warnings);
  const handoutsRead = readHandouts(body, index);

  // Prep: every section no field takes, World State too, and what a reader left over, in Plan order.
  const prep = [];
  // Each leftover is pushed once, keyed as its reader keyed it: a scene section's preamble by its
  // exact title (beats.js), the handouts' and people's by field (each reader joins its sections).
  const leftOnce = new Set();
  const leftover = (sec, key, md) => {
    if (leftOnce.has(key)) return;
    leftOnce.add(key);
    if (md) prep.push({ title: sec.title, md });
  };
  for (const sec of sections) {
    const f = fieldOf(sec.title);
    if (f === null || f === 'world') prep.push({ title: sec.title, md: sec.text });
    else if (f === 'planned' || f === 'contingency') leftover(sec, `scenes:${sec.title}`, beatsRead.preamble[sec.title] || '');
    else if (f === 'handouts') leftover(sec, f, handoutsRead.leftover);
    else if (f === 'people') leftover(sec, f, peopleRead.leftover);
  }

  // Places and maps: every note the Plan links, first seen first; a beat's own paths (a scene
  // note's locations among them) count where its section stands.
  const linked = [];
  const beatsDone = new Set();
  for (const sec of sections) {
    if (!beatsDone.has(sec.title)) {
      beatsDone.add(sec.title);
      beats.forEach((b, i) => {
        if (beatsRead.sections[i] !== sec.title) return;
        linked.push(b.sceneNote, b.place, ...b.spots.map((s) => s.note), ...b.entities, ...b.handouts, ...b.who.map((w) => w.note));
      });
    }
    for (const t of pt.links(sec.text)) linked.push(index.resolve(t));
  }
  const uniq = (list) => [...new Set(list.filter((p) => index.has(p)))];
  const places = uniq(linked).filter((p) => low(fmOf(p).type) === 'location');
  const maps = uniq(linked).filter((p) => low(fmOf(p).doc_type) === 'map');

  // Map pairs: a GM map and the map players see. The GM map's `player_version` names it, else the
  // `X (GM)` / `X` name pair; a twin the Plan does not link is found in the index. A map with no
  // partner is not listed, and a broken `player_version` link is no pair (and no throw).
  const isMap = (p) => p !== null && index.has(p) && low(fmOf(p).doc_type) === 'map';
  const GM_SUFFIX = /\s*\(GM\)\s*$/i;
  const mapPairs = [];
  const pairSeen = new Set();
  const pair = (gm, player) => {
    if (!isMap(gm) || !isMap(player) || gm === player || pairSeen.has(`${gm}\n${player}`)) return;
    pairSeen.add(`${gm}\n${player}`);
    mapPairs.push({ gm, player });
  };
  const allMaps = index.notes().filter(isMap);
  // A GM map's player map: its `player_version` when that resolves to a map, else the name pair. A
  // `player_version` that names no note, or a note that is no map, warns on a GM map the Plan links: the
  // GM asked for a pair the sheet cannot make from it.
  const playerVersionWarning = (gm) => {
    const t = fmTarget(fmOf(gm).player_version);
    const named = t ? index.resolve(t) : null;
    if (!t || (isMap(named) && named !== gm)) return;
    const why = named === gm ? 'is this map itself' : named !== null ? 'is not a map (no doc_type: map)'
      : ((index.linkProblem(t) || {}).text || `[[${t}]] matches no note in the vault`).replace(`[[${t}]] `, '');
    warnings.push({ kind: 'map-pair', note: gm, text: `its player_version [[${t}]] ${why}; the sheet pairs it by name if it can` });
  };
  const playerOf = (gm) => {
    const t = fmTarget(fmOf(gm).player_version);
    const named = t ? index.resolve(t) : null;
    if (isMap(named) && named !== gm) return named;
    const stem = stemOf(gm);
    return GM_SUFFIX.test(stem) ? index.resolve(stem.replace(GM_SUFFIX, '')) : null;
  };
  const playerFor = new Map(allMaps.map((g) => [g, playerOf(g)]));
  for (const p of maps) {
    playerVersionWarning(p);
    pair(p, playerFor.get(p));
    // p as the player map: any GM map that points at it, by field or by name
    for (const g of allMaps) if (g !== p && playerFor.get(g) === p) pair(g, p);
  }

  // A link to nowhere anywhere in the Plan warns once (beats warn for theirs; the same text merges).
  for (const w of warnings) if (w.note === null) warnedLinks.add(low(w.text));
  for (const t of pt.links(body)) if (index.resolve(t) === null) warnLink(t);

  const runLong = readRunLong();

  const model = {
    system,
    plan,
    session: { index: sessionIndex, title, chapter, number },
    brief: { overview: joined('overview'), world: joined('world'), stops: joined('stops') },
    handouts: handoutsRead.handouts,
    pcs: pcsRead.pcs,
    unmatchedPcLines: pcsRead.unmatched,
    beats,
    people: peopleRead.people,
    places,
    maps,
    mapPairs,
    threads: joined('threads'),
    runLong,
    prep,
    notes: {},
    links: {},
    warnings: [],
  };

  // Links: every [[target]] in every string of the model, and in the Plan's own text (a field that
  // took a link as a path, such as a beat's who, still answers for it), as written.
  for (const s of [body, ...stringsOf([model.session, model.brief, model.handouts, model.pcs, model.unmatchedPcLines,
    model.beats, model.people, model.threads, model.prep])]) {
    for (const t of pt.links(s)) if (!Object.prototype.hasOwnProperty.call(model.links, t)) model.links[t] = index.resolve(t);
  }

  add(completeness(body, model, { resolve: (t) => index.resolve(t) }));
  // The index's warnings about notes this sheet touches (a note a warning names among them, such
  // as a PC whose frontmatter does not parse), and those about the vault as a whole. Each touched
  // note's portraits (its unmasked one too) are looked for first, so one that matches no picture warns here.
  const touched = new Set([...stringsOf(model), ...warnings.map((w) => w.note)].filter((x) => index.has(x)));
  for (const p of touched) { portraitOf(p); unmaskOf(p); }
  add(index.warnings.filter((w) => w.note === null || w.kind === 'unreadable-folder' || touched.has(w.note)));
  const kept = new Set();
  for (const w of warnings) {
    const k = JSON.stringify([w.kind, w.note, w.text]);
    if (kept.has(k)) continue;
    kept.add(k);
    model.warnings.push({ kind: w.kind, note: w.note === undefined ? null : w.note, text: w.text });
  }

  // Notes: one per note path anywhere in the model.
  for (const s of stringsOf(model)) {
    if (!index.has(s) || model.notes[s]) continue;
    model.notes[s] = noteOf(s);
  }
  if (!model.notes[plan]) model.notes[plan] = noteOf(plan, fm);
  return model;

  // The index's answer, asked once per note (a picture that cannot be found is its warning).
  function portraitOf(p) {
    if (!portraits.has(p)) portraits.set(p, index.has(p) ? index.portrait(p) : null);
    return portraits.get(p);
  }

  function noteOf(p, ownFm) {
    const read = index.has(p) ? index.read(p) : { fm: ownFm || {}, unreadable: false };
    const nfm = read.fm || {};
    const portrait = portraitOf(p);
    return {
      path: p,
      name: typeof nfm.name === 'string' && nfm.name.trim() ? nfm.name.trim() : stemOf(p),
      type: low(nfm.type),
      withheld: isWithheld(nfm),
      unreadable: Boolean(read.unreadable),
      portrait,
      location: typeof nfm.location === 'string' ? nfm.location : '',
      docType: low(nfm.doc_type),
      aliases: nameList(nfm.aliases),
      unmask: unmaskOf(p),
    };
  }

  // A disguised NPC's true self, behind the sheet's Unmask: only a note with one `unmasked_name` has
  // one (a `gm_aliases` name alone is no disguise). The name is read as reveal reads it (a link is the
  // name it links); a value that names no one, or several names (which reveal refuses), gives no Unmask
  // and a warning, as does a true face with no true name. Its face is null and its play-as '' when the
  // note gives none. Asked once per note, as the portrait is.
  function unmaskOf(p) {
    if (!unmasks.has(p)) {
      const nfm = index.has(p) ? index.read(p).fm || {} : {};
      const names = unmaskedNames(nfm);
      const unread = unmaskedNameUnread(nfm);
      const noSheet = ': no Unmask on the sheet';
      if (names.length > 1) warnings.push({ kind: 'unmask', note: p, text: `unmasked_name is a list of ${names.length} names; give it the one true name${noSheet}` });
      else if (unread !== null) warnings.push({ kind: 'unmask', note: p, text: `unmasked_name holds ${unread}, which names no one${noSheet}` });
      else if (names.length === 0 && nameList(nfm.unmasked_portrait).length > 0) {
        warnings.push({ kind: 'unmask', note: p, text: `unmasked_portrait is set but unmasked_name is empty${noSheet}` });
      }
      const name = names.length === 1 ? names[0] : null;
      unmasks.set(p, name ? { name, portrait: index.portrait(p, 'unmasked_portrait'), playAs: unmaskedPlayAsOf(p, index) } : null);
    }
    return unmasks.get(p);
  }

  // The previous session's Table Log, for the allies (an ally starts from its vitals there, else from
  // its note): `{ log, hp: Map<note path, hit points> }`, or null when there is none. "Previous" is the
  // session before this one in the site's story order (story-spine orderedSessions: chapter, then
  // number), never number alone. Only that one session's `documents.table_log` is read. A link there,
  // or a Who cell, that names no note warns once, naming the note it is in.
  function readCarried() {
    if (!sessionIndex) return null;
    // Page-shaped as the scanner makes them (its displayTitleOf: `title:`, else the stem), so a chapter
    // a session names by title owns it here as on the site. Sessions with equal sort keys (two with no
    // session_number in one chapter) keep their input order: the index's path order here, the scanner's
    // walk order on the site; only such unnumbered sessions can differ.
    const pages = index.notes().map((p) => ({
      title: stemOf(p), displayTitle: displayTitleOf(fmOf(p), stemOf(p)), frontmatter: fmOf(p), sourcePath: path.join(vaultPath, p), rel: p,
    }));
    const order = orderedSessions(pages);
    const at = order.findIndex((pg) => pg.rel === sessionIndex);
    if (at < 1) return null;
    const prev = order[at - 1].rel;
    const docs = fmOf(prev).documents;
    const t = fmTarget(docs && typeof docs === 'object' ? docs.table_log : null);
    if (!t) return null;
    const log = index.resolve(t);
    if (log === null) {
      const why = (index.linkProblem(t) || {}).text || `[[${t}]] matches no note in the vault`;
      warnings.push({ kind: 'table-log', note: prev, text: `its documents.table_log ${why}: allies start from their notes` });
      return null;
    }
    const hp = new Map();
    const bad = new Set();
    for (const v of readTableLog(index.read(log).body).vitals) {
      const who = index.resolve(v.who);
      if (who === null) {
        if (bad.has(low(v.who))) continue;
        bad.add(low(v.who));
        const why = (index.linkProblem(v.who) || {}).text || `[[${v.who}]] matches no note in the vault`;
        warnings.push({ kind: 'table-log', note: log, text: `${VITALS}: ${why}; nobody starts from that row` });
        continue;
      }
      if (v.hpNow !== null && !hp.has(who)) hp.set(who, v.hpNow);
    }
    return { log, hp };
  }

  // If you run long: never above the chapter. The chapter folder is the chapter note's folder,
  // else the nearest folder above the Plan holding a Sessions folder; the vault root is never one.
  function readRunLong() {
    const empty = { nextPlan: null, scenes: [], planning: [], contingencies: beats.filter((b) => b.contingency).map((b) => b.key) };
    let dir = chapter ? path.posix.dirname(chapter) : null;
    if (!dir || dir === '.') {
      dir = null;
      for (let d = path.posix.dirname(plan); d && d !== '.' && !d.startsWith('..'); d = path.posix.dirname(d)) {
        if (index.notes().some((n) => n.startsWith(`${d}/Sessions/`))) { dir = d; break; }
      }
    }
    if (!dir) {
      warnings.push({ kind: 'no-chapter', note: plan, text: 'the Plan names no chapter and sits in no chapter folder: if you run long, the page has nothing to fall back on' });
      return empty;
    }
    const inChapter = index.notes().filter((n) => n.startsWith(`${dir}/`) && n !== plan);
    let nextPlan = null;
    if (number !== null) {
      nextPlan = inChapter.find((n) => {
        const nfm = fmOf(n);
        if (low(nfm.type) !== 'session-plan') return false;
        const ix = index.resolve(fmTarget(nfm.session) || null);
        return numberOf(nfm, ix, fmTarget(nfm.session) || stemOf(n)) === number + 1;
      }) || null;
    }
    const scenes = inChapter.filter((n) => {
      const nfm = fmOf(n);
      return low(nfm.type) === 'scene' && !['played', 'dropped'].includes(low(nfm.status));
    });
    const planning = inChapter.filter((n) => n.startsWith(`${dir}/Planning/`)).map((n) => {
      const nfm = fmOf(n);
      return {
        note: n,
        kind: String(nfm.plan_type || nfm.type || ''),
        heads: pt.sections(index.read(n).body, 2).map((s) => s.title).filter(Boolean).slice(0, 8),
      };
    });
    return { ...empty, nextPlan, scenes, planning };
  }
}

module.exports = { readRunSheet, completeness };

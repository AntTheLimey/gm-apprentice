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
const { parseNote } = require('../frontmatter');
const { readSettings } = require('../settings/read');
const { readerFrom } = require('../vault-reader');
const { isWithheld, nameList } = require('../processor');
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
  for (const beat of beats) {
    const r = foesFor(beat, index, seen);
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
  // note's portrait is looked for first, so a portrait that matches no picture warns here.
  const touched = new Set([...stringsOf(model), ...warnings.map((w) => w.note)].filter((x) => index.has(x)));
  for (const p of touched) portraitOf(p);
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
    };
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

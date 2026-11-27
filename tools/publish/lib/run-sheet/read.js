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
const { placeTitle } = require('./place-name');
const { readBeats, sceneSection } = require('./beats');
const { readPcs, SECTIONS: PC_SECTIONS } = require('./party');
const { sessionParty } = require('./session-party');
const { readPeople, TITLE: PEOPLE_TITLE } = require('./people');
const { readHandouts, TITLE: HANDOUTS_TITLE } = require('./handouts');
const { foesFor } = require('./foes');
const { systemFor } = require('./systems');
const { readTableLog, VITALS } = require('./table-log');
const { orderedSessions } = require('../story-spine');
const { displayTitleOf, mapFolder, matchExcludedDir } = require('../scanner');
const { loadPublishConfig } = require('../config');
const { unmaskedPlayAsOf } = require('./people-from-notes');
const { parseNote } = require('../frontmatter');
const { readSettings } = require('../settings/read');
const { readSideColours } = require('./side-colours');
const { readerFrom } = require('../vault-reader');
const { isWithheld, nameList, unmaskedNames, unmaskedNameUnread } = require('../processor');
const { canonicalNfc } = require('../unicode');
const { decidePage, publishesPage } = require('../publish-decision');
const { loadManifest } = require('../manifest');
const { tableLogOf, isPlayed } = require('./sessions');
const { readCast } = require('./cast');
const { readSeen } = require('./seen');
const { placeKey } = require('./keys');
const { SIDES_SET } = require('./record');
const { isSide } = require('./web/fight-math');

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

// The vitals an ally carries from one session's Table Log to the next (`readCarried`), and the column word a warning
// names each by. Luck is a PC's alone; Energy Reserve is no Table Log column.
const CARRIED = ['hp', 'mp', 'san', 'fp'];
const COLUMN_WORD = { hp: 'HP', mp: 'MP', san: 'SAN', fp: 'FP' };

// A Plan's sheet: reads the Plan file, then the shared core reads the rest.
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

  const early = [];
  let fm = {};
  let body = text;
  try {
    const parsed = parseNote(text);
    fm = parsed.data || {};
    body = parsed.content;
  } catch (err) {
    early.push({ kind: 'unreadable-frontmatter', note: plan, text: `frontmatter does not parse: ${firstLine(err.message)}` });
  }
  return readSheet(vaultPath, { planRel: plan, fm, body, party, deps, early });
}

// The shared core. With a Plan (`planRel`, its `fm` and `body`) the session is read from the Plan; with none, `session`
// ({ index, title, chapter, number, after }) is the session the record gave: its index path (null when not filed yet),
// and `after`, the latest wrapped-up session, which the carried vitals and the party walk from when there is no index.
// `early` holds warnings the caller already has (the Plan's frontmatter), kept first.
function readSheet(vaultPath, { planRel = null, fm = {}, body = '', session = null, party = [], deps, early = [] } = {}) {
  const plan = planRel;
  const given = session || {};
  const warnings = [...early];
  const portraits = new Map();
  const unmasks = new Map();
  const add = (list) => { for (const w of list || []) warnings.push(w); };

  let system = null;
  let campaign = path.basename(path.resolve(vaultPath));
  const withheldWords = { person: 'someone', place: 'somewhere' };
  let publishConfig = {};
  let sideColours = readSideColours({}).sideColours;
  try {
    // Settings values are nested by group: `vault.system` is values.vault.system.
    const settingsRead = readSettings({ vaultPath, deps });
    const values = settingsRead.values || {};
    // The reader already swaps a word that is not allowed for the default; it says so only in its faults, which the sheet does not show.
    for (const f of settingsRead.faults || []) {
      if (f.name === 'vault.run_sheet.side_colours' && f.kind === 'not-allowed') add([{ kind: 'side-colours', note: null, text: `vault.run_sheet.side_colours is ${JSON.stringify(String(f.value).slice(0, 40))}, not pens, colour_blind or own: pens is used` }]);
    }
    system = (values.vault && values.vault.system) || null;
    const colours = readSideColours(values);
    sideColours = colours.sideColours;
    add(colours.warnings);
    const site = values.player_site || {};
    publishConfig = site;
    if (typeof site.title === 'string' && site.title.trim()) campaign = site.title.trim();
    for (const k of ['person', 'place']) {
      const w = site.withheld_words && site.withheld_words[k];
      if (typeof w === 'string' && w.trim()) withheldWords[k] = w;
    }
  } catch (err) {
    warnings.push({ kind: 'unreadable-settings', note: null, text: `the vault's settings could not be read (${firstLine(err.message)}): the game system is unknown` });
  }

  // the vault's system reads the foes and the PCs and describes the rest (model.rules); none runs as D&D
  const sys = systemFor(system);
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
  const sessionIndex = plan ? resolveFm(fm.session) : (given.index || null);
  const chapter = plan ? resolveFm(fm.chapter) : (given.chapter || null);
  const sessionNumber = Number.isInteger(given.number) ? given.number : null;
  const title = plan
    ? (sessionIndex ? stemOf(sessionIndex) : stemOf(plan).replace(/\s+-\s+plan$/i, ''))
    : (given.title || (sessionNumber !== null ? `Session ${sessionNumber}` : 'Session'));
  const numberOf = (planFm, indexPath, fallback) => {
    for (const v of [fmOf(indexPath).session_number, planFm.session_number]) {
      const n = Number(v);
      if (v !== undefined && v !== null && v !== '' && Number.isInteger(n)) return n;
    }
    const m = /\bsession\s+0*(\d+)\b/i.exec(fallback);
    return m ? Number(m[1]) : null;
  };
  const number = plan ? numberOf(fm, sessionIndex, fmTarget(fm.session) || title) : sessionNumber;

  // The parts.
  const sections = pt.sections(body, 2);
  const joined = (field) => sections.filter((s) => fieldOf(s.title) === field).map((s) => s.text).filter(Boolean).join('\n\n');
  const beatsRead = readBeats(body, index);
  add(beatsRead.warnings);
  const beats = beatsRead.beats;
  const seen = new Set();
  const carried = readCarried();
  // The sides the GM set in earlier sessions' fights, the latest per note (plan 6a): a fight starts from
  // them. Read here, so a Sides set line that does not read warns with the rest.
  const sidesCarried = carried ? carried.sides() : {};
  // The session's own party (the index field, the wrap-up, the Plan's roster), else the one given, and the
  // Plan's NPC Quick Reference: what a row's starting side reads (sides.js). Their warnings are added below.
  let own = sessionParty({ index, sessionPath: sessionIndex || given.after || null, planBody: body, given: party, planPath: plan });
  // A no-Plan session filed tonight: its new index names no party of its own, so the party stays the one the record gave
  // (the latest Wrap-Up's), and the PCs the GM placed before the filing stay on the sheet (Task 8).
  if (!plan && sessionIndex && given.after && own.from === 'given') own = sessionParty({ index, sessionPath: given.after, planBody: body, given: party, planPath: plan });
  add(own.warnings);
  const peopleRead = readPeople(body, index);
  const quickRef = new Map();
  for (const x of peopleRead.people) {
    // Links come out whole: a note named "Allies of Ostia" is a name, not the Plan's word. Cells stay `|`-joined.
    if (x.note) quickRef.set(x.note, [quickRef.get(x.note), x.cells.slice(1).map((c) => c.replace(/\[\[[^\]]*\]\]/g, '')).join(' | ')].filter(Boolean).join(' | '));
  }
  // What each beat's who line says about a note, for the cast entry of a person no beat's fight row covers.
  const who = new Map();
  for (const b of beats) for (const w of b.who || []) if (w.note) who.set(w.note, `${who.get(w.note) || ''} ${w.wants || ''} ${w.knownAs || ''}`.trim());
  const sides = { quickRef, partyNotes: own.party, who };
  for (const beat of beats) {
    const r = foesFor(beat, index, seen, carried, sides, sys, beats);
    beat.foes = r.foes;
    beat.treasure.push(...r.treasure);
    add(r.warnings);
  }
  // An ally's own Plan line may state where they stand ("32 of 38 HP"): the first such figure in Plan
  // order is the figure for every row of that ally, in every beat, and wins over the Table Log and the
  // note. The second number is a reading aid; the note's HP stays the maximum.
  const planHp = new Map();
  for (const beat of beats) {
    for (const w of beat.who) {
      const m = w.note && /(\d+)\s*(?:of|\/)\s*(\d+)\s*HP\b/i.exec(w.wants || '');
      if (m && !planHp.has(w.note)) planHp.set(w.note, Number(m[1]));
    }
  }
  for (const beat of beats) {
    for (const f of beat.foes) {
      if (f.ally && planHp.has(f.note)) { f.hpNow = planHp.get(f.note); f.carriedFrom = plan; }
    }
  }
  const pcsRead = readPcs(body, index, own.party, sys);
  add(pcsRead.warnings);
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

  // The maps the GM may Show the players: every map the player site would publish, bar the GM half of a pair.
  // A manifest that does not read leaves the list empty (nothing is known to publish) and says so.
  let manifest = null;
  let manifestRead = true;
  try {
    manifest = loadManifest(vaultPath, { warn: () => {} });
  } catch (err) {
    manifestRead = false;
    warnings.push({ kind: 'map-list', note: null, text: 'the publish list could not be read: no map can be Shown' });
  }
  const gmHalves = new Set([...allMaps.filter((g) => GM_SUFFIX.test(stemOf(g))), ...[...playerFor].filter(([, v]) => v).map(([g]) => g)]);
  // A folder player_site.folder_map leaves out is not published, as the scanner says (a vault with no map set,
  // no site set up, leaves each map to its own publish rule).
  const folderMap = publishConfig.folder_map && typeof publishConfig.folder_map === 'object' ? publishConfig.folder_map : {};
  const folderMapped = (rel) => !Object.keys(folderMap).length || !rel.includes('/') || mapFolder(rel.slice(0, rel.lastIndexOf('/')), folderMap) !== null;
  // The one publish decision, for a map and for a person's note alike.
  const publishes = (rel) => publishesPage(decidePage({ rel, frontmatter: fmOf(rel) }, { rel, publishConfig, manifest, folderMapped: folderMapped(rel) }));
  const showableMaps = !manifestRead ? [] : allMaps.filter((m) => !gmHalves.has(m) && publishes(m)).sort();
  for (const p of maps) {
    playerVersionWarning(p);
    pair(p, playerFor.get(p));
    // p as the player map: any GM map that points at it, by field or by name
    for (const g of allMaps) if (g !== p && playerFor.get(g) === p) pair(g, p);
  }

  // A link to nowhere anywhere in the Plan warns once (beats warn for theirs; the same text merges).
  for (const w of warnings) if (w.note === null) warnedLinks.add(low(w.text));
  for (const t of pt.links(body)) if (index.resolve(t) === null) warnLink(t);

  // A map is never a place the party stands at (final review O5, carried to the beats by the scoped check): a beat's
  // place or a hub spot whose note is a map, or a GM map half, keeps its words and its key but no note, so it is
  // never linked as a place, in the Table Log's Where everyone ended or Places the party went, where reveal_scan
  // would offer to publish a GM map. Done here, after the maps above are read, so the Plan's own map links still count.
  const notAPlace = (p) => Boolean(p) && (isMap(p) || gmHalves.has(p));
  for (const b of beats) {
    if (notAPlace(b.place)) { if (!b.placeText) b.placeText = stemOf(b.place); b.place = null; }
    for (const sp of b.spots || []) if (notAPlace(sp.note)) sp.note = null;
  }

  const runLong = readRunLong();

  const model = {
    system,
    rules: sys.describe(),
    campaign,
    withheldWords,
    sideColours,
    plan,
    session: { index: sessionIndex, title, chapter, number },
    brief: { overview: joined('overview'), world: joined('world'), stops: joined('stops') },
    handouts: handoutsRead.handouts,
    pcs: pcsRead.pcs,
    partyFrom: own.from,
    unmatchedPcLines: pcsRead.unmatched,
    beats,
    people: peopleRead.people,
    places,
    maps,
    mapPairs,
    threads: joined('threads'),
    runLong,
    prep,
    cast: [],
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

  if (plan) add(completeness(body, model, { resolve: (t) => index.resolve(t) }));
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
  if (plan && !model.notes[plan]) model.notes[plan] = noteOf(plan, fm);
  // Places the party can go (plan 6a Task 7): every location note in the vault, keyed for its place beat
  // (`pl-<hash>`, keys.js), with the npc and creature notes whose `location` links it, and its own entry in
  // `placeNotes` (as `notes` holds one), for its name and picture on both screens. `notes` stays the notes this
  // sheet touches. A `location` that names no place places nobody.
  // A map is never a place to go (final review O5), even typed `location`: its GM half would go behind a panel and
  // into the Table Log, where wrap-up's reveal_scan would offer to publish it. Every `doc_type: map` note, the GM
  // half of every pair among them, stays out of placeKeys, placeNotes and Move them's list.
  const locations = index.notes().filter((p) => low(fmOf(p).type) === 'location' && !isMap(p) && !gmHalves.has(p)).sort();
  const isPlace = new Set(locations);
  model.placeKeys = Object.fromEntries(locations.map((p) => [p, placeKey(p)]));
  model.placePeople = {};
  for (const p of index.notes()) {
    const pfm = fmOf(p);
    if (!['npc', 'creature'].includes(low(pfm.type))) continue;
    const t = fmTarget(pfm.location);
    const at = t ? index.resolve(t) : null;
    if (!at || !isPlace.has(at)) continue;
    (model.placePeople[at] = model.placePeople[at] || []).push(p);
  }
  for (const list of Object.values(model.placePeople)) list.sort();
  model.placeNotes = Object.fromEntries(locations.map((p) => [p, model.notes[p] || noteOf(p)]));
  // The cast is read last: its notes are never "touched", and its warnings stay on each entry.
  model.cast = readCast(index, { carried, sides, system: sys });
  model.sidesCarried = sidesCarried;
  // Added last, so these paths make no `notes` entries or links of their own: a Plan that names no map reads as before.
  model.showableMaps = showableMaps;
  // A foe's starting seen: it publishes, or an earlier played session named it. A publish list that does
  // not read leaves nothing known to publish, so nothing starts seen.
  model.seenFrom = {};
  if (!manifestRead) {
    model.warnings.push({ kind: 'seen-list', note: null, text: 'the publish list could not be read: no foe starts seen, and names from earlier sessions are not read either' });
  } else {
    // The strict answer, for a name the players will read: the player site is on, the note is not under a
    // hidden folder, and the page decision is made with the config-shaped settings (exclude_drafts and the
    // rest), as the build makes it. The maps list above keeps its own, looser, reading.
    let strict = null;
    try { strict = loadPublishConfig(vaultPath, {}, () => {}, { quietStops: true, deps }); } catch { strict = null; }
    if (!strict) {
      model.warnings.push({ kind: 'seen-list', note: null, text: 'the publish settings could not be read: no foe starts seen, and names from earlier sessions are not read either' });
    } else {
      const strictMap = strict.folder_map && typeof strict.folder_map === 'object' ? strict.folder_map : {};
      const strictMapped = (rel) => !Object.keys(strictMap).length || !rel.includes('/') || mapFolder(rel.slice(0, rel.lastIndexOf('/')), strictMap) !== null;
      const publishesToPlayers = (rel) => strict.switches.site === true
        && !matchExcludedDir(rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '', strict.exclude_dirs)
        && publishesPage(decidePage({ rel, frontmatter: fmOf(rel) }, { rel, publishConfig: strict, manifest, folderMapped: strictMapped(rel) }));
      model.seenFrom = readSeen({ vaultPath, index, sessionIndex: sessionIndex || given.after || null, publishes: publishesToPlayers, config: strict, deps });
    }
  }
  // What the players' screen needs of each: its own name (never the stem) and its picture.
  model.mapNotes = Object.fromEntries(showableMaps.map((m) => {
    const mfm = fmOf(m);
    const named = typeof mfm.name === 'string' && Boolean(mfm.name.trim());
    return [m, { path: m, name: named ? mfm.name.trim() : stemOf(m), named, type: low(mfm.type), docType: 'map', withheld: isWithheld(mfm), portrait: portraitOf(m) }];
  }));
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
      // whether `name` is the note's own: the players' screen never shows a file's stem (5b decision 12)
      named: typeof nfm.name === 'string' && Boolean(nfm.name.trim()),
      type: low(nfm.type),
      withheld: isWithheld(nfm),
      unseenAs: typeof nfm.unseen_as === 'string' ? nfm.unseen_as.trim() : '',
      unreadable: Boolean(read.unreadable),
      portrait,
      location: typeof nfm.location === 'string' ? nfm.location : '',
      docType: low(nfm.doc_type),
      aliases: nameList(nfm.aliases),
      // a place's title, by the one rule (place-name.js); null for any other note
      title: low(nfm.type) === 'location' ? placeTitle(p, nfm) : null,
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
      unmasks.set(p, name ? { name, portrait: index.portrait(p, 'unmasked_portrait'), playAs: unmaskedPlayAsOf(p, index), since: carried ? carried.unmaskedSince(p) : null } : null);
    }
    return unmasks.get(p);
  }

  // The allies' carried vitals: `{ of(note) }` gives `{ hp, log }`, from the latest Table Log before this
  // session whose vitals name the ally (an empty HP cell is passed over; an unreadable one stops the
  // walk with `hp` null), or null. MP, SAN and FP (step 6b: CoC's and GURPS's columns) walk the same way,
  // each on its own: `mp`, `san` and `fp` are on it when a log gave one (null when its cell was unreadable),
  // and `hp` and `log` are null when only a pool was found. A log with no such column gives that pool nothing.
  // Luck is a PC's alone and never carried; Energy Reserve is no column, so it is not carried either.
  // The walk goes back through the sessions before this one in the site's story order (story-spine
  // orderedSessions: chapter, then number), never number alone, and counts only played ones: `status`
  // played (or wrap-up, reviewed), or a Play Notes, Export, Table Log or Wrap-Up linked from
  // `documents`. A session's Table Log is its `documents.table_log`, else the one `session-table-log`
  // note whose `session:` names the index; one of another type is not read. Each log is read once, and
  // only as far back as an ally asks. A link that names no note or the wrong type, a Who cell that names
  // no note, and an HP cell that holds no number each warn once, naming the note they are in.
  function readCarried() {
    if (!sessionIndex && !given.after) return null;
    // Page-shaped as the scanner makes them (its displayTitleOf: `title:`, else the stem), so a chapter
    // a session names by title owns it here as on the site. The notes ordered are every note the reader
    // indexes (not only those the site pages), and sessions with equal sort keys (two with no
    // session_number in one chapter) keep the index's path order, where the site keeps its walk order.
    const pages = index.notes().map((p) => ({
      title: stemOf(p), displayTitle: displayTitleOf(fmOf(p), stemOf(p)), frontmatter: fmOf(p), sourcePath: path.join(vaultPath, p), rel: p,
    }));
    const order = orderedSessions(pages);
    // A session in the order: every session before it. One not filed yet (no index, or one the order lacks): every
    // session up to and including `after`, the latest with a Wrap-Up.
    const here = sessionIndex ? order.findIndex((pg) => pg.rel === sessionIndex) : -1;
    const at = here >= 0 ? here : (plan ? -1 : order.findIndex((pg) => pg.rel === given.after) + 1);
    if (at < 1) return null;
    const earlier = order.slice(0, at).map((pg) => pg.rel).reverse();
    const logOf = (s) => {
      const r = tableLogOf(index, s);
      if (r.warning) warnings.push(r.warning);
      return r.log;
    };
    // Per earlier played session, newest first, read when first asked: Map<note path, hit points>.
    const read = [];
    let next = 0;
    const bad = new Set();
    const readNext = () => {
      while (next < earlier.length) {
        const s = earlier[next++];
        if (!isPlayed(index, s)) continue;
        const log = logOf(s);
        if (!log) continue;
        // per carried field: Map<row id, figure>, and the rows whose cell is empty (this log recorded nothing
        // for that copy)
        const figs = {};
        const blank = {};
        for (const f of CARRIED) { figs[f] = new Map(); blank[f] = new Set(); }
        const t = readTableLog(index.read(log).body);
        if (t.unnamed) warnings.push({ kind: 'table-log', note: log, text: `${VITALS}: a table's header row names no column the sheet reads, so it is not read: nobody starts from it` });
        // An empty HP cell is nothing recorded: the walk goes on past it. An unreadable one stops it,
        // for its own ally and copy only.
        const rowKey = (who, copy) => `${low(who)}#${copy > 1 ? copy : 1}`;
        const unreadWho = {};
        for (const f of CARRIED) unreadWho[f] = new Set(t.unread.filter((u) => (u.field || 'hp') === f).map((u) => rowKey(u.who, u.copy)));
        for (const v of t.vitals) {
          const who = index.resolve(v.who);
          if (who === null) {
            if (bad.has(low(v.who))) continue;
            bad.add(low(v.who));
            const why = (index.linkProblem(v.who) || {}).text || `[[${v.who}]] matches no note in the vault`;
            warnings.push({ kind: 'table-log', note: log, text: `${VITALS}: ${why}; nobody starts from that row` });
            continue;
          }
          const id = v.copy > 1 ? `${who}#${v.copy}` : who;
          for (const f of CARRIED) {
            const fig = v[`${f}Now`];
            if ((fig === null || fig === undefined) && !unreadWho[f].has(rowKey(v.who, v.copy))) { blank[f].add(id); continue; }
            if (!figs[f].has(id)) figs[f].set(id, fig === undefined ? null : fig);
          }
        }
        const unread = new Set();
        for (const u of t.unread) {
          const field = u.field || 'hp';
          if (!CARRIED.includes(field)) continue;
          const who = index.resolve(u.who);
          const k = `${who}\u0000${field}\u0000${low(u.cell)}`;
          if (who === null || unread.has(k)) continue;
          unread.add(k);
          warnings.push({ kind: 'table-log', note: log, text: `${VITALS}: the ${COLUMN_WORD[field]} cell "${u.cell}" for [[${u.who}]] holds no number it can read (current/max or current): it starts from its note` });
        }
        // `Unmasked this session`: `- [[Note]] as Name` unmasks, `- [[Note]] masked again` cancels.
        const unmasked = [];
        for (const b of pt.bullets(t.sections.get('Unmasked this session') || '')) {
          const target = pt.links(b.text)[0];
          const note = target ? index.resolve(target) : null;
          if (note !== null) unmasked.push({ note, on: !/\bmasked again\s*[.!]?\s*$/i.test(b.text) });
        }
        // `Sides set`: `- [[Note]]: ally` (foe, ally or neutral), as the writer makes it.
        const sidesSet = [];
        for (const b of pt.bullets(t.sections.get(SIDES_SET) || '')) {
          const target = pt.links(b.text)[0];
          const note = target ? index.resolve(target) : null;
          const m = /\]\]\s*:\s*([A-Za-z]+)\s*[.!]?\s*$/.exec(b.text);
          const side = m ? m[1].toLowerCase() : '';
          if (note === null) {
            const why = target ? ((index.linkProblem(target) || {}).text || `[[${target}]] matches no note in the vault`) : `"${b.text.trim()}" links no note`;
            warnings.push({ kind: 'table-log', note: log, text: `${SIDES_SET}: ${why}; that side is not carried` });
          } else if (!isSide(side)) {
            warnings.push({ kind: 'table-log', note: log, text: `${SIDES_SET}: "${b.text.trim()}" names no side the sheet reads (foe, ally or neutral); that side is not carried` });
          } else sidesSet.push({ note, side });
        }
        read.push({ log, figs, blank, unmasked, sidesSet });
        return true;
      }
      return false;
    };
    const found = new Map();
    let since = null;
    let sides = null;
    return {
      // The side each note was last set to, walking every earlier played log oldest first: a later log's
      // line wins, and within one log the last line does. Reads every earlier log.
      sides() {
        if (sides === null) {
          while (readNext());
          sides = {};
          for (const r of [...read].reverse()) for (const x of r.sidesSet) sides[x.note] = x.side;
        }
        return { ...sides };
      },
      // The log an unmasking began in, walking every earlier played log oldest first: a later
      // `masked again` cancels it, a later unmasking after that begins it afresh. Null when the
      // note is masked. Reads every earlier log, so it is asked only of a note that has an Unmask.
      unmaskedSince(note) {
        if (since === null) {
          while (readNext());
          since = new Map();
          for (const r of [...read].reverse()) {
            for (const u of r.unmasked) {
              if (!u.on) since.delete(u.note);
              else if (!since.has(u.note)) since.set(u.note, r.log);
            }
          }
        }
        return since.get(note) || null;
      },
      // Copy 2 and up read their own row (`Guard 2`), falling back to the note's copy-less row.
      of(note, copy = 1) {
        const id = copy > 1 ? `${note}#${copy}` : note;
        if (!found.has(id)) {
          const hit = {};
          for (const f of CARRIED) {
            for (let i = 0; !hit[f] && (i < read.length || readNext()); i++) {
              const h = read[i].figs[f];
              // a blank row of this copy's own: nothing recorded here, never the copy-less row instead
              if (!h.has(id) && read[i].blank[f].has(id)) continue;
              const k = h.has(id) ? id : note;
              if (h.has(k)) hit[f] = { fig: h.get(k), log: read[i].log };
            }
          }
          let got = null;
          if (Object.keys(hit).length) {
            got = { hp: hit.hp ? hit.hp.fig : null, log: hit.hp ? hit.hp.log : null };
            for (const f of CARRIED) if (f !== 'hp' && hit[f]) got[f] = hit[f].fig;
          }
          found.set(id, got);
        }
        return found.get(id);
      },
    };
  }

  // If you run long: never above the chapter. The chapter folder is the chapter note's folder,
  // else the nearest folder above the Plan holding a Sessions folder; the vault root is never one.
  function readRunLong() {
    const empty = { nextPlan: null, scenes: [], planning: [], contingencies: beats.filter((b) => b.contingency).map((b) => b.key) };
    let dir = chapter ? path.posix.dirname(chapter) : null;
    if (!dir || dir === '.') {
      dir = null;
      for (let d = plan ? path.posix.dirname(plan) : null; d && d !== '.' && !d.startsWith('..'); d = path.posix.dirname(d)) {
        if (index.notes().some((n) => n.startsWith(`${d}/Sessions/`))) { dir = d; break; }
      }
    }
    if (!dir) {
      if (!plan) return empty;
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

module.exports = { readRunSheet, readSheet, completeness };

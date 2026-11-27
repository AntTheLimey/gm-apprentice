'use strict';
// The no-Plan run sheet's record reader: a night with no Plan, built from the last Wrap-Up. `readRecord` gives
// `readSheet`'s model (party, PCs, cast, carried vitals) plus `model.record`: Last time, World, Coming up with its lead
// card, and where the crew is. It shows what the record holds and never forecasts. A template placeholder (a line that
// is only `{...}`, a checklist item `- [ ] {...}`, a label with nothing after it) reads as empty.

const crypto = require('node:crypto');
const pt = require('./plan-text');
const { buildIndex, stemOf } = require('./notes');
const { readSheet } = require('./read');
const { listSessions, tableLogOf } = require('./sessions');
const { canonicalNfc } = require('../unicode');
const RR = require('./web/record-rank');

const LEFT_OUT = 'Points to land and If-they need a Plan.';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const PEOPLE_TYPES = new Set(['npc', 'creature']);
const THREAT_TYPES = new Set(['npc', 'creature', 'faction', 'organization']);

const low = (s) => canonicalNfc(String(s == null ? '' : s)).trim().toLowerCase();
const nl = (s) => String(s == null ? '' : s).replace(/\r\n?/g, '\n');
const uniq = (list) => [...new Set(list)];
const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// A name said whole: not inside a longer word (Unicode letters and digits count as word characters).
const said = (t, name, flags = 'iu') => new RegExp(`(?<![\\p{L}\\p{N}])${esc(name)}(?![\\p{L}\\p{N}])`, flags).exec(t);
// Links and emphasis out, so a line reads as the words a GM would say.
const stripMd = (s) => nl(s).replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2').replace(/[*~`]/g, '');
// A line that is one struck span and nothing else; "~~old~~ still true ~~maybe~~" is a live line.
const STRUCK = /^\s*~~(?:(?!~~)[\s\S])+~~\s*$/;
// The notes a card may be about (the ontology's entity types, subtypes included). Sessions, chapters, scenes, plans,
// wrap-ups and other records never count as a subject.
const ENTITY_TYPES = new Set(['npc', 'npc_group', 'creature', 'beast', 'undead', 'construct', 'spirit', 'deity', 'aberration',
  'faction', 'organization', 'government', 'corporation', 'cult', 'guild', 'military', 'criminal', 'location',
  'item', 'weapon', 'armor', 'vehicle', 'treasure', 'relic', 'tool', 'consumable', 'document', 'spell', 'map', 'letter', 'prophecy',
  'contract', 'journal', 'prop', 'clue', 'event', 'battle', 'ritual', 'disaster', 'discovery', 'betrayal_event', 'celebration']);
const HOP = /^(member_of|located_at|part_of|works_for|owned_by|based_at)$/i;
// Words that say nothing about which item a Keeper Checklist line is.
const STOP = new Set('that this with what whether from their they have been were will into which about there where when after before over under while still only also every each some more most other than then them your'.split(' '));
const wordSet = (t) => new Set((stripMd(t).toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}']*/gu) || []).filter((w) => w.length > 3 && !STOP.has(w)));

// A day and a short month, never the locale's ("29 Nov"); what is not a date reads as written.
function shortDate(v) {
  const t = v instanceof Date ? (Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10)) : String(v == null ? '' : v).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}`;
  return t || null;
}

// Text a template leaves behind: nothing, or only a `{...}` placeholder.
const isPlaceholder = (s) => {
  const t = String(s || '').trim();
  return t === '' || /^\{[\s\S]*\}$/.test(t);
};
const stripComments = (s) => nl(s).replace(/<!--[\s\S]*?-->/g, '');
// Text read as prose: comments gone, placeholder paragraphs gone, blank edges trimmed.
const prose = (s) => stripComments(s).split(/\n\s*\n/).map((p) => p.trim()).filter((p) => !isPlaceholder(p)).join('\n\n');

const sectionText = (body, level, re) => {
  const hit = pt.sections(body, level).find((s) => re.test(s.title));
  return hit ? hit.text : '';
};
const bulletsOf = (text) => pt.bullets(stripComments(text)).map((b) => b.text.trim()).filter((t) => !isPlaceholder(t));

// One World State label's items: the line's own words and any nested bullets, each split on sentence ends and `;`.
function labelItems(text, name) {
  const lines = nl(text).split('\n');
  const want = low(name);
  const at = lines.findIndex((l) => { const m = pt.LABEL.exec(l); return m && low(m[1]) === want; });
  if (at < 0) return [];
  const parts = [pt.LABEL.exec(lines[at])[2].trim()];
  for (let i = at + 1; i < lines.length; i++) {
    if (pt.LABEL.test(lines[i])) break;
    if (/^\s+(?:[-*+]|\d+[.)])\s+/.test(lines[i])) parts.push(lines[i].replace(/^\s+(?:[-*+]|\d+[.)])\s+/, '').trim());
    else if (lines[i].trim() === '') continue;
    else if (/^\s+\S/.test(lines[i])) parts[parts.length - 1] += ` ${lines[i].trim()}`;
    else break;
  }
  return parts.filter((p) => !isPlaceholder(p))
    .flatMap((p) => p.split(/(?<=[.!?])\s+(?=[A-Z])|;\s*/))
    .map((p) => p.trim()).filter((p) => p && !isPlaceholder(p));
}
const labelValue = (text, name) => labelItems(text, name).join(' ');

// The plain location map the page ranks by: { path: { parent, type } }.
function locOf(index, places) {
  const out = {};
  for (const p of places) {
    const fm = index.read(p).fm || {};
    const l = pt.links(String(fm.parent_location || ''))[0];
    out[p] = { parent: l ? index.resolve(l) || null : null, type: String(fm.location_type || '') };
  }
  return out;
}
function readRecord(vaultPath, session, { party = [], deps } = {}) {
  const given = session || {};
  const model = readSheet(vaultPath, {
    session: { index: given.index || null, title: given.title || '', chapter: given.chapter || null, number: given.number === undefined ? null : given.number, after: given.after || null },
    party, deps,
  });
  const index = buildIndex(vaultPath, { deps });
  const fmOf = (p) => (p && index.has(p) ? index.read(p).fm || {} : {});
  const typeOf = (p) => low(fmOf(p).type);
  // a place is a location note in `loc`: maps and GM halves are not places (read.js already treats them so)
  const isPlace = (p) => Boolean(p) && typeOf(p) === 'location' && Boolean(loc[p]);
  const nameOf = (p) => { const n = fmOf(p).name; return typeof n === 'string' && n.trim() ? n.trim() : stemOf(p); };
  const parentOf = (p) => { const l = pt.links(String(fmOf(p).parent_location || ''))[0]; return l ? index.resolve(l) : null; };
  const chain = (p) => { const out = []; for (let c = p; c && !out.includes(c) && out.length < 12; c = parentOf(c)) out.push(c); return out; };
  const depth = (p) => chain(p).length;
  const deepest = (places) => places.slice().sort((a, b) => depth(b) - depth(a))[0] || null;
  const placesIn = (text) => uniq(pt.links(text).map((t) => index.resolve(t)).filter(isPlace));

  // Every location note (maps and GM halves left out, as read.js's `locations` does) with its parent and type, and where
  // each NPC or creature stands by its `location` field: what the page ranks the cards by. No guessing from prose.
  const loc = locOf(index, Object.keys(model.placeKeys || {}).sort());
  const peopleAt = {};
  for (const p of index.notes()) {
    if (!PEOPLE_TYPES.has(typeOf(p))) continue;
    const v = Array.isArray(fmOf(p).location) ? fmOf(p).location[0] : fmOf(p).location;
    const t = v == null ? '' : (pt.links(String(v))[0] || String(v).trim());
    const at = t ? index.resolve(t) : null;
    if (at && loc[at]) peopleAt[p] = at;
  }

  const label = given.number !== null && given.number !== undefined ? `Session ${given.number}` : (given.title || 'Session');
  const sessions = listSessions(vaultPath, { deps, index });
  const afterSession = given.after ? sessions.find((s) => s.index === given.after) : null;
  const wrapUp = afterSession ? afterSession.wrapUp : null;
  const wrapNote = wrapUp && index.has(wrapUp) ? index.read(wrapUp) : null;
  const wrapBody = wrapNote ? nl(wrapNote.body) : '';

  let header;
  if (given.played) header = `${label}: played${shortDate(given.playDate) ? ` ${shortDate(given.playDate)}` : ''}, not wrapped up yet`;
  else if (!wrapUp) header = `${label}, no Plan: there is no record yet`;
  else header = `${label}, no Plan: built from ${afterSession.label}'s Wrap-Up`;

  // Last time
  const recap = sectionText(wrapBody, 2, /^(?:narrative )?recap$/i);
  const lastTime = {
    recap: prose(recap).split('\n\n').slice(0, 2).join('\n\n'),
    playDate: wrapNote ? shortDate((wrapNote.fm || {}).play_date) || (afterSession ? shortDate(afterSession.playDate) : null) : null,
  };

  // World: the World State's labelled bullets
  const gm = sectionText(wrapBody, 2, /^gm notes$/i) || wrapBody;
  const worldText = stripComments(sectionText(gm, 3, /^world state$/i));
  const worldLoc = placesIn(labelValue(worldText, 'Location'))[0] || null;
  const date = labelValue(worldText, 'In-game date');
  const threats = labelItems(worldText, 'Active threats');
  const clocks = labelItems(worldText, 'Ticking clocks');
  const world = {
    date, location: worldLoc, threats, clocks,
    md: [
      date ? `- **In-game date:** ${date}` : '',
      worldLoc ? `- **Location:** [[${stemOf(worldLoc)}]]` : '',
      threats.length ? `- **Active threats:** ${threats.join(' ')}` : '',
      clocks.length ? `- **Ticking clocks:** ${clocks.join(' ')}` : '',
    ].filter(Boolean).join('\n'),
  };

  // Where the crew is
  const pcNotes = model.pcs.map((p) => p.note);
  const byPc = {};
  for (const pc of pcNotes) {
    const val = index.has(pc) ? pt.label(nl(index.read(pc).body), 'Location') : '';
    byPc[pc] = isPlaceholder(val) ? null : (placesIn(val)[0] || null);
  }
  const whereNow = { place: null, text: '', from: null, byPc };
  // The latest wrapped-up session's Table Log (`after`), never tonight's: tonight's own positions live in the state, which
  // survives a restart and a played-not-wrapped reopen (Task 8 fix round 2). This is where the crew starts tonight.
  const logNote = tableLogOf(index, given.after || null).log;
  const logPlaces = logNote ? placesIn(sectionText(nl(index.read(logNote).body), 2, /^where everyone ended$/i)) : [];
  const pcPlaces = Object.values(byPc).filter(Boolean);
  if (logPlaces.length) Object.assign(whereNow, { place: deepest(logPlaces), from: 'table-log' });
  else if (worldLoc) Object.assign(whereNow, { place: worldLoc, from: 'world-state' });
  else if (pcPlaces.length) Object.assign(whereNow, { place: deepest(pcPlaces), from: 'pc-notes' });
  if (whereNow.place) whereNow.text = nameOf(whereNow.place);

  // Coming up
  const carries = sectionText(gm, 3, /^what carries forward$/i);
  const handoff = prose(sectionText(gm, 3, /^handoff to session-prep$/i));
  const intentions = bulletsOf(sectionText(carries, 4, /^player-stated intentions$/i));
  const comingUp = { handoff, intentions, lead: null, empty: null };
  if (!wrapUp) comingUp.empty = 'No record yet: nothing is coming up.';
  else if (!handoff) comingUp.empty = 'The last Wrap-Up has no Handoff yet.';
  if (wrapUp && clocks.length) comingUp.lead = leadFrom({ clocks, handoff, threats, whereNow });

  function leadFrom({ clocks: cs, handoff: h, threats: ts, whereNow: where }) {
    const allPlaces = index.notes().filter(isPlace);
    // Words that name a kind of place, never one place: they match nothing.
    const GENERIC = new Set(['street', 'house', 'station', 'market', 'night', 'district', 'quarter', 'square', 'tower', 'hall',
      'road', 'bridge', 'gate', 'city', 'town', 'village', 'building', 'north', 'south', 'east', 'west', 'upper', 'lower', 'great']);
    const wordsOf = (s) => uniq((String(s).match(/\p{L}{5,}/gu) || []).map((w) => w.toLowerCase())).filter((w) => !GENERIC.has(w)).sort((a, b) => b.length - a.length);
    const nameWords = (p) => new Set(wordsOf(`${nameOf(p)} ${stemOf(p)}`));
    const area = where.place ? RR.areaOf(where.place, loc) : null;
    // A clock word names a place only when it matches exactly one location, or exactly one inside the crew's area.
    // Else there is no place from that word: the next word is tried, and if none gives one, no place (never a guess).
    let found = null;
    for (const clock of cs) {
      for (const w of wordsOf(clock)) {
        const named = allPlaces.filter((p) => nameWords(p).has(w));
        const near = area ? named.filter((p) => chain(p).includes(area)) : [];
        const one = named.length === 1 ? named : (near.length === 1 ? near : []);
        if (one.length) { found = { clock, word: w, place: one[0] }; break; }
      }
      if (found) break;
    }
    const clock = found ? found.clock : cs[0];
    const place = found ? found.place : null;
    const people = uniq(pt.links(h).map((t) => index.resolve(t)).filter((p) => p && PEOPLE_TYPES.has(typeOf(p))));
    // Threats tied to the clock: a threat reaches a note by a link, or by the note's full name or an alias; the note
    // counts when it links the lead place or holds the key word that gave the place.
    let hits = [];
    if (found) {
      const re = new RegExp(`(?<![\\p{L}\\p{N}])${found.word}(?![\\p{L}\\p{N}])`, 'iu');
      const named = new Set();
      for (const t of ts) {
        for (const p of pt.links(t).map((x) => index.resolve(x))) if (p && THREAT_TYPES.has(typeOf(p))) named.add(p);
        for (const p of index.notes().filter((n) => THREAT_TYPES.has(typeOf(n)))) {
          const fm = fmOf(p);
          const names = [nameOf(p), ...[fm.aliases, fm.gm_aliases].flat().filter((x) => typeof x === 'string' && x.trim())];
          if (names.some((n) => said(t, n.trim()))) named.add(p);
        }
      }
      hits = [...named].filter((p) => {
        const n = index.read(p);
        const raw = `${JSON.stringify(n.fm || {})}\n${nl(n.body)}`;
        return re.test(raw) || pt.links(raw).some((t) => index.resolve(t) === place);
      }).sort();
    }
    return { title: clock, clock, word: found ? found.word : null, place, people, hits, schedule: [], md: h };
  }

  // Possible scenes: the open items of the last Wrap-Up (rounds 8 and 9). Cards come only from Unresolved Threads, NPCs
  // Needing Follow-Up and Player-Stated Intentions; PC Carry-Forward never makes one.
  const sectionBullets = (re) => bulletsOf(sectionText(carries, 4, re));
  const doneLines = nl(sectionText(gm, 3, /^keeper checklist$/i)).split('\n').filter((l) => /^\s*[-*+]\s*\[x\]/i.test(l)).map(wordSet);
  // A ticked line drops at most one open item: the one sharing the most words with it (three or more). On a tie it drops
  // nothing: keeping a finished item costs a glance, dropping a live one loses it.
  const openTexts = ['unresolved threads', 'npcs needing follow-up', 'player-stated intentions', 'pending consequences', 'resolved threads']
    .flatMap((n) => sectionBullets(new RegExp(`^${n}$`, 'i'))).filter((s) => !STRUCK.test(s));
  const ticked = new Set();
  for (const line of doneLines) {
    const scored = openTexts.map((s) => [s, [...wordSet(s)].filter((x) => line.has(x)).length]);
    const top = Math.max(0, ...scored.map((x) => x[1]));
    const best = scored.filter((x) => x[1] === top);
    if (top >= 3 && best.length === 1) ticked.add(best[0][0]);
  }
  const isDone = (s) => STRUCK.test(s) || ticked.has(s);
  const lead = comingUp.lead;
  // An intention naming the lead card's key word is the lead's schedule, not a card.
  const onLead = (s) => Boolean(lead && lead.word) && said(s, lead.word) !== null;
  const items = [];
  for (const [source, re] of [['Unresolved Threads', /^unresolved threads$/i], ['NPCs Needing Follow-Up', /^npcs needing follow-up$/i], ['Player-Stated Intentions', /^player-stated intentions$/i]]) {
    for (const md of wrapUp ? sectionBullets(re) : []) {
      if (isDone(md)) continue;
      if (source === 'Player-Stated Intentions' && onLead(md)) { lead.schedule.push(md); continue; }
      items.push({ md, source });
    }
  }

  // People: NPC and creature notes. A full name, an alias or a link always names one; a first name or surname only when no
  // other NPC note shares that word.
  const npcs = index.notes().filter((n) => PEOPLE_TYPES.has(typeOf(n)));
  const partsOf = (n) => nameOf(n).split(/\s+/).filter(Boolean);
  const wordOwners = new Map();
  for (const n of npcs) for (const w of new Set([...partsOf(n), ...stemOf(n).split(/\s+/)].map(low))) wordOwners.set(w, (wordOwners.get(w) || 0) + 1);
  const namesFor = (n) => {
    const fm = fmOf(n);
    const whole = [nameOf(n), ...[fm.aliases, fm.gm_aliases].flat().filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim())];
    const ps = partsOf(n);
    const single = ps.length > 1 ? [ps[0], ps[ps.length - 1]].filter((w) => w.length >= 3 && wordOwners.get(low(w)) === 1) : [];
    return { whole, single };
  };
  const peopleOf = (md) => {
    const at = new Map();
    const note = (n, pos) => { if (!at.has(n) || pos < at.get(n)) at.set(n, pos); };
    for (const m of md.matchAll(/\[\[([^\]|#]+)/g)) { const n = index.resolve(m[1].trim()); if (n && PEOPLE_TYPES.has(typeOf(n))) note(n, m.index); }
    for (const n of npcs) {
      const { whole, single } = namesFor(n);
      for (const w of whole) { const h = said(md, w.trim()); if (h) note(n, h.index); }
      for (const w of single) { const h = said(md, w, 'u'); if (h) note(n, h.index); }
    }
    return [...at.entries()].sort((a, b) => a[1] - b[1]).map((e) => e[0]);
  };
  for (const it of items) {
    it.links = uniq(pt.links(it.md).map((x) => index.resolve(x)).filter(Boolean));
    it.people = peopleOf(it.md);
    // a place said as "from [[X]]" is where something came from, not where it is
    it.places = uniq([...it.md.matchAll(/(\bfrom\s+)?\[\[([^\]|#]+)/gi)].filter((m) => !m[1]).map((m) => index.resolve(m[2].trim())).filter(isPlace));
  }

  // Joins: cards sharing a subject note join, one hop, no chains. A card's subject notes are the notes its items link plus
  // one hop through each linked note's own relationships. Left out: the lead card's place, the PCs, and the party's area
  // and everything above it (they would join nearly every card).
  const broad = new Set(whereNow.place ? chain(RR.areaOf(whereNow.place, loc)) : []);
  const pcSet = new Set(pcNotes);
  const keep = (n) => Boolean(n) && ENTITY_TYPES.has(typeOf(n)) && n !== (lead && lead.place) && !pcSet.has(n) && !broad.has(n);
  const subjectsOf = (list) => {
    const out = new Map();
    for (const it of list) for (const n of it.links) {
      if (!keep(n)) continue;
      out.set(n, true);
      for (const r of Array.isArray(fmOf(n).relationships) ? fmOf(n).relationships : []) {
        if (!r || !HOP.test(String(r.type || '').trim())) continue;
        const t = index.resolve(pt.links(String(r.target || ''))[0] || String(r.target || '').trim());
        if (keep(t)) out.set(t, true);
      }
    }
    return out;
  };
  const groups = new Map();
  items.forEach((it, i) => { const k = it.people[0] || `item:${i}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(it); });
  let pool = [...groups.entries()].map(([k, g]) => ({ person: k.startsWith('item:') ? null : k, items: g, subj: subjectsOf(g), joinedOn: null }));
  for (;;) {
    const by = new Map();
    pool.forEach((c, i) => { for (const n of c.subj.keys()) { if (!by.has(n)) by.set(n, []); by.get(n).push(i); } });
    const cands = [...by.entries()].filter(([, ix]) => ix.length >= 2);
    if (!cands.length) break;
    // the note shared by the most cards first (ties: the pair sharing the most notes, then the note's path)
    const score = ([, ix]) => ix.length * 1000 + Math.max(...ix.flatMap((i) => ix.filter((j) => j !== i).map((j) => [...pool[i].subj.keys()].filter((n) => pool[j].subj.has(n)).length)));
    cands.sort((x, y) => score(y) - score(x) || (x[0] < y[0] ? -1 : 1));
    const [note, ix] = cands[0];
    const parts = ix.map((i) => pool[i]);
    const subj = new Map(parts.flatMap((c) => [...c.subj]));
    // a joined card does not join again: its subject notes are kept for the card, not for another join
    pool = [...pool.filter((_, i) => !ix.includes(i)), { person: null, items: parts.flatMap((c) => c.items), subj: new Map(), frozen: subj, joinedOn: note }];
  }
  const firstFive = (md) => stripMd(md).split(/\s+/).filter(Boolean).slice(0, 5).join(' ');
  const cards = pool.map((grp) => {
    const subj = grp.frozen || grp.subj;
    let title;
    if (grp.person) title = nameOf(grp.person);
    else if (grp.joinedOn) {
      const count = new Map();
      for (const it of grp.items) for (const n of uniq([...it.links, ...subjectsOf([it]).keys()])) if (keep(n)) count.set(n, (count.get(n) || 0) + 1);
      // most items linking or reaching it (by link or one hop); a tie goes to the note first seen in the record, in item order
      // (the sort is stable and the map is filled in that order)
      const best = [...count.entries()].sort((x, y) => y[1] - x[1])[0];
      title = nameOf(best ? best[0] : grp.joinedOn);
    } else title = firstFive(grp.items[0].md);
    const texts = grp.items.map((it) => it.md).sort();
    return {
      id: crypto.createHash('sha256').update(JSON.stringify(texts)).digest('hex').slice(0, 12),
      title,
      items: grp.items.map((it) => ({ md: it.md, source: it.source })),
      notes: [...subj.keys()],
      people: uniq([...grp.items.flatMap((it) => it.people), ...[...subj.keys()].filter((n) => PEOPLE_TYPES.has(typeOf(n)))]),
      places: uniq([...grp.items.flatMap((it) => it.places), ...[...subj.keys()].filter(isPlace)]),
    };
  });

  // Background: Pending Consequences, and Resolved Threads entries that say "carried", one line each. A carried entry takes
  // the forward-looking sentence it holds, if it holds one.
  const oneLine = (s) => nl(s).replace(/\s*\n\s*/g, ' ').trim();
  const background = [];
  if (wrapUp) {
    for (const md of sectionBullets(/^pending consequences$/i)) if (!isDone(md)) background.push({ from: 'Pending Consequences', md: oneLine(md) });
    for (const md of sectionBullets(/^resolved threads$/i)) {
      if (!/\bcarried\b/i.test(md) || isDone(md)) continue;
      const sentences = oneLine(md).split(/(?<=[.!?])\s+/);
      const ahead = sentences.slice(1).find((x) => /\b(may|might|could|will)\b/i.test(x) && !/closed/i.test(x));
      background.push({ from: 'Resolved Threads', md: sentences[0].replace(/\.$/, '') + (ahead ? ` (${ahead.replace(/\.$/, '')})` : '') });
    }
  }

  model.record = {
    from: wrapUp || null,
    fromSession: wrapUp ? given.after : null,
    header,
    noPlanLine: given.planVault ? `No Plan for ${label}: this is built from the record. session-prep makes one.` : null,
    lastTime,
    world,
    comingUp,
    cards,
    loc,
    peopleAt,
    background,
    whereNow,
    leftOut: LEFT_OUT,
  };
  return model;
}

module.exports = { readRecord };

'use strict';
// The no-Plan run sheet's record reader: a night with no Plan, built from the last Wrap-Up. `readRecord` gives
// `readSheet`'s model (party, PCs, cast, carried vitals) plus `model.record`: Last time, World, Coming up with its lead
// card, and where the crew is. It shows what the record holds and never forecasts. A template placeholder (a line that
// is only `{...}`, a checklist item `- [ ] {...}`, a label with nothing after it) reads as empty.

const crypto = require('node:crypto');
const pt = require('./plan-text');
const { buildIndex, stemOf, stemName } = require('./notes');
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
// Every place a name is said whole in `t`, as [start, end) spans.
const spansOf = (t, name, flags = 'iu') => [...t.matchAll(new RegExp(`(?<![\\p{L}\\p{N}])${esc(name)}(?![\\p{L}\\p{N}])`, `${flags}g`))]
  .map((m) => [m.index, m.index + m[0].length]);
// Links and emphasis out, so a line reads as the words a GM would say.
const stripMd = (s) => nl(s).replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2').replace(/[*~`]/g, '');
// A line that is one struck span and nothing else; "~~old~~ still true ~~maybe~~" is a live line.
const STRUCK = /^\s*~~(?:(?!~~)[\s\S])+~~\s*$/;
// The notes a card may be about: the ontology's entity types, subtypes included, read from its one list (Task 12; Task
// 5's hand list left heritage and world_domain out). Not people the players are (pc and above), not plans, briefs or
// world flags; and npc_group, the run sheet's own group type (beats.js, foes.js). Sessions, chapters, scenes, wrap-ups
// and other records are no entity type, so never a subject.
const ONTOLOGY_TYPES = require('../ontology.json').entity_types;
const NOT_SUBJECTS = new Set(['person', 'player', 'game_master', 'character', 'pc', 'plan', 'adventure-brief', 'campaign_overview', 'world_flags']);
const ENTITY_TYPES = (() => {
  const out = new Set(['npc_group']);
  const abstract = new Set(ONTOLOGY_TYPES.abstract);
  for (const [parent, kids] of Object.entries(ONTOLOGY_TYPES.hierarchy)) {
    for (const t of [parent, ...kids]) if (!abstract.has(t) && !NOT_SUBJECTS.has(t)) out.add(t);
  }
  return out;
})();
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

// Text a template leaves behind: nothing, or only a `{...}` placeholder: one with a block anchor after it
// ("{…} ^recap"), or under a bold label ("**Thread name:** {…}", "**MAJOR —** {…}") (Task 12, Task 4's edges). A bold
// label with nothing after it is empty only when it reads as a label ("**Thread name:**"): a bullet all in bold ("**Find
// the missing courier**") is a live item (CodeRabbit #895).
const isPlaceholder = (s) => {
  let t = String(s || '').trim().replace(/\s\^[\w-]+$/, '');
  const bold = /^\*\*([^*]+)\*\*\s*/.exec(t);
  if (bold && (t.length > bold[0].length || /[:—–-]\s*$/.test(bold[1]))) t = t.slice(bold[0].length);
  return t === '' || /^\{[\s\S]*\}$/.test(t);
};
// An item that only says there is nothing (Task 11b, F4 and F6; fix round 1): the nothing-phrase is the whole item,
// give or take a full stop ("None.", "Nothing.", "n/a", "—", "None left open by the story.", "No open threads."), or the
// whole bold heading of one ("**None left open by the story.** The dragon is dead…": the rest glosses why). Any further
// clause keeps the item: "Nothing new, but the bell rings at dusk." says something, as do "Nothing stops the deputy…"
// and "No one knows…".
const NOTHING_WORD = /^(?:none|nothing|nil|n\/a|—|–|-+)$/;
const NOTHING_OPEN = /^(?:none|nothing)\s+(?:(?:is|are)\s+)?(?:left\s+)?(?:open|outstanding|pending|active|running|ticking|carried|new|yet|pressing|on the record)(?:\s+(?:by|in|on|at|for|from|this|so|yet|right)(?:\s+[\p{L}\p{N}'-]+){0,4})?$/u;
// "No <kind>" takes at most one of yet, left, open, remain(s), pending, new, known after it: "No threats near the Guild"
// names a place, and stays (fix round 2).
const NO_KIND = /^no\s+(?:(?:open|new|active|further|other|outstanding|unresolved|pending|live|current|more)\s+)*(?:threads?|clocks?|threats?|intentions?|consequences?|follow-?ups?|npcs?|items?|changes?|deadlines?|timers?|plans?)(?:\s+(?:yet|left|open|remains?|pending|new|known))?$/u;
// a further clause: a comma, colon, semicolon, dash or bracket, a second sentence, or "but", "except" and their kin
const MORE = /[,;:—–()]|\s-\s|[.!?]\s|\b(?:but|except|save|unless|besides|apart|other than|until)\b/;
const nothingPhrase = (s) => {
  const t = stripMd(s).replace(/\s+/g, ' ').trim().toLowerCase().replace(/[.!?]+$/, '').trim();
  if (NOTHING_WORD.test(t)) return true;
  return !MORE.test(t) && (NOTHING_OPEN.test(t) || NO_KIND.test(t));
};
// Words by which the text after an all-clear heading turns against it ("**Nothing new.** Except Odalys still wants…").
const AGAINST = /\b(?:still|except|but|yet|save|unless|besides|apart from|other than|though|however)\b/i;
// An item whose bold heading says there is nothing stays, heading and all, when the rest turns against the heading
// (Task 12, F2), named or not: "**No threats.** The Guild still watches", "**Nothing new.** But the bell rings". A rest
// with no such word glosses why nothing is open and drops, people and all ("**None left open by the story.** The
// dragon is dead, … the order has chosen [[Sister X]]."); so does a plain fact with none (accepted: "**Nothing
// pending.** The market reopens" drops). Keeping a finished item costs a glance; dropping a live one loses it.
const isNothing = (s) => {
  const t = String(s || '').trim();
  if (nothingPhrase(t)) return true;
  const head = /^\*\*([^*]+)\*\*/.exec(t);
  if (!head || !nothingPhrase(head[1])) return false;
  return !AGAINST.test(stripMd(t.slice(head[0].length)));
};
const stripComments = (s) => nl(s).replace(/<!--[\s\S]*?-->/g, '');
// Text read as prose: comments gone, placeholder paragraphs gone, blank edges trimmed.
const prose = (s) => stripComments(s).split(/\n\s*\n/).map((p) => p.trim()).filter((p) => !isPlaceholder(p)).join('\n\n');

const sectionText = (body, level, re) => {
  const hit = pt.sections(body, level).find((s) => re.test(s.title));
  return hit ? hit.text : '';
};
const bulletsOf = (text) => pt.bullets(stripComments(text)).map((b) => b.text.trim()).filter((t) => !isPlaceholder(t) && !isNothing(t));

// A sentence end: a stop and a space, but never the dot after a lone capital ("Q.R.L. Council", "J. Smith"), which is
// an initialism's or an initial's, not a sentence's end (Task 11b, F1).
const ITEM_BREAK = /(?<=[.!?])(?<!(?:^|[^\p{L}])\p{Lu}\.)\s+(?=\p{Lu})|;\s*/u;
// A Resolved Threads entry still open: it says it is carried forward, carried on to somewhere ("carried on to the next
// session"), carried on a list (or "carried on" with nothing after), or still live. "Carried on his back" is the physical sense, and carries nothing forward.
const CARRIED = /\bcarried\s+forward\b|\bcarried\s+on\s+to\b|\bcarried\s+on\s+(?:(?:the|a|an)\s+)?(?:[\p{L}-]+\s+)?(?:list|record|board|sheet)\b|\bcarried\s+on\s*(?:[.;:)(—–]|$)|\bstill\s+live\b/iu;
// The closure of an entry "<the thread> — closed: <how>": "closed:" at the start, after a dash that starts the entry
// or has a space before it ("re-closed:" is not one), or after a bracket. A "closed:"
// mid-sentence ("the road is closed: they go round") is the thread's own words, not its closure.
const CLOSURE = /(?:^|(?:^|\s)[—–-]\s*|\()closed:\s*([\s\S]*)$/i;
// One World State label's items, word for word (Task 11b, F5 and F9): the line's own words and each nested bullet, a
// wrapped line joined to the one above. What the page shows.
function labelRaw(text, name) {
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
  return parts.map((p) => p.trim()).filter((p) => !isPlaceholder(p) && !isNothing(p));
}
// The same items split on sentence ends and `;`, for the lead card's search only: never shown re-joined.
// A `;` or a sentence end inside quotes ("…", “…”) splits nothing: the quote is one item's words (Task 12).
const QUOTED = /"[^"\n]*"|“[^”\n]*”/g;
const splitItem = (p) => {
  const quotes = [];
  const held = p.replace(QUOTED, (q) => { quotes.push(q); return `\u0000${quotes.length - 1}\u0000`; });
  return held.split(ITEM_BREAK).map((x) => x.replace(/\u0000(\d+)\u0000/g, (m, i) => quotes[Number(i)]));
};
const labelItems = (text, name) => labelRaw(text, name).flatMap(splitItem)
  .map((p) => p.trim()).filter((p) => p && !isPlaceholder(p) && !isNothing(p));
// A World line as the record wrote it: one item on the label's line, several as nested bullets.
const worldLine = (label, items) => {
  if (!items.length) return '';
  if (items.length === 1) return `- **${label}:** ${items[0]}`;
  return [`- **${label}:**`, ...items.map((x) => `  - ${x}`)].join('\n');
};

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
// `index`: the vault's index, when the caller has just built one (the server's), so the vault is read once (Task 11b, F3).
function readRecord(vaultPath, session, { party = [], deps, index: built = null } = {}) {
  const given = session || {};
  const index = built || buildIndex(vaultPath, { deps });
  const model = readSheet(vaultPath, {
    session: { index: given.index || null, title: given.title || '', chapter: given.chapter || null, number: given.number === undefined ? null : given.number, after: given.after || null },
    party, deps, index,
  });
  const fmOf = (p) => (p && index.has(p) ? index.read(p).fm || {} : {});
  const typeOf = (p) => low(fmOf(p).type);
  // a place is a location note in `loc`: maps and GM halves are not places (read.js already treats them so)
  const isPlace = (p) => Boolean(p) && typeOf(p) === 'location' && Boolean(loc[p]);
  // A note's display name (Task 11b, F11): its `name`, else its `title`, else its stem with `_` as spaces; never a raw stem.
  const nameOf = (p) => {
    const fm = fmOf(p);
    for (const v of [fm.name, fm.title]) if (typeof v === 'string' && v.trim()) return v.trim();
    return stemName(p);
  };
  const parentOf = (p) => { const l = pt.links(String(fmOf(p).parent_location || ''))[0]; return l ? index.resolve(l) : null; };
  const chain = (p) => { const out = []; for (let c = p; c && !out.includes(c) && out.length < 12; c = parentOf(c)) out.push(c); return out; };
  const depth = (p) => chain(p).length;
  const deepest = (places) => places.slice().sort((a, b) => depth(b) - depth(a))[0] || null;
  const placesIn = (text) => uniq(pt.links(text).map((t) => index.resolve(t)).filter(isPlace));
  // The notes `text` names, each at its first place (Task 11b, F2 and F10): a link to one of `wanted` (by its type), or a
  // name of `cands` ({ note, whole: names said whole, any case; single: words said whole, case kept }). The longest
  // match wins: a name inside a longer match, a link or another note's longer name, is dropped, so "Corvin" is not named
  // inside "Corvin Tash", nor the alias "Harl" inside "[[Harl Brannock]]".
  // Every link hides the names inside it, even a link to a note that is not `wanted` (a place, a faction): the words of
  // "[[Corvin's Landing]]" name the place, never Corvin. That is the trade: a person said only inside such a link is not
  // found, which a GM who links the place has already said is the place.
  const namedIn = (text, cands, wanted) => {
    const hits = [];
    for (const m of text.matchAll(/\[\[([^\]|#]+)[^\]]*\]\]/g)) {
      const n = index.resolve(m[1].trim());
      hits.push({ n: n && wanted(n) ? n : null, s: m.index, e: m.index + m[0].length });
    }
    for (const c of cands) {
      for (const w of c.whole) for (const [st, en] of spansOf(text, w)) hits.push({ n: c.note, s: st, e: en });
      for (const w of c.single || []) for (const [st, en] of spansOf(text, w, 'u')) hits.push({ n: c.note, s: st, e: en });
    }
    const inside = (h) => hits.some((o) => o.n !== h.n && o.s <= h.s && o.e >= h.e && o.e - o.s > h.e - h.s);
    const at = new Map();
    for (const h of hits) if (h.n && !inside(h) && (!at.has(h.n) || h.s < at.get(h.n))) at.set(h.n, h.s);
    return [...at.entries()].sort((a, b) => a[1] - b[1]).map((e) => e[0]);
  };
  const namesOf = (p) => [nameOf(p), ...[fmOf(p).aliases, fmOf(p).gm_aliases].flat().filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim())];

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

  // People: NPC and creature notes. A full name, an alias or a link always names one; a first name or surname only when no
  // other NPC note shares that word. Inside a longer match it names nobody (namedIn: the longest match wins).
  const npcs = index.notes().filter((n) => PEOPLE_TYPES.has(typeOf(n)));
  const partsOf = (n) => nameOf(n).split(/\s+/).filter(Boolean);
  const wordOwners = new Map();
  for (const n of npcs) for (const w of new Set([...partsOf(n), ...stemOf(n).split(/\s+/)].map(low))) wordOwners.set(w, (wordOwners.get(w) || 0) + 1);
  const namesFor = (n) => {
    const ps = partsOf(n);
    const single = ps.length > 1 ? [ps[0], ps[ps.length - 1]].filter((w) => w.length >= 3 && wordOwners.get(low(w)) === 1) : [];
    return { note: n, whole: namesOf(n), single };
  };
  const npcNames = npcs.map(namesFor);
  const peopleOf = (md) => namedIn(md, npcNames, (n) => PEOPLE_TYPES.has(typeOf(n)));
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
  const locItems = labelRaw(worldText, 'Location');
  const worldLoc = placesIn(locItems.join('\n'))[0] || null;
  // the In-game date's items, one per line (fix round 1): never joined into one sentence
  const dateItems = labelRaw(worldText, 'In-game date');
  const date = dateItems.join('\n');
  const threats = labelRaw(worldText, 'Active threats');
  const clocks = labelRaw(worldText, 'Ticking clocks');
  // the lead card searches these: each item split on sentence ends and `;`
  const threatItems = labelItems(worldText, 'Active threats');
  const clockItems = labelItems(worldText, 'Ticking clocks');
  const world = {
    date, location: worldLoc, threats, clocks,
    md: [
      worldLine('In-game date', dateItems),
      worldLine('Location', locItems),
      worldLine('Active threats', threats),
      worldLine('Ticking clocks', clocks),
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
  // Task 11b, F8: then the first place the Handoff links (a place it says they came "from" is where they were, not where
  // they are), and the PC notes last, only when the record says nothing of where they are: a World State Location in
  // words ("the party has walked down") is newer than any PC note, so it never falls back to a stale one. Nor does a PC
  // note naming a place the Handoff says they came from: they left it (CodeRabbit #895).
  const handoffText = prose(sectionText(gm, 3, /^handoff to session-prep$/i));
  const handoffLinks = [...handoffText.matchAll(/(\bfrom\s+)?\[\[([^\]|#]+)/gi)].map((m) => ({ from: Boolean(m[1]), note: index.resolve(m[2].trim()) }));
  const handoffPlace = (handoffLinks.find((l) => !l.from && isPlace(l.note)) || {}).note || null;
  const left = new Set(handoffLinks.filter((l) => l.from).map((l) => l.note));
  const pcPlaces = Object.values(byPc).filter((p) => p && !left.has(p));
  if (logPlaces.length) Object.assign(whereNow, { place: deepest(logPlaces), from: 'table-log' });
  else if (worldLoc) Object.assign(whereNow, { place: worldLoc, from: 'world-state' });
  else if (handoffPlace) Object.assign(whereNow, { place: handoffPlace, from: 'handoff' });
  else if (pcPlaces.length && !locItems.length) Object.assign(whereNow, { place: deepest(pcPlaces), from: 'pc-notes' });
  if (whereNow.place) whereNow.text = nameOf(whereNow.place);

  // Coming up
  const carries = sectionText(gm, 3, /^what carries forward$/i);
  const handoff = handoffText;
  const intentions = bulletsOf(sectionText(carries, 4, /^player-stated intentions$/i));
  const comingUp = { handoff, intentions, lead: null, empty: null };
  if (!wrapUp) comingUp.empty = 'No record yet: nothing is coming up.';
  else if (!handoff) comingUp.empty = 'The last Wrap-Up has no Handoff yet.';
  if (wrapUp && clockItems.length) comingUp.lead = leadFrom({ clocks: clockItems, handoff, threats: threatItems, whereNow });

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
      const threatNotes = index.notes().filter((n) => THREAT_TYPES.has(typeOf(n))).map((n) => ({ note: n, whole: namesOf(n) }));
      for (const t of ts) for (const p of namedIn(t, threatNotes, (n) => THREAT_TYPES.has(typeOf(n)))) named.add(p);
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
  // a link in the first words reads as its words: its alias, else the note's display name (never a raw stem, F11)
  const linkWords = (md) => nl(md).replace(/\[\[([^\]|#]*)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (m, t, a) => {
    if (a) return a;
    const n = index.resolve(t.trim());
    return n ? nameOf(n) : t;
  });
  const firstFive = (md) => stripMd(linkWords(md)).split(/\s+/).filter(Boolean).slice(0, 5).join(' ');
  // A card's id is its items' words; two cards with the same words (one line in two sections) take their sections too, and
  // a repeat within one section its place among them, so every id is its own and the same on every read (CodeRabbit #895).
  const used = new Set();
  const idOf = (grp) => {
    const hash = (v) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 12);
    let id = hash(grp.items.map((it) => it.md).sort());
    const withSource = grp.items.map((it) => [it.source, it.md]).sort();
    if (used.has(id)) id = hash(withSource);
    for (let n = 2; used.has(id); n++) id = hash([withSource, n]);
    used.add(id);
    return id;
  };
  const cards = pool.map((grp) => {
    const subj = grp.frozen || grp.subj;
    let title;
    if (grp.person) title = nameOf(grp.person);
    else if (grp.joinedOn) {
      // A title comes only from notes the items link or name (Task 11b, F11): a note one hop away joins cards, never
      // titles them. Most items linking or naming it wins; a tie goes to the note the cards joined on, else the note first
      // seen in the record, in item order (the sort is stable and the map is filled in that order). With none, the note
      // the cards joined on.
      const count = new Map();
      for (const it of grp.items) for (const n of uniq([...it.links, ...it.people])) if (keep(n)) count.set(n, (count.get(n) || 0) + 1);
      const sorted = [...count.entries()].sort((x, y) => y[1] - x[1]);
      // on a tie, the note the cards joined on (Task 12): a card joined on a place is not titled by a person it ties
      const top = sorted.length ? sorted.filter((x) => x[1] === sorted[0][1]) : [];
      const best = top.find((x) => x[0] === grp.joinedOn) || top[0];
      title = nameOf(best ? best[0] : grp.joinedOn);
    } else title = firstFive(grp.items[0].md);
    return {
      id: idOf(grp),
      title,
      items: grp.items.map((it) => ({ md: it.md, source: it.source })),
      notes: [...subj.keys()],
      people: uniq([...grp.items.flatMap((it) => it.people), ...[...subj.keys()].filter((n) => PEOPLE_TYPES.has(typeOf(n)))]),
      places: uniq([...grp.items.flatMap((it) => it.places), ...[...subj.keys()].filter(isPlace)]),
    };
  });

  // Background: Pending Consequences, and Resolved Threads entries that say they are carried on, carried forward or
  // still live, one line each; a closed entry that merely holds the word "carried" ("Mirren carried the casks up") is closed
  // (Task 11b, F7). Each line is its whole bullet, never cut into sentences, so an initialism and the bold survive
  // (Task 11b, F1).
  const oneLine = (s) => nl(s).replace(/\s*\n\s*/g, ' ').trim();
  const background = [];
  if (wrapUp) {
    for (const md of sectionBullets(/^pending consequences$/i)) if (!isDone(md)) background.push({ from: 'Pending Consequences', md: oneLine(md) });
    for (const md of sectionBullets(/^resolved threads$/i)) {
      // an entry "<the thread> — closed: <how>" is judged by its closure alone: the thread's own words ("is still live
      // in that house") were true when it was open
      const closure = CLOSURE.exec(md);
      if (!CARRIED.test(closure ? closure[1] : md) || isDone(md)) continue;
      background.push({ from: 'Resolved Threads', md: oneLine(md) });
    }
  }

  // Every note the page names, by its display name (F11): the PCs, the cards' notes, people and places, the lead's, where
  // the crew is and where each person stands. The page reads a name from here before its own.
  const names = {};
  const named = (p) => { if (p && index.has(p) && !names[p]) names[p] = nameOf(p); };
  for (const p of pcNotes) named(p);
  for (const c of cards) for (const p of [...c.notes, ...c.people, ...c.places]) named(p);
  if (lead) for (const p of [lead.place, ...lead.people, ...lead.hits]) named(p);
  named(whereNow.place);
  named(worldLoc);
  for (const [p, at] of Object.entries(peopleAt)) { named(p); named(at); }
  for (const p of Object.values(byPc)) named(p);

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
    names,
    leftOut: LEFT_OUT,
  };
  return model;
}

module.exports = { readRecord, ENTITY_TYPES };

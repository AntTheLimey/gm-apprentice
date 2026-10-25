'use strict';
// What a page's subject is connected to, for the Connections section. Built once per
// build from the published page list: `page.frontmatter` here is already the reader's
// view (processor.js publishedFrontmatter) and `backlinks` come from published text, so
// a gm-only relationship, an excluded field and a note with no page never get this far.
// Nothing here reads sourceFrontmatter or page.markdown.
const { backlinksOf } = require('./backlinks');
const { linkText, labelsForLinksFully, replaceWikilinks, wikilinkSpans, removeEmbeds, parseWikilink } = require('./wikilink');
const { canonicalNfc } = require('./unicode');
const { kindLabel } = require('./kind-label');
const { orderedSessions } = require('./story-spine');
const { WRAP_UP_TYPES } = require('./session-hub');
const { portraitBasename } = require('./processor');
const { toneFamily, groupLabel, PEOPLE } = require('./ontology');
const { createRenderer } = require('./markdown');
// The build's own reading of a link's address and title (balanced parentheses, `<..>`, a quoted title).
const { parseLinkDestination, parseLinkTitle } = createRenderer().helpers;

const TABS = [
  ['people', 'People'], ['places', 'Places'], ['orgs', 'Organisations'], ['things', 'Things'],
  ['events', 'Events'], ['papers', 'Papers'], ['creatures', 'Creatures'], ['sessions', 'Sessions'],
  ['other', 'Other'],
];
const TAB_OF_TYPE = {
  pc: 'people', npc: 'people', location: 'places', faction: 'orgs', organization: 'orgs',
  item: 'things', event: 'events', document: 'papers', clue: 'papers', handout: 'papers', prop: 'papers',
  creature: 'creatures', session: 'sessions',
};
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const typeOf = (page) => String(((page && page.frontmatter) || {}).type || '');
const isSessionPage = (page) => typeOf(page) === 'session' || WRAP_UP_TYPES.has(typeOf(page));
const isIndex = (page) => String(page.title).toLowerCase() === 'index';

function tabOf(page) {
  if (!page) return 'other';
  const type = typeOf(page);
  if (WRAP_UP_TYPES.has(type)) return 'sessions';
  return own(TAB_OF_TYPE, type) ? TAB_OF_TYPE[type] : 'other';
}

// A note's relationships as a flat list, from the list form (`- target: ..`) or the map
// form (`ally: [A, B]`). Anything that is not a relationship is skipped, never thrown on.
// Text the GM typed (a type, a description) is reduced as the page prints it, a labelled
// link to its label (wikilink.js labelsForLinks), so no reader of the model sees a target
// the GM kept off the site.
// A type or a name: an unlabelled link prints as its name (underscores read as spaces), a
// markdown link as its text and an embed not at all, so no bracket and no file name reaches
// the page. A description goes through printedProse below.
const printed = (text) => {
  const reduced = removeEmbeds(labelsForLinksFully(text))
    .replace(/(?<!\\)!?\[([^\]]*)\]\([^)]*\)/g, '$1');
  return linkText(reduced, { humanize: true }).words.replace(/\s+/g, ' ').trim();
};

// `text` with each markdown link `[label](address "title")` turned into its label. The
// address is read as the build reads it, so one holding `)` ends where the link does. Text
// that is not a link is left as written, and a `[` that opens `[[` never starts a link. Each
// bracket is paired once, so the work is linear.
// Where that reading refuses a link (a space in the address, a stray quote) the label is still
// kept and the address dropped through the next `)`, as it always was, so no address is ever
// printed; past LINK_DEPTH a label is reduced that way too.
// Past that depth every `](address)` goes, through the next `)`, and the brackets stay.
// Where an address that could not be read ends: its balancing `)`, or the first `)` when
// its brackets never balance.
// The text's brackets are counted once, so asking for every link in it stays linear: the
// balancing `)` is the first place the running count drops below its value at the start.
function addressEnds(text) {
  const n = text.length;
  const count = new Int32Array(n + 1);
  const nextClose = new Int32Array(n + 1).fill(-1);
  let open = 0;
  for (let i = 0; i < n; i++) {
    count[i] = open;
    if (text[i] === '\\') { count[++i] = open; continue; }
    if (text[i] === '(') open++;
    else if (text[i] === ')') { open--; nextClose[i] = i; }
  }
  count[n] = open;
  for (let i = n - 1; i >= 0; i--) if (nextClose[i] === -1) nextClose[i] = nextClose[i + 1];
  const drop = new Int32Array(n + 1).fill(-1);
  const stack = [];
  for (let i = n; i >= 0; i--) {
    while (stack.length && count[stack[stack.length - 1]] >= count[i]) stack.pop();
    if (stack.length) drop[i] = stack[stack.length - 1];
    stack.push(i);
  }
  return (start) => (drop[start] !== -1 ? drop[start] - 1 : nextClose[start]);
}
function dropAddresses(text) {
  const addressEnd = addressEnds(text);
  let out = '';
  let at = 0;
  for (let i = text.indexOf(']('); i !== -1; i = text.indexOf('](', at)) {
    const end = addressEnd(i + 2);
    if (end === -1) break;
    out += text.slice(at, i);
    at = end + 1;
  }
  return out + text.slice(at);
}
const LINK_DEPTH = 16;
function markdownLinkLabels(text, depth = 0) {
  const closeOf = new Map();
  const open = [];
  for (let j = 0; j < text.length; j++) {
    if (text[j] === '\\') j++;
    else if (text[j] === '[') open.push(j);
    else if (text[j] === ']' && open.length) closeOf.set(open.pop(), j);
  }
  if (!closeOf.size) return text;
  const blank = (n) => { while (/\s/.test(text[n] || '')) n++; return n; };
  // The `[` of a `[[`..`]]` pair, outer or inner: a wiki-link, never a markdown link.
  const wikiBracket = (i) => (text[i + 1] === '[' && closeOf.get(i + 1) === closeOf.get(i) - 1)
    || (text[i - 1] === '[' && closeOf.get(i - 1) === closeOf.get(i) + 1);
  let addressEnd;
  let out = '';
  let at = 0;
  for (let i = text.indexOf('['); i !== -1; i = text.indexOf('[', Math.max(at, i + 1))) {
    const close = closeOf.get(i);
    if (close === undefined || text[close + 1] !== '(' || wikiBracket(i)) continue;
    const dest = parseLinkDestination(text, blank(close + 2), text.length);
    let end = -1;
    if (dest.ok) {
      end = blank(dest.pos);
      const title = end > dest.pos ? parseLinkTitle(text, end, text.length) : { ok: false };
      if (title.ok) end = blank(title.pos);
    }
    if (end === -1 || text[end] !== ')') end = (addressEnd ||= addressEnds(text))(close + 2);
    // An address that never ends: no link, but the `](` is not prose either; the label stays.
    const unfinished = end === -1;
    const label = text.slice(i + 1, close);
    // An image (`![alt](address)`) prints its alt text, not the `!` before it.
    const image = i > at && text[i - 1] === '!' && text[i - 2] !== '\\';
    out += text.slice(at, image ? i - 1 : i) + (depth < LINK_DEPTH ? markdownLinkLabels(label, depth + 1) : dropAddresses(label));
    // The address that never ends is dropped up to the next space, so `[Shadow](Hidden_Man.md`
    // prints `Shadow`, and the words after a space stay.
    let after = close + 2;
    if (unfinished) while (after < text.length && !/\s/.test(text[after])) after++;
    at = unfinished ? after : end + 1;
  }
  return out + text.slice(at);
}

// A description is prose: the same reduction, but only a link's name is read as words. An
// underscore anywhere else (`snake_case`, `_emphasis_`, a pasted address) is the GM's own.
const printedProse = (text) => {
  // What is left of a link is its note's name (a `#heading` or `^block` after it is not on the
  // page), with `_` (written `\_` in a table) read as a space. Anywhere else `\_` is the
  // underscore the GM escaped.
  const reduced = replaceWikilinks(markdownLinkLabels(removeEmbeds(labelsForLinksFully(text))), (link, body) => {
    const { name, heading } = parseWikilink(body);
    return (name || heading).replace(/\\_/g, '_').replace(/_/g, ' ');
  });
  return linkText(reduced).words.replace(/\\_/g, '_').replace(/\s+/g, ' ').trim();
};
function edgesOf(frontmatter) {
  const raw = frontmatter && frontmatter.relationships;
  const out = [];
  const take = (target, type, tone, description) => {
    if (typeof target !== 'string' || !target.trim()) return;
    out.push({
      target,
      type: typeof type === 'string' ? printed(type) : '',
      tone,
      line: typeof description === 'string' ? printedProse(description) : '',
    });
  };
  if (Array.isArray(raw)) {
    for (const r of raw) if (r && typeof r === 'object' && !Array.isArray(r)) take(r.target, r.type, r.tone, r.description);
  } else if (raw && typeof raw === 'object') {
    for (const [type, targets] of Object.entries(raw)) {
      for (const t of Array.isArray(targets) ? targets : [targets]) take(t, type);
    }
  }
  return out;
}

// The note name a relationship target value names, by the rule the site prints it with.
// One link with words beside it ("[[Name|label]] (briefly)") names that link's note; two or
// more name none (`links` says how many, so a reader can tell "none" from a plain name).
function targetRef(value) {
  const ref = linkText(value, { humanize: true });
  const links = wikilinkSpans(String(value));
  const key = !ref.labelled && links.length === 1 ? parseWikilink(links[0].body).name.trim() : ref.key;
  const name = canonicalNfc(key.split(/[#^]/)[0].replace(/\.md$/i, '').trim());
  return { name, links: links.length, words: ref.words.trim() };
}

// The notes a participant entry starts with, and the line that follows them. A run of links
// joined by a comma, slash, & or "and" names one participant each, all with the one line; the
// line is bare of one pair of brackets and of a dash, colon or comma left at its start.
const JOIN = /^\s*(?:,|\/|&|and)\s*$/i;
const participantsOf = (entry) => {
  if (typeof entry !== 'string') return [];
  const text = entry.trim();
  const spans = wikilinkSpans(text);
  if (!spans.length || spans[0].index !== 0) return [];
  let run = 1;
  while (run < spans.length && JOIN.test(text.slice(spans[run - 1].end, spans[run].index))) run++;
  const rest = text.slice(spans[run - 1].end).trim();
  const line = (/^\(([\s\S]*)\)$/.test(rest) ? rest.slice(1, -1) : rest).replace(/^[\s\u2014\u2013:,-]+/, '').trim();
  return spans.slice(0, run).map((span) => ({ link: text.slice(span.index, span.end), line }));
};

// What an event's own fields tie (#368), read once for the build and for the relationships check, so
// the two never disagree. `resolve(value)` says what a link names ({ page, name, words }; `page` is
// null when it names no note); `self`, `typeOf` and `isIndex` tell the event, a page's type and
// the index page. Returns the `place` the event was held at (or null), each of its `participants`
// ({ to, line }), and the `visitors`: the participants who are people, each of whom visited
// the place. A name with no page is a participant but never a visitor.
function eventTies(fm, resolve, { self, typeOf, isIndex }) {
  const place = typeof fm.location === 'string' && wikilinkSpans(fm.location).length === 1 ? resolve(fm.location) : null;
  const participants = [];
  const visitors = [];
  for (const entry of Array.isArray(fm.participants) ? fm.participants : []) {
    for (const who of participantsOf(entry)) {
      const to = resolve(who.link);
      participants.push({ to, line: who.line });
      // A tie the GM wrote to the event does not stop its visit.
      if (to.page && to.page !== self && !isIndex(to.page) && PEOPLE.has(typeOf(to.page))) visitors.push(to);
    }
  }
  return { place, participants, visitors };
}

// `noteExists(name)`: whether the vault holds a note of that name (published or not). A tie to a note that exists but
// has no page is the Keeper's side of the story, so it is left off the page. A tie to a name with no note at all (a red
// link) is still printed as plain text: nothing hid it. `pageFor(name)`: the output path of the page a name spelled in
// another letter case, or with underscores, belongs to (build.js foldedPagePath), so such a tie is that page's.
function buildConnections({ pages, linkMap, backlinks, hubPairs, imageMap, extras, noteExists, pageFor }) {
  const byPath = new Map(pages.map((p) => [p.outputPath, p]));
  // What a target names: its page when it has one, else the words to call it by (its
  // label, or its name with underscores read as spaces: wikilink.js linkText).
  const resolve = (value) => {
    const { name, words } = targetRef(value);
    const out = name ? (linkMap[name] || (pageFor && pageFor(name))) : undefined;
    const page = (typeof out === 'string' && byPath.get(out)) || null;
    return { page, name, words, hidden: !page && !!name && !!noteExists && noteExists(name) };
  };

  // Every relationship, once, filed under the page it points at.
  const outgoing = new Map();
  const incoming = new Map();
  const tied = new Set();   // pairs of pages (by output path, in one order) that already have a tie
  const pairKey = (a, b) => [a.outputPath, b.outputPath].sort().join('\u0000');
  const file = (page, edge, to) => {
    if (!outgoing.has(page)) outgoing.set(page, []);
    outgoing.get(page).push({ edge, to });
    if (!to.page || to.page === page) return;
    if (!incoming.has(to.page)) incoming.set(to.page, []);
    incoming.get(to.page).push({ edge, from: page });
    tied.add(pairKey(page, to.page));
  };
  for (const page of pages) {
    if (isIndex(page)) continue;
    outgoing.set(page, []);
    for (const edge of edgesOf(page.frontmatter)) file(page, edge, resolve(edge.target));
  }

  // An event's own fields are ties too (#368): each participant took part, the location is
  // where it was held, and everyone who took part visited that place. A tie the GM wrote
  // between the same two notes, in either direction, wins, and a name with no page is left to
  // the list the event prints.
  const derive = (from, type, to, text) => {
    if (!to.page || to.page === from || isIndex(to.page) || tied.has(pairKey(from, to.page))) return false;
    file(from, { target: to.name, type, tone: undefined, line: text ? printedProse(text) : '' }, to);
    return true;
  };
  for (const event of pages) {
    if (isIndex(event) || typeOf(event) !== 'event') continue;
    const { place, participants, visitors } = eventTies(event.frontmatter, resolve, { self: event, typeOf, isIndex });
    if (place) derive(event, 'located_at', place, '');
    for (const { to, line } of participants) derive(event, 'had_participant', to, line);
    if (place && place.page) for (const to of visitors) derive(to.page, 'visited', place, '');
  }

  // The sessions whose published text links a page. A Wrap-Up stands for its hub, so the
  // pair counts once.
  const hubOf = new Map();
  for (const [hub, wrapUp] of hubPairs || []) hubOf.set(wrapUp.outputPath, hub);
  const order = new Map(orderedSessions(pages).map((s, n) => [s.outputPath, n]));
  const sessionsOf = new Map();
  const sessionsLinking = (page) => {
    if (!sessionsOf.has(page)) {
      const found = new Map();
      for (const b of backlinksOf(backlinks, page)) {
        const from = byPath.get(b.outputPath);
        if (!from || !isSessionPage(from)) continue;
        const session = hubOf.get(from.outputPath) || from;
        found.set(session.outputPath, session);
      }
      sessionsOf.set(page, found);
    }
    return sessionsOf.get(page);
  };
  const natural = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });
  const bySessionOrder = (a, b) => (order.has(a.outputPath) ? order.get(a.outputPath) : Infinity)
    - (order.has(b.outputPath) ? order.get(b.outputPath) : Infinity)
    || natural(a.displayTitle, b.displayTitle);
  const shared = (page, other) => {
    const mine = sessionsLinking(page);
    const both = [...sessionsLinking(other).values()].filter((s) => mine.has(s.outputPath)).sort(bySessionOrder);
    if (!both.length) return null;
    return { count: both.length, first: both[0].displayTitle, last: both[both.length - 1].displayTitle };
  };

  const imageOf = (page) => {
    const base = portraitBasename(page.frontmatter || {});
    const key = base && canonicalNfc(base);
    const entry = key && imageMap && own(imageMap, key) && imageMap[key];
    return entry ? 'images/' + entry.relPath : null;
  };

  function modelFor(page) {
    const model = { subject: { title: page.displayTitle || page.title, outputPath: page.outputPath }, tabs: [], mentions: [] };
    if (isIndex(page)) return model;
    const items = new Map();   // the other page's output path, or '\0' + a name with no page, then the group
    const firstKey = new Map();   // the other page's id -> the key of the first item filed for it
    // A relationship the GM wrote is kept under its own heading: two notes of a pair that say
    // different things (`member_of` here, `allied_with` there) both show. The same tie written at
    // both ends, or a tie and its proper inverse, files under one heading and so shows once.
    // A type the vocabulary does not know has no inverse, so its two ends are one statement.
    // Anything else (a parent, an extra) joins the item the pair already has.
    const add = (other, noPage, tab, group, written = false) => {
      const id = other ? other.outputPath : '\u0000' + noPage.name;
      const key = !written && firstKey.has(id) ? firstKey.get(id) : id + '\u0001' + group.replace(/ \(named by\)$/, '');
      if (!firstKey.has(id)) firstKey.set(id, key);
      if (!items.has(key)) {
        items.set(key, {
          tab, group,
          item: other
            ? { title: other.displayTitle || other.title, outputPath: other.outputPath, kind: kindLabel(typeOf(other)), tone: null, lines: [], own: 0, sessions: shared(page, other), image: imageOf(other) }
            : { title: printed(noPage.words) || noPage.name.replace(/_/g, ' '), outputPath: null, kind: '', tone: null, lines: [], own: 0, sessions: null, image: null, key: noPage.name },
        });
      }
      return items.get(key).item;
    };
    // Outgoing relationships are noted first, so an item's own lines lead its list.
    const note = (item, edge, mine) => {
      if (item.tone === null) item.tone = toneFamily(edge.tone);
      if (!edge.line || item.lines.includes(edge.line)) return;
      item.lines.push(edge.line);
      if (mine) item.own += 1;
    };

    for (const { edge, to } of outgoing.get(page) || []) {
      if (to.page === page || (!to.page && !to.name) || to.hidden || (to.page && isIndex(to.page))) continue;
      note(add(to.page, to, tabOf(to.page), groupLabel(edge.type, 'out', { from: typeOf(page), to: typeOf(to.page) }), true), edge, true);
    }
    for (const { edge, from } of incoming.get(page) || []) {
      note(add(from, null, tabOf(from), groupLabel(edge.type, 'in', { from: typeOf(from), to: typeOf(page) }), true), edge, false);
    }
    // A parent with no page stays in Places, as a name with no link.
    if (typeOf(page) === 'location' && typeof page.frontmatter.parent_location === 'string') {
      const parent = resolve(page.frontmatter.parent_location);
      if (parent.page !== page && !parent.hidden && (parent.page || parent.name)) add(parent.page, parent, 'places', 'Part of');
    }
    for (const extra of (extras && extras.get(page)) || []) {
      if (extra.page && extra.page !== page) add(extra.page, null, tabOf(extra.page), printed(extra.group));
    }

    const byTitle = (a, b) => natural(a.title, b.title);
    for (const [id, label] of TABS) {
      const groups = new Map();
      for (const entry of items.values()) {
        if (entry.tab !== id) continue;
        if (!groups.has(entry.group)) groups.set(entry.group, []);
        groups.get(entry.group).push(entry.item);
      }
      if (!groups.size) continue;
      const list = [...groups].map(([name, members]) => ({
        label: name,
        items: members.sort((a, b) => ((b.sessions || {}).count || 0) - ((a.sessions || {}).count || 0) || byTitle(a, b)),
      }));
      // Family first; then the small groups, so the long tail of a big one sits last.
      list.sort((a, b) => (b.label === 'Family') - (a.label === 'Family') || a.items.length - b.items.length || a.label.localeCompare(b.label));
      model.tabs.push({ id, label, groups: list });
    }

    if (!WRAP_UP_TYPES.has(typeOf(page))) {
      const groups = new Map();
      for (const b of backlinksOf(backlinks, page)) {
        const from = byPath.get(b.outputPath);
        if (!from || from === page || isIndex(from) || firstKey.has(from.outputPath)) continue;
        const id = tabOf(from);
        if (!groups.has(id)) groups.set(id, []);
        groups.get(id).push(from);
      }
      const ordered = [['sessions', 'Sessions'], ...TABS.filter(([id]) => id !== 'sessions')];
      for (const [id, label] of ordered) {
        const members = groups.get(id);
        if (!members) continue;
        members.sort(id === 'sessions' ? bySessionOrder : (a, b) => natural(a.displayTitle, b.displayTitle));
        model.mentions.push({ label, items: members.map((p) => ({ title: p.displayTitle || p.title, outputPath: p.outputPath, kind: kindLabel(typeOf(p)) })) });
      }
    }
    return model;
  }

  const cache = new Map();
  return { for: (page) => { if (!cache.has(page)) cache.set(page, modelFor(page)); return cache.get(page); } };
}

function isEmpty(model) {
  return !model || (model.tabs.length === 0 && model.mentions.length === 0);
}

module.exports = { buildConnections, isEmpty, TABS, markdownLinkLabels, targetRef, eventTies, participantsOf };

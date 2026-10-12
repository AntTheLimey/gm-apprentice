'use strict';
// What a page's subject is connected to, for the Connections section. Built once per
// build from the published page list: `page.frontmatter` here is already the reader's
// view (processor.js publishedFrontmatter) and `backlinks` come from published text, so
// a gm-only relationship, an excluded field and a note with no page never get this far.
// Nothing here reads sourceFrontmatter or page.markdown.
const { backlinksOf } = require('./backlinks');
const { linkText, labelsForLinksFully, wikilinkRe, parseWikilink } = require('./wikilink');
const { canonicalNfc } = require('./unicode');
const { kindLabel } = require('./kind-label');
const { orderedSessions } = require('./story-spine');
const { WRAP_UP_TYPES } = require('./session-hub');
const { portraitBasename } = require('./processor');
const { toneFamily, groupLabel } = require('./ontology');
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
  item: 'things', event: 'events', document: 'papers', clue: 'papers', handout: 'papers',
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
  const reduced = labelsForLinksFully(text)
    .replace(/!\[\[[^\]]*\]\]/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
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
function dropAddresses(text) {
  let out = '';
  let at = 0;
  for (let i = text.indexOf(']('); i !== -1; i = text.indexOf('](', at)) {
    const end = text.indexOf(')', i + 2);
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
    if (end === -1 || text[end] !== ')') end = text.indexOf(')', close + 2);
    if (end === -1) continue;
    const label = text.slice(i + 1, close);
    out += text.slice(at, i) + (depth < LINK_DEPTH ? markdownLinkLabels(label, depth + 1) : dropAddresses(label));
    at = end + 1;
  }
  return out + text.slice(at);
}

// A description is prose: the same reduction, but only a link's name is read as words. An
// underscore anywhere else (`snake_case`, `_emphasis_`, a pasted address) is the GM's own.
const printedProse = (text) => {
  const reduced = markdownLinkLabels(labelsForLinksFully(text).replace(/!\[\[[^\]]*\]\]/g, ''))
    .replace(wikilinkRe('g'), (link) => link.replace(/_/g, ' '));
  return linkText(reduced).words.replace(/\s+/g, ' ').trim();
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

function buildConnections({ pages, linkMap, backlinks, hubPairs, imageMap, extras }) {
  const byPath = new Map(pages.map((p) => [p.outputPath, p]));
  // What a target names: its page when it has one, else the words to call it by (its
  // label, or its name with underscores read as spaces: wikilink.js linkText).
  const resolve = (value) => {
    const ref = linkText(value, { humanize: true });
    // One link with words beside it ("[[Name|label]] (briefly)") names that link's page;
    // two or more name none, so the item stays unlinked.
    const links = String(value).match(wikilinkRe('g')) || [];
    const key = !ref.labelled && links.length === 1 ? parseWikilink(wikilinkRe('').exec(links[0])[1]).name.trim() : ref.key;
    const name = canonicalNfc(key.split(/[#^]/)[0].replace(/\.md$/i, '').trim());
    const out = name ? linkMap[name] : undefined;
    return { page: (typeof out === 'string' && byPath.get(out)) || null, name, words: ref.words.trim() };
  };

  // Every relationship, once, filed under the page it points at.
  const outgoing = new Map();
  const incoming = new Map();
  for (const page of pages) {
    if (isIndex(page)) continue;
    const list = edgesOf(page.frontmatter).map((edge) => ({ edge, to: resolve(edge.target) }));
    outgoing.set(page, list);
    for (const { edge, to } of list) {
      if (!to.page || to.page === page) continue;
      if (!incoming.has(to.page)) incoming.set(to.page, []);
      incoming.get(to.page).push({ edge, from: page });
    }
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
    const items = new Map();   // the other page's output path, or '\0' + a name with no page
    const add = (other, noPage, tab, group) => {
      const id = other ? other.outputPath : '\u0000' + noPage.name;
      if (!items.has(id)) {
        items.set(id, {
          tab, group,
          item: other
            ? { title: other.displayTitle || other.title, outputPath: other.outputPath, kind: kindLabel(typeOf(other)), tone: null, lines: [], own: 0, sessions: shared(page, other), image: imageOf(other) }
            : { title: printed(noPage.words) || noPage.name.replace(/_/g, ' '), outputPath: null, kind: '', tone: null, lines: [], own: 0, sessions: null, image: null, key: noPage.name },
        });
      }
      return items.get(id).item;
    };
    // Outgoing relationships are noted first, so an item's own lines lead its list.
    const note = (item, edge, mine) => {
      if (item.tone === null) item.tone = toneFamily(edge.tone);
      if (!edge.line || item.lines.includes(edge.line)) return;
      item.lines.push(edge.line);
      if (mine) item.own += 1;
    };

    for (const { edge, to } of outgoing.get(page) || []) {
      if (to.page === page || (!to.page && !to.name) || (to.page && isIndex(to.page))) continue;
      note(add(to.page, to, tabOf(to.page), groupLabel(edge.type, 'out')), edge, true);
    }
    for (const { edge, from } of incoming.get(page) || []) {
      note(add(from, null, tabOf(from), groupLabel(edge.type, 'in')), edge, false);
    }
    // A parent with no page stays in Places, as a name with no link.
    if (typeOf(page) === 'location' && typeof page.frontmatter.parent_location === 'string') {
      const parent = resolve(page.frontmatter.parent_location);
      if (parent.page !== page && (parent.page || parent.name)) add(parent.page, parent, 'places', 'Part of');
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
        if (!from || from === page || isIndex(from) || items.has(from.outputPath)) continue;
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

module.exports = { buildConnections, isEmpty, TABS, markdownLinkLabels };

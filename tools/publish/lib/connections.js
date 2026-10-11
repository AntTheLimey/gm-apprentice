'use strict';
// What a page's subject is connected to, for the Connections section. Built once per
// build from the published page list: `page.frontmatter` here is already the reader's
// view (processor.js publishedFrontmatter) and `backlinks` come from published text, so
// a gm-only relationship, an excluded field and a note with no page never get this far.
// Nothing here reads sourceFrontmatter or page.markdown.
const { backlinksOf } = require('./backlinks');
const { linkText, labelsForLinks } = require('./wikilink');
const { canonicalNfc } = require('./unicode');
const { kindLabel } = require('./kind-label');
const { orderedSessions } = require('./story-spine');
const { WRAP_UP_TYPES } = require('./session-hub');
const { portraitBasename } = require('./processor');
const { toneFamily, groupLabel } = require('./ontology');

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
const printed = (text) => labelsForLinks(text).replace(/\s+/g, ' ').trim();
function edgesOf(frontmatter) {
  const raw = frontmatter && frontmatter.relationships;
  const out = [];
  const take = (target, type, tone, description) => {
    if (typeof target !== 'string' || !target.trim()) return;
    out.push({
      target,
      type: typeof type === 'string' ? printed(type) : '',
      tone,
      line: typeof description === 'string' ? printed(description) : '',
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
    const name = canonicalNfc(ref.key.split(/[#^]/)[0].replace(/\.md$/i, '').trim());
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
  const bySessionOrder = (a, b) => (order.has(a.outputPath) ? order.get(a.outputPath) : Infinity)
    - (order.has(b.outputPath) ? order.get(b.outputPath) : Infinity)
    || String(a.displayTitle).localeCompare(String(b.displayTitle));
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

    const byTitle = (a, b) => String(a.title).localeCompare(String(b.title));
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
        members.sort(id === 'sessions' ? bySessionOrder : (a, b) => String(a.displayTitle).localeCompare(String(b.displayTitle)));
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

module.exports = { buildConnections, isEmpty, TABS };

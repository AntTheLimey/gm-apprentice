'use strict';

// What a container prop holds, as rows a listing prints. A shown item is linked; an item the
// players have not found is, when its container asks (`show_sealed: titles`), its title alone,
// read from the frontmatter the site would publish; a withheld item is never a row. The build
// and the leak gate both ask this module, so they agree on what each listing shows.
const path = require('path');
const { publishedFrontmatter, isWithheld, parseWikiRef, publishMode, valueText, relativeHref, encodeHref } = require('../processor');
const { linkKeys, slugify } = require('../scanner');
const { unmark } = require('../gm-marks');
const { sessionSortKey } = require('../templates/index-page');
const { canonicalNfc } = require('../unicode');
const { isPropNote, propContainerOf, showSealedOf } = require('./note');
const { bytesOf, stateFileOf } = require('./plan');
const { fieldText } = require('./layout');
const { PAGE_TAKER, addressShapeProblem, takenAddresses } = require('./address');

const sourceOf = (page) => page.sourceFrontmatter || page.frontmatter || {};

// The site path of a prop's own page, when the site holds one: a hand-made file the plan read,
// a styled page the make pass made, or a container page (made in the same pass as its listing).
// null when the prop does not ship, or its page is in `blocked` (outputs the build will not write).
function propPageOf(p, blocked) {
  if (!p.ships || !p.address || !p.files.length || blocked.has(p.files[0].out)) return null;
  if (p.kind === 'container' && p.made) return p.address;
  if (p.made) return typeof p.made_html === 'string' ? p.address : null;
  return bytesOf(p.files[0]) !== null ? p.address : null;
}

function firstOf(value) {
  return Array.isArray(value) ? value[0] : value;
}

// One prop as a row. Shown: linked to its prop page (else its note page), with its line and the
// session it arrived in (`updated`, its lastUpdated, orders it after that). A `publish: stub` item on
// the player site is its title and its note link only: its stub page shows neither line nor session.
// `group`: its published prop_group, or null. Not shown: its title alone, from the published view of its frontmatter (so a hidden prop_title never
// names it), with the note's own field exceptions (`fieldOverrides`, by vault path) as its page has them.
// `unrevealed`: shown on the GM site, not on the player site. `nameOf(page, title)`: the title as this site
// prints the note's name (the GM site marks a withheld one).
function propRow(p, { isShown, excludeFields = [], fieldOverrides = {}, resolvePage = () => null, isPlayerShown = null, blocked = new Set(), site = 'player', nameOf = (pg, t) => t }) {
  const page = p.page;
  if (!isShown(page)) {
    const fm = publishedFrontmatter(sourceOf(page), excludeFields, fieldOverrides[p.rel] || {});
    const named = fm.title === undefined ? String(page.title || '').replace(/_/g, ' ') : page.displayTitle;
    return { rel: p.rel, title: fieldText(fm.prop_title).trim() || named || '', href: null, line: null, arrived: null, sealed: true, unrevealed: false, group: null };
  }
  const fm = page.frontmatter || {};
  const stub = site !== 'gm' && publishMode(sourceOf(page)) === 'stub';
  const first = stub ? null : firstOf(fm.revealed_in);
  const target = typeof first === 'string' ? canonicalNfc(parseWikiRef(first).target) : '';
  const at = target ? resolvePage(target) : null;
  return {
    rel: p.rel,
    title: nameOf(page, fieldText(fm.prop_title).trim() || page.displayTitle || page.title || ''),
    href: propPageOf(p, blocked) || page.outputPath,
    line: (!stub && fieldText(fm.prop_line).trim()) || null,
    arrived: at ? { title: at.displayTitle || at.title || '', href: at.outputPath } : null,
    sealed: false,
    // A withheld item is never on the player site's listing, so on the GM's it is unrevealed too.
    unrevealed: isPlayerShown ? !isPlayerShown(page) || isWithheld(sourceOf(page)) : false,
    updated: (!stub && fieldText(fm.lastUpdated).trim()) || null,
    // Its published prop_group: the heading a container's page lists it under (a sealed row has none).
    group: canonicalNfc(fieldText(fm.prop_group).trim()) || null,
  };
}

const byTitle = (a, b) => a.title.localeCompare(b.title, 'en', { sensitivity: 'base' });
// Ascending, a missing value (null) last.
const missingLast = (x, y) => (x === y ? 0 : x === null ? 1 : y === null ? -1 : x < y ? -1 : 1);

// Shown rows first: by the session they arrived in, then lastUpdated, then title (none last
// each time). Sealed rows after, by title.
function byArrival(a, b) {
  if (a.sealed !== b.sealed) return a.sealed ? 1 : -1;
  if (a.sealed) return byTitle(a, b);
  const session = (r) => (r.arrived && sessionSortKey(r.arrived.title)) || null;
  return missingLast(session(a), session(b))
    || missingLast(a.updated || null, b.updated || null)
    || byTitle(a, b);
}

// Every shown container prop with its title and note title as this site prints them (`nameOf`) and
// its rows, by the container's vault path. An item is listed under
// the container its prop_container names (one level: a container in a container is a row of it).
// An item that names no container prop is listed on its own, with a problem row when its note shows.
// `site: 'gm'`: no sealed rows (nothing is sealed from the GM), withheld items show, and a row the
// player site does not show (`isPlayerShown`) is marked unrevealed.
// `blocked`: outputs the build will not write, so no row links one.
function containerItems({ props, isShown, excludeFields = [], fieldOverrides = {}, resolvePage = () => null, site = 'player', isPlayerShown = null, blocked = new Set(), problems = [], nameOf = (pg, t) => t }) {
  const gm = site === 'gm';
  const containers = props.filter((p) => p.kind === 'container');
  // Names to containers, as a link reaches a page: a title before a vault path or an alias.
  const byKey = new Map();
  for (const c of containers) { const [title] = linkKeys(c.page); if (!byKey.has(title)) byKey.set(title, c); }
  for (const c of containers) for (const k of linkKeys(c.page)) if (!byKey.has(k)) byKey.set(k, c);
  const out = new Map();
  for (const c of containers) {
    if (!isShown(c.page)) continue;
    const noteTitle = c.page.displayTitle || c.page.title || '';
    const title = fieldText((c.page.frontmatter || {}).prop_title).trim() || noteTitle;
    out.set(c.rel, { container: c, title: nameOf(c.page, title), noteTitle: nameOf(c.page, noteTitle), rows: [] });
  }
  const problem = (p, detail, fix) => problems.push({ rel: p.rel, code: 'PROP_NOT_COPIED', severity: 'warning', detail, fix });
  for (const p of props) {
    const target = propContainerOf(sourceOf(p.page));
    if (!target) continue;
    const container = byKey.get(target);
    const shown = isShown(p.page);
    if (container === p) {
      if (shown) problem(p, `prop_container names "${target}", which is this prop itself: it names itself as its container, so it is listed on its own`, 'name the container prop it sits in, or remove prop_container');
      continue;
    }
    if (!container) {
      if (shown) problem(p, `prop_container names "${target}", which is not a container prop; it is listed on its own`, `make "${target}" a container (prop_kind: container), or correct prop_container`);
      continue;
    }
    const entry = out.get(container.rel);
    if (!entry) continue;
    if (!gm && isWithheld(sourceOf(p.page))) continue;
    if (!shown && (gm || showSealedOf(sourceOf(container.page)) !== 'titles')) continue;
    entry.rows.push(propRow(p, { isShown, excludeFields, fieldOverrides, resolvePage, isPlayerShown: gm ? isPlayerShown : null, blocked, site, nameOf }));
  }
  for (const entry of out.values()) entry.rows.sort(byArrival);
  return out;
}

// The fields the tool itself reads off a prop: a container's state file gives an item every other prop_* field.
const GENERIC_PROP_FIELDS = new Set([
  'prop_kind', 'prop_file', 'prop_address', 'prop_style', 'prop_line', 'prop_group', 'prop_container', 'prop_title',
  'prop_state', 'prop_state_global', 'prop_hand', 'prop_font', 'prop_breaks', 'prop_shift', 'show_sealed',
]);
const STATE_CORE = ['title', 'line', 'href', 'sealed'];

// A field value as the state file gives it: text, a finite number, true or false, or a list or map of those; undefined
// for anything else (a date, an empty value), which is left out whole.
function stateValue(v) {
  if (typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (Array.isArray(v)) {
    const out = v.map(stateValue);
    return out.includes(undefined) ? undefined : out;
  }
  if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      const value = stateValue(x);
      if (value === undefined) return undefined;
      out[k] = value;
    }
    return out;
  }
  return undefined;
}

// An item's own fields for its container's state file, from frontmatter `fm` (the published view, so a hidden field is
// never one): every prop_* field the tool does not read itself, named without prop_. A name the item's entry already
// has (title, line, href, sealed) is left out.
function stateFieldsOf(fm) {
  const out = {};
  for (const [name, raw] of Object.entries(fm || {})) {
    if (!name.startsWith('prop_') || GENERIC_PROP_FIELDS.has(name)) continue;
    const key = name.slice('prop_'.length);
    const value = stateValue(raw);
    if (!key || STATE_CORE.includes(key) || value === undefined) continue;
    out[key] = value;
  }
  return out;
}

// What each container's state file gives each item of `rows` (a listing's, containerItems): a sealed row its title
// alone, a shown row its fields (stateFieldsOf of `fieldsOf(p)`, the item's published frontmatter). A `publish: stub`
// item on the player site gives none: its stub page shows neither line nor fields.
function stateEntries(rows, { props, site = 'player', fieldsOf = (p) => p.page.frontmatter || {} }) {
  const byRel = new Map(props.map((p) => [p.rel, p]));
  return rows.map((row) => {
    const p = byRel.get(row.rel);
    const stub = site !== 'gm' && publishMode(sourceOf(p.page)) === 'stub';
    return { row, p, fields: row.sealed || stub ? {} : stateFieldsOf(fieldsOf(p)) };
  });
}

// For the plan's pictures (plan.js planStatePictures): Map<container vault path, [{ rel, fields }]>, from containerItems'
// answer `listed`.
function stateFieldsOfListed(listed, options) {
  const out = new Map();
  for (const [rel, { rows }] of listed) out.set(rel, stateEntries(rows, options).map(({ row, fields }) => ({ rel: row.rel, fields })));
  return out;
}

// A container's state file's items: an object keyed by item, in its listing's order (`rows`, already byArrival). The key
// is the item's prop page's file name without its extension when it has a prop page, else its note's name, slugified;
// a sealed item's is its title, slugified (its note's name may say more than its title). A key met again gets -2, -3.
// A shown item is { title, line, href, sealed: false, ...its fields }, `href` relative from the state file (`from`),
// null without a page; a sealed one is { title, sealed: true } and nothing else. A withheld item is no row on the player
// site, so it is not here either. The GM site's marks are taken out of a title: a script prints it as text.
function stateItems(rows, { props, site = 'player', fieldsOf, from }) {
  const items = {};
  const put = (base, value) => {
    const root = base || 'item';
    let key = root;
    for (let n = 2; Object.prototype.hasOwnProperty.call(items, key); n++) key = `${root}-${n}`;
    items[key] = value;
  };
  for (const { row, p, fields } of stateEntries(rows, { props, site, fieldsOf })) {
    const title = unmark(row.title);
    if (row.sealed) {
      put(slugify(title), { title, sealed: true });
      continue;
    }
    const ownPage = row.href && row.href !== p.page.outputPath;
    const key = ownPage ? path.posix.basename(row.href, path.posix.extname(row.href)) : slugify(path.posix.basename(p.rel, path.posix.extname(p.rel)));
    put(key, { title, line: row.line, href: row.href ? encodeHref(relativeHref(from, row.href)) : null, sealed: false, ...fields });
  }
  return items;
}

// The state file's text: one statement setting window.<global>. Every < is written \u003c, so no value can close the
// script or open a comment in a page that inlines it.
function stateScript(global, items) {
  return `window.${global} = ${JSON.stringify(items, null, 2).replace(/</g, '\\u003c')};\n`;
}

// The props page: one page per site listing every prop it shows, by where each sits.
const COLLECTION_ADDRESS = 'props/index.html';
// Where the page goes when a page the site builds holds props/index.html (a vault's own Props/Index note).
const COLLECTION_FALLBACK = 'props/collection.html';
const OTHER_HEADING = 'Other props';

// The page's settings from a publishConfig (its non-listed `props` and `landing.latest_props`), each
// filled in: the address as written, or the default. A `cover` that is a [[wikilink]] names a prop
// (`coverNote`, the name inside it) and is no picture.
function collectionSettingsOf(settingsLike) {
  const s = (settingsLike && settingsLike.props) || {};
  const latest = settingsLike && settingsLike.landing ? settingsLike.landing.latest_props : 0;
  const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const cover = text(s.cover);
  const coverNote = cover && /^\[\[[^\]]+\]\]$/.test(cover) ? canonicalNfc(parseWikiRef(cover).target) : null;
  return {
    title: text(s.title) || 'Props',
    address: text(s.address) || COLLECTION_ADDRESS,
    cover: coverNote ? null : cover,
    coverNote: coverNote || null,
    intro: text(s.intro),
    latest: Number.isInteger(latest) && latest > 0 ? latest : 0,
  };
}

// Whether the site has a props page: a prop note it publishes that a listing may show (on the
// player site a withheld note is never listed).
function hasCollection(pages, { site = 'player' } = {}) {
  return pages.some((pg) => isPropNote(sourceOf(pg)) && (site === 'gm' || !isWithheld(sourceOf(pg))));
}

// Where the page is: { address, warning, replacesKept }. The asked address when it is a site path
// ending in .html and free (`taken`, props/address.js); else the default, with a warning. The default
// moves once to props/collection.html when a page the site builds holds it, and when a page holds that
// too the site has no props page (`address` null). One in a kept folder replaces the kept file.
// `name` is the setting as the vault writes it.
function collectionAddress(asked, taken, { name = 'player_site.props.address' } = {}) {
  const placed = (address, warning) => ({ address, warning, replacesKept: address !== null && taken.keeps(address) });
  let why = null;
  if (asked !== COLLECTION_ADDRESS) {
    const shape = addressShapeProblem(asked, '.html');
    const taker = shape ? null : taken.has(asked, { explicit: true });
    if (!shape && !taker) return placed(canonicalNfc(asked), null);
    why = shape || `is taken by ${String(taker).replace(/^inside /, '')}`;
  }
  const fallback = taken.has(COLLECTION_ADDRESS) === PAGE_TAKER ? COLLECTION_FALLBACK : COLLECTION_ADDRESS;
  if (fallback !== COLLECTION_ADDRESS && taken.has(fallback, { explicit: true })) {
    return placed(null, `${name}: ${COLLECTION_ADDRESS} and ${COLLECTION_FALLBACK} are both taken by pages the site builds, so the site has no props page`);
  }
  if (why) return placed(fallback, `${name} "${asked}" ${why}; the props page is at ${fallback}`);
  return placed(fallback, fallback === COLLECTION_ADDRESS ? null : `${name} "${asked}" is taken by ${PAGE_TAKER}; the props page is at ${fallback}`);
}

// The site's props page, placed: its settings (collectionSettingsOf, from `settingsLike`) at the address
// collectionAddress gives against the site's built pages (`pageOutputs`) and kept folders, with
// `replacesKept`; null when the site has none. `warning`: what the build says of the address. The build
// and the leak gate both place it here, so they agree on where it is.
function placeCollection({ pages, settingsLike, pageOutputs, keptDirs = [], site = 'player', name }) {
  if (!hasCollection(pages, { site })) return { collection: null, warning: null };
  const settings = collectionSettingsOf(settingsLike);
  const placed = collectionAddress(settings.address, takenAddresses({ pageOutputs, keptDirs }), { name });
  return { collection: placed.address ? { ...settings, address: placed.address, replacesKept: placed.replacesKept } : null, warning: placed.warning };
}

// The addresses no prop may take: the built pages, the files and folders the site needs, the kept
// folders (props/address.js), and the props page where it is set elsewhere than props/index.html (that
// one is already a file the site needs), held like a page.
function propTaken({ pageOutputs, keptDirs = [], collection = null }) {
  const extra = collection && collection.address !== COLLECTION_ADDRESS ? [collection.address] : [];
  return takenAddresses({ pageOutputs: [...pageOutputs, ...extra], keptDirs });
}

// Where the player site prints a sealed item's title, and which: on its container's page, when the
// container ships with a page the tool makes, and on the props page (`collectionAddress`; null: the site
// has none), which lists each container's rows as its page does. `listed` is containerItems' answer.
// Map<address, Map<item vault path, title>>.
function sealedTitlesOn(listed, collectionAddress) {
  const on = new Map();
  const put = (address, row) => {
    if (!on.has(address)) on.set(address, new Map());
    on.get(address).set(row.rel, row.title);
  };
  for (const { container, rows } of listed.values()) {
    for (const row of rows) {
      if (!row.sealed) continue;
      if (container.ships && container.address && container.made) put(container.address, row);
      // Its state file prints the title too, and nothing else of the item (stateItems).
      const state = container.ships && container.address ? stateFileOf(container) : null;
      if (state) put(state.out, row);
      if (collectionAddress) put(collectionAddress, row);
    }
  }
  return on;
}

const headingOrder = (a, b) => a.heading.localeCompare(b.heading, 'en', { sensitivity: 'base' });

// The props page's model, or null when the site has none (`settings` null). Groups, each { heading,
// href (null: a heading that is no page), rows }: one per container the site shows (`containers`, from
// containerItems, its rows as its own page lists them), then each other prop the site shows by its
// published `prop_group`, then by its chapter (its published `chapter` field, else the folder under
// Chapters/ it sits in, when that names a chapter page the site publishes), then `Other props`. A
// container is never a row of these (one inside a container is a row of that container). Groups run in
// the order of their first row (byArrival), ties by heading; an empty container comes last. `coverRow`: the
// row of the prop the settings' cover names (`coverNote`), when the site shows it with a page; it is in no group.
// `coverNote` stays set when it names nothing the site shows, for the build to say so.
// `rowOf(p)`: the prop's row (propRow, with the site's options); `nameOf(page, text)` as containerItems.
function collectionModel({ plan, rowOf, containers, settings, site = 'player', isShown, resolvePage = () => null, nameOf = (pg, t) => t, blocked = new Set() }) {
  if (!settings || !plan) return null;
  const groups = [];
  const inContainer = new Set();
  const coverPage = settings.coverNote ? resolvePage(settings.coverNote) : null;
  const coverProp = coverPage ? plan.props.find((p) => p.page === coverPage) : null;
  const covered = coverProp && coverProp.ships && isShown(coverProp.page) && (site === 'gm' || !isWithheld(sourceOf(coverProp.page))) ? coverProp : null;
  const coverRow = covered ? rowOf(covered) : null;
  for (const entry of containers.values()) {
    groups.push({ heading: entry.title, href: propPageOf(entry.container, blocked) || entry.container.page.outputPath, rows: covered ? entry.rows.filter((r) => r.rel !== covered.rel) : entry.rows });
    for (const r of entry.rows) inContainer.add(r.rel);
  }
  const byGroup = new Map();
  const byChapter = new Map();
  const other = [];
  const chapterOf = (p) => {
    const fm = p.page.frontmatter || {};
    const isChapter = (pg) => (pg && pg.frontmatter && pg.frontmatter.type === 'chapter' ? pg : null);
    const raw = valueText(fm.chapter).trim();
    const named = raw ? isChapter(resolvePage(canonicalNfc(parseWikiRef(raw).target))) : null;
    if (named) return named;
    const parts = String(p.rel).split('/');
    return parts.length > 2 && parts[0].toLowerCase() === 'chapters' ? isChapter(resolvePage(canonicalNfc(parts[1]))) : null;
  };
  for (const p of plan.props) {
    if (p.kind === 'container' || p === covered || inContainer.has(p.rel) || !isShown(p.page)) continue;
    if (site !== 'gm' && isWithheld(sourceOf(p.page))) continue;
    // The page's own headings group it, so the row carries no prop_group heading of its own.
    const row = { ...rowOf(p), group: null };
    const group = fieldText((p.page.frontmatter || {}).prop_group).trim();
    if (group) {
      const key = canonicalNfc(group);
      if (!byGroup.has(key)) byGroup.set(key, { heading: key, href: null, rows: [] });
      byGroup.get(key).rows.push(row);
      continue;
    }
    const chapter = chapterOf(p);
    if (chapter) {
      if (!byChapter.has(chapter.outputPath)) byChapter.set(chapter.outputPath, { heading: nameOf(chapter, chapter.displayTitle || chapter.title || ''), href: chapter.outputPath, rows: [] });
      byChapter.get(chapter.outputPath).rows.push(row);
      continue;
    }
    other.push(row);
  }
  groups.push(...byGroup.values(), ...byChapter.values());
  if (other.length) groups.push({ heading: OTHER_HEADING, href: null, rows: other });
  for (const g of groups) g.rows.sort(byArrival);
  groups.sort((a, b) => {
    if (!a.rows.length || !b.rows.length) return (b.rows.length > 0) - (a.rows.length > 0) || headingOrder(a, b);
    return byArrival(a.rows[0], b.rows[0]) || headingOrder(a, b);
  });
  return { title: settings.title, address: settings.address, cover: settings.cover, coverNote: settings.coverNote, coverRow, intro: settings.intro, groups };
}

// Every shown row of the model, once each.
function shownRows(model) {
  const seen = new Set();
  const out = [];
  for (const g of model ? model.groups : []) {
    for (const r of g.rows) {
      if (r.sealed || seen.has(r.rel)) continue;
      seen.add(r.rel);
      out.push(r);
    }
  }
  return out;
}

// Descending, a missing value (null) last.
const missingLastDesc = (x, y) => (x === y ? 0 : x === null ? 1 : y === null ? -1 : x > y ? -1 : 1);

// The newest `n` shown rows: by the number of the session each arrived in, then lastUpdated (both
// newest first, none last), then title.
function latestProps(model, n) {
  const session = (r) => (r.arrived && sessionSortKey(r.arrived.title)) || null;
  return shownRows(model).sort((a, b) => missingLastDesc(session(a), session(b))
    || missingLastDesc(a.updated || null, b.updated || null)
    || byTitle(a, b)).slice(0, Math.max(0, n));
}

module.exports = {
  containerItems, propRow, byArrival, propPageOf,
  COLLECTION_ADDRESS, COLLECTION_FALLBACK, collectionSettingsOf, hasCollection, collectionAddress, collectionModel, latestProps, shownRows,
  placeCollection, propTaken, sealedTitlesOn,
  GENERIC_PROP_FIELDS, stateFieldsOf, stateFieldsOfListed, stateItems, stateScript,
};

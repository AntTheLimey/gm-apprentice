'use strict';

// What a container prop holds, as rows a listing prints. A shown item is linked; an item the
// players have not found is, when its container asks (`show_sealed: titles`), its title alone,
// read from the frontmatter the site would publish; a withheld item is never a row. The build
// and the leak gate both ask this module, so they agree on what each listing shows.
const { publishedFrontmatter, isWithheld, parseWikiRef, publishMode } = require('../processor');
const { linkKeys } = require('../scanner');
const { sessionSortKey } = require('../templates/index-page');
const { canonicalNfc } = require('../unicode');
const { propContainerOf, showSealedOf } = require('./note');
const { bytesOf } = require('./plan');
const { fieldText } = require('./layout');

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
// Not shown: its title alone, from the published view of its frontmatter (so a hidden prop_title never
// names it), with the note's own field exceptions (`fieldOverrides`, by vault path) as its page has them.
// `unrevealed`: shown on the GM site, not on the player site. `nameOf(page, title)`: the title as this site
// prints the note's name (the GM site marks a withheld one).
function propRow(p, { isShown, excludeFields = [], fieldOverrides = {}, resolvePage = () => null, isPlayerShown = null, blocked = new Set(), site = 'player', nameOf = (pg, t) => t }) {
  const page = p.page;
  if (!isShown(page)) {
    const fm = publishedFrontmatter(sourceOf(page), excludeFields, fieldOverrides[p.rel] || {});
    const named = fm.title === undefined ? String(page.title || '').replace(/_/g, ' ') : page.displayTitle;
    return { rel: p.rel, title: fieldText(fm.prop_title).trim() || named || '', href: null, line: null, arrived: null, sealed: true, unrevealed: false };
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

module.exports = { containerItems, propRow, byArrival, propPageOf };

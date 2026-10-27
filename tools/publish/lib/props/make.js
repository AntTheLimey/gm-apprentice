'use strict';

// The make pass for props: the pages the tool makes for props that name a style, and each container's
// page, made before the note pages so a note links only a page that was made. A prop it cannot make a
// page for is added to `blocked` and to the plan's problems, which the build reports.
const { loadHands, withHand, HANDS_FILE } = require('./hands');
const { styledPage, styleFontFamilies, styledPageProblem } = require('./page');
const { containerItems, propRow, collectionModel, stateItems, stateScript } = require('./collection');
const { stateFileOf } = require('./plan');
const { layoutNames } = require('./layout');
const { containerTemplate, containerItemsHtml } = require('../templates/props-page');
const { isWithheld, withheldPlaceholder, withheldNameMarked } = require('../processor');
const fontsLib = require('../fonts');
const { orderedSessions } = require('../story-spine');

// The pages the tool makes for props that name a style, made before the note pages so a note
// links only a page that was made. A held prop's page is never made: its words would pass
// through the build. The words are the note page's own player view of `## The Text`, on the GM
// site too (the GM sees the Keeper parts on the note page). Then each container's page, which lists
// what it holds, so a row links only a page that was made; one that names a style fills its layout.
// Each container that names a state file gets it, written from the same rows.
// The styles' typefaces are served from the site, from the vault's font cache: a miss warns once.
// Returns { collectionBuilt, styleFonts, problems }: the props page's model (collectionModel), the
// typefaces the styles are served with, and the plan's problems (the same array the build reads).
function makeProps({ propPlan, propBlocked, pages, listedOnlyPages = [], linkMap, imageMap, usedImages, config, options, publishConfig, collection,
  collectionHrefFrom, navFor, gm, mark, onPlayerSite, excludeFields, fieldOverrides, coverName = 'player_site.props.cover' }) {
  let styleFonts = { css: '', files: [] };
  let collectionBuilt = null;
  if (!propPlan) return { collectionBuilt, styleFonts, problems: [] };
  const noPage = (p, problem) => {
    const row = { rel: p.rel, code: 'PROP_NOT_COPIED', severity: 'warning', detail: problem.detail, fix: problem.fix };
    propPlan.problems.push(row);
    console.warn(`  WARNING: ${row.rel}: ${row.detail} — ${row.fix}`);
    propBlocked.add(p.address);
  };
  const styled = [];
  for (const p of propPlan.props) {
    if (!p.ships || !p.address || p.made !== 'style' || p.kind === 'container' || propBlocked.has(p.address)) continue;
    const problem = styledPageProblem(p, p.page.publishedMarkdown);
    if (problem) {
      noPage(p, problem);
      continue;
    }
    styled.push(p);
  }
  const containers = propPlan.props.filter((p) => p.ships && p.address && p.kind === 'container' && p.made && !propBlocked.has(p.address));
  // A container whose style has no place for its list gets the site's own look, and the GM is told.
  for (const p of containers) {
    if (!p.style || [p.style.layout, p.style.sheet].some((t) => layoutNames(t).includes('items'))) continue;
    const row = { rel: p.rel, code: 'PROP_NOT_COPIED', severity: 'warning', detail: `the style "${p.style.name}" has no {{{items}}} place, so the container's page uses the site's own look`, fix: 'use a style made for containers, or remove prop_style from the container' };
    propPlan.problems.push(row);
    console.warn(`  WARNING: ${row.rel}: ${row.detail} — ${row.fix}`);
    p.style = null;   // so none of the style's files or typefaces ship on its account
  }
  // Each shipping prop's hand is resolved once: its fields carry the hand's font as prop_font.
  // A registry that cannot be read is raised once; an unknown hand, once per prop.
  const raise = (rel, problem) => {
    const row = { rel, code: 'PROP_NOT_COPIED', severity: 'warning', detail: problem.detail, fix: problem.fix };
    propPlan.problems.push(row);
    console.warn(`  WARNING: ${row.rel}: ${row.detail} — ${row.fix}`);
  };
  const styledProps = [...styled, ...containers.filter((p) => p.style)];
  if (styledProps.length) {
    const registry = loadHands(config.vaultPath);
    if (registry.problem) raise(HANDS_FILE, registry.problem);
    for (const p of styledProps) {
      const { fields, problem } = withHand(p.page.frontmatter || {}, registry.hands);
      p.fields = fields;
      if (problem) raise(p.rel, problem);
    }
  }
  const families = [...new Set(styledProps.flatMap((p) => styleFontFamilies(p.style, p.fields)))];
  if (families.length) {
    let warned = false;
    styleFonts = fontsLib.selfHostedFontFaces(config.vaultPath, families, () => {
      if (warned) return;
      warned = true;
      console.warn(`  WARNING: the typefaces for the prop styles are not in the vault's font cache and could not be downloaded; the styles use fallback type. ${fontsLib.missAdvice(options.offline === true)}`);
    }, { offline: options.offline === true, fontsHref: '../../fonts/' });
  }
  for (const p of styled) {
    const made = styledPage({ prop: p, style: p.style, page: p.page, fields: p.fields, linkMap, imageMap, usedImages, collectionHref: collectionHrefFrom(p.address), fontsCss: styleFonts.css !== '' });
    if (made.problem) noPage(p, made.problem);
    else p.made_html = made.html;
  }
  // What a listing shows is the note pages this site publishes; on the GM site, a row the
  // player site does not publish is marked.
  // A prop its container lists with no page of its own (previews.js listedOnly) is shown in the listings, unlinked.
  const shown = new Set([...pages, ...listedOnlyPages]);
  const hasPage = new Set(pages);
  const pageAt = new Map(pages.map((pg) => [pg.outputPath, pg]));
  const misplaced = [];
  // On the GM site a withheld note the player site does not publish is named inside the usual withheld mark.
  const nameOf = (pg, text) => (gm && isWithheld(pg.sourceFrontmatter || pg.frontmatter) && !onPlayerSite.has(pg)
    ? withheldNameMarked(text, withheldPlaceholder((pg.sourceFrontmatter || pg.frontmatter).type, publishConfig.withheld_words), mark)
    : text);
  // How every listing reads a row: the same for a container's page and the props page.
  // A row's session is placed in the campaign's play order (chapter, then session), the order the Saga and the session
  // pages' prev/next links read: a session page's title need hold no number.
  const playOrder = new Map(orderedSessions(pages).map((pg, i) => [pg, i + 1]));
  const rowOptions = {
    isShown: (pg) => shown.has(pg), excludeFields, fieldOverrides, site: gm ? 'gm' : 'player', nameOf, blocked: propBlocked,
    sessionOrder: (pg) => playOrder.get(pg) ?? null, hasPage: (pg) => hasPage.has(pg),
    resolvePage: (target) => pageAt.get(linkMap[target]) || null, isPlayerShown: gm ? (pg) => onPlayerSite.has(pg) : null,
  };
  const listed = containerItems({ props: propPlan.props, ...rowOptions, problems: misplaced });
  for (const row of misplaced) {
    propPlan.problems.push(row);
    console.warn(`  WARNING: ${row.rel}: ${row.detail} — ${row.fix}`);
  }
  // The props page lists the same rows, so a prop reads alike on every page that lists it.
  collectionBuilt = collectionModel({ plan: propPlan, containers: listed, settings: collection, ...rowOptions, rowOf: (p) => propRow(p, rowOptions) });
  if (collectionBuilt && collectionBuilt.coverNote && !collectionBuilt.coverRow) {
    console.warn(`  WARNING: ${coverName} names "${collectionBuilt.coverNote}", which is not a prop the site publishes with a page; the props page shows no cover`);
  }
  for (const p of containers) {
    const { rows, title, noteTitle } = listed.get(p.rel);
    p.made_html = p.style
      ? styledPage({ prop: p, style: p.style, page: p.page, fields: p.fields, linkMap, imageMap, usedImages, collectionHref: collectionHrefFrom(p.address), fontsCss: styleFonts.css !== '', items: containerItemsHtml(rows, p.address), names: { title, noteTitle } }).html
      : containerTemplate({ container: p, rows, address: p.address, title, noteTitle }, navFor, config, publishConfig, { linkMap, imageMap, usedImages });
  }
  // Each container's state file (prop_state): the rows its listing shows, as the script its page reads (`state_js`).
  for (const p of propPlan.props) {
    const state = stateFileOf(p);
    if (!state || !p.ships || !p.address || !listed.has(p.rel) || propBlocked.has(state.out)) continue;
    p.state_js = stateScript(state.global, stateItems(listed.get(p.rel).rows, { props: propPlan.props, site: rowOptions.site, from: state.out }));
  }

  return { collectionBuilt, styleFonts, problems: propPlan.problems };
}

module.exports = { makeProps };

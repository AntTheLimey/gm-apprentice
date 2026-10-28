const { refTarget } = require('../wikilink');
const { escapeHtml, relativePath, relativeHref, publishedSource, encodeHref } = require('../processor');
const { canonicalNfc } = require('../unicode');
const { headerMeta, headerMetaFields, pcEpithet } = require('../pc-header-meta');
const { baseShell, cssPath, rootPath, clientScripts, portraitImg, connectionsSection } = require('./base');
const { generateBreadcrumbs, renderBreadcrumbs } = require('../breadcrumbs');
const { getInitials } = require('./landing-data');
const { liveDataScript } = require('./gurps/live-data');
const { liveScriptHrefs, clientFor } = require('./live-mount');
const { getConsumedTitleMatcher, getSheetFamily } = require('./pc-registry');
const { backgroundParts, splitTitle } = require('../pc-background');
const { prologueHtml, asBlock } = require('./prologue');
const { aboveSubheadings, cellText, isPlaceholder, filled } = require('./sheet-parse');
const { sheetSourceOf } = require('../sheet-source');
const { resolveLook, isDressed } = require('../skins');
const { framedPortrait } = require('../skins/portrait');

function renderMetaSpans(fm, headerFacts) {
  return headerMeta(fm, headerFacts)
    .map(([label, value]) => `<span><span class="label">${escapeHtml(label)}</span> ${escapeHtml(String(value))}</span>`)
    .join('\n    ');
}

// The frontmatter field an identity label is read from (pc-identity.js), where it has one.
const IDENTITY_SOURCE_FIELD = { Occupation: 'occupation', Age: 'age', Points: 'point_total' };


// Sections the structured GURPS renderer consumes into the sheet/combat tabs.
// When a GURPS system sheet is present these are dropped from the accordion
// list so they don't duplicate the structured blocks. Prose/extra sections
// (Background, Notes, GM Notes, suit mods, etc.) still render as accordions.
const { GURPS_CONSUMED_TITLES, COC_CONSUMED_TITLES, EQUIPMENT_SECTION_TITLES } = require('./consumed-titles');
const { systemId, SYSTEM_NAMES } = require('../shared-lists');
const { isPlayedSession } = require('../session-hub');

// Titles the structured CoC sheet/record consume. 'connections' and 'cover
// identity' are deliberately NOT here: the structured renderer doesn't place
// them, so consuming them would silently drop the sections. Left un-consumed,
// they fall through to the Record tab's leftover-accordion guard (no content loss).

function isGurpsSystem(publishConfig) {
  return systemId((publishConfig || {}).system) === 'gurps-4e';
}

function isCocSystem(publishConfig) {
  return ['coc-7e', 'coc-7e-regency'].includes(systemId((publishConfig || {}).system));
}

// Whether a PC page is the CoC parchment folio (sheets on, CoC system). That page has no
// epithet under the masthead; every other PC page opens with one.
function usesCocFolio(publishConfig, sheetsOff) {
  return isCocSystem(publishConfig) && !sheetsOff;
}

// System label shown in the CoC masthead era line when the PC has no explicit `era`.
function cocSystemLabel(publishConfig) {
  return SYSTEM_NAMES[systemId((publishConfig || {}).system) === 'coc-7e-regency' ? 'coc-7e-regency' : 'coc-7e'];
}

// Builds the approved parchment folio body for a CoC investigator (mockup:
// docs/superpowers/specs/coc-investigator-sheet-mockup/index.html). The single
// outer .coc-sheet-root carries the engraved frame; #cr-root must live inside it
// so the parchment-scoped .cr-* rules apply.
function buildCocBody(opts) {
  const { page, fm, publishConfig, displayTitle, sheetHtml, recordHtml, statusBarHtml,
    portraitUrl, sealUrl, crWidget, equipmentContent, storyContent, journeyContent, leftoverSections, look } = opts;

  // Portrait: the sheet carries an empty <img class="portrait" data-portrait> slot.
  // Inject the resolved src, or drop the framed box entirely when absent.
  let sheet = sheetHtml || '';
  const slot = /<img class="portrait" data-portrait[^>]*>/;
  if (look && look.frame !== 'none') {
    const framed = framedPortrait({ frame: look.frame, imgUrl: portraitUrl || '', alt: displayTitle, initials: getInitials(displayTitle) });
    sheet = sheet.replace(slot, () => framed);
  } else if (portraitUrl) {
    sheet = sheet.replace(slot,
      `<img class="portrait" src="${portraitUrl}" alt="${escapeHtml(displayTitle)}">`);
  } else {
    sheet = sheet.replace(slot, '');
  }

  // Content-loss guard: every non-consumed prose section (including any authored
  // Relationships/Appearances — empty auto-stubs are already dropped upstream by
  // the sheetSections filter) is appended to the record so nothing is silently lost.
  const leftover = (leftoverSections || [])
    .map(s => `<details class="acc"><summary>${escapeHtml(s.title)}</summary><div class="acc-body">${s.html}</div></details>`)
    .join('');
  const recordBody = (recordHtml || '') + leftover;
  const recordPanel = recordBody.trim()
    ? recordBody
    : '<p class="empty-note">No record entries yet.</p>';

  // Era line: an explicit `era` frontmatter wins verbatim; otherwise the system
  // label, plus "· in the year <setting_year>" from vault config when set.
  const settingYear = (publishConfig || {}).setting_year;
  const yearSuffix = (settingYear != null && String(settingYear).trim())
    ? ` · in the year ${String(settingYear).trim()}` : '';
  const era = fm.era
    ? escapeHtml(String(fm.era))
    : escapeHtml(cocSystemLabel(publishConfig) + yearSuffix);
  const corners = '<span class="corner tl">❦</span><span class="corner tr">❦</span><span class="corner bl">❦</span><span class="corner br">❦</span>';
  const seal = sealUrl ? `<img class="seal-img" src="${sealUrl}" alt="">` : '';

  return `<div class="coc-sheet-root">
${corners}
${seal}
<div class="masthead">
  <div class="kicker">Being a true account of the investigator</div>
  <h1>${escapeHtml(displayTitle)}</h1>
  <div class="era">${era}</div>
</div>
<div class="fleuron">❧ ❦ ❧</div>
${statusBarHtml || ''}
${crWidget}
<div class="folio">
  <div class="foliotabs" role="tablist">
    <button type="button" class="foliotab active" data-target="p-sheet"><span class="t-full">Character Sheet</span><span class="t-short">Sheet</span></button>
    <button type="button" class="foliotab" data-target="p-record"><span class="t-full">Investigator's Record</span><span class="t-short">Record</span></button>
    <button type="button" class="foliotab" data-target="p-equipment"><span class="t-full">Equipment &amp; Wealth</span><span class="t-short">Gear</span></button>
    <button type="button" class="foliotab" data-target="p-story">Story</button>
    <button type="button" class="foliotab" data-target="p-journey">Journey</button>
  </div>
  <div class="foliopanel">
    <div class="tab-panel" id="p-sheet">
${sheet}
    </div>
    <div class="tab-panel" id="p-record" hidden>
${recordPanel}
    </div>
    <div class="tab-panel" id="p-equipment" hidden>
${equipmentContent}
    </div>
    <div class="tab-panel" id="p-story" hidden>
  <div class="story-prose">
    ${storyContent}
  </div>
    </div>
    <div class="tab-panel" id="p-journey" hidden>
${journeyContent}
    </div>
  </div>
</div>
</div>`;
}

// The frontmatter `equipment:` list as cards, or '' when the note has none.
function frontmatterEquipmentHtml(frontmatter) {
  if (!(Array.isArray(frontmatter.equipment) && frontmatter.equipment.length > 0)) return '';
  const items = frontmatter.equipment.map(item => {
    if (typeof item === 'string') return `<div class="entity-card"><h4>${escapeHtml(item)}</h4></div>`;
    const name = item.name || 'Unknown';
    const desc = item.description || item.notes || '';
    const weight = item.weight ? ` ${escapeHtml(String(item.weight))}` : '';
    return `<div class="entity-card"><h4>${escapeHtml(name)}${weight}</h4>${desc ? `<div class="card-excerpt">${escapeHtml(desc)}</div>` : ''}</div>`;
  });
  return `<div class="card-grid">${items.join('\n')}</div>`;
}

function extractEquipment(frontmatter, sections) {
  const list = frontmatterEquipmentHtml(frontmatter);
  if (list) return list;

  const equipmentSections = sections.filter(s => EQUIPMENT_SECTION_TITLES.has(s.title.toLowerCase()));
  if (equipmentSections.length > 0) {
    return equipmentSections.map(s => `<h3>${escapeHtml(s.title)}</h3>\n${s.html}`).join('\n');
  }

  return '<p class="text-muted">No equipment data available.</p>';
}

// A sheet that draws `## Equipment` itself still owes the page every other
// equipment-titled section and the frontmatter list: the Equipment tab is the
// only place they go, so they follow the sheet's own equipment, as written.
function unconsumedEquipment(frontmatter, sections, consumes) {
  const rest = sections
    .filter(s => EQUIPMENT_SECTION_TITLES.has(s.title.toLowerCase()) && !consumes(s.title))
    .map(s => `<h3>${escapeHtml(s.title)}</h3>\n${s.html}`);
  return [frontmatterEquipmentHtml(frontmatter), ...rest].filter(Boolean).join('\n');
}

function buildRouteMap(page, pages) {
  const storyPages = (pages || [])
    .filter(p => isPlayedSession(p.frontmatter))
    .sort((a, b) => (a.frontmatter.session_number || 0) - (b.frontmatter.session_number || 0));

  const locations = [];
  const seen = new Set();
  for (const session of storyPages) {
    const loc = session.frontmatter.location;
    if (loc) {
      // NFC (#139): a Set keyed on an author-typed ref, so two spellings of one location
      // would list it twice in the route map instead of deduping.
      const locTitle = canonicalNfc(refTarget(loc));
      if (!seen.has(locTitle) || locations[locations.length - 1] !== locTitle) {
        locations.push(locTitle);
        seen.add(locTitle);
      }
    }
  }

  if (locations.length < 2) return '';

  const spacing = 120;
  const width = (locations.length - 1) * spacing + 80;
  const height = 80;
  const y = 40;

  let svg = `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" style="font-family:var(--font-body,system-ui)">`;
  svg += `<line x1="40" y1="${y}" x2="${40 + (locations.length - 1) * spacing}" y2="${y}" stroke="var(--border,#30363d)" stroke-width="2"/>`;
  locations.forEach((loc, i) => {
    const x = 40 + i * spacing;
    const display = loc.replace(/_/g, ' ');
    const label = display.length > 12 ? display.slice(0, 10) + '…' : display;
    svg += `<circle cx="${x}" cy="${y}" r="6" fill="var(--accent,#58a6ff)" stroke="var(--bg,#1a1f25)" stroke-width="2"/>`;
    svg += `<text x="${x}" y="${y + 22}" text-anchor="middle" font-size="10" fill="var(--text,#c9d1d9)">${escapeHtml(label)}</text>`;
  });
  svg += '</svg>';
  return `<div class="route-map" style="margin-bottom:2rem"><h3>Campaign Route</h3>${svg}</div>`;
}

const ALL_TABS = ['sheet', 'combat', 'spells', 'equipment', 'story', 'journey'];

// The tab ids the inline script answers to. Spells joins only when a system
// supplies it, so a page without one keeps the list it always had.
function pageTabs(hasSpells, sheetsOff) {
  return ALL_TABS.filter(t => !(
    (t === 'spells' && !hasSpells)
    || (sheetsOff && (t === 'combat' || t === 'equipment' || t === 'spells'))));
}

function tabScript(tabs = ALL_TABS) {
  return `
<script>
function switchTab(tab) {
  document.querySelectorAll('.pc-tab').forEach(function(t) { t.classList.remove('active'); });
  document.querySelectorAll('.tab-panel').forEach(function(p) { p.classList.remove('active'); });
  document.getElementById('tab-' + tab).classList.add('active');
  document.querySelector('[data-tab="' + tab + '"]').classList.add('active');
  history.replaceState(null, '', '#' + tab);
}
function openAccordion(id) {
  var el = document.getElementById(id);
  if (el && el.classList.contains('accordion')) {
    el.classList.add('open');
    var btn = el.querySelector('.accordion-header');
    if (btn) btn.setAttribute('aria-expanded', 'true');
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
document.addEventListener('click', function(e) {
  var link = e.target.closest('.section-nav a');
  if (link) {
    e.preventDefault();
    var id = link.getAttribute('href').slice(1);
    openAccordion(id);
  }
});
(function() {
  var hash = location.hash.slice(1);
  if ([${tabs.map(t => `'${t}'`).join(', ')}].includes(hash)) switchTab(hash);
  else if (hash) openAccordion(hash);
})();
</script>`;
}

// --- Story tab (not the CoC folio, #483) ---

// A root-relative address (`story/characters/x.html#session-2`) as an href from this page.
function hrefFrom(page, address) {
  const text = String(address);
  const cut = text.indexOf('#');
  const target = cut < 0 ? text : text.slice(0, cut);
  return encodeHref(relativeHref(page.outputPath, target)) + (cut < 0 ? '' : escapeHtml(text.slice(cut)));
}

// The Story tab: the backstory as a prologue, how they look, what drives them, the story so far.
// `parts` is backgroundParts' answer (null: none); `lines` the story page's session lines.
function storyTabHtml(page, parts, { portraitUrl, storyHref, storyLines, storyHtml }) {
  const name = escapeHtml(page.displayTitle);
  const blocks = [];
  if (parts && parts.backstoryHtml) {
    blocks.push(prologueHtml(page.displayTitle, parts.backstoryHtml));
  }
  if (parts && (parts.appearanceHtml || parts.facts.length)) {
    const portrait = portraitUrl
      ? `<img class="pc-look-portrait" src="${portraitUrl}" alt="${name}">`
      : `<div class="pc-look-portrait pc-look-initials" aria-hidden="true">${escapeHtml(getInitials(page.displayTitle))}</div>`;
    const facts = parts.facts.length
      ? `\n    <ul class="pc-facts">${parts.facts.map(f => `<li><span class="label">${escapeHtml(f.label)}</span> ${escapeHtml(f.value)}</li>`).join('')}</ul>`
      : '';
    blocks.push(`<section class="pc-story-box pc-look">
  <h3 class="pc-story-label">How they look</h3>
  <div class="pc-look-grid">
    ${portrait}
    <div class="pc-look-text">
${parts.appearanceHtml ? asBlock(parts.appearanceHtml) : ''}${facts}
    </div>
  </div>
</section>`);
  }
  if (parts && parts.personality.length) {
    blocks.push(`<section class="pc-story-box pc-drives">
  <h3 class="pc-story-label">What drives them</h3>
  <div class="pc-drives-grid">
${parts.personality.map(p => `    <div class="pc-drive"><h4>${escapeHtml(p.label)}</h4><p>${p.html}</p></div>`).join('\n')}
  </div>
</section>`);
  }
  const lines = Array.isArray(storyLines) ? storyLines : [];
  if (lines.length || storyHref) {
    const list = lines.length ? `\n  <h3 class="pc-story-label">The story so far</h3>
  <ol>
${lines.map(l => `    <li><span class="pc-sofar-when">Session ${escapeHtml(String(l.n))}</span><a class="pc-sofar-what" href="${hrefFrom(page, l.href)}"><b>${escapeHtml(l.title || '')} &rarr;</b>${escapeHtml(l.line || '')}</a></li>`).join('\n')}
  </ol>` : '';
    const link = storyHref
      ? `\n  <p class="pc-sofar-more"><a class="story-read-link" href="${hrefFrom(page, storyHref)}">Every session in full &rarr;</a></p>`
      : '';
    blocks.push(`<section class="pc-story-box pc-sofar">${list}${link}
</section>`);
  } else if (storyHtml) {
    // A caller with the story's text and no page of its own for it (the build always has a page).
    blocks.push(`<div class="story-prose">\n${storyHtml}\n</div>`);
  }
  return blocks.length ? blocks.join('\n') : `<p class="text-muted pc-story-none">${name}'s story starts at the table.</p>`;
}

const TEASER_CHARS = 280;

// The sheet tab's teaser, and a way to the Story tab. With a `hook` the pull quote says
// something else, so the teaser opens the backstory (its first sentence). Without one the
// pull quote is that first sentence: the teaser goes on from it, cut at a word near
// TEASER_CHARS, and a one-sentence backstory has no teaser.
function storyTeaserHtml(parts, hasHook) {
  if (!parts || !parts.backstoryHtml || !parts.firstSentence) return '';
  let text = parts.firstSentence;
  if (!hasHook) {
    const flat = cellText(splitTitle(asBlock(parts.backstoryHtml)).proseHtml.replace(/<\/(p|li|blockquote)>/gi, ' ')).replace(/\s+/g, ' ').trim();
    const said = parts.firstSentence.replace(/…$/, '');
    const after = flat.startsWith(said) ? flat.slice(said.length).trim() : '';
    if (!after) return '';
    if (after.length <= TEASER_CHARS) text = after;
    else {
      const room = after.slice(0, TEASER_CHARS - 1);
      const space = room.lastIndexOf(' ');
      text = `${(space > 0 ? room.slice(0, space) : room).replace(/[\s,;:.!?-]+$/, '')}…`;
    }
  }
  return `<section class="pc-backstory-teaser">
  <div>
    <p class="pc-backstory-teaser-label">From the backstory</p>
    <p class="pc-backstory-teaser-text">${escapeHtml(text)}</p>
  </div>
  <a href="#story" onclick="switchTab('story'); return false;">Read on &rarr;</a>
</section>`;
}

// Bold-field labels a header already shows, per sheet family (the D&D and PF2e sheet headers).
// Any other family's header shows none of them: all its Background lines go to the rest block.
const HEADER_LABELS = {
  dnd: [/^Class(?:es)?(?:\s*\/\s*Subclass(?:es)?)?$/i, /^(?:Species|Race)$/i, /^Background$/i],
  pf2e: [/^Class(?:es)?(?:\s*\/\s*Subclass(?:es)?)?$/i, /^Ancestry$/i, /^Heritage$/i, /^Background$/i],
};
// The identity strip's labels (pc-identity.js), as the bold-field labels they read.
const IDENTITY_LABELS = {
  Class: HEADER_LABELS.dnd[0], Species: HEADER_LABELS.dnd[1], Background: /^Background$/i,
  Ancestry: /^Ancestry$/i, Heritage: /^Heritage$/i, Vice: /^Vice(?:\/Purveyor)?$/i,
};
// The story's own fields, which the Story tab shows.
const STORY_LABELS = [/^Backstory\s*&\s*Personality$/i, /^Appearance$/i];

// The Background sub-sections the Story tab reads.
const STORY_SUBSECTIONS = new Set(['backstory', 'appearance', 'personality']);

// What the Background section holds besides its story once it is no accordion: the lines
// above its sub-headings that neither the Story tab nor the page header shows, and every
// sub-section the Story tab does not read (`### Allies`), heading and all. '' when none.
function backgroundRest(section, shown) {
  const drop = [...STORY_LABELS, ...shown];
  const rest = aboveSubheadings(section.html).replace(/<p>([\s\S]*?)<\/p>\s*/gi, (p, inner) => {
    const m = inner.match(/^\s*<strong>\s*([^<:]+?)\s*(?::\s*<\/strong>|<\/strong>\s*:)([\s\S]*)$/i);
    if (m && (drop.some(re => re.test(cellText(m[1]))) || !filled(cellText(m[2])) || /^\s*[–—-]\s*$/.test(cellText(m[2])))) return '';
    return isPlaceholder(cellText(inner)) || !cellText(inner) ? '' : p;
  }).trim();
  const others = [];
  const re = /(<h3[^>]*>([\s\S]*?)<\/h3>)([\s\S]*?)(?=<h3[ >]|$)/gi;
  let m;
  while ((m = re.exec(section.html || '')) !== null) {
    if (!STORY_SUBSECTIONS.has(cellText(m[2]).toLowerCase())) others.push(`${m[1]}${m[3]}`.trim());
  }
  const all = [rest, ...others].filter(Boolean).join('\n');
  return all ? `<section class="pc-background-rest">\n${all}\n</section>` : '';
}

function pcTemplate(page, processedContent, sections, navFor, config, imageMap, storyHtml, context) {
  const fm = page.frontmatter;
  const publishConfig = (context || {}).publishConfig || {};
  const pages = (context || {}).pages || [];
  const live = publishConfig.live || {};
  const showInbox = live.inbox === true;
  // Character sheets off (decided once, by the build, from the same list the section filter uses):
  // no sheet content of any kind reaches the page, whatever else the caller passed.
  const sheetsOff = (context || {}).sheetsOff === true;
  const showStatusBar = live.stats === true && !sheetsOff;
  const look = resolveLook(fm, publishConfig.sheetLook);
  if (context && context.onLook) context.onLook(look, page);
  const dressed = isDressed(look) ? {
    mainAttrs: ` data-skin="${look.skin}"`,
    extraCss: [cssPath(page.outputPath).replace('style.css', 'skins.css')],
  } : {};

  const crumbs = generateBreadcrumbs(page.outputPath, { page });
  const breadcrumbsHtml = renderBreadcrumbs(crumbs);

  // --- Cinematic Hero Banner ---
  const hasPortrait = fm.portrait && imageMap && imageMap[String(fm.portrait).split('/').pop()];
  const metaSpans = renderMetaSpans(fm, publishConfig.header_facts);

  let imgUrl = '';
  if (hasPortrait) {
    const imgTag = portraitImg(fm, page.outputPath, imageMap || {});
    const imgMatch = (imgTag || '').match(/src="([^"]+)"/);
    imgUrl = imgMatch ? imgMatch[1] : '';
  }
  const framed = look.frame === 'none' ? '' : framedPortrait({
    frame: look.frame, imgUrl: hasPortrait ? imgUrl : '', alt: page.displayTitle, initials: getInitials(page.displayTitle),
  });

  let heroBanner;
  if (framed) {
    heroBanner = `<div class="hero-cinematic hero-cinematic-framed">
  ${framed}
  <div class="hero-cinematic-overlay">
    <h1>${escapeHtml(page.displayTitle)}</h1>
    <div class="meta">
      <span><span class="label">Player</span> ${escapeHtml(fm.player_name || '')}</span>
      ${metaSpans}
      <span><span class="label">Status</span> ${escapeHtml(fm.status || 'active')}</span>
    </div>
  </div>
</div>`;
  } else if (hasPortrait) {
    heroBanner = `<div class="hero-cinematic">
  <img class="hero-cinematic-img" src="${imgUrl}" alt="${escapeHtml(page.displayTitle)}">
  <div class="hero-cinematic-overlay">
    <h1>${escapeHtml(page.displayTitle)}</h1>
    <div class="meta">
      <span><span class="label">Player</span> ${escapeHtml(fm.player_name || '')}</span>
      ${metaSpans}
      <span><span class="label">Status</span> ${escapeHtml(fm.status || 'active')}</span>
    </div>
  </div>
</div>`;
  } else {
    const initials = getInitials(page.displayTitle);
    heroBanner = `<div class="hero-cinematic hero-cinematic-no-img">
  <div class="pc-portrait" style="width:5rem;height:5rem;font-size:2rem;margin-bottom:1rem">${escapeHtml(initials)}</div>
  <h1>${escapeHtml(page.displayTitle)}</h1>
  <div class="meta">
    <span><span class="label">Player</span> ${escapeHtml(fm.player_name || '')}</span>
    ${metaSpans}
    <span><span class="label">Status</span> ${escapeHtml(fm.status || 'active')}</span>
  </div>
</div>`;
  }

  // Read system HTML before filtering so the filter can react to what was actually rendered.
  const fromSystem = (key) => (sheetsOff ? null : ((context || {})[key] || null));
  const systemHtml = fromSystem('systemSheetHtml');
  const systemCombatHtml = fromSystem('systemCombatHtml');
  const systemEquipmentHtml = fromSystem('systemEquipmentHtml');
  const systemSpellsHtml = fromSystem('systemSpellsHtml');
  const systemVitalsHtml = fromSystem('systemVitalsHtml');
  const systemLiveData = fromSystem('systemLiveData');
  const systemTohitData = fromSystem('systemTohitData');
  const systemStatusPanelHtml = fromSystem('systemStatusPanelHtml');
  const systemRecordHtml = fromSystem('systemRecordHtml');
  const systemStatusBarHtml = fromSystem('systemStatusBarHtml');

  // --- Character Epithet ---
  // key_traits when the PC has any, otherwise the first sentence of the body's
  // prose. A sheet's body opens with stat tables, label lines and tick-boxes; the
  // excerpt drops them, so the quote is never "Playbook: Cutter Insight Prowess Resolve…".
  // One taken from the backstory steps aside on the Story tab, which opens on that sentence.
  let epithet = '';
  const quote = pcEpithet(page);
  if (quote.text) {
    const cls = quote.from === 'backstory' ? 'pull-quote pull-quote-backstory' : 'pull-quote';
    epithet = `<div class="${cls}">${escapeHtml(quote.text)}</div>`;
  }

  // Status-bar tier off ⇒ no live vitals UI anywhere. Null out every live input
  // so the existing null-guards below omit the panel, island, and client scripts.
  const liveOn = showStatusBar;
  const liveData = liveOn ? systemLiveData : null;
  const statusPanel = liveOn ? systemStatusPanelHtml : null;
  const statusBar = liveOn ? systemStatusBarHtml : null;
  // The to-hit calculator does not depend on live stats. Its container and data block ride inside
  // the Combat tab's HTML (see buildCombat), so it needs a Combat tab to be on the page.
  const tohitOn = !!systemTohitData && !!systemCombatHtml;

  // Combat-only consumed titles: only suppress when combat HTML is present.
  const GURPS_COMBAT_TITLES = new Set(['combat action chains', 'multi-action combat skill chains', 'combat summary']);

  // --- Sheet Tab ---
  const emptyRelPattern = /^\s*(<p><strong>Outgoing:<\/strong><\/p>\s*<p><strong>Incoming:<\/strong><\/p>)?\s*$/;
  const emptyAppearPattern = /^\s*(<p><em>Scenes and sessions where .+ appears\.<\/em><\/p>)?\s*$/;

  const gurpsSheet = isGurpsSystem(publishConfig);
  const cocSheet = isCocSystem(publishConfig);
  // D&D, PF2e and FitD: the sheet's own module says which sections it rendered
  // in full, so one matcher decides both what it reads and what leaves this list.
  const sheetConsumes = getConsumedTitleMatcher(publishConfig.system);
  // The background parts (Background's Backstory, Appearance, Personality, or its older one-line
  // fields) go to the Story tab, and Background is then no accordion (the CoC folio keeps its own).
  const cocFolio = usesCocFolio(publishConfig, sheetsOff);
  const parts = cocFolio ? null : backgroundParts(sections);
  const backgroundSection = parts ? sections.find(s => s.id === 'background') : null;
  const sheetSections = sections.filter(s => {
    if (s === backgroundSection) return false;
    const lower = s.title.toLowerCase();
    // With sheets off there is no Equipment tab to take these, and the keep-list already chose them.
    if (!sheetsOff && EQUIPMENT_SECTION_TITLES.has(lower)) return false;
    if (gurpsSheet && systemHtml && GURPS_CONSUMED_TITLES.has(lower) && !GURPS_COMBAT_TITLES.has(lower)) return false;
    if (gurpsSheet && systemCombatHtml && GURPS_COMBAT_TITLES.has(lower)) return false;
    if (cocSheet && (systemHtml || systemRecordHtml) && COC_CONSUMED_TITLES.has(lower)) return false;
    if (sheetConsumes && systemHtml && sheetConsumes(s.title)) return false;
    if (lower === 'relationships' && emptyRelPattern.test(s.html.trim())) return false;
    if (lower === 'appearances' && emptyAppearPattern.test(s.html.trim())) return false;
    return true;
  });

  const sectionNav = sheetSections.length > 0
    ? `<nav class="section-nav" aria-label="Sheet sections">${sheetSections.map(s => `<a href="#${s.id}">${escapeHtml(s.title)}</a>`).join('\n')}</nav>`
    : '';

  // Background's other lines, less what the header shows: the sheet's header (sheets on) or the identity strip (off).
  const family = getSheetFamily(publishConfig.system);
  const shownLabels = sheetsOff
    ? ((context || {}).identity || []).map(([label]) => IDENTITY_LABELS[label]).filter(Boolean)
    : (systemHtml && HEADER_LABELS[family]) || [];
  const restHtml = backgroundSection ? backgroundRest(backgroundSection, shownLabels) : '';
  const teaser = storyTeaserHtml(parts, typeof fm.hook === 'string' && fm.hook.trim() !== '');
  const lead = teaser ? `${teaser}\n` : '';
  const rest = restHtml ? `${restHtml}\n` : '';

  const accordions = sheetSections.map(s => `
<div class="accordion" id="${s.id}">
  <button class="accordion-header" aria-expanded="false" onclick="const o=this.parentElement.classList.toggle('open');this.setAttribute('aria-expanded',o)">${escapeHtml(s.title)}</button>
  <div class="accordion-body">
    ${s.html}
  </div>
</div>`).join('\n');

  let sheetContent;
  if (sheetsOff) {
    // Who the character is, then the line saying why there is no sheet; the kept prose follows.
    // A fact the header's meta badges already show is not said twice.
    const headerFields = new Set(headerMetaFields(fm, publishConfig.header_facts)
      .filter(field => fm[field] != null && fm[field] !== ''));
    // ... but only when the header shows the same value the strip would: a header that shows
    // a raw "ca. 150" leaves the strip's valid total (from the Points Summary) in place.
    const inHeader = (label, value) => {
      const field = IDENTITY_SOURCE_FIELD[label];
      return headerFields.has(field) && String(fm[field]).trim() === value;
    };
    const pairs = ((context || {}).identity || []).filter(([label, value]) => !inHeader(label, value));
    const strip = pairs.length
      ? `<div class="pc-identity">\n${pairs.map(([label, value]) => `<span><span class="label">${escapeHtml(label)}</span> ${escapeHtml(value)}</span>`).join('\n')}\n</div>\n`
      : '';
    const metaFields = headerMetaFields(fm, publishConfig.header_facts);
    const kept = metaFields.includes('sheet_source') ? sheetSourceOf(fm) : '';
    const keptLine = kept ? ` This sheet is kept: ${escapeHtml(kept)}.` : '';
    sheetContent = `${lead}${strip}<p class="sheet-withheld">Character sheets aren't published for this campaign.${keptLine}</p>\n${rest}${sectionNav}\n${accordions}`;
  } else if (systemHtml) {
    const liveClient = liveData ? clientFor(publishConfig.system) : null;
    const island = liveClient ? '\n' + liveDataScript(liveData, liveClient.domId) : '';
    sheetContent = `${lead}${systemHtml}\n${rest}${sectionNav}\n${accordions}${island}`;
  } else {
    sheetContent = `${lead}${rest}${sectionNav}\n${accordions}`;
  }

  // --- Equipment Tab ---
  let equipmentContent;
  if (sheetsOff) equipmentContent = '';
  else if (systemEquipmentHtml && sheetConsumes && sheetConsumes('Equipment')) {
    equipmentContent = [systemEquipmentHtml, unconsumedEquipment(fm, sections, sheetConsumes)].filter(Boolean).join('\n');
  } else equipmentContent = systemEquipmentHtml || extractEquipment(fm, sections);

  // --- Story Tab ---
  const opts = context || {};
  // The CoC folio's Story tab (#483 brings it the prologue).
  const cocStoryContent = opts.storyHref
    ? `<a class="story-read-link" href="${encodeHref(relativeHref(page.outputPath, opts.storyHref))}">Read ${escapeHtml(page.displayTitle)}'s story &rarr;</a>`
    : (storyHtml || '<p class="text-muted">No story content available.</p>');
  const storyContent = cocFolio ? '' : storyTabHtml(page, parts, {
    portraitUrl: hasPortrait ? imgUrl : '', storyHref: opts.storyHref, storyLines: opts.storyLines, storyHtml,
  });

  // --- Journey Tab ---
  const routeMap = buildRouteMap(page, pages);
  const timelineStrip = opts.timelineStrip || '';
  const timelineSection = timelineStrip
    ? `<h2>Timeline</h2>\n<div class="timeline-strip">${timelineStrip}</div>\n<a class="recap-link" href="${encodeHref(relativeHref(page.outputPath, 'timeline.html'))}">Full timeline &rarr;</a>`
    : '';
  const graphSection = connectionsSection(page, publishConfig);
  const journeyContent = [routeMap, timelineSection, graphSection].filter(Boolean).join('\n') || '<p class="text-muted">Journey data builds as the campaign progresses.</p>';

  // --- Combat Tab (system-provided, optional) ---
  const combatTabButton = systemCombatHtml
    ? `\n  <button class="pc-tab" data-tab="combat" onclick="switchTab('combat')">Combat</button>` : '';
  const combatPanel = systemCombatHtml
    ? `\n<div class="tab-panel" id="tab-combat">\n${systemCombatHtml}\n</div>` : '';

  // --- Spells Tab (system-provided, optional) ---
  const spellsTabButton = systemSpellsHtml
    ? `\n  <button class="pc-tab" data-tab="spells" onclick="switchTab('spells')">Spells</button>` : '';
  const spellsPanel = systemSpellsHtml
    ? `\n<div class="tab-panel" id="tab-spells">\n${systemSpellsHtml}\n</div>` : '';

  // --- Equipment Tab (none without a sheet) ---
  const equipmentTabButton = sheetsOff ? ''
    : `\n  <button class="pc-tab" data-tab="equipment" onclick="switchTab('equipment')">Equipment</button>`;
  const equipmentPanel = sheetsOff ? ''
    : `\n<div class="tab-panel" id="tab-equipment">\n${equipmentContent}\n</div>`;

  // --- Assemble ---
  // NFC at the boundary, not because this is a path (it isn't — see unicode.js on
  // why emitted paths stay byte-exact) but because the browser posts this value
  // back as the inbox entry's `character`, where it is matched against vault note
  // names. A decomposed name would survive into that runtime comparison and miss.
  const crWidget = showInbox
    ? `<div id="cr-root" data-character="${escapeHtml(canonicalNfc(page.frontmatter.name || page.displayTitle || page.title || ''))}"${sheetsOff ? ' data-sheets="off"' : ''}></div>`
    : '';

  // --- CoC parchment folio (branch off the generic assembly) ---
  if (cocFolio) {
    const portraitUrl = hasPortrait
      ? (((portraitImg(fm, page.outputPath, imageMap || {}) || '').match(/src="([^"]+)"/) || [])[1] || '')
      : '';
    const crestKey = publishConfig.sheet_crest;
    const sealUrl = crestKey
      ? (((portraitImg({ portrait: crestKey }, page.outputPath, imageMap || {}) || '').match(/src="([^"]+)"/) || [])[1] || '')
      : '';
    const cocLiveClient = liveData ? clientFor(publishConfig.system) : null;
    const cocIsland = cocLiveClient ? '\n' + liveDataScript(liveData, cocLiveClient.domId) : '';
    const cocBody = buildCocBody({
      page, fm, publishConfig,
      displayTitle: page.displayTitle,
      sheetHtml: systemHtml,
      recordHtml: systemRecordHtml,
      statusBarHtml: statusBar,
      portraitUrl, sealUrl, crWidget, look,
      equipmentContent, storyContent: cocStoryContent, journeyContent,
      leftoverSections: sheetSections,
    }) + cocIsland;
    return baseShell({
      pageType: page.frontmatter.type,
      title: page.displayTitle,
      siteTitle: config.siteTitle,
      cssHref: cssPath(page.outputPath),
      navHtml: navFor(page.outputPath, config),
      rootHref: rootPath(page.outputPath),
      content: cocBody,
      footer: config.footer,
      genrePreset: publishConfig._genrePreset,
      overridesCss: publishConfig._overridesCss,
      ...dressed,
      breadcrumbsHtml,
      scripts: [
        ...clientScripts(page.outputPath),
        ...(showInbox ? [rootPath(page.outputPath) + 'js/change-request.js'] : []),
        rootPath(page.outputPath) + 'js/coc-sheet.js',
        ...(liveOn ? liveScriptHrefs(rootPath(page.outputPath), publishConfig.system) : []),
      ],
    });
  }

  const body = `${crWidget}
${heroBanner}
${epithet}
${statusPanel ? statusPanel + '\n' : ''}${systemVitalsHtml ? systemVitalsHtml + '\n' : ''}<div class="tab-bar">
  <button class="pc-tab active" data-tab="sheet" onclick="switchTab('sheet')">${sheetsOff ? 'Character' : 'Character Sheet'}</button>${combatTabButton}${spellsTabButton}${equipmentTabButton}
  <button class="pc-tab" data-tab="story" onclick="switchTab('story')">Story</button>
  <button class="pc-tab" data-tab="journey" onclick="switchTab('journey')">Journey</button>
</div>
<div class="tab-panel active" id="tab-sheet">
${sheetContent}
</div>${combatPanel}${spellsPanel}${equipmentPanel}
<div class="tab-panel" id="tab-story">
${storyContent}
</div>
<div class="tab-panel" id="tab-journey">
${journeyContent}
</div>
${tabScript(pageTabs(systemSpellsHtml, sheetsOff))}`;

  return baseShell({
    pageType: page.frontmatter.type,
    title: page.displayTitle,
    siteTitle: config.siteTitle,
    cssHref: cssPath(page.outputPath),
    navHtml: navFor(page.outputPath, config),
    rootHref: rootPath(page.outputPath),
    content: body,
    footer: config.footer,
    genrePreset: publishConfig._genrePreset,
    overridesCss: publishConfig._overridesCss,
    ...dressed,
    breadcrumbsHtml,
    scripts: [
      ...clientScripts(page.outputPath),
      ...(showInbox ? [rootPath(page.outputPath) + 'js/change-request.js'] : []),
      ...(liveOn ? liveScriptHrefs(rootPath(page.outputPath), publishConfig.system) : []),
      ...(tohitOn ? [rootPath(page.outputPath) + 'js/gurps-tohit.js'] : []),
    ],
  });
}

module.exports = { pageTabs, pcTemplate, usesCocFolio };

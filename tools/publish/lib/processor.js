const { createRenderer } = require('./markdown');
const { canonicalNfc } = require('./unicode');
const { SWITCH_WORDS } = require('./settings/types');
const { gluedBefore } = require('./frontmatter');
const { markerRe: markerPattern } = require('./markers');
const { blockLines, sanitize, marksAtHeadings } = require('./gm-marks');
const { bareSectionTitle } = require('./pc-prose');
const { wikilinkRe, parseWikilink, labelsForLinks, labelsForLinksFully } = require('./wikilink');
const { headingKey, headingKeys, squashedKeys, titleNamedIn } = require('./heading-key');
const md = createRenderer();

function renderMarkdown(markdown) {
  return md.render(markdown);
}

// A frontmatter Date (an unquoted `2026-07-02`) as the date the GM wrote: YAML reads it as
// UTC midnight, so its UTC day is the written one (String() would print a long machine
// string a day early in a western timezone).
function dateText(date) {
  return isNaN(date) ? '' : date.toISOString().slice(0, 10);
}

// What a header prints for a frontmatter value.
function valueText(value) {
  if (value instanceof Date) return dateText(value);
  return String(value == null ? '' : value);
}

// Every piece of a note's text a template prints goes through here, so this is also where
// a labelled link left in it (a field printed whole) is reduced to its label: the target of
// `[[Vesper_Hale|the stranger]]` is never printed (wikilink.js labelsForLinksFully, which also unpicks a link nested in a label).
function escapeHtml(str) {
  return labelsForLinksFully(str instanceof Date ? dateText(str) : String(str || ''))
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Turn a wiki-link slug/target into human-readable display text (underscores → spaces).
// Used wherever a raw entity name would otherwise show, e.g. Lord_Edric_Fenwick.
function humanizeName(s) {
  return String(s == null ? '' : s).replace(/_/g, ' ');
}

// The label for a `[[wikilink]]` target given no alias. A file name can't hold a `/`, so
// one inside the brackets makes it an Obsidian path link (`[[Locations/Drageby]]`), shown
// by the note's name. Only for link targets: a plain value keeps its slashes.
function wikiTargetLabel(target) {
  return humanizeName(String(target == null ? '' : target).split('/').pop());
}

// Parse a wiki ref (`[[Target]]` or `[[Target|Alias]]`, brackets optional) into the raw
// lookup target and a display label. The target keeps its underscores so it still matches
// linkMap keys; the label is the explicit alias if given, otherwise the humanized target.
function parseWikiRef(raw) {
  const str = String(raw == null ? '' : raw);
  const bracketed = /\[\[[^\]]*\]\]/.test(str);
  const inner = str.replace(/\[\[|\]\]/g, '').trim();
  if (!inner) return { target: '', label: '' };
  const w = parseWikilink(inner);
  const label = w.display.trim();
  // The target is the name the link map is asked for: no `#heading`, `^block` or `.md`.
  const target = w.name.trim();
  if (!label) {
    return { target, label: bracketed ? wikiTargetLabel(target) : humanizeName(target) };
  }
  return { target, label };
}

function relativePath(fromDir, toPath) {
  if (!fromDir) return toPath;
  const fromParts = fromDir.split('/').filter(Boolean);
  const toParts = toPath.split('/').filter(Boolean);
  let common = 0;
  while (common < fromParts.length && common < toParts.length && fromParts[common] === toParts[common]) {
    common++;
  }
  const ups = fromParts.length - common;
  const result = '../'.repeat(ups) + toParts.slice(common).join('/');
  return result || toPath;
}

// Relative href between two OUTPUT FILE paths. relativePath() expects a directory as its
// base, so callers that have a page's file path must strip the filename first — passing the
// file directly counts the filename as a directory level and emits one extra `../` (B3).
function relativeHref(fromOutputPath, toOutputPath) {
  const i = String(fromOutputPath).lastIndexOf('/');
  const fromDir = i === -1 ? '' : fromOutputPath.slice(0, i);
  return relativePath(fromDir, toOutputPath);
}

function resolveWikiLinks(markdown, linkMap, currentOutputPath) {
  // The leading `!` of a non-image transclusion (`![[Backstory]]`) is consumed and dropped,
  // degrading it to an ordinary link. Leaving it would pair with the `[text](path)` emitted
  // below into `![text](path)` — an <img> whose src points at an HTML page. Image embeds
  // resolve earlier, in resolveImageEmbeds, so nothing reaching here should stay an image.
  return markdown.replace(wikilinkRe('g', true), (match, body) => {
    const parsed = parseWikilink(body);
    const { raw, display: displayText } = parsed;
    // The map is asked for the name alone: a `#heading`, `^block` or `.md` on the link does
    // not change which page it is. (The site has no heading anchors to jump to, so the link
    // goes to the page.) A name only a literal spelling matches still does.
    const target = linkMap[raw] ? raw : parsed.name;
    // Without an explicit |alias, humanize the slug (Lord_Edric_Fenwick → Lord Edric
    // Fenwick) so neither resolved link text nor unresolved plain text shows raw underscores.
    const targetPath = linkMap[target];
    const display = displayText || wikiTargetLabel(targetPath ? target : raw);
    if (!targetPath) return display;
    const currentDir = currentOutputPath.substring(0, currentOutputPath.lastIndexOf('/'));
    // A raw space (or other unsafe char) in the destination is not valid markdown link
    // syntax — markdown-it falls back to literal `[text](path)` text, and the typographer
    // then mangles a leading `../` into `…/`. Encode it into a real link destination (B7 / #145).
    const relative = encodeHref(relativePath(currentDir, targetPath));
    return `[${display}](${relative})`;
  });
}

// A handout's own analysis, written as top-level headings beside the handout
// text rather than under `## GM Notes` (#280): the handout workflow used to ask
// for Prop Notes as its own section, and handouts grew Context and Clues
// Embedded the same way. On a `type: document` page these are Keeper-facing by
// construction, so they are withheld whatever exclude_sections says — as `##`
// sections only: a `### Delivery` inside `## The Text` is part of the handout.
// `Clues` is a prefix: "Clues, if Katherine walks the servants' course" is the
// same section. A GM who wants one of these on the site renames the heading.
const DOCUMENT_KEEPER_SECTION_RE = /^(context|clues\b.*|(physical )?prop notes|delivery( notes)?)$/i;
// The same names with their spacing taken out, for a title that carries an invisible
// character (heading-key.js squashedKeys).
const DOCUMENT_KEEPER_SQUASHED_RE = /^(context|clues.*|(physical)?propnotes|delivery(notes)?)$/i;

// `handout` is the alias index_build.py accepts for `document`.
function isDocumentPage(frontmatter) {
  const type = frontmatter ? String(frontmatter.type || '').trim().toLowerCase() : '';
  return type === 'document' || type === 'handout';
}

// Why a heading is withheld: 'excluded' (on the exclude list at any level, or a
// document page's Keeper section at level 2), 'sheet' (a PC section that is not on
// the keep-list, level 1-2 only), or null. isExcludedSection and the strip both
// ask this, so the explanation cannot drift from the strip.
function exclusionReason(title, excludeSections = [], frontmatter = null, level = 2, rules = {}) {
  // `## **GM Notes**`, `## GM Notes:` and `## GM Notes {#gm}` are the same section as
  // `## GM Notes`; a spelling must not be the way one reaches the site (heading-key.js).
  if (titleNamedIn(title, excludeSections)) return 'excluded';
  // `## **Context**` and `## Clues:` are the same sections, too.
  if (level === 2 && isDocumentPage(frontmatter)
      && (headingKeys(title).some(k => DOCUMENT_KEEPER_SECTION_RE.test(k))
        || squashedKeys(title).some(k => DOCUMENT_KEEPER_SQUASHED_RE.test(k)))) {
    return 'excluded';
  }
  if (pcKeepRuleApplies(frontmatter, rules) && level <= 2) {
    const keep = (Array.isArray(rules.pcKeepSections) ? rules.pcKeepSections : [])
      .filter(s => typeof s === 'string')
      .map(bareSectionTitle)
      .filter(t => t !== '');
    if (!keep.includes(headingKey(title))) return 'sheet';
  }
  return null;
}

// The keep-list rule is on when the caller supplied one (`null`/absent means
// character sheets are on) and the note is a PC. Supplied but not an array is a
// malformed list: it keeps nothing, it does not switch the rule off.
function pcKeepRuleApplies(frontmatter, rules) {
  const keep = rules ? rules.pcKeepSections : undefined;
  if (keep === undefined || keep === null) return false;
  return !!frontmatter && String(frontmatter.type).trim().toLowerCase() === 'pc';
}

// Whether a heading is withheld, for any reason.
function isExcludedSection(title, excludeSections = [], frontmatter = null, level = 2, rules = {}) {
  return exclusionReason(title, excludeSections, frontmatter, level, rules) !== null;
}

// Line endings are normalized first: `publishedMarkdown` is fed text that still
// carries `\r`, and it is what feeds the search index, backlinks and recency.
//
// `rules.pcKeepSections`: when character sheets are off, a PC note keeps only
// these `##` sections (see pc-prose.js). Absent means no rule.
//
// `rules.mark` ({ marks, show }): with the `sections` kind shown, the GM site's version. Every line is returned and
// each run of lines the walk withholds is wrapped in a `sections` mark naming the section.
function filterSections(markdown, excludeSections = [], frontmatter = null, rules = {}) {
  const walk = walkSections(markdown, excludeSections, frontmatter, rules);
  if (rules.mark && rules.mark.show.has('sections')) return markedSections(markdown, walk.withheldBy, rules.mark);
  return walk.kept.join('\n');
}

const BEFORE_FIRST_SECTION = 'text before the first section';

// The mark's label for a walk's reason: a section title, the text before the first section, or a note no parser read.
function sectionLabel(by) {
  if (by === '(unparsed note)') return 'note body (it could not be read)';
  return by === BEFORE_FIRST_SECTION ? by : `${by} section`;
}

// The note's lines with each run the walk withholds (`withheldBy`, per line) inside one `sections` mark.
function markedSections(markdown, withheldBy, mark) {
  const lines = String(markdown).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let run = null;   // { by, lines } the withheld run being gathered
  const flush = () => {
    if (!run) return;
    blockLines(mark.marks.open('sections', sectionLabel(run.by))).forEach((t) => out.push(t));
    run.lines.forEach((t) => out.push(t));
    blockLines(mark.marks.close()).forEach((t) => out.push(t));
    run = null;
  };
  lines.forEach((line, i) => {
    const by = withheldBy[i] === undefined ? null : withheldBy[i];
    if (by === null) { flush(); out.push(line); return; }
    if (run && run.by !== by) flush();
    if (!run) run = { by, lines: [] };
    run.lines.push(line);
  });
  flush();
  return out.join('\n');
}

// The headings filterSections withholds, each with everything under it — the
// titles as written. explain reports these, so what it names is what the strip did.
// Sections withheld only by the PC keep-list are sheetWithheldTitles' to report.
function strippedSectionTitles(markdown, excludeSections = [], frontmatter = null, rules = {}) {
  return walkSections(markdown, excludeSections, frontmatter, rules).stripped
    .filter(s => s.reason === 'excluded').map(s => s.title);
}

// The `##` titles withheld ONLY by the PC keep-list: not on the exclude list, not a
// document rule, and not inside a section that was.
function sheetWithheldTitles(markdown, excludeSections = [], frontmatter = null, rules = {}) {
  return walkSections(markdown, excludeSections, frontmatter, rules).stripped
    .filter(s => s.reason === 'sheet').map(s => s.title);
}

// Every heading the renderer will render, by its first source line, and the lines that
// are code. Asked of the renderer's own parser (the instance the build renders with), so
// a boundary is never a pattern's guess: ATX at any indent the parser accepts, empty and
// closed headings, setext, and every fence rule are exactly what will be rendered.
// `nested` marks a heading inside a blockquote or list, which renders inside its parent
// section. Throws when the parser does.
function findHeadings(text, parse) {
  const tokens = (parse || parseBlocks)(text);
  const headingAt = new Map();   // first line -> { end, level, title, nested, atx }
  const inCode = new Set();      // lines of fenced or indented code, at any depth
  const inFence = new Set();     // lines of fenced code only, at any depth
  const source = text.split('\n');
  let openFence = null;          // first line of a top-level fence that is never closed
  const fences = [];             // every fence, at any depth: { start, end, closed }
  for (let t = 0; t < tokens.length; t++) {
    const tok = tokens[t];
    if (!tok.map) continue;
    if (tok.type === 'fence') {
      // Closed when its last line is a closing fence: the same mark, at least as many, and
      // nothing after them. Inside a quote or a list item the line carries that block's prefix.
      const last = tok.map[1] - 1;
      const prefix = tok.level === 0 ? ' {0,3}' : '[ \\t>]*';
      const closer = new RegExp(`^${prefix}\\${tok.markup[0]}{${tok.markup.length},}\\s*$`);
      const closed = last !== tok.map[0] && closer.test(source[last] || '');
      fences.push({ start: tok.map[0], end: tok.map[1], closed });
      if (tok.level === 0 && openFence === null && !closed) openFence = tok.map[0];
    }
    if (tok.type === 'heading_open') {
      const inline = tokens[t + 1];
      headingAt.set(tok.map[0], {
        end: tok.map[1],
        level: Number(tok.tag.slice(1)),
        // A setext title can run over several lines; it renders as one.
        title: inline && inline.type === 'inline' ? inline.content.trim().replace(/\s+/g, ' ') : '',
        nested: tok.level > 0,
        atx: tok.markup.startsWith('#'),   // not underlined (setext)
      });
    } else if (tok.type === 'fence' || tok.type === 'code_block') {
      for (let l = tok.map[0]; l < tok.map[1]; l++) {
        inCode.add(l);
        if (tok.type === 'fence') inFence.add(l);
      }
    }
  }
  // Code the section filter may trust: a line in a closed block is code, not a heading. Lines
  // from a fence that is never closed on are not trusted (an unclosed fence above a
  // `## GM Notes` must not be the way it is published), so they read as ordinary text.
  const settled = new Set([...inCode].filter(l => openFence === null || l < openFence));
  return { headingAt, inCode, inFence, settled, openFence, fences };
}

// A cell's inline markdown through the build's own renderer, typographer and all, so a
// reader of a note's cells (the write-back) sees the text the build's parser saw.
function renderInline(text) {
  return md.renderInline(String(text == null ? '' : text));
}

// What the build renders with, asked for its own reading of the note.
function parseBlocks(text) {
  return md.parse(text, {});
}

// A heading as the filter read it before it asked the parser: hashes at the margin,
// whitespace of any kind (a non-breaking space too), a title.
const MARGIN_HEADING_RE = /^(#{1,6})\s+(.+)$/;

function marginHeading(line) {
  const m = MARGIN_HEADING_RE.exec(line);
  if (!m) return null;
  // An ATX closing sequence (`## GM Notes ##`, `## #`) is not part of the title.
  const title = m[2].trim().replace(/(^|\s+)#+$/, '').trim();
  return title === '' ? null : { level: m[1].length, title };
}

// A third reading, for starting a withheld section only: what a heading looks like
// whatever the parser made of the lines around it. An unclosed code block above
// `  ## GM Notes`, or above `GM Notes` over `-----`, turns both into code, which
// neither the parser nor the margin pattern calls a heading.
const SETEXT_UNDERLINE_RE = /^ {0,3}(=+|-+)\s*$/;

function looseHeading(lines, i) {
  const atx = marginHeading(lines[i].replace(/^ {1,3}(?=#)/, ''));
  if (atx) return atx;
  const under = i + 1 < lines.length ? SETEXT_UNDERLINE_RE.exec(lines[i + 1]) : null;
  const title = lines[i].trim();
  return under && title !== '' ? { level: under[1][0] === '=' ? 1 : 2, title } : null;
}

// The exclude-list walk; a note under the PC keep-list takes walkKeepList instead.
//
// The two readings of "heading" (the renderer's parser, and the margin pattern above)
// disagree, and each is wrong in a way that publishes: the pattern ends `## GM Notes`
// at a `## line` shown in a code block; the parser ends it at text with `---` typed
// under it, at a bare `##`, and does not see `## GM Notes` at all when a
// non-breaking space follows the hashes or an unclosed code block sits above it. So the
// walk takes whichever reading withholds more:
//   - a section STARTS at a line ANY reading calls a heading with a withheld title
//     (a parser heading at any indent, underlined, or inside a blockquote or list; a
//     margin-pattern line even inside code; and looseHeading's, for an indented or
//     underlined title the parser read as code);
//   - it ENDS only at a line BOTH call a heading of its level or shallower: a
//     top-level `#` heading at the margin, with a title, outside code, not underlined.
// A parse failure withholds the whole body.
// vault_check does not copy this walk: it asks for the verdicts (the `lines` command).
// `rules.parse` replaces the parser (a test seam); `rules.warn` hears of a failure.
function walkSections(markdown, excludeSections, frontmatter, rules = {}) {
  if (pcKeepRuleApplies(frontmatter, rules)) return walkKeepList(markdown, excludeSections, frontmatter, rules);
  return walkExcludeList(String(markdown).replace(/\r\n?/g, '\n').split('\n'), excludeSections, frontmatter, rules);
}

function walkExcludeList(lines, excludeSections, frontmatter, rules) {
  const kept = [];
  const keptAt = [];       // the index in `lines` of each kept line
  const stripped = [];
  const withheldBy = [];   // per line: the title of the section withholding it, or null
  let headingAt;
  let openFence;
  let settled;
  try {
    ({ headingAt, openFence, settled } = findHeadings(lines.join('\n'), rules.parse));
  } catch (err) {
    if (typeof rules.warn === 'function') rules.warn(`section filter: could not parse the note, body withheld (${err.message})`);
    stripped.push({ title: '(unparsed note)', reason: 'excluded' });
    return { kept, stripped, withheldBy: lines.map(() => '(unparsed note)'), keptAt: [] };
  }
  let excluding = false;
  let excludeLevel = 0;
  let by = null;

  for (let i = 0; i < lines.length; i++) {
    const h = headingAt.get(i);
    // A line of a closed code block is code: it neither starts nor ends a section.
    const margin = settled.has(i) ? null : marginHeading(lines[i]);
    // Both readings, of the same heading: text over an underline can itself look
    // like a margin heading (`## x` typed with a non-breaking space, then `===`).
    if (excluding && h && h.atx && h.title !== '' && margin && Math.max(h.level, margin.level) <= excludeLevel) {
      excluding = false;
    }

    // Never re-anchor an exclusion that is already running: a nested
    // excluded heading (`## GM Notes` / `### Player Notes`) used to reset
    // excludeLevel to 3, so the next `### Secrets` ended the exclusion and
    // published the rest of GM Notes (#228).
    // A withheld heading met while one is running can only widen it: a shallower
    // one takes over the level, so a `# GM Notes` under `## GM Notes` is not ended
    // by the next `##`.
    for (const seen of [h, margin, h || margin || settled.has(i) ? null : looseHeading(lines, i)]) {
      const reason = seen ? exclusionReason(seen.title, excludeSections, frontmatter, seen.level, {}) : null;
      if (!reason) continue;
      if (excluding) {
        excludeLevel = Math.min(excludeLevel, seen.level);
        continue;
      }
      excluding = true;
      excludeLevel = seen.level;
      by = seen.title;
      stripped.push({ title: seen.title, reason });
    }

    withheldBy.push(excluding ? by : null);
    if (!excluding) {
      kept.push(lines[i]);
      keptAt.push(i);
    }
  }

  // A code block left open inside a withheld section swallows every heading after
  // it, so the section runs to the end of the note. That is the safe reading, and
  // the GM should hear that the rest of the page went with it.
  if (openFence !== null && withheldBy[openFence] !== null && typeof rules.warn === 'function'
      && lines.slice(openFence + 1).some((line) => MARGIN_HEADING_RE.test(line))) {
    rules.warn(`a code block opened inside the withheld section "${withheldBy[openFence]}" is never closed; everything after it is withheld, headings included. Close it.`);
  }

  return { kept, stripped, withheldBy, keptAt };
}

// For each line of `markdown`, the title of the excluded section that withholds it,
// or null when the exclude list leaves it in. The exclude-list walk's own verdicts
// (no PC keep-list, no document rule), for a caller that needs them by line: the
// `lines` command answers vault_check with this instead of vault_check keeping a
// copy of the walk.
function sectionVerdicts(markdown, excludeSections = []) {
  return walkSections(markdown, excludeSections, null, {}).withheldBy;
}

const HTML_HEADING_RE = /<h[1-6][\s>]/i;

// The walk for a PC note under the keep-list. Section boundaries come from the
// renderer's own parser (findHeadings). Only TOP-LEVEL headings are boundaries; one
// inside a blockquote or list renders inside its parent section, like a level 3+
// heading. A parse failure withholds the whole body.
// `rules.parse` replaces the parser (a test seam); `rules.warn` hears of a failure.
function walkKeepList(markdown, excludeSections, frontmatter, rules) {
  const lines = String(markdown).replace(/\r\n?/g, '\n').split('\n');
  const stripped = [];
  let found;
  try {
    found = findHeadings(lines.join('\n'), rules.parse);
  } catch (err) {
    if (typeof rules.warn === 'function') rules.warn(`keep-list: could not parse the note, body withheld (${err.message})`);
    stripped.push({ title: '(unparsed note)', reason: 'sheet' });
    return { kept: [], stripped, keptAt: [], withheldBy: lines.map(() => '(unparsed note)') };
  }
  const { inCode } = found;
  const headingAt = new Map([...found.headingAt].filter(([, h]) => !h.nested));
  // The exclude list is applied by its own walk, exactly as on any other page; a line
  // it withholds is withheld here whatever the keep-list makes of it.
  const excluded = walkExcludeList(lines, excludeSections, frontmatter, { parse: rules.parse, warn: rules.warn });
  for (const s of excluded.stripped) stripped.push(s);

  const kept = [];
  const keptAt = [];
  let excluding = false;
  let excludeLevel = 0;
  let sawHeading = false;  // the note's first heading is its title (a level 1, unless the H1 strip ran)
  let sawSection = false;  // text before the first level 1-2 section belongs to no kept section
  let by = null;           // the title of the section being withheld
  const why = [];          // per line the keep-list withholds: the title of the section doing it
  const keep = (l, isPreamble) => {
    if (excluding) why[l] = by;
    if (excluding || excluded.withheldBy[l] !== null) return;
    if (isPreamble && lines[l].trim() !== '') return;
    kept.push(lines[l]);
    keptAt.push(l);
  };

  for (let i = 0; i < lines.length; i++) {
    const h = headingAt.get(i);
    if (h) {
      if (excluding && h.level <= excludeLevel) excluding = false;
      const isTitle = !rules.titleStripped && h.level === 1 && !sawHeading;
      sawHeading = true;
      if (h.level <= 2 && !isTitle) sawSection = true;
      const reason = excluding ? null
        : exclusionReason(h.title, excludeSections, frontmatter, h.level, isTitle ? {} : rules);
      if (reason) {
        excluding = true;
        excludeLevel = h.level;
        by = h.title || '(empty heading)';
        // The exclude walk has already reported the sections it withholds.
        if (reason !== 'excluded') stripped.push({ title: by, reason });
      } else if (!excluding && (isTitle || h.level <= 2 || sawSection)) {
        for (let l = i; l < h.end; l++) keep(l, false);
      }
      if (excluding) for (let l = i; l < h.end; l++) why[l] = by;
      i = Math.max(i, h.end - 1);
      continue;
    }

    // An HTML heading line outside code ends a kept section: withheld to the next
    // level 1-2 heading. The renderer shows it as text, so this only ever withholds more.
    if (!excluding && !inCode.has(i) && HTML_HEADING_RE.test(lines[i])) {
      excluding = true;
      excludeLevel = 2;
      by = lines[i].replace(/<[^>]*>/g, '').trim() || '(html heading)';
      stripped.push({ title: by, reason: 'sheet' });
      why[i] = by;
      continue;
    }

    keep(i, !sawSection);
  }

  // Per line, why it is withheld: the exclude list's section, else the keep-list's section, else the text before
  // the first section. Strip mode ignores this.
  const keptSet = new Set(keptAt);
  const withheldBy = lines.map((_, l) => (keptSet.has(l) ? null
    : (excluded.withheldBy[l] !== null ? excluded.withheldBy[l] : (why[l] !== undefined ? why[l] : BEFORE_FIRST_SECTION))));
  return { kept, stripped, keptAt, withheldBy };
}

// The inverse of filterSections: keep ONLY the named headings and their
// content, dropping everything else including any preamble before the first
// heading. Backs `publish: stub`, where the page must exist for navigation but
// its body is prep. Defaults to keeping nothing — a stub opts content IN, so a
// section added later is suppressed until the GM names it, rather than
// appearing the moment someone writes it.
//
// This runs BEFORE the build's strips, and cutting a note down drops the very things
// that hide its text: the `## GM Notes` over a kept title, the `<!-- gm-only -->` that
// opened above one (#320). So the cut is made on what the WHOLE note publishes:
// playerSafeMarkdown's own strips run first (strippedLines; `withhold.excludeCallouts`
// is its callout setting), then the exclude list (`withhold.excludeSections`, and
// `withhold.frontmatter` for a document page's own sections), and only then are the
// named sections kept. `withhold.warn` hears the strips' warnings (an unclosed
// marker): a later pass over the cut text has no marker left to warn about, bar one
// shown in a code block.
function keepOnlySections(markdown, includeSections = [], withhold = {}) {
  return stubView(markdown, includeSections, withhold).kept.join('\n');
}

// keepOnlySections by line: whether each line of `markdown` is kept, whole or in part.
function keptSectionFlags(markdown, includeSections = [], withhold = {}) {
  return stubView(markdown, includeSections, withhold).flags;
}

// The GM site's stub page: the whole note, each run of lines the stub cuts inside a `sections` mark labelled
// "publish: stub". A line is cut when keptSectionFlags does not keep it AND it lies outside every kept section: a
// line between the first and last kept line of one kept section (a gm-only block in Overview) is left unmarked, for
// the strips to deal with. The tokens are this function's; the caller must not sanitize the result.
function stubMarked(markdown, includeSections, withhold, mark) {
  const lines = String(markdown).replace(/\r\n?/g, '\n').split('\n');
  if (!mark || !mark.show.has('sections')) return lines.join('\n');
  const flags = keptSectionFlags(markdown, includeSections, withhold);
  const inside = flags.slice();   // kept lines, and the lines between a kept section's first and last kept line
  let headings = null;
  try { headings = findHeadings(lines.join('\n')).headingAt; } catch (err) { headings = null; }
  if (headings) {
    const tops = [...headings].filter(([, h]) => !h.nested).sort((a, b) => a[0] - b[0]);
    tops.forEach(([at, h], k) => {
      if (!flags[at]) return;
      const next = tops.slice(k + 1).find(([, n]) => n.level <= h.level);
      const stop = next ? next[0] : lines.length;
      let last = at;
      for (let l = at; l < stop; l++) if (flags[l]) last = l;
      for (let l = at; l <= last; l++) inside[l] = true;
    });
  }
  const out = [];
  let run = [];
  const flush = () => {
    if (run.some((t) => t.trim() !== '')) {
      blockLines(mark.marks.open('sections', 'publish: stub')).forEach((t) => out.push(t));
      run.forEach((t) => out.push(t));
      blockLines(mark.marks.close()).forEach((t) => out.push(t));
    } else run.forEach((t) => out.push(t));
    run = [];
  };
  lines.forEach((line, i) => {
    if (inside[i]) { flush(); out.push(line); } else run.push(line);
  });
  flush();
  return out.join('\n');
}

function stubView(markdown, includeSections, withhold) {
  const source = String(markdown).replace(/\r\n?/g, '\n').split('\n');
  const flags = source.map(() => false);
  // Read the way the exclude list is (heading-key.js), by the title's label alone: a kept
  // section is the risky direction, so a link's target never opens one.
  const wanted = (Array.isArray(includeSections) ? includeSections : [])
    .filter(s => typeof s === 'string')
    .map(headingKey)
    .filter(k => k !== '');
  if (wanted.length === 0) return { kept: [], flags, facts: { strays: [], openFence: null } };

  // What the whole note publishes, each line with the line of the note it came from.
  const stripped = strippedLines(source.join('\n'), withhold.excludeCallouts);
  if (typeof withhold.warn === 'function') stripped.warnings.forEach(w => withhold.warn(w));
  const keep = stubKept(stripped.lines, wanted, withhold, withhold.warn);
  const kept = [];
  stripped.lines.forEach((line, i) => {
    if (!keep[i]) return;
    kept.push(line);
    flags[stripped.from[i]] = true;
  });
  // The chain's faults that show in the kept sections (noteFacts), by this same cut.
  return { kept, flags, facts: noteFacts(stripped, (lines) => stubKept(lines, wanted, withhold, null)) };
}

// Per line of `lines` (a note after the strip chain), whether a stub that keeps the `wanted`
// sections keeps it: the exclude list first, then the named sections of what is left.
function stubKept(lines, wanted, withhold, warn) {
  const out = lines.map(() => false);
  const { withheldBy } = walkExcludeList(lines, withhold.excludeSections || [], withhold.frontmatter || null, { warn });
  const at = [];
  lines.forEach((_, i) => { if (withheldBy[i] === null) at.push(i); });
  lines = at.map(i => lines[i]);

  let headingAt;
  let settled;
  try {
    ({ headingAt, settled } = findHeadings(lines.join('\n')));
  } catch (err) {
    return out;
  }
  let keeping = false;
  let keepLevel = 0;

  // Keeping is the risky direction here, so the two readings of "heading" (see
  // walkSections) are combined the other way round: a kept section OPENS only at a
  // line both call a heading (a `## Overview` shown in a code block opens nothing),
  // and CLOSES at a line either does (a top-level parser heading of any shape, or a
  // margin-pattern line even inside code).
  for (let i = 0; i < lines.length; i++) {
    const parsed = headingAt.get(i);
    const h = parsed && !parsed.nested ? parsed : null;
    // A line of a closed code block is code: it neither opens nor closes a kept section.
    const margin = settled.has(i) ? null : marginHeading(lines[i]);
    // For closing, hashes at the margin count with or without a title.
    const hashes = settled.has(i) ? null : MARGIN_HEADING_RE.exec(lines[i]);
    const level = Math.min(h ? h.level : 7, hashes ? hashes[1].length : 7);
    if (keeping && level <= keepLevel) keeping = false;
    // The title compared is read by both of the readings (the line's own text after the
    // hashes, and the parser's); the parser's part is also to say the line is a real
    // heading, at that level, and not code.
    const written = hashes ? headingKey(hashes[2]) : null;
    if (h && h.atx && hashes && h.level === hashes[1].length && wanted.includes(written) && wanted.includes(headingKey(h.title))) {
      keeping = true;
      keepLevel = h.level;
    } else if (keeping) {
      // A wanted title only one reading sees opens nothing, but it does what it
      // always did to a section already open: sets the level it closes at.
      for (const seen of [h, margin, written === null ? null : { title: written, level: hashes[1].length }]) {
        if (seen && wanted.includes(headingKey(seen.title))) keepLevel = Math.max(keepLevel, seen.level);
      }
    }
    if (keeping) out[at[i]] = true;
  }
  return out;
}

// keepOnlySections, with the faults of the note that show in what is kept: the build takes
// this for a stub page, whose cut text no longer holds the stray marker.
function stubCut(markdown, includeSections = [], withhold = {}) {
  const view = stubView(markdown, includeSections, withhold);
  return { text: view.kept.join('\n'), strays: view.facts.strays, openFence: view.facts.openFence };
}

const DATAVIEW_RE = /```dataview[\s\S]*?```/g;

function stripDataview(markdown) {
  return markdown.replace(DATAVIEW_RE, '');
}

// stripDataview as lines, and `from`: the line of `markdown` each of them starts on (a
// removed block can join the ends of two lines into one).
function dataviewLines(markdown) {
  const lines = [];
  const from = [];
  let line = '';
  let startedAt = -1;
  let n = 0;
  let last = 0;
  const take = (chunk) => {
    for (const ch of chunk) {
      if (ch !== '\n') {
        if (startedAt === -1) startedAt = n;
        line += ch;
        continue;
      }
      lines.push(line);
      from.push(startedAt === -1 ? n : startedAt);
      line = '';
      startedAt = -1;
      n++;
    }
  };
  for (const m of markdown.matchAll(DATAVIEW_RE)) {
    take(markdown.slice(last, m.index));
    n += m[0].split('\n').length - 1;
    last = m.index + m[0].length;
  }
  if (last === 0) {
    const whole = markdown.split('\n');
    return { lines: whole, from: whole.map((_, i) => i) };
  }
  take(markdown.slice(last));
  lines.push(line);
  from.push(startedAt === -1 ? n : startedAt);
  return { lines, from };
}

// Strip content between a named HTML-comment marker pair (e.g. "gm-only" for
// <!-- gm-only -->...<!-- /gm-only -->). Shared implementation behind
// stripGmOnly and stripSpoiler — same stripping behavior, different marker
// name, so a marker of one name never strips a block of the other name.
//
// Nesting-aware by depth, NOT a boolean (#168). With a boolean, the first
// closer ended the outer block, so wrapping a region that already contained
// inner fences published everything after that inner closer. The markers looked
// balanced, so the author had no reason to doubt the region was covered, and
// nothing warned. Silent under-protection is the worst possible failure of the
// one primitive whose entire job is hiding things — so an inner block now
// closes only itself, and the outer block survives it.
function stripMarkedBlocks(markdown, markerName) {
  const { text, warnings } = markedBlocks(markdown, markerName);
  return warnings.length > 0 ? { text, warnings } : text;
}

// Whether a paragraph line `prev` above a `---` / `===` line `next` would join it into a
// Setext heading (once the lines between them are cut).
function setextRisk(prev, next) {
  return typeof prev === 'string' && prev.trim() !== ''
    && typeof next === 'string' && /^ {0,3}(-+|=+)\s*$/.test(next);
}

// One line's effect on the fence state. A fence closes only on the same character, at least
// as long as the opener, with nothing but whitespace after it (CommonMark).
function fenceStep(line, fenceDelim) {
  // up to 3 leading spaces; 4+ would be an indented code block, not a fence
  const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
  let isFenceLine = false;
  if (fence) {
    const [, delim, info] = fence;
    if (fenceDelim === null) {
      // A backtick fence's info string may not contain a backtick.
      if (delim[0] !== '`' || !info.includes('`')) {
        fenceDelim = delim;
        isFenceLine = true;
      }
    } else if (delim[0] === fenceDelim[0]
               && delim.length >= fenceDelim.length
               && /^\s*$/.test(info)) {
      fenceDelim = null;
      isFenceLine = true;
    }
  }
  return { fenceDelim, isFenceLine };
}

// The note's lines for a strip. CRLF would hide a fence line from the fence regex (`.` never
// matches \r), so a closer shown inside a fenced example would end the block early. Callers that
// pass raw gray-matter content (build.js's published view) keep CRLF.
// A marker split over lines ("<!--\ngm-only\n-->") is one marker on its first line; the
// line breaks it held follow it, so every line after it stays on its own line number.
function markerLines(markdown, markerName) {
  return String(markdown).replace(/\r\n?/g, '\n')
    .replace(markerPattern(markerName), (whole) => (whole.includes('\n')
      ? whole.replace(/\n/g, ' ') + whole.replace(/[^\n]/g, '') : whole))
    .split('\n');
}

// The mark kind and label of each marker name on the GM site.
const MARK_OF = {
  'gm-only': { kind: 'gm_only_blocks', label: 'gm-only block' },
  spoiler: { kind: 'spoilers', label: 'spoiler block' },
};

// One line of the GM site's strips as text pieces and open/close events (`inline` or not), written to `out`. An
// inline event is a token inside the line's text; any other ends the text and stands on lines of its own, and the
// text after it loses its leading spaces. The one place the inline/block rule is applied (blocks, comments).
function emitMarkedParts(parts, kind, label, mark, out) {
  let segment = '';
  let fresh = false;   // the segment follows a block break: its leading spaces are dropped
  const flush = (trailing) => {
    const t = trailing ? segment.trimEnd() : segment;
    if (t.trim() !== '') out.push(fresh ? t.trimStart() : t);
    segment = '';
    fresh = false;
  };
  for (const p of parts) {
    if (p.text !== undefined) segment += p.text;
    else if (p.open) {
      p.token = mark.marks.open(kind, label);
      if (p.inline) segment += p.token;
      else { flush(true); blockLines(p.token).forEach((t) => out.push(t)); fresh = true; }
    } else if (p.inline) segment += mark.marks.close();
    else { flush(true); blockLines(mark.marks.close()).forEach((t) => out.push(t)); fresh = true; }
  }
  flush(false);
}

// The GM site's version of the strip: every line is kept, and each block is wrapped in a mark
// (gm-marks.js). A block whose open and close share a line is a mark inside the line; any other
// open or close ends the line's text and stands on lines of its own. `from` is null.
function markBlocksKeeping(lines, markerName, mark) {
  const markerRe = markerPattern(markerName);
  const { kind, label } = MARK_OF[markerName];
  const out = [];
  const warnings = [];
  const stack = [];
  let orphanClosers = 0;
  let fenceDelim = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const step = fenceStep(line, fenceDelim);
    fenceDelim = step.fenceDelim;
    if (fenceDelim !== null || step.isFenceLine || !markerRe.test(line)) { out.push(line); markerRe.lastIndex = 0; continue; }
    markerRe.lastIndex = 0;
    // The line as text pieces and marker events; a pair that opens and closes here is inline.
    const parts = [];
    let last = 0;
    let m;
    while ((m = markerRe.exec(line)) !== null) {
      parts.push({ text: line.slice(last, m.index) });
      last = m.index + m[0].length;
      const inline = line.slice(0, m.index).trim() !== '';
      if (m[1] === '') {
        const ev = { open: true };
        parts.push(ev);
        stack.push({ inline, line: i, ev });
      } else if (stack.length === 0) {
        orphanClosers += 1;   // dropped
      } else {
        const top = stack[stack.length - 1];
        // As in the strip: a closer after other content ends only a block opened the same way or on this line.
        if (!inline || top.inline || top.line === i) {
          stack.pop();
          const ev = { close: true, pair: top.ev };
          if (top.line === i) { top.ev.inline = true; ev.inline = true; }
          parts.push(ev);
        }
      }
    }
    markerRe.lastIndex = 0;
    parts.push({ text: line.slice(last) });
    emitMarkedParts(parts, kind, label, mark, out);
  }
  for (let d = stack.length; d > 0; d--) blockLines(mark.marks.close()).forEach((t) => out.push(t));
  if (stack.length > 0) {
    warnings.push(
      `unclosed <!-- ${markerName} --> marker (${stack.length} block${stack.length === 1 ? '' : 's'} still open) `
      + '— content marked as hidden to end of file (players see none of it)');
  }
  if (orphanClosers > 0) {
    warnings.push(
      `${orphanClosers} <!-- /${markerName} --> marker${orphanClosers === 1 ? '' : 's'} `
      + `without a matching <!-- ${markerName} --> — check the block boundaries`);
  }
  return { text: out.join('\n'), warnings, lines: out, from: null };
}

// The strip as lines, and `from`: the line of `markdown` each of them came from. With `mark`
// ({ marks, show }) and the marker's kind on in `show`, the GM site's version instead (above).
function markedBlocks(markdown, markerName, mark) {
  const lines = markerLines(markdown, markerName);
  if (mark && MARK_OF[markerName] && mark.show.has(MARK_OF[markerName].kind)) return markBlocksKeeping(lines, markerName, mark);
  // Group 1 is "/" for a closer, "" for an opener. Non-global copy for the cheap test.
  // Capitals and spacing inside the comment do not matter (markers.js).
  const markerRe = markerPattern(markerName);
  const result = [];
  const warnings = [];
  const stack = [];
  const from = [];
  const keep = (text, i) => { result.push(text); from.push(i); };
  let depth = 0;
  let orphanClosers = 0;
  // The open fence's delimiter, or null outside a fence. Tracking the actual
  // delimiter — not a boolean — is what makes ``` inside a ~~~ block (and vice
  // versa) inert, per CommonMark: a fence closes only on the same character,
  // at least as long as the opener, with nothing but whitespace after it.
  //
  // Only ^``` used to count as a fence, so a marker shown inside a ~~~ block,
  // a ````-long fence, or an indented fence was obeyed as a real directive —
  // ending the enclosing block early and publishing the rest. This repo's own
  // docs demonstrate these markers inside fenced examples, so it is a shape
  // that actually occurs. Getting this wrong leaks in BOTH directions: miss a
  // fence and an example closer is obeyed; invent one and a real opener is
  // ignored. Hence matching CommonMark rather than loosening the pattern.
  let fenceDelim = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // up to 3 leading spaces; 4+ would be an indented code block, not a fence
    const step = fenceStep(line, fenceDelim);
    fenceDelim = step.fenceDelim;

    if (fenceDelim !== null || step.isFenceLine) {
      if (depth === 0) keep(line, i);
      continue;
    }

    // Markers are honoured wherever they sit on the line: inline
    // ("a <!-- gm-only -->X<!-- /gm-only --> b"), inside HTML wrappers, or several
    // per line. Text outside every block is kept; a line that held only markers
    // and blank leftovers collapses (one blank stands in for a whole block).
    if (!markerRe.test(line)) {
      if (depth === 0) keep(line, i);
      continue;
    }
    markerRe.lastIndex = 0;
    let kept = '';
    let last = 0;
    let opened = false;
    let m;
    while ((m = markerRe.exec(line)) !== null) {
      if (depth === 0) kept += line.slice(last, m.index);
      last = m.index + m[0].length;
      const inline = line.slice(0, m.index).trim() !== '';
      if (m[1] === '') {
        if (depth === 0) opened = true;
        stack.push({ inline, line: i });
      } else if (stack.length === 0) {
        // A closer with nothing open. Don't let it drive depth negative — that
        // would make a LATER opener fail to strip. Count it and warn instead.
        orphanClosers += 1;
      } else {
        // A closer tucked after other content ("<div><!-- /gm-only --></div>")
        // may only end a block opened the same way or on this same line; against
        // a block opened on its own line it is ignored, so the block stays open
        // (over-strips, never under-strips).
        const top = stack[stack.length - 1];
        if (!inline || top.inline || top.line === i) stack.pop();
      }
      depth = stack.length;
    }
    if (depth === 0) kept += line.slice(last);
    markerRe.lastIndex = 0;
    if (kept.trim() !== '') keep(kept, i);
    else if (opened) keep('', i);
  }

  if (depth > 0) {
    warnings.push(
      `unclosed <!-- ${markerName} --> marker (${depth} block${depth === 1 ? '' : 's'} still open) `
      + '— content stripped to end of file');
  }
  if (orphanClosers > 0) {
    warnings.push(
      `${orphanClosers} <!-- /${markerName} --> marker${orphanClosers === 1 ? '' : 's'} `
      + `without a matching <!-- ${markerName} --> — check the block boundaries`);
  }

  return { text: result.join('\n'), warnings, lines: result, from };
}

function stripGmOnly(markdown) {
  return stripMarkedBlocks(markdown, 'gm-only');
}

function stripSpoiler(markdown) {
  return stripMarkedBlocks(markdown, 'spoiler');
}

// Remove Obsidian callout blockquotes (`> [!type] Title` and their body). The gm-apprentice
// convention treats callouts as Keeper-facing (design decisions, alert levels, keeper-only
// notes, canon-state bookkeeping), so a player site can drop them wholesale. Plain blockquotes
// (`> "in-world quote"`) never carry a `[!type]` marker and are preserved.
//   exclude === true            → strip every callout
//   exclude === ['warning', …]  → strip only callouts of those types (case-insensitive)
//   falsy                       → unchanged
// Matches markdown.js CALLOUT_RE on the type token (allows hyphens and a +/- fold marker),
// then consumes the contiguous `>`-prefixed lines that form the blockquote.
function stripCallouts(markdown, exclude) {
  if (!exclude) return markdown;
  return calloutLines(markdown, exclude).lines.join('\n');
}

// The strip as lines, and `from`: the line of `markdown` each of them came from.
// With `mark` and the `callouts` kind on, each callout that would be cut is kept instead, in a block mark.
function calloutLines(markdown, exclude, mark) {
  if (mark && exclude && mark.show.has('callouts')) return calloutLinesMarking(markdown, exclude, mark);
  const types = Array.isArray(exclude)
    ? new Set(exclude.map(t => String(t).toLowerCase()))
    : null; // null → strip all types
  const lines = markdown.split('\n');
  const out = [];
  const from = [];
  if (!exclude) return { lines, from: lines.map((_, i) => i) };
  let inCodeFence = false;
  for (let i = 0; i < lines.length; i++) {
    // A `> [!warning]` written as an example inside a fenced code block is documentation,
    // not a real callout — copy fenced lines verbatim (matches stripMarkedBlocks).
    if (/^```/.test(lines[i])) inCodeFence = !inCodeFence;
    if (inCodeFence) { out.push(lines[i]); from.push(i); continue; }
    const m = lines[i].match(/^>[ \t]*\[!([A-Za-z][\w-]*)\][+-]?/);
    if (m && (!types || types.has(m[1].toLowerCase()))) {
      i++;
      while (i < lines.length && /^>/.test(lines[i])) i++;
      // Swallow one blank separator the callout left behind, so removing a callout that
      // sat between two paragraphs collapses to a single blank line rather than two.
      if (i < lines.length && lines[i].trim() === '') i++;
      i--; // the for-loop's ++ lands on the next real line
      continue;
    }
    out.push(lines[i]);
    from.push(i);
  }
  return { lines: out, from };
}

// The GM site's callout strip: the same callouts are found, and each is wrapped in a mark instead of cut. The blank
// line after it, which the strip swallows, is kept. `from` is null.
function calloutLinesMarking(markdown, exclude, mark) {
  const types = Array.isArray(exclude) ? new Set(exclude.map((t) => String(t).toLowerCase())) : null;
  const lines = markdown.split('\n');
  const out = [];
  let fenceDelim = null;
  for (let i = 0; i < lines.length; i++) {
    const step = fenceStep(lines[i], fenceDelim);
    fenceDelim = step.fenceDelim;
    if (fenceDelim !== null || step.isFenceLine) { out.push(lines[i]); continue; }
    const m = lines[i].match(/^>[ \t]*\[!([A-Za-z][\w-]*)\][+-]?/);
    if (m && (!types || types.has(m[1].toLowerCase()))) {
      blockLines(mark.marks.open('callouts', `${m[1].toLowerCase()} callout`)).forEach((t) => out.push(t));
      out.push(lines[i]);
      while (i + 1 < lines.length && /^>/.test(lines[i + 1])) { i++; out.push(lines[i]); }
      blockLines(mark.marks.close()).forEach((t) => out.push(t));
      continue;
    }
    out.push(lines[i]);
  }
  return { lines: out, from: null };
}

// Remove every `<!-- ... -->` comment, including multi-line ones, outside fenced code
// blocks. A comment in indented (four-space or tab) code is cut like any other: one that
// opens there runs on over lines that are not code, so reading it as literal would publish
// them. Authors keep private notes (UNVERIFIED flags, change logs, import provenance)
// as comments; the renderer runs with `html: false`, so anything left here is escaped and
// printed as visible body text. Must run AFTER stripGmOnly/stripSpoiler, whose block
// markers are themselves comments.
//
// A line that holds nothing but a comment is dropped rather than blanked: a blank line
// would split the paragraph the comment was sitting inside.
function stripHtmlComments(markdown) {
  const { text, warnings } = htmlComments(markdown);
  return warnings.length > 0 ? { text, warnings } : text;
}

// The strip as lines, and `from`: the line of `markdown` each of them came from.
// With `mark` ({ marks, show }) and the `comments` kind on, the GM site's version instead (markComments).
function htmlComments(markdown, mark) {
  if (mark && mark.show.has('comments')) return htmlCommentsMarking(markdown, mark);
  const lines = String(markdown || '').split('\n');
  const result = [];
  const warnings = [];
  const from = [];
  // Track which marker opened the fence: a ``` line inside a ~~~ block is content, not a
  // close, and must not toggle the fence off and expose the rest of the block to stripping.
  let fenceMarker = null;
  let inComment = false;

  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    const fence = inComment ? null : /^\s*(```|~~~)/.exec(line);
    if (fence) {
      if (fenceMarker === null) fenceMarker = fence[1];
      else if (fenceMarker === fence[1]) fenceMarker = null;
    }
    // Inside a fence, or on the line that opened or closed one: pass through verbatim.
    if (fenceMarker !== null || fence) {
      result.push(line);
      from.push(n);
      continue;
    }

    let kept = '';
    let i = 0;
    while (i < line.length) {
      if (inComment) {
        const end = line.indexOf('-->', i);
        if (end === -1) { i = line.length; break; }
        inComment = false;
        i = end + 3;
      } else {
        const start = line.indexOf('<!--', i);
        if (start === -1) { kept += line.slice(i); break; }
        kept += line.slice(i, start);
        inComment = true;
        i = start + 4;
      }
    }

    if (kept.trim() === '' && line.trim() !== '') continue;
    result.push(kept);
    from.push(n);
  }

  if (inComment) {
    warnings.push('unclosed <!-- comment --> — content stripped to end of file');
  }

  return { text: result.join('\n'), warnings, lines: result, from };
}

// Obsidian comments: `%% a comment %%`, on one line or across many. Obsidian hides them;
// the site must too (#305). A `%%` opens a comment and the next `%%` closes it, wherever
// each sits on a line. A `%%` never closed hides everything to the end of the note: that is
// what Obsidian shows, and the reading that cannot leak. `%%` in a fenced code block or an
// inline code span is literal text; in indented (four-space or tab) code it is a comment and
// is cut, as an HTML comment there is. A comment inside a table cell, list item, quote or
// heading is cut out of that line and the rest of the line stays.
// Runs after the HTML-comment strip (a `%%` inside `<!-- -->` is part of that comment) and
// returns the strips' shape: the lines left, and `from` (the line of the input each came from).
function obsidianComments(markdown, mark) {
  if (mark && mark.show.has('comments')) return obsidianCommentsMarking(markdown, mark);
  const lines = String(markdown || '').split('\n');
  // No `%%` anywhere: nothing to cut, and no need to ask the parser where the fences are.
  if (!String(markdown || '').includes('%%')) {
    return { text: lines.join('\n'), warnings: [], lines, from: lines.map((_, i) => i), strays: [] };
  }
  const result = [];
  const from = [];
  const warnings = [];
  let inComment = false;
  // Fenced code is whatever the renderer's parser calls a fence (any length, tilde, in a quote
  // or a list item), the same reading findHeadings gives the section filter. A parser that
  // fails reads no fence: nothing is then literal, which cannot leak.
  let inFence = new Set();
  try { ({ inFence } = findHeadings(lines.join('\n'))); } catch (err) { /* no fence is trusted */ }
  // Every opener, for the note-faults audit: where it sat, where it closed (null when it never
  // did), and whether it was glued to the number before it ("100%% done").
  const openers = [];

  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    const startedInComment = inComment;
    // A comment already open runs on through "code" until its closing %%.
    if (!inComment && inFence.has(n)) {
      result.push(line);
      from.push(n);
      continue;
    }

    let kept = '';
    let i = 0;
    while (i < line.length) {
      if (inComment) {
        const end = line.indexOf('%%', i);
        if (end === -1) { i = line.length; break; }
        inComment = false;
        openers[openers.length - 1].end = n;
        i = end + 2;
        continue;
      }
      const ch = line[i];
      if (ch === '`') {
        // An inline code span: a run of backticks to the next run of the same length on
        // the line. One that never closes is no span, so a `%%` after it still counts.
        let run = 1;
        while (line[i + run] === '`') run++;
        const close = new RegExp('(?<!`)`{' + run + '}(?!`)').exec(line.slice(i + run));
        if (close) {
          const stop = i + run + close.index + run;
          kept += line.slice(i, stop);
          i = stop;
        } else {
          kept += line.slice(i, i + run);
          i += run;
        }
        continue;
      }
      if (ch === '%' && line[i + 1] === '%') {
        inComment = true;
        openers.push({ line: n, end: null, glued: gluedBefore(line, i) });
        i += 2;
        continue;
      }
      kept += ch;
      i++;
    }

    // A line that was only comment goes whole; one with text around a comment keeps it.
    if (kept.trim() === '' && (line.trim() !== '' || startedInComment)) continue;
    result.push(kept);
    from.push(n);
  }

  if (inComment) {
    warnings.push('unclosed %% comment: content stripped to end of file');
  }
  const strays = openers.filter(o => o.end === null || o.glued)
    .map(o => ({ line: o.line, end: o.end, kind: o.end === null ? 'UNCLOSED' : 'GLUED' }));
  return { text: result.join('\n'), warnings, lines: result, from, strays };
}

// The GM site's comment strips: every comment is kept, its delimiters become a mark (kind `comments`). `scan` reads
// one line into pieces: { text, content } for text outside or inside a comment, { open }, { close }; `skip` says
// a line is passed through verbatim. A comment that opens and closes on one line is a mark inside the line when the
// line holds other text, and a block when it does not; one that runs over lines is a block. Returns the strips' shape
// with `from` null.
function markComments(markdown, mark, scan, skip, unclosedWarning) {
  const lines = String(markdown || '').split('\n');
  const out = [];
  const warnings = [];
  const label = 'comment';
  let inComment = false;
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    if (!inComment && skip(line, n)) { out.push(line); continue; }
    const scanned = scan(line, inComment);
    const pieces = scanned.pieces;
    inComment = scanned.inComment;
    if (!pieces.some((p) => p.open || p.close)) { out.push(line); continue; }
    const outside = pieces.some((p) => p.text !== undefined && !p.content && p.text.trim() !== '');
    // A pair on this line: inline when other text is on the line; its text is trimmed.
    let openAt = null;
    pieces.forEach((p, k) => {
      if (p.open) openAt = k;
      else if (p.close) {
        if (openAt !== null && outside) {
          pieces[openAt].inline = true;
          p.inline = true;
          pieces.slice(openAt + 1, k).forEach((c) => { if (c.content) c.text = c.text.trim(); });
        }
        openAt = null;
      }
    });
    emitMarkedParts(pieces, 'comments', label, mark, out);
  }
  if (inComment) {
    blockLines(mark.marks.close()).forEach((t) => out.push(t));
    warnings.push(unclosedWarning);
  }
  return { text: out.join('\n'), warnings, lines: out, from: null, strays: [] };
}

function htmlCommentsMarking(markdown, mark) {
  let fenceDelim = null;
  const skip = (line) => {
    const step = fenceStep(line, fenceDelim);
    fenceDelim = step.fenceDelim;
    return fenceDelim !== null || step.isFenceLine;
  };
  const scan = (line, inComment) => {
    const pieces = [];
    let i = 0;
    while (i < line.length) {
      if (inComment) {
        const end = line.indexOf('-->', i);
        if (end === -1) { pieces.push({ text: line.slice(i), content: true }); i = line.length; break; }
        pieces.push({ text: line.slice(i, end), content: true }, { close: true });
        inComment = false;
        i = end + 3;
      } else {
        const start = line.indexOf('<!--', i);
        if (start === -1) { pieces.push({ text: line.slice(i) }); break; }
        pieces.push({ text: line.slice(i, start) }, { open: true });
        inComment = true;
        i = start + 4;
      }
    }
    return { pieces, inComment };
  };
  return markComments(markdown, mark, scan, skip, 'unclosed <!-- comment --> — content kept to end of file');
}

function obsidianCommentsMarking(markdown, mark) {
  const text = String(markdown || '');
  if (!text.includes('%%')) {
    const lines = text.split('\n');
    return { text, warnings: [], lines, from: null, strays: [] };
  }
  let inFence = new Set();
  try { ({ inFence } = findHeadings(text)); } catch (err) { /* no fence is trusted */ }
  const skip = (line, n) => inFence.has(n);
  const scan = (line, inComment) => {
    const pieces = [];
    let buf = '';
    const emitText = () => { pieces.push({ text: buf, content: inComment }); buf = ''; };
    let i = 0;
    while (i < line.length) {
      if (inComment) {
        const end = line.indexOf('%%', i);
        if (end === -1) { buf += line.slice(i); i = line.length; break; }
        buf += line.slice(i, end);
        emitText();
        pieces.push({ close: true });
        inComment = false;
        i = end + 2;
        continue;
      }
      const ch = line[i];
      if (ch === '`') {
        let run = 1;
        while (line[i + run] === '`') run++;
        const close = new RegExp('(?<!`)`{' + run + '}(?!`)').exec(line.slice(i + run));
        const stop = close ? i + run + close.index + run : i + run;
        buf += line.slice(i, stop);
        i = stop;
        continue;
      }
      if (ch === '%' && line[i + 1] === '%') {
        emitText();
        pieces.push({ open: true });
        inComment = true;
        i += 2;
        continue;
      }
      buf += ch;
      i++;
    }
    emitText();
    return { pieces, inComment };
  };
  return markComments(text, mark, scan, skip, 'unclosed %% comment: content kept to end of file');
}

// The hidden markers still in `lines` once the strip chain has run, outside a code block
// that is properly closed. A marker shown in a closed fence is an example and is meant to
// print; any other one left is a marker a strip did not obey, because a fence above it never
// closed (or closed in a way one of the strips does not read as closing), and the text it
// should hide is published. Fences are the renderer's parser's (findHeadings).
// Each: { at (index in `lines`), marker, fenceAt (the fence line above, or null) }.
const SHOWN_BLOCK_MARKER_RE = markerPattern(undefined, '');
const SHOWN_HTML_MARKER_RE = new RegExp(SHOWN_BLOCK_MARKER_RE.source + '|<!--', 'i');
const SHOWN_MARKER_RE = new RegExp(SHOWN_HTML_MARKER_RE.source + '|%%', 'i');
const FENCE_LOOK_RE = /^\s*(`{3,}|~{3,})/;
// `blocksOnly`: the gm-only and spoiler markers alone, for the lines as the two block strips
// leave them (the comment strip that runs next reads a fence its own way and can cut a
// marker those strips did not obey, leaving the text it wraps).
function markersShown(lines, blocksOnly = false) {
  if (!lines.some(l => (blocksOnly ? SHOWN_BLOCK_MARKER_RE.test(l) : l.includes('%%') || l.includes('<!--')))) return [];
  let fences;
  // A note the parser cannot read publishes no body (the section filter withholds it).
  try { ({ fences } = findHeadings(lines.join('\n'))); } catch (err) { return []; }
  const closed = new Set();
  const openOf = new Map();   // line -> the first line of the unclosed fence it is in
  for (const f of fences) {
    for (let l = f.start; l < f.end; l++) {
      if (f.closed) closed.add(l); else openOf.set(l, f.start);
    }
  }
  const unclosed = fences.filter(f => !f.closed).map(f => f.start);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (closed.has(i) || openOf.get(i) === i) continue;
    // A `%%` the strip left outside a fence is in an inline code span, which is literal.
    const m = (blocksOnly ? SHOWN_BLOCK_MARKER_RE : openOf.has(i) ? SHOWN_MARKER_RE : SHOWN_HTML_MARKER_RE).exec(lines[i]);
    if (!m) continue;
    let fenceAt = openOf.has(i) ? openOf.get(i) : null;
    if (fenceAt === null) {
      const above = unclosed.filter(l => l < i);
      if (above.length) fenceAt = above[above.length - 1];
      else for (let l = i - 1; l >= 0 && fenceAt === null; l--) if (FENCE_LOOK_RE.test(lines[l])) fenceAt = l;
    }
    out.push({ at: i, marker: m[2] ? m[2].toLowerCase() : (m[0] === '%%' ? '%%' : '<!--'), fenceAt });
  }
  return out;
}

// What the strip chain found that changes what the site shows, for the note-faults audit:
// each stray `%%` that hides text the page would otherwise print, and the first hidden marker
// the page prints because a code fence above it never closed. `keptOf(lines)` says, per line,
// whether the page's own section rules keep it; a fault that lies wholly in text those rules
// hide already changes nothing on the site and is not reported.
// Returns { strays: [{ line, kind }], openFence: { line, marker, markerLine } | null }, in
// lines of the text the chain was given (`line` is null for a marker with no fence above it).
function noteFacts(stripped, keptOf) {
  const out = { strays: [], openFence: null };
  if (stripped.strays.length > 0) {
    // Read as if no `%%` were a comment: the text the chain was about to cut.
    const { lines, spans } = stripped.pre;
    const kept = keptOf(lines);
    stripped.strays.forEach((stray, k) => {
      const [at, endAt] = spans[k];
      const stop = endAt === null ? lines.length - 1 : endAt;
      for (let i = at; i <= stop; i++) {
        if (kept[i] && lines[i].trim() !== '') { out.strays.push(stray); return; }
      }
    });
  }
  // Markers left once the block strips have run, and once the whole chain has: the first, by
  // its line in the note, that sits in text the page keeps.
  const stages = [stripped.blocks, { lines: stripped.lines, from: stripped.from, shown: markersShown(stripped.lines) }];
  for (const stage of stages) {
    if (!stage || stage.shown.length === 0) continue;
    const kept = keptOf(stage.lines);
    const first = stage.shown.find(m => kept[m.at]);
    if (!first) continue;
    const found = {
      line: first.fenceAt === null ? null : stage.from[first.fenceAt],
      marker: first.marker,
      markerLine: stage.from[first.at],
    };
    if (out.openFence === null || found.markerLine < out.openFence.markerLine) out.openFence = found;
  }
  return out;
}

// Per line of `lines`, whether the section filter keeps it (filterSections' own walk).
function keptFlags(lines, excludeSections, frontmatter, rules) {
  const flags = lines.map(() => false);
  for (const i of walkSections(lines.join('\n'), excludeSections, frontmatter, rules || {}).keptAt) flags[i] = true;
  return flags;
}

// Strip a single leading H1 from the markdown body. Templates inject their own H1
// from the page title, so the author's `# Title` line at the top would render as a duplicate.
function stripLeadingH1(markdown) {
  const lines = markdown.split('\n');
  let i = 0;
  // Skip leading blank lines
  while (i < lines.length && lines[i].trim() === '') i++;
  // If the first non-blank line is an H1, remove it
  if (i < lines.length && /^#\s+/.test(lines[i])) {
    lines.splice(i, 1);
  }
  return lines.join('\n');
}

// Whether the line stripLeadingH1 would drop is one the exclude list withholds, by the
// walk's own verdict, so the page and everything else that asks the walk agree.
function leadingH1Withheld(markdown, excludeSections, frontmatter) {
  const lines = markdown.split('\n');
  const first = lines.findIndex((line) => line.trim() !== '');
  if (first === -1 || !/^#\s+/.test(lines[first])) return false;
  // Only blank lines stand above it, so the walk's verdict on this line is settled by the
  // block it opens (to the next blank line): the walk is asked about the note up to there,
  // not the whole of it.
  let end = first + 1;
  while (end < lines.length && lines[end].trim() !== '') end++;
  return walkExcludeList(lines.slice(0, end + 1), excludeSections, frontmatter, {}).withheldBy[first] !== null;
}

const IMAGE_EXT_REGEX = /\.(jpe?g|png|webp|gif|svg)$/i;

// Percent-encode each path segment of an output-path-derived href/src. A destination
// containing a raw space — which vault attachments and subfolder names routinely do
// ("Brass Compass.png", "Sessions/Session 02/") — is not a valid markdown or HTML
// destination: markdown-it emits the whole `[text](path)`/`![alt](path)` as literal text
// and the typographer then rewrites a leading `../` into a `…/` ellipsis. Parens are
// encoded too: markdown-it only tolerates balanced ones inside a destination.
//
// Generalized from the image-only `encodeImageUrl` (#145) — every hand-built href or
// markdown-destination that interpolates a computed output path routes through this one
// helper, so a future render path can't reintroduce the same bug in a new file.
function encodeHref(hrefPath) {
  return String(hrefPath)
    .split('/')
    .map(segment => encodeURIComponent(segment).replace(/\(/g, '%28').replace(/\)/g, '%29'))
    .join('/');
}

// An address the GM wrote for a place on the site: the path part is encoded as encodeHref does, and a `?query`
// or `#fragment` after it is kept as written (the caller escapes it for HTML).
function encodeAddress(address) {
  const text = String(address);
  const cut = text.search(/[?#]/);
  return cut < 0 ? encodeHref(text) : encodeHref(text.slice(0, cut)) + text.slice(cut);
}

// Alias retained for the image call sites that already named it this way.
const encodeImageUrl = encodeHref;

// The campaign picture's address as a page prints it: a web address keeps its shape (spaces aside), a picture
// copied into the site is encoded like every other picture address. Landing and 404 pages share this.
function campaignImageSrc(address) {
  const text = String(address);
  return /^https?:\/\//i.test(text) ? text.replace(/ /g, '%20') : encodeImageUrl(text);
}

function resolveImageEmbeds(markdown, imageMap, currentOutputPath, usedImages, options = {}) {
  // The entity's `portrait:` frontmatter. An inline embed of the same file exists so the
  // image shows in Obsidian's reading view; on the site the portrait already displays it,
  // so the inline copy is dropped rather than duplicated.
  //
  // Safe because every entity template renders `portrait:` (world-domain.js was the last
  // holdout). A new template that skips the portrait must not be given a portraitBasename.
  const portrait = options.portraitBasename;
  // NFC throughout (#139): the `portrait:` value, the embed text, and the imageMap keys are
  // authored in three different places and need not agree on normal form. Comparing the
  // embed against the portrait — and registering it in usedImages, which build.js matches
  // against imageMap's own keys when pruning in player mode — must use the canonical form,
  // or a resolved image is dropped from the copy pass and renders as a broken <img>.
  const portraitKey = portrait ? canonicalNfc(portrait) : null;
  const dedupeKey = portraitKey && imageMap[portraitKey] ? portraitKey.toLowerCase() : null;

  // Match ![[filename.ext]] or ![[filename.ext|alt text]]
  return markdown.replace(new RegExp('!' + wikilinkRe().source, 'g'), (match, body) => {
    const { raw: target, display: alt } = parseWikilink(body);
    const basename = target.trim();
    if (!IMAGE_EXT_REGEX.test(basename)) return match; // not an image, leave as-is

    const key = canonicalNfc(basename);
    const entry = imageMap[key];
    if (!entry) {
      console.warn(`processor: image embed not found — "${basename}" (${currentOutputPath})`);
      return '';
    }

    if (usedImages) usedImages.add(key);
    if (dedupeKey && key.toLowerCase() === dedupeKey) return '';

    // Output goes to docs/images/{relPath}. Compute relative path from current page.
    const currentDir = currentOutputPath.substring(0, currentOutputPath.lastIndexOf('/'));
    const imgPath = 'images/' + entry.relPath;
    const relativeImgPath = encodeImageUrl(relativePath(currentDir, imgPath));
    const rawAlt = alt || basename.replace(IMAGE_EXT_REGEX, '').replace(/[-_]/g, ' ');
    const altText = rawAlt.replace(/[[\]]/g, '\\$&');
    return `![${altText}](${relativeImgPath})`;
  });
}

// Render a frontmatter-derived display value (summary, occupation, …) as HTML, resolving
// any `[[wikilink]]` it carries the way body prose does. Everything else is escaped.
function renderMetaValue(raw, linkMap = {}, currentOutputPath = '') {
  const text = valueText(raw);
  const out = [];
  const pattern = wikilinkRe();
  let last = 0;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    out.push(escapeHtml(text.slice(last, match.index)));
    const { target, label } = parseWikiRef(match[0]);
    const targetPath = linkMap[target];
    out.push(targetPath
      ? `<a href="${encodeHref(relativeHref(currentOutputPath, targetPath))}" class="entity-link">${escapeHtml(label)}</a>`
      : escapeHtml(label));
    last = match.index + match[0].length;
  }
  out.push(escapeHtml(text.slice(last)));
  return out.join('');
}

// Plain-text form of the above, for values rendered inside an enclosing <a> (card
// subtitles, landing tiles) where a nested anchor would be invalid HTML.
function plainMetaValue(raw) {
  return valueText(raw)
    .replace(wikilinkRe(), (m) => parseWikiRef(m).label);
}

// A header value that names a page (an item's holder, a faction's leader, an event's place):
// either a bare name or one wikilink spanning the whole value (a reference), or running
// text with wikilinks inside it. A reference links to its page when the site has one;
// running text shows each link as its label. The text a reader sees is plainRefValue.
function wholeReference(text) {
  if (!text.includes('[[')) return true;
  const m = wikilinkRe('').exec(text);
  return Boolean(m) && m.index === 0 && m[0].length === text.length;
}

// The target and label of a whole-reference value. Only a bracketed `[[…]]` goes through the
// wikilink parser (which reads `#`, `^` and `|`); a bare value is a name as written.
function referenceParts(text) {
  return text.includes('[[') ? parseWikiRef(text) : { target: text, label: humanizeName(text) };
}

// What a reference value names: { target, label } for a whole reference (target is the
// link-map name), { target: '', label } for running text (nothing to link to), null when empty.
// The one definition the page headers, the location breadcrumb and the preview cards share.
function referenceOf(raw) {
  const text = valueText(raw).trim();
  if (!text) return null;
  return wholeReference(text) ? referenceParts(text) : { target: '', label: plainMetaValue(text) };
}

// The frontmatter fields whose value is a note's name, bare or in a wikilink, wherever a
// header prints them: the type badges (found_by, author, location, origin) and the fields
// the templates print as references (leadership, territory, current_holder, parent_location).
// Every other field is free text, a number, a date or an enum, and prints as written.
const NOTE_NAME_FIELDS = new Set(['found_by', 'author', 'location', 'origin', 'leadership', 'territory', 'current_holder', 'parent_location']);

function plainRefValue(raw) {
  const ref = referenceOf(raw);
  return ref ? ref.label : '';
}

function refMetaValue(raw, linkMap = {}, currentOutputPath = '') {
  const text = valueText(raw).trim();
  if (!text) return '';
  if (!wholeReference(text)) return renderMetaValue(text, linkMap, currentOutputPath);
  const { target, label } = referenceParts(text);
  const targetPath = (linkMap || {})[target];
  return targetPath
    ? `<a href="${encodeHref(relativeHref(currentOutputPath, targetPath))}">${escapeHtml(label)}</a>`
    : escapeHtml(label);
}

function separateBoldLabelLines(markdown) {
  const lines = markdown.split('\n');
  const result = [];
  const boldStart = /^\*\*[^*]+\*\*/;
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith('```')) inFence = !inFence;
    result.push(lines[i]);
    if (!inFence &&
        boldStart.test(lines[i].trim()) &&
        i + 1 < lines.length &&
        boldStart.test(lines[i + 1].trim())) {
      result.push('');
    }
  }
  return result.join('\n');
}

// A page's reader-visible source: the gm-only/spoiler/excluded-section-stripped view that
// build.js precomputes, falling back to raw markdown for pages it never saw (story units,
// test doubles). Everything derived from prose — backlinks, search, recency, excerpts —
// must read through this, or unpublished content leaks into a derived widget (B6).
function publishedSource(page) {
  if (!page) return '';
  return page.publishedMarkdown != null ? page.publishedMarkdown : (page.markdown || '');
}

// A session index (`type: session`), the hub of the session document chain. Whether its
// body publishes is session-hub.js's call (#276).
function isSessionHub(page) {
  return !!(page && page.frontmatter && page.frontmatter.type === 'session');
}

function portraitBasename(frontmatter) {
  const portrait = frontmatter && frontmatter.portrait;
  return portrait ? String(portrait).split('/').pop() : null;
}

// The player-safe strip chain: everything a reader must never see, removed, with
// nothing renderer-specific done yet. This is the ONE definition of that chain —
// build.js's PC path and the `sheet show --player-safe` CLI both call it, so a
// strip step added here reaches both. They used to be hand-copies of each other,
// which meant the CLI's "this is what a player sees" promise was only as true as
// somebody's memory to update two files.
//
// Deliberately excluded from this helper, because they are not part of "what a
// player may see": stripLeadingH1 (a page-template concern — the CLI's text view
// must keep the H1), wikilink/image resolution, and section extraction.
// Returns { text, warnings } — warnings are the strip functions' own
// (unclosed markers), for the caller to log wherever its warnings go.
function playerSafeMarkdown(markdown, options = {}) {
  if (options.mark) return markedSafeMarkdown(markdown, options);
  const stripped = strippedLines(String(markdown == null ? '' : markdown).replace(/\r/g, ''), options.excludeCallouts);
  const { warnings } = stripped;
  let text = stripped.lines.join('\n');
  text = filterSections(text, options.excludeSections, options.frontmatter,
    { pcKeepSections: options.pcKeepSections, warn: (m) => warnings.push(m) });
  // The chain's faults that show on this page (noteFacts), by the same section rules.
  const { strays, openFence } = noteFacts(stripped, (lines) => keptFlags(lines, options.excludeSections, options.frontmatter,
    { pcKeepSections: options.pcKeepSections }));
  return { text, warnings, strays, openFence };
}

// playerSafeMarkdown for the GM site. The PC and NPC templates cut a page at its `##` headings, so no mark may span
// one: marksAtHeadings closes and reopens the marks there, by the heading finder extractSections uses. The sections
// are filtered with the mark too, so the hidden sections are kept and marked.
function markedSafeMarkdown(markdown, options) {
  const stripped = strippedLines(String(markdown == null ? '' : markdown).replace(/\r/g, ''), options.excludeCallouts, options.mark);
  const { warnings } = stripped;
  let text = stripped.lines.join('\n');
  text = filterSections(text, options.excludeSections, options.frontmatter,
    { pcKeepSections: options.pcKeepSections, warn: (m) => warnings.push(m), mark: options.mark });
  try { text = marksAtHeadings(text, findHeadings); } catch (err) { warnings.push('could not parse the note\'s headings; a mark may run across them'); }
  return { text, warnings, strays: [], openFence: null };
}

// Whatever a strip cut, the lines around the cut must mean what they did: a paragraph line,
// something cut whole, then a `---` / `===` line would join into a Setext heading. A blank
// line, mapped to the first line cut, keeps them apart. One rule for every strip.
function keepApart(lines, from) {
  for (let k = lines.length - 2; k >= 0; k--) {
    if (from[k + 1] > from[k] + 1 && setextRisk(lines[k], lines[k + 1])) {
      lines.splice(k + 1, 0, '');
      from.splice(k + 1, 0, from[k] + 1);
    }
  }
}

// The strips of playerSafeMarkdown, in its order, before any section is filtered: the
// lines left, `from` (the line of `text` each came from) and the strips' warnings.
// playerSafeMarkdown and the stub cut both take this, so the cut cannot be made on a
// different reading of what is hidden.
// With `mark` ({ marks, show }), the GM site's version (markedStrippedLines).
function strippedLines(text, excludeCallouts, mark) {
  if (mark) return markedStrippedLines(text, excludeCallouts, mark);
  const warnings = [];
  let lines = null;
  let from = null;
  // Every stray %% the comment strip met, mapped to lines of `text`, and `pre`: the lines
  // that strip was given and where each stray opens and closes in them (noteFacts reads both).
  let strays = [];
  let pre = null;
  let blocks = null;   // a gm-only or spoiler marker the block strips left: { lines, from, shown }
  const strips = [
    dataviewLines,
    (t) => markedBlocks(t, 'gm-only'),
    (t) => markedBlocks(t, 'spoiler'),
    htmlComments,
    obsidianComments,
    (t) => calloutLines(t, excludeCallouts),
  ];
  for (const [step, strip] of strips.entries()) {
    // Nothing is left: no step has anything to do, and a join/split would invent a line.
    if (lines !== null && lines.length === 0) break;
    if (step === 3) {
      const shown = markersShown(lines, true);
      if (shown.length > 0) blocks = { lines, from, shown };
    }
    const before = from;
    const given = lines;
    const result = strip(lines === null ? text : lines.join('\n'));
    from = before === null ? result.from : result.from.map(i => before[i]);
    lines = result.lines;
    keepApart(lines, from);
    if (result.warnings) warnings.push(...result.warnings);
    if (result.strays && result.strays.length > 0) {
      strays = result.strays.map(s => ({ line: before[s.line], kind: s.kind }));
      pre = { lines: given, spans: result.strays.map(s => [s.line, s.end]) };
    }
  }
  return { lines, from, warnings, strays, pre, blocks };
}

// The strip chain for the GM site: the note's own private-use characters become U+FFFD first (a note cannot forge a
// mark), the dataview strip runs as today (never marked), then each strip is given the mark. Lines are kept, so
// there is no `from`; the note-faults facts (strays, pre, blocks) belong to the player build.
// `mark.sanitized`: the GM build sanitized every note once, when it was read, and has since put marks of its own
// into the text (a secret alias, a stub's cut); those are kept.
function markedStrippedLines(text, excludeCallouts, mark) {
  const warnings = [];
  let lines = null;
  const clean = mark.sanitized ? (t) => t : sanitize;
  const strips = [
    dataviewLines,
    (t) => markedBlocks(t, 'gm-only', mark),
    (t) => markedBlocks(t, 'spoiler', mark),
    (t) => htmlComments(t, mark),
    (t) => obsidianComments(t, mark),
    (t) => calloutLines(t, excludeCallouts, mark),
  ];
  for (const strip of strips) {
    if (lines !== null && lines.length === 0) break;
    const result = strip(lines === null ? clean(text) : lines.join('\n'));
    lines = result.lines;
    // A strip that still cuts (its kind is off) keeps a Setext line apart, as the player strip does.
    if (result.from) keepApart(lines, result.from);
    if (result.warnings) warnings.push(...result.warnings);
  }
  return { lines, from: null, warnings, strays: [], pre: null, blocks: null };
}

const HEADINGS_UNSTABLE_WARNING = 'a link or embed label changes this note\'s headings; nothing after its title is published while character sheets are off. Fix the label.';

// The level 1-2 top-level headings of a text, as `level:bare title` (the note's own
// first heading, when it is a title, by level only: a title may carry a link).
function headingShape(text, titleFirst) {
  const shape = [];
  let first = true;
  for (let t = 0, tokens = md.parse(text, {}); t < tokens.length; t++) {
    const tok = tokens[t];
    if (tok.type !== 'heading_open' || tok.level !== 0) continue;
    const level = Number(tok.tag.slice(1));
    if (level > 2) continue;
    const inline = tokens[t + 1];
    const isTitle = titleFirst && first && level === 1;
    first = false;
    shape.push(isTitle ? '1:' : `${level}:${bareSectionTitle(inline ? inline.content : '')}`);
  }
  return shape.join('\n');
}

// Whether the pre-render transforms (image embeds, wikilinks, bold-label spacing) would
// create or remove a top-level heading in a PC note's raw-kept text. Such a note's
// heading structure is not what the keep-list judged, so the build withholds its whole
// body from EVERY output (page, sections, search/backlink text). Deliberately blunt:
// explain, site-doctor and `sheet show --player-safe` report the raw-text decision only,
// so for an unstable note the build withholds more than they say, never less.
// Two pipelines are checked, the page's (title stripped, bold spacing) and the sheet
// sections' (title kept). Any failure to parse counts as unstable.
function pcHeadingsUnstable(page, linkMap, excludeSections, imageMap, options = {}) {
  const fm = page.sourceFrontmatter || page.frontmatter;
  if (!pcKeepRuleApplies(fm, { pcKeepSections: options.pcKeepSections })) return false;
  const base = playerSafeMarkdown(page.markdown || '', { excludeCallouts: options.excludeCallouts }).text;
  const transform = (text) => {
    // A missing image embed warns; this is a dry run, so it must stay quiet and leave usedImages alone.
    const warn = console.warn;
    console.warn = () => {};
    try {
      const withImages = resolveImageEmbeds(text, imageMap || {}, page.outputPath || '', new Set(), { portraitBasename: portraitBasename(page.frontmatter) });
      return resolveWikiLinks(withImages, linkMap || {}, page.outputPath || '');
    } finally { console.warn = warn; }
  };
  const variants = [
    { text: stripLeadingH1(base), stripped: true, spaced: true },
    { text: base, stripped: false, spaced: false },
  ];
  try {
    for (const v of variants) {
      const rules = { pcKeepSections: options.pcKeepSections, titleStripped: v.stripped };
      const kept = filterSections(v.text, excludeSections, fm, rules);
      const after = transform(v.spaced ? separateBoldLabelLines(kept) : kept);
      if (filterSections(after, excludeSections, fm, rules) !== after) return true;
      if (headingShape(after, !v.stripped) !== headingShape(kept, !v.stripped)) return true;
    }
  } catch (err) {
    return true;
  }
  return false;
}

// The GM site's body of a PC note whose headings a link label changes (the player site shows none of it): the whole
// text in one `sections` mark, or nothing when that kind is not shown. `close` (default true) closes and reopens the
// mark at each level 1-2 heading, as the templates cut there; processContent does that itself, after its own filter.
function unstableBodyMarked(markdown, mark, { close = true } = {}) {
  if (!mark.show.has('sections')) return '';
  const wrapped = [...blockLines(mark.marks.open('sections', 'note body (a link label changes its headings)')), markdown, ...blockLines(mark.marks.close())].join('\n');
  if (!close) return wrapped;
  try { return marksAtHeadings(wrapped, findHeadings); } catch (err) { return wrapped; }
}

function processContent(page, linkMap, excludeSections, imageMap = {}, options = {}) {
  const warnings = [];
  // The strip chain is strippedLines', whole: the page, the published view the search and
  // the cards read, the stub cut and the CLIs all take the same one.
  const mark = options.mark;
  const stripped = strippedLines(page.markdown.replace(/\r/g, ''), options.excludeCallouts, mark);
  warnings.push(...stripped.warnings);
  let markdown = stripped.lines.join('\n');
  // A note whose title line is itself withheld (`# GM Notes`) has that section
  // removed before the title is dropped: once the line is gone nothing below would
  // know its section had started, and the body used to publish.
  // On the GM site that section is kept: the title line stays where the section filter below marks it
  // (marking it here as well would mark it twice).
  const fm = page.sourceFrontmatter || page.frontmatter;
  const titleWithheld = leadingH1Withheld(markdown, excludeSections, fm);
  if (titleWithheld && !mark) {
    markdown = walkExcludeList(markdown.split('\n'), excludeSections, fm, { warn: (m) => warnings.push(m) }).kept.join('\n');
  }
  if (!(mark && titleWithheld)) markdown = stripLeadingH1(markdown);
  // The PC keep-list is decided here, on the raw note, before any transform: the same
  // text publishedMarkdown, explain and the doctor walk. A note whose headings the
  // transforms below would change is withheld whole (pcHeadingsUnstable).
  const keepRules = { pcKeepSections: options.pcKeepSections, titleStripped: true, warn: (m) => warnings.push(m) };
  let unstable = false;
  if (options.pcKeepSections && page.headingsUnstable === undefined) {
    unstable = pcHeadingsUnstable(page, linkMap, excludeSections, imageMap, options);
    if (unstable) warnings.push(HEADINGS_UNSTABLE_WARNING);
  } else if (page.headingsUnstable) {
    unstable = true;   // decided up front by the build, which has already said so
  }
  if (mark) {
    if (unstable) {
      markdown = unstableBodyMarked(markdown, mark, { close: false });
    } else {
      markdown = filterSections(markdown, excludeSections, page.sourceFrontmatter || page.frontmatter, { ...keepRules, mark });
    }
    // No mark spans a level 1-2 heading: the templates cut the page there.
    try { markdown = marksAtHeadings(markdown, findHeadings); } catch (err) { warnings.push('could not parse the note\'s headings; a mark may run across them'); }
  } else {
    markdown = unstable ? '' : filterSections(markdown, excludeSections, page.sourceFrontmatter || page.frontmatter, keepRules);
  }
  markdown = separateBoldLabelLines(markdown);
  markdown = resolveImageEmbeds(markdown, imageMap, page.outputPath, options.usedImages, {
    portraitBasename: portraitBasename(page.frontmatter),
  });
  markdown = resolveWikiLinks(markdown, linkMap, page.outputPath);
  // The renderer widens a table whose row has more cells than its header (nothing is lost);
  // say so, once per table, so the GM can give the extra column a header.
  const env = {};
  const html = md.render(markdown, env);
  for (const t of env.widenedTables || []) {
    const first = String(t.first || '').replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').trim();
    const named = first ? ` (first: "${first.length > 40 ? first.slice(0, 39) + '…' : first}")` : '';
    warnings.push(`a table has ${t.rows} ${t.rows === 1 ? 'row' : 'rows'} with more cells than its ${t.header}-column header${named}; the table was widened to ${t.cells} columns so no cell is lost. Add header cells for the extra columns.`);
  }
  return { html, warnings };
}

// Extract ## sections for accordion rendering (used by PC/NPC templates). The
// boundaries are the renderer's top-level level 2 headings, so a `## line` shown in a
// code block stays inside its section.
function extractSections(markdown) {
  const lines = markdown.replace(/\r/g, '').split('\n');
  let headingAt;
  try {
    ({ headingAt } = findHeadings(lines.join('\n')));
  } catch (err) {
    return [];
  }
  const sections = [];
  let current = null;

  for (let i = 0; i < lines.length; i++) {
    const h = headingAt.get(i);
    // A bare `##` renders as an empty heading; it is not a section of its own.
    if (h && !h.nested && h.level === 2 && h.title !== '') {
      if (current) sections.push(current);
      current = { title: h.title, lines: [] };
      i = h.end - 1;
    } else if (current) {
      current.lines.push(lines[i]);
    }
  }
  if (current) sections.push(current);

  return sections.map(s => ({
    title: s.title,
    id: s.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    html: md.render(s.lines.join('\n')),
  }));
}

function filterFields(frontmatter, excludeFields = [], overrides = {}) {
  const filtered = { ...frontmatter };
  const reInclude = overrides.include || [];
  for (const field of excludeFields) {
    if (reInclude.includes(field)) continue;
    delete filtered[field];
  }
  return filtered;
}

// How much of a file to publish, from its own `publish:` frontmatter key.
// 'all' (default), 'stub' (page shell, body suppressed), 'none' (no page).
// Absent/true/anything unrecognized means 'all' — a typo must not silently
// unpublish a page. A value that says no is read in any capitals and trimmed
// (`False`, `None`), and a list is read item by item: any item that says no
// wins over the rest, as does `stub` over `all`. Reading more of these as a
// no only ever shows less. skills/shared/scripts/vaultlib.py `publish_mode`
// is this function; test/fixtures/publish-mode-vectors.json pins both.
function publishMode(frontmatter) {
  const raw = frontmatter && frontmatter.publish;
  const items = (Array.isArray(raw) ? raw.flat(Infinity) : [raw])
    .map((v) => (typeof v === 'string' ? v.trim().toLowerCase() : v));
  if (items.some((v) => v === false || v === 'false' || v === 'none')) return 'none';
  if (items.includes('stub')) return 'stub';
  return 'all';
}

// The GM-only marker on a single relationship edge. Frontmatter carries no
// body prose, so `<!-- gm-only -->` has no meaning here — an edge whose very
// existence is the secret (a "loyal escort" who `serves` the cult leader)
// needs its own flag. The YAML reader gives `yes` and `on` as strings and a
// GM may quote or pad any of them, so the flag hides the edge for true, the
// number 1, and the words true, yes, on and 1, trimmed and in any capitals.
// Reading more of these as a yes only ever shows less.
// skills/shared/scripts/vaultlib.py `gm_only_hides` is this function;
// test/fixtures/gm-only-vectors.json pins both.
function isGmOnlyEdge(rel) {
  return flagIsYes(rel && rel.gm_only);
}

// How a yes/no flag in frontmatter is read, for `gm_only` and `withheld` alike (above).
// A word that reads as the number 1 (`1.0`, `01`, `+1`) is a yes too: the Python scripts see
// the raw line, where YAML would have made it the number 1. test/fixtures/gm-only-vectors.json.
function flagIsYes(v) {
  if (v === true || v === 1) return true;
  if (typeof v !== 'string') return false;
  const t = v.trim().toLowerCase();
  return SWITCH_WORDS.get(t) === true || /^\+?0*1(?:\.0*)?$/.test(t);
}

// `withheld: true` on a note: its own name is a secret (#291). Read as `gm_only` is read.
// skills/shared/scripts/vaultlib.py `is_withheld` is this function.
function isWithheld(frontmatter) {
  return flagIsYes(frontmatter && frontmatter.withheld);
}

// What an unlabelled link to a withheld page prints in place of the page's name, by the
// kind of note it is: "She met someone at the quay", "Part of something". `words` is the site's
// `withheld_words` setting ({ person, place, thing }), so the words are chosen in one place.
const WITHHELD_WORD_OF = { npc: 'person', pc: 'person', location: 'place' };
function withheldPlaceholder(type, words) {
  const t = String(type == null ? '' : type).trim().toLowerCase();
  return words[Object.prototype.hasOwnProperty.call(WITHHELD_WORD_OF, t) ? WITHHELD_WORD_OF[t] : 'thing'];
}

// One page's frontmatter as a reader may see it. Everything derived from
// frontmatter — Connections, backlinks, the search index, sheet
// meta rows — must be built from THIS, never from the raw frontmatter.
//
// Three layers, in order:
//   1. edges marked `gm_only: true` are dropped
//   2. the file's own `publish_exclude_fields` is merged over the global
//      `exclude_fields` — per-file, because excluding `occupation` campaign-
//      wide to hide one traitor strips it from every honest NPC too
//   3. the existing per-file `include` override can re-admit a field
function publishedFrontmatter(frontmatter, excludeFields = [], overrides = {}) {
  const fm = { ...frontmatter };

  if (Array.isArray(fm.relationships)) {
    const visible = fm.relationships.filter(r => !isGmOnlyEdge(r));
    if (visible.length > 0) fm.relationships = visible;
    else delete fm.relationships;
  }

  const filtered = filterFields(fm, excludeFields, overrides);

  // Applied AFTER, and deliberately not subject to `overrides.include`: the
  // file's own "hide this" outranks a config-level re-include. The config is a
  // campaign-wide default; the frontmatter is the GM saying it about this
  // specific secret. Where they disagree, hiding wins.
  const perFile = Array.isArray(fm.publish_exclude_fields) ? fm.publish_exclude_fields : [];
  for (const field of perFile) {
    if (typeof field === 'string') delete filtered[field];
  }
  // The control fields are bookkeeping, never reader-facing.
  delete filtered.publish;
  delete filtered.publish_exclude_fields;
  delete filtered.publish_include_sections;

  // `gm_aliases` resolve links and are never shown (#212). A GM on Obsidian
  // may list the same name under `aliases` too, since Obsidian only resolves
  // links through `aliases`, so a GM alias is also removed from that list.
  const secret = new Set(gmAliasList(frontmatter).map(gmAliasKey));
  delete filtered.gm_aliases;
  // `withheld` is the note's own flag for the build; nothing on the site says a note has it.
  delete filtered.withheld;
  if (Array.isArray(filtered.aliases) && secret.size > 0) {
    const shown = filtered.aliases.filter(a => !secret.has(gmAliasKey(a)));
    if (shown.length > 0) filtered.aliases = shown;
    else delete filtered.aliases;
  }
  return filtered;
}

// What `publishedFrontmatter` takes out of one note's frontmatter, for the GM site's "Hidden from players" panel:
// [{ kind: 'fields' | 'relationships', label, name, value }], in the input's key order. It is the difference between
// the input and `publishedFrontmatter`'s output, so the rule is not written twice. The bookkeeping keys are not listed.
const BOOKKEEPING_KEYS = new Set(['publish', 'publish_exclude_fields', 'publish_include_sections', 'withheld']);
function hiddenFieldsOf(frontmatter, excludeFields = [], overrides = {}) {
  const fm = frontmatter || {};
  const out = publishedFrontmatter(fm, excludeFields, overrides);
  // The same note with nothing the secret-name and GM-only-edge steps remove: a key still missing from this was
  // taken out by a field rule (a name in the exclude lists), not by one of those steps.
  const probe = { ...fm };
  delete probe.gm_aliases;
  if (Array.isArray(fm.relationships)) probe.relationships = [{ target: '' }];
  const ruled = publishedFrontmatter(probe, excludeFields, overrides);
  const field = (name, value, label = `field: ${name}`) => ({ kind: 'fields', label, name, value });
  const hidden = [];
  // A value with nothing in it (a template's `secrets: ""`) hides nothing: it is not listed.
  const blank = (v) => v == null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.every(blank))
    || (typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) && Object.values(v).every(blank));
  for (const key of Object.keys(fm)) {
    if (BOOKKEEPING_KEYS.has(key)) continue;
    const value = fm[key];
    if (blank(value)) continue;
    if (key === 'gm_aliases') {
      hidden.push(field('gm_aliases', value));
    } else if (key === 'aliases' && key in ruled) {
      const shown = Array.isArray(out.aliases) ? out.aliases : [];
      const all = Array.isArray(value) ? value : [];
      for (const a of all) if (!shown.includes(a) && !blank(a)) hidden.push(field('aliases', a, 'field: gm_aliases'));
    } else if (key === 'relationships' && Array.isArray(value) && key in ruled) {
      const shown = Array.isArray(out.relationships) ? out.relationships : [];
      for (const edge of value) if (!shown.includes(edge) && !blank(edge)) hidden.push({ kind: 'relationships', label: 'GM-only relationship', name: 'relationships', value: edge });
    } else if (!(key in out)) {
      hidden.push(field(key, value));
    }
  }
  return hidden;
}

// A frontmatter value that is a list of names, or one name written alone: the names, trimmed.
function nameList(v) {
  if (typeof v === 'string') return v.trim() ? [v.trim()] : [];
  return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()) : [];
}

function gmAliasList(frontmatter) {
  const raw = frontmatter && frontmatter.gm_aliases;
  // Hand-edited or older frontmatter may write a single secret as a bare
  // scalar (`gm_aliases: Elias Crowe`) rather than a YAML list. Treat it as a
  // one-item list rather than silently dropping it — an ignored scalar is a
  // secret that ships unhidden.
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    return trimmed ? [trimmed] : [];
  }
  if (!Array.isArray(raw)) return [];
  return raw.map(a => String(a).trim()).filter(Boolean);
}

// How a name is compared against GM aliases: the way Obsidian resolves a link,
// so any spelling that reaches the page in Obsidian is caught here too. NFC,
// case-folded, `_` read as a space.
function gmAliasKey(name) {
  return canonicalNfc(String(name)).replace(/_/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

// Frontmatter fields the renderers resolve as a page name, bare or bracketed.
const GM_ALIAS_NAME_FIELDS = new Set([
  'location', 'parent_location', 'parent', 'part_of', 'leadership', 'territory',
  'current_holder', 'origin', 'first_appearance', 'participants', 'superseded_by',
  'chapter', 'about', 'practitioner', 'found_by', 'author',
]);

// A rewriter that replaces every GM alias with the name of the page that owns
// it (#212), or null when the vault has none. `pages` is every note in the
// vault, published or not (`scanAllNotes` plus the scanned pages): a withheld
// villain's page is the likeliest owner of a secret name, and the rewrite must
// still happen when that page has no URL (the link then renders as its public
// title in plain text).
//
// A GM alias that is also a published page's title or public alias is
// skipped: that name belongs to the other page, and its links stay as they
// are. `published` is the pages the site publishes (default: all of `pages`).
//
// `mark` ({ marks, show }, the GM site): the name a player would not see stays in the text, inside a mark.
// A withheld name is kind `withheld_names` ("players see: someone"); a secret alias is kind `fields`
// ("gm_aliases; players see: <name>"). `published` is then the player site's pages. Without `mark`: as above.
function gmAliasRewriter(pages, published, rawNotes, words, mark) {
  // The words are the site's withheld_words setting, always passed in; a missing set is a mistake in the calling code.
  if (!words || typeof words !== 'object' || ['person', 'place', 'thing'].some((k) => typeof words[k] !== 'string')) {
    throw new Error('gmAliasRewriter was not given the site\'s withheld_words; the caller must pass publishConfig.withheld_words');
  }
  const owners = new Map();
  // Every declared secret key, independent of the owner-collision cleanup
  // below. A link's LABEL (not just its target) can carry a secret verbatim
  // — entity-schema.md tells GMs to list the secret in both `aliases` and
  // `gm_aliases`, so Obsidian autocomplete writes `[[Lord Vane|Elias Crowe]]`
  // (a public target, but a secret label) — and that check has to survive
  // even when `owners` itself no longer has the key (e.g. it collided with
  // some other page's public name and was deleted below).
  const secretKeys = new Set();
  for (const page of pages) {
    for (const key of gmAliasList(page.frontmatter || {}).map(gmAliasKey)) {
      secretKeys.add(key);
      if (!owners.has(key)) owners.set(key, page);
    }
  }
  // Only a published page can claim a name: its title is on the site anyway.
  // An unpublished note named after the secret (a GM's `Elias Crowe.md`)
  // would leave the name showing as plain text, so it never claims it.
  for (const page of published || pages) {
    const fm = page.frontmatter || {};
    const secret = new Set(gmAliasList(fm).map(gmAliasKey));
    owners.delete(gmAliasKey(page.title));
    for (const a of Array.isArray(fm.aliases) ? fm.aliases : []) {
      if (!secret.has(gmAliasKey(a))) owners.delete(gmAliasKey(a));
    }
  }
  // Withheld notes (#291): every name an unlabelled link may reach one by, minus any name a
  // published page answers to (that name is on the site already, and the audit tells it).
  // Every name that reaches one: file name, title, aliases and gm_aliases. key -> the words a
  // link with no label prints. A withheld page that publishes has no secret name to keep.
  const withheldKeys = new Map();
  // The note as written: a scanned page's frontmatter has had a value of the wrong shape (one
  // alias written alone) taken out, and a secret name must not go with it.
  const written = new Map((rawNotes || []).map((n) => [n.sourcePath, n.frontmatter || {}]));
  for (const page of pages) {
    const fm = page.frontmatter || {};
    if (!isWithheld(fm) || (published && published.includes(page))) continue;
    const word = withheldPlaceholder(fm.type, words);
    const raw = written.get(page.sourcePath) || fm;
    for (const name of [page.title, page.displayTitle, typeof fm.title === 'string' ? labelsForLinks(fm.title) : '',
      ...nameList(fm.aliases), ...nameList(raw.aliases), ...gmAliasList(fm)]) {
      if (typeof name === 'string' && name.trim() && !withheldKeys.has(gmAliasKey(name))) withheldKeys.set(gmAliasKey(name), word);
    }
  }
  // The one question every path asks: does this name reach a withheld note? The words to
  // print in its place, or null.
  const placeholderFor = (name) => withheldKeys.get(gmAliasKey(String(name).split('/').pop())) || null;
  if (withheldKeys.size > 0) {
    for (const page of published || pages) {
      const fm = page.frontmatter || {};
      withheldKeys.delete(gmAliasKey(page.title));
      for (const a of Array.isArray(fm.aliases) ? fm.aliases : []) withheldKeys.delete(gmAliasKey(a));
    }
  }
  if (owners.size === 0 && secretKeys.size === 0 && withheldKeys.size === 0) return null;

  // `text` wrapped in a mark of `kind`, or null when the GM site does not show that kind.
  const marked = (kind, label, text) => (mark && mark.show.has(kind) ? `${mark.marks.open(kind, label)}${text}${mark.marks.close()}` : null);
  // A withheld name as the GM sees it: the owner's display title, else the link's own text with `_` read as spaces.
  const withheldName = (owner, text) => (owner ? (owner.displayTitle || owner.title) : String(text).split('/').pop().replace(/_/g, ' '));

  const WIKI = wikilinkRe('g', true);
  function links(text, labelled) {
    return String(text).replace(WIKI, (match, body) => {
      const bang = match.startsWith('!') ? '!' : '';
      const w = parseWikilink(body);
      // The owner is looked up by the name alone (no `.md`, `#heading` or `^block`); the anchor
      // stays on the link.
      const target = w.name;
      const anchor = w.raw.slice(w.target.length);
      const bar = w.escapedPipe ? '\\|' : '|';
      const label = w.display ? bar + w.display : '';
      // A folder path names the note by its last segment (`[[NPCs/Elias Crowe]]`).
      const owner = owners.get(gmAliasKey(target.split('/').pop()));
      const labelIsSecret = !!label && secretKeys.has(gmAliasKey(w.display));
      const hidden = placeholderFor(target);
      // A link with a label of its own prints that label, as it does for any page.
      if (!owner && !labelIsSecret && (!hidden || w.display)) return match;
      // A secret label is never shown, whether or not it names the same page
      // as the target — treat it exactly as an absent label from here on.
      const effectiveLabel = labelIsSecret ? '' : label;
      // An unlabelled link to a withheld page (by any of its names) prints the placeholder,
      // not the page's name.
      if (hidden && !effectiveLabel) {
        const name = marked('withheld_names', `players see: ${hidden}`, withheldName(owner, target));
        return `${bang}[[${owner ? owner.title : target}${anchor || ''}${bar}${name === null ? hidden : name}]]`;
      }
      // The GM site keeps the secret alias, inside a mark that says what players see in its place.
      if (mark && !effectiveLabel) {
        const alias = String(labelIsSecret ? w.display : target).split('/').pop();
        const seen = owner ? (owner.displayTitle || owner.title) : withheldName(null, target);
        const name = marked('fields', `gm_aliases; players see: ${seen}`, alias);
        if (name !== null) return `${bang}[[${owner ? owner.title : target}${anchor || ''}${bar}${name}]]`;
      }
      // In prose, an unlabelled link shows the page's display title rather
      // than its filename. Frontmatter values keep a bare target, because
      // several renderers strip the brackets and look the rest up as-is.
      const shown = !effectiveLabel && labelled && owner && owner.displayTitle && owner.displayTitle !== humanizeName(owner.title)
        ? `${bar}${owner.displayTitle}` : '';
      return `${bang}[[${owner ? owner.title : target}${anchor || ''}${effectiveLabel || shown}]]`;
    });
  }
  // `[[...]]` inside any value, at any depth.
  function linksIn(v) {
    if (typeof v === 'string') return links(v, false);
    if (Array.isArray(v)) return v.map(linksIn);
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      const out = {};
      for (const [k, x] of Object.entries(v)) out[k] = linksIn(x);
      return out;
    }
    return v;
  }
  // A field the renderers resolve as a page name also takes a bare name
  // (`location: Elias Crowe`). Only those fields: a GM alias that happens to
  // be an ordinary word must not rewrite `status:` or `occupation:`.
  function nameIn(v) {
    if (typeof v === 'string') {
      const owner = owners.get(gmAliasKey(v.split('/').pop()));
      // A bare name that is a withheld note's: the page prints the placeholder, as for a link.
      const hidden = placeholderFor(v);
      if (owner && hidden) {
        const name = marked('withheld_names', `players see: ${hidden}`, withheldName(owner, v));
        return `[[${owner.title}|${name === null ? hidden : name}]]`;
      }
      if (owner) return owner.title;
      const bare = v.trim();
      if (bare && !bare.includes('[[') && hidden) {
        const name = marked('withheld_names', `players see: ${hidden}`, withheldName(null, bare));
        return `[[${bare}|${name === null ? hidden : name}]]`;
      }
      return links(v, false);
    }
    if (Array.isArray(v)) return v.map(nameIn);
    return linksIn(v);
  }
  function relationships(v) {
    if (Array.isArray(v)) {
      return v.map(r => (r && typeof r === 'object' && !Array.isArray(r))
        ? Object.assign(linksIn(r), 'target' in r ? { target: nameIn(r.target) } : {})
        : nameIn(r));
    }
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      const out = {};
      for (const [k, x] of Object.entries(v)) out[k] = nameIn(x);
      return out;
    }
    return nameIn(v);
  }
  return {
    markdown: text => links(text, true),
    // `aliases` and `gm_aliases` are the declarations themselves;
    // publishedFrontmatter removes the secret names from them.
    frontmatter(fm) {
      const out = {};
      for (const [k, v] of Object.entries(fm || {})) {
        if (k === 'aliases' || k === 'gm_aliases') out[k] = v;
        else if (k === 'relationships') out[k] = relationships(v);
        else if (GM_ALIAS_NAME_FIELDS.has(k)) out[k] = nameIn(v);
        else out[k] = linksIn(v);
      }
      return out;
    },
  };
}

module.exports = { unstableBodyMarked, markedBlocksForTest: markedBlocks, htmlCommentsForTest: htmlComments, obsidianCommentsForTest: obsidianComments, calloutLinesForTest: calloutLines, strippedLines, renderInline, findHeadings, pcHeadingsUnstable, HEADINGS_UNSTABLE_WARNING, renderMarkdown, processContent, playerSafeMarkdown, noteFacts, keptFlags, stubCut, extractSections, resolveWikiLinks, filterSections, isExcludedSection, strippedSectionTitles, stripDataview, stripGmOnly, stripSpoiler, stripCallouts, stripHtmlComments, stripLeadingH1, relativePath, relativeHref, humanizeName, wikiTargetLabel, parseWikiRef, escapeHtml, resolveImageEmbeds, encodeImageUrl, campaignImageSrc, encodeHref, encodeAddress, publishedSource, isSessionHub, renderMetaValue, plainMetaValue, plainRefValue, NOTE_NAME_FIELDS, refMetaValue, referenceOf, valueText, dateText, portraitBasename, filterFields, publishedFrontmatter, hiddenFieldsOf, gmAliasList, nameList, gmAliasKey, gmAliasRewriter, publishMode, isGmOnlyEdge, isWithheld, flagIsYes, withheldPlaceholder, keepOnlySections, keptSectionFlags, stubMarked, sectionVerdicts, sheetWithheldTitles };

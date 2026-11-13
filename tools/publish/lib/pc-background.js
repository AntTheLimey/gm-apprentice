'use strict';
// tools/publish/lib/pc-background.js
// A PC's background parts (the player's own text), read from the processed Background section (GM-only text is already
// gone from it): the Backstory, Appearance and Personality sub-sections, or the older
// one-line `**Backstory & Personality:**` and `**Appearance:**` fields. System-neutral: a CoC
// investigator's one-line fields (`**Personal Description:**`, `**Traits:**`, ...) are its
// appearance and personality, and a Background of prose alone (the GURPS and generic
// templates' free-form one) is its backstory.
// Plain text (the consumer escapes it): facts[].label and .value, personality[].label,
// firstSentence. Trusted processor HTML: backstoryHtml, appearanceHtml, personality[].html.
const { subsections, aboveSubheadings, cellText, filled, hasContent, isPlaceholder } = require('./templates/sheet-parse');

const FACT_LABELS = ['Age', 'Height', 'Weight', 'Eyes', 'Hair', 'Skin', 'Faith'];
// A full stop after one of these (or after a lone letter) is not the end of a sentence.
const ABBREVIATION_RE = /^(?:Mr|Mrs|Ms|Dr|St|Mt|Ft|Prof|Sr|Jr|Capt|Lt|Col|Gen|Sgt|Rev|vs|etc)$/i;
const PARAGRAPH_RE = /<p>[\s\S]*?<\/p>/gi;

// A `---` rule closing a part (a note that rules off its sections) is not the part's.
const trimRules = (html) => String(html || '').replace(/^(?:\s*<hr\s*\/?>)+|(?:<hr\s*\/?>\s*)+$/gi, '').trim();

// Paragraphs that are only a template placeholder (`{Backstory}`) are not content.
function withoutPlaceholders(html) {
  const out = trimRules(String(html || '').replace(PARAGRAPH_RE, p => (isPlaceholder(cellText(p)) ? '' : p)));
  return hasContent(out) ? out : '';
}

// A value that says nothing: empty, a template placeholder, or a lone dash.
const real = (text) => (/^[–-]$/.test(String(text).trim()) ? '' : filled(text));

// `<strong>Age:</strong> 31` -> { label: 'Age', value: '31' }, or null.
function factOf(chunk) {
  const m = chunk.match(/^\s*<strong>\s*([^<:]+?)\s*(?::\s*<\/strong>|<\/strong>\s*:)([\s\S]*)$/i);
  if (!m) return null;
  return { label: cellText(m[1]), inner: m[2] };
}

// The appearance block's facts line is the paragraph whose first label is a FACTS label.
function splitFacts(blockHtml) {
  const facts = [];
  const prose = String(blockHtml || '').replace(PARAGRAPH_RE, (p) => {
    const first = factOf(p.slice(3, -4));
    if (!first || !FACT_LABELS.some(l => l.toLowerCase() === first.label.toLowerCase())) return p;
    for (const chunk of p.slice(3, -4).split(/\s·\s+(?=<strong>(?:[^<]*:|[^<]*<\/strong>\s*:))/i)) {
      const f = factOf(chunk);
      const value = f ? real(cellText(f.inner)) : '';
      if (value) facts.push({ label: f.label, value });
    }
    return '';
  });
  return { facts, appearanceHtml: withoutPlaceholders(prose) };
}

function readPersonality(blockHtml) {
  const out = [];
  const re = /<li>([\s\S]*?)<\/li>/gi;
  let m;
  while ((m = re.exec(blockHtml)) !== null) {
    const f = factOf(m[1]);
    if (f && real(cellText(f.inner))) out.push({ label: f.label, html: f.inner.trim() });
  }
  return out;
}

// The older one-line field `**Label:** value`, as the value's HTML.
function oldField(html, labelPattern) {
  // The value runs to the end of its paragraph (a hard-wrapped line keeps its tail), or to
  // the next field's label starting a line.
  const re = new RegExp(`<strong>\\s*${labelPattern}\\s*:\\s*</strong>([\\s\\S]*?)(?=(?:<br\\s*/?>|\\n)\\s*<strong>[^<]*:|</p>|$)`, 'i');
  const m = String(html || '').match(re);
  const value = m ? m[1].trim() : '';
  return real(cellText(value)) ? value : '';
}

// A CoC investigator's Background fields, as their sheet has them: Personal Description is how
// they look, the rest are cards beside each other (D&D's traits, ideals, bonds and flaws). Each is
// [the card's name, the labels notes write for it]. A field's value is the rest of its line, and
// the list under it when the line ends the paragraph (`**Significant People:**` then `- ...` lines).
const APPEARANCE_FIELD = ['Personal Description', /^Personal\s+Description$/i];
const CARD_FIELDS = [
  ['Traits', /^Traits?$/i],
  ['Ideology & Beliefs', /^Ideology(?:\s*(?:&|\/|and)\s*Beliefs?)?$/i],
  ['Significant People', /^Significant\s+(?:People|Persons?)$/i],
  ['Meaningful Locations', /^Meaningful\s+(?:Locations?|Places?)$/i],
  ['Treasured Possessions', /^(?:Treasured\s+)?Possessions?$/i],
];
// Every label the Story tab shows from a one-line field (the Background lines left over for the
// page are the others).
const STORY_FIELD_LABELS = [/^Backstory\s*&\s*Personality$/i, /^Appearance$/i, APPEARANCE_FIELD[1], ...CARD_FIELDS.map(([, re]) => re)];

// The top-level blocks of a fragment, in order: [{ tag, html, start, end }]. Lists nest, so an
// element ends at its own closing tag.
function topBlocks(html) {
  const text = String(html || '');
  const out = [];
  const open = /<([a-z][a-z0-9]*)\b[^>]*>/gi;
  let m;
  while ((m = open.exec(text)) !== null) {
    const tag = m[1].toLowerCase();
    if (/^(?:hr|br|img)$/.test(tag)) { out.push({ tag, html: m[0], start: m.index, end: open.lastIndex }); continue; }
    const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
    re.lastIndex = open.lastIndex;
    let depth = 1;
    let t;
    while (depth > 0 && (t = re.exec(text)) !== null) depth += t[1] ? -1 : 1;
    const end = depth === 0 ? re.lastIndex : text.length;
    out.push({ tag, html: text.slice(m.index, end), start: m.index, end });
    open.lastIndex = end;
  }
  return out;
}

// The `**Label:** value` fields of a fragment's paragraphs: [{ label, html, block }], `block` the
// index (in topBlocks) of the last block the value takes. A label starts its paragraph or a line.
function labelledFields(html) {
  const blocks = topBlocks(html);
  const out = [];
  blocks.forEach((b, i) => {
    if (b.tag !== 'p') return;
    const inner = b.html.slice(3, -4);
    const starts = [...inner.matchAll(/(?:^|<br\s*\/?>|\n)\s*<strong>\s*([^<:]+?)\s*:\s*<\/strong>/gi)];
    starts.forEach((s, k) => {
      const from = s.index + s[0].length;
      const to = k + 1 < starts.length ? starts[k + 1].index : inner.length;
      let value = inner.slice(from, to).trim();
      let last = i;
      // The line that ends the paragraph takes the lists right under it.
      if (k === starts.length - 1) {
        const lists = [];
        while (blocks[last + 1] && /^(?:ul|ol)$/.test(blocks[last + 1].tag)) lists.push(blocks[++last].html);
        if (lists.length) value = `${real(cellText(value)) ? `<p>${value}</p>\n` : ''}${lists.join('\n')}`;
      }
      out.push({ label: cellText(s[1]), html: value, block: last });
    });
  });
  return out;
}

// The value of the first field whose label `re` matches ('' when none says anything).
function fieldValue(fields, re) {
  const f = fields.find(x => re.test(x.label) && real(cellText(x.html)));
  return f ? f.html : '';
}

// The CoC card fields a note has, in the note's order, under their card names: [{ label, html }].
function cardFields(fields) {
  const out = [];
  const taken = new Set();
  for (const f of fields) {
    const card = CARD_FIELDS.find(([, re]) => re.test(f.label));
    if (!card || taken.has(card[0]) || !real(cellText(f.html))) continue;
    taken.add(card[0]);
    out.push({ label: card[0], html: f.html });
  }
  return out;
}

// A Background with no sub-sections and no `**Label:**` field lines, only prose, is the backstory
// as written (the free-form template). A table or a heading in it is not a story: none, then.
function freeFormBackstory(html) {
  const text = String(html || '');
  if (/<(?:table|h[1-6])[ >]/i.test(text)) return '';
  const fieldLine = /<p>\s*<strong>[^<]*?(?::\s*<\/strong>|<\/strong>\s*:)/i;
  return fieldLine.test(text) ? '' : withoutPlaceholders(text);
}

// To the first `.`, `!` or `?` followed by whitespace or the end; past `max`, cut at a word.
function firstSentence(text, max = 200) {
  const flat = String(text || '').replace(/\s+/g, ' ').trim();
  let end = -1;
  for (const m of flat.matchAll(/[.!?](?=\s|$)/g)) {
    if (m[0] === '.') {
      const word = (flat.slice(0, m.index).match(/(\S*)$/)[1]).replace(/^\W+/, '');
      if (/^[A-Za-z]$/.test(word) || ABBREVIATION_RE.test(word)) continue;
      if (flat[m.index - 1] === '.' && /^\s+[a-z]/.test(flat.slice(m.index + 1))) continue;
    }
    end = m.index;
    break;
  }
  const sentence = end === -1 ? flat : flat.slice(0, end + 1);
  if (sentence.length <= max) return sentence;
  const room = sentence.slice(0, max - 1);
  const space = room.lastIndexOf(' ');
  return `${(space > 0 ? room.slice(0, space) : room).replace(/[\s,;:.!?-]+$/, '')}…`;
}

// A backstory whose first paragraph is a single bold line has that line as its title:
// -> { titleHtml, proseHtml } (titleHtml '' when there is none; proseHtml is the rest).
function splitTitle(html) {
  const text = String(html || '');
  const m = text.match(/^\s*<p>\s*<strong>((?:(?!<\/?strong>|<br)[\s\S])*?)<\/strong>\s*<\/p>\s*/i);
  if (!m || !cellText(m[1]).trim() || !text.slice(m[0].length).trim()) return { titleHtml: '', proseHtml: text };
  return { titleHtml: m[1].trim(), proseHtml: text.slice(m[0].length) };
}

// -> { hasSections, wholeSection, backstoryHtml, appearanceHtml, facts, personality, firstSentence }, or null
// when there is no Background section or no background in it. Fields may be empty
// (a blank template note); hasSections says the note has the sub-section headings.
function backgroundParts(sections) {
  const background = (sections || []).find(s => s.id === 'background');
  if (!background) return null;
  const block = (title) => {
    const found = subsections(background.html).find(s => s.title.toLowerCase() === title);
    return found ? found.html : null;
  };
  const backstory = block('backstory');
  const appearance = block('appearance');
  const personality = block('personality');
  const hasSections = backstory !== null || appearance !== null || personality !== null;

  let backstoryHtml = '';
  let appearanceHtml = '';
  let facts = [];
  if (hasSections) {
    backstoryHtml = withoutPlaceholders(backstory);
    ({ facts, appearanceHtml } = splitFacts(appearance));
  }
  // A part with no sub-section text falls back to its old one-line field (a half-migrated note).
  const top = aboveSubheadings(background.html);
  const fields = labelledFields(top);
  backstoryHtml = backstoryHtml || oldField(top, 'Backstory\\s*(?:&amp;|&)\\s*Personality');
  appearanceHtml = appearanceHtml || oldField(top, 'Appearance') || fieldValue(fields, APPEARANCE_FIELD[1]);
  const cards = [...readPersonality(personality || ''), ...cardFields(fields)];
  // The whole section is the backstory: nothing else of it is left for the page.
  const wholeSection = !hasSections && !backstoryHtml && !appearanceHtml && !cards.length && !!freeFormBackstory(background.html);
  if (wholeSection) backstoryHtml = freeFormBackstory(background.html);
  if (!hasSections && !backstoryHtml && !appearanceHtml && !cards.length) return null;
  return {
    hasSections,
    wholeSection,
    backstoryHtml,
    appearanceHtml,
    facts,
    personality: cards,
    // The title line is not a sentence of the story.
    firstSentence: firstSentence(cellText(splitTitle(backstoryHtml).proseHtml.replace(/<\/(p|li)>/gi, ' '))),
  };
}

// The Background sub-sections the Story tab reads.
const STORY_SUBSECTIONS = new Set(['backstory', 'appearance', 'personality']);

// What the Background section holds besides its story, given its parts: the lines above its
// sub-headings that neither the Story tab nor the page header (`shown`, label patterns) shows,
// and every sub-section the Story tab does not read (`### Allies`), heading and all, as HTML.
// '' when none, or when the whole section is the backstory.
function backgroundRestHtml(section, shown, parts) {
  if (parts && parts.wholeSection) return '';
  const drop = [...STORY_FIELD_LABELS, ...(shown || [])];
  // The lists under a story field are its value: they go with it.
  const top = aboveSubheadings(section.html);
  const blocks = topBlocks(top);
  const taken = new Set();
  for (const f of labelledFields(top)) {
    if (!STORY_FIELD_LABELS.some(re => re.test(f.label))) continue;
    for (let i = f.block; i >= 0 && /^(?:ul|ol)$/.test(blocks[i].tag); i--) taken.add(i);
  }
  const unlisted = taken.size ? blocks.reduceRight((h, b, i) => (taken.has(i) ? h.slice(0, b.start) + h.slice(b.end) : h), top) : top;
  const rest = unlisted.replace(/<p>([\s\S]*?)<\/p>\s*/gi, (p, inner) => {
    const m = inner.match(/^\s*<strong>\s*([^<:]+?)\s*(?::\s*<\/strong>|<\/strong>\s*:)([\s\S]*)$/i);
    if (m && (drop.some(re => re.test(cellText(m[1]))) || !filled(cellText(m[2])) || /^\s*[–—-]\s*$/.test(cellText(m[2])))) return '';
    return isPlaceholder(cellText(inner)) || !cellText(inner) ? '' : p;
  }).trim();
  const kept = hasContent(trimRules(rest)) ? trimRules(rest) : '';
  const others = [];
  const re = /(<h3[^>]*>([\s\S]*?)<\/h3>)([\s\S]*?)(?=<h3[ >]|$)/gi;
  let m;
  while ((m = re.exec(section.html || '')) !== null) {
    if (!STORY_SUBSECTIONS.has(cellText(m[2]).toLowerCase())) others.push(`${m[1]}${m[3]}`.trim());
  }
  return [kept, ...others].filter(Boolean).join('\n');
}

// The same, as the section the page shows below the sheet ('' when none).
function backgroundRest(section, shown, parts) {
  const all = backgroundRestHtml(section, shown, parts);
  return all ? `<section class="pc-background-rest">\n${all}\n</section>` : '';
}

module.exports = { backgroundParts, backgroundRest, backgroundRestHtml, firstSentence, splitTitle };

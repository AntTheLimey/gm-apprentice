'use strict';
// tools/publish/lib/pc-story.js
// A PC's story parts, read from the processed Background section (GM-only text is already
// gone from it): the Backstory, Appearance and Personality sub-sections, or the older
// one-line `**Backstory & Personality:**` and `**Appearance:**` fields. System-neutral.
// Plain text (the consumer escapes it): facts[].label and .value, personality[].label,
// firstSentence. Trusted processor HTML: backstoryHtml, appearanceHtml, personality[].html.
const { subsections, aboveSubheadings, cellText, filled, hasContent, isPlaceholder } = require('./templates/sheet-parse');

const FACT_LABELS = ['Age', 'Height', 'Weight', 'Eyes', 'Hair', 'Skin', 'Faith'];
// A full stop after one of these (or after a lone letter) is not the end of a sentence.
const ABBREVIATION_RE = /^(?:Mr|Mrs|Ms|Dr|St|Mt|Ft|Prof|Sr|Jr|Capt|Lt|Col|Gen|Sgt|Rev|vs|etc)$/i;
const PARAGRAPH_RE = /<p>[\s\S]*?<\/p>/gi;

// Paragraphs that are only a template placeholder (`{Backstory}`) are not content.
function withoutPlaceholders(html) {
  const out = String(html || '').replace(PARAGRAPH_RE, p => (isPlaceholder(cellText(p)) ? '' : p)).trim();
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
    for (const chunk of p.slice(3, -4).split('·')) {
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

// -> { hasSections, backstoryHtml, appearanceHtml, facts, personality, firstSentence }, or null
// when there is no Background section or nothing of a story in it. Fields may be empty
// (a blank template note); hasSections says the note has the sub-section headings.
function storyParts(sections) {
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
  backstoryHtml = backstoryHtml || oldField(top, 'Backstory\\s*(?:&amp;|&)\\s*Personality');
  appearanceHtml = appearanceHtml || oldField(top, 'Appearance');
  if (!hasSections && !backstoryHtml && !appearanceHtml) return null;
  return {
    hasSections,
    backstoryHtml,
    appearanceHtml,
    facts,
    personality: readPersonality(personality || ''),
    firstSentence: firstSentence(cellText(backstoryHtml.replace(/<\/(p|li)>/gi, ' '))),
  };
}

module.exports = { storyParts, firstSentence };

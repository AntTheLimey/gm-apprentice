'use strict';
// The card-is-a-subset-of-its-page check, shared by the build test and the proof script.
// A card may say only what its own built page says.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => (ENTITIES[n.toLowerCase()] !== undefined ? ENTITIES[n.toLowerCase()] : m));
}

// A built page's visible text: scripts and styles dropped, tags stripped, entities
// decoded, whitespace collapsed.
// The page's typography turns straight quotes into curly ones; the card keeps the straight
// ones. Both sides are compared with straight quotes.
function plainQuotes(text) {
  return text.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"');
}

function pageText(html) {
  const noCode = html.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ');
  // Inline tags close up (a linked name followed by a comma reads "Zed, Adam", not "Zed , Adam");
  // block tags separate.
  const flat = noCode.replace(/<\/?(a|em|strong|b|i|u|span|code|sup|sub|small|mark|abbr)\b[^>]*>/gi, '').replace(/<[^>]*>/g, ' ');
  return plainQuotes(decodeEntities(flat)).replace(/\s+/g, ' ').trim();
}

const collapse = (s) => plainQuotes(String(s)).replace(/\s+/g, ' ').trim();

// The rule. The title `t` and the excerpt `x` (a trailing "…" removed) must occur in the
// page text exactly. A fact value passes when it occurs exactly, OR when every
// whitespace-separated word of it does: this allows the three places a page header prints
// a raw form where the card prints the clean one (a wikilink with its brackets,
// `Target|alias`, and an unquoted date printed as a long date string; for a value shaped
// YYYY-MM-DD the year in the page text is enough).
// One further allowance, for an excerpt only: the excerpt skips headings and tables, so on a
// page with a sheet its two sentences can sit in separate blocks. It passes when each
// sentence occurs exactly (reported in `loose`, label 'excerpt').
// Returns { problems: [string], loose: [{value, why}] }; loose lists fact values that
// passed only by the word rule.
function cardProblems(card, text) {
  const problems = [];
  const loose = [];
  const has = (s) => text.includes(collapse(s));
  if (!has(card.t)) problems.push(`title ${JSON.stringify(card.t)}`);
  if (card.x != null) {
    const x = card.x.replace(/…$/, '');
    if (!has(x)) {
      if (collapse(x).split(/(?<=[.!?])\s+/).every(has)) loose.push({ label: 'excerpt', value: card.x });
      else problems.push(`excerpt ${JSON.stringify(card.x)}`);
    }
  }
  for (const [label, value] of card.f || []) {
    if (has(value)) continue;
    const iso = /^(\d{4})-\d{2}-\d{2}$/.exec(value);
    const words = iso ? [iso[1]] : collapse(value).split(' ');
    if (words.every((w) => text.includes(w))) loose.push({ label, value });
    else problems.push(`fact ${label}=${JSON.stringify(value)}`);
  }
  return { problems, loose };
}

module.exports = { pageText, cardProblems };

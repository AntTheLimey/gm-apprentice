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

// The rule. The title `t`, the excerpt `x` and every fact value, each with a trailing "…"
// removed (the card cuts long text; the page does not), must occur in the page text exactly.
// Returns { problems: [string] }.
function cardProblems(card, text) {
  const problems = [];
  const has = (s) => text.includes(collapse(s.replace(/…$/, '')));
  if (!has(card.t)) problems.push(`title ${JSON.stringify(card.t)}`);
  if (card.x != null && !has(card.x)) problems.push(`excerpt ${JSON.stringify(card.x)}`);
  for (const [label, value] of card.f || []) {
    if (!has(value)) problems.push(`fact ${label}=${JSON.stringify(value)}`);
  }
  return { problems };
}

module.exports = { pageText, cardProblems };

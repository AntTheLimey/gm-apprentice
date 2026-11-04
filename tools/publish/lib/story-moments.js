'use strict';
// Memorable Moments as cards on the Story page. The wrap-up template writes each moment as a bold beat line with an
// italic context line under it, or a block-quote of table dialogue ending in a `— Speaker` line; a moment may end with
// a `#moment/<kind>` tag, at its end or in a paragraph of its own under it. The build shows the note as written: a card
// adds no quote marks and drops none, a quote in the note is a quote card and a bold line is narration. The only text
// taken out is the tag, which is structure.
const { createRenderer } = require('./markdown');
const { renderMarkdown, renderInline, escapeHtml } = require('./processor');

const md = createRenderer();

// Ant's list, with the icon each is drawn with (stroke SVG, 15x15) and the label printed beside it.
const KINDS = ['dramatic', 'intriguing', 'funny', 'epic', 'tragic'];
const ICONS = {
  dramatic: '<path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/>',
  intriguing: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  funny: '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><path d="M9 9h.01"/><path d="M15 9h.01"/>',
  epic: '<path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>',
  tragic: '<path d="M12 2.7S6 9.5 6 14a6 6 0 0 0 12 0c0-4.5-6-11.3-6-11.3z"/>',
};
const LABEL = (kind) => kind[0].toUpperCase() + kind.slice(1);

const TAG = /\s#moment\/([\p{L}\p{N}_-]+)([*_]*)\s*$/u;
// A paragraph that is the tag alone.
const LONE_TAG = /^#moment\/([\p{L}\p{N}_-]+)$/u;
// The speaker line of a quote: its dash (as written, with the space after it) and the name.
const DASH = /^(—|–|--)(\s*)(\S.*)$/;
// The GM site's marks (gm-marks.js): an open token alone on a line starts a span that runs to where its depth returns to 0.
const OPEN_LINE = /^\uE000[0-9a-z]+\uE001$/;
const MARK = /\uE000[0-9a-z]+\uE001|\uE002/g;
// A marked span's text and the mark tokens (with the space between them) that end it.
const SPAN_TAIL = /^([\s\S]*?)((?:\s*(?:\uE000[0-9a-z]+\uE001|\uE002))*)$/;

// True when the inline markdown is one `type` span (`strong` or `em`) from its first character to its last.
function wholly(text, type) {
  const kids = (md.parseInline(text.trim(), {})[0] || { children: [] }).children
    .filter((k) => k.type !== 'text' || k.content !== '');
  if (kids.length < 3 || kids[0].type !== `${type}_open`) return false;
  let depth = 0;
  for (let i = 0; i < kids.length; i++) {
    if (kids[i].type === `${type}_open`) depth++;
    else if (kids[i].type === `${type}_close` && --depth === 0) return i === kids.length - 1;
  }
  return false;
}

// The text split into unmarked stretches and marked spans, in order: { text, marked, start (its first line) }.
function stretches(lines) {
  const out = [];
  let cur = [];
  let start = 0;
  let depth = 0;
  let spanning = false;
  const flush = (marked) => { if (cur.length) out.push({ text: cur.join('\n'), marked, start }); cur = []; };
  for (const [i, line] of lines.entries()) {
    if (depth === 0 && !spanning && OPEN_LINE.test(line.trim())) { flush(false); spanning = true; }
    if (!cur.length) start = i;
    cur.push(line);
    for (const m of line.matchAll(MARK)) depth = m[0] === '' ? Math.max(0, depth - 1) : depth + 1;
    if (spanning && depth === 0) { flush(true); spanning = false; }
  }
  flush(spanning);
  return out;
}

// The top-level blocks of unmarked text: { type, text, first, last } (type: paragraph, quote, rule or other), each as
// written; `first` and `last` are its first and last written lines, counted from `start`.
function blocksOf(text, start = 0) {
  const lines = text.split('\n');
  return md.parse(text, {})
    .filter((t) => t.level === 0 && t.map && t.nesting !== -1)
    .map((t) => {
      let last = t.map[1] - 1;
      while (last > t.map[0] && !lines[last].trim()) last--;
      return {
        type: t.type === 'paragraph_open' ? 'paragraph' : t.type === 'blockquote_open' ? 'quote' : t.type === 'hr' ? 'rule' : 'other',
        text: lines.slice(t.map[0], t.map[1]).join('\n').replace(/\s+$/, ''),
        first: start + t.map[0],
        last: start + last,
      };
    });
}

// Where a card stands in the text parsed: { first, last }, its first and last lines (the last is where a tag added to
// it goes). Not enumerable, so a card reads as before; a marked span's card has none.
const stand = (c, block) => Object.defineProperty(c, 'lines', { value: { first: block.first, last: block.last }, writable: true });

function parseMoments(markdown) {
  const lines = String(markdown == null ? '' : markdown).replace(/\r/g, '').split('\n');
  const cards = [];
  const unknownTags = [];
  let card = null;   // the last card, while a context line may still follow it
  // The last card outside a marked span since the last rule: the one a paragraph that is only a tag names. A marked
  // span (the GM site's) is passed over, so the tag names the card the player site, which has no such span, names.
  let prior = null;

  // The block's text with its trailing tag taken off; the tag is noted on `tagged`.
  // Only the tag goes. Not touched on purpose (a ruling, not an oversight): the renderer's typographer still curls
  // straight quotes when a card is drawn.
  const strip = (text, tagged) => {
    const m = TAG.exec(text);
    if (!m) return text;
    tagged.word = m[1];
    return text.slice(0, m.index) + m[2];
  };
  // The kind a tag names goes on its card; a word that is no kind is reported and the card has none.
  const kindOf = (c, tagged) => {
    if (tagged.word === undefined) return;
    const kind = tagged.word.toLowerCase();
    if (KINDS.includes(kind)) c.kind = kind;
    else if (!unknownTags.some((w) => w.toLowerCase() === kind)) unknownTags.push(tagged.word);
  };
  const add = (c, tagged) => { kindOf(c, tagged); cards.push(c); prior = c; return c; };
  const fresh = (shape, main, speaker = null, context = null) => ({ shape, main, speaker, context, kind: null });

  for (const part of stretches(lines)) {
    if (part.marked) {
      // A marked span is one card: its blocks, as written. A tag ending its last block is structure here too: taken off
      // (the mark tokens after it stay), its kind the card's.
      card = null;
      const before = prior;
      const tagged = {};
      const [, body, tail] = SPAN_TAIL.exec(part.text.replace(/^\s+|\s+$/g, ''));
      const untagged = strip(body, tagged);
      add(fresh('other', untagged === body ? body + tail : untagged.replace(/\s+$/, '') + tail), tagged);
      prior = before;
      continue;
    }
    card = null;
    for (const block of blocksOf(part.text, part.start)) {
      // A `---` rule divides the section; it is no moment, and no context line reaches back across it.
      if (block.type === 'rule') { card = null; prior = null; continue; }
      // A paragraph that is only a tag is no card: it names the kind of the card before it, when that card has none. A
      // word that is no kind is reported wherever it stands; with no card before it, the tag is dropped.
      const lone = block.type === 'paragraph' ? LONE_TAG.exec(block.text.trim()) : null;
      if (lone) {
        const word = lone[1];
        if (prior && prior.kind === null) kindOf(prior, { word });
        else if (!KINDS.includes(word.toLowerCase())) kindOf({}, { word });
        continue;
      }
      const tagged = {};
      const text = strip(block.text, tagged);
      const last = card;
      card = null;
      if (last && last.context === null && block.type === 'paragraph' && wholly(text, 'em')) {
        last.context = text.trim();
        if (last.lines) last.lines = { first: last.lines.first, last: block.last };
        kindOf(last, tagged);
        card = null;
        continue;
      }
      if (block.type === 'quote') {
        const body = text.split('\n').map((l) => l.replace(/^\s*> ?/, ''));
        while (body.length && !body[body.length - 1].trim()) body.pop();
        const m = body.length ? DASH.exec(body[body.length - 1].trim()) : null;
        if (m) body.pop();
        card = add(stand(fresh('speech', body.join('\n').trim(), m ? m[3].trim() : null), block), tagged);
        if (m) card.speakerDash = m[1] + m[2];
      } else if (block.type === 'paragraph' && wholly(text, 'strong')) {
        card = add(stand(fresh('narration', text.trim()), block), tagged);
      } else if (block.type === 'paragraph' && text.includes('\n')) {
        // The template's two lines in one paragraph: a bold beat, then its italic context.
        const rows = text.split('\n');
        let split = -1;
        for (let i = 1; i < rows.length && split < 0; i++) {
          if (wholly(rows.slice(0, i).join('\n'), 'strong') && wholly(rows.slice(i).join('\n'), 'em')) split = i;
        }
        if (split > 0) {
          add(stand(fresh('narration', rows.slice(0, split).join('\n').trim(), null, rows.slice(split).join('\n').trim()), block), tagged);
        } else {
          add(stand(fresh('other', text.trim()), block), tagged);
        }
      } else {
        add(stand(fresh('other', text.trim()), block), tagged);
      }
    }
  }
  return { cards, unknownTags };
}

const svg = (kind) => `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[kind]}</svg>`;

function cardHtml(c) {
  const parts = [];
  if (c.kind) parts.push(`<p class="moment-kind" data-kind="${c.kind}">${svg(c.kind)}${LABEL(c.kind)}</p>`);
  parts.push(c.shape === 'narration'
    ? `<p class="moment-main">${renderInline(c.main)}</p>`
    : `<div class="moment-main">${renderMarkdown(c.main)}</div>`);
  if (c.speaker) parts.push(`<p class="moment-speaker">${escapeHtml(c.speakerDash || '— ')}${renderInline(c.speaker)}</p>`);
  if (c.context) parts.push(`<hr class="moment-rule">`, `<p class="moment-context">${renderInline(c.context)}</p>`);
  return `<article class="moment-card">${parts.join('')}</article>`;
}

// The cards block, heading as the note wrote it; '' when there are no cards.
function momentsHtml(parsed, { title, unitKind } = {}) {
  if (!parsed || !parsed.cards.length) return '';
  const id = String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const of = unitKind === 'session' ? 'session' : 'chapter';
  return `<section class="story-moments">
  <header class="story-moments__head"><h2${id ? ` id="${escapeHtml(id)}"` : ''}>${renderInline(title || '')}</h2><p>${parsed.cards.length} from this ${of}</p></header>
  <div class="story-moments__grid">
${parsed.cards.map(cardHtml).join('\n')}
  </div>
</section>`;
}

module.exports = { KINDS, parseMoments, momentsHtml };

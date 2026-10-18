'use strict';
// linkText and the readers beside it take time in step with the text (#355): a long run of `[` took
// seconds, because the link pattern was retried from every `[[` to the end of the run. The links
// they find are the pattern's own, checked here against the pattern itself on random text.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  wikilinkRe, wikilinkSpans, replaceWikilinks, replaceLooseLabelled, removeEmbeds,
  linkText, labelsForLinks, labelsForLinksFully,
} = require('../../lib/wikilink');

// The reference: the patterns as they stood before, run through String.replace.
const LOOSE = /\[\[(?:(?!\]\]|\[\[)[^|\n])*\|([^\n]*?)\]\]/g;
const EMBED = /!\[\[[^\]]*\]\]/g;

let seed = 11;
const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648);
const ALPHABET = ['[', '[[', ']', ']]', '|', '\\', '\\|', '!', '![[', 'a', 'b_c', ' ', '\n', '#', '^', '[[A|', '[[B]]'];
const randomText = () => {
  let text = '';
  for (let k = 0, n = 1 + (next() >> 4) % 14; k < n; k++) text += ALPHABET[(next() >> 4) % ALPHABET.length];
  return text;
};

test('the link finders return what the patterns return, on random text', () => {
  for (let n = 0; n < 20000; n++) {
    const text = randomText();
    const tag = (link, body) => `<${link}|${body}>`;
    for (const bang of [false, true]) {
      assert.equal(replaceWikilinks(text, tag, bang), text.replace(wikilinkRe('g', bang), tag), JSON.stringify(text));
    }
    assert.equal(replaceLooseLabelled(text, (label) => `<${label}>`), text.replace(LOOSE, (_, label) => `<${label}>`), JSON.stringify(text));
    assert.equal(removeEmbeds(text), text.replace(EMBED, ''), JSON.stringify(text));
    const first = wikilinkRe('').exec(text);
    const [span] = wikilinkSpans(text, false, 1);
    assert.deepEqual(span ? [span.index, span.end, span.body] : null, first ? [first.index, first.index + first[0].length, first[1]] : null, JSON.stringify(text));
  }
});

test('linkText and labelsForLinks read a link the way the patterns do, on random text', () => {
  const marks = (text) => {
    // markLabels as it was: each pattern a String.replace, to a fixed point.
    let s = text.replace(/[\u0001\u0002]/g, '');
    for (let i = 0; i <= s.length + 1; i++) {
      const out = s.replace(wikilinkRe('g'), (link, body) => {
        const m = /^([^|]*)(?:\\?\|(.*))?$/s.exec(body);
        const label = (m[2] || '').trim();
        return label ? `\u0001${label}\u0002` : body;
      }).replace(LOOSE, (_, label) => `\u0001${label.trim()}\u0002`);
      if (out === s) return s;
      s = out;
    }
    return s;
  };
  for (let n = 0; n < 5000; n++) {
    const text = randomText();
    const words = linkText(text).words;
    const expected = marks(text).replace(/[\u0001\u0002]/g, '').replace(/\[\[|\]\]/g, '');
    assert.equal(words.replace(/\[\[|\]\]/g, ''), expected.replace(/\[\[|\]\]/g, ''), JSON.stringify(text));
    assert.ok(typeof labelsForLinksFully(text) === 'string');
    assert.ok(typeof labelsForLinks(text) === 'string');
  }
});

test('a long run of brackets, pipes and backslashes is read in time linear in its length', () => {
  const runs = ['['.repeat(50000), '[['.repeat(25000), '[[a|'.repeat(12500), '[[a\\'.repeat(12500), '[[[a|'.repeat(10000),
    '[['.repeat(25000) + ']', '[[a|b]'.repeat(8000), ']'.repeat(50000), '![['.repeat(16000), '[[a|'.repeat(12500) + ']]'];
  for (const text of runs) {
    const start = Date.now();
    linkText(text);
    labelsForLinks(text);
    labelsForLinksFully(text);
    const took = Date.now() - start;
    assert.ok(took < 1000, `${JSON.stringify(text.slice(0, 8))}… took ${took} ms`);
  }
});

'use strict';
// tools/publish/test/unit/gm-marks.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createMarks, markKinds, sanitize, unmark, blockLines, renderMarks, marksAtHeadings } = require('../../lib/gm-marks');
const { findHeadings, renderMarkdown, extractSections } = require('../../lib/processor');

const CLOSE = '\uE002';
const PUA = /[\uE000-\uE002]/;

// Every element in a fragment closes in the order it opened (void elements aside), and every gm-mark element is closed.
function wellNested(html) {
  const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'col', 'area', 'base', 'embed', 'source', 'track', 'wbr']);
  const stack = [];
  for (const m of html.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/?)>/g)) {
    const [, closing, name, self] = m;
    const tag = name.toLowerCase();
    if (VOID.has(tag) || self) continue;
    if (!closing) { stack.push(tag); continue; }
    const top = stack.pop();
    if (top !== tag) return `</${tag}> closes <${top}> at ${m.index}`;
  }
  return stack.length ? `left open: ${stack.join(', ')}` : true;
}

test('the kinds are the show switches, in order', () => {
  assert.deepEqual(markKinds(), ['notes', 'sections', 'fields', 'relationships', 'gm_only_blocks', 'spoilers', 'callouts', 'withheld_names', 'comments']);
});

test('loading the module does not load the settings list (it is read when the kinds are asked for)', () => {
  const lib = path.join(__dirname, '..', '..', 'lib');
  const script = [
    `require(${JSON.stringify(path.join(lib, 'gm-marks.js'))});`,
    `const reg = ${JSON.stringify(path.join(lib, 'settings', 'registry.js'))};`,
    'process.stdout.write(String(Object.keys(require.cache).includes(reg)));',
  ].join('\n');
  assert.equal(execFileSync(process.execPath, ['-e', script], { encoding: 'utf8' }), 'false');
});

test('a note cannot forge a mark', () => {
  assert.equal(sanitize('a\uE0000\uE001b\uE002'), 'a\uFFFD0\uFFFDb\uFFFD');
});

test('the tokens: an index in base 36 between two characters, one close, the same token again', () => {
  const m = createMarks();
  for (let i = 0; i < 36; i++) m.open('fields', `f${i}`);
  const t = m.open('spoilers', 'last');
  assert.equal(t, '\uE000' + (36).toString(36) + '\uE001');
  assert.equal(m.again(t), t);
  assert.equal(m.close(), CLOSE);
  assert.deepEqual(m.get(36), { kind: 'spoilers', label: 'last' });
  assert.deepEqual(blockLines(t), ['', t, '']);
});

test('unmark keeps the words and drops the tokens', () => {
  const m = createMarks();
  assert.equal(unmark(`x ${m.open('spoilers', 'spoiler block')}secret${m.close()} y`), 'x secret y');
});

test('a token cut in half by an excerpt is dropped with its digits', () => {
  const m = createMarks();
  for (let i = 0; i < 40; i++) m.open('fields', 'f');
  const t = m.open('spoilers', 's');   // '\uE000' + '14' + '\uE001': two digits, so the cut keeps one
  const cut = `a ${t}b${CLOSE} c ${t.slice(0, 2)}`;
  assert.equal(unmark(cut), 'a b c ');
  const out = renderMarks(`<p>${cut}</p>`, m);
  assert.doesNotMatch(out, PUA);
  assert.equal(out, '<p>a <span class="gm-mark gm-mark--spoilers" data-gm-kind="spoilers" data-gm-label="s">b</span> c </p>');
});

test('a token alone in a paragraph is a panel; inside text it is a span', () => {
  const m = createMarks();
  const md = [...blockLines(m.open('sections', 'GM Notes section')), 'Hidden **words**.', ...blockLines(m.close()),
    `A ${m.open('withheld_names', 'players see: someone')}Vesper${m.close()} spoke.`].join('\n');
  const html = renderMarks(renderMarkdown(md), m);
  assert.match(html, /<div class="gm-mark gm-mark--sections" data-gm-kind="sections" data-gm-label="GM Notes section"><p class="gm-mark__label">GM: GM Notes section<\/p>\s*<p>Hidden <strong>words<\/strong>\.<\/p>\s*<\/div>/);
  assert.match(html, /A <span class="gm-mark gm-mark--withheld_names" data-gm-kind="withheld_names" data-gm-label="players see: someone">Vesper<\/span> spoke\./);
  assert.doesNotMatch(html, PUA);
});

test('tokens in attributes, scripts, styles and titles are removed, not rendered', () => {
  const m = createMarks();
  const t = m.open('fields', 'f');
  const html = `<title>${t}x${m.close()}</title><img alt="${t}a${m.close()}"><script>var s="${t}";</script><p>${t}b${m.close()}</p>`;
  const out = renderMarks(html, m);
  assert.match(out, /<title>x<\/title>/);
  assert.match(out, /alt="a"/);
  assert.match(out, /<script>var s="";<\/script>/);
  assert.match(out, /<span class="gm-mark gm-mark--fields"/);
  const more = renderMarks(`<style>a{content:"${t}"}</style><textarea>${t}q${m.close()}</textarea>`, m);
  assert.equal(more, '<style>a{content:""}</style><textarea>q</textarea>');
});

test('a label is escaped', () => {
  const m = createMarks();
  const out = renderMarks(`<p>${m.open('sections', '<b>"x"</b> section')}y${m.close()}</p>`, m);
  assert.match(out, /data-gm-label="&lt;b&gt;&quot;x&quot;&lt;\/b&gt; section"/);
});

test('a mark left open is closed at the end; a stray close is dropped', () => {
  const m = createMarks();
  const out = renderMarks(`<p>${m.close()}a ${m.open('comments', 'comment')}b</p>`, m);
  assert.equal((out.match(/<span/g) || []).length, (out.match(/<\/span>/g) || []).length);
  assert.equal(wellNested(out), true);
  assert.doesNotMatch(out, PUA);
});

test('a mark opened mid-line and closed three paragraphs later stays inside each paragraph', () => {
  const m = createMarks();
  const md = [`Shown ${m.open('gm_only_blocks', 'gm-only block')}hidden one.`, '', 'Hidden two.', '', '- hidden item', '',
    `Hidden three${m.close()} shown.`].join('\n');
  const out = renderMarks(renderMarkdown(md), m);
  assert.equal(wellNested(out), true);
  assert.doesNotMatch(out, PUA);
  for (const words of ['hidden one.', 'Hidden two.', 'hidden item', 'Hidden three']) {
    assert.match(out, new RegExp(`<span class="gm-mark gm-mark--gm_only_blocks"[^>]*>${words}</span>`), words);
  }
  assert.match(out, /<\/span> shown\.<\/p>/);
});

test('a panel opened in a list item and closed after the list is closed with the item and opened again', () => {
  const m = createMarks();
  const html = `<ul>\n<li>\n<p>a</p>\n<p>${m.open('spoilers', 's')}</p>\n<p>b</p>\n</li>\n</ul>\n<p>c</p>\n<p>${CLOSE}</p>\n<p>d</p>\n`;
  const out = renderMarks(html, m);
  assert.equal(wellNested(out), true);
  assert.match(out, /<li>\n<p>a<\/p>\n<div class="gm-mark gm-mark--spoilers"[^>]*><p class="gm-mark__label">GM: s<\/p>\n<p>b<\/p>\n<\/div><\/li>/);
  assert.match(out, /<\/ul>\n<div class="gm-mark gm-mark--spoilers"[^>]*><p class="gm-mark__label">GM: s<\/p><p>c<\/p>\n<\/div>\n<p>d<\/p>/);
});

test('a close that falls inside a link or a code block waits for that element to close', () => {
  const m = createMarks();
  const link = renderMarks(`<p>${m.open('fields', 'f')}<a href="x">a${CLOSE} b</a> c</p>`, m);
  assert.equal(link, '<p><span class="gm-mark gm-mark--fields" data-gm-kind="fields" data-gm-label="f"><a href="x">a b</a></span> c</p>');
  const fence = renderMarks(renderMarkdown([...blockLines(m.open('spoilers', 's')), '```', 'code', ...blockLines(CLOSE), 'after'].join('\n')), m);
  assert.equal(wellNested(fence), true);
  assert.doesNotMatch(fence, PUA);
});

test('a mark never spans a level 1-2 heading: closed before, heading marked inline, reopened after', () => {
  const m = createMarks();
  const open = m.open('gm_only_blocks', 'gm-only block');
  const md = [...blockLines(open), 'before', '', '## Secret Plans', '', 'after', ...blockLines(m.close())].join('\n');
  const out = marksAtHeadings(md, findHeadings);
  const lines = out.split('\n');
  const h = lines.findIndex((l) => l.includes('Secret Plans'));
  assert.equal(lines[h], `## ${open}Secret Plans${m.close()}`);
  assert.ok(lines.slice(0, h).includes(m.close()), 'closed before the heading');
  assert.ok(lines.slice(h + 1).includes(open), 'opened again after it');
  assert.equal(wellNested(renderMarks(renderMarkdown(out), m)), true);
});

// An open token line followed by a close line with only blank lines between them: an empty panel.
function emptyPanel(lines) {
  const full = lines.filter((l) => l.trim());
  return full.some((l, i) => /^\uE000[0-9a-z]+\uE001$/.test(l) && full[i + 1] === CLOSE);
}

test('a section mark that starts at its own heading puts the heading inside, the panel below', () => {
  const m = createMarks();
  const open = m.open('sections', 'GM Notes section');
  const md = ['Intro.', ...blockLines(open), '## GM Notes', '', 'The traitor.', ...blockLines(m.close()), '## Open', '', 'Shown.'].join('\n');
  const out = marksAtHeadings(md, findHeadings);
  const lines = out.split('\n');
  const h = lines.indexOf(`## ${open}GM Notes${m.close()}`);
  assert.ok(h > 0);
  assert.equal(lines.slice(h + 1).find((l) => l.trim()), open);
  assert.equal(lines.find((l) => l.startsWith('## Open')), '## Open');
  assert.equal(emptyPanel(lines), false, 'no empty panel');
  assert.equal(out.split(open).length - 1, 2, 'the token appears exactly twice');
});

test('marks opened one after another at a heading all wrap it; a mark that ends at the heading leaves no empty panel', () => {
  const m = createMarks();
  const a = m.open('sections', 'GM Notes section');
  const b = m.open('spoilers', 's');
  const md = [...blockLines(a), ...blockLines(b), '# Plans ##', ...blockLines(CLOSE), ...blockLines(CLOSE), 'Shown.'].join('\n');
  const lines = marksAtHeadings(md, findHeadings).split('\n');
  assert.ok(lines.includes(`# ${a}${b}Plans${CLOSE}${CLOSE} ##`), 'closing hashes stay outside');
  assert.equal(emptyPanel(lines), false);
  assert.equal(lines.filter((l) => l === a || l === b).length, 0, 'nothing left to reopen');
});

test('a heading below the opening line is closed over, its own text marked with the innermost mark', () => {
  const m = createMarks();
  const a = m.open('sections', 'outer');
  const b = m.open('spoilers', 'inner');
  const md = [...blockLines(a), 'x', ...blockLines(b), 'y', '', '## H', '', 'z', ...blockLines(CLOSE), ...blockLines(CLOSE)].join('\n');
  const out = marksAtHeadings(md, findHeadings);
  const lines = out.split('\n');
  const h = lines.indexOf(`## ${b}H${CLOSE}`);
  assert.ok(h > 0);
  assert.deepEqual(lines.slice(h + 1).filter((l) => l.trim()).slice(0, 3), [a, b, 'z']);
  assert.equal(lines.slice(0, h).filter((l) => l === CLOSE).length, 2);
  assert.equal(wellNested(renderMarks(renderMarkdown(out), m)), true);
});

test('a level 3 heading and headings with no mark open are left alone', () => {
  const m = createMarks();
  const md = ['## Open', '', 'Setext', '------', '', ...blockLines(m.open('spoilers', 's')), '### Deep', '', 'x', ...blockLines(CLOSE)].join('\n');
  assert.equal(marksAtHeadings(md, findHeadings), md);
});

test('a setext heading is a heading too: each section the templates cut holds whole marks', () => {
  const m = createMarks();
  const open = m.open('gm_only_blocks', 'gm-only block');
  const md = ['## Story', '', ...blockLines(open), 'hidden', '', 'The', 'Plans  ', '---', '', 'more hidden', ...blockLines(CLOSE),
    '## After', '', 'shown'].join('\n');
  const out = marksAtHeadings(md, findHeadings);
  const lines = out.split('\n');
  const u = lines.indexOf('---');
  assert.deepEqual(lines.slice(u - 2, u), [`${open}The`, `Plans${CLOSE}  `], 'the title wrapped, the underline left as it was');
  const sections = extractSections(out);
  assert.deepEqual(sections.map((s) => unmark(s.title)), ['Story', 'The Plans', 'After']);
  for (const s of sections) {
    let depth = 0;
    for (const t of s.html.matchAll(/\uE000[0-9a-z]+\uE001|\uE002/g)) {
      depth += t[0] === CLOSE ? -1 : 1;
      assert.ok(depth >= 0, `a close with nothing open in ${s.title}`);
    }
    assert.equal(depth, 0, `marks left open in ${s.title}`);
  }
  const plans = renderMarks(sections[1].html, m);
  assert.match(plans, /<div class="gm-mark gm-mark--gm_only_blocks"[^>]*><p class="gm-mark__label">GM: gm-only block<\/p>\s*<p>more hidden<\/p>\s*<\/div>/);
});

test('a heading in a code block is not a heading', () => {
  const m = createMarks();
  const md = [...blockLines(m.open('spoilers', 's')), '```', '## not a heading', '```', ...blockLines(m.close())].join('\n');
  assert.equal(marksAtHeadings(md, findHeadings), md);
});

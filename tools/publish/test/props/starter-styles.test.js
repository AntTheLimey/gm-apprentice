'use strict';
// The nine styles the plugin ships, built from the prop-styles fixture vault: each loads, says
// exactly its note's words, reads only the fields it documents, names only fetchable families,
// ships no picture or font, and links nothing outside the site.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { build } = require('../../lib/build');
const { prepareFixture } = require('../helpers/fixture-build');
const { listStyles, loadStyle, PLUGIN_STYLES_DIR } = require('../../lib/props/styles');
const { layoutNames } = require('../../lib/props/layout');
const { propTextOf, linesOfPropHtml } = require('../../lib/props/text');
const { isValidFamily } = require('../../lib/fonts');
const { noticeText } = require('../../lib/notice');

const STARTERS = ['clipping', 'decree', 'form', 'hand', 'letter', 'passport', 'scroll', 'terminal', 'ticket'];
const FIXTURE = path.join(__dirname, '..', 'fixtures', 'prop-styles');
const STYLE_FILES = new Set(['layout.html', 'sheet.html', 'style.css', 'style.json', 'script.js']);

const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&');
// Every word, as many times as it occurs: a dropped or doubled paragraph changes the list.
const wordsOf = (html) => decode(String(html).replace(/<[^>]*>/g, ' ')).split(/[^\p{L}\p{N}]+/u).filter(Boolean).sort();

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
}

function quietBuild(configPath) {
  const saved = { log: console.log, warn: console.warn };
  const lines = [];
  console.log = (m) => lines.push(String(m)); console.warn = (m) => lines.push(String(m));
  try { build({ configPath }); } finally { Object.assign(console, saved); }
  return lines;
}

// The fixture's published prop notes that name a style.
function fixtureNotes() {
  const dir = path.join(FIXTURE, 'Props');
  const out = [];
  for (const name of fs.readdirSync(dir).sort()) {
    const text = fs.readFileSync(path.join(dir, name), 'utf8');
    const style = /^prop_style: (\S+)$/m.exec(text);
    if (!style || /^publish: false$/m.test(text)) continue;
    out.push({ style: style[1], name, text, slug: name.replace(/\.md$/, '').replace(/['’]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') });
  }
  return out;
}

describe('the starter styles', () => {
  it('every starter style loads with no problem', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'starter-'));
    try {
      assert.deepEqual(listStyles({ vaultPath: empty }).map((s) => s.name), STARTERS);
      for (const name of STARTERS) {
        const loaded = loadStyle(name, { vaultPath: empty });
        assert.ok(loaded.style, `${name}: ${JSON.stringify(loaded.problem)}`);
        assert.equal(loaded.style.from, 'plugin');
      }
    } finally { fs.rmSync(empty, { recursive: true, force: true }); }
  });

  it("every field a style reads is in its style.json, and every font is a valid family", () => {
    for (const name of STARTERS) {
      const dir = path.join(PLUGIN_STYLES_DIR, name);
      const json = JSON.parse(fs.readFileSync(path.join(dir, 'style.json'), 'utf8'));
      const sheetFile = path.join(dir, 'sheet.html');
      const texts = [fs.readFileSync(path.join(dir, 'layout.html'), 'utf8'), fs.existsSync(sheetFile) ? fs.readFileSync(sheetFile, 'utf8') : ''];
      const read = [...new Set(texts.flatMap(layoutNames).filter((n) => n.startsWith('prop_')).map((n) => n.split('|')[0]))];
      assert.deepEqual(read.filter((f) => !Object.keys(json.fields).includes(f)), [], `${name} reads fields its style.json does not name`);
      assert.deepEqual(Object.keys(json.fields).filter((f) => !read.includes(f)), [], `${name}'s style.json names fields it does not read`);
      assert.ok(typeof json.title === 'string' && json.title.trim(), `${name}: title`);
      assert.ok(typeof json.about === 'string' && json.about.trim(), `${name}: about`);
      assert.ok(Array.isArray(json.fonts) && json.fonts.length > 0, `${name}: fonts`);
      for (const f of json.fonts) assert.ok(isValidFamily(f), `${name}: font ${f}`);
      assert.ok(!json.fonts.includes('Permanent Marker'), `${name}: Permanent Marker is Apache-2.0, never a starter font`);
      for (const v of Object.values(json.fields)) assert.ok(typeof v === 'string' && v.trim());
    }
  });

  it('no starter style ships a picture or a font file', () => {
    for (const name of STARTERS) {
      const files = walk(path.join(PLUGIN_STYLES_DIR, name)).map((f) => path.relative(path.join(PLUGIN_STYLES_DIR, name), f));
      assert.deepEqual(files.filter((f) => !STYLE_FILES.has(f)), [], `${name}: ${files.join(', ')}`);
      const css = fs.readFileSync(path.join(PLUGIN_STYLES_DIR, name, 'style.css'), 'utf8');
      assert.doesNotMatch(css, /url\(|@import|@font-face/i, `${name}: style.css loads nothing`);
    }
  });
});

describe('the prop-styles fixture, built', () => {
  let root;
  let docs;
  let logs;
  const notes = fixtureNotes();
  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'starter-build-'));
    logs = quietBuild(prepareFixture('prop-styles', root));
    docs = path.join(root, 'docs');
  });
  after(() => fs.rmSync(root, { recursive: true, force: true }));
  const read = (...p) => fs.readFileSync(path.join(docs, ...p), 'utf8');

  it('the fixture has a published note for every starter style', () => {
    assert.deepEqual([...new Set(notes.map((n) => n.style))].sort(), STARTERS);
  });

  it("every starter style's page says its note's words", () => {
    for (const note of notes) {
      const { style } = note;
      // The notes sit in Props/, so each note page holds props/<slug>.html and its prop moves to -prop.
      const page = read('props', `${note.slug}-prop.html`);
      assert.match(read('props', `${note.slug}.html`), new RegExp(`<a class="prop-btn" href="${note.slug}-prop\\.html">See the prop</a>`), style);
      assert.match(page, new RegExp(`<body class="prop-page prop-style-${style}">`));
      const text = propTextOf(note.text);
      if (text.mode === 'lines') {
        // Blank lines at a sheet break belong to neither sheet; a note with no breaks is one sheet, line for line.
        const words = (lines) => lines.filter((l) => l.trim());
        if (/^prop_breaks:/m.test(note.text)) assert.deepEqual(words(linesOfPropHtml(page)), words(text.lines), style);
        else assert.deepEqual(linesOfPropHtml(page), text.lines, style);
        continue;
      }
      const sheets = [...page.matchAll(/<div class="prop-text">([\s\S]*?)<\/div>/g)].map((m) => m[1]).join(' ');
      const notePage = read('props', `${note.slug}.html`).replace(/<p class="prop-link">[\s\S]*?<\/p>/, '');
      const section = /<h2>The Text<\/h2>([\s\S]*?)(?:<h2\b|<\/main>)/.exec(notePage)[1];
      assert.deepEqual(wordsOf(sheets), wordsOf(section), style);
    }
  });

  it('sheets break where prop_breaks says, and the sheet chrome follows', () => {
    const term = read('props', 'kestrel-relay-log-prop.html');
    assert.equal((term.match(/<section class="sheet term"/g) || []).length, 2);
    assert.match(term, /SHEET 1\/2[\s\S]*MORE ▼[\s\S]*SHEET 2\/2[\s\S]*END OF FILE ■/);
    assert.equal((term.match(/END OF FILE/g) || []).length, 1);
    assert.match(term, /<section class="sheet desk" aria-label="The envelope">[\s\S]*POSTAGE PAID<strong>3 CR<\/strong>[\s\S]*style="--hand: 'Reenie Beanie'">KESTREL<\/div>/);
    assert.match(term, /<script src="styles\/terminal\/script\.js" defer><\/script>/);
    const form = read('props', 'harbour-authority-lien-prop.html');
    assert.equal((form.match(/<section class="sheet form"/g) || []).length, 2);
    assert.equal((form.match(/class="stamp"/g) || []).length, 1, 'the stamp is on the first sheet only');
    assert.match(form, /style="--accent: #2f5d50"/);
    assert.match(form, /HARDCOPY · SHEET 2\/2/);
  });

  it('a starter style\'s page links nothing outside the site', () => {
    // Every styled note's page, and the container's (the sea chest), which lists them.
    const pages = walk(path.join(docs, 'props')).filter((f) => f.endsWith('-prop.html'));
    assert.deepEqual(pages.map((f) => path.basename(f)).sort(), [...notes.map((n) => `${n.slug}-prop.html`), 'sea-chest-prop.html'].sort());
    for (const f of pages) {
      const page = fs.readFileSync(f, 'utf8');
      for (const [, url] of page.matchAll(/(?:href|src)="([^"]*)"/g)) assert.doesNotMatch(url, /^(?:[a-z][a-z0-9+.-]*:|\/)/i, `${f}: ${url}`);
    }
    for (const f of walk(docs).filter((p) => /\.(html|css|js)$/.test(p))) assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /fonts\.googleapis\.com/, f);
  });

  it('the site ships each starter style used, and NOTICE.txt names them as the generator\'s', () => {
    const notice = read('NOTICE.txt');
    for (const name of STARTERS) {
      assert.ok(fs.existsSync(path.join(docs, 'props', 'styles', name, 'style.css')), name);
      assert.ok(notice.includes(`props/styles/${name}/ (the generator's)`), `${name}\n${notice}`);
    }
    assert.ok(!fs.existsSync(path.join(docs, 'props', 'styles', 'terminal', 'style.json')), 'style.json is build input only');
  });

  it('a held or withheld item ships nothing of itself', () => {
    for (const f of walk(docs)) {
      if (!/\.(html|json|txt|js|css|xml)$/.test(f)) continue;
      assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /SEALED(?:LINE|BODY|TEXT)|WITHHELD(?:BODY|TEXT)/, f);
    }
    assert.deepEqual(logs.filter((l) => /WARNING: Props\//.test(l)), [], 'no prop row on any note');
  });

  it('the same vault with no styled props builds no prop styles and the NOTICE it had', () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'starter-plain-'));
    try {
      const configPath = prepareFixture('prop-styles', plain);
      const notesDir = path.join(plain, 'vault', 'Props');
      for (const n of fs.readdirSync(notesDir)) {
        const file = path.join(notesDir, n);
        fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^prop_style: .*\n/m, ''));
      }
      quietBuild(configPath);
      const out = path.join(plain, 'docs');
      assert.ok(!fs.existsSync(path.join(out, 'props', 'styles')));
      assert.ok(!fs.existsSync(path.join(out, 'css', 'props.css')));
      assert.ok(!fs.existsSync(path.join(out, 'fonts')));
      assert.equal(fs.readFileSync(path.join(out, 'NOTICE.txt'), 'utf8'), noticeText({ lunr: true }));
    } finally { fs.rmSync(plain, { recursive: true, force: true }); }
  });
});

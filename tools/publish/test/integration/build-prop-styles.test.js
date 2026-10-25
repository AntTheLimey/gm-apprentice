'use strict';
// A prop note that names a style gets a page the tool makes from its own `## The Text`, as the
// note page shows it, filled into the style's layout, with the style's files and fonts beside it.
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { build } = require('../../lib/build');
const { buildBoth } = require('../helpers/gm-build');
const { listFileText } = require('../helpers/publish-list');
const { linesOfPropHtml } = require('../../lib/props/text');
const { noticeText } = require('../../lib/notice');
const { prefetchForConfig } = require('../../lib/fonts');

const STYLE = {
  '_meta/prop-styles/t/layout.html': '<h1>{{title}}</h1>{{{body}}}<p class="stamp">{{prop_stamp}}</p>',
  '_meta/prop-styles/t/style.css': '.stamp { color: red; }\n',
};
const FENCE = ['DEAR SIR', 'The rent is due.', '  Signed ..... M'];
const note = (fm, text) => `---\ntype: prop\nprop_style: t\n${fm}---\nA letter left on the desk.\n\n## The Text\n\n${text}\n`;
const fenced = (lines, after = '') => `\`\`\`text\n${lines.join('\n')}\n\`\`\`${after}`;
const LETTER = (fm = 'prop_stamp: PAID\n', text = fenced(FENCE)) => ({ ...STYLE, 'Documents/Letter.md': note(fm, text) });
const OTHER = { 'Documents/Other.md': '---\ntype: document\n---\nOther.\n' };
const rels = (site) => site.files().map((f) => path.relative(site.dir, f).split(path.sep).join('/'));

const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const wordsOf = (html) => new Set(decode(String(html).replace(/<[^>]*>/g, ' ')).split(/[^\p{L}\p{N}]+/u).filter(Boolean));
// The words of the styled page's sheets, and of the note page's main.
const sheetWords = (page) => wordsOf([...page.matchAll(/<section class="sheet">([\s\S]*?)<\/section>/g)].map((m) => m[1]).join(' '));
const mainWords = (page) => wordsOf(/<main\b[\s\S]*<\/main>/.exec(page)[0]);
const subset = (a, b) => [...a].filter((w) => !b.has(w));

const seedFont = (slug, file = '0123456789abcdef.woff2') => ({
  [`_meta/font-cache/${slug}/faces.json`]: JSON.stringify([{ style: 'normal', weight: '400', unicodeRange: null, file }]),
  [`_meta/font-cache/${slug}/${file}`]: 'wOF2fake',
});
const quiet = (fn) => {
  const saved = { log: console.log, warn: console.warn };
  const lines = [];
  console.log = (m) => lines.push(String(m)); console.warn = (m) => lines.push(String(m));
  try { fn(); } finally { Object.assign(console, saved); }
  return lines;
};

describe('a published styled prop', () => {
  const s = buildBoth(LETTER(), { sites: ['player'] });
  after(() => s.cleanup());

  it("a published styled prop is on the site with the note page's words", () => {
    assert.ok(s.player.exists('props', 'letter.html'));
    const page = s.player.read('props', 'letter.html');
    assert.deepEqual(linesOfPropHtml(page), FENCE);
    assert.match(s.player.read('documents', 'letter.html'), /<a class="prop-btn" href="\.\.\/props\/letter\.html">See the prop<\/a>/);
    assert.match(page, /<nav class="gma-prop-bar"[^>]*>.*<a href="\.\.\/documents\/letter\.html">&larr; Letter<\/a>/);
    assert.match(page, /<link rel="stylesheet" href="\.\.\/css\/props\.css">/);
    assert.match(page, /<link rel="stylesheet" href="styles\/t\/style\.css">/);
    assert.match(page, /<body class="prop-page prop-style-t">/);
    assert.match(page, /<title>Letter<\/title>/);
    assert.match(page, /<h1>Letter<\/h1>/);
    assert.match(page, /<p class="stamp">PAID<\/p>/);
    assert.equal(s.player.read('props', 'styles', 't', 'style.css'), STYLE['_meta/prop-styles/t/style.css']);
    assert.match(s.player.read('css', 'props.css'), /@page/);
    assert.doesNotMatch(page, /fonts\.css/, 'no style font, so no fonts.css link');
  });

  it("the plugin's styles are not named in NOTICE.txt for a vault style, and nothing else changes", () => {
    assert.equal(s.player.read('NOTICE.txt'), noticeText({ lunr: true }));
  });
});

describe('the styled page says what the note page says', () => {
  const cases = {
    'a gm-only line after the fence': {
      files: LETTER('', fenced(FENCE, '\n<!-- gm-only -->KEEPER LINE<!-- /gm-only -->')),
      hidden: /KEEPER/, lines: FENCE,
    },
    'a hidden callout in prose': {
      files: LETTER('', 'Dear sir, the rent is due.\n\n> [!gm] Keeper\n> CALLOUT SECRET\n\nYours, M.'),
      player: { hide: { callouts: true } }, hidden: /CALLOUT SECRET/,
    },
    'a GM alias in the text': {
      files: { ...LETTER('', 'Signed, [[Elias Crowe]].'), 'NPCs/Lord Vane.md': '---\ntype: npc\ngm_aliases: ["Elias Crowe"]\n---\nA patron.\n' },
      hidden: /Elias Crowe/, shown: /Lord Vane/,
    },
    'a field the GM hides': {
      files: LETTER('prop_stamp: HIDDENSTAMP\n'), player: { hide: { fields: ['prop_stamp'] } },
      hidden: /HIDDENSTAMP/,
    },
  };
  for (const [name, c] of Object.entries(cases)) {
    it(name, () => {
      const s = buildBoth(c.files, { sites: ['player'], player: c.player || {} });
      try {
        const page = s.player.read('props', 'letter.html');
        const notePage = s.player.read('documents', 'letter.html');
        assert.doesNotMatch(page, c.hidden);
        assert.doesNotMatch(notePage, c.hidden);
        if (c.shown) { assert.match(page, c.shown); assert.match(notePage, c.shown); }
        if (c.lines) assert.deepEqual(linesOfPropHtml(page), c.lines);
        assert.deepEqual(subset(sheetWords(page), mainWords(notePage)), []);
      } finally { s.cleanup(); }
    });
  }
});

describe('what a styled prop ships', () => {
  it('a hostile field on a styled page is inert', () => {
    const s = buildBoth(LETTER("prop_stamp: '<script>alert(1)</script>'\n"), { sites: ['player'] });
    try {
      const page = s.player.read('props', 'letter.html');
      assert.doesNotMatch(page, /<script>alert/);
      assert.match(page, /&lt;script&gt;/);
    } finally { s.cleanup(); }
  });

  const shipsNothing = (s) => {
    const all = rels(s.player);
    assert.ok(!all.some((f) => f.startsWith('props/')), all.join(', '));
    assert.ok(!all.includes('css/props.css'));
    assert.ok(!all.some((f) => f.startsWith('fonts/')), all.join(', '));
    assert.doesNotMatch(s.player.read('NOTICE.txt'), /typefaces/);
  };

  it('a held styled prop ships nothing', () => {
    const s = buildBoth({ ...LETTER(), ...OTHER, ...seedFont('vt323'), '_meta/prop-styles/t/style.json': '{"fonts":["VT323"]}', '_meta/publish-list.yaml': listFileText({ publishing: ['Documents/Other.md'] }) }, { sites: ['player'] });
    try { shipsNothing(s); } finally { s.cleanup(); }
  });

  it("a stub's styled prop ships nothing", () => {
    const s = buildBoth({ ...LETTER('publish: stub\n'), ...seedFont('vt323'), '_meta/prop-styles/t/style.json': '{"fonts":["VT323"]}' }, { sites: ['player'] });
    try { shipsNothing(s); } finally { s.cleanup(); }
  });

  it('no ## The Text: the note page publishes with no link and a warning', () => {
    const s = buildBoth({ ...STYLE, 'Documents/Letter.md': '---\ntype: prop\nprop_style: t\n---\nA letter.\n' }, { sites: ['player'] });
    try {
      assert.ok(s.player.exists('documents', 'letter.html'));
      assert.doesNotMatch(s.player.read('documents', 'letter.html'), /See the prop/);
      assert.ok(!s.player.exists('props'));
      assert.ok(s.logs.includes('  WARNING: Documents/Letter.md: has no ## The Text section, so its styled page is not made — add a ## The Text section with the words the players see'), s.logs.join('\n'));
    } finally { s.cleanup(); }
  });

  it('prop_file and prop_style: the hand-made file ships and the build warns', () => {
    const s = buildBoth({ ...STYLE, 'Documents/Letter.md': '---\ntype: prop\nprop_file: letter.html\nprop_style: t\n---\nA letter.\n\n## The Text\n\nWords.\n', 'Documents/letter.html': '<html><body><p>HANDMADE</p></body></html>' }, { sites: ['player'] });
    try {
      assert.match(s.player.read('props', 'letter.html'), /HANDMADE/);
      assert.ok(!s.player.exists('props', 'styles'));
      assert.ok(!s.player.exists('css', 'props.css'));
      assert.ok(s.logs.some((l) => /prop_style "t" is not used: the note names a prop_file/.test(l)), s.logs.join('\n'));
    } finally { s.cleanup(); }
  });

  it('no styled page loads anything from another site', () => {
    const s = buildBoth({ ...LETTER(), ...seedFont('vt323'), '_meta/prop-styles/t/style.json': '{"fonts":["VT323"]}', '_meta/prop-styles/t/script.js': 'void 0;\n' }, { sites: ['player'] });
    try {
      const pages = rels(s.player).filter((f) => f.startsWith('props/') && f.endsWith('.html'));
      assert.ok(pages.length > 0);
      for (const f of pages) {
        const page = s.player.read(...f.split('/'));
        for (const [, url] of page.matchAll(/(?:href|src)="([^"]*)"/g)) assert.doesNotMatch(url, /^(?:[a-z][a-z0-9+.-]*:|\/)/i, `${f}: ${url}`);
      }
      assert.match(s.player.read('props', 'letter.html'), /<script src="styles\/t\/script\.js" defer><\/script>\n<\/body>/);
      for (const f of s.player.files()) assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /fonts\.googleapis\.com/, f);
    } finally { s.cleanup(); }
  });
});

describe('style fonts', () => {
  it('style fonts are self-hosted from the cache', () => {
    const s = buildBoth({ ...LETTER(), ...seedFont('vt323'), '_meta/prop-styles/t/style.json': '{"fonts":["VT323"]}' }, { sites: ['player'] });
    try {
      assert.match(s.player.read('props', 'styles', 'fonts.css'), /url\('\.\.\/\.\.\/fonts\/vt323\/0123456789abcdef\.woff2'\)/);
      assert.ok(s.player.exists('fonts', 'vt323', '0123456789abcdef.woff2'));
      assert.match(s.player.read('props', 'letter.html'), /<link rel="stylesheet" href="\.\.\/css\/props\.css">\n<link rel="stylesheet" href="styles\/fonts\.css">\n<link rel="stylesheet" href="styles\/t\/style\.css">/);
      // NOTICE.txt names the family, its folder, where it came from and where its licence is.
      assert.match(s.player.read('NOTICE.txt'), /VT323: fonts\/vt323\/, served unmodified from Google Fonts\. Licence: https:\/\/fonts\.google\.com\/specimen\/VT323\/license/);
    } finally { s.cleanup(); }
  });

  it('a font a field names through the font filter is self-hosted too', () => {
    const s = buildBoth({ ...LETTER('prop_font: Special Elite\n'), ...seedFont('special-elite'), '_meta/prop-styles/t/layout.html': '<h1 style="font-family: {{prop_font|font}}">{{title}}</h1>{{{body}}}' }, { sites: ['player'] });
    try {
      assert.match(s.player.read('props', 'styles', 'fonts.css'), /font-family: 'Special Elite'/);
      assert.match(s.player.read('NOTICE.txt'), /Special Elite: fonts\/special-elite\/, .*specimen\/Special\+Elite\/license/);
    } finally { s.cleanup(); }
  });

  it('the prefetch fetches a style font into the cache', async () => {
    const s = buildBoth({ ...LETTER(), '_meta/prop-styles/t/style.json': '{"fonts":["VT323"]}' }, { sites: [] });
    try {
      const asked = [];
      const fetch = async (url) => {
        asked.push(String(url));
        if (new URL(url).hostname === 'fonts.googleapis.com') {
          return new Response("@font-face { font-family: 'VT323'; font-style: normal; font-weight: 400; src: url(https://fonts.gstatic.com/s/vt323/a.woff2) format('woff2'); }", { status: 200 });
        }
        return new Response(Buffer.from('wOF2fake'), { status: 200 });
      };
      await prefetchForConfig(s.configPath, { fetch, log: () => {}, warn: () => {} });
      assert.ok(asked.some((u) => /family=VT323/.test(u)), asked.join('\n'));
      assert.ok(fs.existsSync(path.join(s.root, 'vault', '_meta', 'font-cache', 'vt323', 'faces.json')));
    } finally { s.cleanup(); }
  });

  it('with no cache, offline: one warning, no fonts.css, no link to it', () => {
    const s = buildBoth({ ...LETTER(), '_meta/prop-styles/t/style.json': '{"fonts":["VT323"]}' }, { sites: [] });
    try {
      const lines = quiet(() => build({ configPath: s.configPath, site: 'player', offline: true }));
      assert.equal(lines.filter((l) => /typefaces for the prop styles/.test(l)).length, 1, lines.join('\n'));
      assert.ok(!s.player.exists('props', 'styles', 'fonts.css'));
      assert.doesNotMatch(s.player.read('props', 'letter.html'), /fonts\.css/);
      assert.ok(s.player.exists('props', 'letter.html'));
    } finally { s.cleanup(); }
  });
});

describe('the GM site', () => {
  it('the GM site shows a held styled prop with its band', () => {
    const s = buildBoth({ ...LETTER(), ...OTHER, '_meta/publish-list.yaml': listFileText({ publishing: ['Documents/Other.md'] }) });
    try {
      const page = s.gm.read('props', 'letter.html');
      assert.match(page, /GM copy: not for players/);
      assert.match(page, /Players don't see this page:/);
      assert.deepEqual(linesOfPropHtml(page), FENCE);
      assert.ok(s.gm.exists('props', 'styles', 't', 'style.css'));
      assert.ok(!s.player.exists('props'));
    } finally { s.cleanup(); }
  });
});

describe('NOTICE.txt', () => {
  it('NOTICE.txt names the plugin styles a site ships', () => {
    const text = noticeText({ lunr: false, styles: ['terminal'] });
    assert.match(text, /props\/styles\/terminal\/ \(the generator's\)/);
    assert.equal(noticeText({ lunr: false, styles: [] }), noticeText({ lunr: false }));
  });

  it('names a sheet skin font served from fonts/', () => {
    const s = buildBoth({ 'PCs/Ada.md': '---\ntype: pc\nsheet_skin: console\n---\nA pilot.\n', ...seedFont('chakra-petch') }, { sites: ['player'] });
    try {
      assert.ok(s.player.exists('fonts', 'chakra-petch', '0123456789abcdef.woff2'), rels(s.player).join(', '));
      assert.match(s.player.read('NOTICE.txt'), /Chakra Petch: fonts\/chakra-petch\/, served unmodified from Google Fonts\. Licence: https:\/\/fonts\.google\.com\/specimen\/Chakra\+Petch\/license/);
      assert.doesNotMatch(s.player.read('NOTICE.txt'), /IBM Plex Mono/, 'a family not in the cache is not served');
    } finally { s.cleanup(); }
  });

  it("names a GM-supplied font as the site owner's", () => {
    const s = buildBoth({ ...OTHER, 'Assets/Fonts/hand.woff2': 'wOF2fake' }, { sites: ['player'], player: { theme: { fonts: { source: 'local', heading: 'Hand', files: [{ path: 'Assets/Fonts/hand.woff2', family: 'Hand' }] } } } });
    try {
      const text = s.player.read('NOTICE.txt');
      assert.match(text, /supplied by the site's owner:\n\n {2}fonts\/[^\n]*hand\.woff2/);
      assert.doesNotMatch(text, /Google Fonts\. Licence/);
    } finally { s.cleanup(); }
  });

  it('a site serving no fonts has the NOTICE it had', () => {
    const s = buildBoth(OTHER, { sites: ['player'] });
    try {
      assert.equal(s.player.read('NOTICE.txt'), noticeText({ lunr: true }));
    } finally { s.cleanup(); }
  });
});

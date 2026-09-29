const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert');
const { sanitizeBodyHtml, stripTags } = require('../../lib/html-allowlist');
const { createRenderer } = require('../../lib/markdown');
const { processContent, configureRenderer, extractSections } = require('../../lib/processor');
const { loadPublishConfig } = require('../../lib/config');
const { buildSearchIndex } = require('../../lib/search-index');
const { excerptFromMarkdown } = require('../../lib/excerpt');
const { extractRecap } = require('../../lib/templates/landing-data');
const fs = require('fs');
const os = require('os');
const path = require('path');

// #266: publish.allow_html lets raw HTML in page bodies render, through an allowlist.

describe('html allowlist sanitiser: author ids are namespaced', () => {
  it('prefixes an id that would hijack a site data island', () => {
    const out = sanitizeBodyHtml('<div id="gurps-live-data">{"x":1}</div>');
    assert.match(out, /id="u-gurps-live-data"/);
    assert.doesNotMatch(out, /id="gurps-live-data"/);
  });
  it('keeps in-page anchors linked', () => {
    const out = sanitizeBodyHtml('<a href="#seal">go</a><svg><g id="seal"></g></svg><a href="#">top</a>');
    assert.match(out, /href="#u-seal"/);
    assert.match(out, /<g id="u-seal">/);
    assert.match(out, /href="#"/);
  });
  it('keeps <use> references working', () => {
    const out = sanitizeBodyHtml('<svg><symbol id="s"></symbol><use href="#s"></use><use xlink:href="#s"></use></svg>');
    assert.match(out, /<symbol id="u-s">/);
    assert.match(out, /<use href="#u-s">/);
    assert.match(out, /<use xlink:href="#u-s">/);
  });
  it('rewrites local url() references and drops external ones', () => {
    const out = sanitizeBodyHtml('<svg><rect fill="url(#g)" stroke="url(https://evil.example/x.svg#p)" mask="url(//evil.example/m)" clip-path="url(#c)"/></svg>');
    assert.match(out, /fill="url\(#u-g\)"/);
    assert.match(out, /clip-path="url\(#u-c\)"/);
    assert.doesNotMatch(out, /evil|stroke=|mask=/);
  });
  it('rewrites aria idrefs and table headers', () => {
    const out = sanitizeBodyHtml('<div aria-labelledby="a b" aria-describedby="c" role="region">x</div><table><tr><th id="h1">H</th><td headers="h1">v</td></tr></table>');
    assert.match(out, /aria-labelledby="u-a u-b"/);
    assert.match(out, /aria-describedby="u-c"/);
    assert.match(out, /<th id="u-h1">/);
    assert.match(out, /headers="u-h1"/);
  });
  it('prefixes named anchors', () => {
    assert.match(sanitizeBodyHtml('<a name="x" href="#x">t</a>'), /name="u-x" href="#u-x"/);
  });
});

describe('html allowlist sanitiser: never allowed', () => {
  const cases = {
    'script element and its content': ['<p>ok</p><script>alert(1)</script>', /script|alert/i],
    'style element and its content': ['<style>body{display:none}</style>ok', /style|display/i],
    'iframe': ['<iframe src="https://evil.example"></iframe>ok', /iframe|evil/i],
    'object / embed': ['<object data="x.swf"></object><embed src="x.swf">ok', /object|embed|swf/i],
    'form controls': ['<form action="/x"><input name="p"><button>Go</button></form>ok', /form|input|button/i],
    'link / meta / base': ['<link rel="stylesheet" href="x.css"><meta http-equiv="refresh" content="0"><base href="https://evil.example/">ok', /link|meta|base|evil/i],
    'on* event handlers': ['<img src="x.png" onerror="alert(1)"><div onclick="alert(2)" onmouseover="x()">ok</div>', /on\w+=|alert/i],
    'javascript: links': ['<a href="javascript:alert(1)">x</a><a href="JaVaScRiPt:alert(1)">y</a><a href=" javascript:alert(1)">z</a>', /javascript|alert/i],
    'data: links': ['<a href="data:text/html,<script>alert(1)</script>">x</a>', /data:|alert/i],
    'data: in img other than raster images': ['<img src="data:image/svg+xml;base64,PHN2Zz4="><img src="data:text/html,hi">', /data:/i],
    'svg foreignObject and its content': ['<svg><foreignObject><div>INNER</div></foreignObject></svg>', /foreignObject|INNER/i],
    'svg <use> pointing off-document': ['<svg><use href="https://evil.example/a.svg#x"></use><use xlink:href="//evil.example/b.svg#y"></use></svg>', /evil/i],
    'svg script': ['<svg><script>alert(1)</script><a href="javascript:alert(2)"><text>t</text></a></svg>', /script|alert|javascript/i],
    'url() in style': ['<div style="background: url(https://evil.example/t.png); color: red">ok</div>', /url|evil/i],
    'expression() in style': ['<div style="width: expression(alert(1))">ok</div>', /expression|alert/i],
    'position in style (overlaying site chrome)': ['<div style="position: fixed; top: 0">ok</div>', /position|fixed/i],
    'data-* attributes': ['<div data-live-mount="x">ok</div>', /data-/i],
    'comments': ['<p>a<!-- private -->b</p>', /private|<!--/],
  };
  for (const [name, [input, forbidden]] of Object.entries(cases)) {
    it(`strips ${name}`, () => {
      const out = sanitizeBodyHtml(input);
      assert.doesNotMatch(out, forbidden, out);
    });
  }

  it('keeps a raster data: image in <img>', () => {
    const out = sanitizeBodyHtml('<img src="data:image/png;base64,iVBORw0KGgo=" alt="seal">');
    assert.match(out, /src="data:image\/png;base64,iVBORw0KGgo="/);
  });
});

describe('html allowlist sanitiser: survives', () => {
  it('keeps a styled handout div', () => {
    const out = sanitizeBodyHtml('<div class="handout" id="letter" style="border: 1px solid #333; font-family: Georgia, serif; color: var(--accent)">Dear <em>sir</em></div>');
    assert.match(out, /<div class="handout" id="u-letter" style="border:1px solid #333;font-family:Georgia, serif;color:var\(--accent\)">Dear <em>sir<\/em><\/div>/);
  });

  it('keeps inline SVG with gradients, local <use> and text', () => {
    const out = sanitizeBodyHtml(
      '<svg viewBox="0 0 100 50" width="100"><defs><linearGradient id="g"><stop offset="0" stop-color="#900"/></linearGradient>'
      + '<symbol id="s"><circle cx="5" cy="5" r="4"/></symbol></defs>'
      + '<rect width="100" height="50" fill="url(#g)"/><use href="#s" x="10"/><path d="M0 0 L10 10" stroke="#000"/>'
      + '<text x="50" y="25" text-anchor="middle">Seal of <tspan>Thoth</tspan></text></svg>');
    for (const re of [/<svg viewbox="0 0 100 50" width="100">/, /<linearGradient id="u-g">/, /<stop offset="0" stop-color="#900">/,
      /<symbol id="u-s">/, /<rect width="100" height="50" fill="url\(#u-g\)">/, /<use href="#u-s" x="10">/,
      /<path d="M0 0 L10 10" stroke="#000">/, /text-anchor="middle">Seal of <tspan>Thoth<\/tspan><\/text>/]) {
      assert.match(out, re, out);
    }
  });

  it('keeps details/summary, tables and figures', () => {
    const out = sanitizeBodyHtml('<details open><summary>Clue</summary><p>Found it.</p></details>'
      + '<figure><img src="map.png" alt="Map"><figcaption>The map</figcaption></figure>'
      + '<table><caption>Ledger</caption><tr><th scope="col">Item</th></tr><tr><td colspan="2">Lamp</td></tr></table>');
    assert.match(out, /<details open><summary>Clue<\/summary><p>Found it\.<\/p><\/details>/);
    assert.match(out, /<figure><img src="map.png" alt="Map" \/><figcaption>The map<\/figcaption><\/figure>/);
    assert.match(out, /<th scope="col">Item<\/th>/);
    assert.match(out, /<td colspan="2">Lamp<\/td>/);
  });

  it('keeps ordinary links', () => {
    const out = sanitizeBodyHtml('<a href="../npcs/vex.html">Vex</a> <a href="https://example.com">site</a> <a href="#top">top</a>');
    assert.strictEqual(out, '<a href="../npcs/vex.html">Vex</a> <a href="https://example.com">site</a> <a href="#u-top">top</a>');
  });
});

describe('createRenderer({ allowHtml })', () => {
  const src = 'Intro <span class="x">inline</span>.\n\n<div class="handout">\n\n**Bold** text\n\n</div>\n\n<script>alert(1)</script>\n\n| a | b |\n|:-|-:|\n| 1 | 2 |\n\n```html\n<div>code</div>\n```\n\n3. three\n4. four\n\n> [!info] Note\n> body\n';

  it('off (default) escapes raw HTML exactly as before', () => {
    const html = createRenderer().render(src);
    assert.match(html, /&lt;div class=.handout.&gt;/);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    // same output as a renderer constructed with the flag explicitly off
    assert.strictEqual(createRenderer({ allowHtml: false }).render(src), html);
  });

  it('on renders allowed HTML, sanitises the rest, and keeps markdown output intact', () => {
    const html = createRenderer({ allowHtml: true }).render(src);
    assert.match(html, /<span class="x">inline<\/span>/);
    assert.match(html, /<div class="handout">\s*<p><strong>Bold<\/strong> text<\/p>\s*<\/div>/);
    assert.doesNotMatch(html, /<script|alert/);
    assert.match(html, /<th style="text-align:left">a<\/th>/);
    assert.match(html, /<td style="text-align:right">2<\/td>/);
    assert.match(html, /<pre><code class="language-html">&lt;div&gt;code&lt;\/div&gt;\n<\/code><\/pre>/);
    assert.match(html, /<ol start="3">/);
    assert.match(html, /<div class="callout callout-info">\n<div class="callout-title">Note<\/div>/);
  });
});

describe('processContent with allow_html: gm-only content never reaches the output', () => {
  afterEach(() => configureRenderer({ allowHtml: false }));

  const render = (markdown, opts = {}) => {
    configureRenderer({ allowHtml: true });
    return processContent({ markdown, frontmatter: {}, outputPath: 'x.html' }, {}, opts.excludeSections || ['GM Notes'], {}, {});
  };

  const cases = {
    'a gm-only block holding raw HTML':
      'Public.\n\n<!-- gm-only -->\n<div class="handout">SECRET <b>bold</b></div>\n<svg><text>SECRET</text></svg>\n<!-- /gm-only -->\n\nAfter.',
    'a gm-only block inside an HTML block':
      '<div class="handout">\nPublic.\n<!-- gm-only -->\nSECRET\n<!-- /gm-only -->\n</div>\n\nAfter.',
    'a closer hidden inside an element on the same line (block stays open)':
      'Public.\n\n<!-- gm-only -->\n<div><!-- /gm-only --></div>\nSECRET\n<!-- /gm-only -->\n\nAfter.',
    'an opener followed by content on the same line':
      'Public.\n\n<!-- gm-only --> SECRET on the marker line\nSECRET\n<!-- /gm-only -->\n\nAfter.',
    'nested gm-only blocks':
      'Public.\n\n<!-- gm-only -->\nSECRET\n<!-- gm-only -->\nSECRET\n<!-- /gm-only -->\nSECRET\n<!-- /gm-only -->\n\nAfter.',
    'an unclosed gm-only block (stripped to end of file)':
      'Public.\n\n<!-- gm-only -->\n<div>SECRET</div>\n\nSECRET',
    'a spoiler block holding raw HTML':
      'Public.\n\n<!-- spoiler -->\n<details><summary>SECRET</summary>SECRET</details>\n<!-- /spoiler -->\n\nAfter.',
    'a plain comment spanning lines inside an HTML block':
      '<div class="handout">\nPublic.\n<!-- keeper note\nSECRET\n-->\n</div>\n\nAfter.',
    'a comment split so its opener and closer sit on different lines':
      'Public. <!--\nSECRET\nSECRET -->\n\nAfter.',
    'an unclosed plain comment (stripped to end of file)':
      'Public.\n\n<!-- note to self\nSECRET\n\n<div>SECRET</div>',
    'a browser-style --!> comment closer (over-strips, never under-strips)':
      'Public.\n\n<!-- note SECRET --!>\nSECRET',
    'an excluded GM Notes section holding raw HTML':
      'Public.\n\n## GM Notes\n\n<div class="handout">SECRET</div>\n\n<svg><text>SECRET</text></svg>',
  };

  for (const [name, markdown] of Object.entries(cases)) {
    it(`hides ${name}`, () => {
      const { html } = render(markdown);
      assert.doesNotMatch(html, /SECRET/, html);
      assert.doesNotMatch(html, /<!--|--!?>|gm-only|spoiler/, html);
      assert.match(html, /Public\./);
    });
  }

  it('shows a gm-only marker inside a fenced code block as escaped code, not a live comment', () => {
    const { html } = render('```\n<!-- gm-only -->\nexample\n<!-- /gm-only -->\n```');
    assert.match(html, /<pre><code>&lt;!-- gm-only --&gt;\nexample\n&lt;!-- \/gm-only --&gt;\n<\/code><\/pre>/);
  });

  it('renders allowed markup that sits outside every gm-only block', () => {
    const { html } = render('<div class="handout">Handout</div>\n\n<details><summary>More</summary>Body</details>\n\n<!-- gm-only -->\nSECRET\n<!-- /gm-only -->');
    assert.match(html, /<div class="handout">Handout<\/div>/);
    assert.match(html, /<details><summary>More<\/summary>Body<\/details>/);
    assert.doesNotMatch(html, /SECRET/);
  });

  it('applies to extractSections (PC/NPC accordions, story recaps) too', () => {
    configureRenderer({ allowHtml: true });
    const [section] = extractSections('## Letter\n\n<div class="handout">Hi<script>x()</script></div>');
    assert.match(section.html, /<div class="handout">Hi<\/div>/);
    configureRenderer({ allowHtml: false });
    const [off] = extractSections('## Letter\n\n<div class="handout">Hi</div>');
    assert.match(off.html, /&lt;div class=.handout.&gt;/);
  });

  it('flag off leaves processContent output unchanged', () => {
    configureRenderer({ allowHtml: false });
    const page = { markdown: 'A <div class="h">x</div>\n\n<!-- note -->\n\n<b>b</b>', frontmatter: {}, outputPath: 'x.html' };
    const { html } = processContent(page, {}, [], {}, {});
    assert.strictEqual(html, createRenderer().render('A <div class="h">x</div>\n\n\n<b>b</b>'));
    assert.match(html, /&lt;div class=.h.&gt;x&lt;\/div&gt;/);
  });
});

describe('plain-text consumers never carry raw tags', () => {
  const markdown = 'The <b>Magellan</b>\'s log.\n\n<div class="handout" style="color:red">Handout text</div>\n\n<svg viewBox="0 0 1 1"><text>Label</text></svg>\n\n<script>var leak = 1;</script>';

  it('search index terms contain no tag or attribute names', () => {
    const { index } = buildSearchIndex([{ displayTitle: 'Log', outputPath: 'log.html', frontmatter: { type: 'document' }, markdown }]);
    const terms = Object.keys(index.invertedIndex || {}).concat((index.invertedIndex || []).map(e => e[0]));
    for (const bad of ['div', 'class', 'handout"', 'style', 'svg', 'viewbox', 'script', 'var', 'leak']) {
      assert.ok(!terms.includes(bad), `search index contains "${bad}": ${terms.join(' ')}`);
    }
    for (const good of ['log', 'handout', 'label']) {
      assert.ok(terms.includes(good), `search index is missing "${good}": ${terms.join(' ')}`);
    }
  });

  it('excerpts contain no tags', () => {
    const excerpt = excerptFromMarkdown(markdown);
    assert.doesNotMatch(excerpt, /[<>]/);
    assert.match(excerpt, /Magellan's log/);
  });

  it('landing recap contains no tags', () => {
    const recap = extractRecap({ frontmatter: {}, publishedMarkdown: '## Narrative Recap\n\n<svg viewBox="0 0 1 1"><rect width="1" height="1"/></svg>\n\n<div class="handout">The <b>party</b> fled.</div>\n' });
    assert.doesNotMatch(recap, /[<>]/);
    assert.match(recap, /The party fled\./);
  });

  it('stripTags keeps a bare < in prose', () => {
    assert.strictEqual(stripTags('a < b and c > d').trim(), 'a < b and c > d');
  });

  it('stripTags keeps angle-bracket prose and autolinks that are not element names', () => {
    assert.strictEqual(stripTags('Met <Grim> at <https://x.com>, <b>bold</b>.'), 'Met <Grim> at <https://x.com>, bold.');
  });
});

describe('publish.allow_html config', () => {
  const load = (yaml) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-allow-html-'));
    fs.mkdirSync(path.join(dir, '_meta'));
    fs.writeFileSync(path.join(dir, '_meta', 'vault-config.md'), `---\npublish:\n${yaml}---\n`);
    const warn = console.warn;
    const warnings = [];
    console.warn = (...a) => warnings.push(a.join(' '));
    try {
      return { config: loadPublishConfig(dir, {}), warnings };
    } finally {
      console.warn = warn;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };

  it('defaults to false', () => {
    assert.strictEqual(load('  mode: player\n').config.allow_html, false);
  });

  it('is true only for a YAML true', () => {
    assert.strictEqual(load('  allow_html: true\n').config.allow_html, true);
    assert.strictEqual(load('  allow_html: false\n').config.allow_html, false);
  });

  it('warns and stays off for a non-boolean value', () => {
    const { config, warnings } = load('  allow_html: "yes"\n');
    assert.strictEqual(config.allow_html, false);
    assert.match(warnings.join('\n'), /allow_html/);
  });

  it('ignores vault.config.json', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-allow-html-'));
    try {
      assert.strictEqual(loadPublishConfig(dir, { allow_html: true, allowHtml: true }).allow_html, false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

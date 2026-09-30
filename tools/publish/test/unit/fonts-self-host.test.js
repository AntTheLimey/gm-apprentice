const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const fonts = require('../../lib/fonts');
const { build } = require('../../lib/build');

const WOFF2 = Buffer.concat([Buffer.from('wOF2'), Buffer.from('fake-font-bytes')]);

function css(family, urls) {
  return urls.map(([style, weight, url, range]) => `/* latin */
@font-face {
  font-family: '${family}';
  font-style: ${style};
  font-weight: ${weight};
  font-display: swap;
  src: url(${url}) format('woff2');
  unicode-range: ${range};
}`).join('\n');
}

// A fetch that serves a CSS response per requested family and woff2 for gstatic URLs.
function mockFetch(calls, { failNetwork = false, badHost = false } = {}) {
  return async (url) => {
    calls.push(String(url));
    if (failNetwork) throw new Error('offline');
    const u = new URL(url);
    if (u.hostname === 'fonts.googleapis.com') {
      const family = u.searchParams.get('family').split(':')[0];
      const host = badHost ? 'evil.example.com' : 'fonts.gstatic.com';
      const slug = family.replace(/ /g, '');
      return new Response(css(family, [
        ['normal', '400', `https://${host}/s/${slug}/n400a.woff2`, 'U+0000-00FF'],
        ['normal', '400', `https://${host}/s/${slug}/n400b.woff2`, 'U+0100-024F'],
        ['italic', '400', `https://${host}/s/${slug}/i400.woff2`, 'U+0000-00FF'],
        ['normal', '700', `https://${host}/s/${slug}/n700.woff2`, 'U+0000-00FF'],
      ]), { status: 200 });
    }
    return new Response(WOFF2, { status: 200 });
  };
}

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'gm-fonts-')); }

describe('font family safety', () => {
  it('rejects traversal and odd family names', () => {
    for (const bad of ['../../etc', 'a/b', "x'; }", '', 'a  b', 'x'.repeat(80)]) {
      assert.strictEqual(fonts.isValidFamily(bad), false, bad);
    }
    assert.strictEqual(fonts.isValidFamily('IM Fell English'), true);
    assert.strictEqual(fonts.isValidFamily('M PLUS 1p'), true);
  });
});

describe('presetFamiliesFor', () => {
  it('reports the scifi preset font even with a custom palette (the preset CSS still ships)', () => {
    const { presetFamiliesFor } = require('../../lib/fonts');
    assert.deepStrictEqual(presetFamiliesFor({ genre: 'scifi' }), presetFamiliesFor({ genre: 'scifi', palette: { bg: '#000' } }));
    assert.ok(presetFamiliesFor({ genre: 'scifi', palette: { bg: '#000' } }).includes('Rajdhani'));
  });
});

describe('parseFontFaces', () => {
  it('keeps unicode-range and drops non-gstatic hosts', () => {
    const text = css('Foo', [
      ['normal', '400', 'https://fonts.gstatic.com/a.woff2', 'U+0000-00FF'],
      ['normal', '700', 'https://evil.example.com/b.woff2', 'U+0000-00FF'],
      ['normal', '400', 'http://fonts.gstatic.com/c.woff2', 'U+0000-00FF'],
    ]);
    const faces = fonts.parseFontFaces(text, 'Foo');
    assert.strictEqual(faces.length, 1);
    assert.strictEqual(faces[0].unicodeRange, 'U+0000-00FF');
  });
});

describe('ensureFontCache', () => {
  it('downloads once, then a second run makes no network calls', async () => {
    const vault = tmp();
    const calls = [];
    const warnings = [];
    const opts = { fetch: mockFetch(calls), warn: (m) => warnings.push(m), log: () => {} };
    await fonts.ensureFontCache(vault, ['IM Fell English'], opts);
    assert.ok(calls.length > 0);
    assert.deepStrictEqual(warnings, []);
    const faces = fonts.readFamilyCache(vault, 'IM Fell English');
    assert.strictEqual(faces.length, 4);
    const dir = path.join(vault, '_meta/font-cache/im-fell-english');
    assert.strictEqual(fs.readdirSync(dir).filter(f => f.endsWith('.woff2')).length, 4);
    calls.length = 0;
    await fonts.ensureFontCache(vault, ['IM Fell English'], opts);
    assert.deepStrictEqual(calls, []);
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it('warns loudly and caches nothing when the network fails', async () => {
    const vault = tmp();
    const warnings = [];
    await fonts.ensureFontCache(vault, ['Cinzel'], { fetch: mockFetch([], { failNetwork: true }), warn: (m) => warnings.push(m), log: () => {} });
    assert.match(warnings.join('\n'), /could not download font "Cinzel"/);
    assert.strictEqual(fonts.readFamilyCache(vault, 'Cinzel'), null);
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it('refuses CSS that points outside fonts.gstatic.com', async () => {
    const vault = tmp();
    const warnings = [];
    await fonts.ensureFontCache(vault, ['Cinzel'], { fetch: mockFetch([], { badHost: true }), warn: (m) => warnings.push(m), log: () => {} });
    assert.match(warnings.join('\n'), /no usable font files/);
    assert.strictEqual(fonts.readFamilyCache(vault, 'Cinzel'), null);
    fs.rmSync(vault, { recursive: true, force: true });
  });
});

describe('fetch hardening', () => {
  const withUrl = (res, url) => { Object.defineProperty(res, 'url', { value: url }); return res; };

  it('rejects a font whose content-length exceeds the cap before buffering it', async () => {
    const vault = tmp();
    const warnings = [];
    const base = mockFetch([]);
    const fetchImpl = async (url) => {
      const res = await base(url);
      if (new URL(url).hostname !== 'fonts.gstatic.com') return res;
      return new Response(WOFF2, { status: 200, headers: { 'content-length': String(6 * 1024 * 1024) } });
    };
    await fonts.ensureFontCache(vault, ['Cinzel'], { fetch: fetchImpl, warn: (m) => warnings.push(m), log: () => {} });
    assert.match(warnings.join('\n'), /too large/);
    assert.strictEqual(fonts.readFamilyCache(vault, 'Cinzel'), null);
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it('rejects a font response redirected off fonts.gstatic.com', async () => {
    const vault = tmp();
    const warnings = [];
    const base = mockFetch([]);
    const fetchImpl = async (url) => {
      const res = await base(url);
      return new URL(url).hostname === 'fonts.gstatic.com' ? withUrl(res, 'https://evil.example.com/x.woff2') : res;
    };
    await fonts.ensureFontCache(vault, ['Cinzel'], { fetch: fetchImpl, warn: (m) => warnings.push(m), log: () => {} });
    assert.match(warnings.join('\n'), /redirected to evil\.example\.com/);
    assert.strictEqual(fonts.readFamilyCache(vault, 'Cinzel'), null);
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it('rejects a CSS response redirected off fonts.googleapis.com', async () => {
    const vault = tmp();
    const warnings = [];
    const base = mockFetch([]);
    const fetchImpl = async (url) => {
      const res = await base(url);
      return new URL(url).hostname === 'fonts.googleapis.com' ? withUrl(res, 'https://evil.example.com/css') : res;
    };
    await fonts.ensureFontCache(vault, ['Cinzel'], { fetch: fetchImpl, warn: (m) => warnings.push(m), log: () => {} });
    assert.match(warnings.join('\n'), /redirected to evil\.example\.com/);
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it('accepts responses whose final URL stays on the expected hosts', async () => {
    const vault = tmp();
    const base = mockFetch([]);
    const fetchImpl = async (url) => withUrl(await base(url), String(url));
    await fonts.ensureFontCache(vault, ['Cinzel'], { fetch: fetchImpl, warn: () => {}, log: () => {} });
    assert.ok(fonts.readFamilyCache(vault, 'Cinzel'));
    fs.rmSync(vault, { recursive: true, force: true });
  });
});

describe('index exports', () => {
  it('exposes buildWithFonts', () => {
    assert.strictEqual(typeof require('../../lib/index').buildWithFonts, 'function');
  });
});

describe('build with source: self-host', () => {
  function setup(fontsYaml, genre) {
    const work = tmp();
    const vault = path.join(work, 'vault');
    fs.mkdirSync(path.join(vault, '_meta'), { recursive: true });
    fs.mkdirSync(path.join(vault, 'Characters/NPCs'), { recursive: true });
    fs.writeFileSync(path.join(vault, '_meta/vault-config.md'),
      `---\npublish:\n  theme:\n${genre ? `    genre: ${genre}\n` : ''}    fonts:\n${fontsYaml}\n---\n`);
    fs.writeFileSync(path.join(vault, 'Characters/NPCs/Someone.md'), '---\ntype: npc\n---\n\n# Someone\n');
    const outputDir = path.join(work, 'docs');
    const configPath = path.join(work, 'vault.config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      siteTitle: 'Self Host', siteUrl: 'https://example.github.io/x', vaultPath: vault, outputDir,
      excludeDirs: ['_meta', '_Templates'], folderMap: { 'Characters/NPCs': 'characters/npcs' },
    }));
    return { work, vault, outputDir, configPath };
  }

  function quiet(fn) {
    const warns = [];
    const w = console.warn; const l = console.log;
    console.warn = (...a) => warns.push(a.join(' ')); console.log = () => {};
    try { fn(); } finally { console.warn = w; console.log = l; }
    return warns;
  }

  it('emits local @font-face with unicode-range, copies files, and never mentions Google', async () => {
    const s = setup('      heading: IM Fell English\n      body: Cormorant Garamond\n      source: self-host');
    await fonts.prefetchForConfig(s.configPath, { fetch: mockFetch([]), log: () => {}, warn: () => {} });
    const warns = quiet(() => build({ configPath: s.configPath }));
    const theme = fs.readFileSync(path.join(s.outputDir, 'css/theme.css'), 'utf8');
    assert.ok(!/googleapis|gstatic/.test(theme));
    assert.match(theme, /font-family: 'IM Fell English'/);
    assert.match(theme, /font-style: italic/);
    assert.match(theme, /unicode-range: U\+0100-024F/);
    assert.match(theme, /--font-heading: 'IM Fell English', serif/);
    assert.strictEqual(fs.readdirSync(path.join(s.outputDir, 'fonts/im-fell-english')).length, 4);
    assert.strictEqual(fs.readdirSync(path.join(s.outputDir, 'fonts/cormorant-garamond')).length, 4);
    assert.ok(!warns.some(w => /Google Fonts at page load/.test(w)));
    fs.rmSync(s.work, { recursive: true, force: true });
  });

  it('on a cache miss warns and falls back to the stack, never a Google import', () => {
    const s = setup('      heading: Cinzel\n      body: system-ui\n      source: self-host');
    const warns = quiet(() => build({ configPath: s.configPath }));
    const theme = fs.readFileSync(path.join(s.outputDir, 'css/theme.css'), 'utf8');
    assert.ok(!/googleapis|gstatic|@import/.test(theme));
    assert.match(theme, /--font-heading: 'Cinzel', serif/);
    assert.ok(warns.some(w => /"Cinzel" is not in the vault's font cache/.test(w)), warns.join('\n'));
    fs.rmSync(s.work, { recursive: true, force: true });
  });

  it('self-hosts the scifi preset font and strips its Google import', async () => {
    const s = setup('      source: self-host', 'scifi');
    await fonts.prefetchForConfig(s.configPath, { fetch: mockFetch([]), log: () => {}, warn: () => {} });
    quiet(() => build({ configPath: s.configPath }));
    const preset = fs.readFileSync(path.join(s.outputDir, 'css/themes/scifi.css'), 'utf8');
    assert.ok(!/googleapis/.test(preset));
    assert.match(fs.readFileSync(path.join(s.outputDir, 'css/theme.css'), 'utf8'), /font-family: 'Rajdhani'/);
    fs.rmSync(s.work, { recursive: true, force: true });
  });

  it('source: google warns once, naming the fonts and the self-host fix', () => {
    const s = setup('      heading: Cinzel\n      body: Inter');
    const warns = quiet(() => build({ configPath: s.configPath }));
    const hits = warns.filter(w => /Google Fonts at page load/.test(w));
    assert.strictEqual(hits.length, 1);
    assert.match(hits[0], /Cinzel, Inter/);
    assert.match(hits[0], /theme\.fonts\.source: self-host/);
    fs.rmSync(s.work, { recursive: true, force: true });
  });

  it('system fonts produce no Google warning', () => {
    const s = setup('      heading: serif\n      body: system-ui');
    const warns = quiet(() => build({ configPath: s.configPath }));
    assert.ok(!warns.some(w => /Google Fonts/.test(w)));
    fs.rmSync(s.work, { recursive: true, force: true });
  });
});

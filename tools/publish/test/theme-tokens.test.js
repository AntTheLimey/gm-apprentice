'use strict';
// The custom properties a theme may set (#363), checked against what the build writes. Every listed token is declared
// where the list says, with the default it says (a site that sets none looks as it did); an unset token is declared
// nowhere and every rule that reads it says what to use instead; every custom property the tool's stylesheets read is
// listed or named private; and style.css names its colours rather than writing them into rules.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildBoth } = require('./helpers/gm-build');
const { TOKENS, GROUPS, isPrivate } = require('../lib/theme-tokens');

const CSS = path.join(__dirname, '..', 'css');
const site = buildBoth({ 'NPCs/Mara.md': '---\ntype: npc\n---\nA person.\n' }, { sites: ['player', 'gm'] });
after(() => site.cleanup());
const built = site.player.read('css', 'style.css');
const noComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
// The stylesheet without its @media print blocks (print keeps the light palette whatever the screen shows).
function withoutPrint(css) {
  let out = css;
  for (let at = out.indexOf('@media print'); at >= 0; at = out.indexOf('@media print')) {
    let depth = 0;
    let i = out.indexOf('{', at);
    for (; i < out.length; i++) {
      if (out[i] === '{') depth++;
      else if (out[i] === '}' && --depth === 0) break;
    }
    out = out.slice(0, at) + out.slice(i + 1);
  }
  return out;
}

// Every rule block whose selector is exactly `selector`, its declarations as a map (later ones win).
function declared(css, selector) {
  const out = new Map();
  const re = /([^{};]+)\{([^{}]*)\}/g;
  let m;
  const text = withoutPrint(noComments(css));
  while ((m = re.exec(text))) {
    if (m[1].trim().replace(/\s+/g, ' ') !== selector) continue;
    for (const d of m[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+)/g)) out.set(d[1], d[2].trim());
  }
  return out;
}
const root = declared(built, ':root');
const light = declared(built, ':root:where([data-theme="light"])');
const coc = declared(built, '.coc-sheet-root, .cr-modal-backdrop.coc');
const allCss = () => {
  const files = ['style.css', 'gm.css', 'props.css', ...fs.readdirSync(path.join(CSS, 'skins')).map((f) => `skins/${f}`),
    ...fs.readdirSync(path.join(CSS, 'themes')).map((f) => `themes/${f}`)];
  return files.map((f) => ({ f, text: noComments(fs.readFileSync(path.join(CSS, f), 'utf8')) }));
};

test('the list has no name twice, and every token sits in a group', () => {
  const names = TOKENS.map((t) => t.name);
  assert.deepEqual(names.filter((n, i) => names.indexOf(n) !== i), []);
  for (const t of TOKENS) assert.ok(GROUPS.some((g) => g.id === t.group), t.name);
});

for (const t of TOKENS) {
  test(`${t.name} is declared as the list says`, () => {
    if (t.scope === 'root') assert.equal(root.get(t.name), t.value, `${t.name} in :root of the built style.css`);
    if (t.scope === 'coc') assert.equal(coc.get(t.name), t.value, `${t.name} on the Call of Cthulhu sheet`);
    if (t.light) assert.equal(light.get(t.name), t.light, `${t.name} in the light palette`);
    if (t.scope === 'unset') {
      assert.doesNotMatch(noComments(built), new RegExp(`${t.name}\\s*:`), `${t.name} is declared, but the list says it is unset`);
      const uses = allCss().flatMap(({ f, text }) => [...text.matchAll(new RegExp(`var\\(${t.name}(\\s*[,)])`, 'g'))].map((m) => ({ f, sep: m[1].trim() })));
      assert.ok(uses.length > 0, `${t.name} is read nowhere`);
      for (const u of uses) assert.equal(u.sep, ',', `${u.f} reads ${t.name} with nothing to fall back on`);
    } else {
      assert.ok(allCss().some(({ text }) => text.includes(`var(${t.name})`) || text.includes(`var(${t.name},`)), `${t.name} is read nowhere`);
    }
  });
}

test('every custom property the stylesheets read is listed or private', () => {
  const listed = new Set(TOKENS.map((t) => t.name));
  const stray = new Set();
  for (const { f, text } of allCss()) {
    for (const m of text.matchAll(/var\((--[\w-]+)/g)) if (!listed.has(m[1]) && !isPrivate(m[1])) stray.add(`${m[1]} (${f})`);
  }
  assert.deepEqual([...stray], [], 'list these in lib/theme-tokens.js, or name them private there');
});

// A styled prop page and a gazetteer page link css/gm.css and css/props.css without style.css, so a custom property
// declared only in style.css is undefined there. Each read of one carries today's literal as its fallback, with two
// exceptions: the palette names gm.css read bare before #363 (on such a page they have always been undefined, and a
// fallback now would change how those pages look), and the full-bleed hero's rules, which match only on a landing page,
// and every landing page loads style.css.
test('gm.css and props.css read style.css-only tokens with a fallback (they load without style.css)', () => {
  const declares = (text) => new Set([...text.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
  const styleOnly = declares(noComments(fs.readFileSync(path.join(CSS, 'style.css'), 'utf8')));
  const READ_BARE_BEFORE_363 = new Set(['--warning', '--bg-card', '--text', '--border']);
  const LANDING_ONLY = /landing-full-bleed|landing-hero--full-bleed/;
  const bare = [];
  for (const f of ['gm.css', 'props.css']) {
    const text = noComments(fs.readFileSync(path.join(CSS, f), 'utf8'));
    const own = declares(text);
    for (const m of text.matchAll(/([^{};]+)\{([^{}]*)\}/g)) {
      if (LANDING_ONLY.test(m[1])) continue;
      for (const v of m[2].matchAll(/var\((--[\w-]+)\s*([,)])/g)) {
        if (v[2] === ',' || own.has(v[1]) || !styleOnly.has(v[1]) || READ_BARE_BEFORE_363.has(v[1])) continue;
        bare.push(`${f}: ${m[1].trim()} reads ${v[1]}`);
      }
    }
  }
  assert.deepEqual(bare, [], 'give each of these its old literal as a fallback: var(--x, <literal>)');
});

test('style.css writes no colour into a rule: only token declarations, fallbacks, shadows and print', () => {
  let css = noComments(fs.readFileSync(path.join(CSS, 'style.css'), 'utf8'));
  css = css.slice(0, css.indexOf('@media print'));   // print is black on white, whatever the theme
  const found = [];
  for (const m of css.matchAll(/([^{};]+)\{([^{}]*)\}/g)) {
    for (const d of m[2].matchAll(/([\w-]+)\s*:\s*([^;]+)/g)) {
      if (d[1].startsWith('--')) continue;
      const bare = d[2].replace(/var\(--[\w-]+\s*,[^()]*(\([^()]*\))?[^()]*\)/g, '');
      const hex = bare.match(/#[0-9a-fA-F]{3,8}\b/);
      if (hex) found.push(`${m[1].trim()} { ${d[1]}: ${d[2].trim()} }`);
    }
  }
  assert.deepEqual(found, []);
});

test('docs/theme-tokens.md lists every token, as the list says', () => {
  const { renderTokens } = require('../scripts/gen-theme-hooks-doc');
  const doc = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'docs', 'theme-tokens.md'), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(renderTokens(doc), doc, 'docs/theme-tokens.md is out of date: run `node tools/publish/scripts/gen-theme-hooks-doc.js --write`');
  for (const t of TOKENS) assert.ok(doc.includes(`\`${t.name}\``), `${t.name} is not on the page`);
});

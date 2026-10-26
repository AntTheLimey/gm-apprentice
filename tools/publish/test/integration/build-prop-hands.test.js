'use strict';
// A prop's `prop_hand` names a hand in the vault's registry; the hand's font is fetched and
// self-hosted like a `prop_font`, for shipping styled props only.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { buildBoth } = require('../helpers/gm-build');

const STYLE = {
  '_meta/prop-styles/t/layout.html': '<h1>{{title}}</h1><p style="--hand: \'{{prop_font|font}}\'">x</p>{{{body}}}',
  '_meta/prop-styles/t/style.css': '.x { color: red; }\n',
};
const REGISTRY = { '_meta/prop-hands.json': JSON.stringify({ hands: { fairhand: { font: 'Tangerine', who: 'MYSTERIOUS CLERK DYNASTY' } } }) };
const seedFont = (slug, file = '0123456789abcdef.woff2') => ({
  [`_meta/font-cache/${slug}/faces.json`]: JSON.stringify([{ style: 'normal', weight: '400', unicodeRange: null, file }]),
  [`_meta/font-cache/${slug}/${file}`]: 'wOF2fake',
});
const letter = (fm) => ({ ...STYLE, 'Documents/Letter.md': `---\ntype: prop\nprop_style: t\n${fm}---\nA letter.\n\n## The Text\n\nThe rent is due.\n` });
const rels = (site) => site.files().map((f) => path.relative(site.dir, f).split(path.sep).join('/'));

describe('hands in the build', () => {
  it('a styled prop in a registered hand uses its font', () => {
    const s = buildBoth({ ...letter('prop_hand: fairhand\n'), ...REGISTRY, ...seedFont('tangerine') }, { sites: ['player'] });
    try {
      assert.match(s.player.read('props', 'letter.html'), /--hand: 'Tangerine'/);
      assert.ok(s.player.exists('fonts', 'tangerine', '0123456789abcdef.woff2'));
      assert.match(s.player.read('props', 'styles', 'fonts.css'), /font-family: 'Tangerine'/);
      assert.ok(!s.logs.some((l) => /prop_hand|prop-hands/.test(l)), s.logs.join('\n'));
    } finally { s.cleanup(); }
  });

  it("an unknown hand warns and the page uses the style's hand", () => {
    const s = buildBoth({ ...letter('prop_hand: scrawl\n'), ...REGISTRY, ...seedFont('tangerine') }, { sites: ['player'] });
    try {
      assert.match(s.player.read('props', 'letter.html'), /--hand: ''/);
      assert.ok(!s.player.exists('fonts', 'tangerine', '0123456789abcdef.woff2'));
      const warns = s.logs.filter((l) => /prop_hand/.test(l));
      assert.deepEqual(warns, ['  WARNING: Documents/Letter.md: prop_hand "scrawl" is not in _meta/prop-hands.json, so the style\'s own hand is used — add the hand to _meta/prop-hands.json (vault_write.py prop-new --hand scrawl --hand-font "<family>"), or correct prop_hand']);
    } finally { s.cleanup(); }
  });

  it('a bad registry warns once', () => {
    const s = buildBoth({ ...letter('prop_hand: fairhand\n'), '_meta/prop-hands.json': '{nope' }, { sites: ['player'] });
    try {
      assert.equal(s.logs.filter((l) => /not a hand registry \(not JSON\)/.test(l)).length, 1, s.logs.join('\n'));
    } finally { s.cleanup(); }
  });

  it("a held prop's hand fetches nothing", () => {
    const s = buildBoth({ ...letter('prop_hand: fairhand\npublish: stub\n'), ...REGISTRY, ...seedFont('tangerine') }, { sites: ['player'] });
    try {
      assert.ok(!rels(s.player).some((r) => r.startsWith('fonts/tangerine')), rels(s.player).join('\n'));
      assert.ok(!s.player.exists('props', 'letter.html'));
    } finally { s.cleanup(); }
  });

  it("the registry's who never reaches a page", () => {
    const s = buildBoth({ ...letter('prop_hand: fairhand\n'), ...REGISTRY, ...seedFont('tangerine') }, { sites: ['player', 'gm'] });
    try {
      for (const site of [s.player, s.gm]) {
        for (const f of site.files()) {
          if (/\.(woff2|png|jpe?g)$/.test(f)) continue;
          assert.ok(!require('node:fs').readFileSync(f, 'utf8').includes('MYSTERIOUS CLERK'), f);
        }
      }
    } finally { s.cleanup(); }
  });
});

describe('the font prefetch', () => {
  it('one scan feeds skins and styles', async () => {
    const scanner = require('../../lib/scanner');
    const { prefetchForConfig } = require('../../lib/fonts');
    const s = buildBoth({ ...letter('prop_hand: fairhand\n'), ...REGISTRY, ...seedFont('tangerine'), 'PCs/Ada.md': '---\ntype: pc\n---\nA clerk.\n' }, { sites: [] });
    const real = scanner.scanVaultReport;
    let calls = 0;
    scanner.scanVaultReport = (...a) => { calls += 1; return real(...a); };
    try {
      await prefetchForConfig(s.configPath, { fetch: async () => { throw new Error('no network'); }, log: () => {}, warn: () => {} });
      assert.equal(calls, 1);
    } finally {
      scanner.scanVaultReport = real;
      s.cleanup();
    }
  });
});

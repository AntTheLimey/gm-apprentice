// tools/publish/test/unit/skins-css.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { SKINS, skinsCss } = require('../../lib/skins');
const { scopeColorScheme } = require('../../lib/color-mode');
const dir = path.join(__dirname, '../../css/skins');
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8').replace(/\r\n/g, '\n');
const SET = ['--bg', '--bg-card', '--sk-well', '--text', '--text-muted', '--accent', '--accent-dim', '--border', '--danger', '--warning', '--success',
  '--font-heading', '--font-body', '--font-mono', '--sk-c1', '--sk-c2', '--sk-c3', '--sk-c4', '--sk-c5', '--sk-c6', '--sk-c7', '--sk-c8'];
const COLOURS = ['--bg', '--bg-card', '--sk-well', '--text', '--text-muted', '--accent', '--accent-dim', '--border', '--danger', '--warning', '--success'];

describe('skins: css', () => {
  it('the layer holds no colour literal and names no skin', () => {
    const layer = read('_layer.css').replace(/\/\*[\s\S]*?\*\//g, '').replace(/url\("data:[^"]*"\)/g, '');
    assert.doesNotMatch(layer, /#[0-9a-fA-F]{3,8}\b|rgba?\(/);
    assert.doesNotMatch(layer, /data-skin="/);
  });
  it('the layer names every Pathfinder and FitD sheet class it dresses', () => {
    const layer = read('_layer.css');
    for (const c of ['pf2e-sheet', 'fitd-sheet', 'dnd-ability-card', 'stat-item', 'dnd-proficiency', 'skill-rank', 'skill-mark', 'dnd-header',
      'fitd-tracker', 'fitd-attribute', 'fitd-dot', 'fitd-box', 'filled', 'is-proficient']) {
      assert.match(layer, new RegExp('[.]' + c + '\\b'), c);
    }
  });
  it('the layer ends with one light block and scopes every Pathfinder and FitD rule under its sheet', () => {
    const layer = read('_layer.css').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.strictEqual((layer.match(/@media \(prefers-color-scheme: light\)/g) || []).length, 1);
    assert.match(layer, /@media \(prefers-color-scheme: light\) \{[\s\S]*\}\s*$/);
    for (const line of layer.split('\n').filter((l) => /[.]fitd-|[.]skill-|[.]dnd-ability|[.]dnd-header|[.]pf2e-sheet/.test(l))) {
      assert.match(line, /main\.content\[data-skin\]:not\(\[data-skin=plain\]\)/, line.slice(0, 80));
    }
  });
  for (const id of Object.keys(SKINS).filter((s) => s !== 'plain')) {
    it(`${id} sets every setting, dark first, and every colour again for light`, () => {
      const css = read(id + '.css');
      const base = css.slice(0, css.indexOf('@media'));
      for (const name of SET) assert.match(base, new RegExp(name.replace(/-/g, '\\-') + '\\s*:'), `${id} base ${name}`);
      const light = css.match(/@media \(prefers-color-scheme: light\) \{([\s\S]*)\}\s*$/);
      assert.ok(light, `${id} has one trailing light block`);
      for (const name of COLOURS) assert.match(light[1], new RegExp(name.replace(/-/g, '\\-') + '\\s*:'), `${id} light ${name}`);
      assert.doesNotMatch(css, /data-mode|#stage/);
      // every selector is scoped to this skin
      for (const sel of css.replace(/\/\*[\s\S]*?\*\//g, '').match(/(^|\})\s*([^@{}\s][^{}]*)\{/g) || []) {
        if (/^\}?\s*$/.test(sel)) continue;
        assert.match(sel, new RegExp(`main\\.content\\[data-skin="${id}"\\]`), sel);
      }
    });
  }
  it('assembles in registry order and survives the reader light/dark transform', () => {
    const css = skinsCss(['ledger', 'parchment', 'plain']);
    assert.ok(css.indexOf('data-skin="parchment"') < css.indexOf('data-skin="ledger"'));
    const scoped = scopeColorScheme(css);
    assert.match(scoped, /\[data-theme="light"\]/);
    assert.doesNotMatch(scoped, /@media \(prefers-color-scheme: light\) \{/);
  });
});

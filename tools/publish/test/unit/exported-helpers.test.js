const { describe, it } = require('node:test');
const assert = require('node:assert');

// #425: the helpers that decide what a build publishes, or how it looks, are exported, so a
// tool that predicts a build calls them instead of keeping a hand copy that drifts.
describe('helpers a downstream predictor calls (#425)', () => {
  it('uncycle cuts a frontmatter cycle to null', () => {
    const { uncycle } = require('../../lib/frontmatter');
    const note = { name: 'a', child: {} };
    note.child.back = note;
    uncycle(note, []);
    assert.strictEqual(note.child.back, null);
    assert.strictEqual(note.name, 'a');
  });

  it('overrideEntryProblem and canonicalizeOverrideFieldKeys are exported and agree with the loader', () => {
    const { overrideEntryProblem, canonicalizeOverrideFieldKeys } = require('../../lib/config');
    assert.match(overrideEntryProblem('secrets'), /must be a map/);
    assert.strictEqual(overrideEntryProblem({ include: ['secrets'] }), null);
    const out = canonicalizeOverrideFieldKeys({ 'People/Vex.md': { include: ['secrets'] }, 'People/Bad.md': 'oops' }, '/vault');
    assert.deepStrictEqual(Object.keys(out.fields), ['People/Vex.md']);
    assert.strictEqual(out.problems.length, 1);
  });

  it('the exclude-list merge is a resolved setting, with its folder normaliser exported beside it', () => {
    const { normalizeExcludeDir } = require('../../lib/settings/folders');
    assert.strictEqual(normalizeExcludeDir('Characters/NPCs/', '/vault'), normalizeExcludeDir('Characters/NPCs', '/vault'));
    const { scanConfigFor } = require('../../lib/config');
    assert.deepStrictEqual(scanConfigFor({ excludeDirs: ['x'] }, { exclude_dirs: ['y'] }).excludeDirs, ['y']);
  });

  it('paletteScheme says light or dark as generateThemeCSS does', () => {
    const { paletteScheme, generateThemeCSS } = require('../../lib/theme');
    for (const palette of [{ background: '#fafafa' }, { background: '#101010' }, {}, { background: '#fff' }]) {
      const css = generateThemeCSS({ palette });
      assert.match(css, new RegExp(`color-scheme: ${paletteScheme(palette)};`));
    }
    assert.strictEqual(paletteScheme({ background: '#fafafa' }), 'light');
    assert.strictEqual(paletteScheme({}), 'dark');
  });

  it('publishMode is the one reading of a note\'s publish field', () => {
    const { publishMode } = require('../../lib/processor');
    assert.strictEqual(publishMode({ publish: 'False' }), 'none');
  });
});

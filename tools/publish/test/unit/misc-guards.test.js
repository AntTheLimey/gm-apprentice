'use strict';
// Small checks that each need a few lines: the licence file, fonts, the to-hit CSS, the orphan badge, assertNoStops, the CoC skills template and the bundled packages.
// Each block below was a test file of its own; the blocks keep their own imports and helpers.

// ---- license.test.js -------------------------------------------------------------------------------------
{
// The packed tool carries the MIT text (#418): tools/publish/LICENSE is a copy of the repo's
// LICENSE-CODE, kept byte for byte so the two cannot drift.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('the tool LICENSE is the repo LICENSE-CODE, byte for byte', () => {
  const tool = fs.readFileSync(path.join(__dirname, '../../LICENSE'));
  const root = fs.readFileSync(path.join(__dirname, '../../../../LICENSE-CODE'));
  assert.ok(tool.equals(root), 'copy LICENSE-CODE to tools/publish/LICENSE');
});
}

// ---- skins-fonts.test.js ---------------------------------------------------------------------------------
{
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { fontFamiliesFor } = require('../../lib/skins');
const fontsLib = require('../../lib/fonts');

describe('skins: fonts', () => {
  it('lists the families of the skins in use, once each', () => {
    assert.deepStrictEqual(fontFamiliesFor(['ledger', 'plain', 'ledger']), ['Spectral', 'Spectral SC']);
    assert.deepStrictEqual(fontFamiliesFor(['plain']), []);
  });
  it('names only families the font cache accepts', () => {
    for (const f of fontFamiliesFor(['parchment', 'case-file', 'console', 'ledger'])) assert.ok(fontsLib.isValidFamily(f), f);
  });
});
}

// ---- tohit-css.test.js -----------------------------------------------------------------------------------
{
// The to-hit calculator's colour discipline, read from the stylesheet. Its phone layout is
// measured in a browser: test/tohit-phone-browser.test.js.
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', '..', 'css', 'style.css'), 'utf8');
const block = css.slice(css.indexOf('/* === To-hit calculator'), css.indexOf('/* === Combat action chains'));

describe('the to-hit calculator stylesheet', () => {
  it('holds no colour literal and no new font', () => {
    assert.doesNotMatch(block, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|font-family/);
  });
  it('keeps colour off the subtotals and puts the page text on what a player reads', () => {
    assert.doesNotMatch(block, /th-pos|th-neg/);
    assert.match(block, /\.th-gsum { font-weight: 600; color: var\(--text\)/);
    assert.match(block, /\.th-lbl { font-size: 11\.5px; color: var\(--text\)/);
    assert.match(block, /input::placeholder { color: var\(--text-muted\)/);
  });
});
}

// ---- no-orphan-badge.test.js -----------------------------------------------------------------------------
{
// `sidebar-badge` styled the removed Connections sidebar (#334); no rule is left for it, so
// no template may print it (#345).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out); else out.push(full);
  }
  return out;
}

test('no template prints a sidebar-badge span and no stylesheet is missing its rule', () => {
  const root = path.join(__dirname, '..', '..');
  const css = walk(path.join(root, 'css')).filter((f) => f.endsWith('.css')).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  assert.ok(!css.includes('sidebar-badge'));
  for (const file of walk(path.join(root, 'lib')).filter((f) => f.endsWith('.js'))) {
    assert.ok(!fs.readFileSync(file, 'utf8').includes('sidebar-badge'), `${path.relative(root, file)} still prints sidebar-badge`);
  }
});
}

// ---- assert-no-stops.test.js -----------------------------------------------------------------------------
{
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { assertNoStops } = require('../../lib/config');
const { makeFault, formatFault } = require('../../lib/settings');
const { entry } = require('../../lib/settings');

const stop = makeFault({ name: 'publish.mode', kind: 'not-allowed', level: 'stop', value: 'players', entry: entry('player_site.hide.mode') });
const warn = makeFault({ name: 'publish.zebra', kind: 'unknown-name', level: 'warn', value: 1, suggest: null });

describe('assertNoStops', () => {
  it('throws for a stop, with what stopped, the fault lines, the warnings beside it and what to do', () => {
    assert.throws(() => assertNoStops({ faults: [warn, stop] }, 'build'), (err) => {
      assert.strictEqual(err.message,
        'build stopped: the settings have a fault that could show players more than you meant.\n'
        + `  ${formatFault(stop)}\n`
        + `Also:\n  ${formatFault(warn)}\n`
        + 'Fix it, or ask the apprentice to run the Settings check.');
      return true;
    });
  });
  it('names every stop, one line each', () => {
    const second = makeFault({ name: 'publish.exclude_drafts', kind: 'not-allowed', level: 'stop', value: 'maybe', entry: entry('player_site.hide.drafts') });
    assert.throws(() => assertNoStops({ faults: [stop, second] }, 'deploy'), (err) => err.message.split('\n').length === 4);
  });
  it('returns quietly for warnings only and for no faults', () => {
    assert.strictEqual(assertNoStops({ faults: [warn] }, 'build'), undefined);
    assert.strictEqual(assertNoStops({ faults: [] }, 'build'), undefined);
    assert.strictEqual(assertNoStops({}, 'build'), undefined);
  });
});
}

// ---- coc-skills-template.test.js -------------------------------------------------------------------------
{
// The PC templates and the sheet's skill lists name the same skills at the same bases (#366): the sheet's list in
// skills-data.js is the one source, and this test keeps the shipped templates to it.
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { REGENCY_SKILLS, BASE_SKILLS } = require('../../lib/templates/coc/skills-data');
const { baseText } = require('../../lib/templates/coc/skills');

const templatesDir = path.join(__dirname, '../../../../skills/shared/templates');

function templateRows(file) {
  const text = fs.readFileSync(path.join(templatesDir, file), 'utf8');
  const section = text.split(/^## Skills\s*$/m)[1].split(/^## /m)[0];
  const rows = [];
  for (const m of section.matchAll(/^\|([^|]*)\|([^|]*)\|/gm)) {
    const name = m[1].trim().replace(/\s*\(\s*\)$/, '');
    if (!name || /^skill$/i.test(name) || /^-+$/.test(name)) continue;
    rows.push([name, m[2].trim()]);
  }
  return rows;
}

for (const [file, list] of [['pc-coc-7e-regency.md', REGENCY_SKILLS], ['pc-coc-7e.md', BASE_SKILLS]]) {
  describe(`${file} and the sheet's skill list`, () => {
    it('list the same skills, in the same order, at the same bases', () => {
      const expected = list.map((s) => [s.name, baseText(s)]);
      const got = templateRows(file).map(([name, base]) => [name, /^\d+$/.test(base) ? String(Number(base)) : base]);
      assert.deepEqual(got, expected);
    });
  });
}
}

// ---- bundled-deps.test.js --------------------------------------------------------------------------------
{
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// #359: the bundled packages are at or past the first version that fixes their advisories
// (slow-parsing denial of service), and each one is still bundled.
const ROOT = path.join(__dirname, '..', '..');
const FIXED_IN = { 'js-yaml': '3.15.2', 'markdown-it': '14.3.1', 'linkify-it': '5.0.2' };

const parts = (v) => v.split('.').map(Number);
const atLeast = (have, want) => {
  const [a, b] = [parts(have), parts(want)];
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
};

describe('bundled dependencies carry the security fixes (#359)', () => {
  for (const [name, fixed] of Object.entries(FIXED_IN)) {
    it(`${name} is ${fixed} or later in node_modules and in the lockfile`, () => {
      const installed = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', name, 'package.json'), 'utf8')).version;
      assert.ok(atLeast(installed, fixed), `${name} ${installed} is older than ${fixed}`);
      const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8')).packages[`node_modules/${name}`];
      assert.strictEqual(lock.version, installed);
      assert.strictEqual(lock.inBundle, true, `${name} must stay bundled`);
    });
  }

  it('the tool still bundles them', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    for (const name of ['js-yaml', 'markdown-it']) assert.ok(pkg.bundleDependencies.includes(name), name);
  });
});
}

// tools/publish/test/integration/build-pf2e-fitd.test.js
require('../helpers/quiet-legacy-warning.js');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { buildPc } = require('../helpers/pc-vault');
const { druidBody, cutterBody } = require('../helpers/pc-template');

// #272: a PF2e or FitD PC written to its template's body structure got no sheet.
// The vault is made from the real template (helpers/pc-vault.js), not kept as a fixture.

const accordionTitles = html => [...html.matchAll(/<button class="accordion-header"[^>]*>([^<]*)</g)].map(m => m[1]);

describe('build integration — PF2e PC', () => {
  let out;
  before(() => { out = buildPc('pf2e', druidBody()); });
  after(() => fs.rmSync(out.root, { recursive: true, force: true }));

  it('renders the structured sheet', () => {
    assert.ok(out.html.includes('pf2e-sheet'));
    assert.match(out.html, /<span>Level 2<\/span><span>Druid \(Leaf\)<\/span>/);
    assert.match(out.html, /<span class="stat-label">HP<\/span><span class="stat-value">20 \/ 26</);
    assert.match(out.html, /<span class="stat-label">Rank 1<\/span><span class="stat-value">2 \/ 3</);
  });
  it('does not repeat consumed sections as accordions', () => {
    const titles = accordionTitles(out.html);
    for (const t of ['Stat Sheet', 'Skills', 'Spellcasting', 'Proficiencies']) assert.ok(!titles.includes(t), t);
    assert.ok(titles.includes('Class Feats'));
  });
  it('withholds GM Notes', () => assert.ok(!out.html.includes('GM-SECRET')));
});

describe('build integration — FitD PC', () => {
  let out;
  before(() => { out = buildPc('fitd', cutterBody()); });
  after(() => fs.rmSync(out.root, { recursive: true, force: true }));

  it('renders the structured sheet', () => {
    assert.ok(out.html.includes('class="fitd-sheet"'));
    assert.ok(out.html.includes('<dt>Playbook</dt><dd>Cutter</dd>'));
    assert.strictEqual((out.html.match(/class="fitd-action-row"/g) || []).length, 12);
    assert.ok(out.html.includes('4 / 9'));
  });
  it('does not repeat consumed sections as accordions', () => {
    const titles = accordionTitles(out.html);
    for (const t of ['Stat Sheet', 'Special Abilities', 'Stash &amp; Coin']) assert.ok(!titles.includes(t), t);
    assert.ok(titles.includes('Long-Term Projects'));
  });
  it('withholds GM Notes', () => assert.ok(!out.html.includes('GM-SECRET')));
});

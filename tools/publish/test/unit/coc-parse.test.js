// tools/publish/test/unit/coc-parse.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { parseCoC } = require('../../lib/templates/coc/parse');

const statSheet = {
  title: 'Stat Sheet',
  id: 'stat-sheet',
  html: `
  <h3>Characteristics</h3>
  <table><tr><th>Characteristic</th><th>Regular</th><th>Half</th><th>Fifth</th></tr>
  <tr><td>STR</td><td>50</td><td>25</td><td>10</td></tr>
  <tr><td>DEX</td><td>70</td><td>35</td><td>14</td></tr></table>
  <h3>Derived</h3>
  <table><tr><th>Attribute</th><th>Max</th><th>Current</th></tr>
  <tr><td>HP</td><td>10</td><td>10</td></tr>
  <tr><td>MP</td><td>12</td><td>12</td></tr>
  <tr><td>Luck</td><td>—</td><td>80 (starting 55)</td></tr>
  <tr><td>Sanity</td><td>92</td><td>35 (starting 60)</td></tr></table>
  <h3>Reputation</h3>
  <table><tr><th>Attribute</th><th>Value</th></tr>
  <tr><td>Starting Reputation</td><td>45</td></tr>
  <tr><td>Current Reputation</td><td>71</td></tr>
  <tr><td>Censure</td><td>—</td></tr></table>
  <h3>Combat</h3>
  <table><tr><th>Attribute</th><th>Value</th></tr>
  <tr><td>Move</td><td>8</td></tr><tr><td>Build</td><td>0</td></tr>
  <tr><td>Damage Bonus</td><td>0</td></tr>
  <tr><td>Dodge (Regular)</td><td>48</td></tr>
  <tr><td>Dodge (Half)</td><td>24</td></tr>
  <tr><td>Dodge (Fifth)</td><td>9</td></tr></table>
  <h3>Status</h3>
  <ul><li>[ ] Temporary Insanity</li><li>[x] <strong>Indefinite Insanity</strong></li>
  <li>[ ] Major Wound</li><li>[ ] Unconscious</li><li>[ ] Dying</li></ul>`,
};
const skillsSection = {
  title: 'Skills', id: 'skills',
  html: `<table><tr><th>Skill</th><th>Base</th><th>Regular</th><th>Half</th><th>Fifth</th></tr>
  <tr><td>Charm</td><td>15</td><td>72</td><td>36</td><td>14</td></tr></table>`,
};
const weaponsSection = {
  title: 'Combat', id: 'combat',
  html: `<table><tr><th>Weapon</th><th>Skill %</th><th>Damage</th><th>Attacks</th><th>Range</th><th>Ammo</th><th>Malf</th></tr>
  <tr><td>Brawl</td><td>28</td><td>1D3+DB</td><td>1</td><td>—</td><td>—</td><td>—</td></tr></table>`,
};
const fm = { occupation: 'Gentlewoman', nationality: 'British', player_name: 'Missy',
  age: '17', gender: 'Female', first_appearance: 'The Long Corridor', asOfSession: 'Chapter 4, Session 4' };

describe('parseCoC', () => {
  const model = parseCoC(fm, [statSheet, skillsSection, weaponsSection], 'regency-cthulhu');

  it('parses characteristics with half/fifth', () => {
    assert.deepEqual(model.chars.DEX, { reg: 70, half: 35, fifth: 14 });
  });
  it('parses derived current vs max and the starting note', () => {
    assert.deepEqual(model.derived.sanity, { cur: 35, max: 92, start: 60 });
    assert.equal(model.derived.luck.cur, 80);
    assert.equal(model.derived.luck.start, 55);
  });
  it('parses the Regency reputation block', () => {
    assert.equal(model.reputation.current, 71);
    assert.equal(model.reputation.start, 45);
  });
  it('parses combat stats incl dodge reg/half/fifth', () => {
    assert.equal(model.combat.move, '8');
    assert.deepEqual(model.combat.dodge, { reg: 48, half: 24, fifth: 9 });
  });
  it('parses the status checklist into condition booleans', () => {
    assert.equal(model.conditions.indefiniteInsanity, true);
    assert.equal(model.conditions.majorWound, false);
  });
  it('merges skills with the canonical list and marks developed', () => {
    const charm = model.skills.find(s => s.name === 'Charm');
    assert.equal(charm.reg, 72);
    assert.equal(charm.developed, true);
    assert.ok(model.skills.length > 50, 'full canonical list present');
  });
  it('parses the weapons table', () => {
    assert.equal(model.weapons[0].weapon, 'Brawl');
    assert.equal(model.weapons[0].damage, '1D3+DB');
  });
  it('detects the regency variant', () => {
    assert.equal(model.variant, 'regency');
  });
});

describe('parseCoC backstory', () => {
  const background = {
    title: 'Background', id: 'background',
    html: `<p><strong>Personal Description:</strong> Plainly dressed and easy to overlook.</p>
      <p><strong>Ideology &amp; Beliefs:</strong> Reads the arrangement she was not meant to read.</p>`,
  };
  const model = parseCoC({}, [background], 'regency-cthulhu');

  it('extracts labelled Background fields into the backstory strip', () => {
    const desc = model.backstory.find(b => b.label === 'Personal Description');
    assert.ok(desc, 'Personal Description present');
    assert.equal(desc.value, 'Plainly dressed and easy to overlook.');
  });
  it('decodes HTML entities in labels so they are not double-encoded', () => {
    const ideology = model.backstory.find(b => b.label === 'Ideology & Beliefs');
    assert.ok(ideology, 'label decoded to a plain ampersand');
  });
  it('returns an empty strip when Background has no labelled fields', () => {
    const plain = parseCoC({}, [{ title: 'Background', id: 'background', html: '<p>Just prose.</p>' }], 'regency-cthulhu');
    assert.deepEqual(plain.backstory, []);
  });
});

const { renderCoCSheet } = require('../../lib/templates/coc/index');

describe('renderCoCSheet — legacy body-structure warning (#107)', () => {
  it('warns when a sheet parses no characteristics (divergent legacy body)', () => {
    const out = renderCoCSheet({ occupation: 'Antiquarian' }, [], 'coc-7e');
    assert.ok(out.warnings.some(w => /no characteristics/i.test(w)),
      `expected a no-characteristics warning, got: ${JSON.stringify(out.warnings)}`);
  });

  it('does not warn when the documented Stat Sheet structure parses', () => {
    const out = renderCoCSheet(fm, [statSheet, skillsSection, weaponsSection], 'regency-cthulhu');
    assert.deepStrictEqual(out.warnings, []);
  });
});

/**
 * The GURPS PC template holds the weapon tables the to-hit calculator reads: a
 * PC body built from the template, filled the way a GM fills it, parses into
 * the aids and bonuses the guidance promises. Names are invented.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { extractSections } = require('../../../lib/processor');
const { parseGurps } = require('../../../lib/templates/gurps/parse');
const { buildTohitData } = require('../../../lib/templates/gurps/tohit-data');
const { templateBody, replace } = require('../../helpers/pc-template');

const MELEE_HEAD = '| Weapon | Skill | Damage | Reach | Parry | Notes |';
const RANGED_HEAD = '| Weapon | Skill | Damage | Acc | Range | RoF | Shots | ST | Bulk | Rcl | Notes |';

function filled() {
  let b = templateBody('pc-gurps-4e.md');
  b = replace(b, '| Name | Difficulty | Relative Level | Points | Base | Current |\n|------|-----------|----------------|--------|------|---------|\n| | | | | | |',
    '| Name | Difficulty | Relative Level | Points | Base | Current |\n|------|-----------|----------------|--------|------|---------|\n| Beam Weapons (Pistol) | E | DX+2 | 4 | 14 | 14 |\n| Broadsword | A | DX+1 | 4 | 13 | 13 |');
  b = replace(b, `${MELEE_HEAD}\n|--------|-------|--------|-------|-------|-------|\n| | | | | | |`,
    `${MELEE_HEAD}\n|--------|-------|--------|-------|-------|-------|\n| Test blade | Broadsword-14 | sw+1 cut | 1 | 10 | Weapon Bond +1 |`);
  b = replace(b, `${RANGED_HEAD}\n|--------|-------|--------|-----|-------|-----|-------|----|------|-----|-------|\n| | | | | | | | | | | |`,
    `${RANGED_HEAD}\n|--------|-------|--------|-----|-------|-----|-------|----|------|-----|-------|\n| Test blaster | Beam Weapons (Pistol)-14 | 3d burn | 3 | 150/450 | 3 | 20 | 8 | -2 | 1 | Scope +2 Acc; HUD link +1 Acc; Laser sight +1 |`);
  return b;
}

describe('the GURPS PC template and the to-hit reader', () => {
  const model = parseGurps({}, extractSections(filled()));
  const data = buildTohitData(model, { pcSlug: 'test' });
  it('keeps the wider weapon table headers', () => {
    const body = templateBody('pc-gurps-4e.md');
    assert.ok(body.includes(MELEE_HEAD));
    assert.ok(body.includes(RANGED_HEAD));
  });
  it('reads a melee row\'s Notes as a bonus', () => {
    const w = data.weapons.find(x => x.type === 'melee');
    assert.deepStrictEqual(w.bonuses, [{ name: 'Weapon Bond', bonus: 1 }]);
    assert.strictEqual(w.level, 14);
  });
  it('reads a ranged row\'s Notes as three aids, the first two aiming bonuses', () => {
    const w = data.weapons.find(x => x.type === 'ranged');
    assert.deepStrictEqual(w.aids.map(a => [a.name, a.bonus, a.acc]),
      [['Scope', 2, true], ['HUD link', 1, true], ['Laser sight', 1, false]]);
    assert.strictEqual(w.rcl, 1);
    assert.strictEqual(w.acc, 3);
  });
});

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { pcIdentity } = require('../../lib/templates/pc-identity');
const { templateBody, setRow, replace, sectionsOf, druidBody, cutterBody } = require('../helpers/pc-template');

describe('pcIdentity', () => {
  it('D&D: Level from the Core row, then Class, Species, Background', () => {
    let b = templateBody('pc-dnd-5e-2024.md');
    b = setRow(b, 'Level', ['3']);
    b = replace(b, '**Species:** {Species name}', '**Species:** Dwarf');
    b = replace(b, '**Class/Subclass:** {Class (Subclass)}', '**Class/Subclass:** Fighter (Champion)');
    b = replace(b, '**Background:** {Background name}', '**Background:** Soldier');
    for (const system of ['dnd', 'dnd-5e', 'dnd-5e-2024']) {
      assert.deepStrictEqual(pcIdentity(system, {}, sectionsOf(b)),
        [['Level', '3'], ['Class', 'Fighter (Champion)'], ['Species', 'Dwarf'], ['Background', 'Soldier']]);
    }
  });

  it('D&D: Race is read as the species', () => {
    let b = templateBody('pc-dnd-5e-2024.md');
    b = replace(b, '**Species:** {Species name}', '**Race:** Halfling');
    assert.ok(pcIdentity('dnd-5e', {}, sectionsOf(b)).some(([l, v]) => l === 'Species' && v === 'Halfling'));
  });

  it('PF2e: Level, Class, Ancestry, Heritage, Background', () => {
    for (const system of ['pf2e', 'pathfinder-2e', 'pathfinder']) {
      assert.deepStrictEqual(pcIdentity(system, {}, sectionsOf(druidBody())),
        [['Level', '2'], ['Class', 'Druid (Leaf)'], ['Ancestry', 'Elf'], ['Heritage', 'Woodland Elf'], ['Background', 'Herbalist']]);
    }
  });

  it('FitD: Playbook from the Stat Sheet, Heritage and Vice from Background', () => {
    for (const system of ['fitd', 'blades']) {
      assert.deepStrictEqual(pcIdentity(system, {}, sectionsOf(cutterBody())),
        [['Playbook', 'Cutter'], ['Heritage', 'Marrow Coast'], ['Vice', 'Obligation — the old crew']]);
    }
  });

  it('GURPS: point_total from frontmatter wins, else the Total row of Points Summary', () => {
    const b = setRow(templateBody('pc-gurps-4e.md'), '**Total**', ['**150**']);
    for (const system of ['gurps', 'gurps-4e']) {
      assert.deepStrictEqual(pcIdentity(system, {}, sectionsOf(b)), [['Points', '150']]);
      assert.deepStrictEqual(pcIdentity(system, { point_total: 250 }, sectionsOf(b)), [['Points', '250']]);
      assert.deepStrictEqual(pcIdentity(system, { point_total: 250 }, []), [['Points', '250']]);
    }
  });

  it('GURPS: only a positive number or a digits-only string is a points total', () => {
    const b = setRow(templateBody('pc-gurps-4e.md'), '**Total**', ['**150**']);
    const points = (pt) => pcIdentity('gurps-4e', { point_total: pt }, sectionsOf(b));
    assert.deepStrictEqual(points('250'), [['Points', '250']]);
    assert.deepStrictEqual(points(' 250 '), [['Points', '250']]);
    for (const bad of ['lots', '250 pts', '1e3', ['250'], { n: 1 }, 0, '0', NaN, Infinity, -5, null, true]) {
      assert.deepStrictEqual(points(bad), [['Points', '150']], String(JSON.stringify(bad)));
    }
    assert.deepStrictEqual(pcIdentity('gurps-4e', { point_total: 0 }, []), []);
  });

  it('CoC aliases: Occupation and Age from frontmatter only', () => {
    for (const system of ['coc', 'coc-7e', 'regency-cthulhu', 'coc-7e-regency']) {
      assert.deepStrictEqual(pcIdentity(system, { occupation: 'Antiquarian', age: 41 }, sectionsOf(templateBody('pc-coc-7e.md'))),
        [['Occupation', 'Antiquarian'], ['Age', '41']]);
    }
    assert.deepStrictEqual(pcIdentity('coc-7e', { occupation: '' }, []), []);
  });

  it('an unknown or missing system has no identity', () => {
    const b = templateBody('pc-generic.md');
    assert.deepStrictEqual(pcIdentity('', { occupation: 'x' }, sectionsOf(b)), []);
    assert.deepStrictEqual(pcIdentity(undefined, {}, sectionsOf(b)), []);
    assert.deepStrictEqual(pcIdentity('homebrew', {}, sectionsOf(b)), []);
  });

  it('placeholders and empty values are dropped', () => {
    const b = templateBody('pc-pf2e.md');   // Level 1 filled; every Background field is a placeholder
    assert.deepStrictEqual(pcIdentity('pf2e', {}, sectionsOf(b)), [['Level', '1']]);
    assert.deepStrictEqual(pcIdentity('pf2e', {}, []), []);
  });

  it('a Level row in a section that is not there is never read', () => {
    // The caller strips GM sections first; a note with Level only under GM Notes has none.
    const gmOnly = sectionsOf('## GM Notes\n\n| Attribute | Value |\n|---|---|\n| Level | 9 |\n');
    assert.deepStrictEqual(pcIdentity('dnd-5e', {}, sectionsOf('## Background\n\n**Class:** Wizard\n')), [['Class', 'Wizard']]);
    assert.deepStrictEqual(pcIdentity('dnd-5e', {}, gmOnly), []);
  });
});

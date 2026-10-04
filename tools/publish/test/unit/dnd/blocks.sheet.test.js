const { describe, it } = require('node:test');
const assert = require('node:assert');
const { num, marks, usesHtml, entry, block } = require('../../../lib/templates/dnd/render');
const { renderVitals } = require('../../../lib/templates/dnd/blocks/vitals');
const { renderAbilities } = require('../../../lib/templates/dnd/blocks/abilities');
const { renderSkills } = require('../../../lib/templates/dnd/blocks/skills');
const { renderSenses } = require('../../../lib/templates/dnd/blocks/senses');
const { renderProficiencies } = require('../../../lib/templates/dnd/blocks/proficiencies');
const { renderFeatures } = require('../../../lib/templates/dnd/blocks/features');

const empty = () => ({
  header: {}, pb: '', inspiration: '', core: [], abilities: {},
  combat: { ac: '', initiative: '', speed: '', size: '', hpCur: '', hpMax: '', tempHp: '', exhaustion: '', conditions: '', hitDice: [], other: [] },
  senses: [], defences: [], skills: [], features: { class: [], species: [], feats: [] },
  casting: [], slots: [], spells: [], proficienciesHtml: '', attacks: [], gear: [], attunement: [], coins: [],
  asWritten: { statSheet: [], skills: [], classFeatures: [], speciesTraits: [], feats: [], spellcasting: [], proficiencies: [], equipment: [] },
  hasSpellcasting: false, warnings: [],
});

describe('render helpers', () => {
  it('num keeps a reason', () => {
    assert.equal(num('+4'), '<span class="dnd5e-num">+4</span>');
    assert.equal(num('+7 (cloak)'), '<span class="dnd5e-num" title="cloak">+7</span><span class="dnd5e-why">cloak</span>');
    assert.equal(num(''), '<span class="dnd5e-num">—</span>');
  });
  it('num escapes', () => assert.ok(!num('<b>').includes('<b>')));
  it('marks puts spent ones last', () => {
    const html = marks(4, 1, 'Spell slots, 1st');
    assert.equal((html.match(/dnd5e-mark"/g) || []).length, 3);
    assert.equal((html.match(/is-spent/g) || []).length, 1);
    assert.match(html, /aria-label="Spell slots, 1st: 3 of 4 left"/);
  });
  it('marks become a count above ten', () => {
    assert.match(marks(25, 7, 'Lay on Hands'), /<span class="dnd5e-num">18<\/span> \/ 25/);
  });
  it('usesHtml shows nothing without uses, and an over-used row as written', () => {
    assert.equal(usesHtml({ name: 'X', uses: null }), '');
    assert.match(usesHtml({ name: 'X', uses: 2, used: 3 }), /3 used of 2/);
    assert.match(usesHtml({ name: 'X', uses: 2, used: 1, recovers: 'Long Rest' }), /dnd5e-recovers">Long Rest/);
  });
  it('entry names concentration', () => {
    assert.match(entry({ nameHtml: 'Bless', tags: ['C', 'Oath'] }), /is-conc">Concentration<\/span><span class="dnd5e-tag">Oath/);
  });
  it('block is null when empty', () => assert.equal(block('x', 'X', ''), null));
});

describe('renderVitals', () => {
  it('is null with no combat numbers', () => assert.equal(renderVitals(empty()), null));
  it('shows HP, temp HP and the chips', () => {
    const m = empty();
    Object.assign(m.combat, { ac: '19', initiative: '+3 (Alert)', speed: '30 ft', hpCur: '38', hpMax: '44', tempHp: '5', exhaustion: '0' });
    m.pb = '+3'; m.inspiration = 'Yes';
    const html = renderVitals(m);
    assert.match(html, /dnd5e-hp[\s\S]*38[\s\S]*\/ 44[\s\S]*\+ 5 temp/);
    assert.match(html, /title="Alert">\+3</);
    assert.match(html, /is-on">Heroic Inspiration/);
    assert.match(html, />No conditions</);
    assert.match(html, />Exhaustion 0</);
  });
  it('leaves out temp HP of 0, an empty tile and an unset inspiration', () => {
    const m = empty();
    Object.assign(m.combat, { ac: '12', hpCur: '9', hpMax: '9', tempHp: '0', conditions: 'Poisoned' });
    m.inspiration = 'No';
    const html = renderVitals(m);
    assert.ok(!html.includes('temp') && !html.includes('Heroic') && !html.includes('>Init<') && !html.includes('Exhaustion'));
    assert.match(html, />Poisoned</);
  });
});

describe('renderAbilities', () => {
  it('shows modifier, score and save number', () => {
    const m = empty();
    m.abilities = { WIS: { score: '12', mod: '+1', saveProf: true, save: '+4' }, STR: { score: '18', mod: '+4', saveProf: false, save: '+4' } };
    const html = renderAbilities(m);
    assert.ok(html.indexOf('>STR<') < html.indexOf('>WIS<'));
    assert.match(html, /dnd5e-ab is-prof[\s\S]*>WIS<[\s\S]*Save <span class="dnd5e-num">\+4/);
  });
  it('old layout: a proficiency mark and no number', () => {
    const m = empty();
    m.abilities = { WIS: { score: '12', mod: '+1', saveProf: true, save: '' }, STR: { score: '18', mod: '', saveProf: false, save: '' } };
    const html = renderAbilities(m);
    assert.match(html, /Save proficiency/);
    assert.equal((html.match(/dnd5e-ab-save/g) || []).length, 1);
    assert.match(html, /dnd5e-ab-mod"><span class="dnd5e-num">—/);   // no sum for a blank modifier
  });
  it('shows core rows and what was left as written', () => {
    const m = empty();
    m.abilities = { STR: { score: '10', mod: '+0', saveProf: false, save: '+0' } };
    m.core = [['XP', '900']];
    m.asWritten.statSheet = ['<h3>House Rules</h3>\n<p>Luck 3</p>'];
    const html = renderAbilities(m);
    assert.match(html, />XP<[\s\S]*900/);
    assert.match(html, /dnd5e-as-written[\s\S]*Luck 3/);
  });
  it('is null when only loose text was written', () => {
    const m = empty();
    m.asWritten.statSheet = ['<p>See D&D Beyond.</p>'];
    assert.equal(renderAbilities(m), null);
  });
});

describe('renderSkills, renderSenses, renderProficiencies', () => {
  it('marks proficiency and expertise', () => {
    const m = empty();
    m.skills = [{ name: 'Arcana', ability: 'INT', proficient: true, expert: true, modifier: '+7' }, { name: 'Stealth', ability: 'DEX', proficient: false, expert: false, modifier: '+5 (cloak)' }];
    const html = renderSkills(m);
    assert.match(html, /dnd5e-skill is-prof is-expert[\s\S]*Arcana/);
    assert.match(html, /Stealth[\s\S]*dnd5e-why">cloak/);
  });
  it('are null when empty', () => {
    assert.equal(renderSkills(empty()), null);
    assert.equal(renderSenses(empty()), null);
    assert.equal(renderProficiencies(empty()), null);
  });
  it('senses are tiles; proficiencies are the note\'s lines', () => {
    const m = empty();
    m.senses = [['Passive Perception', '14']];
    m.proficienciesHtml = '<p><strong>Languages:</strong> Common</p>';
    assert.match(renderSenses(m), /Passive Perception[\s\S]*14/);
    assert.match(renderProficiencies(m), /dnd5e-lines"><p><strong>Languages:/);
  });
});

describe('renderFeatures', () => {
  it('renders entries with action, uses and summary, then prose', () => {
    const m = empty();
    m.features.class = [{ name: 'Channel Divinity', nameHtml: 'Channel Divinity', action: '', uses: 2, used: 1, recovers: '1 Short Rest, all Long Rest', summaryHtml: 'Powers two options.' }];
    m.asWritten.classFeatures = ['<p>Also: Extra Attack.</p>'];
    const html = renderFeatures(m, 'class', 'Class features');
    assert.match(html, /dnd5e-blk-features-class/);
    assert.match(html, /Channel Divinity[\s\S]*Powers two options\.[\s\S]*is-spent[\s\S]*1 Short Rest, all Long Rest/);
    assert.match(html, /Also: Extra Attack\./);
  });
  it('is null when the section is empty', () => assert.equal(renderFeatures(empty(), 'feats', 'Feats'), null));
});

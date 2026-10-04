const { describe, it } = require('node:test');
const assert = require('node:assert');
const B = name => require(`../../../lib/templates/dnd/blocks/${name}`);
const { renderAttacks } = B('attacks');
const { renderActions } = B('actions');
const { renderDefences } = B('defences');
const { renderTracks } = B('tracks');
const { renderCasting } = B('casting');
const { renderSlots } = B('slots');
const { renderSpells } = B('spells');
const { renderGear } = B('gear');
const { renderAttunement } = B('attunement');
const { renderCoins } = B('coins');

const empty = () => ({
  header: {}, pb: '', inspiration: '', core: [], abilities: {},
  combat: { ac: '', initiative: '', speed: '', size: '', hpCur: '', hpMax: '', tempHp: '', exhaustion: '', conditions: '', hitDice: [], other: [] },
  senses: [], defences: [], skills: [], features: { class: [], species: [], feats: [] },
  casting: [], slots: [], spells: [], proficienciesHtml: '', attacks: [], gear: [], attunement: [], coins: [],
  asWritten: { statSheet: [], skills: [], classFeatures: [], speciesTraits: [], feats: [], spellcasting: [], proficiencies: [], equipment: [] },
  hasSpellcasting: false, warnings: [],
});
const feature = (name, action, extra = {}) => ({ name, nameHtml: name, action, uses: null, used: null, recovers: '', summaryHtml: `${name} text.`, ...extra });
const spell = (name, level, time, extra = {}) => ({ name, nameHtml: name, level, time, range: '30 ft', components: 'V, S', duration: '1 min', hit: '', tags: [], summaryHtml: `${name} text.`, ...extra });

describe('renderAttacks', () => {
  it('shows hit and damage', () => {
    const m = empty();
    m.attacks = [{ name: 'Longsword', nameHtml: 'Longsword', hit: '+7', damage: '1d8+4 Slashing', notesHtml: 'Versatile' }, { name: 'Sacred Flame', nameHtml: 'Sacred Flame', hit: '', damage: '1d8 Radiant', notesHtml: '' }];
    const html = renderAttacks(m);
    assert.match(html, /Longsword[\s\S]*Hit<\/span> <span class="dnd5e-num">\+7<[\s\S]*1d8\+4 Slashing[\s\S]*Versatile/);
    assert.equal((html.match(/>Hit</g) || []).length, 1);
  });
  it('is null with none', () => assert.equal(renderAttacks(empty()), null));
});

describe('renderActions', () => {
  it('groups features and spells by action', () => {
    const m = empty();
    m.features.class = [feature('Lay on Hands', 'Bonus Action', { uses: 25, used: 7, recovers: 'Long Rest' }), feature('Aura', ''), feature('Attack', 'action')];
    m.features.feats = [feature('Sentinel', 'Reaction')];
    m.spells = [spell('Shield of Faith', '1', 'Bonus Action'), spell('Bless', '1', 'Action'), spell('Shield', '1', 'Reaction, when hit')];
    const [a, b, r] = renderActions(m);
    assert.match(a, /dnd5e-blk-actions-action[\s\S]*Attack/);
    assert.ok(!a.includes('Aura') && !a.includes('Bless'));
    assert.match(b, /Lay on Hands[\s\S]*18<\/span> \/ 25[\s\S]*Spells[\s\S]*Shield of Faith/);
    assert.ok(!b.includes('dnd5e-tag">Bonus Action'));
    assert.match(r, /Sentinel[\s\S]*Spells[\s\S]*Shield/);
  });
  it('is an empty list with nothing to do', () => assert.deepEqual(renderActions(empty()), []));
});

describe('renderDefences, renderTracks', () => {
  it('defences are lines', () => {
    const m = empty();
    m.defences = [['Resistances', 'fire']];
    assert.match(renderDefences(m), /<strong>Resistances:<\/strong> fire/);
    assert.equal(renderDefences(empty()), null);
  });
  it('tracks draw hit dice left and death saves made', () => {
    const m = empty();
    m.combat.hitDice = [{ label: 'Hit Dice d10', spent: 1, max: 5 }];
    m.combat.deathSaves = { s: 2, f: 0 };
    const html = renderTracks(m);
    assert.match(html, /Hit Dice d10: 4 of 5 left/);
    const saved = html.split('Saved')[1].split('Failed')[0];
    assert.equal((saved.match(/is-spent/g) || []).length, 1);          // 2 made of 3
    assert.equal((html.split('Failed')[1].match(/is-spent/g) || []).length, 3);
  });
  it('tracks keep what is not n/n as text', () => {
    const m = empty();
    m.combat.hitDice = [{ label: 'Hit Dice', raw: 'two left' }];
    m.combat.other = [['Lucky Coin', 'heads']];
    const html = renderTracks(m);
    assert.match(html, /two left/);
    assert.match(html, /Lucky Coin[\s\S]*heads/);
  });
  it('is null with nothing', () => assert.equal(renderTracks(empty()), null));
});

describe('casting, slots, spells', () => {
  it('casting tiles and slot tracks', () => {
    const m = empty();
    m.casting = [['Spell Save DC', '14']];
    m.slots = [{ level: '1st', total: 4, expended: 1 }, { level: 'Pact (3rd)', total: 2, expended: 2 }];
    assert.match(renderCasting(m), /Spell Save DC[\s\S]*14/);
    const html = renderSlots(m);
    assert.match(html, /Spell slots, 1st: 3 of 4 left/);
    assert.match(html, /Spell slots, Pact \(3rd\): 0 of 2 left/);
  });
  it('spells are grouped by level, cantrips first', () => {
    const m = empty();
    m.spells = [spell('Bless', '1', 'Action', { tags: ['C'] }), spell('Light', '0', 'Action'), spell('Command', '1', 'Action', { hit: 'WIS 14' })];
    m.asWritten.spellcasting = ['<h4>Prepared Spells</h4><p>Guidance</p>'];
    const blocks = renderSpells(m);
    assert.equal(blocks.length, 3);
    assert.match(blocks[0], /dnd5e-blk-spells-0[\s\S]*Cantrips[\s\S]*Light/);
    assert.match(blocks[1], /1st level[\s\S]*Bless[\s\S]*Concentration[\s\S]*Command[\s\S]*WIS 14/);
    assert.match(blocks[2], /Spells, as written[\s\S]*Guidance/);
  });
  it('are empty with nothing', () => {
    assert.equal(renderCasting(empty()), null);
    assert.equal(renderSlots(empty()), null);
    assert.deepEqual(renderSpells(empty()), []);
  });
});

describe('gear, attunement, coins', () => {
  it('gear shows quantity above one, notes and prose', () => {
    const m = empty();
    m.gear = [{ name: 'Javelin', nameHtml: 'Javelin', qty: '4', notesHtml: '' }, { name: 'Shield', nameHtml: '<a href="s.html">Shield</a>', qty: '1', notesHtml: 'Worn' }];
    m.asWritten.equipment = ['<h3>Stash</h3>\n<p>A chest at the inn.</p>'];
    const html = renderGear(m);
    assert.match(html, /Javelin[\s\S]*× 4/);
    assert.ok(!html.includes('× 1'));
    assert.match(html, /<a href="s.html">Shield<\/a>[\s\S]*Worn/);
    assert.match(html, /A chest at the inn\./);
  });
  it('attunement counts used slots', () => {
    const m = empty();
    m.attunement = [['1', 'Amulet of Health'], ['2', ''], ['3', '']];
    const html = renderAttunement(m);
    assert.match(html, /1 of 3 used/);
    assert.match(html, /<strong>2:<\/strong> empty/);
  });
  it('coins are tiles', () => {
    const m = empty();
    m.coins = [['GP', '62'], ['PP', '1']];
    assert.match(renderCoins(m), /dnd5e-coins[\s\S]*GP[\s\S]*62[\s\S]*PP/);
  });
  it('are null when empty', () => {
    assert.equal(renderGear(empty()), null);
    assert.equal(renderAttunement(empty()), null);
    assert.equal(renderCoins(empty()), null);
  });
});

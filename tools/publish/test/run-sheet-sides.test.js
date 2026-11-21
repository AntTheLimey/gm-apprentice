'use strict';
const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildIndex } = require('../lib/run-sheet/notes');
const { startingSide } = require('../lib/run-sheet/sides');
const { foesFor } = require('../lib/run-sheet/foes');
const { readCast } = require('../lib/run-sheet/cast');

const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

const EMMA = 'PCs/Emma.md';
const NATHANIEL = 'PCs/Nathaniel.md';
const GEORGIANA = 'PCs/Georgiana.md';
const ADRIEN = 'PCs/Adrien.md';
const FREDDY = 'PCs/Freddy.md';
const KATHERINE = 'PCs/Katherine.md';
const rel = (target, tone, strength) => `  - type: knows\n    target: "[[${target}]]"\n${tone ? `    tone: ${tone}\n` : ''}${strength === undefined ? '' : `    strength: ${strength}\n`}`;
const npc = (extra) => `---\ntype: npc\n${extra}---\n# x\n`;

// The war council of Canticle's Session 13 (v8 round 3), cut down to what decides a side.
function vault() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-sides-'));
  made.push(dir);
  const put = (p, text) => { fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true }); fs.writeFileSync(path.join(dir, p), text); };
  for (const n of ['Emma', 'Nathaniel', 'Georgiana', 'Adrien', 'Freddy', 'Katherine']) put(`PCs/${n}.md`, '---\ntype: pc\n---\n# x\n');
  put('NPCs/Wyndham.md', npc(`affiliation: "British Army / Independent (loyal to party)"\nrelationships:\n${rel('Emma', 'positive', 5)}${rel('Nathaniel', 'negative', 3)}`));
  put('NPCs/Andrei.md', npc(`affiliation: "Russian military intelligence"\nrelationships:\n${rel('Georgiana', 'respectful', 3)}`));
  put('NPCs/Fischbein.md', npc(`affiliation: "None (committed ally)"\nrelationships:\n${rel('Adrien', 'positive', 6)}${rel('Freddy', 'professional', 7)}`));
  put('NPCs/Ferrante.md', npc('affiliation: "Independent mercenary company"\n'));
  put('NPCs/Nell.md', npc(`affiliation: "None (independent criminal)"\nrelationships:\n${rel('Katherine', 'cautious', 4)}`));
  put('NPCs/Thurner.md', npc('affiliation: "Order of St. Aelfric"\n'));
  put('NPCs/Allied.md', npc('affiliation: "Allied with the Order of St. Aelfric"\n'));
  put('NPCs/Outsider.md', npc(`relationships:\n${rel('Nathaniel', 'hostile', 2)}${rel('Emma', 'friendly')}`));
  put('NPCs/Wary.md', npc(`relationships:\n${rel('Emma', 'friendly', 2)}${rel('Georgiana', 'wary', 3)}`));
  const stats = (line) => `---\ntype: npc\n---\n# x\n\n<!-- gm-only -->\n\n## GM Notes\n\n### Stats\n\n**AC** 12 · **HP** 10 · **Initiative** +1\n\n${line}\n\n<!-- /gm-only -->\n`;
  put('NPCs/Fighter.md', stats(''));
  put('NPCs/Friend.md', stats('Run as an ally'));
  put('NPCs/NoStats.md', npc('affiliation: "loyal to party"\n'));
  return buildIndex(dir);
}
const PARTY = [EMMA, GEORGIANA, ADRIEN, FREDDY, KATHERINE];
const side = (index, name, extra = {}) => {
  const p = `NPCs/${name}.md`;
  return startingSide({ whoText: '', quickRefText: '', statsText: '', fm: index.read(p).fm, partyNotes: PARTY, resolve: (t) => index.resolve(t), ...extra });
};
const pick = (s) => [s.ally, s.allyBy];

describe('a row\'s starting side', () => {
  const index = vault();

  it('the war council: Wyndham and Fischbein by affiliation, Andrei by relationships', () => {
    assert.deepStrictEqual(side(index, 'Wyndham'), { ally: true, allyFrom: 'affiliation: loyal to party', allyBy: 'affiliation' });
    assert.deepStrictEqual(side(index, 'Fischbein'), { ally: true, allyFrom: 'affiliation: committed ally', allyBy: 'affiliation' });
    assert.deepStrictEqual(side(index, 'Andrei'), { ally: true, allyFrom: 'relationships: +3 with this party', allyBy: 'relationships' });
  });

  it('Ferrante, Nell (cautious counts 0) and Thurner are foes', () => {
    for (const n of ['Ferrante', 'Nell', 'Thurner']) assert.deepStrictEqual(side(index, n), { ally: false, allyFrom: null, allyBy: null }, n);
  });

  it('"with the coalition" in the who line is an ally by the Plan', () => {
    assert.deepStrictEqual(side(index, 'Ferrante', { whoText: 'Hired, with the coalition' }),
      { ally: true, allyFrom: 'the Plan: "with the coalition"', allyBy: 'plan' });
    assert.deepStrictEqual(pick(side(index, 'Ferrante', { whoText: 'WITH THE PARTY' })), [true, 'plan']);
    assert.deepStrictEqual(pick(side(index, 'Ferrante', { whoText: 'fights on their side' })), [true, 'plan']);
  });

  it('the Plan\'s words beat a hostile note', () => {
    assert.deepStrictEqual(pick(side(index, 'Outsider', { whoText: 'as an ally' })), [true, 'plan']);
  });

  it('"as an ally" in the stat block is an ally by the stats', () => {
    assert.deepStrictEqual(side(index, 'Ferrante', { statsText: 'Plays as an ally in this fight.' }),
      { ally: true, allyFrom: 'the stat block: "as an ally"', allyBy: 'stats' });
  });

  it('bare "ally" counts in the Quick Reference row, not in the who line', () => {
    assert.deepStrictEqual(pick(side(index, 'Ferrante', { whoText: 'a possible ally of the Order' })), [false, null]);
    assert.deepStrictEqual(pick(side(index, 'Ferrante', { whoText: 'Allies all round' })), [false, null]);
    assert.deepStrictEqual(pick(side(index, 'Ferrante', { quickRefText: 'Trusted ally' })), [true, 'quickRef']);
    assert.deepStrictEqual(pick(side(index, 'Ferrante', { quickRefText: 'With coalition' })), [true, 'plan']);
  });

  it('a bare ally in the Quick Reference is an inferred ally; a hedged one is none', () => {
    assert.deepStrictEqual(side(index, 'Ferrante', { quickRefText: 'Ally' }),
      { ally: true, allyFrom: 'the Plan\'s quick reference: "ally"', allyBy: 'quickRef' });
    assert.deepStrictEqual(pick(side(index, 'Ferrante', { quickRefText: 'With coalition' })), [true, 'plan']);
    for (const t of ['not an ally', 'Former ally, now hostile', 'Potential ally / threat', 'No ally', 'ex-ally', 'an ally?']) {
      assert.deepStrictEqual(pick(side(index, 'Ferrante', { quickRefText: t })), [false, null], t);
    }
    // another cell's hedge does not cancel this cell's ally
    assert.deepStrictEqual(pick(side(index, 'Ferrante', { quickRefText: 'Ally | not seen since' })), [true, 'quickRef']);
  });

  it('only whole words count', () => {
    for (const t of ['really', 'allyship', 'Sally']) {
      assert.deepStrictEqual(pick(side(index, 'Ferrante', { quickRefText: t, whoText: t })), [false, null], t);
    }
  });

  it('"the party" counts as membership or loyalty, not as an enemy of it', () => {
    const aff = (a) => pick(startingSide({ fm: { affiliation: a }, partyNotes: PARTY }));
    assert.deepStrictEqual(aff('Enemy of the party'), [false, null]);
    assert.deepStrictEqual(aff('Hunting the party'), [false, null]);
    assert.deepStrictEqual(aff('Loyal to the party'), [true, 'affiliation']);
    assert.deepStrictEqual(aff('The party'), [true, 'affiliation']);
  });

  it('strength 0 weighs nothing', () => {
    const fm = { relationships: [{ target: '[[Emma]]', tone: 'positive', strength: 0 }] };
    assert.deepStrictEqual(pick(startingSide({ fm, partyNotes: PARTY, resolve: (t) => index.resolve(t) })), [false, null]);
  });

  it('"Allied with the Order" is not an ally', () => {
    assert.deepStrictEqual(pick(side(index, 'Allied')), [false, null]);
  });

  it('a negative relationship to a PC outside the party does not count', () => {
    // Emma +1 (friendly, no strength), Nathaniel (not in the party) -2
    assert.deepStrictEqual(side(index, 'Outsider'), { ally: true, allyFrom: 'relationships: +1 with this party', allyBy: 'relationships' });
    assert.deepStrictEqual(pick(side(index, 'Outsider', { partyNotes: [GEORGIANA] })), [false, null]);
  });

  it('a negative tone takes from the total; wary is the ontology\'s cautious, so 0', () => {
    // Emma +2, Georgiana wary (cautious: 0)
    assert.deepStrictEqual(side(index, 'Wary').allyFrom, 'relationships: +2 with this party');
    assert.deepStrictEqual(pick(side(index, 'Outsider', { partyNotes: [EMMA, NATHANIEL] })), [false, null]);
  });
});

describe('a row\'s starting side in the reader', () => {
  const index = vault();
  const sides = { quickRef: new Map(), partyNotes: PARTY };

  it('a cast entry with no stats carries the side', () => {
    const cast = readCast(index, { carried: null, sides });
    const by = (n) => cast.find((c) => c.note === `NPCs/${n}.md`);
    assert.deepStrictEqual([by('NoStats').foe, by('NoStats').ally, by('NoStats').allyBy], [null, true, 'affiliation']);
    assert.deepStrictEqual([by('Ferrante').ally, by('Ferrante').allyFrom, by('Ferrante').allyBy], [false, null, null]);
    assert.strictEqual(cast.find((c) => c.note === EMMA).ally, false);
  });

  it('a foe built from a note carries the side, from the who line and from the Quick Reference', () => {
    const beat = (whoWants) => ({ key: 'b-x', who: [{ note: 'NPCs/Fighter.md', count: 1, wants: whoWants, knownAs: '' }] });
    const foe = (b, ctx) => foesFor(b, index, new Set(), null, ctx).foes[0];
    assert.deepStrictEqual(['ally', 'allyFrom', 'allyBy'].map((k) => foe(beat(''), sides)[k]), [false, null, null]);
    const planned = foe(beat('with the party'), sides);
    assert.deepStrictEqual([planned.ally, planned.allyFrom, planned.allyBy], [true, 'the Plan: "with the party"', 'plan']);
    const quick = foe(beat(''), { quickRef: new Map([['NPCs/Fighter.md', 'Trusted ally']]), partyNotes: PARTY });
    assert.deepStrictEqual([quick.ally, quick.allyBy], [true, 'quickRef']);
    const withStats = foe(beat(''), { quickRef: new Map(), partyNotes: PARTY });
    assert.strictEqual(withStats.ally, false);
  });

  it('a statless NPC\'s cast entry reads the Plan\'s who line', () => {
    const who = new Map([['NPCs/NoStats.md', 'with the party'], ['NPCs/Ferrante.md', '']]);
    const cast = readCast(index, { carried: null, sides: { quickRef: new Map(), partyNotes: [], who } });
    const c = cast.find((x) => x.note === 'NPCs/Ferrante.md');
    assert.strictEqual(c.ally, false);
    const who2 = new Map([['NPCs/Ferrante.md', 'with the party']]);
    const f = readCast(index, { carried: null, sides: { quickRef: new Map(), partyNotes: [], who: who2 } }).find((x) => x.note === 'NPCs/Ferrante.md');
    assert.deepStrictEqual([f.ally, f.allyBy], [true, 'plan']);
  });

  it('a link in the Quick Reference is not the Plan\'s word; a plain "Ally" cell is, as quickRef', () => {
    const { readRunSheet } = require('../lib/run-sheet/read');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-sides-q-'));
    made.push(dir);
    fs.cpSync(path.join(__dirname, 'fixtures', 'run-sheet'), dir, { recursive: true });
    const plan = 'Chapters/Chapter 1/Sessions/Session 02/Session 02 - The Test - Plan.md';
    const text = fs.readFileSync(path.join(dir, plan), 'utf8').replace(/\r\n/g, '\n')
      .replace('| Gate warden | Wants the bell rung | [[The Gate]]', '| [[Allies of Ostia]] | Wants the bell rung | [[The Gate]]')
      .replace('| Chapel keeper |', '| Ally |');
    fs.writeFileSync(path.join(dir, plan), text);
    const cast = readRunSheet(dir, plan, { party: [] }).cast;
    const by = (n) => cast.find((c) => c.note === `Characters/NPCs/${n}.md`);
    assert.deepStrictEqual([by('Brother Ash').ally, by('Brother Ash').allyBy], [false, null]);
    assert.deepStrictEqual([by('Sister Fen').ally, by('Sister Fen').allyBy], [true, 'quickRef']);
  });

  it('a foe whose stats say "as an ally" carries allyBy stats', () => {
    const f = foesFor({ key: 'b-x', who: [{ note: 'NPCs/Friend.md', count: 1, wants: '', knownAs: '' }] }, index, new Set(), null, sides).foes[0];
    assert.deepStrictEqual([f.ally, f.allyFrom, f.allyBy], [true, 'the stat block: "as an ally"', 'stats']);
  });
});

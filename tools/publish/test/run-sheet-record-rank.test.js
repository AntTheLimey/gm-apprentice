'use strict';
// Ranking the no-Plan cards around where the crew stands: one module for the page and for Node.
const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const { readRecord } = require('../lib/run-sheet/read-record');
const RR = require('../lib/run-sheet/web/record-rank');
const { copyRecordFixture } = require('./helpers/record-fixture');
const { removeFixture } = require('./helpers/systems-fixture');

const made = [];
after(() => { for (const d of made) removeFixture(d); });
const CH3 = 'Chapters/Chapter 3/Chapter 3.md';
const S14 = 'Chapters/Chapter 3/Sessions/Session 14/Session 14 - Ledger.md';
const loc = (n) => `Locations/${n}.md`;
const SALT = loc('The Salt Inn');

function model(crlf) {
  const dir = copyRecordFixture({ crlf });
  made.push(dir);
  return readRecord(dir, { index: null, title: 'Session 15', number: 15, chapter: CH3, after: S14, played: false, playDate: null, planVault: false, fromRecord: true });
}
const titles = (list) => list.map((c) => c.title);

for (const crlf of [false, true]) {
  describe(`rankCards${crlf ? ' (CRLF)' : ''}`, () => {
    it('the model carries the location map and where each person is', () => {
      const { record } = model(crlf);
      assert.deepStrictEqual(record.loc[SALT], { parent: loc('Dock Row'), type: 'building' });
      assert.deepStrictEqual(record.loc[loc('Harbour District')], { parent: null, type: 'city' });
      assert.deepStrictEqual(Object.keys(record.loc).sort(), [
        'Locations/Dock Row.md', 'Locations/Harbour District.md', 'Locations/Harbour Festival Grounds.md',
        'Locations/Marrow Market.md', 'Locations/The Salt Inn.md', 'Locations/Veyland.md']);
      assert.deepStrictEqual(record.peopleAt, {
        'Characters/NPCs/Harl Brannock.md': loc('Dock Row'),
        'Characters/NPCs/Odalys Venn.md': SALT,
        'Characters/NPCs/Sister Imry.md': loc('Marrow Market'),
      });
    });

    it('at The Salt Inn: two cards here, two could come, none elsewhere', () => {
      const { record } = model(crlf);
      const r = RR.rankCards(record.cards, SALT, record.loc, record.peopleAt);
      assert.deepStrictEqual(titles(r.here), ['Odalys Venn', 'Harl Brannock']);
      assert.deepStrictEqual(titles(r.could), ['Unsigned notes: someone keeps slipping', 'Corvin Tash']);
      assert.deepStrictEqual(titles(r.elsewhere), []);
    });

    it('after a move to the other city, Here empties and elsewhere grows', () => {
      const { record } = model(crlf);
      const r = RR.rankCards(record.cards, loc('Marrow Market'), record.loc, record.peopleAt);
      assert.deepStrictEqual(titles(r.here), []);
      assert.deepStrictEqual(titles(r.could), ['Unsigned notes: someone keeps slipping', 'Corvin Tash']);
      assert.deepStrictEqual(titles(r.elsewhere), ['Odalys Venn', 'Harl Brannock']);
    });

    it('a typed place has no area: nothing is Here; no place at all: every card could come', () => {
      const { record } = model(crlf);
      const typed = RR.rankCards(record.cards, 'the old pier', record.loc, record.peopleAt);
      assert.deepStrictEqual(titles(typed.here), []);
      assert.deepStrictEqual(titles(typed.elsewhere), ['Odalys Venn', 'Harl Brannock']);
      const none = RR.rankCards(record.cards, null, record.loc, record.peopleAt);
      assert.deepStrictEqual([none.here.length, none.could.length, none.elsewhere.length], [0, 4, 0]);
    });

    it('placesFor lists where they are first, then inside it, then the Here cards places', () => {
      const { record } = model(crlf);
      assert.deepStrictEqual(RR.placesFor(loc('Dock Row'), record.loc, []), [loc('Dock Row'), SALT]);
      const here = [{ places: [loc('Marrow Market'), SALT] }, { places: [loc('Dock Row')] }];
      assert.deepStrictEqual(RR.placesFor(loc('Dock Row'), record.loc, here), [loc('Dock Row'), SALT, loc('Marrow Market')]);
      assert.deepStrictEqual(RR.placesFor(SALT, record.loc, []), [SALT]);
      assert.deepStrictEqual(RR.placesFor(null, record.loc, []), []);
    });
  });
}

describe('rankCards, people', () => {
  const L = { in: { parent: null, type: 'city' }, out: { parent: null, type: 'city' } };
  it('a card with no places whose person stands outside the area ranks elsewhere, not could', () => {
    const card = { title: 'X', places: [], people: ['p'] };
    const r = RR.rankCards([card], 'in', L, { p: 'out' });
    assert.deepStrictEqual([r.here.length, r.could.length, r.elsewhere.length], [0, 0, 1]);
  });
});

describe('areaOf', () => {
  const L = {
    a: { parent: null, type: 'region' }, b: { parent: 'a', type: 'city' }, c: { parent: 'b', type: 'building' },
    x: { parent: 'y', type: 'building' }, y: { parent: 'x', type: 'building' },
    s: { parent: 'a', type: 'Space Station' },
  };
  it('walks up to the nearest settlement', () => {
    assert.strictEqual(RR.areaOf('c', L), 'b');
    assert.strictEqual(RR.areaOf('s', L), 's');
  });
  it('a place with no parent is its own area', () => {
    assert.strictEqual(RR.areaOf('a', L), 'a');
  });
  it('no settlement on the chain: the parent', () => {
    assert.strictEqual(RR.areaOf('b', { b: { parent: 'a', type: 'district' }, a: { parent: null, type: 'region' } }), 'a');
  });
  it('a loop in parent_location stops after 12 steps', () => {
    assert.strictEqual(RR.areaOf('x', L), 'y');
  });
  it('null and unknown places', () => {
    assert.strictEqual(RR.areaOf(null, L), null);
    assert.strictEqual(RR.areaOf('typed name', L), 'typed name');
  });
});

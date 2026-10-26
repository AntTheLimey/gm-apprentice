'use strict';
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { HANDS_FILE, loadHands, handOf, withHand } = require('../../lib/props/hands');

const vaultWith = (text) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hands-'));
  after(() => fs.rmSync(dir, { recursive: true, force: true }));
  if (text !== null) {
    fs.mkdirSync(path.join(dir, '_meta'));
    fs.writeFileSync(path.join(dir, HANDS_FILE), text);
  }
  return dir;
};

describe('loadHands', () => {
  it('no registry, no problem', () => {
    const r = loadHands(vaultWith(null));
    assert.equal(r.hands.size, 0);
    assert.equal(r.problem, null);
  });

  it('a good registry is read, and who is ignored', () => {
    const r = loadHands(vaultWith('{"hands": {"fairhand": {"font": "Tangerine", "who": "clerks"}}}'));
    assert.deepEqual([...r.hands], [['fairhand', { font: 'Tangerine' }]]);
    assert.equal(r.problem, null);
  });

  it('a bad registry is one problem', () => {
    for (const [text, why] of [['{nope', 'not JSON'], ['{"hands": []}', '"hands" is not an object'], ['null', '"hands" is not an object']]) {
      const r = loadHands(vaultWith(text));
      assert.equal(r.hands.size, 0);
      assert.deepEqual(r.problem, {
        detail: `_meta/prop-hands.json is not a hand registry (${why})`,
        fix: 'fix the file: {"hands": {"<id>": {"font": "<Google Fonts family>"}}}',
      });
    }
  });

  it('a bad entry is skipped and named', () => {
    const r = loadHands(vaultWith('{"hands": {"ok": {"font": "Tangerine"}, "Bad Id": {"font": "Tangerine"}, "nofont": {"font": "x;y"}}}'));
    assert.deepEqual([...r.hands.keys()], ['ok']);
    assert.match(r.problem.detail, /"Bad Id", "nofont"/);
  });
});

describe('handOf', () => {
  it('trims and lower-cases, null when empty', () => {
    assert.equal(handOf({ prop_hand: '  FairHand ' }), 'fairhand');
    assert.equal(handOf({ prop_hand: '  ' }), null);
    assert.equal(handOf({}), null);
    assert.equal(handOf(null), null);
  });
});

describe('withHand', () => {
  const hands = new Map([['fairhand', { font: 'Tangerine' }]]);

  it('prop_font beats prop_hand', () => {
    const fields = { prop_hand: 'fairhand', prop_font: 'Special Elite' };
    const r = withHand(fields, hands);
    assert.equal(r.fields.prop_font, 'Special Elite');
    assert.equal(r.problem, null);
  });

  it('a known hand sets prop_font', () => {
    const r = withHand({ prop_hand: 'FairHand', prop_font: '' }, hands);
    assert.equal(r.fields.prop_font, 'Tangerine');
    assert.equal(r.problem, null);
  });

  it('an unknown hand is a problem and changes nothing', () => {
    const fields = { prop_hand: 'scrawl' };
    const r = withHand(fields, hands);
    assert.equal(r.fields, fields);
    assert.deepEqual(r.problem, {
      detail: 'prop_hand "scrawl" is not in _meta/prop-hands.json, so the style\'s own hand is used',
      fix: 'add the hand to _meta/prop-hands.json (vault_write.py prop-hand --hand scrawl --hand-font "<family>"), or correct prop_hand',
    });
  });

  it('no hand, no change', () => {
    const fields = { prop_stamp: 'PAID' };
    assert.deepEqual(withHand(fields, hands), { fields, problem: null });
  });

  it('withHand does not mutate', () => {
    const fields = { prop_hand: 'fairhand' };
    const r = withHand(fields, hands);
    assert.deepEqual(fields, { prop_hand: 'fairhand' });
    assert.notEqual(r.fields, fields);
  });
});

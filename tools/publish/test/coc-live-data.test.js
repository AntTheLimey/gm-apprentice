const { test } = require('node:test');
const assert = require('node:assert');
const { buildCoCLiveData } = require('../lib/templates/coc/live-data');

const META = { campaignId: 'camp', pcSlug: 'ada', buildVersion: 'v1', system: 'coc-7e' };

function model(over = {}) {
  return Object.assign({
    derived: {
      hp: { cur: 9, max: 11 },
      mp: { cur: 14, max: 14 },
      sanity: { cur: 55, max: 99, start: 60 },
      luck: { cur: 48, start: 65 },
    },
    reputation: null,
    conditions: { temporaryInsanity: false, indefiniteInsanity: false, majorWound: false, unconscious: false, dying: false },
    skills: [{ name: 'Spot Hidden', reg: 45 }, { name: 'Library Use', reg: 60 }],
  }, over);
}

test('buildCoCLiveData maps derived vitals, conditions, and skill names', () => {
  const d = buildCoCLiveData(model(), META);
  assert.equal(d.campaignId, 'camp');
  assert.equal(d.pcSlug, 'ada');
  assert.deepEqual(d.hp, { cur: 9, max: 11 });
  assert.deepEqual(d.mp, { cur: 14, max: 14 });
  assert.deepEqual(d.san, { cur: 55, max: 99, start: 60 });
  assert.deepEqual(d.luck, { cur: 48 });
  assert.equal(d.rep, null);
  assert.deepEqual(d.conditions, model().conditions);
  assert.deepEqual(d.skills, ['Spot Hidden', 'Library Use']);
});

test('buildCoCLiveData includes rep only when a Reputation track exists', () => {
  const d = buildCoCLiveData(model({ reputation: { current: 50, start: 50 } }), META);
  assert.deepEqual(d.rep, { cur: 50 });
});

test('buildCoCLiveData returns null without meta (no KV key derivable)', () => {
  assert.equal(buildCoCLiveData(model(), null), null);
});

const { buildSheet } = require('../lib/templates/coc/layout');

test('skill rows carry a stable data-skill attribute for tick serialization', () => {
  const html = buildSheet({
    identity: {}, chars: {}, combat: {}, backstory: [], weapons: [],
    skills: [{ name: 'Spot Hidden', reg: 45, half: 22, fifth: 9, developed: false }],
  });
  assert.match(html, /data-skill="Spot Hidden"/);
});

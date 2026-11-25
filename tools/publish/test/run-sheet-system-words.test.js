'use strict';
// A CoC or GURPS run sheet speaks its own system (step 6b Task 22): no prep note, warning or system word of the model
// holds one of D&D's. Plain node over the model, on the two fixtures and, when present, the Task 28 proof copies
// (Hollow Quay, Dead Air); absent copies are said so and the test is marked skipped, never a silent pass.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readRunSheet } = require('../lib/run-sheet/read');
const { listSessions } = require('../lib/run-sheet/sessions');
const { buildIndex } = require('../lib/run-sheet/notes');
const { copyFixture, removeFixture } = require('./helpers/systems-fixture');

// D&D's words, and Bloodied (a D&D 2024 condition) for the players' rows
const DND = /\bAC\b|initiative modifier|stat-fill|Long rest|milestone|temp HP|death save|Exhaustion|Concentrat|Bloodied/i;
const PROOF = path.join(__dirname, '..', '..', '..', 'tests', 'proof-runs', 'run-sheet-6b', 'vaults');

const pcsOf = (vault) => buildIndex(vault).notes().filter((n) => /^Characters\/PCs\//.test(n));

// Every string the model says as a prep note, a warning or a system word, with where it sits
function sayings(model) {
  const out = [];
  const walk = (v, where) => {
    if (typeof v === 'string') out.push([where, v]);
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${where}[${i}]`));
    else if (v && typeof v === 'object') for (const k of Object.keys(v)) walk(v[k], `${where}.${k}`);
  };
  walk(model.rules.words, 'rules.words');
  walk(model.rules.statuses, 'rules.statuses');
  walk(model.rules.vitals, 'rules.vitals');
  walk(model.warnings, 'warnings');
  const prep = (v, where) => {
    if (Array.isArray(v)) v.forEach((x, i) => prep(x, `${where}[${i}]`));
    else if (v && typeof v === 'object') {
      for (const k of Object.keys(v)) {
        if (k === 'rules') continue;
        if (k === 'prepNote' && typeof v[k] === 'string') out.push([`${where}.prepNote`, v[k]]);
        else prep(v[k], `${where}.${k}`);
      }
    }
  };
  prep(model, 'model');
  return out;
}

function check(vault, label) {
  const sessions = listSessions(vault).filter((s) => s.plan);
  assert.ok(sessions.length > 0, `${label}: no session with a Plan to read`);
  const bad = [];
  let checked = 0;
  for (const s of sessions) {
    const model = readRunSheet(vault, s.plan, { party: pcsOf(vault) });
    for (const [where, text] of sayings(model)) {
      checked++;
      if (DND.test(text)) bad.push(`${label} ${s.label} ${where}: ${text}`);
    }
  }
  assert.ok(checked > 0, `${label}: nothing was checked`);
  assert.deepEqual(bad, [], `D&D words on a ${label} run sheet:\n${bad.join('\n')}`);
}

describe('system words: no D&D word on a CoC or GURPS run sheet', () => {
  for (const [name, fixture, system] of [['CoC fixture', 'run-sheet-coc', 'coc-7e'], ['Regency fixture', 'run-sheet-coc', 'coc-7e-regency'], ['GURPS fixture', 'run-sheet-gurps', 'gurps-4e']]) {
    it(name, () => {
      const dir = copyFixture(fixture);
      try {
        if (system === 'coc-7e-regency') require('./helpers/systems-fixture').withSystem(dir, system);
        check(dir, name);
      } finally { removeFixture(dir); }
    });
  }
  for (const [name, folder] of [['Hollow Quay', 'HollowQuay'], ['Dead Air', 'DeadAir']]) {
    const dir = path.join(PROOF, folder);
    const present = fs.existsSync(dir);
    if (!present) console.log(`skipped: no proof copies at ${dir}`);
    it(`${name} proof copy`, { skip: present ? false : `no proof copies at ${dir}` }, () => check(dir, name));
  }
});

describe('system words: what the page says in place of D&D', () => {
  const { systemFor } = require('../lib/run-sheet/systems');
  const words = (id) => systemFor(id).describe().words;
  it('the Advancement placeholder and the PC line are the system\'s own', () => {
    assert.match(words('dnd-5e-2024').advancement, /milestone/);
    assert.equal(words('coc-7e').advancement, 'One line each, e.g. skill checks to roll');
    assert.equal(words('coc-7e-regency').advancement, 'One line each, e.g. skill checks to roll');
    assert.equal(words('gurps-4e').advancement, 'One line each, e.g. 3 character points');
    const labels = (id) => words(id).pcLine.map((x) => x.word);
    assert.deepEqual(labels('dnd-5e-2024'), ['AC', 'HP', 'Init']);
    assert.deepEqual(labels('coc-7e'), ['HP', 'MP', 'SAN', 'DEX']);
    assert.deepEqual(labels('gurps-4e'), ['HP', 'FP', 'Speed']);
  });
});

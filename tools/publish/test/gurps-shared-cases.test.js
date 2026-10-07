const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const gc = require('../lib/templates/gurps/gurps-calc');

// The cases gurps_calc.py also runs (tests/test_gurps_shared_cases.py).
const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'tests', 'shared-cases', 'gurps-calc.json'), 'utf8'));
const camel = (name) => name.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

test('every formula shared with gurps_calc.py has cases, and every case names one', () => {
  for (const name of Object.keys(DATA.cases)) {
    assert.strictEqual(typeof gc[camel(name)], 'function', `${camel(name)} is not exported`);
    assert.ok(DATA.cases[name].length >= 5, `${name} has fewer than five cases`);
  }
});

for (const [name, cases] of Object.entries(DATA.cases)) {
  test(`${camel(name)} agrees with gurps_calc.py`, () => {
    for (const [args, want] of cases) assert.deepStrictEqual(gc[camel(name)](...args), want, `${name}(${args})`);
  });
}

test('the shared constants agree', () => {
  assert.deepStrictEqual(gc.ENC_LEVELS, DATA.constants.ENC_LEVELS);
  assert.deepStrictEqual(gc.ENC_PENALIZED_SKILLS, DATA.constants.ENC_PENALIZED_SKILLS);
});

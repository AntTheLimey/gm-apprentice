'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { readRunSheet } = require('../lib/run-sheet/read');
const { missingLines } = require('./helpers/run-sheet-lines');

const VAULT = path.join(__dirname, '..', '..', '..', 'tests', 'benchmark-campaign');
const PLAN = 'Chapters/Chapter 1/Sessions/Session 03 - The Inner Sanctum - Plan.md';

describe('run sheet reader on the benchmark Plan', () => {
  it('benchmark plan keeps every line', () => {
    const text = fs.readFileSync(path.join(VAULT, PLAN), 'utf8').replace(/\r\n/g, '\n');
    const body = text.replace(/^---\n[\s\S]*?\n---\n/, '');
    const titles = [...body.matchAll(/^## (.+?)\s*$/gm)].map((m) => m[1]);
    assert.strictEqual(titles.length, 6);

    let m;
    assert.doesNotThrow(() => { m = readRunSheet(VAULT, PLAN, { party: [] }); });
    assert.deepStrictEqual(m.beats, []);
    assert.deepStrictEqual(m.prep.filter((p) => p.title !== '').map((p) => p.title), titles);
    const lead = m.prep.find((p) => p.title === '');
    assert.ok(lead && lead.md.includes('Session 3: The Inner Sanctum'));
    assert.deepStrictEqual(missingLines(body, m), []);
    for (const p of [m.runLong.nextPlan, ...m.runLong.scenes, ...m.runLong.planning.map((x) => x.note)]) {
      if (p) assert.ok(fs.existsSync(path.join(VAULT, p)), `${p} is in the vault`);
    }
  });
});

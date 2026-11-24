'use strict';
const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildIndex } = require('../lib/run-sheet/notes');
const { readCast } = require('../lib/run-sheet/cast');
const { foesOf } = require('../lib/run-sheet/foes');
const { readRunSheet } = require('../lib/run-sheet/read');
const { writeSettings } = require('./helpers/vault-files');

const made = [];
const mkTmp = (prefix) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); made.push(d); return d; };
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

const FIXTURE = path.join(__dirname, 'fixtures', 'run-sheet');
const PLAN = 'Chapters/Chapter 1/Sessions/Session 02/Session 02 - The Test - Plan.md';
const LUCAN = 'Characters/NPCs/Lucan Grey.md';
const ADA = 'Characters/PCs/Ada Moss.md';
const WOLF = 'Creatures/Frost Wolf.md';

function copy(settings = { 'vault.system': 'dnd5e' }) {
  const dir = mkTmp('rs-cast-');
  fs.cpSync(FIXTURE, dir, { recursive: true });
  if (settings) writeSettings(dir, settings);
  return dir;
}

describe('run sheet cast', () => {
  it('cast lists every npc, creature and pc with aliases and gm aliases', () => {
    // Broken.md's frontmatter does not parse, so it has no type to list
    const cast = readCast(buildIndex(copy()), { carried: null });
    const count = (t) => cast.filter((c) => c.type === t).length;
    assert.deepStrictEqual([count('npc'), count('creature'), count('pc')], [6, 5, 2]);
    assert.strictEqual(cast.length, 13);
    const names = cast.map((c) => c.name);
    assert.deepStrictEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
    const lucan = cast.find((c) => c.note === LUCAN);
    assert.deepStrictEqual([lucan.name, lucan.aliases, lucan.gmAliases], ['Lucan Grey', ['Lucan'], ['The Pale Courier']]);
    assert.strictEqual(lucan.withheld, false);
    assert.strictEqual(lucan.dead, false);
    assert.strictEqual(lucan.playAs, 'quick and dry counts exits');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(cast)), cast);
  });

  it("a cast entry's foe row is foesOf's", () => {
    const index = buildIndex(copy());
    const cast = readCast(index, { carried: null });
    const wolf = cast.find((c) => c.note === WOLF);
    assert.deepStrictEqual(wolf.foe, foesOf(WOLF, index, 1, `cast.${WOLF}`).foes[0]);
    assert.ok(wolf.foe.hp > 0);
  });

  it('a note with no name named from its stem shows spaces, not underscores (Task 34)', () => {
    const dir = copy();
    const wolf = fs.readFileSync(path.join(dir, WOLF), 'utf8').replace(/\r\n/g, '\n').replace('name: Frost Wolf\n', '');
    fs.writeFileSync(path.join(dir, 'Creatures/Ice_Hound.md'), wolf);
    const index = buildIndex(dir);
    const hound = readCast(index, { carried: null }).find((c) => c.note === 'Creatures/Ice_Hound.md');
    assert.equal(hound.name, 'Ice Hound');
    assert.equal(hound.named, false);
    assert.deepEqual(foesOf('Creatures/Ice_Hound.md', index, 1, 'b').foes.map((f) => f.name), ['Ice Hound']);
  });
  it('a pc has no foe and no play-as', () => {
    const ada = readCast(buildIndex(copy()), { carried: null }).find((c) => c.note === ADA);
    assert.deepStrictEqual([ada.type, ada.foe, ada.playAs, ada.wants, ada.status], ['pc', null, '', '', 'alive']);
  });

  it('a withheld and a dead note say so', () => {
    const dir = copy();
    const p = path.join(dir, 'Characters/NPCs/Garrick Fell.md');
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/\r?\ntype: npc/, '\ntype: npc\nwithheld: true\nstatus: dead'));
    const g = readCast(buildIndex(dir), { carried: null }).find((c) => c.note === 'Characters/NPCs/Garrick Fell.md');
    assert.deepStrictEqual([g.withheld, g.dead, g.status], [true, true, 'dead']);
  });

  it('cast and notes carry unseen_as', () => {
    const dir = copy();
    const mephit = 'Creatures/Ice Mephit.md';
    const mp = path.join(dir, mephit);
    fs.writeFileSync(mp, fs.readFileSync(mp, 'utf8').replace(/\r?\ntype: creature/, '\ntype: creature\nunseen_as: "  a mephit "'));
    const cast = readCast(buildIndex(dir), { carried: null });
    assert.strictEqual(cast.find((c) => c.note === mephit).unseenAs, 'a mephit');
    assert.strictEqual(cast.find((c) => c.note === WOLF).unseenAs, '');
    assert.ok(cast.every((c) => typeof c.unseenAs === 'string'));
  });

  it('cast warnings stay off the model', () => {
    const dir = copy();
    const m = readRunSheet(dir, PLAN, { party: [ADA] });
    assert.ok(Array.isArray(m.cast) && m.cast.length === 13);
    assert.ok(m.cast.some((c) => c.warnings.length > 0), 'some cast entry carries its own warnings');
    const without = JSON.parse(JSON.stringify(m));
    delete without.cast;
    const texts = new Set(m.warnings.map((w) => w.text));
    // a cast-only warning (a note the Plan never touches) is not in the model's warnings
    for (const c of m.cast) for (const w of c.warnings) if (!m.beats.some((b) => b.foes.some((f) => f.note === c.note))) assert.ok(!texts.has(w.text), w.text);
    // and the model's warnings are what the reader gave before the cast: no more, none changed
    assert.deepStrictEqual(m.warnings, without.warnings);
    assert.ok(!m.warnings.some((w) => /^cast\./.test(String(w.note))));
  });

  it('campaign from player_site.title, else the folder name', () => {
    const dir = copy({ 'vault.system': 'dnd5e', 'player_site.title': 'The Long Winter' });
    assert.strictEqual(readRunSheet(dir, PLAN, { party: [] }).campaign, 'The Long Winter');
    const bare = copy(null);
    fs.rmSync(path.join(bare, '_meta'), { recursive: true, force: true });
    assert.strictEqual(readRunSheet(bare, PLAN, { party: [] }).campaign, path.basename(bare));
  });

  it('withheld words from the settings, defaults without', () => {
    const dir = copy({ 'vault.system': 'dnd5e', 'player_site.withheld_words.person': 'a stranger' });
    assert.deepStrictEqual(readRunSheet(dir, PLAN, { party: [] }).withheldWords, { person: 'a stranger', place: 'somewhere' });
    assert.deepStrictEqual(readRunSheet(copy(), PLAN, { party: [] }).withheldWords, { person: 'someone', place: 'somewhere' });
  });

  it('recharge thresholds', () => {
    const dir = copy();
    const p = path.join(dir, WOLF);
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('***Howl (Recharge 5-6).***', '***Howl (Recharge 5–6).*** x\n\n***Cold Breath (Recharge 5–6).*** y\n\n***Roar (Recharge 6).***'));
    const { foe } = readCast(buildIndex(dir), { carried: null }).find((c) => c.note === WOLF);
    assert.deepStrictEqual(foe.rechargeAt, { 'Cold Breath': 5, Howl: 5, Roar: 6 });
    const plain = readCast(buildIndex(copy()), { carried: null }).find((c) => c.note === WOLF).foe;
    assert.deepStrictEqual(plain.rechargeAt, { Howl: 5 }, 'the ASCII hyphen reads too');
    assert.deepStrictEqual(readCast(buildIndex(copy()), { carried: null }).find((c) => c.note === LUCAN).foe.rechargeAt, {});
  });

  it('a 500-person cast reads within budget', () => {
    const dir = mkTmp('rs-cast500-');
    fs.mkdirSync(path.join(dir, 'Characters'), { recursive: true });
    for (let i = 0; i < 500; i++) {
      const type = i % 2 ? 'creature' : 'npc';
      fs.writeFileSync(path.join(dir, 'Characters', `Person ${i}.md`), [
        '---', `name: Person ${i}`, `type: ${type}`, 'aliases: [P' + i + ']', '---', '', '## Overview', '', 'Someone.', '',
        '<!-- gm-only -->', '', '## GM Notes', '', '### Stats', '', `AC 12, Hit Points ${10 + i % 30}, Initiative +1`, '',
        '***Bite (Recharge 5-6).*** teeth', '', '### Playing Them', '', '- **Speech:** low', '- **Tell:** blinks', '',
        '### Wants', '', 'To be left alone.', '', '<!-- /gm-only -->', '',
      ].join('\n'));
    }
    const index = buildIndex(dir);
    const t0 = Date.now();
    const cast = readCast(index, { carried: null });
    const ms = Date.now() - t0;
    assert.strictEqual(cast.length, 500);
    assert.ok(ms < 1500, `${ms} ms`);
    assert.strictEqual(cast[0].playAs.length > 0, true);
  });
});

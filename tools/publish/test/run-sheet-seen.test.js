'use strict';
// A foe's starting "seen" (6a Task 4): a note that publishes on the player site, or one an earlier
// played session named in its Play Notes or Table Log, by a link or by its whole name or an alias.
const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readRunSheet } = require('../lib/run-sheet/read');
const { writeSettings } = require('./helpers/vault-files');

const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
const FIXTURE = path.join(__dirname, 'fixtures', 'run-sheet');
const PLAN = 'Chapters/Chapter 1/Sessions/Session 02/Session 02 - The Test - Plan.md';
const S = 'Chapters/Chapter 1/Sessions/';
const write = (dir, rel, text) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
};
const npc = (name, extra = '') => `---\nname: ${name}\ntype: npc\n${extra}---\n\n## Overview\n\nSomeone.\n`;
const NOTE = (n) => `Characters/NPCs/${n}.md`;

// A vault where only Lucan Grey publishes; Session 1 is played with Play Notes `s1`; Session 3 is
// played after the run's Session 2 with Play Notes `s3`.
function vault({ s1 = 'Nothing of note.', s3 = 'Nothing of note.', notes = {}, publish = ['Characters/NPCs/Lucan Grey.md'] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-seen-'));
  made.push(dir);
  fs.cpSync(FIXTURE, dir, { recursive: true });
  writeSettings(dir, { 'vault.system': 'dnd5e' });
  if (publish) write(dir, '_meta/publish-list.yaml', `publishing:\n${publish.map((p) => `  - ${p}\n`).join('')}`);
  const idx = (n, title, status) => `---\ntype: session\nsession_number: ${n}\nchapter: "[[Chapter 1]]"\nstatus: ${status}\ndocuments:\n  play_notes: "[[${title} - Play Notes]]"\n---\n\n# ${title}\n`;
  write(dir, `${S}Session 01/Session 01 - Start.md`, idx(1, 'Session 01 - Start', 'played'));
  write(dir, `${S}Session 01/Session 01 - Start - Play Notes.md`, `---\ntype: session-play-notes\nsession: "[[Session 01 - Start]]"\n---\n\n${s1}\n`);
  write(dir, `${S}Session 03/Session 03 - Next.md`, idx(3, 'Session 03 - Next', 'played'));
  write(dir, `${S}Session 03/Session 03 - Next - Play Notes.md`, `---\ntype: session-play-notes\nsession: "[[Session 03 - Next]]"\n---\n\n${s3}\n`);
  for (const [n, text] of Object.entries(notes)) write(dir, NOTE(n), text);
  return dir;
}
const seenOf = (dir) => readRunSheet(dir, PLAN, { party: [] }).seenFrom;

describe('a foe starts seen (6a Task 4)', () => {
  it('published note is seen', () => {
    assert.strictEqual(seenOf(vault())[NOTE('Lucan Grey')], 'on the player site');
  });

  it("linked in an earlier session's Play Notes", () => {
    const dir = vault({ s1: 'They met [[Abbot Rime|the abbot]] at dusk.' });
    assert.strictEqual(seenOf(dir)[NOTE('Abbot Rime')], 'named in Session 1');
  });

  it('whole name in words counts, first name alone does not', () => {
    const dir = vault({ s1: 'Garrick Fell waved. Later Brother wept. Sister was quiet. Abbotsford burned.', notes: { 'Garrick Fell': npc('Garrick Fell') } });
    const seen = seenOf(dir);
    assert.strictEqual(seen[NOTE('Garrick Fell')], 'named in Session 1');
    assert.ok(!(NOTE('Brother Ash') in seen), 'a first word alone is not a name');
    assert.ok(!(NOTE('Sister Fen') in seen));
    assert.ok(!(NOTE('Abbot Rime') in seen), 'part of a word is not a name');
    const dir2 = vault({ s1: 'Garrick met Mr Fell.' });
    assert.ok(!(NOTE('Garrick Fell') in seenOf(dir2)), 'a first name alone is not the name');
    const dir3 = vault({ s1: 'The Garrick Fellows club.' });
    assert.ok(!(NOTE('Garrick Fell') in seenOf(dir3)), 'a name inside a longer word does not count');
  });

  it('a later session does not count', () => {
    const dir = vault({ s3: 'Brother Ash and [[Sister Fen]] arrived.' });
    const seen = seenOf(dir);
    assert.ok(!(NOTE('Brother Ash') in seen));
    assert.ok(!(NOTE('Sister Fen') in seen));
  });

  it('an alias counts', () => {
    const dir = vault({ s1: 'A scout called Lucan helped them; the Frost Warden watched.', notes: { 'Brother Venn': npc('Brother Venn', 'aliases: [Frost Warden]\n') }, publish: [] });
    const seen = seenOf(dir);
    assert.strictEqual(seen[NOTE('Brother Venn')], 'named in Session 1');
    assert.strictEqual(seen[NOTE('Lucan Grey')], 'named in Session 1', 'Lucan is Lucan Grey\'s alias');
  });

  it('a gm_alias never counts', () => {
    const dir = vault({ s1: 'The Pale Courier rode off.', publish: [] });
    assert.ok(!(NOTE('Lucan Grey') in seenOf(dir)));
  });

  it('unpublished and never named is absent', () => {
    const seen = seenOf(vault());
    assert.ok(!(NOTE('Garrick Fell') in seen));
    assert.ok(!(NOTE('Brother Ash') in seen));
    assert.ok(!('Creatures/Frost Wolf.md' in seen));
  });

  it("an earlier session's Table Log counts", () => {
    const dir = vault();
    write(dir, `${S}Session 01/Session 01 - Start - Table Log.md`, `---\ntype: session-table-log\nsession: "[[Session 01 - Start]]"\n---\n\nThe Frost Wolf was beaten.\n`);
    const idx = fs.readFileSync(path.join(dir, `${S}Session 01/Session 01 - Start.md`), 'utf8').replace('documents:\n', 'documents:\n  table_log: "[[Session 01 - Start - Table Log]]"\n');
    write(dir, `${S}Session 01/Session 01 - Start.md`, idx);
    assert.strictEqual(seenOf(dir)['Creatures/Frost Wolf.md'], 'named in Session 1');
  });

  it('an unplayed earlier session does not count', () => {
    const dir = vault({ s1: 'Garrick Fell waved.', notes: { 'Garrick Fell': npc('Garrick Fell') } });
    const p = path.join(dir, `${S}Session 01/Session 01 - Start.md`);
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('status: played', 'status: planned').replace(/documents:[\s\S]*?---/, '---'));
    assert.ok(!(NOTE('Garrick Fell') in seenOf(dir)));
  });

  it('a manifest that does not read gives {} and a warning, never a throw', () => {
    const dir = vault({ s1: '[[Abbot Rime]] spoke.' });
    write(dir, '_meta/publish-list.yaml', 'publishing: [unclosed\n  - x: : :\n');
    const m = readRunSheet(dir, PLAN, { party: [] });
    assert.deepStrictEqual(m.seenFrom, {});
    assert.ok(m.warnings.some((w) => w.kind === 'seen-list'));
  });
});

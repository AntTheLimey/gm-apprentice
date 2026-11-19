'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildIndex } = require('../lib/run-sheet/notes');
const { writeSettings } = require('./helpers/vault-files');
const { makePng } = require('./helpers/make-png');

const FIXTURE = path.join(__dirname, 'fixtures', 'run-sheet');

// A copy of the fixture with its settings and picture, written at test time.
function copy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-'));
  fs.cpSync(FIXTURE, dir, { recursive: true });
  writeSettings(dir, { 'vault.system': 'dnd5e' });
  fs.mkdirSync(path.join(dir, '_attachments'), { recursive: true });
  fs.writeFileSync(path.join(dir, '_attachments', 'ada.png'), makePng(8, 8));
  return dir;
}

describe('run sheet note index', () => {
  it('resolves file name, folder path, alias and gm_alias', () => {
    const idx = buildIndex(copy());
    assert.strictEqual(idx.resolve('Brother Ash'), 'Characters/NPCs/Brother Ash.md');
    assert.strictEqual(idx.resolve('Characters/NPCs/Brother Ash'), 'Characters/NPCs/Brother Ash.md');
    assert.strictEqual(idx.resolve('Lucan'), 'Characters/NPCs/Lucan Grey.md');
    assert.strictEqual(idx.resolve('The Pale Courier'), 'Characters/NPCs/Lucan Grey.md');
    assert.strictEqual(idx.resolve('Nobody Here'), null);
    assert.strictEqual(idx.resolve('constructor'), null);
    assert.ok(idx.notes().includes('Chapters/Chapter 1/Scenes/The Bell Tower.md'));
  });

  it('nfd file name resolves from an nfc link', () => {
    const dir = copy();
    const nfd = 'Sia\u0302n'; // typed as a base letter and a combining mark, the way macOS keeps it
    const nfc = 'Si\u00e2n';
    assert.notStrictEqual(nfd, nfc);
    fs.writeFileSync(path.join(dir, 'Characters', 'NPCs', `${nfd}.md`), '---\ntype: npc\n---\n\nHello.\n');
    assert.ok(fs.readdirSync(path.join(dir, 'Characters', 'NPCs')).some((n) => n.normalize('NFC') === `${nfc}.md`));
    const idx = buildIndex(dir);
    assert.ok(idx.resolve(nfc), 'resolves from the NFC spelling');
    assert.ok(idx.resolve(nfd), 'and from the NFD one');
  });

  it('broken frontmatter resolves, unreadable, one warning', () => {
    const idx = buildIndex(copy());
    const p = idx.resolve('Broken');
    assert.strictEqual(p, 'Characters/NPCs/Broken.md');
    const r = idx.read(p);
    assert.strictEqual(r.unreadable, true);
    assert.deepStrictEqual(r.fm, {});
    assert.strictEqual(idx.warnings.filter((w) => w.kind === 'unreadable-frontmatter').length, 1);
    assert.strictEqual(idx.read('Characters/NPCs/Brother Ash.md').unreadable, false);
  });

  it('a shared file name resolves by path only', () => {
    const idx = buildIndex(copy());
    assert.strictEqual(idx.resolve('index'), null);
    assert.strictEqual(idx.resolve('Locations/North/index'), 'Locations/North/index.md');
    assert.strictEqual(idx.resolve('Locations/South/index'), 'Locations/South/index.md');
    assert.strictEqual(idx.warnings.filter((w) => w.kind === 'ambiguous-name').length, 1);
  });

  it('left-out folders are skipped', () => {
    const dir = copy();
    for (const d of ['_archive', '_Templates', '_midwife', '_meta', '_QA', 'node_modules']) {
      fs.mkdirSync(path.join(dir, d), { recursive: true });
      fs.writeFileSync(path.join(dir, d, 'Brother Ash.md'), '---\ntype: npc\n---\n\nImpostor.\n');
    }
    fs.mkdirSync(path.join(dir, 'Characters', '.hidden'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'Characters', '.hidden', 'Brother Ash.md'), 'x');
    const idx = buildIndex(dir);
    assert.strictEqual(idx.resolve('Brother Ash'), 'Characters/NPCs/Brother Ash.md');
    assert.ok(idx.notes().every((n) => !/^(_archive|_Templates|_midwife|_meta|_QA|node_modules)\//.test(n) && !n.includes('/.hidden/')));
    assert.strictEqual(idx.warnings.filter((w) => w.kind === 'ambiguous-name').length, 1);
  });

  it('portrait resolves through the attachments', () => {
    const idx = buildIndex(copy());
    assert.strictEqual(idx.portrait('Characters/PCs/Ada Moss.md'), '_attachments/ada.png');
    assert.strictEqual(idx.portrait('Characters/PCs/Ben Hart.md'), null);
  });

  it('section and gmSection read headings', () => {
    const idx = buildIndex(copy());
    assert.match(idx.section('Chapters/Chapter 1/Sessions/Session 02/Session 02 - The Test - Plan.md', 'Session Intent'), /wolves are listening/);
    assert.match(idx.gmSection('Characters/NPCs/Brother Ash.md', 'Playing Them'), /Speech/);
    assert.strictEqual(idx.gmSection('Characters/NPCs/Brother Ash.md', 'Nope'), '');
  });
});

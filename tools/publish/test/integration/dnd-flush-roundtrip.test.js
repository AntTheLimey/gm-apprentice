require('../helpers/quiet-legacy-warning.js');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const path = require('path'); const os = require('os');
const { build } = require('../../lib/build');
const { applyDnDFlush } = require('../../lib/flush/dnd-writeback');

// The write-back must find, in the note, every cell the build made live. For every D&D PC
// fixture: build, change everything live, flush, rebuild from the flushed note, compare.
const FIXTURES = path.join(__dirname, '..', 'fixtures');
const PCS = path.join('Characters', 'PCs');

function copyAndBuild(sourceVault, mutate) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-publish-dnd-roundtrip-'));
  const vault = path.join(work, 'vault');
  fs.cpSync(sourceVault, vault, { recursive: true });
  const cfg = path.join(vault, '_meta', 'vault-config.md');
  if (!/live_stats: true/.test(fs.readFileSync(cfg, 'utf8'))) {
    fs.writeFileSync(cfg, fs.readFileSync(cfg, 'utf8').replace('system: dnd-5e-2024', 'system: dnd-5e-2024\n  live_stats: true'));
  }
  if (mutate) mutate(vault);
  const configPath = path.join(work, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    vaultPath: vault, outputDir: path.join(work, 'docs'), attachmentsDir: '_attachments', siteTitle: 'D&D Test',
    system: 'dnd-5e-2024', excludeDirs: ['_meta', '_Templates'], excludeSections: ['GM Notes'],
    folderMap: { 'Characters/PCs': 'characters/pcs', Creatures: 'creatures', Items: 'items' },
  }, null, 2));
  const realWarn = console.warn; const realLog = console.log;
  console.warn = () => {}; console.log = () => {};
  try { build({ configPath, assumeKv: true }); } finally { console.warn = realWarn; console.log = realLog; }
  const island = file => {
    const html = fs.readFileSync(path.join(work, 'docs', 'characters', 'pcs', file.replace(/_/g, '-').replace(/\.md$/, '').toLowerCase() + '.html'), 'utf8');
    const m = html.match(/<script type="application\/json" id="dnd-live-data">([\s\S]*?)<\/script>/);
    return m ? JSON.parse(m[1].replace(/\\u003c/g, '<')) : null;
  };
  return { work, vault, island };
}

describe('D&D flush round trip, every fixture note', () => {
  let first, second;
  const files = fs.readdirSync(path.join(FIXTURES, 'with-dnd-pc', PCS)).filter(f => f.endsWith('.md'));
  const flushed = {};
  const blobs = {};
  before(() => {
    first = copyAndBuild(path.join(FIXTURES, 'with-dnd-pc'));
    for (const file of files) {
      const d = first.island(file);
      if (!d) continue;
      const note = fs.readFileSync(path.join(first.vault, PCS, file), 'utf8').replace(/\r\n/g, '\n');
      const b = { v: 1, used: {}, concentrating: false, conditions: ['Prone', 'Stunned'] };
      if (d.defaults.hp !== null) b.hp = d.defaults.hp > 0 ? d.defaults.hp - 1 : 1;
      b.temp = d.defaults.temp + 1;
      if (d.exhaustionLive) b.exhaustion = (d.defaults.exhaustion + 1) % 7;
      if (d.inspirationLive) b.inspiration = !d.defaults.inspiration;
      for (const t of d.tracks) b.used[t.key] = (t.used + 1) % (t.max + 1);
      blobs[file] = b;
      flushed[file] = { note, island: d, result: applyDnDFlush(note, b) };
    }
    second = copyAndBuild(path.join(FIXTURES, 'with-dnd-pc'), (vault) => {
      for (const file of files) if (flushed[file]) fs.writeFileSync(path.join(vault, PCS, file), flushed[file].result.markdown);
    });
  });
  after(() => { for (const s of [first, second]) if (s) fs.rmSync(s.work, { recursive: true, force: true }); });

  it('covers every D&D PC fixture note that goes live', () => {
    assert.ok(Object.keys(flushed).length >= 5, Object.keys(flushed).join(','));
  });

  for (const file of files) {
    it(`${file}: names only cells the note truly lacks, keeps its lines, rebuilds to what was flushed, and is stable`, () => {
      const f = flushed[file];
      if (!f) return;
      const expected = file === 'Ilse_Varn_Old_Layout.md' ? ['conditions', 'exhaustion', 'temp'] : [];
      assert.deepEqual(f.result.skipped.slice().sort(), expected);
      assert.equal(f.result.markdown.split('\n').length, f.note.split('\n').length);
      const d2 = second.island(file);
      const b = blobs[file];
      for (const k of ['hp', 'temp', 'exhaustion', 'inspiration']) {
        if (b[k] !== undefined && !expected.includes(k)) assert.equal(d2.defaults[k], b[k], `${file}: ${k}`);
      }
      if (!expected.includes('conditions')) assert.deepEqual(d2.defaults.conditions, b.conditions);
      assert.deepEqual(d2.defaults.used, b.used);
      assert.deepEqual(d2.tracks.map(t => [t.key, t.max]), f.island.tracks.map(t => [t.key, t.max]));
      const again = applyDnDFlush(f.result.markdown, b);
      assert.deepEqual(again.changes, []);
      assert.equal(again.markdown, f.result.markdown);
    });
  }
});

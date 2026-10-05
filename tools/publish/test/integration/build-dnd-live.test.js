require('../helpers/quiet-legacy-warning.js');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const path = require('path'); const os = require('os');
const { build } = require('../../lib/build');

const FIXTURES = path.join(__dirname, '..', 'fixtures');

function site(liveStats, mutate) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-publish-dnd-live-'));
  const vault = path.join(work, 'vault');
  fs.cpSync(path.join(FIXTURES, 'with-dnd-pc'), vault, { recursive: true });
  if (mutate) mutate(vault);
  if (liveStats) {
    const cfg = path.join(vault, '_meta', 'vault-config.md');
    fs.writeFileSync(cfg, fs.readFileSync(cfg, 'utf8').replace('system: dnd-5e-2024', 'system: dnd-5e-2024\n  live_stats: true'));
  }
  const configPath = path.join(work, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    vaultPath: vault, outputDir: path.join(work, 'docs'), attachmentsDir: '_attachments', siteTitle: 'D&D Test',
    system: 'dnd-5e-2024', excludeDirs: ['_meta', '_Templates'], excludeSections: ['GM Notes'],
    folderMap: { 'Characters/PCs': 'characters/pcs', Creatures: 'creatures', Items: 'items' },
  }, null, 2));
  const warned = [];
  const realWarn = console.warn;
  console.warn = (...a) => { warned.push(a.join(' ')); };
  try { build({ configPath, assumeKv: true }); } finally { console.warn = realWarn; }
  const page = slug => fs.readFileSync(path.join(work, 'docs', 'characters', 'pcs', slug + '.html'), 'utf8');
  return { work, page, warned };
}
const islandOf = html => JSON.parse(html.match(/<script type="application\/json" id="dnd-live-data">([\s\S]*?)<\/script>/)[1].replace(/\\u003c/g, '<'));

describe('build integration: D&D live sheet', () => {
  let on, off;
  before(() => { on = site(true); off = site(false); });
  after(() => { for (const s of [on, off]) fs.rmSync(s.work, { recursive: true, force: true }); });

  it('live on: the island, both scripts in order, and the store script first', () => {
    const html = on.page('brannoch-vale');
    const d = islandOf(html);
    assert.equal(d.system, 'dnd');
    assert.equal(d.pcSlug, 'brannoch-vale');
    assert.ok(d.tracks.some(t => t.key === 'class:channel divinity' && t.rest === 'short1'));
    assert.ok(html.indexOf('js/live-state.js') < html.indexOf('js/dnd-live.js'));
    assert.ok(fs.existsSync(path.join(on.work, 'docs', 'js', 'dnd-live.js')));
  });

  it('live on: every track in the island has a hook on the page, and every hook has a track', () => {
    for (const slug of ['brannoch-vale', 'ilse-varn', 'oriel-thackeray', 'tamsin-reed', 'dov-ashgrove']) {
      const html = on.page(slug);
      const keys = new Set(islandOf(html).tracks.map(t => t.key));
      const hooks = new Set([...html.matchAll(/data-live="([^"]+)"/g)].map(m => m[1].replace(/&amp;/g, '&')));
      for (const k of keys) assert.ok(hooks.has(k), `${slug}: no hook for ${k}`);
      for (const h of hooks) assert.ok(keys.has(h) || ['vitals', 'hp', 'chips'].includes(h), `${slug}: hook ${h} has no track`);
    }
  });

  it('live on: a mark is a button; a feature on two tabs is hooked twice under one key', () => {
    const html = on.page('tamsin-reed');
    assert.match(html, /<span class="dnd5e-marks dnd5e-live" data-live="class:second wind" role="group"[^>]*><button type="button" class="dnd5e-mark/);
    assert.equal([...html.matchAll(/data-live="class:second wind"/g)].length, 2);
  });

  it('live on: what the note over-spent stays as written and has no hook', () => {
    assert.doesNotMatch(on.page('tamsin-reed'), /data-live="class:action surge"/);
  });

  it('live on: the vitals strip is hooked', () => {
    const html = on.page('brannoch-vale');
    assert.match(html, /<section class="dnd5e-vitals" aria-label="Vitals" data-live="vitals">/);
    assert.match(html, /class="dnd5e-v dnd5e-hp" data-live="hp"/);
    assert.match(html, /class="dnd5e-chips[^"]*" data-live="chips"/);
  });

  it('live on: a linked magic item name is live (its key is built from the shown text)', () => {
    const html = on.page('brannoch-vale');
    const d = islandOf(html);
    const item = d.tracks.find(t => t.key.startsWith('item:'));
    assert.ok(item, 'a magic item track');
    assert.doesNotMatch(item.key, /\[|\||\\/);
    assert.ok(html.includes(`data-live="${item.key}"`), `no hook for ${item.key}`);
  });

  it('live off: no hook, no island, no script', () => {
    for (const slug of ['brannoch-vale', 'tamsin-reed', 'ilse-varn-old-layout']) {
      const html = off.page(slug);
      assert.doesNotMatch(html, /data-live|dnd-live|live-state\.js/);
      assert.match(html, /<span class="dnd5e-mark/);
    }
  });

  it('a duplicate-named live row warns only when live is on', () => {
    const dup = vault => {
      const f = path.join(vault, 'Characters', 'PCs', 'Brannoch_Vale.md');
      const text = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
      const row = text.split('\n').find(l => l.startsWith('| [[Wand_of_Magic_Missiles'));
      fs.writeFileSync(f, text.replace(row, row + '\n' + row));
    };
    const withLive = site(true, dup);
    const without = site(false, dup);
    try {
      assert.ok(withLive.warned.some(w => /share one count/.test(w)));
      assert.ok(!without.warned.some(w => /share one count/.test(w)));
    } finally {
      for (const s of [withLive, without]) fs.rmSync(s.work, { recursive: true, force: true });
    }
  });
});

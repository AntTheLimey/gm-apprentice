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
  fs.writeFileSync(path.join(vault, 'Characters', 'PCs', 'Player Characters.md'), '---\ntype: pc_roster\ncanon_status: AUTHORITATIVE\n---\n\n# Player Characters\n\nThe party.\n');
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
  const roster = () => fs.readFileSync(path.join(work, 'docs', 'characters', 'pcs', 'player-characters.html'), 'utf8');
  return { work, page, roster, warned };
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

  it('the party page: a board with a row per PC; the live layer only when live is on', () => {
    const live = on.roster(), still = off.roster();
    assert.match(live, /data-gl-party="brannoch-vale"/);
    assert.match(live, /id="dnd-party-data"/);
    assert.ok(live.indexOf('js/party-core.js') < live.indexOf('js/dnd-live.js'));
    assert.ok(live.indexOf('js/dnd-live.js') < live.indexOf('js/dnd-party.js'));
    assert.match(still, /data-gl-party="brannoch-vale"/);
    assert.doesNotMatch(still, /dnd-party-data|dnd-party\.js/);
  });

  it('a PC whose note gives nothing live still has a party row, sorted by name, with dashes and nothing live', () => {
    const bare = '---\ntype: pc\ncanon_status: DRAFT\nstatus: alive\n---\n\n# Aaron Bare\n\n## Stat Sheet\n\n### Combat\n\n| Attribute | Value |\n|---|---|\n| AC | 15 |\n';
    const withBare = v => fs.writeFileSync(path.join(v, 'Characters', 'PCs', 'Aaron_Bare.md'), bare);
    const a = site(true, withBare), b = site(false, withBare);
    try {
      for (const s of [a, b]) {
        assert.equal(s.page('aaron-bare').includes('dnd-live-data'), false);
        const html = s.roster();
        assert.ok(html.indexOf('data-gl-party="aaron-bare"') > 0 && html.indexOf('data-gl-party="aaron-bare"') < html.indexOf('data-gl-party="brannoch-vale"'));
        const row = html.match(/<tr class="gl-party-row[^>]*data-gl-party="aaron-bare">[\s\S]*?<\/tr>/)[0];
        assert.match(row, /data-gl-party-field="ac"><span class="gl-vnum">15</);
        assert.match(row, /data-gl-party-field="hp"><span class="gl-vnum">—</);
        assert.doesNotMatch(row, /Dying|Fine/);
      }
      const manifest = JSON.parse(a.roster().match(/id="dnd-party-data">([\s\S]*?)<\/script>/)[1].replace(/\\u003c/g, '<'));
      assert.equal(manifest.pcs.find(p => p.pcSlug === 'aaron-bare').unreadable, true);
      assert.equal(manifest.pcs.find(p => p.pcSlug === 'brannoch-vale').unreadable, undefined);
    } finally { for (const s of [a, b]) fs.rmSync(s.work, { recursive: true, force: true }); }
  });

  it('live off: no hook, no island, no script', () => {
    for (const slug of ['brannoch-vale', 'tamsin-reed', 'ilse-varn-old-layout']) {
      const html = off.page(slug);
      assert.doesNotMatch(html, /data-live|dnd-live|live-state\.js/);
      assert.match(html, /<span class="dnd5e-mark/);
    }
  });

  it('of two rows with one name only the first is tappable; the second is drawn as the note has it', () => {
    // Channel Divinity (2 uses, 1 used) twice, the second with 5 uses and none used; and two 1st-level slot rows.
    const dup = vault => {
      const f = path.join(vault, 'Characters', 'PCs', 'Brannoch_Vale.md');
      let text = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
      const cd = text.split('\n').find(l => l.startsWith('| Channel Divinity |'));
      assert.ok(cd && cd.includes('| 2 | 1 |'), 'fixture row changed');
      text = text.replace(cd, cd + '\n' + cd.replace('| 2 | 1 |', '| 5 | 0 |'));
      const slot = text.split('\n').find(l => l.startsWith('| 1st | 4 | 1 |'));
      assert.ok(slot, 'fixture row changed');
      text = text.replace(slot, slot + '\n| 1st | 3 | 0 |');
      fs.writeFileSync(f, text);
    };
    const s = site(true, dup);
    try {
      const html = s.page('brannoch-vale');
      const d = islandOf(html);
      assert.equal(d.tracks.filter(t => t.key === 'class:channel divinity').length, 1);
      assert.equal(d.tracks.find(t => t.key === 'class:channel divinity').max, 2);
      for (const [key, max] of [['class:channel divinity', 2], ['slot:1st', 4]]) {
        const hooked = [...html.matchAll(new RegExp(`<span class="dnd5e-marks dnd5e-live" data-live="${key}"[^>]*>((?:<button[^>]*></button>)*)</span>`, 'g'))];
        assert.ok(hooked.length >= 1, key);
        for (const h of hooked) assert.equal((h[1].match(/<button/g) || []).length, max, `${key}: a hooked group has the first row's marks`);
      }
      // The later rows are on the page, as marks nobody can tap.
      assert.match(html, /<span class="dnd5e-marks" role="img" aria-label="Channel Divinity: 5 of 5 left">/);
      assert.match(html, /<span class="dnd5e-marks" role="img" aria-label="Spell slots, 1st: 3 of 3 left">/);
    } finally { fs.rmSync(s.work, { recursive: true, force: true }); }
  });

  it('a Conditions cell that says None is no condition, on the page and on the party board', () => {
    const none = vault => {
      const f = path.join(vault, 'Characters', 'PCs', 'Brannoch_Vale.md');
      const text = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
      assert.match(text, /^\| Conditions \|[^|]*\|$/m);
      fs.writeFileSync(f, text.replace(/^\| Conditions \|[^|]*\|$/m, '| Conditions | None |'));
    };
    const s = site(true, none);
    try {
      assert.deepEqual(islandOf(s.page('brannoch-vale')).defaults.conditions, []);
      const row = s.roster().match(/<tr class="gl-party-row[^"]*" data-gl-party="brannoch-vale">[\s\S]*?<\/tr>/)[0];
      assert.doesNotMatch(row, /None|cond-wound/);
    } finally { fs.rmSync(s.work, { recursive: true, force: true }); }
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
      assert.ok(withLive.warned.some(w => /only the first is live/.test(w)));
      assert.ok(!without.warned.some(w => /only the first is live/.test(w)));
    } finally {
      for (const s of [withLive, without]) fs.rmSync(s.work, { recursive: true, force: true });
    }
  });
});

const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { planMigration, applyMigration, runMigrateConfig } = require('../lib/migrate-config');
const { MOVED_KEYS, DEPLOY_KEYS } = require('../lib/config-keys');
const { parseNote } = require('../lib/frontmatter');
const { build } = require('../lib/build');
const { loadPublishConfig } = require('../lib/config');

const CLI = path.join(__dirname, '..', 'bin', 'gm-publish.js');
const FIXTURE = path.join(__dirname, 'fixtures', 'with-gurps-pc');
const KV_TOML = '[[kv_namespaces]]\nbinding = "INBOX"\nid = "abc123def456"\n';
const roots = [];
after(() => roots.forEach((r) => fs.rmSync(r, { recursive: true, force: true })));

// A temp site (vault.config.json) beside a temp vault; `vaultFile` is the text of
// _meta/vault-config.md, or null for none.
function makeSite({ site = {}, vaultFile = '---\ntype: meta\n---\n', root } = {}) {
  root = root || fs.mkdtempSync(path.join(os.tmpdir(), 'gm-migrate-'));
  if (!roots.includes(root)) roots.push(root);
  const vault = path.join(root, 'vault');
  fs.mkdirSync(path.join(vault, '_meta'), { recursive: true });
  if (vaultFile !== null) fs.writeFileSync(path.join(vault, '_meta', 'vault-config.md'), vaultFile);
  const configPath = path.join(root, 'vault.config.json');
  fs.writeFileSync(configPath, JSON.stringify({ vaultPath: vault, outputDir: './docs', ...site }, null, 2) + '\n');
  return { root, vault, configPath, vaultFile: path.join(vault, '_meta', 'vault-config.md') };
}
const read = (f) => fs.readFileSync(f, 'utf8');
const publishOf = (f) => parseNote(read(f)).data.publish;
const migrate = (s) => {
  const plan = planMigration({ configPath: s.configPath });
  return { plan, result: applyMigration(plan, { configPath: s.configPath }) };
};
const cli = (args, cwd) => spawnSync(process.execPath, [CLI, 'migrate-config', ...args], { cwd: cwd || os.tmpdir(), encoding: 'utf8' });

// One value of the right shape for every moved key.
const FULL = {
  siteTitle: 'Dead Light', footer: 'Made at the table', searchEnabled: false,
  folderMap: { 'Characters/PCs': 'characters/pcs' }, attachmentsDir: 'Files', system: 'gurps-4e',
  excludeDirs: ['Secrets'], excludeSections: ['GM Notes'], excludeFields: ['secret'], excludeCallouts: ['gm'],
  sheet_crest: 'crest.png', landing: { hero: 'Hero.png' }, images: { Ada: 'ada.png' },
  banners: { Chapter: 'ch.png' }, locations: { Pier: 'pier.png' },
};

describe('migrate-config', () => {
  it('1: a full legacy site moves every key, strips the site file, and backs both up', () => {
    const originalVault = '---\ntype: meta\n---\n';
    const s = makeSite({ site: { ...FULL, host: 'cloudflare-pages', siteUrl: 'https://x.example', customThing: 1 }, vaultFile: originalVault });
    const originalSite = read(s.configPath);
    const { plan, result } = migrate(s);
    assert.strictEqual(plan.moves.length, MOVED_KEYS.length);
    const pub = publishOf(s.vaultFile);
    for (const k of MOVED_KEYS) assert.deepStrictEqual(pub[k.publish], FULL[k.json], k.json);
    const site = JSON.parse(read(s.configPath));
    assert.deepStrictEqual(Object.keys(site), ['vaultPath', 'outputDir', 'host', 'siteUrl', 'customThing']);
    assert.ok(Object.keys(site).every((k) => DEPLOY_KEYS.includes(k) || k === 'customThing'));
    assert.ok(read(s.configPath).endsWith('}\n'));
    assert.strictEqual(read(`${s.vaultFile}.pre-migrate`), originalVault);
    assert.strictEqual(read(`${s.configPath}.pre-migrate`), originalSite);
    assert.strictEqual(result.backups.length, 2);
  });

  it('2: a dry run writes nothing and its --json is what apply then does', () => {
    const s = makeSite({ site: { siteTitle: 'T', excludeDirs: ['Secrets'], backend: { inbox: true } } });
    const before = [read(s.configPath), read(s.vaultFile)];
    const dry = cli(['--dry-run', '--json', '--config', s.configPath]);
    assert.strictEqual(dry.status, 0, dry.stderr);
    assert.deepStrictEqual([read(s.configPath), read(s.vaultFile)], before);
    assert.ok(!fs.existsSync(`${s.configPath}.pre-migrate`));
    const { lines: plannedLines, noteLines: plannedNotes, ...planned } = JSON.parse(dry.stdout);
    const real = cli(['--json', '--config', s.configPath]);
    assert.strictEqual(real.status, 0, real.stderr);
    const { backups, keptBackups, lines: appliedLines, noteLines: appliedNotes, ...applied } = JSON.parse(real.stdout);
    assert.deepStrictEqual(applied, planned);
    assert.strictEqual(backups.length, 2);
    assert.deepStrictEqual(keptBackups, []);
    const pub = publishOf(s.vaultFile);
    for (const [k, v] of Object.entries(planned.vaultSet)) assert.deepStrictEqual(pub[k], v, k);
    const site = JSON.parse(read(s.configPath));
    for (const k of planned.siteRemove) assert.ok(!(k in site), k);
    assert.ok(!('backend' in pub));
  });

  it('2b: --json noteLines are the lines that are not changes', () => {
    const s = makeSite({ site: { siteTitle: 'T', excludeDirs: [null, 'Secrets'], customThing: 1 } });
    const r = cli(['--json', '--config', s.configPath]);
    assert.strictEqual(r.status, 0, r.stderr);
    const j = JSON.parse(r.stdout);
    assert.ok(j.noteLines.length >= 3, j.stdout);
    assert.ok(j.noteLines.every((l) => j.lines.includes(l)));
    const notes = j.lines.filter((l) => /^(left in |skipped |note |backup)/.test(l));
    assert.deepStrictEqual(j.noteLines, notes);
    assert.ok(j.lines.filter((l) => !j.noteLines.includes(l)).every((l) => /^(move|merge|switch|conflict) /.test(l)));
    const none = JSON.parse(cli(['--json', '--config', makeSite().configPath]).stdout);
    assert.deepStrictEqual(none.noteLines, []);
  });

  it('3: exclude lists merge, de-duplicated the way the reader compares them', () => {
    const s = makeSite({
      site: { excludeDirs: ['Secrets', 'drafts'] },
      vaultFile: '---\npublish:\n  exclude_dirs: [Drafts]\n---\n',
    });
    const { plan } = migrate(s);
    assert.deepStrictEqual(plan.merges, [{ to: 'publish.exclude_dirs', added: ['Secrets'] }]);
    assert.deepStrictEqual(publishOf(s.vaultFile).exclude_dirs, ['Drafts', 'Secrets']);
    const t = makeSite({
      site: { excludeDirs: ['secrets', 'Secrets/', './Secrets'] },
      vaultFile: '---\npublish:\n  exclude_dirs:\n    - Secrets\n---\n',
    });
    assert.deepStrictEqual(migrate(t).plan.merges, []);
    assert.deepStrictEqual(publishOf(t.vaultFile).exclude_dirs, ['Secrets']);
  });

  it('4: a conflict keeps the vault value, reports the pair, and still strips the site key', () => {
    const s = makeSite({ site: { siteTitle: 'Old' }, vaultFile: '---\npublish:\n  site_title: New\n---\n' });
    const { plan } = migrate(s);
    assert.deepStrictEqual(plan.conflicts, [{ key: 'siteTitle', kept: 'New', discarded: 'Old' }]);
    assert.strictEqual(publishOf(s.vaultFile).site_title, 'New');
    assert.ok(!('siteTitle' in JSON.parse(read(s.configPath))));
  });

  it('5: explicit old flags in the site file are copied as they are', () => {
    const s = makeSite({ site: { backend: { statusBar: true, inbox: false } } });
    const { plan } = migrate(s);
    assert.deepStrictEqual(plan.switches.map((x) => [x.to, x.value]), [['publish.live_stats', true], ['publish.inbox', false]]);
    const pub = publishOf(s.vaultFile);
    assert.strictEqual(pub.live_stats, true);
    assert.strictEqual(pub.inbox, false);
    assert.ok(!('backend' in JSON.parse(read(s.configPath))));
  });

  it('6: with no flags, a deployed inbox is detected and only true is written', () => {
    const s = makeSite({ site: { siteTitle: 'T' } });
    fs.mkdirSync(path.join(s.root, 'functions', 'api'), { recursive: true });
    fs.writeFileSync(path.join(s.root, 'functions', 'api', 'request.js'), '// fn');
    fs.writeFileSync(path.join(s.root, 'wrangler.toml'), KV_TOML);
    const { plan } = migrate(s);
    assert.deepStrictEqual(plan.switches, [{ to: 'publish.inbox', value: true, from: 'detected' }]);
    const pub = publishOf(s.vaultFile);
    assert.strictEqual(pub.inbox, true);
    assert.ok(!('live_stats' in pub));
  });

  it('6b: detection runs once: a removed switch stays removed, and a migrated site is not probed', () => {
    const wire = (s) => {
      fs.mkdirSync(path.join(s.root, 'functions', 'api'), { recursive: true });
      fs.writeFileSync(path.join(s.root, 'functions', 'api', 'request.js'), '// fn');
      fs.writeFileSync(path.join(s.root, 'wrangler.toml'), KV_TOML);
    };
    const s = makeSite({ site: { landingTagline: 'Hi' } });
    wire(s);
    migrate(s);
    assert.strictEqual(publishOf(s.vaultFile).inbox, true);
    fs.writeFileSync(s.vaultFile, read(s.vaultFile).replace(/\n  inbox: true/, ''));
    assert.ok(!('inbox' in publishOf(s.vaultFile)));
    const again = migrate(s).plan;
    assert.deepStrictEqual([again.moves, again.switches, again.vaultSet], [[], [], {}]);
    assert.ok(!('inbox' in publishOf(s.vaultFile)));
    const t = makeSite();
    wire(t);
    assert.deepStrictEqual(migrate(t).plan.switches, []);
    assert.ok(!('inbox' in (publishOf(t.vaultFile) || {})));
  });

  it('7: with no flags and no backend, neither switch is written', () => {
    const s = makeSite({ site: { siteTitle: 'T' } });
    migrate(s);
    const pub = publishOf(s.vaultFile);
    assert.ok(!('live_stats' in pub) && !('inbox' in pub));
    assert.ok(!('character_sheets' in pub));
  });

  it('8: publish.backend.inbox in the vault file becomes publish.inbox', () => {
    const s = makeSite({ vaultFile: '---\npublish:\n  backend:\n    inbox: true\n---\n' });
    const plan = planMigration({ vaultPath: s.vault });
    assert.deepStrictEqual(plan.switches, [{ to: 'publish.inbox', value: true, from: 'backend.inbox' }]);
    applyMigration(plan, { vaultPath: s.vault });
    const pub = publishOf(s.vaultFile);
    assert.strictEqual(pub.inbox, true);
    assert.ok(!('backend' in pub));
  });

  it('9: a second run plans nothing, changes nothing and writes no backup', () => {
    const s = makeSite({ site: { ...FULL, backend: { inbox: true } } });
    migrate(s);
    const files = [s.configPath, s.vaultFile, `${s.configPath}.pre-migrate`, `${s.vaultFile}.pre-migrate`];
    const before = files.map(read);
    const listing = fs.readdirSync(s.root).concat(fs.readdirSync(path.dirname(s.vaultFile)));
    const { plan, result } = migrate(s);
    for (const k of ['moves', 'merges', 'switches', 'conflicts', 'vaultRemove', 'siteRemove']) assert.deepStrictEqual(plan[k], [], k);
    assert.strictEqual(plan.applicable, false);
    assert.deepStrictEqual(files.map(read), before);
    assert.deepStrictEqual(result.backups, []);
    assert.deepStrictEqual(fs.readdirSync(s.root).concat(fs.readdirSync(path.dirname(s.vaultFile))), listing);
  });

  it('10: two sites, one vault: the vault value stands, the second site is merged and stripped', () => {
    const a = makeSite({ site: { siteTitle: 'A title', excludeDirs: ['Secrets'] } });
    const b = makeSite({ site: { siteTitle: 'B title', excludeDirs: ['Secrets', 'Extra'] }, vaultFile: null });
    fs.writeFileSync(b.configPath, JSON.stringify({ vaultPath: a.vault, siteTitle: 'B title', excludeDirs: ['Secrets', 'Extra'] }));
    migrate(a);
    const afterA = publishOf(a.vaultFile);
    assert.strictEqual(afterA.site_title, 'A title');
    const { plan } = migrate(b);
    assert.deepStrictEqual(plan.conflicts, [{ key: 'siteTitle', kept: 'A title', discarded: 'B title' }]);
    assert.deepStrictEqual(plan.merges, [{ to: 'publish.exclude_dirs', added: ['Extra'] }]);
    const pub = publishOf(a.vaultFile);
    assert.strictEqual(pub.site_title, 'A title');
    assert.deepStrictEqual(pub.exclude_dirs, ['Secrets', 'Extra']);
    assert.deepStrictEqual(JSON.parse(read(b.configPath)), { vaultPath: a.vault });
  });

  it('11: a vault file the editor refuses: exit 1, one stderr line, nothing written', () => {
    const vaultFile = '---\npublish: { mode: player }\n---\n';
    const s = makeSite({ site: { siteTitle: 'T' }, vaultFile });
    const siteBefore = read(s.configPath);
    const r = cli(['--config', s.configPath]);
    assert.strictEqual(r.status, 1);
    const lines = r.stderr.trim().split('\n');
    assert.strictEqual(lines.length, 1, r.stderr);
    assert.ok(lines[0].includes('_meta/vault-config.md'), lines[0]);
    assert.strictEqual(read(s.configPath), siteBefore);
    assert.strictEqual(read(s.vaultFile), vaultFile);
    assert.ok(!fs.existsSync(`${s.configPath}.pre-migrate`) && !fs.existsSync(`${s.vaultFile}.pre-migrate`));
  });

  it('12: a vault.config.json that is not JSON: exit 1, nothing written', () => {
    const s = makeSite();
    fs.writeFileSync(s.configPath, '{ "siteTitle": ');
    const vaultBefore = read(s.vaultFile);
    const r = cli(['--config', s.configPath]);
    assert.strictEqual(r.status, 1);
    assert.strictEqual(r.stderr.trim().split('\n').length, 1, r.stderr);
    assert.strictEqual(read(s.configPath), '{ "siteTitle": ');
    assert.strictEqual(read(s.vaultFile), vaultBefore);
    assert.ok(!fs.existsSync(`${s.configPath}.pre-migrate`));
  });

  it('13: no vault file at all: it is created with type: meta and the moved keys', () => {
    const s = makeSite({ site: { siteTitle: 'T', excludeDirs: ['Secrets'] }, vaultFile: null });
    const { result } = migrate(s);
    const data = parseNote(read(s.vaultFile)).data;
    assert.strictEqual(data.type, 'meta');
    assert.deepStrictEqual(data.publish, { site_title: 'T', exclude_dirs: ['Secrets'] });
    assert.deepStrictEqual(result.backups, [`${s.configPath}.pre-migrate`]);
  });

  it('14: comments and unrelated keys in the vault file survive byte for byte', () => {
    const s = makeSite({
      site: { siteTitle: 'Old', footer: 'F' },
      vaultFile: '---\n# keep me\ntype: meta   # trailing\npublish:\n  # about mode\n  mode: player\n  site_title: New\n---\n\nBody text\n',
    });
    migrate(s);
    assert.strictEqual(
      read(s.vaultFile),
      '---\n# keep me\ntype: meta   # trailing\npublish:\n  # about mode\n  mode: player\n  site_title: New\n  footer: F\n---\n\nBody text\n',
    );
  });

  it('15: --vault only, no site: just the backend rename is planned', () => {
    const s = makeSite({ vaultFile: '---\npublish:\n  mode: player\n  backend:\n    statusBar: true\n    inbox: false\n---\n' });
    const plan = planMigration({ vaultPath: s.vault });
    assert.deepStrictEqual(plan.moves, []);
    assert.deepStrictEqual(plan.siteRemove, []);
    assert.deepStrictEqual(plan.vaultRemove, ['backend']);
    assert.deepStrictEqual(plan.vaultSet, { live_stats: true, inbox: false });
    const r = cli(['--vault', s.vault], s.root.replace(/\/[^/]*$/, ''));
    assert.strictEqual(r.status, 0, r.stderr);
    assert.deepStrictEqual(publishOf(s.vaultFile), { mode: 'player', live_stats: true, inbox: false });
    assert.ok(fs.existsSync(`${s.vaultFile}.pre-migrate`));
  });

  // Builds a fixture site twice, before and after migrating it; returns both docs trees.
  function buildBeforeAndAfter({ vaultYaml, site, pcAppend = '' }) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-migrate-build-'));
    roots.push(root);
    const vault = path.join(root, 'vault');
    fs.cpSync(FIXTURE, vault, { recursive: true });
    if (pcAppend) fs.appendFileSync(path.join(vault, 'Characters', 'PCs', 'Karl Brenner.md'), pcAppend);
    fs.writeFileSync(path.join(vault, '_meta', 'vault-config.md'), vaultYaml);
    const configPath = path.join(root, 'vault.config.json');
    fs.writeFileSync(configPath, JSON.stringify({ vaultPath: './vault', outputDir: './docs', ...site }, null, 2));
    const run = () => {
      const lines = [];
      const real = { warn: console.warn, log: console.log };
      console.warn = (...a) => lines.push(a.join(' '));
      console.log = (...a) => lines.push(a.join(' '));
      try { build({ configPath }); } finally { Object.assign(console, real); }
      return lines;
    };
    const tree = (dir) => {
      const out = {};
      const walk = (d) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const p = path.join(d, e.name);
          if (e.isDirectory()) walk(p); else out[path.relative(dir, p)] = p;
        }
      };
      walk(dir);
      return out;
    };
    const first = run();
    fs.renameSync(path.join(root, 'docs'), path.join(root, 'docs-before'));
    migrate({ configPath });
    const second = run();
    return { root, first, second, a: tree(path.join(root, 'docs-before')), b: tree(path.join(root, 'docs')) };
  }

  it('16: before and after a migration the built HTML is byte-identical and the warning is gone', () => {
    const { first, second, a, b } = buildBeforeAndAfter({
      vaultYaml: '---\ntype: meta\npublish:\n  mode: player\n---\n',
      site: {
        siteTitle: 'Migrated Site', footer: 'Foot',
        system: 'gurps-4e', folderMap: { 'Characters/PCs': 'characters/pcs' }, excludeDirs: ['Nowhere'],
      },
    });
    assert.ok(first.some((l) => l.includes('vault.config.json still holds campaign settings')), first.join('\n'));
    assert.ok(!second.some((l) => l.includes('still holds campaign settings')), second.join('\n'));
    assert.deepStrictEqual(Object.keys(b).sort(), Object.keys(a).sort());
    const html = Object.keys(a).filter((f) => f.endsWith('.html'));
    assert.ok(html.length > 3);
    for (const f of html) assert.ok(read(a[f]) === read(b[f]), `${f} differs`);
  });

  it('16a: a second build in the same process reads the config file again', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-reread-'));
    roots.push(root);
    const vault = path.join(root, 'vault');
    fs.cpSync(FIXTURE, vault, { recursive: true });
    fs.writeFileSync(path.join(vault, '_meta', 'vault-config.md'), '---\ntype: meta\npublish:\n  mode: player\n---\n');
    const configPath = path.join(root, 'vault.config.json');
    const write = (extra) => fs.writeFileSync(configPath, JSON.stringify({ vaultPath: './vault', outputDir: './docs', ...extra }));
    const run = () => {
      const lines = [];
      const real = { warn: console.warn, log: console.log };
      console.warn = (...a) => lines.push(a.join(' '));
      console.log = (...a) => lines.push(a.join(' '));
      try { build({ configPath }); } finally { Object.assign(console, real); }
      return lines;
    };
    write({ siteTitle: 'First Title', footer: 'Foot', system: 'gurps-4e' });
    const first = run();
    assert.ok(first.some((l) => l.includes('still holds campaign settings')), first.join('\n'));
    assert.ok(read(path.join(root, 'docs', 'index.html')).includes('First Title'));
    write({});
    const second = run();
    assert.ok(!second.some((l) => l.includes('still holds campaign settings')), second.join('\n'));
    assert.ok(!read(path.join(root, 'docs', 'index.html')).includes('First Title'));
  });

  it('16c: an invalid vault.config.json fails with one line naming the file', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-badjson-'));
    roots.push(root);
    const configPath = path.join(root, 'vault.config.json');
    fs.writeFileSync(configPath, '{ nope');
    assert.throws(() => build({ configPath }), (e) => e.message.startsWith(`${configPath} could not be read as JSON:`) && !e.message.includes('\n'));
  });

  it('16b: a site-only exclude_sections entry hides the section before and after, byte-identical', () => {
    const { first, second, a, b } = buildBeforeAndAfter({
      vaultYaml: '---\ntype: meta\npublish:\n  mode: player\n  exclude_sections: [GM Notes]\n---\n',
      site: { system: 'gurps-4e', folderMap: { 'Characters/PCs': 'characters/pcs' }, excludeSections: ['Keeper Only'] },
      pcAppend: '\n## Keeper Only\n\nZorblatt the unspeakable.\n',
    });
    assert.ok(first.some((l) => l.includes('excludeSections entry "Keeper Only" is still applied')), first.join('\n'));
    assert.ok(!second.some((l) => l.includes('still holds campaign settings')), second.join('\n'));
    assert.deepStrictEqual(Object.keys(b).sort(), Object.keys(a).sort());
    for (const f of Object.keys(a)) {
      assert.ok(read(a[f]) === read(b[f]), `${f} differs`);
      assert.ok(!/Zorblatt/i.test(read(b[f])), `${f} leaks the withheld section`);
    }
  });

  it('names the site-file keys it leaves behind, without removing them', () => {
    const s = makeSite({ site: { siteTitle: 'T', campaignImage: 'a.png', fourOhFour: 'x', backend: { inbox: true } } });
    const { plan } = migrate(s);
    assert.deepStrictEqual(plan.leftover, ['campaignImage', 'fourOhFour']);
    // Applied above, so run a fresh site through the human output.
    const t = makeSite({ site: { siteTitle: 'T', campaignImage: 'a.png', fourOhFour: 'x' } });
    const out = [];
    runMigrateConfig({ configPath: t.configPath, dryRun: true }, { out: (l) => out.push(l) });
    assert.ok(out.includes('left in vault.config.json (not a setting this tool reads): campaignImage, fourOhFour'), out.join('\n'));
    const kept = JSON.parse(read(s.configPath));
    assert.strictEqual(kept.campaignImage, 'a.png');
    assert.strictEqual(kept.fourOhFour, 'x');
  });

  it('a site file with only deployment and moved keys has no leftover', () => {
    const s = makeSite({ site: { siteTitle: 'T', host: 'github-pages', landingTagline: 'Hi' } });
    assert.deepStrictEqual(planMigration({ configPath: s.configPath }).leftover, []);
  });

  it('a site list that is not a list is skipped, reported and left in the site file', () => {
    const s = makeSite({ site: { siteTitle: 'T', excludeDirs: 'Secrets' } });
    const { plan } = migrate(s);
    assert.strictEqual(plan.skipped.length, 1);
    assert.strictEqual(plan.skipped[0].key, 'excludeDirs');
    assert.strictEqual(publishOf(s.vaultFile).exclude_dirs, undefined);
    assert.strictEqual(JSON.parse(read(s.configPath)).excludeDirs, 'Secrets');
    const out = [];
    const t = makeSite({ site: { siteTitle: 'T', excludeDirs: 'Secrets' } });
    runMigrateConfig({ configPath: t.configPath, dryRun: true }, { out: (l) => out.push(l) });
    assert.ok(out.some((l) => l.startsWith('skipped publish.exclude_dirs:') && l.includes('is not a list') && l.includes('left in the site file')), out.join('\n'));
  });

  it('a site list of only unusable entries writes no empty list; the key stays in the site file', () => {
    const s = makeSite({ site: { excludeFields: [null, { a: 1 }] } });
    const { plan } = migrate(s);
    assert.strictEqual(publishOf(s.vaultFile)?.exclude_fields, undefined);
    assert.deepStrictEqual(JSON.parse(read(s.configPath)).excludeFields, [null, { a: 1 }]);
    assert.strictEqual(plan.skipped[0].key, 'excludeFields');
    assert.ok(plan.skipped[0].reason.includes('left in the site file'), plan.skipped[0].reason);
  });

  it('a site list with some usable entries still moves the usable ones', () => {
    const s = makeSite({ site: { excludeFields: ['secret', null] } });
    migrate(s);
    assert.deepStrictEqual(publishOf(s.vaultFile).exclude_fields, ['secret']);
  });

  it('a vault list key that is set but not a list refuses, naming the key', () => {
    for (const body of ['  exclude_dirs:\n', '  exclude_dirs: Secrets\n']) {
      const s = makeSite({ site: { excludeDirs: ['X'] }, vaultFile: `---\npublish:\n${body}---\n` });
      const plan = planMigration({ configPath: s.configPath });
      assert.strictEqual(plan.refused, true);
      assert.ok(plan.reason.includes('excludeDirs') && plan.reason.includes('exclude_dirs'), plan.reason);
      assert.ok(!fs.existsSync(`${s.configPath}.pre-migrate`));
    }
  });

  it('an unreadable explicit flag is reported and written as false', () => {
    const s = makeSite({ site: { backend: { inbox: 'maybe' } } });
    const { plan } = migrate(s);
    assert.ok(plan.notes.some((n) => n.includes('backend.inbox')));
    assert.strictEqual(publishOf(s.vaultFile).inbox, false);
  });

  it('an explicit true wins in the vault file before the site file, and an old word is accepted', () => {
    const s = makeSite({ site: { backend: { inbox: false } }, vaultFile: '---\npublish:\n  backend:\n    inbox: "yes"\n---\n' });
    migrate(s);
    assert.strictEqual(publishOf(s.vaultFile).inbox, true);
  });

  it('a relative vaultPath resolves against the config file, and landingTagline moves', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-migrate-rel-'));
    roots.push(root);
    fs.mkdirSync(path.join(root, 'site'));
    fs.mkdirSync(path.join(root, 'vault', '_meta'), { recursive: true });
    fs.writeFileSync(path.join(root, 'site', 'vault.config.json'), JSON.stringify({ vaultPath: '../vault', landingTagline: 'Into the dark' }));
    const r = cli(['--config', path.join(root, 'site', 'vault.config.json')], os.tmpdir());
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(publishOf(path.join(root, 'vault', '_meta', 'vault-config.md')).theme.tagline, 'Into the dark');
    assert.deepStrictEqual(JSON.parse(read(path.join(root, 'site', 'vault.config.json'))), { vaultPath: '../vault' });
  });

  it('an existing backup is never overwritten', () => {
    const s = makeSite({ site: { siteTitle: 'T' } });
    fs.writeFileSync(`${s.configPath}.pre-migrate`, 'older backup');
    const { result } = migrate(s);
    assert.strictEqual(read(`${s.configPath}.pre-migrate`), 'older backup');
    assert.ok(!result.backups.includes(`${s.configPath}.pre-migrate`));
  });

  it('human output is one line per move, merge, switch and conflict', () => {
    const s = makeSite({ site: { siteTitle: 'Old', footer: 'F', excludeDirs: ['A'], backend: { inbox: true } }, vaultFile: '---\npublish:\n  site_title: New\n  exclude_dirs: [B]\n---\n' });
    const lines = [];
    const rc = runMigrateConfig({ configPath: s.configPath, dryRun: true }, { out: (l) => lines.push(l) });
    assert.strictEqual(rc, 0);
    assert.deepStrictEqual(lines.filter((l) => /^(move|merge|switch|conflict) /.test(l)).length, 4);
    assert.ok(lines.includes('Dry run: nothing written.'));
  });

  it('a dropped switch is reported: two sites, one vault', () => {
    const a = makeSite({ site: { backend: { inbox: true } } });
    migrate(a);
    const b = makeSite({ site: {}, vaultFile: null });
    fs.writeFileSync(b.configPath, JSON.stringify({ vaultPath: a.vault, backend: { inbox: false, statusBar: true } }));
    const { plan } = migrate(b);
    assert.deepStrictEqual(plan.conflicts, [{ key: 'backend.inbox', kept: true, discarded: false }]);
    assert.deepStrictEqual(plan.switches.map((x) => x.to), ['publish.live_stats']);
    assert.strictEqual(publishOf(a.vaultFile).inbox, true);
    // Two explicit old flags that disagree: the first is kept, the other reported.
    const c = makeSite({ site: { backend: { statusBar: false } }, vaultFile: '---\npublish:\n  backend:\n    statusBar: true\n---\n' });
    assert.deepStrictEqual(migrate(c).plan.conflicts, [{ key: 'backend.statusBar', kept: true, discarded: false }]);
  });

  it('a kept earlier backup is reported, and a second site leaves it untouched', () => {
    const a = makeSite({ site: { siteTitle: 'A' } });
    migrate(a);
    const first = read(`${a.vaultFile}.pre-migrate`);
    const b = makeSite({ site: {}, vaultFile: null });
    fs.writeFileSync(b.configPath, JSON.stringify({ vaultPath: a.vault, footer: 'F' }));
    const lines = [];
    const rc = runMigrateConfig({ configPath: b.configPath }, { out: (l) => lines.push(l) });
    assert.strictEqual(rc, 0);
    assert.strictEqual(read(`${a.vaultFile}.pre-migrate`), first);
    assert.ok(lines.includes(`backup kept from an earlier run: ${a.vaultFile}.pre-migrate`), lines.join('\n'));
    assert.ok(lines.includes(`backup ${b.configPath}.pre-migrate`));
  });

  it('a theme block that gets a tagline carries a note saying its comments are lost', () => {
    const s = makeSite({ site: { landingTagline: 'Hi' }, vaultFile: '---\npublish:\n  theme:\n    # keep\n    genre: noir\n---\n' });
    const lines = [];
    runMigrateConfig({ configPath: s.configPath, dryRun: true }, { out: (l) => lines.push(l) });
    assert.ok(lines.includes('note publish.theme is rewritten; comments inside it are not kept'), lines.join('\n'));
    migrate(s);
    assert.deepStrictEqual(publishOf(s.vaultFile).theme, { genre: 'noir', tagline: 'Hi' });
    const t = makeSite({ site: { landingTagline: 'Hi' } });
    assert.deepStrictEqual(planMigration({ configPath: t.configPath }).notes, []);
  });

  it('list entries that are not text are skipped and reported, on a merge and on a whole move', () => {
    const s = makeSite({ site: { excludeDirs: [{ x: 1 }, null, '', 'A'], excludeFields: [null, 'f'] }, vaultFile: '---\npublish:\n  exclude_dirs: [B]\n---\n' });
    const lines = [];
    const plan = planMigration({ configPath: s.configPath });
    assert.deepStrictEqual(plan.merges, [{ to: 'publish.exclude_dirs', added: ['A'], skipped: [{ x: 1 }, null, ''] }]);
    assert.deepStrictEqual(plan.moves[0].value, ['f']);
    assert.deepStrictEqual(plan.moves[0].skipped, [null]);
    runMigrateConfig({ configPath: s.configPath }, { out: (l) => lines.push(l) });
    assert.strictEqual(lines.filter((l) => l.startsWith('skipped ')).length, 2, lines.join('\n'));
    const pub = publishOf(s.vaultFile);
    assert.deepStrictEqual(pub.exclude_dirs, ['B', 'A']);
    assert.deepStrictEqual(pub.exclude_fields, ['f']);
  });

  // The list the reader resolves for a site, before and after the migration.
  const resolvedLists = (s) => {
    const cfg = JSON.parse(read(s.configPath));
    const p = loadPublishConfig(s.vault, cfg, () => {});
    return { exclude_dirs: p.exclude_dirs.map(String), exclude_sections: p.exclude_sections.map(String), exclude_fields: p.exclude_fields.map(String) };
  };

  it('I1: the resolved exclude lists are the same before and after a migration, for entries that are not plain text', () => {
    const vectors = [[2024, '_meta'], [true, 'X'], [null, 'X'], [{ a: 1 }], [2024, null, 'Y', '']];
    for (const list of vectors) {
      const s = makeSite({ site: { excludeDirs: list, excludeSections: list, excludeFields: list } });
      const before = resolvedLists(s);
      migrate(s);
      const after = resolvedLists(s);
      for (const k of Object.keys(before)) assert.deepStrictEqual([...after[k]].sort(), [...before[k]].sort(), `${JSON.stringify(list)} ${k}`);
    }
    const s = makeSite({ site: { excludeDirs: [2024, '_meta'] } });
    migrate(s);
    assert.deepStrictEqual(publishOf(s.vaultFile).exclude_dirs, ['2024', '_meta']);
  });

  it('I1: skipped entries stay in the site file, the line says so, and a second run changes nothing', () => {
    const s = makeSite({ site: { excludeSections: [null, 'X'] } });
    const lines = [];
    runMigrateConfig({ configPath: s.configPath }, { out: (l) => lines.push(l) });
    assert.deepStrictEqual(JSON.parse(read(s.configPath)).excludeSections, [null]);
    assert.deepStrictEqual(publishOf(s.vaultFile).exclude_sections, ['X']);
    assert.ok(lines.some((l) => l.startsWith('skipped publish.exclude_sections:') && l.includes('left in vault.config.json')), lines.join('\n'));
    const again = planMigration({ configPath: s.configPath });
    assert.strictEqual(again.applicable, false);
  });

  it('I1: a build before and after migrating a list with a number in it is byte-identical', () => {
    const { a, b } = buildBeforeAndAfter({
      vaultYaml: '---\ntype: meta\npublish:\n  mode: player\n---\n',
      site: { excludeDirs: [2024, 'Nowhere'], excludeSections: [true, 'Keeper Only'] },
    });
    assert.deepStrictEqual(Object.keys(a).sort(), Object.keys(b).sort());
    for (const k of Object.keys(a)) assert.strictEqual(fs.readFileSync(a[k]).equals(fs.readFileSync(b[k])), true, k);
  });

  it('maps: sub-keys the vault map lacks move in, a sub-key both set keeps the vault value and reports the other', () => {
    const s = makeSite({
      site: { landing: { max_npcs: 5, max_locations: 9 }, images: { optimize: true }, banners: { a: 'x' } },
      vaultFile: '---\npublish:\n  landing:\n    # keep me\n    max_npcs: 2\n  banners:\n---\n',
    });
    const lines = [];
    runMigrateConfig({ configPath: s.configPath }, { out: (l) => lines.push(l) });
    const pub = publishOf(s.vaultFile);
    assert.deepStrictEqual(pub.landing, { max_npcs: 2, max_locations: 9 });
    assert.deepStrictEqual(pub.images, { optimize: true });
    assert.deepStrictEqual(pub.banners, { a: 'x' });
    assert.ok(lines.some((l) => l.startsWith('merge publish.landing: added "max_locations"')), lines.join('\n'));
    assert.ok(lines.some((l) => l.startsWith('conflict landing.max_npcs: kept 2') && l.includes('discarded 5')), lines.join('\n'));
    assert.ok(lines.includes('note publish.landing is rewritten; comments inside it are not kept'), lines.join('\n'));
    assert.deepStrictEqual(JSON.parse(read(s.configPath)), { vaultPath: s.vault, outputDir: './docs' });
  });

  it('maps: the resolved landing, images, banners and locations are the same before and after a migration', () => {
    const site = { landing: { max_npcs: 5, max_locations: 9 }, images: { optimize: true, quality: 70 }, banners: { a: 'x', b: 'y' }, locations: { group_by: 'kind' } };
    const s = makeSite({ site, vaultFile: '---\npublish:\n  landing:\n    max_npcs: 2\n  banners:\n    a: z\n---\n' });
    const pick = () => { const p = loadPublishConfig(s.vault, JSON.parse(read(s.configPath)), () => {}); return { l: p.landing, i: p.images, b: p.banners, x: p.locations }; };
    const before = pick();
    migrate(s);
    assert.deepStrictEqual(pick(), before);
  });

  it('every rewritten list or map in the vault file carries a comments note', () => {
    const s = makeSite({ site: { excludeDirs: ['Secrets'] }, vaultFile: '---\npublish:\n  exclude_dirs: [Drafts] # mine\n---\n' });
    const lines = [];
    runMigrateConfig({ configPath: s.configPath, dryRun: true }, { out: (l) => lines.push(l) });
    assert.ok(lines.includes('note publish.exclude_dirs is rewritten; comments inside it are not kept'), lines.join('\n'));
  });

  it('I2: exclude_callouts moves the stricter of the two values and reports it', () => {
    const cases = [
      [false, true, true], [['gm'], true, true], [true, ['gm'], true], [false, ['gm'], ['gm']],
      [['gm'], ['GM', 'secret'], ['gm', 'secret']], [['gm'], false, ['gm']], [null, true, true],
    ];
    for (const [vault, site, want] of cases) {
      const v = vault === null ? 'null' : JSON.stringify(vault);
      const s = makeSite({ site: { excludeCallouts: site }, vaultFile: `---\npublish:\n  exclude_callouts: ${v}\n---\n` });
      const lines = [];
      runMigrateConfig({ configPath: s.configPath }, { out: (l) => lines.push(l) });
      assert.deepStrictEqual(publishOf(s.vaultFile).exclude_callouts, want, `${v} + ${JSON.stringify(site)}`);
      assert.ok(!('excludeCallouts' in JSON.parse(read(s.configPath))));
      if (JSON.stringify(want) !== v) assert.ok(lines.some((l) => l.includes('publish.exclude_callouts')), lines.join('\n'));
    }
  });

  it('I2: two sites sharing one vault: the second site\'s true is not lost behind the first site\'s false', () => {
    const a = makeSite({ site: { excludeCallouts: false } });
    migrate(a);
    assert.strictEqual(publishOf(a.vaultFile).exclude_callouts, false);
    const bConfig = path.join(a.root, 'siteB.json');
    fs.writeFileSync(bConfig, JSON.stringify({ vaultPath: a.vault, outputDir: './docsB', excludeCallouts: true }));
    const plan = planMigration({ configPath: bConfig });
    applyMigration(plan, { configPath: bConfig });
    assert.strictEqual(publishOf(a.vaultFile).exclude_callouts, true);
  });

  it('the site file keeps its mode, and a symlinked config is written through', () => {
    const s = makeSite({ site: { siteTitle: 'T' } });
    fs.chmodSync(s.configPath, 0o640);
    migrate(s);
    // POSIX permission bits do not exist on Windows.
    if (process.platform !== 'win32') assert.strictEqual(fs.statSync(s.configPath).mode & 0o777, 0o640);
    const t = makeSite({ site: {} });
    const real = path.join(t.root, 'real.json');
    fs.writeFileSync(real, JSON.stringify({ vaultPath: t.vault, siteTitle: 'T' }));
    fs.rmSync(t.configPath);
    try { fs.symlinkSync(real, t.configPath); } catch (e) { return; }
    migrate(t);
    assert.ok(fs.lstatSync(t.configPath).isSymbolicLink());
    assert.deepStrictEqual(JSON.parse(read(real)), { vaultPath: t.vault });
  });

  it('a failed site write after the vault write names both files and both backups', () => {
    const s = makeSite({ site: { siteTitle: 'T' } });
    const plan = planMigration({ configPath: s.configPath });
    const siteBefore = read(s.configPath);
    assert.throws(
      () => applyMigration(plan, { configPath: s.configPath }, { writeSite: () => { throw new Error('disk full'); } }),
      (e) => [s.vaultFile, s.configPath, `${s.vaultFile}.pre-migrate`, `${s.configPath}.pre-migrate`, 'disk full'].every((x) => e.message.includes(x)),
    );
    assert.strictEqual(publishOf(s.vaultFile).site_title, 'T');
    assert.strictEqual(read(s.configPath), siteBefore);
    assert.strictEqual(read(`${s.configPath}.pre-migrate`), siteBefore);
  });

  it('--json carries `lines`, the exact lines the human run prints', () => {
    const files = () => {
      const s = makeSite({
        site: { siteTitle: 'Old', footer: 'F', excludeDirs: ['A', 1], excludeFields: [null, 'f'], landingTagline: 'Hi', backend: { inbox: 'maybe' } },
        vaultFile: '---\npublish:\n  site_title: New\n  exclude_dirs: [B]\n  theme:\n    genre: noir\n---\n',
      });
      return s;
    };
    const humanLines = (args, dryRun) => {
      const out = [];
      runMigrateConfig({ ...args, dryRun }, { out: (l) => out.push(l) });
      return out.filter((l) => l !== 'Dry run: nothing written.');
    };
    const jsonLines = (args, dryRun) => {
      const out = [];
      runMigrateConfig({ ...args, dryRun, json: true }, { out: (l) => out.push(l) });
      return JSON.parse(out.join('\n')).lines;
    };
    const a = files();
    const dry = humanLines({ configPath: a.configPath }, true);
    assert.deepStrictEqual(jsonLines({ configPath: a.configPath }, true), dry);
    for (const kind of ['skipped ', 'conflict ', 'note ']) assert.ok(dry.some((l) => l.startsWith(kind)), `${kind}: ${dry.join('\n')}`);
    // A real run: the backups it wrote and the one it kept are lines too.
    const seeded = () => {
      const t = files();
      fs.writeFileSync(`${t.vaultFile}.pre-migrate`, 'older backup');
      return t;
    };
    const h = seeded();
    const j = seeded();
    const human = humanLines({ configPath: h.configPath }, false);
    const json = jsonLines({ configPath: j.configPath }, false);
    assert.ok(human.some((l) => l.startsWith('backup ')), human.join('\n'));
    assert.ok(human.some((l) => l.startsWith('backup kept from an earlier run: ')), human.join('\n'));
    assert.deepStrictEqual(json.map((l) => l.replace(j.root, 'ROOT')), human.map((l) => l.replace(h.root, 'ROOT')));
  });
});

'use strict';
// Small checks that each need a few lines: the release version, the Cloudflare guide, the init scaffolds, the party board registry and a few sheet details.
// Each block below was a test file of its own; the blocks keep their own imports and helpers.

// ---- dnd-live-conditions.test.js -------------------------------------------------------------------------
{
const { test } = require('node:test');
const assert = require('node:assert');
const { CONDITIONS } = require('../js/dnd-live.js');
const { STANDARD_CONDITIONS } = require('../lib/templates/dnd/live-data');

// The browser cannot import the build's list, so each side holds its own copy.
test('the conditions the drawer offers are the ones the build knows', () => {
  assert.equal(CONDITIONS.length, 14);
  assert.deepEqual(CONDITIONS, STANDARD_CONDITIONS);
});
}

// ---- cloudflare-doc-branch.test.js -----------------------------------------------------------------------
{
// CodeRabbit: the by-hand wrangler deploy in the Cloudflare guide must send to main, as gm-publish deploy does.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('every by-hand `npx wrangler@4 pages deploy` command in the Cloudflare guide names --branch=main', () => {
  const doc = fs.readFileSync(path.join(__dirname, '../../../skills/publish-site/references/cloudflare-pages.md'), 'utf8');
  const lines = doc.split('\n').filter((l) => /^npx wrangler@4 pages deploy\b/.test(l));
  assert.ok(lines.length >= 2, 'expected the two by-hand deploy commands');
  for (const l of lines) assert.match(l, /--branch=main/, l);
});
}

// ---- package-version.test.js -----------------------------------------------------------------------------
{
// The release tag (publish-vX.Y.Z) is taken from package.json, so a bump that reaches only package-lock.json
// ships no release: 1.10.78 did that, and publish-v1.37.0 was never tagged.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

test('package.json and package-lock.json carry the same version', () => {
  const pkg = require(path.join(__dirname, '..', 'package.json'));
  const lock = require(path.join(__dirname, '..', 'package-lock.json'));
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
});
}

// ---- equipment-block.test.js -----------------------------------------------------------------------------
{
const { test } = require('node:test');
const assert = require('node:assert');
const { renderEquipment } = require('../lib/templates/gurps/blocks/equipment');

test('main items get checked toggles; loadout items get unchecked toggles', () => {
  const model = { equipment: {
    items: [{ qty: '1', name: 'Vibro-axe', cost: '$500', weight: '4 lbs' }],
    loadouts: [{ name: 'Transit', items: [{ qty: '1', name: 'Hand thruster', cost: '$50', weight: '4 lbs' }] }],
  } };
  const html = renderEquipment(model);
  assert.match(html, /class="eq-toggle"[^>]*data-item-key="Vibro-axe"[^>]*data-weight="4"[^>]*checked/);
  assert.match(html, /data-item-key="Hand thruster"[^>]*data-weight="4"/);
  // loadout toggle is NOT checked
  assert.doesNotMatch(html, /data-item-key="Hand thruster"[^>]*checked/);
});
}

// ---- gurps-equipment-newline.test.js ---------------------------------------------------------------------
{
// A GURPS PC with no sheet and an Equipment table: the Equipment tab gets the table's notes on
// rows appended, and nothing at all, not even a newline, when there are none (#348).
const { test } = require('node:test');
const assert = require('node:assert');
const { renderGURPSSheet } = require('../lib/templates/gurps');

const EQUIPMENT = (extra) => ({
  title: 'Equipment',
  html: `<table><thead><tr><th>Item</th><th>Qty</th></tr></thead><tbody><tr><td>Rope</td><td>1</td>${extra}</tr></tbody></table>`,
});

test('no notes on rows: the Equipment tab ends where its markup ends', () => {
  const out = renderGURPSSheet({}, [EQUIPMENT('')], null);
  assert.ok(!out.sheetHtml, 'the fixture has no sheet');
  assert.ok(out.equipmentHtml, 'the fixture has an equipment tab');
  assert.ok(!out.equipmentHtml.endsWith('\n'), JSON.stringify(out.equipmentHtml.slice(-20)));
});

test('a cell beyond the header is still listed on the Equipment tab', () => {
  const html = EQUIPMENT('<td>ZZNOTE</td>').html.replace('<th>Qty</th>', '<th>Qty</th><th data-widened="1"></th>');
  const out = renderGURPSSheet({}, [{ title: 'Equipment', html }], null);
  assert.ok(out.equipmentHtml.includes('ZZNOTE'));
});
}

// ---- init-no-settings-file.test.js -----------------------------------------------------------------------
{
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const BIN = path.join(__dirname, '..', 'bin', 'gm-publish.js');

// `init` writes its own deployment-only vault.config.json, so it can never meet a site file that still holds
// a vault's settings: it makes the vault's new settings file instead. The refusal that names `settings move`
// belongs to the commands that read an existing site folder (setup-inbox and the rest).
test('init on a vault with no settings file makes the new file and says nothing about moving', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'init-nosettings-'));
  const vault = path.join(root, 'vault');
  fs.mkdirSync(path.join(vault, '_meta'), { recursive: true });
  const run = spawnSync(process.execPath, [BIN, 'init', path.join(root, 'site'), '--vault', vault, '--title', 'Hollow'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.ok(fs.existsSync(path.join(vault, '_meta', 'vault-config.yaml')));
  assert.ok(!fs.existsSync(path.join(vault, '_meta', 'vault-config.md')));
  assert.ok(!/settings move|run the update/.test(run.stdout + run.stderr));
  assert.match(run.stdout, /wrote .* to _meta\/vault-config\.yaml/);
});
}

// ---- init-inbox.test.js ----------------------------------------------------------------------------------
{
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { init } = require('../lib/init.js');

test('init scaffolds a Tier-1 wrangler.toml with no KV binding and no Functions', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tier1-init-'));
  await fs.mkdir(path.join(dir, 'vault')); // so init has a vault to put the campaign settings in
  await init(dir, { siteTitle: 'Dead End', toolDep: 'file:../tool' });

  // wrangler.toml: keeps the deploy config, drops the inbox KV binding.
  const wrangler = await fs.readFile(path.join(dir, 'wrangler.toml'), 'utf8');
  assert.match(wrangler, /pages_build_output_dir = "docs"/);
  assert.match(wrangler, /dead-end/);                 // {{PACKAGE_NAME}} substituted
  assert.doesNotMatch(wrangler, /\[\[kv_namespaces\]\]/);
  assert.doesNotMatch(wrangler, /binding = "INBOX"/);
  assert.doesNotMatch(wrangler, /PUT-YOUR-KV-NAMESPACE-ID-HERE/);

  // Tier-1 ships no Functions.
  await assert.rejects(fs.access(path.join(dir, 'functions')), /ENOENT/);

  // The local build config is gitignored (it holds an absolute vaultPath).
  const gitignore = await fs.readFile(path.join(dir, '.gitignore'), 'utf8');
  assert.match(gitignore, /^vault\.config\.json$/m);
});
}

// ---- party-board-registry.test.js ------------------------------------------------------------------------
{
const { test } = require('node:test');
const assert = require('node:assert');
const { boardFor } = require('../lib/party-board-registry');
const { buildPartyManifest } = require('../lib/party-manifest');
const { buildCoCPartyManifest } = require('../lib/templates/coc/party-board');

test('boardFor maps GURPS aliases to the GURPS skin', () => {
  for (const s of ['gurps', 'gurps-4e', 'GURPS-4e']) {
    const b = boardFor(s);
    assert.equal(b.scriptId, 'gurps-party-data');
    assert.deepEqual(b.clientScripts, ['party-core.js', 'gurps-live.js', 'gurps-party.js']);
    assert.equal(b.buildManifest, buildPartyManifest);
  }
});

test('boardFor maps CoC / Regency aliases to the CoC skin', () => {
  for (const s of ['coc', 'coc-7e', 'regency-cthulhu', 'coc-7e-regency']) {
    const b = boardFor(s);
    assert.equal(b.scriptId, 'coc-party-data');
    assert.deepEqual(b.clientScripts, ['party-core.js', 'coc-party.js']);
    assert.equal(b.buildManifest, buildCoCPartyManifest);
  }
});

test('boardFor returns null for unknown/absent systems', () => {
  assert.equal(boardFor('pf2e'), null);
  assert.equal(boardFor(null), null);
  assert.equal(boardFor(undefined), null);
});
}

// ---- settings-campaign-default.test.js -------------------------------------------------------------------
{
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readSettings } = require('../lib/settings/read');

// Unset, the campaign is the vault folder's name, with the origin `default`, on every layout.
test('vault.campaign unset reads as the vault folder\'s name on the old file, the new file and with no file', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'campaign-default-'));
  const make = (name, file, text) => {
    const vault = path.join(root, name);
    fs.mkdirSync(path.join(vault, '_meta'), { recursive: true });
    if (file) fs.writeFileSync(path.join(vault, '_meta', file), text);
    return vault;
  };
  const cases = [
    make('Old Hollow', 'vault-config.md', '---\ntype: meta\npublish:\n  site_title: T\n---\n'),
    make('New Hollow', 'vault-config.yaml', 'version: 1\n'),
    make('Bare Hollow', null),
  ];
  for (const vault of cases) {
    const r = readSettings({ vaultPath: vault });
    assert.equal(r.values.vault.campaign, path.basename(vault), vault);
    assert.equal(r.origins['vault.campaign'], 'default', vault);
  }
  const named = make('Named', 'vault-config.yaml', 'version: 1\nvault:\n  campaign: The Hollow\n');
  assert.equal(readSettings({ vaultPath: named }).values.vault.campaign, 'The Hollow');
});
}

// ---- live-mount.test.js ----------------------------------------------------------------------------------
{
const { test } = require('node:test');
const assert = require('node:assert');
const lm = require('../lib/templates/live-mount');

test('clientFor maps GURPS and CoC system ids to their clients', () => {
  assert.deepEqual(lm.clientFor('gurps-4e'), { script: 'gurps-live.js', domId: 'gurps-live-data' });
  assert.deepEqual(lm.clientFor('gurps'), { script: 'gurps-live.js', domId: 'gurps-live-data' });
  assert.deepEqual(lm.clientFor('coc-7e'), { script: 'coc-live.js', domId: 'coc-live-data' });
  assert.deepEqual(lm.clientFor('regency-cthulhu'), { script: 'coc-live.js', domId: 'coc-live-data' });
  assert.deepEqual(lm.clientFor('coc-7e-regency'), { script: 'coc-live.js', domId: 'coc-live-data' });
});

test('clientFor is case-insensitive and null for unknown systems', () => {
  assert.deepEqual(lm.clientFor('CoC-7e'), { script: 'coc-live.js', domId: 'coc-live-data' });
  assert.deepEqual(lm.clientFor('dnd-5e'), { script: 'dnd-live.js', domId: 'dnd-live-data' });
  assert.equal(lm.clientFor('pf2e'), null);
  assert.equal(lm.clientFor(null), null);
});

test('liveScriptHrefs orders live-state before the system client', () => {
  assert.deepEqual(lm.liveScriptHrefs('../', 'coc-7e'), ['../js/live-state.js', '../js/coc-live.js']);
});

test('liveScriptHrefs is empty for a system without a live client', () => {
  assert.deepEqual(lm.liveScriptHrefs('../', 'dnd-5e'), ['../js/live-state.js', '../js/dnd-live.js']);
  assert.deepEqual(lm.liveScriptHrefs('../', 'pf2e'), []);
});
}

// ---- site-doctor-story-reader.test.js --------------------------------------------------------------------
{
// PR #472 review: the site doctor pairs a PC with its story through the reader it was given.
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildBoth } = require('./helpers/gm-build');
const { runSiteDoctor } = require('../lib/site-doctor');

const PC = '---\ntype: pc\nsystem: coc\n---\n## Notes\n\nA person.\n';
const STORY = '---\ntype: character-story\n---\n## Tale\n\nOnce.\n';

describe('PR 472: the site doctor and a PC story', () => {
  const site = buildBoth({ 'PCs/Ann.md': PC, 'PCs/Ann_Story.md': STORY }, { sites: [] });
  after(() => site.cleanup());

  it('reads the story file with the reader passed in', async () => {
    const asked = [];
    const readFile = (p) => { if (p.endsWith('_Story.md')) asked.push(p); return fs.readFileSync(p, 'utf8'); };
    await runSiteDoctor({ configPath: site.configPath, json: true }, { out: () => {}, detect: () => null, readFile });
    assert.ok(asked.some((p) => path.basename(p) === 'Ann_Story.md'), JSON.stringify(asked));
  });
});
}

// ---- gurps-shared-cases.test.js --------------------------------------------------------------------------
{
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const gc = require('../lib/templates/gurps/gurps-calc');

// The cases gurps_calc.py also runs (tests/test_gurps_shared_cases.py).
const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'tests', 'shared-cases', 'gurps-calc.json'), 'utf8'));
const camel = (name) => name.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
// The JavaScript copy returns the same encumbrance rows as objects; turn them into [name, level, max] triples.
const plain = (r) => (Array.isArray(r) ? r.map((x) => (x && typeof x === 'object' && !Array.isArray(x) && 'name' in x && 'level' in x && 'max' in x ? [x.name, x.level, x.max] : x)) : r);

test('every formula in the case file is exported here and has five or more cases', () => {
  for (const name of Object.keys(DATA.cases)) {
    assert.strictEqual(typeof gc[camel(name)], 'function', `${camel(name)} is not exported`);
    assert.ok(DATA.cases[name].length >= 5, `${name} has fewer than five cases`);
  }
});

for (const [name, cases] of Object.entries(DATA.cases)) {
  test(`${camel(name)} agrees with gurps_calc.py`, () => {
    for (const [args, want] of cases) assert.deepStrictEqual(plain(gc[camel(name)](...args)), want, `${name}(${args})`);
  });
}

test('the shared constants agree', () => {
  assert.deepStrictEqual(gc.ENC_LEVELS, DATA.constants.ENC_LEVELS);
  assert.deepStrictEqual(gc.ENC_PENALIZED_SKILLS, DATA.constants.ENC_PENALIZED_SKILLS);
});
}

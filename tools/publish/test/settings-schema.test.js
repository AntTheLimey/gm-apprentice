'use strict';
// The JSON Schema of _meta/vault-config.yaml is built from the declared list (describe.schema()),
// committed, and checked here against the files the tool itself writes and reads.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parse } = require('yaml');
const { schema, schemaText } = require('../lib/settings/describe');
const { REGISTRY } = require('../lib/settings/registry');
const { readSettings } = require('../lib/settings/read');
const { planMove, applyMove } = require('../lib/settings/move');
const { NEW_FILE, OLD_FILE, at } = require('../lib/settings/layout');

const SCHEMA_FILE = path.join(__dirname, '..', 'schema', 'vault-config.schema.json');
const FORMAT_PAGE = path.join(__dirname, '..', '..', '..', 'docs', 'vault-config-format.md');
const FIXTURES = path.join(__dirname, 'fixtures');
const REPO_TESTS = path.join(__dirname, '..', '..', '..', 'tests');
const norm = (t) => t.replace(/\r\n/g, '\n');

// A small structural checker for the parts of JSON Schema the file uses. Returns the problems found.
function check(node, value, where = '', out = []) {
  const kind = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
  const isType = (t, v) => kind(v) === t || (t === 'number' && kind(v) === 'integer') || (t === 'object' && kind(v) === 'object');
  if (node.anyOf) {
    if (!node.anyOf.some((n) => check(n, value, where).length === 0)) out.push(`${where}: matches none of the alternatives`);
    return out;
  }
  if (node.const !== undefined && value !== node.const) out.push(`${where}: must be ${node.const}`);
  if (node.type && ![].concat(node.type).some((t) => isType(t, value))) { out.push(`${where}: wrong type`); return out; }
  if (node.enum && !node.enum.includes(value)) out.push(`${where}: ${JSON.stringify(value)} is not an allowed word`);
  if (node.pattern && typeof value === 'string' && !new RegExp(node.pattern).test(value)) out.push(`${where}: ${JSON.stringify(value)} does not match`);
  if (node.minimum !== undefined && typeof value === 'number' && value < node.minimum) out.push(`${where}: below ${node.minimum}`);
  if (node.maximum !== undefined && typeof value === 'number' && value > node.maximum) out.push(`${where}: above ${node.maximum}`);
  if (node.items && Array.isArray(value)) value.forEach((v, i) => check(node.items, v, `${where}[${i}]`, out));
  if (node.properties && kind(value) === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (node.properties[k]) check(node.properties[k], v, where ? `${where}.${k}` : k, out);
      else if (node.additionalProperties === false) out.push(`${where ? `${where}.` : ''}${k}: unknown name`);
    }
  }
  return out;
}

test('the committed schema file is what the list produces', () => {
  assert.equal(norm(fs.readFileSync(SCHEMA_FILE, 'utf8')), schemaText());
  assert.ok(schemaText().endsWith('}\n'));
  assert.ok(!schemaText().includes('\r'));
  assert.equal(JSON.stringify(schema()), JSON.stringify(schema()), 'the key order is not deterministic');
});

test('the schema is closed at every level the settings file is, and lists its four groups', () => {
  const s = schema();
  assert.deepEqual(Object.keys(s.properties), ['version', 'vault', 'player_site', 'gm_site']);
  assert.equal(s.additionalProperties, false);
  assert.equal(s.properties.vault.additionalProperties, false);
  assert.equal(s.properties.player_site.additionalProperties, false);
  assert.equal(s.properties.player_site.properties.hide.additionalProperties, false);
  assert.equal(s.properties.player_site.properties.theme.additionalProperties, undefined);
});

test('every setting the file can hold is in the schema, and no legacy-only one is', () => {
  const at2 = (name) => name.split('.').reduce((n, seg) => n && n.properties && n.properties[seg], schema());
  for (const e of REGISTRY) {
    if (e.legacyOnly) assert.equal(at2(e.name), undefined, `${e.name} is in the schema`);
    else assert.ok(at2(e.name), `${e.name} is missing from the schema`);
  }
});

test('the schema takes what it should and refuses what it should', () => {
  const ok = (v) => check(schema(), v);
  assert.deepEqual(ok({ version: 1, vault: { kept_by: 'player' }, player_site: { hide: { mode: 'full', drafts: 'On', callouts: ['note'] }, landing: { max_npcs: 0 } }, gm_site: { anything: [1] } }), []);
  assert.deepEqual(ok({ gm_site: { show: { comments: 'on' } } }), []);
  assert.deepEqual(ok({ player_site: { features: { search: 'Yes', connections: true }, hide: { callouts: false } } }), []);
  assert.deepEqual(ok({ player_site: { folder_map: { Sessions: 'sessions' }, theme: { genre: 'horror', unknown_but_warned: 1 } } }), []);
  assert.deepEqual(ok({ player_site: { hide: { sections: null } } }), []);
  assert.notDeepEqual(ok({ player_site: { hide: { secions: ['x'] } } }), []);
  // The reader forgives case and spaces round a word; the schema does too.
  assert.deepEqual(ok({ player_site: { theme: { default_mode: 'Dark' }, features: { search: ' Yes ' } } }), []);
  assert.notDeepEqual(ok({ player_site: { theme: { default_mode: 'darkish' } } }), []);
  assert.notDeepEqual(ok({ publish: {} }), []);
  assert.notDeepEqual(ok({ version: 2 }), []);
  assert.notDeepEqual(ok({ vault: { kept_by: 'nobody' } }), []);
  assert.notDeepEqual(ok({ player_site: { features: { search: 'maybe' } } }), []);
  assert.notDeepEqual(ok({ player_site: { landing: { max_npcs: -1 } } }), []);
  assert.notDeepEqual(ok({ player_site: { hide: { sections: 'GM Notes' } } }), []);
  assert.notDeepEqual(ok({ player_site: { sheets: { show: null } } }), [], 'an empty onFault:false switch is unreadable');
  assert.notDeepEqual(ok({ player_site: { hide: { secions: ['x'] } } }).concat(ok({ vault: { tonne: 1 } })), []);
});

// ---- Every fixture's moved file validates ----

function movedFixtures() {
  const found = [];
  for (const name of fs.readdirSync(FIXTURES)) found.push(path.join(FIXTURES, name));
  for (const rel of ['benchmark-campaign', 'fixtures/slice-b/index', 'fixtures/slice-a/version-behind', 'fixtures/slice-a/wrapup', 'fixtures/slice-a/leak']) found.push(path.join(REPO_TESTS, ...rel.split('/')));
  return found.filter((dir) => fs.existsSync(at(dir, OLD_FILE)));
}

test('the moved file of every fixture vault validates', () => {
  const dirs = movedFixtures();
  assert.ok(dirs.length >= 11, `only ${dirs.length} fixture vaults found`);
  for (const dir of dirs) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schema-'));
    const vault = path.join(root, 'Vault');
    fs.cpSync(dir, vault, { recursive: true });
    const plan = planMove({ vaultPath: vault });
    assert.equal(plan.ok, true, `${dir}: ${plan.blockers.join(' | ')}`);
    applyMove(plan);
    const moved = parse(fs.readFileSync(at(vault, NEW_FILE), 'utf8')) || {};
    assert.deepEqual(check(schema(), moved), [], dir);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---- A file that sets every setting ----

// A valid value for a setting that is not its default, from the list alone.
function sampleFor(e) {
  switch (e.type) {
    case 'switch': return e.default === true ? false : true;
    case 'choice': return [...e.values, ...Object.keys(e.aliases || {})].find((w) => w !== e.default) ?? e.values[0];
    case 'number': return Math.min((e.min || 0) + 7, e.max ?? Infinity);
    case 'list': return ['Sample'];
    case 'switchOrList': return ['Sample'];
    case 'map': return e.keys ? { [e.keys[0]]: 'Sample' } : { 'Sample key': 'Sample' };
    case 'text': return 'Sample';
    case 'position': return '20% center';
    case 'listOfMaps': return [Object.fromEntries(Object.keys(e.fields).map((k) => [k, 'Sample']))];
    default: return [];
  }
}

function everySettingFile() {
  const tree = { version: 1 };
  for (const e of REGISTRY.filter((x) => !x.legacyOnly && !x.retired && !x.container && !REGISTRY.some((o) => o.name.startsWith(`${x.name}.`)))) {
    const segs = e.name.split('.');
    let cur = tree;
    for (const s of segs.slice(0, -1)) cur = cur[s] || (cur[s] = {});
    cur[segs[segs.length - 1]] = sampleFor(e);
  }
  return tree;
}

test('a file that sets every setting to a valid, non-default value validates and reads without a fault', () => {
  const tree = everySettingFile();
  // (A GM site on a vault kept by a player is a stop of its own; the sample keeps the vault by a player.)
  tree.gm_site.publish = false;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schema-'));
  // The GM site's folder must be a folder of its own, beside the player site's.
  tree.player_site.folder = path.join(root, 'site');
  tree.gm_site.folder = path.join(root, 'site-gm');
  assert.deepEqual(check(schema(), tree), []);
  const vault = path.join(root, 'Vault');
  fs.mkdirSync(path.join(vault, '_meta'), { recursive: true });
  fs.writeFileSync(at(vault, NEW_FILE), require('yaml').stringify(tree));
  const read = readSettings({ vaultPath: vault });
  assert.deepEqual(read.faults.map((f) => `${f.level} ${f.name}`), []);
  fs.rmSync(root, { recursive: true, force: true });
});

// ---- The format page's example ----

test('the first YAML example on the format page validates and reads without a fault', () => {
  const page = norm(fs.readFileSync(FORMAT_PAGE, 'utf8'));
  const block = page.match(/```yaml\n([\s\S]*?)\n```/);
  assert.ok(block, 'the page has no yaml example');
  const tree = parse(block[1]);
  assert.deepEqual(check(schema(), tree), []);
  assert.equal(tree.version, 1);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schema-'));
  const vault = path.join(root, 'Vault');
  fs.mkdirSync(path.join(vault, '_meta'), { recursive: true });
  fs.writeFileSync(at(vault, NEW_FILE), block[1]);
  assert.deepEqual(readSettings({ vaultPath: vault }).faults.map((f) => `${f.level} ${f.name}`), []);
  fs.rmSync(root, { recursive: true, force: true });
});

test('a file that writes a choice as Tree and a switch as Yes validates and reads as the reader does', () => {
  const text = 'version: 1\nplayer_site:\n  features:\n    connections: " Tree "\n    search: Yes\n  hide:\n    drafts: Yes\n';
  assert.deepEqual(check(schema(), parse(text)), []);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schema-'));
  const vault = path.join(root, 'Vault');
  fs.mkdirSync(path.join(vault, '_meta'), { recursive: true });
  fs.writeFileSync(at(vault, NEW_FILE), text);
  const read = readSettings({ vaultPath: vault });
  assert.deepEqual(read.faults.map((f) => `${f.level} ${f.name}`), []);
  assert.equal(read.values.player_site.features.connections, 'tree');
  assert.equal(read.values.player_site.features.search, true);
  fs.rmSync(root, { recursive: true, force: true });
});

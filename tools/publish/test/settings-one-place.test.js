'use strict';
// A setting is stated in one place: lib/settings/. Nothing outside it restates a default,
// the words a switch takes, or which files read the vault's settings file; and every name
// the code reads off the settings is in the list.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { entry } = require('../lib/settings');
const { REGISTRY, names } = require('../lib/settings/registry');
const { loadPublishConfig } = require('../lib/config');

const ROOT = path.join(__dirname, '..');
const SETTINGS = path.join(ROOT, 'lib', 'settings');
function files(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (p !== SETTINGS && e.name !== 'node_modules') files(p, out); } else if (/\.(js|mjs)$/.test(e.name)) out.push(p);
  }
  return out;
}
const sources = [...files(path.join(ROOT, 'lib')), ...files(path.join(ROOT, 'bin'))];
const rel = (f) => path.relative(ROOT, f).split(path.sep).join('/');
const text = (f) => fs.readFileSync(f, 'utf8');
// A source file with its comments taken out, so a sentence about a setting is not code: whole
// comment lines, block comments that start a line, and `  // ...` after code.
const code = (f) => text(f).replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, '').replace(/^[ \t]*\/\/.*$/gm, '').replace(/\s\/\/\s.*$/gm, '');
const grep = (re, read = text) => sources.filter((f) => re.test(read(f))).map(rel);

test('the scan sees the code it is meant to check', () => {
  assert.ok(sources.length > 40, `only ${sources.length} source files found`);
  assert.ok(!sources.some((f) => f.startsWith(SETTINGS)), 'the settings package is scanned');
});

// A note's yes/no flags (gm_only, withheld) are read with the same words, from lib/settings/types.js.
// A file states the switch words when it quotes both `yes` and `off`, or when a pattern
// alternates yes, on and true.
test('the switch words are written in one place', () => {
  const quoted = (word) => new RegExp(`['"\`]${word}['"\`]`);
  const both = (src) => quoted('yes').test(src) && quoted('off').test(src);
  const alternation = /\b(?:true|yes|on)\|(?:true|yes|on|false|no|off)\b|\b(?:false|no|off)\|(?:true|yes|on|false|no|off)\b/;
  const found = sources.filter((f) => { const src = code(f); return both(src) || alternation.test(src); }).map(rel);
  assert.deepEqual(found, []);
});

// The headings and field names a site hides by default are read from the list, not typed here.
// A file states one of those lists when it quotes two or more of its entries.
test('no default list is restated', () => {
  for (const name of ['player_site.hide.sections', 'player_site.hide.fields']) {
    const defaults = entry(name).default;
    assert.ok(defaults.length >= 3, `${name} has no default list to check`);
    const found = sources.filter((f) => {
      const src = code(f);
      return defaults.filter((d) => src.includes(`'${d}'`) || src.includes(`"${d}"`) || src.includes(`\`${d}\``)).length >= 2;
    }).map(rel);
    assert.deepEqual(found, [], name);
  }
});

// A fallback typed beside a setting (`attachmentsDir || '_attachments'`, `mode || 'player'`) is the
// default written a second time. The scan looks for `||` or `??` followed by any quoted text
// default or fallback word in the list.
test('no default is written as a fallback', () => {
  const words = new Set(REGISTRY.flatMap((e) => [e.default, e.fallback]).filter((d) => typeof d === 'string' && d.length >= 4));
  assert.ok(words.has('_attachments') && words.has('player') && words.has('plain'), 'the words to look for are missing');
  const found = [];
  for (const f of sources) {
    for (const m of code(f).matchAll(/(?:\|\||\?\?)\s*['"`]([^'"`]+)['"`]/g)) {
      if (words.has(m[1])) found.push(`${rel(f)}: ${m[0]}`);
    }
  }
  assert.deepEqual(found, []);
});

// Each file below names the settings file in code, and why:
//   (none: the old editor and the old migration command are gone)
// The settings package reads and writes the file for everything else (settings/write.js is the one writer),
// and layout.js is the one place that writes either file's name: a message to the GM gets the name from
// fileLabel / nameIn (or their `For` forms), which know which of the two files the vault is on.
test('nothing reads the vault settings file but the settings package', () => {
  const allowed = new Set([]);
  // Either file's name anywhere in code: a path joined, a template, a line of help text.
  const named = /vault-config\.(?:md|yaml)/;
  const hits = grep(named, code);
  const outside = hits.filter((f) => !allowed.has(f));
  assert.deepEqual(outside, []);
  // The list does not go stale: each allowed file still names the file.
  assert.deepEqual([...allowed].filter((f) => !hits.includes(f)), []);
});

// Names the code reads off the resolved config that are worked out by the build, not
// written by a GM:
//   switches  the resolved on/off switches, by name (build.js sets them; the sheet and sync code read them)
//   live      the live-play flags worked out from those switches (build.js, templates/pc.js)
//   legacy    the settings an older site file still holds (build.js lists them in its closing warning)
//   faults    the settings problems found while reading (config.js, site-doctor.js, build.js report them)
//   layout    which settings file the vault is on, for naming a setting in a message (not enumerable)
//   site      the site folder's own settings (url, host, output, cloudflare_project, keep), for code that has only the publishConfig (not enumerable)
// `setting_year` is a setting, written beside `publish:`; it is checked below as a top-level name.
//   steps     the vault's build steps, { before, after } (not enumerable; only `build` and `deploy` run them)
//   menu_extra  the GM's extra menu entries with a repeat left out (not enumerable; build.js reads each link)
//   limits, header_facts, withheld_words  the numbers, header facts and withheld words (not enumerable; passed down to the code that uses each)
//   statuses  the three status lists as sets, { out_of_play, fallen, gone } (not enumerable; passed down to the code that uses each)
//   gm        the GM site's switch, folder and show switches, { publish, folder, show } (not enumerable; the GM build reads it)
const DERIVED = ['switches', 'live', 'legacy', 'faults', 'layout', 'site', 'steps', 'menu_extra', 'limits', 'header_facts', 'withheld_words', 'statuses', 'gm'];

// Only reads through the name `publishConfig` are checked (`publishConfig.x`, `publishConfig['x']`,
// and one level further for the groups). A read through another name (`p.x`, `cfg.publish.x`)
// cannot be told from other objects by a pattern without false alarms, so it is not checked.
// The object config.js builds, read from config.js itself: a vault with no settings file gives every key.
const built = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-one-place-'));
  try { return loadPublishConfig(dir, {}, () => {}); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
};

test('every setting the code reads is in the list', () => {
  const known = new Set(Object.keys(built()));
  const derived = new Set(DERIVED);
  const read = new Set();
  const first = /\bpublishConfig(?:\??\.([a-z][a-z_0-9]*)\b|\[\s*['"]([a-z][a-z_0-9]*)['"]\s*\])/g;
  for (const f of sources) for (const m of code(f).matchAll(first)) read.add(m[1] || m[2]);
  assert.ok(read.size >= 10, `the scan found only ${read.size} names; it has stopped working`);
  assert.deepEqual([...read].filter((n) => !known.has(n) && !derived.has(n)).sort(), []);
});

test('every setting the code reads inside a group is in the list', () => {
  // Each group of publishConfig, and the part of the list's names that its keys are the last part of.
  const prefixes = { theme: 'player_site.theme', landing: 'player_site.landing', images: 'player_site.images', locations: 'player_site.lists.locations' };
  const groups = [...Object.keys(prefixes), 'four_oh_four'];
  const known = new Set([
    ...Object.entries(prefixes).flatMap(([g, prefix]) => names().filter((n) => n.startsWith(`${prefix}.`)).map((n) => `${g}.${n.slice(prefix.length + 1).split('.')[0]}`)),
    ...Object.keys(built().four_oh_four).map((k) => `four_oh_four.${k}`),
  ]);
  const read = new Set();
  const second = new RegExp(`\\bpublishConfig\\??\\.(${groups.join('|')})(?:\\??\\.([a-z][a-z_0-9]*)\\b|\\[\\s*['"]([a-z][a-z_0-9]*)['"]\\s*\\])`, 'g');
  for (const f of sources) for (const m of code(f).matchAll(second)) read.add(`${m[1]}.${m[2] || m[3]}`);
  assert.ok(read.size >= 5, `the scan found only ${read.size} names; it has stopped working`);
  assert.deepEqual([...read].filter((n) => !known.has(n)).sort(), []);
});

test('every landing setting the code reads is in the list', () => {
  const known = new Set(names().filter((n) => n.startsWith('player_site.landing.')).map((n) => n.split('.')[2]));
  const read = new Set();
  for (const f of sources) for (const m of code(f).matchAll(/\blandingConfig\??\.([a-z][a-z_0-9]*)\b/g)) read.add(m[1]);
  assert.ok(read.size >= 4, `the scan found only ${read.size} names; it has stopped working`);
  assert.deepEqual([...read].filter((n) => !known.has(n)).sort(), []);
});

// Client-side strings and modules that cannot require the list state a few allowed values
// themselves; they must not drift from it.
test('the colour modes the page script knows are the list\'s', () => {
  assert.deepEqual(require('../lib/color-mode').MODES, entry('player_site.theme.default_mode').values);
});

test('the connection and link-preview modes the templates use come from the list', () => {
  const base = fs.readFileSync(path.join(ROOT, 'lib', 'templates', 'base.js'), 'utf8');
  const conn = fs.readFileSync(path.join(ROOT, 'lib', 'templates', 'connections.js'), 'utf8');
  assert.match(base, /entry\('player_site\.features\.link_previews'\)\.values/);
  assert.match(base, /entry\('player_site\.features\.connections'\)\.values/);
  assert.match(conn, /entry\('player_site\.features\.connections'\)\.values/);
  assert.match(fs.readFileSync(path.join(ROOT, 'lib', 'image-optimize.js'), 'utf8'), /entry\('player_site\.images\.format'\)\.values/);
});

// A message names a setting as the vault's own file writes it: the old name on the old file, the new
// one on the new. So no file outside the settings package holds a setting's old name as text; the
// pair lives in the list (`was`), and the helpers in layout.js read it.
test('no message states a setting under its old name', () => {
  const old = new Set(REGISTRY.filter((e) => !e.legacyOnly).flatMap((e) => (e.was || []).filter((w) => w.in === 'vault').map((w) => w.name)));
  const exempt = new Set(['bin/gm-publish.js']);
  const found = [];
  for (const f of sources) {
    if (exempt.has(rel(f))) continue;
    for (const m of code(f).matchAll(/['"`]([^'"`\n]*)['"`]/g)) {
      for (const word of m[1].match(/[A-Za-z_][A-Za-z_.0-9]*[A-Za-z_0-9]/g) || []) if (old.has(word)) found.push(`${rel(f)}: ${word}`);
    }
  }
  assert.deepEqual(found, []);
});

// ---- Plan 1c: what moved into the list stays there ---------------------------------------------------------------

// (a) The constants the numbers, word lists and status lists became settings from are gone: none of these names
// is in lib/ or bin/ again (comments included), so a returning constant cannot hide.
test('the constants that became settings do not return', () => {
  const deleted = [
    // Task 6: the fixed numbers and words
    'RECAP_MAX_CHARS', 'VALUE_LIMIT', 'TITLE_LIMIT', 'EXCERPT_LIMIT', 'MAX_FACTS', 'DEFAULT_META_FIELDS', 'WITHHELD_PLACEHOLDERS',
    // Task 7: the status lists, and the role guess that read the landing tag lists
    'OUT_OF_PLAY_STATUSES', 'FALLEN_STATUSES', 'TERMINAL_STATUSES', 'inferNPCRole', 'PATRON_TAGS', 'ANTAGONIST_TAGS', 'COMPANION_TAGS', 'THREAT_TAGS',
  ];
  const everything = [...sources, ...files(SETTINGS)];
  assert.ok(everything.some((f) => f.startsWith(SETTINGS)), 'the settings package is not scanned');
  const found = [];
  for (const f of everything) for (const name of deleted) if (new RegExp(`\\b${name}\\b`).test(text(f))) found.push(`${rel(f)}: ${name}`);
  assert.deepEqual(found, []);
});

// (b) The words that take a character out of play are written once, in the list. A file outside the settings
// package that quotes three or more of them close together (within 250 characters, so a stray `'npc'` far from
// `'dead'` is not a list) is stating the list again. The one exception is the In Memoriam card labels in
// landing.js: a label for each status word, which is not a list of what counts.
test('the out-of-play words are not restated', () => {
  const words = entry('vault.statuses.out_of_play').default;
  assert.ok(words.length >= 8, 'the list to check is missing');
  const exempt = new Set(['lib/templates/landing.js']);
  const nearby = (src) => {
    const hits = [];
    for (const w of words) for (const m of src.matchAll(new RegExp(`['"\`]${w}['"\`]|\\b${w}\\s*:`, 'g'))) hits.push({ w, at: m.index });
    hits.sort((a, b) => a.at - b.at);
    return hits.some((h, i) => new Set(hits.slice(i).filter((o) => o.at - h.at <= 250).map((o) => o.w)).size >= 3);
  };
  const found = sources.filter((f) => !exempt.has(rel(f)) && nearby(code(f))).map(rel);
  assert.deepEqual(found, []);
  // The exception still earns its place.
  assert.ok(nearby(code(path.join(ROOT, 'lib', 'templates', 'landing.js'))), 'landing.js no longer needs its exception');
});

// (c) The five site-folder keys are the vault's settings now. The site file is read for the path to the vault
// and nothing else, apart from config.js, which maps what an older site file still holds (SITE_KEYS) onto the
// settings. So: no `rawConfig.<key>`, and no file reads one of the keys off what loadVaultConfig returned.
const SITE_FOLDER_KEYS = ['siteUrl', 'host', 'outputDir', 'cloudflarePagesProject', 'preserveDirs'];
// A destructure: `const { outputDir } = loadVaultConfig(p)` or `= rawConfig` (or a name bound to one); the keys named in the
// braces are reads.
function destructuredKeys(src, vars) {
  const from = `(?:[^;\\n]*\\bloadVaultConfig\\(|(?:${[...vars].join('|')})\\s*[;\\n)])`;
  const keys = [];
  for (const m of src.matchAll(new RegExp(`\\{([^{}]*)\\}\\s*=\\s*${from}`, 'g'))) {
    for (const part of m[1].split(',')) {
      const key = part.trim().split(/[:=\s]/)[0];
      if (key) keys.push(key);
    }
  }
  return keys;
}

// Every loadVaultConfig call in lib/ and bin/ -> the names its result is kept in, and the properties read off them.
function loadVaultConfigReads() {
  const calls = [];
  for (const f of [...sources, ...files(SETTINGS)]) {
    const src = code(f);
    if (!src.includes('loadVaultConfig(')) continue;
    if (/^function loadVaultConfig\b/m.test(src) && !/=\s*loadVaultConfig\(|\bloadVaultConfig\(.*\)\./.test(src)) continue;
    const vars = new Set();
    for (const m of src.matchAll(/(?:\b(?:const|let|var)\s+)?\b([A-Za-z_]\w*)\s*=\s*[^;\n]*\bloadVaultConfig\(/g)) vars.add(m[1]);
    for (const m of src.matchAll(/\bloadVaultConfig\([^)\n]*\)(?:\[|\??\.)\s*['"]?(\w+)/g)) calls.push({ file: rel(f), variable: '(call)', prop: m[1] });
    // The name `rawConfig` counts as a result, and so does a name bound to one (`const c = rawConfig;`), to any depth.
    if (/\brawConfig\b/.test(src)) vars.add('rawConfig');
    for (let grew = true; grew;) {
      grew = false;
      for (const v of [...vars]) {
        for (const m of src.matchAll(new RegExp(`\\b(?:const|let|var)\\s+(\\w+)\\s*=\\s*${v}\\s*[;,)\\n]`, 'g'))) if (!vars.has(m[1])) { vars.add(m[1]); grew = true; }
      }
    }
    for (const key of destructuredKeys(src, vars)) calls.push({ file: rel(f), variable: '(destructured)', prop: key });
    for (const v of vars) {
      for (const m of src.matchAll(new RegExp(`(?<![\\w.'"/-])${v}(?:\\?\\.|\\.|\\[\\s*['"])(\\w+)`, 'g'))) calls.push({ file: rel(f), variable: v, prop: m[1] });
    }
  }
  return calls;
}

// The destructure scan, on sample source: each way of naming a site-folder key is read as that key, whole.
test('the destructure scan reads whole key names', () => {
  const cases = [
    ['const { siteUrl } = rawConfig;', ['siteUrl']],
    ['const { host } = rawConfig;', ['host']],
    ['const { siteUrl } = loadVaultConfig(p);', ['siteUrl']],
    ['const { siteUrl: s } = loadVaultConfig(p);', ['siteUrl']],
    ['const { vaultPath, outputDir = \'docs\', preserveDirs } = loadVaultConfig(p);', ['vaultPath', 'outputDir', 'preserveDirs']],
    ['const { cloudflarePagesProject } = alias;', ['cloudflarePagesProject']],
    ['const { siteUrl } = somethingElse;', []],
  ];
  for (const [src, want] of cases) assert.deepEqual(destructuredKeys(src, new Set(['rawConfig', 'alias'])), want, src);
  assert.ok(SITE_FOLDER_KEYS.every((k) => destructuredKeys(`const { ${k} } = rawConfig;`, new Set(['rawConfig'])).includes(k)));
});

test('no code reads a site-folder key off the site file', () => {
  const raw = [];
  for (const f of [...sources, ...files(SETTINGS)]) {
    for (const m of code(f).matchAll(new RegExp(`\\brawConfig\\??\\.(${SITE_FOLDER_KEYS.join('|')})\\b`, 'g'))) raw.push(`${rel(f)}: ${m[0]}`);
  }
  assert.deepEqual(raw, []);
  const reads = loadVaultConfigReads();
  assert.ok(reads.some((r) => r.prop === 'vaultPath'), 'the scan found no read of vaultPath; it has stopped working');
  // Only the path to the vault is read off the site file, except in the settings package (the move and the
  // fallback read the old keys there, and nowhere else).
  const bad = reads.filter((r) => r.prop !== 'vaultPath' && !r.file.startsWith('lib/settings/'));
  assert.deepEqual(bad.map((r) => `${r.file}: ${r.variable}.${r.prop}`), []);
});

// Two files parse the site file themselves instead of calling loadVaultConfig (`JSON.parse(readFile(configPath))`), so
// the scan above cannot see them: no site-folder key is read off what they parsed (they ask the settings).
test('setup-backend.js and site-doctor.js read no site-folder key off the site file they parse', () => {
  for (const file of ['setup-backend.js', 'site-doctor.js']) {
    const src = code(path.join(ROOT, 'lib', file));
    assert.match(src, /JSON\.parse\(|rawSiteConfig/, `${file} no longer parses the site file; this check is out of date`);
    const bad = [...src.matchAll(new RegExp(`\\b(?:config|rawConfig|rawSiteConfig|raw|site)\\??\\.(${SITE_FOLDER_KEYS.join('|')})\\b`, 'g'))].map((m) => m[0]);
    assert.deepEqual(bad, [], file);
  }
});

// (d) A build step is run in one place: lib/settings/steps.js. This looks at the settings package too, so a second
// runner there is caught. Files that require child_process: run-command.js (the shared runner for git, npm install,
// wrangler and gh), image-optimize.js (image tools), steps.js (the steps) and settings/move.js, whose one use runs
// this tool's own `update-pin --check`. The only code that runs `npm run <hook>` is the dated block in deploy-cli.js,
// which keeps a site on the old layout running its package.json prebuild/postbuild until the site is updated
// (legacy.js's buildHooks; it goes with that file). The two script names appear as code only there, in legacy.js (that
// block's reader) and in the registry (`stepsFrom`); a shell is opened with `shell: true` only by steps.js.
test('a build step is run only by the steps module and the dated deploy hook', () => {
  const everywhere = [...sources, ...files(SETTINGS)];
  const grepAll = (re) => everywhere.filter((f) => re.test(code(f))).map(rel).sort();
  assert.deepEqual(grepAll(/\brequire\(\s*['"](?:node:)?child_process['"]\s*\)/),
    ['lib/image-optimize.js', 'lib/run-command.js', 'lib/settings/move.js', 'lib/settings/steps.js']);
  // move.js starts exactly one process: this tool, to ask update-pin about the site.
  const moveSpawns = code(path.join(SETTINGS, 'move.js')).match(/\bspawnSync\(/g) || [];
  assert.equal(moveSpawns.length, 1, 'move.js: one call');
  assert.match(code(path.join(SETTINGS, 'move.js')), /spawnSync\(process\.execPath, \[bin, 'update-pin', '--check'/);
  assert.deepEqual(grepAll(/shell:\s*true/), ['lib/settings/steps.js']);
  // `npm run <something>` is run by deploy-cli.js alone.
  assert.deepEqual(grepAll(/runCommand\(\s*['"]npm['"]\s*,\s*\[\s*['"]run['"]/), ['lib/deploy-cli.js']);
  // The two script names, as code (build.js and the doctor ask steps.js).
  assert.deepEqual(grepAll(/['"`](?:pre|post)build['"`]/), ['lib/deploy-cli.js', 'lib/settings/legacy.js', 'lib/settings/registry.js']);
  // The hook list that block runs comes from the dated legacy module.
  assert.match(code(path.join(ROOT, 'lib', 'deploy-cli.js')), /buildHooks[\s\S]*require\('\.\/settings\/legacy'\)|require\('\.\/settings\/legacy'\)[\s\S]*buildHooks/);
  // Every call of the steps runner is the settings module's own.
  for (const f of grep(/\brunSteps\(/, code)) {
    assert.match(code(path.join(ROOT, f)), /require\('\.\/settings\/steps'\)/, f);
  }
});

// #382: the tool installed in a site folder is read by siteToolVersion (settings/layout.js), which update-pin.js
// calls twice and move.js once; neither of them reads the installed package.json on its own.
test('the installed tool of a site is read in one place by update-pin and the move', () => {
  const installedRead = /['"`]node_modules['"`]\s*,\s*['"`]gm-apprentice-publish['"`]|node_modules\/gm-apprentice-publish/;
  assert.deepEqual(grep(installedRead, code).filter((f) => f === 'lib/update-pin.js'), []);
  assert.match(code(path.join(SETTINGS, 'layout.js')), installedRead);
  assert.equal((code(path.join(ROOT, 'lib', 'update-pin.js')).match(/siteToolVersion\(/g) || []).length, 2);
  assert.doesNotMatch(code(path.join(SETTINGS, 'move.js')), installedRead);
  assert.match(code(path.join(SETTINGS, 'move.js')), /siteToolVersion\(/);
});

'use strict';
// player_site.theme.stylesheets (#361): more stylesheets on every page. Each entry is a path in the vault, or failing
// that in the site folder; it is copied to css/extra/ and linked after the tool's own stylesheets and before
// css/overrides.css, in the order written. A missing file, a file that is not a .css or a second file of the same name
// is a warning, never a stop. A site that sets none builds as it did.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildBoth } = require('../helpers/gm-build');
const { runLeakGate } = require('../../lib/leak-gate');

const FILES = {
  'NPCs/Mara Quill.md': '---\ntype: npc\n---\n\nA ferry pilot on the north channel.\n\n## GM Notes\n\nShe carries letters for the smugglers at the old salt works.\n',
  'Locations/Harbour.md': '---\ntype: location\n---\n\nA cold grey harbour.\n',
  'NPCs/Lord Zorn.md': '---\ntype: npc\npublish: false\nwithheld: true\n---\n\nThe hidden hand.\n',
};

// Builds the two sites with `stylesheets` set (undefined: not set). `vaultCss` and `siteCss` are files to write first,
// { 'rel/path.css': text }, in the vault and in the site folder; `overrides` writes the site's css/overrides.css.
function site(stylesheets, { vaultCss = {}, siteCss = {}, overrides = true, gm = {}, sites = ['player', 'gm'], player = {} } = {}) {
  const files = { ...FILES };
  for (const [rel, text] of Object.entries(vaultCss)) files[rel] = text;
  // buildBoth writes the vault, then builds: the site-folder files must be there first, so they go in through a step
  // of its own below (buildBoth makes the site folder).
  const theme = stylesheets === undefined ? {} : { theme: { stylesheets } };
  const s = buildBoth(files, { player: { ...theme, ...player }, gm, sites: [] });
  const siteDir = path.dirname(s.configPath);
  for (const [rel, text] of Object.entries(siteCss)) {
    fs.mkdirSync(path.dirname(path.join(siteDir, rel)), { recursive: true });
    fs.writeFileSync(path.join(siteDir, rel), text);
  }
  if (overrides) {
    fs.mkdirSync(path.join(siteDir, 'css'), { recursive: true });
    fs.writeFileSync(path.join(siteDir, 'css', 'overrides.css'), ':root { --accent: #8b0000; }\n');
  }
  const { build } = require('../../lib/build');
  const saved = { log: console.log, warn: console.warn };
  const logs = [];
  console.log = () => {}; console.warn = (...a) => logs.push(a.join(' '));
  try { for (const which of sites) build({ configPath: s.configPath, site: which }); } finally { Object.assign(console, saved); }
  return { ...s, siteDir, logs };
}

// The stylesheet links of a page's <head>, in order.
const links = (html) => [...html.slice(0, html.indexOf('</head>')).matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((m) => m[1]);

test('nothing set: no css/extra folder and no extra link, the page is as it was', () => {
  const s = site(undefined);
  try {
    assert.ok(!s.player.exists('css', 'extra'));
    const head = links(s.player.read('npcs', 'mara-quill.html'));
    assert.deepEqual(head, ['../css/style.css', '../css/theme.css', '../css/overrides.css']);
    const same = site([]);
    try { assert.equal(same.player.read('npcs', 'mara-quill.html'), s.player.read('npcs', 'mara-quill.html')); } finally { same.cleanup(); }
  } finally { s.cleanup(); }
});

test('a vault file and a site-folder file are copied and linked on every page, in the order written, before overrides.css', () => {
  const s = site(['_meta/theme/paper.css', 'theme/ink.css'], {
    vaultCss: { '_meta/theme/paper.css': 'body { background: #f4ecd8; }\n' },
    siteCss: { 'theme/ink.css': 'h1 { color: #222; }\n' },
  });
  try {
    assert.equal(s.player.read('css', 'extra', 'paper.css'), 'body { background: #f4ecd8; }\n');
    assert.equal(s.player.read('css', 'extra', 'ink.css'), 'h1 { color: #222; }\n');
    assert.deepEqual(links(s.player.read('npcs', 'mara-quill.html')),
      ['../css/style.css', '../css/theme.css', '../css/extra/paper.css', '../css/extra/ink.css', '../css/overrides.css']);
    assert.deepEqual(links(s.player.read('index.html')),
      ['css/style.css', 'css/theme.css', 'css/extra/paper.css', 'css/extra/ink.css', 'css/overrides.css']);
    for (const page of [['characters', 'npcs', 'index.html'], ['locations', 'harbour.html'], ['404.html']]) {
      const head = links(s.player.read(...page));
      const paper = head.findIndex((h) => h.endsWith('css/extra/paper.css'));
      const ink = head.findIndex((h) => h.endsWith('css/extra/ink.css'));
      const over = head.findIndex((h) => h.endsWith('css/overrides.css'));
      assert.ok(paper > 0 && ink === paper + 1 && over === ink + 1, `${page.join('/')}: ${head.join(', ')}`);
    }
    // The GM site links them too.
    assert.ok(s.gm.exists('css', 'extra', 'paper.css'));
    assert.ok(links(s.gm.read('npcs', 'mara-quill.html')).includes('../css/extra/ink.css'));
    assert.deepEqual(s.logs.filter((l) => /stylesheets/.test(l)), []);
  } finally { s.cleanup(); }
});

test('with no overrides.css the extra stylesheets come last', () => {
  const s = site(['_meta/theme/paper.css'], { vaultCss: { '_meta/theme/paper.css': 'p {}\n' }, overrides: false });
  try {
    assert.deepEqual(links(s.player.read('npcs', 'mara-quill.html')), ['../css/style.css', '../css/theme.css', '../css/extra/paper.css']);
  } finally { s.cleanup(); }
});

test('a vault file wins over a site-folder file at the same path', () => {
  const s = site(['theme/look.css'], { vaultCss: { 'theme/look.css': '/* vault */\n' }, siteCss: { 'theme/look.css': '/* site */\n' } });
  try { assert.equal(s.player.read('css', 'extra', 'look.css'), '/* vault */\n'); } finally { s.cleanup(); }
});

test('a missing file is a warning naming the entry and both places looked; the build goes on', () => {
  const s = site(['theme/gone.css', '_meta/theme/paper.css'], { vaultCss: { '_meta/theme/paper.css': 'p {}\n' } });
  try {
    const said = s.logs.filter((l) => l.includes('theme/gone.css'));
    assert.equal(said.length, 2, s.logs.join('\n'));   // once for each site
    assert.ok(said[0].includes('player_site.theme.stylesheets'));
    assert.ok(said[0].includes(path.join(s.root, 'vault')) && said[0].includes(s.siteDir), said[0]);
    assert.deepEqual(links(s.player.read('npcs', 'mara-quill.html')).filter((h) => h.includes('extra')), ['../css/extra/paper.css']);
  } finally { s.cleanup(); }
});

test('a file that is not a .css is a warning and is skipped', () => {
  const s = site(['_meta/theme/notes.txt', '_meta/theme/paper.css'], { vaultCss: { '_meta/theme/notes.txt': 'hello\n', '_meta/theme/paper.css': 'p {}\n' }, sites: ['player'] });
  try {
    assert.ok(s.logs.some((l) => l.includes('_meta/theme/notes.txt') && /not a \.css/.test(l)), s.logs.join('\n'));
    assert.ok(!s.player.exists('css', 'extra', 'notes.txt'));
    assert.deepEqual(links(s.player.read('npcs', 'mara-quill.html')).filter((h) => h.includes('extra')), ['../css/extra/paper.css']);
  } finally { s.cleanup(); }
});

test('two files of the same name: a warning, and the first is kept', () => {
  const s = site(['_meta/a/look.css', 'b/look.css'], { vaultCss: { '_meta/a/look.css': '/* first */\n' }, siteCss: { 'b/look.css': '/* second */\n' }, sites: ['player'] });
  try {
    assert.ok(s.logs.some((l) => l.includes('b/look.css') && l.includes('_meta/a/look.css')), s.logs.join('\n'));
    assert.equal(s.player.read('css', 'extra', 'look.css'), '/* first */\n');
    assert.deepEqual(links(s.player.read('npcs', 'mara-quill.html')).filter((h) => h.includes('extra')), ['../css/extra/look.css']);
  } finally { s.cleanup(); }
});

test('a path outside both the vault and the site folder is not read', () => {
  const s = site(['../outside.css'], { sites: ['player'] });
  try {
    fs.writeFileSync(path.join(s.root, 'outside.css'), 'p {}\n');
    const { build } = require('../../lib/build');
    const saved = { log: console.log, warn: console.warn };
    const logs = [];
    console.log = () => {}; console.warn = (...a) => logs.push(a.join(' '));
    try { build({ configPath: s.configPath }); } finally { Object.assign(console, saved); }
    assert.ok(logs.some((l) => l.includes('../outside.css')), logs.join('\n'));
    assert.ok(!s.player.exists('css', 'extra', 'outside.css'));
  } finally { s.cleanup(); }
});

test('the GM site may set its own list', () => {
  const s = site(['_meta/theme/paper.css'], { vaultCss: { '_meta/theme/paper.css': 'p {}\n', '_meta/theme/gm.css': 'h1 {}\n' }, gm: { theme: { stylesheets: ['_meta/theme/gm.css'] } } });
  try {
    assert.deepEqual(links(s.player.read('npcs', 'mara-quill.html')).filter((h) => h.includes('extra')), ['../css/extra/paper.css']);
    assert.deepEqual(links(s.gm.read('npcs', 'mara-quill.html')).filter((h) => h.includes('extra')), ['../css/extra/gm.css']);
  } finally { s.cleanup(); }
});

test('the leak gate does not flag the copied stylesheets, and still reads them', () => {
  const css = '/* Paper look for the campaign site */\nbody { background: #f4ecd8; font-family: Georgia, serif; }\n';
  const s = site(['_meta/theme/paper.css'], { vaultCss: { '_meta/theme/paper.css': css }, sites: ['player'] });
  try {
    const clean = runLeakGate({ configPath: s.configPath, outputDir: s.player.dir });
    assert.deepEqual(clean.findings, []);
    // The reverse case: a stylesheet that carries hidden text is a leak like any other file.
    fs.writeFileSync(path.join(s.player.dir, 'css', 'extra', 'paper.css'), `${css}/* She carries letters for the smugglers at the old salt works. */\n`);
    const caught = runLeakGate({ configPath: s.configPath, outputDir: s.player.dir });
    assert.ok(caught.findings.some((f) => f.page === 'css/extra/paper.css'), JSON.stringify(caught.findings));
  } finally { s.cleanup(); }
});

test('a sheets-only build links them on the pages it writes', () => {
  const s = site(['_meta/theme/paper.css'], {
    vaultCss: { '_meta/theme/paper.css': 'p {}\n', 'PCs/Ash.md': '---\ntype: pc\nplayer_name: Pat\nstatus: alive\n---\n\nA climber.\n' },
    sites: ['player'],
  });
  try {
    const { build } = require('../../lib/build');
    const saved = { log: console.log, warn: console.warn };
    console.log = () => {}; console.warn = () => {};
    try { build({ configPath: s.configPath, only: 'sheets' }); } finally { Object.assign(console, saved); }
    assert.ok(links(s.player.read('pcs', 'ash.html')).includes('../css/extra/paper.css'));
  } finally { s.cleanup(); }
});

const { test } = require('node:test');
require('./helpers/quiet-legacy-warning.js');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { build } = require('../lib/build');

function buildVault(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-timeline-build-'));
  const vault = path.join(root, 'vault');
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(vault, rel)), { recursive: true });
    fs.writeFileSync(path.join(vault, rel), text);
  }
  const configPath = path.join(root, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({ vaultPath: vault, outputDir: path.join(root, 'docs'), attachmentsDir: '_attachments', siteTitle: 'T' }));
  const real = console.log; console.log = () => {};
  try { build({ configPath }); } finally { console.log = real; }
  return { read: (...p) => fs.readFileSync(path.join(root, 'docs', ...p), 'utf8'), root };
}

const CONFIG = '---\npublish:\n  mode: full\n  folder_map:\n    Characters/PCs: characters/pcs\n    Events: events\n    Sessions: sessions\n---\n';

function event(date, participants) {
  const list = participants.length ? '\n' + participants.map(p => `  - "${p}"`).join('\n') : ' []';
  return `---\ntype: event\nin_game_date: "${date}"\nparticipants:${list}\n---\nIt happened.\n`;
}

const VAULT = {
  '_meta/vault-config.md': CONFIG,
  'Characters/PCs/Mara_Voss.md': '---\ntype: pc\naliases: ["The Captain"]\n---\n# Mara Voss\n',
  'Characters/PCs/Tobin.md': '---\ntype: pc\n---\n# Tobin\n',
  'Characters/PCs/Quill.md': '---\ntype: pc\n---\n# Quill\n',
  'Events/Dock Fire.md': event('1921-03-01', ['[[Mara_Voss]] (raised the alarm)', '[[Tobin]]']),
  'Events/Vault Heist.md': event('1921-03-04', ['[[Tobin|Toby]] (drove)']),
  'Events/Parley.md': event('1921-03-09', ['[[The Captain]]', 'Quill (named, not linked)']),
  'Sessions/S1.md': '---\ntype: session\nsession_number: 1\nin_game_date: "1921-03-02"\n---\n[[Mara_Voss]] and [[Tobin]] and [[Quill]].\n',
};

// The Journey panel is the last tab panel on a PC page; the tab script follows it.
function journey(html) {
  const start = html.indexOf('id="tab-journey">');
  assert.notStrictEqual(start, -1, 'the page has a Journey tab');
  const end = html.indexOf('<script', start);
  return html.slice(start, end === -1 ? undefined : end);
}

test("a PC's Journey tab lists the events that name that PC, oldest first, and no others", () => {
  const { read, root } = buildVault(VAULT);
  const mara = journey(read('characters', 'pcs', 'mara-voss.html'));
  assert.match(mara, /<h2>Timeline<\/h2>/);
  assert.match(mara, /Dock Fire/);
  assert.match(mara, /Parley/, 'a participant written by an alias counts');
  assert.doesNotMatch(mara, /Vault Heist/);
  assert.doesNotMatch(mara, /tl-session/, 'a session names no participants and is not listed');
  assert.ok(mara.indexOf('Dock Fire') < mara.indexOf('Parley'));

  const tobin = journey(read('characters', 'pcs', 'tobin.html'));
  assert.match(tobin, /Dock Fire/);
  assert.match(tobin, /Vault Heist/, 'a participant written with display text counts');
  assert.doesNotMatch(tobin, /Parley/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("the links in a PC's timeline reach the event pages from the PC's own folder", () => {
  const { read, root } = buildVault(VAULT);
  const mara = journey(read('characters', 'pcs', 'mara-voss.html'));
  assert.match(mara, /href="\.\.\/\.\.\/events\/dock-fire\.html"/);
  assert.match(mara, /href="\.\.\/\.\.\/timeline\.html"/, 'and one link reaches the full timeline');
  fs.rmSync(root, { recursive: true, force: true });
});

test('a PC no event names has no Timeline section', () => {
  const { read, root } = buildVault(VAULT);
  assert.doesNotMatch(read('characters', 'pcs', 'quill.html'), /<h2>Timeline<\/h2>/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("a PC's timeline shows the fifteen latest of its events", () => {
  const files = { ...VAULT };
  for (let i = 1; i <= 18; i++) {
    files[`Events/Raid ${String(i).padStart(2, '0')}.md`] = event(`1922-01-${String(i).padStart(2, '0')}`, ['[[Quill]]']);
  }
  const { read, root } = buildVault(files);
  const quill = journey(read('characters', 'pcs', 'quill.html'));
  assert.strictEqual((quill.match(/class="tl-entry/g) || []).length, 15);
  assert.doesNotMatch(quill, /Raid 03/);
  assert.match(quill, /Raid 04/);
  assert.match(quill, /Raid 18/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('the landing page keeps the whole campaign in its timeline', () => {
  const { read, root } = buildVault(VAULT);
  const landing = read('index.html');
  for (const name of ['Dock Fire', 'Vault Heist', 'Parley']) assert.ok(landing.includes(name), name);
  assert.match(landing, /href="events\/dock-fire\.html"/);
  fs.rmSync(root, { recursive: true, force: true });
});

// The CoC folio is light paper on any theme; its Story and Journey panels hold parts drawn
// in the site's colour names, which a dark theme makes pale.
test("the CoC sheet's Story and Journey panels read the site's colour names as the sheet's inks", () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'style.css'), 'utf8');
  const rule = css.match(/\.coc-sheet-root :is\(#p-story, #p-journey\)\{([^}]*)\}/);
  assert.ok(rule, 'the rule is there');
  for (const [name, ink] of [['--text', '--ink'], ['--text-muted', '--ink-soft'], ['--accent', '--oxblood'], ['--border', '--rule-soft'], ['--bg', '--box'], ['--bg-card', '--box']]) {
    assert.ok(rule[1].replace(/\s/g, '').includes(`${name}:var(${ink});`), `${name} stands for ${ink}`);
  }
});

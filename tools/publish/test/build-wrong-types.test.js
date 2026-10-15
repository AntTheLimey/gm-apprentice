const { describe, it } = require('node:test');
require('./helpers/quiet-legacy-warning.js');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { build } = require('../lib/build');
const { TEXT_FIELDS, LIST_FIELDS, RECORD_LIST_FIELDS } = require('../lib/frontmatter-shape');

// One note of every kind of page, each carrying `lines` in its frontmatter; built as a site.
// Returns what the build said and whether it finished.
const KINDS = {
  npc: 'People', pc: 'Heroes', creature: 'Creatures', location: 'Places', faction: 'Factions', item: 'Items',
  event: 'Events', clue: 'Clues', document: 'Documents', heritage: 'Heritages', session: 'Sessions', chapter: 'Chapters',
};
function buildWith(lines, { typed = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wrong-types-'));
  const vault = path.join(root, 'vault');
  const folders = [...new Set(Object.values(KINDS))];
  fs.mkdirSync(path.join(vault, '_meta'), { recursive: true });
  fs.writeFileSync(path.join(vault, '_meta', 'vault-config.md'),
    `---\npublish:\n  folder_map:\n${folders.map((f) => `    ${f}: ${f.toLowerCase()}\n`).join('')}---\n`);
  for (const [type, folder] of Object.entries(KINDS)) {
    fs.mkdirSync(path.join(vault, folder), { recursive: true });
    for (const n of [1, 2]) {
      const extra = type === 'pc' ? 'player_name: Pat\n' : type === 'session' ? `session_number: ${n}\n` : '';
      fs.writeFileSync(path.join(vault, folder, `${type}_${n}.md`),
        `---\n${typed ? `type: ${type}\n` : ''}${extra}${lines}\n---\n# Note\n\nOpenword. [[npc_1]] [[location_2]]\n`);
    }
  }
  const configPath = path.join(root, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({ vaultPath: vault, outputDir: path.join(root, 'docs'), attachmentsDir: '_attachments', siteTitle: 'T' }));
  const said = [];
  const { log, warn, error } = console;
  console.log = () => {};
  console.warn = (...a) => said.push(a.join(' '));
  console.error = (...a) => said.push(a.join(' '));
  let thrown = null;
  try { build({ configPath }); } catch (e) { thrown = e; } finally { Object.assign(console, { log, warn, error }); }
  const read = (...p) => fs.readFileSync(path.join(root, 'docs', ...p), 'utf8');
  return { said, thrown, read, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

const SHAPES = {
  'a list': (f) => `${f}:\n  - one\n  - two`,
  'named values': (f) => `${f}:\n  now: one\n  then: two`,
  'a list of named values': (f) => `${f}:\n  - a: one\n  - b: two`,
  'a list in a list': (f) => `${f}:\n  - - one\n    - two`,
  'a number': (f) => `${f}: 7`,
  'true': (f) => `${f}: true`,
  'a date': (f) => `${f}: 2024-03-04`,
  'plain words': (f) => `${f}: plain words`,
  'a list with a number, a date and an empty item': (f) => `${f}:\n  - 7\n  - 2024-03-04\n  -`,
  'a mixed list': (f) => `${f}:\n  - one\n  - now: two\n  - - three`,
};
const FIELDS = [...TEXT_FIELDS.filter((f) => f !== 'type'), ...Object.keys(LIST_FIELDS), ...RECORD_LIST_FIELDS];

describe('a frontmatter value of the wrong type does not stop the build', () => {
  for (const [name, write] of Object.entries(SHAPES)) {
    it(`${name} in every field read as text or as a list`, () => {
      const v = buildWith(FIELDS.map(write).join('\n'));
      try {
        assert.strictEqual(v.thrown, null, v.thrown && v.thrown.stack);
        assert.ok(v.read('people', 'npc-1.html').includes('Openword'));
      } finally { v.cleanup(); }
    });
    it(`${name} in type:`, () => {
      const v = buildWith(write('type'), { typed: false });
      try { assert.strictEqual(v.thrown, null, v.thrown && v.thrown.stack); } finally { v.cleanup(); }
    });
  }

  it('the three the tester found: a list in status, named values in status, named values in aliases', () => {
    for (const lines of ['status:\n  - alive\n  - missing', 'status:\n  now: alive', 'aliases:\n  short: Jon']) {
      const v = buildWith(lines);
      try { assert.strictEqual(v.thrown, null, `${lines}: ${v.thrown && v.thrown.message}`); } finally { v.cleanup(); }
    }
  });

  it('the build names the note and the field', () => {
    const v = buildWith('status:\n  - alive\n  - missing\naliases:\n  short: Jon');
    try {
      assert.ok(v.said.includes('scanner: Chapters/chapter_1.md — status: is a list where one value is expected; it is read as "alive, missing".'), v.said.join('\n'));
      assert.ok(v.said.includes('scanner: Chapters/chapter_1.md — aliases: is not a list, so it is not read; write it as a list, one item to a line.'), v.said.join('\n'));
    } finally { v.cleanup(); }
  });

  it('a vault with none says nothing of it', () => {
    const v = buildWith('status: alive\naliases:\n  - Jon\nrelationships:\n  - target: "[[npc_2]]"\n    type: knows');
    try {
      assert.strictEqual(v.thrown, null);
      assert.deepStrictEqual(v.said.filter((l) => /^scanner: .* — /.test(l)), []);
    } finally { v.cleanup(); }
  });

  it('a one-item list in status, or a list inside one, keeps a planned note off a player site, as the plain value does', () => {
    for (const lines of ['status: planned', 'status:\n  - planned', 'status: [[planned]]', 'status:\n  - [planned]']) {
      const v = buildWith(lines);
      try {
        assert.strictEqual(v.thrown, null);
        assert.throws(() => v.read('people', 'npc-1.html'), /ENOENT/, lines);
      } finally { v.cleanup(); }
    }
    const open = buildWith('status: alive');
    try { assert.ok(open.read('people', 'npc-1.html').includes('Openword')); } finally { open.cleanup(); }
  });
});

// tools/publish/test/integration/build-unparseable.test.js
const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const path = require('path'); const os = require('os');
const { build } = require('../../lib/build');

// #287: a note whose frontmatter is not valid YAML gets no page, and the only word of
// it was one scanner line above the whole `wrote …` list.
describe('build repeats the notes it could not parse in its closing warnings', () => {
  let root;
  let lines;

  function run(notes) {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-publish-unparseable-'));
    const vault = path.join(root, 'vault');
    fs.mkdirSync(path.join(vault, 'Characters', 'NPCs'), { recursive: true });
    fs.mkdirSync(path.join(vault, '_meta'), { recursive: true });
    fs.writeFileSync(path.join(vault, '_meta', 'vault-config.md'), '---\npublish:\n  mode: player\n---\n');
    for (const [name, text] of Object.entries(notes)) fs.writeFileSync(path.join(vault, 'Characters', 'NPCs', `${name}.md`), text);
    const configPath = path.join(root, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      vaultPath: vault, outputDir: path.join(root, 'docs'), attachmentsDir: '_attachments',
      siteTitle: 'Test', excludeDirs: ['_meta'], excludeSections: ['GM Notes'],
      folderMap: { 'Characters/NPCs': 'characters/npcs' },
    }));
    lines = [];
    const original = { warn: console.warn, log: console.log };
    console.warn = (...args) => lines.push(args.join(' '));
    console.log = (...args) => lines.push(args.join(' '));
    try { build({ configPath }); } finally { Object.assign(console, original); }
    return lines.filter(l => l.includes('whose frontmatter is not valid YAML'));
  }
  after(() => root && fs.rmSync(root, { recursive: true, force: true }));

  const good = '---\ntype: npc\n---\n\nA clerk.\n';
  const dup = '---\ntype: npc\nrole: clerk\nrole: spy\n---\n\nA clerk.\n';

  it('names each skipped file with the parser message, after the pages are written', () => {
    const warned = run({ Good: good, Dup: dup, Colon: '---\ntype: npc\nrole: a: b\n---\n\nA spy.\n' });
    assert.strictEqual(warned.length, 1, lines.join('\n'));
    assert.match(warned[0], /WARNING: the build skipped 2 notes whose frontmatter is not valid YAML/);
    assert.match(warned[0], /Characters\/NPCs\/Dup\.md \(duplicated mapping key/);
    assert.match(warned[0], /Characters\/NPCs\/Colon\.md \(/);
    assert.ok(!warned[0].includes('\n'), 'one line');
    const wrote = lines.map((l, i) => (/wrote /.test(l) ? i : -1)).filter(i => i >= 0).pop();
    assert.ok(lines.indexOf(warned[0]) > wrote, 'after the last wrote line');
    assert.ok(fs.existsSync(path.join(root, 'docs', 'characters', 'npcs', 'good.html')));
    assert.ok(!fs.existsSync(path.join(root, 'docs', 'characters', 'npcs', 'dup.html')));
  });

  it('counts past the first eight', () => {
    const notes = { Good: good };
    for (let i = 0; i < 10; i++) notes[`Dup${i}`] = dup;
    const warned = run(notes);
    assert.match(warned[0], /WARNING: the build skipped 10 notes /);
    assert.match(warned[0], /, and 2 more/);
  });

  it('says nothing when every note parses', () => {
    assert.deepStrictEqual(run({ Good: good }), []);
  });

  it('uses the singular for one note', () => {
    assert.match(run({ Good: good, Dup: dup })[0], /WARNING: the build skipped 1 note whose frontmatter/);
  });
});

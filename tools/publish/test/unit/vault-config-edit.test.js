const { editPublishBlock, setPublishKeys } = require('../../lib/vault-config-edit');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it } = require('node:test');

describe('editPublishBlock', () => {
  it('adds a key to an existing block and leaves every other byte alone', () => {
    const before = '---\ntype: meta\n# campaign settings\npublish:\n  mode: player   # players only\n  theme:\n    genre: horror\nsetting_year: 1923\n---\n\n# Notes\nbody\n';
    const { text } = editPublishBlock(before, { set: { inbox: true } });
    assert.strictEqual(text, '---\ntype: meta\n# campaign settings\npublish:\n  mode: player   # players only\n  theme:\n    genre: horror\n  inbox: true\nsetting_year: 1923\n---\n\n# Notes\nbody\n');
  });
  it('replaces a list key in place', () => {
    const before = '---\npublish:\n  exclude_dirs:\n    - _meta\n  mode: player\n---\n';
    const { text } = editPublishBlock(before, { set: { exclude_dirs: ['_meta', 'Secrets'] } });
    assert.strictEqual(text, '---\npublish:\n  exclude_dirs:\n    - _meta\n    - Secrets\n  mode: player\n---\n');
  });
  it('removes a nested key and its children', () => {
    const before = '---\npublish:\n  backend:\n    inbox: true\n    statusBar: false\n  mode: player\n---\n';
    assert.strictEqual(editPublishBlock(before, { remove: ['backend'] }).text, '---\npublish:\n  mode: player\n---\n');
  });
  it('creates the block when there is none', () => {
    assert.strictEqual(editPublishBlock('---\ntype: meta\n---\nbody\n', { set: { inbox: false } }).text, '---\ntype: meta\npublish:\n  inbox: false\n---\nbody\n');
  });
  it('keeps CRLF', () => {
    const { text } = editPublishBlock('---\r\npublish:\r\n  mode: player\r\n---\r\n', { set: { inbox: true } });
    assert.strictEqual(text, '---\r\npublish:\r\n  mode: player\r\n  inbox: true\r\n---\r\n');
  });
  it('follows a four-space block', () => {
    const { text } = editPublishBlock('---\npublish:\n    mode: player\n---\n', { set: { inbox: true } });
    assert.strictEqual(text, '---\npublish:\n    mode: player\n    inbox: true\n---\n');
  });
  for (const [name, input] of [
    ['flow-style publish', '---\npublish: {mode: player}\n---\n'],
    ['a tab inside the block', '---\npublish:\n\tmode: player\n---\n'],
    ['no closing fence', '---\npublish:\n  mode: player\n'],
    ['no frontmatter', '# just a note\n'],
    ['mixed line endings', '---\r\npublish:\n  mode: player\r\n---\r\n'],
    ['frontmatter that does not parse', '---\npublish:\n  mode: player\n  mode: gm\n---\n'],
  ]) {
    it(`refuses ${name} and returns no text`, () => {
      const out = editPublishBlock(input, { set: { inbox: true } });
      assert.ok(out.error, name);
      assert.strictEqual(out.text, undefined);
    });
  }
  it('is a no-op when the value is already there', () => {
    const before = '---\npublish:\n  inbox: true\n---\n';
    assert.strictEqual(editPublishBlock(before, { set: { inbox: true } }).text, before);
  });
  it('keeps a comment line directly above the next key when replacing', () => {
    const before = '---\npublish:\n  inbox: false   # off for now\n  # which mode\n  mode: player\n---\n';
    const { text } = editPublishBlock(before, { set: { inbox: true } });
    assert.strictEqual(text, '---\npublish:\n  inbox: true   # off for now\n  # which mode\n  mode: player\n---\n');
  });
  it('keeps a comment line directly above the next key when removing', () => {
    const before = '---\npublish:\n  backend:\n    inbox: true\n  # which mode\n  mode: player\n---\n';
    const { text } = editPublishBlock(before, { remove: ['backend'] });
    assert.strictEqual(text, '---\npublish:\n  # which mode\n  mode: player\n---\n');
  });
  it('appends when publish is the last key of the frontmatter', () => {
    const { text } = editPublishBlock('---\ntype: meta\npublish:\n  mode: player\n---\nbody\n', { set: { inbox: true } });
    assert.strictEqual(text, '---\ntype: meta\npublish:\n  mode: player\n  inbox: true\n---\nbody\n');
  });
  it('appends children to a publish key with a null value', () => {
    const { text } = editPublishBlock('---\npublish:\nsetting_year: 1923\n---\n', { set: { inbox: true } });
    assert.strictEqual(text, '---\npublish:\n  inbox: true\nsetting_year: 1923\n---\n');
  });
  it('writes a nested map at the child indent', () => {
    const { text } = editPublishBlock('---\npublish:\n    mode: player\n---\n', { set: { folder_map: { NPCs: 'npcs' } } });
    assert.strictEqual(text, '---\npublish:\n    mode: player\n    folder_map:\n      NPCs: npcs\n---\n');
  });
  it('replaces the last key in the block', () => {
    const before = '---\npublish:\n  mode: player\n  exclude_dirs:\n    - _meta\nsetting_year: 1923\n---\n';
    const { text } = editPublishBlock(before, { set: { exclude_dirs: ['Secrets'] } });
    assert.strictEqual(text, '---\npublish:\n  mode: player\n  exclude_dirs:\n    - Secrets\nsetting_year: 1923\n---\n');
  });
  it('keeps an inline comment when the value is unchanged', () => {
    const before = '---\npublish:\n  mode: player   # players only\n---\n';
    assert.strictEqual(editPublishBlock(before, { set: { mode: 'player' } }).text, before);
  });
  it('refuses a key that is both set and removed', () => {
    const out = editPublishBlock('---\npublish:\n  mode: player\n---\n', { set: { mode: 'gm' }, remove: ['mode'] });
    assert.ok(out.error);
    assert.strictEqual(out.text, undefined);
  });
  it('refuses a value that cannot be written', () => {
    const out = editPublishBlock('---\npublish:\n  mode: player\n---\n', { set: { x: undefined } });
    assert.ok(out.error);
    assert.strictEqual(out.text, undefined);
  });
});

describe('editPublishBlock edge cases', () => {
  const run = (before, changes) => editPublishBlock(before, changes);
  const scalar = '---\npublish:\n  footer: |\n    line one\n    # not a comment\n  mode: player\n---\n';
  const scalarLast = '---\npublish:\n  mode: player\n  footer: |\n    line one\n    # not a comment\nsetting_year: 1\n---\n';

  it('removes a block scalar whose last line starts with #', () => {
    assert.strictEqual(run(scalar, { remove: ['footer'] }).text, '---\npublish:\n  mode: player\n---\n');
  });
  it('replaces a block scalar whose last line starts with #', () => {
    assert.strictEqual(run(scalar, { set: { footer: 'x' } }).text, '---\npublish:\n  footer: x\n  mode: player\n---\n');
  });
  it('appends after a block scalar ending in a # line', () => {
    assert.strictEqual(run(scalarLast, { set: { inbox: true } }).text, '---\npublish:\n  mode: player\n  footer: |\n    line one\n    # not a comment\n  inbox: true\nsetting_year: 1\n---\n');
  });
  it('treats inbox and inbox_notes as different keys', () => {
    const before = '---\npublish:\n  inbox_notes: a\n  inbox: false\n---\n';
    assert.strictEqual(run(before, { set: { inbox: true } }).text, '---\npublish:\n  inbox_notes: a\n  inbox: true\n---\n');
    assert.strictEqual(run(before, { remove: ['inbox'] }).text, '---\npublish:\n  inbox_notes: a\n---\n');
    assert.strictEqual(run(before, { remove: ['inbox_notes'] }).text, '---\npublish:\n  inbox: false\n---\n');
  });
  it('finds double- and single-quoted keys', () => {
    assert.strictEqual(run('---\npublish:\n  "inbox": false\n---\n', { set: { inbox: true } }).text, '---\npublish:\n  inbox: true\n---\n');
    assert.strictEqual(run("---\npublish:\n  'inbox': false\n  mode: player\n---\n", { remove: ['inbox'] }).text, '---\npublish:\n  mode: player\n---\n');
  });
  it('ignores a key-looking line inside a block scalar', () => {
    const before = '---\npublish:\n  footer: |\n    inbox: true\n---\n';
    assert.strictEqual(run(before, { set: { inbox: false } }).text, '---\npublish:\n  footer: |\n    inbox: true\n  inbox: false\n---\n');
  });
  it('refuses a BOM before the opening fence', () => {
    const out = run('\uFEFF---\npublish:\n  mode: player\n---\n', { set: { inbox: true } });
    assert.ok(out.error);
    assert.strictEqual(out.text, undefined);
  });
  it('edits a publish: line that carries a comment', () => {
    assert.strictEqual(run('---\npublish: # settings\n  mode: player\n---\n', { set: { inbox: true } }).text, '---\npublish: # settings\n  mode: player\n  inbox: true\n---\n');
  });
  it('leaves a second --- in the body alone', () => {
    const body = '\nbody\n---\nmore\n';
    assert.strictEqual(run(`---\npublish:\n  mode: player\n---\n${body}`, { set: { inbox: true } }).text, `---\npublish:\n  mode: player\n  inbox: true\n---\n${body}`);
  });
  it('replaces and removes a sequence written at its key indent as a whole', () => {
    const before = '---\npublish:\n  exclude_dirs:\n  - _meta\n  - Secrets\n  mode: player\n---\n';
    assert.strictEqual(run(before, { set: { exclude_dirs: ['X'] } }).text, '---\npublish:\n  exclude_dirs:\n    - X\n  mode: player\n---\n');
    assert.strictEqual(run(before, { remove: ['exclude_dirs'] }).text, '---\npublish:\n  mode: player\n---\n');
  });
  it('leaves a bare (null) publish: when the only child is removed', () => {
    assert.strictEqual(run('---\ntype: meta\npublish:\n  backend:\n    inbox: true\n---\n', { remove: ['backend'] }).text, '---\ntype: meta\npublish:\n---\n');
  });
  it('refuses indented top-level keys with a plain reason', () => {
    const out = run('---\n  type: meta\n  publish:\n    mode: player\n---\n', { set: { inbox: true } });
    assert.match(out.error, /top-level keys are indented/);
  });
  it('refuses a quoted child key with a space before the colon, with the plain reason', () => {
    for (const key of ['"inbox" :', "'inbox'  :", 'inbox :']) {
      const out = editPublishBlock(`---\npublish:\n  ${key} true\n---\n`, { set: { inbox: false } });
      assert.strictEqual(out.error, 'the key "inbox" has a space before its colon', key);
    }
    assert.ok(editPublishBlock('---\npublish:\n  "inbox": true\n---\n', { set: { inbox: false } }).text);
  });
  it('refuses a child key written with a space before the colon', () => {
    const out = run('---\npublish:\n  inbox : false\n---\n', { set: { inbox: true } });
    assert.match(out.error, /space before its colon/);
  });
});

describe('setPublishKeys', () => {
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'vce-'));
  const cfg = (dir) => path.join(dir, '_meta', 'vault-config.md');

  it('creates the file with type: meta when absent', () => {
    const dir = tmp();
    assert.deepStrictEqual(setPublishKeys(dir, { inbox: true }), { changed: true });
    assert.strictEqual(fs.readFileSync(cfg(dir), 'utf8'), '---\ntype: meta\npublish:\n  inbox: true\n---\n');
    assert.deepStrictEqual(fs.readdirSync(path.join(dir, '_meta')), ['vault-config.md']);
  });
  it('throws with the reason and leaves the file byte-identical on refusal', () => {
    const dir = tmp();
    fs.mkdirSync(path.join(dir, '_meta'));
    const before = '---\npublish: {mode: player}\n---\n';
    fs.writeFileSync(cfg(dir), before);
    assert.throws(() => setPublishKeys(dir, { inbox: true }), /not written as a block/);
    assert.strictEqual(fs.readFileSync(cfg(dir), 'utf8'), before);
    assert.deepStrictEqual(fs.readdirSync(path.join(dir, '_meta')), ['vault-config.md']);
  });
  it('returns changed: false without rewriting when nothing changes', () => {
    const dir = tmp();
    fs.mkdirSync(path.join(dir, '_meta'));
    fs.writeFileSync(cfg(dir), '---\npublish:\n  inbox: true\n---\n');
    const old = new Date(2020, 0, 1);
    fs.utimesSync(cfg(dir), old, old);
    assert.deepStrictEqual(setPublishKeys(dir, { inbox: true }), { changed: false });
    assert.strictEqual(fs.statSync(cfg(dir)).mtimeMs, old.getTime());
  });
  it('applies removals', () => {
    const dir = tmp();
    fs.mkdirSync(path.join(dir, '_meta'));
    fs.writeFileSync(cfg(dir), '---\npublish:\n  backend:\n    inbox: true\n  mode: player\n---\n');
    assert.deepStrictEqual(setPublishKeys(dir, {}, ['backend']), { changed: true });
    assert.strictEqual(fs.readFileSync(cfg(dir), 'utf8'), '---\npublish:\n  mode: player\n---\n');
  });
});

describe('setPublishKeys write failure', () => {
  it('a failed rename leaves the file as it was and no temp file behind', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-vce-'));
    try {
      fs.mkdirSync(path.join(dir, '_meta'));
      const file = path.join(dir, '_meta', 'vault-config.md');
      const original = '---\npublish:\n  mode: player\n---\n';
      fs.writeFileSync(file, original);
      const failing = () => { throw new Error('rename refused'); };
      assert.throws(() => setPublishKeys(dir, { inbox: true }, [], { rename: failing }), /rename refused/);
      assert.strictEqual(fs.readFileSync(file, 'utf8'), original);
      assert.deepStrictEqual(fs.readdirSync(path.join(dir, '_meta')), ['vault-config.md']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('setPublishKeys keeps a symlink and the file mode', () => {
  it('writes through a symlinked vault-config.md and keeps its permission bits', { skip: process.platform === 'win32' }, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-vce-link-'));
    try {
      const real = path.join(dir, 'shared', 'real-config.md');
      fs.mkdirSync(path.dirname(real));
      fs.writeFileSync(real, '---\npublish:\n  mode: player\n---\n');
      fs.chmodSync(real, 0o640);
      fs.mkdirSync(path.join(dir, 'vault', '_meta'), { recursive: true });
      const link = path.join(dir, 'vault', '_meta', 'vault-config.md');
      fs.symlinkSync(real, link);
      assert.deepStrictEqual(setPublishKeys(path.join(dir, 'vault'), { inbox: true }), { changed: true });
      assert.ok(fs.lstatSync(link).isSymbolicLink(), 'still a symlink');
      assert.match(fs.readFileSync(real, 'utf8'), /^  inbox: true$/m);
      assert.strictEqual(fs.statSync(real).mode & 0o777, 0o640);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('fillUnset', () => {
  const { fillUnset } = require('../../lib/vault-config-edit');
  it('adds only what the existing map leaves unset, and returns null when nothing is added', () => {
    assert.deepStrictEqual(fillUnset({ genre: 'noir', tagline: '' }, { tagline: 'Hi', genre: 'x' }), { genre: 'noir', tagline: 'Hi' });
    assert.deepStrictEqual(fillUnset({}, { tagline: 'Hi' }), { tagline: 'Hi' });
    assert.strictEqual(fillUnset({ tagline: 'Mine' }, { tagline: 'Hi' }), null);
  });
});

describe('removals', () => {
  const edit = (before, removals) => editPublishBlock(before, { removals });
  it('removes one top-level key and touches no other byte', () => {
    const before = '---\npublish:\n  # who reads\n  mode: player   # players\n  connections: web\n  inbox: true\n---\nbody\n';
    assert.strictEqual(edit(before, [['connections']]).text, '---\npublish:\n  # who reads\n  mode: player   # players\n  inbox: true\n---\nbody\n');
  });
  it('removes a nested leaf and keeps its neighbours', () => {
    const before = '---\npublish:\n  theme:\n    genre: horror   # mood\n    tagline: Hi\n  mode: player\n---\n';
    assert.strictEqual(edit(before, [['theme', 'tagline']]).text, '---\npublish:\n  theme:\n    genre: horror   # mood\n  mode: player\n---\n');
  });
  it('removes a map it leaves empty, at every level', () => {
    const before = '---\npublish:\n  theme:\n    fonts:\n      source: self-host\n  mode: player\n---\n';
    assert.strictEqual(edit(before, [['theme', 'fonts', 'source']]).text, '---\npublish:\n  mode: player\n---\n');
  });
  it('rewrites a map written on one line, and removes it when it empties', () => {
    const before = '---\npublish:\n  theme: {genre: horror, tagline: Hi}\n  mode: player\n---\n';
    const out = edit(before, [['theme', 'tagline']]).text;
    assert.deepStrictEqual(require('../../lib/frontmatter').parseNote(out).data.publish, { theme: { genre: 'horror' }, mode: 'player' });
    assert.strictEqual(edit('---\npublish:\n  theme: {tagline: Hi}\n  mode: player\n---\n', [['theme', 'tagline']]).text, '---\npublish:\n  mode: player\n---\n');
  });
  it('leaves the text alone when the key is not there, or sits under something that is not a map', () => {
    const before = '---\npublish:\n  theme: dark\n  mode: player\n---\n';
    assert.strictEqual(edit(before, [['connections'], ['theme', 'genre']]).text, before);
    assert.strictEqual(edit('---\ntype: meta\n---\n', [['connections']]).text, '---\ntype: meta\n---\n');
  });
  it('removes several at once', () => {
    const before = '---\npublish:\n  a: 1\n  b: 2\n  c: 3\n---\n';
    assert.strictEqual(edit(before, [['a'], ['c']]).text, '---\npublish:\n  b: 2\n---\n');
  });
  it('removePublishLeaves writes the file, or changes nothing when the key is absent', () => {
    const { removePublishLeaves } = require('../../lib/vault-config-edit');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-vce-rm-'));
    try {
      fs.mkdirSync(path.join(dir, '_meta'));
      const file = path.join(dir, '_meta', 'vault-config.md');
      fs.writeFileSync(file, '---\npublish:\n  mode: player\n  inbox: true\n---\n');
      assert.deepStrictEqual(removePublishLeaves(dir, [['inbox']]), { changed: true });
      assert.strictEqual(fs.readFileSync(file, 'utf8'), '---\npublish:\n  mode: player\n---\n');
      assert.deepStrictEqual(removePublishLeaves(dir, [['inbox']]), { changed: false });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('a comment after a replaced scalar', () => {
  const { parseNote } = require('../../lib/frontmatter');
  const doc = (line) => `---\npublish:\n  mode: player\n${line}\n---\n`;
  const set = (line, key, value) => editPublishBlock(doc(line), { set: { [key]: value } });
  it('stays, with its spacing', () => {
    assert.strictEqual(set('  connections: tree  # keep it', 'connections', 'web').text, doc('  connections: web  # keep it'));
    assert.strictEqual(set('  connections: tree\t# tab', 'connections', 'web').text, doc('  connections: web\t# tab'));
  });
  it('stays through a leaf edit, in a nested map', () => {
    const before = '---\npublish:\n  theme:\n    genre: horror   # mood\n---\n';
    const { text } = editPublishBlock(before, { leaves: [{ path: ['theme', 'genre'], value: 'noir' }] });
    assert.strictEqual(text, '---\npublish:\n  theme:\n    genre: noir   # mood\n---\n');
  });
  it('is told from a # inside quotes or inside a word', () => {
    assert.strictEqual(set('  colour: "#aa3311"  # accent', 'colour', '#000000').text, doc("  colour: '#000000'  # accent"));
    assert.strictEqual(set("  colour: '#aa''3'  # accent", 'colour', 'x').text, doc('  colour: x  # accent'));
    assert.strictEqual(set('  tag: a#b', 'tag', 'c').text, doc('  tag: c'));
    assert.strictEqual(set('  colour: "#aa3311"', 'colour', 'x').text, doc('  colour: x'));
  });
  it('keeps what YAML itself reads as a comment: title: Room #4 holds "Room"', () => {
    assert.strictEqual(parseNote(doc('  title: Room #4')).data.publish.title, 'Room');
    assert.strictEqual(set('  title: Room #4', 'title', 'Hall').text, doc('  title: Hall #4'));
  });
  it('goes on the key line when a scalar becomes a list or a map', () => {
    const list = set('  connections: tree  # keep it', 'connections', ['a', 'b']).text;
    assert.strictEqual(list, doc('  connections:  # keep it\n    - a\n    - b'));
    assert.deepStrictEqual(parseNote(list).data.publish.connections, ['a', 'b']);
    const map = set('  connections: tree  # keep it', 'connections', { a: 1 }).text;
    assert.deepStrictEqual(parseNote(map).data.publish.connections, { a: 1 });
    assert.match(map, /# keep it/);
  });
  it('is carried over a flow list that is replaced, onto the key line', () => {
    assert.strictEqual(set('  x: [a, "b # c"]  # note', 'x', ['z']).text, doc('  x:  # note\n    - z'));
  });
  it('goes with its line on removal', () => {
    assert.strictEqual(editPublishBlock(doc('  connections: tree  # keep it'), { removals: [['connections']] }).text, '---\npublish:\n  mode: player\n---\n');
  });
});

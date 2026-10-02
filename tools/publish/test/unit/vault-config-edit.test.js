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
    assert.strictEqual(text, '---\npublish:\n  inbox: true\n  # which mode\n  mode: player\n---\n');
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

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

describe('setPublishKeys', () => {
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'vce-'));
  const cfg = (dir) => path.join(dir, '_meta', 'vault-config.md');

  it('creates the file with type: meta when absent', () => {
    const dir = tmp();
    assert.deepStrictEqual(setPublishKeys(dir, { inbox: true }), { changed: true });
    assert.strictEqual(fs.readFileSync(cfg(dir), 'utf8'), '---\ntype: meta\npublish:\n  inbox: true\n---\n');
  });
  it('throws with the reason and leaves the file byte-identical on refusal', () => {
    const dir = tmp();
    fs.mkdirSync(path.join(dir, '_meta'));
    const before = '---\npublish: {mode: player}\n---\n';
    fs.writeFileSync(cfg(dir), before);
    assert.throws(() => setPublishKeys(dir, { inbox: true }), /not written as a block/);
    assert.strictEqual(fs.readFileSync(cfg(dir), 'utf8'), before);
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

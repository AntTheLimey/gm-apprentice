const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ensureIgnored } = require('../../lib/gitignore');

describe('ensureIgnored', () => {
  let root;
  before(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-gitignore-')); });
  after(() => fs.rmSync(root, { recursive: true, force: true }));
  const site = (name, text) => {
    const dir = path.join(root, name);
    fs.mkdirSync(dir);
    if (text !== undefined) fs.writeFileSync(path.join(dir, '.gitignore'), text);
    return dir;
  };
  const read = (dir) => fs.readFileSync(path.join(dir, '.gitignore'), 'utf8');

  it('adds only the missing names, once, after a lead newline when the file needs one', () => {
    const dir = site('missing', 'node_modules/\n/.watcher-heartbeat');
    ensureIgnored(dir, ['.watcher-heartbeat', '.watcher-seen.json', 'cache/'], 'the files');
    ensureIgnored(dir, ['.watcher-heartbeat', '.watcher-seen.json', 'cache/'], 'the files');
    assert.strictEqual(read(dir), 'node_modules/\n/.watcher-heartbeat\n.watcher-seen.json\ncache/\n');
  });

  it('matches a name with or without its leading or trailing slash', () => {
    const dir = site('slashes', '/cache\n.watcher-seen.json/\n');
    ensureIgnored(dir, ['cache/', '.watcher-seen.json'], 'the files');
    assert.strictEqual(read(dir), '/cache\n.watcher-seen.json/\n');
  });

  it('keeps the file\'s CRLF line endings', () => {
    const dir = site('crlf', 'node_modules/\r\nsite/\r\n');
    ensureIgnored(dir, ['a', 'b'], 'the files');
    assert.strictEqual(read(dir), 'node_modules/\r\nsite/\r\na\r\nb\r\n');
  });

  it('makes no .gitignore where the site has none', () => {
    const dir = site('bare');
    ensureIgnored(dir, ['a'], 'the files');
    assert.ok(!fs.existsSync(path.join(dir, '.gitignore')));
  });

  it('warns once and carries on when the .gitignore cannot be written', (t) => {
    if (typeof process.getuid === 'function' && process.getuid() === 0) { t.skip('root can write a read-only file'); return; }
    const dir = site('locked', 'node_modules/\n');
    const file = path.join(dir, '.gitignore');
    fs.chmodSync(file, 0o444);
    const warnings = [];
    const saved = console.warn;
    console.warn = (...a) => warnings.push(a.join(' '));
    try { ensureIgnored(dir, ['a', 'b'], 'the watcher files'); } finally { console.warn = saved; }
    assert.strictEqual(warnings.length, 1);
    assert.ok(warnings[0].includes(file) && warnings[0].includes('the watcher files a b'), warnings[0]);
    assert.strictEqual(read(dir), 'node_modules/\n');
  });
});

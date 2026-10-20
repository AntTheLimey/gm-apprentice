const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// A page that fails to render: processContent is replaced before build.js takes its copy, and
// throws for the note titled Boom. (Each test file runs in its own process.)
const processor = require('../lib/processor');
const realProcessContent = processor.processContent;
processor.processContent = (page, ...rest) => {
  if (page.title === 'Boom') throw new Error('the page fell over');
  return realProcessContent(page, ...rest);
};
const { build } = require('../lib/build');

const made = [];
after(() => { for (const dir of made) fs.rmSync(dir, { recursive: true, force: true }); });

function site(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'build-report-'));
  made.push(root);
  const vault = path.join(root, 'vault');
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(vault, rel)), { recursive: true });
    fs.writeFileSync(path.join(vault, rel), text);
  }
  fs.mkdirSync(path.join(vault, '_meta'), { recursive: true });
  fs.writeFileSync(path.join(vault, '_meta', 'vault-config.md'), '---\npublish:\n  folder_map:\n    N: n\n---\n');
  const configPath = path.join(root, 'vault.config.json');
  fs.writeFileSync(configPath, JSON.stringify({ vaultPath: vault, outputDir: './docs', attachmentsDir: '_attachments', siteTitle: 'T', excludeDirs: ['_meta'] }));
  return configPath;
}

function run(configPath, options = {}) {
  const heard = [];
  const saved = { log: console.log, warn: console.warn, error: console.error };
  console.log = () => {};
  console.warn = (...a) => heard.push(a.join(' '));
  console.error = (...a) => heard.push(a.join(' '));
  let result = null;
  let thrown = null;
  try { result = build({ configPath, ...options }); } catch (e) { thrown = e; } finally { Object.assign(console, saved); }
  return { result, thrown, heard };
}

const GOOD = { 'N/Good.md': '---\ntype: npc\n---\n\nFine.\n' };
const BROKEN_YAML = { 'N/Bad.md': '---\ntype: npc\nname: [unclosed\n---\n\nx\n' };
const BOOM = { 'N/Boom.md': '---\ntype: npc\n---\n\nx\n' };

describe('build() returns what it reports (#426)', () => {
  it('a clean build returns empty renderErrors and warnings', () => {
    const { result, thrown } = run(site(GOOD));
    assert.strictEqual(thrown, null);
    assert.deepStrictEqual(result.renderErrors, []);
    assert.ok(Array.isArray(result.warnings));
  });

  it('warnings come back as text, without the WARNING prefix, and are still printed', () => {
    const { result, heard } = run(site({ ...GOOD, ...BROKEN_YAML }));
    const hit = result.warnings.filter((w) => /not valid YAML/.test(w));
    assert.strictEqual(hit.length, 1);
    assert.ok(!/^\s*WARNING:/.test(hit[0]));
    assert.ok(heard.some((l) => /WARNING: .*not valid YAML/.test(l)), 'still printed to the console');
  });

  it('an in-memory build returns its warnings too', () => {
    const { result, heard } = run(site({ ...GOOD, ...BROKEN_YAML }), { inMemory: true });
    assert.ok(result.warnings.some((w) => /not valid YAML/.test(w)));
    assert.deepStrictEqual(heard, [], 'the in-memory build stays quiet');
  });

  it('a render error is returned on the error that stops the build', () => {
    const { thrown, heard } = run(site({ ...GOOD, ...BOOM }));
    assert.ok(thrown, 'the build still throws');
    assert.strictEqual(thrown.errorCount, 1);
    assert.deepStrictEqual(thrown.renderErrors.length, 1);
    assert.match(thrown.renderErrors[0], /the page fell over/);
    assert.ok(Array.isArray(thrown.warnings));
    assert.ok(heard.some((l) => /ERROR rendering/.test(l)), 'still printed to the console');
  });

  it('the console is put back after a build, whether it succeeds or throws', () => {
    const before = console.warn;
    run(site(GOOD));
    run(site(BOOM));
    assert.strictEqual(console.warn, before);
  });
});

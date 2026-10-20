const { describe, it, after } = require('node:test');
require('./helpers/quiet-legacy-warning.js');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { build } = require('../lib/build');
const { noticeText } = require('../lib/notice');

// #428: a built site ships lunr.js and the generator's own CSS and JavaScript, so it carries
// the licence notices those ask for, in a NOTICE.txt at the site root.
const made = [];
after(() => { for (const dir of made) fs.rmSync(dir, { recursive: true, force: true }); });

function site(extraSettings = '') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'build-notice-'));
  made.push(root);
  const vault = path.join(root, 'vault');
  fs.mkdirSync(path.join(vault, 'N'), { recursive: true });
  fs.mkdirSync(path.join(vault, '_meta'), { recursive: true });
  fs.writeFileSync(path.join(vault, 'N', 'Vex.md'), '---\ntype: npc\n---\n\nA ferryman.\n');
  fs.writeFileSync(path.join(vault, '_meta', 'vault-config.md'), `---\npublish:\n  folder_map:\n    N: n\n${extraSettings}---\n`);
  const configPath = path.join(root, 'vault.config.json');
  fs.writeFileSync(configPath, JSON.stringify({ vaultPath: vault, outputDir: './docs', attachmentsDir: '_attachments', siteTitle: 'T', excludeDirs: ['_meta'] }));
  return { root, configPath };
}

function quietBuild(options) {
  const saved = { log: console.log, warn: console.warn };
  console.log = console.warn = () => {};
  try { return build(options); } finally { Object.assign(console, saved); }
}

describe('the built site carries the licence notices (#428)', () => {
  it('writes NOTICE.txt with the generator\'s and lunr\'s MIT notices when search ships', () => {
    const { root, configPath } = site();
    quietBuild({ configPath });
    assert.ok(fs.existsSync(path.join(root, 'docs', 'js', 'lunr.js')), 'the fixture ships lunr');
    const text = fs.readFileSync(path.join(root, 'docs', 'NOTICE.txt'), 'utf8');
    assert.match(text, /lunr/);
    assert.match(text, /Copyright \(C\) 2013 by Oliver Nightingale/);
    assert.match(text, /Copyright \(c\) 2026 AntTheLimey/);
    assert.equal((text.match(/Permission is hereby granted/g) || []).length, 2, 'the full MIT permission notice, once for each');
  });

  it('leaves lunr out of the notice when the site ships no search', () => {
    assert.doesNotMatch(noticeText({ lunr: false }), /Oliver Nightingale/);
    assert.match(noticeText({ lunr: false }), /AntTheLimey/);
  });

  it('writes nothing in an in-memory build', () => {
    const { root, configPath } = site();
    quietBuild({ configPath, inMemory: true });
    assert.ok(!fs.existsSync(path.join(root, 'docs')));
  });
});

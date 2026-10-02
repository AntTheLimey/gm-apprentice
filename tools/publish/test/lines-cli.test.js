const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { spawnSync } = require('child_process');
const { Readable } = require('stream');
const { runLines, answer, answerLine, siteDirPath } = require('../lib/lines-cli');
const { filterSections, keepOnlySections, playerSafeMarkdown } = require('../lib/processor');

const BIN = path.join(__dirname, '..', 'bin', 'gm-publish.js');
const NOTE = '# T\nintro <!-- gm-only -->aside<!-- /gm-only -->\n## Overview\npublic\n## GM Notes\nsecret\n```\n## Example\n```\nstill secret\n## Next\nmore';

describe('lines: published', () => {
  it('is the build\'s own strip chain', () => {
    const got = answer({ op: 'published', text: NOTE, excludeSections: ['GM Notes'] });
    assert.strictEqual(got.text, playerSafeMarkdown(NOTE, { excludeSections: ['GM Notes'] }).text);
    assert.ok(!got.text.includes('secret') && !got.text.includes('aside') && got.text.includes('more'));
  });
  it('a stub page is reduced to its included sections first', () => {
    const got = answer({ op: 'published', text: NOTE, excludeSections: ['GM Notes'], publish: 'stub', include: ['Overview'] });
    assert.strictEqual(got.text, '## Overview\npublic');
  });
  it('a stub with no list, and publish none, publish nothing', () => {
    assert.strictEqual(answer({ op: 'published', text: NOTE, excludeSections: [], publish: 'stub', include: [] }).text, '');
    assert.strictEqual(answer({ op: 'published', text: NOTE, excludeSections: [], publish: 'none' }).text, '');
  });
  it('a missing or malformed list is refused, never read as "nothing withheld"', () => {
    assert.throws(() => answer({ op: 'published', text: '## GM Notes\nx' }), /excludeSections must be a list of strings/);
    assert.throws(() => answer({ op: 'sections', text: '## GM Notes\nx' }), /excludeSections must be a list of strings/);
    assert.throws(() => answer({ op: 'stub', text: 'x' }), /include must be a list of strings/);
    assert.throws(() => answer({ op: 'published', text: 'x', excludeSections: [], publish: 'stub' }), /include must be a list of strings/);
    assert.throws(() => answer({ op: 'published', text: 'x', excludeSections: 'GM Notes' }), /excludeSections must be a list of strings/);
    assert.throws(() => answer({ op: 'sections', text: 'x', excludeSections: [7] }), /excludeSections must be a list of strings/);
    assert.throws(() => answer({ op: 'stub', text: 'x', include: 'Overview' }), /include must be a list of strings/);
    assert.throws(() => answer({ op: 'sections', text: null, excludeSections: [] }), /text must be a string/);
    assert.throws(() => answer({ op: 'sections', excludeSections: [] }), /text must be a string/);
    assert.throws(() => answer({ op: 'published', text: 'x', publish: 'STUB' }), /publish must be all, stub or none/);
  });
});

describe('lines: sections', () => {
  it('names the section withholding each line', () => {
    const { withheldBy } = answer({ op: 'sections', text: NOTE, excludeSections: ['gm notes'] });
    const lines = NOTE.split('\n');
    assert.strictEqual(withheldBy.length, lines.length);
    assert.deepStrictEqual(lines.filter((_, i) => withheldBy[i] === null).join('\n'), filterSections(NOTE, ['GM Notes']));
    assert.strictEqual(withheldBy[lines.indexOf('still secret')], 'GM Notes');
    assert.strictEqual(withheldBy[lines.indexOf('## Next')], null);
  });
  it('a nested excluded heading does not rename the running section', () => {
    const { withheldBy } = answer({ op: 'sections', text: '## GM Notes\n### Secrets\nx', excludeSections: ['GM Notes', 'Secrets'] });
    assert.deepStrictEqual(withheldBy, ['GM Notes', 'GM Notes', 'GM Notes']);
  });
});

describe('lines: stub', () => {
  it('flags the lines keepOnlySections keeps', () => {
    const { kept } = answer({ op: 'stub', text: NOTE, include: ['overview'] });
    assert.strictEqual(NOTE.split('\n').filter((_, i) => kept[i]).join('\n'), keepOnlySections(NOTE, ['Overview']));
  });
  it('no list keeps nothing', () => {
    assert.ok(answer({ op: 'stub', text: NOTE, include: [] }).kept.every((k) => k === false));
  });
});

describe('lines: site', () => {
  const fs = require('fs');
  const os = require('os');
  const vaultWith = (config) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lines-site-'));
    if (config !== null) {
      fs.mkdirSync(path.join(dir, '_meta'));
      fs.writeFileSync(path.join(dir, '_meta', 'vault-config.md'), config);
    }
    return dir;
  };
  const ask = (config) => {
    const vault = vaultWith(config);
    try { return { vault, got: answer({ op: 'site', vault }) }; } finally { fs.rmSync(vault, { recursive: true, force: true }); }
  };

  it('no file, and a file with no publish block, publish nothing', () => {
    assert.deepStrictEqual(ask(null).got, { publishes: false, site: false, siteDir: null });
    assert.deepStrictEqual(ask('---\ntype: meta\n---\n').got, { publishes: false, site: false, siteDir: null });
    assert.deepStrictEqual(ask('---\npublish:\n---\n').got, { publishes: false, site: false, siteDir: null });
  });
  it('reads the block however YAML allows it to be written', () => {
    for (const config of [
      '---\npublish:\n  mode: player\n---\n',
      '\ufeff---\npublish:\n  mode: player\n---\n',
      '---\n"publish":\n  mode: player\n---\n',
      '---\n  publish:\n    mode: player\n---\n',
      '---\n? publish\n: {mode: player}\n---\n',
      '---\n{publish: {mode: player}}\n---\n',
      '---\npublish: {mode: player}\n---\n',
    ]) {
      assert.deepStrictEqual(ask(config).got, { publishes: true, site: false, siteDir: null }, JSON.stringify(config));
    }
  });
  it('the switch decides: off is no site whatever site_dir says, on with no folder is a site to set up', () => {
    const dir = path.resolve(os.tmpdir(), 'a-site').replace(/\\/g, '/');
    const cfg = (lines) => `---\npublish:\n${lines.map((l) => `  ${l}\n`).join('')}---\n`;
    assert.deepStrictEqual(ask(cfg(['site: false', `site_dir: "${dir}"`])).got, { publishes: true, site: false, siteDir: null });
    assert.deepStrictEqual(ask(cfg(['site: off', 'site_dir: [not, a, path]'])).got, { publishes: true, site: false, siteDir: null });
    assert.deepStrictEqual(ask(cfg(['site: maybe', `site_dir: "${dir}"`])).got, { publishes: true, site: false, siteDir: null });
    assert.deepStrictEqual(ask(cfg(['site: true'])).got, { publishes: true, site: true, siteDir: null });
    assert.deepStrictEqual(ask(cfg(['site: true', 'site_dir:'])).got, { publishes: true, site: true, siteDir: null });
    assert.deepStrictEqual(ask(cfg(['site: yes', `site_dir: "${dir}"`])).got, { publishes: true, site: true, siteDir: path.resolve(dir) });
    // A site_dir that names nothing is no site_dir, as the build reads it.
    assert.deepStrictEqual(ask(cfg(['site_dir: "  "'])).got, { publishes: true, site: false, siteDir: null });
    assert.deepStrictEqual(ask(cfg(['site_dir: 5'])).got, { publishes: true, site: false, siteDir: null });
    assert.deepStrictEqual(ask(cfg(['site_dir: [a]'])).got, { publishes: true, site: false, siteDir: null });
    assert.deepStrictEqual(ask(cfg(['site: true', 'site_dir: "  "'])).got, { publishes: true, site: true, siteDir: null });
    // Unset, in a vault written before the switch: a site_dir says on.
    assert.deepStrictEqual(ask(cfg([`site_dir: "${dir}"`])).got, { publishes: true, site: true, siteDir: path.resolve(dir) });
  });
  it('resolves site_dir against the vault, and ~ against the home folder', () => {
    const abs = path.resolve(os.tmpdir(), 'some site');
    assert.strictEqual(ask(`---\npublish:\n  site_dir: "${abs.replace(/\\/g, '/')}"\n---\n`).got.siteDir, abs);
    const rel = ask('---\npublish:\n  site_dir: ../site\n---\n');
    assert.strictEqual(rel.got.siteDir, path.resolve(rel.vault, '../site'));
    assert.strictEqual(ask('---\npublish:\n  site_dir: ~/site\n---\n').got.siteDir, path.join(os.homedir(), 'site'));
    // On Windows a home-folder path is written ~\site as well.
    if (process.platform === 'win32') assert.strictEqual(siteDirPath('C:\\v', '~\\site'), path.join(os.homedir(), 'site'));
    assert.strictEqual(siteDirPath('/v', '  ~/site '), path.join(os.homedir(), 'site'));
  });
  it('a file that cannot be parsed, or a block that is not one, is an error, not a "no"', () => {
    assert.throws(() => ask('---\npublish:\n  a: 1\npublish:\n  b: 2\n---\n'), /not valid YAML/);
    assert.throws(() => ask('---\npublish: yes please\n---\n'), /not a block of settings/);
    assert.throws(() => ask('---\npublish:\n  site: true\n  site_dir: [a]\n---\n'), /site_dir .* is not a path/);
    assert.throws(() => answer({ op: 'site' }), /vault must be a path/);
  });
});

describe('lines: the protocol', () => {
  it('a bad request is answered with an error, not a crash', () => {
    assert.match(JSON.parse(answerLine('not json')).error, /JSON/);
    assert.match(JSON.parse(answerLine('{"op":"nope","text":""}')).error, /unknown op/);
    assert.match(JSON.parse(answerLine('[]')).error, /JSON object/);
    assert.match(JSON.parse(answerLine('7')).error, /JSON object/);
  });
  it('answers each line in order and resolves when the input closes', async () => {
    const out = [];
    const rc = await runLines({
      input: Readable.from([Buffer.from('{"op":"stub","text":"## A","include":["a"]}\n\nbroken\n{"op":"published","text":"x","excludeSections":[]}\n')]),
      write: (s) => out.push(s),
    });
    assert.strictEqual(rc, 0);
    const answers = out.join('').trim().split('\n').map((l) => JSON.parse(l));
    assert.deepStrictEqual(answers.map((a) => Object.keys(a)[0]), ['kept', 'error', 'text']);
  });
  it('a line separator inside a request does not split it', async () => {
    const out = [];
    await runLines({
      input: Readable.from([Buffer.from('{"op":"sections","text":"a\u2028b\u2029c","excludeSections":[]}\r\n{"op":"stub","text":"x","include":[]}')]),
      write: (s) => out.push(s),
    });
    const answers = out.join('').trim().split('\n').map((l) => JSON.parse(l));
    assert.deepStrictEqual(answers, [{ withheldBy: [null] }, { kept: [false] }]);
  });
  it('a multi-byte character split across two chunks is read whole', async () => {
    const bytes = Buffer.from('{"op":"published","excludeSections":[],"text":"caf\u00e9"}\n');
    assert.ok(bytes.indexOf(0xc3) > 30 && bytes[bytes.indexOf(0xc3) + 1] === 0xa9);
    const out = [];
    const mid = bytes.indexOf(0xc3) + 1;   // between the two bytes of the e-acute
    await runLines({ input: Readable.from([bytes.subarray(0, mid), bytes.subarray(mid)]), write: (s) => out.push(s) });
    assert.strictEqual(JSON.parse(out.join('')).text, 'caf\u00e9');
  });
  it('runs from the command line', () => {
    const run = spawnSync(process.execPath, [BIN, 'lines'], {
      input: '{"op":"sections","text":"## GM Notes\\nx","excludeSections":["GM Notes"]}\n', encoding: 'utf8',
    });
    assert.strictEqual(run.status, 0);
    assert.deepStrictEqual(JSON.parse(run.stdout), { withheldBy: ['GM Notes', 'GM Notes'] });
  });
  it('refuses arguments', () => {
    const run = spawnSync(process.execPath, [BIN, 'lines', '--config', 'x'], { input: '', encoding: 'utf8' });
    assert.strictEqual(run.status, 1);
    assert.match(run.stderr, /lines takes no arguments/);
  });
});

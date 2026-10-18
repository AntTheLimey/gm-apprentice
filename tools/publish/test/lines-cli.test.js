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

describe('lines: withheld (links.py asks it, so the two never read the flag two ways, #352)', () => {
  const { isWithheld } = require('../lib/processor');
  it('reads the flag with the build\'s YAML reader: every number spelling YAML makes 1 is a yes', () => {
    for (const value of ['true', '1', '0x1', '0b1', '1e0', '1.0e0', 'yes', '"on"']) {
      assert.strictEqual(answer({ op: 'withheld', text: `---\nwithheld: ${value}\n---\nx` }).withheld, true, value);
    }
    for (const value of ['false', '0', '"0x1"', '2', 'tru', '[true]']) {
      assert.strictEqual(answer({ op: 'withheld', text: `---\nwithheld: ${value}\n---\nx` }).withheld, false, value);
    }
    assert.strictEqual(answer({ op: 'withheld', text: '---\nwithheld : true\n---\nx' }).withheld, isWithheld({ withheld: true }));
  });
  it('gives the names the note answers to, and refuses a note whose frontmatter cannot be read', () => {
    const got = answer({ op: 'withheld', text: '---\nwithheld: true\ntitle: "[[X|The Ferryman]]"\naliases: Old Nick\ngm_aliases: [Vesper]\n---\n' });
    assert.deepStrictEqual(got, { withheld: true, names: ['The Ferryman', 'Old Nick', 'Vesper'] });
    assert.match(JSON.parse(answerLine(JSON.stringify({ op: 'withheld', text: '---\nwithheld: [\n---\n' }))).error, /cannot be read/);
  });
});

describe('lines: cut', () => {
  it('gives each line as the strip chain leaves it, null when the chain removes it', () => {
    const text = 'a %%x%% b\n%%\nhidden\n%%\n<!-- c -->\nkept\n<!-- gm-only -->\nsecret\n<!-- /gm-only -->\nend';
    const { cut } = answer({ op: 'cut', text });
    assert.deepStrictEqual(cut, ['a  b', null, null, null, null, 'kept', '', null, null, 'end']);
  });
  it('is the build\'s own strip chain: fenced code is kept, a comment in indented code is cut', () => {
    const { cut } = answer({ op: 'cut', text: '```\n%%x\n```\n    %%y%%' });
    assert.deepStrictEqual(cut, ['```', '%%x', '```', null]);
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

describe('lines: a fenced heading is code', () => {
  it('a heading-shaped line in a closed fence neither starts nor ends a withheld section', () => {
    const text = '## Open\n```\n## GM Notes\n```\nprose\n## GM Notes\nsecret\n```\n## Other\n```\nstill secret\n## Next\npublic';
    const { withheldBy } = answer({ op: 'sections', text, excludeSections: ['GM Notes'] });
    const lines = text.split('\n');
    assert.deepStrictEqual(lines.filter((_, i) => withheldBy[i] === null),
      ['## Open', '```', '## GM Notes', '```', 'prose', '## Next', 'public']);
    const published = answer({ op: 'published', text, excludeSections: ['GM Notes'] }).text;
    assert.ok(published.includes('prose') && !published.includes('secret'));
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
  it('does not keep an included title under a withheld section, or inside a hidden block (#320)', () => {
    const text = '## Overview\npublic\n## GM Notes\n### Overview\nsecret\n<!-- spoiler -->\n## Overview\nlater\n<!-- /spoiler -->';
    const lines = text.split('\n');
    const named = answer({ op: 'stub', text, include: ['Overview'], excludeSections: ['GM Notes'] }).kept;
    assert.deepStrictEqual(lines.filter((_, i) => named[i]), ['## Overview', 'public']);
    assert.strictEqual(answer({ op: 'published', text, excludeSections: ['GM Notes'], publish: 'stub', include: ['Overview'] }).text, '## Overview\npublic');
    assert.throws(() => answer({ op: 'stub', text, include: [], excludeSections: 'GM Notes' }), /excludeSections must be a list of strings/);
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
  it('on the new file, a stray top-level publish names player_site, not "publish:"', () => {
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'lines-site-'));
    try {
      fs.mkdirSync(path.join(vault, '_meta'));
      const file = path.join(vault, '_meta', 'vault-config.yaml');
      fs.writeFileSync(file, 'version: 1\npublish:\n  site: true\n');
      assert.throws(() => answer({ op: 'site', vault }), (e) => /vault-config\.yaml is not a setting; the site's settings go under player_site/.test(e.message) && !/publish:/.test(e.message));
      fs.writeFileSync(file, 'version: 1\nplayer_site:\n  publish: true\n  folder: ../site\n');
      assert.deepStrictEqual(answer({ op: 'site', vault }), { publishes: true, site: true, siteDir: path.resolve(vault, '../site') });
    } finally { fs.rmSync(vault, { recursive: true, force: true }); }
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

describe('lines: google-fonts', () => {
  const fs = require('fs');
  const os = require('os');
  const cases = {
    'a genre and google fonts': 'theme:\n    genre: gothic\n    fonts:\n      heading: Cinzel\n      body: Lora\n',
    'self-hosted fonts': 'theme:\n    genre: gothic\n    fonts:\n      source: self-host\n      heading: Cinzel\n',
    'no theme': 'mode: player\n',
  };
  for (const [name, publish] of Object.entries(cases)) {
    it(`gives the google fonts: ${name}`, () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-'));
      try {
        const vault = path.join(root, 'vault');
        fs.mkdirSync(path.join(vault, '_meta'), { recursive: true });
        fs.writeFileSync(path.join(vault, '_meta', 'vault-config.md'), `---\ntype: meta\npublish:\n  ${publish.replace(/\n(?=.)/g, '\n  ')}---\n`);
        const asked = answer({ op: 'google-fonts', vault });
        if (name === 'self-hosted fonts' || name === 'no theme') assert.ok(Array.isArray(asked.families));
        if (name === 'a genre and google fonts') assert.ok(asked.families.includes('Cinzel') && asked.families.includes('Lora'));
        if (name === 'self-hosted fonts') assert.deepStrictEqual(asked.families, []);
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    });
  }

  it('refuses a request without a vault', () => {
    assert.throws(() => answer({ op: 'google-fonts' }), /vault must be a path/);
  });
});

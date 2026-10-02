const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { spawnSync } = require('child_process');
const { Readable } = require('stream');
const { runLines, answer, answerLine } = require('../lib/lines-cli');
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
    assert.strictEqual(answer({ op: 'published', text: NOTE, publish: 'stub' }).text, '');
    assert.strictEqual(answer({ op: 'published', text: NOTE, publish: 'none' }).text, '');
  });
  it('a missing or malformed list is no list', () => {
    assert.strictEqual(answer({ op: 'published', text: '## GM Notes\nx', excludeSections: 'GM Notes' }).text, '## GM Notes\nx');
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
    assert.ok(answer({ op: 'stub', text: NOTE }).kept.every((k) => k === false));
  });
});

describe('lines: the protocol', () => {
  it('a bad request is answered with an error, not a crash', () => {
    assert.match(JSON.parse(answerLine('not json')).error, /JSON/);
    assert.match(JSON.parse(answerLine('{"op":"nope"}')).error, /unknown op/);
    assert.match(JSON.parse(answerLine('7')).error, /JSON object/);
  });
  it('answers each line in order and resolves when the input closes', async () => {
    const out = [];
    const rc = await runLines({
      input: Readable.from(['{"op":"stub","text":"## A","include":["a"]}\n\nbroken\n{"op":"published","text":"x"}\n']),
      write: (s) => out.push(s),
    });
    assert.strictEqual(rc, 0);
    const answers = out.join('').trim().split('\n').map((l) => JSON.parse(l));
    assert.deepStrictEqual(answers.map((a) => Object.keys(a)[0]), ['kept', 'error', 'text']);
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

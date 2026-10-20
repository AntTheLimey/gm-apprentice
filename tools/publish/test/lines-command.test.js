// The `lines` command's `command` op: `settings` and `explain --all` answered inside the kept-open
// process, as a run of their own would answer them, reading every file again for each question.
const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { Readable } = require('stream');
const { runLines } = require('../lib/lines-cli');

const BIN = path.join(__dirname, '..', 'bin', 'gm-publish.js');
const made = [];
after(() => { for (const dir of made) fs.rmSync(dir, { recursive: true, force: true }); });

function tmp(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  made.push(dir);
  return dir;
}

function write(root, rel, body) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
}

function makeVault(title = 'One') {
  const vault = tmp('lines-command-vault-');
  write(vault, '_meta/vault-config.yaml', `player_site:\n  publish: true\n  title: ${title}\n`);
  write(vault, 'Sessions/Session_07.md', '---\ntype: session\nsession_number: 7\nstatus: played\n---\n\n## GM Notes\n\nx\n');
  return vault;
}

function siteFor(vault) {
  const configPath = path.join(tmp('lines-command-site-'), 'vault.config.json');
  fs.writeFileSync(configPath, JSON.stringify({ siteTitle: 'T', vaultPath: vault, outputDir: './docs', folderMap: { Sessions: 'sessions' } }));
  return configPath;
}

// The requests in one process, their answers parsed.
async function ask(...requests) {
  const out = [];
  await runLines({ input: Readable.from([Buffer.from(requests.map((r) => `${JSON.stringify(r)}\n`).join(''))]), write: (s) => out.push(s) });
  return out.join('').trim().split('\n').map((line) => JSON.parse(line));
}

// `gm-publish <args>` run on its own.
function alone(args, cwd) {
  const done = spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', cwd });
  return { rc: done.status, stdout: done.stdout, stderr: done.stderr };
}

describe('lines: command', () => {
  it('answers as a run of its own does, for answers and refusals alike', async () => {
    const vault = makeVault();
    const config = siteFor(vault);
    const cases = [
      ['settings', 'get', '--vault', vault, '--no-site-file', '--json'],
      ['settings', 'get', '--vault', vault, '--config', config, 'player_site.title', '--json'],
      ['settings', 'raw', '--vault', vault, '--no-site-file', '--json'],
      ['settings', 'describe', 'player_site.title', '--json'],
      ['settings', 'describe', 'no.such.setting', '--json'],
      ['settings', 'set', '--vault', vault, '--no-site-file', 'player_site.nonsense=1', '--json'],
      ['settings', 'get', '--bogus'],
      ['explain', '--all', '--json', '--config', config, '--vault', vault],
      ['explain', '--all', '--json', '--config', path.join(vault, 'missing.json'), '--vault', vault],
    ];
    const answers = await ask(...cases.map((args) => ({ op: 'command', args })));
    cases.forEach((args, i) => {
      const own = alone(args);
      // A parse error prints the help after its line on a run of its own; the line is the same.
      if (args.includes('--bogus')) {
        assert.strictEqual(answers[i].rc, own.rc);
        assert.strictEqual(answers[i].stderr, own.stderr.split('\n')[0] + '\n');
        return;
      }
      assert.deepStrictEqual(answers[i], own, args.join(' '));
    });
    assert.ok(JSON.parse(answers[7].stdout).pages.some((p) => p.path === 'Sessions/Session_07.md'));
  });

  it('reads the files again for every question: a change between two is seen', async () => {
    const vault = makeVault('One');
    const get = { op: 'command', args: ['settings', 'get', '--vault', vault, '--no-site-file', 'player_site.title', '--json'] };
    const out = [];
    const input = new Readable({ read() {} });
    const done = runLines({ input, write: (s) => out.push(JSON.parse(s)) });
    const answered = (n) => new Promise((resolve) => { const t = setInterval(() => { if (out.length >= n) { clearInterval(t); resolve(); } }, 5); });
    input.push(`${JSON.stringify(get)}\n`);
    await answered(1);
    write(vault, '_meta/vault-config.yaml', 'player_site:\n  publish: true\n  title: Two\n');
    input.push(`${JSON.stringify(get)}\n`);
    await answered(2);
    write(vault, 'Sessions/Session_08.md', '---\ntype: session\nsession_number: 8\nstatus: played\n---\n');
    input.push(`${JSON.stringify({ op: 'command', args: ['explain', '--all', '--json', '--config', siteFor(vault), '--vault', vault] })}\n`);
    input.push(null);
    await done;
    assert.strictEqual(JSON.parse(out[0].stdout).values['player_site.title'], 'One');
    assert.strictEqual(JSON.parse(out[1].stdout).values['player_site.title'], 'Two');
    assert.ok(JSON.parse(out[2].stdout).pages.some((p) => p.path === 'Sessions/Session_08.md'));
  });

  it('runs in the folder and with the environment it is given, and puts its own back', async () => {
    const vault = makeVault('Here');
    const before = process.cwd();
    const [answer] = await ask({ op: 'command', args: ['settings', 'get', '--vault', '.', '--no-site-file', 'player_site.title', '--json'], cwd: vault, env: { ...process.env, GM_LINES_TEST: 'x' } });
    assert.strictEqual(JSON.parse(answer.stdout).values['player_site.title'], 'Here');
    assert.strictEqual(process.cwd(), before);
    assert.strictEqual(process.env.GM_LINES_TEST, undefined);
  });

  it('keeps answers in the order asked around a command, and refuses any other command', async () => {
    const vault = makeVault();
    const answers = await ask(
      { op: 'cut', text: 'a' },
      { op: 'command', args: ['explain', '--all', '--json', '--config', siteFor(vault), '--vault', vault] },
      { op: 'cut', text: 'b' },
      { op: 'command', args: ['build'] },
      { op: 'command', args: ['explain', 'Sessions/Session_07.md'] },
    );
    assert.deepStrictEqual(answers[0].cut, ['a']);
    assert.strictEqual(answers[1].rc, 0);
    assert.deepStrictEqual(answers[2].cut, ['b']);
    assert.match(answers[3].error, /command runs settings or explain --all/);
    assert.match(answers[4].error, /command runs settings or explain --all/);
  });
});

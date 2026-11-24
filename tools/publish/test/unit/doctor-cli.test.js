const { describe, it } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { runDoctor } = require('../../lib/doctor-cli');

const WHOAMI_OK = 'Account ID\n│ x │ a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6 │\n';

function wranglerAllGood() {
  return (cmd, args) => {
    const a = args || [];
    if (cmd === 'git') return { code: 0, stdout: 'git version 2.44.0\n', stderr: '' };
    if (cmd === 'npx' && a[1] === '--version') return { code: 0, stdout: 'wrangler 4.20.0\n', stderr: '' };
    if (cmd === 'npx' && a[1] === 'whoami') return { code: 0, stdout: WHOAMI_OK, stderr: '' };
    return { code: 1, stdout: '', stderr: '' };
  };
}

describe('runDoctor default report', () => {
  it('--json emits machine-readable state and returns 0 when all required green', async () => {
    const lines = [];
    const rc = await runDoctor(['--json', '--host', 'cloudflare-pages'], {
      out: (s) => lines.push(s), runCommand: wranglerAllGood(), env: {}, nodeVersion: 'v22.5.0',
    });
    const parsed = JSON.parse(lines.join('\n'));
    assert.strictEqual(parsed.wrangler.accountId, 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6');
    assert.strictEqual(parsed.ok, true);
    assert.strictEqual(rc, 0);
  });

  it('returns 1 and names a fix when a required tool is missing', async () => {
    const lines = [];
    const rc = await runDoctor([], {
      out: (s) => lines.push(s),
      runCommand: () => ({ code: 1, stdout: '', stderr: 'not found' }),
      env: {}, nodeVersion: 'v22.5.0',
    });
    assert.strictEqual(rc, 1);
    assert.ok(lines.join('\n').includes('nodejs.org') || lines.join('\n').toLowerCase().includes('token'));
  });
});

describe('runDoctor --set-cloudflare-creds', () => {
  it('writes token + derived account id to the shell file, never echoes the token, verifies', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-doc-'));
    const lines = [];
    const env = { SHELL: '/bin/bash' };
    const rc = await runDoctor(['--set-cloudflare-creds'], {
      out: (s) => lines.push(String(s)),
      runCommand: wranglerAllGood(),
      readStdin: async () => 'super-secret-token\n',
      env, platform: 'linux', homedir: dir,
    });
    const written = fs.readFileSync(path.join(dir, '.bashrc'), 'utf8');
    assert.ok(written.includes('export CLOUDFLARE_API_TOKEN="super-secret-token"'), 'token written to file');
    assert.ok(written.includes('export CLOUDFLARE_ACCOUNT_ID="a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6"'), 'account id written');
    assert.ok(!lines.join('\n').includes('super-secret-token'), 'token NEVER printed');
    assert.strictEqual(rc, 0);
  });

  it('empty token → error, no write, return 1', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-doc2-'));
    const rc = await runDoctor(['--set-cloudflare-creds'], {
      out: () => {}, runCommand: wranglerAllGood(), readStdin: async () => '   \n',
      env: { SHELL: '/bin/bash' }, platform: 'linux', homedir: dir,
    });
    assert.strictEqual(rc, 1);
    assert.ok(!fs.existsSync(path.join(dir, '.bashrc')), 'nothing written on empty token');
  });

  it('token with shell metacharacters → rejected, no write, not echoed, return 1', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-doc3-'));
    const lines = [];
    const evil = 'x";$(rm -rf ~);"';
    const rc = await runDoctor(['--set-cloudflare-creds'], {
      out: (s) => lines.push(String(s)), runCommand: wranglerAllGood(),
      readStdin: async () => evil + '\n',
      env: { SHELL: '/bin/bash' }, platform: 'linux', homedir: dir,
    });
    assert.strictEqual(rc, 1);
    assert.ok(!fs.existsSync(path.join(dir, '.bashrc')), 'nothing written for a malformed token');
    assert.ok(!lines.join('\n').includes(evil), 'malformed token NEVER echoed');
  });
});

// #877: the token is never taken in a chat. In a terminal the command asks for it, hidden, on every OS; run where
// no one can type (an assistant's shell), it says the line to run in the GM's own terminal.
describe('runDoctor --set-cloudflare-creds in a terminal', () => {
  const { PassThrough } = require('node:stream');
  const { promptHidden, ownTerminalLine, WINDOWS_RESTART } = require('../../lib/doctor-cli');
  const terminal = () => { const input = new PassThrough(); input.isTTY = true; const shown = []; const output = { write: (c) => { shown.push(String(c)); return true; } }; return { input, output, shown: () => shown.join('') }; };

  it('asks for the token with the prompt showing and the token not', async () => {
    const t = terminal();
    const answer = promptHidden('Token: ', { input: t.input, output: t.output });
    t.input.write('abc_DEF-123');
    t.input.write('\r');
    assert.strictEqual(await answer, 'abc_DEF-123');
    assert.ok(t.shown().includes('Token: '), 'the prompt shows');
    assert.ok(!t.shown().includes('abc'), 'nothing typed or pasted shows');
  });

  it('a token pasted with a trailing CR/LF, or edited with backspace, never shows: the output is the prompt and a new line', async () => {
    const t = terminal();
    const answer = promptHidden('Token: ', { input: t.input, output: t.output });
    t.input.write('abX\u007fc_123\r\n');
    assert.strictEqual(await answer, 'abc_123');
    assert.strictEqual(t.shown().replace(/\u001b\[[0-9;]*[A-Za-z]/g, ''), 'Token: \n', 'only the prompt, its cursor codes aside');
  });

  it('a pipe left open with nothing in it answers nothing after a moment; one with a token reads it to its end', async () => {
    const { defaultReadStdin } = require('../../lib/doctor-cli');
    const open = new PassThrough();
    assert.strictEqual(await defaultReadStdin(open, 50), '');
    const piped = new PassThrough();
    const read = defaultReadStdin(piped, 50);
    piped.write('piped-token');
    setTimeout(() => piped.end('\n'), 120);
    assert.strictEqual(await read, 'piped-token\n');
  });

  it('Ctrl-C or the end of input answers nothing', async () => {
    const t = terminal();
    const answer = promptHidden('Token: ', { input: t.input, output: t.output });
    t.input.write('abc\u0003');
    assert.strictEqual(await answer, '');
    const u = terminal();
    const ended = promptHidden('Token: ', { input: u.input, output: u.output });
    u.input.end();
    assert.strictEqual(await ended, '');
  });

  it('in a terminal it asks, saves and never prints the token', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-doc-tty-'));
    const lines = []; const asked = [];
    const rc = await runDoctor(['--set-cloudflare-creds'], {
      out: (s) => lines.push(String(s)), runCommand: wranglerAllGood(),
      stdinIsTTY: true, promptToken: async (p) => { asked.push(p); return 'tty-secret-token\n'; },
      env: { SHELL: '/bin/zsh' }, platform: 'darwin', homedir: dir,
    });
    assert.strictEqual(rc, 0);
    assert.match(asked[0], /Cloudflare API token \(it will not show\)/);
    assert.ok(fs.readFileSync(path.join(dir, '.zshenv'), 'utf8').includes('export CLOUDFLARE_API_TOKEN="tty-secret-token"'));
    assert.ok(!lines.join('\n').includes('tty-secret-token'));
    assert.ok(!lines.join('\n').includes(WINDOWS_RESTART), 'no restart needed: every new shell reads ~/.zshenv');
  });

  it('nothing entered in a terminal: nothing written', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-doc-tty2-'));
    const lines = [];
    const rc = await runDoctor(['--set-cloudflare-creds'], {
      out: (s) => lines.push(String(s)), runCommand: wranglerAllGood(), stdinIsTTY: true, promptToken: async () => '',
      env: { SHELL: '/bin/bash' }, platform: 'linux', homedir: dir,
    });
    assert.strictEqual(rc, 1);
    assert.match(lines.join('\n'), /No token entered\. Nothing written\./);
    assert.ok(!fs.existsSync(path.join(dir, '.bashrc')));
  });

  it('run where no one can type, it gives the line to run in the GM\'s own terminal, the tool by its full path under node', async () => {
    const lines = [];
    const rc = await runDoctor(['--set-cloudflare-creds'], {
      out: (s) => lines.push(String(s)), runCommand: wranglerAllGood(), stdinIsTTY: false, readStdin: async () => '',
      env: {}, platform: 'linux', homedir: os.tmpdir(),
    });
    assert.strictEqual(rc, 1);
    const line = ownTerminalLine();
    assert.ok(lines.some((l) => l.trim() === line), lines.join('\n'));
    const script = /^node "([^"]+)" doctor --set-cloudflare-creds$/.exec(line);
    assert.ok(script && path.isAbsolute(script[1]) && fs.existsSync(script[1]), line);
    assert.strictEqual(path.basename(script[1]), 'gm-publish.js');
  });

  it('on Windows it saves with setx and says to restart the programs already open', async () => {
    const lines = []; const setx = [];
    const run = (cmd, args) => { if (cmd === 'setx') { setx.push(args[0]); return { code: 0, stdout: '', stderr: '' }; } return wranglerAllGood()(cmd, args); };
    const rc = await runDoctor(['--set-cloudflare-creds'], {
      out: (s) => lines.push(String(s)), runCommand: run, stdinIsTTY: true, promptToken: async () => 'win-token',
      env: {}, platform: 'win32', homedir: os.tmpdir(),
    });
    assert.strictEqual(rc, 0);
    assert.deepStrictEqual(setx, ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID']);
    assert.ok(lines.includes(WINDOWS_RESTART), lines.join('\n'));
    assert.ok(!lines.join('\n').includes('win-token'));
  });
});

const { writeSiteConfig } = require('../helpers/vault-files');

describe('runDoctor --site', () => {
  it('routes to the vault audit and never touches the host CLI', async () => {
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-site-vault-'));
    fs.mkdirSync(path.join(vault, 'Characters', 'NPCs'), { recursive: true });
    fs.writeFileSync(path.join(vault, 'Characters', 'NPCs', 'Someone.md'), '---\ntype: npc\n---\n\nHi.\n');
    const site = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-site-'));
    const configPath = path.join(site, 'vault.config.json');
    writeSiteConfig(configPath, {
      siteTitle: 'x', vaultPath: vault, outputDir: './docs',
      excludeDirs: ['_meta'], folderMap: { 'Characters/NPCs': 'characters/npcs' },
    });

    const lines = [];
    const ran = [];
    const rc = await runDoctor(['--site', '--config', configPath], {
      out: (s) => lines.push(String(s)),
      runCommand: (cmd, args) => { ran.push(cmd); return { code: 0, stdout: '', stderr: '' }; },
      detect: () => null,
    });

    assert.strictEqual(rc, 0);
    assert.deepStrictEqual(ran, [], 'the vault audit spawns nothing');
    assert.match(lines.join('\n'), /Site audit \(/);
    assert.doesNotMatch(lines.join('\n'), /Publish preflight/);
    fs.rmSync(vault, { recursive: true, force: true });
    fs.rmSync(site, { recursive: true, force: true });
  });

  it('without --site the preflight runs exactly as before', async () => {
    const lines = [];
    const rc = await runDoctor(['--host', 'cloudflare-pages'], {
      out: (s) => lines.push(String(s)), runCommand: wranglerAllGood(), env: {}, nodeVersion: 'v22.5.0',
    });
    assert.strictEqual(rc, 0);
    assert.match(lines.join('\n'), /Publish preflight \(host: cloudflare-pages\)/);
  });
});

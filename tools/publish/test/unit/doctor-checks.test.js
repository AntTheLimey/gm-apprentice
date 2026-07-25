const { describe, it } = require('node:test');
const assert = require('node:assert');
const { parseAccountId, checkCommand, runChecks } = require('../../lib/doctor');

const WHOAMI = `
 ⛅️ wrangler 4.20.0
Getting User settings...
You are logged in with an API Token.
┌────────────────┬──────────────────────────────────┐
│ Account Name   │ Account ID                       │
├────────────────┼──────────────────────────────────┤
│ Ant's Account  │ a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6 │
└────────────────┴──────────────────────────────────┘
`;

// A fake runner keyed by "cmd arg0".
function fakeRunner(table) {
  return (cmd, args) => table[`${cmd} ${(args || [])[0] || ''}`] || { code: 1, stdout: '', stderr: 'not found' };
}

describe('parseAccountId', () => {
  it('pulls the 32-hex account id from whoami output', () => {
    assert.strictEqual(parseAccountId(WHOAMI), 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6');
  });
  it('returns null when absent', () => {
    assert.strictEqual(parseAccountId('no id here'), null);
  });
});

describe('checkCommand', () => {
  it('ok + version on exit 0', () => {
    const run = fakeRunner({ 'git --version': { code: 0, stdout: 'git version 2.44.0\n', stderr: '' } });
    assert.deepStrictEqual(checkCommand(run, 'git', ['--version']), { ok: true, version: 'git version 2.44.0' });
  });
  it('not ok on non-zero', () => {
    assert.deepStrictEqual(checkCommand(fakeRunner({}), 'git', ['--version']), { ok: false, version: null });
  });
});

describe('runChecks', () => {
  // wrangler version and whoami both dispatch as ('npx', ['wrangler@4', ...]); to
  // distinguish, the runner keys on arg0 === 'wrangler@4' for BOTH, so provide a
  // richer fake that inspects args[1].
  function wranglerAwareRunner() {
    return (cmd, args) => {
      const a = args || [];
      if (cmd === 'git') return { code: 0, stdout: 'git version 2.44.0\n', stderr: '' };
      if (cmd === 'gh' && a[0] === '--version') return { code: 0, stdout: 'gh version 2.50.0\n', stderr: '' };
      if (cmd === 'gh' && a[0] === 'auth') return { code: 0, stdout: 'Logged in', stderr: '' };
      if (cmd === 'npx' && a[0] === 'wrangler@4' && a[1] === '--version') return { code: 0, stdout: 'wrangler 4.20.0\n', stderr: '' };
      if (cmd === 'npx' && a[0] === 'wrangler@4' && a[1] === 'whoami') return { code: 0, stdout: WHOAMI, stderr: '' };
      return { code: 1, stdout: '', stderr: 'not found' };
    };
  }

  it('cloudflare host: node/git/wrangler required, reports authed + accountId, overall ok', () => {
    const r = runChecks({ runCommand: wranglerAwareRunner(), host: 'cloudflare-pages', nodeVersion: 'v22.5.0' });
    assert.strictEqual(r.node.ok, true);
    assert.strictEqual(r.wrangler.ok, true);
    assert.strictEqual(r.wrangler.authed, true);
    assert.strictEqual(r.wrangler.accountId, 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6');
    assert.deepStrictEqual(r.required, ['node', 'git', 'wrangler']);
    assert.strictEqual(r.ok, true);
  });

  it('flags old node as not ok and drags overall ok false', () => {
    const r = runChecks({ runCommand: wranglerAwareRunner(), host: 'cloudflare-pages', nodeVersion: 'v18.19.0' });
    assert.strictEqual(r.node.ok, false);
    assert.strictEqual(r.ok, false);
  });

  it('github host requires gh, not wrangler', () => {
    const r = runChecks({ runCommand: wranglerAwareRunner(), host: 'github-pages', nodeVersion: 'v22.5.0' });
    assert.deepStrictEqual(r.required, ['node', 'git', 'gh']);
    assert.strictEqual(r.gh.authed, true);
    assert.strictEqual(r.ok, true);
  });

  // A spy wraps wranglerAwareRunner, recording every (cmd, args) call so a test
  // can assert that the non-host deploy tool was never spawned.
  function spyRunner() {
    const base = wranglerAwareRunner();
    const calls = [];
    const run = (cmd, args) => {
      calls.push({ cmd, args: args || [] });
      return base(cmd, args);
    };
    return { run, calls };
  }

  it('github host: never spawns wrangler, checks gh, wrangler slot is not-checked default', () => {
    const { run, calls } = spyRunner();
    const r = runChecks({ runCommand: run, host: 'github-pages', nodeVersion: 'v22.5.0' });
    const spawnedWrangler = calls.some((c) => c.cmd === 'npx' && c.args[0] === 'wrangler@4');
    assert.strictEqual(spawnedWrangler, false, 'must not spawn npx wrangler@4 for github-pages');
    assert.strictEqual(r.gh.authed, true);
    assert.deepStrictEqual(r.wrangler, { ok: false, version: null, authed: false, accountId: null });
  });

  it('cloudflare host: never spawns gh, reports wrangler result, gh slot is not-checked default', () => {
    const { run, calls } = spyRunner();
    const r = runChecks({ runCommand: run, host: 'cloudflare-pages', nodeVersion: 'v22.5.0' });
    const spawnedGh = calls.some((c) => c.cmd === 'gh');
    assert.strictEqual(spawnedGh, false, 'must not spawn gh for cloudflare-pages');
    assert.strictEqual(r.wrangler.ok, true);
    assert.strictEqual(r.wrangler.authed, true);
    assert.deepStrictEqual(r.gh, { ok: false, version: null, authed: false });
  });

  it('wrangler present but not authed drags overall ok false', () => {
    const runner = (cmd, args) => {
      const a = args || [];
      if (cmd === 'git') return { code: 0, stdout: 'git version 2.44.0\n', stderr: '' };
      if (cmd === 'npx' && a[0] === 'wrangler@4' && a[1] === '--version') return { code: 0, stdout: 'wrangler 4.20.0\n', stderr: '' };
      if (cmd === 'npx' && a[0] === 'wrangler@4' && a[1] === 'whoami') return { code: 1, stdout: '', stderr: '' };
      return { code: 1, stdout: '', stderr: 'not found' };
    };
    const r = runChecks({ runCommand: runner, host: 'cloudflare-pages', nodeVersion: 'v22.5.0' });
    assert.strictEqual(r.wrangler.ok, true);
    assert.strictEqual(r.wrangler.authed, false);
    assert.strictEqual(r.wrangler.accountId, null);
    assert.strictEqual(r.ok, false);
  });
});

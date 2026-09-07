const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');

const { runDeploy } = require('../lib/deploy-cli');
const { alignProjectName } = require('../lib/setup-backend');

const SITE = path.resolve('/sites/canticle');
const CONFIG = path.join(SITE, 'vault.config.json');

const TOML = [
  'name = "old-name"',
  'pages_build_output_dir = "docs"',
  '',
  '[[kv_namespaces]]',
  'binding = "INBOX"',
  'id = "abc123"',
  '',
].join('\n');

// Everything the runner can touch, recorded. No wrangler, no git, no network.
function harness(overrides = {}) {
  const out = [];
  const writes = {};
  const wrangler = [];
  const commands = [];
  const builds = [];
  const sleeps = [];
  const fetches = [];
  const files = Object.assign({ [path.join(SITE, 'wrangler.toml')]: TOML }, overrides.files);

  const deps = {
    out: (line) => out.push(String(line)),
    readFile: (p) => {
      if (!(p in files)) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; }
      return files[p];
    },
    writeFile: (p, content) => { files[p] = content; writes[p] = content; },
    exists: (p) => p in files,
    runWrangler: (args) => {
      wrangler.push(args);
      return (overrides.wrangler || (() => ({ code: 0, stdout: '', stderr: '' })))(args);
    },
    runCommand: (cmd, args, opts) => {
      commands.push({ cmd, args, cwd: opts && opts.cwd });
      return (overrides.command || (() => ({ code: 0, stdout: '', stderr: '' })))(cmd, args);
    },
    build: (opts) => {
      builds.push(opts);
      if (overrides.buildThrows) throw new Error(overrides.buildThrows);
    },
    fetchStatus: async (url) => {
      fetches.push(url);
      return (overrides.statuses || [200])[Math.min(fetches.length - 1, (overrides.statuses || [200]).length - 1)];
    },
    sleep: async (ms) => { sleeps.push(ms); },
    now: () => new Date('2026-09-07T12:00:00.000Z'),
    config: Object.assign({ host: 'cloudflare-pages', outputDir: './docs' }, overrides.config),
  };
  return { deps, out, writes, wrangler, commands, builds, sleeps, fetches, files, text: () => out.join('\n') };
}

describe('alignProjectName', () => {
  it('rewrites only the name line', () => {
    const aligned = alignProjectName(TOML, 'canticle');
    assert.strictEqual(aligned, TOML.replace('name = "old-name"', 'name = "canticle"'));
    assert.match(aligned, /id = "abc123"/);
  });

  it('leaves the text alone when the name already matches', () => {
    assert.strictEqual(alignProjectName(TOML, 'old-name'), TOML);
  });

  it('adds a name line when the file has none', () => {
    const aligned = alignProjectName('pages_build_output_dir = "docs"\n', 'canticle');
    assert.strictEqual(aligned, 'name = "canticle"\npages_build_output_dir = "docs"\n');
  });
});

describe('deploy: cloudflare-pages', () => {
  it('builds first, then deploys bare when wrangler.toml is present', async () => {
    const h = harness();
    const rc = await runDeploy({ configPath: CONFIG }, h.deps);
    assert.strictEqual(rc, 0);
    assert.deepStrictEqual(h.builds, [{ configPath: CONFIG }]);
    assert.deepStrictEqual(h.wrangler, [['whoami'], ['pages', 'deploy']]);
  });

  it('aligns the wrangler.toml project name before deploying', async () => {
    const h = harness({ config: { cloudflarePagesProject: 'canticle' } });
    await runDeploy({ configPath: CONFIG }, h.deps);
    const written = h.writes[path.join(SITE, 'wrangler.toml')];
    assert.match(written, /^name = "canticle"$/m);
    assert.doesNotMatch(written, /old-name/);
    assert.match(written, /id = "abc123"/, 'the KV block survives');
  });

  it('does not rewrite wrangler.toml when the name already matches', async () => {
    const h = harness({ config: { cloudflarePagesProject: 'old-name' } });
    await runDeploy({ configPath: CONFIG }, h.deps);
    assert.deepStrictEqual(h.writes, {});
  });

  it('uses the explicit deploy form when there is no wrangler.toml', async () => {
    const h = harness();
    delete h.files[path.join(SITE, 'wrangler.toml')];
    const rc = await runDeploy({ configPath: CONFIG }, h.deps);
    assert.strictEqual(rc, 0);
    assert.deepStrictEqual(h.wrangler[1], [
      'pages', 'deploy', 'docs/', '--project-name=canticle', '--branch=main', '--commit-dirty=true',
    ]);
  });

  it('stops before deploying when wrangler is not authenticated', async () => {
    const h = harness({ wrangler: (args) => (args[0] === 'whoami' ? { code: 1, stderr: 'not logged in' } : { code: 0 }) });
    const rc = await runDeploy({ configPath: CONFIG }, h.deps);
    assert.strictEqual(rc, 1);
    assert.deepStrictEqual(h.wrangler, [['whoami']]);
    assert.match(h.text(), /Cloudflare credentials are not set up\. Run `gm-publish doctor --set-cloudflare-creds`/);
  });

  it('reports the wrangler failure tail when the deploy fails', async () => {
    const h = harness({
      wrangler: (args) => (args[0] === 'whoami'
        ? { code: 0, stdout: '', stderr: '' }
        : { code: 1, stdout: '', stderr: 'Error: project not found' }),
    });
    const rc = await runDeploy({ configPath: CONFIG }, h.deps);
    assert.strictEqual(rc, 1);
    assert.match(h.text(), /Deploy failed: Error: project not found/);
  });

  it('--no-build skips the build', async () => {
    const h = harness();
    await runDeploy({ configPath: CONFIG, noBuild: true }, h.deps);
    assert.deepStrictEqual(h.builds, []);
    assert.deepStrictEqual(h.wrangler, [['whoami'], ['pages', 'deploy']]);
  });

  it('a build failure stops before any deploy', async () => {
    const h = harness({ buildThrows: 'no such vault' });
    const rc = await runDeploy({ configPath: CONFIG }, h.deps);
    assert.strictEqual(rc, 1);
    assert.match(h.text(), /Build failed: no such vault/);
    assert.deepStrictEqual(h.wrangler, []);
  });

  it('--dry-run runs nothing and prints the commands', async () => {
    const h = harness();
    const rc = await runDeploy({ configPath: CONFIG, dryRun: true }, h.deps);
    assert.strictEqual(rc, 0);
    assert.deepStrictEqual(h.builds, []);
    assert.deepStrictEqual(h.wrangler, []);
    assert.deepStrictEqual(h.commands, []);
    assert.deepStrictEqual(h.writes, {});
    const text = h.text();
    assert.match(text, /DRY RUN/);
    assert.match(text, /gm-publish build --config/);
    assert.match(text, /npx wrangler@4 pages deploy/);
  });
});

describe('deploy: github-pages', () => {
  const ghConfig = { host: 'github-pages', siteUrl: 'https://example.github.io/canticle' };

  it('adds, commits and pushes docs/ in that order', async () => {
    const h = harness({
      config: ghConfig,
      command: (cmd, args) => (args[0] === 'status' ? { code: 0, stdout: ' M docs/index.html\n' } : { code: 0, stdout: '' }),
    });
    const rc = await runDeploy({ configPath: CONFIG }, h.deps);
    assert.strictEqual(rc, 0);
    assert.deepStrictEqual(h.commands.map(c => c.args), [
      ['add', 'docs/'],
      ['status', '--porcelain', 'docs/'],
      ['commit', '-m', 'Rebuild site'],
      ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'],
      ['push'],
    ]);
    assert.ok(h.commands.every(c => c.cwd === SITE), 'git runs in the site root');
  });

  // I3: `git add`'s exit code used to be discarded entirely, and a *failing*
  // `git status` (non-zero, empty stdout) read as "clean" — so a failed add (e.g.
  // docs/ gitignored, or not yet a repo) meant nothing was committed, the push was
  // a no-op that still exited 0, and --verify then reported the *previous*
  // deployment as freshly live.
  it('exits 1 and does not push when `git add` fails', async () => {
    const h = harness({
      config: ghConfig,
      command: (cmd, args) => (args[0] === 'add'
        ? { code: 1, stderr: 'fatal: pathspec did not match any files' }
        : { code: 0, stdout: '' }),
    });
    const rc = await runDeploy({ configPath: CONFIG }, h.deps);
    assert.strictEqual(rc, 1);
    assert.match(h.text(), /Deploy failed: fatal: pathspec did not match any files/);
    assert.deepStrictEqual(h.commands.map(c => c.args), [['add', 'docs/']]);
  });

  it('exits 1 and does not push when `git status` fails', async () => {
    const h = harness({
      config: ghConfig,
      command: (cmd, args) => (args[0] === 'status'
        ? { code: 1, stderr: 'fatal: not a git repository' }
        : { code: 0, stdout: '' }),
    });
    const rc = await runDeploy({ configPath: CONFIG }, h.deps);
    assert.strictEqual(rc, 1);
    assert.match(h.text(), /Deploy failed: fatal: not a git repository/);
    assert.deepStrictEqual(h.commands.map(c => c.args), [
      ['add', 'docs/'],
      ['status', '--porcelain', 'docs/'],
    ]);
  });

  it('pushes anyway when docs/ is unchanged, and says so', async () => {
    const h = harness({ config: ghConfig, command: () => ({ code: 0, stdout: '' }) });
    const rc = await runDeploy({ configPath: CONFIG }, h.deps);
    assert.strictEqual(rc, 0);
    assert.match(h.text(), /nothing to commit — docs\/ unchanged/);
    assert.deepStrictEqual(h.commands.map(c => c.args), [
      ['add', 'docs/'],
      ['status', '--porcelain', 'docs/'],
      ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'],
      ['push'],
    ]);
  });

  it('exits 1 when the push fails', async () => {
    const h = harness({
      config: ghConfig,
      command: (cmd, args) => (args[0] === 'push'
        ? { code: 1, stderr: 'rejected: fetch first' }
        : { code: 0, stdout: args[0] === 'status' ? ' M docs/x\n' : '' }),
    });
    const rc = await runDeploy({ configPath: CONFIG }, h.deps);
    assert.strictEqual(rc, 1);
    assert.match(h.text(), /rejected: fetch first/);
  });

  it('pushes bare when the current branch already has an upstream', async () => {
    const h = harness({
      config: ghConfig,
      command: (cmd, args) => {
        if (args[0] === 'status') return { code: 0, stdout: ' M docs/index.html\n' };
        if (args[0] === 'rev-parse') return { code: 0, stdout: 'origin/main\n' };
        return { code: 0, stdout: '' };
      },
    });
    const rc = await runDeploy({ configPath: CONFIG }, h.deps);
    assert.strictEqual(rc, 0);
    assert.deepStrictEqual(h.commands.map(c => c.args), [
      ['add', 'docs/'],
      ['status', '--porcelain', 'docs/'],
      ['commit', '-m', 'Rebuild site'],
      ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'],
      ['push'],
    ]);
  });

  it('pushes with -u origin HEAD when the current branch has no upstream yet', async () => {
    const h = harness({
      config: ghConfig,
      command: (cmd, args) => {
        if (args[0] === 'status') return { code: 0, stdout: ' M docs/index.html\n' };
        if (args[0] === 'rev-parse') return { code: 1, stderr: "fatal: no upstream configured for branch 'main'" };
        return { code: 0, stdout: '' };
      },
    });
    const rc = await runDeploy({ configPath: CONFIG }, h.deps);
    assert.strictEqual(rc, 0);
    assert.deepStrictEqual(h.commands.map(c => c.args), [
      ['add', 'docs/'],
      ['status', '--porcelain', 'docs/'],
      ['commit', '-m', 'Rebuild site'],
      ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'],
      ['push', '-u', 'origin', 'HEAD'],
    ]);
    assert.match(h.text(), /no upstream branch yet — pushing with -u origin HEAD/);
  });

  it('--dry-run reflects a bare push when the branch already has an upstream', async () => {
    const h = harness({ config: ghConfig, command: () => ({ code: 0, stdout: '' }) });
    const rc = await runDeploy({ configPath: CONFIG, dryRun: true }, h.deps);
    assert.strictEqual(rc, 0);
    const text = h.text();
    assert.match(text, /git push$/m);
    assert.doesNotMatch(text, /git push -u origin HEAD/);
  });

  it('--dry-run reflects a -u push when the branch has no upstream yet', async () => {
    const h = harness({
      config: ghConfig,
      command: (cmd, args) => (args[0] === 'rev-parse' ? { code: 1, stderr: 'no upstream' } : { code: 0, stdout: '' }),
    });
    const rc = await runDeploy({ configPath: CONFIG, dryRun: true }, h.deps);
    assert.strictEqual(rc, 0);
    assert.match(h.text(), /git push -u origin HEAD/);
  });
});

describe('deploy --verify', () => {
  it('reports the site live on the first 2xx', async () => {
    const h = harness({ config: { siteUrl: 'https://canticle.pages.dev' }, statuses: [200] });
    const rc = await runDeploy({ configPath: CONFIG, verify: true }, h.deps);
    assert.strictEqual(rc, 0);
    assert.deepStrictEqual(h.fetches, ['https://canticle.pages.dev']);
    assert.deepStrictEqual(h.sleeps, []);
    assert.match(h.text(), /live at https:\/\/canticle\.pages\.dev/);
  });

  it('defaults the URL to the pages.dev project host', async () => {
    const h = harness({ statuses: [200] });
    await runDeploy({ configPath: CONFIG, verify: true }, h.deps);
    assert.deepStrictEqual(h.fetches, ['https://canticle.pages.dev']);
  });

  it('tries three times with a wait between, then exits 0 with verified false', async () => {
    const h = harness({ statuses: [404, 404, 404] });
    const rc = await runDeploy({ configPath: CONFIG, verify: true, json: true }, h.deps);
    assert.strictEqual(rc, 0, 'the deploy succeeded — verification is advisory');
    assert.strictEqual(h.fetches.length, 3);
    assert.deepStrictEqual(h.sleeps, [20000, 20000]);
    const payload = JSON.parse(h.out.join(''));
    assert.strictEqual(payload.verified, false);
    assert.strictEqual(payload.status, 404);
    assert.strictEqual(payload.attempts, 3);
    assert.strictEqual(payload.deployed, true);
  });

  it('says "no response" when the host never answers', async () => {
    const h = harness({ statuses: [null] });
    const rc = await runDeploy({ configPath: CONFIG, verify: true }, h.deps);
    assert.strictEqual(rc, 0);
    assert.match(h.text(), /returned no response after 3 tries — the host is still propagating/);
  });

  it('recovers on a later attempt', async () => {
    const h = harness({ statuses: [503, 200] });
    await runDeploy({ configPath: CONFIG, verify: true }, h.deps);
    assert.strictEqual(h.fetches.length, 2);
    assert.deepStrictEqual(h.sleeps, [20000]);
    assert.match(h.text(), /live at/);
  });

  it('says it cannot verify a github-pages site with no siteUrl', async () => {
    const h = harness({ config: { host: 'github-pages', siteUrl: undefined }, statuses: [200] });
    const rc = await runDeploy({ configPath: CONFIG, verify: true }, h.deps);
    assert.strictEqual(rc, 0);
    assert.deepStrictEqual(h.fetches, []);
    assert.match(h.text(), /no siteUrl in vault\.config\.json — cannot verify; check the site by hand/);
  });

  it('--json reports the commands it ran', async () => {
    const h = harness({ statuses: [200] });
    await runDeploy({ configPath: CONFIG, verify: true, json: true }, h.deps);
    const payload = JSON.parse(h.out.join(''));
    assert.strictEqual(payload.host, 'cloudflare-pages');
    assert.strictEqual(payload.built, true);
    assert.strictEqual(payload.deployed, true);
    assert.strictEqual(payload.verified, true);
    assert.strictEqual(payload.status, 200);
    assert.strictEqual(payload.url, 'https://canticle.pages.dev');
    assert.deepStrictEqual(payload.commands, ['npx wrangler@4 pages deploy']);
  });
});

// M3: deploy shares config loading with manifest and explain — a bad config path
// must fail the same clean way instead of a raw `require()` "Cannot find module"
// stack. Deliberately not routed through `harness()`, which always injects a
// `config` override; this exercises the real read-from-disk path with none.
describe('deploy: config loading', () => {
  it('fails with a clean message on a config path that does not exist', async () => {
    const configPath = path.join(os.tmpdir(), 'no-such-dir-' + Date.now(), 'vault.config.json');
    await assert.rejects(
      () => runDeploy({ configPath }, {}),
      (err) => {
        assert.doesNotMatch(err.message, /Cannot find module/);
        assert.match(err.message, /could not be read as JSON/);
        return true;
      },
    );
  });
});

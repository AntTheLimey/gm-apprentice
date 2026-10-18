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

const DEPLOYED = 'https://1a2b3c4d.canticle.pages.dev';

// Everything the runner can touch, recorded. No wrangler, no git, no network.
function harness(overrides = {}) {
  const out = [];
  const writes = {};
  const wrangler = [];
  const wranglerOpts = [];
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
    exists: overrides.exists || ((p) => p in files),
    runWrangler: (args, opts) => {
      wrangler.push(args);
      wranglerOpts.push(opts);
      const quiet = { code: 0, stdout: '', stderr: '' };
      // A real `pages deploy` prints the address of the deployment it made.
      const made = { code: 0, stdout: `Uploaded 3 files\n✨ Deployment complete! Take a peek over at ${DEPLOYED}\n`, stderr: '' };
      return (overrides.wrangler || (([sub]) => (sub === 'pages' ? made : quiet)))(args);
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
    leakGate: overrides.leakGate || (() => ({ skipped: null, missing: false, findings: [], unneeded: [], files: 3, seconds: 0.01 })),
  };
  return { deps, out, writes, wrangler, wranglerOpts, commands, builds, sleeps, fetches, files, text: () => out.join('\n') };
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
  it('builds first, then deploys to the production branch when wrangler.toml is present', async () => {
    const h = harness();
    const rc = await runDeploy({ configPath: CONFIG }, h.deps);
    assert.strictEqual(rc, 0);
    assert.deepStrictEqual(h.builds, [{ configPath: CONFIG, site: 'player' }]);
    assert.deepStrictEqual(h.wrangler, [['whoami'], ['pages', 'deploy', '--branch=main', '--commit-dirty=true']]);
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

  it('gives the upload its own 10 minute timeout, longer than the other wrangler calls', async () => {
    const h = harness();
    await runDeploy({ configPath: CONFIG }, h.deps);
    assert.strictEqual(h.wranglerOpts[1].timeoutMs, 600000);
    assert.strictEqual(h.wranglerOpts[0].timeoutMs, undefined, 'whoami keeps the shared bound');
  });

  it('fails plainly, exit 1, when the upload timed out, even with a zero exit status', async () => {
    const h = harness({ wrangler: ([sub]) => ({ code: 0, stdout: '', stderr: '', error: sub === 'pages' ? 'ETIMEDOUT' : null }) });
    const rc = await runDeploy({ configPath: CONFIG, verify: true }, h.deps);
    assert.strictEqual(rc, 1);
    assert.match(h.text(), /Deploy failed: the upload did not finish within 10 minutes, so it may not have been deployed/);
    assert.doesNotMatch(h.text(), /live at|Deployed\./);
    assert.deepStrictEqual(h.fetches, []);
  });

  it('the timeout message points at the deployment list and says to run deploy again', async () => {
    const h = harness({ wrangler: ([sub]) => ({ code: 0, stdout: '', stderr: '', error: sub === 'pages' ? 'ETIMEDOUT' : null }) });
    await runDeploy({ configPath: CONFIG }, h.deps);
    assert.match(h.text(), /npx wrangler@4 pages deployment list/);
    assert.match(h.text(), /Run deploy again/);
    assert.doesNotMatch(h.text(), /nothing was deployed/);
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

  it('a site turned off is neither built nor uploaded, with or without --no-build', async () => {
    for (const noBuild of [false, true]) {
      const h = harness();
      h.deps.siteOffFor = () => 'the site is off for this vault';
      const rc = await runDeploy({ configPath: CONFIG, noBuild }, h.deps);
      assert.strictEqual(rc, 1);
      assert.deepStrictEqual(h.builds, []);
      assert.deepStrictEqual(h.wrangler, []);
      assert.match(h.text(), /the site is off for this vault/);
    }
  });

  it('a site turned off is refused by --dry-run too, before any command is printed', async () => {
    for (const json of [false, true]) {
      const h = harness();
      h.deps.siteOffFor = () => 'the site is off for this vault';
      const rc = await runDeploy({ configPath: CONFIG, dryRun: true, json }, h.deps);
      assert.strictEqual(rc, 1);
      assert.deepStrictEqual(h.builds, []);
      assert.deepStrictEqual(h.commands, []);
      assert.doesNotMatch(h.text(), /DRY RUN|git push|wrangler@4/);
      assert.match(h.text(), /the site is off for this vault/);
      if (json) {
        const payload = JSON.parse(h.out[0]);
        assert.strictEqual(payload.dryRun, undefined);
        assert.deepStrictEqual(payload.commands, []);
      }
    }
  });

  it('--no-build skips the build', async () => {
    const h = harness();
    await runDeploy({ configPath: CONFIG, noBuild: true }, h.deps);
    assert.deepStrictEqual(h.builds, []);
    assert.deepStrictEqual(h.wrangler, [['whoami'], ['pages', 'deploy', '--branch=main', '--commit-dirty=true']]);
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
      ['commit', '-m', 'Rebuild site', '--only', '--', 'docs/'],
      ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'],
      ['push'],
    ]);
    assert.ok(h.commands.every(c => c.cwd === SITE), 'git runs in the site root');
  });

  // Unrelated staged content (e.g. the GM had something else `git add`ed
  // before running deploy) must not ride along with the site rebuild commit.
  // A bare `git commit` commits the whole index; `--only -- <outDir>` limits
  // the commit to the named paths regardless of what else is staged.
  it('commits only docs/, not other staged files', async () => {
    const h = harness({
      config: ghConfig,
      command: (cmd, args) => (args[0] === 'status' ? { code: 0, stdout: ' M docs/index.html\n' } : { code: 0, stdout: '' }),
    });
    const rc = await runDeploy({ configPath: CONFIG }, h.deps);
    assert.strictEqual(rc, 0);
    const commit = h.commands.find(c => c.args[0] === 'commit');
    assert.deepStrictEqual(commit.args, ['commit', '-m', 'Rebuild site', '--only', '--', 'docs/']);
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
      ['commit', '-m', 'Rebuild site', '--only', '--', 'docs/'],
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
      ['commit', '-m', 'Rebuild site', '--only', '--', 'docs/'],
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
    assert.deepStrictEqual(h.fetches, [DEPLOYED]);
    assert.deepStrictEqual(h.sleeps, []);
    assert.match(h.text(), /live at https:\/\/1a2b3c4d\.canticle\.pages\.dev/);
  });

  it('checks the deployment address wrangler printed, not the site root the old build answers', async () => {
    const h = harness({ statuses: [200] });
    await runDeploy({ configPath: CONFIG, verify: true }, h.deps);
    assert.deepStrictEqual(h.fetches, [DEPLOYED]);
  });

  it('does not say live, and exits non-zero, when wrangler printed no deployment address', async () => {
    const h = harness({ statuses: [200], wrangler: () => ({ code: 0, stdout: 'Uploaded 3 files\n', stderr: '' }) });
    const rc = await runDeploy({ configPath: CONFIG, verify: true, json: true }, h.deps);
    assert.strictEqual(rc, 1);
    assert.deepStrictEqual(h.fetches, [], 'the site root is not fetched as proof');
    const payload = JSON.parse(h.out.join(''));
    assert.strictEqual(payload.verified, false);
    assert.match(payload.messages.join('\n'), /could not confirm which build is served/);
    assert.doesNotMatch(payload.messages.join('\n'), /live at/);
  });

  it('says it was deployed as a preview, and exits 1, when wrangler printed a branch alias', async () => {
    const h = harness({
      statuses: [200],
      config: { siteUrl: 'https://canticle.pages.dev' },
      wrangler: ([sub]) => (sub === 'pages'
        ? { code: 0, stdout: `Take a peek over at ${DEPLOYED}\nDeployment alias URL: https://my-branch.canticle.pages.dev\n`, stderr: '' }
        : { code: 0, stdout: '', stderr: '' }),
    });
    const rc = await runDeploy({ configPath: CONFIG, verify: true, json: true }, h.deps);
    assert.strictEqual(rc, 1);
    const payload = JSON.parse(h.out.join(''));
    assert.strictEqual(payload.verified, false);
    assert.strictEqual(payload.preview, true);
    assert.strictEqual(payload.deployed, true);
    assert.match(payload.messages.join('\n'), /deployed as a preview/);
    assert.doesNotMatch(payload.messages.join('\n'), /live at/);
    assert.deepStrictEqual(h.fetches, []);
  });

  it('a production alias (the project address) is not a preview', async () => {
    const h = harness({
      statuses: [200],
      config: { siteUrl: 'https://canticle.pages.dev' },
      wrangler: ([sub]) => (sub === 'pages'
        ? { code: 0, stdout: `Take a peek over at ${DEPLOYED}\nDeployment alias URL: https://canticle.pages.dev\n`, stderr: '' }
        : { code: 0, stdout: '', stderr: '' }),
    });
    const rc = await runDeploy({ configPath: CONFIG, verify: true }, h.deps);
    assert.strictEqual(rc, 0);
    assert.match(h.text(), /this deployment is live at https:\/\/1a2b3c4d\.canticle\.pages\.dev/);
  });

  it('github-pages still verifies the site address', async () => {
    const h = harness({ config: { host: 'github-pages', siteUrl: 'https://u.github.io/c' }, statuses: [200] });
    const rc = await runDeploy({ configPath: CONFIG, verify: true }, h.deps);
    assert.strictEqual(rc, 0);
    assert.deepStrictEqual(h.fetches, ['https://u.github.io/c']);
    assert.match(h.text(), /live at https:\/\/u\.github\.io\/c/);
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

  it('says it cannot verify a github-pages site with no site address', async () => {
    const h = harness({ config: { host: 'github-pages', siteUrl: undefined }, statuses: [200] });
    const rc = await runDeploy({ configPath: CONFIG, verify: true }, h.deps);
    assert.strictEqual(rc, 0);
    assert.deepStrictEqual(h.fetches, []);
    assert.match(h.text(), /no player_site\.url set — cannot verify; check the site by hand/);
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
    assert.deepStrictEqual(payload.commands, ['npx wrangler@4 pages deploy --branch=main --commit-dirty=true']);
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

describe('deploy runs the site\'s own build hooks (#248)', () => {
  const PKG = path.join(SITE, 'package.json');
  const withHooks = (scripts) => ({ [PKG]: JSON.stringify({ scripts }) });

  it('runs prebuild before and postbuild after the build, in the site dir', async () => {
    const order = [];
    const h = harness({
      files: withHooks({ build: 'gm-apprentice-publish build', prebuild: 'x', postbuild: 'y' }),
      command: (cmd, args) => { order.push(`${cmd} ${args.join(' ')}`); return { code: 0, stdout: '', stderr: '' }; },
    });
    const build = h.deps.build;
    h.deps.build = (o) => { order.push('build'); return build(o); };
    const rc = await runDeploy({ configPath: CONFIG }, h.deps);
    assert.strictEqual(rc, 0);
    assert.deepStrictEqual(order, ['npm run prebuild', 'build', 'npm run postbuild']);
    assert.ok(h.commands.every(c => c.cwd === SITE));
    assert.deepStrictEqual(h.wrangler, [['whoami'], ['pages', 'deploy', '--branch=main', '--commit-dirty=true']]);
  });

  it('runs nothing extra for a site with no hooks or no package.json', async () => {
    for (const files of [withHooks({ build: 'gm-apprentice-publish build' }), {}]) {
      const h = harness({ files });
      assert.strictEqual(await runDeploy({ configPath: CONFIG }, h.deps), 0);
      assert.deepStrictEqual(h.commands, []);
    }
  });

  it('a failed postbuild stops the deploy and says why', async () => {
    const h = harness({
      files: withHooks({ postbuild: 'node optimise.js' }),
      command: () => ({ code: 2, stdout: '', stderr: 'sharp: missing' }),
    });
    const rc = await runDeploy({ configPath: CONFIG }, h.deps);
    assert.strictEqual(rc, 1);
    assert.match(h.text(), /postbuild failed: sharp: missing/);
    assert.deepStrictEqual(h.wrangler, []);
  });

  it('--no-build runs no hooks; --dry-run lists them', async () => {
    const files = withHooks({ prebuild: 'x', postbuild: 'y' });
    const h = harness({ files });
    await runDeploy({ configPath: CONFIG, noBuild: true }, h.deps);
    assert.deepStrictEqual(h.commands, []);
    const d = harness({ files });
    await runDeploy({ configPath: CONFIG, dryRun: true }, d.deps);
    assert.deepStrictEqual(d.commands, []);
    assert.match(d.text(), /npm run prebuild[\s\S]*gm-publish build[\s\S]*npm run postbuild/);
  });
});

describe('deploy hooks: the ways they used to slip through (#248 review)', () => {
  const PKG = path.join(SITE, 'package.json');

  it('reads a package.json that starts with a byte-order mark', async () => {
    const h = harness({ files: { [PKG]: '﻿' + JSON.stringify({ scripts: { postbuild: 'x' } }) } });
    assert.strictEqual(await runDeploy({ configPath: CONFIG }, h.deps), 0);
    assert.deepStrictEqual(h.commands.map(c => c.args), [['run', 'postbuild']]);
  });

  it('says so when package.json exists but will not parse', async () => {
    const h = harness({ files: { [PKG]: '{ "scripts": ' } });
    assert.strictEqual(await runDeploy({ configPath: CONFIG }, h.deps), 0);
    assert.match(h.text(), /package\.json.*not valid JSON.*prebuild\/postbuild/);
  });

  it('streams hook output and uses a shell on Windows', async () => {
    const seen = [];
    const h = harness({ files: { [PKG]: JSON.stringify({ scripts: { postbuild: 'x' } }) } });
    h.deps.runCommand = (cmd, args, opts) => { seen.push(opts); return { code: 0, stdout: '', stderr: '' }; };
    h.deps.platform = 'win32';
    await runDeploy({ configPath: CONFIG }, h.deps);
    assert.strictEqual(seen[0].stdio, 'inherit');
    assert.strictEqual(seen[0].shell, true);
    const j = harness({ files: { [PKG]: JSON.stringify({ scripts: { postbuild: 'x' } }) } });
    const seenJ = [];
    j.deps.runCommand = (cmd, args, opts) => { seenJ.push(opts); return { code: 0, stdout: '', stderr: '' }; };
    await runDeploy({ configPath: CONFIG, json: true }, j.deps);
    assert.deepStrictEqual(seenJ[0].stdio, ['ignore', 2, 2]);   // never onto the JSON stdout
    assert.strictEqual(seenJ[0].shell, process.platform === 'win32');
  });
});

describe('setup-status-bar and setup-inbox build with the vault\'s build steps', () => {
  it('asks for the steps to run, as build and deploy do', async () => {
    const fs = require('fs');
    const { runSetupBackend } = require('../lib/setup-backend');
    for (const feature of ['status-bar', 'inbox']) {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-steps-'));
      const vault = path.join(root, 'vault');
      fs.mkdirSync(path.join(vault, '_meta'), { recursive: true });
      fs.writeFileSync(path.join(vault, '_meta', 'vault-config.yaml'), 'version: 1\n');
      const site = path.join(root, 'site');
      fs.mkdirSync(site);
      const configPath = path.join(site, 'vault.config.json');
      fs.writeFileSync(configPath, JSON.stringify({ vaultPath: '../vault' }));
      fs.writeFileSync(path.join(site, 'wrangler.toml'), 'name = "x"\npages_build_output_dir = "docs"\n');
      const seen = [];
      const rc = await runSetupBackend(feature, { configPath }, {
        out: () => {},
        runWrangler: (args) => {
          if (args[1] === 'namespace' && args[2] === 'list') return { code: 0, stdout: '[]', stderr: '' };
          if (args[1] === 'namespace' && args[2] === 'create') return { code: 0, stdout: 'id = "kv1"', stderr: '' };
          return { code: 0, stdout: '', stderr: '' };
        },
        build: (opts) => { seen.push(opts); },
        syncFunctions: () => {},
      });
      assert.strictEqual(rc, 0, feature);
      assert.strictEqual(seen.length, 1, feature);
      assert.strictEqual(seen[0].runSteps, true, feature);
    }
  });
});

describe('deploy refuses a GM site folder', () => {
  const GM_TAG = require('../lib/gm-site').GM_META_TAG;
  const fs = require('fs');
  // A real site folder in a temp dir, so the real isGmOutput reads the real output folder.
  function realSite(setup) {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-gm-')));
    const docs = path.join(root, 'docs');
    if (setup) { fs.mkdirSync(docs); setup(docs); }
    const h = harness({ files: { [path.join(root, 'wrangler.toml')]: TOML } });
    return { root, h, config: path.join(root, 'vault.config.json'), done: () => fs.rmSync(root, { recursive: true, force: true }) };
  }
  const noBuilt = (h) => { assert.deepStrictEqual(h.wrangler, []); assert.deepStrictEqual(h.commands, []); assert.deepStrictEqual(h.builds, []); };

  for (const [flag, opts] of [['--no-build', { noBuild: true }], ['--dry-run', { dryRun: true }], ['--json', { json: true }]]) {
    it(`refuses a GM folder under ${flag}: runs nothing, builds nothing`, async () => {
      const h = harness();
      h.deps.isGmOutput = (dir) => { h.seen = dir; return true; };
      const rc = await runDeploy({ configPath: CONFIG, ...opts }, h.deps);
      assert.strictEqual(rc, 1);
      noBuilt(h);
      assert.strictEqual(h.seen, path.join(SITE, 'docs'));
      assert.match(h.text(), /deploy refused: .* is a GM site folder/);
      assert.match(h.text(), /The GM site never goes online\./);
      if (opts.json) {
        const payload = JSON.parse(h.out[0]);
        assert.strictEqual(payload.refused, true);
        assert.ok(payload.messages.some((m) => /The GM site never goes online/.test(m)));
      }
    });
  }

  it('checks an absolute player_site.output where it is, not under the site folder', async () => {
    const abs = path.resolve(path.sep, 'srv', 'out');
    const h = harness({ config: { outputDir: abs } });
    const seen = [];
    h.deps.isGmOutput = (dir) => { seen.push(dir); return true; };
    const rc = await runDeploy({ configPath: CONFIG, noBuild: true }, h.deps);
    assert.strictEqual(rc, 1);
    assert.strictEqual(seen[0], abs);
  });

  it('refuses when wrangler.toml names a GM folder, though player_site.output is not one', async () => {
    const s = realSite((docs) => fs.writeFileSync(path.join(docs, 'index.html'), '<html></html>'));
    try {
      const gm = path.join(s.root, 'elsewhere');
      fs.mkdirSync(gm);
      fs.writeFileSync(path.join(gm, 'gm-build.json'), '{}\n');
      s.h.deps.readFile = (p) => (p === path.join(s.root, 'wrangler.toml') ? 'pages_build_output_dir = "elsewhere"\n' : fs.readFileSync(p, 'utf8'));
      const rc = await runDeploy({ configPath: s.config, noBuild: true }, s.h.deps);
      assert.strictEqual(rc, 1);
      noBuilt(s.h);
      assert.match(s.h.text(), /elsewhere/);
    } finally { s.done(); }
  });

  it('refuses a folder holding only gm-build.json and names it', async () => {
    const s = realSite((docs) => fs.writeFileSync(path.join(docs, 'gm-build.json'), '{"build":"gm","tool":"1","built":null}\n'));
    try {
      const rc = await runDeploy({ configPath: s.config, noBuild: true }, s.h.deps);
      assert.strictEqual(rc, 1);
      noBuilt(s.h);
      assert.match(s.h.text(), /gm-build\.json/);
    } finally { s.done(); }
  });

  it('refuses a folder holding only a page with the GM build tag and names it', async () => {
    const s = realSite((docs) => fs.writeFileSync(path.join(docs, 'index.html'), `<html><head>${GM_TAG}</head></html>`));
    try {
      const rc = await runDeploy({ configPath: s.config, noBuild: true }, s.h.deps);
      assert.strictEqual(rc, 1);
      noBuilt(s.h);
      assert.match(s.h.text(), /GM build tag/);
    } finally { s.done(); }
  });

  it('does not refuse an ordinary player output folder', async () => {
    const s = realSite((docs) => fs.writeFileSync(path.join(docs, 'index.html'), '<html><head></head></html>'));
    try {
      const rc = await runDeploy({ configPath: s.config, noBuild: true }, s.h.deps);
      assert.strictEqual(rc, 0);
      assert.doesNotMatch(s.h.text(), /deploy refused/);
    } finally { s.done(); }
  });

  it('does not refuse a missing output folder', async () => {
    const s = realSite(null);
    try {
      const rc = await runDeploy({ configPath: s.config, noBuild: true }, s.h.deps);
      assert.doesNotMatch(s.h.text(), /deploy refused/);
      assert.strictEqual(rc, 0);
    } finally { s.done(); }
  });

  it('the default build is made for the player site', async () => {
    const h = harness();
    await runDeploy({ configPath: CONFIG }, h.deps);
    assert.strictEqual(h.builds.length, 1);
    assert.strictEqual(h.builds[0].site, 'player');
  });
});

describe('deploy hooks: an unreadable package.json (CodeRabbit #263)', () => {
  it('stops rather than silently skipping the site\'s build steps', async () => {
    const h = harness();
    const read = h.deps.readFile;
    h.deps.readFile = (p) => {
      if (p.endsWith('package.json')) { const e = new Error('EACCES: permission denied'); e.code = 'EACCES'; throw e; }
      return read(p);
    };
    const rc = await runDeploy({ configPath: CONFIG }, h.deps);
    assert.strictEqual(rc, 1);
    assert.match(h.text(), /package\.json.*EACCES/);
    assert.deepStrictEqual(h.wrangler, []);
  });
});

describe('deploy: the leak gate', () => {
  const finding = { id: 'abc123', kind: 'text', code: 'HIDDEN_TEXT', page: 'npcs/a.html', text: 'the baker poisoned the mayor', shown: 'The baker poisoned the mayor.', note: 'NPCs/A.md', reason: 'GM Notes section' };
  const leaking = () => ({ skipped: null, missing: false, findings: [finding], unneeded: [], files: 3, seconds: 0.01 });

  it('stops before any upload and lists each finding, exit 1', async () => {
    const h = harness({ leakGate: leaking });
    const rc = await runDeploy({ configPath: CONFIG }, h.deps);
    assert.strictEqual(rc, 1);
    assert.deepStrictEqual(h.wrangler, []);
    assert.equal(h.builds.length, 1);
    assert.match(h.text(), /\[abc123\] npcs\/a\.html: "The baker poisoned the mayor\."/);
    assert.match(h.text(), /Nothing was uploaded/);
  });

  it('github-pages: no git add, commit or push on a finding', async () => {
    const h = harness({ leakGate: leaking, config: { host: 'github-pages' } });
    const rc = await runDeploy({ configPath: CONFIG }, h.deps);
    assert.strictEqual(rc, 1);
    assert.ok(!h.commands.some((c) => c.cmd === 'git' && ['add', 'commit', 'push'].includes(c.args[0])));
  });

  it('--json carries the findings and refused', async () => {
    const h = harness({ leakGate: leaking });
    const rc = await runDeploy({ configPath: CONFIG, json: true }, h.deps);
    assert.strictEqual(rc, 1);
    const payload = JSON.parse(h.out.join(''));
    assert.strictEqual(payload.refused, true);
    assert.strictEqual(payload.deployed, false);
    assert.deepStrictEqual(payload.leaks.findings.map((f) => f.id), ['abc123']);
  });

  it('--no-build checks the folder as it stands', async () => {
    const seen = [];
    const h = harness({ leakGate: (o) => { seen.push(o.outputDir); return leaking(); } });
    assert.strictEqual(await runDeploy({ configPath: CONFIG, noBuild: true }, h.deps), 1);
    assert.equal(seen.length, 1);
    assert.deepStrictEqual(h.builds, []);
    assert.deepStrictEqual(h.wrangler, []);
  });

  it('the folder checked is the one wrangler.toml uploads', async () => {
    const seen = [];
    const h = harness({ leakGate: (o) => { seen.push(o.outputDir); return { skipped: null, missing: false, findings: [], unneeded: [], files: 1, seconds: 0 }; } });
    await runDeploy({ configPath: CONFIG }, h.deps);
    assert.deepStrictEqual(seen, [path.join(SITE, 'docs')]);
  });

  it('a clean check says so and the deploy goes on, with the summary in --json', async () => {
    const h = harness();
    assert.strictEqual(await runDeploy({ configPath: CONFIG }, h.deps), 0);
    assert.match(h.text(), /Leak check: nothing hidden on the player site \(3 files/);
    assert.deepStrictEqual(h.wrangler, [['whoami'], ['pages', 'deploy', '--branch=main', '--commit-dirty=true']]);
    const j = harness();
    await runDeploy({ configPath: CONFIG, json: true }, j.deps);
    const payload = JSON.parse(j.out.join(''));
    assert.strictEqual(payload.deployed, true);
    assert.strictEqual(payload.leaks.checked, true);
    assert.deepStrictEqual(payload.leaks.findings, []);
  });

  it('--dry-run runs the gate read-only, says what it would refuse, exit 1, and runs nothing', async () => {
    const h = harness({ leakGate: leaking });
    const rc = await runDeploy({ configPath: CONFIG, dryRun: true }, h.deps);
    assert.strictEqual(rc, 1);
    assert.deepStrictEqual(h.builds, []);
    assert.deepStrictEqual(h.wrangler, []);
    assert.match(h.text(), /would stop/i);
    assert.match(h.text(), /\[abc123\]/);
  });

  it('--dry-run --json carries wouldRefuse and the findings', async () => {
    const h = harness({ leakGate: leaking });
    const rc = await runDeploy({ configPath: CONFIG, dryRun: true, json: true }, h.deps);
    assert.strictEqual(rc, 1);
    const payload = JSON.parse(h.out.join(''));
    assert.strictEqual(payload.wouldRefuse, true);
    assert.strictEqual(payload.dryRun, true);
    assert.deepStrictEqual(payload.leaks.findings.map((f) => f.id), ['abc123']);
  });

  it('--dry-run with no built folder says there is nothing to check, exit 0', async () => {
    const h = harness({ leakGate: () => ({ skipped: null, missing: true, findings: [], unneeded: [], files: 0, seconds: 0 }) });
    assert.strictEqual(await runDeploy({ configPath: CONFIG, dryRun: true }, h.deps), 0);
    assert.match(h.text(), /nothing to check/i);
  });

  it('a real deploy with no built folder is refused', async () => {
    const h = harness({ leakGate: () => ({ skipped: null, missing: true, findings: [], unneeded: [], files: 0, seconds: 0 }) });
    assert.strictEqual(await runDeploy({ configPath: CONFIG, noBuild: true }, h.deps), 1);
    assert.match(h.text(), /no built site/i);
    assert.deepStrictEqual(h.wrangler, []);
  });

  it('a gate that cannot run uploads nothing', async () => {
    const h = harness({ leakGate: () => { throw new Error('vault unreadable'); } });
    assert.strictEqual(await runDeploy({ configPath: CONFIG }, h.deps), 1);
    assert.deepStrictEqual(h.wrangler.filter((a) => a[0] === 'pages'), []);
    assert.match(h.text(), /leak check could not run: vault unreadable/i);
  });

  it('a gate that cannot run on a dry run exits 1', async () => {
    const h = harness({ leakGate: () => { throw new Error('vault unreadable'); } });
    assert.strictEqual(await runDeploy({ configPath: CONFIG, dryRun: true }, h.deps), 1);
    assert.match(h.text(), /leak check could not run: vault unreadable/i);
  });

  it('--ignore-leaks prints every finding and uploads anyway, exit 0', async () => {
    const h = harness({ leakGate: leaking });
    const rc = await runDeploy({ configPath: CONFIG, ignoreLeaks: true }, h.deps);
    assert.strictEqual(rc, 0);
    assert.match(h.text(), /\[abc123\] npcs\/a\.html: "The baker poisoned the mayor\."/);
    assert.match(h.text(), /Deploying anyway: --ignore-leaks/);
    assert.deepStrictEqual(h.wrangler, [['whoami'], ['pages', 'deploy', '--branch=main', '--commit-dirty=true']]);
  });

  it('--ignore-leaks --json says leaksIgnored and keeps the findings', async () => {
    const h = harness({ leakGate: leaking });
    assert.strictEqual(await runDeploy({ configPath: CONFIG, ignoreLeaks: true, json: true }, h.deps), 0);
    const payload = JSON.parse(h.out.join(''));
    assert.strictEqual(payload.leaksIgnored, true);
    assert.strictEqual(payload.refused, undefined);
    assert.deepStrictEqual(payload.leaks.findings.map((f) => f.id), ['abc123']);
  });

  it('--ignore-leaks past a gate that cannot run says so and uploads', async () => {
    const docs = path.join(SITE, 'docs');
    const h = harness({ leakGate: () => { throw new Error('vault unreadable'); }, exists: (p) => p === docs || p === path.join(SITE, 'wrangler.toml') });
    assert.strictEqual(await runDeploy({ configPath: CONFIG, ignoreLeaks: true }, h.deps), 0);
    assert.match(h.text(), /leak check could not run: vault unreadable/i);
    assert.doesNotMatch(h.text(), /Nothing was uploaded/);
    assert.deepStrictEqual(h.wrangler, [['whoami'], ['pages', 'deploy', '--branch=main', '--commit-dirty=true']]);
  });

  it('--ignore-leaks still stops when there is no built site to upload', async () => {
    const h = harness({ leakGate: () => ({ skipped: null, missing: true, findings: [], unneeded: [], files: 0, seconds: 0 }) });
    assert.strictEqual(await runDeploy({ configPath: CONFIG, noBuild: true, ignoreLeaks: true }, h.deps), 1);
    assert.deepStrictEqual(h.wrangler.filter((a) => a[0] === 'pages'), []);
  });

  it('--ignore-leaks past a gate that cannot run still stops when there is no built site', async () => {
    const h = harness({ leakGate: () => { throw new Error('vault unreadable'); }, exists: () => false });
    assert.strictEqual(await runDeploy({ configPath: CONFIG, noBuild: true, ignoreLeaks: true }, h.deps), 1);
    assert.deepStrictEqual(h.wrangler.filter((x) => x[0] === 'pages'), []);
    assert.match(h.text(), /no built site/);
  });

  it('--ignore-leaks on a dry run lists the findings and exits 0', async () => {
    const h = harness({ leakGate: leaking });
    assert.strictEqual(await runDeploy({ configPath: CONFIG, dryRun: true, ignoreLeaks: true }, h.deps), 0);
    assert.match(h.text(), /deploy would go ahead anyway \(--ignore-leaks\)/);
    assert.match(h.text(), /\[abc123\]/);
  });

  it('github-pages with --ignore-leaks commits and pushes', async () => {
    const h = harness({ leakGate: leaking, config: { host: 'github-pages' } });
    await runDeploy({ configPath: CONFIG, ignoreLeaks: true }, h.deps);
    assert.ok(h.commands.some((c) => c.cmd === 'git' && c.args[0] === 'push'));
  });

  it('a vault kept by a player: one line, and the deploy goes on', async () => {
    const h = harness({ leakGate: () => ({ skipped: 'The leak check is skipped: this vault is kept by a player (vault.kept_by: player), so it holds nothing hidden.', missing: false, findings: [], unneeded: [], files: 0, seconds: 0 }) });
    assert.strictEqual(await runDeploy({ configPath: CONFIG }, h.deps), 0);
    assert.match(h.text(), /kept by a player/);
    assert.doesNotMatch(h.text(), /nothing hidden on the player site/);
    assert.deepStrictEqual(h.wrangler, [['whoami'], ['pages', 'deploy', '--branch=main', '--commit-dirty=true']]);
  });
});

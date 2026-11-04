'use strict';
// #576, review C: deploy against real temp git repos (a bare remote to push to), for a file whose letter case changed
// on a Mac or Windows disk. Only the build and the leak gate are stood in; git, the disk and the deploy steps are real.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { runDeploy } = require('../lib/deploy-cli');

const git = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
};
const insensitive = (dir) => {
  const probe = path.join(dir, 'CASE-PROBE');
  fs.writeFileSync(probe, '');
  try { return fs.existsSync(path.join(dir, 'case-probe')); } finally { fs.rmSync(probe); }
};
const recase = (from, to) => { fs.renameSync(from, `${from}.t`); fs.renameSync(`${from}.t`, to); };

// A repo with the site in `sub` (or at the root), docs/ committed and pushed to a bare remote.
function setup({ sub = '', ignorecase = true, runCommand = null } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-case-')));
  const remote = path.join(root, 'remote.git');
  const repo = path.join(root, 'repo');
  git(root, 'init', '-q', '--bare', remote);
  fs.mkdirSync(repo);
  git(repo, 'init', '-q');
  git(repo, 'config', 'core.ignorecase', String(ignorecase));
  git(repo, 'config', 'user.email', 't@example.com');
  git(repo, 'config', 'user.name', 'T');
  git(repo, 'remote', 'add', 'origin', remote);
  const site = path.join(repo, sub);
  fs.mkdirSync(path.join(site, 'docs', 'gazetteer'), { recursive: true });
  fs.writeFileSync(path.join(site, 'docs', 'gazetteer', 'invitation.html'), 'a');
  fs.writeFileSync(path.join(site, 'docs', 'index.html'), 'i');
  fs.writeFileSync(path.join(repo, 'README.md'), 'r');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'one');
  git(repo, 'push', '-q', '-u', 'origin', 'HEAD');
  const out = [];
  const deps = {
    out: (l) => out.push(String(l)),
    config: { host: 'github-pages', outputDir: './docs', siteUrl: 'https://example.github.io/x' },
    build: () => {},
    leakGate: () => ({ skipped: null, missing: false, findings: [], unneeded: [], files: 2, seconds: 0.01 }),
    assertNoStopsFor: () => {},
    siteOffFor: () => null,
    ...(runCommand ? { runCommand } : {}),
  };
  const deploy = async (more = {}) => { out.length = 0; return runDeploy({ configPath: path.join(site, 'vault.config.json'), noBuild: true, ...more }, deps); };
  return { root, repo, site, out, deploy, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}
const recaseInvitation = (s) => {
  const g = path.join(s.site, 'docs', 'gazetteer');
  recase(path.join(g, 'invitation.html'), path.join(g, 'Invitation.html'));
  fs.writeFileSync(path.join(g, 'Invitation.html'), 'b');
};
const headFiles = (s) => git(s.repo, 'ls-tree', '-r', '--name-only', 'HEAD').trim().split('\n').sort();

describe('deploy: a case-only rename with real git', () => {
  it('a commit that fails once leaves the rename staged; the next deploy commits it', async (t) => {
    const s = setup();
    try {
      if (!insensitive(s.repo)) { t.skip('this disk tells letter case apart'); return; }
      recaseInvitation(s);
      const hook = path.join(s.repo, '.git', 'hooks', 'pre-commit');
      fs.writeFileSync(hook, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
      assert.equal(await s.deploy(), 1);
      assert.match(s.out.join('\n'), /Commit failed/);
      assert.match(s.out.join('\n'), /the old letter-case spellings under docs\/ are out of git's index and the new ones staged: fix what stopped the commit, then deploy again/);
      fs.rmSync(hook);
      assert.equal(await s.deploy(), 0, s.out.join('\n'));
      assert.deepEqual(headFiles(s), ['README.md', 'docs/gazetteer/Invitation.html', 'docs/index.html']);
      assert.equal(git(s.repo, 'show', 'HEAD:docs/gazetteer/Invitation.html'), 'b');
    } finally { s.cleanup(); }
  });

  it('a site folder below the repo root: a commit that fails once still leaves the rename for the next deploy', async (t) => {
    const s = setup({ sub: 'site' });
    try {
      if (!insensitive(s.repo)) { t.skip('this disk tells letter case apart'); return; }
      recaseInvitation(s);
      const hook = path.join(s.repo, '.git', 'hooks', 'pre-commit');
      fs.writeFileSync(hook, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
      assert.equal(await s.deploy(), 1);
      assert.match(s.out.join('\n'), /the old letter-case spellings under docs\/ are out of git's index and the new ones staged/);
      fs.rmSync(hook);
      assert.equal(await s.deploy(), 0, s.out.join('\n'));
      assert.deepEqual(headFiles(s), ['README.md', 'site/docs/gazetteer/Invitation.html', 'site/docs/index.html']);
    } finally { s.cleanup(); }
  });

  it('a git add that fails after the old spelling left the index: the next deploy still commits the new spelling', async (t) => {
    const real = require('../lib/run-command').runCommand;
    let failAdd = true;
    const s = setup({ runCommand: (cmd, args, o) => {
      if (args[0] === 'add' && failAdd) { failAdd = false; return { code: 1, stdout: '', stderr: 'fatal: add stood in to fail' }; }
      return real(cmd, args, o);
    } });
    try {
      if (!insensitive(s.repo)) { t.skip('this disk tells letter case apart'); return; }
      recaseInvitation(s);
      assert.equal(await s.deploy(), 1);
      assert.match(s.out.join('\n'), /add stood in to fail/);
      assert.equal(await s.deploy(), 0, s.out.join('\n'));
      assert.deepEqual(headFiles(s), ['README.md', 'docs/gazetteer/Invitation.html', 'docs/index.html']);
      assert.equal(git(s.repo, 'show', 'HEAD:docs/gazetteer/Invitation.html'), 'b');
    } finally { s.cleanup(); }
  });

  it('a page staged by hand before its letter case changed still takes its new spelling', async (t) => {
    const s = setup();
    try {
      if (!insensitive(s.repo)) { t.skip('this disk tells letter case apart'); return; }
      fs.writeFileSync(path.join(s.site, 'docs', 'gazetteer', 'invitation.html'), 'staged by hand');
      git(s.repo, 'add', 'docs/gazetteer/invitation.html');
      recaseInvitation(s);
      assert.equal(await s.deploy(), 0, s.out.join('\n'));
      assert.deepEqual(headFiles(s), ['README.md', 'docs/gazetteer/Invitation.html', 'docs/index.html']);
      assert.equal(git(s.repo, 'show', 'HEAD:docs/gazetteer/Invitation.html'), 'b');
    } finally { s.cleanup(); }
  });

  it('a dry run prints the letter-case steps a real deploy takes, and the stop for files staged elsewhere', async (t) => {
    const s = setup();
    try {
      if (!insensitive(s.repo)) { t.skip('this disk tells letter case apart'); return; }
      recaseInvitation(s);
      assert.equal(await s.deploy({ dryRun: true }), 0, s.out.join('\n'));
      const text = s.out.join('\n');
      assert.match(text, /git rm --cached -q -f -- :\(literal\)docs\/gazetteer\/invitation\.html\n {2}git add docs\/\n {2}git commit -m "Rebuild site"\n/);
      assert.doesNotMatch(text, /--only/);
      assert.ok(git(s.repo, 'ls-files').includes('docs/gazetteer/invitation.html'), 'the dry run changed nothing');
      fs.writeFileSync(path.join(s.repo, 'README.md'), 'changed');
      git(s.repo, 'add', 'README.md');
      assert.equal(await s.deploy({ dryRun: true }), 1);
      assert.match(s.out.join('\n'), /Deploy would stop: files outside docs\/ are staged \(README\.md\)/);
    } finally { s.cleanup(); }
  });

  it('a site folder below the repo root still sees a file staged at the root, and stops', async (t) => {
    const s = setup({ sub: 'site' });
    try {
      if (!insensitive(s.repo)) { t.skip('this disk tells letter case apart'); return; }
      recaseInvitation(s);
      fs.writeFileSync(path.join(s.repo, 'README.md'), 'changed');
      git(s.repo, 'add', 'README.md');
      assert.equal(await s.deploy(), 1);
      assert.match(s.out.join('\n'), /Deploy stopped: files outside docs\/ are staged \(README\.md\)/);
      assert.equal(git(s.repo, 'show', 'HEAD:README.md'), 'r', 'nothing committed');
    } finally { s.cleanup(); }
  });

  it('a repo without core.ignorecase deploys as before, with --only, whatever else is staged', async () => {
    const s = setup({ ignorecase: false });
    try {
      // An ordinary renamed page, as Linux sees it: the old file gone, a new one with another case.
      const g = path.join(s.site, 'docs', 'gazetteer');
      fs.rmSync(path.join(g, 'invitation.html'));
      fs.writeFileSync(path.join(g, 'INVITATION.html'), 'b');
      fs.writeFileSync(path.join(s.repo, 'README.md'), 'changed');
      git(s.repo, 'add', 'README.md');
      assert.equal(await s.deploy(), 0, s.out.join('\n'));
      assert.doesNotMatch(s.out.join('\n'), /letter case/);
      assert.equal(git(s.repo, 'show', 'HEAD:README.md'), 'r', 'the staged README stays out of the site commit');
      assert.ok(git(s.repo, 'diff', '--cached', '--name-only').includes('README.md'), 'and stays staged');
    } finally { s.cleanup(); }
  });

  it('many renamed files go through git in batches short enough for any command line', async (t) => {
    const real = require('../lib/run-command').runCommand;
    const rms = [];
    const s = setup({ runCommand: (cmd, args, o) => { if (args[0] === 'rm') rms.push(args); return real(cmd, args, o); } });
    try {
      if (!insensitive(s.repo)) { t.skip('this disk tells letter case apart'); return; }
      const dir = path.join(s.site, 'docs', 'gazetteer', 'letters');
      fs.mkdirSync(dir);
      for (let i = 0; i < 250; i++) fs.writeFileSync(path.join(dir, `letter-${String(i).padStart(3, '0')}-with-a-long-enough-name.html`), String(i));
      git(s.repo, 'add', '-A'); git(s.repo, 'commit', '-q', '-m', 'letters');
      recase(dir, path.join(s.site, 'docs', 'gazetteer', 'Letters'));
      assert.equal(await s.deploy(), 0, s.out.join('\n'));
      assert.ok(rms.length >= 2, `${rms.length} git rm runs`);
      // Windows caps a command line at 32,767 characters.
      for (const args of rms) assert.ok(args.join(' ').length < 16000, `${args.join(' ').length} characters`);
      assert.ok(headFiles(s).filter((f) => f.startsWith('docs/gazetteer/Letters/')).length === 250);
      assert.ok(!headFiles(s).some((f) => f.startsWith('docs/gazetteer/letters/')));
    } finally { s.cleanup(); }
  });

  it('a leftover temporary name from a case rename stops the deploy before git add, and is named', async () => {
    const s = setup();
    try {
      fs.writeFileSync(path.join(s.site, 'docs', 'gazetteer', 'invitation.html.case-123.tmp'), 'only copy');
      assert.equal(await s.deploy(), 1);
      const text = s.out.join('\n');
      assert.match(text, /Deploy stopped: a file in docs\/ still has the temporary name a letter-case rename gave it: docs\/gazetteer\/invitation\.html\.case-123\.tmp/);
      assert.match(text, /give it back its name \(invitation\.html\) or move it out of the site folder; deploy never deletes it/);
      assert.ok(fs.existsSync(path.join(s.site, 'docs', 'gazetteer', 'invitation.html.case-123.tmp')));
      assert.ok(!git(s.repo, 'ls-files').includes('.case-'), 'not staged');
    } finally { s.cleanup(); }
  });

  it('a dry run names a leftover temporary name and would stop, --ignore-leaks or not, in text and JSON', async () => {
    const s = setup();
    try {
      fs.writeFileSync(path.join(s.site, 'docs', 'gazetteer', 'invitation.html.case-123.tmp'), 'only copy');
      assert.equal(await s.deploy({ dryRun: true, ignoreLeaks: true }), 1);
      assert.match(s.out.join('\n'), /Deploy would stop: a file in docs\/ still has the temporary name a letter-case rename gave it: docs\/gazetteer\/invitation\.html\.case-123\.tmp/);
      assert.equal(await s.deploy({ dryRun: true, json: true }), 1);
      const payload = JSON.parse(s.out.join('\n'));
      assert.deepEqual(payload.caseTemps, ['docs/gazetteer/invitation.html.case-123.tmp']);
      assert.equal(payload.wouldRefuse, true);
    } finally { s.cleanup(); }
  });

  it('on a git host the temporary-name check reads the folder git commits, whatever wrangler.toml names', async () => {
    const s = setup();
    try {
      fs.mkdirSync(path.join(s.site, 'other'));
      fs.writeFileSync(path.join(s.site, 'wrangler.toml'), 'name = "x"\npages_build_output_dir = "other"\n');
      fs.writeFileSync(path.join(s.site, 'docs', 'index.html.case-7.tmp'), 'only copy');
      assert.equal(await s.deploy(), 1);
      assert.match(s.out.join('\n'), /temporary name a letter-case rename gave it: docs\/index\.html\.case-7\.tmp/);
      assert.ok(!git(s.repo, 'ls-files').includes('.case-'), 'not staged');
    } finally { s.cleanup(); }
  });
});

'use strict';
// #576 review A: on a Mac or Windows disk git (core.ignorecase) keeps a file's old letter case in its index when only
// the case changes on disk, so `git add` alone never records the rename and the deployed site keeps the old address.
// Deploy takes the old spellings out of the index first, so `git add` records the new ones.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { runCommand } = require('../../lib/run-command');
const { caseRenames: staleCaseSpellings } = require('../../lib/git-case');

const git = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
};
function repo() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'git-case-')));
  git(root, 'init', '-q');
  git(root, 'config', 'core.ignorecase', 'true');
  git(root, 'config', 'user.email', 't@example.com');
  git(root, 'config', 'user.name', 'T');
  fs.mkdirSync(path.join(root, 'docs', 'gazetteer', 'letters'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'gazetteer', 'invitation.html'), 'a');
  fs.writeFileSync(path.join(root, 'docs', 'gazetteer', 'letters', 'note.html'), 'n');
  fs.writeFileSync(path.join(root, 'docs', 'index.html'), 'i');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'one');
  return root;
}
const insensitive = (dir) => {
  const probe = path.join(dir, 'CASE-PROBE');
  fs.writeFileSync(probe, '');
  try { return fs.existsSync(path.join(dir, 'case-probe')); } finally { fs.rmSync(probe); }
};
// Two steps, as the build renames (a case-only rename is not one step everywhere).
const recase = (from, to) => { fs.renameSync(from, `${from}.t`); fs.renameSync(`${from}.t`, to); };

describe('caseRenames', () => {
  it('finds the tracked spellings whose file or folder now has another case, and deploy records the new ones', (t) => {
    const root = repo();
    try {
      if (!insensitive(root)) { t.skip('this disk tells letter case apart'); return; }
      const g = path.join(root, 'docs', 'gazetteer');
      recase(path.join(g, 'invitation.html'), path.join(g, 'Invitation.html'));
      fs.writeFileSync(path.join(g, 'Invitation.html'), 'b');
      recase(path.join(g, 'letters'), path.join(g, 'Letters'));
      const stale = staleCaseSpellings(root, 'docs', runCommand);
      assert.deepEqual(stale.paths.sort(), ['docs/gazetteer/invitation.html', 'docs/gazetteer/letters/note.html']);
      // Deploy's steps (deploy-cli.js): the old spellings leave the index, then add, then a commit of the index (a
      // commit with --only adds the old name back, and git refuses it).
      git(root, 'rm', '--cached', '-q', '--', ...stale.paths.map((p) => `:(literal)${p}`));
      git(root, 'add', 'docs');
      git(root, 'commit', '-q', '-m', 'Rebuild site');
      assert.deepEqual(git(root, 'ls-files', 'docs').trim().split('\n').sort(),
        ['docs/gazetteer/Invitation.html', 'docs/gazetteer/Letters/note.html', 'docs/index.html']);
      assert.equal(git(root, 'show', 'HEAD:docs/gazetteer/Invitation.html'), 'b');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it('without the step git keeps the old spelling (why it is needed)', (t) => {
    const root = repo();
    try {
      if (!insensitive(root)) { t.skip('this disk tells letter case apart'); return; }
      const g = path.join(root, 'docs', 'gazetteer');
      recase(path.join(g, 'invitation.html'), path.join(g, 'Invitation.html'));
      git(root, 'add', 'docs');
      assert.ok(git(root, 'ls-files', 'docs').includes('docs/gazetteer/invitation.html'));
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it('a repo with nothing renamed, and a path gone from disk, give nothing', () => {
    const root = repo();
    try {
      fs.rmSync(path.join(root, 'docs', 'index.html'));
      assert.deepEqual(staleCaseSpellings(root, 'docs', runCommand).paths, []);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});

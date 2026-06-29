const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const toolDir = path.resolve(__dirname, '..', '..');
const repoRoot = path.resolve(toolDir, '..', '..');
const pkg = require('../../package.json');
const deps = Object.keys(pkg.dependencies || {});

function isGitRepo() {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: repoRoot, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

describe('runtime dependencies (Bug 1 guardrail)', () => {
  it('declares at least one runtime dependency', () => {
    assert.ok(deps.length > 0, 'package.json should declare runtime dependencies');
  });

  for (const dep of deps) {
    it(`can require '${dep}' from the tool directory`, () => {
      // Mirrors how the symlinked tool resolves its deps from its own location.
      assert.doesNotThrow(() => {
        require.resolve(dep, { paths: [toolDir] });
      }, `runtime dependency '${dep}' must be resolvable from the tool directory`);
    });

    it(`ships '${dep}' as a git-tracked (vendored) file`, (t) => {
      // The plugin cache is a git copy: a dep that is not tracked never reaches the cache,
      // which is exactly how Bug 1 happened. Tracking, not a local npm install, is the fix.
      if (!isGitRepo()) {
        t.skip('not a git repo — cannot check tracked state (e.g. running from an extracted copy)');
        return;
      }
      const out = execFileSync(
        'git',
        ['ls-files', path.join('tools', 'publish', 'node_modules', dep, 'package.json')],
        { cwd: repoRoot, encoding: 'utf8' },
      ).trim();
      assert.ok(
        out.length > 0,
        `node_modules/${dep}/package.json must be committed (vendored), got no git-tracked match`,
      );
    });
  }

  it('vendored deps are physically present in node_modules', () => {
    for (const dep of deps) {
      const p = path.join(toolDir, 'node_modules', dep, 'package.json');
      assert.ok(fs.existsSync(p), `expected vendored ${dep} at ${p}`);
    }
  });
});

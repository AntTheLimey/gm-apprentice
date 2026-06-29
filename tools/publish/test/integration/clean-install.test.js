const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync, spawnSync } = require('child_process');

// Repo root is four levels up from tools/publish/test/integration.
const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const toolRel = path.join('tools', 'publish');

function isGitRepo() {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: repoRoot, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Mirror what a fresh `/plugin install` (or `/plugin update`) actually copies into
 * `~/.claude/plugins/cache/.../<version>/tools/publish`: the set of git-tracked files,
 * and nothing else. Untracked/gitignored files (notably node_modules) are absent.
 *
 * Using `git ls-files` (not `git archive HEAD`) makes this index-aware: staging the
 * vendored deps is enough to flip this test from failing to passing, no commit required.
 */
function copyTrackedTool(destCacheRoot) {
  const out = execFileSync('git', ['ls-files', toolRel], { cwd: repoRoot }).toString();
  const files = out.split('\n').map((s) => s.trim()).filter(Boolean);
  for (const rel of files) {
    const src = path.join(repoRoot, rel);
    const dest = path.join(destCacheRoot, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    // Preserve symlinks (e.g. node_modules/.bin/*) rather than dereferencing them.
    const stat = fs.lstatSync(src);
    if (stat.isSymbolicLink()) {
      fs.symlinkSync(fs.readlinkSync(src), dest);
    } else {
      fs.copyFileSync(src, dest);
    }
  }
  return path.join(destCacheRoot, toolRel);
}

describe('clean install build (Bug 1 guardrail)', () => {
  it('builds from a git-copy cache linked into a site with no deps of its own', (t) => {
    if (!isGitRepo()) {
      t.skip('not a git repo — cannot mirror plugin-cache copy');
      return;
    }

    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-clean-install-'));
    try {
      // 1. Simulate the plugin cache: git-tracked tool files only.
      const cacheToolDir = copyTrackedTool(path.join(work, 'cache'));

      // 2. Simulate a site that pins the tool via `file:` — npm symlinks the cache dir into
      //    node_modules, so at build time Node resolves the tool's own require()s from the
      //    cache location, NOT the site. The site has no node_modules of its own.
      const site = path.join(work, 'site');
      const siteModules = path.join(site, 'node_modules');
      fs.mkdirSync(siteModules, { recursive: true });
      fs.symlinkSync(cacheToolDir, path.join(siteModules, 'gm-apprentice-publish'), 'dir');

      // Use the known-good committed fixture vault (it ships inside the cache copy).
      const vault = path.join(cacheToolDir, 'test', 'fixtures', 'minimal');
      assert.ok(fs.existsSync(vault), 'fixture vault should be copied into the cache');
      fs.writeFileSync(
        path.join(site, 'vault.config.json'),
        JSON.stringify({
          siteTitle: 'Clean Install',
          siteUrl: 'https://example.github.io/clean-install',
          vaultPath: vault,
          outputDir: './docs',
          excludeDirs: ['_meta', '_Templates'],
          folderMap: {
            _Campaign: 'campaign',
            'Characters/PCs': 'characters/pcs',
            'Characters/NPCs': 'characters/npcs',
            Locations: 'locations',
          },
        }),
      );

      // 3. Build exactly as `npm run build` would — through the symlinked bin.
      const bin = path.join(siteModules, 'gm-apprentice-publish', 'bin', 'gm-publish.js');
      const res = spawnSync(process.execPath, [bin, 'build'], { cwd: site, encoding: 'utf8' });

      assert.strictEqual(
        res.status,
        0,
        `build should succeed from a clean install; exit=${res.status}\nstdout:\n${res.stdout}\nstderr:\n${res.stderr}`,
      );

      const docs = path.join(site, 'docs');
      assert.ok(fs.existsSync(path.join(docs, 'index.html')), 'landing page should be written');
      // require.resolve('lunr') must resolve to a real file so the client search lib is copied.
      assert.ok(fs.existsSync(path.join(docs, 'js', 'lunr.js')), 'client lunr.js should be copied');
      assert.ok(
        fs.existsSync(path.join(docs, 'locations', 'test-location.html')),
        'a fixture location page should render',
      );
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  });
});

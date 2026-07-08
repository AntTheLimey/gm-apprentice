const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('theme showcase build', () => {
  const repoRoot = path.join(__dirname, '..', '..', '..', '..');
  const script = path.join(repoRoot, 'scripts', 'build-theme-showcase.mjs');
  let outDir;

  before(() => {
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-showcase-'));
    execFileSync('node', [script, '--out', outDir], { stdio: 'pipe' });
  });

  after(() => { fs.rmSync(outDir, { recursive: true, force: true }); });

  it('builds one site per preset plus the gallery index', () => {
    for (const preset of ['fantasy', 'horror', 'military', 'noir', 'scifi']) {
      assert.ok(fs.existsSync(path.join(outDir, preset, 'index.html')), preset);
      assert.ok(fs.existsSync(path.join(outDir, preset, 'css', 'themes', `${preset}.css`)),
        `${preset} theme css copied`);
    }
    assert.ok(fs.existsSync(path.join(outDir, 'index.html')), 'gallery index');
  });

  it('gallery index links every preset', () => {
    const html = fs.readFileSync(path.join(outDir, 'index.html'), 'utf-8');
    for (const preset of ['fantasy', 'horror', 'military', 'noir', 'scifi']) {
      assert.ok(html.includes(`href="${preset}/index.html"`), preset);
    }
  });
});

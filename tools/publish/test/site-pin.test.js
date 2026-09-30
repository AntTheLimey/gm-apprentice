const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { sitePin, semverBelow, parseSemver } = require('../lib/site-pin');

// The same vectors drive tests/test_site_pin.py, so vault_check's gate and this one agree.
const VECTORS = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'site-pin-vectors.json'), 'utf8'));

// A site directory as a vector describes it.
function siteFrom(v) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'site-pin-'));
  const tool = path.join(dir, 'node_modules', 'gm-apprentice-publish');
  if (v.installed === 'BROKEN_SYMLINK') {
    fs.mkdirSync(path.dirname(tool), { recursive: true });
    fs.symlinkSync(path.join(dir, 'no-such-dir'), tool);
  } else if (v.installed != null) {
    fs.mkdirSync(tool, { recursive: true });
    fs.writeFileSync(path.join(tool, 'package.json'),
      v.installed === 'UNPARSEABLE' ? '{nope' : JSON.stringify({ name: 'gm-apprentice-publish', version: v.installed }));
  }
  if (v.package != null) {
    fs.writeFileSync(path.join(dir, 'package.json'), v.package === 'UNPARSEABLE' ? '{nope' : JSON.stringify(v.package));
  }
  return dir;
}

describe('site-pin: strict semver comparison (shared vectors)', () => {
  for (const [a, b, below] of VECTORS.below) {
    it(`${a} ${below ? '<' : '>='} ${b}`, () => assert.strictEqual(semverBelow(a, b), below));
  }
  for (const bad of VECTORS.invalid) {
    it(`"${bad}" is not a version`, () => {
      assert.strictEqual(parseSemver(bad), null);
      assert.throws(() => semverBelow(bad, '1.11.40'));
    });
  }
});

describe('site-pin: which tool a site builds with (shared vectors)', () => {
  for (const v of VECTORS.sites) {
    it(v.name, () => {
      const dir = siteFrom(v);
      try {
        const got = sitePin(dir);
        assert.deepStrictEqual({ stale: !!got.stale, version: got.version, source: got.source }, v.expect);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  }
});

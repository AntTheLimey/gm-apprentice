const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// #359: the bundled packages are at or past the first version that fixes their advisories
// (slow-parsing denial of service), and each one is still bundled.
const ROOT = path.join(__dirname, '..', '..');
const FIXED_IN = { 'js-yaml': '3.15.2', 'markdown-it': '14.3.1', 'linkify-it': '5.0.2' };

const parts = (v) => v.split('.').map(Number);
const atLeast = (have, want) => {
  const [a, b] = [parts(have), parts(want)];
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
};

describe('bundled dependencies carry the security fixes (#359)', () => {
  for (const [name, fixed] of Object.entries(FIXED_IN)) {
    it(`${name} is ${fixed} or later in node_modules and in the lockfile`, () => {
      const installed = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', name, 'package.json'), 'utf8')).version;
      assert.ok(atLeast(installed, fixed), `${name} ${installed} is older than ${fixed}`);
      const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8')).packages[`node_modules/${name}`];
      assert.strictEqual(lock.version, installed);
      assert.strictEqual(lock.inBundle, true, `${name} must stay bundled`);
    });
  }

  it('the tool still bundles them', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    for (const name of ['js-yaml', 'markdown-it']) assert.ok(pkg.bundleDependencies.includes(name), name);
  });
});

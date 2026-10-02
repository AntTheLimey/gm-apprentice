const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const yaml = require('js-yaml');
const { loadPublishConfig } = require('../../lib/config');
const vectors = require('../fixtures/config-resolution-vectors.json');

function vaultWith(publish) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-cfgres-'));
  fs.mkdirSync(path.join(dir, '_meta'));
  if (publish) fs.writeFileSync(path.join(dir, '_meta', 'vault-config.md'), `---\n${yaml.safeDump({ publish })}---\n`);
  return dir;
}

describe('config resolution: vault file first, site file only when it is silent', () => {
  for (const v of vectors) {
    it(v.name, () => {
      const vault = vaultWith(v.vault);
      try {
        const warned = [];
        const realWarn = console.warn;
        console.warn = (...a) => warned.push(a.join(' '));
        let cfg;
        try { cfg = loadPublishConfig(vault, v.site); } finally { console.warn = realWarn; }
        // A vector names the warning it expects, or expects none.
        if (v.warns) assert.ok(warned.some((w) => w.includes(v.warns)), `expected a warning naming ${v.warns}: ${warned}`);
        else assert.deepStrictEqual(warned, []);
        for (const [key, value] of Object.entries(v.expect)) assert.deepStrictEqual(cfg[key], value, key);
        assert.deepStrictEqual(
          cfg.legacy.map(({ key, status, dropped }) => (dropped ? { key, status, dropped } : { key, status })),
          v.legacy);
      } finally {
        fs.rmSync(vault, { recursive: true, force: true });
      }
    });
  }
});

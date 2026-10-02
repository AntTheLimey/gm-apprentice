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
        const cfg = loadPublishConfig(vault, v.site);
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

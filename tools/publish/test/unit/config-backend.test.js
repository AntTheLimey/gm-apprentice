const { describe, it } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { loadPublishConfig } = require('../../lib/config');

function tmpVault() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-cfg-'));
  fs.mkdirSync(path.join(dir, '_meta'), { recursive: true });
  return dir;
}

describe('loadPublishConfig backend flags', () => {
  it('passes explicit flags from vault.config.json through', () => {
    const vault = tmpVault();
    const cfg = loadPublishConfig(vault, { backend: { statusBar: true, inbox: false } });
    assert.strictEqual(cfg.backend.statusBar, true);
    assert.strictEqual(cfg.backend.inbox, false);
  });

  it('leaves flags undefined when neither source sets them', () => {
    const vault = tmpVault();
    const cfg = loadPublishConfig(vault, {});
    assert.strictEqual(cfg.backend.statusBar, undefined);
    assert.strictEqual(cfg.backend.inbox, undefined);
  });

  it('vault-config.md publish.backend wins over vault.config.json', () => {
    const vault = tmpVault();
    fs.writeFileSync(
      path.join(vault, '_meta', 'vault-config.md'),
      '---\npublish:\n  backend:\n    inbox: true\n---\n',
    );
    const cfg = loadPublishConfig(vault, { backend: { inbox: false, statusBar: false } });
    assert.strictEqual(cfg.backend.inbox, true);       // publish block wins
    assert.strictEqual(cfg.backend.statusBar, false);  // only json sets it → json value
  });
});

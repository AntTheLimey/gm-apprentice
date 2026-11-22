'use strict';
// The run sheet's two system fixture vaults (test/fixtures/run-sheet-coc, run-sheet-gurps), copied to a temp folder
// a test may change. `copyFixture(name, { crlf })` copies the folder and returns its path (`crlf: true` rewrites every
// text file to CRLF line ends, as a Windows checkout has them, so a test can prove a reader copes); `withSystem(dir,
// id)` rewrites the copy's `system:` in `_meta/vault-config.yaml` (e.g. `coc-7e-regency`) and returns the path;
// `removeFixture(dir)` deletes the copy. The checked-in fixture is never written to.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const FIXTURES = path.join(__dirname, '..', 'fixtures');
const TEXT = /\.(md|ya?ml|json|txt)$/i;

function walk(dir, fn) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, fn); else fn(p);
  }
}

// A copy of `test/fixtures/<name>` in a fresh temp folder; the path of the copy.
function copyFixture(name, { crlf = false } = {}) {
  const src = path.join(FIXTURES, name);
  if (!fs.existsSync(src)) throw new Error(`no fixture ${name}`);
  const dir = path.join(fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gm-systems-fixture-'))), name);
  fs.cpSync(src, dir, { recursive: true });
  if (crlf) {
    walk(dir, (file) => {
      if (!TEXT.test(file)) return;
      const text = fs.readFileSync(file, 'utf8');
      fs.writeFileSync(file, text.replace(/\r?\n/g, '\r\n'));
    });
  }
  return dir;
}

// The copy's game system set to `id`; the path, for chaining. Keeps the file's line ends.
function withSystem(dir, id) {
  const file = path.join(dir, '_meta', 'vault-config.yaml');
  const text = fs.readFileSync(file, 'utf8');
  if (!/^([ \t]+)system:[ \t]*.*$/m.test(text)) throw new Error(`${file} has no system: line`);
  fs.writeFileSync(file, text.replace(/^([ \t]+)system:[ \t]*.*$/m, `$1system: ${id}`));
  return dir;
}

// Deletes a copy (its temp folder too).
function removeFixture(dir) {
  fs.rmSync(path.dirname(dir), { recursive: true, force: true, maxRetries: 3 });
}

module.exports = { copyFixture, withSystem, removeFixture, FIXTURES };

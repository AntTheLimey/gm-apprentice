'use strict';
// The state file and the set-up note: the file's read and write, and the `setup-note` command on
// both layouts.
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readState, writeState } = require('../../lib/settings/state');
const { runSettings } = require('../../lib/settings/cli');
const { STATE_FILE, OLD_FILE, NEW_FILE, at } = require('../../lib/settings/layout');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'settings-state-'));
const stateText = (dir) => fs.readFileSync(at(dir, STATE_FILE), 'utf8');
const put = (dir, rel, text) => { fs.mkdirSync(path.dirname(at(dir, rel)), { recursive: true }); fs.writeFileSync(at(dir, rel), text); };

function run(dir, verb, args, json = false) {
  const out = [];
  const err = [];
  const rc = runSettings({ verb, args, vault: dir, json }, { out: (l) => out.push(l), err: (l) => err.push(l) });
  return { rc, out: out.join('\n'), err: err.join('\n') };
}
const note = (dir, args, json) => run(dir, 'setup-note', args, json);

describe('state file', () => {
  it('reads {} when the file is absent', () => {
    assert.deepStrictEqual(readState(tmp()), {});
  });

  it('keeps a key it does not know, and key order, on write', () => {
    const dir = tmp();
    put(dir, STATE_FILE, '{"future": 1, "gm_apprentice_version": "1.10.52"}');
    writeState(dir, { setup: { host: 'x' } });
    assert.strictEqual(stateText(dir), '{\n  "future": 1,\n  "gm_apprentice_version": "1.10.52",\n  "setup": {\n    "host": "x"\n  }\n}\n');
    writeState(dir, { gm_apprentice_version: '1.10.53' });
    assert.deepStrictEqual(Object.keys(readState(dir)), ['future', 'gm_apprentice_version', 'setup']);
    assert.strictEqual(readState(dir).future, 1);
    assert.ok(!fs.readdirSync(path.dirname(at(dir, STATE_FILE))).some((f) => f.endsWith('.tmp')));
  });

  it('removes a key set to null', () => {
    const dir = tmp();
    writeState(dir, { a: 1, b: 2 });
    writeState(dir, { a: null });
    assert.deepStrictEqual(readState(dir), { b: 2 });
  });

  it('says plainly when the file is broken', () => {
    const dir = tmp();
    put(dir, STATE_FILE, '{nope');
    assert.throws(() => readState(dir), /^Error: _meta\/vault-state\.json is not valid JSON: /);
    assert.throws(() => writeState(dir, { a: 1 }), /is not valid JSON/);
    assert.strictEqual(stateText(dir), '{nope');
  });

  it('does not make a vault folder that is not there, or write into a file', () => {
    const dir = tmp();
    assert.throws(() => writeState(path.join(dir, 'missing'), { a: 1 }), /is not a folder/);
    assert.ok(!fs.existsSync(path.join(dir, 'missing')));
    fs.writeFileSync(path.join(dir, 'file'), '');
    assert.throws(() => writeState(path.join(dir, 'file'), { a: 1 }), /is not a folder/);
  });
});

describe('settings setup-note on the new layout', () => {
  it('says there is no note when there is none', () => {
    const dir = tmp();
    assert.strictEqual(note(dir, ['get']).out, 'No set-up note.');
    assert.deepStrictEqual(JSON.parse(note(dir, ['get'], true).out), {});
    assert.ok(!fs.existsSync(at(dir, STATE_FILE)));
  });

  it('sets pairs and reads them back', () => {
    const dir = tmp();
    put(dir, NEW_FILE, 'version: 1\n');
    assert.strictEqual(note(dir, ['set', 'last_completed_step=9', 'host=cloudflare-pages']).rc, 0);
    assert.deepStrictEqual(JSON.parse(note(dir, ['get'], true).out), { last_completed_step: 9, host: 'cloudflare-pages' });
    assert.strictEqual(note(dir, ['get']).out, 'last_completed_step: 9\nhost: cloudflare-pages');
    assert.strictEqual(note(dir, ['get', 'host']).out, 'cloudflare-pages');
    note(dir, ['set', 'done=true', 'last_completed_step=10']);
    assert.deepStrictEqual(readState(dir).setup, { last_completed_step: 10, host: 'cloudflare-pages', done: true });
  });

  it('clear removes the note and leaves the version', () => {
    const dir = tmp();
    put(dir, STATE_FILE, '{"gm_apprentice_version": "1.10.53", "setup": {"host": "x"}}');
    const r = note(dir, ['clear']);
    assert.strictEqual(r.rc, 0);
    assert.deepStrictEqual(readState(dir), { gm_apprentice_version: '1.10.53' });
    assert.strictEqual(note(dir, ['get']).out, 'No set-up note.');
  });

  it('refuses a pair without a value, and writes nothing', () => {
    const dir = tmp();
    const r = note(dir, ['set', 'host=x', 'step']);
    assert.strictEqual(r.rc, 1);
    assert.match(r.err, /step needs a value/);
    assert.ok(!fs.existsSync(at(dir, STATE_FILE)));
  });

  it('reports a broken state file as one error line', () => {
    const dir = tmp();
    put(dir, STATE_FILE, '[1]');
    const r = note(dir, ['get']);
    assert.strictEqual(r.rc, 1);
    assert.match(r.err, /^Error: _meta\/vault-state\.json is not valid JSON/);
  });
});

describe('settings setup-note on the old layout', () => {
  const OLD = '---\npublish:\n  site: true\n  setup_progress:\n    host: pages\n    last_completed_step: 4\n---\nMy notes.\n';

  it('reads publish.setup_progress from the old file', () => {
    const dir = tmp();
    put(dir, OLD_FILE, OLD);
    assert.deepStrictEqual(JSON.parse(note(dir, ['get'], true).out), { host: 'pages', last_completed_step: 4 });
    assert.strictEqual(note(dir, ['get', 'host']).out, 'pages');
  });

  it('writes and clears it in the old file, and not in a state file', () => {
    const dir = tmp();
    put(dir, OLD_FILE, OLD);
    assert.strictEqual(note(dir, ['set', 'last_completed_step=5']).rc, 0);
    assert.strictEqual(fs.readFileSync(at(dir, OLD_FILE), 'utf8'), OLD.replace('last_completed_step: 4', 'last_completed_step: 5'));
    assert.strictEqual(note(dir, ['clear']).rc, 0);
    assert.strictEqual(fs.readFileSync(at(dir, OLD_FILE), 'utf8'), '---\npublish:\n  site: true\n---\nMy notes.\n');
    assert.ok(!fs.existsSync(at(dir, STATE_FILE)));
  });

  it('settings set still refuses the note by its name', () => {
    const dir = tmp();
    put(dir, OLD_FILE, OLD);
    const r = run(dir, 'set', ['publish.setup_progress={}']);
    assert.strictEqual(r.rc, 1);
    assert.match(r.err, /publish\.setup_progress is kept by the tool and cannot be set here/);
    assert.strictEqual(fs.readFileSync(at(dir, OLD_FILE), 'utf8'), OLD);
  });
});

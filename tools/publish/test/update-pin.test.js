const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { runUpdatePin } = require('../lib/update-pin');

const CACHE = '/home/gm/.claude/plugins/cache/gm-apprentice/gm-apprentice';

function drift(pinned, latest) {
  return {
    pinned,
    latest,
    drift: pinned !== latest,
    message: 'drift',
    suggestedPath: pinned !== latest ? `${CACHE}/${latest}/tools/publish` : null,
    versionsRoot: CACHE,
  };
}

// A fake filesystem keyed by absolute path, plus a recording npm runner whose
// effect on `installed` is spelled out per test rather than mocked away.
function harness({ files, detect, npm }) {
  const out = [];
  const writes = {};
  const runs = [];
  const store = Object.assign({}, files);
  const deps = {
    out: (line) => out.push(String(line)),
    readFile: (p) => {
      const key = path.resolve(p);
      if (!(key in store)) {
        const err = new Error(`ENOENT: no such file or directory, open '${key}'`);
        err.code = 'ENOENT';
        throw err;
      }
      return store[key];
    },
    writeFile: (p, content) => { const key = path.resolve(p); store[key] = content; writes[key] = content; },
    runCommand: (cmd, args, opts) => {
      runs.push({ cmd, args, cwd: opts && opts.cwd });
      return npm ? npm(store) : { code: 0, stdout: '', stderr: '' };
    },
    detect: () => detect,
    toolDir: '/opt/tool',
  };
  return { deps, out, writes, runs, store };
}

const sitePkg = (spec) => JSON.stringify({
  name: 'my-campaign-site',
  private: true,
  dependencies: { 'gm-apprentice-publish': spec },
}, null, 2) + '\n';

const installedPkg = (version) => JSON.stringify({ name: 'gm-apprentice-publish', version });

function siteFiles(spec, installed) {
  const files = { [path.resolve('/site/package.json')]: sitePkg(spec) };
  if (installed) {
    files[path.resolve('/site/node_modules/gm-apprentice-publish/package.json')] = installedPkg(installed);
  }
  return files;
}

describe('update-pin', () => {
  it('says nothing to repoint when the tool is not in a plugin cache', async () => {
    const h = harness({
      files: { [path.resolve('/opt/tool/package.json')]: JSON.stringify({ version: '9.9.9' }) },
      detect: null,
    });
    const rc = await runUpdatePin({ siteDir: '/site' }, h.deps);
    assert.strictEqual(rc, 0);
    assert.match(h.out.join('\n'), /not in a versioned plugin cache — the running tool is 9\.9\.9; nothing to repoint/);
    assert.deepStrictEqual(h.writes, {});
  });

  it('leaves a non-file: pin alone', async () => {
    const h = harness({ files: siteFiles('^1.2.3'), detect: drift('1.11.29', '1.11.30') });
    const rc = await runUpdatePin({ siteDir: '/site' }, h.deps);
    assert.strictEqual(rc, 0);
    assert.match(h.out.join('\n'), /pinned to \^1\.2\.3, not a plugin-cache path — leave it alone/);
    assert.deepStrictEqual(h.writes, {});
    assert.deepStrictEqual(h.runs, []);
  });

  it('reports current when the pin and the install both match the newest version', async () => {
    const h = harness({
      files: siteFiles(`file:${CACHE}/1.11.30/tools/publish`, '1.11.30'),
      detect: drift('1.11.30', '1.11.30'),
    });
    const rc = await runUpdatePin({ siteDir: '/site' }, h.deps);
    assert.strictEqual(rc, 0);
    assert.strictEqual(h.out.join('\n'), 'gm-apprentice-publish 1.11.30 is current');
    assert.deepStrictEqual(h.writes, {});
    assert.deepStrictEqual(h.runs, []);
  });

  it('--check reports the drift and writes nothing, exiting 1', async () => {
    const h = harness({
      files: siteFiles(`file:${CACHE}/1.11.20/tools/publish`, '1.11.20'),
      detect: drift('1.11.29', '1.11.30'),
    });
    const rc = await runUpdatePin({ siteDir: '/site', check: true }, h.deps);
    assert.strictEqual(rc, 1);
    const text = h.out.join('\n');
    assert.match(text, /pinned:\s+1\.11\.20/);
    assert.match(text, /installed:\s+1\.11\.20/);
    assert.match(text, /desired:\s+1\.11\.30/);
    assert.deepStrictEqual(h.writes, {});
    assert.deepStrictEqual(h.runs, []);
  });

  it('--check --json reports the drift flag', async () => {
    const h = harness({
      files: siteFiles(`file:${CACHE}/1.11.20/tools/publish`, '1.11.20'),
      detect: drift('1.11.29', '1.11.30'),
    });
    const rc = await runUpdatePin({ siteDir: '/site', check: true, json: true }, h.deps);
    assert.strictEqual(rc, 1);
    assert.deepStrictEqual(JSON.parse(h.out.join('')), {
      pinnedBefore: '1.11.20',
      pinnedAfter: '1.11.20',
      installedBefore: '1.11.20',
      installedAfter: '1.11.20',
      desired: '1.11.30',
      changed: false,
      ok: false,
    });
  });

  it('rewrites the pin, runs npm install in the site, and reports the move', async () => {
    const h = harness({
      files: siteFiles(`file:${CACHE}/1.11.20/tools/publish`, '1.11.20'),
      detect: drift('1.11.29', '1.11.30'),
      npm: (store) => {
        store[path.resolve('/site/node_modules/gm-apprentice-publish/package.json')] = installedPkg('1.11.30');
        return { code: 0, stdout: 'added 1 package', stderr: '' };
      },
    });
    const rc = await runUpdatePin({ siteDir: '/site' }, h.deps);
    assert.strictEqual(rc, 0);

    const written = JSON.parse(h.writes[path.resolve('/site/package.json')]);
    assert.strictEqual(written.dependencies['gm-apprentice-publish'], `file:${CACHE}/1.11.30/tools/publish`);
    // Untouched keys survive, and the file keeps 2-space JSON plus a trailing newline.
    assert.strictEqual(written.name, 'my-campaign-site');
    assert.ok(h.writes[path.resolve('/site/package.json')].endsWith('}\n'));
    assert.match(h.writes[path.resolve('/site/package.json')], /\n {2}"dependencies"/);

    assert.deepStrictEqual(h.runs, [{ cmd: 'npm', args: ['install'], cwd: '/site' }]);
    assert.match(h.out.join('\n'), /Updated gm-apprentice-publish from 1\.11\.20 to 1\.11\.30/);
  });

  it('repoints a stale site even when the running tool is already the newest', async () => {
    // detectVersionDrift reports no drift (the tool IS the latest) but hands back
    // versionsRoot, which is all the suggested path needs.
    const h = harness({
      files: siteFiles(`file:${CACHE}/1.11.20/tools/publish`, '1.11.20'),
      detect: drift('1.11.30', '1.11.30'),
      npm: (store) => {
        store[path.resolve('/site/node_modules/gm-apprentice-publish/package.json')] = installedPkg('1.11.30');
        return { code: 0, stdout: '', stderr: '' };
      },
    });
    const rc = await runUpdatePin({ siteDir: '/site' }, h.deps);
    assert.strictEqual(rc, 0);
    const written = JSON.parse(h.writes[path.resolve('/site/package.json')]);
    assert.strictEqual(written.dependencies['gm-apprentice-publish'], `file:${CACHE}/1.11.30/tools/publish`);
  });

  it('reports "none" when nothing was installed before', async () => {
    const h = harness({
      files: siteFiles(`file:${CACHE}/1.11.20/tools/publish`),
      detect: drift('1.11.29', '1.11.30'),
      npm: (store) => {
        store[path.resolve('/site/node_modules/gm-apprentice-publish/package.json')] = installedPkg('1.11.30');
        return { code: 0, stdout: '', stderr: '' };
      },
    });
    assert.strictEqual(await runUpdatePin({ siteDir: '/site' }, h.deps), 0);
    assert.match(h.out.join('\n'), /Updated gm-apprentice-publish from none to 1\.11\.30/);
  });

  it('exits 1 with the npm stderr tail when the install does not land the version', async () => {
    const h = harness({
      files: siteFiles(`file:${CACHE}/1.11.20/tools/publish`, '1.11.20'),
      detect: drift('1.11.29', '1.11.30'),
      npm: () => ({ code: 1, stdout: '', stderr: 'npm ERR! code ENOENT\nnpm ERR! path missing\n' }),
    });
    const rc = await runUpdatePin({ siteDir: '/site' }, h.deps);
    assert.strictEqual(rc, 1);
    const text = h.out.join('\n');
    assert.match(text, /npm ERR! path missing/);
    assert.match(text, /1\.11\.30/);
    // The pin was still rewritten — the file on disk names the version we want.
    const written = JSON.parse(h.writes[path.resolve('/site/package.json')]);
    assert.strictEqual(written.dependencies['gm-apprentice-publish'], `file:${CACHE}/1.11.30/tools/publish`);
  });

  it('--json reports the before/after pair', async () => {
    const h = harness({
      files: siteFiles(`file:${CACHE}/1.11.20/tools/publish`, '1.11.20'),
      detect: drift('1.11.29', '1.11.30'),
      npm: (store) => {
        store[path.resolve('/site/node_modules/gm-apprentice-publish/package.json')] = installedPkg('1.11.30');
        return { code: 0, stdout: '', stderr: '' };
      },
    });
    assert.strictEqual(await runUpdatePin({ siteDir: '/site', json: true }, h.deps), 0);
    assert.deepStrictEqual(JSON.parse(h.out.join('')), {
      pinnedBefore: '1.11.20',
      pinnedAfter: '1.11.30',
      installedBefore: '1.11.20',
      installedAfter: '1.11.30',
      desired: '1.11.30',
      changed: true,
      ok: true,
    });
  });

  it('exits 1 when the site directory has no package.json', async () => {
    const h = harness({ files: {}, detect: drift('1.11.29', '1.11.30') });
    const rc = await runUpdatePin({ siteDir: '/site' }, h.deps);
    assert.strictEqual(rc, 1);
    assert.match(h.out.join('\n'), /no package\.json/i);
  });

  it('leaves a site with no gm-apprentice-publish dependency alone', async () => {
    const h = harness({
      files: { [path.resolve('/site/package.json')]: JSON.stringify({ name: 'x' }) },
      detect: drift('1.11.29', '1.11.30'),
    });
    const rc = await runUpdatePin({ siteDir: '/site' }, h.deps);
    assert.strictEqual(rc, 0);
    assert.match(h.out.join('\n'), /no gm-apprentice-publish dependency/);
    assert.deepStrictEqual(h.writes, {});
  });
});

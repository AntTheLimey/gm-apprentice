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
    assert.strictEqual(h.out.join('\n'), 'gm-apprentice-publish 1.11.30 is current (plugin 1.11.30)');
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

    assert.deepStrictEqual(h.runs, [{ cmd: 'npm', args: ['install'], cwd: path.resolve('/site') }]);
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

  it('--json still emits a payload when the site has no package.json', async () => {
    const h = harness({ files: {}, detect: drift('1.11.29', '1.11.30') });
    const rc = await runUpdatePin({ siteDir: '/site', json: true }, h.deps);
    assert.strictEqual(rc, 1);
    // The payload is the whole of stdout — a caller parsing it must not trip over
    // a human sentence printed alongside it.
    assert.deepStrictEqual(JSON.parse(h.out.join('')), {
      pinnedBefore: null,
      pinnedAfter: null,
      installedBefore: null,
      installedAfter: null,
      desired: '1.11.30',
      changed: false,
      ok: false,
    });
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

describe('update-pin --tag', () => {
  const crypto = require('crypto');
  const TAG = 'publish-v1.11.40';
  const NAME = 'gm-apprentice-publish-1.11.40.tgz';
  const BASE = 'https://github.com/AntTheLimey/gm-apprentice/releases/download/publish-v1.11.40';
  const body = Buffer.from('fake tarball bytes');
  const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

  // A fetch that serves from a url -> Buffer|status map and records calls.
  function fakeFetch(routes, calls) {
    return async (url, init) => {
      calls.push({ url, hasSignal: !!(init && init.signal) });
      const r = routes[url];
      if (r === undefined) return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
      if (r instanceof Error) throw r;
      return { ok: true, status: 200, arrayBuffer: async () => r.buffer.slice(r.byteOffset, r.byteOffset + r.byteLength) };
    };
  }

  function tagHarness({ sums, tarball = body, spec = 'file:/x/1.11.30/tools/publish', installed = '1.11.30', routes }) {
    const h = harness({
      files: siteFiles(spec, installed),
      detect: null,
      npm: (store) => {
        store[path.resolve('/site/node_modules/gm-apprentice-publish/package.json')] = installedPkg('1.11.40');
        return { code: 0, stdout: '', stderr: '' };
      },
    });
    const calls = [];
    const bin = {};
    h.deps.fetch = fakeFetch(routes || {
      [`${BASE}/SHA256SUMS`]: Buffer.from(sums === undefined ? `${sha(body)}  ${NAME}\n` : sums),
      [`${BASE}/${NAME}`]: tarball,
    }, calls);
    h.deps.mkdirp = () => {};
    h.deps.writeFile = (p, c) => { const k = path.resolve(p); h.store[k] = c; h.writes[k] = c; bin[k] = c; };
    h.deps.unlink = (p) => { h.writes[`unlink:${path.resolve(p)}`] = true; };
    return Object.assign(h, { calls });
  }

  it('downloads, verifies, vendors the tarball and pins to it', async () => {
    const h = tagHarness({});
    const rc = await runUpdatePin({ siteDir: '/site', tag: TAG }, h.deps);
    assert.strictEqual(rc, 0);
    assert.deepStrictEqual(h.calls.map((c) => c.url), [`${BASE}/SHA256SUMS`, `${BASE}/${NAME}`]);
    assert.ok(h.calls.every((c) => c.hasSignal), 'every request carries a timeout signal');
    assert.ok(h.writes[path.resolve(`/site/vendor/${NAME}`)].equals(body));
    const pkg = JSON.parse(h.writes[path.resolve('/site/package.json')]);
    assert.strictEqual(pkg.dependencies['gm-apprentice-publish'], `file:vendor/${NAME}`);
    assert.deepStrictEqual(h.runs.map((r) => r.cmd + ' ' + r.args.join(' ')), ['npm install']);
    assert.match(h.out.join('\n'), /Updated gm-apprentice-publish from 1\.11\.30 to 1\.11\.40 \(publish-v1\.11\.40, checksum verified\)/);
  });

  it('fails loudly on a checksum mismatch and writes nothing', async () => {
    const h = tagHarness({ tarball: Buffer.from('tampered') });
    const rc = await runUpdatePin({ siteDir: '/site', tag: TAG }, h.deps);
    assert.strictEqual(rc, 1);
    assert.match(h.out.join('\n'), /CHECKSUM MISMATCH/);
    assert.deepStrictEqual(h.writes, {});
    assert.deepStrictEqual(h.runs, []);
  });

  it('fails when SHA256SUMS has no entry for the tarball', async () => {
    const h = tagHarness({ sums: `${sha(body)}  other.tgz\n` });
    const rc = await runUpdatePin({ siteDir: '/site', tag: TAG }, h.deps);
    assert.strictEqual(rc, 1);
    assert.match(h.out.join('\n'), /no entry for gm-apprentice-publish-1\.11\.40\.tgz/);
    assert.deepStrictEqual(h.writes, {});
  });

  it('reports a network failure and writes nothing', async () => {
    const h = tagHarness({ routes: { [`${BASE}/SHA256SUMS`]: new Error('network down') } });
    const rc = await runUpdatePin({ siteDir: '/site', tag: TAG }, h.deps);
    assert.strictEqual(rc, 1);
    assert.match(h.out.join('\n'), /Could not fetch publish-v1\.11\.40: network down/);
    assert.deepStrictEqual(h.writes, {});
  });

  it('reports an HTTP 404 for an unknown tag', async () => {
    const h = tagHarness({ routes: {} });
    const rc = await runUpdatePin({ siteDir: '/site', tag: TAG }, h.deps);
    assert.strictEqual(rc, 1);
    assert.match(h.out.join('\n'), /HTTP 404/);
  });

  it('rejects an empty --tag instead of falling through to a cache repoint (#274 final review)', async () => {
    const h = tagHarness({});
    const rc = await runUpdatePin({ siteDir: '/site', tag: '' }, h.deps);
    assert.strictEqual(rc, 1);
    assert.match(h.out.join('\n'), /--tag must look like publish-vX\.Y\.Z \(got ""\)/);
    assert.deepStrictEqual(h.calls, []);
    assert.deepStrictEqual(h.writes, {});
  });

  it('rejects a malformed tag before any network call', async () => {
    const h = tagHarness({});
    const rc = await runUpdatePin({ siteDir: '/site', tag: 'v1.9.11' }, h.deps);
    assert.strictEqual(rc, 1);
    assert.match(h.out.join('\n'), /--tag must look like publish-vX\.Y\.Z/);
    assert.deepStrictEqual(h.calls, []);
  });

  it('is a no-op when already pinned and installed', async () => {
    const h = tagHarness({ spec: `file:vendor/${NAME}`, installed: '1.11.40' });
    const rc = await runUpdatePin({ siteDir: '/site', tag: TAG }, h.deps);
    assert.strictEqual(rc, 0);
    assert.deepStrictEqual(h.calls, []);
    assert.match(h.out.join('\n'), /1\.11\.40 is current/);
  });

  it('--check reports drift without touching the network', async () => {
    const h = tagHarness({});
    const rc = await runUpdatePin({ siteDir: '/site', tag: TAG, check: true }, h.deps);
    assert.strictEqual(rc, 1);
    assert.deepStrictEqual(h.calls, []);
    assert.deepStrictEqual(h.writes, {});
  });

  it('removes the tarball an earlier --tag pin vendored', async () => {
    const h = tagHarness({ spec: 'file:vendor/gm-apprentice-publish-1.11.39.tgz', installed: '1.11.39' });
    const rc = await runUpdatePin({ siteDir: '/site', tag: TAG }, h.deps);
    assert.strictEqual(rc, 0);
    assert.ok(h.writes[`unlink:${path.resolve('/site/vendor/gm-apprentice-publish-1.11.39.tgz')}`]);
  });

  it('emits JSON with --json', async () => {
    const h = tagHarness({});
    await runUpdatePin({ siteDir: '/site', tag: TAG, json: true }, h.deps);
    const payload = JSON.parse(h.out.join('\n'));
    assert.strictEqual(payload.desired, '1.11.40');
    assert.strictEqual(payload.ok, true);
    assert.strictEqual(payload.changed, true);
  });
});

describe('update-pin records the site in its vault', () => {
  const fs = require('fs');
  const os = require('os');
  const { parseNote } = require('../lib/frontmatter');

  // A real site and vault on disk: the vault file is edited for real.
  function site(config) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pin-site-'));
    const siteDir = path.join(root, 'site');
    const vault = path.join(root, 'vault');
    fs.mkdirSync(siteDir);
    fs.mkdirSync(path.join(vault, '_meta'), { recursive: true });
    fs.writeFileSync(path.join(siteDir, 'vault.config.json'), JSON.stringify({ vaultPath: '../vault' }));
    fs.writeFileSync(path.join(siteDir, 'package.json'), '{}');
    if (config !== null) fs.writeFileSync(path.join(vault, '_meta', 'vault-config.md'), config);
    const publish = () => parseNote(fs.readFileSync(path.join(vault, '_meta', 'vault-config.md'), 'utf8')).data.publish;
    return { root, siteDir, vault, publish, posix: path.resolve(siteDir).split(path.sep).join('/') };
  }
  // Not in a plugin cache: the repoint itself has nothing to do.
  const run = (s, opts = {}) => {
    const out = [];
    return runUpdatePin({ siteDir: s.siteDir, ...opts }, { out: (l) => out.push(String(l)), detect: () => null }).then((rc) => ({ rc, out }));
  };

  it('writes publish.site_dir when the vault does not have it', async () => {
    const s = site('---\ntype: meta\npublish:\n  mode: player\n---\n');
    try {
      const { rc, out } = await run(s);
      assert.strictEqual(rc, 0);
      assert.strictEqual(s.publish().site_dir, s.posix);
      assert.strictEqual(s.publish().mode, 'player');
      assert.ok(out.some((l) => l.includes('recorded this site in the vault')), out.join('\n'));
    } finally { fs.rmSync(s.root, { recursive: true, force: true }); }
  });
  it('records that the vault has a site where the switch is unset, and leaves one the GM set', async () => {
    const unset = site('---\npublish:\n  mode: player\n---\n');
    const off = site('---\npublish:\n  site: false\n---\n');
    try {
      const a = await run(unset);
      assert.strictEqual(unset.publish().site, true);
      assert.ok(a.out.some((l) => l.includes('publish.site = true')), a.out.join('\n'));
      const b = await run(off);
      assert.strictEqual(off.publish().site, false);
      assert.strictEqual(off.publish().site_dir, off.posix);
      assert.ok(!b.out.some((l) => l.includes('publish.site = true')), b.out.join('\n'));
    } finally {
      fs.rmSync(unset.root, { recursive: true, force: true });
      fs.rmSync(off.root, { recursive: true, force: true });
    }
  });
  it('leaves a site_dir that is already set, wherever it points', async () => {
    const s = site('---\npublish:\n  site_dir: /somewhere/else\n---\n');
    try {
      const { out } = await run(s);
      assert.strictEqual(s.publish().site_dir, '/somewhere/else');
      assert.ok(!out.some((l) => l.includes('recorded this site')));
    } finally { fs.rmSync(s.root, { recursive: true, force: true }); }
  });
  it('--check writes nothing', async () => {
    const before = '---\npublish:\n  mode: player\n---\n';
    const s = site(before);
    try {
      await run(s, { check: true });
      assert.strictEqual(fs.readFileSync(path.join(s.vault, '_meta', 'vault-config.md'), 'utf8'), before);
    } finally { fs.rmSync(s.root, { recursive: true, force: true }); }
  });
  it('--json stays one JSON document', async () => {
    const s = site('---\npublish:\n  mode: player\n---\n');
    try {
      const { out } = await run(s, { json: true });
      assert.doesNotThrow(() => JSON.parse(out.join('\n')));
      assert.strictEqual(s.publish().site_dir, s.posix);
    } finally { fs.rmSync(s.root, { recursive: true, force: true }); }
  });
  it('a site with no vault.config.json, or a vault that is not there, stops nothing and creates nothing', async () => {
    const s = site(null);
    try {
      fs.rmSync(s.vault, { recursive: true, force: true });
      assert.strictEqual((await run(s)).rc, 0);
      assert.ok(!fs.existsSync(s.vault));
      fs.rmSync(path.join(s.siteDir, 'vault.config.json'));
      assert.strictEqual((await run(s)).rc, 0);
    } finally { fs.rmSync(s.root, { recursive: true, force: true }); }
  });
  it('never creates a vault file: a folder with none is said, not turned into a vault', async () => {
    const s = site(null);
    try {
      const { rc, out } = await run(s);
      assert.strictEqual(rc, 0);
      assert.ok(!fs.existsSync(path.join(s.vault, '_meta', 'vault-config.md')));
      assert.ok(out.some((l) => l.includes('could not record this site in the vault') && l.includes('has no _meta/vault-config.md') && l.includes(`site_dir: ${s.posix}`)), out.join('\n'));
    } finally { fs.rmSync(s.root, { recursive: true, force: true }); }
  });
  it('fills a blank site_dir', async () => {
    for (const blank of ['site_dir:', 'site_dir: null', 'site_dir: ""']) {
      const s = site(`---\npublish:\n  ${blank}\n  mode: player\n---\n`);
      try {
        await run(s);
        assert.strictEqual(s.publish().site_dir, s.posix, blank);
        assert.strictEqual(s.publish().mode, 'player');
      } finally { fs.rmSync(s.root, { recursive: true, force: true }); }
    }
  });
  it('the same site written another way is not a different site', async () => {
    for (const written of ['../site', '../site/']) {
      const s = site(`---\npublish:\n  site_dir: ${written}\n---\n`);
      try {
        const { out } = await run(s);
        assert.ok(!out.some((l) => l.includes('different site')), out.join('\n'));
        assert.strictEqual(s.publish().site_dir, written);
      } finally { fs.rmSync(s.root, { recursive: true, force: true }); }
    }
  });
  it('the same site written from the home folder is not a different site', async () => {
    const s = site('---\npublish:\n  site_dir: ~/site\n---\n');
    const was = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
    process.env.HOME = s.root;
    process.env.USERPROFILE = s.root;
    try {
      const { out } = await run(s);
      assert.ok(!out.some((l) => l.includes('different site')), out.join('\n'));
      assert.strictEqual(s.publish().site_dir, '~/site');
    } finally {
      for (const [k, v] of Object.entries(was)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
      fs.rmSync(s.root, { recursive: true, force: true });
    }
  });
  it('says so when the vault names a different site, and when the file cannot be edited', async () => {
    const other = site('---\npublish:\n  site_dir: /somewhere/else\n---\n');
    const flow = site('---\npublish: {mode: player}\n---\n');
    try {
      assert.ok((await run(other)).out.some((l) => l.includes('already names a different site (publish.site_dir: /somewhere/else)')));
      const { rc, out } = await run(flow);
      assert.strictEqual(rc, 0);
      assert.ok(out.some((l) => l.includes('could not record this site in the vault') && l.includes(`site_dir: ${flow.posix}`)), out.join('\n'));
      assert.strictEqual(flow.publish().site_dir, undefined);
    } finally {
      fs.rmSync(other.root, { recursive: true, force: true });
      fs.rmSync(flow.root, { recursive: true, force: true });
    }
  });
  it('a folder with no package.json, and a --tag that is refused, write nothing', async () => {
    const before = '---\npublish:\n  mode: player\n---\n';
    const s = site(before);
    const file = path.join(s.vault, '_meta', 'vault-config.md');
    try {
      assert.strictEqual((await run(s, { tag: 'nonsense' })).rc, 1);
      assert.strictEqual(fs.readFileSync(file, 'utf8'), before);
      fs.rmSync(path.join(s.siteDir, 'package.json'));
      await run(s);
      assert.strictEqual(fs.readFileSync(file, 'utf8'), before);
    } finally { fs.rmSync(s.root, { recursive: true, force: true }); }
  });
});

describe('update-pin compares the tool version, not the plugin folder', () => {
  // Plugin 1.10.25 holds publish tool 1.12.1: the folder's number and the package's differ.
  const toolPkg = { [path.resolve(`${CACHE}/1.10.25/tools/publish/package.json`)]: JSON.stringify({ version: '1.12.1' }) };

  it('a site pinned to the newest plugin with its tool installed is current', async () => {
    const h = harness({
      files: Object.assign(siteFiles(`file:${CACHE}/1.10.25/tools/publish`, '1.12.1'), toolPkg),
      detect: drift('1.10.25', '1.10.25'),
    });
    assert.strictEqual(await runUpdatePin({ siteDir: '/site' }, h.deps), 0);
    assert.strictEqual(h.out.join('\n'), 'gm-apprentice-publish 1.12.1 is current (plugin 1.10.25)');
    assert.deepStrictEqual(h.runs, []);
  });
  it('a repoint that installs the tool the plugin holds is a success', async () => {
    const h = harness({
      files: Object.assign(siteFiles(`file:${CACHE}/1.10.19/tools/publish`, '1.11.41'), toolPkg),
      detect: drift('1.10.25', '1.10.25'),
      npm: (store) => {
        store[path.resolve('/site/node_modules/gm-apprentice-publish/package.json')] = installedPkg('1.12.1');
        return { code: 0, stdout: '', stderr: '' };
      },
    });
    assert.strictEqual(await runUpdatePin({ siteDir: '/site' }, h.deps), 0);
    assert.match(h.out.join('\n'), /Updated gm-apprentice-publish from 1\.11\.41 to 1\.12\.1/);
  });
  it('an install that left the old tool is still a failure', async () => {
    const h = harness({
      files: Object.assign(siteFiles(`file:${CACHE}/1.10.19/tools/publish`, '1.11.41'), toolPkg),
      detect: drift('1.10.25', '1.10.25'),
    });
    assert.strictEqual(await runUpdatePin({ siteDir: '/site' }, h.deps), 1);
    assert.match(h.out.join('\n'), /to plugin 1\.10\.25 \(tool 1\.12\.1\), but npm install left 1\.11\.41/);
  });
});

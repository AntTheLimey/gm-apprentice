const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { syncScaffoldFunctions } = require('../../lib/sync-functions');

// A tiny fake scaffold Functions tree, so tests don't depend on the real templates.
function makeSource(root) {
  const src = path.join(root, 'scaffold', 'functions');
  fs.mkdirSync(path.join(src, 'api'), { recursive: true });
  fs.writeFileSync(path.join(src, 'api', 'loadout.js'), 'export const onRequest = () => {}; // v2\n');
  fs.writeFileSync(path.join(src, 'api', 'loadout-list.js'), 'export const onRequest = () => {}; // list\n');
  fs.writeFileSync(path.join(src, 'api', 'package.json'), '{"type":"module"}\n');
  return src;
}

describe('syncScaffoldFunctions', () => {
  let work, sourceDir, siteRoot;

  beforeEach(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-sync-fn-'));
    sourceDir = makeSource(work);
    siteRoot = path.join(work, 'site');
    fs.mkdirSync(siteRoot, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(work, { recursive: true, force: true });
  });

  const read = (rel) => fs.readFileSync(path.join(siteRoot, 'functions', rel), 'utf8');

  it('copies every scaffold Function into a site that has none', () => {
    const res = syncScaffoldFunctions(siteRoot, { sourceDir });
    assert.deepStrictEqual(res.created.sort(), ['api/loadout-list.js', 'api/loadout.js', 'api/package.json']);
    assert.deepStrictEqual(res.updated, []);
    assert.match(read('api/loadout-list.js'), /list/);
  });

  it('adds a missing Function without touching existing ones', () => {
    // Simulate an old site: has loadout.js but not the newer loadout-list.js.
    fs.mkdirSync(path.join(siteRoot, 'functions', 'api'), { recursive: true });
    fs.writeFileSync(path.join(siteRoot, 'functions', 'api', 'loadout.js'), 'export const onRequest = () => {}; // v2\n');
    fs.writeFileSync(path.join(siteRoot, 'functions', 'api', 'package.json'), '{"type":"module"}\n');

    const res = syncScaffoldFunctions(siteRoot, { sourceDir });
    assert.deepStrictEqual(res.created, ['api/loadout-list.js']);
    assert.deepStrictEqual(res.updated, []);
  });

  it('overwrites a stale Function to match the current scaffold', () => {
    fs.mkdirSync(path.join(siteRoot, 'functions', 'api'), { recursive: true });
    fs.writeFileSync(path.join(siteRoot, 'functions', 'api', 'loadout.js'), 'export const onRequest = () => {}; // v1 OLD\n');

    const res = syncScaffoldFunctions(siteRoot, { sourceDir });
    assert.ok(res.updated.includes('api/loadout.js'));
    assert.match(read('api/loadout.js'), /v2/);
    assert.doesNotMatch(read('api/loadout.js'), /OLD/);
  });

  it('is a no-op on a site already in sync (no needless rewrites)', () => {
    syncScaffoldFunctions(siteRoot, { sourceDir });
    const res = syncScaffoldFunctions(siteRoot, { sourceDir });
    assert.deepStrictEqual(res.created, []);
    assert.deepStrictEqual(res.updated, []);
  });
});

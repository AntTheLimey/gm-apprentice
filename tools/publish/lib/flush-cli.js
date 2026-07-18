'use strict';

// `flush` command: snapshot each PC's current KV live-state back into the vault
// .md so the build-time fallback seed stays fresh past KV's 30-day TTL. Edits
// vault source only — no rebuild/deploy. Every side effect is behind an
// injectable dep so the runner is unit-testable without wrangler or real disk.
const fs = require('fs');
const path = require('path');
const { scanVault, slugify } = require('./scanner');
const { readNamespaceId, makeAdapter } = require('./inbox-wrangler');
const { latestStateByPcSlug } = require('./flush/reconcile');
const { applyCoCFlush } = require('./flush/coc-writeback');

const { spawnSync } = require('child_process');

function defaultRunWrangler(args) {
  const res = spawnSync('npx', ['wrangler@4', ...args], { encoding: 'utf8' });
  return { code: res.status == null ? 1 : res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

function defaultAdapter(cwd) {
  const tomlPath = path.join(cwd || process.cwd(), 'wrangler.toml');
  const namespaceId = readNamespaceId(fs.readFileSync(tomlPath, 'utf8'));
  if (!namespaceId) throw new Error('No INBOX namespace id in wrangler.toml — run the inbox setup first.');
  return makeAdapter({ runWrangler: defaultRunWrangler, namespaceId });
}

// "HP 11→7, Dying on" — scalars show from→to, conditions show on/off.
function summarize(changes) {
  return changes.map(function (c) {
    if (typeof c.to === 'boolean') return c.field + ' ' + (c.to ? 'on' : 'off');
    return c.field + ' ' + (c.from == null ? '?' : c.from) + '→' + c.to;
  }).join(', ');
}

async function runFlush(deps) {
  deps = deps || {};
  const out = deps.out || console.log;
  const readFile = deps.readFile || function (p) { return fs.readFileSync(p, 'utf8'); };
  const writeFile = deps.writeFile || function (p, s) { fs.writeFileSync(p, s); };

  // Resolve config exactly as build.js does (so campaignId/pcSlug match).
  const configPath = path.resolve(deps.configPath || './vault.config.json');
  const configDir = path.dirname(configPath);
  const config = deps.config || require(configPath);
  const vaultPath = deps.config ? config.vaultPath : path.resolve(configDir, config.vaultPath);
  const campaignId = slugify(config.siteTitle || 'campaign');

  const adapter = deps.adapter || defaultAdapter(configDir);
  const core = await import('../templates-scaffold/functions/api/loadout-core.mjs');
  const states = await core.getStates(adapter, campaignId);
  const latest = latestStateByPcSlug(states);

  if (!Object.keys(latest).length) {
    out('No live state read for campaign ' + campaignId + '. If players saved sheet state this session, this can also mean KV could not be read — check `npx wrangler@4 whoami` and the INBOX namespace id in wrangler.toml.');
    return 0;
  }

  const scan = deps.scan || function () { return scanVault(Object.assign({}, config, { vaultPath: vaultPath })); };
  const bySlug = {};
  for (const p of scan()) {
    if (p.frontmatter && p.frontmatter.type === 'pc') bySlug[slugify(p.title)] = p;
  }

  for (const slug of Object.keys(latest)) {
    const page = bySlug[slug];
    if (!page) { out('⚠ ' + slug + ' — in KV but no matching vault sheet (skipped)'); continue; }
    const name = page.displayTitle || page.title;
    const res = applyCoCFlush(readFile(page.sourcePath), latest[slug]);
    if (res.changes.length) {
      writeFile(page.sourcePath, res.markdown);
      out('✓ ' + name + ' — ' + summarize(res.changes));
    } else {
      out('· ' + name + ' — no change');
    }
  }
  return 0;
}

module.exports = { runFlush };

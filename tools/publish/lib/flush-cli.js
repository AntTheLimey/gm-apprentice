'use strict';

// `flush` command: snapshot each PC's current KV live-state back into the vault
// .md so the build-time fallback seed stays fresh past KV's 30-day TTL. Edits
// vault source only — no rebuild/deploy. Every side effect is behind an
// injectable dep so the runner is unit-testable without wrangler or real disk.
const fs = require('fs');
const path = require('path');
const { scanVault, slugify, pcLiveKey } = require('./scanner');
const { readNamespaceId, makeAdapter } = require('./inbox-wrangler');
const { latestStateByPcSlug } = require('./flush/reconcile');
const { applyCoCFlush } = require('./flush/coc-writeback');
const { applyDnDFlush } = require('./flush/dnd-writeback');
const { applyGURPSFlush } = require('./flush/gurps-writeback');
const { deriveGurpsMax } = require('./flush/gurps-max');
const { resolveConfig, loadVaultConfig } = require('./config');
const { detectStatusBar } = require('./backend-flags');

const { runCommand, WRANGLER_TIMEOUT_MS } = require('./run-command');

// Bounded like the watcher's poll (#154). The failure here is milder — the GM
// watches a flush hang rather than a background watcher going silently dark —
// but an unbounded spawn still blocks the flush with no exit and no signal.
function defaultRunWrangler(args, run = runCommand) {
  const res = run('npx', ['wrangler@4', ...args], { timeoutMs: WRANGLER_TIMEOUT_MS });
  return { code: res.code, stdout: res.stdout || '', stderr: res.stderr || '', error: res.error || null };
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

// Which writer a PC's note takes. A PC's own frontmatter.system wins; otherwise the
// campaign system decides (publishConfig.system, resolved as build.js does). CoC is
// the default, as it always was: old CoC sites carry no system.
function resolveSystem(frontmatter, campaignSystem) {
  const s = String((frontmatter && frontmatter.system) || campaignSystem || '').toLowerCase();
  if (s.indexOf('gurps') !== -1) return 'gurps';
  if (/^dnd/.test(s) || /^d&d/.test(s)) return 'dnd';
  return 'coc';
}

// One writer per system: (raw note, stored record, page, out) -> { markdown, changes, skipped? },
// or null to skip the note after saying why.
const WRITERS = {
  gurps: function (raw, rec, page, out) {
    // GURPS flush edits the body `## Current Status` block, but the parser
    // reads HP/FP from frontmatter when `status:` is authored as a YAML
    // object — so a body rewrite would report a phantom success the build
    // ignores. Skip and tell the GM to move the vitals out of frontmatter.
    const fmStatus = page.frontmatter && page.frontmatter.status;
    if (fmStatus && typeof fmStatus === 'object' && !Array.isArray(fmStatus)) {
      out('⚠ ' + (page.displayTitle || page.title) + ' — HP/FP are pinned in frontmatter (status:); flush edits the body block, which the build ignores. Move them out of frontmatter to sync.');
      return null;
    }
    const { maxHp, maxFp } = deriveGurpsMax(raw, page.frontmatter);
    return applyGURPSFlush(raw, rec, { maxHp: maxHp, maxFp: maxFp });
  },
  dnd: function (raw, rec) { return applyDnDFlush(raw, rec); },
  coc: function (raw, rec) { return applyCoCFlush(raw, rec); },
};

async function runFlush(deps) {
  deps = deps || {};
  const out = deps.out || console.log;
  const readFile = deps.readFile || function (p) { return fs.readFileSync(p, 'utf8'); };
  const writeFile = deps.writeFile || function (p, s) { fs.writeFileSync(p, s); };
  // --dry-run: identical reconciliation and report, no write (#178). The GM
  // reads the same "✓ Name — HP 10→13" lines they would get for real.
  const dryRun = !!deps.dryRun;

  // Resolve config exactly as build.js does (so campaignId/pcSlug match).
  const configPath = path.resolve(deps.configPath || './vault.config.json');
  const configDir = path.dirname(configPath);
  const rawConfig = loadVaultConfig(configPath, deps);
  const vaultPath = deps.config ? rawConfig.vaultPath : path.resolve(configDir, rawConfig.vaultPath);
  const { config, publishConfig } = deps.publishConfig
    ? { config: rawConfig, publishConfig: deps.publishConfig }
    : resolveConfig(rawConfig, vaultPath);
  const campaignSystem = publishConfig.system;
  const campaignId = slugify(config.siteTitle || 'campaign');

  // Flush writes live vitals into PC notes. With live stats off (or sheets off, which forces
  // them off) there is no live state to keep, so it does nothing. An injected publishConfig
  // with no `switches` (a test seam) means on, as in pcKeepList.
  const switches = publishConfig.switches;
  if (switches && switches.liveStats !== true) {
    const deployedButUnset = switches.characterSheets !== false && (switches.unset || []).includes('live_stats') && detectStatusBar(configDir);
    out(switches.characterSheets === false
      ? 'Nothing flushed: character sheets are off for this campaign, so live stats are off too.'
      : deployedButUnset
        ? 'Nothing flushed: live stats are deployed on this site but publish.live_stats is not set, so they are off. Set publish.live_stats to true to keep them, then flush again.'
        : 'Nothing flushed: live stats are off for this campaign (publish.live_stats is not true).');
    return 0;
  }

  const adapter = deps.adapter || defaultAdapter(configDir);
  const core = await import('../templates-scaffold/functions/api/loadout-core.mjs');
  let states;
  try {
    states = await core.getStates(adapter, campaignId);
  } catch (e) {
    out('✖ Could not read live state from KV: ' + e.message);
    out('  Nothing was written. Check `npx wrangler@4 whoami` and the INBOX namespace id in wrangler.toml, then re-run flush.');
    return 1;
  }
  const latest = latestStateByPcSlug(states);

  if (dryRun) out('DRY RUN — nothing will be written.');
  if (!Object.keys(latest).length) {
    out('No live state to flush for campaign ' + campaignId + ' — no players have saved sheet state yet.');
    return 0;
  }

  const scan = deps.scan || function () { return scanVault(Object.assign({}, config, { vaultPath: vaultPath })); };
  const bySlug = {};
  for (const p of scan()) {
    if (p.frontmatter && p.frontmatter.type === 'pc') bySlug[pcLiveKey(p.frontmatter, p.title)] = p;
  }

  for (const slug of Object.keys(latest)) {
    const page = bySlug[slug];
    if (!page) { out('⚠ ' + slug + ' — in KV but no matching vault sheet (skipped)'); continue; }
    const name = page.displayTitle || page.title;
    const raw = readFile(page.sourcePath);
    const res = WRITERS[resolveSystem(page.frontmatter, campaignSystem)](raw, latest[slug], page, out);
    if (!res) continue;
    if (res.changes.length) {
      if (dryRun) {
        out('✓ ' + name + ' — ' + summarize(res.changes) + '  (would write)');
      } else {
        writeFile(page.sourcePath, res.markdown);
        out('✓ ' + name + ' — ' + summarize(res.changes));
      }
    } else {
      out('· ' + name + ' — no change');
    }
    if (res.skipped && res.skipped.length) out('  ' + name + ' — not written, no cell in the note can hold: ' + res.skipped.join(', '));
  }
  return 0;
}

module.exports = { runFlush, resolveSystem, defaultRunWrangler, WRANGLER_TIMEOUT_MS };
